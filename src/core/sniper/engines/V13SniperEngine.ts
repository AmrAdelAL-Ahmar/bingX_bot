import { AnalysisDetails, OHLCV } from '../../shared/types';
import { TechnicalAnalyzer } from '../../analysis/TechnicalAnalyzer';
import { ISniperEngine, SniperReport } from '../ISniperEngine';

export class V13SniperEngine implements ISniperEngine {
    readonly engineId: string;
    readonly displayName: string;
    readonly mode: 'SWING' | 'SCALP';
    readonly requiredTFs: string[];

    constructor(mode: 'SWING' | 'SCALP' = 'SWING') {
        this.mode = mode;
        this.engineId = mode === 'SWING' ? 'V13-SWING' : 'V13-SCALP';
        this.displayName = mode === 'SWING'
            ? '🏆 V13 قناص وايكوف ومصائد السيولة الهيكلية (SWING)'
            : '⚡ V13 قناص وايكوف ومصائد السيولة الهيكلية (SCALP)';
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

        if (ohlcv.length < 25) {
            return this.noSignal(symbol, cp, 'بيانات غير كافية لـ V13', now);
        }

        // 1. Detect Liquidity Sweep (Wyckoff Spring or Upthrust)
        const recent = ohlcv.slice(-25, -1);
        const highestHigh = Math.max(...recent.map(c => c.high));
        const lowestLow = Math.min(...recent.map(c => c.low));
        const last = ohlcv[ohlcv.length - 1];

        // Volume Spike confirmation: last candle volume must be > 1.5x of previous 20-candle average
        const recentForVolume = ohlcv.slice(-21, -1);
        const avgVolume = recentForVolume.reduce((sum, c) => sum + c.volume, 0) / (recentForVolume.length || 1);
        const isVolumeSpike = last.volume > avgVolume * 1.5;

        let direction: 'LONG' | 'SHORT' | 'NONE' = 'NONE';
        let confidence = 30;

        if (last.low < lowestLow && last.close > lowestLow) {
            direction = 'LONG';
            confidence += 40;
            completed.push(`✅ تم رصد Wyckoff Spring: السعر سحب سيولة القاع السابق ($${lowestLow.toFixed(4)}) وارتد مغلقاً أعلاه`);
        } else if (last.high > highestHigh && last.close < highestHigh) {
            direction = 'SHORT';
            confidence += 40;
            completed.push(`✅ تم رصد Wyckoff Upthrust: السعر سحب سيولة القمة السابقة ($${highestHigh.toFixed(4)}) وارتد مغلقاً أدناها`);
        } else {
            pending.push('⏳ في انتظار حدوث كسر كاذب وسحب سيولة للقمم أو القيعان الهيكلية');
        }

        if (direction !== 'NONE') {
            if (isVolumeSpike) {
                confidence += 15;
                completed.push(`✅ تم تأكيد طفرة أحجام التداول: الحجم الحالي (${last.volume.toFixed(0)}) > 1.5x من المتوسط (${avgVolume.toFixed(0)})`);
            } else {
                pending.push(`⏳ انتظار تأكيد طفرة أحجام التداول (الحجم الحالي ${last.volume.toFixed(0)}، المتوسط المطلق ${avgVolume.toFixed(0)})`);
            }
        }

        // 2. Confluence with multi-timeframe matrix
        const matrix = TechnicalAnalyzer.calculateMatrix(allTimeframes);
        const matrixOk = direction === 'LONG' ? matrix.percentage >= 55 : matrix.percentage <= 45;
        if (direction !== 'NONE') {
            if (matrixOk) {
                confidence += 10;
                completed.push(`✅ توافق مصفوفة الاتجاه للفريمات بنسبة: ${matrix.percentage.toFixed(0)}%`);
            } else {
                pending.push(`⏳ انتظار توافق المصفوفة مع اتجاه الصفقة (الماتريكس الحالي: ${matrix.percentage.toFixed(0)}%)`);
            }
        }

        // 3. Stop loss and target calculations (Tight stop loss below/above the sweep wick)
        const sl = direction === 'LONG' ? last.low * 0.998 : last.high * 1.002;
        const execData = allTimeframes[quickKey];
        const atr = execData?.atr || cp * 0.005;
        const tp = direction === 'LONG' ? cp + atr * 4 : cp - atr * 4;

        confidence = Math.min(Math.max(confidence, 10), 95);
        const winRate = Math.min(50 + confidence * 0.45, 96);
        const readyToFire = direction !== 'NONE' && confidence >= 65 && matrixOk && isVolumeSpike;

        const summary = readyToFire
            ? `🚀 V13 جاهز للاقتناص (${completed.length} شروط مكتملة)`
            : `⏳ مراقبة V13 (${completed.length} شروط مكتملة)`;

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
        const title = `🏆 *محرك قناص وايكوف ومصائد السيولة الهيكلية V13 (${this.mode})*`;

        let text = `${title}\n🪙 ${sym}/USDT | ${dirText}\n━━━━━━━━━━━━━━\n`;
        text += `• نسبة الثقة: \`${confidence}%\` | النجاح المتوقع: \`${winRate.toFixed(0)}%\`\n\n`;
        text += `🎯 *المستويات المقترحة:*\n` +
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
            ? `🚀 *تم رصد الكشط الهيكلي وامتصاص العروض، جاهز للتنفيذ!*`
            : `⏳ *في انتظار حدوث كشط سيولة مؤكد...*`);

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
            summary: `❌ لا توجد إشارة لـ V13 (${reason})`,
            details: `🏆 *${this.displayName}*\n\n🔍 لا توجد إشارات سحب سيولة حالياً.`,
            generatedAt: now
        };
    }
}
