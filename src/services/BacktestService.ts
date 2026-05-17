import logger from '../utils/logger';
import { BingXService } from './BingXService';
import { AnalysisService, OHLCV, AnalysisDetails } from './AnalysisService';
import { TechnicalAnalyzer, MATRIX_TFS } from './TechnicalAnalyzer';
import { MTFDataBuilder } from './MTFDataBuilder';
import { ITradingEngine } from './engines/ITradingEngine';
import { V1Engine } from './engines/V1Engine';
import { V2Engine } from './engines/V2Engine';
import { V3Engine } from './engines/V3Engine';
import { V4Engine } from './engines/V4Engine';
import { V5Engine } from './engines/V5Engine';
import { V6Engine } from './engines/V6Engine';

export interface BacktestResult {
    reportText: string;
    trades: any[]; // Save detailed trades for future analysis
}

export class BacktestService {
    private engines: Record<string, ITradingEngine> = {
        'V1': new V1Engine(),
        'V2': new V2Engine(),
        'V3': new V3Engine(),
        'V4': new V4Engine(),
        'V5': new V5Engine(),
        'V6': new V6Engine()
    };

    constructor(
        private bingxService: BingXService,
        private analysisService: AnalysisService
    ) { }

    async runAdvancedBacktest(symbol: string, version: string, options: { quickTF: string, longTF: string, days: number, stepMinutes: number, mode: 'SCALP' | 'SWING', initialCapital?: number, marginPerTradePercentage?: number, marginMode?: string, leverage?: number, riskSizingEnabled?: boolean, maxSlCapEnabled?: boolean, maxSlPercentage?: number, fullReportEnabled?: boolean }): Promise<BacktestResult> {
        logger.info(`Running Time-Step Backtest for ${symbol} on ${version} over ${options.days} days with step ${options.stepMinutes}m (Mode: ${options.mode})`);

        const stepMs = options.stepMinutes * 60 * 1000;
        const now = Date.now();
        const startTime = now - (options.days * 24 * 60 * 60 * 1000);

        // 1. Fetch deep historical data for ALL required timeframes once
        logger.info(`Fetching deep historical data for multiple timeframes...`);
        const allData: Record<string, OHLCV[]> = {};
        for (const tf of MATRIX_TFS) {
            // We fetch extra days to guarantee AT LEAST 200 candles for indicators (Warmup Phase)
            let fetchDays = options.days;
            if (tf === '1d') fetchDays += 200; // 200 days = 200 candles
            else if (tf === '4h') fetchDays += 35; // 35 days * 6 = 210 candles
            else if (tf === '1h') fetchDays += 10; // 10 days * 24 = 240 candles
            else fetchDays += 3; // For 5m/15m/30m, 3 days gives > 140-800 candles
            allData[tf] = await this.bingxService.fetchDeepHistoricalData(symbol, tf, fetchDays);
        }

        const engine = this.engines[version] || this.engines['V1'];
        const generatedTrades: any[] = [];

        // 2. Pass 1: Generate Trades (Time-Step Simulation)
        logger.info(`Starting Pass 1: Generating trades by stepping through time...`);
        for (let t = startTime; t <= now; t += stepMs) {

            // Build the MTF snapshot exactly as it looked at timestamp `t`
            const mtfSnapshot: Record<string, OHLCV[]> = {};
            let hasEnoughData = true;

            for (const tf of MATRIX_TFS) {
                // To prevent Look-Ahead Bias, we MUST only include candles that have FULLY CLOSED.
                // A candle is fully closed if its (open time + timeframe duration) <= current timestamp t.
                const tfMs = MTFDataBuilder.tfToMs(tf);
                const dataUpToT = allData[tf].filter(c => c.timestamp + tfMs <= t);
                mtfSnapshot[tf] = dataUpToT;

                // We need enough candles. 1d and 4h have more history fetched now.
                // 14 candles is the minimum for RSI
                if (dataUpToT.length < 15) {
                    hasEnoughData = false;
                }
            }

            if (!hasEnoughData) continue;

            const currentPrice = mtfSnapshot[options.quickTF][mtfSnapshot[options.quickTF].length - 1].close;
            const dailyOHLCV = mtfSnapshot['1d'] || mtfSnapshot['4h'] || mtfSnapshot[options.quickTF];
            const vwap = dailyOHLCV.length > 0 ? TechnicalAnalyzer.calculateVWAP(dailyOHLCV) : currentPrice;

            const allTimeframes: Record<string, AnalysisDetails> = {};
            MATRIX_TFS.forEach(tf => {
                if (mtfSnapshot[tf] && mtfSnapshot[tf].length > 15) {
                    allTimeframes[tf] = TechnicalAnalyzer.calculateTechnicalData(mtfSnapshot[tf], tf, vwap);
                }
            });

            if (!allTimeframes[options.quickTF]) continue;

            const result = engine.analyze(currentPrice, vwap, allTimeframes, mtfSnapshot, { quickTF: options.quickTF, longTF: options.longTF });

            let signal: any = { type: 'NONE', tp: 0, sl: 0 };
            if (options.mode === 'SCALP') {
                signal = result.scalp;
            } else if (options.mode === 'SWING') {
                signal = result.swing;
            }

            if (signal.type !== 'NONE') {
                // Add robust date formatting for the report and records
                const entryDateObj = new Date(t);
                const entryDateFormatted = `${entryDateObj.getFullYear()}-${String(entryDateObj.getMonth() + 1).padStart(2, '0')}-${String(entryDateObj.getDate()).padStart(2, '0')} ${String(entryDateObj.getHours()).padStart(2, '0')}:${String(entryDateObj.getMinutes()).padStart(2, '0')}`;

                generatedTrades.push({
                    type: signal.type,
                    mode: options.mode, // Record if it was scalp or swing
                    entry: currentPrice,
                    tp: signal.tp,
                    sl: signal.sl,
                    signalReason: signal.signalReason || 'N/A', // Add signal reason here
                    entryTime: t, // raw ms timestamp
                    entryDate: entryDateFormatted, // Human readable date
                    status: 'OPEN', // Will be evaluated in pass 2
                    durationMinutes: 0,
                    analysisContext: {
                        matrixScore: result.matrix.percentage,
                        candles_quick: mtfSnapshot[options.quickTF]?.length,
                        candles_long: mtfSnapshot[options.longTF]?.length,

                        quick_rsi: allTimeframes[options.quickTF]?.rsi,
                        quick_macd: allTimeframes[options.quickTF]?.indicators?.macd?.macd,
                        quick_macd_sig: allTimeframes[options.quickTF]?.indicators?.macd?.signal,
                        quick_macd_hist: allTimeframes[options.quickTF]?.indicators?.macd?.histogram,
                        quick_bb_up: allTimeframes[options.quickTF]?.indicators?.bb?.upper,
                        quick_bb_low: allTimeframes[options.quickTF]?.indicators?.bb?.lower,
                        quick_stochRsi: allTimeframes[options.quickTF]?.indicators?.stochRsi,
                        quick_cci: allTimeframes[options.quickTF]?.indicators?.cci,
                        quick_williamsR: allTimeframes[options.quickTF]?.indicators?.williamsR,
                        quick_atr: allTimeframes[options.quickTF]?.atr,
                        quick_trend: allTimeframes[options.quickTF]?.structure || 'UNKNOWN',

                        // Quick TF Levels
                        quick_pivot: allTimeframes[options.quickTF]?.levels?.pivot,
                        quick_r1: allTimeframes[options.quickTF]?.levels?.r1,
                        quick_s1: allTimeframes[options.quickTF]?.levels?.s1,
                        quick_fib382: allTimeframes[options.quickTF]?.levels?.fib382,
                        quick_fib618: allTimeframes[options.quickTF]?.levels?.fib618,
                        quick_lastSwingHigh: allTimeframes[options.quickTF]?.levels?.lastSwingHigh,
                        quick_lastSwingLow: allTimeframes[options.quickTF]?.levels?.lastSwingLow,

                        long_rsi: allTimeframes[options.longTF]?.rsi,
                        long_macd: allTimeframes[options.longTF]?.indicators?.macd?.macd,
                        long_macd_hist: allTimeframes[options.longTF]?.indicators?.macd?.histogram,
                        long_trend: allTimeframes[options.longTF]?.structure || 'UNKNOWN',

                        // Long TF Levels
                        long_pivot: allTimeframes[options.longTF]?.levels?.pivot,
                        long_r1: allTimeframes[options.longTF]?.levels?.r1,
                        long_s1: allTimeframes[options.longTF]?.levels?.s1,
                        long_fib382: allTimeframes[options.longTF]?.levels?.fib382,
                        long_fib618: allTimeframes[options.longTF]?.levels?.fib618,
                        long_lastSwingHigh: allTimeframes[options.longTF]?.levels?.lastSwingHigh,
                        long_lastSwingLow: allTimeframes[options.longTF]?.levels?.lastSwingLow,
                        // Extra MTF Context (if available)
                        tf5m_rsi: allTimeframes['5m']?.rsi,
                        tf5m_trend: allTimeframes['5m']?.structure || 'UNKNOWN',
                        tf5m_pivot: allTimeframes['5m']?.levels?.pivot,
                        tf5m_r1: allTimeframes['5m']?.levels?.r1,
                        tf5m_s1: allTimeframes['5m']?.levels?.s1,
                        tf5m_fib382: allTimeframes['5m']?.levels?.fib382,
                        tf5m_fib618: allTimeframes['5m']?.levels?.fib618,
                        tf5m_lastSwingHigh: allTimeframes['5m']?.levels?.lastSwingHigh,
                        tf5m_lastSwingLow: allTimeframes['5m']?.levels?.lastSwingLow,

                        tf15m_rsi: allTimeframes['15m']?.rsi,
                        tf15m_trend: allTimeframes['15m']?.structure || 'UNKNOWN',
                        tf15m_pivot: allTimeframes['15m']?.levels?.pivot,
                        tf15m_r1: allTimeframes['15m']?.levels?.r1,
                        tf15m_s1: allTimeframes['15m']?.levels?.s1,
                        tf15m_fib382: allTimeframes['15m']?.levels?.fib382,
                        tf15m_fib618: allTimeframes['15m']?.levels?.fib618,
                        tf15m_lastSwingHigh: allTimeframes['15m']?.levels?.lastSwingHigh,
                        tf15m_lastSwingLow: allTimeframes['15m']?.levels?.lastSwingLow,

                        tf30m_rsi: allTimeframes['30m']?.rsi,
                        tf30m_trend: allTimeframes['30m']?.structure || 'UNKNOWN',
                        tf30m_pivot: allTimeframes['30m']?.levels?.pivot,
                        tf30m_r1: allTimeframes['30m']?.levels?.r1,
                        tf30m_s1: allTimeframes['30m']?.levels?.s1,
                        tf30m_fib382: allTimeframes['30m']?.levels?.fib382,
                        tf30m_fib618: allTimeframes['30m']?.levels?.fib618,
                        tf30m_lastSwingHigh: allTimeframes['30m']?.levels?.lastSwingHigh,
                        tf30m_lastSwingLow: allTimeframes['30m']?.levels?.lastSwingLow,

                        tf1h_rsi: allTimeframes['1h']?.rsi,
                        tf1h_trend: allTimeframes['1h']?.structure || 'UNKNOWN',
                        tf1h_pivot: allTimeframes['1h']?.levels?.pivot,
                        tf1h_r1: allTimeframes['1h']?.levels?.r1,
                        tf1h_s1: allTimeframes['1h']?.levels?.s1,
                        tf1h_fib382: allTimeframes['1h']?.levels?.fib382,
                        tf1h_fib618: allTimeframes['1h']?.levels?.fib618,
                        tf1h_lastSwingHigh: allTimeframes['1h']?.levels?.lastSwingHigh,
                        tf1h_lastSwingLow: allTimeframes['1h']?.levels?.lastSwingLow,
                        tf4h_rsi: allTimeframes['4h']?.rsi,
                        tf4h_trend: allTimeframes['4h']?.structure || 'UNKNOWN',
                        tf4h_pivot: allTimeframes['4h']?.levels?.pivot,
                        tf4h_r1: allTimeframes['4h']?.levels?.r1,
                        tf4h_s1: allTimeframes['4h']?.levels?.s1,
                        tf4h_fib382: allTimeframes['4h']?.levels?.fib382,
                        tf4h_fib618: allTimeframes['4h']?.levels?.fib618,
                        tf4h_lastSwingHigh: allTimeframes['4h']?.levels?.lastSwingHigh,
                        tf4h_lastSwingLow: allTimeframes['4h']?.levels?.lastSwingLow,

                        tf1d_rsi: allTimeframes['1d']?.rsi,
                        tf1d_trend: allTimeframes['1d']?.structure || 'UNKNOWN',
                        tf1d_pivot: allTimeframes['1d']?.levels?.pivot,
                        tf1d_r1: allTimeframes['1d']?.levels?.r1,
                        tf1d_s1: allTimeframes['1d']?.levels?.s1,
                        tf1d_fib382: allTimeframes['1d']?.levels?.fib382,
                        tf1d_fib618: allTimeframes['1d']?.levels?.fib618,
                        tf1d_lastSwingHigh: allTimeframes['1d']?.levels?.lastSwingHigh,
                        tf1d_lastSwingLow: allTimeframes['1d']?.levels?.lastSwingLow
                    }
                });
            }
        }

        // 3. Pass 2: Evaluate Trades against 5m data
        logger.info(`Starting Pass 2: Evaluating ${generatedTrades.length} generated trades...`);
        const evaluationTF = '5m';
        const evalData = allData[evaluationTF]; // Use the fine-grained 5m data to check TP/SL

        let stats = {
            total: generatedTrades.length,
            longWins: 0, longLosses: 0,
            shortWins: 0, shortLosses: 0,
            open: 0
        };

        for (const trade of generatedTrades) {
            // Find all 5m candles that occurred AT OR AFTER the trade entry time
            // Because trade entry happens at `t`, the candle opening exactly at `t` contains the immediate price action!
            const futureCandles = evalData.filter(c => c.timestamp >= trade.entryTime);

            let closed = false;
            let durationCandles = 0;

            for (const candle of futureCandles) {
                durationCandles++;

                if (trade.type === 'LONG') {
                    if (candle.high >= trade.tp) {
                        trade.status = 'WIN';
                        trade.closePrice = trade.tp;
                        trade.closeTime = candle.timestamp;
                        stats.longWins++;
                        closed = true;
                        break;
                    } else if (candle.low <= trade.sl) {
                        trade.status = 'LOSS';
                        trade.closePrice = trade.sl;
                        trade.closeTime = candle.timestamp;
                        stats.longLosses++;
                        closed = true;
                        break;
                    }
                } else if (trade.type === 'SHORT') {
                    if (candle.low <= trade.tp) {
                        trade.status = 'WIN';
                        trade.closePrice = trade.tp;
                        trade.closeTime = candle.timestamp;
                        stats.shortWins++;
                        closed = true;
                        break;
                    } else if (candle.high >= trade.sl) {
                        trade.status = 'LOSS';
                        trade.closePrice = trade.sl;
                        trade.closeTime = candle.timestamp;
                        stats.shortLosses++;
                        closed = true;
                        break;
                    }
                }
            }

            // Calculate duration in minutes based on 5m candles
            trade.durationMinutes = durationCandles * 5;

            // Format close date if closed
            if (closed && trade.closeTime) {
                const closeDateObj = new Date(trade.closeTime);
                trade.closeDate = `${closeDateObj.getFullYear()}-${String(closeDateObj.getMonth() + 1).padStart(2, '0')}-${String(closeDateObj.getDate()).padStart(2, '0')} ${String(closeDateObj.getHours()).padStart(2, '0')}:${String(closeDateObj.getMinutes()).padStart(2, '0')}`;
            } else {
                trade.status = 'OPEN';
                trade.closeDate = 'N/A';
                stats.open++;
            }
        }

        // 4. Pass 3: Realistic Capital Simulation
        let initialCapital = options.initialCapital || 1000;
        let activeCapital = initialCapital; // Liquid balance
        let totalCapital = initialCapital; // Final account size (includes locked margin)
        const riskPercentage = options.marginPerTradePercentage || 3;
        const marginMode = options.marginMode || 'ISOLATED';
        const defaultLeverage = options.leverage || 10;
        const riskSizingEnabled = options.riskSizingEnabled || false;
        const maxSlCapEnabled = options.maxSlCapEnabled || false;
        const maxSlPercentage = options.maxSlPercentage || 5;

        let peakCapital = totalCapital;
        let maxDrawdown = 0;
        let skippedTrades = 0;

        // Create chronological events for concurrent capital simulation
        const events: { type: 'OPEN' | 'CLOSE', time: number, trade: any }[] = [];
        for (const trade of generatedTrades) {
            events.push({ type: 'OPEN', time: trade.entryTime, trade });
            if (trade.closeTime) {
                events.push({ type: 'CLOSE', time: trade.closeTime, trade });
            }
        }

        // Sort chronologically
        events.sort((a, b) => a.time - b.time);

        for (const event of events) {
            if (event.type === 'OPEN') {
                let slDistancePercentage = 0;
                if (event.trade.entry && event.trade.sl) {
                    slDistancePercentage = Math.abs(event.trade.entry - event.trade.sl) / event.trade.entry * 100;
                }

                // --- BUTTON 1: Fixed Entry Sizing ---
                // Always enter with riskPercentage% of total capital as margin.
                // Simple and fixed — has nothing to do with SL distance.
                let requestedMargin = totalCapital * (riskPercentage / 100);

                // --- BUTTON 2: Max SL Loss Cap (independent safety check) ---
                // After fixing the margin, check if the potential SL loss exceeds the cap.
                // If so, proportionally reduce the margin until potential loss == cap.
                if (maxSlCapEnabled && slDistancePercentage > 0) {
                    const potentialLossAmount = requestedMargin * defaultLeverage * (slDistancePercentage / 100);
                    const maxAllowedLoss = totalCapital * (maxSlPercentage / 100);
                    if (potentialLossAmount > maxAllowedLoss) {
                        // Reduce margin so that: margin * leverage * slDist% == maxAllowedLoss
                        requestedMargin = maxAllowedLoss / (defaultLeverage * (slDistancePercentage / 100));
                    }
                }

                let shouldSkip = false;
                if (activeCapital < 5) {
                    shouldSkip = true;
                }

                // If we don't have enough available capital, scale it down or skip.
                if (shouldSkip) { // Minimum 5 USDT to trade
                    event.trade.skipped = true;
                    event.trade.skipReason = 'Insufficient Margin';
                    skippedTrades++;

                    // Undo stats contribution
                    if (event.trade.status === 'WIN') {
                        if (event.trade.type === 'LONG') stats.longWins--;
                        if (event.trade.type === 'SHORT') stats.shortWins--;
                    } else if (event.trade.status === 'LOSS') {
                        if (event.trade.type === 'LONG') stats.longLosses--;
                        if (event.trade.type === 'SHORT') stats.shortLosses--;
                    } else if (event.trade.status === 'OPEN') {
                        stats.open--;
                    }
                    continue;
                }

                event.trade.marginMode = marginMode;
                event.trade.availableCapitalBefore = activeCapital;
                event.trade.totalCapitalBefore = totalCapital;

                let actualMargin = Math.min(requestedMargin, activeCapital);
                activeCapital -= actualMargin;

                event.trade.marginUsed = actualMargin;
                event.trade.marginPercent = (actualMargin / totalCapital) * 100;
                event.trade.leverage = defaultLeverage;
            } else if (event.type === 'CLOSE') {
                if (event.trade.skipped) continue; // It was never opened

                const margin = event.trade.marginUsed;
                let pnlMultiplier = 0;

                if (event.trade.type === 'LONG') {
                    pnlMultiplier = ((event.trade.closePrice - event.trade.entry) / event.trade.entry) * defaultLeverage;
                } else {
                    pnlMultiplier = ((event.trade.entry - event.trade.closePrice) / event.trade.entry) * defaultLeverage;
                }

                let pnlUSDT = margin * pnlMultiplier;

                // In ISOLATED mode, maximum loss is restricted to the margin used (Liquidation)
                if (event.trade.marginMode === 'ISOLATED' && pnlUSDT < -margin) {
                    pnlUSDT = -margin;
                }

                const pnlPercent = (pnlUSDT / margin) * 100;

                // Free up the margin + PnL
                activeCapital += (margin + pnlUSDT);
                totalCapital += pnlUSDT;

                if (totalCapital > peakCapital) {
                    peakCapital = totalCapital;
                }
                const currentDrawdown = ((peakCapital - totalCapital) / peakCapital) * 100;
                if (currentDrawdown > maxDrawdown) {
                    maxDrawdown = currentDrawdown;
                }

                event.trade.pnlUSDT = pnlUSDT;
                event.trade.pnlPercent = pnlPercent;
                event.trade.availableCapitalAfter = activeCapital;
                event.trade.totalCapitalAfter = totalCapital;
            }
        }

        // Adjust stats for skipped trades
        stats.total -= skippedTrades;

        // Calculate average percentages
        const validTrades = generatedTrades.filter(t => !t.skipped);
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
        const modeText = options.mode === 'SCALP' ? 'سكالبينج ⚡️' : 'سوينج 🌊';
        const roi = ((totalCapital - initialCapital) / initialCapital) * 100;
        const netProfit = totalCapital - initialCapital;

        const reportText = `
📊 **تقرير الاختبار الرجعي الشامل مع محاكاة رأس المال** 📊
━━━━━━━━━━━━━━
🪙 العملة: **${symbol}**
⚙️ الإصدار: **${version}**
نوع الاختبار: **${modeText}**
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

🔢 **إحصائيات الصفقات:**
إجمالي الإشارات المنفذة: **${stats.total}**
تم تجاهلها (رصيد غير كافٍ): **${skippedTrades}**

🟢 **صفقات LONG:**
🏆 أهداف (TP): **${stats.longWins}** | ❌ استوب (SL): **${stats.longLosses}**

🔴 **صفقات SHORT:**
🏆 أهداف (TP): **${stats.shortWins}** | ❌ استوب (SL): **${stats.shortLosses}**

🕒 **صفقات مفتوحة:** **${stats.open}**
🎯 **نسبة نجاح الصفقات المغلقة:** **${winRate.toFixed(1)}%**
━━━━━━━━━━━━━━
💡 *تم الاختبار عبر محاكاة الزمن خطوة بخطوة مع تخصيص واقعي لرأس المال وتتبع دقيق للمارجن المحجوز لضمان واقعية النتائج.*
        `;

        return { reportText, trades: generatedTrades };
    }


}
