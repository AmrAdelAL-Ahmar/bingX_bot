import { AnalysisDetails, MatrixResult, OHLCV, TradeRecommendation } from '../../shared/types';
import { ITradingEngine, EngineResult } from './ITradingEngine';
import { TechnicalAnalyzer } from '../TechnicalAnalyzer';

export class V13Engine implements ITradingEngine {
    analyze(
        cp: number,
        vwap: number,
        allTimeframes: Record<string, AnalysisDetails>,
        mtfOHLCV: Record<string, OHLCV[]>,
        options: { quickTF: string; longTF: string }
    ): EngineResult {
        const matrix = TechnicalAnalyzer.calculateMatrix(allTimeframes);

        return {
            matrix,
            scalp: this.runV13Pipeline(cp, vwap, allTimeframes, mtfOHLCV, matrix, 'SCALP'),
            swing: this.runV13Pipeline(cp, vwap, allTimeframes, mtfOHLCV, matrix, 'SWING'),
        };
    }

    private runV13Pipeline(
        cp: number,
        vwap: number,
        allTimeframes: Record<string, AnalysisDetails>,
        mtfOHLCV: Record<string, OHLCV[]>,
        matrix: MatrixResult,
        mode: 'SCALP' | 'SWING'
    ): TradeRecommendation {
        const ohlcv = mtfOHLCV[mode === 'SCALP' ? '5m' : '1h'] || mtfOHLCV['15m'] || [];
        if (ohlcv.length < 25) {
            return this.cancel(cp, '❌ بيانات غير كافية لـ V13', mode, 0, 'No data');
        }

        const recent = ohlcv.slice(-25, -1);
        const highestHigh = Math.max(...recent.map(c => c.high));
        const lowestLow = Math.min(...recent.map(c => c.low));
        const last = ohlcv[ohlcv.length - 1];

        let direction: 'LONG' | 'SHORT' | 'NONE' = 'NONE';
        const reasons: string[] = [];
        let score = 30;

        // Bullish Liquidity Sweep (Spring)
        if (last.low < lowestLow && last.close > lowestLow) {
            direction = 'LONG';
            score += 40;
            reasons.push('سحب سيولة شرائي (Wyckoff Spring / Bullish Liquidity Sweep)');
        }
        // Bearish Liquidity Sweep (Upthrust UT)
        else if (last.high > highestHigh && last.close < highestHigh) {
            direction = 'SHORT';
            score += 40;
            reasons.push('سحب سيولة بيعي (Wyckoff Upthrust / Bearish Liquidity Sweep)');
        }

        if (direction === 'NONE') {
            return this.cancel(cp, '⚪ لا يوجد سحب سيولة هيكلي لـ V13', mode, 0, 'No Wyckoff sweep');
        }

        // Volume Spike confirmation: last candle volume must be > 1.5x of previous 20-candle average
        const recentForVolume = ohlcv.slice(-21, -1);
        const avgVolume = recentForVolume.reduce((sum, c) => sum + c.volume, 0) / (recentForVolume.length || 1);
        const isVolumeSpike = last.volume > avgVolume * 1.5;

        if (!isVolumeSpike) {
            return this.cancel(cp, '⚪ كشط السيولة غير مدعوم بحجم تداول مؤسساتي (لا توجد طفرة حجمية لـ V13)', mode, 0, 'No Volume Spike');
        }
        reasons.push(`طفرة أحجام التداول (${last.volume.toFixed(0)} > 1.5x من المتوسط ${avgVolume.toFixed(0)})`);
        score += 15;

        // Additional confirmation from multi-timeframe matrix
        const matrixOk = direction === 'LONG' ? matrix.percentage >= 55 : matrix.percentage <= 45;
        if (matrixOk) {
            score += 15;
            reasons.push(`توافق المصفوفة (${matrix.percentage.toFixed(0)}%)`);
        }

        const winRate = Math.min(50 + score * 0.45, 96);
        if (winRate < 70) {
            return this.cancel(cp, `⚪ قوة الإشارة غير كافية V13 (${winRate.toFixed(0)}%)`, mode, score, 'Low score');
        }

        const execData = allTimeframes[mode === 'SCALP' ? '5m' : '1h'] || allTimeframes['15m'];
        const atr = execData?.atr || cp * 0.005;

        // In liquidity sweeps, Stop Loss is tight, placed just below the sweep wick
        const sl = direction === 'LONG' ? last.low * 0.998 : last.high * 1.002;
        const tp = direction === 'LONG' ? cp + atr * 4 : cp - atr * 4;

        return {
            status: `${direction === 'LONG' ? '🟢 قناص صاعد' : '🔴 قناص هابط'} V13 [${mode}] (${winRate.toFixed(0)}%)`,
            type: direction,
            entry: cp,
            tp,
            sl,
            timeEstimate: mode === 'SCALP' ? 30 : 240,
            winRate,
            reverseProb: 100 - winRate,
            confidenceScore: score,
            signalReason: reasons.join(' | ')
        };
    }

    private cancel(
        cp: number,
        status: string,
        mode: string,
        score: number,
        reason: string
    ): TradeRecommendation {
        return {
            status,
            type: 'NONE',
            entry: cp, tp: cp, sl: cp,
            timeEstimate: mode === 'SCALP' ? 30 : 240,
            winRate: 0,
            reverseProb: 0,
            confidenceScore: score,
            signalReason: reason,
        };
    }
}
