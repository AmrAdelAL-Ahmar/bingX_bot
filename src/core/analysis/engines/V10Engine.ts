import { AnalysisDetails, MatrixResult, OHLCV, TradeRecommendation } from '../../shared/types';
import { ITradingEngine, EngineResult } from './ITradingEngine';
import { TechnicalAnalyzer } from '../TechnicalAnalyzer';
import { OptimizedEngineSuite } from './OptimizedEngineSuite';

interface MacroResult {
    bias: 'LONG' | 'SHORT' | 'NEUTRAL';
    reason: string;
    score: number;
}

interface POIZone {
    top: number;
    bottom: number;
    source: 'OB' | 'FVG' | 'POC';
    description: string;
}

interface MicroResult {
    confirmed: boolean;
    reason: string;
    score: number;
}

/**
 * 🚀 V10 Hybrid SMC & Statistical Engine — المحرك الهجين العشاري المتقدم
 *
 * الميزات الفريدة للإصدار V10:
 * 1. دمج SMC (Order Block + FVG) مع مستويات POC (Point of Control) لتحديد السيولة بدقة فائقة.
 * 2. فلترة الضوضاء السعرية بالكامل عبر شموع Heikin-Ashi لتأكيد كسر الهيكل الحقيقي (MSS).
 * 3. تأكيد الاتجاه الاستراتيجي بدمج الـ SuperTrend على الفريمات المتوسطة والكبيرة.
 * 4. تصفية إحصائية متطورة بالاعتماد على معامل انحدار خط Linear Regression كعامل ثقة لتوقع حركة السعر.
 */
