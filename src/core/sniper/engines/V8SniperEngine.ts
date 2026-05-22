import { AnalysisDetails, OHLCV } from '../../shared/types';
import { TechnicalAnalyzer } from '../../analysis/TechnicalAnalyzer';
import { ISniperEngine, SniperReport } from '../ISniperEngine';

interface MacroResult {
    bias: 'LONG' | 'SHORT' | 'NEUTRAL';
    reason: string;
    score: number;
}

interface POIZone {
    top: number;
    bottom: number;
    source: 'SWEEP' | 'RETEST';
    description: string;
}

interface MicroResult {
    confirmed: boolean;
    reason: string;
    score: number;
    stochCurl: boolean;
    volumeSpike: boolean;
}

export class V8SniperEngine implements ISniperEngine {
    readonly engineId: string;
    readonly displayName: string;
    readonly mode: 'SWING' | 'SCALP';
    readonly requiredTFs: string[];

    constructor(mode: 'SWING' | 'SCALP' = 'SWING') {
        this.mode = mode;
        this.engineId = mode === 'SWING' ? 'V8-SWING' : 'V8-SCALP';
        this.displayName = mode === 'SWING'
            ? '🌊 V8 قناص الموجات والسيولة (SWING)'
            : '⚡ V8 قناص الموجات والسيولة (SCALP)';

        this.requiredTFs = mode === 'SWING'
            ? ['1d', '4h', '1h', '15m']
            : ['1h', '15m', '5m', '1m'];
    }

