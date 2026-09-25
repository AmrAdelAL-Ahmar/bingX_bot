import { OHLCV, AnalysisDetails } from '../../shared/types';
import { IRadarEngine, RadarInvalidationResult } from './IRadarEngine';
import { TechnicalAnalyzer } from '../../analysis/TechnicalAnalyzer';
import { RSI } from 'technicalindicators';

export class V12RadarEngine implements IRadarEngine {
    readonly engineId = 'V12-SMC-HYBRID';

    monitor(
        direction: 'LONG' | 'SHORT',
        currentPrice: number,
        ohlcv: OHLCV[],
        allTimeframes: Record<string, AnalysisDetails>,
        mtfOHLCV: Record<string, OHLCV[]>
    ): RadarInvalidationResult {
        const ohlcv15m = mtfOHLCV['15m'] || ohlcv;
        if (ohlcv15m.length < 5) {
            return { invalidate: false, action: 'EXIT', reason: 'بيانات غير كافية لـ V12' };
        }

        // 1. Detect Order Block boundaries on 15M
        const ob = TechnicalAnalyzer.detectOrderBlock(ohlcv15m, direction);
        if (!ob.found) {
            return { invalidate: false, action: 'EXIT', reason: 'لم يتم العثور على OB نشط للمراقبة' };
        }

        const lastCandle = ohlcv15m[ohlcv15m.length - 1];
        const rsiVal = allTimeframes['15m']?.rsi || RSI.calculate({ period: 14, values: ohlcv15m.map(c => c.close) }).slice(-1)[0] || 50;

        if (direction === 'LONG') {
            // Candle body closed below the OB bottom
            const bodyBelowOB = Math.min(lastCandle.open, lastCandle.close) < ob.bottom;
            const rsiOversold = rsiVal < 30;

            if (bodyBelowOB && rsiOversold) {
                return {
                    invalidate: true,
                    action: 'FREEZE',
                    reason: `إغلاق جسم الشمعة ($${lastCandle.close.toFixed(4)}) أسفل قاع الـ OB ($${ob.bottom.toFixed(4)}) مع مؤشر RSI ($${rsiVal.toFixed(1)} < 30)`
                };
            }
        } else {
            // Candle body closed above the OB top
            const bodyAboveOB = Math.max(lastCandle.open, lastCandle.close) > ob.top;
            const rsiOverbought = rsiVal > 70;

            if (bodyAboveOB && rsiOverbought) {
                return {
                    invalidate: true,
                    action: 'FREEZE',
                    reason: `إغلاق جسم الشمعة ($${lastCandle.close.toFixed(4)}) أعلى قمة الـ OB ($${ob.top.toFixed(4)}) مع مؤشر RSI ($${rsiVal.toFixed(1)} > 70)`
                };
            }
        }

        return { invalidate: false, action: 'EXIT', reason: 'الشروط هيكلية وآمنة' };
    }
}
