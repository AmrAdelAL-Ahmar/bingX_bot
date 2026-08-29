import { AnalysisDetails, OHLCV } from '../../shared/types';
import { TechnicalAnalyzer } from '../../analysis/TechnicalAnalyzer';
import { ISniperEngine, SniperReport } from '../ISniperEngine';
import { OptimizedEngineSuite } from '../../analysis/engines/OptimizedEngineSuite';

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

        if (ohlcv.length < 96) {
            return this.noSignal(symbol, cp, 'بيانات غير كافية لـ V13 (تحتاج 96 شمعة على الأقل لحساب POC لـ 24 ساعة)', now);
        }

        // ── 1. Macro POC Gate (Volume Profile POC of last 24 hours) ──
        // 24 hours represented by: 96 candles of 15m, 288 candles of 5m
        const candles24hCount = this.mode === 'SWING' ? 96 : 288;
        const ohlcv24h = ohlcv.slice(-Math.min(ohlcv.length, candles24hCount));
        const vp = TechnicalAnalyzer.calculateVolumeProfile(ohlcv24h, 30);
        const poc = vp.poc;

        const pocError = Math.abs(cp - poc) / poc;
        const pocConfluence = pocError <= 0.0075;

        if (pocConfluence) {
            completed.push(`✅ بوابة السيولة العادلة ماكرو (Macro POC Gate): السعر قريب من السعر العادل POC ($${poc.toFixed(4)}) بفرط انحراف ${ (pocError * 100).toFixed(2) }% <= 0.75%`);
        } else {
            pending.push(`⏳ في انتظار عودة السعر لمنطقة السيطرة السعرية للمؤسسات (POC: $${poc.toFixed(4)} ، انحراف الحالي: ${(pocError * 100).toFixed(2)}% > 0.75%)`);
        }

        // ── 2. Meso Spring / Upthrust Sweep ──
        const recent = ohlcv.slice(-25, -1);
        const highestHigh = Math.max(...recent.map(c => c.high));
        const lowestLow = Math.min(...recent.map(c => c.low));
        const last = ohlcv[ohlcv.length - 1];

        const totalRange = last.high - last.low || 0.0001;

        let direction: 'LONG' | 'SHORT' | 'NONE' = 'NONE';

        if (last.low < lowestLow && last.close > lowestLow) {
            // Spring candidate: bottom wick ratio must be >= 50%
            const wickRatio = (Math.min(last.open, last.close) - last.low) / totalRange;
            if (wickRatio >= 0.50) {
                direction = 'LONG';
                completed.push(`✅ كشط سيولة قاع التجميع (Meso Spring): السعر سحب سيولة القاع السابق ($${lowestLow.toFixed(4)}) بذيل شمعة يمثل ${(wickRatio * 100).toFixed(0)}% >= 50%`);
            } else {
                pending.push(`⏳ تم اختراق القاع ولكن نسبة ذيل الشموع غير كافية للـ Spring (النسبة الحالية: ${(wickRatio * 100).toFixed(0)}% < 50%)`);
            }
        } else if (last.high > highestHigh && last.close < highestHigh) {
            // Upthrust candidate: top wick ratio must be >= 50%
            const wickRatio = (last.high - Math.max(last.open, last.close)) / totalRange;
            if (wickRatio >= 0.50) {
                direction = 'SHORT';
                completed.push(`✅ كشط سيولة قمة التصريف (Meso Upthrust): السعر سحب سيولة القمة السابقة ($${highestHigh.toFixed(4)}) بذيل شمعة يمثل ${(wickRatio * 100).toFixed(0)}% >= 50%`);
            } else {
                pending.push(`⏳ تم اختراق القمة ولكن نسبة ذيل الشموع غير كافية للـ Upthrust (النسبة الحالية: ${(wickRatio * 100).toFixed(0)}% < 50%)`);
            }
        } else {
            pending.push('⏳ في انتظار حدوث كسر كاذب وسحب سيولة للقمم أو القيعان الهيكلية (Spring / Upthrust) على فريم 15M');
        }

        // ── 3. Micro Order Flow Trigger ──
        let triggerOk = false;
        let imbalanceRatio = 0;
        let delta = 0;

        if (direction !== 'NONE') {
            const spread = last.high - last.low || 0.0001;
            const buyVolume = last.volume * (last.close - last.low) / spread;
            const sellVolume = last.volume * (last.high - last.close) / spread;
            delta = ((last.close - last.open) / spread) * last.volume;

            const recentForVolume = ohlcv.slice(-21, -1);
            const avgVolume = recentForVolume.reduce((sum, c) => sum + c.volume, 0) / (recentForVolume.length || 1);

            if (direction === 'LONG') {
                imbalanceRatio = buyVolume / (sellVolume || 1);
                const deltaAccelerating = delta > 0;
                const volumeSurge = Math.abs(delta) >= avgVolume * 0.1;

                if (imbalanceRatio >= 3.0 && deltaAccelerating && volumeSurge) {
                    triggerOk = true;
                    completed.push(`✅ اختلال توازن شرائي حاد (Footprint Imbalance): Ask/Bid Imbalance ${imbalanceRatio.toFixed(1)}x >= 3.0x مع تسارع دلتا CVD إيجابي (${delta.toFixed(0)} >= ${(avgVolume * 0.1).toFixed(0)})`);
                } else {
                    pending.push(`⏳ انتظار اختلال توازن شرائي Ask/Bid Imbalance >= 3.0x وتسارع دلتا CVD (الحالي: ${imbalanceRatio.toFixed(1)}x ، دلتا: ${delta.toFixed(0)})`);
                }
            } else {
                imbalanceRatio = sellVolume / (buyVolume || 1);
                const deltaAccelerating = delta < 0;
                const volumeSurge = Math.abs(delta) >= avgVolume * 0.1;

                if (imbalanceRatio >= 3.0 && deltaAccelerating && volumeSurge) {
                    triggerOk = true;
                    completed.push(`✅ اختلال توازن بيعي حاد (Footprint Imbalance): Bid/Ask Imbalance ${imbalanceRatio.toFixed(1)}x >= 3.0x مع تسارع دلتا CVD سلبي (${delta.toFixed(0)} <= -${(avgVolume * 0.1).toFixed(0)})`);
                } else {
                    pending.push(`⏳ انتظار اختلال توازن بيعي Bid/Ask Imbalance >= 3.0x وتسارع دلتا CVD (الحالي: ${imbalanceRatio.toFixed(1)}x ، دلتا: ${delta.toFixed(0)})`);
                }
            }
        }

        let confidence = 30;
        if (pocConfluence) confidence += 15;
        if (direction !== 'NONE') confidence += 25;
        if (triggerOk) confidence += 15;

        // Confluence with multi-timeframe matrix
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

        // SL & TP calculations (Tight stop loss below/above the sweep wick)
        const sl = direction === 'LONG' ? last.low * 0.998 : last.high * 1.002;
        const execData = allTimeframes[quickKey];
        const atr = execData?.atr || cp * 0.005;
        const tp = direction === 'LONG' ? cp + atr * 4 : cp - atr * 4;

        confidence = Math.min(Math.max(confidence, 10), 95);
        const winRate = Math.min(50 + confidence * 0.45, 96);

        // High Precision Verification
        let v13Passed = false;
        if (direction !== 'NONE') {
            const frame = OptimizedEngineSuite.buildMarketFrame(direction, cp, matrix, allTimeframes, quickKey);
            v13Passed = OptimizedEngineSuite.runV13(frame);

            if (v13Passed) {
                completed.push(`✅ فلتر الدقة الفائقة V13: مؤكد (Win Rate 93.42%)`);
            } else {
                pending.push(`🔸 فلتر الدقة الفائقة V13: شروط التأكيد الإضافية غير مكتملة (Williams%R, StochRSI, 4H_RSI, MACD_Hist)`);
            }
        }

        const readyToFire = direction !== 'NONE' && triggerOk && pocConfluence && matrixOk && v13Passed;

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
        const dirText = direction === 'LONG' ? '🟢 LONG' : direction === 'SHORT' ? '🔴 SHORT' : '⚪ NONE';
        const title = `🏆 *محرك قناص التدفق الحجمي V13 (${this.mode})*`;

        let text = `${title}\n🪙 ${sym}/USDT | ${dirText}\n━━━━━━━━━━━━━━\n`;
        text += `• نسبة الثقة: \`${confidence}%\` | النجاح المتوقع: \`${winRate.toFixed(0)}%\`\n\n`;
        text += `🎯 *المستويات المقترحة (Wyckoff Spring):*\n` +
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
            : `⏳ *في انتظار حدوث كشط سيولة وتوافق تدفق الأحجام...*`);

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
