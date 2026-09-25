import { OHLCV } from '../shared/types';
import logger from '../../utils/logger';

export interface LiquiditySweepDetail {
    detected: boolean;
    type: 'BULLISH_SWEEP' | 'BEARISH_SWEEP' | 'NONE';
    sweepPrice: number;
    sweptLevel: number;
    rejectionStrength: number; // 0 to 100%
    reason: string;
}

export interface StructureBreakDetail {
    detected: boolean;
    type: 'BOS_LONG' | 'BOS_SHORT' | 'CHOCH_LONG' | 'CHOCH_SHORT' | 'NONE';
    brokenLevel: number;
    displacementRatio: number; // body / range ratio
    fvgPresent: boolean;
    fvgGap: { top: number; bottom: number } | null;
    reason: string;
}

export interface VolumeSurgeDetail {
    detected: boolean;
    volumeMultiplier: number; // current vol / 20-SMA vol
    isSpike: boolean; // >= 2.2x
    volumeSMA: number;
    currentVolume: number;
    reason: string;
}

export interface WhaleSurgeReport {
    symbol: string;
    isQualified: boolean;
    direction: 'LONG' | 'SHORT' | 'NONE';
    confidenceScore: number; // 0 to 100
    sweep: LiquiditySweepDetail;
    structure: StructureBreakDetail;
    volume: VolumeSurgeDetail;
    exhausted: boolean; // true if move is already > 4.5% (danger zone)
    suggestedEntry: number;
    suggestedSL: number;
    suggestedTPs: [number, number, number]; // [1.5%, 2.5%, 4.5%]
    justification: string;
}

export class WhaleSurgeDetector {
    /**
     * Calculates Simple Moving Average of candle volumes
     */
    private static calculateVolumeSMA(candles: OHLCV[], period: number = 20): number {
        if (candles.length < period) return 0;
        const slice = candles.slice(-period);
        const sum = slice.reduce((acc, c) => acc + c.volume, 0);
        return sum / period;
    }

    /**
     * 1. Detects Liquidity Sweeps and Fakeouts (Turtle Soup / Stop Hunts)
     */
    static detectLiquiditySweep(candles: OHLCV[]): LiquiditySweepDetail {
        if (candles.length < 15) {
            return { detected: false, type: 'NONE', sweepPrice: 0, sweptLevel: 0, rejectionStrength: 0, reason: 'بيانات غير كافية' };
        }

        const recent = candles[candles.length - 1];
        const prev = candles[candles.length - 2];
        const lookback = candles.slice(-25, -2); // Previous reference range

        const highestHigh = Math.max(...lookback.map(c => c.high));
        const lowestLow = Math.min(...lookback.map(c => c.low));

        const candleRange = recent.high - recent.low;
        if (candleRange <= 0) {
            return { detected: false, type: 'NONE', sweepPrice: 0, sweptLevel: 0, rejectionStrength: 0, reason: 'نطاق شمعة غير صالح' };
        }

        // Bullish Liquidity Sweep (Sweep of lows with strong rejection upward)
        const sweptLowCandidate = Math.min(recent.low, prev.low);
        if (sweptLowCandidate < lowestLow) {
            // Price breached previous lows
            const lowerWick = Math.min(recent.open, recent.close) - recent.low;
            const wickRatio = lowerWick / candleRange;

            // If price swept low but closed back above or created >= 40% lower wick
            if (recent.close > lowestLow || wickRatio >= 0.40) {
                const rejectionStrength = Math.min(100, Math.round(wickRatio * 100));
                return {
                    detected: true,
                    type: 'BULLISH_SWEEP',
                    sweepPrice: recent.low,
                    sweptLevel: lowestLow,
                    rejectionStrength,
                    reason: `سحب سيولة بيعية (SSL) تحت قاع ${lowestLow.toFixed(4)} مع ارتداد قوي (${rejectionStrength}%)`
                };
            }
        }

        // Bearish Liquidity Sweep (Sweep of highs with strong rejection downward)
        const sweptHighCandidate = Math.max(recent.high, prev.high);
        if (sweptHighCandidate > highestHigh) {
            // Price breached previous highs
            const upperWick = recent.high - Math.max(recent.open, recent.close);
            const wickRatio = upperWick / candleRange;

            // If price swept high but closed back below or created >= 40% upper wick
            if (recent.close < highestHigh || wickRatio >= 0.40) {
                const rejectionStrength = Math.min(100, Math.round(wickRatio * 100));
                return {
                    detected: true,
                    type: 'BEARISH_SWEEP',
                    sweepPrice: recent.high,
                    sweptLevel: highestHigh,
                    rejectionStrength,
                    reason: `سحب سيولة شرائية (BSL) فوق قمة ${highestHigh.toFixed(4)} مع ارتداد هابط (${rejectionStrength}%)`
                };
            }
        }

        return { detected: false, type: 'NONE', sweepPrice: 0, sweptLevel: 0, rejectionStrength: 0, reason: 'لا يوجد سحب سيولة واضح' };
    }

