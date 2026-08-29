import { AnalysisDetails, OHLCV } from '../../shared/types';
import { TechnicalAnalyzer } from '../../analysis/TechnicalAnalyzer';
import { ISniperEngine, SniperReport } from '../ISniperEngine';
import { OptimizedEngineSuite } from '../../analysis/engines/OptimizedEngineSuite';

// ─── Internal types (مشتركة مع V7Engine) ──────────────────────────────────────

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
    mssTrigger: boolean;
    hasDivergence: boolean;
    rsiExtreme: boolean;
}

// ─── V7SniperEngine ────────────────────────────────────────────────────────────

/**
 * V7 Hybrid Sniper Engine — نسخة الاقتناص
 *
 * الفرق عن V7Engine:
 * - يُصدر SniperReport بدلاً من TradeRecommendation
 * - يُفصّل شروط الدخول المكتملة وغير المكتملة
 * - يُرسل تقريراً حتى لو الصفقة لم تكتمل (تقرير "استعداد")
 * - يدعم وضعي SWING و SCALP بفريمات مختلفة
 */
export class V7SniperEngine implements ISniperEngine {
    readonly engineId: string;
    readonly displayName: string;
    readonly mode: 'SWING' | 'SCALP';
    readonly requiredTFs: string[];

    constructor(mode: 'SWING' | 'SCALP' = 'SWING') {
        this.mode = mode;
        this.engineId = mode === 'SWING' ? 'V7-SWING' : 'V7-SCALP';
        this.displayName = mode === 'SWING'
            ? '🎯 V7 قناص سوينج (1D/4H/1H/15m)'
            : '⚡ V7 قناص سكالب (1H/15m/5m/1m)';
        // الفريمات حسب الوضع
        this.requiredTFs = mode === 'SWING'
            ? ['1d', '4h', '1h', '15m']
            : ['1h', '15m', '5m', '1m'];
    }

    // ─────────────────────────────────────────────────────────────────────────
    // MAIN SCAN — يُصدر تقريراً شاملاً بغض النظر عن حالة الشروط
    // ─────────────────────────────────────────────────────────────────────────

