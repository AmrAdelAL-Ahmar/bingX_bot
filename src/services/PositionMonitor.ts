import { BingXService } from './BingXService';
import Trade from '../models/Trade';
import User from '../models/User';
import logger from '../utils/logger';

export class PositionMonitor {
    private bingx: BingXService;
    private notifier: (telegramId: string, msg: string) => Promise<void>;
    private isRunning: boolean = false;
    private intervalId?: NodeJS.Timeout;

    constructor(bingx: BingXService, notifier: (telegramId: string, msg: string) => Promise<void>) {
        this.bingx = bingx;
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
            // Include PENDING trades to check for limit fills
            const allTrackedTrades = await Trade.find({ currentStatus: { $in: ['PENDING', 'OPEN', 'TP1_HIT', 'TP2_HIT'] } });
            if (allTrackedTrades.length === 0) return;

            // Separate pending from open
            const pendingTrades = allTrackedTrades.filter(t => t.currentStatus === 'PENDING');
            const activeTrades = allTrackedTrades.filter(t => t.currentStatus !== 'PENDING');

            // --- 1. Handle Pending (Limit) Orders ---
            for (const trade of pendingTrades) {
                if (!trade.bingxOrderId) continue;

                try {
                    const order = await this.bingx.getOrder(trade.symbol, trade.bingxOrderId);
                    if (!order) continue;

                    if (order.status === 'closed' || order.status === 'filled') {
                        logger.info(`Limit order filled for ${trade.symbol}. Placing SL/TP now...`);
                        
                        // Detect mode for SL/TP placement
                        const hedgeMode = await this.bingx.isHedgeMode();
                        
                        // Prepare SL/TP prices with precision
                        const stopLossPrice = await this.bingx.priceToPrecision(trade.symbol, trade.stopLoss);
                        const takeProfitPrices = await Promise.all(trade.targets.map(t => this.bingx.priceToPrecision(trade.symbol, t.price)));
                        
                        // Calculate amount Contracts (using the amount field which is positionSizeUSDT)
                        const amountContracts = await this.bingx.amountToPrecision(trade.symbol, trade.amount / trade.entryPrice);

                        // Place orders
                        await this.bingx.placeSLTPOrders(
                            trade.symbol,
                            trade.direction,
                            amountContracts,
                            stopLossPrice,
                            takeProfitPrices,
                            hedgeMode
                        );

                        // Update trade status to OPEN
                        trade.currentStatus = 'OPEN';
                        trade.logs.push(`Limit order filled and SL/TP placed at ${new Date().toISOString()}`);
                        await trade.save();

                        // Notify user
                        const user = await User.findById(trade.userId);
                        if (user?.telegramId) {
                            await this.notifier(user.telegramId, `✅ <b>تم تنفيذ الأمر الحدي للعملة ${trade.symbol}!</b>\nتم وضع أوامر وقف الخسارة والأهداف بنجاح.`);
                        }
                    } else if (order.status === 'canceled' || order.status === 'expired') {
                        logger.info(`Limit order for ${trade.symbol} was canceled or expired.`);
                        trade.currentStatus = 'CANCELLED';
                        trade.logs.push(`Order was ${order.status} on exchange.`);
                        await trade.save();
                    }
                } catch (err: any) {
                    logger.error(`Error checking pending order ${trade.bingxOrderId}:`, err);
                }
            }

            if (activeTrades.length === 0) return;
            const openTrades = activeTrades;

            // Group by symbol
            const symbols = [...new Set(openTrades.map(t => t.symbol))];
            logger.info(`Monitor checking ${openTrades.length} open trades across ${symbols.length} symbols.`);

            // Fetch balance for SL warning calculation (5% threshold)
            let totalBalance = 0;
            try {
                totalBalance = await this.bingx.getTotalEquity();
            } catch (e) {
                logger.warn('Could not fetch balance for SL warning calculation.');
            }

            for (const symbol of symbols) {
                const positions = await this.bingx.getPositions(symbol);
                const tradesForSymbol = openTrades.filter(t => t.symbol === symbol);

                for (const trade of tradesForSymbol) {
                    const matchingPos = positions.find((p: any) =>
                        ((trade.direction === 'LONG' && p.side.toLowerCase() === 'long') ||
                            (trade.direction === 'SHORT' && p.side.toLowerCase() === 'short')) &&
                        parseFloat(p.contracts || '0') > 0
                    );

                    // Lookup user settings
                    let user: any = null;
                    try {
                        const UserModel = (trade.constructor as any).db.model('User');
                        user = await UserModel.findById(trade.userId);
                    } catch (e) {
                        logger.warn(`Could not find user for trade ${trade._id}`);
                    }

                    const telegramId: string | null = user?.telegramId || null;

                    if (matchingPos) {
                        // --- Position is still ACTIVE: check warnings ---

                        const currentPrice: number = parseFloat(matchingPos.markPrice) || await this.bingx.getMarketPrice(symbol);
                        const entry = trade.entryPrice;

                        // --- TP1 BreakEven Logic ---
                        if (user?.autoBreakEven && !trade.isBreakEvenSet && trade.targets.length > 0) {
                            const tp1 = trade.targets[0].price;
                            const tp1Hit = trade.direction === 'LONG'
                                ? currentPrice >= tp1
                                : currentPrice <= tp1;

                            if (tp1Hit) {
                                logger.info(`TP1 hit for ${trade.symbol}. Moving SL to Break-Even (${entry})`);
                                try {
                                    await this.bingx.setStopLoss(symbol, entry, trade.direction);
                                    trade.isBreakEvenSet = true;
                                    trade.logs.push(`Auto-adjusted SL to BE at ${entry} after TP1 hit`);
                                    await trade.save();

                                    if (telegramId) {
                                        const msg = `🔒 <b>تم نقل وقف الخسارة لنقطة الدخول (Break-Even)</b>\n` +
                                            `الرمز: ${trade.symbol}\n` +
                                            `تم ضرب الهدف الأول! تم نقل وقف الخسارة لسعر الدخول (${entry}) لحماية الأرباح.`;
                                        await this.notifier(telegramId, msg);
                                    }
                                } catch (error) {
                                    logger.error(`Failed to set BE for ${trade.symbol}:`, error);
                                }
                            }
                        }

                        // --- SL WARNING (5% capital loss threshold) ---
                        if (telegramId && user?.slWarningEnabled && !trade.slWarningSent) {
                            const pnl = matchingPos.unrealizedPnl !== undefined
                                ? matchingPos.unrealizedPnl
                                : (matchingPos.info?.unrealizedProfit ? parseFloat(matchingPos.info.unrealizedProfit) : 0);

                            if (totalBalance > 0 && pnl < 0) {
                                const lossPercent = Math.abs(pnl / totalBalance) * 100;
                                if (lossPercent >= 5) {
                                    logger.info(`SL warning triggered for ${trade.symbol}: ${lossPercent.toFixed(2)}% capital loss`);
                                    const msg = `⚠️🔔 <b>تحذير: اقتراب من وقف الخسارة!</b>\n\n` +
                                        `📉 الرمز: <b>${trade.symbol}</b> (${trade.direction})\n` +
                                        `💸 الخسارة الحالية: <b>${pnl.toFixed(2)} USDT</b>\n` +
                                        `⚡ نسبة الخسارة من رأس المال: <b>${lossPercent.toFixed(2)}%</b>\n\n` +
                                        `🚨 تنبيه: الخسارة وصلت إلى 5% من رأس المال، وقف الخسارة قريب جداً!`;
                                    await this.notifier(telegramId, msg);
                                    trade.slWarningSent = true;
                                    await trade.save();
                                }
                            }
                        }

                        // --- TP WARNINGS (user-defined thresholds) ---
                        if (telegramId && user?.tpWarningEnabled && trade.targets && trade.targets.length > 0) {
                            const tp1 = trade.targets[0].price;
                            const totalDist = Math.abs(tp1 - entry);

                            if (totalDist > 0) {
                                const progressToTp = trade.direction === 'LONG'
                                    ? (currentPrice - entry) / totalDist * 100
                                    : (entry - currentPrice) / totalDist * 100;

                                const thresholds: number[] = (user.tpWarningThresholds && user.tpWarningThresholds.length > 0)
                                    ? [...user.tpWarningThresholds].sort((a, b) => a - b)
                                    : [70, 90];

                                const triggered: number[] = trade.triggeredTpWarnings || [];
                                let changed = false;

                                for (const threshold of thresholds) {
                                    if (progressToTp >= threshold && !triggered.includes(threshold)) {
                                        logger.info(`TP warning ${threshold}% triggered for ${trade.symbol}`);
                                        const msg = `🎯🔔 <b>تنبيه: اقتراب من الهدف!</b>\n\n` +
                                            `📈 الرمز: <b>${trade.symbol}</b> (${trade.direction})\n` +
                                            `🏁 الهدف الأول: <b>${tp1}</b>\n` +
                                            `📊 السعر الحالي: <b>${currentPrice.toFixed(4)}</b>\n` +
                                            `✅ التقدم نحو الهدف: <b>${progressToTp.toFixed(1)}%</b>\n\n` +
                                            `🔔 لقد وصلت إلى <b>${threshold}%</b> من المسافة نحو الهدف!`;
                                        await this.notifier(telegramId, msg);
                                        triggered.push(threshold);
                                        changed = true;
                                    }
                                }

                                if (changed) {
                                    trade.triggeredTpWarnings = triggered;
                                    await trade.save();
                                }
                            }
                        }

                        continue;

                    } else {
                        // --- Position is GONE (closed by SL/TP/manual) ---
                        logger.info(`Trade ${trade._id} (${trade.symbol}) is NO LONGER active on bingx. Closing in DB...`);

                        const currentPrice = await this.bingx.getMarketPrice(symbol);
                        const entry = trade.entryPrice;
                        const lev = trade.leverage || 10;
                        let pnlPercent = 0;

                        if (currentPrice) {
                            const isLong = trade.direction === 'LONG';
                            const diff = isLong ? (currentPrice - entry) : (entry - currentPrice);
                            pnlPercent = (diff / entry) * 100 * lev;
                        }

                        trade.currentStatus = pnlPercent > 0 ? 'CLOSED_PROFIT' : 'CLOSED_LOSS';
                        trade.closeTime = new Date();
                        trade.pnl = pnlPercent;
                        trade.logs.push(`Position monitor detected close. PnL: ${pnlPercent.toFixed(2)}%`);
                        await trade.save();

                        // --- Enhanced Exit Notification ---
                        if (telegramId) {
                            const closeTime = trade.closeTime || new Date();
                            const durationMs = closeTime.getTime() - trade.entryTime.getTime();
                            const durationMinutes = Math.floor(durationMs / 60000);
                            const durationHours = Math.floor(durationMinutes / 60);
                            const durationStr = durationHours > 0 
                                ? `${durationHours} ساعة و ${durationMinutes % 60} دقيقة`
                                : `${durationMinutes} دقيقة`;

                            const margin = trade.amount / lev;
                            const profitAmount = margin * (pnlPercent / 100);
                            
                            // Calculate capital percentage
                            let capitalPercentageStr = 'N/A';
                            if (totalBalance > 0) {
                                capitalPercentageStr = ((margin / totalBalance) * 100).toFixed(2) + '%';
                            }

                            const statusEmoji = pnlPercent >= 0 ? '✅' : '🛑';
                            const statusLabel = pnlPercent >= 0 ? 'ضرب الهدف' : 'ضرب الاستوب';

                            const exitMsg = `${statusEmoji} <b>إغلاق صفقة: ${trade.symbol}</b>\n\n` +
                                `📝 الحالة: <b>${statusLabel}</b>\n` +
                                `💰 الربح/الخسارة: <b>${profitAmount.toFixed(2)} USDT (${pnlPercent.toFixed(2)}%)</b>\n` +
                                `💵 مبلغ الدخول: <b>${margin.toFixed(2)} USDT</b> (${capitalPercentageStr} من رأس المال)\n` +
                                `🏁 سعر الدخول: <b>${entry.toFixed(6)}</b>\n` +
                                `🚪 سعر الإغلاق: <b>${currentPrice.toFixed(6)}</b>\n` +
                                `⏱️ استمرت الصفقة: <b>${durationStr}</b>\n\n` +
                                `🤖 نظام التداول الآلي`;

                            // Send to user
                            await this.notifier(telegramId, exitMsg);

                            // Send to source group if different
                            if (trade.sourceChatId && trade.sourceChatId !== telegramId) {
                                await this.notifier(trade.sourceChatId, exitMsg);
                            }
                        }

                        logger.info(`Trade ${trade._id} (${trade.symbol}) closed. PnL: ${pnlPercent.toFixed(2)}%. Notifications sent.`);
                    }
                }
            }

        } catch (error) {
            logger.error('Error in PositionMonitor:', error);
        }
    }
}
