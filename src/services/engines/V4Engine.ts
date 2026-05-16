import { AnalysisDetails, MatrixResult, OHLCV, TradeRecommendation } from '../AnalysisService';
import { ITradingEngine, EngineResult } from './ITradingEngine';
import { TechnicalAnalyzer } from '../TechnicalAnalyzer';

export class V4Engine implements ITradingEngine {
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
        return this.runScalpLogic(cp, data, m);
    }

    private analyzeSwing(cp: number, data: AnalysisDetails, m: MatrixResult): TradeRecommendation {
        return this.runScalpLogic(cp, data, m);
    }

    private runScalpLogic(cp: number, data: AnalysisDetails, m: MatrixResult): TradeRecommendation {
        const isLong = cp <= data.indicators.bb.lower || data.indicators.cci < -100;
        const isShort = cp >= data.indicators.bb.upper || data.indicators.cci > 100;
        const type = isLong ? 'LONG' : 'SHORT';
        const winRate = Math.min(65 + (Math.abs(data.indicators.cci) / 10), 94);
        const slDistance = data.atr * 2;

        let reason = [];
        if (cp <= data.indicators.bb.lower) reason.push(`Price <= BB Lower (${data.indicators.bb.lower.toFixed(2)})`);
        if (data.indicators.cci < -100) reason.push(`CCI < -100 (${data.indicators.cci.toFixed(1)})`);
        if (cp >= data.indicators.bb.upper) reason.push(`Price >= BB Upper (${data.indicators.bb.upper.toFixed(2)})`);
        if (data.indicators.cci > 100) reason.push(`CCI > 100 (${data.indicators.cci.toFixed(1)})`);
        if (reason.length === 0) reason.push('Default Short Bias');
        const finalReason = `Factors: [${reason.join(', ')}] -> ${type}`;

        return {
            status: `⚡ V4 SCALP PRO (${type}) - BB/CCI Confluence`,
            type, entry: cp,
            tp: data.indicators.bb.middle,
            sl: type === 'LONG' ? cp - slDistance : cp + slDistance,
            timeEstimate: data.timeframe.includes('m') ? 15 : 60,
            winRate, reverseProb: 100 - winRate,
            signalReason: finalReason
        };
    }
}
