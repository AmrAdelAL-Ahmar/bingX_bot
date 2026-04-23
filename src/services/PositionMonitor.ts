import { BingXService } from './BingXService';
import Trade from '../models/Trade';
import User from '../models/User';
import logger from '../utils/logger';

export class PositionMonitor {
    private bingX: BingXService;
    private notifier: (telegramId: string, msg: string) => Promise<void>;
    private groupNotifier: (msg: string) => Promise<void>;
    private isRunning: boolean = false;
    private intervalId?: NodeJS.Timeout;

    constructor(
        bingX: BingXService,
        notifier: (telegramId: string, msg: string) => Promise<void>,
        groupNotifier: (msg: string) => Promise<void>
    ) {
        this.bingX = bingX;
        this.notifier = notifier;
        this.groupNotifier = groupNotifier;
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
            const openTrades = await Trade.find({ currentStatus: { $in: ['OPEN', 'TP1_HIT', 'TP2_HIT'] } });
            if (openTrades.length === 0) return;

            // Group by symbol
            const symbols = [...new Set(openTrades.map(t => t.symbol))];
            logger.info(`Monitor checking ${openTrades.length} open trades across ${symbols.length} symbols.`);

            // Fetch balance for SL warning calculation (5% threshold)
            let totalBalance = 0;
            try {
                totalBalance = await this.bingX.getTotalEquity();
            } catch (e) {
                logger.warn('Could not fetch balance for SL warning calculation.');
            }

            for (const symbol of symbols) {
                const positions = await this.bingX.getPositions(symbol);
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

                        const currentPrice: number = parseFloat(matchingPos.markPrice) || await this.bingX.getMarketPrice(symbol);
                        const entry = trade.entryPrice;

                        // --- TP1 BreakEven Logic ---
                        if (!trade.isBreakEvenSet && trade.targets.length > 0) {
                            const tp1 = trade.targets[0].price;
                            const tp1Hit = trade.direction === 'LONG'
                                ? currentPrice >= tp1
                                : currentPrice <= tp1;

                            if (tp1Hit) {
                                logger.info(`TP1 hit for ${trade.symbol}. Moving SL to Break-Even (${entry})`);
                                try {
                                    await this.bingX.setStopLoss(symbol, entry, trade.direction);
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
                        logger.info(`Trade ${trade._id} (${trade.symbol}) is NO LONGER active on BingX. Closing in DB...`);

                        const entry = trade.entryPrice;
                        const lev = trade.leverage || 10;
                        const margin = (trade.amount || 0) / lev;

                        // Try to fetch the actual close price from BingX closed orders
                        let actualClosePrice: number | null = null;
                        let actualPnlUsdt: number | null = null;
                        let closeType: 'AUTO' | 'MANUAL' = 'AUTO';

                        try {
                            const since = trade.entryTime ? trade.entryTime.getTime() : undefined;
                            const closedOrders = await this.bingX.getClosedOrders(symbol, since);

                            // Find the most recent closing order (opposite side to position direction)
                            const closingSide = trade.direction === 'LONG' ? 'sell' : 'buy';
                            const recentClose = closedOrders
                                .filter((o: any) =>
                                    o.side === closingSide &&
                                    o.status === 'closed' &&
                                    parseFloat(o.filled || '0') > 0
                                )
                                .sort((a: any, b: any) => (b.timestamp || 0) - (a.timestamp || 0))[0];

                            if (recentClose) {
                                actualClosePrice = parseFloat(recentClose.average || recentClose.price || '0');

                                // Detect if it was a manual close (reduce-only market order without TPSL trigger)
                                const orderType = (recentClose.type || '').toLowerCase();
                                const reduceOnly = recentClose.reduceOnly === true || recentClose.info?.reduceOnly === true;
                                const isTpSlOrder = orderType.includes('stop') || orderType.includes('take_profit') ||
                                    (recentClose.info?.type || '').toLowerCase().includes('stop') ||
                                    (recentClose.info?.type || '').toLowerCase().includes('profit');

                                if (reduceOnly && !isTpSlOrder) {
                                    closeType = 'MANUAL';
                                } else if (isTpSlOrder) {
                                    closeType = 'AUTO';
                                }

                                // Calculate actual PnL from realised
                                if (recentClose.info?.realisedProfit !== undefined) {
                                    actualPnlUsdt = parseFloat(recentClose.info.realisedProfit);
                                } else if (actualClosePrice && entry) {
                                    const priceDiff = trade.direction === 'LONG'
                                        ? (actualClosePrice - entry)
                                        : (entry - actualClosePrice);
                                    const contracts = trade.amount / entry;
                                    actualPnlUsdt = priceDiff * contracts;
                                }
                            }
                        } catch (e) {
                            logger.warn(`Could not fetch closed orders for ${symbol}:`, e);
                        }

                        // Fallback: use market price estimate if no actual close price
                        let pnlPercent = 0;
                        let pnlUsdt = 0;

                        if (actualClosePrice && actualClosePrice > 0) {
                            const priceDiff = trade.direction === 'LONG'
                                ? (actualClosePrice - entry)
                                : (entry - actualClosePrice);
                            pnlPercent = (priceDiff / entry) * 100 * lev;
                            pnlUsdt = actualPnlUsdt !== null ? actualPnlUsdt : (margin * (pnlPercent / 100));
                        } else {
                            // Fallback to market price
                            const currentPrice = await this.bingX.getMarketPrice(symbol);
                            if (currentPrice) {
                                const priceDiff = trade.direction === 'LONG'
                                    ? (currentPrice - entry)
                                    : (entry - currentPrice);
                                pnlPercent = (priceDiff / entry) * 100 * lev;
                                pnlUsdt = margin * (pnlPercent / 100);
                            }
                        }

                        // Determine final status
                        const finalStatus = closeType === 'MANUAL' ? 'CLOSED_MANUAL'
                            : (pnlPercent > 0 ? 'CLOSED_PROFIT' : 'CLOSED_LOSS');

                        trade.currentStatus = finalStatus as any;
                        trade.closeTime = new Date();
                        trade.pnl = pnlPercent;
                        (trade as any).closeType = closeType;
                        trade.logs.push(
                            `Position monitor detected close. Type: ${closeType}. PnL: ${pnlPercent.toFixed(2)}% (${pnlUsdt.toFixed(2)} USDT)`
                        );
                        await trade.save();

                        logger.info(`Trade ${trade._id} (${trade.symbol}) closed. Type: ${closeType}. PnL: ${pnlPercent.toFixed(2)}% / ${pnlUsdt.toFixed(2)} USDT`);

                        // --- SEND CLOSE NOTIFICATION to group/user ---
                        const isProfit = pnlPercent >= 0;
                        const emoji = isProfit ? '🟢' : '🔴';
                        const pnlSign = isProfit ? '+' : '';

                        let closeTypeLabel = '';
                        if (closeType === 'MANUAL') {
                            closeTypeLabel = '🤚 إغلاق يدوي';
                        } else if (isProfit) {
                            closeTypeLabel = '🎯 ضرب الهدف (TP)';
                        } else {
                            closeTypeLabel = '🛑 ضرب وقف الخسارة (SL)';
                        }

                        // Show trader info in notification if available
                        const traderInfo = user
                            ? (user.username ? `@${user.username}` : `ID: ${user.telegramId}`)
                            : '';

                        const closeMsg =
                            `${emoji} <b>صفقة مغلقة - ${trade.symbol}</b> (${trade.direction})\n` +
                            `📍 نوع الإغلاق: <b>${closeTypeLabel}</b>\n` +
                            `💰 النتيجة: <b>${pnlSign}${pnlUsdt.toFixed(2)} USDT</b> (${pnlSign}${pnlPercent.toFixed(2)}%)\n` +
                            `📊 الرافعة: ${lev}x | المارجن: ${margin.toFixed(2)} USDT\n` +
                            (traderInfo ? `👤 المتداول: ${traderInfo}\n` : '') +
                            `⏱ ${new Date().toLocaleString('ar-SA')}`;

                        // Send to group notifier (NOTIFICATION_CHAT_ID) if available
                        await this.groupNotifier(closeMsg).catch(e =>
                            logger.error(`Failed to send close notification to group: ${e.message}`)
                        );

                        // Also notify the individual user if different from group
                        if (telegramId) {
                            await this.notifier(telegramId, closeMsg).catch(e =>
                                logger.error(`Failed to send close notification to user ${telegramId}: ${e.message}`)
                            );
                        }
                    }
                }
            }

        } catch (error) {
            logger.error('Error in PositionMonitor:', error);
        }
    }
}
