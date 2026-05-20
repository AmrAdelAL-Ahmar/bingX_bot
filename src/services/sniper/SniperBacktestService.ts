import logger from '../../utils/logger';
import { BingXService } from '../BingXService';
import { TechnicalAnalyzer, MATRIX_TFS } from '../TechnicalAnalyzer';
import { MTFDataBuilder } from '../MTFDataBuilder';
import { OHLCV, AnalysisDetails } from '../AnalysisService';
import { getSniperEngine } from './SniperRegistry';

export interface SniperBacktestOptions {
    days: number;
    stepMinutes: number;
    cooldownHours?: number;
}

export interface SniperBacktestResult {
    reportText: string;
    trades: any[];
}

export class SniperBacktestService {
    private bingxService: BingXService;

    constructor(bingxService: BingXService) {
        this.bingxService = bingxService;
    }

    async runSniperBacktest(
        symbol: string,
        engineId: string,
        options: SniperBacktestOptions
    ): Promise<SniperBacktestResult> {
        const engine = getSniperEngine(engineId);
        if (!engine) {
            throw new Error(`Engine ${engineId} not found in registry!`);
        }

        const now = Date.now();
        const startTime = now - (options.days * 24 * 60 * 60 * 1000);
        const cooldownHours = options.cooldownHours ?? 2;

        logger.info(`Starting Sniper Backtest for engine: ${engineId}, symbol: ${symbol}, days: ${options.days}`);

        // 1. Fetch deep historical data for all required timeframes once
        const allData: Record<string, OHLCV[]> = {};
        const tfsToFetch = [...new Set([...MATRIX_TFS, ...engine.requiredTFs])];

        for (const tf of tfsToFetch) {
            let fetchDays = options.days;
            if (tf === '1d') fetchDays += 200;
            else if (tf === '4h') fetchDays += 35;
            else if (tf === '1h') fetchDays += 10;
            else fetchDays += 3;

            allData[tf] = await this.bingxService.fetchDeepHistoricalData(symbol, tf, fetchDays);
        }

        const evaluationTF = '5m';
        const evalData = allData[evaluationTF] || allData['15m'];
        if (!evalData || evalData.length === 0) {
            throw new Error("Evaluation data (5m/15m) not available!");
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

        // Loop through time step-by-step
        for (let t = startTime; t <= now; t += stepMs) {
            // Build MTF snapshot at timestamp `t` without lookahead bias
            const mtfSnapshot: Record<string, OHLCV[]> = {};
            let hasEnoughData = true;

            for (const tf of tfsToFetch) {
                const tfMs = MTFDataBuilder.tfToMs(tf);
                const dataUpToT = allData[tf].filter(c => c.timestamp + tfMs <= t);
                mtfSnapshot[tf] = dataUpToT;

                if (dataUpToT.length < 15) {
                    hasEnoughData = false;
                }
            }

            if (!hasEnoughData) continue;

            // Get current price at timestamp `t`
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

                    // ─── Build full analysis context (سبب اتخاذ القرار) ────────────
                    const ctx: Record<string, any> = {
                        confidence: report.confidence,
                        winRate: report.winRate,
                        matrixScore: TechnicalAnalyzer.calculateMatrix(allTimeframes).percentage,
                        completedConditions: report.completedConditions.join(' | '),
                        pendingConditions: report.pendingConditions.join(' | '),
                        summary: report.summary,
                    };

                    // Per-timeframe technical snapshot
                    const tfLabels: Record<string, string> = {
                        '1m': '1m', '3m': '3m', '5m': '5m', '15m': '15m',
                        '30m': '30m', '1h': '1h', '4h': '4h', '1d': '1d'
                    };

                    for (const [tf, label] of Object.entries(tfLabels)) {
                        const d = allTimeframes[tf];
                        if (!d) continue;
                        ctx[`${label}_RSI`]           = d.rsi?.toFixed(2) ?? '';
                        ctx[`${label}_Trend`]         = d.structure ?? '';
                        ctx[`${label}_ATR`]           = d.atr?.toFixed(4) ?? '';
                        ctx[`${label}_MACD`]          = d.indicators?.macd?.macd?.toFixed(4) ?? '';
                        ctx[`${label}_MACD_Sig`]      = d.indicators?.macd?.signal?.toFixed(4) ?? '';
                        ctx[`${label}_MACD_Hist`]     = d.indicators?.macd?.histogram?.toFixed(4) ?? '';
                        ctx[`${label}_BB_Up`]         = d.indicators?.bb?.upper?.toFixed(4) ?? '';
                        ctx[`${label}_BB_Low`]        = d.indicators?.bb?.lower?.toFixed(4) ?? '';
                        ctx[`${label}_StochRSI`]      = d.indicators?.stochRsi?.toString() ?? '';
                        ctx[`${label}_CCI`]           = d.indicators?.cci?.toFixed(2) ?? '';
                        ctx[`${label}_WilliamsR`]     = d.indicators?.williamsR?.toFixed(2) ?? '';
                        ctx[`${label}_Pivot`]         = d.levels?.pivot?.toFixed(4) ?? '';
                        ctx[`${label}_R1`]            = d.levels?.r1?.toFixed(4) ?? '';
                        ctx[`${label}_S1`]            = d.levels?.s1?.toFixed(4) ?? '';
                        ctx[`${label}_Fib382`]        = d.levels?.fib382?.toFixed(4) ?? '';
                        ctx[`${label}_Fib618`]        = d.levels?.fib618?.toFixed(4) ?? '';
                        ctx[`${label}_SwingHigh`]     = d.levels?.lastSwingHigh?.toFixed(4) ?? '';
                        ctx[`${label}_SwingLow`]      = d.levels?.lastSwingLow?.toFixed(4) ?? '';
                    }

                    currentTrade = {
                        type: report.direction as 'LONG' | 'SHORT',
                        entryPrice: report.entry,
                        sl: report.sl,
                        tp: report.tp,
                        tp2: report.tp2,
                        entryTime: t,
                        entryDate: dateStr,
                        engineId: engineId,
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

        const reportText = `🎯 *تقرير الاختبار الرجعي لقناص الصفقات (${engineId})*

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
