import { OHLCV } from '../shared/types';
import { TechnicalAnalyzer } from '../analysis/TechnicalAnalyzer';

/**
 * CoreTradeRadar
 * Pure in-memory coordinate calculations for position trailing stops, 
 * Wick Sweeps, and early structural reversals.
 */
export class CoreTradeRadar {
    /**
     * Checks if a candle wick temporarily broke the Stop Loss level but the body closed safely.
     * Indicates institutional liquidity hunt (Wick Sweep).
     */
    static checkWickSweep(
        ohlcv: OHLCV[],
        stopLoss: number,
        direction: 'LONG' | 'SHORT'
    ): boolean {
        const lastCandle = ohlcv[ohlcv.length - 1];
        if (!lastCandle) return false;

        // Has the lower/upper wick penetrated Stop Loss?
        const wickBrokeSL = direction === 'LONG'
            ? lastCandle.low <= stopLoss
            : lastCandle.high >= stopLoss;

        // Did the candle body close safely on the correct side of Stop Loss?
        const bodyIntact = direction === 'LONG'
            ? lastCandle.close > stopLoss
            : lastCandle.close < stopLoss;

        return wickBrokeSL && bodyIntact;
    }

    /**
     * Spots early momentum reversal by combining counter-trend CHoCH/MSS 
     * and multi-candle RSI Divergence.
     */
    static checkEarlyReversal(
        ohlcv: OHLCV[],
        direction: 'LONG' | 'SHORT'
    ): { detected: boolean; description: string } {
        const reverseDir = direction === 'LONG' ? 'SHORT' : 'LONG';
        
        // Detect Market Structure Shift (MSS/CHoCH) in the opposite direction
        const mss = TechnicalAnalyzer.detectMSS(ohlcv, reverseDir);
        
        // Detect RSI Divergence in original direction
        const div = TechnicalAnalyzer.detectDivergence(ohlcv, direction);

        if (mss.detected && div.detected) {
            return { detected: true, description: mss.description };
        }
        
        return { detected: false, description: '' };
    }

    /**
     * Computes dynamically-adjusted Trailing Stop using current ATR or local fractals.
     * Returns the updated Stop Loss value if it has locked in higher profits, otherwise null.
     */
    static calculateTrailingStop(
        ohlcv: OHLCV[],
        currentSL: number,
        direction: 'LONG' | 'SHORT',
        currentPrice: number
    ): number | null {
        if (ohlcv.length < 15) return null;

        const atr = this.calculateATR(ohlcv, 14);
        let newSL: number;

        if (atr > 0) {
            const multiplier = 2.0; // Volatility factor
            if (direction === 'LONG') {
                newSL = currentPrice - (multiplier * atr);
                if (newSL <= currentSL) return null;
            } else {
                newSL = currentPrice + (multiplier * atr);
                if (newSL >= currentSL) return null;
            }
        } else {
            // Swing fractal swing-high/swing-low fallback
            const recent = ohlcv.slice(-5);
            if (direction === 'LONG') {
                newSL = Math.min(...recent.map(c => c.low));
                if (newSL <= currentSL) return null;
            } else {
                newSL = Math.max(...recent.map(c => c.high));
                if (newSL >= currentSL) return null;
            }
        }

        return newSL;
    }

    /**
     * Helper to compute Average True Range (ATR)
     */
    private static calculateATR(ohlcv: OHLCV[], period: number = 14): number {
        if (ohlcv.length <= period) return 0;
        const trs: number[] = [];
        for (let i = 1; i < ohlcv.length; i++) {
            const high = ohlcv[i].high;
            const low = ohlcv[i].low;
            const prevClose = ohlcv[i - 1].close;
            const tr = Math.max(
                high - low,
                Math.abs(high - prevClose),
                Math.abs(low - prevClose)
            );
            trs.push(tr);
        }
        const sum = trs.slice(-period).reduce((acc, v) => acc + v, 0);
        return sum / period;
    }
}
