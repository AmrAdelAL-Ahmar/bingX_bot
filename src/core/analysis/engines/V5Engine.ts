import { AnalysisDetails, MatrixResult, OHLCV, TradeRecommendation } from '../../shared/types';
import { ITradingEngine, EngineResult } from './ITradingEngine';
import { TechnicalAnalyzer } from '../TechnicalAnalyzer';

export class V5Engine implements ITradingEngine {
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

        const scalpOHLCV = mtfOHLCV[options.quickTF] || mtfOHLCV['5m'];
        const swingOHLCV = mtfOHLCV[options.longTF] || mtfOHLCV['1h'];

        return {
            matrix,
            scalp: this.analyzeScalp(cp, scalpData, scalpOHLCV),
            swing: this.analyzeSwing(cp, swingData, swingOHLCV)
        };
    }

    private calculateMatrix(allTimeframes: Record<string, AnalysisDetails>): MatrixResult {
        return TechnicalAnalyzer.calculateMatrix(allTimeframes);
    }

    private analyzeScalp(cp: number, data: AnalysisDetails, ohlcv: OHLCV[]): TradeRecommendation {
        return this.runPredictiveLogic(cp, data, ohlcv);
    }

    private analyzeSwing(cp: number, data: AnalysisDetails, ohlcv: OHLCV[]): TradeRecommendation {
        return this.runPredictiveLogic(cp, data, ohlcv);
    }

    private runPredictiveLogic(cp: number, data: AnalysisDetails, ohlcv: OHLCV[]): TradeRecommendation {
        const pred = TechnicalAnalyzer.predictNextPriceLinear(ohlcv, 20);
        const type = pred.predictedPrice > cp ? 'LONG' : 'SHORT';
        const winRate = Math.min(70 + (pred.confidence * 0.1), 96);
        
        const finalReason = `Predicted Price: $${pred.predictedPrice.toFixed(2)} vs Current: $${cp.toFixed(2)} (Confidence: ${pred.confidence.toFixed(1)}%) -> ${type}`;

        return {
            status: `🔮 V5 PREDICTIVE AI - Expected: $${pred.predictedPrice.toFixed(2)}`,
            type, entry: cp,
            tp: pred.predictedPrice,
            sl: type === 'LONG' ? cp - (data.atr * 4) : cp + (data.atr * 4),
            timeEstimate: data.timeframe.includes('m') ? 30 : 120,
            winRate, reverseProb: 100 - winRate,
            signalReason: finalReason
        };
    }
}
