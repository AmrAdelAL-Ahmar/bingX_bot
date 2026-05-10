import { RSI, SMA, ATR, VWAP } from 'technicalindicators';
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

const TF_WEIGHTS: Record<string, number> = {
    '1m': 1, '3m': 1, '5m': 2, '10m': 3, '15m': 4,
    '30m': 5, '1h': 6, '4h': 8, '8h': 9, '1d': 10
};

export class AnalysisService {
    constructor(private bingxService: BingXService) { }

    async analyze(symbolInput: string, version: 'V1' | 'V2' | 'V3' | 'V4' | 'V5' = 'V1'): Promise<AnalysisResult> {
        let symbol = symbolInput.toUpperCase();
        if (!symbol.includes('/')) {
            symbol = `${symbol}/USDT:USDT`;
        }
        logger.info(`Starting ${version} analysis for ${symbol}`);

        // Fetch Data
        const quickTF = '5m';
        const longTF = '1h';
        const allTFs = ['5m', '15m', '1h', '4h', '1d'];

        const mtfOHLCV: Record<string, any[]> = {};
        for (const tf of allTFs) {
            mtfOHLCV[tf] = await this.bingxService.fetchOHLCV(symbol, tf, 500);
        }

        const quickOHLCV = mtfOHLCV[quickTF];
        const longOHLCV = mtfOHLCV[longTF];
        const dailyOHLCV = mtfOHLCV['1d'];

        const currentPrice = quickOHLCV[quickOHLCV.length - 1].close;
        const currentVolume = quickOHLCV[quickOHLCV.length - 1].volume;

        // Calculate Indicators
        const longCloses = longOHLCV.map(c => c.close);
        const quickCloses = quickOHLCV.map(c => c.close);
        const quickHighs = quickOHLCV.map(c => c.high);
        const quickLows = quickOHLCV.map(c => c.low);
        const quickVolumes = quickOHLCV.map(c => c.volume);

        const ma99 = SMA.calculate({ period: 99, values: longCloses });
        const lastMA99 = ma99[ma99.length - 1];
        const isUptrend = currentPrice > lastMA99;

        const rsi = RSI.calculate({ period: 14, values: quickCloses });
        const lastRSI = rsi[rsi.length - 1];

        const atr = ATR.calculate({ period: 14, high: quickHighs, low: quickLows, close: quickCloses });
        const lastATR = atr[atr.length - 1];

        const mavol = SMA.calculate({ period: 14, values: quickVolumes });
        const lastMAVOL = mavol[mavol.length - 1];
        const volumeStatus = currentVolume > lastMAVOL ? 'high' : 'low';

        // Fibonacci
        const longHigh = Math.max(...longCloses.slice(-50));
        const longLow = Math.min(...longCloses.slice(-50));
        const fib618 = longHigh - (longHigh - longLow) * 0.618;
        const fib1618 = longHigh + (longHigh - longLow) * 1.618;
        const fib382 = longHigh - (longHigh - longLow) * 0.382;

        // Pivot Points (Quick TF)
        const prevCandle = quickOHLCV[quickOHLCV.length - 2];
        const pivot = (prevCandle.high + prevCandle.low + prevCandle.close) / 3;
        const s1 = (2 * pivot) - prevCandle.high;
        const r1 = (2 * pivot) - prevCandle.low;

        // VWAP (Daily)
        const vwap = this.calculateVWAP(dailyOHLCV);
        const isAboveVWAP = currentPrice > vwap;

        // Matrix (MTF)
        const matrix = this.calculateMatrix(mtfOHLCV);

        // --- VERSION ROUTING ---
        switch (version) {
            case 'V1':
                return this.analyzeV1(symbol, currentPrice, isUptrend, lastRSI, s1, fib618, fib1618, lastATR);
            case 'V2':
                return this.analyzeV2(symbol, currentPrice, currentVolume, lastMAVOL, isUptrend, lastRSI, s1, fib618, fib1618, lastATR);
            case 'V3':
                return this.analyzeV3(symbol, currentPrice, isAboveVWAP, matrix, lastRSI, s1, fib618, fib1618, lastATR, lastMA99);
            case 'V4':
                return this.analyzeV4(symbol, currentPrice, isAboveVWAP, matrix, lastRSI, s1, r1, fib618, fib1618, fib382, lastATR, lastMA99);
            case 'V5':
                return this.analyzeV5(symbol, currentPrice, quickOHLCV, isAboveVWAP, matrix, lastRSI, s1, r1, fib618, fib1618, lastATR, lastMA99);
            default:
                return this.analyzeV1(symbol, currentPrice, isUptrend, lastRSI, s1, fib618, fib1618, lastATR);
        }
    }

