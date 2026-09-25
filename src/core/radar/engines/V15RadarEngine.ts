import { OHLCV, AnalysisDetails } from '../../shared/types';
import { IRadarEngine, RadarInvalidationResult } from './IRadarEngine';

export class V15RadarEngine implements IRadarEngine {
    readonly engineId = 'V15-QUANT-HARMONIC';

    monitor(
        direction: 'LONG' | 'SHORT',
        currentPrice: number,
        ohlcv: OHLCV[],
        allTimeframes: Record<string, AnalysisDetails>,
        mtfOHLCV: Record<string, OHLCV[]>
    ): RadarInvalidationResult {
        const ohlcvMeso = mtfOHLCV['15m'] || ohlcv;
        if (ohlcvMeso.length < 40) {
            return { invalidate: false, action: 'EXIT', reason: 'بيانات غير كافية لـ V15' };
        }

        const recent = ohlcvMeso.slice(-40);
        const last = ohlcvMeso[ohlcvMeso.length - 1];

        // 1. Calculate Average Volume over last 9 candles
        const recent9 = ohlcvMeso.slice(-10, -1);
        const avgVol9 = recent9.reduce((sum, c) => sum + c.volume, 0) / recent9.length;
        const volumeSurge = last.volume > avgVol9 * 1.5;

        if (direction === 'LONG') {
            // Point X is the lowest support of the pattern (lowest low of last 40 candles)
            const lowestLow = Math.min(...recent.map(c => c.low));
            const pointX = lowestLow;
            const breachThreshold = pointX * 0.995; // 0.5% breach

            if (currentPrice < breachThreshold && volumeSurge) {
                return {
                    invalidate: true,
                    action: 'RESET',
                    reason: `السعر ($${currentPrice.toFixed(4)}) كسر النقطة X ($${pointX.toFixed(4)}) بأكثر من 0.5% مع حجم تداول مرتفع جداً (${last.volume.toFixed(0)} > 1.5x من ${avgVol9.toFixed(0)})`
                };
            }
        } else {
            // Point X is the highest resistance of the pattern (highest high of last 40 candles)
            const highestHigh = Math.max(...recent.map(c => c.high));
            const pointX = highestHigh;
            const breachThreshold = pointX * 1.005; // 0.5% breach

            if (currentPrice > breachThreshold && volumeSurge) {
                return {
                    invalidate: true,
                    action: 'RESET',
                    reason: `السعر ($${currentPrice.toFixed(4)}) كسر النقطة X ($${pointX.toFixed(4)}) بأكثر من 0.5% مع حجم تداول مرتفع جداً (${last.volume.toFixed(0)} > 1.5x من ${avgVol9.toFixed(0)})`
                };
            }
        }

        return { invalidate: false, action: 'EXIT', reason: 'هيكل نموذج الهارمونيك متماسك' };
    }
}
