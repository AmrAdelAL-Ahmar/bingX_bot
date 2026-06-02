import { AnalysisDetails, MatrixResult, OHLCV, TradeRecommendation } from '../../shared/types';
import { ITradingEngine, EngineResult } from './ITradingEngine';
import { TechnicalAnalyzer } from '../TechnicalAnalyzer';
import { V16SniperEngine } from '../../sniper/engines/V16SniperEngine';

export class V16Engine implements ITradingEngine {
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
            scalp: this.runV16Pipeline(cp, allTimeframes, mtfOHLCV, matrix, 'SCALP'),
            swing: this.runV16Pipeline(cp, allTimeframes, mtfOHLCV, matrix, 'SWING'),
        };
    }

    private runV16Pipeline(
        cp: number,
        allTimeframes: Record<string, AnalysisDetails>,
        mtfOHLCV: Record<string, OHLCV[]>,
        matrix: MatrixResult,
        mode: 'SCALP' | 'SWING'
    ): TradeRecommendation {
        const sniper = new V16SniperEngine(mode);
        const report = sniper.scan('', cp, mtfOHLCV, allTimeframes);

        const direction = report.direction;
        const winRate = report.winRate;

        if (direction === 'NONE') {
            const reason = report.pendingConditions[0] || 'No setup found';
            return {
                status: `⚪ لا توجد إشارة V16 [${mode}]`,
                type: 'NONE',
                entry: cp,
                tp: cp,
                sl: cp,
                timeEstimate: mode === 'SCALP' ? 30 : 240,
                winRate: 0,
                reverseProb: 0,
                confidenceScore: 0,
                signalReason: reason,
                rejectionReason: reason
            };
        }

        const reason = report.completedConditions.join(' | ');

        return {
            status: `${direction === 'LONG' ? '🟢 قناص صاعد' : '🔴 قناص هابط'} V16 [${mode}] (${winRate.toFixed(0)}%)`,
            type: direction,
            entry: cp,
            tp: report.tp,
            sl: report.sl,
            timeEstimate: mode === 'SCALP' ? 30 : 240,
            winRate,
            reverseProb: 100 - winRate,
            confidenceScore: report.confidence,
            signalReason: reason
        };
    }
}
