import { OHLCV, AnalysisDetails } from '../shared/types';
import { TechnicalAnalyzer, MATRIX_TFS } from '../analysis/TechnicalAnalyzer';
import { MTFDataBuilder } from '../shared/MTFDataBuilder';

export interface SniperReport {
    readyToFire: boolean;
    direction: 'LONG' | 'SHORT' | 'NONE';
    entry: number;
    sl: number;
    tp: number;
    tp2?: number;
    confidence: number;
    winRate: number;
    completedConditions: string[];
    pendingConditions: string[];
    summary: string;
}

export interface ISniperEngine {
    displayName: string;
    requiredTFs: string[];
    scan(symbol: string, currentPrice: number, mtfOHLCV: Record<string, OHLCV[]>, allTimeframes: Record<string, AnalysisDetails>): SniperReport;
}

export interface SniperBacktestOptions {
    days: number;
    stepMinutes: number;
    cooldownHours?: number;
    initialCapital?: number;
    marginPerTradePercentage?: number;
    marginMode?: string;
    leverage?: number;
    riskSizingEnabled?: boolean;
    maxSlCapEnabled?: boolean;
    maxSlPercentage?: number;
    alignToStartOfDay?: boolean;
}

export interface SniperBacktestSimulationResult {
    reportText: string;
    trades: any[];
}

