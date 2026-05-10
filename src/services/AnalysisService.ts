import { RSI, SMA, ATR, VWAP, MACD, BollingerBands, StochasticRSI, CCI, WilliamsR, MFI } from 'technicalindicators';
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
    mfi?: number;
}

const TF_WEIGHTS: Record<string, number> = {
    '1m': 1, '3m': 2, '5m': 3, '15m': 4,
    '30m': 5, '1h': 8, '4h': 12, '1d': 15
};

export class AnalysisService {
    constructor(private bingxService: BingXService) {}

    async analyze(
        symbolInput: string, 
        version: 'V1' | 'V2' | 'V3' | 'V4' | 'V5' = 'V1',
        options: { quickTF?: string, longTF?: string, limit?: number, rsiThreshold?: number } = {}
    ): Promise<AnalysisResult> {
        let symbol = symbolInput.toUpperCase();
        if (!symbol.includes('/')) symbol = `${symbol}/USDT:USDT`;
        
        const quickTF = options.quickTF || '5m';
        const longTF = options.longTF || '1h';
        const limit = options.limit || 200;

        const matrixTFs = ['1m', '5m', '15m', '30m', '1h', '4h', '1d'];
        const mtfOHLCV: Record<string, any[]> = {};
        for (const tf of matrixTFs) {
            const fetchLimit = (tf === quickTF || tf === longTF) ? Math.max(limit, 200) : 200;
            mtfOHLCV[tf] = await this.bingxService.fetchOHLCV(symbol, tf, fetchLimit);
        }

        const quickOHLCV = mtfOHLCV[quickTF] || mtfOHLCV['5m'];
        const dailyOHLCV = mtfOHLCV['1d'];
        const currentPrice = quickOHLCV[quickOHLCV.length - 1].close;

        const quickCloses = quickOHLCV.map(c => c.close), quickHighs = quickOHLCV.map(c => c.high), quickLows = quickOHLCV.map(c => c.low), quickVolumes = quickOHLCV.map(c => c.volume);
        
        const macdArr = MACD.calculate({ values: quickCloses, fastPeriod: 12, slowPeriod: 26, signalPeriod: 9, SimpleMAOscillator: false, SimpleMASignal: false });
        const lastMACD = macdArr[macdArr.length - 1];
        const ma99Arr = SMA.calculate({ period: 99, values: mtfOHLCV[longTF].map(c => c.close) });
        const ma7Arr = SMA.calculate({ period: 7, values: quickCloses });
        const rsiArr = RSI.calculate({ period: 14, values: quickCloses });
        const atrArr = ATR.calculate({ period: 14, high: quickHighs, low: quickLows, close: quickCloses });
        const cciArr = CCI.calculate({ period: 20, high: quickHighs, low: quickLows, close: quickCloses });
        const wRArr = WilliamsR.calculate({ period: 14, high: quickHighs, low: quickLows, close: quickCloses });
        const mfiArr = MFI.calculate({ period: 14, high: quickHighs, low: quickLows, close: quickCloses, volume: quickVolumes });
        const stochRsiArr = StochasticRSI.calculate({ values: quickCloses, rsiPeriod: 14, stochasticPeriod: 14, kPeriod: 3, dPeriod: 3 });

        const lastATR = atrArr[atrArr.length - 1];
        const indicators: IndicatorData = { 
            macd: { macd: lastMACD?.MACD || 0, signal: lastMACD?.signal || 0, histogram: lastMACD?.histogram || 0 }, 
            bb: BollingerBands.calculate({ period: 20, values: quickCloses, stdDev: 2 }).slice(-1)[0], 
            stochRsi: stochRsiArr.slice(-1)[0]?.k || 50,
            cci: cciArr.slice(-1)[0] || 0,
            williamsR: wRArr.slice(-1)[0] || -50,
            mfi: mfiArr.slice(-1)[0] || 50
        };

        const longCloses = mtfOHLCV[longTF].map(c => c.close);
        const longHigh = Math.max(...longCloses), longLow = Math.min(...longCloses);
        const levels: TechnicalLevels = { 
            pivot: (quickOHLCV[quickOHLCV.length-2].high + quickOHLCV[quickOHLCV.length-2].low + quickOHLCV[quickOHLCV.length-2].close)/3,
            s1: 0, r1: 0, s2: 0, r2: 0,
            fib382: longHigh - (longHigh-longLow)*0.382,
            fib618: longHigh - (longHigh-longLow)*0.618,
            fibTarget: longHigh + (longHigh-longLow)*1.618,
            ma99: ma99Arr.slice(-1)[0],
            ma7: ma7Arr.slice(-1)[0]
        };
        levels.r1 = (2 * levels.pivot) - quickOHLCV[quickOHLCV.length-2].low;
        levels.s1 = (2 * levels.pivot) - quickOHLCV[quickOHLCV.length-2].high;

        const matrix = this.calculateMatrix(mtfOHLCV);
        const vwap = this.calculateVWAP(dailyOHLCV);
        const structure = this.detectMarketStructure(mtfOHLCV['1h']);

        // --- ENGINES ROUTING ---
        let result: AnalysisResult;
        switch(version) {
            case 'V2': result = this.analyzeQuantV2(symbol, currentPrice, indicators, levels, matrix, structure, lastATR); break;
            case 'V3': result = this.analyzeMatrixMaster(symbol, currentPrice, matrix, indicators, levels, structure, lastATR, vwap); break;
            case 'V4': result = this.analyzeScalpProV4(symbol, currentPrice, indicators, levels, matrix, structure, lastATR); break;
            case 'V5': result = this.analyzePredictiveV5(symbol, currentPrice, quickOHLCV, indicators, levels, matrix, structure, lastATR); break;
            default: result = this.analyzeProbabilityEngine(symbol, currentPrice, currentPrice > vwap, rsiArr.slice(-1)[0], indicators, levels, matrix, structure, lastATR);
        }

        return { ...result, levels, indicators, structure, options: { quickTF, longTF, limit } };
    }

