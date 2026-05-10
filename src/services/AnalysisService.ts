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

        const quickCloses = quickOHLCV.map(c => c.close), quickHighs = quickOHLCV.map(c => c.high), quickLows = quickOHLCV.map(c => c.low);
        
        const macdArr = MACD.calculate({ values: quickCloses, fastPeriod: 12, slowPeriod: 26, signalPeriod: 9, SimpleMAOscillator: false, SimpleMASignal: false });
        const lastMACD = macdArr[macdArr.length - 1];
        const ma99Arr = SMA.calculate({ period: 99, values: mtfOHLCV[longTF].map(c => c.close) });
        const ma7Arr = SMA.calculate({ period: 7, values: quickCloses });
        const rsiArr = RSI.calculate({ period: 14, values: quickCloses });
        const atrArr = ATR.calculate({ period: 14, high: quickHighs, low: quickLows, close: quickCloses });
        const cciArr = CCI.calculate({ period: 20, high: quickHighs, low: quickLows, close: quickCloses });
        const wRArr = WilliamsR.calculate({ period: 14, high: quickHighs, low: quickLows, close: quickCloses });
        const stochRsiArr = StochasticRSI.calculate({ values: quickCloses, rsiPeriod: 14, stochasticPeriod: 14, kPeriod: 3, dPeriod: 3 });

        const lastATR = atrArr[atrArr.length - 1];
        const indicators: IndicatorData = { 
            macd: { macd: lastMACD?.MACD || 0, signal: lastMACD?.signal || 0, histogram: lastMACD?.histogram || 0 }, 
            bb: BollingerBands.calculate({ period: 20, values: quickCloses, stdDev: 2 }).slice(-1)[0], 
            stochRsi: stochRsiArr.slice(-1)[0]?.k || 50,
            cci: cciArr.slice(-1)[0] || 0,
            williamsR: wRArr.slice(-1)[0] || -50
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

        // --- ENGINES ---
        let result: AnalysisResult;
        if (version === 'V3') {
            result = this.analyzeMatrixMaster(symbol, currentPrice, matrix, indicators, levels, structure, lastATR, vwap);
        } else {
            result = this.analyzeProbabilityEngine(symbol, currentPrice, currentPrice > vwap, rsiArr.slice(-1)[0], indicators, levels, matrix, structure, lastATR);
        }

        return { ...result, levels, indicators, structure, options: { quickTF, longTF, limit } };
    }

    private analyzeMatrixMaster(symbol: string, cp: number, m: MatrixResult, ind: IndicatorData, l: TechnicalLevels, struct: string, atr: number, vwapPrice: number): AnalysisResult {
        // V3 focuses on Matrix Confluence (The Big Picture)
        const type = m.percentage >= 50 ? 'LONG' : 'SHORT';
        const winRate = Math.min(m.percentage + 10, 98);
        
        // Dynamic ATR-based Stop Loss (Preventing stop outs)
        const slDistance = Math.max(atr * 3, cp * 0.01); // 3x ATR or 1% minimum
        const sl = type === 'LONG' ? cp - slDistance : cp + slDistance;
        const tp = type === 'LONG' ? cp + (slDistance * 1.5) : cp - (slDistance * 1.5);

        const scalp: TradeRecommendation = {
            status: `🏛 V3 MATRIX ${type} ${m.decision}`,
            type, entry: cp, tp, sl, timeEstimate: 45, winRate, reverseProb: 100 - winRate, confidenceScore: m.percentage
        };

        return { symbol, currentPrice: cp, isUptrend: cp > vwapPrice, quickRSI: 50, volumeStatus: 'high', quickATR: atr, scalp, swing: scalp, levels: l, indicators: ind, structure: struct, options: {} as any };
    }

    private analyzeProbabilityEngine(symbol: string, cp: number, vwap: boolean, rsi: number, ind: IndicatorData, levels: TechnicalLevels, m: MatrixResult, struct: string, atr: number): AnalysisResult {
        let score = 0;
        score += vwap ? 25 : -25;
        score += (m.percentage - 50) * 0.8;
        if (rsi < 35) score += 15; else if (rsi > 65) score -= 15;
        if (ind.cci < -100) score += 15; else if (ind.cci > 100) score -= 15;
        if (struct.includes("صاعد")) score += 20; else if (struct.includes("هابط")) score -= 20;

        const absScore = Math.abs(score);
        const winRate = Math.min(50 + (absScore * 0.6), 96);
        const type = score >= 0 ? 'LONG' : 'SHORT';

        // Dynamic ATR-based Stop Loss
        const slDistance = Math.max(atr * 2.5, cp * 0.008); 
        const sl = type === 'LONG' ? cp - slDistance : cp + slDistance;
        
        let tp = 0;
        if (type === 'LONG') {
            tp = Math.max(levels.ma7, levels.r1, cp + (atr * 2));
            if (tp <= cp) tp = cp + (atr * 3);
        } else {
            tp = Math.min(levels.ma7, levels.s1, cp - (atr * 2));
            if (tp >= cp) tp = cp - (atr * 3);
        }

        const scalp: TradeRecommendation = {
            status: `${type === 'LONG' ? '🟢 احتمالية صعود' : '🔴 احتمالية هبوط'} (${winRate.toFixed(1)}%)`,
            type, entry: cp, tp, sl, timeEstimate: 20, winRate, reverseProb: 100 - winRate, confidenceScore: score
        };

        const swing: TradeRecommendation = {
            status: `${type === 'LONG' ? '🌊 موجة صاعدة' : '🌊 موجة هابطة'}`,
            type, entry: cp, tp: type === 'LONG' ? levels.fibTarget : cp - (levels.fibTarget-cp), sl: type === 'LONG' ? cp * 0.96 : cp * 1.04, timeEstimate: 1440, winRate: winRate * 0.85, reverseProb: 100 - (winRate * 0.85)
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

        if (matrix) r += `📈 **المصفوفة (MTF):** **${matrix.percentage.toFixed(0)}%** | ${matrix.decision}\n${matrix.details}\n\n`;

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
