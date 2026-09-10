import { OHLCV } from '../types';
import { SwingPoint } from './types';

export class DynamicZigZag {
    /**
     * Extracts dynamic swing highs (PEAK) and swing lows (VALLEY) using ATR-scaled deviations
     */
    static findSwings(candles: OHLCV[], atrMultiplier: number = 1.8, minBarsBetweenSwings: number = 3): SwingPoint[] {
        if (!candles || candles.length < 20) return [];

        // 1. Calculate ATR(14)
        const atrs = this.calculateATR(candles, 14);
        const swings: SwingPoint[] = [];

        let currentType: 'PEAK' | 'VALLEY' | null = null;
        let lastExtremumPrice = 0;
        let lastExtremumIdx = -1;

        for (let i = 14; i < candles.length; i++) {
            const candle = candles[i];
            const atr = atrs[i] || atrs[atrs.length - 1];
            const deviationThreshold = atr * atrMultiplier;

            if (currentType === null) {
                // Initial pivot selection
                if (candle.high > candles[i - 1].high && candle.high > candles[i - 2].high) {
                    currentType = 'PEAK';
                    lastExtremumPrice = candle.high;
                    lastExtremumIdx = i;
                } else if (candle.low < candles[i - 1].low && candle.low < candles[i - 2].low) {
                    currentType = 'VALLEY';
                    lastExtremumPrice = candle.low;
                    lastExtremumIdx = i;
                }
                continue;
            }

            if (currentType === 'PEAK') {
                if (candle.high > lastExtremumPrice) {
                    // Update peak higher
                    lastExtremumPrice = candle.high;
                    lastExtremumIdx = i;
                } else if (lastExtremumPrice - candle.low >= deviationThreshold && (i - lastExtremumIdx) >= minBarsBetweenSwings) {
                    // Switch to VALLEY
                    swings.push({
                        index: lastExtremumIdx,
                        timestamp: candles[lastExtremumIdx].timestamp,
                        price: lastExtremumPrice,
                        type: 'PEAK'
                    });
                    currentType = 'VALLEY';
                    lastExtremumPrice = candle.low;
                    lastExtremumIdx = i;
                }
            } else if (currentType === 'VALLEY') {
                if (candle.low < lastExtremumPrice) {
                    // Update valley lower
                    lastExtremumPrice = candle.low;
                    lastExtremumIdx = i;
                } else if (candle.high - lastExtremumPrice >= deviationThreshold && (i - lastExtremumIdx) >= minBarsBetweenSwings) {
                    // Switch to PEAK
                    swings.push({
                        index: lastExtremumIdx,
                        timestamp: candles[lastExtremumIdx].timestamp,
                        price: lastExtremumPrice,
                        type: 'VALLEY'
                    });
                    currentType = 'PEAK';
                    lastExtremumPrice = candle.high;
                    lastExtremumIdx = i;
                }
            }
        }

        // Push final pending swing point
        if (lastExtremumIdx !== -1 && (swings.length === 0 || swings[swings.length - 1].index !== lastExtremumIdx)) {
            swings.push({
                index: lastExtremumIdx,
                timestamp: candles[lastExtremumIdx].timestamp,
                price: lastExtremumPrice,
                type: currentType!
            });
        }

        return swings;
    }

    private static calculateATR(candles: OHLCV[], period: number = 14): number[] {
        const atrs: number[] = new Array(candles.length).fill(0);
        if (candles.length < 2) return atrs;

        const trs: number[] = [candles[0].high - candles[0].low];
        for (let i = 1; i < candles.length; i++) {
            const h = candles[i].high;
            const l = candles[i].low;
            const prevC = candles[i - 1].close;
            const tr = Math.max(h - l, Math.abs(h - prevC), Math.abs(l - prevC));
            trs.push(tr);
        }

        // First ATR is simple SMA of TR
        let sum = 0;
        for (let i = 0; i < period && i < trs.length; i++) {
            sum += trs[i];
        }
        atrs[Math.min(period - 1, trs.length - 1)] = sum / Math.min(period, trs.length);

        for (let i = period; i < trs.length; i++) {
            atrs[i] = (atrs[i - 1] * (period - 1) + trs[i]) / period;
        }

        return atrs;
    }
}
