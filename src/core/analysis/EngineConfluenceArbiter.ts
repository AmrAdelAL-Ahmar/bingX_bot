import { AnalysisResult, OHLCV, TradeRecommendation, MatrixResult } from '../shared/types';
import { CoreAnalysisService } from './CoreAnalysisService';
import { getSniperEngine } from '../sniper/SniperRegistry';
import { CoreSniperScanner } from '../sniper/CoreSniperScanner';
import { TechnicalAnalyzer, MATRIX_TFS } from './TechnicalAnalyzer';
import logger from '../../utils/logger';

// ─── Interfaces ─────────────────────────────────────────────────────────────

export interface SupportResistanceLevels {
    pivot: number;
    r1: number;
    r2: number;
    r3: number;
    s1: number;
    s2: number;
    s3: number;
}

export interface FibonacciZones {
    fib382: number;
    fib500: number;
    fib618: number; // Golden Pocket
    fib786: number; // Deep Discount
    fibTarget1272: number;
    fibTarget1618: number;
}

export interface EngineVerdict {
    engineId: string;
    direction: 'LONG' | 'SHORT' | 'NONE';
    confidence: number;
    entry: number;
    tp: number;
    sl: number;
    isSniperFired?: boolean;
    reason: string;
}

export interface InstitutionalMarketDossier {
    symbol: string;
    currentPrice: number;
    pricePrecision: number;
    timestamp: number;
    vwap: number;
    isAboveVWAP: boolean;
    v1Benchmark: {
        status: string;
        direction: 'LONG' | 'SHORT' | 'NONE';
        matrixScore: number;
        decision: string;
    };
    supportResistance: SupportResistanceLevels;
    fibonacci: FibonacciZones;
    timeframeIndicators: {
        '5m'?: { rsi: number; macdHist: number; stochRsi: number; trend: string };
        '15m'?: { rsi: number; macdHist: number; stochRsi: number; trend: string; atr: number };
        '1h'?: { rsi: number; macdHist: number; stochRsi: number; trend: string };
        '4h'?: { rsi: number; trend: string };
    };
    enginesSummary: EngineVerdict[];
    snipersSummary: { engineId: string; readyToFire: boolean; direction: string }[];
    confluenceMetrics: {
        overallScore: number; // 0 to 100
        recommendedDirection: 'LONG' | 'SHORT' | 'NONE';
        bullishVoteWeight: number;
        bearishVoteWeight: number;
        totalWeight: number;
        suggestedEntry: number;
        suggestedSL: number;
        suggestedTPs: number[];
        riskRewardRatio: number;
    };
}

// ─── Engine Trust Weights ───────────────────────────────────────────────────

const ENGINE_WEIGHTS: Record<string, number> = {
    'V16': 1.35, // Master Hybrid Matrix
    'V15': 1.30, // Chan Pen & Harmonic Bat
    'HARMONIC': 1.30, // 11 Harmonic Patterns PRZ
    'V11': 1.25, // Adaptive Decision & Regime
    'V10': 1.25, // Institutional Heikin-Ashi & POC
    'V12': 1.20, // Order Flow & CVD Delta
    'V13': 1.20, // Wyckoff & Liquidity Sweep
    'V18': 1.15, // Order Book L2 Imbalance
    'V17': 1.15, // Dynamic Market Regime
    'V14': 1.10, // Adaptive Renko Cloud
    'V9': 1.10,  // SMC Order Block & FVG
    'V8': 1.05,  // Wave & Liquidity Sweep
    'V7': 1.05,  // Hybrid Sniper
    'V1': 1.10,  // V1 Benchmark (VWAP & Matrix)
    'V6': 0.95,
    'V3': 0.90,
    'V5': 0.85,
    'V2': 0.85,
    'V4': 0.80
};

