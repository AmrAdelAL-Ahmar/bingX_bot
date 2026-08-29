import { AnalysisDetails, OHLCV } from '../../shared/types';
import { TechnicalAnalyzer } from '../../analysis/TechnicalAnalyzer';
import { ISniperEngine, SniperReport } from '../ISniperEngine';
import { OptimizedEngineSuite } from '../../analysis/engines/OptimizedEngineSuite';

export class V14SniperEngine implements ISniperEngine {
    readonly engineId: string;
    readonly displayName: string;
    readonly mode: 'SWING' | 'SCALP';
    readonly requiredTFs: string[];

    constructor(mode: 'SWING' | 'SCALP' = 'SWING') {
        this.mode = mode;
        this.engineId = mode === 'SWING' ? 'V14-SWING' : 'V14-SCALP';
        this.displayName = mode === 'SWING'
            ? '🏆 V14 قناص رينكو السحابي التكيفي (SWING)'
            : '⚡ V14 قناص رينكو السحابي التكيفي (SCALP)';
        this.requiredTFs = mode === 'SWING'
            ? ['1d', '4h', '1h', '15m']
            : ['1d', '1h', '15m', '5m'];
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

        const quickTF = this.mode === 'SWING' ? '15m' : '5m';
        const ohlcv = mtfOHLCV[quickTF] || [];
        const dailyOHLCV = mtfOHLCV['1d'] || mtfOHLCV['4h'] || ohlcv;

        if (ohlcv.length < 100) {
            return this.noSignal(symbol, cp, 'بيانات غير كافية لـ V14 (تحتاج 100 شمعة على الأقل)', now);
        }

        // 1. Calculate Brick Size using daily ATR
        const dailyAtr = this.calculateATR(dailyOHLCV, 14);
        const multiplier = this.mode === 'SWING' ? 1.0 : 0.5;
        const brickSize = Math.max(dailyAtr * multiplier, cp * 0.001);

        // 2. Generate Renko Bricks
        const bricks = this.calculateRenkoBricks(ohlcv, brickSize);
        if (bricks.length < 4) {
            return this.noSignal(symbol, cp, 'طوب رينكو غير كافٍ للاقتناص', now);
        }

        // 3. Calculate Ichimoku Cloud and Kaufman ER at current index
        const ichimoku = this.calculateIchimoku(ohlcv, ohlcv.length - 1);
        const er = this.calculateKaufmanER(ohlcv, ohlcv.length - 1, 10);

        // ── Check Pullback and Reversal Trigger ──
        let direction: 'LONG' | 'SHORT' | 'NONE' = 'NONE';
        let readyToFire = false;

        const lastBrick = bricks[bricks.length - 1];
        const prevBrick = bricks[bricks.length - 2];
        const prevBrick2 = bricks[bricks.length - 3];

        const isLongReversal = lastBrick.type === 'GREEN' && prevBrick.type === 'RED' && prevBrick2.type === 'RED';
        const isShortReversal = lastBrick.type === 'RED' && prevBrick.type === 'GREEN' && prevBrick2.type === 'GREEN';

        // Check Tenkan/Kijun cross
        const isTkBullish = ichimoku.tenkan > ichimoku.kijun;
        const isTkBearish = ichimoku.tenkan < ichimoku.kijun;

        // Cloud conditions
        const cloudTop = Math.max(ichimoku.senkouA, ichimoku.senkouB);
        const cloudBottom = Math.min(ichimoku.senkouA, ichimoku.senkouB);
        const isAboveCloud = cp > cloudTop;
        const isBelowCloud = cp < cloudBottom;

        // Anti-FOMO gate: price not too far from cloud
        const limit = 3 * brickSize;
        const fomoLongOk = isAboveCloud && (cp - cloudTop) <= limit;
        const fomoShortOk = isBelowCloud && (cloudBottom - cp) <= limit;

        // Kaufman ER threshold
        const erOk = er >= 0.60;

        if (isLongReversal) {
            // Pullback does not break cloud bottom
            const pullbackOk = prevBrick.price >= cloudBottom && prevBrick2.price >= cloudBottom;
            const conditionsMet = isAboveCloud && isTkBullish && pullbackOk && erOk && fomoLongOk;

            if (conditionsMet) {
                direction = 'LONG';
                readyToFire = true;
            }
        } else if (isShortReversal) {
            // Pullback does not break cloud top
            const pullbackOk = prevBrick.price <= cloudTop && prevBrick2.price <= cloudTop;
            const conditionsMet = isBelowCloud && isTkBearish && pullbackOk && erOk && fomoShortOk;

            if (conditionsMet) {
                direction = 'SHORT';
                readyToFire = true;
            }
        }

        // ── Populating reports ──
        completed.push(`✅ حجم طوبة رينكو التكيفي: $${brickSize.toFixed(4)} (ATR يومي: $${dailyAtr.toFixed(4)} × ${multiplier})`);
        
        const tkText = `تقاطع Tenkan/Kijun: ${isTkBullish ? 'صاعد' : isTkBearish ? 'هابط' : 'متساوي'} (T: $${ichimoku.tenkan.toFixed(4)} / K: $${ichimoku.kijun.toFixed(4)})`;
        if (direction === 'LONG' && isTkBullish || direction === 'SHORT' && isTkBearish || (direction === 'NONE' && (isTkBullish || isTkBearish))) {
            completed.push(`✅ ${tkText}`);
        } else {
            pending.push(`⏳ ${tkText}`);
        }

        const erText = `كفاءة كوفمان Kaufman ER: ${er.toFixed(2)} (${erOk ? '>= 0.60 كافٍ' : '< 0.60 غير كافٍ'})`;
        if (erOk) completed.push(`✅ ${erText}`);
        else pending.push(`⏳ ${erText}`);

        const cloudText = `فلتر سحابة إيشيموكو: ${isAboveCloud ? 'السعر أعلى السحابة (صاعد)' : isBelowCloud ? 'السعر أسفل السحابة (هابط)' : 'السعر داخل السحابة (عرضي)'} (A: $${ichimoku.senkouA.toFixed(4)} / B: $${ichimoku.senkouB.toFixed(4)})`;
        if (isAboveCloud || isBelowCloud) completed.push(`✅ ${cloudText}`);
        else pending.push(`⏳ ${cloudText}`);

        const fomoText = `بوابة مكافحة الاندفاع (Anti-FOMO): ${fomoLongOk || fomoShortOk ? 'مقبولة' : 'مرفوضة'} (البعد عن السحابة: $${(isAboveCloud ? (cp - cloudTop) : isBelowCloud ? (cloudBottom - cp) : 0).toFixed(4)} <= الحد $${limit.toFixed(4)})`;
        if (fomoLongOk || fomoShortOk || direction === 'NONE') {
            completed.push(`✅ ${fomoText}`);
        } else {
            pending.push(`⏳ ${fomoText}`);
        }

        const last3Types = bricks.slice(-3).map(b => b.type).join('-');
        const patternText = `هيكل رينكو وتصحيح الاتجاه: ${last3Types}`;
        if (isLongReversal || isShortReversal) {
            completed.push(`✅ ${patternText} (تم رصد ارتداد وتأكيد اتجاه جديد)`);
        } else {
            pending.push(`⏳ ${patternText} (بانتظار نمط ارتداد رينكو تراجعي مثل GREEN-RED-RED للشراء أو RED-GREEN-GREEN للبيع)`);
        }

        // Confidence and Win rate logic
        let confidence = 30;
        if (isAboveCloud || isBelowCloud) confidence += 15;
        if (isTkBullish || isTkBearish) confidence += 15;
        if (erOk) confidence += 15;
        if (isLongReversal || isShortReversal) confidence += 20;

        confidence = Math.min(Math.max(confidence, 10), 95);
        const winRate = Math.min(50 + confidence * 0.45, 96);

        // High Precision Verification
        const matrix = TechnicalAnalyzer.calculateMatrix(allTimeframes);
        let v14Passed = false;
        if (direction !== 'NONE') {
            const frame = OptimizedEngineSuite.buildMarketFrame(direction, cp, matrix, allTimeframes, quickTF);
            v14Passed = OptimizedEngineSuite.runV14(frame);

            if (v14Passed) {
                completed.push(`✅ فلتر الدقة الفائقة V14: مؤكد (Win Rate 90.34%)`);
            } else {
                pending.push(`🔸 فلتر الدقة الفائقة V14: شروط التأكيد الإضافية غير مكتملة (Quick_ATR, Matrix, 4H_RSI, MACD_Hist)`);
            }
        }

        readyToFire = readyToFire && v14Passed;

        // SL & TP: SL below cloud bottom (for long) or above cloud top (for short). TP at 4x ATR.
        const sl = direction === 'LONG' ? Math.min(cloudBottom, cp - 2 * brickSize) : Math.max(cloudTop, cp + 2 * brickSize);
        const tp = direction === 'LONG' ? cp + dailyAtr * 4.0 : cp - dailyAtr * 4.0;

        const summary = readyToFire
            ? `🚀 V14 رينكو جاهز للاقتناص (${completed.length} شروط مكتملة)`
            : `⏳ مراقبة V14 رينكو السحابي (${completed.length} شروط مكتملة)`;

        const details = this.buildDetails(symbol, direction, cp, sl, tp, confidence, winRate, completed, pending, readyToFire, brickSize);

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

    private calculateATR(ohlcv: OHLCV[], period: number = 14): number {
        if (ohlcv.length < period + 1) return ohlcv[ohlcv.length - 1]?.close * 0.005 || 0.005;
        const trs: number[] = [];
        for (let i = 1; i < ohlcv.length; i++) {
            const h = ohlcv[i].high;
            const l = ohlcv[i].low;
            const pc = ohlcv[i - 1].close;
            const tr = Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc));
            trs.push(tr);
        }
        let atr = trs.slice(0, period).reduce((sum, val) => sum + val, 0) / period;
        for (let i = period; i < trs.length; i++) {
            atr = (atr * (period - 1) + trs[i]) / period;
        }
        return atr;
    }

    private calculateRenkoBricks(ohlcv: OHLCV[], brickSize: number): { type: 'GREEN' | 'RED'; price: number }[] {
        const bricks: { type: 'GREEN' | 'RED'; price: number }[] = [];
        if (ohlcv.length === 0) return bricks;

        let lastBrickPrice = ohlcv[0].close;

        for (let i = 1; i < ohlcv.length; i++) {
            const price = ohlcv[i].close;
            const diff = price - lastBrickPrice;
            const numBricks = Math.floor(Math.abs(diff) / brickSize);

            if (numBricks >= 1) {
                const type = diff > 0 ? 'GREEN' : 'RED';
                for (let j = 0; j < numBricks; j++) {
                    lastBrickPrice += (diff > 0 ? brickSize : -brickSize);
                    bricks.push({ type, price: lastBrickPrice });
                }
            }
        }
        return bricks;
    }

    private calculateIchimoku(ohlcv: OHLCV[], index: number): { tenkan: number, kijun: number, senkouA: number, senkouB: number } {
        const getHighLow = (start: number, end: number) => {
            let max = -Infinity;
            let min = Infinity;
            for (let i = start; i <= end; i++) {
                const idx = Math.max(0, Math.min(i, ohlcv.length - 1));
                if (ohlcv[idx].high > max) max = ohlcv[idx].high;
                if (ohlcv[idx].low < min) min = ohlcv[idx].low;
            }
            return { max, min };
        };

        const tenkanVal = getHighLow(index - 8, index);
        const tenkan = (tenkanVal.max + tenkanVal.min) / 2;

        const kijunVal = getHighLow(index - 25, index);
        const kijun = (kijunVal.max + kijunVal.min) / 2;

        const calcIndex = index - 26;
        if (calcIndex < 0) {
            return { tenkan, kijun, senkouA: tenkan, senkouB: kijun };
        }

        const tenkanPastVal = getHighLow(calcIndex - 8, calcIndex);
        const tenkanPast = (tenkanPastVal.max + tenkanPastVal.min) / 2;

        const kijunPastVal = getHighLow(calcIndex - 25, calcIndex);
        const kijunPast = (kijunPastVal.max + kijunPastVal.min) / 2;

        const senkouA = (tenkanPast + kijunPast) / 2;

        const s52 = getHighLow(calcIndex - 51, calcIndex);
        const senkouB = (s52.max + s52.min) / 2;

        return { tenkan, kijun, senkouA, senkouB };
    }

    private calculateKaufmanER(ohlcv: OHLCV[], index: number, period: number = 10): number {
        if (index < period) return 0;
        const change = Math.abs(ohlcv[index].close - ohlcv[index - period].close);
        let volatility = 0;
        for (let i = index - period + 1; i <= index; i++) {
            volatility += Math.abs(ohlcv[i].close - ohlcv[i - 1].close);
        }
        return volatility === 0 ? 0 : change / volatility;
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
        readyToFire: boolean,
        brickSize: number
    ): string {
        const sym = symbol.split('/')[0];
        const dirText = direction === 'LONG' ? '🟢 LONG' : direction === 'SHORT' ? '🔴 SHORT' : '⚪ NONE';
        const title = `🏆 *محرك قناص رينكو السحابي التكيفي V14 (${this.mode})*`;

        let text = `${title}\n🪙 ${sym}/USDT | ${dirText}\n━━━━━━━━━━━━━━\n`;
        text += `• نسبة الثقة: \`${confidence}%\` | النجاح المتوقع: \`${winRate.toFixed(0)}%\`\n`;
        text += `• حجم قالب الرينكو الحالي: \`$${brickSize.toFixed(4)}\`\n\n`;
        text += `🎯 *مستويات الدخول والخروج:*\n` +
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
            ? `🚀 *تم تأكيد إشارات الرينكو واختراق السحابة التكيفية بنجاح!*`
            : `⏳ *في انتظار حدوث تصحيح رينكو مع مواءمة السحابة وإشارة التوافق...*`);

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
            details: `🏆 *${this.displayName}*\n\n🔍 لا توجد إشارات رينكو نشطة حالياً.`,
            generatedAt: now
        };
    }
}