    private calculateVWAP(ohlcv: any[]): number {
        const input = {
            high: ohlcv.map(c => c.high),
            low: ohlcv.map(c => c.low),
            close: ohlcv.map(c => c.close),
            volume: ohlcv.map(c => c.volume),
        };
        const vwapValues = VWAP.calculate(input);
        return vwapValues[vwapValues.length - 1];
    }

    private calculateMatrix(mtfOHLCV: Record<string, any[]>): MatrixResult {
        let totalScore = 0;
        let maxPossibleScore = 0;
        let details = "";

        for (const [tf, data] of Object.entries(mtfOHLCV)) {
            const closes = data.map(c => c.close);
            const ma99Arr = SMA.calculate({ period: 99, values: closes });
            if (ma99Arr.length === 0) continue;

            const lastMA99 = ma99Arr[ma99Arr.length - 1];
            const weight = TF_WEIGHTS[tf] || 1;
            const isBullish = closes[closes.length - 1] > lastMA99;

            totalScore += (isBullish ? 1 : -1) * weight;
            maxPossibleScore += weight;
            details += `| ${tf}: ${isBullish ? 'صاعد 🟢' : 'هابط 🔴'} `;
        }

        const percentage = ((totalScore + maxPossibleScore) / (2 * maxPossibleScore)) * 100;
        let decision = "حيادي 🟡";
        if (percentage >= 80) decision = "شراء قوي جداً 🟢🔥";
        else if (percentage >= 60) decision = "شراء 🟢";
        else if (percentage <= 20) decision = "بيع قوي جداً 🔴🔥";
        else if (percentage <= 40) decision = "بيع 🔴";

        return { score: totalScore, percentage, decision, details };
    }

    private predictNextPriceLinear(pastCandles: any[], period: number = 20): PredictionResult {
        let sumX = 0, sumY = 0, sumXY = 0, sumXX = 0;
        const n = Math.min(period, pastCandles.length);
        const recentCandles = pastCandles.slice(-n);

        for (let i = 0; i < n; i++) {
            const x = i + 1;
            const y = recentCandles[i].close;
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
            confidence: Math.abs(m) * 100 // Simple confidence based on slope magnitude
        };
    }

    private analyzeV1(symbol: string, currentPrice: number, isUptrend: boolean, rsi: number, s1: number, fib618: number, fibTarget: number, atr: number): AnalysisResult {
        let scalp: TradeRecommendation = this.getDefaultRecommendation();
        let swing: TradeRecommendation = this.getDefaultRecommendation();

        if (rsi < 30 && currentPrice <= s1) {
            scalp = {
                status: "🟢 فرصة شراء (Scalp V1)",
                type: 'LONG',
                entry: currentPrice,
                tp: currentPrice + (atr * 2),
                sl: currentPrice - (atr * 1.5),
                timeEstimate: 30,
                winRate: 70,
                reverseProb: 30
            };
        }

        if (isUptrend && currentPrice <= fib618 * 1.01) {
            swing = {
                status: "🟢 فرصة استثمارية (Swing V1)",
                type: 'LONG',
                entry: currentPrice,
                tp: fibTarget,
                sl: currentPrice - (currentPrice * 0.03),
                timeEstimate: 1440,
                winRate: 65,
                reverseProb: 35
            };
        }

        return { symbol, currentPrice, isUptrend, quickRSI: rsi, volumeStatus: 'high', quickATR: atr, scalp, swing };
    }

