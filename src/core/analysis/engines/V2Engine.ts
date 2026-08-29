import { AnalysisDetails, MatrixResult, OHLCV, TradeRecommendation } from '../../shared/types';
import { ITradingEngine, EngineResult } from './ITradingEngine';
import { TechnicalAnalyzer, TF_WEIGHTS } from '../TechnicalAnalyzer';
import { OptimizedEngineSuite } from './OptimizedEngineSuite';

export class V2Engine implements ITradingEngine {
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
            scalp: this.analyzeScalp(cp, scalpData, matrix, allTimeframes, options),
            swing: this.analyzeSwing(cp, swingData, matrix, allTimeframes, options)
        };
    }

    private calculateMatrix(allTimeframes: Record<string, AnalysisDetails>): MatrixResult {
        let totalScore = 0;
        let maxPossibleScore = 0;
        let details = "";

        for (const [tf, data] of Object.entries(allTimeframes)) {
            const weight = TF_WEIGHTS[tf] || 1;
            const isBullish = data.isBullishTrend;

            totalScore += (isBullish ? 1 : -1) * weight;
            maxPossibleScore += weight;
            details += `| ${tf}:${isBullish ? '🟢' : '🔴'} `;
        }
        const percentage = ((totalScore + maxPossibleScore) / (2 * maxPossibleScore)) * 100;

        let decision = percentage >= 75 ? "شراء قوي 🟢" :
            percentage >= 55 ? "شراء 🟡" :
                percentage <= 25 ? "بيع قوي 🔴" : "محايد ⚪";
        return { score: totalScore, percentage, decision, details };
    }

    private analyzeScalp(
        cp: number, 
        data: AnalysisDetails, 
        m: MatrixResult, 
        allTimeframes: Record<string, AnalysisDetails>, 
        options: { quickTF: string, longTF: string, params?: Record<string, any> }
    ): TradeRecommendation {
        return this.runQuantLogic(cp, data, m, allTimeframes, options, options.quickTF);
    }

    private analyzeSwing(
        cp: number, 
        data: AnalysisDetails, 
        m: MatrixResult, 
        allTimeframes: Record<string, AnalysisDetails>, 
        options: { quickTF: string, longTF: string, params?: Record<string, any> }
    ): TradeRecommendation {
        return this.runQuantLogic(cp, data, m, allTimeframes, options, options.longTF);
    }

    private runQuantLogic(
        cp: number, 
        data: AnalysisDetails, 
        m: MatrixResult, 
        allTimeframes: Record<string, AnalysisDetails>, 
        options: { quickTF: string, longTF: string, params?: Record<string, any> },
        tf: string
    ): TradeRecommendation {
        const mfi = data.indicators.mfi || 50;
        const type: 'LONG' | 'SHORT' = mfi < 30 ? 'LONG' : mfi > 70 ? 'SHORT' : (m.percentage >= 50 ? 'LONG' : 'SHORT');
        const winRate = Math.min(60 + Math.abs(mfi - 50) * 0.8, 93.7);
        const slDistance = data.atr * 3;

        let finalType: 'LONG' | 'SHORT' | 'NONE' = type;
        let finalStatus = `📊 V2 QUANT (${type}) - MFI: ${mfi.toFixed(0)}`;
        let finalReason = `MFI: ${mfi.toFixed(1)} | Matrix ${m.percentage.toFixed(1)}% -> ${type}`;

        const useFilter = options.params?.highPrecisionFilter !== false;
        if (useFilter) {
            const frame = OptimizedEngineSuite.buildMarketFrame(type, cp, m, allTimeframes, tf);
            const passed = OptimizedEngineSuite.runV2(frame);
            if (!passed) {
                finalType = 'NONE';
                finalStatus = `⚪ ملغاة: لم تتطابق شروط V2 (MFI Flow + Volume Gate)`;
                finalReason = `Failed V2 Filter. Matrix: ${m.percentage.toFixed(0)}%, 1H_RSI: ${frame.rsi1h ?? 'N/A'}, 4H_RSI: ${frame.rsi4h ?? 'N/A'}, MACD_Hist: ${frame.quickMacdHist ?? 'N/A'}, WilliamsR: ${frame.quickWilliamsR ?? 'N/A'}`;
            }
        }

        return {
            status: finalStatus,
            type: finalType,
            entry: cp,
            tp: type === 'LONG' ? cp + (slDistance * 1.5) : cp - (slDistance * 1.5),
            sl: type === 'LONG' ? cp - slDistance : cp + slDistance,
            timeEstimate: data.timeframe.includes('m') ? 60 : 240,
            winRate: finalType === 'NONE' ? 0 : winRate,
            reverseProb: finalType === 'NONE' ? 0 : 100 - winRate,
            signalReason: finalReason
        };
    }
}

