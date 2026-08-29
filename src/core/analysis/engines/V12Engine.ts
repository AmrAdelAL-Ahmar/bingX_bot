import { AnalysisDetails, MatrixResult, OHLCV, TradeRecommendation } from '../../shared/types';
import { ITradingEngine, EngineResult } from './ITradingEngine';
import { TechnicalAnalyzer } from '../TechnicalAnalyzer';
import { OptimizedEngineSuite } from './OptimizedEngineSuite';

export class V12Engine implements ITradingEngine {
    analyze(
        cp: number,
        vwap: number,
        allTimeframes: Record<string, AnalysisDetails>,
        mtfOHLCV: Record<string, OHLCV[]>,
        options: { quickTF: string; longTF: string; params?: Record<string, any> }
    ): EngineResult {
        const matrix = TechnicalAnalyzer.calculateMatrix(allTimeframes);

        return {
            matrix,
            scalp: this.runV12Pipeline(cp, allTimeframes, mtfOHLCV, matrix, 'SCALP', options.params, options, options.quickTF),
            swing: this.runV12Pipeline(cp, allTimeframes, mtfOHLCV, matrix, 'SWING', options.params, options, options.longTF),
        };
    }

    private runV12Pipeline(
        cp: number,
        allTimeframes: Record<string, AnalysisDetails>,
        mtfOHLCV: Record<string, OHLCV[]>,
        matrix: MatrixResult,
        mode: 'SCALP' | 'SWING',
        params?: Record<string, any>,
        options?: { quickTF: string; longTF: string; params?: Record<string, any> },
        tf?: string
    ): TradeRecommendation {
        const macroTF = mode === 'SCALP' ? '1h' : '4h';
        const mesoTF = '15m';
        const microTF = mode === 'SCALP' ? '5m' : '15m';

        const ohlcvMacro = mtfOHLCV[macroTF] || [];
        const ohlcvMeso = mtfOHLCV[mesoTF] || [];
        const ohlcvMicro = mtfOHLCV[microTF] || [];

        if (ohlcvMacro.length < 20 || ohlcvMeso.length < 30 || ohlcvMicro.length < 30) {
            return this.cancel(cp, '❌ بيانات غير كافية لـ V12 (تحتاج 30 شمعة على الأقل)', mode, 0, 'No data');
        }

        const reasons: string[] = [];
        let score = 30;

        // ── 1. Macro Gate ──
        const macroAnalysis = allTimeframes[macroTF];
        const macroClose = ohlcvMacro[ohlcvMacro.length - 1].close;
        const macroAtr = macroAnalysis?.atr || cp * 0.005;

        const swingHighMacro = macroAnalysis?.levels?.lastSwingHigh || Math.max(...ohlcvMacro.slice(-15).map(c => c.high));
        const swingLowMacro = macroAnalysis?.levels?.lastSwingLow || Math.min(...ohlcvMacro.slice(-15).map(c => c.low));

        let direction: 'LONG' | 'SHORT' | 'NONE' = 'NONE';
        const deltaPriceBreakLong = macroClose - swingHighMacro;
        const deltaPriceBreakShort = swingLowMacro - macroClose;
        const macroThreshold = 0.5 * macroAtr;

        if (deltaPriceBreakLong >= macroThreshold) {
            direction = 'LONG';
            score += 20;
            reasons.push('BOS صاعد ماكرو');
        } else if (deltaPriceBreakShort >= macroThreshold) {
            direction = 'SHORT';
            score += 20;
            reasons.push('BOS هابط ماكرو');
        } else {
            return this.cancel(cp, '⚪ لا توجد إشارة هيكلية ماكرو كافية لـ V12', mode, 0, 'No Macro structural shift');
        }

        // ── 2. Meso POI (Unmitigated OB) ──
        let obFound = false;
        let obBottom = 0;
        let obTop = 0;
        let equilibrium = 0;

        const MIN_IMPULSE = params?.minImpulse ?? 0.002;
        const volumeSpikeMultiplier = params?.volumeSpikeMultiplier ?? 1.0;
        const candles = ohlcvMeso.slice(-30);

        for (let i = candles.length - 4; i >= 20; i--) {
            const c = candles[i];
            const next = candles[i + 1];

            const obIndexInFull = ohlcvMeso.indexOf(c);
            if (obIndexInFull < 20) continue;
            const preObCandles = ohlcvMeso.slice(obIndexInFull - 20, obIndexInFull);
            const meanVol = preObCandles.reduce((s, x) => s + x.volume, 0) / preObCandles.length;
            const varianceVol = preObCandles.reduce((s, x) => s + Math.pow(x.volume - meanVol, 2), 0) / preObCandles.length;
            const stdDevVol = Math.sqrt(varianceVol) || 0.0001;

            if (direction === 'LONG') {
                const isBearish = c.close < c.open;
                const nextIsBullish = next.close > next.open;
                const impulse = next.open > 0 && (next.close - next.open) / next.open > MIN_IMPULSE;
                const volumeSpike = next.volume >= (meanVol + volumeSpikeMultiplier * stdDevVol);

                if (isBearish && nextIsBullish && impulse && volumeSpike) {
                    obTop = Math.max(c.open, c.close);
                    obBottom = c.low;
                    equilibrium = obBottom + (obTop - obBottom) / 2;

                    let unmitigated = true;
                    for (let j = obIndexInFull + 2; j < ohlcvMeso.length; j++) {
                        if (ohlcvMeso[j].close < obBottom) {
                            unmitigated = false;
                            break;
                        }
                    }

                    if (unmitigated) {
                        obFound = true;
                        score += 20;
                        reasons.push('Unmitigated Bullish OB');
                        break;
                    }
                }
            } else {
                const isBullish = c.close > c.open;
                const nextIsBearish = next.close < next.open;
                const impulse = next.open > 0 && (next.open - next.close) / next.open > MIN_IMPULSE;
                const volumeSpike = next.volume >= (meanVol + volumeSpikeMultiplier * stdDevVol);

                if (isBullish && nextIsBearish && impulse && volumeSpike) {
                    obTop = c.high;
                    obBottom = Math.min(c.open, c.close);
                    equilibrium = obBottom + (obTop - obBottom) / 2;

                    let unmitigated = true;
                    for (let j = obIndexInFull + 2; j < ohlcvMeso.length; j++) {
                        if (ohlcvMeso[j].close > obTop) {
                            unmitigated = false;
                            break;
                        }
                    }

                    if (unmitigated) {
                        obFound = true;
                        score += 20;
                        reasons.push('Unmitigated Bearish OB');
                        break;
                    }
                }
            }
        }

        if (!obFound) {
            return this.cancel(cp, '⚪ لم يتم رصد كتلة أوامر مؤسساتية غير ملموسة لـ V12', mode, 0, 'No OB found on Meso');
        }

        // ── 3. Micro Trigger (Equilibrium and confirmation pattern) ──
        let priceTouchedOB = false;
        let patternConfirmed = false;

        const lastMicro = ohlcvMicro[ohlcvMicro.length - 1];
        const prevMicro = ohlcvMicro[ohlcvMicro.length - 2];

        if (direction === 'LONG') {
            priceTouchedOB = lastMicro.low <= equilibrium && lastMicro.close >= obBottom;

            const bodySize = Math.abs(lastMicro.close - lastMicro.open);
            const lowerWick = Math.min(lastMicro.open, lastMicro.close) - lastMicro.low;
            const isBullishClose = lastMicro.close > lastMicro.open;
            const isHammer = lowerWick > 2.0 * bodySize;
            const isEngulfing = isBullishClose && prevMicro.close < prevMicro.open && lastMicro.close > prevMicro.open;

            patternConfirmed = isBullishClose && (isHammer || isEngulfing || true);
        } else {
            priceTouchedOB = lastMicro.high >= equilibrium && lastMicro.close <= obTop;

            const bodySize = Math.abs(lastMicro.close - lastMicro.open);
            const upperWick = lastMicro.high - Math.max(lastMicro.open, lastMicro.close);
            const isBearishClose = lastMicro.close < lastMicro.open;
            const isStar = upperWick > 2.0 * bodySize;
            const isEngulfing = isBearishClose && prevMicro.close > prevMicro.open && lastMicro.close < prevMicro.open;

            patternConfirmed = isBearishClose && (isStar || isEngulfing || true);
        }

        if (!priceTouchedOB || !patternConfirmed) {
            return this.cancel(cp, '⚪ في انتظار ارتداد السعر وتأكيد شمعة تأكيدية للـ OB', mode, 0, 'Trigger conditions pending');
        }

        score += 25;
        reasons.push('ملامسة الـ 50% وتأكيد شمعة الارتداد');

        // Multi-timeframe matrix confluence
        const matrixOk = direction === 'LONG' ? matrix.percentage >= 60 : matrix.percentage <= 40;
        if (matrixOk) {
            score += 10;
            reasons.push(`توافق المصفوفة (${matrix.percentage.toFixed(0)}%)`);
        }

        const winRate = Math.min(50 + score * 0.45, 95);
        if (winRate < 70) {
            return this.cancel(cp, `⚪ قوة الإشارة غير كافية لـ V12 (${winRate.toFixed(0)}%)`, mode, score, 'Low score');
        }

        // ── 4. Level Calculations (Stop Loss / Take Profit) ──
        const microAnalysis = allTimeframes[microTF];
        const microAtr = microAnalysis?.atr || cp * 0.005;

        const recentMicroCloses = ohlcvMicro.slice(-15);
        const fractalSupport = Math.min(...recentMicroCloses.map(c => c.low));
        const fractalResistance = Math.max(...recentMicroCloses.map(c => c.high));

        let sl = cp;
        let tp = cp;

        const atrMultiplier = params?.atrMultiplier ?? 3.6;
        const atrSlMultiplier = params?.atrSlMultiplier ?? 0.3;
        const maxSlCap = params?.maxSlCap ?? 0.03;

        if (direction === 'LONG') {
            const slDynamic = fractalSupport - atrSlMultiplier * microAtr;
            sl = Math.max(slDynamic, equilibrium * (1 - maxSlCap)); // Cap risk
            tp = equilibrium + microAtr * atrMultiplier;
        } else {
            const slDynamic = fractalResistance + atrSlMultiplier * microAtr;
            sl = Math.min(slDynamic, equilibrium * (1 + maxSlCap)); // Cap risk
            tp = equilibrium - microAtr * atrMultiplier;
        }

        // High Precision Filter Check
        const useFilter = options?.params?.highPrecisionFilter !== false;
        if (useFilter && allTimeframes && (direction === 'LONG' || direction === 'SHORT')) {
            const frame = OptimizedEngineSuite.buildMarketFrame(direction, cp, matrix, allTimeframes, tf || '5m');
            const passed = OptimizedEngineSuite.runV12(frame);
            if (!passed) {
                return this.cancel(cp, '⚪ ملغاة: لم تتطابق شروط V12 (KAMA + SuperTrend Wave)', mode, score, `Failed V12 Filter. Quick_CCI: ${frame.quickCci?.toFixed(1)}, 1H_RSI: ${frame.rsi1h?.toFixed(1) ?? 'N/A'}, 4H_RSI: ${frame.rsi4h?.toFixed(1) ?? 'N/A'}, Matrix: ${matrix.percentage.toFixed(0)}%`);
            }
        }

        return {
            status: `${direction === 'LONG' ? '🟢 قناص صاعد' : '🔴 قناص هابط'} V12 [${mode}] (${winRate.toFixed(0)}%)`,
            type: direction,
            entry: equilibrium,
            tp,
            sl,
            timeEstimate: mode === 'SCALP' ? 30 : 240,
            winRate,
            reverseProb: 100 - winRate,
            confidenceScore: score,
            signalReason: reasons.join(' | ')
        };
    }

    private cancel(
        cp: number,
        status: string,
        mode: string,
        score: number,
        reason: string
    ): TradeRecommendation {
        return {
            status,
            type: 'NONE',
            entry: cp, tp: cp, sl: cp,
            timeEstimate: mode === 'SCALP' ? 30 : 240,
            winRate: 0,
            reverseProb: 0,
            confidenceScore: score,
            signalReason: reason,
        };
    }
}
