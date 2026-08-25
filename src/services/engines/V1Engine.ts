import { AnalysisDetails, MatrixResult, OHLCV, TradeRecommendation } from '../AnalysisService';
import { ITradingEngine, EngineResult } from './ITradingEngine';
import { TechnicalAnalyzer } from '../TechnicalAnalyzer';

export class V1Engine implements ITradingEngine {
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
            scalp: this.analyzeScalp(cp, scalpData, matrix, vwap, allTimeframes, options),
            swing: this.analyzeSwing(cp, swingData, matrix, vwap, allTimeframes, options)
        };
    }

    private calculateMatrix(allTimeframes: Record<string, AnalysisDetails>): MatrixResult {
        // Default matrix calculation (can be customized here for V1)
        return TechnicalAnalyzer.calculateMatrix(allTimeframes);
    }

    private analyzeScalp(
        cp: number,
        data: AnalysisDetails,
        m: MatrixResult,
        vwap: number,
        allTimeframes: Record<string, AnalysisDetails>,
        options: { quickTF: string, longTF: string, params?: Record<string, any> }
    ): TradeRecommendation {
        return this.runProbabilityLogic(cp, data, cp > vwap, m, allTimeframes, options);
    }

    private analyzeSwing(
        cp: number,
        data: AnalysisDetails,
        m: MatrixResult,
        vwap: number,
        allTimeframes: Record<string, AnalysisDetails>,
        options: { quickTF: string, longTF: string, params?: Record<string, any> }
    ): TradeRecommendation {
        return this.runProbabilityLogic(cp, data, cp > vwap, m, allTimeframes, options);
    }

    private runProbabilityLogic(
        cp: number,
        data: AnalysisDetails,
        isAboveVWAP: boolean,
        m: MatrixResult,
        allTimeframes: Record<string, AnalysisDetails>,
        options: { quickTF: string, longTF: string, params?: Record<string, any> }
    ): TradeRecommendation {
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

        const useFilter = options.params?.highPrecisionFilter !== false;

        let finalType: 'LONG' | 'SHORT' | 'NONE' = type;
        let finalStatus = `${type === 'LONG' ? '🟢 احتمالية صعود' : '🔴 احتمالية هبوط'} (${winRate.toFixed(1)}%)`;
        let finalReason = `Score: ${score.toFixed(1)} | Factors: [${reason.join(', ')}]`;

        if (useFilter) {
            const rsi1h = allTimeframes['1h']?.rsi;
            const rsi4h = allTimeframes['4h']?.rsi;
            const trend4h = allTimeframes['4h']?.structure;
            const trend30m = allTimeframes['30m']?.structure;

            if (type === 'LONG') {
                const matrixOk = m.percentage >= 65;
                const rsi1hOk = rsi1h !== undefined && rsi1h >= 48;
                const quickRsiOk = data.rsi <= 70;
                const trend4hOk = trend4h !== 'هابط (LH/LL) 📉';

                if (!(matrixOk && rsi1hOk && quickRsiOk && trend4hOk)) {
                    finalType = 'NONE';
                    finalStatus = `⚪ ملغاة: لم تتطابق شروط الشراء الفائقة الدقة`;
                    finalReason = `Failed LONG Filter. Matrix: ${m.percentage.toFixed(0)}% (min 65%), 1H_RSI: ${rsi1h !== undefined ? rsi1h.toFixed(1) : 'N/A'} (min 48), Quick_RSI: ${data.rsi.toFixed(1)} (max 70), 4H_Trend: ${trend4h || 'N/A'} (not bearish)`;
                }
            } else if (type === 'SHORT') {
                const matrixOk = m.percentage <= 35;
                const rsi1hOk = rsi1h !== undefined && rsi1h <= 48;
                const rsi4hOk = rsi4h !== undefined && rsi4h <= 48;
                const quickMacdHist = data.indicators?.macd?.histogram;
                const macdHistOk = quickMacdHist !== undefined && quickMacdHist < 0;
                const williamsOk = (data.indicators.williamsR || -50) > -75;
                const stochRsiOk = (data.indicators.stochRsi || 50) > 15;
                const trend4hOk = trend4h !== 'صاعد (HH/HL) 📈';
                const trend30mOk = trend30m !== 'صاعد (HH/HL) 📈';

                if (!(matrixOk && rsi1hOk && rsi4hOk && macdHistOk && williamsOk && stochRsiOk && trend4hOk && trend30mOk)) {
                    finalType = 'NONE';
                    finalStatus = `⚪ ملغاة: لم تتطابق شروط البيع الفائقة الدقة`;
                    finalReason = `Failed SHORT Filter. Matrix: ${m.percentage.toFixed(0)}% (max 35%), 1H_RSI: ${rsi1h !== undefined ? rsi1h.toFixed(1) : 'N/A'}, 4H_RSI: ${rsi4h !== undefined ? rsi4h.toFixed(1) : 'N/A'} (max 48), Quick_MACD_Hist: ${quickMacdHist !== undefined ? quickMacdHist.toFixed(4) : 'N/A'} (<0), WilliamsR: ${data.indicators.williamsR?.toFixed(1)} (>-75), StochRSI: ${data.indicators.stochRsi?.toFixed(1)} (>15), 4H_Trend: ${trend4h || 'N/A'}, 30m_Trend: ${trend30m || 'N/A'} (not bullish)`;
                }
            }
        }

        return {
            status: finalStatus,
            type: finalType,
            entry: cp,
            tp: type === 'LONG' ? Math.max(data.levels.ma7, cp + data.atr * 2) : Math.min(data.levels.ma7, cp - data.atr * 2),
            sl: type === 'LONG' ? cp - slDistance : cp + slDistance,
            timeEstimate: data.timeframe.includes('m') ? 20 : 90,
            winRate: finalType === 'NONE' ? 0 : winRate,
            reverseProb: finalType === 'NONE' ? 0 : 100 - winRate,
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
