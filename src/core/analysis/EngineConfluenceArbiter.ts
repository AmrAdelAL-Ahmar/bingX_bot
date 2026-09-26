import { AnalysisResult, OHLCV, TradeRecommendation, MatrixResult } from '../shared/types';
import { CoreAnalysisService } from './CoreAnalysisService';
import { getSniperEngine } from '../sniper/SniperRegistry';
import { CoreSniperScanner } from '../sniper/CoreSniperScanner';
import { TechnicalAnalyzer, MATRIX_TFS } from './TechnicalAnalyzer';
import { WhaleSurgeDetector, WhaleSurgeReport } from './WhaleSurgeDetector';
import { RSI, SMA, EMA, BollingerBands, StochasticRSI } from 'technicalindicators';
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
    whaleSurge?: WhaleSurgeReport;
    antiPeakAnalysis?: {
        isPeak: boolean;
        isTrough: boolean;
        reason?: string;
    };
    structuralFrontRun?: {
        nearestResistance?: number;
        nearestSupport?: number;
        adjustedTp1?: number;
        adjustedTp2?: number;
        adjustedMicroTp?: number;
        wallLevel?: number;
        wallType?: string;
    };
    pullbackRetestQuality?: {
        hasHealthyRetest: boolean;
        retestScore: number;
        details: string;
    };
    confluenceMetrics: {
        overallScore: number; // 0 to 100
        recommendedDirection: 'LONG' | 'SHORT' | 'NONE';
        bullishVoteWeight: number;
        bearishVoteWeight: number;
        totalWeight: number;
        suggestedEntry: number;
        suggestedSL: number;
        suggestedMicroTP: number; // 50% quick scalp target
        suggestedTPs: number[];
        suggestedFrontRunTPs?: number[];
        suggestedFrontRunMicroTP?: number;
        riskRewardRatio: number;
    };
}

// ─── Engine Trust Weights ───────────────────────────────────────────────────

