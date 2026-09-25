import { ISniperEngine, SniperReport } from '../ISniperEngine';
import { AnalysisDetails, OHLCV } from '../../shared/types';
import { DynamicZigZag, HarmonicPatternDetector, HarmonicConfirmator } from '../../shared/harmonic';

export class HarmonicSniperEngine implements ISniperEngine {
    readonly engineId: string;
    readonly displayName: string;
    readonly mode: 'SWING' | 'SCALP';
    readonly requiredTFs: string[];

    constructor(mode: 'SWING' | 'SCALP' = 'SCALP') {
        this.mode = mode;
        this.engineId = mode === 'SWING' ? 'HARMONIC-SWING' : 'HARMONIC-SCALP';
        this.displayName = mode === 'SWING'
            ? '🎯 قناص الهارمونيك الشامل (سوينغ - 11 نموذجاً)'
            : '⚡ قناص الهارمونيك الشامل (مضاربة - 11 نموذجاً)';
        this.requiredTFs = mode === 'SWING' ? ['1h', '4h', '1d'] : ['5m', '15m', '1h'];
    }

    scan(
        symbol: string,
        currentPrice: number,
        mtfOHLCV: Record<string, OHLCV[]>,
        allTimeframes: Record<string, AnalysisDetails>
    ): SniperReport {
        const primaryTF = this.mode === 'SWING' ? '1h' : '5m';
        const candles = mtfOHLCV[primaryTF] || mtfOHLCV['5m'] || [];
        const details = allTimeframes[primaryTF] || allTimeframes['5m'];

        const completedConditions: string[] = [];
        const pendingConditions: string[] = [];

        if (candles.length < 25) {
            return this.buildPendingReport(symbol, currentPrice, 'بيانات الشموع غير كافية لحساب نماذج الهارمونيك');
        }

        // 1. Swing calculation
        const swings = DynamicZigZag.findSwings(candles, this.mode === 'SWING' ? 1.9 : 1.5, 2);
        if (swings.length < 4) {
            return this.buildPendingReport(symbol, currentPrice, 'لم يتم رصد 4 قمم وقيعان متتالية كافية لتشكيل أضلاع الهارمونيك');
        }
        completedConditions.push(`تم رصد ${swings.length} قمة وقاع عبر ATR ZigZag`);

        // 2. Pattern detection
        const matches = HarmonicPatternDetector.detectPatterns(swings, currentPrice);
        if (matches.length === 0) {
            return this.buildPendingReport(symbol, currentPrice, 'لا توجد نسب توافقية مطابقة للنماذج الـ 11 الحالية');
        }

        let best = matches[0];
        completedConditions.push(`اكتشاف نموذج ${best.pattern} (${best.direction}) بنسبة تطابق ${best.score.toFixed(0)}%`);

        // 3. Confirmation check
        const rsi = details ? details.rsi : 50;
        best = HarmonicConfirmator.confirm(best, candles, rsi);

        const inPRZ = best.status === 'IN_PRZ' || best.status === 'CONFIRMED';
        if (inPRZ) {
            completedConditions.push(`السعر داخل منطقة الانعكاس المحتملة PRZ: [${best.prz.min.toFixed(4)} - ${best.prz.max.toFixed(4)}]`);
        } else {
            pendingConditions.push(`انتظار وصول السعر لمنطقة PRZ: [${best.prz.min.toFixed(4)} - ${best.prz.max.toFixed(4)}]`);
        }

        if (best.confirmation?.reversalCandle && best.confirmation.reversalCandle !== 'NONE') {
            completedConditions.push(`شمعة انعكاسية مؤكدة: ${best.confirmation.reversalCandle}`);
        } else {
            pendingConditions.push('انتظار تشكل شمعة انعكاسية داخل الـ PRZ');
        }

        if (best.confirmation?.volumeAbsorption) {
            completedConditions.push(`امتصاص سيولة ملحوظ بالحجم (${best.confirmation.volumeRatio}x من المعدل)`);
        }

        const readyToFire = inPRZ && (best.status === 'CONFIRMED' || best.score >= 85);

        return {
            symbol,
            engineId: this.engineId,
            direction: best.direction === 'BULLISH' ? 'LONG' : 'SHORT',
            entry: Number(best.prz.median.toFixed(4)),
            sl: Number(best.stopLoss.toFixed(4)),
            tp: Number(best.targets.tp1.toFixed(4)),
            tp2: Number(best.targets.tp2.toFixed(4)),
            readyToFire,
            confidence: best.score,
            winRate: best.score,
            completedConditions,
            pendingConditions,
            summary: readyToFire 
                ? `🔥 إشارة اقتناص جاهزة: نموذج ${best.pattern} (${best.direction}) في الـ PRZ`
                : `⏳ نموذج ${best.pattern} قيد التكوين بانتظار اكتمال الشروط`,
            details: `النموذج: ${best.pattern} | الجودة: ${best.prz.quality} | وقف الخسارة: ${best.stopLoss.toFixed(4)} | RRR: 1:${best.riskRewardRatio}`,
            generatedAt: new Date()
        };
    }

    private buildPendingReport(symbol: string, currentPrice: number, reason: string): SniperReport {
        return {
            symbol,
            engineId: this.engineId,
            direction: 'NONE',
            entry: currentPrice,
            sl: currentPrice,
            tp: currentPrice,
            readyToFire: false,
            confidence: 0,
            winRate: 50,
            completedConditions: [],
            pendingConditions: [reason],
            summary: `بانتظار تشكل نموذج توافقي: ${reason}`,
            details: reason,
            generatedAt: new Date()
        };
    }
}