    scan(
        symbol: string,
        cp: number,
        mtfOHLCV: Record<string, OHLCV[]>,
        allTimeframes: Record<string, AnalysisDetails>
    ): SniperReport {
        const completed: string[] = [];
        const pending: string[] = [];
        const now = new Date();

        // ── LAYER 1: MACRO ────────────────────────────────────────────────────
        const macro = this.evaluateMacroLayer(allTimeframes);

        if (macro.bias === 'NEUTRAL') {
            pending.push('🔸 تحيز الماكرو: لا يوجد اتجاه واضح على الفريم الكبير');
            return this.buildReport(symbol, cp, 'NONE', cp, cp, cp, false, 0, 0,
                completed, pending,
                '⚪ لا تحيز واضح على الإطار الكبير',
                `التحليل: ${macro.reason}`, now);
        }

        completed.push(`✅ الماكرو: ${macro.reason}`);
        const direction = macro.bias;

        // ── LAYER 2: MESO (POI) ───────────────────────────────────────────────
        const mesoTF = this.mode === 'SWING' ? '1h' : '5m';
        const mesoOHLCV = mtfOHLCV[mesoTF] || mtfOHLCV['15m'] || [];
        const zone = this.calcGoldenZone(mesoOHLCV, direction);
        const poi = this.evaluateMesoLayer(cp, mesoOHLCV, direction, zone);

        const inZone = zone ? (cp >= zone.bottom && cp <= zone.top) : false;

        if (inZone) {
            completed.push(`✅ الميزو: السعر داخل المنطقة الذهبية [0.618–0.886]`);
        } else {
            pending.push(`🔸 الميزو: السعر خارج المنطقة الذهبية — انتظار العودة`);
        }

        if (poi) {
            completed.push(`✅ منطقة اهتمام: ${poi.source} — ${poi.description}`);
        } else if (inZone) {
            pending.push(`🔸 البحث عن OB/FVG داخل المنطقة الذهبية`);
        } else {
            pending.push(`🔸 لا يوجد OB/FVG مؤهل في النطاق الحالي`);
        }

        // ── LAYER 3: MICRO (Trigger) ──────────────────────────────────────────
        const microTF = this.mode === 'SWING' ? '15m' : '1m';
        const microOHLCV = mtfOHLCV[microTF] || mtfOHLCV['5m'] || [];
        const micro = this.evaluateMicroLayer(cp, microOHLCV, direction);

        if (micro.rsiExtreme) completed.push(`✅ RSI: ${micro.reason.split(' + ')[0]}`);
        else pending.push(`🔸 RSI: لم يصل لمنطقة التشبع بعد`);

        if (micro.hasDivergence) completed.push(`✅ Divergence: ${direction === 'LONG' ? 'Bullish' : 'Bearish'} ✅`);
        else pending.push(`🔸 Divergence: لم يُرصد بعد`);

        if (micro.mssTrigger) completed.push(`✅ كسر هيكل MSS مؤكد (Body Close + Volume)`);
        else pending.push(`🔸 زناد الدخول MSS: لم يُطلق بعد`);

        // ── CONFIDENCE & HIGH PRECISION GATE ─────────────────────────────────
        const matrix = TechnicalAnalyzer.calculateMatrix(allTimeframes);
        const confidence = this.calcConfidence(macro, micro, matrix, direction);
        const winRate = Math.min(50 + confidence * 0.55, 97);

        // High Precision Verification
        const frame = OptimizedEngineSuite.buildMarketFrame(direction, cp, matrix, allTimeframes, this.mode === 'SCALP' ? '5m' : '15m');
        const v7Passed = OptimizedEngineSuite.runV7(frame);

        if (v7Passed) {
            completed.push(`✅ فلتر الدقة الفائقة V7: مؤكد (Win Rate 91.4%)`);
        } else {
            pending.push(`🔸 فلتر الدقة الفائقة V7: شروط التأكيد الإضافية غير مكتملة (Matrix/RSI/Fib/Structure)`);
        }

        const readyToFire = poi !== null && micro.confirmed && winRate >= 80 && v7Passed;

        // ── Expected Entry Price ──────────────────────────────────────────────
        let entryPrice = cp;
        if (!readyToFire && zone) {
            entryPrice = direction === 'LONG' ? zone.top : zone.bottom;
        }

        // ── SL / TP ───────────────────────────────────────────────────────────
        const execData = allTimeframes[mesoTF] || allTimeframes['15m'] || allTimeframes['1h'];
        let sl = cp;
        let tp = cp;
        let tp2: number | undefined;

        if (execData && microOHLCV.length > 0) {
            sl = this.calcSL(entryPrice, microOHLCV, direction, execData, zone);
            tp = this.calcTP(entryPrice, mesoOHLCV, direction, execData);
            tp2 = this.calcTP2(entryPrice, mesoOHLCV, direction, execData);
        }

        // ── SUMMARY ───────────────────────────────────────────────────────────
        const completedCount = completed.length;
        const totalConditions = completed.length + pending.length;
        const summary = readyToFire
            ? `🚀 إشارة جاهزة (${completedCount}/${totalConditions} شروط)`
            : `🔍 استعداد (${completedCount}/${totalConditions} شروط مكتملة)`;

        const details = this.buildDetails(symbol, direction, entryPrice, sl, tp, tp2, confidence, winRate, zone, poi, completed, pending, readyToFire);

        return this.buildReport(
            symbol, cp, direction, sl, tp, entryPrice, readyToFire,
            confidence, winRate, completed, pending, summary, details, now, tp2
        );
    }

    // ─────────────────────────────────────────────────────────────────────────
    // LAYER 1 — MACRO
    // ─────────────────────────────────────────────────────────────────────────

