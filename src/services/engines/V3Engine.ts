import { AnalysisDetails, MatrixResult, OHLCV, TradeRecommendation } from '../AnalysisService';
import { ITradingEngine, EngineResult } from './ITradingEngine';
import { TechnicalAnalyzer } from '../TechnicalAnalyzer';

export class V3Engine implements ITradingEngine {
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
            scalp: this.analyzeScalp(cp, scalpData, matrix),
            swing: this.analyzeSwing(cp, swingData, matrix)
        };
    }

    private calculateMatrix(allTimeframes: Record<string, AnalysisDetails>): MatrixResult {
        return TechnicalAnalyzer.calculateMatrix(allTimeframes);
    }

    private analyzeScalp(cp: number, data: AnalysisDetails, m: MatrixResult): TradeRecommendation {
        return this.runMatrixLogic(cp, data, m);
    }

    private analyzeSwing(cp: number, data: AnalysisDetails, m: MatrixResult): TradeRecommendation {
        return this.runMatrixLogic(cp, data, m);
    }

    private runMatrixLogic(cp: number, data: AnalysisDetails, m: MatrixResult): TradeRecommendation {
        const type = m.percentage >= 50 ? 'LONG' : 'SHORT';
        const winRate = Math.min(m.percentage + 10, 98);
        const slDistance = Math.max(data.atr * 3, cp * 0.01);

        return {
            status: `🏛 V3 MATRIX ${type} ${m.decision}`,
            type, entry: cp,
            tp: type === 'LONG' ? cp + (slDistance * 2) : cp - (slDistance * 2),
            sl: type === 'LONG' ? cp - slDistance : cp + slDistance,
            timeEstimate: data.timeframe.includes('m') ? 60 : 240,
            winRate, reverseProb: 100 - winRate,
            confidenceScore: m.percentage
        };
    }
}
