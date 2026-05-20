import { AnalysisDetails, MatrixResult, OHLCV, TradeRecommendation } from '../AnalysisService';
import { ITradingEngine, EngineResult } from './ITradingEngine';
import { TechnicalAnalyzer } from '../TechnicalAnalyzer';

export class V1Engine implements ITradingEngine {
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
            scalp: this.analyzeScalp(cp, scalpData, matrix, vwap),
            swing: this.analyzeSwing(cp, swingData, matrix, vwap)
        };
    }

    private calculateMatrix(allTimeframes: Record<string, AnalysisDetails>): MatrixResult {
        // Default matrix calculation (can be customized here for V1)
        return TechnicalAnalyzer.calculateMatrix(allTimeframes);
    }

    private analyzeScalp(cp: number, data: AnalysisDetails, m: MatrixResult, vwap: number): TradeRecommendation {
        return this.runProbabilityLogic(cp, data, cp > vwap, m);
    }

    private analyzeSwing(cp: number, data: AnalysisDetails, m: MatrixResult, vwap: number): TradeRecommendation {
        return this.runProbabilityLogic(cp, data, cp > vwap, m);
    }

    private runProbabilityLogic(cp: number, data: AnalysisDetails, isAboveVWAP: boolean, m: MatrixResult): TradeRecommendation {
        let score = 0;
        let reason = [];

        if (isAboveVWAP) { score += 25; reason.push('Price > VWAP (+25)'); }
        else { score -= 25; reason.push('Price < VWAP (-25)'); }

        const matrixScore = (m.percentage - 50) * 0.8;
        score += matrixScore;
        reason.push(`Matrix ${m.percentage}% (${matrixScore > 0 ? '+' : ''}${matrixScore.toFixed(1)})`);

        if (data.rsi < 35) { score += 15; reason.push('RSI < 35  long'); }
        else if (data.rsi > 65) { score -= 15; reason.push('RSI > 65  short'); }
        else { reason.push('RSI Neutral (0)'); }

        if (data.indicators.cci < -100) { reason.push('cci < -100 short'); }
        else if (data.indicators.cci > 100) { reason.push('cci > 100 long'); }
        else { reason.push('cci Neutral (0)'); }

        if (data.indicators?.mfi && data.indicators.mfi < 20) { reason.push('mfi < 20  long'); }
        else if (data.indicators?.mfi && data.indicators.mfi > 80) { reason.push('mfi > 80  short'); }
        else { reason.push('mfi Neutral (0)'); }


        if (data.indicators.macd.macd > 0) { reason.push('macd > 0 long'); }
        else if (data.indicators.macd.macd < 0) { reason.push('macd < 0 short'); }
        else { reason.push('macd Neutral (0)'); }

        if (data.indicators.stochRsi < 20) { reason.push('stochRsi < 20 long'); }
        else if (data.indicators.stochRsi > 80) { reason.push('stochRsi > 80 short'); }
        else { reason.push('stochRsi Neutral (0)'); }

        if (data.indicators.williamsR <= -80) { reason.push('williamsR <= -80 long'); }
        else if (data.indicators.williamsR >= -20) { reason.push('williamsR >= -20 short'); }
        else { reason.push('williamsR Neutral (0)'); }


        const winRate = Math.min(50 + (Math.abs(score) * 0.6), 96);
        const type = score >= 0 ? 'LONG' : 'SHORT';
        const slDistance = winRate > 90 ? data.atr * 2.5 : data.atr * 6;
        const finalReason = `Score: ${score.toFixed(1)} | Factors: [${reason.join(', ')}]`;

        return {
            status: `${type === 'LONG' ? '🟢 احتمالية صعود' : '🔴 احتمالية هبوط'} (${winRate.toFixed(1)}%)`,
            type, entry: cp,
            tp: type === 'LONG' ? Math.max(data.levels.ma7, cp + data.atr * 2) : Math.min(data.levels.ma7, cp - data.atr * 2),
            sl: type === 'LONG' ? cp - slDistance : cp + slDistance,
            timeEstimate: data.timeframe.includes('m') ? 20 : 90,
            winRate, reverseProb: 100 - winRate,
            confidenceScore: score,
            signalReason: finalReason
        };
    }


    // private runProbabilityLogic(cp: number, data: AnalysisDetails, isAboveVWAP: boolean, m: MatrixResult): TradeRecommendation {
    //     let score = 0;
    //     let reason = [];

    //     // 1. VWAP (+25 / -25)
    //     if (isAboveVWAP) { score += 25; reason.push('Price > VWAP (+25)'); }
    //     else { score -= 25; reason.push('Price < VWAP (-25)'); }

    //     // 2. Matrix
    //     const matrixScore = (m.percentage - 50) * 0.8;
    //     score += matrixScore;
    //     reason.push(`Matrix ${m.percentage}% (${matrixScore > 0 ? '+' : ''}${matrixScore.toFixed(1)})`);

    //     // 3. RSI (+15 / -15)
    //     if (data.rsi < 35) { score += 15; reason.push(`RSI ${data.rsi.toFixed(1)} < 35 long`); }
    //     else if (data.rsi > 65) { score -= 15; reason.push(`RSI ${data.rsi.toFixed(1)} > 65 short`); }
    //     else { reason.push(`RSI ${data.rsi.toFixed(1)} Neutral (0)`); }

    //     // 4. CCI (+10 / -10)
    //     if (data.indicators.cci < -100) { score += 10; reason.push(`CCI ${data.indicators.cci.toFixed(1)} < -100 long`); }
    //     else if (data.indicators.cci > 100) { score -= 10; reason.push(`CCI ${data.indicators.cci.toFixed(1)} > 100 short`); }
    //     else { reason.push(`CCI ${data.indicators.cci.toFixed(1)} Neutral (0)`); }

    //     // 5. MFI (+10 / -10)
    //     if (data.indicators?.mfi && data.indicators.mfi < 20) { score += 10; reason.push(`MFI ${data.indicators.mfi.toFixed(1)} < 20 long`); }
    //     else if (data.indicators?.mfi && data.indicators.mfi > 80) { score -= 10; reason.push(`MFI ${data.indicators.mfi.toFixed(1)} > 80 short`); }
    //     else { reason.push(`MFI ${data.indicators?.mfi ? data.indicators.mfi.toFixed(1) : 'N/A'} Neutral (0)`); }

    //     // 6. MACD (+10 / -10)
    //     if (data.indicators.macd.macd > 0) { score += 10; reason.push(`MACD > 0 long`); }
    //     else if (data.indicators.macd.macd < 0) { score -= 10; reason.push(`MACD < 0 short`); }
    //     else { reason.push('MACD Neutral (0)'); }

    //     // 7. StochRSI (+10 / -10) - تم التصحيح: أقل من 20 شراء، أكبر من 80 بيع
    //     if (data.indicators.stochRsi < 20) { score += 10; reason.push(`StochRSI ${data.indicators.stochRsi.toFixed(1)} < 20 long`); }
    //     else if (data.indicators.stochRsi > 80) { score -= 10; reason.push(`StochRSI ${data.indicators.stochRsi.toFixed(1)} > 80 short`); }
    //     else { reason.push('StochRSI Neutral (0)'); }

    //     // 8. Williams %R (+10 / -10) - تم التصحيح الجذري
    //     // التشبع البيعي (Oversold): القراءة بين -80 و -100 (إشارة شراء)
    //     // التشبع الشرائي (Overbought): القراءة بين 0 و -20 (إشارة بيع)
    //     if (data.indicators.williamsR <= -80) {
    //         score += 10;
    //         reason.push(`Williams%R ${data.indicators.williamsR.toFixed(1)} <= -80 long`);
    //     }
    //     else if (data.indicators.williamsR >= -20) {
    //         score -= 10;
    //         reason.push(`Williams%R ${data.indicators.williamsR.toFixed(1)} >= -20 short`);
    //     }
    //     else {
    //         reason.push(`Williams%R ${data.indicators.williamsR.toFixed(1)} Neutral (0)`);
    //     }

    //     // --- حساب النتيجة النهائية ---
    //     const winRate = Math.min(50 + (Math.abs(score) * 0.6), 96);
    //     const type = score >= 0 ? 'LONG' : 'SHORT';
    //     const slDistance = winRate > 90 ? data.atr * 2.5 : data.atr * 6;
    //     const finalReason = `Score: ${score.toFixed(1)} | Factors: [${reason.join(', ')}]`;

    //     return {
    //         status: `${type === 'LONG' ? '🟢 احتمالية صعود' : '🔴 احتمالية هبوط'} (${winRate.toFixed(1)}%)`,
    //         type, entry: cp,
    //         tp: type === 'LONG' ? Math.max(data.levels.ma7, cp + data.atr * 2) : Math.min(data.levels.ma7, cp - data.atr * 2),
    //         sl: type === 'LONG' ? cp - slDistance : cp + slDistance,
    //         timeEstimate: data.timeframe.includes('m') ? 20 : 90,
    //         winRate, reverseProb: 100 - winRate,
    //         confidenceScore: score,
    //         signalReason: finalReason
    //     };
    // }
}
