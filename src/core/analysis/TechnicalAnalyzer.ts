import { RSI, SMA, ATR, VWAP, MACD, BollingerBands, StochasticRSI, CCI, WilliamsR, MFI } from 'technicalindicators';
import { OHLCV, CandleData, IndicatorData, AnalysisDetails, TechnicalLevels, MatrixResult, PredictionResult } from '../shared/types';

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
            ma50: SMA.calculate({ period: 50, values: closes }).slice(-1)[0] || 0,
            ma99: SMA.calculate({ period: 99, values: closes }).slice(-1)[0],
            ma200: closes.length >= 200 ? SMA.calculate({ period: 200, values: closes }).slice(-1)[0] : 0,
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

    /**
     * كشف كتلة الأوامر (Order Block)
     * هي آخر شمعة معاكسة للاتجاه قبل حركة دافعة قوية، ولم يُختبر فيها السعر بعد.
     */
    static detectOrderBlock(
        ohlcv: OHLCV[],
        direction: 'LONG' | 'SHORT'
    ): { found: boolean; top: number; bottom: number; description: string } {
        const candles = ohlcv.slice(-30);
        if (candles.length < 5) return { found: false, top: 0, bottom: 0, description: 'بيانات غير كافية' };

        const latestClose = candles[candles.length - 1].close;
        const MIN_IMPULSE = 0.002; // 0.2% minimum impulse move

        for (let i = candles.length - 4; i >= 1; i--) {
            const c = candles[i];
            const next = candles[i + 1];

            if (direction === 'LONG') {
                // Bullish OB: last bearish candle before a strong bullish impulse
                const isBearish = c.close < c.open;
                const nextIsBullish = next.close > next.open;
                const impulse = next.open > 0 && (next.close - next.open) / next.open > MIN_IMPULSE;
                if (isBearish && nextIsBullish && impulse) {
                    const top = Math.max(c.open, c.close);
                    const bottom = Math.min(c.open, c.close);
                    if (latestClose > top) { // Still untested
                        return { found: true, top, bottom, description: `Bullish OB [${bottom.toFixed(4)}–${top.toFixed(4)}]` };
                    }
                }
            } else {
                // Bearish OB: last bullish candle before a strong bearish impulse
                const isBullish = c.close > c.open;
                const nextIsBearish = next.close < next.open;
                const impulse = next.open > 0 && (next.open - next.close) / next.open > MIN_IMPULSE;
                if (isBullish && nextIsBearish && impulse) {
                    const top = Math.max(c.open, c.close);
                    const bottom = Math.min(c.open, c.close);
                    if (latestClose < bottom) { // Still untested
                        return { found: true, top, bottom, description: `Bearish OB [${bottom.toFixed(4)}–${top.toFixed(4)}]` };
                    }
                }
            }
        }
        return { found: false, top: 0, bottom: 0, description: 'لا يوجد OB صالح' };
    }

    /**
     * كشف الفجوة السعرية العادلة (Fair Value Gap)
     * نمط ثلاث شموع: فجوة بين قمة الشمعة الأولى وقاع الشمعة الثالثة (صاعد) أو العكس.
     */
    static detectFVG(
        ohlcv: OHLCV[],
        direction: 'LONG' | 'SHORT'
    ): { found: boolean; top: number; bottom: number; description: string } {
        const candles = ohlcv.slice(-20);
        if (candles.length < 3) return { found: false, top: 0, bottom: 0, description: 'بيانات غير كافية' };

        const latestClose = candles[candles.length - 1].close;

        // Scan most recent FVGs first
        for (let i = candles.length - 1; i >= 2; i--) {
            const c1 = candles[i - 2];
            const c3 = candles[i];

            if (direction === 'LONG') {
                // Bullish FVG: gap between c1.high and c3.low
                if (c1.high < c3.low) {
                    const bottom = c1.high;
                    const top = c3.low;
                    if (latestClose > top) { // Unfilled
                        return { found: true, top, bottom, description: `Bullish FVG [${bottom.toFixed(4)}–${top.toFixed(4)}]` };
                    }
                }
            } else {
                // Bearish FVG: gap between c3.high and c1.low
                if (c1.low > c3.high) {
                    const bottom = c3.high;
                    const top = c1.low;
                    if (latestClose < bottom) { // Unfilled
                        return { found: true, top, bottom, description: `Bearish FVG [${bottom.toFixed(4)}–${top.toFixed(4)}]` };
                    }
                }
            }
        }
        return { found: false, top: 0, bottom: 0, description: 'لا يوجد FVG صالح' };
    }

    /**
     * كشف كسر هيكل السوق (Market Structure Shift / CHoCH)
     * المعيار الثلاثي: إغلاق الجسم خارج الهيكل + حجم أعلى + عدم رفض فوري
     * الذيول (Wicks) تُتجاهل تماماً لتجنب مصايد السيولة.
     */
    static detectMSS(
        ohlcv: OHLCV[],
        direction: 'LONG' | 'SHORT'
    ): { detected: boolean; breakLevel: number; description: string } {
        const candles = ohlcv.slice(-20);
        if (candles.length < 5) return { detected: false, breakLevel: 0, description: 'بيانات غير كافية' };

        // Average volume (excluding last 2 candles)
        const lookback = candles.slice(0, -2);
        const avgVolume = lookback.reduce((s, c) => s + c.volume, 0) / lookback.length;

        const last = candles[candles.length - 1];
        const prev = candles[candles.length - 2];

        if (direction === 'LONG') {
            // Structure high = max HIGH of all candles except last 3 (avoid counting current move)
            const structureHigh = Math.max(...candles.slice(0, -3).map(c => c.high));

            const bodyCloseAbove = last.close > structureHigh;           // ✅ Body, not wick
            const volumeConfirmed = last.volume > avgVolume * 1.2;       // ✅ Volume surge
            const noRejection = prev.close > structureHigh               // ✅ Prev also closed above
                || (last.close > last.open && (last.close - last.open) / last.open > 0.001);

            const detected = bodyCloseAbove && volumeConfirmed && noRejection;
            return {
                detected,
                breakLevel: structureHigh,
                description: detected
                    ? `✅ MSS صاعد: إغلاق فوق ${structureHigh.toFixed(4)} | حجم ${((last.volume / avgVolume) * 100).toFixed(0)}%`
                    : `❌ MSS غير مؤكد (LONG): جسم:${bodyCloseAbove} | حجم:${volumeConfirmed} | عدم رفض:${noRejection}`
            };
        } else {
            const structureLow = Math.min(...candles.slice(0, -3).map(c => c.low));

            const bodyCloseBelow = last.close < structureLow;
            const volumeConfirmed = last.volume > avgVolume * 1.2;
            const noRejection = prev.close < structureLow
                || (last.open > last.close && (last.open - last.close) / last.open > 0.001);

            const detected = bodyCloseBelow && volumeConfirmed && noRejection;
            return {
                detected,
                breakLevel: structureLow,
                description: detected
                    ? `✅ MSS هابط: إغلاق تحت ${structureLow.toFixed(4)} | حجم ${((last.volume / avgVolume) * 100).toFixed(0)}%`
                    : `❌ MSS غير مؤكد (SHORT): جسم:${bodyCloseBelow} | حجم:${volumeConfirmed} | عدم رفض:${noRejection}`
            };
        }
    }

    /**
     * حساب Volume Profile وتحديد POC (Point of Control)
     * POC هو السعر الذي تتركز فيه أعلى نسبة سيولة خلال فترة زمنية.
     */
    static calculateVolumeProfile(ohlcv: OHLCV[], binsCount: number = 30): { poc: number; profile: { price: number; volume: number }[] } {
        if (ohlcv.length === 0) return { poc: 0, profile: [] };
        const highs = ohlcv.map(c => c.high);
        const lows = ohlcv.map(c => c.low);
        const minLow = Math.min(...lows);
        const maxHigh = Math.max(...highs);
        const range = maxHigh - minLow;
        if (range === 0) return { poc: minLow, profile: [] };

        const binSize = range / binsCount;
        const bins = Array.from({ length: binsCount }, (_, i) => {
            const price = minLow + (i + 0.5) * binSize;
            return { price, volume: 0 };
        });

        ohlcv.forEach(c => {
            const lowBin = Math.max(0, Math.floor((c.low - minLow) / binSize));
            const highBin = Math.min(binsCount - 1, Math.floor((c.high - minLow) / binSize));
            const numBins = (highBin - lowBin) + 1;
            const volPerBin = c.volume / numBins;
            for (let i = lowBin; i <= highBin; i++) {
                bins[i].volume += volPerBin;
            }
        });

        let maxVol = -1;
        let poc = minLow;
        bins.forEach(b => {
            if (b.volume > maxVol) {
                maxVol = b.volume;
                poc = b.price;
            }
        });

        return { poc, profile: bins };
    }

    /**
     * حساب شموع الـ Heikin-Ashi لفلترة الضوضاء وتأكيد الاتجاه الحقيقي.
     */
    static calculateHeikinAshi(ohlcv: OHLCV[]): OHLCV[] {
        if (ohlcv.length === 0) return [];
        const haData: OHLCV[] = [];

        const first = ohlcv[0];
        let prevHAOpen = first.open;
        let prevHAClose = (first.open + first.high + first.low + first.close) / 4;
        haData.push({
            timestamp: first.timestamp,
            open: prevHAOpen,
            high: Math.max(first.high, prevHAOpen, prevHAClose),
            low: Math.min(first.low, prevHAOpen, prevHAClose),
            close: prevHAClose,
            volume: first.volume
        });

        for (let i = 1; i < ohlcv.length; i++) {
            const c = ohlcv[i];
            const close = (c.open + c.high + c.low + c.close) / 4;
            const open = (prevHAOpen + prevHAClose) / 2;
            const high = Math.max(c.high, open, close);
            const low = Math.min(c.low, open, close);

            haData.push({
                timestamp: c.timestamp,
                open,
                high,
                low,
                close,
                volume: c.volume
            });

            prevHAOpen = open;
            prevHAClose = close;
        }
        return haData;
    }

    /**
     * حساب مؤشر الـ SuperTrend
     * يجمع بين التقلبات الحادة (ATR) لتحديد نقاط الانعكاس والاتجاه الصاعد/الهابط.
     */
    static calculateSuperTrend(ohlcv: OHLCV[], period: number = 10, multiplier: number = 3): { trend: 'UP' | 'DOWN'; value: number }[] {
        if (ohlcv.length < period) return ohlcv.map(() => ({ trend: 'UP', value: 0 }));

        const highs = ohlcv.map(c => c.high);
        const lows = ohlcv.map(c => c.low);
        const closes = ohlcv.map(c => c.close);

        const atrValues = ATR.calculate({ period, high: highs, low: lows, close: closes });

        const supertrend: { trend: 'UP' | 'DOWN'; value: number }[] = [];
        const offset = ohlcv.length - atrValues.length;
        for (let i = 0; i < offset; i++) {
            supertrend.push({ trend: 'UP', value: closes[i] });
        }

        let prevTrend: 'UP' | 'DOWN' = 'UP';
        let finalUpperBand = closes[offset - 1];
        let finalLowerBand = closes[offset - 1];

        for (let i = 0; i < atrValues.length; i++) {
            const idx = offset + i;
            const candle = ohlcv[idx];
            const prevCandle = ohlcv[idx - 1];
            const atrVal = atrValues[i] || 0;

            const median = (candle.high + candle.low) / 2;
            const basicUpper = median + multiplier * atrVal;
            const basicLower = median - multiplier * atrVal;

            if (basicUpper < finalUpperBand || prevCandle.close > finalUpperBand) {
                finalUpperBand = basicUpper;
            }

            if (basicLower > finalLowerBand || prevCandle.close < finalLowerBand) {
                finalLowerBand = basicLower;
            }

            let currentTrend: 'UP' | 'DOWN' = prevTrend;
            let superTrendVal = 0;

            if (prevTrend === 'UP' && candle.close < finalLowerBand) {
                currentTrend = 'DOWN';
                superTrendVal = finalUpperBand;
            } else if (prevTrend === 'DOWN' && candle.close > finalUpperBand) {
                currentTrend = 'UP';
                superTrendVal = finalLowerBand;
            } else {
                currentTrend = prevTrend;
                superTrendVal = currentTrend === 'UP' ? finalLowerBand : finalUpperBand;
            }

            supertrend.push({ trend: currentTrend, value: superTrendVal });
            prevTrend = currentTrend;
        }

        return supertrend;
    }

    /**
     * حساب متوسط كوفمان التكيفي (KAMA - Kaufman's Adaptive Moving Average)
     * KAMA يتكيف مع التذبذب: يكون بطيئاً في السوق العرضي وسريعاً في السوق الاتجاهي.
     */
    static calculateKAMA(ohlcv: OHLCV[], period: number = 10, fastPeriod: number = 2, slowPeriod: number = 30): number[] {
        const kamaArr: number[] = [];
        if (ohlcv.length < period) {
            return ohlcv.map(c => c.close);
        }

        const closes = ohlcv.map(c => c.close);
        // Initialize KAMA array with closes for values before the period
        for (let i = 0; i < period; i++) {
            kamaArr.push(closes[i]);
        }

        const fastestSC = 2 / (fastPeriod + 1);
        const slowestSC = 2 / (slowPeriod + 1);

        for (let i = period; i < closes.length; i++) {
            // Direction = abs(close[i] - close[i - period])
            const direction = Math.abs(closes[i] - closes[i - period]);
            
            // Volatility = sum of absolute difference of adjacent candles over the period
            let volatility = 0;
            for (let j = i - period + 1; j <= i; j++) {
                volatility += Math.abs(closes[j] - closes[j - 1]);
            }

            // Efficiency Ratio (ER)
            const er = volatility === 0 ? 0 : direction / volatility;

            // Smoothing Constant (SC)
            const sc = Math.pow(er * (fastestSC - slowestSC) + slowestSC, 2);

            // KAMA = KAMA_prev + SC * (Close - KAMA_prev)
            const prevKAMA = kamaArr[i - 1];
            const kamaVal = prevKAMA + sc * (closes[i] - prevKAMA);
            kamaArr.push(kamaVal);
        }

        return kamaArr;
    }

    /**
     * حساب مستويات الفيبوناتشي الذكية للموجة النشطة (Smart Fibonacci Levels)
     * يبحث في القمم والقيعان التاريخية للموجة الأخيرة ويستخرج مستويات الخصم (Discount Zone 0.618 - 0.786).
     */
    static calculateSmartFibonacci(
        ohlcv: OHLCV[],
        direction: 'LONG' | 'SHORT',
        lookback: number = 40
    ): { maxHigh: number; minLow: number; fib618: number; fib786: number; fib500: number; discountTop: number; discountBottom: number } {
        const recent = ohlcv.slice(-lookback);
        const highs = recent.map(c => c.high);
        const lows = recent.map(c => c.low);
        const maxHigh = Math.max(...highs);
        const minLow = Math.min(...lows);
        const diff = maxHigh - minLow;

        let fib618 = 0;
        let fib786 = 0;
        let fib500 = 0;
        let discountTop = 0;
        let discountBottom = 0;

        if (direction === 'LONG') {
            fib500 = maxHigh - (diff * 0.500);
            fib618 = maxHigh - (diff * 0.618);
            fib786 = maxHigh - (diff * 0.786);
            discountTop = fib618;
            discountBottom = fib786;
        } else {
            fib500 = minLow + (diff * 0.500);
            fib618 = minLow + (diff * 0.618);
            fib786 = minLow + (diff * 0.786);
            discountTop = fib786;
            discountBottom = fib618;
        }

        return {
            maxHigh,
            minLow,
            fib500,
            fib618,
            fib786,
            discountTop,
            discountBottom
        };
    }
}
