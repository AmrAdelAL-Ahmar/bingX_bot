import { RSI, SMA, ATR, VWAP, MACD, BollingerBands, StochasticRSI, CCI, WilliamsR, MFI } from 'technicalindicators';
import { OHLCV, CandleData, IndicatorData, AnalysisDetails, TechnicalLevels, MatrixResult, PredictionResult } from './AnalysisService';

export const TF_WEIGHTS: Record<string, number> = {
    '1m': 1, '3m': 2, '5m': 3, '15m': 4,
    '30m': 5, '1h': 8, '4h': 12, '1d': 15
};

export const MATRIX_TFS = ['1m', '5m', '15m', '30m', '1h', '4h', '1d'];

export class TechnicalAnalyzer {
    static prepareCandleData(ohlcv: OHLCV[]): CandleData {
        return {
            closes: ohlcv.map(c => c.close),
            highs: ohlcv.map(c => c.high),
            lows: ohlcv.map(c => c.low),
            volumes: ohlcv.map(c => c.volume),
            last: ohlcv[ohlcv.length - 1],
            prev: ohlcv[ohlcv.length - 2],
            all: ohlcv
        };
    }

    static calculateIndicators(data: CandleData): IndicatorData {
        const { closes, highs, lows, volumes } = data;
        
        const macdArr = MACD.calculate({ 
            values: closes, 
            fastPeriod: 12, 
            slowPeriod: 26, 
            signalPeriod: 9, 
            SimpleMAOscillator: false, 
            SimpleMASignal: false 
        });
        const lastMACD = macdArr[macdArr.length - 1];

        return {
            macd: { 
                macd: lastMACD?.MACD || 0, 
                signal: lastMACD?.signal || 0, 
                histogram: lastMACD?.histogram || 0 
            },
            bb: BollingerBands.calculate({ period: 20, values: closes, stdDev: 2 }).slice(-1)[0],
            stochRsi: StochasticRSI.calculate({ values: closes, rsiPeriod: 14, stochasticPeriod: 14, kPeriod: 3, dPeriod: 3 }).slice(-1)[0]?.k || 50,
            cci: CCI.calculate({ period: 20, high: highs, low: lows, close: closes }).slice(-1)[0] || 0,
            williamsR: WilliamsR.calculate({ period: 14, high: highs, low: lows, close: closes }).slice(-1)[0] || -50,
            mfi: MFI.calculate({ period: 14, high: highs, low: lows, close: closes, volume: volumes }).slice(-1)[0] || 50
        };
    }

    static calculateTechnicalData(ohlcv: OHLCV[], tf: string, vwap: number): AnalysisDetails {
        const data = this.prepareCandleData(ohlcv);
        const { closes, highs, lows, last, prev } = data;

        const ma20 = SMA.calculate({ period: 20, values: closes }).slice(-1)[0] || last.close;
        const isBullishTrend = last.close > ma20;

        const rsi = RSI.calculate({ period: 14, values: closes }).slice(-1)[0] || 50;
        const atr = ATR.calculate({ period: 14, high: highs, low: lows, close: closes }).slice(-1)[0] || 0;

        const recentCandles = ohlcv.slice(-15);
        const lastSwingHigh = Math.max(...recentCandles.map(c => c.high));
        const lastSwingLow = Math.min(...recentCandles.map(c => c.low));

        const levels: TechnicalLevels = {
            pivot: (prev.high + prev.low + prev.close) / 3,
            r1: 0, s1: 0, r2: 0, s2: 0,
            ma7: SMA.calculate({ period: 7, values: closes }).slice(-1)[0],
            ma20: ma20,
            ma99: SMA.calculate({ period: 99, values: closes }).slice(-1)[0],
            fib618: 0, fib382: 0, fibTarget: 0,
            lastSwingHigh,
            lastSwingLow
        };

        levels.r1 = (2 * levels.pivot) - prev.low;
        levels.s1 = (2 * levels.pivot) - prev.high;
        levels.r2 = levels.pivot + (prev.high - prev.low);
        levels.s2 = levels.pivot - (prev.high - prev.low);

        const fibCandles = ohlcv.slice(-50);
        const maxH = Math.max(...fibCandles.map(c => c.high));
        const minL = Math.min(...fibCandles.map(c => c.low));
        const diff = maxH - minL;
        levels.fib618 = maxH - (diff * 0.382);
        levels.fib382 = maxH - (diff * 0.618);
        levels.fibTarget = maxH + (diff * 0.618);

        const indicators = this.calculateIndicators(data);

        return {
            indicators,
            sentiments: [],
            rsi,
            atr,
            levels,
            structure: this.detectMarketStructure(data),
            timeframe: tf,
            isBullishTrend
        };
    }

