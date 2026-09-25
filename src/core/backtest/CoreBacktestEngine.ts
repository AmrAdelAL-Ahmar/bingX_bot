import { OHLCV, AnalysisDetails } from '../shared/types';
import { TechnicalAnalyzer, MATRIX_TFS } from '../analysis/TechnicalAnalyzer';
import { ITradingEngine } from '../analysis/engines/ITradingEngine';
import { V1Engine } from '../analysis/engines/V1Engine';
import { V2Engine } from '../analysis/engines/V2Engine';
import { V3Engine } from '../analysis/engines/V3Engine';
import { V4Engine } from '../analysis/engines/V4Engine';
import { V5Engine } from '../analysis/engines/V5Engine';
import { V6Engine } from '../analysis/engines/V6Engine';
import { V7Engine } from '../analysis/engines/V7Engine';
import { V8Engine } from '../analysis/engines/V8Engine';
import { V9Engine } from '../analysis/engines/V9Engine';
import { V10Engine } from '../analysis/engines/V10Engine';
import { V11Engine } from '../analysis/engines/V11Engine';
import { V12Engine } from '../analysis/engines/V12Engine';
import { V13Engine } from '../analysis/engines/V13Engine';
import { V14Engine } from '../analysis/engines/V14Engine';
import { V15Engine } from '../analysis/engines/V15Engine';
import { V16Engine } from '../analysis/engines/V16Engine';
import { V17Engine } from '../analysis/engines/V17Engine';
import { V18Engine } from '../analysis/engines/V18Engine';
import { HarmonicMasterEngine } from '../analysis/engines/HarmonicMasterEngine';
import { MTFDataBuilder } from '../shared/MTFDataBuilder';

const ENGINES: Record<string, ITradingEngine> = {
    'V1': new V1Engine(),
    'V2': new V2Engine(),
    'V3': new V3Engine(),
    'V4': new V4Engine(),
    'V5': new V5Engine(),
    'V6': new V6Engine(),
    'V7': new V7Engine(),
    'V8': new V8Engine(),
    'V9': new V9Engine(),
    'V10': new V10Engine(),
    'V11': new V11Engine(),
    'V12': new V12Engine(),
    'V13': new V13Engine(),
    'V14': new V14Engine(),
    'V15': new V15Engine(),
    'V16': new V16Engine(),
    'V17': new V17Engine(),
    'V18': new V18Engine(),
    'HARMONIC': new HarmonicMasterEngine()
};

export interface BacktestOptions {
    quickTF: string;
    longTF: string;
    days: number;
    stepMinutes: number;
    mode: 'SCALP' | 'SWING';
    initialCapital?: number;
    marginPerTradePercentage?: number;
    marginMode?: string;
    leverage?: number;
    riskSizingEnabled?: boolean;
    maxSlCapEnabled?: boolean;
    maxSlPercentage?: number;
    alignToStartOfDay?: boolean;
    params?: Record<string, any>;
}

export interface BacktestSimulationResult {
    reportText: string;
    trades: any[];
}