    /**
     * 2. Detects Market Structure Breaks (BOS / CHoCH with Displacement & FVG)
     */
    static detectStructureBreakout(candles: OHLCV[]): StructureBreakDetail {
        if (candles.length < 20) {
            return { detected: false, type: 'NONE', brokenLevel: 0, displacementRatio: 0, fvgPresent: false, fvgGap: null, reason: 'بيانات غير كافية' };
        }

        const current = candles[candles.length - 1];
        const prev1 = candles[candles.length - 2];
        const prev2 = candles[candles.length - 3];

        const range = current.high - current.low;
        const body = Math.abs(current.close - current.open);
        const displacementRatio = range > 0 ? (body / range) : 0;

        // Reference swing points from the preceding 18 candles
        const window = candles.slice(-20, -1);
        const swingHigh = Math.max(...window.map(c => c.high));
        const swingLow = Math.min(...window.map(c => c.low));

        // Fair Value Gap (FVG) Check
        // Bullish FVG: Current candle 1 low is higher than candle 3 high
        const isBullishFVG = current.low > prev2.high;
        const bullishGap = isBullishFVG ? { top: current.low, bottom: prev2.high } : null;

        // Bearish FVG: Current candle 1 high is lower than candle 3 low
        const isBearishFVG = current.high < prev2.low;
        const bearishGap = isBearishFVG ? { top: prev2.low, bottom: current.high } : null;

        // Check Bullish BOS / CHoCH: Close convincingly breaks above swingHigh
        if (current.close > swingHigh && current.close > current.open) {
            return {
                detected: true,
                type: isBullishFVG ? 'CHOCH_LONG' : 'BOS_LONG',
                brokenLevel: swingHigh,
                displacementRatio: Number(displacementRatio.toFixed(2)),
                fvgPresent: isBullishFVG,
                fvgGap: bullishGap,
                reason: `كسر هيكل صاعد فوق قمة ${swingHigh.toFixed(4)} بقوة إزاحة ${(displacementRatio * 100).toFixed(0)}%${isBullishFVG ? ' مع تكون FVG' : ''}`
            };
        }

        // Check Bearish BOS / CHoCH: Close convincingly breaks below swingLow
        if (current.close < swingLow && current.close < current.open) {
            return {
                detected: true,
                type: isBearishFVG ? 'CHOCH_SHORT' : 'BOS_SHORT',
                brokenLevel: swingLow,
                displacementRatio: Number(displacementRatio.toFixed(2)),
                fvgPresent: isBearishFVG,
                fvgGap: bearishGap,
                reason: `كسر هيكل هابط تحت قاع ${swingLow.toFixed(4)} بقوة إزاحة ${(displacementRatio * 100).toFixed(0)}%${isBearishFVG ? ' مع تكون FVG' : ''}`
            };
        }

        return { detected: false, type: 'NONE', brokenLevel: 0, displacementRatio: 0, fvgPresent: false, fvgGap: null, reason: 'لا يوجد كسر هيكل واضح' };
    }