    private analyzeQuantV2(symbol: string, cp: number, ind: IndicatorData, l: TechnicalLevels, m: MatrixResult, struct: string, atr: number): AnalysisResult {
        // V2 focuses on Money Flow and Volume
        const mfi = ind.mfi || 50;
        const type = mfi < 30 ? 'LONG' : mfi > 70 ? 'SHORT' : (m.percentage >= 50 ? 'LONG' : 'SHORT');
        const winRate = Math.min(60 + Math.abs(mfi - 50) * 0.8, 92);
        
        const slDistance = atr * 3;
        const scalp: TradeRecommendation = {
            status: `📊 V2 QUANT (${type}) - MFI: ${mfi.toFixed(0)}`,
            type, entry: cp, tp: type === 'LONG' ? cp + (slDistance * 1.5) : cp - (slDistance * 1.5), sl: type === 'LONG' ? cp - slDistance : cp + slDistance,
            timeEstimate: 60, winRate, reverseProb: 100 - winRate
        };
        return { symbol, currentPrice: cp, isUptrend: mfi < 50, quickRSI: 50, volumeStatus: 'high', quickATR: atr, scalp, swing: scalp, levels: l, indicators: ind, structure: struct, options: {} as any };
    }

    private analyzeScalpProV4(symbol: string, cp: number, ind: IndicatorData, l: TechnicalLevels, m: MatrixResult, struct: string, atr: number): AnalysisResult {
        // V4 focuses on Volatility and Momentum
        const isLong = cp <= ind.bb.lower || ind.cci < -100;
        const isShort = cp >= ind.bb.upper || ind.cci > 100;
        const type = isLong ? 'LONG' : 'SHORT';
        const winRate = Math.min(65 + (Math.abs(ind.cci)/10), 94);

        const slDistance = atr * 2;
        const scalp: TradeRecommendation = {
            status: `⚡ V4 SCALP PRO (${type}) - BB/CCI Confluence`,
            type, entry: cp, tp: type === 'LONG' ? ind.bb.middle : ind.bb.middle, sl: type === 'LONG' ? cp - slDistance : cp + slDistance,
            timeEstimate: 15, winRate, reverseProb: 100 - winRate
        };
        return { symbol, currentPrice: cp, isUptrend: ind.cci > 0, quickRSI: 50, volumeStatus: 'high', quickATR: atr, scalp, swing: scalp, levels: l, indicators: ind, structure: struct, options: {} as any };
    }

    private analyzePredictiveV5(symbol: string, cp: number, ohlcv: any[], ind: IndicatorData, l: TechnicalLevels, m: MatrixResult, struct: string, atr: number): AnalysisResult {
        // V5 focuses on Statistical AI Prediction
        const pred = this.predictNextPriceLinear(ohlcv, 20);
        const type = pred.predictedPrice > cp ? 'LONG' : 'SHORT';
        const winRate = Math.min(70 + (pred.confidence * 0.1), 96);

        const scalp: TradeRecommendation = {
            status: `🔮 V5 PREDICTIVE AI - Expected: $${pred.predictedPrice.toFixed(2)}`,
            type, entry: cp, tp: pred.predictedPrice, sl: type === 'LONG' ? cp - (atr * 4) : cp + (atr * 4),
            timeEstimate: 30, winRate, reverseProb: 100 - winRate
        };
        return { symbol, currentPrice: cp, isUptrend: type === 'LONG', quickRSI: 50, volumeStatus: 'high', quickATR: atr, scalp, swing: scalp, levels: l, indicators: ind, structure: struct, options: {} as any, prediction: pred };
    }

