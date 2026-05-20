import { BingXService } from './BingXService';
import { AnalysisService } from './AnalysisService';
import Trade from '../models/Trade';
import User from '../models/User';
import TradeRadar, { ITradeRadar } from '../models/TradeRadar';
import { TechnicalAnalyzer } from './TechnicalAnalyzer';
import logger from '../utils/logger';

export class PositionMonitor {
    private bingx: BingXService;
    private analysis: AnalysisService;
    private notifier: (telegramId: string, msg: string) => Promise<void>;
    private isRunning: boolean = false;
    private intervalId?: NodeJS.Timeout;

    constructor(bingx: BingXService, analysis: AnalysisService, notifier: (telegramId: string, msg: string) => Promise<void>) {
        this.bingx = bingx;
        this.analysis = analysis;
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

    // =========================================================================
    // RADAR SYSTEM — مراقبة متقدمة للصفقات
    // =========================================================================

    /**
     * نقطة الدخول الرئيسية للـ Radar — يُستدعى لكل صفقة نشطة
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

            // جلب شموع 5m للتحليل
            const ohlcv5m = await this.bingx.fetchOHLCV(symbol, '5m', 30);
            if (ohlcv5m.length < 10) return;

            radar.lastCheckedAt = new Date();

            // ── 1. كشف الكسر الكاذب (Wick Sweep) ───────────────────────────────
            if (radar.settings.wickSweepAlert) {
                await this.detectWickSweep(radar, ohlcv5m, stopLoss, direction, currentPrice);
            }

            // ── 2. تنبيه الانعكاس المبكر (CHoCH + Divergence) ───────────────────
            if (radar.settings.reversalAlert) {
                await this.detectEarlyReversal(radar, ohlcv5m, direction);
            }

            // ── 3. Trailing Stop الديناميكي ──────────────────────────────────────
            if (radar.settings.trailingEnabled) {
                await this.updateTrailingStop(radar, ohlcv5m, direction, currentPrice, symbol);
            }

            await radar.save();
        } catch (err) {
            logger.error(`Radar check error for ${symbol}:`, err);
        }
    }

    /**
     * كشف الكسر الكاذب: ذيل اخترق SL وجسم الشمعة ارتد داخل الأمان
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

        // هل الذيل اخترق الـ SL؟
        const wickBrokeSL = direction === 'LONG'
            ? lastCandle.low <= stopLoss
            : lastCandle.high >= stopLoss;

        // هل الجسم بقي بأمان؟
        const bodyIntact = direction === 'LONG'
            ? lastCandle.close > stopLoss
            : lastCandle.close < stopLoss;

        if (!wickBrokeSL || !bodyIntact) return;

        // هل أُرسل هذا الحدث مسبقاً؟ (notifyOnce)
        if (radar.settings.notifyOnce) {
            const alreadySent = radar.sentEvents.some(e => e.type === 'WICK_SWEEP');
            if (alreadySent) return;
        }

        logger.info(`Radar: Wick Sweep detected for ${radar.symbol}`);
        const msg = `⚠️ <b>تحذير: سحب سيولة (Wick Sweep)!</b>\n\n` +
            `📍 الرمز: <b>${radar.symbol}</b> (${direction})\n` +
            `📉 الذيل اخترق وقف الخسارة: <b>$${stopLoss.toFixed(4)}</b>\n` +
            `✅ جسم الشمعة أُغلق خارج خطر الخسارة\n\n` +
            `<i>هذا سحب سيولة محتمل — الصفقة لا تزال صالحة هيكلياً. راقب الإغلاق القادم.</i>`;

        await this.notifier(radar.telegramId, msg);
        radar.sentEvents.push({ type: 'WICK_SWEEP', sentAt: new Date(), details: `SL=${stopLoss}, low=${lastCandle.low}` });
    }

    /**
     * كشف الانعكاس المبكر: CHoCH عكسي + RSI Divergence
     */
    private async detectEarlyReversal(
        radar: ITradeRadar,
        ohlcv: any[],
        direction: 'LONG' | 'SHORT'
    ): Promise<void> {
        // هل أُرسل هذا الحدث مسبقاً؟
        if (radar.settings.notifyOnce) {
            const alreadySent = radar.sentEvents.some(e => e.type === 'REVERSAL_WARNING');
            if (alreadySent) return;
        }

        // MSS عكسي: نبحث عن كسر هيكل في الاتجاه المعاكس
        const reverseDir = direction === 'LONG' ? 'SHORT' : 'LONG';
        const mss = TechnicalAnalyzer.detectMSS(ohlcv, reverseDir);
        const div = TechnicalAnalyzer.detectDivergence(ohlcv, direction);

        // يتطلب كلا الشرطين للتأكيد
        if (!mss.detected || !div.detected) return;

        logger.info(`Radar: Early Reversal Warning for ${radar.symbol}`);
        const actionMsg = direction === 'LONG'
            ? 'يُنصح بإغلاق 50% من المركز أو نقل SL لنقطة الدخول (Break-Even)'
            : 'يُنصح بإغلاق 50% من المركز أو نقل SL لنقطة الدخول (Break-Even)';

        const msg = `🚨 <b>تنبيه انعكاس مبكر!</b>\n\n` +
            `📍 الرمز: <b>${radar.symbol}</b> (${direction})\n` +
            `⚡ كسر هيكل عكسي: <b>${mss.description}</b>\n` +
            `📊 Divergence: <b>${direction === 'LONG' ? 'Bearish Divergence' : 'Bullish Divergence'} ✅</b>\n\n` +
            `💡 <i>${actionMsg}</i>`;

        await this.notifier(radar.telegramId, msg);
        radar.sentEvents.push({ type: 'REVERSAL_WARNING', sentAt: new Date(), details: mss.description });
    }

    /**
     * Trailing Stop ديناميكي: يرفع/يخفض SL مع كل Higher Low / Lower High جديد
     */
    private async updateTrailingStop(
        radar: ITradeRadar,
        ohlcv: any[],
        direction: 'LONG' | 'SHORT',
        currentPrice: number,
        symbol: string
    ): Promise<void> {
        if (ohlcv.length < 5) return;

        const recent = ohlcv.slice(-5);
        let newSL: number;

        if (direction === 'LONG') {
            // نُحرك SL للأعلى مع كل قاع أعلى (Higher Low)
            const newSwingLow = Math.min(...recent.map((c: any) => c.low));
            newSL = newSwingLow;
            // لا نُحرك SL للأسفل أبداً
            if (newSL <= radar.currentSL) return;
        } else {
            // نُحرك SL للأسفل مع كل قمة أدنى (Lower High)
            const newSwingHigh = Math.max(...recent.map((c: any) => c.high));
            newSL = newSwingHigh;
            // لا نُحرك SL للأعلى أبداً
            if (newSL >= radar.currentSL) return;
        }

        logger.info(`Radar: Trailing SL update for ${symbol}: ${radar.currentSL} → ${newSL}`);

        try {
            // تطبيق الـ SL الجديد على المنصة
            await this.bingx.setStopLoss(symbol, newSL, direction);

            const msg = `📈 <b>تحديث Trailing Stop</b>\n\n` +
                `📍 الرمز: <b>${symbol}</b> (${direction})\n` +
                `🔄 وقف الخسارة السابق: <b>$${radar.currentSL.toFixed(4)}</b>\n` +
                `✅ وقف الخسارة الجديد: <b>$${newSL.toFixed(4)}</b>\n\n` +
                `<i>تم رفع الحماية تلقائياً مع الحركة</i>`;

            await this.notifier(radar.telegramId, msg);
            radar.sentEvents.push({ type: 'TRAILING_UPDATE', sentAt: new Date(), details: `${radar.currentSL} → ${newSL}` });
            radar.currentSL = newSL;
        } catch (err) {
            logger.error(`Radar: Failed to set trailing SL for ${symbol}:`, err);
        }
    }
}
