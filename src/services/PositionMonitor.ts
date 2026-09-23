import { BingXService } from './BingXService';
import { AnalysisService } from './AnalysisService';
import Trade from '../models/Trade';
import User from '../models/User';
import TradeRadar, { ITradeRadar } from '../models/TradeRadar';
import { TechnicalAnalyzer } from './TechnicalAnalyzer';
import { TradeManager } from './TradeManager';
import { CoreTradeRadar } from '../core/radar/CoreTradeRadar';
import logger from '../utils/logger';
import { getRadarEngine } from '../core/radar/RadarEngineRegistry';
import { FrozenPairsRegistry } from '../utils/FrozenPairsRegistry';
import { OHLCV, AnalysisDetails } from '../core/shared/types';
import { TradingMemoryService } from './TradingMemoryService';

export class PositionMonitor {
    private bingx: BingXService;
    private analysis: AnalysisService;
    private notifier: (telegramId: string, msg: string) => Promise<void>;
    private isRunning: boolean = false;
    private intervalId?: NodeJS.Timeout;

    private tradeManager: TradeManager;

    constructor(
        bingx: BingXService,
        analysis: AnalysisService,
        notifier: (telegramId: string, msg: string) => Promise<void>,
        tradeManager?: TradeManager
    ) {
        this.bingx = bingx;
        this.analysis = analysis;
        this.notifier = notifier;
        this.tradeManager = tradeManager || new TradeManager(bingx);
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
            // Include PENDING trades to check for limit fills (Live exchange positions only! Paper trades are handled by PaperTradingEngine)
            const allTrackedTrades = await Trade.find({
                isPaperTrade: { $ne: true },
                currentStatus: { $in: ['PENDING', 'OPEN', 'TP1_HIT', 'TP2_HIT'] }
            });
            if (allTrackedTrades.length === 0) return;

            // Separate pending from open
            const pendingTrades = allTrackedTrades.filter(t => t.currentStatus === 'PENDING');
            const activeTrades = allTrackedTrades.filter(t => t.currentStatus !== 'PENDING');

            // --- 1. Handle Pending (Limit) Orders ---
            for (const trade of pendingTrades) {
                const orderId = trade.bingxOrderId || trade.binanceOrderId;
                if (!orderId) continue;

                try {
                    const order = await this.bingx.getOrder(trade.symbol, orderId);
                    if (!order) continue;

                    if (order.status === 'closed' || order.status === 'filled') {
                        logger.info(`Limit order filled for ${trade.symbol}. SL/TP were already attached.`);

                        // Update trade status to OPEN
                        trade.currentStatus = 'OPEN';
                        trade.logs.push(`Limit order filled at ${new Date().toISOString()}`);
                        await trade.save();

                        // Notify user
                        const user = await User.findById(trade.userId);
                        if (user?.telegramId) {
                            const msg = `✅ <b>تم تنفيذ الأمر الحدي للعملة ${trade.symbol}!</b>\nلقد تم تفعيل صفقتك المعلقة وتم ربط أوامر الوقف والهدف تلقائياً.`;
                            await this.notifier(user.telegramId, msg);

                            // Send to source group if different
                            if (trade.sourceChatId && trade.sourceChatId !== user.telegramId) {
                                await this.notifier(trade.sourceChatId, msg);
                            }
                        }
                    } else if (order.status === 'canceled' || order.status === 'expired') {
                        logger.info(`Limit order for ${trade.symbol} was canceled or expired.`);
                        trade.currentStatus = 'CANCELLED';
                        trade.logs.push(`Order was ${order.status} on exchange.`);
                        await trade.save();
                    }
                } catch (err: any) {
                    logger.error(`Error checking pending order ${trade.bingxOrderId || trade.binanceOrderId}:`, err);
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

                        // --- Dynamic Trailing Stop Logic (Chandelier / ATR Trailing) ---
                        if (trade.isBreakEvenSet) {
                            try {
                                const approxAtr = currentPrice * 0.008; // 0.8% volatility estimate
                                let shouldUpdateTrailing = false;
                                let newTrailingSl = trade.currentTrailingSl || entry;

                                if (trade.direction === 'LONG') {
                                    const candidateSl = currentPrice - (2.0 * approxAtr);
                                    if (candidateSl > (trade.currentTrailingSl || entry) * 1.003) {
                                        newTrailingSl = candidateSl;
                                        shouldUpdateTrailing = true;
                                    }
                                } else {
                                    const candidateSl = currentPrice + (2.0 * approxAtr);
                                    if (candidateSl < (trade.currentTrailingSl || entry) * 0.997) {
                                        newTrailingSl = candidateSl;
                                        shouldUpdateTrailing = true;
                                    }
                                }

                                if (shouldUpdateTrailing) {
                                    const precisionSl = await this.bingx.priceToPrecision(symbol, newTrailingSl);
                                    await this.bingx.setStopLoss(symbol, precisionSl, trade.direction);
                                    trade.currentTrailingSl = precisionSl;
                                    trade.isTrailingActive = true;
                                    trade.logs.push(`Dynamic Trailing SL moved to ${precisionSl}`);
                                    await trade.save();
                                    logger.info(`[Dynamic Trailing] Trailing SL updated for ${trade.symbol} to ${precisionSl}`);

                                    if (telegramId) {
                                        const trailMsg = `📈🔒 <b>تحديث الوقف المتحرك (Dynamic Trailing Stop)</b>\n` +
                                            `الرمز: <b>${trade.symbol}</b> (${trade.direction})\n` +
                                            `تم رفع وقف الخسارة تلقائياً لتأمين الأرباح إلى: <b>${precisionSl}</b>`;
                                        await this.notifier(telegramId, trailMsg);
                                    }
                                }
                            } catch (trailErr) {
                                logger.warn(`[Dynamic Trailing] Could not adjust trailing stop for ${trade.symbol}:`, trailErr);
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

                        // --- CORRECTION GUARD (V7 Sniper Logic) ---
                        if (telegramId && trade.correctionAlertEnabled && !trade.correctionWarningSent) {
                            try {
                                const ohlcv5m = await this.bingx.fetchOHLCV(symbol, '5m', 50);
                                const p = await this.bingx.getPricePrecision(symbol);
                                if (ohlcv5m.length >= 20) {
                                    const divergence = this.analysis.detectDivergence(ohlcv5m, trade.direction as 'LONG' | 'SHORT');
                                    const fib = this.analysis.calculateCorrectionFibLevels(ohlcv5m, trade.direction as 'LONG' | 'SHORT');
                                    
                                    if (divergence.detected) {
                                        logger.info(`Correction Warning (Divergence) for ${trade.symbol}`);
                                        const typeMsg = trade.direction === 'LONG' ? 'انحراف سلبي (Bearish)' : 'انحراف إيجابي (Bullish)';
                                        const zoneMsg = trade.direction === 'LONG' ? 'منطقة الدعم' : 'منطقة المقاومة';

                                        const warningMsg = `⚠️ <b>تحذير استراتيجي: ضعف في الزخم!</b>\n\n` +
                                            `📉 الرمز: <b>${trade.symbol}</b>\n` +
                                            `🔍 الإشارة: <b>${typeMsg}</b>\n` +
                                            `🛡️ ${zoneMsg} المتوقعة (Zone):\n` +
                                            `🔖 من: <b>$${fib.fib500.toFixed(p)}</b>\n` +
                                            `🔖 إلى: <b>$${fib.fib618.toFixed(p)}</b> (المستوى الذهبي)\n\n` +
                                            `💡 يمثل هذا النطاق أقوى منطقة يتوقع أن يرتد منها السعر لإكمال الاتجاه.`;
                                        await this.notifier(telegramId, warningMsg);
                                        trade.correctionWarningSent = true;
                                        await trade.save();
                                    }

                                    const ohlcv1h = await this.bingx.fetchOHLCV(symbol, '1h', 2);
                                    const prev1h = ohlcv1h[ohlcv1h.length - 2];
                                    const pivot = (prev1h.high + prev1h.low + prev1h.close) / 3;

                                    if (this.analysis.isPivotBroken(currentPrice, pivot, trade.direction)) {
                                        logger.info(`CRITICAL: Pivot broken for ${trade.symbol}`);
                                        const criticalMsg = `🚨 <b>تنبيه حرج: كسر هيكل السوق!</b>\n\n` +
                                            `📉 الرمز: <b>${trade.symbol}</b>\n` +
                                            `⛔ الحالة: <b>السعر كسر مستوى الـ Pivot</b> (${pivot.toFixed(p)})\n` +
                                            `🎯 الهدف القادم (نهاية التصحيح): <b>$${fib.fib618.toFixed(p)}</b>\n\n` +
                                            `التصحيح بدأ رسمياً وفقد السعر الدعم المؤسساتي. ينصح بالخروج الآن أو تأمين الصفقة فوراً!`;
                                        await this.notifier(telegramId, criticalMsg);
                                        trade.correctionAlertEnabled = false;
                                        await trade.save();
                                    }
                                }
                            } catch (error) {
                                logger.error(`Error in Correction Guard for ${trade.symbol}:`, error);
                            }
                        }

                        // ── RADAR SYSTEM ─────────────────────────────────────────────────────
                        await this.runRadarChecks(trade._id.toString(), trade.symbol, trade.direction as 'LONG' | 'SHORT', trade.stopLoss, currentPrice);

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
                        await TradingMemoryService.recordTradeResult(trade);

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

        } catch (error: any) {
            if (error.message && (error.message.includes('ENOTFOUND') || error.message.includes('topology'))) {
                return; // Offline / waiting for network reconnection
            }
            logger.error('Error in PositionMonitor:', error);
        }
    }

    /**
     * نقطة الدخول الرئيسية للـ Radar — يُستدعى لكل صفقة نشطة
     * نظام تنبيه ثلاثي المراحل (Three-Phase Position Alert System)
     */
    private async runRadarChecks(
        tradeId: string,
        symbol: string,
        direction: 'LONG' | 'SHORT',
        stopLoss: number,
        currentPrice: number
    ): Promise<void> {
        try {
            const radar = await TradeRadar.findOne({ tradeId, isActive: true });
            if (!radar) return;

            // ── Call Independent Radar monitoring engine if engineId is set ──
            if (radar.engineId) {
                const radarEngine = getRadarEngine(radar.engineId);
                if (radarEngine) {
                    try {
                        const ohlcv5m = await this.bingx.fetchOHLCV(symbol, '5m', 100);
                        const ohlcv15m = await this.bingx.fetchOHLCV(symbol, '15m', 100);
                        const ohlcv1h = await this.bingx.fetchOHLCV(symbol, '1h', 100);
                        const ohlcv4h = await this.bingx.fetchOHLCV(symbol, '4h', 100);
                        const ohlcv1d = await this.bingx.fetchOHLCV(symbol, '1d', 100).catch(() => []);

                        const mtfOHLCV: Record<string, OHLCV[]> = {
                            '5m': ohlcv5m,
                            '15m': ohlcv15m,
                            '1h': ohlcv1h,
                            '4h': ohlcv4h,
                            '1d': ohlcv1d
                        };

                        const allTimeframes: Record<string, AnalysisDetails> = {};
                        for (const [tf, candles] of Object.entries(mtfOHLCV)) {
                            if (candles.length >= 14) {
                                allTimeframes[tf] = TechnicalAnalyzer.calculateTechnicalData(candles, tf, currentPrice);
                            }
                        }

                        const checkResult = radarEngine.monitor(
                            direction,
                            currentPrice,
                            ohlcv5m,
                            allTimeframes,
                            mtfOHLCV
                        );

                        if (checkResult.invalidate) {
                            logger.warn(`[PositionMonitor] Radar Engine ${radar.engineId} invalidated position for ${symbol}: ${checkResult.reason}`);

                            // Close position immediately
                            await this.tradeManager.closeSpecificPosition(radar.userId.toString(), symbol);

                            radar.isActive = false;
                            radar.sentEvents.push({
                                type: 'CUSTOM',
                                sentAt: new Date(),
                                details: `INVALIDATION: ${checkResult.action} - ${checkResult.reason}`
                            });
                            await radar.save();

                            const originalTrade = await Trade.findById(tradeId);
                            if (originalTrade) {
                                originalTrade.currentStatus = 'CLOSED_LOSS';
                                originalTrade.closeTime = new Date();
                                originalTrade.logs.push(`Invalidated by Radar Engine ${radar.engineId}. Action: ${checkResult.action}. Reason: ${checkResult.reason}`);
                                await originalTrade.save();
                            }

                            let actionLabel = '';
                            if (checkResult.action === 'EXIT') actionLabel = 'خروج فوري (EXIT)';
                            else if (checkResult.action === 'FREEZE') actionLabel = 'تجميد التداول (FREEZE)';
                            else if (checkResult.action === 'FLIP') actionLabel = 'انعكاس المركز (FLIP)';
                            else if (checkResult.action === 'RESET') actionLabel = 'إعادة ضبط النموذج (RESET)';

                            const notifyMsg = `🚨 <b>تنبيه المراقب المستقل (Radar ${radar.engineId}): كسر شروط الاستمرار!</b>\n\n` +
                                `📍 الرمز: <b>${symbol}</b> (${direction})\n` +
                                `⛔ السبب: ${checkResult.reason}\n` +
                                `⚙️ الإجراء المتخذ: <b>${actionLabel}</b>\n\n` +
                                `💡 <i>تم إغلاق المركز فوراً لحماية رأس المال.</i>`;
                            await this.notifier(radar.telegramId, notifyMsg);

                            // Handle actions
                            if (checkResult.action === 'FREEZE') {
                                FrozenPairsRegistry.freeze(symbol, 2 * 60 * 60 * 1000); // 2 hours
                                await this.notifier(radar.telegramId, `❄️ <b>تم تجميد التداول على زوج ${symbol} لمدة ساعتين!</b>`);
                            } else if (checkResult.action === 'FLIP') {
                                const flipDirection = direction === 'LONG' ? 'SHORT' : 'LONG';
                                if (originalTrade) {
                                    const flipSignal = {
                                        symbol,
                                        type: 'TRADE' as const,
                                        direction: flipDirection as 'LONG' | 'SHORT',
                                        entry: [currentPrice],
                                        stopLoss: flipDirection === 'LONG' ? currentPrice * 0.98 : currentPrice * 1.02,
                                        targets: [flipDirection === 'LONG' ? currentPrice * 1.04 : currentPrice * 0.96],
                                        risk: originalTrade.leverage ? originalTrade.amount * (originalTrade.leverage / 100) : 2,
                                        leverage: originalTrade.leverage || 10,
                                        engineId: radar.engineId
                                    };
                                    await this.notifier(radar.telegramId, `🔄 <b>بدء تنفيذ مركز عكسي (FLIP) لـ ${symbol}...</b>`);
                                    await this.tradeManager.executeSignal(flipSignal, radar.userId.toString(), originalTrade.sourceChatId);
                                }
                            } else if (checkResult.action === 'RESET') {
                                await this.notifier(radar.telegramId, `🔄 <b>تمت إعادة تهيئة نموذج ${radar.engineId} وتصفير المعاملات للرمز ${symbol}.</b>`);
                            }

                            return; // Stop further checks for this closed trade
                        }
                    } catch (err: any) {
                        logger.error(`[PositionMonitor] Error running Radar Engine ${radar.engineId} check: ${err.message}`, err);
                    }
                }
            }

            // جلب شموع 5m للتحليل
            const ohlcv5m = await this.bingx.fetchOHLCV(symbol, '5m', 30);
            if (ohlcv5m.length < 10) return;

            radar.lastCheckedAt = new Date();

            // حساب Pivot لفريم الساعة لتوفيره للمراحل
            let pivot1h = 0;
            try {
                const ohlcv1h = await this.bingx.fetchOHLCV(symbol, '1h', 2);
                if (ohlcv1h && ohlcv1h.length >= 2) {
                    const prev1h = ohlcv1h[ohlcv1h.length - 2];
                    pivot1h = (prev1h.high + prev1h.low + prev1h.close) / 3;
                }
            } catch (err) {
                logger.error(`Radar: Failed to fetch 1h Pivot for ${symbol}:`, err);
            }

            // ── المرحلة 1: تحذيرات الضعف والتصحيح الهيكلي ─────────────────
            await this.checkPhase1Weakness(radar, ohlcv5m, currentPrice, direction, pivot1h);

            // ── المرحلة 2: تحذيرات كسر الدعم وسحب السيولة ──────────────────
            await this.checkPhase2Breakout(radar, ohlcv5m, stopLoss, direction, currentPrice);

            // ── المرحلة 3: تحذيرات زخم الاتجاه وتسارعه ──────────────────────
            await this.checkPhase3Momentum(radar, ohlcv5m, direction, currentPrice, symbol, pivot1h);

            await radar.save();
        } catch (err) {
            logger.error(`Radar check error for ${symbol}:`, err);
        }
    }

    /**
     * المرحلة 1: تحذيرات الضعف والتصحيح الهيكلي (Structural Weakness & Fib Correction)
     */
    private async checkPhase1Weakness(
        radar: ITradeRadar,
        ohlcv5m: any[],
        currentPrice: number,
        direction: 'LONG' | 'SHORT',
        pivot1h: number
    ): Promise<void> {
        if (!radar.settings.reversalAlert) return;

        // 1. انحراف RSI (Divergence)
        const divergence = this.analysis.detectDivergence(ohlcv5m, direction);
        if (divergence.detected) {
            const alreadySent = radar.sentEvents.some(
                e => e.type === 'REVERSAL_WARNING' && e.details === 'RSI_DIVERGENCE'
            );
            if (!alreadySent) {
                logger.info(`Radar Phase 1: RSI Divergence detected for ${radar.symbol}`);
                const msg = `⚠️ <b>رادار المراكز - المرحلة 1: ضعف الزخم (RSI Divergence)!</b>\n\n` +
                    `📍 الرمز: <b>${radar.symbol}</b> (${direction})\n` +
                    `🔍 الإشارة: <b>${divergence.description}</b>\n\n` +
                    `💡 <i>تم رصد انحراف في المؤشرات الفنية، مما يشير إلى ضعف محتمل في الاتجاه الحالي.</i>`;
                await this.notifier(radar.telegramId, msg);
                radar.sentEvents.push({
                    type: 'REVERSAL_WARNING',
                    sentAt: new Date(),
                    details: 'RSI_DIVERGENCE'
                });
            }
        }

        // 2. كسر مستوى الـ Pivot
        if (pivot1h > 0) {
            const isPivotBroken = this.analysis.isPivotBroken(currentPrice, pivot1h, direction);
            if (isPivotBroken) {
                const alreadySent = radar.sentEvents.some(
                    e => e.type === 'REVERSAL_WARNING' && e.details === 'PIVOT_BREAK'
                );
                if (!alreadySent) {
                    logger.info(`Radar Phase 1: Pivot broken for ${radar.symbol}`);
                    const msg = `🚨 <b>رادار المراكز - المرحلة 1: كسر هيكل السوق (Pivot Break)!</b>\n\n` +
                        `📍 الرمز: <b>${radar.symbol}</b> (${direction})\n` +
                        `⛔ الحالة: كسر السعر لمستوى الـ Pivot اليومي/الاسبوعي عند <b>$${pivot1h.toFixed(4)}</b>\n\n` +
                        `💡 <i>فقد السعر الدعم المؤسساتي وبدأ التصحيح رسمياً. يرجى تأمين الصفقة!</i>`;
                    await this.notifier(radar.telegramId, msg);
                    radar.sentEvents.push({
                        type: 'REVERSAL_WARNING',
                        sentAt: new Date(),
                        details: 'PIVOT_BREAK'
                    });
                }
            }
        }

        // 3. تصحيح فيبوناتشي 50% أو 61.8%
        const fib = this.analysis.calculateCorrectionFibLevels(ohlcv5m, direction);
        if (direction === 'LONG') {
            if (currentPrice <= fib.fib618) {
                const alreadySent = radar.sentEvents.some(
                    e => e.type === 'REVERSAL_WARNING' && e.details === 'FIB_618_RETRACEMENT'
                );
                if (!alreadySent) {
                    logger.info(`Radar Phase 1: Fib 61.8% hit for ${radar.symbol}`);
                    const msg = `📉 <b>رادار المراكز - المرحلة 1: ملامسة تصحيح فيبوناتشي الذهبي 61.8%!</b>\n\n` +
                        `📍 الرمز: <b>${radar.symbol}</b> (LONG)\n` +
                        `📊 السعر الحالي: <b>$${currentPrice.toFixed(4)}</b>\n` +
                        `🎯 المستوى الذهبي: <b>$${fib.fib618.toFixed(4)}</b>\n\n` +
                        `💡 <i>السعر يتداول عند أقوى مناطق الدعم للتصحيح. راقب حدوث ارتداد صاعد.</i>`;
                    await this.notifier(radar.telegramId, msg);
                    radar.sentEvents.push({
                        type: 'REVERSAL_WARNING',
                        sentAt: new Date(),
                        details: 'FIB_618_RETRACEMENT'
                    });
                }
            } else if (currentPrice <= fib.fib500) {
                const alreadySent = radar.sentEvents.some(
                    e => e.type === 'REVERSAL_WARNING' && e.details === 'FIB_50_RETRACEMENT'
                );
                if (!alreadySent) {
                    logger.info(`Radar Phase 1: Fib 50% hit for ${radar.symbol}`);
                    const msg = `📉 <b>رادار المراكز - المرحلة 1: ملامسة تصحيح فيبوناتشي 50%!</b>\n\n` +
                        `📍 الرمز: <b>${radar.symbol}</b> (LONG)\n` +
                        `📊 السعر الحالي: <b>$${currentPrice.toFixed(4)}</b>\n` +
                        `🎯 مستوى 50%: <b>$${fib.fib500.toFixed(4)}</b>\n\n` +
                        `💡 <i>السعر لامس مستوى الـ 50% للتصحيح، وهي منطقة الارتداد الأولية.</i>`;
                    await this.notifier(radar.telegramId, msg);
                    radar.sentEvents.push({
                        type: 'REVERSAL_WARNING',
                        sentAt: new Date(),
                        details: 'FIB_50_RETRACEMENT'
                    });
                }
            }
        } else { // SHORT
            if (currentPrice >= fib.fib618) {
                const alreadySent = radar.sentEvents.some(
                    e => e.type === 'REVERSAL_WARNING' && e.details === 'FIB_618_RETRACEMENT'
                );
                if (!alreadySent) {
                    logger.info(`Radar Phase 1: Fib 61.8% hit for ${radar.symbol}`);
                    const msg = `📈 <b>رادار المراكز - المرحلة 1: ملامسة تصحيح فيبوناتشي الذهبي 61.8%!</b>\n\n` +
                        `📍 الرمز: <b>${radar.symbol}</b> (SHORT)\n` +
                        `📊 السعر الحالي: <b>$${currentPrice.toFixed(4)}</b>\n` +
                        `🎯 المستوى الذهبي: <b>$${fib.fib618.toFixed(4)}</b>\n\n` +
                        `💡 <i>السعر يتداول عند أقوى مناطق المقاومة للتصحيح. راقب حدوث ارتداد هابط.</i>`;
                    await this.notifier(radar.telegramId, msg);
                    radar.sentEvents.push({
                        type: 'REVERSAL_WARNING',
                        sentAt: new Date(),
                        details: 'FIB_618_RETRACEMENT'
                    });
                }
            } else if (currentPrice >= fib.fib500) {
                const alreadySent = radar.sentEvents.some(
                    e => e.type === 'REVERSAL_WARNING' && e.details === 'FIB_50_RETRACEMENT'
                );
                if (!alreadySent) {
                    logger.info(`Radar Phase 1: Fib 50% hit for ${radar.symbol}`);
                    const msg = `📈 <b>رادار المراكز - المرحلة 1: ملامسة تصحيح فيبوناتشي 50%!</b>\n\n` +
                        `📍 الرمز: <b>${radar.symbol}</b> (SHORT)\n` +
                        `📊 السعر الحالي: <b>$${currentPrice.toFixed(4)}</b>\n` +
                        `🎯 مستوى 50%: <b>$${fib.fib500.toFixed(4)}</b>\n\n` +
                        `💡 <i>السعر لامس مستوى الـ 50% للتصحيح، وهي منطقة الارتداد الأولية.</i>`;
                    await this.notifier(radar.telegramId, msg);
                    radar.sentEvents.push({
                        type: 'REVERSAL_WARNING',
                        sentAt: new Date(),
                        details: 'FIB_50_RETRACEMENT'
                    });
                }
            }
        }
    }

    /**
     * المرحلة 2: تحذيرات كسر الدعم/المقاومة وسحب السيولة (S/R Breakout & Wick Sweep)
     */
    private async checkPhase2Breakout(
        radar: ITradeRadar,
        ohlcv5m: any[],
        stopLoss: number,
        direction: 'LONG' | 'SHORT',
        currentPrice: number
    ): Promise<void> {
        // 1. كشف Wick Sweep (إذا مفعل)
        if (radar.settings.wickSweepAlert) {
            await this.detectWickSweep(radar, ohlcv5m, stopLoss, direction, currentPrice);
        }

        // 2. كسر الدعم والمقاومة المحلية (Fractal Swing Support/Resistance Break)
        if (radar.settings.reversalAlert) {
            const recent = ohlcv5m.slice(-15, -1); // exclude live candle
            if (recent.length >= 5) {
                if (direction === 'LONG') {
                    const localSwingLow = Math.min(...recent.map(c => c.low));
                    if (currentPrice < localSwingLow) {
                        const alreadySent = radar.sentEvents.some(
                            e => e.type === 'REVERSAL_WARNING' && e.details === 'LOCAL_SWING_BREAK'
                        );
                        if (!alreadySent) {
                            logger.info(`Radar Phase 2: Swing Low Broken for ${radar.symbol}`);
                            const msg = `🚨 <b>رادار المراكز - المرحلة 2: كسر الدعم المحلي (Swing Low)!</b>\n\n` +
                                `📍 الرمز: <b>${radar.symbol}</b> (LONG)\n` +
                                `⛔ كسر القاع المحلي: السعر الحالي <b>$${currentPrice.toFixed(4)}</b> كسر الدعم السابق عند <b>$${localSwingLow.toFixed(4)}</b>.\n\n` +
                                `💡 <i>يشير هذا إلى كسر هيكلي هابط وسلبي للمركز الصاعد. ينصح بنقل وقف الخسارة أو تأمين الأرباح.</i>`;
                            await this.notifier(radar.telegramId, msg);
                            radar.sentEvents.push({
                                type: 'REVERSAL_WARNING',
                                sentAt: new Date(),
                                details: 'LOCAL_SWING_BREAK'
                            });
                        }
                    }
                } else { // SHORT
                    const localSwingHigh = Math.max(...recent.map(c => c.high));
                    if (currentPrice > localSwingHigh) {
                        const alreadySent = radar.sentEvents.some(
                            e => e.type === 'REVERSAL_WARNING' && e.details === 'LOCAL_SWING_BREAK'
                        );
                        if (!alreadySent) {
                            logger.info(`Radar Phase 2: Swing High Broken for ${radar.symbol}`);
                            const msg = `🚨 <b>رادار المراكز - المرحلة 2: كسر المقاومة المحلية (Swing High)!</b>\n\n` +
                                `📍 الرمز: <b>${radar.symbol}</b> (SHORT)\n` +
                                `⛔ كسر القمة المحلية: السعر الحالي <b>$${currentPrice.toFixed(4)}</b> كسر المقاومة السابقة عند <b>$${localSwingHigh.toFixed(4)}</b>.\n\n` +
                                `💡 <i>يشير هذا إلى كسر هيكلي صاعد وسلبي لصفقة الشورت المفتوحة.</i>`;
                            await this.notifier(radar.telegramId, msg);
                            radar.sentEvents.push({
                                type: 'REVERSAL_WARNING',
                                sentAt: new Date(),
                                details: 'LOCAL_SWING_BREAK'
                            });
                        }
                    }
                }
            }
        }
    }

    /**
     * المرحلة 3: تحذيرات زخم الترند وتسارع الحركة (Momentum Bounce & Trend Expansion)
     */
    private async checkPhase3Momentum(
        radar: ITradeRadar,
        ohlcv5m: any[],
        direction: 'LONG' | 'SHORT',
        currentPrice: number,
        symbol: string,
        pivot1h: number
    ): Promise<void> {
        // 1. ارتداد إيجابي (Pivot/Support Bounce + Volume Spike)
        const recent3 = ohlcv5m.slice(-3);
        const fib = this.analysis.calculateCorrectionFibLevels(ohlcv5m, direction);
        const lastCandle = ohlcv5m[ohlcv5m.length - 1];

        // حساب متوسط الحجم لآخر 15 شمعة لاستخلاص انفجار الأحجام (Volume Spike)
        const lookback = ohlcv5m.slice(-15, -1);
        const avgVolume = lookback.reduce((sum, c) => sum + c.volume, 0) / lookback.length;

        if (recent3.length >= 3 && avgVolume > 0 && lastCandle) {
            const volSpike = lastCandle.volume > avgVolume * 1.5;
            const extremeVolSpike = lastCandle.volume > avgVolume * 2.2;

            // 1.1 Volume Spike (standalone alert if extremely high)
            if (extremeVolSpike) {
                const alreadySent = radar.sentEvents.some(
                    e => e.type === 'CUSTOM' && e.details === 'VOLUME_SPIKE'
                );
                if (!alreadySent) {
                    logger.info(`Radar Phase 3: Volume Spike detected for ${radar.symbol}`);
                    const msg = `⚡ <b>رادار المراكز - المرحلة 3: انفجار في حجم التداول (Volume Spike)!</b>\n\n` +
                        `📍 الرمز: <b>${radar.symbol}</b> (${direction})\n` +
                        `📊 الحجم الحالي: <b>${lastCandle.volume.toFixed(0)}</b> (أعلى بـ ${((lastCandle.volume / avgVolume) * 100).toFixed(0)}% من المتوسط).\n\n` +
                        `💡 <i>سيولة ضخمة تدخل السوق الآن، توقع حركة سعرية قوية وعنيفة.</i>`;
                    await this.notifier(radar.telegramId, msg);
                    radar.sentEvents.push({
                        type: 'CUSTOM',
                        sentAt: new Date(),
                        details: 'VOLUME_SPIKE'
                    });
                }
            }

            // 1.2 Pivot/Support Bounce with Vol Spike
            let bounced = false;
            if (direction === 'LONG') {
                const closeToPivot = pivot1h > 0 && recent3.some(c => Math.abs(c.low - pivot1h) / pivot1h < 0.0015);
                const closeToFib618 = recent3.some(c => Math.abs(c.low - fib.fib618) / fib.fib618 < 0.0015);
                const closeToFib500 = recent3.some(c => Math.abs(c.low - fib.fib500) / fib.fib500 < 0.0015);
                const isGreen = currentPrice > ohlcv5m[ohlcv5m.length - 2].close;

                if ((closeToPivot || closeToFib618 || closeToFib500) && isGreen && volSpike) {
                    bounced = true;
                }
            } else { // SHORT
                const closeToPivot = pivot1h > 0 && recent3.some(c => Math.abs(c.high - pivot1h) / pivot1h < 0.0015);
                const closeToFib618 = recent3.some(c => Math.abs(c.high - fib.fib618) / fib.fib618 < 0.0015);
                const closeToFib500 = recent3.some(c => Math.abs(c.high - fib.fib500) / fib.fib500 < 0.0015);
                const isRed = currentPrice < ohlcv5m[ohlcv5m.length - 2].close;

                if ((closeToPivot || closeToFib618 || closeToFib500) && isRed && volSpike) {
                    bounced = true;
                }
            }

            if (bounced) {
                const alreadySent = radar.sentEvents.some(
                    e => e.type === 'CUSTOM' && e.details === 'MOMENTUM_BOUNCE'
                );
                if (!alreadySent) {
                    logger.info(`Radar Phase 3: Pivot/Support Bounce detected for ${radar.symbol}`);
                    const bounceType = direction === 'LONG' ? 'صاعد 📈' : 'هابط 📉';
                    const msg = `🟢 <b>رادار المراكز - المرحلة 3: ارتداد ${bounceType} مع تأكيد سيولة!</b>\n\n` +
                        `📍 الرمز: <b>${radar.symbol}</b> (${direction})\n` +
                        `⚡ الإشارة: ارتداد ناجح من مستوى دعم/Pivot مع انفجار أحجام التداول لتأكيد الحركة.\n` +
                        `📊 السعر الحالي: <b>$${currentPrice.toFixed(4)}</b>\n\n` +
                        `💡 <i>تأكيد أمان الصفقة واستمرار الزخم باتجاه الأهداف المحددة.</i>`;
                    await this.notifier(radar.telegramId, msg);
                    radar.sentEvents.push({
                        type: 'CUSTOM',
                        sentAt: new Date(),
                        details: 'MOMENTUM_BOUNCE'
                    });
                }
            }
        }

        // 2. Trailing Stop التكيفي (إذا مفعل)
        if (radar.settings.trailingEnabled) {
            await this.updateTrailingStop(radar, ohlcv5m, direction, currentPrice, symbol);
        }
    }

    /**
     * كشب الكسر الكاذب: ذيل اخترق SL وجسم الشمعة ارتد داخل الأمان
     */
    private async detectWickSweep(
        radar: ITradeRadar,
        ohlcv: any[],
        stopLoss: number,
        direction: 'LONG' | 'SHORT',
        currentPrice: number
    ): Promise<void> {
        const lastCandle = ohlcv[ohlcv.length - 1];
        if (!lastCandle) return;

        const isWickSweep = CoreTradeRadar.checkWickSweep(ohlcv, stopLoss, direction);
        if (!isWickSweep) return;

        // هل أُرسل هذا الحدث مسبقاً؟ (notifyOnce)
        if (radar.settings.notifyOnce) {
            const alreadySent = radar.sentEvents.some(e => e.type === 'WICK_SWEEP');
            if (alreadySent) return;
        }

        logger.info(`Radar: Wick Sweep detected for ${radar.symbol}`);

        // Calculate proposed tight stop loss just below sweep candle
        const compSL = direction === 'LONG' ? lastCandle.low * 0.998 : lastCandle.high * 1.002;
        const originalTrade = await Trade.findById(radar.tradeId);
        if (!originalTrade) return;

        const originalMargin = originalTrade.amount / (originalTrade.leverage || 10);
        const compRiskMargin = originalMargin * 0.5;

        const msg = `⚠️ <b>تحذير: سحب سيولة (Wick Sweep)!</b>\n\n` +
            `📍 الرمز: <b>${radar.symbol}</b> (${direction})\n` +
            `📉 الذيل اخترق وقف الخسارة: <b>$${stopLoss.toFixed(4)}</b>\n` +
            `✅ جسم الشمعة أُغلق خارج خطر الخسارة (كسر كاذب)\n\n` +
            `🛡️ <b>صفقة تعويضية تحوطية مقترحة (بمخاطرة 50%):</b>\n` +
            `🏁 سعر الدخول: <b>$${currentPrice.toFixed(4)}</b>\n` +
            `🛑 وقف خسارة ضيق: <b>$${compSL.toFixed(4)}</b>\n` +
            `💰 الهامش المطلوب: <b>${compRiskMargin.toFixed(2)} USDT</b>\n\n` +
            `<i>هل تود تنفيذ صفقة التعويض التحوطية الآن؟</i>`;

        const extra = {
            parse_mode: 'HTML',
            reply_markup: {
                inline_keyboard: [
                    [
                        { text: '⚡ تنفيذ صفقة التعويض', callback_data: `radar_exec_comp_${radar.tradeId}` },
                        { text: '❌ تجاهل التنبيه', callback_data: `radar_noop` }
                    ]
                ]
            }
        };

        // notifier handles optional extra parameters (like inline keyboard) in bot/index.ts
        await (this.notifier as any)(radar.telegramId, msg, extra);

        radar.sentEvents.push({
            type: 'WICK_SWEEP',
            sentAt: new Date(),
            details: `SL=${stopLoss}, low=${lastCandle.low}, proposedSL=${compSL}, margin=${compRiskMargin}`
        });
    }

    /**
     * Trailing Stop ديناميكي: يرفع/يخفض SL مع كل Higher Low / Lower High جديد بناءً على ATR
     */
    private async updateTrailingStop(
        radar: ITradeRadar,
        ohlcv: any[],
        direction: 'LONG' | 'SHORT',
        currentPrice: number,
        symbol: string
    ): Promise<void> {
        const newSL = CoreTradeRadar.calculateTrailingStop(ohlcv, radar.currentSL, direction, currentPrice);
        if (newSL === null) return;

        logger.info(`Radar: Volatility Trailing SL update for ${symbol}: ${radar.currentSL} → ${newSL}`);

        try {
            // تطبيق الـ SL الجديد على المنصة
            await this.bingx.setStopLoss(symbol, newSL, direction);

            const msg = `📈 <b>تحديث Trailing Stop (تقلبات ATR)</b>\n\n` +
                `📍 الرمز: <b>${symbol}</b> (${direction})\n` +
                `🔄 وقف الخسارة السابق: <b>$${radar.currentSL.toFixed(4)}</b>\n` +
                `✅ وقف الخسارة الجديد: <b>$${newSL.toFixed(4)}</b>\n\n` +
                `<i>تم تحديث الحماية تلقائياً وفقاً لتقلبات السوق الحالية</i>`;

            await this.notifier(radar.telegramId, msg);
            radar.sentEvents.push({ type: 'TRAILING_UPDATE', sentAt: new Date(), details: `${radar.currentSL} → ${newSL}` });
            radar.currentSL = newSL;
        } catch (err) {
            logger.error(`Radar: Failed to set trailing SL for ${symbol}:`, err);
        }
    }
}
