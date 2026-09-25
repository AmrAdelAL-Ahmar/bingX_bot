import { OHLCV, AnalysisDetails } from '../../shared/types';

export interface RadarInvalidationResult {
    invalidate: boolean;
    action: 'EXIT' | 'FLIP' | 'FREEZE' | 'RESET';
    reason: string;
}

export interface IRadarEngine {
    readonly engineId: string;
    monitor(
        direction: 'LONG' | 'SHORT',
        currentPrice: number,
        ohlcv: OHLCV[],
        allTimeframes: Record<string, AnalysisDetails>,
        mtfOHLCV: Record<string, OHLCV[]>
    ): RadarInvalidationResult;
}
