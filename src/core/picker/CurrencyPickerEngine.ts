import { RSI, ATR, MACD, SMA } from 'technicalindicators';
import { OHLCV } from '../shared/types';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface PickerResult {
    symbol: string;
    shortName: string;
    score: number;          // 0–100
    label: 'READY' | 'WATCH' | 'AVOID';
    volume24h: number;
    change24h: number;
    rsi15m: number;
    trend: string;
    reason: string;
    scannedAt: Date;
}

export interface SymbolScanData {
    symbol: string;
    shortName: string;
    ohlcv15m: OHLCV[];
    ohlcv1h: OHLCV[];
    ohlcv4h: OHLCV[];
    ticker: {
        volume: number;
        percentage: number;
        last: number;
    };
}

// ─── ScanStep Interface — قابل للتوسع مستقبلاً ────────────────────────────────

export interface ScanStep {
    name: string;
    weight: number;         // 0.0–1.0 (مجموع الكل يجب أن = 1.0)
    evaluate: (data: SymbolScanData) => number;  // يُعيد 0–100
}

// ─── خطوات الفحص الافتراضية ─────────────────────────────────────────────────

/**
 * خطوة 1: حجم التداول النسبي (Volume)
 * يُقيّم الحجم اليومي مقارنة بالحد الأدنى للسيولة
 */
const VolumeStep: ScanStep = {
    name: 'Volume',
    weight: 0.15,
    evaluate: (data: SymbolScanData): number => {
        const vol = data.ticker.volume;
        if (vol <= 0) return 0;
        // حجم ممتاز: فوق 500M — حجم مقبول: فوق 10M
        if (vol >= 500_000_000) return 100;
        if (vol >= 100_000_000) return 80;
        if (vol >= 50_000_000) return 60;
        if (vol >= 10_000_000) return 40;
        if (vol >= 1_000_000) return 20;
        return 5;
    }
};

/**
 * خطوة 2: مؤشر RSI على الـ 15m
 * أفضل مناطق: RSI 30–45 (شراء) أو 55–70 (بيع) — تجنب التشبع
 */
const RSIStep: ScanStep = {
    name: 'RSI',
    weight: 0.20,
    evaluate: (data: SymbolScanData): number => {
        const { ohlcv15m } = data;
        if (!ohlcv15m || ohlcv15m.length < 20) return 50;

        const closes = ohlcv15m.map(c => c.close);
        const rsiValues = RSI.calculate({ period: 14, values: closes });
        const rsi = rsiValues[rsiValues.length - 1];

        if (rsi === undefined) return 50;

        // أفضل مناطق: قرب من التشبع البيعي أو الشرائي (فرصة انعكاس)
        if (rsi >= 35 && rsi <= 45) return 100;  // منطقة شراء ممتازة
        if (rsi >= 55 && rsi <= 65) return 100;  // منطقة بيع ممتازة
        if (rsi >= 25 && rsi <= 55) return 80;
        if (rsi >= 55 && rsi <= 75) return 80;
        if (rsi < 25) return 60;  // تشبع بيعي حاد — فرصة محتملة لكن خطر
        if (rsi > 75) return 40;  // تشبع شرائي حاد
        return 50;
    }
};

/**
 * خطوة 3: MACD Histogram على الـ 1h
 * يُقيّم وجود زخم اتجاهي واضح
 */
const MACDStep: ScanStep = {
    name: 'MACD',
    weight: 0.20,
    evaluate: (data: SymbolScanData): number => {
        const { ohlcv1h } = data;
        if (!ohlcv1h || ohlcv1h.length < 30) return 50;

        const closes = ohlcv1h.map(c => c.close);
        const macdValues = MACD.calculate({
            values: closes,
            fastPeriod: 12,
            slowPeriod: 26,
            signalPeriod: 9,
            SimpleMAOscillator: false,
            SimpleMASignal: false
        });

        const last = macdValues[macdValues.length - 1];
        const prev = macdValues[macdValues.length - 2];
        if (!last || !prev) return 50;

        const hist = last.histogram ?? 0;
        const prevHist = prev.histogram ?? 0;

        const increasing = Math.abs(hist) > Math.abs(prevHist);  // الزخم يتصاعد
        const crossover = (hist > 0 && prevHist <= 0) || (hist < 0 && prevHist >= 0); // تقاطع حديث

        if (crossover) return 100;  // تقاطع MACD — إشارة قوية جداً
        if (increasing && Math.abs(hist) > 0) return 80;
        if (!increasing && Math.abs(hist) > 0) return 50;
        return 30;
    }
};

