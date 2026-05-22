import { AnalysisDetails, MatrixResult, OHLCV, TradeRecommendation } from '../../shared/types';
import { ITradingEngine, EngineResult } from './ITradingEngine';
import { TechnicalAnalyzer } from '../TechnicalAnalyzer';

export class V3Engine implements ITradingEngine {
    analyze(
        cp: number,
        vwap: number,
        allTimeframes: Record<string, AnalysisDetails>,
        mtfOHLCV: Record<string, OHLCV[]>,
        options: { quickTF: string, longTF: string }
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
            scalp: this.runProbabilityLogic(cp, scalpData, scalpOHLCV, scalpMacro, vwap, matrix, 'SCALP'),
            swing: this.runProbabilityLogic(cp, swingData, swingOHLCV, swingMacro, vwap, matrix, 'SWING'),
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
        mode: string
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

            // Macro RSI extreme penalty
            if (type === 'LONG' && macroData.rsi > 75) { score -= 15; reason.push('RSI ماكرو تشبع شرائي (-15)'); }
            if (type === 'SHORT' && macroData.rsi < 25) { score -= 15; reason.push('RSI ماكرو تشبع بيعي (-15)'); }
        }

        // ==========================================================
        // LAYER 4 — VWAP + RSI Confluence (دمج السيولة والزخم)
        // ==========================================================
        const aboveVWAP = cp > vwap;
        const vwapDist = Math.abs(cp - vwap) / vwap * 100; // distance %

        if (type === 'LONG') {
            if (aboveVWAP) {
                score += vwapDist < 0.3 ? 10 : 15;  // close to VWAP = stronger break signal
                reason.push(`فوق VWAP بـ ${vwapDist.toFixed(2)}% (+${vwapDist < 0.3 ? 10 : 15})`);
            } else {
                score -= 10; reason.push('تحت VWAP (-10)');
            }
            // RSI Zones
            if (data.rsi < 30) { score += 25; reason.push('RSI ذعر بيعي (+25)'); }
            else if (data.rsi < 45 && cp > data.levels.s1) { score += 15; reason.push('RSI ارتداد من دعم (+15)'); }
            else if (data.rsi > 75) { score -= 25; reason.push('RSI تشبع شرائي خطر (-25)'); }
            else if (data.rsi > 60) { score -= 10; reason.push('RSI مرتفع (-10)'); }
        } else {
            if (!aboveVWAP) {
                score += vwapDist < 0.3 ? 10 : 15;
                reason.push(`تحت VWAP بـ ${vwapDist.toFixed(2)}% (+${vwapDist < 0.3 ? 10 : 15})`);
            } else {
                score -= 10; reason.push('فوق VWAP (-10)');
            }
            // RSI Zones
            if (data.rsi > 70) { score += 25; reason.push('RSI ذعر شرائي (+25)'); }
            else if (data.rsi > 55 && cp < data.levels.r1) { score += 15; reason.push('RSI ارتداد من مقاومة (+15)'); }
            else if (data.rsi < 25) { score -= 25; reason.push('RSI تشبع بيعي خطر (-25)'); }
            else if (data.rsi < 40) { score -= 10; reason.push('RSI منخفض (-10)'); }
        }

        // ==========================================================
        // LAYER 5 — MACD Momentum Check (زخم MACD)
        // ==========================================================
        if (data.indicators?.macd) {
            const macdDiff = data.indicators.macd.macd - data.indicators.macd.signal;
            if (type === 'LONG') {
                if (macdDiff > 0) { score += 10; reason.push('MACD تصاعدي (+10)'); }
                else { score -= 8; reason.push('MACD تنازلي (-8)'); }
            } else {
                if (macdDiff < 0) { score += 10; reason.push('MACD تنازلي (+10)'); }
                else { score -= 8; reason.push('MACD تصاعدي (-8)'); }
            }
        }

        // ==========================================================
        // LAYER 6 — Matrix Direction Alignment
        // Direction-aware: matrix bullish helps LONG, hurts SHORT
        // ==========================================================
        const matrixBias = (m.percentage - 50); // positive = bullish bias
        if (type === 'LONG') {
            const matBonus = matrixBias * 0.5;
            score += matBonus;
            reason.push(`ماتريكس ${m.percentage.toFixed(0)}% (${matBonus >= 0 ? '+' : ''}${matBonus.toFixed(1)})`);
        } else {
            const matBonus = -matrixBias * 0.5; // invert: bullish matrix hurts SHORT
            score += matBonus;
            reason.push(`ماتريكس ${m.percentage.toFixed(0)}% (${matBonus >= 0 ? '+' : ''}${matBonus.toFixed(1)})`);
        }

        // ==========================================================
        // LAYER 7 — Dynamic SL / TP (based on technical levels)
        // ==========================================================
        const safetyBuffer = Math.max(data.atr * 0.5, cp * 0.002); // at least 0.2% safety
        let sl = 0, tp = 0;

        if (type === 'LONG') {
            // SL: highest of (lastSwingLow - buffer) or s2 — nearest to price below it
            const candidateSL1 = data.levels.lastSwingLow - safetyBuffer;
            const candidateSL2 = data.levels.s2;
            sl = Math.max(candidateSL1, candidateSL2);
            sl = Math.min(sl, cp * 0.994); // guarantee at least 0.6% below price

            // TP: farthest of r1 or fibTarget above price
            const candidateTP1 = data.levels.r1;
            const candidateTP2 = data.levels.fibTarget || 0;
            tp = Math.max(candidateTP1, candidateTP2, cp + data.atr * 2);

        } else {
            // SL: lowest of (lastSwingHigh + buffer) or r2 — nearest to price above it
            const candidateSL1 = data.levels.lastSwingHigh + safetyBuffer;
            const candidateSL2 = data.levels.r2;
            sl = Math.min(candidateSL1, candidateSL2);
            sl = Math.max(sl, cp * 1.006); // guarantee at least 0.6% above price

            // TP: lowest valid level below cp (s1 or fib382)
            const shortTPCandidates = [
                data.levels.s1,
                data.levels.fib382 || 0
            ].filter(v => v > 0 && v < cp);

            tp = shortTPCandidates.length > 0
                ? Math.min(...shortTPCandidates)
                : cp - data.atr * 2; // safe fallback
        }

        // Ensure minimum 1:1.5 R/R
        const riskDist = Math.abs(cp - sl);
        const rewardDist = Math.abs(tp - cp);
        if (riskDist <= 0 || rewardDist < riskDist * 1.5) {
            const minRisk = Math.max(riskDist, cp * 0.005);
            tp = type === 'LONG' ? cp + minRisk * 1.5 : cp - minRisk * 1.5;
            reason.push('تعديل TP لضمان R/R 1:1.5');
        }

        // ==========================================================
        // LAYER 8 — Final Decision (tiered confidence)
        // ==========================================================
        const winRate = Math.max(0, Math.min(50 + score * 0.75, 95));
        const finalReason = `Score: ${score.toFixed(1)} | [${reason.join(' | ')}]`;

        // Tiered signal response
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