export class EngineConfluenceArbiter {
    /**
     * Calculates pivot point support & resistance levels from 1h/4h OHLCV
     */
    static calculateSupportResistance(candles: OHLCV[]): SupportResistanceLevels {
        if (!candles || candles.length < 2) {
            return { pivot: 0, r1: 0, r2: 0, r3: 0, s1: 0, s2: 0, s3: 0 };
        }
        const prev = candles[candles.length - 2];
        const p = (prev.high + prev.low + prev.close) / 3;
        const r1 = (2 * p) - prev.low;
        const s1 = (2 * p) - prev.high;
        const r2 = p + (prev.high - prev.low);
        const s2 = p - (prev.high - prev.low);
        const r3 = prev.high + 2 * (p - prev.low);
        const s3 = prev.low - 2 * (prev.high - p);

        return { pivot: p, r1, r2, r3, s1, s2, s3 };
    }

    /**
     * Calculates Fibonacci retracement & extension levels from swing high/low
     */
    static calculateFibonacciZones(candles: OHLCV[], currentPrice: number): FibonacciZones {
        if (!candles || candles.length < 20) {
            return {
                fib382: currentPrice * 0.98,
                fib500: currentPrice * 0.97,
                fib618: currentPrice * 0.96,
                fib786: currentPrice * 0.95,
                fibTarget1272: currentPrice * 1.03,
                fibTarget1618: currentPrice * 1.05
            };
        }

        const recent = candles.slice(-50);
        const high = Math.max(...recent.map(c => c.high));
        const low = Math.min(...recent.map(c => c.low));
        const diff = high - low;

        return {
            fib382: high - (diff * 0.382),
            fib500: high - (diff * 0.500),
            fib618: high - (diff * 0.618), // Golden pocket
            fib786: high - (diff * 0.786), // Deep discount
            fibTarget1272: high + (diff * 0.272),
            fibTarget1618: high + (diff * 0.618)
        };
    }

