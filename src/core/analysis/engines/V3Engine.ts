import { AnalysisDetails, MatrixResult, OHLCV, TradeRecommendation } from '../../shared/types';
import { ITradingEngine, EngineResult } from './ITradingEngine';
import { TechnicalAnalyzer } from '../TechnicalAnalyzer';
import { OptimizedEngineSuite } from './OptimizedEngineSuite';

export class V3Engine implements ITradingEngine {
    analyze(
        cp: number,
        vwap: number,
        allTimeframes: Record<string, AnalysisDetails>,
        mtfOHLCV: Record<string, OHLCV[]>,
        options: { quickTF: string, longTF: string, params?: Record<string, any> }
    ): EngineResult {
        const matrix = this.calculateMatrix(allTimeframes);

        const scalpData = allTimeframes[options.quickTF] || allTimeframes['5m'];
        const scalpOHLCV = mtfOHLCV[options.quickTF] || mtfOHLCV['5m'];
        const swingData = allTimeframes[options.longTF] || allTimeframes['1h'];
        const swingOHLCV = mtfOHLCV[options.longTF] || mtfOHLCV['1h'];

        // Macro confirmation frames
        const scalpMacro = allTimeframes['1h'];
        const swingMacro = allTimeframes['4h'] || allTimeframes['1h'];

        return {
            matrix,
            scalp: this.runProbabilityLogic(cp, scalpData, scalpOHLCV, scalpMacro, vwap, matrix, 'SCALP', allTimeframes, options, options.quickTF),
            swing: this.runProbabilityLogic(cp, swingData, swingOHLCV, swingMacro, vwap, matrix, 'SWING', allTimeframes, options, options.longTF),
        };
    }

    private calculateMatrix(allTimeframes: Record<string, AnalysisDetails>): MatrixResult {
        return TechnicalAnalyzer.calculateMatrix(allTimeframes);
    }