export class CoreBacktestEngine {
    static runSimulation(
        symbol: string,
        version: string,
        allData: Record<string, OHLCV[]>,
        options: BacktestOptions
    ): BacktestSimulationResult {
        const stepMs = options.stepMinutes * 60 * 1000;
        const now = Date.now();
        let startTime = now - (options.days * 24 * 60 * 60 * 1000);
        if (options.alignToStartOfDay) {
            const startOfStartDay = new Date(startTime);
            startOfStartDay.setUTCHours(0, 0, 0, 0);
            startTime = startOfStartDay.getTime();
        }

        const engine = ENGINES[version] || ENGINES['V1'];
        const generatedTrades: any[] = [];

        // 1. Pass 1: Generate Trades (Time-Step Simulation)
        for (let t = startTime; t <= now; t += stepMs) {
            // Build the MTF snapshot exactly as it looked at timestamp `t`
            const mtfSnapshot: Record<string, OHLCV[]> = {};
            let hasEnoughData = true;

            for (const tf of MATRIX_TFS) {
                // To prevent Look-Ahead Bias, we MUST only include candles that have FULLY CLOSED.
                // A candle is fully closed if its (open time + timeframe duration) <= current timestamp t.
                if (!allData[tf]) {
                    hasEnoughData = false;
                    continue;
                }
                const tfMs = MTFDataBuilder.tfToMs(tf);
                const dataUpToT = allData[tf].filter(c => c.timestamp + tfMs <= t);
                mtfSnapshot[tf] = dataUpToT;

                // 14 candles is the minimum for RSI calculations
                if (dataUpToT.length < 15) {
                    hasEnoughData = false;
                }
            }

            if (!hasEnoughData) continue;

            const quickCandles = mtfSnapshot[options.quickTF];
            if (!quickCandles || quickCandles.length === 0) continue;

            const currentPrice = quickCandles[quickCandles.length - 1].close;
            const dailyOHLCV = mtfSnapshot['1d'] || mtfSnapshot['4h'] || quickCandles;
            const vwap = dailyOHLCV.length > 0 ? TechnicalAnalyzer.calculateVWAP(dailyOHLCV) : currentPrice;

            const allTimeframes: Record<string, AnalysisDetails> = {};
            MATRIX_TFS.forEach(tf => {
                if (mtfSnapshot[tf] && mtfSnapshot[tf].length > 15) {
                    allTimeframes[tf] = TechnicalAnalyzer.calculateTechnicalData(mtfSnapshot[tf], tf, vwap);
                }
            });

            if (!allTimeframes[options.quickTF]) continue;

            const result = engine.analyze(currentPrice, vwap, allTimeframes, mtfSnapshot, { 
                quickTF: options.quickTF, 
                longTF: options.longTF,
                params: options.params
            });

            let signal: any = { type: 'NONE', tp: 0, sl: 0 };
            if (options.mode === 'SCALP') {
                signal = result.scalp;
            } else if (options.mode === 'SWING') {
                signal = result.swing;
            }

            if (signal.type !== 'NONE') {
                const entryDateObj = new Date(t);
                const entryDateFormatted = `${entryDateObj.getFullYear()}-${String(entryDateObj.getMonth() + 1).padStart(2, '0')}-${String(entryDateObj.getDate()).padStart(2, '0')} ${String(entryDateObj.getHours()).padStart(2, '0')}:${String(entryDateObj.getMinutes()).padStart(2, '0')}`;

                generatedTrades.push({
                    type: signal.type,
                    mode: options.mode,
                    entry: currentPrice,
                    tp: signal.tp,
                    sl: signal.sl,
                    signalReason: signal.signalReason || 'N/A',
                    entryTime: t,
                    entryDate: entryDateFormatted,
                    status: 'OPEN',
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

                        long_pivot: allTimeframes[options.longTF]?.levels?.pivot,
                        long_r1: allTimeframes[options.longTF]?.levels?.r1,
                        long_s1: allTimeframes[options.longTF]?.levels?.s1,
                        long_fib382: allTimeframes[options.longTF]?.levels?.fib382,
                        long_fib618: allTimeframes[options.longTF]?.levels?.fib618,
                        long_lastSwingHigh: allTimeframes[options.longTF]?.levels?.lastSwingHigh,
                        long_lastSwingLow: allTimeframes[options.longTF]?.levels?.lastSwingLow,

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

        // 2. Pass 2: Evaluate Trades against 5m data (fallback to 15m)
        const evalTF = allData['5m'] ? '5m' : '15m';
        const evalTFMinutes = evalTF === '5m' ? 5 : 15;
        const evalData = allData[evalTF];
        if (!evalData || evalData.length === 0) {
            throw new Error("Evaluation candle data ('5m' or '15m') is required for simulation!");
        }

        let stats = {
            total: generatedTrades.length,
            longWins: 0, longLosses: 0,
            shortWins: 0, shortLosses: 0,
            open: 0
        };

        for (const trade of generatedTrades) {
            // Use >= to include the candle that opens exactly at entry time,
            // since Pass 1 uses fully-closed candles (openTime + tfMs <= t),
            // meaning the entry price is the close of the candle just before t.
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

            trade.durationMinutes = durationCandles * evalTFMinutes;

            if (closed && trade.closeTime) {
                const closeDateObj = new Date(trade.closeTime);
                trade.closeDate = `${closeDateObj.getFullYear()}-${String(closeDateObj.getMonth() + 1).padStart(2, '0')}-${String(closeDateObj.getDate()).padStart(2, '0')} ${String(closeDateObj.getHours()).padStart(2, '0')}:${String(closeDateObj.getMinutes()).padStart(2, '0')}`;
            } else {
                trade.status = 'OPEN';
                trade.closeDate = 'N/A';
                stats.open++;
            }
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

        const events: { type: 'OPEN' | 'CLOSE', time: number, trade: any }[] = [];
        for (const trade of generatedTrades) {
            events.push({ type: 'OPEN', time: trade.entryTime, trade });
            if (trade.closeTime) {
                events.push({ type: 'CLOSE', time: trade.closeTime, trade });
            }
        }

        events.sort((a, b) => a.time - b.time);

        const slippageRate = 0.0003; // 0.03% Slippage
        const takerFeeRate = 0.0005; // 0.05% Taker Fee (standard fee)

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

                // Slippage adjustment on entry and close prices
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
                    // Check if totalCapital drops below maintenance margin (e.g., 5% of position value)
                    const maintenanceMargin = (margin * defaultLeverage) * 0.05;
                    if (totalCapital + pnlUSDT <= maintenanceMargin) {
                        pnlUSDT = -totalCapital;
                    }
                }

                activeCapital += (margin + pnlUSDT);
                totalCapital += pnlUSDT;

                // If cross liquidation happened
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
        const roi = ((totalCapital - initialCapital) / initialCapital) * 100;
        const netProfit = totalCapital - initialCapital;

        // Monte Carlo Stress Testing (1,000 runs)
        const mc = CoreBacktestEngine.runMonteCarloSimulation(generatedTrades, initialCapital, 1000);

        const modeText = options.mode === 'SCALP' ? 'سكالبينج ⚡️' : 'سوينج 🌊';
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

🎲 **اختبارات الضغط العشوائي (Monte Carlo 1,000 Iterations):**
- أقصى تراجع محتمل بنسبة ثقة 95%: **${mc.worstDrawdown95}%**
- أقصى تراجع محتمل في السيناريو المتطرف 99%: **${mc.worstDrawdown99}%**
- احتمالية حدوث تراجع حرج (>25%): **${mc.ruinProbability}%**
- رأس المال الوسيط المتوقع: **${mc.medianFinalCapital} USDT**

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
💡 *تم الاختبار عبر محاكاة الزمن خطوة بخطوة مع احتساب العمولات، الانزلاق السعري، وتتبع دقيق للمارجن المحجوز لضمان واقعية النتائج.*
        `;

        return { reportText, trades: generatedTrades };
    }

    /**
     * 1000-iteration Monte Carlo Stress Simulation
     */
    static runMonteCarloSimulation(
        trades: any[],
        initialCapital: number,
        iterations = 1000
    ): {
        worstDrawdown95: number;
        worstDrawdown99: number;
        ruinProbability: number;
        medianFinalCapital: number;
    } {
        const closedTrades = trades.filter(t => t.status === 'WIN' || t.status === 'LOSS');
        if (closedTrades.length < 5) {
            return {
                worstDrawdown95: 0,
                worstDrawdown99: 0,
                ruinProbability: 0,
                medianFinalCapital: initialCapital
            };
        }

        const simFinalCapitals: number[] = [];
        const simMaxDrawdowns: number[] = [];
        let ruinCount = 0;

        for (let iter = 0; iter < iterations; iter++) {
            const shuffled = [...closedTrades];
            for (let i = shuffled.length - 1; i > 0; i--) {
                const j = Math.floor(Math.random() * (i + 1));
                [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
            }

            let cap = initialCapital;
            let peak = cap;
            let maxDd = 0;

            for (const t of shuffled) {
                const pnl = t.pnlAmount || 0;
                cap += pnl;
                if (cap > peak) peak = cap;
                const dd = peak > 0 ? ((peak - cap) / peak) * 100 : 0;
                if (dd > maxDd) maxDd = dd;
            }

            simFinalCapitals.push(cap);
            simMaxDrawdowns.push(maxDd);

            if (maxDd >= 25) {
                ruinCount++;
            }
        }

        simMaxDrawdowns.sort((a, b) => a - b);
        simFinalCapitals.sort((a, b) => a - b);

        const idx95 = Math.floor(iterations * 0.95);
        const idx99 = Math.floor(iterations * 0.99);
        const idxMedian = Math.floor(iterations * 0.50);

        return {
            worstDrawdown95: Number(simMaxDrawdowns[idx95].toFixed(2)),
            worstDrawdown99: Number(simMaxDrawdowns[idx99].toFixed(2)),
            ruinProbability: Number(((ruinCount / iterations) * 100).toFixed(1)),
            medianFinalCapital: Number(simFinalCapitals[idxMedian].toFixed(2))
        };
    }
}
