import { BingXService } from '../../services/BingXService';
import { OHLCV } from '../shared/types';
import logger from '../../utils/logger';

export interface VolumeFlowReport {
    isReady: boolean;
    direction: 'LONG' | 'SHORT' | 'NONE';
    buyVolumeRatio: number;      // e.g. 74.2%
    sellVolumeRatio: number;     // e.g. 25.8%
    spikeFactor: number;         // e.g. 2.45x
    latestCandleVolume: number;
    avg10CandleVolume: number;
    isAbsorptionPresent: boolean;
    reason: string;
}

export class MicroVolumeAnalyzer {
    /**
     * Analyzes the last 10 candles on the 1-minute timeframe to detect institutional volume burst
     * and aggressive buyer/seller dominance before pulling the trade trigger.
     */
    static async analyze1mVolumeFlow(
        bingx: BingXService,
        symbol: string,
        targetDirection: 'LONG' | 'SHORT',
        minDominanceRatio: number = 65,
        minSpikeFactor: number = 2.0
    ): Promise<VolumeFlowReport> {
        try {
            const candles: OHLCV[] = await bingx.fetchOHLCV(symbol, '1m', 15);

            if (!candles || candles.length < 10) {
                return {
                    isReady: false,
                    direction: 'NONE',
                    buyVolumeRatio: 50,
                    sellVolumeRatio: 50,
                    spikeFactor: 1.0,
                    latestCandleVolume: 0,
                    avg10CandleVolume: 0,
                    isAbsorptionPresent: false,
                    reason: '⚠️ شموع دقيقة غير كافية للتحليل (أقل من 10 شموع)'
                };
            }

            // Take the last 10 completed or near-completed 1m candles
            const recent10 = candles.slice(-10);
            const latestCandle = recent10[recent10.length - 1];
            const previous9 = recent10.slice(0, 9);

            let totalBuyVolume = 0;
            let totalSellVolume = 0;
            let totalVolumeSum = 0;

            for (const c of recent10) {
                const range = Math.max(c.high - c.low, 1e-8);
                const body = Math.abs(c.close - c.open);
                const isGreen = c.close >= c.open;

                // Estimate intra-candle flow via close position within the high-low span
                // plus body direction weighting
                const closePositionRatio = (c.close - c.low) / range; // 0 (closed at low) to 1 (closed at high)
                
                let buyWeight = closePositionRatio;
                if (isGreen) {
                    buyWeight = Math.min(1.0, buyWeight * 1.15);
                } else {
                    buyWeight = Math.max(0.0, buyWeight * 0.85);
                }

                const candleBuyVol = c.volume * buyWeight;
                const candleSellVol = c.volume * (1.0 - buyWeight);

                totalBuyVolume += candleBuyVol;
                totalSellVolume += candleSellVol;
                totalVolumeSum += c.volume;
            }

            const buyRatio = totalVolumeSum > 0 ? (totalBuyVolume / totalVolumeSum) * 100 : 50;
            const sellRatio = totalVolumeSum > 0 ? (totalSellVolume / totalVolumeSum) * 100 : 50;

            // Compute volume spike on latest 1m candle vs prior 9 candles
            const sumPrevVol = previous9.reduce((acc, c) => acc + c.volume, 0);
            const avgPrevVol = sumPrevVol / Math.max(previous9.length, 1);
            const spikeFactor = avgPrevVol > 0 ? (latestCandle.volume / avgPrevVol) : 1.0;

            // Check wick absorption (e.g. long lower wick on recent candles for LONG, or upper wick for SHORT)
            const latestRange = Math.max(latestCandle.high - latestCandle.low, 1e-8);
            const lowerWick = Math.min(latestCandle.open, latestCandle.close) - latestCandle.low;
            const upperWick = latestCandle.high - Math.max(latestCandle.open, latestCandle.close);
            
            const isAbsorptionPresent = targetDirection === 'LONG'
                ? (lowerWick / latestRange) > 0.35 // Buyers soaked up the dip
                : (upperWick / latestRange) > 0.35; // Sellers rejected the high

            let isReady = false;
            let reason = '';

            if (targetDirection === 'LONG') {
                const hasDominance = buyRatio >= minDominanceRatio;
                const hasSpike = spikeFactor >= minSpikeFactor;
                const latestNotBearishDump = latestCandle.close >= (latestCandle.low + latestRange * 0.3);

                if (hasDominance && hasSpike && latestNotBearishDump) {
                    isReady = true;
                    reason = `🚀 انفجار سيولة شرائية 1m: نسبة الشراء ${buyRatio.toFixed(1)}% (المطلوب ${minDominanceRatio}%) ومضاعف الفوليوم ${spikeFactor.toFixed(2)}x (المطلوب ${minSpikeFactor}x)`;
                } else {
                    const missingReasons: string[] = [];
                    if (!hasDominance) missingReasons.push(`نسبة الشراء ${buyRatio.toFixed(1)}% < ${minDominanceRatio}%`);
                    if (!hasSpike) missingReasons.push(`مضاعف الفوليوم ${spikeFactor.toFixed(2)}x < ${minSpikeFactor}x`);
                    if (!latestNotBearishDump) missingReasons.push(`شمعة الدقيقة الأخيرة هابطة بشدة`);
                    reason = `⏳ في انتظار تأكيد الفوليوم 1m: [${missingReasons.join(' | ')}]`;
                }
            } else { // SHORT
                const hasDominance = sellRatio >= minDominanceRatio;
                const hasSpike = spikeFactor >= minSpikeFactor;
                const latestNotBullishPump = latestCandle.close <= (latestCandle.high - latestRange * 0.3);

                if (hasDominance && hasSpike && latestNotBullishPump) {
                    isReady = true;
                    reason = `🔻 انفجار سيولة بيعية 1m: نسبة البيع ${sellRatio.toFixed(1)}% (المطلوب ${minDominanceRatio}%) ومضاعف الفوليوم ${spikeFactor.toFixed(2)}x (المطلوب ${minSpikeFactor}x)`;
                } else {
                    const missingReasons: string[] = [];
                    if (!hasDominance) missingReasons.push(`نسبة البيع ${sellRatio.toFixed(1)}% < ${minDominanceRatio}%`);
                    if (!hasSpike) missingReasons.push(`مضاعف الفوليوم ${spikeFactor.toFixed(2)}x < ${minSpikeFactor}x`);
                    if (!latestNotBullishPump) missingReasons.push(`شمعة الدقيقة الأخيرة صاعدة بشدة`);
                    reason = `⏳ في انتظار تأكيد الفوليوم 1m: [${missingReasons.join(' | ')}]`;
                }
            }

            return {
                isReady,
                direction: targetDirection,
                buyVolumeRatio: Number(buyRatio.toFixed(1)),
                sellVolumeRatio: Number(sellRatio.toFixed(1)),
                spikeFactor: Number(spikeFactor.toFixed(2)),
                latestCandleVolume: latestCandle.volume,
                avg10CandleVolume: Number(avgPrevVol.toFixed(2)),
                isAbsorptionPresent,
                reason
            };
        } catch (error: any) {
            logger.warn(`[MicroVolumeAnalyzer] Failed to analyze 1m volume for ${symbol}: ${error.message}`);
            return {
                isReady: false,
                direction: targetDirection,
                buyVolumeRatio: 50,
                sellVolumeRatio: 50,
                spikeFactor: 1.0,
                latestCandleVolume: 0,
                avg10CandleVolume: 0,
                isAbsorptionPresent: false,
                reason: `خطأ في قراءة فوليوم 1m: ${error.message}`
            };
        }
    }
}