export class CoreSniperBacktester {
    static runSimulation(
        symbol: string,
        engine: ISniperEngine,
        allData: Record<string, OHLCV[]>,
        options: SniperBacktestOptions
    ): SniperBacktestSimulationResult {
        const now = Date.now();
        let startTime = now - (options.days * 24 * 60 * 60 * 1000);
        if (options.alignToStartOfDay) {
            const startOfStartDay = new Date(startTime);
            startOfStartDay.setUTCHours(0, 0, 0, 0);
            startTime = startOfStartDay.getTime();
        }
        const cooldownHours = options.cooldownHours ?? 2;

        const evaluationTF = '5m';
        const evalData = allData[evaluationTF] || allData['15m'];
        if (!evalData || evalData.length === 0) {
            throw new Error("Evaluation data (5m/15m) not available in provided dataset!");
        }

        interface ActiveTrade {
            type: 'LONG' | 'SHORT';
            entryPrice: number;
            sl: number;
            tp: number;
            tp2?: number;
            entryTime: number;
            entryDate: string;
            engineId: string;
            analysisContext?: Record<string, any>;
        }

        const completedTrades: any[] = [];
        let currentTrade: ActiveTrade | null = null;
        let totalSnipedOpportunities = 0;
        let totalEnteredTrades = 0;
        let lastEntryTime = 0;
        let lastKnownPrice = 0;

        const stepMs = options.stepMinutes * 60 * 1000;
        const tfsToFetch = [...new Set([...MATRIX_TFS, ...engine.requiredTFs])];

        // Loop through time step-by-step
        for (let t = startTime; t <= now; t += stepMs) {
            // Build MTF snapshot at timestamp `t` without lookahead bias
            const mtfSnapshot: Record<string, OHLCV[]> = {};
            let hasEnoughData = true;

            for (const tf of tfsToFetch) {
                if (!allData[tf]) {
                    hasEnoughData = false;
                    continue;
                }
                const tfMs = MTFDataBuilder.tfToMs(tf);
                const dataUpToT = allData[tf].filter(c => c.timestamp + tfMs <= t);
                mtfSnapshot[tf] = dataUpToT;

                if (dataUpToT.length < 15) {
                    hasEnoughData = false;
                }
            }

            if (!hasEnoughData) continue;

            const quickTF = engine.requiredTFs[engine.requiredTFs.length - 1]; // e.g. '1m' or '15m'
            const quickCandles = mtfSnapshot[quickTF];
            if (!quickCandles || quickCandles.length === 0) continue;

            const currentPrice = quickCandles[quickCandles.length - 1].close;
            lastKnownPrice = currentPrice;

            // ─── PART A: EVALUATE ACTIVE TRADE ────────────────────────────────────
            if (currentTrade) {
                const trade = currentTrade;
                // Find fine-grained candles starting after trade entry
                const futureCandles = evalData.filter(c => c.timestamp >= trade.entryTime && c.timestamp <= t);
                let closed = false;
                let resultStatus: 'WIN' | 'LOSS' = 'WIN';
                let closePrice = 0;
                let closeTime = 0;

                for (const candle of futureCandles) {
                    if (trade.type === 'LONG') {
                        if (candle.high >= trade.tp) {
                            closed = true;
                            resultStatus = 'WIN';
                            closePrice = trade.tp;
                            closeTime = candle.timestamp;
                            break;
                        } else if (candle.low <= trade.sl) {
                            closed = true;
                            resultStatus = 'LOSS';
                            closePrice = trade.sl;
                            closeTime = candle.timestamp;
                            break;
                        }
                    } else { // SHORT
                        if (candle.low <= trade.tp) {
                            closed = true;
                            resultStatus = 'WIN';
                            closePrice = trade.tp;
                            closeTime = candle.timestamp;
                            break;
                        } else if (candle.high >= trade.sl) {
                            closed = true;
                            resultStatus = 'LOSS';
                            closePrice = trade.sl;
                            closeTime = candle.timestamp;
                            break;
                        }
                    }
                }

                if (closed) {
                    const durationMin = Math.round((closeTime - trade.entryTime) / 60000);
                    const pnlPct = trade.type === 'LONG'
                        ? ((closePrice - trade.entryPrice) / trade.entryPrice) * 100
                        : ((trade.entryPrice - closePrice) / trade.entryPrice) * 100;

                    completedTrades.push({
                        ...trade,
                        status: resultStatus,
                        closePrice,
                        closeTime,
                        closeDate: new Date(closeTime).toISOString().replace('T', ' ').substring(0, 16),
                        durationMinutes: durationMin,
                        pnlPercentage: pnlPct * 10 // Assuming 10x leverage
                    });

                    currentTrade = null;
                }
            }

            // ─── PART B: RUN SNIPER SCANNING ──────────────────────────────────────
            const dailyOHLCV = mtfSnapshot['1d'] || mtfSnapshot['4h'] || quickCandles;
            const vwap = dailyOHLCV.length > 0 ? TechnicalAnalyzer.calculateVWAP(dailyOHLCV) : currentPrice;

            const allTimeframes: Record<string, AnalysisDetails> = {};
            tfsToFetch.forEach(tf => {
                if (mtfSnapshot[tf] && mtfSnapshot[tf].length > 15) {
                    allTimeframes[tf] = TechnicalAnalyzer.calculateTechnicalData(mtfSnapshot[tf], tf, vwap);
                }
            });

            // Run the sniper engine scan
            const report = engine.scan(symbol, currentPrice, mtfSnapshot, allTimeframes);

            if (report.readyToFire) {
                totalSnipedOpportunities++;

                const dateStr = new Date(t).toISOString().replace('T', ' ').substring(0, 16);

                // Check if we can enter: Not in a trade AND cooldown has passed
                const cooldownMs = cooldownHours * 60 * 60 * 1000;
                if (!currentTrade && (t - lastEntryTime >= cooldownMs)) {
                    totalEnteredTrades++;
                    lastEntryTime = t;

                    // ─── Build full analysis context ────────────
                    const ctx: Record<string, any> = {
                        confidence: report.confidence,
                        winRate: report.winRate,
                        matrixScore: TechnicalAnalyzer.calculateMatrix(allTimeframes).percentage,
                        completedConditions: report.completedConditions.join(' | '),
                        pendingConditions: report.pendingConditions.join(' | '),
                        summary: report.summary,
                    };

                    const tfLabels = ['1m', '5m', '15m', '30m', '1h', '4h', '1d'];

                    for (const tf of tfLabels) {
                        const d = allTimeframes[tf];
                        if (!d) continue;
                        ctx[`${tf}_RSI`] = d.rsi?.toFixed(2) ?? '';
                        ctx[`${tf}_Trend`] = d.structure ?? '';
                        ctx[`${tf}_ATR`] = d.atr?.toFixed(4) ?? '';
                        ctx[`${tf}_MACD`] = d.indicators?.macd?.macd?.toFixed(4) ?? '';
                        ctx[`${tf}_MACD_Sig`] = d.indicators?.macd?.signal?.toFixed(4) ?? '';
                        ctx[`${tf}_MACD_Hist`] = d.indicators?.macd?.histogram?.toFixed(4) ?? '';
                        ctx[`${tf}_BB_Up`] = d.indicators?.bb?.upper?.toFixed(4) ?? '';
                        ctx[`${tf}_BB_Low`] = d.indicators?.bb?.lower?.toFixed(4) ?? '';
                        ctx[`${tf}_StochRSI`] = d.indicators?.stochRsi?.toString() ?? '';
                        ctx[`${tf}_CCI`] = d.indicators?.cci?.toFixed(2) ?? '';
                        ctx[`${tf}_WilliamsR`] = d.indicators?.williamsR?.toFixed(2) ?? '';
                        ctx[`${tf}_Pivot`] = d.levels?.pivot?.toFixed(4) ?? '';
                        ctx[`${tf}_R1`] = d.levels?.r1?.toFixed(4) ?? '';
                        ctx[`${tf}_S1`] = d.levels?.s1?.toFixed(4) ?? '';
                        ctx[`${tf}_Fib382`] = d.levels?.fib382?.toFixed(4) ?? '';
                        ctx[`${tf}_Fib618`] = d.levels?.fib618?.toFixed(4) ?? '';
                        ctx[`${tf}_SwingHigh`] = d.levels?.lastSwingHigh?.toFixed(4) ?? '';
                        ctx[`${tf}_SwingLow`] = d.levels?.lastSwingLow?.toFixed(4) ?? '';
                    }

                    currentTrade = {
                        type: report.direction as 'LONG' | 'SHORT',
                        entryPrice: report.entry,
                        sl: report.sl,
                        tp: report.tp,
                        tp2: report.tp2,
                        entryTime: t,
                        entryDate: dateStr,
                        engineId: engine.displayName,
                        analysisContext: ctx
                    };
                }
            }
        }

        // Force close any remaining open position at the end
        if (currentTrade) {
            completedTrades.push({
                ...currentTrade,
                status: 'OPEN',
                closePrice: lastKnownPrice,
                closeTime: now,
                closeDate: 'N/A',
                durationMinutes: Math.round((now - currentTrade.entryTime) / 60000),
                pnlPercentage: 0
            });
        }

        // Ensure each trade has `entry` property mapped from `entryPrice` for capital simulation compatibility
        for (const tr of completedTrades) {
            tr.entry = tr.entryPrice;
        }

        // 3. Pass 3: Realistic Capital Simulation
        let initialCapital = options.initialCapital || 1000;
        let activeCapital = initialCapital;
        let totalCapital = initialCapital;
        const riskPercentage = options.marginPerTradePercentage || 3;
        const marginMode = options.marginMode || 'ISOLATED';
        const defaultLeverage = options.leverage || 10;
        const maxSlCapEnabled = options.maxSlCapEnabled || false;
        const maxSlPercentage = options.maxSlPercentage || 5;

        let peakCapital = totalCapital;
        let maxDrawdown = 0;
        let skippedTrades = 0;

        let stats = {
            total: completedTrades.length,
            longWins: 0,
            longLosses: 0,
            shortWins: 0,
            shortLosses: 0,
            open: 0
        };

        // Populate initial stats (we will decrement if skipped)
        for (const tr of completedTrades) {
            if (tr.status === 'WIN') {
                if (tr.type === 'LONG') stats.longWins++;
                else stats.shortWins++;
            } else if (tr.status === 'LOSS') {
                if (tr.type === 'LONG') stats.longLosses++;
                else stats.shortLosses++;
            } else {
                stats.open++;
            }
        }

        const events: { type: 'OPEN' | 'CLOSE', time: number, trade: any }[] = [];
        for (const trade of completedTrades) {
            events.push({ type: 'OPEN', time: trade.entryTime, trade });
            if (trade.status !== 'OPEN' && trade.closeTime) {
                events.push({ type: 'CLOSE', time: trade.closeTime, trade });
            }
        }

        events.sort((a, b) => a.time - b.time);

        const slippageRate = 0.0003; // 0.03% Slippage
        const takerFeeRate = 0.0005; // 0.05% Taker Fee

        for (const event of events) {
            if (event.type === 'OPEN') {
                let slDistancePercentage = 0;
                if (event.trade.entry && event.trade.sl) {
                    slDistancePercentage = Math.abs(event.trade.entry - event.trade.sl) / event.trade.entry * 100;
                }

                let requestedMargin = totalCapital * (riskPercentage / 100);

                if (maxSlCapEnabled && slDistancePercentage > 0) {
                    const potentialLossAmount = requestedMargin * defaultLeverage * (slDistancePercentage / 100);
                    const maxAllowedLoss = totalCapital * (maxSlPercentage / 100);
                    if (potentialLossAmount > maxAllowedLoss) {
                        requestedMargin = maxAllowedLoss / (defaultLeverage * (slDistancePercentage / 100));
                    }
                }

                const entryFee = (requestedMargin * defaultLeverage) * takerFeeRate;

                if (activeCapital - entryFee < 5) {
                    event.trade.skipped = true;
                    event.trade.skipReason = 'Insufficient Margin';
                    skippedTrades++;

                    if (event.trade.status === 'WIN') {
                        if (event.trade.type === 'LONG') stats.longWins--;
                        else stats.shortWins--;
                    } else if (event.trade.status === 'LOSS') {
                        if (event.trade.type === 'LONG') stats.longLosses--;
                        else stats.shortLosses--;
                    } else {
                        stats.open--;
                    }
                    continue;
                }

                event.trade.marginMode = marginMode;
                event.trade.availableCapitalBefore = activeCapital;
                event.trade.totalCapitalBefore = totalCapital;

                let actualMargin = Math.min(requestedMargin, activeCapital - entryFee);
                activeCapital -= (actualMargin + entryFee);
                totalCapital -= entryFee;

                event.trade.marginUsed = actualMargin;
                event.trade.marginPercent = (actualMargin / totalCapital) * 100;
                event.trade.leverage = defaultLeverage;
                event.trade.entryFee = entryFee;
            } else if (event.type === 'CLOSE') {
                if (event.trade.skipped) continue;

                const margin = event.trade.marginUsed;
                const exitFee = (margin * defaultLeverage) * takerFeeRate;

                const entrySlippage = event.trade.type === 'LONG' ? (1 + slippageRate) : (1 - slippageRate);
                const effectiveEntry = event.trade.entry * entrySlippage;

                const exitSlippage = event.trade.type === 'LONG' ? (1 - slippageRate) : (1 + slippageRate);
                const effectiveClose = event.trade.closePrice * exitSlippage;

                let pnlMultiplier = 0;
                if (event.trade.type === 'LONG') {
                    pnlMultiplier = ((effectiveClose - effectiveEntry) / effectiveEntry) * defaultLeverage;
                } else {
                    pnlMultiplier = ((effectiveEntry - effectiveClose) / effectiveEntry) * defaultLeverage;
                }

                let pnlUSDT = margin * pnlMultiplier - exitFee;

                if (event.trade.marginMode === 'ISOLATED' && pnlUSDT < -margin) {
                    pnlUSDT = -margin;
                } else if (event.trade.marginMode === 'CROSS') {
                    const maintenanceMargin = (margin * defaultLeverage) * 0.05;
                    if (totalCapital + pnlUSDT <= maintenanceMargin) {
                        pnlUSDT = -totalCapital;
                    }
                }

                activeCapital += (margin + pnlUSDT);
                totalCapital += pnlUSDT;

                if (totalCapital <= 0) {
                    totalCapital = 0;
                    activeCapital = 0;
                }

                if (totalCapital > peakCapital) {
                    peakCapital = totalCapital;
                }
                const currentDrawdown = peakCapital > 0 ? (((peakCapital - totalCapital) / peakCapital) * 100) : 0;
                if (currentDrawdown > maxDrawdown) {
                    maxDrawdown = currentDrawdown;
                }

                event.trade.pnlUSDT = pnlUSDT;
                event.trade.pnlPercent = (pnlUSDT / margin) * 100;
                event.trade.availableCapitalAfter = activeCapital;
                event.trade.totalCapitalAfter = totalCapital;
            }
        }

        stats.total -= skippedTrades;

        const validTrades = completedTrades.filter(t => !t.skipped);
        let totalPnlPercentWin = 0;
        let totalPnlPercentLoss = 0;
        let winCount = 0;
        let lossCount = 0;

        for (const t of validTrades) {
            if (t.status === 'WIN' && t.pnlPercent !== undefined) {
                totalPnlPercentWin += t.pnlPercent;
                winCount++;
            } else if (t.status === 'LOSS' && t.pnlPercent !== undefined) {
                totalPnlPercentLoss += t.pnlPercent;
                lossCount++;
            }
        }

        const avgWinPercent = winCount > 0 ? (totalPnlPercentWin / winCount) : 0;
        const avgLossPercent = lossCount > 0 ? (totalPnlPercentLoss / lossCount) : 0;

        const totalClosed = stats.total - stats.open;
        const totalWins = stats.longWins + stats.shortWins;
        const totalLosses = stats.longLosses + stats.shortLosses;
        const winRate = totalClosed > 0 ? (totalWins / totalClosed) * 100 : 0;
        const roi = ((totalCapital - initialCapital) / initialCapital) * 100;
        const netProfit = totalCapital - initialCapital;

        const reportText = `🎯 **تقرير الاختبار الرجعي لقناص الصفقات (${engine.displayName})** 🎯
━━━━━━━━━━━━━━
🪙 العملة: **${symbol}**
⚙️ المحرك: **${engine.displayName}**
📅 مدة الاختبار: **أخر ${options.days} أيام**
⏳ فاصل التحليل: **كل ${options.stepMinutes} دقيقة**

💼 **الأداء المالي (المحاكاة):**
رأس المال الابتدائي: **${initialCapital.toFixed(2)} USDT**
رأس المال النهائي: **${totalCapital.toFixed(2)} USDT**
صافي الربح/الخسارة: **${netProfit >= 0 ? '+' : ''}${netProfit.toFixed(2)} USDT**
نسبة نمو الحساب (ROI): **${roi >= 0 ? '+' : ''}${roi.toFixed(2)}%**
أقصى تراجع (Max Drawdown): **${maxDrawdown.toFixed(2)}%**
متوسط نسبة الربح للصفقة: **+${avgWinPercent.toFixed(2)}%**
متوسط نسبة الخسارة للصفقة: **${avgLossPercent.toFixed(2)}%**
حجم الدخول للصفقة (Margin): **${riskPercentage}% من الرصيد المتوفر**
الرافعة المالية المفترضة: **${defaultLeverage}x**
وضع الهامش: **${marginMode === 'CROSS' ? 'متبادل (Cross)' : 'معزول (Isolated)'}**

🔢 **إحصائيات الصفقات للقناص:**
إجمالي الفرص المكتشفة: **${totalSnipedOpportunities}**
إجمالي الإشارات المنفذة: **${stats.total}**
تم تجاهلها (رصيد غير كافٍ): **${skippedTrades}**

🟢 **صفقات LONG:**
🏆 أهداف (TP): **${stats.longWins}** | ❌ استوب (SL): **${stats.longLosses}**

🔴 **صفقات SHORT:**
🏆 أهداف (TP): **${stats.shortWins}** | ❌ استوب (SL): **${stats.shortLosses}**

🕒 **صفقات مفتوحة:** **${stats.open}**
🎯 **نسبة نجاح الصفقات المغلقة:** **${winRate.toFixed(1)}%**
━━━━━━━━━━━━━━
*💡 تم الاختبار عبر محاكاة الزمن خطوة بخطوة مع تخصيص واقعي لرأس المال وتتبع دقيق للمارجن المحجوز لضمان واقعية النتائج.*
        `;

        return {
            reportText,
            trades: completedTrades
        };
    }
}