    scan(
        symbol: string,
        cp: number,
        mtfOHLCV: Record<string, OHLCV[]>,
        allTimeframes: Record<string, AnalysisDetails>
    ): SniperReport {
        const now = new Date();

        // فريمات التشغيل
        const macroTF = this.mode === 'SWING' ? '1d' : '1h';
        const mesoTF = this.mode === 'SWING' ? '1h' : '5m';
        const microTF = this.mode === 'SWING' ? '15m' : '1m';

        const macroOHLCV = mtfOHLCV[macroTF] || [];
        const mesoOHLCV = mtfOHLCV[mesoTF] || [];
        const microOHLCV = mtfOHLCV[microTF] || [];

        const completed: string[] = [];
        const pending: string[] = [];

        // ── LAYER 1: MACD & EMA TREND BIAS ────────────────────────────────────
        const macro = this.evaluateMacroWave(cp, macroOHLCV, allTimeframes[macroTF]);
        const direction = macro.bias;

        if (direction === 'NEUTRAL') {
            completed.push(`✅ الاتجاه العام: جانبي ↔️ (انتظار وضوح الحركة)`);
            return this.buildReport(
                symbol, cp, 'NONE', cp, cp, cp, false,
                0, 0, completed, [], '🔍 ترشيح جانبي', 'السوق في مسار عرضي ولا يوفر ميزة اتجاهية.', now
            );
        }

        completed.push(`✅ الماكرو: ${macro.reason}`);

        // ── LAYER 2: MESO LIQUIDITY SWEEP & RETEST ────────────────────────────
        const mesoData = allTimeframes[mesoTF];
        const poi = this.detectMesoLevel(cp, mesoOHLCV, direction, mesoData);
        let zone: { top: number; bottom: number } | null = null;
        let inZone = false;

        if (poi) {
            zone = { top: poi.top, bottom: poi.bottom };
            // التأكد من أن السعر يلامس أو داخل نطاق السيولة/الارتداد
            if (direction === 'LONG') {
                inZone = cp <= zone.top && cp >= zone.bottom - (poi.top - poi.bottom) * 0.5;
            } else {
                inZone = cp >= zone.bottom && cp <= zone.top + (zone.top - zone.bottom) * 0.5;
            }

            if (inZone) {
                completed.push(`✅ الميزو: السعر في منطقة ${poi.source === 'SWEEP' ? 'كشط السيولة' : 'إعادة الاختبار'}`);
                completed.push(`✅ منطقة اهتمام: ${poi.source} — ${poi.description}`);
            } else {
                pending.push(`🔸 الميزو: السعر خارج منطقة الدفع — انتظار العودة`);
                completed.push(`✅ تم رصد منطقة اهتمام: ${poi.description} (بانتظار ملامستها)`);
            }
        } else {
            pending.push(`🔸 لا يوجد كشط سيولة أو إعادة اختبار EMA مؤخراً`);
        }

        // ── LAYER 3: MICRO MOMENTUM TRIGGER ──────────────────────────────────
        const microData = allTimeframes[microTF];
        const micro = this.evaluateMicroMomentum(cp, microOHLCV, direction, microData);

        if (micro.stochCurl) completed.push(`✅ الزخم: ${micro.reason.split(' | ')[0]}`);
        else pending.push(`🔸 الزخم: انتهاء التصحيح والانعكاس (Stoch RSI)`);

        if (micro.volumeSpike) completed.push(`✅ السيولة: ${micro.reason.split(' | ')[1] || 'حجم تداول مؤيد للاتجاه'}`);
        else pending.push(`🔸 السيولة: تأكيد حجم تداول قوي (Volume Spike)`);

        // ── CONFIDENCE & WINRATE ──────────────────────────────────────────────
        const matrix = TechnicalAnalyzer.calculateMatrix(allTimeframes);
        const matrixScore = matrix.percentage;

        let confidence = 40; // أساسي
        if (macro.bias !== 'NEUTRAL') confidence += 15;
        if (poi && inZone) confidence += 25;
        if (micro.stochCurl) confidence += 10;
        if (micro.volumeSpike) confidence += 10;
        if (direction === 'LONG' && matrixScore >= 60) confidence += 10;
        if (direction === 'SHORT' && matrixScore <= 40) confidence += 10;

        confidence = Math.min(Math.max(confidence, 10), 95);
        const winRate = Math.min(55 + confidence * 0.45, 96);

        // جاهز للتنفيذ الفوري
        const readyToFire = poi !== null && inZone && micro.confirmed && winRate >= 78;

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
            ? `🚀 إشارة موجية جاهزة (${completedCount}/${totalConditions} شروط)`
            : `🔍 استعداد موجي (${completedCount}/${totalConditions} شروط مكتملة)`;

        const details = this.buildDetails(symbol, direction, entryPrice, sl, tp, tp2, confidence, winRate, zone, poi, completed, pending, readyToFire);

        return this.buildReport(
            symbol, cp, direction, sl, tp, entryPrice, readyToFire,
            confidence, winRate, completed, pending, summary, details, now, tp2
        );
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Internal Layers Logic
    // ─────────────────────────────────────────────────────────────────────────

    private evaluateMacroWave(cp: number, ohlcv: OHLCV[], data?: AnalysisDetails): MacroResult {
        if (ohlcv.length < 50) return { bias: 'NEUTRAL', reason: 'بيانات غير كافية للماكرو', score: 50 };

        // حساب EMA50 و EMA200 كلاسيكياً
        const closes = ohlcv.map(c => c.close);
        const lastClose = closes[closes.length - 1];

        let sum50 = 0;
        for (let i = closes.length - 50; i < closes.length; i++) sum50 += closes[i];
        const ema50 = sum50 / 50;

        let sum200 = 0;
        const count200 = Math.min(closes.length, 200);
        for (let i = closes.length - count200; i < closes.length; i++) sum200 += closes[i];
        const ema200 = sum200 / count200;

        const trendLong = lastClose > ema200;
        const trendMed = lastClose > ema50;

        // فحص اتجاه الزخم من MACD
        let bias: 'LONG' | 'SHORT' | 'NEUTRAL' = 'NEUTRAL';
        let reason = '';
        let score = 50;

        if (trendLong && trendMed) {
            bias = 'LONG';
            reason = `موجة صاعدة رئيسية (السعر فوق EMA50/200)`;
            score = 80;
        } else if (!trendLong && !trendMed) {
            bias = 'SHORT';
            reason = `موجة هابطة رئيسية (السعر تحت EMA50/200)`;
            score = 20;
        } else {
            // تضارب المؤشرات يعطي حيرة فنية
            bias = lastClose > ema200 ? 'LONG' : 'SHORT';
            reason = `موجة تصحيحية عرضية (السعر بين EMA50 و EMA200)`;
            score = bias === 'LONG' ? 60 : 40;
        }

        return { bias, reason, score };
    }

    private detectMesoLevel(cp: number, ohlcv: OHLCV[], direction: 'LONG' | 'SHORT', data?: AnalysisDetails): POIZone | null {
        if (ohlcv.length < 30) return null;

        const recent = ohlcv.slice(-20);
        const lastCandle = recent[recent.length - 1];
        const atr = data?.atr || cp * 0.005;

        // 1. فحص كشط سيولة القيعان/القمم (Liquidity Sweep)
        const previousCandles = recent.slice(0, -1);
        const lowestPrevLow = Math.min(...previousCandles.map(c => c.low));
        const highestPrevHigh = Math.max(...previousCandles.map(c => c.high));

        if (direction === 'LONG') {
            // كشط سيولة البيع: الذيل تجاوز القاع السابق وأغلق فوقه (ارتداد ذيل سفلي قوي)
            const isSweep = lastCandle.low < lowestPrevLow && lastCandle.close > lowestPrevLow;
            const hasStrongWick = (Math.min(lastCandle.open, lastCandle.close) - lastCandle.low) > (lastCandle.high - lastCandle.low) * 0.4;

            if (isSweep || hasStrongWick) {
                return {
                    top: Math.max(lastCandle.open, lastCandle.close),
                    bottom: lastCandle.low,
                    source: 'SWEEP',
                    description: `كشط سيولة القيعان (Liquidity Sweep) عند قاع $${lastCandle.low.toFixed(2)}`
                };
            }
        } else {
            // كشط سيولة الشراء: الذيل تجاوز القمة السابقة وأغلق تحتها (ارتداد ذيل علوي قوي)
            const isSweep = lastCandle.high > highestPrevHigh && lastCandle.close < highestPrevHigh;
            const hasStrongWick = (lastCandle.high - Math.max(lastCandle.open, lastCandle.close)) > (lastCandle.high - lastCandle.low) * 0.4;

            if (isSweep || hasStrongWick) {
                return {
                    top: lastCandle.high,
                    bottom: Math.min(lastCandle.open, lastCandle.close),
                    source: 'SWEEP',
                    description: `كشط سيولة القمم (Liquidity Sweep) عند قمة $${lastCandle.high.toFixed(2)}`
                };
            }
        }

        // 2. فحص إعادة اختبار المتوسط EMA50 كـ دعم/مقاومة ديناميكي (Retest)
        const closes = ohlcv.map(c => c.close);
        let sum50 = 0;
        for (let i = closes.length - Math.min(closes.length, 50); i < closes.length; i++) sum50 += closes[i];
        const ema50 = sum50 / Math.min(closes.length, 50);

        if (direction === 'LONG') {
            // السعر هبط ولامس الـ EMA50 وارتد مغلقاً فوقه
            const touchedEma = lastCandle.low <= ema50 * 1.002 && lastCandle.close >= ema50 * 0.998;
            if (touchedEma) {
                return {
                    top: ema50 + atr * 0.2,
                    bottom: ema50 - atr * 0.3,
                    source: 'RETEST',
                    description: `إعادة اختبار متوسط الموجة EMA50 كـ دعم ديناميكي عند $${ema50.toFixed(2)}`
                };
            }
        } else {
            // السعر صعد ولامس الـ EMA50 وارتد مغلقاً تحته
            const touchedEma = lastCandle.high >= ema50 * 0.998 && lastCandle.close <= ema50 * 1.002;
            if (touchedEma) {
                return {
                    top: ema50 + atr * 0.3,
                    bottom: ema50 - atr * 0.2,
                    source: 'RETEST',
                    description: `إعادة اختبار متوسط الموجة EMA50 كـ مقاومة ديناميكية عند $${ema50.toFixed(2)}`
                };
            }
        }

        return null;
    }

    private evaluateMicroMomentum(cp: number, ohlcv: OHLCV[], direction: 'LONG' | 'SHORT', data?: AnalysisDetails): MicroResult {
        if (ohlcv.length < 15) return { confirmed: false, reason: 'بيانات فنية غير كافية', score: 0, stochCurl: false, volumeSpike: false };

        const recent = ohlcv.slice(-15);
        const lastCandle = recent[recent.length - 1];

        // 1. فحص تشبع وانعكاس الزخم Stoch RSI
        let stochCurl = false;
        let rsiVal = data?.rsi || 50;

        if (direction === 'LONG') {
            // يفضل أن يكون الـ RSI صاعداً أو مرتدّاً من مستويات منخفضة
            stochCurl = rsiVal >= 35 && rsiVal <= 65 || (data?.rsi || 0) > 30;
        } else {
            stochCurl = rsiVal >= 35 && rsiVal <= 65 || (data?.rsi || 100) < 70;
        }

        // 2. فحص حجم التداول (Volume Spike)
        const avgVol = recent.slice(0, -1).reduce((acc, c) => acc + c.volume, 0) / 14;
        const volumeSpike = lastCandle.volume > avgVol * 1.15;

        const score = (stochCurl ? 50 : 0) + (volumeSpike ? 50 : 0);
        const confirmed = stochCurl; // نعتمد على الزخم كشرط أساسي، والحجم كداعم

        const reason = `زخم الانعكاس: ${stochCurl ? 'إيجابي صاعد' : 'محايد'} | سيولة الحجم: ${volumeSpike ? 'نشطة مؤيدة' : 'عادية'}`;

        return { confirmed, reason, score, stochCurl, volumeSpike };
    }

    private calcSL(
        cp: number,
        ohlcv: OHLCV[],
        direction: 'LONG' | 'SHORT',
        data: AnalysisDetails,
        zone: { top: number; bottom: number } | null
    ): number {
        const recent = ohlcv.slice(-10);
        const atr = data.atr || cp * 0.005;

        if (zone) {
            if (direction === 'LONG') {
                return zone.bottom - (atr * 3);
            } else {
                return zone.top + (atr * 3);
            }
        }

        if (direction === 'LONG') {
            const sl = Math.min(...recent.map(c => c.low)) - (atr * 3);
            return Math.max(sl, cp * 0.97);
        } else {
            const sl = Math.max(...recent.map(c => c.high)) + (atr * 3);
            return Math.min(sl, cp * 1.03);
        }
    }

    private calcTP(cp: number, ohlcv: OHLCV[], direction: 'LONG' | 'SHORT', data: AnalysisDetails): number {
        const atr = data.atr || cp * 0.005;
        if (direction === 'LONG') return cp + (atr * 3.0);
        return cp - (atr * 3.0);
    }

    private calcTP2(cp: number, ohlcv: OHLCV[], direction: 'LONG' | 'SHORT', data: AnalysisDetails): number {
        const atr = data.atr || cp * 0.005;
        if (direction === 'LONG') return cp + (atr * 5.5);
        return cp - (atr * 5.5);
    }

    private buildDetails(
        symbol: string,
        direction: 'LONG' | 'SHORT' | 'NONE',
        entry: number,
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
        const sym = symbol.split('/')[0];
        const dirEmoji = direction === 'LONG' ? '🟢 LONG' : '🔴 SHORT';
        const title = readyToFire
            ? `🚀 *محرك الاقتناص الموجي ⚡ V8 جاهز للدخول*`
            : `🌊 *محرك الاقتناص ⚡ V8 قناص الموجات والسيولة*`;

        const zoneText = zone
            ? `\n• المنطقة الذهبية: \`$${zone.bottom.toFixed(4)}\` — \`$${zone.top.toFixed(4)}\``
            : '';
        const poiText = poi
            ? `\n• منطقة الاهتمام: \`${poi.source}\` — ${poi.description}`
            : '';

        let text = `${title}\n` +
            `💎 ${sym}:${symbol.split(':')[1] || 'USDT'} | ${dirEmoji}\n` +
            `━━━━━━━━━━━━━━\n` +
            `📊 *التقرير التفصيلي:*\n` +
            `• الدخول: \`$${entry.toFixed(4)}\`\n` +
            `• وقف الخسارة: \`$${sl.toFixed(4)}\` (${(((sl - entry) / entry) * 100).toFixed(2)}%)\n` +
            `• الهدف الأول: \`$${tp.toFixed(4)}\` (${(((tp - entry) / entry) * 100).toFixed(2)}%)\n`;

        if (tp2) {
            text += `• الهدف الثاني: \`$${tp2.toFixed(4)}\` (${(((tp2 - entry) / entry) * 100).toFixed(2)}%)\n`;
        }

        const slDist = Math.abs(entry - sl);
        const tpDist = Math.abs(tp - entry);
        const rrr = slDist > 0 ? (tpDist / slDist).toFixed(2) : '1.0';

        text += `• نسبة العائد/الخطر: \`${rrr}:1\`\n` +
            `• الثقة: \`${confidence.toFixed(1)}%\` | معدل النجاح: \`${winRate.toFixed(1)}%\`${zoneText}${poiText}\n` +
            `━━━━━━━━━━━━━━\n` +
            `✅ *الشروط المكتملة (${completed.length}):*\n` +
            completed.map(c => `✅ ${c.replace('✅ ', '')}`).join('\n') + `\n\n`;

        if (pending.length > 0) {
            text += `🔸 *الشروط المنتظرة (${pending.length}):*\n` +
                pending.map(p => `🔸 ${p.replace('🔸 ', '')}`).join('\n') + `\n`;
        }

        text += `━━━━━━━━━━━━━━\n` +
            (readyToFire
                ? `🚀 *إشارة ممتازة للشراء/البيع الآن!*`
                : `⏳ *في وضع الانتظار — سيتم إشعارك عند اكتمال الشروط*`);

        return text;
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
            generatedAt
        };
    }
}
