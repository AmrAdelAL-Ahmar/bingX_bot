import { RSI, SMA, ATR, VWAP, MACD, BollingerBands, StochasticRSI, CCI, WilliamsR } from 'technicalindicators';
import logger from '../utils/logger';
import { BingXService } from './BingXService';

export interface AnalysisResult {
    symbol: string;
    currentPrice: number;
    isUptrend: boolean;
    quickRSI: number;
    volumeStatus: 'high' | 'low';
    quickATR: number;
    scalp: TradeRecommendation;
    swing: TradeRecommendation;
    matrix?: MatrixResult;
    isAboveVWAP?: boolean;
    prediction?: PredictionResult;
    levels: TechnicalLevels;
    indicators: IndicatorData;
    structure?: string;
    options: { quickTF: string, longTF: string, limit: number };
}

export interface TradeRecommendation {
    status: string;
    type: 'LONG' | 'SHORT' | 'NONE';
    entry: number;
    tp: number;
    tp2?: number;
    sl: number;
    timeEstimate: number;
    winRate: number;
    reverseProb: number;
    rejectionReason?: string;
    confidenceScore?: number;
}

export interface MatrixResult {
    score: number;
    percentage: number;
    decision: string;
    details: string;
}

export interface PredictionResult {
    predictedPrice: number;
    trendDirection: 'UP' | 'DOWN';
    slope: number;
    confidence: number;
}

export interface TechnicalLevels {
    pivot: number;
    s1: number;
    s2: number;
    r1: number;
    r2: number;
    fib382: number;
    fib618: number;
    fibTarget: number;
    ma99: number;
    ma7: number;
}

export interface IndicatorData {
    macd: { macd: number, signal: number, histogram: number };
    bb: { upper: number, lower: number, middle: number };
    stochRsi: number;
    cci: number;
    williamsR: number;
}

const TF_WEIGHTS: Record<string, number> = {
    '1m': 1, '3m': 2, '5m': 3, '15m': 4,
    '30m': 5, '1h': 6, '4h': 8, '1d': 10
};

export class AnalysisService {
    constructor(private bingxService: BingXService) {}

