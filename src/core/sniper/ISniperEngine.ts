import { AnalysisDetails, OHLCV } from '../shared/types';

// ─── Sniper Report ─────────────────────────────────────────────────────────────
// يُصدره كل محرك اقتناص — يُفصّل حالة الشروط حتى بدون إشارة نهائية

export interface SniperReport {
    /** رمز العملة */
    symbol: string;
    /** محرك الاقتناص المستخدم */
    engineId: string;
    /** اتجاه الصفقة المقترح */
    direction: 'LONG' | 'SHORT' | 'NONE';
    /** نقطة الدخول المثالية */
    entry: number;
    /** وقف الخسارة */
    sl: number;
    /** الهدف الأول */
    tp: number;
    /** الهدف الثاني (اختياري) */
    tp2?: number;
    /** هل الزناد جاهز للدخول الآن؟ */
    readyToFire: boolean;
    /** نسبة الثقة 0–100 */
    confidence: number;
    /** نسبة النجاح المتوقعة */
    winRate: number;
    /** شروط الدخول المكتملة */
    completedConditions: string[];
    /** شروط الدخول التي لم تكتمل بعد */
    pendingConditions: string[];
    /** ملخص حالة الصفقة (للتقرير) */
    summary: string;
    /** وصف تفصيلي (للإشعار) */
    details: string;
    /** وقت توليد التقرير */
    generatedAt: Date;
}

// ─── Sniper Engine Interface ───────────────────────────────────────────────────

export interface ISniperEngine {
    /** اسم المحرك (مثل: 'V7-SWING') */
    readonly engineId: string;
    /** الاسم العربي للعرض */
    readonly displayName: string;
    /** وضع التداول */
    readonly mode: 'SWING' | 'SCALP';
    /** الفريمات المطلوبة لهذا المحرك */
    readonly requiredTFs: string[];

    /**
     * تشغيل محرك الاقتناص وإصدار تقرير شامل
     * يُصدر تقريراً حتى لو الشروط لم تكتمل (تقرير "استعداد")
     */
    scan(
        symbol: string,
        currentPrice: number,
        mtfOHLCV: Record<string, OHLCV[]>,
        allTimeframes: Record<string, AnalysisDetails>
    ): SniperReport;
}