/**
 * خطوة 4: توافق الاتجاه متعدد الأطر (Trend Alignment)
 * يُقيّم توافق الاتجاه على 15m + 1h + 4h
 */
const TrendAlignStep: ScanStep = {
    name: 'TrendAlign',
    weight: 0.25,
    evaluate: (data: SymbolScanData): number => {
        const results: boolean[] = [];

        const checkTrend = (ohlcv: OHLCV[]): boolean | null => {
            if (!ohlcv || ohlcv.length < 25) return null;
            const closes = ohlcv.map(c => c.close);
            const ma20 = SMA.calculate({ period: 20, values: closes }).slice(-1)[0];
            const last = closes[closes.length - 1];
            return last > ma20;
        };

        const t15 = checkTrend(data.ohlcv15m);
        const t1h = checkTrend(data.ohlcv1h);
        const t4h = checkTrend(data.ohlcv4h);

        if (t15 !== null) results.push(t15);
        if (t1h !== null) results.push(t1h);
        if (t4h !== null) results.push(t4h);

        if (results.length === 0) return 50;

        const aligned = results.every(r => r) || results.every(r => !r);
        const agreeCount = results.filter(r => r).length;
        const total = results.length;

        if (aligned && total >= 3) return 100;   // توافق كامل 3 أطر
        if (aligned && total >= 2) return 85;    // توافق كامل 2 إطار
        if (agreeCount === 2 && total === 3) return 65; // 2 من 3 متوافقان
        return 30; // تضارب الإشارات
    }
};

/**
 * خطوة 5: التقلب النسبي (Volatility / ATR)
 * يُقيّم نسبة ATR إلى السعر — يُفضّل حركة كافية للتداول
 */
const VolatilityStep: ScanStep = {
    name: 'Volatility',
    weight: 0.10,
    evaluate: (data: SymbolScanData): number => {
        const { ohlcv15m } = data;
        if (!ohlcv15m || ohlcv15m.length < 20) return 50;

        const highs = ohlcv15m.map(c => c.high);
        const lows = ohlcv15m.map(c => c.low);
        const closes = ohlcv15m.map(c => c.close);
        const last = closes[closes.length - 1];

        const atrValues = ATR.calculate({ period: 14, high: highs, low: lows, close: closes });
        const atr = atrValues[atrValues.length - 1];

        if (!atr || !last || last === 0) return 50;

        const atrPct = (atr / last) * 100;

        // أفضل: تقلب 0.3% – 2% لكل شمعة 15m
        if (atrPct >= 0.4 && atrPct <= 1.5) return 100;
        if (atrPct >= 0.2 && atrPct <= 3.0) return 75;
        if (atrPct < 0.2) return 30;   // راكد جداً
        if (atrPct > 3.0) return 40;   // متقلب خطر
        return 50;
    }
};

/**
 * خطوة 6: القرب من مستوى دعم/مقاومة رئيسي
 * يُقيّم مدى قرب السعر من Pivot أو مستوى Fibonacci رئيسي
 */
const LevelProximityStep: ScanStep = {
    name: 'LevelProximity',
    weight: 0.10,
    evaluate: (data: SymbolScanData): number => {
        const { ohlcv1h } = data;
        if (!ohlcv1h || ohlcv1h.length < 10) return 50;

        const recent = ohlcv1h.slice(-2);
        if (recent.length < 2) return 50;

        const prev = recent[0];
        const last = ohlcv1h[ohlcv1h.length - 1];
        const currentPrice = last.close;

        // Pivot Point الكلاسيكي
        const pivot = (prev.high + prev.low + prev.close) / 3;
        const r1 = (2 * pivot) - prev.low;
        const s1 = (2 * pivot) - prev.high;

        // Fibonacci على آخر 50 شمعة
        const fibCandles = ohlcv1h.slice(-50);
        const maxH = Math.max(...fibCandles.map(c => c.high));
        const minL = Math.min(...fibCandles.map(c => c.low));
        const diff = maxH - minL;
        const fib618 = maxH - (diff * 0.382);
        const fib382 = maxH - (diff * 0.618);

        const levels = [pivot, r1, s1, fib618, fib382];

        let minDistPct = Infinity;
        for (const lvl of levels) {
            if (lvl > 0) {
                const distPct = Math.abs(currentPrice - lvl) / currentPrice * 100;
                if (distPct < minDistPct) minDistPct = distPct;
            }
        }

        // قريب جداً من مستوى رئيسي (أقل من 0.3%) — فرصة ممتازة
        if (minDistPct < 0.3) return 100;
        if (minDistPct < 0.8) return 80;
        if (minDistPct < 1.5) return 60;
        if (minDistPct < 3.0) return 40;
        return 20;
    }
};

