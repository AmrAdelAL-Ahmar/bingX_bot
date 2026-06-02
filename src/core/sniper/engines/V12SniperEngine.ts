import { AnalysisDetails, OHLCV } from '../../shared/types';
import { TechnicalAnalyzer } from '../../analysis/TechnicalAnalyzer';
import { ISniperEngine, SniperReport } from '../ISniperEngine';

export class V12SniperEngine implements ISniperEngine {
    readonly engineId: string;
    readonly displayName: string;
    readonly mode: 'SWING' | 'SCALP';
    readonly requiredTFs: string[];

    constructor(mode: 'SWING' | 'SCALP' = 'SWING') {
        this.mode = mode;
        this.engineId = mode === 'SWING' ? 'V12-SWING' : 'V12-SCALP';
        this.displayName = mode === 'SWING'
            ? '🏆 V12 قناص تدفق السيولة وعقد الأحجام (SWING)'
            : '⚡ V12 قناص تدفق السيولة وعقد الأحجام (SCALP)';
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

        if (ohlcv.length < 50) {
            return this.noSignal(symbol, cp, 'بيانات غير كافية لـ V12 (تحتاج 50 شمعة على الأقل)', now);
        }

        // 1. Calculate CVD
        const cvd: number[] = [];
        let acc = 0;
        for (const c of ohlcv) {
            const spread = c.high - c.low || 0.0001;
            const delta = ((c.close - c.open) / spread) * c.volume;
            acc += delta;
            cvd.push(acc);
        }

        // 2. CVD Divergence
        const len = ohlcv.length;
        let pivotLowIdx = len - 15;
        let pivotHighIdx = len - 15;
        
        for (let i = len - 14; i <= len - 3; i++) {
            if (ohlcv[i].low < ohlcv[pivotLowIdx].low) {
                pivotLowIdx = i;
            }
            if (ohlcv[i].high > ohlcv[pivotHighIdx].high) {
                pivotHighIdx = i;
            }
        }

        const currentLow = ohlcv[len - 1].low;
        const currentHigh = ohlcv[len - 1].high;
        const pivotLowPrice = ohlcv[pivotLowIdx].low;
        const pivotHighPrice = ohlcv[pivotHighIdx].high;

        const currentCVD = cvd[len - 1];
        const pivotLowCVD = cvd[pivotLowIdx];
        const pivotHighCVD = cvd[pivotHighIdx];

        let direction: 'LONG' | 'SHORT' | 'NONE' = 'NONE';
        let confidence = 30;

        if (currentLow < pivotLowPrice && currentCVD > pivotLowCVD) {
            direction = 'LONG';
            confidence += 35;
            completed.push(`✅ تم رصد انحراف إيجابي صاعد CVD (السعر أدنى من القاع السابق $${pivotLowPrice.toFixed(4)} بينما CVD أعلى)`);
        } else if (currentHigh > pivotHighPrice && currentCVD < pivotHighCVD) {
            direction = 'SHORT';
            confidence += 35;
            completed.push(`✅ تم رصد انحراف سلبي هابط CVD (السعر أعلى من القمة السابقة $${pivotHighPrice.toFixed(4)} بينما CVD أدنى)`);
        } else {
            pending.push('⏳ في انتظار انحراف مؤشر دلتا الأحجام التراكمية CVD');
        }

        // 3. Proximity to liquidity levels check
        let isCloseToLiquidity = false;
        if (direction !== 'NONE') {
            const recent50 = ohlcv.slice(-50);
            const maxHigh50 = Math.max(...recent50.map(c => c.high));
            const minLow50 = Math.min(...recent50.map(c => c.low));
            const range = maxHigh50 - minLow50 || 0.0001;
            const fib618 = maxHigh50 - 0.618 * range;
            const tolerance = 0.003; // 0.3%

            if (direction === 'LONG') {
                const distToSwingLow = Math.abs(cp - minLow50) / minLow50;
                const distToFib618 = Math.abs(cp - fib618) / fib618;

                if (distToSwingLow <= tolerance) {
                    isCloseToLiquidity = true;
                    completed.push(`✅ السعر قريب من مستوى قاع السيولة الرئيسي ($${minLow50.toFixed(4)})`);
                } else if (distToFib618 <= tolerance) {
                    isCloseToLiquidity = true;
                    completed.push(`✅ السعر قريب من مستوى فيبوناتشي الذهبي 61.8% ($${fib618.toFixed(4)})`);
                }
            } else {
                const distToSwingHigh = Math.abs(cp - maxHigh50) / maxHigh50;
                const distToFib618 = Math.abs(cp - fib618) / fib618;

                if (distToSwingHigh <= tolerance) {
                    isCloseToLiquidity = true;
                    completed.push(`✅ السعر قريب من مستوى قمة السيولة الرئيسية ($${maxHigh50.toFixed(4)})`);
                } else if (distToFib618 <= tolerance) {
                    isCloseToLiquidity = true;
                    completed.push(`✅ السعر قريب من مستوى فيبوناتشي الذهبي 61.8% ($${fib618.toFixed(4)})`);
                }
            }

            if (isCloseToLiquidity) {
                confidence += 20;
            } else {
                pending.push('⏳ في انتظار اقتراب السعر من مستوى سيولة رئيسي (Swing H/L أو Fib 61.8%)');
            }
        }

        // 4. Multi-timeframe Matrix Confluence
        const matrix = TechnicalAnalyzer.calculateMatrix(allTimeframes);
        const matrixOk = direction === 'LONG' ? matrix.percentage >= 60 : matrix.percentage <= 40;
        if (direction !== 'NONE') {
            if (matrixOk) {
                confidence += 10;
                completed.push(`✅ توافق مصفوفة الاتجاه العام للفريمات بنسبة: ${matrix.percentage.toFixed(0)}%`);
            } else {
                pending.push(`⏳ انتظار توافق المصفوفة مع اتجاه الصفقة (الماتريكس الحالي: ${matrix.percentage.toFixed(0)}%)`);
            }
        }

        // 5. Calculations for SL and TP
        const execData = allTimeframes[quickKey];
        const atr = execData?.atr || cp * 0.005;

        const sl = direction === 'LONG' ? cp - atr * 1.8 : cp + atr * 1.8;
        const tp = direction === 'LONG' ? cp + atr * 3.6 : cp - atr * 3.6;

        confidence = Math.min(Math.max(confidence, 10), 95);
        const winRate = Math.min(50 + confidence * 0.45, 96);
        const readyToFire = direction !== 'NONE' && confidence >= 65 && matrixOk && isCloseToLiquidity;

        const summary = readyToFire
            ? `🚀 V12 جاهز للاقتناص (${completed.length} شروط مكتملة)`
            : `⏳ مراقبة V12 (${completed.length} شروط مكتملة)`;

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
        const title = `🏆 *محرك قناص تدفق السيولة وعقد الأحجام V12 (${this.mode})*`;

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
            ? `🚀 *دلتا السيولة تؤكد جاهزية الدخول الآن!*`
            : `⏳ *في انتظار اكتمال كافة تأكيدات السيولة والدلتا...*`);

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
            summary: `❌ لا توجد إشارة لـ V12 (${reason})`,
            details: `🏆 *${this.displayName}*\n\n🔍 لا توجد إشارات سيولة حالياً.`,
            generatedAt: now
        };
    }
}
