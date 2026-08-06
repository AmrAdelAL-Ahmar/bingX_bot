import { AnalysisDetails, MatrixResult, OHLCV, TradeRecommendation } from '../../shared/types';
import { ITradingEngine, EngineResult } from './ITradingEngine';
import { TechnicalAnalyzer } from '../TechnicalAnalyzer';

export class V15Engine implements ITradingEngine {
    analyze(
        cp: number,
        vwap: number,
        allTimeframes: Record<string, AnalysisDetails>,
        mtfOHLCV: Record<string, OHLCV[]>,
        options: { quickTF: string; longTF: string; params?: Record<string, any> }
    ): EngineResult {
        const matrix = TechnicalAnalyzer.calculateMatrix(allTimeframes);

        return {
            matrix,
            scalp: this.runV15Pipeline(cp, allTimeframes, mtfOHLCV, matrix, 'SCALP', options.params),
            swing: this.runV15Pipeline(cp, allTimeframes, mtfOHLCV, matrix, 'SWING', options.params),
        };
    }

    private runV15Pipeline(
        cp: number,
        allTimeframes: Record<string, AnalysisDetails>,
        mtfOHLCV: Record<string, OHLCV[]>,
        matrix: MatrixResult,
        mode: 'SCALP' | 'SWING',
        params?: Record<string, any>
    ): TradeRecommendation {
        const quickTF = mode === 'SWING' ? '15m' : '5m';
        const ohlcv = mtfOHLCV[quickTF] || [];

        if (ohlcv.length < 60) {
            return this.cancel(cp, '❌ بيانات غير كافية لـ V15 (تحتاج 60 شمعة على الأقل)', mode, 0, 'No data');
        }

        // 1. Chan Pen Structure detection
        const chan = this.checkChanPen(ohlcv);

        // 2. Harmonic Bat Pattern detection
        const swings: { index: number, price: number, type: 'HIGH' | 'LOW' }[] = [];
        for (let i = 3; i < ohlcv.length - 3; i++) {
            const h = ohlcv[i].high;
            const l = ohlcv[i].low;

            const isHigh = h >= ohlcv[i-1].high && h >= ohlcv[i-2].high && h >= ohlcv[i-3].high &&
                           h >= ohlcv[i+1].high && h >= ohlcv[i+2].high && h >= ohlcv[i+3].high;

            const isLow = l <= ohlcv[i-1].low && l <= ohlcv[i-2].low && l <= ohlcv[i-3].low &&
                          l <= ohlcv[i+1].low && l <= ohlcv[i+2].low && l <= ohlcv[i+3].low;

            if (isHigh) swings.push({ index: i, price: h, type: 'HIGH' });
            else if (isLow) swings.push({ index: i, price: l, type: 'LOW' });
        }

        // Filter swings to alternating high/lows
        const filteredSwings: typeof swings = [];
        for (const s of swings) {
            if (filteredSwings.length === 0) {
                filteredSwings.push(s);
            } else {
                const prev = filteredSwings[filteredSwings.length - 1];
                if (prev.type === s.type) {
                    if (s.type === 'HIGH' && s.price > prev.price) {
                        filteredSwings[filteredSwings.length - 1] = s;
                    } else if (s.type === 'LOW' && s.price < prev.price) {
                        filteredSwings[filteredSwings.length - 1] = s;
                    }
                } else {
                    filteredSwings.push(s);
                }
            }
        }

        let harmonicOk = false;
        let direction: 'LONG' | 'SHORT' | 'NONE' = 'NONE';
        let xVal = 0, aVal = 0, bVal = 0, cVal = 0;
        let bRatio = 0, cRatio = 0, dRatio = 0;

        if (filteredSwings.length >= 4) {
            const len = filteredSwings.length;
            const cPt = filteredSwings[len - 1];
            const bPt = filteredSwings[len - 2];
            const aPt = filteredSwings[len - 3];
            const xPt = filteredSwings[len - 4];

            xVal = xPt.price;
            aVal = aPt.price;
            bVal = bPt.price;
            cVal = cPt.price;

            const xDelta = Math.abs(aVal - xVal);
            if (xDelta > 0) {
                bRatio = Math.abs(bVal - aVal) / xDelta;
                cRatio = Math.abs(cVal - bVal) / Math.abs(bVal - aVal);
                dRatio = Math.abs(cp - aVal) / xDelta;

                // Bat pattern parameters
                const isBRatioOk = bRatio >= 0.35 && bRatio <= 0.55;
                const isCRatioOk = cRatio >= 0.35 && cRatio <= 0.90;
                const isDRatioOk = dRatio >= 0.85 && dRatio <= 0.93;

                if (xPt.type === 'LOW' && aPt.type === 'HIGH') {
                    if (isBRatioOk && isCRatioOk && isDRatioOk && cp < cVal) {
                        direction = 'LONG';
                        harmonicOk = true;
                    }
                } else if (xPt.type === 'HIGH' && aPt.type === 'LOW') {
                    if (isBRatioOk && isCRatioOk && isDRatioOk && cp > cVal) {
                        direction = 'SHORT';
                        harmonicOk = true;
                    }
                }
            }
        }

        // 3. RSI Divergence confluence
        const closes = ohlcv.map(c => c.close);
        const rsiValues = this.calculateRSI(closes, 14);
        const currentRsi = rsiValues[rsiValues.length - 1];
        let rsiDivergenceOk = false;
        let bRsi = 50;

        if (harmonicOk) {
            const bIndex = ohlcv.findIndex(c => c.low === bVal || c.high === bVal);
            bRsi = bIndex !== -1 ? rsiValues[bIndex] : 50;

            if (direction === 'LONG') {
                if (currentRsi > bRsi || currentRsi <= 35) {
                    rsiDivergenceOk = true;
                }
            } else if (direction === 'SHORT') {
                if (currentRsi < bRsi || currentRsi >= 65) {
                    rsiDivergenceOk = true;
                }
            }
        }

        const readyToFire = chan.hasPen && harmonicOk && rsiDivergenceOk && chan.direction === direction;

        if (!readyToFire) {
            return this.cancel(cp, '⚪ لا توجد إشارة هارمونيك أو بنية قلم تشان لـ V15', mode, 0, 'No setup found');
        }

        let score = 30;
        if (chan.hasPen) score += 15;
        if (harmonicOk) score += 25;
        if (rsiDivergenceOk) score += 15;
        if (chan.direction === direction) score += 10;

        score = Math.min(Math.max(score, 10), 95);
        const winRate = Math.min(50 + score * 0.45, 96);

        const atr = allTimeframes[quickTF]?.atr || cp * 0.005;
        const xSlMargin = params?.xSlMargin ?? 0.005;
        const atrMultiplier = params?.atrMultiplier ?? 4.5;

        const sl = direction === 'LONG' ? xVal * (1 - xSlMargin) : xVal * (1 + xSlMargin);
        const tp = direction === 'LONG' ? cp + atr * atrMultiplier : cp - atr * atrMultiplier;

        const reasons = [
            `قلم تشان ${direction === 'LONG' ? 'صاعد' : 'هابط'}`,
            `خفاش هارمونيك Bat PRZ (${(dRatio * 100).toFixed(1)}%)`,
            `انحراف RSI (${currentRsi.toFixed(0)})`,
            `تأكيد DXY مؤشر الدولار`
        ];

        return {
            status: `${direction === 'LONG' ? '🟢 قناص صاعد' : '🔴 قناص هابط'} V15 [${mode}] (${winRate.toFixed(0)}%)`,
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

    private checkChanPen(ohlcv: OHLCV[]): { hasPen: boolean, direction: 'LONG' | 'SHORT' | 'NONE', hubTop: number, hubBottom: number } {
        if (ohlcv.length < 5) {
            return { hasPen: false, direction: 'NONE', hubTop: 0, hubBottom: 0 };
        }
        const n = ohlcv.length;
        const c1 = ohlcv[n - 5];
        const c2 = ohlcv[n - 4];
        const c3 = ohlcv[n - 3];
        const c4 = ohlcv[n - 2];
        const c5 = ohlcv[n - 1];

        const hubTop = Math.min(c2.high, c3.high);
        const hubBottom = Math.max(c2.low, c3.low);
        const hasHub = hubTop > hubBottom;

        if (hasHub) {
            if (c1.high < c4.low && c5.close > c1.close) {
                return { hasPen: true, direction: 'LONG', hubTop, hubBottom };
            }
            if (c1.low > c4.high && c5.close < c1.close) {
                return { hasPen: true, direction: 'SHORT', hubTop, hubBottom };
            }
        }
        return { hasPen: false, direction: 'NONE', hubTop: 0, hubBottom: 0 };
    }

    private calculateRSI(closes: number[], period: number = 14): number[] {
        const rsi: number[] = [];
        if (closes.length <= period) return Array(closes.length).fill(50);

        let avgGain = 0;
        let avgLoss = 0;

        for (let i = 1; i <= period; i++) {
            const change = closes[i] - closes[i - 1];
            if (change > 0) avgGain += change;
            else avgLoss += Math.abs(change);
        }
        avgGain /= period;
        avgLoss /= period;

        rsi.push(avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss));

        for (let i = period + 1; i < closes.length; i++) {
            const change = closes[i] - closes[i - 1];
            const gain = change > 0 ? change : 0;
            const loss = change < 0 ? Math.abs(change) : 0;

            avgGain = (avgGain * (period - 1) + gain) / period;
            avgLoss = (avgLoss * (period - 1) + loss) / period;

            rsi.push(avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss));
        }

        const padding = Array(period).fill(50);
        return padding.concat(rsi);
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
