import { OHLCV } from './types';

export class MTFDataBuilder {
    public static tfToMs(tf: string): number {
        const value = parseInt(tf.replace(/[^0-9]/g, ''));
        const unit = tf.replace(/[0-9]/g, '');
        
        switch (unit) {
            case 'm': return value * 60 * 1000;
            case 'h': return value * 60 * 60 * 1000;
            case 'd': return value * 24 * 60 * 60 * 1000;
            case 'w': return value * 7 * 24 * 60 * 60 * 1000;
            default: return 5 * 60 * 1000; // default 5m
        }
    }

    /**
     * Aggregates lower timeframe candles into a higher timeframe.
     * Ensures proper timestamp alignment (e.g. 1h candle starts exactly at the top of the hour).
     */
    static aggregateCandles(baseCandles: OHLCV[], targetTF: string): OHLCV[] {
        if (!baseCandles || baseCandles.length === 0) return [];

        const targetMs = this.tfToMs(targetTF);
        const aggregated: OHLCV[] = [];
        let currentBucketTime = -1;
        let currentCandle: OHLCV | null = null;

        for (const candle of baseCandles) {
            // Find the boundary for this candle based on target timeframe
            const bucketTime = Math.floor(candle.timestamp / targetMs) * targetMs;

            if (bucketTime !== currentBucketTime) {
                // Save the previous aggregated candle if it exists
                if (currentCandle) {
                    aggregated.push(currentCandle);
                }
                
                // Start a new aggregated candle
                currentBucketTime = bucketTime;
                currentCandle = {
                    timestamp: bucketTime,
                    open: candle.open,
                    high: candle.high,
                    low: candle.low,
                    close: candle.close,
                    volume: candle.volume
                };
            } else if (currentCandle) {
                // Update the current aggregated candle
                currentCandle.high = Math.max(currentCandle.high, candle.high);
                currentCandle.low = Math.min(currentCandle.low, candle.low);
                currentCandle.close = candle.close;
                currentCandle.volume += candle.volume;
            }
        }

        // Push the last candle
        if (currentCandle) {
            aggregated.push(currentCandle);
        }

        return aggregated;
    }
}