    private runProbabilityLogic(
        cp: number,
        data: AnalysisDetails,
        ohlcv: OHLCV[],
        macroData: AnalysisDetails | undefined,
        vwap: number,
        m: MatrixResult,
        mode: string,
        allTimeframes?: Record<string, AnalysisDetails>,
        options?: { quickTF: string, longTF: string, params?: Record<string, any> },
        tf?: string
    ): TradeRecommendation {
        let score = 0;
        const reason: string[] = [];
        let type: 'LONG' | 'SHORT' | 'NEUTRAL' = 'NEUTRAL';

        // ==========================================================
        // LAYER 1 — Market Structure Filter (حاكم أول)
        // ==========================================================
        const struct = data.structure;
        const isBullish = struct.includes('صاعد');
        const isBearish = struct.includes('هابط');
        const isSideways = struct.includes('عرضي');
        const isBOS = struct.includes('كسر هيكل');

        if (isBullish) type = 'LONG';
        else if (isBearish) type = 'SHORT';
        else if (isSideways && cp > data.levels.pivot) type = 'LONG';
        else if (isSideways && cp < data.levels.pivot) type = 'SHORT';
        else if (isBOS) type = cp > vwap ? 'LONG' : 'SHORT';

        if (type === 'NEUTRAL') {
            return this.cancel(cp, '⚪ محايد (هيكل غير واضح)', 'NEUTRAL', 0, mode);
        }

        // Structural bonus
        if (isBullish && type === 'LONG') { score += 15; reason.push('هيكل صاعد (+15)'); }
        if (isBearish && type === 'SHORT') { score += 15; reason.push('هيكل هابط (+15)'); }
        if (isBOS) { score += 8; reason.push('كسر هيكل BOS (+8)'); }

        // ==========================================================
        // LAYER 2 — Divergence Shield (فلتر الانعكاس)
        // ==========================================================
        const div = TechnicalAnalyzer.detectDivergence(ohlcv, type);
        if (div.detected) {
            return this.cancel(cp, `⚠️ ملغاة: ${div.description}`, type, score, mode);
        }

        // ==========================================================
        // RSI EXTREME REVERSAL BLOCK (حاجز التشبع المطلق)
        // RSI < 25 = تشبع بيعي حاد → السوق متهيئ للارتداد → إلغاء SHORT فوراً
        // RSI > 75 = تشبع شرائي حاد → السوق متهيئ للتصحيح → إلغاء LONG فوراً
        if (type === 'SHORT' && data.rsi < 25) {
            return this.cancel(cp, `❌ محظور: RSI تشبع بيعي (${data.rsi.toFixed(1)}) - خطر انعكاس مرتفع`, type, score, mode);
        }
        if (type === 'LONG' && data.rsi > 75) {
            return this.cancel(cp, `❌ محظور: RSI تشبع شرائي (${data.rsi.toFixed(1)}) - خطر انعكاس مرتفع`, type, score, mode);
        }

        // ==========================================================
        // LAYER 3 — Macro Timeframe Confirmation
        // ==========================================================
        if (macroData) {
            const macroIsBullish = macroData.structure.includes('صاعد');
            const macroIsBearish = macroData.structure.includes('هابط');

            if (type === 'LONG') {
                if (macroIsBullish) { score += 20; reason.push('توافق الفريم الأكبر (+20)'); }
                else if (macroIsBearish) { score -= 20; reason.push('الفريم الأكبر معاكس (-20)'); }
            } else {
                if (macroIsBearish) { score += 20; reason.push('توافق الفريم الأكبر (+20)'); }
                else if (macroIsBullish) { score -= 20; reason.push('الفريم الأكبر معاكس (-20)'); }
            }
        }

        // ==========================================================
        // LAYER 4 — EMA & VWAP Alignment
        // ==========================================================
        const ema20 = data.levels.ma20 || data.levels.ma7;
        if (type === 'LONG' && cp > ema20 && cp > vwap) {
            score += 15; reason.push('فوق EMA/VWAP (+15)');
        } else if (type === 'SHORT' && cp < ema20 && cp < vwap) {
            score += 15; reason.push('تحت EMA/VWAP (+15)');
        }

        // ==========================================================
        // LAYER 5 — Momentum Indicators (MACD + StochRSI)
        // ==========================================================
        const macdHist = data.indicators?.macd?.histogram || 0;
        const stoch = data.indicators?.stochRsi || 50;

        if (type === 'LONG') {
            if (macdHist > 0) { score += 10; reason.push('MACD صاعد (+10)'); }
            if (stoch < 60) { score += 5; reason.push('StochRSI مساحة صعود (+5)'); }
        } else {
            if (macdHist < 0) { score += 10; reason.push('MACD هابط (+10)'); }
            if (stoch > 40) { score += 5; reason.push('StochRSI مساحة هبوط (+5)'); }
        }

        // ==========================================================
        // LAYER 6 — Matrix Score Weight
        // ==========================================================
        const matrixBias = (m.percentage - 50);
        if (type === 'LONG') {
            const matBonus = matrixBias * 0.5;
            score += matBonus;
            reason.push(`ماتريكس ${m.percentage.toFixed(0)}% (${matBonus >= 0 ? '+' : ''}${matBonus.toFixed(1)})`);
        } else {
            const matBonus = -matrixBias * 0.5;
            score += matBonus;
            reason.push(`ماتريكس ${m.percentage.toFixed(0)}% (${matBonus >= 0 ? '+' : ''}${matBonus.toFixed(1)})`);
        }

        // ==========================================================
        // LAYER 7 — Dynamic SL / TP
        // ==========================================================
        const safetyBuffer = Math.max(data.atr * 0.5, cp * 0.002);
        let sl = 0, tp = 0;

        if (type === 'LONG') {
            const candidateSL1 = data.levels.lastSwingLow - safetyBuffer;
            const candidateSL2 = data.levels.s2;
            sl = Math.max(candidateSL1, candidateSL2);
            sl = Math.min(sl, cp * 0.994);

            const candidateTP1 = data.levels.r1;
            const candidateTP2 = data.levels.fibTarget || 0;
            tp = Math.max(candidateTP1, candidateTP2, cp + data.atr * 2);
        } else {
            const candidateSL1 = data.levels.lastSwingHigh + safetyBuffer;
            const candidateSL2 = data.levels.r2;
            sl = Math.min(candidateSL1, candidateSL2);
            sl = Math.max(sl, cp * 1.006);

            const shortTPCandidates = [
                data.levels.s1,
                data.levels.fib382 || 0
            ].filter(v => v > 0 && v < cp);

            tp = shortTPCandidates.length > 0
                ? Math.min(...shortTPCandidates)
                : cp - data.atr * 2;
        }

        const riskDist = Math.abs(cp - sl);
        const rewardDist = Math.abs(tp - cp);
        if (riskDist <= 0 || rewardDist < riskDist * 1.5) {
            const minRisk = Math.max(riskDist, cp * 0.005);
            tp = type === 'LONG' ? cp + minRisk * 1.5 : cp - minRisk * 1.5;
            reason.push('تعديل TP لضمان R/R 1:1.5');
        }

        // ==========================================================
        // High Precision Filter Check (89.5% Win Rate)
        // ==========================================================
        const useFilter = options?.params?.highPrecisionFilter !== false;
        if (useFilter && allTimeframes) {
            const frame = OptimizedEngineSuite.buildMarketFrame(type, cp, m, allTimeframes, tf || '5m');
            const passed = OptimizedEngineSuite.runV3(frame);
            if (!passed) {
                return this.cancel(cp, `⚪ ملغاة: لم تتطابق شروط V3 Multi-Layer Sniper`, type, score, mode, `Failed V3 Filter: Quick_RSI=${frame.quickRsi?.toFixed(1)}, 1H_RSI=${frame.rsi1h?.toFixed(1)}, Matrix=${m.percentage.toFixed(0)}%, 4H_Trend=${frame.trend4h}`);
            }
        }

        // ==========================================================
        // LAYER 8 — Final Decision
        // ==========================================================
        const winRate = Math.max(0, Math.min(50 + score * 0.75, 95));
        const finalReason = `Score: ${score.toFixed(1)} | [${reason.join(' | ')}]`;

        if (winRate >= 72) {
            return {
                status: `${type === 'LONG' ? '🟢 شراء قوي' : '🔴 بيع قوي'} (${winRate.toFixed(1)}%)`,
                type, entry: cp, tp, sl,
                timeEstimate: mode === 'SCALP' ? 20 : 90,
                winRate, reverseProb: 100 - winRate,
                confidenceScore: score,
                signalReason: finalReason
            };
        } else if (winRate >= 60) {
            return {
                status: `${type === 'LONG' ? '🟡 شراء' : '🟠 بيع'} (${winRate.toFixed(1)}%)`,
                type, entry: cp, tp, sl,
                timeEstimate: mode === 'SCALP' ? 20 : 90,
                winRate, reverseProb: 100 - winRate,
                confidenceScore: score,
                signalReason: finalReason
            };
        } else {
            // Weak signal — still show real SL/TP for reference
            return this.cancel(cp, `⚪ إشارة ضعيفة (${winRate.toFixed(1)}%)`, type, score, mode, finalReason, sl, tp);
        }
    }

    private cancel(
        cp: number, statusText: string, type: string,
        score: number, mode: string,
        reason = '', sl = 0, tp = 0
    ): TradeRecommendation {
        return {
            status: statusText,
            type: type as any,
            entry: cp,
            tp: tp || cp,
            sl: sl || cp,
            timeEstimate: mode === 'SCALP' ? 20 : 90,
            winRate: 0, reverseProb: 0,
            confidenceScore: score,
            signalReason: reason || 'لم تتحقق شروط الدخول'
        };
    }
}
