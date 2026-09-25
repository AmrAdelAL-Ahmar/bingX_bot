import { OHLCV, AnalysisDetails } from '../../shared/types';
import { IRadarEngine, RadarInvalidationResult } from './IRadarEngine';
import { WyckoffVolumeEngine } from '../../sniper/engines/V16SniperEngine';

export class V16RadarEngine implements IRadarEngine {
    readonly engineId = 'V16-HYBRID-MATRIX';

    monitor(
        direction: 'LONG' | 'SHORT',
        currentPrice: number,
        ohlcv: OHLCV[],
        allTimeframes: Record<string, AnalysisDetails>,
        mtfOHLCV: Record<string, OHLCV[]>
    ): RadarInvalidationResult {
        const ohlcvMeso = mtfOHLCV['15m'] || ohlcv;
        if (ohlcvMeso.length < 20) {
            return { invalidate: false, action: 'EXIT', reason: 'بيانات غير كافية لـ V16' };
        }

        const wyckoffEngine = new WyckoffVolumeEngine(20);
        const context = wyckoffEngine.analyzeContext(ohlcvMeso);

        if (direction === 'LONG') {
            const breachThreshold = context.minLow * 0.98;
            if (currentPrice < breachThreshold) {
                return {
                    invalidate: true,
                    action: 'FREEZE',
                    reason: `السعر الحالي ($${currentPrice.toFixed(4)}) كسر حد الدعم السفلي لصندوق وايكوف ($${breachThreshold.toFixed(4)})`
                };
            }
            if (!context.isObvAccumulating) {
                return {
                    invalidate: true,
                    action: 'FREEZE',
                    reason: `تحول ميل تدفق السيولة OBV إلى سلبي (توقف التجميع صعوداً)`
                };
            }
        } else {
            const breachThreshold = context.maxHigh * 1.02;
            if (currentPrice > breachThreshold) {
                return {
                    invalidate: true,
                    action: 'FREEZE',
                    reason: `السعر الحالي ($${currentPrice.toFixed(4)}) اخترق حد المقاومة العلوي لصندوق وايكوف ($${breachThreshold.toFixed(4)})`
                };
            }
            if (!context.isObvDistributing) {
                return {
                    invalidate: true,
                    action: 'FREEZE',
                    reason: `تحول ميل تدفق السيولة OBV إلى إيجابي (توقف التصريف هبوطاً)`
                };
            }
        }

        return { invalidate: false, action: 'EXIT', reason: 'مصفوفة الزمان والسيولة متماسكة والاتجاه مستقر' };
    }
}