    private analyzeV2(symbol: string, currentPrice: number, currentVolume: number, mavol: number, isUptrend: boolean, rsi: number, s1: number, fib618: number, fibTarget: number, atr: number): AnalysisResult {
        let scalp: TradeRecommendation = this.getDefaultRecommendation();
        let swing: TradeRecommendation = this.getDefaultRecommendation();
        const volumeConfirmed = currentVolume > mavol;

        if (rsi < 30 && currentPrice <= s1 && isUptrend && volumeConfirmed) {
            scalp = {
                status: "🟢 إشارة شراء قوية (Scalp V2)",
                type: 'LONG',
                entry: currentPrice,
                tp: currentPrice + (atr * 2),
                tp2: currentPrice + (atr * 4),
                sl: currentPrice - (currentPrice * 0.005),
                timeEstimate: 30,
                winRate: 85,
                reverseProb: 15
            };
        }

        if (isUptrend && currentPrice <= fib618 * 1.01 && volumeConfirmed) {
            swing = {
                status: "🟢 إشارة استثمارية (Wave 3 V2)",
                type: 'LONG',
                entry: currentPrice,
                tp: fibTarget,
                tp2: fibTarget + (fibTarget - fib618) * 0.5,
                sl: currentPrice - (currentPrice * 0.02),
                timeEstimate: 1440,
                winRate: 75,
                reverseProb: 25
            };
        }

        return { symbol, currentPrice, isUptrend, quickRSI: rsi, volumeStatus: volumeConfirmed ? 'high' : 'low', quickATR: atr, scalp, swing };
    }

    private analyzeV3(symbol: string, currentPrice: number, isAboveVWAP: boolean, matrix: MatrixResult, rsi: number, s1: number, fib618: number, fibTarget: number, atr: number, ma99: number): AnalysisResult {
        let scalp: TradeRecommendation = this.getDefaultRecommendation();
        let swing: TradeRecommendation = this.getDefaultRecommendation();

        if (rsi < 30 && currentPrice <= s1 && isAboveVWAP) {
            scalp = {
                status: "شراء سريع (Scalp) 🟢",
                type: 'LONG',
                entry: currentPrice,
                tp: currentPrice + (atr * 2),
                tp2: currentPrice + (atr * 4),
                sl: currentPrice * 0.995,
                timeEstimate: 20,
                winRate: matrix.percentage > 60 ? 85 : 50,
                reverseProb: matrix.percentage > 60 ? 15 : 50
            };
        }

        if (currentPrice > ma99 && currentPrice <= (fib618 * 1.02)) {
            swing = {
                status: "شراء استثمارية (Wave 3) 🟢",
                type: 'LONG',
                entry: currentPrice,
                tp: fibTarget,
                tp2: fibTarget + (fibTarget - fib618) * 0.5,
                sl: currentPrice * 0.97,
                timeEstimate: 1440,
                winRate: matrix.percentage >= 80 ? 90 : 70,
                reverseProb: matrix.percentage >= 80 ? 10 : 30
            };
        }

        return { symbol, currentPrice, isUptrend: currentPrice > ma99, quickRSI: rsi, volumeStatus: 'high', quickATR: atr, scalp, swing, matrix, isAboveVWAP };
    }

