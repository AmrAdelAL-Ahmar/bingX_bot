import { OHLCV, AnalysisDetails } from '../../shared/types';
import { IRadarEngine, RadarInvalidationResult } from './IRadarEngine';

export class V13RadarEngine implements IRadarEngine {
    readonly engineId = 'V13-VOL-FLOW';

    monitor(
        direction: 'LONG' | 'SHORT',
        currentPrice: number,
        ohlcv: OHLCV[],
        allTimeframes: Record<string, AnalysisDetails>,
        mtfOHLCV: Record<string, OHLCV[]>
    ): RadarInvalidationResult {
        const ohlcvMicro = ohlcv;
        if (ohlcvMicro.length < 25) {
            return { invalidate: false, action: 'EXIT', reason: 'بيانات غير كافية لـ V13' };
        }

        const recent = ohlcvMicro.slice(-25, -1);
        const last = ohlcvMicro[ohlcvMicro.length - 1];

        // Fetch volume stats
        const avgVolume = recent.reduce((sum, c) => sum + c.volume, 0) / recent.length;
        const isHighVolume = last.volume > avgVolume * 1.5;

        if (direction === 'LONG') {
            // Spring low is the lowest low in recent history
            const lowestLow = Math.min(...recent.map(c => c.low));
            
            if (currentPrice < lowestLow && isHighVolume) {
                return {
                    invalidate: true,
                    action: 'FLIP',
                    reason: `السعر ($${currentPrice.toFixed(4)}) كسر أدنى قاع للـ Spring ($${lowestLow.toFixed(4)}) بحجم تداول كبير (${last.volume.toFixed(0)} > ${avgVolume.toFixed(0)})`
                };
            }
        } else {
            // Upthrust high is the highest high in recent history
            const highestHigh = Math.max(...recent.map(c => c.high));

            if (currentPrice > highestHigh && isHighVolume) {
                return {
                    invalidate: true,
                    action: 'FLIP',
                    reason: `السعر ($${currentPrice.toFixed(4)}) تجاوز قمة الـ Upthrust ($${highestHigh.toFixed(4)}) بحجم تداول كبير (${last.volume.toFixed(0)} > ${avgVolume.toFixed(0)})`
                };
            }
        }

        return { invalidate: false, action: 'EXIT', reason: 'تدفق السيولة ضمن الحدود الآمنة' };
    }
}
