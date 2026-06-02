import { AnalysisDetails, MatrixResult, OHLCV, TradeRecommendation } from '../../shared/types';
import { ITradingEngine, EngineResult } from './ITradingEngine';
import { TechnicalAnalyzer } from '../TechnicalAnalyzer';

export class V14Engine implements ITradingEngine {
    analyze(
        cp: number,
        vwap: number,
        allTimeframes: Record<string, AnalysisDetails>,
        mtfOHLCV: Record<string, OHLCV[]>,
        options: { quickTF: string; longTF: string }
    ): EngineResult {
        const matrix = TechnicalAnalyzer.calculateMatrix(allTimeframes);

        return {
            matrix,
            scalp: this.runV14Pipeline(cp, allTimeframes, mtfOHLCV, matrix, 'SCALP'),
            swing: this.runV14Pipeline(cp, allTimeframes, mtfOHLCV, matrix, 'SWING'),
        };
    }

    private runV14Pipeline(
        cp: number,
        allTimeframes: Record<string, AnalysisDetails>,
        mtfOHLCV: Record<string, OHLCV[]>,
        matrix: MatrixResult,
        mode: 'SCALP' | 'SWING'
    ): TradeRecommendation {
        const quickTF = mode === 'SWING' ? '15m' : '5m';
        const ohlcv = mtfOHLCV[quickTF] || [];
        const dailyOHLCV = mtfOHLCV['1d'] || mtfOHLCV['4h'] || ohlcv;

        if (ohlcv.length < 100) {
            return this.cancel(cp, '❌ بيانات غير كافية لـ V14 (تحتاج 100 شمعة على الأقل)', mode, 0, 'No data');
        }

        // 1. Calculate Brick Size using daily ATR
        const dailyAtr = this.calculateATR(dailyOHLCV, 14);
        const multiplier = mode === 'SWING' ? 1.0 : 0.5;
        const brickSize = Math.max(dailyAtr * multiplier, cp * 0.001);

        // 2. Generate Renko Bricks
        const bricks = this.calculateRenkoBricks(ohlcv, brickSize);
        if (bricks.length < 4) {
            return this.cancel(cp, '⚪ طوب رينكو غير كافٍ للاقتناص', mode, 0, 'Not enough Renko bricks');
        }

        // 3. Calculate Ichimoku Cloud and Kaufman ER at current index
        const ichimoku = this.calculateIchimoku(ohlcv, ohlcv.length - 1);
        const er = this.calculateKaufmanER(ohlcv, ohlcv.length - 1, 10);

        // ── Check Pullback and Reversal Trigger ──
        let direction: 'LONG' | 'SHORT' | 'NONE' = 'NONE';
        const reasons: string[] = [];

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

        // Anti-FOMO gate
        const limit = 3 * brickSize;
        const fomoLongOk = isAboveCloud && (cp - cloudTop) <= limit;
        const fomoShortOk = isBelowCloud && (cloudBottom - cp) <= limit;

        const erOk = er >= 0.60;

        if (isLongReversal) {
            const pullbackOk = prevBrick.price >= cloudBottom && prevBrick2.price >= cloudBottom;
            const conditionsMet = isAboveCloud && isTkBullish && pullbackOk && erOk && fomoLongOk;

            if (conditionsMet) {
                direction = 'LONG';
                reasons.push('ارتداد رينكو صاعد مع كفاءة كوفمان وتقاطع Tenkan/Kijun وتداول السعر أعلى السحابة التكيفية');
            }
        } else if (isShortReversal) {
            const pullbackOk = prevBrick.price <= cloudTop && prevBrick2.price <= cloudTop;
            const conditionsMet = isBelowCloud && isTkBearish && pullbackOk && erOk && fomoShortOk;

            if (conditionsMet) {
                direction = 'SHORT';
                reasons.push('ارتداد رينكو هابط مع كفاءة كوفمان وتقاطع Tenkan/Kijun وتداول السعر أسفل السحابة التكيفية');
            }
        }

        if (direction === 'NONE') {
            return this.cancel(cp, '⚪ لا توجد إشارة رينكو سحابية تكيفية لـ V14', mode, 0, 'No setup found');
        }

        let score = 30;
        if (isAboveCloud || isBelowCloud) score += 15;
        if (isTkBullish || isTkBearish) score += 15;
        if (erOk) score += 15;
        if (isLongReversal || isShortReversal) score += 20;

        score = Math.min(Math.max(score, 10), 95);
        const winRate = Math.min(50 + score * 0.45, 96);

        // SL & TP: SL below cloud bottom (long) / above cloud top (short)
        const sl = direction === 'LONG' ? Math.min(cloudBottom, cp - 2 * brickSize) : Math.max(cloudTop, cp + 2 * brickSize);
        const tp = direction === 'LONG' ? cp + dailyAtr * 4.0 : cp - dailyAtr * 4.0;

        return {
            status: `${direction === 'LONG' ? '🟢 قناص صاعد' : '🔴 قناص هابط'} V14 [${mode}] (${winRate.toFixed(0)}%)`,
            type: direction,
            entry: cp,
            tp,
            sl,
            timeEstimate: mode === 'SCALP' ? 30 : 240,
            winRate,
            reverseProb: 100 - winRate,
            confidenceScore: score,
            signalReason: reasons.join(' | ')
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


    private cancel(
        cp: number,
        status: string,
        mode: string,
        score: number,
        reason: string
    ): TradeRecommendation {
        return {
            status,
            type: 'NONE',
            entry: cp, tp: cp, sl: cp,
            timeEstimate: mode === 'SCALP' ? 30 : 240,
            winRate: 0,
            reverseProb: 0,
            confidenceScore: score,
            signalReason: reason,
        };
    }
}