    private analyzeV4(symbol: string, currentPrice: number, isAboveVWAP: boolean, matrix: MatrixResult, rsi: number, s1: number, r1: number, fib618: number, fibTarget: number, fib382: number, atr: number, ma99: number): AnalysisResult {
        let scalp: TradeRecommendation = this.getDefaultRecommendation();
        let swing: TradeRecommendation = this.getDefaultRecommendation();

        if (matrix.percentage >= 50 && isAboveVWAP && rsi < 30 && currentPrice <= s1) {
            scalp = {
                status: "شراء سريع من القاع (Long) 🟢",
                type: 'LONG',
                entry: currentPrice,
                tp: currentPrice + (atr * 2),
                tp2: currentPrice + (atr * 4),
                sl: currentPrice * 0.995,
                timeEstimate: 20,
                winRate: matrix.percentage > 60 ? 85 : 60,
                reverseProb: 15
            };
        }
        else if (matrix.percentage < 50 && !isAboveVWAP && rsi > 70 && currentPrice >= r1) {
            scalp = {
                status: "بيع سريع من القمة (Short) 🔴",
                type: 'SHORT',
                entry: currentPrice,
                tp: currentPrice - (atr * 2),
                tp2: currentPrice - (atr * 4),
                sl: currentPrice * 1.005,
                timeEstimate: 20,
                winRate: matrix.percentage < 40 ? 85 : 60,
                reverseProb: 15
            };
        }

        if (matrix.percentage >= 60 && currentPrice <= (fib618 * 1.02)) {
            swing = {
                status: "استثمار صاعد (Wave 3 Long) 🟢",
                type: 'LONG',
                entry: currentPrice,
                tp: fibTarget,
                tp2: fibTarget + (fibTarget - fib618) * 0.5,
                sl: currentPrice * 0.97,
                timeEstimate: 1440,
                winRate: 80,
                reverseProb: 20
            };
        }
        else if (matrix.percentage <= 40 && currentPrice >= (fib382 * 0.98)) {
            swing = {
                status: "استثمار هابط (Wave 3 Short) 🔴",
                type: 'SHORT',
                entry: currentPrice,
                tp: currentPrice - (fibTarget - fib618),
                tp2: currentPrice - (fibTarget - fib618) * 1.5,
                sl: currentPrice * 1.03,
                timeEstimate: 1440,
                winRate: 80,
                reverseProb: 20
            };
        }

        return { symbol, currentPrice, isUptrend: currentPrice > ma99, quickRSI: rsi, volumeStatus: 'high', quickATR: atr, scalp, swing, matrix, isAboveVWAP };
    }

    private analyzeV5(symbol: string, currentPrice: number, quickOHLCV: any[], isAboveVWAP: boolean, matrix: MatrixResult, rsi: number, s1: number, r1: number, fib618: number, fibTarget: number, atr: number, ma99: number): AnalysisResult {
        let scalp: TradeRecommendation = this.getDefaultRecommendation();
        let swing: TradeRecommendation = this.getDefaultRecommendation();

        const prediction = this.predictNextPriceLinear(quickOHLCV, 20);
        const priceDiff = prediction.predictedPrice - currentPrice;
        const trendAgreesWithLong = prediction.trendDirection === 'UP' && priceDiff > (currentPrice * 0.001);
        const trendAgreesWithShort = prediction.trendDirection === 'DOWN' && priceDiff < -(currentPrice * 0.001);

        // Enhanced Scalp V5 (Long)
        if (rsi < 35 && trendAgreesWithLong && matrix.percentage >= 50 && isAboveVWAP) {
            scalp = {
                status: "إشارة V5 شراء قوية (الذكاء التنبؤي) 🟢🔮",
                type: 'LONG',
                entry: currentPrice,
                tp: currentPrice + (atr * 3), // Higher target with prediction
                tp2: currentPrice + (atr * 5),
                sl: currentPrice * 0.994,
                timeEstimate: 15,
                winRate: 90,
                reverseProb: 10
            };
        }
        // Enhanced Scalp V5 (Short)
        else if (rsi > 65 && trendAgreesWithShort && matrix.percentage < 50 && !isAboveVWAP) {
            scalp = {
                status: "إشارة V5 بيع قوية (الذكاء التنبؤي) 🔴🔮",
                type: 'SHORT',
                entry: currentPrice,
                tp: currentPrice - (atr * 3),
                tp2: currentPrice - (atr * 5),
                sl: currentPrice * 1.006,
                timeEstimate: 15,
                winRate: 90,
                reverseProb: 10
            };
        }

        // Use V4 swing logic as base for V5
        const v4Result = this.analyzeV4(symbol, currentPrice, isAboveVWAP, matrix, rsi, s1, r1, fib618, fibTarget, fib618, atr, ma99);
        swing = v4Result.swing;

        return { symbol, currentPrice, isUptrend: currentPrice > ma99, quickRSI: rsi, volumeStatus: 'high', quickATR: atr, scalp, swing, matrix, isAboveVWAP, prediction };
    }

