import { AnalysisDetails, MatrixResult, OHLCV, TradeRecommendation } from '../AnalysisService';
import { ITradingEngine, EngineResult } from './ITradingEngine';
import { TechnicalAnalyzer } from '../TechnicalAnalyzer';

// ─── Internal types ───────────────────────────────────────────────────────────

interface MacroResult {
    bias: 'LONG' | 'SHORT' | 'NEUTRAL';
    reason: string;
    score: number;
}

interface POIZone {
    top: number;
    bottom: number;
    source: 'OB' | 'FVG';
    description: string;
}

interface MicroResult {
    confirmed: boolean;
    reason: string;
    score: number;
}

// ─── V7 Engine ────────────────────────────────────────────────────────────────

/**
 * V7 Hybrid Sniper Engine — القناص المتعدد الطبقات
 *
 * Pipeline:
 *   MACRO GATE  →  تحيز يومي (SMA50/200 + هيكل السوق)
 *   MESO GATE   →  منطقة اهتمام (فيبوناتشي 0.618-0.886 + OB/FVG)
 *   MICRO GATE  →  زناد الدخول (RSI Divergence + كسر هيكل MSS)
 *   EXECUTION   →  SL/TP + حد ثقة 80%
 */
export class V7Engine implements ITradingEngine {
    analyze(
        cp: number,
        vwap: number,
        allTimeframes: Record<string, AnalysisDetails>,
        mtfOHLCV: Record<string, OHLCV[]>,
        options: { quickTF: string; longTF: string }
    ): EngineResult {
        const matrix = TechnicalAnalyzer.calculateMatrix(allTimeframes);

        return {
            matrix,
            scalp: this.runSniperPipeline(cp, vwap, allTimeframes, mtfOHLCV, matrix, 'SCALP'),
            swing: this.runSniperPipeline(cp, vwap, allTimeframes, mtfOHLCV, matrix, 'SWING'),
        };
    }

    // =========================================================================
    // MAIN PIPELINE
    // =========================================================================

