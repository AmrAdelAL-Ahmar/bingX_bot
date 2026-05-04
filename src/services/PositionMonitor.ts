import { IExchangeService } from './IExchangeService';
import Trade from '../models/Trade';
import User from '../models/User';
import logger from '../utils/logger';
import { formatPrice, formatAmount } from '../utils/formatters';

export class PositionMonitor {
    private exchange: IExchangeService;
    private notifier: (telegramId: string, msg: string) => Promise<void>;
    private isRunning: boolean = false;
    private intervalId?: NodeJS.Timeout;
    private consecutiveMissingMap: Map<string, number> = new Map();

    constructor(exchange: IExchangeService, notifier: (telegramId: string, msg: string) => Promise<void>) {
        this.exchange = exchange;
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

            // Fetch positions once for both pending and active checks
            let currentPositions: any[] = [];
            let openOrders: any[] = [];
            let fetchSuccess = false;
            try {
                currentPositions = await this.exchange.getPositions();
                openOrders = await this.exchange.getOpenOrders();
                fetchSuccess = true;
            } catch (e) {
                logger.error('Failed to fetch positions/orders:', e);
                // If API fails, we skip this cycle and DO NOT increment miss counts
                return;
            }

            // --- 1. Handle Pending (Limit) Orders ---
            for (const trade of pendingTrades) {
                if (!trade.xtOrderId) continue;

                try {
                    // Check if the limit order is still open on the exchange
                    const isStillOpen = openOrders.find((o: any) => o.id === trade.xtOrderId);
                    if (isStillOpen) {
                        continue; // Still pending, no action needed
                    }

                    // Check if there is an open position for this symbol and direction
                    // Robust matching for pending fill detection
                    const pos = currentPositions.find((p: any) => {
                        const pSide = (p.side || p.info?.positionSide || p.info?.side || 'LONG').toString().toUpperCase();
                        const isLongMatch = trade.direction === 'LONG' && (pSide === 'LONG' || pSide === 'BUY');
                        const isShortMatch = trade.direction === 'SHORT' && (pSide === 'SHORT' || pSide === 'SELL');
                        
                        // Robust symbol matching (handle BTC/USDT vs BTC/USDT:USDT)
                        const symbolMatch = p.symbol === trade.symbol || 
                                          p.symbol.replace(':USDT', '') === trade.symbol ||
                                          trade.symbol.replace(':USDT', '') === p.symbol;

                        return (isLongMatch || isShortMatch) && symbolMatch && parseFloat(p.contracts || '0') > 0;
                    });

                    if (pos) {
                        logger.info(`Limit order filled (detected via position) for ${trade.symbol}. Placing extra TPs (TP2+) if any...`);

                        const contractSize = await this.exchange.getContractSize(trade.symbol);
                        const filledQty = parseFloat(pos.contracts);

                        // Update entry price to actual fill price if available
                        const posEntryPrice = parseFloat(pos.entryPrice) || parseFloat(pos.info?.entryPrice);
                        if (posEntryPrice && posEntryPrice > 0) {
                            trade.entryPrice = posEntryPrice;
                        }

                        // Detect mode for SL/TP placement
                        const hedgeMode = await this.exchange.isHedgeMode();

                        // Prepare SL/TP prices with precision
                        const stopLossPrice = await this.exchange.priceToPrecision(trade.symbol, trade.stopLoss);
                        const takeProfitPrices = await Promise.all(
                            trade.targets.map(t => this.exchange.priceToPrecision(trade.symbol, t.price))
                        );

                        // SL and TP1 were already attached to the original entry order.
                        // Only place TP2, TP3... as separate orders (skipFirstTp=true).
                        const hasExtraTps = takeProfitPrices.length > 1;
                        if (hasExtraTps) {
                            await this.exchange.placeSLTPOrders(
                                trade.symbol,
                                trade.direction,
                                filledQty,
                                stopLossPrice,
                                takeProfitPrices,
                                hedgeMode,
                                true // skipFirstTp — SL and TP1 are already active as attached orders
                            );
                        } else {
                            logger.info(`[PositionMonitor] Only 1 target for ${trade.symbol}, TP1 already attached. Nothing extra to place.`);
                        }

                        // Update trade status to OPEN
                        trade.currentStatus = 'OPEN';
                        trade.entryTime = new Date();
                        trade.logs.push(`Limit order filled at ${trade.entryPrice} on ${new Date().toISOString()}. SL/TP placed.`);
                        await trade.save();

                        // Notify user
                        const user = await User.findById(trade.userId);
                        if (user?.telegramId) {
                            await this.notifier(
                                user.telegramId,
                                `✅ <b>تم تنفيذ الأمر الحدي للعملة ${trade.symbol}!</b>\n` +
                                `سعر الدخول الفعلي: <b>${formatPrice(trade.entryPrice)}</b>\n` +
                                `تم وضع أوامر وقف الخسارة والأهداف بنجاح.`
                            );
                        }
                    } else {
                        // Order is NOT open, and NO position exists. It must have been canceled.
                        logger.info(`Limit order for ${trade.symbol} was canceled or expired.`);
                        trade.currentStatus = 'CANCELLED';
                        trade.logs.push(`Order was not found in open orders and no position exists.`);
                        await trade.save();
                    }
                } catch (err: any) {
                    logger.error(`Error checking pending order ${trade.xtOrderId}:`, err);
                }
            }

            if (activeTrades.length === 0) return;
            const openTrades = activeTrades;

            // Group symbols for logging
            const uniqueSymbols = [...new Set(openTrades.map(t => t.symbol))];
            logger.info(`Monitor checking ${openTrades.length} open trades across ${uniqueSymbols.length} symbols. API Fetch Success: ${fetchSuccess}`);

            // Fetch balance for SL warning calculation (5% threshold)
            let totalBalance = 0;
            try {
                totalBalance = await this.exchange.getTotalEquity();
            } catch (e) {
                logger.warn('Could not fetch balance for SL warning calculation.');
            }

            // Main monitoring loop
            for (const trade of openTrades) {
                // Robust matching logic for existing positions
                const matchingPos = currentPositions.find((p: any) => {
                    const pSide = (p.side || p.info?.positionSide || p.info?.side || 'LONG').toString().toUpperCase();
                    const isLongMatch = trade.direction === 'LONG' && (pSide === 'LONG' || pSide === 'BUY');
                    const isShortMatch = trade.direction === 'SHORT' && (pSide === 'SHORT' || pSide === 'SELL');
                    
                    // Robust symbol matching
                    const symbolMatch = p.symbol === trade.symbol || 
                                      p.symbol.replace(':USDT', '') === trade.symbol ||
                                      trade.symbol.replace(':USDT', '') === p.symbol ||
                                      p.symbol.includes(trade.symbol.split('/')[0]);

                    return (isLongMatch || isShortMatch) && symbolMatch && parseFloat(p.contracts || '0') > 0;
                });

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
                    // Reset consecutive misses since position is found
                    this.consecutiveMissingMap.delete(trade._id.toString());
                    
                    // --- Position is still ACTIVE: check warnings ---
                    const rawMark = matchingPos.markPrice ?? matchingPos.info?.markPrice ?? matchingPos.info?.markValue;
                    const currentPrice: number = (rawMark && parseFloat(rawMark) > 0)
                        ? parseFloat(rawMark)
                        : await this.exchange.getMarketPrice(trade.symbol);
                    
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
                                if (typeof (this.exchange as any).setStopLoss === 'function') {
                                    await (this.exchange as any).setStopLoss(trade.symbol, entry, trade.direction);
                                }
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

                    // --- SL WARNING ---
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
                                    `💸 الخسارة الحالية: <b>${formatAmount(pnl)} USDT</b>\n` +
                                    `⚡ نسبة الخسارة من رأس المال: <b>${lossPercent.toFixed(2)}%</b>\n\n` +
                                    `🚨 تنبيه: الخسارة وصلت إلى 5% من رأس المال، وقف الخسارة قريب جداً!`;
                                await this.notifier(telegramId, msg);
                                trade.slWarningSent = true;
                                await trade.save();
                            }
                        }
                    }

                    // --- TP WARNINGS ---
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
                                    const msg = `🎯🔔 <b>تنبيه: اقتراب من الهدف!</b>\n\n` +
                                        `📈 الرمز: <b>${trade.symbol}</b> (${trade.direction})\n` +
                                        `🏁 الهدف الأول: <b>${formatPrice(tp1)}</b>\n` +
                                        `📊 السعر الحالي: <b>${formatPrice(currentPrice)}</b>\n` +
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

                } else {
                    // --- Position is GONE (potentially closed by SL/TP/manual) ---
                    
                    // Add a grace period of 6 consecutive misses before closing in DB
                    // (Increased from 3 to 6 to handle XT API lags)
                    const tradeIdStr = trade._id.toString();
                    const missCount = (this.consecutiveMissingMap.get(tradeIdStr) || 0) + 1;
                    this.consecutiveMissingMap.set(tradeIdStr, missCount);

                    if (missCount < 6) {
                        logger.info(`Trade ${trade._id} (${trade.symbol}) not found on exchange (Miss ${missCount}/6). Waiting for next cycle...`);
                        continue;
                    }

                    logger.info(`Trade ${trade._id} (${trade.symbol}) is NO LONGER active on exchange after 6 checks. Closing in DB...`);
                    this.consecutiveMissingMap.delete(tradeIdStr);

                    let closePrice = 0;
                    try {
                        closePrice = await this.exchange.getMarketPrice(trade.symbol);
                    } catch (_) {}
                    
                    const entry = trade.entryPrice;
                    const lev = trade.leverage || 10;
                    let pnlPercent = 0;

                    if (closePrice > 0 && entry > 0) {
                        const isLong = trade.direction === 'LONG';
                        const diff = isLong ? (closePrice - entry) : (entry - closePrice);
                        pnlPercent = (diff / entry) * 100 * lev;
                    }

                    trade.closePrice = closePrice || entry;
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

                        let capitalPercentageStr = 'N/A';
                        if (totalBalance > 0) {
                            capitalPercentageStr = ((margin / totalBalance) * 100).toFixed(2) + '%';
                        }

                        const statusEmoji = pnlPercent >= 0 ? '✅' : '🛑';
                        const statusLabel = pnlPercent >= 0 ? 'ضرب الهدف' : 'ضرب الاستوب';

                        const exitMsg = `${statusEmoji} <b>إغلاق صفقة: ${trade.symbol}</b>\n\n` +
                            `📝 الحالة: <b>${statusLabel}</b>\n` +
                            `💰 الربح/الخسارة: <b>${formatAmount(profitAmount)} USDT (${pnlPercent.toFixed(2)}%)</b>\n` +
                            `💵 مبلغ الدخول: <b>${formatAmount(margin)} USDT</b> (${capitalPercentageStr} من رأس المال)\n` +
                            `🏁 سعر الدخول: <b>${formatPrice(entry)}</b>\n` +
                            `🚪 سعر الإغلاق: <b>${formatPrice(closePrice)}</b>\n` +
                            `⏱️ استمرت الصفقة: <b>${durationStr}</b>\n\n` +
                            `🤖 نظام التداول الآلي`;

                        await this.notifier(telegramId, exitMsg);
                        if (trade.sourceChatId && trade.sourceChatId !== telegramId) {
                            await this.notifier(trade.sourceChatId, exitMsg);
                        }
                    }
                }
            }

        } catch (error) {
            logger.error('Error in PositionMonitor:', error);
        }
    }
}