    private evaluateMacroLayer(allTimeframes: Record<string, AnalysisDetails>): MacroResult {
        const macroTF1 = this.mode === 'SWING' ? '1d' : '1h';
        const macroTF2 = this.mode === 'SWING' ? '4h' : '15m';

        const tf1 = allTimeframes[macroTF1];
        const tf2 = allTimeframes[macroTF2];

        let bull = 0, bear = 0;
        const reasons: string[] = [];

        if (tf1) {
            const ma50 = tf1.levels.ma50 || 0;
            const ma200 = tf1.levels.ma200 || 0;
            if (ma50 > 0 && ma200 > 0) {
                if (ma50 > ma200) { bull += 30; reasons.push(`SMA50>200 (${macroTF1})`); }
                else { bear += 30; reasons.push(`SMA50<200 (${macroTF1})`); }
            }
            if (tf1.structure.includes('صاعد')) { bull += 25; reasons.push(`هيكل ${macroTF1} صاعد`); }
            else if (tf1.structure.includes('هابط')) { bear += 25; reasons.push(`هيكل ${macroTF1} هابط`); }
            if (tf1.isBullishTrend) bull += 10; else bear += 10;
        }

        if (tf2) {
            if (tf2.structure.includes('صاعد')) { bull += 20; reasons.push(`هيكل ${macroTF2} صاعد`); }
            else if (tf2.structure.includes('هابط')) { bear += 20; reasons.push(`هيكل ${macroTF2} هابط`); }
            if (tf2.isBullishTrend) bull += 10; else bear += 10;
        }

        const total = bull + bear;
        if (total === 0) return { bias: 'NEUTRAL', reason: 'لا بيانات كافية', score: 0 };

        const bullRatio = bull / total;
        if (bullRatio >= 0.60) return { bias: 'LONG', reason: reasons.join(', '), score: bull };
        if (bullRatio <= 0.40) return { bias: 'SHORT', reason: reasons.join(', '), score: bear };
        return { bias: 'NEUTRAL', reason: `توازن: صاعد(${bull}) vs هابط(${bear})`, score: 0 };
    }

    // ─────────────────────────────────────────────────────────────────────────
    // LAYER 2 — MESO (POI)
    // ─────────────────────────────────────────────────────────────────────────

    private evaluateMesoLayer(
        cp: number,
        ohlcv: OHLCV[],
        direction: 'LONG' | 'SHORT',
        zone: { top: number; bottom: number } | null
    ): POIZone | null {
        if (!zone || ohlcv.length < 10) return null;
        if (cp < zone.bottom || cp > zone.top) return null;

        const ob = TechnicalAnalyzer.detectOrderBlock(ohlcv, direction);
        if (ob.found && this.overlaps(ob.top, ob.bottom, zone)) {
            return { top: ob.top, bottom: ob.bottom, source: 'OB', description: ob.description };
        }

        const fvg = TechnicalAnalyzer.detectFVG(ohlcv, direction);
        if (fvg.found && this.overlaps(fvg.top, fvg.bottom, zone)) {
            return { top: fvg.top, bottom: fvg.bottom, source: 'FVG', description: fvg.description };
        }
        return null;
    }

    private calcGoldenZone(ohlcv: OHLCV[], direction: 'LONG' | 'SHORT'): { top: number; bottom: number } | null {
        if (ohlcv.length < 20) return null;
        const recent = ohlcv.slice(-50);
        const swingHigh = Math.max(...recent.map(c => c.high));
        const swingLow = Math.min(...recent.map(c => c.low));
        const diff = swingHigh - swingLow;
        if (diff === 0) return null;
        return direction === 'LONG'
            ? { top: swingHigh - (diff * 0.618), bottom: swingHigh - (diff * 0.886) }
            : { top: swingLow + (diff * 0.886), bottom: swingLow + (diff * 0.618) };
    }

