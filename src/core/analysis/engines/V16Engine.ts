import { AnalysisDetails, MatrixResult, OHLCV, TradeRecommendation } from '../../shared/types';
import { ITradingEngine, EngineResult } from './ITradingEngine';
import { TechnicalAnalyzer } from '../TechnicalAnalyzer';
import { V16SniperEngine } from '../../sniper/engines/V16SniperEngine';
import { OptimizedEngineSuite } from './OptimizedEngineSuite';

export class V16Engine implements ITradingEngine {
    analyze(
        cp: number,
        vwap: number,
        allTimeframes: Record<string, AnalysisDetails>,
        mtfOHLCV: Record<string, OHLCV[]>,
        options: { quickTF: string; longTF: string; params?: Record<string, any> }
    ): EngineResult {
        const matrix = TechnicalAnalyzer.calculateMatrix(allTimeframes);

        return {
            matrix,
            scalp: this.runV16Pipeline(cp, allTimeframes, mtfOHLCV, matrix, 'SCALP', options, options.quickTF),
            swing: this.runV16Pipeline(cp, allTimeframes, mtfOHLCV, matrix, 'SWING', options, options.longTF),
        };
    }

    private runV16Pipeline(
        cp: number,
        allTimeframes: Record<string, AnalysisDetails>,
        mtfOHLCV: Record<string, OHLCV[]>,
        matrix: MatrixResult,
        mode: 'SCALP' | 'SWING',
        options?: { quickTF: string; longTF: string; params?: Record<string, any> },
        tf?: string
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

        // High Precision Filter Check
        const useFilter = options?.params?.highPrecisionFilter !== false;
        if (useFilter && allTimeframes) {
            const frame = OptimizedEngineSuite.buildMarketFrame(direction, cp, matrix, allTimeframes, tf || '5m');
            const passed = OptimizedEngineSuite.runV16(frame);
            if (!passed) {
                const reason = `Failed V16 Filter. Matrix: ${matrix.percentage.toFixed(0)}%, 1H_RSI: ${frame.rsi1h?.toFixed(1) ?? 'N/A'}, 4H_RSI: ${frame.rsi4h?.toFixed(1) ?? 'N/A'}, 30m_Trend: ${frame.trend30m ?? 'N/A'}`;
                return {
                    status: `⚪ ملغاة: لم تتطابق شروط V16 (Quantum Astro & Macro Confluence)`,
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