    /**
     * 3. Detects Volume Spikes and Capital Inflow Anomalies
     */
    static detectVolumeSurge(candles: OHLCV[]): VolumeSurgeDetail {
        if (candles.length < 21) {
            return { detected: false, volumeMultiplier: 1.0, isSpike: false, volumeSMA: 0, currentVolume: 0, reason: 'بيانات غير كافية' };
        }

        const current = candles[candles.length - 1];
        const prev1 = candles[candles.length - 2];
        const smaVol = this.calculateVolumeSMA(candles.slice(0, -1), 20);

        if (smaVol <= 0) {
            return { detected: false, volumeMultiplier: 1.0, isSpike: false, volumeSMA: 0, currentVolume: current.volume, reason: 'متوسط الحجم غير متوفر' };
        }

        // Check max of current candle or previous breakout candle
        const activeVol = Math.max(current.volume, prev1.volume);
        const multiplier = Number((activeVol / smaVol).toFixed(2));
        const isSpike = multiplier >= 2.2; // Volume is at least 220% of 20-period average

        return {
            detected: isSpike,
            volumeMultiplier: multiplier,
            isSpike,
            volumeSMA: Number(smaVol.toFixed(2)),
            currentVolume: Number(activeVol.toFixed(2)),
            reason: isSpike
                ? `تدفق سيولة مؤسساتية ضخمة (${multiplier}x من متوسط الحجم الطبيعي)`
                : `حجم تداول طبيعي (${multiplier}x من المتوسط)`
        };
    }