const ENGINE_WEIGHTS: Record<string, number> = {
    'HARMONIC': 1.35, // 11 Harmonic Patterns PRZ (Golden Ratio Reversals)
    'V16': 1.35,      // Master Hybrid Matrix
    'V1': 1.30,       // V1 Benchmark (VWAP & Multi-TF Core Matrix)
    'V18': 1.25,      // Order Book L2 Imbalance
    'V17': 1.25,      // Dynamic Market Regime
    'V6': 1.25,       // Momentum Confluence (RSI, MACD, Stoch)
    'V11': 1.20,      // Adaptive Decision & Regime
    'V15': 1.20,      // Chan Pen & Harmonic Bat
    'V10': 1.15,      // Institutional Heikin-Ashi & POC
    'V12': 1.15,      // Order Flow & CVD Delta
    'V13': 1.15,      // Wyckoff & Liquidity Sweep
    'V14': 1.10,      // Adaptive Renko Cloud
    'V9': 1.10,       // SMC Order Block & FVG
    'V8': 1.05,       // Wave & Liquidity Sweep
    'V7': 1.05,       // Hybrid Sniper
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
     * Checks if current market condition is an overextended peak (for LONG) or trough (for SHORT)
     */
    static checkAntiPeakConditions(
        candles: OHLCV[],
        direction: 'LONG' | 'SHORT' | 'NONE'
    ): { isExtreme: boolean; reason?: string } {
        if (!candles || candles.length < 25 || direction === 'NONE') {
            return { isExtreme: false };
        }

        const closes = candles.map(c => c.close);
        const highs = candles.map(c => c.high);
        const lows = candles.map(c => c.low);
        const lastClose = closes[closes.length - 1];

        const rsiValues = RSI.calculate({ period: 14, values: closes });
        const currentRSI = rsiValues[rsiValues.length - 1] || 50;

        const bbValues = BollingerBands.calculate({ period: 20, values: closes, stdDev: 2 });
        const currentBB = bbValues[bbValues.length - 1];

        const ma20Values = SMA.calculate({ period: 20, values: closes });
        const currentMA20 = ma20Values[ma20Values.length - 1] || lastClose;

        const stochRsiValues = StochasticRSI.calculate({ values: closes, rsiPeriod: 14, stochasticPeriod: 14, kPeriod: 3, dPeriod: 3 });
        const currentStochK = stochRsiValues[stochRsiValues.length - 1]?.k || 50;

        if (direction === 'LONG') {
            // 1. Extreme RSI + StochRSI overbought
            if (currentRSI >= 76 && currentStochK >= 85) {
                return {
                    isExtreme: true,
                    reason: `تشبع شرائي حاد (RSI: ${currentRSI.toFixed(1)} > 76، StochK: ${currentStochK.toFixed(0)})`
                };
            }

            // 2. Piercing upper Bollinger Band significantly
            if (currentBB && lastClose >= currentBB.upper * 1.002) {
                return {
                    isExtreme: true,
                    reason: `السعر خارج الحد العلوي لبولنجر باند (Upper BB Piercing)`
                };
            }

            // 3. Excessive distance above MA20 (overextended mean reversion gap > 2.5%)
            const maDistPct = ((lastClose - currentMA20) / currentMA20) * 100;
            if (maDistPct > 2.5 && currentRSI >= 70) {
                return {
                    isExtreme: true,
                    reason: `تباعد سعري مفرط عن المتوسط MA20 بنسبة +${maDistPct.toFixed(1)}% دون تصحيح`
                };
            }

            // 4. Bearish Divergence on recent candles (Price Higher High, RSI Lower High)
            if (candles.length >= 15 && rsiValues.length >= 15) {
                const prevHighCandle = Math.max(...highs.slice(-15, -3));
                const recentHighCandle = Math.max(...highs.slice(-3));
                const prevHighRsi = Math.max(...rsiValues.slice(-15, -3));
                const recentHighRsi = Math.max(...rsiValues.slice(-3));
                if (recentHighCandle > prevHighCandle && recentHighRsi < prevHighRsi - 4 && currentRSI >= 65) {
                    return {
                        isExtreme: true,
                        reason: `دايفرجنس بيعي (Bearish Divergence) قمة سعرية أعلى مع ضعف في مؤشر القوة`
                    };
                }
            }
        } else if (direction === 'SHORT') {
            // 1. Extreme RSI + StochRSI oversold
            if (currentRSI <= 24 && currentStochK <= 15) {
                return {
                    isExtreme: true,
                    reason: `تشبع بيعي حاد (RSI: ${currentRSI.toFixed(1)} < 24، StochK: ${currentStochK.toFixed(0)})`
                };
            }

            // 2. Piercing lower Bollinger Band significantly
            if (currentBB && lastClose <= currentBB.lower * 0.998) {
                return {
                    isExtreme: true,
                    reason: `السعر خارج الحد السفلي لبولنجر باند (Lower BB Piercing)`
                };
            }

            // 3. Excessive distance below MA20 (overextended drop > 2.5%)
            const maDistPct = ((currentMA20 - lastClose) / currentMA20) * 100;
            if (maDistPct > 2.5 && currentRSI <= 30) {
                return {
                    isExtreme: true,
                    reason: `تباعد سعري مفرط هبوطاً عن المتوسط MA20 بنسبة -${maDistPct.toFixed(1)}%`
                };
            }

            // 4. Bullish Divergence on recent candles (Price Lower Low, RSI Higher Low)
            if (candles.length >= 15 && rsiValues.length >= 15) {
                const prevLowCandle = Math.min(...lows.slice(-15, -3));
                const recentLowCandle = Math.min(...lows.slice(-3));
                const prevLowRsi = Math.min(...rsiValues.slice(-15, -3));
                const recentLowRsi = Math.max(...rsiValues.slice(-3));
                if (recentLowCandle < prevLowCandle && recentLowRsi > prevLowRsi + 4 && currentRSI <= 35) {
                    return {
                        isExtreme: true,
                        reason: `دايفرجنس شرائي (Bullish Divergence) قاع سعري أدنى مع ارتداد في مؤشر القوة`
                    };
                }
            }
        }

        return { isExtreme: false };
    }

    /**
     * Smart Money Pullback & Retest quality checker
     */
    static checkPullbackRetestQuality(
        candles: OHLCV[],
        direction: 'LONG' | 'SHORT' | 'NONE'
    ): { hasHealthyRetest: boolean; retestScore: number; details: string } {
        if (!candles || candles.length < 20 || direction === 'NONE') {
            return { hasHealthyRetest: true, retestScore: 50, details: 'بيانات غير كافية - افتراضي' };
        }

        const closes = candles.map(c => c.close);
        const lastCandle = candles[candles.length - 1];
        const currentPrice = lastCandle.close;

        const ema20Arr = EMA.calculate({ period: 20, values: closes });
        const ema20 = ema20Arr[ema20Arr.length - 1] || currentPrice;

        const candleRange = Math.max(0.000001, lastCandle.high - lastCandle.low);
        const lowerWick = Math.min(lastCandle.open, lastCandle.close) - lastCandle.low;
        const upperWick = lastCandle.high - Math.max(lastCandle.open, lastCandle.close);
        const lowerWickRatio = lowerWick / candleRange;
        const upperWickRatio = upperWick / candleRange;

        if (direction === 'LONG') {
            const distFromEmaPct = ((currentPrice - ema20) / ema20) * 100;
            const touchedEma = lastCandle.low <= ema20 * 1.004 && currentPrice >= ema20 * 0.996;
            const hasRejectionWick = lowerWickRatio >= 0.25;

            if (distFromEmaPct >= -0.5 && distFromEmaPct <= 1.2 && (touchedEma || hasRejectionWick)) {
                return {
                    hasHealthyRetest: true,
                    retestScore: 90,
                    details: `ارتداد ممتاز من متوسط EMA20 (تباعد ${distFromEmaPct.toFixed(2)}% مع ذيل رفض سفلي ${(lowerWickRatio * 100).toFixed(0)}%)`
                };
            } else if (distFromEmaPct > 2.0) {
                return {
                    hasHealthyRetest: false,
                    retestScore: 30,
                    details: `اندفاع متباعد (+${distFromEmaPct.toFixed(1)}% فوق EMA20) يحتاج تصحيحاً هادئاً أولاً`
                };
            }

            return {
                hasHealthyRetest: true,
                retestScore: 70,
                details: `تصحيح مقبول (تباعد +${distFromEmaPct.toFixed(1)}% عن EMA20)`
            };
        } else if (direction === 'SHORT') {
            const distFromEmaPct = ((ema20 - currentPrice) / ema20) * 100;
            const touchedEma = lastCandle.high >= ema20 * 0.996 && currentPrice <= ema20 * 1.004;
            const hasRejectionWick = upperWickRatio >= 0.25;

            if (distFromEmaPct >= -0.5 && distFromEmaPct <= 1.2 && (touchedEma || hasRejectionWick)) {
                return {
                    hasHealthyRetest: true,
                    retestScore: 90,
                    details: `ارتداد بيعي ممتاز من متوسط EMA20 (تباعد ${distFromEmaPct.toFixed(2)}% مع ذيل رفض علوي ${(upperWickRatio * 100).toFixed(0)}%)`
                };
            } else if (distFromEmaPct > 2.0) {
                return {
                    hasHealthyRetest: false,
                    retestScore: 30,
                    details: `هبوط حاد متباعد (-${distFromEmaPct.toFixed(1)}% تحت EMA20) يحتاج تصحيحاً صاعداً أولاً`
                };
            }

            return {
                hasHealthyRetest: true,
                retestScore: 70,
                details: `تصحيح بيعي مقبول (تباعد -${distFromEmaPct.toFixed(1)}% عن EMA20)`
            };
        }

        return { hasHealthyRetest: true, retestScore: 50, details: 'محايد' };
    }

    /**
     * Calculates front-running target prices placed 0.20% before resistance/support walls
     */
    static calculateFrontRunTp(
        currentPrice: number,
        direction: 'LONG' | 'SHORT' | 'NONE',
        srLevels: SupportResistanceLevels,
        h1Candles: OHLCV[],
        pricePrecision: number,
        baseTp: number
    ): { adjustedTp: number; wallLevel: number; wallType: string } {
        if (direction === 'NONE' || currentPrice <= 0) {
            return { adjustedTp: baseTp, wallLevel: 0, wallType: 'NONE' };
        }

        const buffer = 0.0020; // 0.20% buffer before the wall

        if (direction === 'LONG') {
            const recentHighs = h1Candles.slice(-30).map(c => c.high);
            const swingHigh = recentHighs.length > 0 ? Math.max(...recentHighs) : 0;

            const candidateResistances: { level: number; type: string }[] = [];
            if (srLevels.r1 > currentPrice) candidateResistances.push({ level: srLevels.r1, type: 'R1' });
            if (srLevels.r2 > currentPrice) candidateResistances.push({ level: srLevels.r2, type: 'R2' });
            if (srLevels.pivot > currentPrice) candidateResistances.push({ level: srLevels.pivot, type: 'Pivot' });
            if (swingHigh > currentPrice * 1.003) candidateResistances.push({ level: swingHigh, type: 'Swing High' });

            candidateResistances.sort((a, b) => a.level - b.level);

            for (const res of candidateResistances) {
                const frontRunPrice = Number((res.level * (1 - buffer)).toFixed(pricePrecision));
                if (frontRunPrice > currentPrice * 1.0035) {
                    if (baseTp >= frontRunPrice) {
                        return { adjustedTp: frontRunPrice, wallLevel: res.level, wallType: res.type };
                    }
                }
            }
        } else if (direction === 'SHORT') {
            const recentLows = h1Candles.slice(-30).map(c => c.low);
            const swingLow = recentLows.length > 0 ? Math.min(...recentLows) : 0;

            const candidateSupports: { level: number; type: string }[] = [];
            if (srLevels.s1 > 0 && srLevels.s1 < currentPrice) candidateSupports.push({ level: srLevels.s1, type: 'S1' });
            if (srLevels.s2 > 0 && srLevels.s2 < currentPrice) candidateSupports.push({ level: srLevels.s2, type: 'S2' });
            if (srLevels.pivot > 0 && srLevels.pivot < currentPrice) candidateSupports.push({ level: srLevels.pivot, type: 'Pivot' });
            if (swingLow > 0 && swingLow < currentPrice * 0.997) candidateSupports.push({ level: swingLow, type: 'Swing Low' });

            candidateSupports.sort((a, b) => b.level - a.level);

            for (const sup of candidateSupports) {
                const frontRunPrice = Number((sup.level * (1 + buffer)).toFixed(pricePrecision));
                if (frontRunPrice < currentPrice * 0.9965) {
                    if (baseTp <= frontRunPrice) {
                        return { adjustedTp: frontRunPrice, wallLevel: sup.level, wallType: sup.type };
                    }
                }
            }
        }

        return { adjustedTp: Number(baseTp.toFixed(pricePrecision)), wallLevel: 0, wallType: 'NONE' };
    }

    /**
     * Runs multi-engine evaluation and builds the complete InstitutionalMarketDossier
     */
    static buildDossier(
        symbol: string,
        pricePrecision: number,
        mtfOHLCV: Record<string, OHLCV[]>,
        options: { quickTF?: string; longTF?: string; tradeStyle?: 'HYBRID' | 'SCALP' | 'SWING' | 'SCALP_TURBO' | 'WHALE_SURGE' } = {}
    ): InstitutionalMarketDossier {
        const quickTF = options.quickTF || '15m';
        const longTF = options.longTF || '1h';
        const tradeStyle = options.tradeStyle || 'HYBRID';

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

                const isScalp = tradeStyle === 'SCALP' || tradeStyle === 'SCALP_TURBO';
                const activeRec = isScalp
                    ? (res.scalp.type !== 'NONE' ? res.scalp : null)
                    : tradeStyle === 'SWING'
                        ? (res.swing.type !== 'NONE' ? res.swing : null)
                        : (res.scalp.type !== 'NONE' ? res.scalp : (res.swing.type !== 'NONE' ? res.swing : null));
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

        // ── 3b. Whale Surge / SMC Breakout Evaluation ───────────────────────
        const isWhaleSurge = tradeStyle === 'WHALE_SURGE';
        let whaleSurgeReport: WhaleSurgeReport | undefined;

        if (isWhaleSurge) {
            try {
                whaleSurgeReport = WhaleSurgeDetector.analyze(symbol, pricePrecision, mtfOHLCV);
                if (whaleSurgeReport.isQualified) {
                    if (whaleSurgeReport.direction === 'LONG') {
                        bullScore += 25;
                    } else if (whaleSurgeReport.direction === 'SHORT') {
                        bearScore += 25;
                    }
                }
            } catch (surgeErr: any) {
                logger.warn(`[Arbiter] WhaleSurge analysis error: ${surgeErr.message}`);
            }
        }

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

        const isTurbo = tradeStyle === 'SCALP_TURBO';

        // In SCALP_TURBO: stop loss is balanced between 0.8% and 1.0% to match the quick 0.55% micro-target
        // For HYBRID / SWING / SCALP: enforce minimum 1.6% or 1.8x ATR to avoid noise stop hunts
        const minSlDist = isTurbo
            ? currentPrice * 0.008 // 0.8% minimum
            : Math.max(atr15m * 1.8, currentPrice * 0.016);

        const maxSlDist = isTurbo
            ? currentPrice * 0.010 // 1.0% maximum
            : currentPrice * 0.035;

        // Filter SL candidates that strictly match the recommended trade direction and respect the safety buffers
        const validSlCandidates = slCandidates.filter(sl => {
            if (recDir === 'LONG') {
                const dist = currentPrice - sl;
                return dist >= minSlDist && dist <= maxSlDist;
            }
            if (recDir === 'SHORT') {
                const dist = sl - currentPrice;
                return dist >= minSlDist && dist <= maxSlDist;
            }
            return false;
        });

        let suggestedSL: number;
        if (recDir === 'LONG') {
            suggestedSL = validSlCandidates.length > 0
                ? Math.max(...validSlCandidates)
                : currentPrice - (isTurbo ? currentPrice * 0.009 : minSlDist);
            // Strict bound: SL must always be below entry
            if (suggestedSL >= currentPrice) suggestedSL = currentPrice - minSlDist;
            if (isTurbo && (currentPrice - suggestedSL) > maxSlDist) suggestedSL = currentPrice - maxSlDist;
        } else {
            suggestedSL = validSlCandidates.length > 0
                ? Math.min(...validSlCandidates)
                : currentPrice + (isTurbo ? currentPrice * 0.009 : minSlDist);
            // Strict bound: SL must always be above entry
            if (suggestedSL <= currentPrice) suggestedSL = currentPrice + minSlDist;
            if (isTurbo && (suggestedSL - currentPrice) > maxSlDist) suggestedSL = currentPrice + maxSlDist;
        }

        const riskDist = Math.max(Math.abs(currentPrice - suggestedSL), minSlDist);

        // Standard Targets
        let tp1 = recDir === 'LONG' ? currentPrice + (riskDist * 1.5) : currentPrice - (riskDist * 1.5);
        let tp2 = recDir === 'LONG' ? currentPrice + (riskDist * 2.5) : currentPrice - (riskDist * 2.5);
        let tp3 = recDir === 'LONG'
            ? (fibZones.fibTarget1272 > tp2 ? fibZones.fibTarget1272 : currentPrice + (riskDist * 4.0))
            : (fibZones.fib786 < tp2 ? fibZones.fib786 : currentPrice - (riskDist * 4.0));

        // Override targets and SL if qualified Whale Surge was detected
        if (isWhaleSurge && whaleSurgeReport && whaleSurgeReport.isQualified) {
            recDir = whaleSurgeReport.direction;
            dominantScore = Math.max(dominantScore, whaleSurgeReport.confidenceScore);
            suggestedSL = whaleSurgeReport.suggestedSL;
            tp1 = whaleSurgeReport.suggestedTPs[0];
            tp2 = whaleSurgeReport.suggestedTPs[1];
            tp3 = whaleSurgeReport.suggestedTPs[2];
        }

        const rewardDist = Math.abs(tp1 - currentPrice);
        const rrr = riskDist > 0 ? Number((rewardDist / riskDist).toFixed(2)) : 1.5;

        // Ultra-Fast Scalp Target (Micro-TP): close target (0.45% - 0.65% price move)
        // Highly reachable in 1-3 candles, giving 10%-20% profit on high leverage (20x-30x)
        const microDist = Math.max(currentPrice * 0.005, Math.min(rewardDist * 0.35, currentPrice * 0.008));
        const microTP = (isWhaleSurge && whaleSurgeReport && whaleSurgeReport.isQualified)
            ? whaleSurgeReport.suggestedTPs[0]
            : (recDir === 'LONG' ? currentPrice + microDist : currentPrice - microDist);

        // ── 4.1 Anti-Peak and Anti-Trough Guard ──
        const antiPeakCheck = this.checkAntiPeakConditions(quickCandles, recDir);

        // ── 4.2 Pullback & Retest Quality Check ──
        const retestQuality = this.checkPullbackRetestQuality(quickCandles, recDir);
        if (retestQuality.hasHealthyRetest && retestQuality.retestScore >= 85) {
            dominantScore = Math.min(98, dominantScore + 4);
        } else if (!retestQuality.hasHealthyRetest && !isWhaleSurge) {
            dominantScore = Math.max(40, dominantScore - 8);
        }

        // ── 4.3 Structural Front-Running Take-Profits ──
        const frontRun1 = this.calculateFrontRunTp(currentPrice, recDir, srLevels, h1Candles, pricePrecision, tp1);
        const frontRun2 = this.calculateFrontRunTp(currentPrice, recDir, srLevels, h1Candles, pricePrecision, tp2);
        const frontRunMicro = this.calculateFrontRunTp(currentPrice, recDir, srLevels, h1Candles, pricePrecision, microTP);

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
            antiPeakAnalysis: {
                isPeak: antiPeakCheck.isExtreme && recDir === 'LONG',
                isTrough: antiPeakCheck.isExtreme && recDir === 'SHORT',
                reason: antiPeakCheck.reason
            },
            structuralFrontRun: {
                nearestResistance: srLevels.r1 > currentPrice ? srLevels.r1 : (srLevels.pivot > currentPrice ? srLevels.pivot : 0),
                nearestSupport: srLevels.s1 > 0 && srLevels.s1 < currentPrice ? srLevels.s1 : (srLevels.pivot < currentPrice ? srLevels.pivot : 0),
                adjustedTp1: frontRun1.adjustedTp,
                adjustedTp2: frontRun2.adjustedTp,
                adjustedMicroTp: frontRunMicro.adjustedTp,
                wallLevel: frontRun1.wallLevel || frontRunMicro.wallLevel,
                wallType: frontRun1.wallType !== 'NONE' ? frontRun1.wallType : frontRunMicro.wallType
            },
            pullbackRetestQuality: retestQuality,
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
            whaleSurge: whaleSurgeReport,
            confluenceMetrics: {
                overallScore: dominantScore,
                recommendedDirection: recDir,
                bullishVoteWeight: Number(bullishWeight.toFixed(2)),
                bearishVoteWeight: Number(bearishWeight.toFixed(2)),
                totalWeight: Number(totalMatrixWeight.toFixed(2)),
                suggestedEntry: Number(avgEntry.toFixed(pricePrecision)),
                suggestedSL: Number(suggestedSL.toFixed(pricePrecision)),
                suggestedMicroTP: Number(microTP.toFixed(pricePrecision)),
                suggestedTPs: [
                    Number(tp1.toFixed(pricePrecision)),
                    Number(tp2.toFixed(pricePrecision)),
                    Number(tp3.toFixed(pricePrecision))
                ],
                suggestedFrontRunTPs: [
                    frontRun1.adjustedTp,
                    frontRun2.adjustedTp,
                    Number(tp3.toFixed(pricePrecision))
                ],
                suggestedFrontRunMicroTP: frontRunMicro.adjustedTp,
                riskRewardRatio: rrr
            }
        };
    }
}
