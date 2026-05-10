import { RSI, SMA, ATR, VWAP, BollingerBands, MACD, StochasticRSI } from 'technicalindicators';
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
    indicators: IndicatorState;
}

export interface TradeRecommendation {
    status: string;
    type: 'LONG' | 'SHORT' | 'NONE';
    entry: number;
    tp: number;
    tp2?: number;
    sl: number;
    timeEstimate: number; // in minutes
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
    bb: { upper: number, lower: number, middle: number };
}

export interface IndicatorState {
    macd: { MACD: number, signal: number, histogram: number };
    stochRSI: { stochRSI: number, k: number, d: number };
}

const TF_WEIGHTS: Record<string, number> = {
    '1m': 1, '3m': 2, '5m': 3, '15m': 4, '1h': 6, '4h': 8, '1d': 10
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
        const rsiThreshold = options.rsiThreshold || 30;

        const matrixTFs = ['1m', '3m', '5m', '15m', '1h', '4h', '1d'];
        const mtfOHLCV: Record<string, any[]> = {};
        
        for (const tf of matrixTFs) {
            mtfOHLCV[tf] = await this.bingxService.fetchOHLCV(symbol, tf, Math.max(limit, 200));
        }

        const quickOHLCV = mtfOHLCV[quickTF];
        const longOHLCV = mtfOHLCV[longTF];
        const dailyOHLCV = mtfOHLCV['1d'];

        if (!quickOHLCV || quickOHLCV.length < 50) {
            throw new Error(`بيانات غير كافية لتحليل ${symbol}.`);
        }

        const currentPrice = quickOHLCV[quickOHLCV.length - 1].close;
        const quickCloses = quickOHLCV.map(c => c.close);
        const quickHighs = quickOHLCV.map(c => c.high);
        const quickLows = quickOHLCV.map(c => c.low);
        const longCloses = longOHLCV.map(c => c.close);

        // Indicators
        const ma99Arr = SMA.calculate({ period: 99, values: longCloses });
        const lastMA99 = ma99Arr[ma99Arr.length - 1] || currentPrice;
        
        const rsiArr = RSI.calculate({ period: 14, values: quickCloses });
        const lastRSI = rsiArr[rsiArr.length - 1] || 50;

        const bbArr = BollingerBands.calculate({ period: 20, stdDev: 2, values: quickCloses });
        const lastBB = bbArr[bbArr.length - 1] || { upper: currentPrice, lower: currentPrice, middle: currentPrice };

        const macdArr = MACD.calculate({ fastPeriod: 12, slowPeriod: 26, signalPeriod: 9, values: quickCloses, SimpleMAOscillator: false, SimpleMASignal: false });
        const lastMACD = macdArr[macdArr.length - 1] || { MACD: 0, signal: 0, histogram: 0 };

        const stochArr = StochasticRSI.calculate({ kPeriod: 3, dPeriod: 3, rsiPeriod: 14, stochasticPeriod: 14, values: quickCloses });
        const lastStoch = stochArr[stochArr.length - 1] || { k: 50, d: 50, stochRSI: 50 };

        const atrArr = ATR.calculate({ period: 14, high: quickHighs, low: quickLows, close: quickCloses });
        const lastATR = atrArr[atrArr.length - 1] || 0;

        const ma7Arr = SMA.calculate({ period: 7, values: quickCloses });
        const lastMA7 = ma7Arr[ma7Arr.length - 1] || currentPrice;

        // Levels
        const longHigh = Math.max(...longCloses.slice(-100));
        const longLow = Math.min(...longCloses.slice(-100));
        const fib618 = longHigh - (longHigh - longLow) * 0.618;
        const fib382 = longHigh - (longHigh - longLow) * 0.382;

        const prevCandle = quickOHLCV[quickOHLCV.length - 2];
        const pivot = (prevCandle.high + prevCandle.low + prevCandle.close) / 3;
        const s1 = (2 * pivot) - prevCandle.high;
        const r1 = (2 * pivot) - prevCandle.low;

        const levels: TechnicalLevels = {
            pivot, s1, s2: pivot - (prevCandle.high - prevCandle.low),
            r1, r2: pivot + (prevCandle.high - prevCandle.low),
            fib382, fib618, fibTarget: longHigh + (longHigh - longLow) * 1.618,
            ma99: lastMA99, ma7: lastMA7,
            bb: lastBB
        };

        const vwap = this.calculateVWAP(dailyOHLCV);
        const matrix = this.calculateMatrix(mtfOHLCV);

        const params = { symbol, currentPrice, lastRSI, lastATR, lastMA7, lastMA99, levels, lastBB, lastMACD, lastStoch, vwap, matrix, rsiThreshold, quickOHLCV };
        
        let result: any;
        switch (version) {
            case 'V1': result = this.runV1(params); break;
            case 'V4': result = this.runV4(params); break;
            case 'V5': result = this.runV5(params); break;
            default: result = this.runV1(params);
        }

        return { ...result, levels, indicators: { macd: lastMACD, stochRSI: lastStoch } };
    }

    private runV1(p: any): any {
        let scalp = this.getDefaultRecommendation();
        const isUptrend = p.currentPrice > p.lastMA99;
        if (isUptrend && p.lastRSI < p.rsiThreshold && p.currentPrice <= (p.levels.fib618 * 1.005)) {
            scalp = { status: "🟢 شراء (V1 Gold)", type: 'LONG', entry: p.currentPrice, tp: p.lastMA7, sl: p.currentPrice * 0.995, winRate: 75, timeEstimate: 30, reverseProb: 20 };
        } else {
            scalp.rejectionReason = !isUptrend ? "الاتجاه هابط" : p.lastRSI >= p.rsiThreshold ? "RSI مرتفع" : "السعر بعيد عن الدعم";
        }
        return { ...p, isUptrend, scalp, swing: this.getDefaultRecommendation() };
    }

    private runV4(p: any): any {
        let scalp = this.getDefaultRecommendation();
        const isAboveVWAP = p.currentPrice > p.vwap;
        const matrixBullish = p.matrix.percentage >= 55;
        const matrixBearish = p.matrix.percentage <= 45;

        if (matrixBullish && isAboveVWAP && p.lastRSI < p.rsiThreshold && p.currentPrice <= p.levels.bb.lower) {
            scalp = { status: "🟢 شراء (V4 Matrix)", type: 'LONG', entry: p.currentPrice, tp: p.levels.bb.middle, sl: p.currentPrice * 0.992, winRate: 85, timeEstimate: 20, reverseProb: 15 };
        } else if (matrixBearish && !isAboveVWAP && p.lastRSI > (100 - p.rsiThreshold) && p.currentPrice >= p.levels.bb.upper) {
            scalp = { status: "🔴 بيع (V4 Matrix)", type: 'SHORT', entry: p.currentPrice, tp: p.levels.bb.middle, sl: p.currentPrice * 1.008, winRate: 85, timeEstimate: 20, reverseProb: 15 };
        } else {
            scalp.rejectionReason = "تضارب المؤشرات أو السعر داخل النطاق المتوسط";
        }
        return { ...p, isUptrend: p.currentPrice > p.lastMA99, isAboveVWAP, scalp, swing: this.getDefaultRecommendation() };
    }

    private runV5(p: any): any {
        const v4 = this.runV4(p);
        const prediction = this.predictNextPriceLinear(p.quickOHLCV);
        if (v4.scalp.type !== 'NONE') {
            const agrees = (v4.scalp.type === 'LONG' && prediction.trendDirection === 'UP') || (v4.scalp.type === 'SHORT' && prediction.trendDirection === 'DOWN');
            if (agrees) { v4.scalp.status += " + 🔮 تنبؤ مؤكد"; v4.scalp.winRate = 92; }
            else { v4.scalp.rejectionReason = "تضارب مع التنبؤ الإحصائي"; v4.scalp.type = 'NONE'; }
        }
        return { ...v4, prediction };
    }

    private calculateVWAP(ohlcv: any[]): number {
        const input = { high: ohlcv.map(c => c.high), low: ohlcv.map(c => c.low), close: ohlcv.map(c => c.close), volume: ohlcv.map(c => c.volume) };
        const vwapValues = VWAP.calculate(input);
        return vwapValues[vwapValues.length - 1] || ohlcv[ohlcv.length-1].close;
    }

    private calculateMatrix(mtfOHLCV: Record<string, any[]>): MatrixResult {
        let totalScore = 0, maxPossibleScore = 0, details = "";
        for (const [tf, data] of Object.entries(mtfOHLCV)) {
            if (!data || data.length < 50) continue;
            const lastClose = data[data.length-1].close;
            const maArr = SMA.calculate({ period: 50, values: data.map(c => c.close) });
            const lastMA = maArr[maArr.length-1] || lastClose;
            const weight = TF_WEIGHTS[tf] || 1;
            const isBullish = lastClose > lastMA;
            totalScore += (isBullish ? 1 : -1) * weight;
            maxPossibleScore += weight;
            details += `| ${tf}:${isBullish ? '🟢' : '🔴'} `;
        }
        const percentage = ((totalScore + maxPossibleScore) / (2 * maxPossibleScore)) * 100;
        return { score: totalScore, percentage, decision: percentage > 60 ? "شراء 🟢" : percentage < 40 ? "بيع 🔴" : "حيادي 🟡", details };
    }

    private predictNextPriceLinear(pastCandles: any[]): PredictionResult {
        const n = Math.min(20, pastCandles.length);
        const recent = pastCandles.slice(-n);
        let sumX = 0, sumY = 0, sumXY = 0, sumXX = 0;
        for (let i = 0; i < n; i++) {
            const x = i + 1; const y = recent[i].close;
            sumX += x; sumY += y; sumXY += x * y; sumXX += x * x;
        }
        const m = (n * sumXY - sumX * sumY) / (n * sumXX - sumX * sumX) || 0;
        const b = (sumY - m * sumX) / n || recent[n-1].close;
        return { predictedPrice: m * (n + 1) + b, trendDirection: m > 0 ? 'UP' : 'DOWN', slope: m, confidence: Math.abs(m) * 100 };
    }

    private getDefaultRecommendation(): TradeRecommendation {
        return { status: "لا توجد فرصة الان", type: 'NONE', entry: 0, tp: 0, sl: 0, timeEstimate: 0, winRate: 0, reverseProb: 0 };
    }

    formatReport(result: AnalysisResult, version: string): string {
        const { scalp, swing, matrix, isAboveVWAP, prediction, levels, indicators } = result;
        let report = `💎 **تقرير المحلل المطور | ${result.symbol}** 💎\n` +
            `💵 السعر: **$${result.currentPrice.toFixed(2)}**\n\n`;

        if (matrix) {
            report += `📊 **المصفوفة (7 فريمات):**\n` +
                `${matrix.details} |\n` +
                `🎯 القوة: **${matrix.percentage.toFixed(0)}%** | **${matrix.decision}**\n\n`;
        }

        report += `⚙️ **الحالة الفنية:**\n` +
            `- VWAP: ${isAboveVWAP ? '✅ فوق' : '⚠️ تحت'}\n` +
            `- RSI: ${(result.quickRSI || 0).toFixed(1)} | MACD: ${(indicators?.macd?.histogram || 0) > 0 ? '🟢' : '🔴'}\n\n`;

        report += `🛠 **أهم المستويات:**\n` +
            `- 🔴 مقاومة (BB): $${(levels?.bb?.upper || 0).toFixed(2)}\n` +
            `- 🟢 دعم (BB): $${(levels?.bb?.lower || 0).toFixed(2)}\n\n`;

        report += `⚡ **التحليل اللحظي (Scalp):**\n`;
        if (scalp.type !== 'NONE') {
            report += `✅ **إشارة ${scalp.type}:** ${scalp.status}\n` +
                `> دخول: ${scalp.entry.toFixed(4)} | هدف: ${scalp.tp.toFixed(4)}\n` +
                `> 🎯 الدقة: ${scalp.winRate}% | 🔄 الانعكاس: ${scalp.reverseProb}%\n\n`;
        } else {
            report += `❌ **السبب:** ${scalp.rejectionReason || 'عدم توافق المؤشرات'}\n\n`;
        }

        if (prediction) {
            report += `🔮 **التنبؤ:** **$${prediction.predictedPrice.toFixed(2)}** (${prediction.trendDirection === 'UP' ? '📈' : '📉'})\n`;
        }
        return report;
    }

    getAlgorithmGuide(version: string): string {
        const guides: Record<string, string> = {
            'V1': "📘 **V1:** تعتمد على MA99 و RSI30 و Fib 0.618.",
            'V4': "📘 **V4:** تعتمد على 7 فريمات و Bollinger Bands و VWAP.",
            'V5': "📘 **V5:** تدمج V4 مع التنبؤ الإحصائي Linear Regression."
        };
        return guides[version] || "دليل غير متوفر.";
    }

    getTradeDetails(result: AnalysisResult): string {
        return `🔍 **تفاصيل الحسابات:**\n\n1. الأهداف محسوبة بناءً على Bollinger Bands و MA7.\n2. يتم الرفض عند تضارب الفريمات الكبيرة مع اللحظية.`;
    }

    formatSignalText(symbol: string, type: 'LONG' | 'SHORT', entry: number, targets: number[], sl: number, leverage: number = 25): string {
        return `\`${symbol}\`\n\n${type === 'LONG' ? '🔼LONG' : '🔽SHORT'} X${leverage}\n\n▶️ENTRY PRICE:\n${entry.toFixed(6)}\n\n▶️TARGETS:\n${targets.map(t => t.toFixed(6)).join('\n')}\n\n▶️STOP LOSS:\n${sl.toFixed(6)}`;
    }
}