    /**
     * 4. Complete Whale Surge Analysis Pipeline
     */
    static analyze(
        symbol: string,
        pricePrecision: number,
        mtfOHLCV: Record<string, OHLCV[]>
    ): WhaleSurgeReport {
        const quickCandles = mtfOHLCV['15m'] || mtfOHLCV['5m'] || [];
        const confirmCandles = mtfOHLCV['5m'] || [];
        const currentPrice = quickCandles.length > 0 ? quickCandles[quickCandles.length - 1].close : 0;

        if (quickCandles.length < 25) {
            return {
                symbol,
                isQualified: false,
                direction: 'NONE',
                confidenceScore: 0,
                sweep: { detected: false, type: 'NONE', sweepPrice: 0, sweptLevel: 0, rejectionStrength: 0, reason: '' },
                structure: { detected: false, type: 'NONE', brokenLevel: 0, displacementRatio: 0, fvgPresent: false, fvgGap: null, reason: '' },
                volume: { detected: false, volumeMultiplier: 1.0, isSpike: false, volumeSMA: 0, currentVolume: 0, reason: '' },
                exhausted: false,
                suggestedEntry: currentPrice,
                suggestedSL: currentPrice,
                suggestedTPs: [currentPrice, currentPrice, currentPrice],
                justification: 'بيانات الشموع غير كافية'
            };
        }

        // Run component detectors on 15m (Primary) & 5m (Confirmation)
        const sweep15 = this.detectLiquiditySweep(quickCandles);
        const sweep5 = confirmCandles.length > 15 ? this.detectLiquiditySweep(confirmCandles) : sweep15;
        const activeSweep = sweep15.detected ? sweep15 : (sweep5.detected ? sweep5 : sweep15);

        const structure15 = this.detectStructureBreakout(quickCandles);
        const structure5 = confirmCandles.length > 20 ? this.detectStructureBreakout(confirmCandles) : structure15;
        const activeStructure = structure15.detected ? structure15 : (structure5.detected ? structure5 : structure15);

        const volume = this.detectVolumeSurge(quickCandles);

        // Exhaustion Safety Check (prevent buying top of a 4.5%+ hyper-candle)
        const lastCandle = quickCandles[quickCandles.length - 1];
        const lastCandleMovePct = Math.abs(lastCandle.close - lastCandle.open) / lastCandle.open * 100;
        const exhausted = lastCandleMovePct >= 4.5;

        // Confluence Scoring
        let bullScore = 0;
        let bearScore = 0;

        // A. Sweep Factor (35 pts)
        if (activeSweep.type === 'BULLISH_SWEEP') bullScore += 35;
        if (activeSweep.type === 'BEARISH_SWEEP') bearScore += 35;

        // B. Structure Factor (35 pts)
        if (activeStructure.type === 'BOS_LONG' || activeStructure.type === 'CHOCH_LONG') {
            bullScore += 35;
            if (activeStructure.fvgPresent) bullScore += 5;
        }
        if (activeStructure.type === 'BOS_SHORT' || activeStructure.type === 'CHOCH_SHORT') {
            bearScore += 35;
            if (activeStructure.fvgPresent) bearScore += 5;
        }

        // C. Volume Factor (25 pts)
        if (volume.isSpike) {
            bullScore += Math.min(25, volume.volumeMultiplier * 10);
            bearScore += Math.min(25, volume.volumeMultiplier * 10);
        }

        let direction: 'LONG' | 'SHORT' | 'NONE' = 'NONE';
        let confidenceScore = 0;

        if (bullScore > bearScore && bullScore >= 70 && !exhausted) {
            direction = 'LONG';
            confidenceScore = Math.min(96, Math.round(bullScore));
        } else if (bearScore > bullScore && bearScore >= 70 && !exhausted) {
            direction = 'SHORT';
            confidenceScore = Math.min(96, Math.round(bearScore));
        }

        const isQualified = direction !== 'NONE' && (activeSweep.detected || activeStructure.detected) && volume.isSpike;

        // Calculate Strategic Stop Loss and Multi-Tier Targets
        let suggestedSL = currentPrice;
        let tps: [number, number, number] = [currentPrice, currentPrice, currentPrice];

        if (direction === 'LONG') {
            // Protected SL: below swept low or structure origin, clamped between 1.2% and 1.5%
            const naturalLow = activeSweep.sweepPrice > 0 ? activeSweep.sweepPrice : (activeStructure.brokenLevel > 0 ? activeStructure.brokenLevel : currentPrice * 0.988);
            const dist = currentPrice - naturalLow;
            const safeDist = Math.max(currentPrice * 0.012, Math.min(currentPrice * 0.015, dist * 1.05));
            suggestedSL = Number((currentPrice - safeDist).toFixed(pricePrecision));

            tps = [
                Number((currentPrice * 1.015).toFixed(pricePrecision)), // TP1: +1.50% (triggers Auto Break-Even)
                Number((currentPrice * 1.025).toFixed(pricePrecision)), // TP2: +2.50% (main profit wave)
                Number((currentPrice * 1.045).toFixed(pricePrecision))  // TP3: +4.50% (hyper-surge target)
            ];
        } else if (direction === 'SHORT') {
            const naturalHigh = activeSweep.sweepPrice > 0 ? activeSweep.sweepPrice : (activeStructure.brokenLevel > 0 ? activeStructure.brokenLevel : currentPrice * 1.012);
            const dist = naturalHigh - currentPrice;
            const safeDist = Math.max(currentPrice * 0.012, Math.min(currentPrice * 0.015, dist * 1.05));
            suggestedSL = Number((currentPrice + safeDist).toFixed(pricePrecision));

            tps = [
                Number((currentPrice * 0.985).toFixed(pricePrecision)), // TP1: -1.50% (triggers Auto Break-Even)
                Number((currentPrice * 0.975).toFixed(pricePrecision)), // TP2: -2.50% (main profit wave)
                Number((currentPrice * 0.955).toFixed(pricePrecision))  // TP3: -4.50% (hyper-surge target)
            ];
        }

        const reasonComponents = [];
        if (activeSweep.detected) reasonComponents.push(activeSweep.reason);
        if (activeStructure.detected) reasonComponents.push(activeStructure.reason);
        if (volume.detected) reasonComponents.push(volume.reason);
        if (exhausted) reasonComponents.push('⚠️ حركة شمعة منهكة (> 4.5%) تم حجب الدخول');

        const justification = reasonComponents.length > 0 ? reasonComponents.join(' + ') : 'لا توجد شروط انفجار مكتملة';

        return {
            symbol,
            isQualified,
            direction,
            confidenceScore,
            sweep: activeSweep,
            structure: activeStructure,
            volume,
            exhausted,
            suggestedEntry: currentPrice,
            suggestedSL,
            suggestedTPs: tps,
            justification
        };
    }
}