    static detectMarketStructure(data: CandleData): string {
        const recent = data.all.slice(-30);
        const highs = recent.map(c => c.high);
        const lows = recent.map(c => c.low);
        
        const lastH = highs[highs.length - 1];
        const prevH = Math.max(...highs.slice(-10, -1));
        const lastL = lows[lows.length - 1];
        const prevL = Math.min(...lows.slice(-10, -1));

        if (lastH > prevH && lastL > prevL) return "صاعد (HH/HL) 📈";
        if (lastH < prevH && lastL < prevL) return "هابط (LH/LL) 📉";
        if (lastH > prevH && lastL < prevL) return "كسر هيكل (BOS) ⚡";
        return "عرضي ↔️";
    }

    static calculateVWAP(ohlcv: OHLCV[]): number {
        const input = {
            high: ohlcv.map(c => c.high),
            low: ohlcv.map(c => c.low),
            close: ohlcv.map(c => c.close),
            volume: ohlcv.map(c => c.volume)
        };
        const vwapValues = VWAP.calculate(input);
        return vwapValues[vwapValues.length - 1];
    }

    static calculateMatrix(allTimeframes: Record<string, AnalysisDetails>, targetTFs: string[] = MATRIX_TFS): MatrixResult {
        let totalScore = 0;
        let maxPossibleScore = 0;
        let details = "| ";

        targetTFs.forEach(tf => {
            const data = allTimeframes[tf];
            if (data) {
                const weight = TF_WEIGHTS[tf] || 1;
                totalScore += (data.isBullishTrend ? 1 : -1) * weight;
                maxPossibleScore += weight;
                details += `${tf}:${data.isBullishTrend ? '🟢' : '🔴'} | `;
            }
        });

        const percentage = ((totalScore + maxPossibleScore) / (2 * maxPossibleScore)) * 100;
        let decision = "محايد ⚪";
        if (percentage >= 75) decision = "شراء قوي 🟢";
        else if (percentage >= 55) decision = "شراء 🟢";
        else if (percentage <= 25) decision = "بيع قوي 🔴";
        else if (percentage <= 45) decision = "بيع 🔴";

        return { score: totalScore, percentage, decision, details };
    }

    static predictNextPriceLinear(pastCandles: OHLCV[], period: number = 20): PredictionResult {
        let sumX = 0, sumY = 0, sumXY = 0, sumXX = 0;
        const n = Math.min(period, pastCandles.length);
        const recent = pastCandles.slice(-n);
        
        for (let i = 0; i < n; i++) {
            const x = i + 1;
            const y = recent[i].close;
            sumX += x;
            sumY += y;
            sumXY += (x * y);
            sumXX += (x * x);
        }
        
        const m = (n * sumXY - sumX * sumY) / (n * sumXX - sumX * sumX);
        const b = (sumY - m * sumX) / n;
        const predictedPrice = (m * (n + 1)) + b;

        return {
            predictedPrice,
            trendDirection: m > 0 ? 'UP' : 'DOWN',
            slope: m,
            confidence: Math.abs(m) * 1000
        };
    }

    static detectDivergence(ohlcv: OHLCV[], direction: 'LONG' | 'SHORT' = 'LONG'): { detected: boolean, description: string } {
        const closes = ohlcv.map(c => c.close);
        const rsiValues = RSI.calculate({ period: 14, values: closes });
        
        if (closes.length < 20 || rsiValues.length < 20) {
            return { detected: false, description: "بيانات غير كافية" };
        }

        const p2 = closes[closes.length - 1];
        const p1 = closes[closes.length - 10] || closes[0];
        const r2 = rsiValues[rsiValues.length - 1];
        const r1 = rsiValues[rsiValues.length - 10] || rsiValues[0];

        if (direction === 'LONG') {
            // Bearish Divergence: Price higher high, RSI lower high
            const isDivergent = p2 > p1 && r2 < r1;
            return { 
                detected: isDivergent, 
                description: isDivergent ? "⚠️ انحراف سلبي (Bearish): السعر يصعد والزخم يضعف" : "✅ لا يوجد انحراف سلبي حالياً" 
            };
        } else {
            // Bullish Divergence: Price lower low, RSI higher low
            const isDivergent = p2 < p1 && r2 > r1;
            return { 
                detected: isDivergent, 
                description: isDivergent ? "⚠️ انحراف إيجابي (Bullish): السعر يهبط وقوة الشراء تزداد" : "✅ لا يوجد انحراف إيجابي حالياً" 
            };
        }
    }

    static calculateCorrectionFibLevels(ohlcv: OHLCV[], direction: 'LONG' | 'SHORT' = 'LONG') {
        const highs = ohlcv.map(c => c.high);
        const lows = ohlcv.map(c => c.low);
        const maxHigh = Math.max(...highs.slice(-40));
        const minLow = Math.min(...lows.slice(-40));
        const diff = maxHigh - minLow;

        if (direction === 'LONG') {
            return {
                fib382: maxHigh - (diff * 0.382),
                fib500: maxHigh - (diff * 0.500),
                fib618: maxHigh - (diff * 0.618),
                type: 'SUPPORT'
            };
        } else {
            return {
                fib382: minLow + (diff * 0.382),
                fib500: minLow + (diff * 0.500),
                fib618: minLow + (diff * 0.618),
                type: 'RESISTANCE'
            };
        }
    }
}
