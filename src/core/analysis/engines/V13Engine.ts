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
        const quickKey = mode === 'SWING' ? '15m' : '5m';
        const ohlcv = mtfOHLCV[quickKey] || [];

        if (ohlcv.length < 96) {
            return this.cancel(cp, '❌ بيانات غير كافية لـ V13 (تحتاج 96 شمعة على الأقل لحساب POC لـ 24 ساعة)', mode, 0, 'No data');
        }

        // ── 1. Macro POC Gate (Volume Profile POC of last 24 hours) ──
        const candles24hCount = mode === 'SWING' ? 96 : 288;
        const ohlcv24h = ohlcv.slice(-Math.min(ohlcv.length, candles24hCount));
        const vp = TechnicalAnalyzer.calculateVolumeProfile(ohlcv24h, 30);
        const poc = vp.poc;

        const pocError = Math.abs(cp - poc) / poc;
        const pocConfluence = pocError <= 0.0075;

        if (!pocConfluence) {
            return this.cancel(cp, `⚪ السعر بعيد عن POC للمؤسسات لـ V13 (انحراف: ${(pocError * 100).toFixed(2)}% > 0.75%)`, mode, 0, 'Out of POC range');
        }

        // ── 2. Meso Spring / Upthrust Sweep ──
        const recent = ohlcv.slice(-25, -1);
        const highestHigh = Math.max(...recent.map(c => c.high));
        const lowestLow = Math.min(...recent.map(c => c.low));
        const last = ohlcv[ohlcv.length - 1];

        const totalRange = last.high - last.low || 0.0001;
        let direction: 'LONG' | 'SHORT' | 'NONE' = 'NONE';
        let wickRatio = 0;

        if (last.low < lowestLow && last.close > lowestLow) {
            wickRatio = (Math.min(last.open, last.close) - last.low) / totalRange;
            if (wickRatio >= 0.50) {
                direction = 'LONG';
            }
        } else if (last.high > highestHigh && last.close < highestHigh) {
            wickRatio = (last.high - Math.max(last.open, last.close)) / totalRange;
            if (wickRatio >= 0.50) {
                direction = 'SHORT';
            }
        }

        if (direction === 'NONE') {
            return this.cancel(cp, '⚪ لا يوجد سحب سيولة هيكلي لـ V13 (Spring / Upthrust)', mode, 0, 'No Wyckoff sweep');
        }

        // ── 3. Micro Order Flow Trigger ──
        const spread = last.high - last.low || 0.0001;
        const buyVolume = last.volume * (last.close - last.low) / spread;
        const sellVolume = last.volume * (last.high - last.close) / spread;
        const delta = ((last.close - last.open) / spread) * last.volume;

        const recentForVolume = ohlcv.slice(-21, -1);
        const avgVolume = recentForVolume.reduce((sum, c) => sum + c.volume, 0) / (recentForVolume.length || 1);

        let triggerOk = false;
        let imbalanceRatio = 0;

        if (direction === 'LONG') {
            imbalanceRatio = buyVolume / (sellVolume || 1);
            const deltaAccelerating = delta > 0;
            const volumeSurge = Math.abs(delta) >= avgVolume * 0.1;

            if (imbalanceRatio >= 3.0 && deltaAccelerating && volumeSurge) {
                triggerOk = true;
            }
        } else {
            imbalanceRatio = sellVolume / (buyVolume || 1);
            const deltaAccelerating = delta < 0;
            const volumeSurge = Math.abs(delta) >= avgVolume * 0.1;

            if (imbalanceRatio >= 3.0 && deltaAccelerating && volumeSurge) {
                triggerOk = true;
            }
        }

        if (!triggerOk) {
            return this.cancel(cp, `⚪ لا يوجد تأكيد من تدفق السيولة/الأحجام لـ V13 (الحجم غير متوازن: ${imbalanceRatio.toFixed(1)}x)`, mode, 0, 'No orderflow confirmation');
        }

        // Confluence with multi-timeframe matrix
        const matrixOk = direction === 'LONG' ? matrix.percentage >= 55 : matrix.percentage <= 45;
        if (!matrixOk) {
            return this.cancel(cp, `⚪ لا يوجد توافق مع مصفوفة الفريمات لـ V13 (الماتريكس الحالي: ${matrix.percentage.toFixed(0)}%)`, mode, 0, 'No matrix confluence');
        }

        let score = 30;
        if (pocConfluence) score += 15;
        score += 25;
        if (triggerOk) score += 15;
        if (matrixOk) score += 10;

        score = Math.min(Math.max(score, 10), 95);
        const winRate = Math.min(50 + score * 0.45, 96);

        const execData = allTimeframes[quickKey];
        const atr = execData?.atr || cp * 0.005;

        const sl = direction === 'LONG' ? last.low * 0.998 : last.high * 1.002;
        const tp = direction === 'LONG' ? cp + atr * 4 : cp - atr * 4;

        const reasons: string[] = [
            `سحب سيولة ${direction === 'LONG' ? 'شرائي (Spring)' : 'بيعي (Upthrust)'} بذيل ${(wickRatio * 100).toFixed(0)}%`,
            `توازن أحجام ${imbalanceRatio.toFixed(1)}x`,
            `مصفوفة الفريمات ${matrix.percentage.toFixed(0)}%`
        ];

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
