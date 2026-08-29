import { AnalysisDetails, MatrixResult, OHLCV, TradeRecommendation } from '../../shared/types';
import { ITradingEngine, EngineResult } from './ITradingEngine';
import { TechnicalAnalyzer } from '../TechnicalAnalyzer';
import { OptimizedEngineSuite } from './OptimizedEngineSuite';

export class V6Engine implements ITradingEngine {
    analyze(
        cp: number,
        vwap: number,
        allTimeframes: Record<string, AnalysisDetails>,
        mtfOHLCV: Record<string, OHLCV[]>,
        options: { quickTF: string, longTF: string, params?: Record<string, any> }
    ): EngineResult {
        // --- 1. Timeframe Firewall (Isolated Matrices) ---
        const scalpTFs = ['1m', '3m', '5m', '15m', '30m'];
        const swingTFs = ['1h', '4h', '1d'];

        const scalpMatrix = TechnicalAnalyzer.calculateMatrix(allTimeframes, scalpTFs);
        const swingMatrix = TechnicalAnalyzer.calculateMatrix(allTimeframes, swingTFs);

        const scalpData = allTimeframes[options.quickTF] || allTimeframes['5m'];
        const swingData = allTimeframes[options.longTF] || allTimeframes['1h'];

        const scalpOHLCV = mtfOHLCV[options.quickTF] || mtfOHLCV['5m'];
        const swingOHLCV = mtfOHLCV[options.longTF] || mtfOHLCV['1h'];

        return {
            matrix: scalpMatrix,
            scalp: this.analyzeScalp(cp, scalpData, scalpMatrix, scalpOHLCV, vwap, allTimeframes, options, options.quickTF),
            swing: this.analyzeSwing(cp, swingData, swingMatrix, swingOHLCV, vwap, allTimeframes, options, options.longTF)
        };
    }

    private analyzeScalp(
        cp: number, 
        data: AnalysisDetails, 
        m: MatrixResult, 
        ohlcv: OHLCV[], 
        vwap: number, 
        allTimeframes: Record<string, AnalysisDetails>, 
        options: { quickTF: string, longTF: string, params?: Record<string, any> },
        tf: string
    ): TradeRecommendation {
        return this.runSniperLogic(cp, data, m, ohlcv, vwap, 'SCALP', allTimeframes, options, tf);
    }

    private analyzeSwing(
        cp: number, 
        data: AnalysisDetails, 
        m: MatrixResult, 
        ohlcv: OHLCV[], 
        vwap: number, 
        allTimeframes: Record<string, AnalysisDetails>, 
        options: { quickTF: string, longTF: string, params?: Record<string, any> },
        tf: string
    ): TradeRecommendation {
        return this.runSniperLogic(cp, data, m, ohlcv, vwap, 'SWING', allTimeframes, options, tf);
    }

    private runSniperLogic(
        cp: number, 
        data: AnalysisDetails, 
        m: MatrixResult, 
        ohlcv: OHLCV[], 
        vwap: number, 
        mode: 'SCALP' | 'SWING', 
        allTimeframes: Record<string, AnalysisDetails>, 
        options: { quickTF: string, longTF: string, params?: Record<string, any> },
        tf: string
    ): TradeRecommendation {
        let score = 0;
        let reason = [];
        const isAboveVWAP = cp > vwap;

        if (isAboveVWAP) { score += 25; reason.push('Price > VWAP (+25)'); }
        else { score -= 25; reason.push('Price < VWAP (-25)'); }

        const matrixScore = (m.percentage - 50) * 0.8;
        score += matrixScore;
        reason.push(`Matrix ${m.percentage}% (${matrixScore > 0 ? '+' : ''}${matrixScore.toFixed(1)})`);

        if (data.rsi < 35) { score += 15; reason.push('RSI < 35 (+15)'); }
        else if (data.rsi > 65) { score -= 15; reason.push('RSI > 65 (-15)'); }
        else { reason.push('RSI Neutral (0)'); }

        let winRate = Math.min(50 + (Math.abs(score) * 0.6), 99.2);
        let type: 'LONG' | 'SHORT' | 'NONE' = score >= 0 ? 'LONG' : 'SHORT';
        const slDistance = data.atr * 2.5;
        let rejectionReason = "";

        const useFilter = options.params?.highPrecisionFilter !== false;
        if (useFilter) {
            const frame = OptimizedEngineSuite.buildMarketFrame(type, cp, m, allTimeframes, tf);
            const passed = OptimizedEngineSuite.runV6(frame);
            if (!passed) {
                type = 'NONE';
                rejectionReason = `Failed V6 Firewall Filter. 1H_RSI=${frame.rsi1h ?? 'N/A'}, 4H_RSI=${frame.rsi4h ?? 'N/A'}, MACD_Hist=${frame.quickMacdHist ?? 'N/A'}`;
            }
        }

        if (type === 'NONE') {
            return {
                status: `🚫 صفقة ملغاة (${rejectionReason})`,
                type: 'NONE', entry: cp, tp: 0, sl: 0, timeEstimate: 0, winRate: 0, reverseProb: 0, rejectionReason,
                signalReason: `Rejected: ${rejectionReason}`
            };
        }

        // --- 3. Dynamic TP/SL based on Pivots ---
        const tp = type === 'LONG' ? Math.max(data.levels.lastSwingHigh, cp + data.atr * 2) : Math.min(data.levels.lastSwingLow, cp - data.atr * 2);
        const sl = type === 'LONG'
            ? Math.min(cp - slDistance, data.levels.lastSwingLow - (data.atr * 0.5))
            : Math.max(cp + slDistance, data.levels.lastSwingHigh + (data.atr * 0.5));

        const finalReason = `Score: ${score.toFixed(1)} | Factors: [${reason.join(', ')}] -> ${type}`;

        return {
            status: `${type === 'LONG' ? '🟢 احتمالية صعود' : '🔴 احتمالية هبوط'} (${winRate.toFixed(1)}%)`,
            type, entry: cp,
            tp, sl,
            timeEstimate: mode === 'SCALP' ? 20 : 120,
            winRate, reverseProb: 100 - winRate,
            confidenceScore: score,
            signalReason: finalReason
        };
    }
}

