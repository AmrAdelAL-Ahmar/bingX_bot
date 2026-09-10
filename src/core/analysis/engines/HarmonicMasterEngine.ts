import { ITradingEngine, EngineResult } from './ITradingEngine';
import { AnalysisDetails, MatrixResult, OHLCV, TradeRecommendation } from '../../shared/types';
import { DynamicZigZag, HarmonicPatternDetector, HarmonicConfirmator, HarmonicMatch } from '../../shared/harmonic';

export class HarmonicMasterEngine implements ITradingEngine {
    analyze(
        cp: number,
        vwap: number,
        allTimeframes: Record<string, AnalysisDetails>,
        mtfOHLCV: Record<string, OHLCV[]>,
        options: { quickTF: string; longTF: string; params?: Record<string, any> }
    ): EngineResult {
        const quickTF = options.quickTF || '5m';
        const longTF = options.longTF || '1h';

        const quickCandles = mtfOHLCV[quickTF] || mtfOHLCV['5m'] || [];
        const longCandles = mtfOHLCV[longTF] || mtfOHLCV['1h'] || [];

        const quickDetails = allTimeframes[quickTF] || allTimeframes['5m'];
        const longDetails = allTimeframes[longTF] || allTimeframes['1h'];

        // 1. Detect Scalp Harmonics (Quick TF)
        const scalpSwings = DynamicZigZag.findSwings(quickCandles, 1.6, 2);
        const scalpMatches = HarmonicPatternDetector.detectPatterns(scalpSwings, cp);
        let bestScalp: HarmonicMatch | undefined = scalpMatches[0];
        if (bestScalp && quickDetails) {
            bestScalp = HarmonicConfirmator.confirm(bestScalp, quickCandles, quickDetails.rsi);
        }

        // 2. Detect Swing Harmonics (Long TF)
        const swingSwings = DynamicZigZag.findSwings(longCandles, 2.0, 3);
        const swingMatches = HarmonicPatternDetector.detectPatterns(swingSwings, cp);
        let bestSwing: HarmonicMatch | undefined = swingMatches[0];
        if (bestSwing && longDetails) {
            bestSwing = HarmonicConfirmator.confirm(bestSwing, longCandles, longDetails.rsi);
        }

        // 3. Matrix Score formulation based on harmonic confluence
        let matrixScore = 50;
        let decision = 'محايد - لا توجد نماذج هارمونيك نشطة في منطقة الانعكاس';
        let details = 'Harmonic Engine: No active PRZ convergence.';

        const activeMatch = (bestScalp?.status === 'IN_PRZ' || bestScalp?.status === 'CONFIRMED') ? bestScalp :
                            (bestSwing?.status === 'IN_PRZ' || bestSwing?.status === 'CONFIRMED') ? bestSwing : null;

        if (activeMatch) {
            const isBullish = activeMatch.direction === 'BULLISH';
            const bonus = activeMatch.status === 'CONFIRMED' ? 25 : 15;
            matrixScore = isBullish ? Math.min(98, 70 + bonus) : Math.max(2, 30 - bonus);
            decision = `${isBullish ? '🟢 شراء توافقي قوي (LONG)' : '🔴 بيع توافقي قوي (SHORT)'} [نموذج ${activeMatch.pattern}]`;
            details = `نموذج ${activeMatch.pattern} (${activeMatch.direction}) - الحالة: ${activeMatch.status} - RRR: 1:${activeMatch.riskRewardRatio} - PRZ: [${activeMatch.prz.min.toFixed(4)} - ${activeMatch.prz.max.toFixed(4)}]`;
        }

        const matrix: MatrixResult = {
            score: matrixScore,
            percentage: matrixScore,
            decision,
            details
        };

        // 4. Recommendations
        const scalpRec: TradeRecommendation = bestScalp && (bestScalp.status === 'IN_PRZ' || bestScalp.status === 'CONFIRMED')
            ? {
                status: `HARMONIC_${bestScalp.pattern}`,
                type: bestScalp.direction === 'BULLISH' ? 'LONG' : 'SHORT',
                entry: Number(bestScalp.prz.median.toFixed(4)),
                tp: Number(bestScalp.targets.tp1.toFixed(4)),
                tp2: Number(bestScalp.targets.tp2.toFixed(4)),
                sl: Number(bestScalp.stopLoss.toFixed(4)),
                timeEstimate: 15,
                winRate: bestScalp.score,
                reverseProb: 100 - bestScalp.score,
                signalReason: `Harmonic ${bestScalp.pattern} in PRZ (${bestScalp.status})`
            }
            : {
                status: 'WAITING_PRZ',
                type: 'NONE',
                entry: cp,
                tp: cp,
                sl: cp,
                timeEstimate: 0,
                winRate: 50,
                reverseProb: 50,
                rejectionReason: 'السعر خارج منطقة الانعكاس المحتملة PRZ'
            };

        const swingRec: TradeRecommendation = bestSwing && (bestSwing.status === 'IN_PRZ' || bestSwing.status === 'CONFIRMED')
            ? {
                status: `HARMONIC_${bestSwing.pattern}`,
                type: bestSwing.direction === 'BULLISH' ? 'LONG' : 'SHORT',
                entry: Number(bestSwing.prz.median.toFixed(4)),
                tp: Number(bestSwing.targets.tp2.toFixed(4)),
                tp2: Number(bestSwing.targets.tp3.toFixed(4)),
                sl: Number(bestSwing.stopLoss.toFixed(4)),
                timeEstimate: 60,
                winRate: bestSwing.score,
                reverseProb: 100 - bestSwing.score,
                signalReason: `Harmonic Swing ${bestSwing.pattern} in PRZ (${bestSwing.status})`
            }
            : {
                status: 'WAITING_PRZ',
                type: 'NONE',
                entry: cp,
                tp: cp,
                sl: cp,
                timeEstimate: 0,
                winRate: 50,
                reverseProb: 50,
                rejectionReason: 'لا يوجد نموذج هارمونيك سوينغ مؤكد'
            };

        return {
            matrix,
            scalp: scalpRec,
            swing: swingRec
        };
    }
}
