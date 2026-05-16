import { AnalysisDetails, MatrixResult, OHLCV, TradeRecommendation } from '../AnalysisService';
import { ITradingEngine, EngineResult } from './ITradingEngine';
import { TechnicalAnalyzer } from '../TechnicalAnalyzer';

export class V1Engine implements ITradingEngine {
    analyze(
        cp: number, 
        vwap: number, 
        allTimeframes: Record<string, AnalysisDetails>, 
        mtfOHLCV: Record<string, OHLCV[]>,
        options: { quickTF: string, longTF: string }
    ): EngineResult {
        const matrix = this.calculateMatrix(allTimeframes);
        
        const scalpData = allTimeframes[options.quickTF] || allTimeframes['5m'];
        const swingData = allTimeframes[options.longTF] || allTimeframes['1h'];

        return {
            matrix,
            scalp: this.analyzeScalp(cp, scalpData, matrix, vwap),
            swing: this.analyzeSwing(cp, swingData, matrix, vwap)
        };
    }

    private calculateMatrix(allTimeframes: Record<string, AnalysisDetails>): MatrixResult {
        // Default matrix calculation (can be customized here for V1)
        return TechnicalAnalyzer.calculateMatrix(allTimeframes);
    }

    private analyzeScalp(cp: number, data: AnalysisDetails, m: MatrixResult, vwap: number): TradeRecommendation {
        return this.runProbabilityLogic(cp, data, cp > vwap, m);
    }

    private analyzeSwing(cp: number, data: AnalysisDetails, m: MatrixResult, vwap: number): TradeRecommendation {
        return this.runProbabilityLogic(cp, data, cp > vwap, m);
    }

    private runProbabilityLogic(cp: number, data: AnalysisDetails, isAboveVWAP: boolean, m: MatrixResult): TradeRecommendation {
        let score = 0;
        let reason = [];
        
        if (isAboveVWAP) { score += 25; reason.push('Price > VWAP (+25)'); }
        else { score -= 25; reason.push('Price < VWAP (-25)'); }

        const matrixScore = (m.percentage - 50) * 0.8;
        score += matrixScore;
        reason.push(`Matrix ${m.percentage}% (${matrixScore > 0 ? '+' : ''}${matrixScore.toFixed(1)})`);

        if (data.rsi < 35) { score += 15; reason.push('RSI < 35 (+15)'); }
        else if (data.rsi > 65) { score -= 15; reason.push('RSI > 65 (-15)'); }
        else { reason.push('RSI Neutral (0)'); }

        const winRate = Math.min(50 + (Math.abs(score) * 0.6), 96);
        const type = score >= 0 ? 'LONG' : 'SHORT';
        const slDistance = data.atr * 2.5;
        const finalReason = `Score: ${score.toFixed(1)} | Factors: [${reason.join(', ')}]`;

        return {
            status: `${type === 'LONG' ? '🟢 احتمالية صعود' : '🔴 احتمالية هبوط'} (${winRate.toFixed(1)}%)`,
            type, entry: cp,
            tp: type === 'LONG' ? Math.max(data.levels.ma7, cp + data.atr * 2) : Math.min(data.levels.ma7, cp - data.atr * 2),
            sl: type === 'LONG' ? cp - slDistance : cp + slDistance,
            timeEstimate: data.timeframe.includes('m') ? 20 : 90,
            winRate, reverseProb: 100 - winRate,
            confidenceScore: score,
            signalReason: finalReason
        };
    }
}
