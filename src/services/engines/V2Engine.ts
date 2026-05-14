import { AnalysisDetails, MatrixResult, OHLCV, TradeRecommendation } from '../AnalysisService';
import { ITradingEngine, EngineResult } from './ITradingEngine';
import { TechnicalAnalyzer } from '../TechnicalAnalyzer';

export class V2Engine implements ITradingEngine {
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
        return this.runQuantLogic(cp, data, m);
    }

    private analyzeSwing(cp: number, data: AnalysisDetails, m: MatrixResult): TradeRecommendation {
        return this.runQuantLogic(cp, data, m);
    }

    private runQuantLogic(cp: number, data: AnalysisDetails, m: MatrixResult): TradeRecommendation {
        const mfi = data.indicators.mfi || 50;
        const type = mfi < 30 ? 'LONG' : mfi > 70 ? 'SHORT' : (m.percentage >= 50 ? 'LONG' : 'SHORT');
        const winRate = Math.min(60 + Math.abs(mfi - 50) * 0.8, 92);
        const slDistance = data.atr * 3;

        return {
            status: `📊 V2 QUANT (${type}) - MFI: ${mfi.toFixed(0)}`,
            type, entry: cp,
            tp: type === 'LONG' ? cp + (slDistance * 1.5) : cp - (slDistance * 1.5),
            sl: type === 'LONG' ? cp - slDistance : cp + slDistance,
            timeEstimate: data.timeframe.includes('m') ? 60 : 240,
            winRate, reverseProb: 100 - winRate
        };
    }
}