export class V10Engine implements ITradingEngine {
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
            scalp: this.runV10Pipeline(cp, vwap, allTimeframes, mtfOHLCV, matrix, 'SCALP', options, options.quickTF),
            swing: this.runV10Pipeline(cp, vwap, allTimeframes, mtfOHLCV, matrix, 'SWING', options, options.longTF),
        };
    }

    private runV10Pipeline(
        cp: number,
        vwap: number,
        allTimeframes: Record<string, AnalysisDetails>,
        mtfOHLCV: Record<string, OHLCV[]>,
        matrix: MatrixResult,
        mode: 'SCALP' | 'SWING',
        options?: { quickTF: string; longTF: string; params?: Record<string, any> },
        tf?: string
    ): TradeRecommendation {

        // ── 1. LAYER 1: MACRO GATE (Daily & 4H Bias with SuperTrend) ───────────
        const macro = this.evaluateMacroLayer(allTimeframes, mtfOHLCV);
        if (macro.bias === 'NEUTRAL') {
            return this.cancel(cp, '⚪ لا تحيز واضح على الإطار الكبير (V10)', mode, 0,
                `[V10 Macro] رُفض: ${macro.reason}`);
        }
        const direction = macro.bias;

        // ── 2. LAYER 2: MESO GATE (SMC POI + Volume Profile POC Search) ────────
        const mesoOHLCV = mtfOHLCV['1h'] || mtfOHLCV['15m'] || [];
        const poi = this.evaluateMesoLayer(cp, mesoOHLCV, direction);

        if (!poi) {
            const zone = this.calcGoldenZone(mesoOHLCV, direction);
            const inZone = zone ? (cp >= zone.bottom && cp <= zone.top) : false;
            const standbyMsg = inZone
                ? '🕐 V10 انتظار: داخل المنطقة الذهبية، لا يوجد سيولة مؤسساتية OB/FVG/POC'
                : '🕐 V10 انتظار: السعر خارج المنطقة الذهبية والسيولة';
            return this.cancel(cp, standbyMsg, mode, macro.score,
                `[V10 Meso] استعداد: ${standbyMsg}`);
        }

        // ── 3. LAYER 3: MICRO GATE (Heikin-Ashi MSS + Statistical Regression Trigger) ──
        const microOHLCV = mtfOHLCV['5m'] || mtfOHLCV['1m'] || [];
        const micro = this.evaluateMicroLayer(cp, microOHLCV, direction);

        if (!micro.confirmed) {
            return this.cancel(cp, `🔍 V10 انتظار الزناد: ${micro.reason}`, mode,
                macro.score + micro.score,
                `[V10 Micro] استعداد: ${micro.reason}`);
        }

        // ── 4. LAYER 4: EXECUTION (Dynamic ATR SL/TP Calculation) ───────────────
        const execData = allTimeframes['5m'] || allTimeframes['15m'] || allTimeframes['1h'];
        if (!execData) {
            return this.cancel(cp, '❌ V10 بيانات التنفيذ غير متوفرة', mode, 0, 'No exec data');
        }

        const sl = this.calcSL(cp, microOHLCV, direction, execData);
        const tp = this.calcTP(cp, mesoOHLCV, direction, execData);
        
        // Calculate dynamic confidence score (incorporating statistics and Matrix)
        const confidence = this.calcConfidence(macro, micro, matrix, direction);
        const winRate = Math.min(55 + confidence * 0.50, 98); // V10 has base 55%

        if (winRate < 80) {
            return this.cancel(cp,
                `⚪ ثقة غير كافية V10 (${winRate.toFixed(0)}%) — الحد الأدنى 80%`,
                mode, confidence,
                `[V10 Confidence Gate] ${winRate.toFixed(1)}% < 80%`);
        }

        // High Precision Filter Check
        const useFilter = options?.params?.highPrecisionFilter !== false;
        if (useFilter && allTimeframes) {
            const frame = OptimizedEngineSuite.buildMarketFrame(direction, cp, matrix, allTimeframes, tf || '5m');
            const passed = OptimizedEngineSuite.runV10(frame);
            if (!passed) {
                return this.cancel(cp, '⚪ ملغاة: لم تتطابق شروط V10 المؤسساتية (POC + Linear Regression)', mode, confidence, `Failed V10 Filter. Matrix: ${matrix.percentage.toFixed(0)}%, 1H_RSI: ${frame.rsi1h?.toFixed(1) ?? 'N/A'}, 4H_RSI: ${frame.rsi4h?.toFixed(1) ?? 'N/A'}`);
            }
        }

        const signalReason = [
            `🎯 V10 SMC Hybrid [${mode}]`,
            `Macro: ${macro.reason}`,
            `POI: ${poi.description}`,
            `Trigger: ${micro.reason}`,
            `WinRate: ${winRate.toFixed(0)}%`,
        ].join(' | ');

        return {
            status: `${direction === 'LONG' ? '🟢 قناص صاعد' : '🔴 قناص هابط'} V10 (${winRate.toFixed(0)}%)`,
            type: direction,
            entry: cp,
            tp,
            sl,
            timeEstimate: mode === 'SCALP' ? 30 : 240,
            winRate,
            reverseProb: 100 - winRate,
            confidenceScore: confidence,
            signalReason,
        };
    }

    private evaluateMacroLayer(
        allTimeframes: Record<string, AnalysisDetails>,
        mtfOHLCV: Record<string, OHLCV[]>
    ): MacroResult {
        const daily = allTimeframes['1d'];
        const h4 = allTimeframes['4h'];

        let bull = 0;
        let bear = 0;
        const reasons: string[] = [];

        // 1. MA Alignment
        if (daily) {
            const ma50 = daily.levels.ma50 || 0;
            const ma200 = daily.levels.ma200 || 0;

            if (ma50 > 0 && ma200 > 0) {
                if (ma50 > ma200) { bull += 20; reasons.push('EMA50>200'); }
                else { bear += 20; reasons.push('EMA50<200'); }
            }
            if (daily.isBullishTrend) { bull += 10; } else { bear += 10; }
        }

        // 2. SuperTrend on 4H/1D
        const h4OHLCV = mtfOHLCV['4h'] || [];
        if (h4OHLCV.length >= 10) {
            const h4ST = TechnicalAnalyzer.calculateSuperTrend(h4OHLCV);
            const lastST = h4ST[h4ST.length - 1];
            if (lastST) {
                if (lastST.trend === 'UP') {
                    bull += 25;
                    reasons.push('4H SuperTrend 🟢');
                } else {
                    bear += 25;
                    reasons.push('4H SuperTrend 🔴');
                }
            }
        }

        // 3. Linear Regression Forecast on Daily to evaluate bias
        const dailyOHLCV = mtfOHLCV['1d'] || [];
        if (dailyOHLCV.length >= 20) {
            const pred = TechnicalAnalyzer.predictNextPriceLinear(dailyOHLCV);
            if (pred.trendDirection === 'UP' && pred.slope > 0) {
                bull += 20;
                reasons.push('LR LinearUp 📈');
            } else if (pred.trendDirection === 'DOWN' && pred.slope < 0) {
                bear += 20;
                reasons.push('LR LinearDown 📉');
            }
        }

        const total = bull + bear;
        if (total === 0) return { bias: 'NEUTRAL', reason: 'لا بيانات كافية', score: 0 };

        const bullRatio = bull / total;

        if (bullRatio >= 0.60) return { bias: 'LONG', reason: reasons.join(', '), score: bull };
        if (bullRatio <= 0.40) return { bias: 'SHORT', reason: reasons.join(', '), score: bear };

        return { bias: 'NEUTRAL', reason: `تذبذب: صاعد(${bull}) مقابل هابط(${bear})`, score: 0 };
    }

    private evaluateMesoLayer(
        cp: number,
        ohlcv: OHLCV[],
        direction: 'LONG' | 'SHORT'
    ): POIZone | null {
        if (ohlcv.length < 15) return null;

        const zone = this.calcGoldenZone(ohlcv, direction);
        if (!zone) return null;

        // Price must be inside the golden zone or extremely close (within 0.3%)
        const margin = cp * 0.003;
        if (cp < zone.bottom - margin || cp > zone.top + margin) return null;

        // 1. Order Block (SMC)
        const ob = TechnicalAnalyzer.detectOrderBlock(ohlcv, direction);
        if (ob.found && this.overlaps(ob.top, ob.bottom, zone)) {
            return { top: ob.top, bottom: ob.bottom, source: 'OB', description: ob.description };
        }

        // 2. Volume Profile POC (Point of Control)
        const vp = TechnicalAnalyzer.calculateVolumeProfile(ohlcv, 40);
        if (vp.poc > 0 && vp.poc >= zone.bottom && vp.poc <= zone.top) {
            // Price is close to POC
            if (Math.abs(cp - vp.poc) / vp.poc <= 0.005) {
                return {
                    top: vp.poc * 1.002,
                    bottom: vp.poc * 0.998,
                    source: 'POC',
                    description: `POC Accumulation [${vp.poc.toFixed(4)}]`
                };
            }
        }

        // 3. Fair Value Gap (SMC)
        const fvg = TechnicalAnalyzer.detectFVG(ohlcv, direction);
        if (fvg.found && this.overlaps(fvg.top, fvg.bottom, zone)) {
            return { top: fvg.top, bottom: fvg.bottom, source: 'FVG', description: fvg.description };
        }

        return null;
    }

    private evaluateMicroLayer(
        cp: number,
        ohlcv: OHLCV[],
        direction: 'LONG' | 'SHORT'
    ): MicroResult {
        if (ohlcv.length < 15) {
            return { confirmed: false, reason: 'بيانات الفريم الصغير غير كافية', score: 0 };
        }

        let score = 0;
        const reasons: string[] = [];

        // 1. Filter out price wicks via Heikin-Ashi transformation
        const haCandles = TechnicalAnalyzer.calculateHeikinAshi(ohlcv);
        
        // Detect Market Structure Shift (MSS) using noise-filtered Heikin-Ashi candles
        const mss = TechnicalAnalyzer.detectMSS(haCandles, direction);
        if (mss.detected) {
            score += 45;
            reasons.push(`MSS HeikinAshi ✅`);
        }

        // 2. Statistical Linear Regression on Micro TF (5m/1m) to verify momentum
        const pred = TechnicalAnalyzer.predictNextPriceLinear(ohlcv, 15);
        if (direction === 'LONG' && pred.trendDirection === 'UP') {
            score += 20;
            reasons.push(`LR Micro صاعد`);
        } else if (direction === 'SHORT' && pred.trendDirection === 'DOWN') {
            score += 20;
            reasons.push(`LR Micro هابط`);
        }

        // 3. RSI Divergence
        const divCheck = direction === 'LONG' ? 'SHORT' : 'LONG';
        const div = TechnicalAnalyzer.detectDivergence(ohlcv, divCheck);
        if (div.detected) {
            score += 20;
            reasons.push(`Divergence ✅`);
        }

        // 4. Stoch RSI & CCI Synchronization
        const scalpST = TechnicalAnalyzer.calculateSuperTrend(ohlcv, 10, 3);
        const lastScalpST = scalpST[scalpST.length - 1];
        if (lastScalpST && ((direction === 'LONG' && lastScalpST.trend === 'UP') || (direction === 'SHORT' && lastScalpST.trend === 'DOWN'))) {
            score += 15;
            reasons.push('Scalp SuperTrend Sync');
        }

        // V10 Confirmation gate: MSS is mandatory + total score >= 60
        const confirmed = mss.detected && score >= 60;

        return {
            confirmed,
            reason: reasons.length > 0 ? reasons.join(' + ') : 'لا تأكيد بعد',
            score,
        };
    }

    private calcGoldenZone(
        ohlcv: OHLCV[],
        direction: 'LONG' | 'SHORT'
    ): { top: number; bottom: number } | null {
        if (ohlcv.length < 20) return null;

        const recent = ohlcv.slice(-50);
        const swingHigh = Math.max(...recent.map(c => c.high));
        const swingLow = Math.min(...recent.map(c => c.low));
        const diff = swingHigh - swingLow;

        if (diff === 0) return null;

        if (direction === 'LONG') {
            return {
                top: swingHigh - (diff * 0.618),
                bottom: swingHigh - (diff * 0.886),
            };
        }
        return {
            top: swingLow + (diff * 0.886),
            bottom: swingLow + (diff * 0.618),
        };
    }

    private overlaps(
        top: number, bottom: number,
        zone: { top: number; bottom: number }
    ): boolean {
        return !(bottom > zone.top || top < zone.bottom);
    }

    private calcSL(
        cp: number,
        ohlcv: OHLCV[],
        direction: 'LONG' | 'SHORT',
        data: AnalysisDetails
    ): number {
        const recent = ohlcv.slice(-10);
        const atr = data.atr || cp * 0.005;

        if (direction === 'LONG') {
            const recentLow = Math.min(...recent.map(c => c.low));
            const sl = recentLow - (atr * 0.5);
            return Math.max(sl, cp * 0.96); // max 4% risk
        } else {
            const recentHigh = Math.max(...recent.map(c => c.high));
            const sl = recentHigh + (atr * 0.5);
            return Math.min(sl, cp * 1.04);
        }
    }

    private calcTP(
        cp: number,
        ohlcv: OHLCV[],
        direction: 'LONG' | 'SHORT',
        data: AnalysisDetails
    ): number {
        const recent = ohlcv.slice(-50);
        const swingHigh = Math.max(...recent.map(c => c.high));
        const swingLow = Math.min(...recent.map(c => c.low));
        const diff = swingHigh - swingLow;
        const atr = data.atr || cp * 0.005;

        if (direction === 'LONG') {
            const fibExt = swingHigh + (diff * 0.618);
            return Math.max(fibExt, cp + atr * 3.5); // V10 aims for 3.5x ATR targets
        } else {
            const fibExt = swingLow - (diff * 0.618);
            return Math.min(fibExt, cp - atr * 3.5);
        }
    }

    private calcConfidence(
        macro: MacroResult,
        micro: MicroResult,
        matrix: MatrixResult,
        direction: 'LONG' | 'SHORT'
    ): number {
        let score = 0;

        // Macro bias (max 35)
        score += Math.min(macro.score * 0.45, 35);

        // Micro trigger (max 40)
        score += Math.min(micro.score * 0.45, 40);

        // Matrix confluence (max 25)
        const matrixScore = direction === 'LONG'
            ? Math.max(0, matrix.percentage - 50) * 0.5
            : Math.max(0, 50 - matrix.percentage) * 0.5;
        score += Math.min(matrixScore, 25);

        return score;
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