    private analyzeMatrixMaster(symbol: string, cp: number, m: MatrixResult, ind: IndicatorData, l: TechnicalLevels, struct: string, atr: number, vwapPrice: number): AnalysisResult {
        const type = m.percentage >= 50 ? 'LONG' : 'SHORT';
        const winRate = Math.min(m.percentage + 10, 98);
        const slDistance = Math.max(atr * 3, cp * 0.01);
        const scalp: TradeRecommendation = {
            status: `🏛 V3 MATRIX ${type} ${m.decision}`,
            type, entry: cp, tp: type === 'LONG' ? cp + (slDistance * 2) : cp - (slDistance * 2), sl: type === 'LONG' ? cp - slDistance : cp + slDistance,
            timeEstimate: 120, winRate, reverseProb: 100 - winRate, confidenceScore: m.percentage
        };
        return { symbol, currentPrice: cp, isUptrend: cp > vwapPrice, quickRSI: 50, volumeStatus: 'high', quickATR: atr, scalp, swing: scalp, levels: l, indicators: ind, structure: struct, options: {} as any };
    }

    private analyzeProbabilityEngine(symbol: string, cp: number, vwap: boolean, rsi: number, ind: IndicatorData, levels: TechnicalLevels, m: MatrixResult, struct: string, atr: number): AnalysisResult {
        let score = 0;
        score += vwap ? 25 : -25;
        score += (m.percentage - 50) * 0.8;
        if (rsi < 35) score += 15; else if (rsi > 65) score -= 15;
        const winRate = Math.min(50 + (Math.abs(score) * 0.6), 96);
        const type = score >= 0 ? 'LONG' : 'SHORT';
        const slDistance = atr * 2.5;
        const scalp: TradeRecommendation = {
            status: `${type === 'LONG' ? '🟢 احتمالية صعود' : '🔴 احتمالية هبوط'} (${winRate.toFixed(1)}%)`,
            type, entry: cp, tp: type === 'LONG' ? Math.max(levels.ma7, cp + atr * 2) : Math.min(levels.ma7, cp - atr * 2), sl: type === 'LONG' ? cp - slDistance : cp + slDistance,
            timeEstimate: 20, winRate, reverseProb: 100 - winRate, confidenceScore: score
        };
        return { symbol, currentPrice: cp, isUptrend: score > 0, quickRSI: rsi, volumeStatus: 'high', quickATR: atr, scalp, swing: scalp, levels, indicators: ind, structure: struct, options: {} as any };
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
        const { scalp, swing, matrix, indicators, structure, levels, options, prediction } = res;
        const statusIcon = scalp.winRate >= 80 ? '🔥' : scalp.winRate >= 65 ? '✅' : '⚠️';

        let r = `💎 **المحلل الاحتمالي | ${res.symbol}** 💎\n` +
                `💵 السعر: **$${res.currentPrice.toFixed(3)}** | **${v}**\n` +
                `📊 الإعدادات: **Limit:${options.limit}** | TF:**${options.quickTF}/${options.longTF}**\n\n` +
                `🎯 **النتيجة المتوقعة:** ${scalp.status} ${statusIcon}\n` +
                `📈 نسبة النجاح: **${scalp.winRate.toFixed(1)}%**\n` +
                `📉 نسبة المخاطرة: **${scalp.reverseProb.toFixed(1)}%**\n\n`;

        if (prediction) r += `🔮 **التوقع الإحصائي:** **$${prediction.predictedPrice.toFixed(2)}** (${prediction.trendDirection})\n\n`;

        r += `🏛 **هيكل السوق:** **${structure || 'عرضي'}**\n` +
             `📊 **حالة المؤشرات:**\n` +
             `- RSI: **${res.quickRSI.toFixed(1)}** | CCI: **${indicators.cci.toFixed(0)}**\n` +
             `- MFI: **${indicators.mfi?.toFixed(1)}** | Williams%R: **${indicators.williamsR.toFixed(1)}**\n\n`;

        if (matrix) r += `📈 **المصفوفة (MTF):** **${matrix.percentage.toFixed(0)}%** | ${matrix.decision}\n${matrix.details}\n\n`;

        r += `⚡ **التوصية اللحظية:**\n` +
             `✅ **النوع:** ${scalp.type} | 🎯 الهدف: **${scalp.tp.toFixed(4)}**\n` +
             `🛑 الوقف: **${scalp.sl.toFixed(4)}** | ⏱️ الوقت: ${scalp.timeEstimate}د\n\n`;

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
        return "📘 **نظام التداول المتعدد الاستراتيجيات:** يضم 5 محركات تحليل مختلفة (كمي، مصفوفي، مضاربي، وتنبؤي) لتغطية كافة ظروف السوق.";
    }

    generateEducationalDetails(res: AnalysisResult): string {
        return `🔍 **تفاصيل الاحتمالات لـ ${res.symbol}:**\n\n` +
               `- قوة الزخم: ${Math.abs(res.quickRSI - 50).toFixed(1)}\n` +
               `- سيولة السوق (MFI): ${res.indicators.mfi?.toFixed(1)}\n` +
               `- توافق المصفوفة: ${res.matrix?.percentage.toFixed(0)}%\n\n` +
               `تم حساب نسبة النجاح ${res.scalp.winRate.toFixed(1)}% بناءً على المحرك المختار.`;
    }
}