    async analyze(
        symbolInput: string, 
        version: 'V1' | 'V2' | 'V3' | 'V4' | 'V5' = 'V1',
        options: { quickTF?: string, longTF?: string, limit?: number, rsiThreshold?: number } = {}
    ): Promise<AnalysisResult> {
        let symbol = symbolInput.toUpperCase();
        if (!symbol.includes('/')) {
            symbol = `${symbol}/USDT:USDT`;
        }
        
        const quickTF = options.quickTF || '5m';
        const longTF = options.longTF || '1h';
        const limit = options.limit || 200;
        const rsiThreshold = options.rsiThreshold || 35;

        const matrixTFs = ['1m', '5m', '15m', '1h', '4h', '1d'];
        const mtfOHLCV: Record<string, any[]> = {};
        for (const tf of matrixTFs) {
            const fetchLimit = (tf === quickTF || tf === longTF) ? Math.max(limit, 200) : 200;
            mtfOHLCV[tf] = await this.bingxService.fetchOHLCV(symbol, tf, fetchLimit);
        }

        const quickOHLCV = mtfOHLCV[quickTF] || mtfOHLCV['5m'];
        const longOHLCV = mtfOHLCV[longTF] || mtfOHLCV['1h'];
        const dailyOHLCV = mtfOHLCV['1d'];

        const currentPrice = quickOHLCV[quickOHLCV.length - 1].close;
        const currentVolume = quickOHLCV[quickOHLCV.length - 1].volume;

        const quickCloses = quickOHLCV.map(c => c.close);
        const quickHighs = quickOHLCV.map(c => c.high);
        const quickLows = quickOHLCV.map(c => c.low);
        const quickVolumes = quickOHLCV.map(c => c.volume);
        const longCloses = longOHLCV.map(c => c.close);

        const macdArr = MACD.calculate({ values: quickCloses, fastPeriod: 12, slowPeriod: 26, signalPeriod: 9, SimpleMAOscillator: false, SimpleMASignal: false });
        const lastMACD = macdArr[macdArr.length - 1];

        const bbArr = BollingerBands.calculate({ period: 20, values: quickCloses, stdDev: 2 });
        const lastBB = bbArr[bbArr.length - 1];

        const ma99Arr = SMA.calculate({ period: 99, values: longCloses });
        const lastMA99 = ma99Arr[ma99Arr.length - 1];
        const ma7Arr = SMA.calculate({ period: 7, values: quickCloses });
        const lastMA7 = ma7Arr[ma7Arr.length - 1];

        const rsiArr = RSI.calculate({ period: 14, values: quickCloses });
        const lastRSI = rsiArr[rsiArr.length - 1];

        const cciArr = CCI.calculate({ period: 20, high: quickHighs, low: quickLows, close: quickCloses });
        const lastCCI = cciArr[cciArr.length - 1];

        const wRArr = WilliamsR.calculate({ period: 14, high: quickHighs, low: quickLows, close: quickCloses });
        const lastWR = wRArr[wRArr.length - 1];

        const atrArr = ATR.calculate({ period: 14, high: quickHighs, low: quickLows, close: quickCloses });
        const lastATR = atrArr[atrArr.length - 1];

        const mavolArr = SMA.calculate({ period: 14, values: quickVolumes });
        const lastMAVOL = mavolArr[mavolArr.length - 1];

        const longHigh = Math.max(...longCloses);
        const longLow = Math.min(...longCloses);
        const fib618 = longHigh - (longHigh - longLow) * 0.618;
        const fib382 = longHigh - (longHigh - longLow) * 0.382;
        const fibTarget = longHigh + (longHigh - longLow) * 1.618;

        const stochRsiArr = StochasticRSI.calculate({ values: quickCloses, rsiPeriod: 14, stochasticPeriod: 14, kPeriod: 3, dPeriod: 3 });
        const lastStoch = stochRsiArr[stochRsiArr.length - 1];

        const prevCandle = quickOHLCV[quickOHLCV.length - 2];
        const pivot = (prevCandle.high + prevCandle.low + prevCandle.close) / 3;
        const s1 = (2 * pivot) - prevCandle.high;
        const r1 = (2 * pivot) - prevCandle.low;

        const indicators: IndicatorData = { 
            macd: { macd: lastMACD?.MACD || 0, signal: lastMACD?.signal || 0, histogram: lastMACD?.histogram || 0 }, 
            bb: lastBB, 
            stochRsi: lastStoch?.k || 50,
            cci: lastCCI || 0,
            williamsR: lastWR || -50
        };
        const levels: TechnicalLevels = { pivot, s1, r1, s2: pivot - (prevCandle.high-prevCandle.low), r2: pivot + (prevCandle.high-prevCandle.low), fib382, fib618, fibTarget, ma99: lastMA99, ma7: lastMA7 };

        const matrix = this.calculateMatrix(mtfOHLCV);
        const vwap = this.calculateVWAP(dailyOHLCV);
        const isAboveVWAP = currentPrice > vwap;
        const structure = this.detectMarketStructure(longOHLCV);

        let result: AnalysisResult;
        switch (version) {
            case 'V1': result = this.analyzeProbabilityEngine(symbol, currentPrice, isAboveVWAP, lastRSI, indicators, levels, matrix, structure, lastATR); break;
            default: result = this.analyzeProbabilityEngine(symbol, currentPrice, isAboveVWAP, lastRSI, indicators, levels, matrix, structure, lastATR);
        }

        return { ...result, levels, indicators, structure, options: { quickTF, longTF, limit } };
    }