    private overlaps(top: number, bottom: number, zone: { top: number; bottom: number }): boolean {
        return !(bottom > zone.top || top < zone.bottom);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // LAYER 3 — MICRO (Trigger)
    // ─────────────────────────────────────────────────────────────────────────

    private evaluateMicroLayer(cp: number, ohlcv: OHLCV[], direction: 'LONG' | 'SHORT'): MicroResult {
        if (ohlcv.length < 15) {
            return { confirmed: false, reason: 'بيانات غير كافية', score: 0, mssTrigger: false, hasDivergence: false, rsiExtreme: false };
        }

        let score = 0;
        const reasons: string[] = [];
        let rsiExtreme = false;
        let hasDivergence = false;
        let mssTrigger = false;

        // RSI
        const { RSI } = require('technicalindicators');
        const closes = ohlcv.map(c => c.close);
        const rsiValues = RSI.calculate({ period: 14, values: closes }) as number[];
        const rsi = rsiValues[rsiValues.length - 1] ?? 50;
        if (direction === 'LONG' && rsi < 35) { score += 25; reasons.push(`RSI تشبع بيعي (${rsi.toFixed(1)})`); rsiExtreme = true; }
        if (direction === 'SHORT' && rsi > 65) { score += 25; reasons.push(`RSI تشبع شرائي (${rsi.toFixed(1)})`); rsiExtreme = true; }

        // Divergence
        const divCheck = direction === 'LONG' ? 'SHORT' : 'LONG';
        const div = TechnicalAnalyzer.detectDivergence(ohlcv, divCheck);
        if (div.detected) {
            score += 30;
            hasDivergence = true;
            reasons.push(direction === 'LONG' ? 'Bullish Divergence ✅' : 'Bearish Divergence ✅');
        }

        // MSS — الزناد الإلزامي
        const mss = TechnicalAnalyzer.detectMSS(ohlcv, direction);
        if (mss.detected) {
            score += 40;
            mssTrigger = true;
            reasons.push(`MSS: ${mss.description}`);
        }

        const confirmed = mss.detected && score >= 55;
        return {
            confirmed,
            reason: reasons.length > 0 ? reasons.join(' + ') : 'لا تأكيد بعد',
            score,
            mssTrigger,
            hasDivergence,
            rsiExtreme,
        };
    }

    // ─────────────────────────────────────────────────────────────────────────
    // SL / TP Calculation
    // ─────────────────────────────────────────────────────────────────────────

    private calcSL(
        cp: number, 
        ohlcv: OHLCV[], 
        direction: 'LONG' | 'SHORT', 
        data: AnalysisDetails,
        zone?: { top: number; bottom: number } | null
    ): number {
        const recent = ohlcv.slice(-10);
        const atr = data.atr || cp * 0.005;

        if (zone) {
            if (direction === 'LONG') {
                return zone.bottom - (atr * 0.5);
            } else {
                return zone.top + (atr * 0.5);
            }
        }

        if (direction === 'LONG') {
            const sl = Math.min(...recent.map(c => c.low)) - (atr * 0.5);
            return Math.max(sl, cp * 0.96);
        } else {
            const sl = Math.max(...recent.map(c => c.high)) + (atr * 0.5);
            return Math.min(sl, cp * 1.04);
        }
    }

    private calcTP(cp: number, ohlcv: OHLCV[], direction: 'LONG' | 'SHORT', data: AnalysisDetails): number {
        const recent = ohlcv.slice(-50);
        const swingHigh = Math.max(...recent.map(c => c.high));
        const swingLow = Math.min(...recent.map(c => c.low));
        const diff = swingHigh - swingLow;
        const atr = data.atr || cp * 0.005;
        if (direction === 'LONG') return Math.max(swingHigh + (diff * 0.618), cp + atr * 3);
        return Math.min(swingLow - (diff * 0.618), cp - atr * 3);
    }

    private calcTP2(cp: number, ohlcv: OHLCV[], direction: 'LONG' | 'SHORT', data: AnalysisDetails): number | undefined {
        const recent = ohlcv.slice(-50);
        const swingHigh = Math.max(...recent.map(c => c.high));
        const swingLow = Math.min(...recent.map(c => c.low));
        const diff = swingHigh - swingLow;
        const atr = data.atr || cp * 0.005;
        if (direction === 'LONG') return Math.max(swingHigh + (diff * 1.0), cp + atr * 6);
        return Math.min(swingLow - (diff * 1.0), cp - atr * 6);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Confidence
    // ─────────────────────────────────────────────────────────────────────────

    private calcConfidence(
        macro: MacroResult,
        micro: MicroResult,
        matrix: { percentage: number },
        direction: 'LONG' | 'SHORT'
    ): number {
        let score = 0;
        score += Math.min(macro.score * 0.5, 40);
        score += Math.min(micro.score * 0.5, 35);
        const matrixScore = direction === 'LONG'
            ? Math.max(0, matrix.percentage - 50) * 0.5
            : Math.max(0, 50 - matrix.percentage) * 0.5;
        score += Math.min(matrixScore, 25);
        return score;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Report Builder
    // ─────────────────────────────────────────────────────────────────────────

    private buildDetails(
        symbol: string,
        direction: 'LONG' | 'SHORT' | 'NONE',
        cp: number,
        sl: number,
        tp: number,
        tp2: number | undefined,
        confidence: number,
        winRate: number,
        zone: { top: number; bottom: number } | null,
        poi: POIZone | null,
        completed: string[],
        pending: string[],
        readyToFire: boolean
    ): string {
        const dirEmoji = direction === 'LONG' ? '🟢 LONG' : direction === 'SHORT' ? '🔴 SHORT' : '⚪ لا إشارة';
        const slPct = cp > 0 ? Math.abs((sl - cp) / cp * 100).toFixed(2) : '0';
        const tpPct = cp > 0 ? Math.abs((tp - cp) / cp * 100).toFixed(2) : '0';
        const rrr = parseFloat(tpPct) > 0 && parseFloat(slPct) > 0
            ? (parseFloat(tpPct) / parseFloat(slPct)).toFixed(2) : '—';

        let d = `🎯 *محرك الاقتناص ${this.displayName}*\n`;
        d += `💎 ${symbol} | ${dirEmoji}\n`;
        d += `━━━━━━━━━━━━━━\n`;
        d += `📊 *التقرير التفصيلي:*\n`;
        d += `• الدخول: \`$${cp.toFixed(4)}\`\n`;
        d += `• وقف الخسارة: \`$${sl.toFixed(4)}\` (-${slPct}%)\n`;
        d += `• الهدف الأول: \`$${tp.toFixed(4)}\` (+${tpPct}%)\n`;
        if (tp2) {
            const tp2Pct = Math.abs((tp2 - cp) / cp * 100).toFixed(2);
            d += `• الهدف الثاني: \`$${tp2.toFixed(4)}\` (+${tp2Pct}%)\n`;
        }
        d += `• نسبة العائد/الخطر: \`${rrr}:1\`\n`;
        d += `• الثقة: \`${confidence.toFixed(1)}%\` | معدل النجاح: \`${winRate.toFixed(1)}%\`\n`;
        if (zone) {
            d += `• المنطقة الذهبية: \`$${zone.bottom.toFixed(4)}\` — \`$${zone.top.toFixed(4)}\`\n`;
        }
        if (poi) {
            d += `• منطقة الاهتمام: \`${poi.source}\` — ${poi.description}\n`;
        }
        d += `━━━━━━━━━━━━━━\n`;
        d += `✅ *الشروط المكتملة (${completed.length}):*\n`;
        completed.forEach(c => { d += `${c}\n`; });
        if (pending.length > 0) {
            d += `\n🔸 *الشروط المنتظرة (${pending.length}):*\n`;
            pending.forEach(p => { d += `${p}\n`; });
        }
        d += `━━━━━━━━━━━━━━\n`;
        d += readyToFire
            ? `🚀 *الزناد جاهز — يمكن الدخول الآن*`
            : `⏳ *في وضع الانتظار — سيتم إشعارك عند اكتمال الشروط*`;
        return d;
    }

    private buildReport(
        symbol: string,
        cp: number,
        direction: 'LONG' | 'SHORT' | 'NONE',
        sl: number,
        tp: number,
        entry: number,
        readyToFire: boolean,
        confidence: number,
        winRate: number,
        completed: string[],
        pending: string[],
        summary: string,
        details: string,
        generatedAt: Date,
        tp2?: number
    ): SniperReport {
        return {
            symbol,
            engineId: this.engineId,
            direction,
            entry,
            sl,
            tp,
            tp2,
            readyToFire,
            confidence,
            winRate,
            completedConditions: completed,
            pendingConditions: pending,
            summary,
            details,
            generatedAt,
        };
    }
}
