import { AnalysisDetails, MatrixResult, OHLCV, TradeRecommendation } from '../../shared/types';
import { ITradingEngine, EngineResult } from './ITradingEngine';
import { TechnicalAnalyzer } from '../TechnicalAnalyzer';
import { OptimizedEngineSuite } from './OptimizedEngineSuite';

export class V5Engine implements ITradingEngine {
    analyze(
        cp: number, 
        vwap: number, 
        allTimeframes: Record<string, AnalysisDetails>, 
        mtfOHLCV: Record<string, OHLCV[]>,
        options: { quickTF: string, longTF: string, params?: Record<string, any> }
    ): EngineResult {
        const matrix = this.calculateMatrix(allTimeframes);
        
        const scalpData = allTimeframes[options.quickTF] || allTimeframes['5m'];
        const swingData = allTimeframes[options.longTF] || allTimeframes['1h'];

        const scalpOHLCV = mtfOHLCV[options.quickTF] || mtfOHLCV['5m'];
        const swingOHLCV = mtfOHLCV[options.longTF] || mtfOHLCV['1h'];

        return {
            matrix,
            scalp: this.analyzeScalp(cp, scalpData, scalpOHLCV, matrix, allTimeframes, options, options.quickTF),
            swing: this.analyzeSwing(cp, swingData, swingOHLCV, matrix, allTimeframes, options, options.longTF)
        };
    }

    private calculateMatrix(allTimeframes: Record<string, AnalysisDetails>): MatrixResult {
        return TechnicalAnalyzer.calculateMatrix(allTimeframes);
    }

    private analyzeScalp(
        cp: number, 
        data: AnalysisDetails, 
        ohlcv: OHLCV[], 
        m: MatrixResult, 
        allTimeframes: Record<string, AnalysisDetails>, 
        options: { quickTF: string, longTF: string, params?: Record<string, any> },
        tf: string
    ): TradeRecommendation {
        return this.runPredictiveLogic(cp, data, ohlcv, m, allTimeframes, options, tf);
    }

    private analyzeSwing(
        cp: number, 
        data: AnalysisDetails, 
        ohlcv: OHLCV[], 
        m: MatrixResult, 
        allTimeframes: Record<string, AnalysisDetails>, 
        options: { quickTF: string, longTF: string, params?: Record<string, any> },
        tf: string
    ): TradeRecommendation {
        return this.runPredictiveLogic(cp, data, ohlcv, m, allTimeframes, options, tf);
    }

    private runPredictiveLogic(
        cp: number, 
        data: AnalysisDetails, 
        ohlcv: OHLCV[], 
        m: MatrixResult, 
        allTimeframes: Record<string, AnalysisDetails>, 
        options: { quickTF: string, longTF: string, params?: Record<string, any> },
        tf: string
    ): TradeRecommendation {
        const pred = TechnicalAnalyzer.predictNextPriceLinear(ohlcv, 20);
        const type: 'LONG' | 'SHORT' = pred.predictedPrice > cp ? 'LONG' : 'SHORT';
        const winRate = Math.min(70 + (pred.confidence * 0.1), 90.1);
        
        let finalType: 'LONG' | 'SHORT' | 'NONE' = type;
        let finalStatus = `🔮 V5 PREDICTIVE AI - Expected: $${pred.predictedPrice.toFixed(2)}`;
        let finalReason = `Predicted Price: $${pred.predictedPrice.toFixed(2)} vs Current: $${cp.toFixed(2)} (Confidence: ${pred.confidence.toFixed(1)}%) -> ${type}`;

        const useFilter = options.params?.highPrecisionFilter !== false;
        if (useFilter) {
            const frame = OptimizedEngineSuite.buildMarketFrame(type, cp, m, allTimeframes, tf);
            const passed = OptimizedEngineSuite.runV5(frame);
            if (!passed) {
                finalType = 'NONE';
                finalStatus = `⚪ ملغاة: لم تتطابق شروط V5 (Linear Regression + Pivot Slope)`;
                finalReason = `Failed V5 Filter. Pivot: ${frame.pivotQuick?.toFixed(2)}, Matrix: ${m.percentage.toFixed(0)}%, 1H_RSI: ${frame.rsi1h?.toFixed(1) ?? 'N/A'}, 4H_RSI: ${frame.rsi4h?.toFixed(1) ?? 'N/A'}`;
            }
        }

        return {
            status: finalStatus,
            type: finalType,
            entry: cp,
            tp: pred.predictedPrice,
            sl: type === 'LONG' ? cp - (data.atr * 4) : cp + (data.atr * 4),
            timeEstimate: data.timeframe.includes('m') ? 30 : 120,
            winRate: finalType === 'NONE' ? 0 : winRate,
            reverseProb: finalType === 'NONE' ? 0 : 100 - winRate,
            signalReason: finalReason
        };
    }
}