// ─── Pipeline الافتراضي ──────────────────────────────────────────────────────

/**
 * قائمة خطوات الفحص الافتراضية.
 * يمكن تعديل، إضافة، أو حذف أي خطوة مستقبلاً.
 * تأكد دائماً أن مجموع الأوزان = 1.0
 */
export const DEFAULT_SCAN_PIPELINE: ScanStep[] = [
    VolumeStep,        // 0.15
    RSIStep,           // 0.20
    MACDStep,          // 0.20
    TrendAlignStep,    // 0.25
    VolatilityStep,    // 0.10
    LevelProximityStep // 0.10
];

// ─── المحرك الرئيسي ─────────────────────────────────────────────────────────

export class CurrencyPickerEngine {
    private pipeline: ScanStep[];

    constructor(customPipeline?: ScanStep[]) {
        this.pipeline = customPipeline ?? DEFAULT_SCAN_PIPELINE;
    }

    /**
     * يُمرّر بيانات عملة واحدة على كل خطوات الـ Pipeline ويحسب النقاط الإجمالية.
     */
    scoreSymbol(data: SymbolScanData): PickerResult {
        let totalScore = 0;
        let totalWeight = 0;
        const reasons: string[] = [];

        for (const step of this.pipeline) {
            try {
                const stepScore = Math.max(0, Math.min(100, step.evaluate(data)));
                totalScore += stepScore * step.weight;
                totalWeight += step.weight;

                // جمع أسباب الأداء العالي
                if (stepScore >= 80) {
                    reasons.push(step.name);
                }
            } catch {
                // تجاهل الخطأ والمتابعة — لا نوقف الفحص بسبب خطوة واحدة
                totalWeight += step.weight;
            }
        }

        // تطبيع النقاط في حال كان مجموع الأوزان أقل من 1
        const finalScore = totalWeight > 0
            ? Math.round(totalScore / totalWeight)
            : 0;

        // حساب RSI للعرض
        let rsi15m = 50;
        try {
            if (data.ohlcv15m && data.ohlcv15m.length >= 20) {
                const closes = data.ohlcv15m.map(c => c.close);
                const rsiVals = RSI.calculate({ period: 14, values: closes });
                rsi15m = Math.round(rsiVals[rsiVals.length - 1] ?? 50);
            }
        } catch { /* تجاهل */ }

        // تحديد الاتجاه
        let trend = 'محايد';
        try {
            if (data.ohlcv1h && data.ohlcv1h.length >= 25) {
                const closes = data.ohlcv1h.map(c => c.close);
                const ma20 = SMA.calculate({ period: 20, values: closes }).slice(-1)[0];
                const last = closes[closes.length - 1];
                trend = last > ma20 ? 'صاعد 📈' : 'هابط 📉';
            }
        } catch { /* تجاهل */ }

        const label: PickerResult['label'] =
            finalScore >= 70 ? 'READY' :
            finalScore >= 45 ? 'WATCH' : 'AVOID';

        const reasonText = reasons.length > 0
            ? `✅ ${reasons.join(', ')}`
            : 'لا توجد إشارات قوية';

        return {
            symbol: data.symbol,
            shortName: data.shortName,
            score: finalScore,
            label,
            volume24h: data.ticker.volume,
            change24h: data.ticker.percentage,
            rsi15m,
            trend,
            reason: reasonText,
            scannedAt: new Date()
        };
    }

    /**
     * يُرتّب القائمة النهائية تنازلياً حسب النقاط.
     */
    rankResults(results: PickerResult[]): PickerResult[] {
        return [...results].sort((a, b) => b.score - a.score);
    }
}
