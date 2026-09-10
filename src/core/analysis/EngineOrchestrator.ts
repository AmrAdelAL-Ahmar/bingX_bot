import { CoreAnalysisService, SupportedEngineVersion } from './CoreAnalysisService';
import { AnalysisDetails, MatrixResult, OHLCV, TradeRecommendation } from '../shared/types';
import { V17Engine, MarketRegime } from './engines/V17Engine';

export interface EngineVote {
    engineId: SupportedEngineVersion;
    decision: 'LONG' | 'SHORT' | 'NONE';
    score: number;
    reason: string;
}

export interface OrchestratedSignal {
    symbol: string;
    action: 'LONG' | 'SHORT' | 'HOLD';
    confidence: number;
    regime: MarketRegime;
    selectedEngine: SupportedEngineVersion;
    concurringEngines: SupportedEngineVersion[];
    opposingEngines: SupportedEngineVersion[];
    votes: EngineVote[];
    recommendation: TradeRecommendation;
    summary: string;
}

export class EngineOrchestrator {
    private static ALL_ENGINES: SupportedEngineVersion[] = [
        'V1', 'V2', 'V3', 'V4', 'V5', 'V6', 'V7', 'V8',
        'V9', 'V10', 'V11', 'V12', 'V13', 'V14', 'V15', 'V16',
        'V17', 'V18', 'HARMONIC'
    ];

    /**
     * Runs all engines in parallel and returns each engine's vote
     */
    static runAllEngines(
        symbol: string,
        pricePrecision: number,
        mtfOHLCV: Record<string, OHLCV[]>,
        options: { quickTF: string; longTF: string; limit: number }
    ): EngineVote[] {
        const votes: EngineVote[] = [];

        for (const engineId of this.ALL_ENGINES) {
            try {
                const analysis = CoreAnalysisService.analyze(symbol, pricePrecision, mtfOHLCV, engineId, options);
                const scalp = analysis.scalp;
                const matrix = analysis.matrix;

                let decision: 'LONG' | 'SHORT' | 'NONE' = 'NONE';
                if (scalp.type === 'LONG' && matrix.score >= 60) {
                    decision = 'LONG';
                } else if (scalp.type === 'SHORT' && matrix.score <= 40) {
                    decision = 'SHORT';
                }

                votes.push({
                    engineId,
                    decision,
                    score: matrix.score,
                    reason: scalp.signalReason || matrix.decision
                });
            } catch (err) {
                // Graceful fallback for any missing TF in specific engine
                votes.push({
                    engineId,
                    decision: 'NONE',
                    score: 50,
                    reason: 'Engine execution skipped or missing data'
                });
            }
        }

        return votes;
    }

    /**
     * Determines unified trading signal either via Multi-Engine Consensus or Market-Adaptive Routing
     */
    static orchestrate(
        symbol: string,
        pricePrecision: number,
        mtfOHLCV: Record<string, OHLCV[]>,
        mode: 'CONSENSUS' | 'ADAPTIVE_REGIME' = 'CONSENSUS',
        options: { quickTF: string; longTF: string; limit: number } = { quickTF: '5m', longTF: '1h', limit: 100 }
    ): OrchestratedSignal {
        const quickCandles = mtfOHLCV[options.quickTF] || mtfOHLCV['5m'] || [];
        const quickData = CoreAnalysisService.analyze(symbol, pricePrecision, mtfOHLCV, 'V1', options);
        const currentPrice = quickData.currentPrice;

        // 1. Detect Regime using V17
        const regimeInfo = V17Engine.detectRegime(quickCandles, quickData.scalp);

        // 2. Poll all 19 engines
        const votes = this.runAllEngines(symbol, pricePrecision, mtfOHLCV, options);

        const longVotes = votes.filter(v => v.decision === 'LONG');
        const shortVotes = votes.filter(v => v.decision === 'SHORT');

        let action: 'LONG' | 'SHORT' | 'HOLD' = 'HOLD';
        let selectedEngine: SupportedEngineVersion = 'HARMONIC';
        let concurringEngines: SupportedEngineVersion[] = [];
        let opposingEngines: SupportedEngineVersion[] = [];
        let confidence = 50;

        if (mode === 'ADAPTIVE_REGIME') {
            // Adaptive mode picks the engine best suited for the regime
            const candidateList = regimeInfo.recommendedEngines as SupportedEngineVersion[];
            selectedEngine = candidateList[0] || 'HARMONIC';

            // Check if recommended engine generated an actionable signal
            const primaryVote = votes.find(v => v.engineId === selectedEngine);
            if (primaryVote && primaryVote.decision !== 'NONE') {
                action = primaryVote.decision;
                confidence = regimeInfo.confidence;
            } else {
                // Fallback to Harmonic if in PRZ
                const harmonicVote = votes.find(v => v.engineId === 'HARMONIC');
                if (harmonicVote && harmonicVote.decision !== 'NONE') {
                    action = harmonicVote.decision;
                    selectedEngine = 'HARMONIC';
                    confidence = 85;
                }
            }
        } else {
            // Consensus mode: requires threshold of agreeing engines (>= 3 engines)
            if (longVotes.length >= 3 && longVotes.length > shortVotes.length) {
                action = 'LONG';
                concurringEngines = longVotes.map(v => v.engineId);
                opposingEngines = shortVotes.map(v => v.engineId);
                confidence = Math.min(99, Math.round(50 + (longVotes.length / this.ALL_ENGINES.length) * 50));
                selectedEngine = longVotes[0].engineId;
            } else if (shortVotes.length >= 3 && shortVotes.length > longVotes.length) {
                action = 'SHORT';
                concurringEngines = shortVotes.map(v => v.engineId);
                opposingEngines = longVotes.map(v => v.engineId);
                confidence = Math.min(99, Math.round(50 + (shortVotes.length / this.ALL_ENGINES.length) * 50));
                selectedEngine = shortVotes[0].engineId;
            }
        }

        // 3. Build trade recommendation using selected engine output
        const bestAnalysis = CoreAnalysisService.analyze(symbol, pricePrecision, mtfOHLCV, selectedEngine, options);
        const rec = bestAnalysis.scalp;

        const summary = action !== 'HOLD'
            ? `🚀 إجماع المحركات الموحد: ${action === 'LONG' ? 'شراء 🟢' : 'بيع 🔴'} (${confidence}% ثقة) بموافقة ${concurringEngines.length} محركاً [المحرك الأساسي: ${selectedEngine}]`
            : `⚖️ المحركات في وضع توازن أو انتظار إشارة إجماع قوية (Long: ${longVotes.length}, Short: ${shortVotes.length})`;

        return {
            symbol,
            action,
            confidence,
            regime: regimeInfo.regime,
            selectedEngine,
            concurringEngines,
            opposingEngines,
            votes,
            recommendation: rec,
            summary
        };
    }
}