    /**
     * Runs multi-engine evaluation and builds the complete InstitutionalMarketDossier
     */
    static buildDossier(
        symbol: string,
        pricePrecision: number,
        mtfOHLCV: Record<string, OHLCV[]>,
        options: { quickTF?: string; longTF?: string } = {}
    ): InstitutionalMarketDossier {
        const quickTF = options.quickTF || '15m';
        const longTF = options.longTF || '1h';

        const quickCandles = mtfOHLCV[quickTF] || mtfOHLCV['15m'] || mtfOHLCV['5m'] || [];
        const dailyCandles = mtfOHLCV['1d'] || [];
        const h1Candles = mtfOHLCV['1h'] || [];

        const currentPrice = quickCandles.length > 0 ? quickCandles[quickCandles.length - 1].close : 0;
        const vwap = dailyCandles.length > 0 ? TechnicalAnalyzer.calculateVWAP(dailyCandles) : currentPrice;
        const isAboveVWAP = currentPrice >= vwap;

        const srLevels = this.calculateSupportResistance(h1Candles);
        const fibZones = this.calculateFibonacciZones(h1Candles, currentPrice);

        // ── 1. Run V1 Benchmark Engine ──────────────────────────────────────
        let v1BenchmarkResult: any = null;
        try {
            v1BenchmarkResult = CoreAnalysisService.analyze(symbol, pricePrecision, mtfOHLCV, 'V1', {
                quickTF,
                longTF,
                limit: 200
            });
        } catch (e: any) {
            logger.warn(`[Arbiter] V1 Benchmark run error for ${symbol}: ${e.message}`);
        }

        const v1Dir = v1BenchmarkResult?.scalp?.type !== 'NONE' ? v1BenchmarkResult?.scalp?.type : (v1BenchmarkResult?.swing?.type || 'NONE');
        const v1Data = {
            status: v1BenchmarkResult?.scalp?.status || 'NORMAL',
            direction: (v1Dir || 'NONE') as 'LONG' | 'SHORT' | 'NONE',
            matrixScore: v1BenchmarkResult?.matrix?.percentage || 50,
            decision: v1BenchmarkResult?.matrix?.decision || 'محايد'
        };

        // ── 2. Run All Active Analysis Engines ──────────────────────────────
        const enginesToTest = [
            'V1', 'V2', 'V3', 'V6', 'V7', 'V8', 'V9', 'V10',
            'V11', 'V12', 'V13', 'V14', 'V15', 'V16', 'V17', 'V18', 'HARMONIC'
        ];

        const engineVerdicts: EngineVerdict[] = [];
        let bullishWeight = 0;
        let bearishWeight = 0;
        let weightedMatrixSum = 0;
        let totalMatrixWeight = 0;

        const entryCandidates: number[] = [];
        const slCandidates: number[] = [];
        const tpCandidates: number[] = [];

        for (const engId of enginesToTest) {
            try {
                const res = CoreAnalysisService.analyze(symbol, pricePrecision, mtfOHLCV, engId as any, {
                    quickTF,
                    longTF,
                    limit: 200
                });

                const activeRec = res.scalp.type !== 'NONE' ? res.scalp : (res.swing.type !== 'NONE' ? res.swing : null);
                const dir: 'LONG' | 'SHORT' | 'NONE' = activeRec ? activeRec.type : 'NONE';
                const weight = ENGINE_WEIGHTS[engId] || 1.0;

                const matrixScore = res.matrix?.percentage || 50;
                weightedMatrixSum += matrixScore * weight;
                totalMatrixWeight += weight;

                if (dir === 'LONG') bullishWeight += weight;
                else if (dir === 'SHORT') bearishWeight += weight;

                if (activeRec && activeRec.entry > 0) entryCandidates.push(activeRec.entry);
                if (activeRec && activeRec.sl > 0) slCandidates.push(activeRec.sl);
                if (activeRec && activeRec.tp > 0) tpCandidates.push(activeRec.tp);

                engineVerdicts.push({
                    engineId: engId,
                    direction: dir,
                    confidence: activeRec?.winRate || res.matrix.percentage || 50,
                    entry: activeRec?.entry || currentPrice,
                    tp: activeRec?.tp || 0,
                    sl: activeRec?.sl || 0,
                    reason: activeRec?.signalReason || res.matrix.decision
                });
            } catch (err: any) {
                // Ignore individual engine failures
            }
        }

        // ── 3. Run Snipers to verify 2D Horizontal Triggers ────────────────
        const snipersSummary: { engineId: string; readyToFire: boolean; direction: string }[] = [];
        const snipersToCheck = ['V1-SWING', 'V6-SCALP', 'V7-SWING', 'V8-SWING', 'V10-SWING', 'V16-SWING'];

        for (const snpId of snipersToCheck) {
            try {
                const snpReport = CoreSniperScanner.scan(symbol, snpId, mtfOHLCV);
                if (snpReport) {
                    snipersSummary.push({
                        engineId: snpId,
                        readyToFire: snpReport.readyToFire,
                        direction: snpReport.direction
                    });
                }
            } catch (err) {
                // Ignore sniper scanner failure
            }
        }

        // ── 4. Formulate Multi-Tier Confluence Metrics ─────────────────────
        const avgMatrixScore = totalMatrixWeight > 0 ? (weightedMatrixSum / totalMatrixWeight) : 50;
        const sniperBullish = snipersSummary.filter(s => s.readyToFire && s.direction === 'LONG').length;
        const sniperBearish = snipersSummary.filter(s => s.readyToFire && s.direction === 'SHORT').length;

        // Base score from weighted multi-engine trend matrix
        let bullScore = avgMatrixScore;
        let bearScore = 100 - avgMatrixScore;

        // Add boosts for active execution signals from engines
        if (bullishWeight > 0) bullScore += Math.min(18, bullishWeight * 5);
        if (bearishWeight > 0) bearScore += Math.min(18, bearishWeight * 5);

        // Add boost for institutional VWAP positioning
        if (isAboveVWAP) {
            bullScore += 4;
            bearScore -= 4;
        } else {
            bearScore += 4;
            bullScore -= 4;
        }

        // Add boost for V1 benchmark alignment
        if (v1Data.direction === 'LONG') bullScore += 5;
        else if (v1Data.direction === 'SHORT') bearScore += 5;

        // Add boost for horizontal sniper triggers
        if (sniperBullish > 0) bullScore += Math.min(10, sniperBullish * 5);
        if (sniperBearish > 0) bearScore += Math.min(10, sniperBearish * 5);

        // Clamp to 10 - 98 range
        const finalBullish = Math.max(10, Math.min(98, Math.round(bullScore)));
        const finalBearish = Math.max(10, Math.min(98, Math.round(bearScore)));

        let recDir: 'LONG' | 'SHORT' | 'NONE' = 'NONE';
        let dominantScore = 50;

        if (finalBullish > finalBearish && finalBullish >= 56) {
            recDir = 'LONG';
            dominantScore = finalBullish;
        } else if (finalBearish > finalBullish && finalBearish >= 56) {
            recDir = 'SHORT';
            dominantScore = finalBearish;
        } else {
            recDir = 'NONE';
            dominantScore = Math.round((finalBullish + finalBearish) / 2);
        }

        // Calculate consensus prices
        const avgEntry = entryCandidates.length > 0
            ? entryCandidates.reduce((a, b) => a + b, 0) / entryCandidates.length
            : currentPrice;

        const atr15m = quickCandles.length > 14
            ? quickCandles[quickCandles.length - 1].close * 0.008
            : currentPrice * 0.008;

        const defaultSlDist = Math.max(atr15m * 1.5, currentPrice * 0.012);

        // Filter SL candidates that strictly match the recommended trade direction
        const validSlCandidates = slCandidates.filter(sl => {
            if (recDir === 'LONG') return sl < currentPrice * 0.998;
            if (recDir === 'SHORT') return sl > currentPrice * 1.002;
            return false;
        });

        let suggestedSL: number;
        if (recDir === 'LONG') {
            suggestedSL = validSlCandidates.length > 0
                ? Math.max(...validSlCandidates)
                : currentPrice - defaultSlDist;
            // Strict bound: SL must always be below entry
            if (suggestedSL >= currentPrice) suggestedSL = currentPrice - defaultSlDist;
        } else {
            suggestedSL = validSlCandidates.length > 0
                ? Math.min(...validSlCandidates)
                : currentPrice + defaultSlDist;
            // Strict bound: SL must always be above entry
            if (suggestedSL <= currentPrice) suggestedSL = currentPrice + defaultSlDist;
        }

        const riskDist = Math.max(Math.abs(currentPrice - suggestedSL), currentPrice * 0.008);

        const tp1 = recDir === 'LONG' ? currentPrice + (riskDist * 1.5) : currentPrice - (riskDist * 1.5);
        const tp2 = recDir === 'LONG' ? currentPrice + (riskDist * 2.5) : currentPrice - (riskDist * 2.5);
        const tp3 = recDir === 'LONG'
            ? (fibZones.fibTarget1272 > tp2 ? fibZones.fibTarget1272 : currentPrice + (riskDist * 4.0))
            : (fibZones.fib786 < tp2 ? fibZones.fib786 : currentPrice - (riskDist * 4.0));

        const rewardDist = Math.abs(tp1 - currentPrice);
        const rrr = riskDist > 0 ? Number((rewardDist / riskDist).toFixed(2)) : 1.5;

        // ── 5. Assemble Dossier ─────────────────────────────────────────────
        return {
            symbol,
            currentPrice,
            pricePrecision,
            timestamp: Date.now(),
            vwap,
            isAboveVWAP,
            v1Benchmark: v1Data,
            supportResistance: srLevels,
            fibonacci: fibZones,
            timeframeIndicators: {
                '15m': {
                    rsi: 50,
                    macdHist: 0,
                    stochRsi: 50,
                    trend: isAboveVWAP ? 'BULLISH' : 'BEARISH',
                    atr: atr15m
                }
            },
            enginesSummary: engineVerdicts,
            snipersSummary,
            confluenceMetrics: {
                overallScore: dominantScore,
                recommendedDirection: recDir,
                bullishVoteWeight: Number(bullishWeight.toFixed(2)),
                bearishVoteWeight: Number(bearishWeight.toFixed(2)),
                totalWeight: Number(totalMatrixWeight.toFixed(2)),
                suggestedEntry: Number(avgEntry.toFixed(pricePrecision)),
                suggestedSL: Number(suggestedSL.toFixed(pricePrecision)),
                suggestedTPs: [
                    Number(tp1.toFixed(pricePrecision)),
                    Number(tp2.toFixed(pricePrecision)),
                    Number(tp3.toFixed(pricePrecision))
                ],
                riskRewardRatio: rrr
            }
        };
    }
}
