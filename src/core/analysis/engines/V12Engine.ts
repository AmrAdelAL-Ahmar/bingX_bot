import { AnalysisDetails, MatrixResult, OHLCV, TradeRecommendation } from '../../shared/types';
import { ITradingEngine, EngineResult } from './ITradingEngine';
import { TechnicalAnalyzer } from '../TechnicalAnalyzer';

export class V12Engine implements ITradingEngine {
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
            scalp: this.runV12Pipeline(cp, vwap, allTimeframes, mtfOHLCV, matrix, 'SCALP'),
            swing: this.runV12Pipeline(cp, vwap, allTimeframes, mtfOHLCV, matrix, 'SWING'),
        };
    }

    private runV12Pipeline(
        cp: number,
        vwap: number,
        allTimeframes: Record<string, AnalysisDetails>,
        mtfOHLCV: Record<string, OHLCV[]>,
        matrix: MatrixResult,
        mode: 'SCALP' | 'SWING'
    ): TradeRecommendation {
        const ohlcv = mtfOHLCV[mode === 'SCALP' ? '5m' : '1h'] || mtfOHLCV['15m'] || [];
        if (ohlcv.length < 50) {
            return this.cancel(cp, '❌ بيانات غير كافية لـ V12 (تحتاج 50 شمعة على الأقل)', mode, 0, 'No data');
        }

        const cvd = this.calculateCVD(ohlcv);
        const cvdDiv = this.detectCVDDivergence(ohlcv, cvd);

        let direction: 'LONG' | 'SHORT' | 'NONE' = 'NONE';
        const reasons: string[] = [];
        let score = 30;

        if (cvdDiv === 'BULLISH') {
            direction = 'LONG';
            score += 35;
            reasons.push('انحراف إيجابي CVD (Bullish CVD Divergence)');
        } else if (cvdDiv === 'BEARISH') {
            direction = 'SHORT';
            score += 35;
            reasons.push('انحراف سلبي CVD (Bearish CVD Divergence)');
        }

        if (direction === 'NONE') {
            return this.cancel(cp, '⚪ لا توجد مؤشرات تدفق سيولة كافية لـ V12', mode, 0, 'No CVD divergence');
        }

        // Proximity to liquidity levels check
        const liq = this.checkLiquidityProximity(ohlcv, cp, direction);
        if (!liq.isClose) {
            return this.cancel(cp, '⚪ لا توجد مستويات سيولة كبرى قريبة لـ V12', mode, 0, 'No major liquidity level nearby');
        }
        reasons.push(liq.reason);
        score += 20;

        // Additional confirmation from multi-timeframe matrix
        const matrixOk = direction === 'LONG' ? matrix.percentage >= 60 : matrix.percentage <= 40;
        if (matrixOk) {
            score += 15;
            reasons.push(`توافق المصفوفة (${matrix.percentage.toFixed(0)}%)`);
        }

        const winRate = Math.min(50 + score * 0.45, 95);
        if (winRate < 70) {
            return this.cancel(cp, `⚪ قوة الإشارة غير كافية V12 (${winRate.toFixed(0)}%)`, mode, score, 'Low score');
        }

        const execData = allTimeframes[mode === 'SCALP' ? '5m' : '1h'] || allTimeframes['15m'];
        const atr = execData?.atr || cp * 0.005;

        const sl = direction === 'LONG' ? cp - atr * 1.8 : cp + atr * 1.8;
        const tp = direction === 'LONG' ? cp + atr * 3.5 : cp - atr * 3.5;

        return {
            status: `${direction === 'LONG' ? '🟢 قناص صاعد' : '🔴 قناص هابط'} V12 [${mode}] (${winRate.toFixed(0)}%)`,
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

    private calculateCVD(ohlcv: OHLCV[]): number[] {
        const cvd: number[] = [];
        let acc = 0;
        for (const c of ohlcv) {
            const spread = c.high - c.low || 0.0001;
            const delta = ((c.close - c.open) / spread) * c.volume;
            acc += delta;
            cvd.push(acc);
        }
        return cvd;
    }

    private detectCVDDivergence(ohlcv: OHLCV[], cvd: number[]): 'BULLISH' | 'BEARISH' | 'NONE' {
        if (ohlcv.length < 20 || cvd.length < 20) return 'NONE';

        const len = ohlcv.length;
        
        // Find local pivot low/high in the window [len - 15, len - 3]
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

        // Bullish Divergence: Price makes a lower low but CVD makes a higher low
        if (currentLow < pivotLowPrice && currentCVD > pivotLowCVD) {
            return 'BULLISH';
        }

        // Bearish Divergence: Price makes a higher high but CVD makes a lower high
        if (currentHigh > pivotHighPrice && currentCVD < pivotHighCVD) {
            return 'BEARISH';
        }

        return 'NONE';
    }

    private checkLiquidityProximity(ohlcv: OHLCV[], cp: number, direction: 'LONG' | 'SHORT'): { isClose: boolean; reason: string } {
        if (ohlcv.length < 50) {
            return { isClose: true, reason: 'بيانات غير كافية لحساب مستويات السيولة' };
        }

        const recent50 = ohlcv.slice(-50);
        const maxHigh50 = Math.max(...recent50.map(c => c.high));
        const minLow50 = Math.min(...recent50.map(c => c.low));
        const range = maxHigh50 - minLow50 || 0.0001;

        // Fibonacci Golden Zone (61.8%)
        const fib618 = maxHigh50 - 0.618 * range;
        const tolerance = 0.003; // 0.3%

        if (direction === 'LONG') {
            const distToSwingLow = Math.abs(cp - minLow50) / minLow50;
            const distToFib618 = Math.abs(cp - fib618) / fib618;

            if (distToSwingLow <= tolerance) {
                return { isClose: true, reason: `قرب مستوى قاع السيولة الرئيسي ($${minLow50.toFixed(4)})` };
            }
            if (distToFib618 <= tolerance) {
                return { isClose: true, reason: `قرب مستوى فيبوناتشي 61.8% الذهبي ($${fib618.toFixed(4)})` };
            }
        } else {
            const distToSwingHigh = Math.abs(cp - maxHigh50) / maxHigh50;
            const distToFib618 = Math.abs(cp - fib618) / fib618;

            if (distToSwingHigh <= tolerance) {
                return { isClose: true, reason: `قرب مستوى قمة السيولة الرئيسية ($${maxHigh50.toFixed(4)})` };
            }
            if (distToFib618 <= tolerance) {
                return { isClose: true, reason: `قرب مستوى فيبوناتشي 61.8% الذهبي ($${fib618.toFixed(4)})` };
            }
        }

        return { isClose: false, reason: 'لا توجد سيولة معلقة قريبة' };
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
