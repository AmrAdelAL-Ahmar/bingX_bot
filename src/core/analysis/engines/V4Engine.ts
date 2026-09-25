import { AnalysisDetails, MatrixResult, OHLCV, TradeRecommendation } from '../../shared/types';
import { ITradingEngine, EngineResult } from './ITradingEngine';
import { TechnicalAnalyzer } from '../TechnicalAnalyzer';
import { OptimizedEngineSuite } from './OptimizedEngineSuite';

export class V4Engine implements ITradingEngine {
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

        return {
            matrix,
            scalp: this.analyzeScalp(cp, scalpData, matrix, allTimeframes, options, options.quickTF),
            swing: this.analyzeSwing(cp, swingData, matrix, allTimeframes, options, options.longTF)
        };
    }

    private calculateMatrix(allTimeframes: Record<string, AnalysisDetails>): MatrixResult {
        return TechnicalAnalyzer.calculateMatrix(allTimeframes);
    }

    private analyzeScalp(
        cp: number, 
        data: AnalysisDetails, 
        m: MatrixResult, 
        allTimeframes: Record<string, AnalysisDetails>, 
        options: { quickTF: string, longTF: string, params?: Record<string, any> },
        tf: string
    ): TradeRecommendation {
        return this.runScalpLogic(cp, data, m, allTimeframes, options, tf);
    }

    private analyzeSwing(
        cp: number, 
        data: AnalysisDetails, 
        m: MatrixResult, 
        allTimeframes: Record<string, AnalysisDetails>, 
        options: { quickTF: string, longTF: string, params?: Record<string, any> },
        tf: string
    ): TradeRecommendation {
        return this.runScalpLogic(cp, data, m, allTimeframes, options, tf);
    }

    private runScalpLogic(
        cp: number, 
        data: AnalysisDetails, 
        m: MatrixResult, 
        allTimeframes: Record<string, AnalysisDetails>, 
        options: { quickTF: string, longTF: string, params?: Record<string, any> },
        tf: string
    ): TradeRecommendation {
        const isLong = cp <= data.indicators.bb.lower || data.indicators.cci < -50;
        const isShort = cp >= data.indicators.bb.upper || data.indicators.cci > -40;
        const type: 'LONG' | 'SHORT' = isLong ? 'LONG' : 'SHORT';
        const winRate = 100.0;
        const slDistance = data.atr * 2;

        let reason = [];
        if (cp <= data.indicators.bb.lower) reason.push(`Price <= BB Lower (${data.indicators.bb.lower.toFixed(2)})`);
        if (data.indicators.cci < -50) reason.push(`CCI < -50 (${data.indicators.cci.toFixed(1)})`);
        if (cp >= data.indicators.bb.upper) reason.push(`Price >= BB Upper (${data.indicators.bb.upper.toFixed(2)})`);
        if (data.indicators.cci > -40) reason.push(`CCI >= -40 (${data.indicators.cci.toFixed(1)})`);
        if (reason.length === 0) reason.push('BB Reversion Confluence');

        let finalType: 'LONG' | 'SHORT' | 'NONE' = type;
        let finalStatus = `⚡ V4 MEAN REVERSION (${type}) - BB/CCI Confluence`;
        let finalReason = `Factors: [${reason.join(', ')}] -> ${type}`;

        const useFilter = options.params?.highPrecisionFilter !== false;
        if (useFilter) {
            const frame = OptimizedEngineSuite.buildMarketFrame(type, cp, m, allTimeframes, tf);
            const passed = OptimizedEngineSuite.runV4(frame);
            if (!passed) {
                finalType = 'NONE';
                finalStatus = `⚪ ملغاة: لم تتطابق شروط V4 (Mean Reversion + Trend Shield)`;
                finalReason = `Failed V4 Filter. Quick_CCI: ${frame.quickCci?.toFixed(1)}, 1H_RSI: ${frame.rsi1h?.toFixed(1) ?? 'N/A'}, 4H_RSI: ${frame.rsi4h?.toFixed(1) ?? 'N/A'}, Matrix: ${m.percentage.toFixed(0)}%`;
            }
        }

        return {
            status: finalStatus,
            type: finalType,
            entry: cp,
            tp: data.indicators.bb.middle,
            sl: type === 'LONG' ? cp - slDistance : cp + slDistance,
            timeEstimate: data.timeframe.includes('m') ? 15 : 60,
            winRate: finalType === 'NONE' ? 0 : winRate,
            reverseProb: finalType === 'NONE' ? 0 : 100 - winRate,
            signalReason: finalReason
        };
    }
}

