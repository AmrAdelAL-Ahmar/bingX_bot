import { AnalysisDetails, MatrixResult, OHLCV, TradeRecommendation } from '../../shared/types';
import { ITradingEngine, EngineResult } from './ITradingEngine';
import { TechnicalAnalyzer } from '../TechnicalAnalyzer';
import { BollingerBands } from 'technicalindicators';

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
            scalp: this.runV14Pipeline(cp, vwap, allTimeframes, mtfOHLCV, matrix, 'SCALP'),
            swing: this.runV14Pipeline(cp, vwap, allTimeframes, mtfOHLCV, matrix, 'SWING'),
        };
    }

    private runV14Pipeline(
        cp: number,
        vwap: number,
        allTimeframes: Record<string, AnalysisDetails>,
        mtfOHLCV: Record<string, OHLCV[]>,
        matrix: MatrixResult,
        mode: 'SCALP' | 'SWING'
    ): TradeRecommendation {
        const ohlcv = mtfOHLCV[mode === 'SCALP' ? '5m' : '1h'] || mtfOHLCV['15m'] || [];
        if (ohlcv.length < 100) {
            return this.cancel(cp, '❌ بيانات غير كافية لـ V14 (تحتاج 100 شمعة على الأقل)', mode, 0, 'No data');
        }

        const closes = ohlcv.slice(-100).map(c => c.close);
        const { zScore, mean, stdDev } = this.calculateZScore(closes, cp);

        let direction: 'LONG' | 'SHORT' | 'NONE' = 'NONE';
        const reasons: string[] = [];
        let score = 35;

        // Statistical Arbitrage Trigger boundaries: Z-Score <= -2.5 or Z-Score >= 2.5
        if (zScore <= -2.5) {
            direction = 'LONG';
            score += 45;
            reasons.push(`انحراف إحصائي سالب حاد Z-Score (${zScore.toFixed(2)}) <= -2.5 (فرصة شراء للارتداد)`);
        } else if (zScore >= 2.5) {
            direction = 'SHORT';
            score += 45;
            reasons.push(`انحراف إحصائي موجب حاد Z-Score (${zScore.toFixed(2)}) >= 2.5 (فرصة بيع للارتداد)`);
        }

        if (direction === 'NONE') {
            return this.cancel(cp, `⚪ السعر يتداول ضمن النطاق الإحصائي الطبيعي لـ V14 (Z-Score: ${zScore.toFixed(2)})`, mode, 0, 'Price inside normal Z-Score range');
        }

        const winRate = Math.min(55 + score * 0.40, 94);
        if (winRate < 70) {
            return this.cancel(cp, `⚪ قوة الإشارة غير كافية V14 (${winRate.toFixed(0)}%)`, mode, score, 'Low score');
        }

        const execData = allTimeframes[mode === 'SCALP' ? '5m' : '1h'] || allTimeframes['15m'];
        const atr = execData?.atr || cp * 0.005;

        // In mean reversion, SL is placed outside the standard deviation limit, TP is the mean.
        const sl = direction === 'LONG' ? cp - atr * 2.0 : cp + atr * 2.0;
        const tp = mean; // Reversion target

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

    private calculateZScore(values: number[], currentVal: number): { zScore: number; mean: number; stdDev: number } {
        const len = values.length;
        if (len === 0) return { zScore: 0, mean: 0, stdDev: 0 };
        const mean = values.reduce((sum, v) => sum + v, 0) / len;
        const variance = values.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / len;
        const stdDev = Math.sqrt(variance) || 0.0001;
        const zScore = (currentVal - mean) / stdDev;
        return { zScore, mean, stdDev };
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
