import { OHLCV } from '../types';
import { HarmonicMatch } from './types';

export class HarmonicConfirmator {
    /**
     * Evaluates multi-indicator confirmation (RSI divergence/extremes, candlestick reversal, volume absorption)
     */
    static confirm(match: HarmonicMatch, candles: OHLCV[], rsi: number): HarmonicMatch {
        if (!candles || candles.length < 5) return match;

        const last = candles[candles.length - 1];
        const prev = candles[candles.length - 2];
        const isBullish = match.direction === 'BULLISH';

        // 1. Volume Absorption Check (>= 1.25x of 20-period SMA)
        const recentVolumes = candles.slice(-21, -1).map(c => c.volume);
        const avgVol = recentVolumes.reduce((acc, v) => acc + v, 0) / (recentVolumes.length || 1);
        const volumeRatio = avgVol > 0 ? Number((last.volume / avgVol).toFixed(2)) : 1.0;
        const volumeAbsorption = volumeRatio >= 1.25;

        // 2. Candlestick Reversal Recognition
        const body = Math.abs(last.close - last.open);
        const range = last.high - last.low || 0.0001;
        const upperWick = last.high - Math.max(last.close, last.open);
        const lowerWick = Math.min(last.close, last.open) - last.low;

        let reversalCandle = 'NONE';

        if (isBullish) {
            // Hammer / Pinbar / Bullish Engulfing
            if (lowerWick >= body * 2 && upperWick <= body * 0.8) {
                reversalCandle = 'BULLISH_PINBAR / HAMMER 🔨';
            } else if (last.close > last.open && prev.close < prev.open && last.close > prev.open && last.open < prev.close) {
                reversalCandle = 'BULLISH_ENGULFING 🟢';
            } else if (last.close > last.open && (last.close - last.open) / range > 0.6) {
                reversalCandle = 'STRONG_BULLISH_CLOSE 📈';
            }
        } else {
            // Shooting Star / Inverted Pinbar / Bearish Engulfing
            if (upperWick >= body * 2 && lowerWick <= body * 0.8) {
                reversalCandle = 'BEARISH_PINBAR / SHOOTING_STAR 🌠';
            } else if (last.close < last.open && prev.close > prev.open && last.close < prev.open && last.open > prev.close) {
                reversalCandle = 'BEARISH_ENGULFING 🔴';
            } else if (last.close < last.open && (last.open - last.close) / range > 0.6) {
                reversalCandle = 'STRONG_BEARISH_CLOSE 📉';
            }
        }

        // 3. RSI Divergence / Extreme Check
        let rsiCondition = false;
        if (isBullish) {
            rsiCondition = rsi <= 35 || (rsi <= 45 && last.close <= prev.close);
        } else {
            rsiCondition = rsi >= 65 || (rsi >= 55 && last.close >= prev.close);
        }

        const isFullyConfirmed = match.status === 'IN_PRZ' && reversalCandle !== 'NONE' && (rsiCondition || volumeAbsorption);

        return {
            ...match,
            status: isFullyConfirmed ? 'CONFIRMED' : match.status,
            confirmation: {
                rsiDivergence: rsiCondition,
                rsiValue: rsi,
                reversalCandle,
                volumeAbsorption,
                volumeRatio
            }
        };
    }
}
