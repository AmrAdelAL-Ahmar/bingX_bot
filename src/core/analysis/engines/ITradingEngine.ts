import { AnalysisDetails, MatrixResult, OHLCV, TradeRecommendation } from '../../shared/types';

export interface EngineResult {
    matrix: MatrixResult;
    scalp: TradeRecommendation;
    swing: TradeRecommendation;
}

export interface ITradingEngine {
    analyze(
        cp: number, 
        vwap: number, 
        allTimeframes: Record<string, AnalysisDetails>, 
        mtfOHLCV: Record<string, OHLCV[]>,
        options: { quickTF: string, longTF: string }
    ): EngineResult;
}