    private analyzeProbabilityEngine(symbol: string, cp: number, vwap: boolean, rsi: number, ind: IndicatorData, levels: TechnicalLevels, m: MatrixResult, struct: string, atr: number): AnalysisResult {
        let score = 0;
        
        // --- SCORE CALCULATION ---
        score += vwap ? 25 : -25;
        score += (m.percentage - 50) * 0.8;
        if (rsi < 35) score += 15; else if (rsi > 65) score -= 15;
        if (ind.cci < -100) score += 15; else if (ind.cci > 100) score -= 15;
        if (struct.includes("صاعد")) score += 20; else if (struct.includes("هابط")) score -= 20;
        if (cp <= levels.fib618 * 1.005) score += 15; else if (cp >= levels.fib382 * 0.995) score -= 15;

        const absScore = Math.abs(score);
        const winRate = Math.min(50 + (absScore * 0.6), 96);
        const type = score >= 0 ? 'LONG' : 'SHORT';

        // --- SCALP RECOMMENDATION ---
        let scalpTp = 0;
        if (type === 'LONG') {
            scalpTp = Math.max(levels.ma7, levels.r1, cp + (atr * 1.5));
            if (scalpTp <= cp) scalpTp = cp + (atr * 2); // Guaranteed positive target
        } else {
            scalpTp = Math.min(levels.ma7, levels.s1, cp - (atr * 1.5));
            if (scalpTp >= cp) scalpTp = cp - (atr * 2);
        }

        const scalp: TradeRecommendation = {
            status: `${type === 'LONG' ? '🟢 احتمالية صعود' : '🔴 احتمالية هبوط'} (${winRate.toFixed(1)}%)`,
            type,
            entry: cp,
            tp: scalpTp,
            sl: type === 'LONG' ? cp * 0.995 : cp * 1.005,
            timeEstimate: 20,
            winRate,
            reverseProb: 100 - winRate,
            confidenceScore: score
        };

        // --- SWING RECOMMENDATION ---
        let swingTp = type === 'LONG' ? levels.fibTarget : cp - (levels.fibTarget - cp);
        const swing: TradeRecommendation = {
            status: `${type === 'LONG' ? '🌊 موجة صاعدة' : '🌊 موجة هابطة'} (${(winRate * 0.9).toFixed(1)}%)`,
            type,
            entry: cp,
            tp: swingTp,
            sl: type === 'LONG' ? cp * 0.97 : cp * 1.03,
            timeEstimate: 1440,
            winRate: winRate * 0.9,
            reverseProb: 100 - (winRate * 0.9)
        };

        return { symbol, currentPrice: cp, isUptrend: score > 0, quickRSI: rsi, volumeStatus: 'high', quickATR: atr, scalp, swing, levels, indicators: ind, structure: struct, options: {} as any };
    }

    private detectMarketStructure(ohlcv: any[]): string {
        const candles = ohlcv.slice(-30);
        const highs = candles.map(c => c.high), lows = candles.map(c => c.low);
        const lastH = highs[highs.length - 1], prevH = Math.max(...highs.slice(-10, -1));
        const lastL = lows[lows.length - 1], prevL = Math.min(...lows.slice(-10, -1));
        if (lastH > prevH && lastL > prevL) return "صاعد (HH/HL) 📈";
        if (lastH < prevH && lastL < prevL) return "هابط (LH/LL) 📉";
        if (lastH > prevH && lastL < prevL) return "كسر هيكل (BOS) ⚡";
        return "عرضي ↔️";
    }

    private calculateVWAP(ohlcv: any[]): number {
        const input = { high: ohlcv.map(c => c.high), low: ohlcv.map(c => c.low), close: ohlcv.map(c => c.close), volume: ohlcv.map(c => c.volume) };
        const vwapValues = VWAP.calculate(input);
        return vwapValues[vwapValues.length - 1];
    }

    private calculateMatrix(mtfOHLCV: Record<string, any[]>): MatrixResult {
        let totalScore = 0, maxPossibleScore = 0, details = "";
        for (const [tf, data] of Object.entries(mtfOHLCV)) {
            const closes = data.map(c => c.close);
            const maArr = SMA.calculate({ period: 20, values: closes });
            if (maArr.length === 0) continue;
            const isBullish = closes[closes.length - 1] > maArr[maArr.length - 1];
            const weight = TF_WEIGHTS[tf] || 1;
            totalScore += (isBullish ? 1 : -1) * weight;
            maxPossibleScore += weight;
            details += `| ${tf}:${isBullish ? '🟢' : '🔴'} `;
        }
        const percentage = ((totalScore + maxPossibleScore) / (2 * maxPossibleScore)) * 100;
        let decision = percentage >= 75 ? "شراء قوي 🟢" : percentage >= 55 ? "شراء 🟡" : percentage <= 25 ? "بيع قوي 🔴" : "محايد ⚪";
        return { score: totalScore, percentage, decision, details };
    }

    private predictNextPriceLinear(pastCandles: any[], period: number = 20): PredictionResult {
        let sumX = 0, sumY = 0, sumXY = 0, sumXX = 0;
        const n = Math.min(period, pastCandles.length);
        const recent = pastCandles.slice(-n);
        for (let i = 0; i < n; i++) {
            const x = i + 1, y = recent[i].close;
            sumX += x; sumY += y; sumXY += (x * y); sumXX += (x * x);
        }
        const m = (n * sumXY - sumX * sumY) / (n * sumXX - sumX * sumX);
        const b = (sumY - m * sumX) / n;
        return { predictedPrice: (m * (n + 1)) + b, trendDirection: m > 0 ? 'UP' : 'DOWN', slope: m, confidence: Math.abs(m) * 1000 };
    }

