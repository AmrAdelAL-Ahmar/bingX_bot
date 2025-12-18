import { BingXService } from './BingXService';
import Trade from '../models/Trade';
import '../models/User'; // Ensure User model is registered for populate
import logger from '../utils/logger';

export class PositionMonitor {
    private bingX: BingXService;
    private notifier: (telegramId: string, msg: string) => Promise<void>;
    private isRunning: boolean = false;
    private intervalId?: NodeJS.Timeout;

    constructor(bingX: BingXService, notifier: (telegramId: string, msg: string) => Promise<void>) {
        this.bingX = bingX;
        this.notifier = notifier;
    }

    start(intervalMs: number = 30000) { // Check every 30s
        if (this.isRunning) return;
        this.isRunning = true;
        logger.info('Starting Position Monitor...');
        this.checkPositions(); // Run immediately
        this.intervalId = setInterval(() => this.checkPositions(), intervalMs);
    }

    stop() {
        this.isRunning = false;
        if (this.intervalId) clearInterval(this.intervalId);
    }

    async checkPositions() {
        try {
            // We don't populate here to avoid MissingSchemaError if models register out of order.
            // We use manual lookup in the loop instead.
            const openTrades = await Trade.find({ currentStatus: 'OPEN' });
            if (openTrades.length === 0) return;

            // Group by symbol to optimize API calls
            // Group by symbol to optimize API calls
            const symbols = [...new Set(openTrades.map(t => t.symbol))];
            logger.info(`Monitor checking ${openTrades.length} open trades across ${symbols.length} symbols.`);

            for (const symbol of symbols) {
                // Fetch active positions for this symbol
                const positions = await this.bingX.getPositions(symbol);
                // logger.info(`Fetched ${positions.length} positions for ${symbol}`);

                const tradesForSymbol = openTrades.filter(t => t.symbol === symbol);

                for (const trade of tradesForSymbol) {
                    const matchingPos = positions.find((p: any) =>
                        // Check direction match AND ensuring it's not a leftover empty position
                        ((trade.direction === 'LONG' && p.side.toLowerCase() === 'long') ||
                            (trade.direction === 'SHORT' && p.side.toLowerCase() === 'short')) &&
                        parseFloat(p.contracts || '0') > 0
                    );

                    if (matchingPos) {
                        // Position is active
                        continue;
                    } else {
                        // Position is GONE
                        logger.info(`Trade ${trade._id} (${trade.symbol}) is NO LONGER active on BingX. Triggering notification...`);

                        // It closed. Assume TP/SL hit or manual close.
                        const currentPrice = await this.bingX.getMarketPrice(symbol);
                        const entry = trade.entryPrice;
                        const lev = trade.leverage || 10;
                        let pnlPercent = 0;

                        if (currentPrice) {
                            const isLong = trade.direction === 'LONG';
                            const priceDiff = isLong ? (currentPrice - entry) : (entry - currentPrice);
                            pnlPercent = (priceDiff / entry) * 100 * lev;
                        }

                        // Determine if Win or Loss based on PnL sign
                        const isWin = pnlPercent > 0;
                        const emoji = isWin ? '✅ 🎯 Goal Hit' : '❌ Stop Loss Hit';

                        const msg = `<b>${emoji}</b>\n` +
                            `Symbol: ${trade.symbol}\n` +
                            `Type: ${trade.direction}\n` +
                            `Result: ${isWin ? 'Win' : 'Loss'}\n` +
                            `PnL: ${pnlPercent.toFixed(2)}%`;

                        // Populate fallback
                        let user = trade.userId as any;
                        if (user && !user.telegramId) {
                            const User = (trade.constructor as any).db.model('User');
                            user = await User.findById(trade.userId);
                        }

                        if (user && user.telegramId) {
                            logger.info(`Sending ${isWin ? 'Win' : 'Loss'} notification for ${trade.symbol} to ${user.telegramId}`);
                            await this.notifier(user.telegramId, msg);
                        } else {
                            logger.warn(`Could not find User or Telegram ID for trade ${trade._id}. User value: ${JSON.stringify(user)}`);
                        }

                        trade.currentStatus = isWin ? 'CLOSED_PROFIT' : 'CLOSED_LOSS';
                        trade.closeTime = new Date();
                        trade.pnl = pnlPercent;
                        trade.logs.push(`Position monitor detected close. PnL: ${pnlPercent.toFixed(2)}%`);
                        await trade.save();
                    }
                }
            }

        } catch (error) {
            logger.error('Error in PositionMonitor:', error);
        }
    }
}
