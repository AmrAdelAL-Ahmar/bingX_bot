import { IRadarEngine, RadarInvalidationResult } from './IRadarEngine';
import { OHLCV, AnalysisDetails } from '../../shared/types';
import { DynamicZigZag, HarmonicPatternDetector } from '../../shared/harmonic';

export class HarmonicRadarEngine implements IRadarEngine {
    readonly engineId = 'HARMONIC';

    monitor(
        direction: 'LONG' | 'SHORT',
        currentPrice: number,
        ohlcv: OHLCV[],
        allTimeframes: Record<string, AnalysisDetails>,
        mtfOHLCV: Record<string, OHLCV[]>
    ): RadarInvalidationResult {
        if (!ohlcv || ohlcv.length < 15) {
            return { invalidate: false, action: 'RESET', reason: 'بيانات غير كافية' };
        }

        const swings = DynamicZigZag.findSwings(ohlcv, 1.5, 2);
        if (swings.length < 4) {
            return { invalidate: false, action: 'RESET', reason: 'مراقبة سارية' };
        }

        const matches = HarmonicPatternDetector.detectPatterns(swings, currentPrice);
        if (matches.length > 0) {
            const best = matches[0];
            // Invalidation check: if price broke beyond PRZ boundary by more than 1.5%
            if (direction === 'LONG' && currentPrice < best.prz.min * 0.985) {
                return {
                    invalidate: true,
                    action: 'EXIT',
                    reason: `🚨 كسر صريح لمنطقة الانعكاس PRZ لنموذج ${best.pattern} هبوطاً (Breakout Invalidation)`
                };
            }
            if (direction === 'SHORT' && currentPrice > best.prz.max * 1.015) {
                return {
                    invalidate: true,
                    action: 'EXIT',
                    reason: `🚨 كسر صريح لمنطقة الانعكاس PRZ لنموذج ${best.pattern} صعوداً (Breakout Invalidation)`
                };
            }
        }

        return {
            invalidate: false,
            action: 'RESET',
            reason: 'هيكل الهارمونيك سليم ولم يكسر مستويات الأمان'
        };
    }
}