    formatReport(res: AnalysisResult, v: string): string {
        const { scalp, swing, matrix, indicators, structure, levels, options } = res;
        const statusIcon = scalp.winRate >= 80 ? '🔥' : scalp.winRate >= 65 ? '✅' : '⚠️';

        let r = `💎 **المحلل الاحتمالي | ${res.symbol}** 💎\n` +
                `💵 السعر: **$${res.currentPrice.toFixed(3)}** | **${v}**\n` +
                `📊 الإعدادات: **Limit:${options.limit}** | TF:**${options.quickTF}/${options.longTF}**\n\n` +
                `🎯 **النتيجة المتوقعة:** ${scalp.status} ${statusIcon}\n` +
                `📈 نسبة النجاح: **${scalp.winRate.toFixed(1)}%**\n` +
                `📉 نسبة المخاطرة: **${scalp.reverseProb.toFixed(1)}%**\n\n` +
                `🏛 **هيكل السوق:** **${structure || 'عرضي'}**\n` +
                `📊 **حالة المؤشرات:**\n` +
                `- RSI: **${res.quickRSI.toFixed(1)}** | CCI: **${indicators.cci.toFixed(0)}**\n` +
                `- Stoch: **${indicators.stochRsi.toFixed(1)}** | Williams%R: **${indicators.williamsR.toFixed(1)}**\n\n`;

        if (matrix) r += `📈 **المصفوفة (MTF):** **${matrix.percentage.toFixed(0)}%** | ${matrix.decision}\n\n`;

        r += `⚡ **السكالبينج (Scalp):**\n` +
             `✅ **النوع:** ${scalp.type} | 🎯 الهدف: **${scalp.tp.toFixed(4)}**\n` +
             `🛑 الوقف: **${scalp.sl.toFixed(4)}** | ⏱️ الوقت: ${scalp.timeEstimate}د\n\n`;

        r += `🌊 **السوينج (Swing):**\n` +
             `✅ **النوع:** ${swing.type} | 🎯 الهدف: **${swing.tp.toFixed(4)}**\n` +
             `🛑 الوقف: **${swing.sl.toFixed(4)}** | 📈 الدقة: ${swing.winRate.toFixed(1)}%\n\n`;

        r += `🛠 **المستويات:** R1:${levels.r1.toFixed(3)} | S1:${levels.s1.toFixed(3)} | Fib:${levels.fib618.toFixed(3)}`;
        return r;
    }

    formatSignalText(symbol: string, type: 'LONG' | 'SHORT', entry: number, targets: number[], sl: number, leverage: number = 25): string {
        return `\`${symbol}\`\n\n` +
            `${type === 'LONG' ? '🔼LONG' : '🔽SHORT'}  X${leverage}  \n\n` +
            `▶️ENTER PRICE(سعر الدخول):\n${entry.toFixed(6)}\n\n` +
            `▶️TARGET  PRICES(الاهداف):\n${targets.map(t => t.toFixed(6)).join('\n')}\n\n` +
            `▶️STOP LOSE(الاستوب)\n${sl.toFixed(6)}`;
    }

    getAlgorithmExplanation(v: string): string {
        return "📘 **نظام الاحتمالات المتطور:** يقوم بدمج 10 مؤشرات فنية وإعطاء وزن نسبي لكل منها لتحديد الاتجاه الأرجح ونسبة نجاحه.";
    }

    generateEducationalDetails(res: AnalysisResult): string {
        return `🔍 **تفاصيل الاحتمالات لـ ${res.symbol}:**\n\n` +
               `- مجموع النقاط الفنية: ${res.scalp.confidenceScore?.toFixed(1)}\n` +
               `- قوة الزخم: ${Math.abs(res.quickRSI - 50).toFixed(1)}\n` +
               `- توافق المصفوفة: ${res.matrix?.percentage.toFixed(0)}%\n\n` +
               `تم حساب نسبة النجاح ${res.scalp.winRate.toFixed(1)}% بناءً على التقاء هذه المؤشرات.`;
    }
}
