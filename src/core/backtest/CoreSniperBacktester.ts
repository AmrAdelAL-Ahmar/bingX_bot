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
        const startTime = now - (options.days * 24 * 60 * 60 * 1000);
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

                    const tfLabels = ['1m', '3m', '5m', '15m', '30m', '1h', '4h', '1d'];

                    for (const tf of tfLabels) {
                        const d = allTimeframes[tf];
                        if (!d) continue;
                        ctx[`${tf}_RSI`]           = d.rsi?.toFixed(2) ?? '';
                        ctx[`${tf}_Trend`]         = d.structure ?? '';
                        ctx[`${tf}_ATR`]           = d.atr?.toFixed(4) ?? '';
                        ctx[`${tf}_MACD`]          = d.indicators?.macd?.macd?.toFixed(4) ?? '';
                        ctx[`${tf}_MACD_Sig`]      = d.indicators?.macd?.signal?.toFixed(4) ?? '';
                        ctx[`${tf}_MACD_Hist`]     = d.indicators?.macd?.histogram?.toFixed(4) ?? '';
                        ctx[`${tf}_BB_Up`]         = d.indicators?.bb?.upper?.toFixed(4) ?? '';
                        ctx[`${tf}_BB_Low`]        = d.indicators?.bb?.lower?.toFixed(4) ?? '';
                        ctx[`${tf}_StochRSI`]      = d.indicators?.stochRsi?.toString() ?? '';
                        ctx[`${tf}_CCI`]           = d.indicators?.cci?.toFixed(2) ?? '';
                        ctx[`${tf}_WilliamsR`]     = d.indicators?.williamsR?.toFixed(2) ?? '';
                        ctx[`${tf}_Pivot`]         = d.levels?.pivot?.toFixed(4) ?? '';
                        ctx[`${tf}_R1`]            = d.levels?.r1?.toFixed(4) ?? '';
                        ctx[`${tf}_S1`]            = d.levels?.s1?.toFixed(4) ?? '';
                        ctx[`${tf}_Fib382`]        = d.levels?.fib382?.toFixed(4) ?? '';
                        ctx[`${tf}_Fib618`]        = d.levels?.fib618?.toFixed(4) ?? '';
                        ctx[`${tf}_SwingHigh`]     = d.levels?.lastSwingHigh?.toFixed(4) ?? '';
                        ctx[`${tf}_SwingLow`]      = d.levels?.lastSwingLow?.toFixed(4) ?? '';
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

        // Compile results
        let wins = 0;
        let losses = 0;
        let openCount = 0;
        let totalPnl = 0;

        completedTrades.forEach(tr => {
            if (tr.status === 'WIN') wins++;
            else if (tr.status === 'LOSS') losses++;
            else openCount++;
            totalPnl += tr.pnlPercentage;
        });

        const winRate = (wins + losses) > 0 ? (wins / (wins + losses)) * 100 : 0;

        const reportText = `🎯 *تقرير الاختبار الرجعي لقناص الصفقات (${engine.displayName})*

📊 *الخلاصة والأداء العام:*
• المحرك: \`${engine.displayName}\`
• الزوج: \`${symbol}\`
• المدة: \`آخر ${options.days} أيام\`
• فاصل التحليل: \`كل ${options.stepMinutes} دقيقة\`

━━━━━━━━━━━━━━━━━━━━━━

📈 *إحصائيات الأداء:*
• **عدد الفرص التي تم قنصها:** \`${totalSnipedOpportunities}\`
• **عدد الفرص التي تم الدخول فيها:** \`${totalEnteredTrades}\`
• **🏆 الصفقات الناجحة (TP Hit):** \`${wins}\`
• **❌ الصفقات الخاسرة (SL Hit):** \`${losses}\`
• **⏳ صفقات معلقة/مفتوحة:** \`${openCount}\`
• **🎯 نسبة النجاح الفعالة (Win Rate):** \`${winRate.toFixed(1)}%\`
• **💰 إجمالي العائد (برافعة 10x):** \`${totalPnl >= 0 ? '+' : ''}${totalPnl.toFixed(2)}%\`

━━━━━━━━━━━━━━━━━━━━━━
*💡 تم إرسال ملف الـ CSV المرفق بجميع تفاصيل صفقات الدخول والخروج لدراستها.*`;

        return {
            reportText,
            trades: completedTrades
        };
    }
}