    private runSniperPipeline(
        cp: number,
        vwap: number,
        allTimeframes: Record<string, AnalysisDetails>,
        mtfOHLCV: Record<string, OHLCV[]>,
        matrix: MatrixResult,
        mode: 'SCALP' | 'SWING'
    ): TradeRecommendation {

        // ── LAYER 1: MACRO GATE (Daily Bias) ──────────────────────────────────
        const macro = this.evaluateMacroLayer(allTimeframes);
        if (macro.bias === 'NEUTRAL') {
            return this.cancel(cp, '⚪ لا تحيز واضح على الإطار الكبير', mode, 0,
                `[Macro] رُفض: ${macro.reason}`);
        }
        const direction = macro.bias;

        // ── LAYER 2: MESO GATE (POI Search) ──────────────────────────────────
        const mesoOHLCV = mtfOHLCV['1h'] || mtfOHLCV['15m'] || [];
        const poi = this.evaluateMesoLayer(cp, mesoOHLCV, direction);

        if (!poi) {
            const zone = this.calcGoldenZone(mesoOHLCV, direction);
            const inZone = zone ? (cp >= zone.bottom && cp <= zone.top) : false;
            const standbyMsg = inZone
                ? '🕐 انتظار: داخل المنطقة الذهبية، لا يوجد OB/FVG'
                : '🕐 انتظار: السعر خارج المنطقة الذهبية [0.618–0.886]';
            return this.cancel(cp, standbyMsg, mode, macro.score,
                `[Meso] استعداد: ${standbyMsg}`);
        }

        // ── LAYER 3: MICRO GATE (Entry Trigger) ───────────────────────────────
        const microOHLCV = mtfOHLCV['5m'] || mtfOHLCV['1m'] || [];
        const micro = this.evaluateMicroLayer(cp, microOHLCV, direction);

        if (!micro.confirmed) {
            return this.cancel(cp, `🔍 انتظار زناد الدخول: ${micro.reason}`, mode,
                macro.score + micro.score,
                `[Micro] استعداد: ${micro.reason}`);
        }

        // ── LAYER 4: EXECUTION ────────────────────────────────────────────────
        const execData = allTimeframes['5m'] || allTimeframes['15m'] || allTimeframes['1h'];
        if (!execData) {
            return this.cancel(cp, '❌ بيانات التنفيذ غير متاحة', mode, 0, 'No exec data');
        }

        const sl = this.calcSL(cp, microOHLCV, direction, execData);
        const tp = this.calcTP(cp, mesoOHLCV, direction, execData);
        const confidence = this.calcConfidence(macro, micro, matrix, direction);
        const winRate = Math.min(50 + confidence * 0.55, 97);

        if (winRate < 80) {
            return this.cancel(cp,
                `⚪ ثقة غير كافية (${winRate.toFixed(0)}%) — الحد الأدنى 80%`,
                mode, confidence,
                `[Confidence Gate] ${winRate.toFixed(1)}% < 80%`);
        }

        const signalReason = [
            `🎯 V7 Sniper [${mode}]`,
            `Macro: ${macro.reason}`,
            `POI: ${poi?.description}`,
            `Trigger: ${micro.reason}`,
            `Score: ${confidence.toFixed(1)} → WinRate: ${winRate.toFixed(1)}%`,
        ].join(' | ');

        return {
            status: `${direction === 'LONG' ? '🟢 قناص صاعد' : '🔴 قناص هابط'} V7 (${winRate.toFixed(0)}%)`,
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

    // =========================================================================
    // LAYER 1 — MACRO: Daily Bias via SMA + Market Structure
    // =========================================================================

    private evaluateMacroLayer(
        allTimeframes: Record<string, AnalysisDetails>
    ): MacroResult {
        const daily = allTimeframes['1d'];
        const h4 = allTimeframes['4h'];

        let bull = 0;
        let bear = 0;
        const reasons: string[] = [];

        // --- SMA50 vs SMA200 (Golden/Death Cross) ---
        if (daily) {
            const ma50 = daily.levels.ma50 || 0;
            const ma200 = daily.levels.ma200 || 0;

            if (ma50 > 0 && ma200 > 0) {
                if (ma50 > ma200) { bull += 30; reasons.push('SMA50>200 ✅'); }
                else { bear += 30; reasons.push('SMA50<200 ✅'); }
            }

            // Daily market structure
            if (daily.structure.includes('صاعد')) { bull += 25; reasons.push('هيكل يومي صاعد'); }
            else if (daily.structure.includes('هابط')) { bear += 25; reasons.push('هيكل يومي هابط'); }

            // Daily SMA20 trend
            if (daily.isBullishTrend) bull += 10; else bear += 10;
        }

        // --- 4H Confirmation ---
        if (h4) {
            if (h4.structure.includes('صاعد')) { bull += 20; reasons.push('هيكل 4H صاعد'); }
            else if (h4.structure.includes('هابط')) { bear += 20; reasons.push('هيكل 4H هابط'); }

            if (h4.isBullishTrend) bull += 10; else bear += 10;
        }

        const total = bull + bear;
        if (total === 0) return { bias: 'NEUTRAL', reason: 'لا بيانات كافية', score: 0 };

        const bullRatio = bull / total;

        if (bullRatio >= 0.60) return { bias: 'LONG', reason: reasons.join(', '), score: bull };
        if (bullRatio <= 0.40) return { bias: 'SHORT', reason: reasons.join(', '), score: bear };

        return { bias: 'NEUTRAL', reason: `توازن: صاعد(${bull}) vs هابط(${bear})`, score: 0 };
    }

    // =========================================================================
    // LAYER 2 — MESO: POI Detection in Golden Zone [0.618 – 0.886]
    // =========================================================================

    private evaluateMesoLayer(
        cp: number,
        ohlcv: OHLCV[],
        direction: 'LONG' | 'SHORT'
    ): POIZone | null {
        if (ohlcv.length < 10) return null;

        const zone = this.calcGoldenZone(ohlcv, direction);
        if (!zone) return null;

        // Price must be inside the golden zone
        if (cp < zone.bottom || cp > zone.top) return null;

        // 1st priority: Order Block
        const ob = TechnicalAnalyzer.detectOrderBlock(ohlcv, direction);
        if (ob.found && this.overlaps(ob.top, ob.bottom, zone)) {
            return { top: ob.top, bottom: ob.bottom, source: 'OB', description: ob.description };
        }

        // 2nd priority: Fair Value Gap
        const fvg = TechnicalAnalyzer.detectFVG(ohlcv, direction);
        if (fvg.found && this.overlaps(fvg.top, fvg.bottom, zone)) {
            return { top: fvg.top, bottom: fvg.bottom, source: 'FVG', description: fvg.description };
        }

        return null;
    }

    /**
     * حساب المنطقة الذهبية [0.618 – 0.886] من آخر swing كبير
     */
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

        // تصحيح صاعد: السعر تراجع من القمة، نبحث عن دعم في [0.618 – 0.886]
        if (direction === 'LONG') {
            return {
                top: swingHigh - (diff * 0.618),
                bottom: swingHigh - (diff * 0.886),
            };
        }
        // تصحيح هابط: السعر ارتد من القاع، نبحث عن مقاومة في [0.618 – 0.886]
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

    // =========================================================================
    // LAYER 3 — MICRO: RSI Divergence + MSS Trigger
    // =========================================================================

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

        // --- RSI Extreme ---
        const { RSI } = require('technicalindicators');
        const closes = ohlcv.map(c => c.close);
        const rsiValues = RSI.calculate({ period: 14, values: closes }) as number[];
        const rsi = rsiValues[rsiValues.length - 1] ?? 50;

        if (direction === 'LONG' && rsi < 35) { score += 25; reasons.push(`RSI تشبع بيعي (${rsi.toFixed(1)})`); }
        if (direction === 'SHORT' && rsi > 65) { score += 25; reasons.push(`RSI تشبع شرائي (${rsi.toFixed(1)})`); }

        // --- RSI Divergence ---
        // للدخول LONG نريد انحراف إيجابي (Bullish Div) → detectDivergence('SHORT')
        // للدخول SHORT نريد انحراف سلبي (Bearish Div) → detectDivergence('LONG')
        const divCheck = direction === 'LONG' ? 'SHORT' : 'LONG';
        const div = TechnicalAnalyzer.detectDivergence(ohlcv, divCheck);
        if (div.detected) {
            score += 30;
            reasons.push(direction === 'LONG' ? 'Bullish Divergence ✅' : 'Bearish Divergence ✅');
        }

        // --- MSS Trigger (mandatory for confirmation) ---
        const mss = TechnicalAnalyzer.detectMSS(ohlcv, direction);
        if (mss.detected) {
            score += 40;
            reasons.push(`كسر هيكل مؤكد MSS (${mss.description})`);
        }

        // Confirmation requires MSS + at least one other signal (total score ≥ 55)
        const confirmed = mss.detected && score >= 55;

        return {
            confirmed,
            reason: reasons.length > 0 ? reasons.join(' + ') : 'لا تأكيد بعد',
            score,
        };
    }

    // =========================================================================
    // LAYER 4 — EXECUTION: SL / TP Calculation
    // =========================================================================

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
            // Fibonacci extension -0.618 above swing high
            const fibExt = swingHigh + (diff * 0.618);
            return Math.max(fibExt, cp + atr * 3);
        } else {
            const fibExt = swingLow - (diff * 0.618);
            return Math.min(fibExt, cp - atr * 3);
        }
    }

    // =========================================================================
    // HELPERS
    // =========================================================================

    private calcConfidence(
        macro: MacroResult,
        micro: MicroResult,
        matrix: MatrixResult,
        direction: 'LONG' | 'SHORT'
    ): number {
        let score = 0;

        // Macro contribution (max 40)
        score += Math.min(macro.score * 0.5, 40);

        // Micro trigger contribution (max 35)
        score += Math.min(micro.score * 0.5, 35);

        // Matrix alignment (max 25)
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
