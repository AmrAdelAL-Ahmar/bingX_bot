import { AnalysisDetails, OHLCV } from '../../shared/types';
import { TechnicalAnalyzer } from '../../analysis/TechnicalAnalyzer';
import { ISniperEngine, SniperReport } from '../ISniperEngine';
import { BollingerBands } from 'technicalindicators';

export class V14SniperEngine implements ISniperEngine {
    readonly engineId: string;
    readonly displayName: string;
    readonly mode: 'SWING' | 'SCALP';
    readonly requiredTFs: string[];

    constructor(mode: 'SWING' | 'SCALP' = 'SWING') {
        this.mode = mode;
        this.engineId = mode === 'SWING' ? 'V14-SWING' : 'V14-SCALP';
        this.displayName = mode === 'SWING'
            ? '🏆 V14 قناص الشبكة العرضية والتحكيم الإحصائي (SWING)'
            : '⚡ V14 قناص الشبكة العرضية والتحكيم الإحصائي (SCALP)';
        this.requiredTFs = mode === 'SWING'
            ? ['4h', '1h', '15m']
            : ['1h', '15m', '5m'];
    }

    scan(
        symbol: string,
        cp: number,
        mtfOHLCV: Record<string, OHLCV[]>,
        allTimeframes: Record<string, AnalysisDetails>
    ): SniperReport {
        const now = new Date();
        const completed: string[] = [];
        const pending: string[] = [];

        const quickKey = this.mode === 'SWING' ? '15m' : '5m';
        const ohlcv = mtfOHLCV[quickKey] || [];

        if (ohlcv.length < 100) {
            return this.noSignal(symbol, cp, 'بيانات غير كافية لـ V14 (تحتاج 100 شمعة على الأقل)', now);
        }

        // 1. Calculate Z-Score
        const closes = ohlcv.slice(-100).map(c => c.close);
        const { zScore, mean, stdDev } = this.calculateZScore(closes, cp);

        // 2. Overbought / Oversold statistical trigger
        let direction: 'LONG' | 'SHORT' | 'NONE' = 'NONE';
        let confidence = 30;

        if (zScore <= -2.5) {
            direction = 'LONG';
            confidence += 45;
            completed.push(`✅ تم رصد انحراف إحصائي سالب حاد Z-Score (${zScore.toFixed(2)}) <= -2.5 (فرصة شراء للارتداد)`);
        } else if (zScore >= 2.5) {
            direction = 'SHORT';
            confidence += 45;
            completed.push(`✅ تم رصد انحراف إحصائي موجب حاد Z-Score (${zScore.toFixed(2)}) >= 2.5 (فرصة بيع للارتداد)`);
        } else {
            pending.push(`⏳ انتظار انحراف السعر إحصائياً لأطراف القيمة المعيارية (Z-Score الحالي: ${zScore.toFixed(2)})`);
        }

        // 3. Stop loss and target calculations (Mean Reversion)
        const execData = allTimeframes[quickKey];
        const atr = execData?.atr || cp * 0.005;
        const sl = direction === 'LONG' ? cp - atr * 2.0 : cp + atr * 2.0;
        const tp = mean; // Reversion target is the mean of 100 candles

        confidence = Math.min(Math.max(confidence, 10), 95);
        const winRate = Math.min(55 + confidence * 0.40, 96);
        const readyToFire = direction !== 'NONE' && confidence >= 70;

        const summary = readyToFire
            ? `🚀 V14 جاهز للاقتناص (${completed.length} شروط مكتملة)`
            : `⏳ مراقبة V14 (${completed.length} شروط مكتملة)`;

        const details = this.buildDetails(symbol, direction, cp, sl, tp, confidence, winRate, completed, pending, readyToFire);

        return {
            symbol,
            engineId: this.engineId,
            direction,
            entry: cp,
            sl,
            tp,
            readyToFire,
            confidence,
            winRate,
            completedConditions: completed,
            pendingConditions: pending,
            summary,
            details,
            generatedAt: now
        };
    }

    private calculateZScore(values: number[], currentVal: number): { zScore: number; mean: number; stdDev: number } {
        const len = values.length;
        if (len === 0) return { zScore: 0, mean: 0, stdDev: 0 };
        const mean = values.reduce((sum, v) => sum + v, 0) / len;
        const variance = values.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / len;
        const stdDev = Math.sqrt(variance) || 0.0001;
        const zScore = (currentVal - mean) / stdDev;
        return { zScore, mean, stdDev };
    }

    private buildDetails(
        symbol: string,
        direction: 'LONG' | 'SHORT' | 'NONE',
        entry: number,
        sl: number,
        tp: number,
        confidence: number,
        winRate: number,
        completed: string[],
        pending: string[],
        readyToFire: boolean
    ): string {
        const sym = symbol.split('/')[0];
        const dirText = direction === 'LONG' ? '🟢 LONG' : '🔴 SHORT';
        const title = `🏆 *محرك قناص الشبكة العرضية V14 (${this.mode})*`;

        let text = `${title}\n🪙 ${sym}/USDT | ${dirText}\n━━━━━━━━━━━━━━\n`;
        text += `• نسبة الثقة: \`${confidence}%\` | النجاح المتوقع: \`${winRate.toFixed(0)}%\`\n\n`;
        text += `🎯 *المستويات المقترحة (العودة للمتوسط):*\n` +
            `• الدخول: \`$${entry.toFixed(4)}\`\n` +
            `• الستوب (SL): \`$${sl.toFixed(4)}\`\n` +
            `• الهدف (TP): \`$${tp.toFixed(4)}\`\n\n`;

        text += `✅ *الشروط المكتملة (${completed.length}):*\n` +
            completed.map(c => `• ${c.replace('✅ ', '')}`).join('\n') + `\n\n`;

        if (pending.length > 0) {
            text += `⏳ *الشروط المنتظرة (${pending.length}):*\n` +
                pending.map(p => `• ${p.replace('⏳ ', '')}`).join('\n') + `\n`;
        }

        text += `━━━━━━━━━━━━━━\n` + (readyToFire
            ? `🚀 *تم رصد ارتداد من الأطراف، جاهز للاقتناص والعودة للمتوسط!*`
            : `⏳ *في انتظار انحسار الحركة العرضية والوصول للنطاق...*`);

        return text;
    }

    private noSignal(symbol: string, cp: number, reason: string, now: Date): SniperReport {
        return {
            symbol,
            engineId: this.engineId,
            direction: 'NONE',
            entry: cp,
            sl: cp * 0.95,
            tp: cp * 1.05,
            readyToFire: false,
            confidence: 0,
            winRate: 0,
            completedConditions: [],
            pendingConditions: [reason],
            summary: `❌ لا توجد إشارة لـ V14 (${reason})`,
            details: `🏆 *${this.displayName}*\n\n🔍 لا توجد إشارات عرضية حالياً.`,
            generatedAt: now
        };
    }
}
