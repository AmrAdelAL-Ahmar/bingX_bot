import { AnalysisDetails, MatrixResult, OHLCV, TradeRecommendation } from '../../shared/types';
import { ITradingEngine, EngineResult } from './ITradingEngine';
import { TechnicalAnalyzer } from '../TechnicalAnalyzer';

interface MacroResult {
    bias: 'LONG' | 'SHORT' | 'NEUTRAL';
    reason: string;
    score: number;
}

interface POIZone {
    top: number;
    bottom: number;
    source: 'SWEEP' | 'RETEST';
    description: string;
}

interface MicroResult {
    confirmed: boolean;
    reason: string;
    score: number;
    stochCurl: boolean;
    volumeSpike: boolean;
}

export class V8Engine implements ITradingEngine {
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
            scalp: this.runV8Pipeline(cp, vwap, allTimeframes, mtfOHLCV, matrix, 'SCALP'),
            swing: this.runV8Pipeline(cp, vwap, allTimeframes, mtfOHLCV, matrix, 'SWING'),
        };
    }

    private runV8Pipeline(
        cp: number,
        vwap: number,
        allTimeframes: Record<string, AnalysisDetails>,
        mtfOHLCV: Record<string, OHLCV[]>,
        matrix: MatrixResult,
        mode: 'SCALP' | 'SWING'
    ): TradeRecommendation {
        const macroTF = mode === 'SWING' ? '1d' : '1h';
        const mesoTF = mode === 'SWING' ? '1h' : '5m';
        const microTF = mode === 'SWING' ? '15m' : '1m';

        const macroOHLCV = mtfOHLCV[macroTF] || [];
        const mesoOHLCV = mtfOHLCV[mesoTF] || [];
        const microOHLCV = mtfOHLCV[microTF] || [];

        // 1. Macro Bias
        const macro = this.evaluateMacroWave(cp, macroOHLCV, allTimeframes[macroTF]);
        const direction = macro.bias;

        if (direction === 'NEUTRAL') {
            return this.cancel(cp, '⚪ مسار عرضي: لا تحيز للموجة العامة (V8)', mode, 0, 'Macro Neutral');
        }

        // 2. Meso Zone
        const mesoData = allTimeframes[mesoTF];
        const poi = this.detectMesoLevel(cp, mesoOHLCV, direction, mesoData);
        let zone: { top: number; bottom: number } | null = null;
        let inZone = false;

        if (poi) {
            zone = { top: poi.top, bottom: poi.bottom };
            if (direction === 'LONG') {
                inZone = cp <= zone.top && cp >= zone.bottom - (poi.top - poi.bottom) * 0.5;
            } else {
                inZone = cp >= zone.bottom && cp <= zone.top + (zone.top - zone.bottom) * 0.5;
            }
        }

        // 3. Micro Momentum
        const microData = allTimeframes[microTF];
        const micro = this.evaluateMicroMomentum(cp, microOHLCV, direction, microData);

        // Confidence & WinRate
        let confidence = 40;
        if (macro.bias !== 'NEUTRAL') confidence += 15;
        if (poi && inZone) confidence += 25;
        if (micro.stochCurl) confidence += 10;
        if (micro.volumeSpike) confidence += 10;
        if (direction === 'LONG' && matrix.percentage >= 60) confidence += 10;
        if (direction === 'SHORT' && matrix.percentage <= 40) confidence += 10;

        confidence = Math.min(Math.max(confidence, 10), 95);
        const winRate = Math.min(55 + confidence * 0.45, 96);

        // SL / TP
        const execData = allTimeframes[mesoTF] || allTimeframes['15m'] || allTimeframes['1h'];
        if (!execData || microOHLCV.length === 0) {
            return this.cancel(cp, '❌ V8 بيانات التنفيذ غير متوفرة', mode, 0, 'No execution data');
        }

        let entryPrice = cp;
        if (zone && !inZone) {
            entryPrice = direction === 'LONG' ? zone.top : zone.bottom;
        }

        const sl = this.calcSL(entryPrice, microOHLCV, direction, execData, zone);
        const tp = this.calcTP(entryPrice, mesoOHLCV, direction, execData);
        const tp2 = this.calcTP2(entryPrice, mesoOHLCV, direction, execData);

        // Rejection Check
        const ready = poi !== null && inZone && micro.confirmed && winRate >= 78;
        if (!ready) {
            let reason = 'انتظار الشروط: ';
            if (!poi) reason += 'لا توجد منطقة اهتمام (POI)، ';
            else if (!inZone) reason += 'السعر خارج منطقة التراجع، ';
            if (!micro.confirmed) reason += 'الزناد الصغير لم يتأكد، ';
            if (winRate < 78) reason += `نسبة الفوز (${winRate.toFixed(0)}%) < 78%`;
            return this.cancel(cp, `🔍 V8 انتظار: ${reason.replace(/,\s*$/, '')}`, mode, confidence, reason);
        }

        const signalReason = [
            `🎯 V8 Wave Sniper [${mode}]`,
            `Macro: ${macro.reason}`,
            `POI: ${poi.description}`,
            `Micro: ${micro.reason}`,
            `WinRate: ${winRate.toFixed(0)}%`
        ].join(' | ');

        return {
            status: `${direction === 'LONG' ? '🟢 صعود موجي' : '🔴 هبوط موجي'} V8 (${winRate.toFixed(0)}%)`,
            type: direction,
            entry: cp,
            tp,
            tp2,
            sl,
            timeEstimate: mode === 'SCALP' ? 30 : 240,
            winRate,
            reverseProb: 100 - winRate,
            confidenceScore: confidence,
            signalReason
        };
    }

    private evaluateMacroWave(cp: number, ohlcv: OHLCV[], data?: AnalysisDetails): MacroResult {
        if (ohlcv.length < 50) return { bias: 'NEUTRAL', reason: 'بيانات غير كافية للماكرو', score: 50 };

        const closes = ohlcv.map(c => c.close);
        const lastClose = closes[closes.length - 1];

        let sum50 = 0;
        for (let i = closes.length - 50; i < closes.length; i++) sum50 += closes[i];
        const ema50 = sum50 / 50;

        let sum200 = 0;
        const count200 = Math.min(closes.length, 200);
        for (let i = closes.length - count200; i < closes.length; i++) sum200 += closes[i];
        const ema200 = sum200 / count200;

        const trendLong = lastClose > ema200;
        const trendMed = lastClose > ema50;

        let bias: 'LONG' | 'SHORT' | 'NEUTRAL' = 'NEUTRAL';
        let reason = '';
        let score = 50;

        if (trendLong && trendMed) {
            bias = 'LONG';
            reason = `موجة صاعدة رئيسية (السعر فوق EMA50/200)`;
            score = 80;
        } else if (!trendLong && !trendMed) {
            bias = 'SHORT';
            reason = `موجة هابطة رئيسية (السعر تحت EMA50/200)`;
            score = 20;
        } else {
            bias = lastClose > ema200 ? 'LONG' : 'SHORT';
            reason = `موجة تصحيحية عرضية (السعر بين EMA50 و EMA200)`;
            score = bias === 'LONG' ? 60 : 40;
        }

        return { bias, reason, score };
    }

    private detectMesoLevel(cp: number, ohlcv: OHLCV[], direction: 'LONG' | 'SHORT', data?: AnalysisDetails): POIZone | null {
        if (ohlcv.length < 30) return null;

        const recent = ohlcv.slice(-20);
        const lastCandle = recent[recent.length - 1];
        const atr = data?.atr || cp * 0.005;

        const previousCandles = recent.slice(0, -1);
        const lowestPrevLow = Math.min(...previousCandles.map(c => c.low));
        const highestPrevHigh = Math.max(...previousCandles.map(c => c.high));

        if (direction === 'LONG') {
            const isSweep = lastCandle.low < lowestPrevLow && lastCandle.close > lowestPrevLow;
            const hasStrongWick = (Math.min(lastCandle.open, lastCandle.close) - lastCandle.low) > (lastCandle.high - lastCandle.low) * 0.4;

            if (isSweep || hasStrongWick) {
                return {
                    top: Math.max(lastCandle.open, lastCandle.close),
                    bottom: lastCandle.low,
                    source: 'SWEEP',
                    description: `كشط سيولة القيعان (Liquidity Sweep) عند قاع $${lastCandle.low.toFixed(2)}`
                };
            }
        } else {
            const isSweep = lastCandle.high > highestPrevHigh && lastCandle.close < highestPrevHigh;
            const hasStrongWick = (lastCandle.high - Math.max(lastCandle.open, lastCandle.close)) > (lastCandle.high - lastCandle.low) * 0.4;

            if (isSweep || hasStrongWick) {
                return {
                    top: lastCandle.high,
                    bottom: Math.min(lastCandle.open, lastCandle.close),
                    source: 'SWEEP',
                    description: `كشط سيولة القمم (Liquidity Sweep) عند قمة $${lastCandle.high.toFixed(2)}`
                };
            }
        }

        const closes = ohlcv.map(c => c.close);
        let sum50 = 0;
        for (let i = closes.length - Math.min(closes.length, 50); i < closes.length; i++) sum50 += closes[i];
        const ema50 = sum50 / Math.min(closes.length, 50);

        if (direction === 'LONG') {
            const touchedEma = lastCandle.low <= ema50 * 1.002 && lastCandle.close >= ema50 * 0.998;
            if (touchedEma) {
                return {
                    top: ema50 + atr * 0.2,
                    bottom: ema50 - atr * 0.3,
                    source: 'RETEST',
                    description: `إعادة اختبار متوسط الموجة EMA50 كـ دعم ديناميكي عند $${ema50.toFixed(2)}`
                };
            }
        } else {
            const touchedEma = lastCandle.high >= ema50 * 0.998 && lastCandle.close <= ema50 * 1.002;
            if (touchedEma) {
                return {
                    top: ema50 + atr * 0.3,
                    bottom: ema50 - atr * 0.2,
                    source: 'RETEST',
                    description: `إعادة اختبار متوسط الموجة EMA50 كـ مقاومة ديناميكية عند $${ema50.toFixed(2)}`
                };
            }
        }

        return null;
    }

    private evaluateMicroMomentum(cp: number, ohlcv: OHLCV[], direction: 'LONG' | 'SHORT', data?: AnalysisDetails): MicroResult {
        if (ohlcv.length < 15) return { confirmed: false, reason: 'بيانات فنية غير كافية', score: 0, stochCurl: false, volumeSpike: false };

        const recent = ohlcv.slice(-15);
        const lastCandle = recent[recent.length - 1];

        let stochCurl = false;
        let rsiVal = data?.rsi || 50;

        if (direction === 'LONG') {
            stochCurl = rsiVal >= 35 && rsiVal <= 65 || (data?.rsi || 0) > 30;
        } else {
            stochCurl = rsiVal >= 35 && rsiVal <= 65 || (data?.rsi || 100) < 70;
        }

        const avgVol = recent.slice(0, -1).reduce((acc, c) => acc + c.volume, 0) / 14;
        const volumeSpike = lastCandle.volume > avgVol * 1.15;

        const score = (stochCurl ? 50 : 0) + (volumeSpike ? 50 : 0);
        const confirmed = stochCurl;

        const reason = `زخم الانعكاس: ${stochCurl ? 'إيجابي صاعد' : 'محايد'} | سيولة الحجم: ${volumeSpike ? 'نشطة مؤيدة' : 'عادية'}`;

        return { confirmed, reason, score, stochCurl, volumeSpike };
    }

    private calcSL(
        cp: number,
        ohlcv: OHLCV[],
        direction: 'LONG' | 'SHORT',
        data: AnalysisDetails,
        zone: { top: number; bottom: number } | null
    ): number {
        const recent = ohlcv.slice(-10);
        const atr = data.atr || cp * 0.005;

        if (zone) {
            if (direction === 'LONG') {
                return zone.bottom - (atr * 3);
            } else {
                return zone.top + (atr * 3);
            }
        }

        if (direction === 'LONG') {
            const sl = Math.min(...recent.map(c => c.low)) - (atr * 3);
            return Math.max(sl, cp * 0.97);
        } else {
            const sl = Math.max(...recent.map(c => c.high)) + (atr * 3);
            return Math.min(sl, cp * 1.03);
        }
    }

    private calcTP(cp: number, ohlcv: OHLCV[], direction: 'LONG' | 'SHORT', data: AnalysisDetails): number {
        const atr = data.atr || cp * 0.005;
        if (direction === 'LONG') return cp + (atr * 3.0);
        return cp - (atr * 3.0);
    }

    private calcTP2(cp: number, ohlcv: OHLCV[], direction: 'LONG' | 'SHORT', data: AnalysisDetails): number {
        const atr = data.atr || cp * 0.005;
        if (direction === 'LONG') return cp + (atr * 5.5);
        return cp - (atr * 5.5);
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
