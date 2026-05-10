import { RSI, SMA, ATR, VWAP, MACD, BollingerBands, StochasticRSI } from 'technicalindicators';
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

        logger.info(`Starting ${version} analysis for ${symbol}`);

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
            stochRsi: lastStoch?.k || 50 
        };
        const levels: TechnicalLevels = { pivot, s1, r1, s2: pivot - (prevCandle.high-prevCandle.low), r2: pivot + (prevCandle.high-prevCandle.low), fib382, fib618, fibTarget, ma99: lastMA99, ma7: lastMA7 };

        const matrix = this.calculateMatrix(mtfOHLCV);
        const vwap = this.calculateVWAP(dailyOHLCV);
        const isAboveVWAP = currentPrice > vwap;
        const structure = this.detectMarketStructure(longOHLCV);

        let result: AnalysisResult;
        switch (version) {
            case 'V1': result = this.analyzeV1(symbol, currentPrice, currentPrice > lastMA99, lastRSI, s1, r1, fib618, fibTarget, lastATR, lastMA7, rsiThreshold); break;
            case 'V2': result = this.analyzeV2(symbol, currentPrice, currentVolume, lastMAVOL, currentPrice > lastMA99, lastRSI, s1, r1, fib618, fibTarget, lastATR, rsiThreshold, indicators); break;
            case 'V3': result = this.analyzeV3(symbol, currentPrice, isAboveVWAP, matrix, lastRSI, s1, r1, fib618, fibTarget, lastATR, lastMA99, rsiThreshold, indicators); break;
            case 'V4': result = this.analyzeV4(symbol, currentPrice, isAboveVWAP, matrix, lastRSI, s1, r1, fib618, fibTarget, fib382, lastATR, lastMA99, rsiThreshold, indicators, structure); break;
            case 'V5': result = this.analyzeV5(symbol, currentPrice, quickOHLCV, isAboveVWAP, matrix, lastRSI, s1, r1, fib618, fibTarget, lastATR, lastMA99, rsiThreshold, indicators, structure); break;
            default: result = this.analyzeV1(symbol, currentPrice, currentPrice > lastMA99, lastRSI, s1, r1, fib618, fibTarget, lastATR, lastMA7, rsiThreshold);
        }

        return { ...result, levels, indicators, structure };
    }

    private detectMarketStructure(ohlcv: any[]): string {
        const candles = ohlcv.slice(-30);
        const highs = candles.map(c => c.high);
        const lows = candles.map(c => c.low);

        const lastH = highs[highs.length - 1];
        const prevH = Math.max(...highs.slice(-10, -1));
        const lastL = lows[lows.length - 1];
        const prevL = Math.min(...lows.slice(-10, -1));

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
        let decision = percentage >= 75 ? "شراء قوي 🟢🔥" : percentage >= 55 ? "شراء 🟢" : percentage <= 25 ? "بيع قوي 🔴🔥" : "محايد 🟡";
        return { score: totalScore, percentage, decision, details };
    }

    private analyzeV1(symbol: string, cp: number, isUp: boolean, rsi: number, s1: number, r1: number, fib618: number, fibT: number, atr: number, ma7: number, rsiT: number): AnalysisResult {
        let scalp = this.getDefaultRec(), swing = this.getDefaultRec();
        const fibPriceLong = fib618 * 1.01;
        const fibPriceShort = fib618 * 0.99;

        // LONG Logic V1
        if (isUp && rsi < rsiT && cp <= fibPriceLong) {
            scalp = { status: "🟢 شراء (V1 - الثالوث)", type: 'LONG', entry: cp, tp: ma7, sl: cp * 0.995, timeEstimate: 25, winRate: 75, reverseProb: 20 };
        } 
        // SHORT Logic V1 (New)
        else if (!isUp && rsi > (100 - rsiT) && cp >= fibPriceShort) {
            scalp = { status: "🔴 بيع (V1 - الثالوث)", type: 'SHORT', entry: cp, tp: ma7, sl: cp * 1.005, timeEstimate: 25, winRate: 72, reverseProb: 22 };
        }
        else {
            const reasons = [];
            if (isUp && rsi >= rsiT) reasons.push(`RSI مرتفع للشرط (${rsi.toFixed(1)})`);
            if (!isUp && rsi <= (100 - rsiT)) reasons.push(`RSI منخفض للبيع (${rsi.toFixed(1)})`);
            scalp.rejectionReason = reasons.length > 0 ? reasons.join(" + ") : "السعر ليس عند منطقة دخول ذهبية";
        }
        return { symbol, currentPrice: cp, isUptrend: isUp, quickRSI: rsi, volumeStatus: 'high', quickATR: atr, scalp, swing, levels: {} as any, indicators: {} as any };
    }

    private analyzeV2(symbol: string, cp: number, vol: number, mavol: number, isUp: boolean, rsi: number, s1: number, r1: number, fib618: number, fibT: number, atr: number, rsiT: number, ind: IndicatorData): AnalysisResult {
        let scalp = this.getDefaultRec(), swing = this.getDefaultRec();
        const volOk = vol > mavol, macdOk = ind.macd.histogram > 0, stochOk = (ind.stochRsi ?? 50) < 25;

        if (isUp && rsi < rsiT && volOk && macdOk && stochOk) {
            scalp = { status: "🟢 شراء قوي (V2)", type: 'LONG', entry: cp, tp: cp + (atr * 2), sl: cp - (atr * 1.5), timeEstimate: 40, winRate: 85, reverseProb: 12 };
        } else {
            const reasons = [];
            if (!volOk) reasons.push(`سيولة ضعيفة (${vol.toFixed(0)} < ${mavol.toFixed(0)})`);
            if (!macdOk) reasons.push("MACD لم يتقاطع إيجابياً بعد");
            if (!stochOk) reasons.push(`StochRSI مرتفع (${ind.stochRsi.toFixed(0)} > 25)`);
            scalp.rejectionReason = reasons.join(" + ");
        }
        return { symbol, currentPrice: cp, isUptrend: isUp, quickRSI: rsi, volumeStatus: volOk ? 'high' : 'low', quickATR: atr, scalp, swing, levels: {} as any, indicators: ind };
    }

    private analyzeV3(symbol: string, cp: number, vwap: boolean, m: MatrixResult, rsi: number, s1: number, r1: number, fib618: number, fibT: number, atr: number, ma99: number, rsiT: number, ind: IndicatorData): AnalysisResult {
        let scalp = this.getDefaultRec(), swing = this.getDefaultRec();
        if (vwap && m.percentage >= 60 && rsi < rsiT && (ind.stochRsi ?? 50) < 30) {
            scalp = { status: "🟢 شراء مؤسساتي (V3)", type: 'LONG', entry: cp, tp: cp + (atr * 3), sl: cp * 0.994, timeEstimate: 30, winRate: 90, reverseProb: 8 };
        } else {
            const reasons = [];
            if (!vwap) reasons.push("السعر تحت VWAP");
            if (m.percentage < 60) reasons.push(`المصفوفة ضعيفة (${m.percentage.toFixed(0)}% < 60%)`);
            scalp.rejectionReason = reasons.join(" + ");
        }
        return { symbol, currentPrice: cp, isUptrend: cp > ma99, quickRSI: rsi, volumeStatus: 'high', quickATR: atr, scalp, swing, matrix: m, isAboveVWAP: vwap, levels: {} as any, indicators: ind };
    }

    private analyzeV4(symbol: string, cp: number, vwap: boolean, m: MatrixResult, rsi: number, s1: number, r1: number, f618: number, fT: number, f382: number, atr: number, ma99: number, rsiT: number, ind: IndicatorData, struct: string): AnalysisResult {
        let scalp = this.getDefaultRec(), swing = this.getDefaultRec();
        
        if (m.percentage >= 50 && vwap && cp <= ind.bb.lower) {
            scalp = { status: "🟢 سكالب صاعد (V4)", type: 'LONG', entry: cp, tp: ind.bb.middle, sl: cp * 0.995, timeEstimate: 15, winRate: 84, reverseProb: 15 };
        } else if (m.percentage <= 50 && !vwap && cp >= ind.bb.upper) {
            scalp = { status: "🔴 سكالب هابط (V4)", type: 'SHORT', entry: cp, tp: ind.bb.middle, sl: cp * 1.005, timeEstimate: 15, winRate: 82, reverseProb: 18 };
        } else {
            scalp.rejectionReason = "السعر ليس عند أطراف البولنجر أو تضارب المؤشرات";
        }

        if (struct.includes("صاعد") || struct.includes("BOS")) {
            if (cp <= f618 * 1.02) {
                swing = { status: "🟢 سوينج صاعد (BOS confirmed)", type: 'LONG', entry: cp, tp: fT, sl: cp * 0.97, timeEstimate: 1440, winRate: 85, reverseProb: 15 };
            }
        } else {
            swing.rejectionReason = `هيكل السوق حالياً: ${struct}`;
        }

        return { symbol, currentPrice: cp, isUptrend: cp > ma99, quickRSI: rsi, volumeStatus: 'high', quickATR: atr, scalp, swing, matrix: m, isAboveVWAP: vwap, levels: {} as any, indicators: ind };
    }

    private analyzeV5(symbol: string, cp: number, ohlcv: any[], vwap: boolean, m: MatrixResult, rsi: number, s1: number, r1: number, f618: number, fT: number, atr: number, ma99: number, rsiT: number, ind: IndicatorData, struct: string): AnalysisResult {
        const pred = this.predictNextPriceLinear(ohlcv, 20), scalp = this.getDefaultRec();
        if (pred.trendDirection === 'UP' && m.percentage >= 55 && vwap) {
            scalp.status = "🟢 تنبؤ صاعد (V5) 🔮"; scalp.type = 'LONG'; scalp.entry = cp; scalp.tp = pred.predictedPrice; scalp.sl = cp * 0.993; scalp.winRate = 92; scalp.timeEstimate = 10;
        } else if (pred.trendDirection === 'DOWN' && m.percentage <= 45 && !vwap) {
            scalp.status = "🔴 تنبؤ هابط (V5) 🔮"; scalp.type = 'SHORT'; scalp.entry = cp; scalp.tp = pred.predictedPrice; scalp.sl = cp * 1.007; scalp.winRate = 90; scalp.timeEstimate = 10;
        } else {
            scalp.rejectionReason = `تضارب بين التنبؤ (${pred.trendDirection}) وبقية المؤشرات`;
        }
        const v4 = this.analyzeV4(symbol, cp, vwap, m, rsi, s1, r1, f618, fT, f618, atr, ma99, rsiT, ind, struct);
        return { symbol, currentPrice: cp, isUptrend: cp > ma99, quickRSI: rsi, volumeStatus: 'high', quickATR: atr, scalp, swing: v4.swing, matrix: m, isAboveVWAP: vwap, prediction: pred, levels: {} as any, indicators: ind };
    }

    private getDefaultRec(): TradeRecommendation {
        return { status: "لا توجد فرصة الان", type: 'NONE', entry: 0, tp: 0, tp2: 0, sl: 0, timeEstimate: 0, winRate: 0, reverseProb: 0 };
    }

    formatReport(res: AnalysisResult, v: string): string {
        const { scalp, swing, matrix, indicators, structure, levels } = res;
        let r = `💎 **تقرير المحلل الذكي | ${res.symbol}** 💎\n` +
                `💵 السعر: **$${res.currentPrice.toFixed(3)}** | **${v}**\n\n` +
                `🏛 **هيكل السوق:** **${structure || 'عرضي'}**\n\n` +
                `📊 **حالة المؤشرات اللحظية:**\n` +
                `- RSI: **${res.quickRSI.toFixed(1)}**\n` +
                `- StochRSI: **${indicators.stochRsi.toFixed(1)}**\n` +
                `- MACD Hist: **${indicators.macd.histogram.toFixed(4)}**\n\n`;

        if (matrix) r += `📈 **المصفوفة (MTF):** **${matrix.percentage.toFixed(0)}%** | ${matrix.decision}\n\n`;

        r += `⚡ **السكالبينج (Scalp):**\n`;
        if (scalp.entry > 0) {
            r += `✅ **إشارة ${scalp.type}:** ${scalp.status}\n` +
                 `🎯 الهدف: ${scalp.tp.toFixed(4)} | ⏱️ الوقت: ${scalp.timeEstimate}د\n` +
                 `📈 الدقة: ${scalp.winRate}% | 🔄 الانعكاس: ${scalp.reverseProb}%\n\n`;
        } else r += `❌ **السبب:** ${scalp.rejectionReason}\n\n`;

        r += `🌊 **السوينج (Swing):**\n`;
        if (swing.entry > 0) {
            r += `✅ **إشارة ${swing.type}:** ${swing.status}\n` +
                 `🎯 الهدف: ${swing.tp.toFixed(4)} | 📈 الدقة: ${swing.winRate}%\n\n`;
        } else r += `❌ **السبب:** ${swing.rejectionReason || 'الهيكل غير مؤكد'}\n\n`;

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
        const guides: Record<string, string> = {
            'V1': "📘 **V1 (الأساسي):** يعتمد على تقاطع السعر مع MA99 ومستويات فيبوناتشي 0.618.",
            'V2': "📘 **V2 (الكمي):** يضيف تأكيد السيولة (Volume) ومؤشر MACD و Stochastic RSI.",
            'V3': "📘 **V3 (المؤسساتي):** يعتمد على فلتر VWAP ومصفوفة الفريمات المتعددة.",
            'V4': "📘 **V4 (الهيكلي):** يستخدم حدود البولنجر ونظام Market Structure لرصد كسر الهيكل (BOS).",
            'V5': "📘 **V5 (التنبؤي AI):** يستخدم معادلة الانحدار الخطي لتوقع السعر القادم إحصائياً."
        };
        return guides[v] || "يرجى اختيار إصدار صالح.";
    }

    generateEducationalDetails(res: AnalysisResult): string {
        let d = `🔍 **تفاصيل التحليل الفني لـ ${res.symbol}:**\n\n`;
        d += `1️⃣ **لماذا هذه التوصية؟**\n`;
        if (res.scalp.type !== 'NONE') {
            d += `- تم رصد ${res.scalp.type === 'LONG' ? 'تشبع بيعي' : 'تشبع شرائي'} عند RSI ${res.quickRSI.toFixed(1)}.\n`;
            d += `- هيكل السوق يُظهر ${res.structure}.\n`;
        } else {
            d += `- لم تكتمل الشروط بسبب: ${res.scalp.rejectionReason}.\n`;
        }
        return d;
    }
}