    private getDefaultRecommendation(): TradeRecommendation {
        return { status: "لا توجد فرصة الان", type: 'NONE', entry: 0, tp: 0, tp2: 0, sl: 0, timeEstimate: 0, winRate: 0, reverseProb: 0 };
    }

    formatReport(result: AnalysisResult, version: string): string {
        const { scalp, swing, matrix, isAboveVWAP, prediction } = result;

        let report = `💎 **التقرير الكمّي الشامل | ${result.symbol}** 💎\n` +
            `💵 السعر الحالي: **$${result.currentPrice.toFixed(2)}**\n\n`;

        if (prediction) {
            report += `🔮 **تحليل الذكاء التنبؤي (V5):**\n` +
                `- السعر المتوقع (الشمعة القادمة): **$${prediction.predictedPrice.toFixed(2)}**\n` +
                `- اتجاه التنبؤ: **${prediction.trendDirection === 'UP' ? 'صاعد 📈' : 'هابط 📉'}**\n\n`;
        }

        if (isAboveVWAP !== undefined) {
            report += `${isAboveVWAP ? '✅ السعر يتداول فوق VWAP (إيجابي للمؤسسات)' : '⚠️ السعر يتداول تحت VWAP (ضغط بيعي من المؤسسات)'}\n\n`;
        }

        if (matrix) {
            report += `📊 **أولاً: مصفوفة الإطارات الزمنية (The Matrix):**\n` +
                `${matrix.details} |\n` +
                `🎯 **قوة الاتجاه الكلية:** **${matrix.percentage.toFixed(1)}%**\n` +
                `⚖️ **القرار العام:** **${matrix.decision}**\n\n`;
        }

        report += `⚡ **ثانياً: التحليل اللحظي (Scalp):**\n` +
            `- إشارة البوت: **${scalp.status}**\n`;
        if (scalp.entry > 0) {
            report += `  > دخول: $${scalp.entry.toFixed(4)} | هدف: $${scalp.tp.toFixed(4)} | وقف: $${scalp.sl.toFixed(4)}\n` +
                `  > 🎯 دقة متوقعة: ${scalp.winRate}%\n\n`;
        } else {
            report += `\n`;
        }

        report += `🌊 **ثالثاً: التحليل الموجي (Swing):**\n` +
            `- إشارة البوت: **${swing.status}**\n`;
        if (swing.entry > 0) {
            report += `  > دخول: $${swing.entry.toFixed(4)} | هدف: $${swing.tp.toFixed(4)} | وقف: $${swing.sl.toFixed(4)}\n` +
                `  > 🎯 دقة متوقعة: ${swing.winRate}%\n`;
        }

        return report;
    }

    formatSignalText(symbol: string, type: 'LONG' | 'SHORT', entry: number, targets: number[], sl: number, leverage: number = 25): string {
        return `\`${symbol}\`\n\n` +
            `${type === 'LONG' ? '🔼LONG' : '🔽SHORT'}  X${leverage}  \n\n` +
            `▶️ENTER PRICE(سعر الدخول):\n` +
            `${entry.toFixed(6)}\n\n` +
            `▶️TARGET  PRICES(الاهداف):\n` +
            `${targets.map(t => t.toFixed(6)).join('\n')}\n\n` +
            `▶️STOP LOSE(الاستوب)\n` +
            `${sl.toFixed(6)}`;
    }
}
