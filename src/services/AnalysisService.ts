import { RSI, SMA, ATR, VWAP, MACD, BollingerBands, StochasticRSI, CCI, WilliamsR, MFI } from 'technicalindicators';
import logger from '../utils/logger';
import { BingXService } from './BingXService';

export interface AnalysisResult {
    symbol: string;
    currentPrice: number;
    isUptrend: boolean;
    matrix?: MatrixResult;
    isAboveVWAP?: boolean;
    prediction?: PredictionResult;
    scalp: TradeRecommendation & AnalysisDetails;
    swing: TradeRecommendation & AnalysisDetails;
    options: { quickTF: string, longTF: string, limit: number };
}

export interface AnalysisDetails {
    indicators: IndicatorData;
    sentiments: IndicatorSentiment[];
    rsi: number;
    atr: number;
    levels: TechnicalLevels;
    structure: string;
    timeframe: string;
}

export interface IndicatorSentiment {
    name: string;
    value: string | number;
    status: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
    description: string;
    timeframe?: string;
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
    ma25: number;
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

        const matrix = this.calculateMatrix(mtfOHLCV);
        const vwap = this.calculateVWAP(dailyOHLCV);

        const scalpData = this.calculateTechnicalData(quickOHLCV, quickTF, currentPrice, vwap, matrix);
        const swingData = this.calculateTechnicalData(mtfOHLCV[longTF], longTF, currentPrice, vwap, matrix);

        // --- ENGINES ROUTING ---
        const scalpRec = this.runEngine(version, symbol, currentPrice, scalpData, matrix, vwap, quickOHLCV);
        const swingRec = this.runEngine(version, symbol, currentPrice, swingData, matrix, vwap, mtfOHLCV[longTF]);

        return { 
            symbol,
            currentPrice,
            isUptrend: scalpData.rsi < 50,
            matrix, 
            isAboveVWAP: currentPrice > vwap, 
            scalp: { ...scalpRec, ...scalpData },
            swing: { ...swingRec, ...swingData },
            options: { quickTF, longTF, limit } 
        };
    }

    private runEngine(version: string, symbol: string, cp: number, data: AnalysisDetails, m: MatrixResult, vwap: number, ohlcv: any[]): TradeRecommendation {
        switch(version) {
            case 'V2': return this.analyzeQuantV2(cp, data, m);
            case 'V3': return this.analyzeMatrixMaster(cp, data, m, vwap);
            case 'V4': return this.analyzeScalpProV4(cp, data, m);
            case 'V5': return this.analyzePredictiveV5(cp, data, ohlcv);
            default: return this.analyzeProbabilityEngine(cp, data, cp > vwap, m);
        }
    }

    private getQuickIndicators(ohlcv: any[]): IndicatorData {
        const closes = ohlcv.map(c => c.close), highs = ohlcv.map(c => c.high), lows = ohlcv.map(c => c.low), volumes = ohlcv.map(c => c.volume);
        const macdArr = MACD.calculate({ values: closes, fastPeriod: 12, slowPeriod: 26, signalPeriod: 9, SimpleMAOscillator: false, SimpleMASignal: false });
        return {
            macd: { macd: macdArr[macdArr.length-1]?.MACD || 0, signal: macdArr[macdArr.length-1]?.signal || 0, histogram: macdArr[macdArr.length-1]?.histogram || 0 },
            bb: BollingerBands.calculate({ period: 20, values: closes, stdDev: 2 }).slice(-1)[0],
            stochRsi: StochasticRSI.calculate({ values: closes, rsiPeriod: 14, stochasticPeriod: 14, kPeriod: 3, dPeriod: 3 }).slice(-1)[0]?.k || 50,
            cci: CCI.calculate({ period: 20, high: highs, low: lows, close: closes }).slice(-1)[0] || 0,
            williamsR: WilliamsR.calculate({ period: 14, high: highs, low: lows, close: closes }).slice(-1)[0] || -50,
            mfi: MFI.calculate({ period: 14, high: highs, low: lows, close: closes, volume: volumes }).slice(-1)[0] || 50
        };
    }

    private calculateTechnicalData(ohlcv: any[], tf: string, cp: number, vwap: number, matrix: MatrixResult): AnalysisDetails {
        const closes = ohlcv.map(c => c.close), highs = ohlcv.map(c => c.high), lows = ohlcv.map(c => c.low), volumes = ohlcv.map(c => c.volume);
        const rsi = RSI.calculate({ period: 14, values: closes }).slice(-1)[0] || 50;
        const atr = ATR.calculate({ period: 14, high: highs, low: lows, close: closes }).slice(-1)[0] || 0;
        const macdArr = MACD.calculate({ values: closes, fastPeriod: 12, slowPeriod: 26, signalPeriod: 9, SimpleMAOscillator: false, SimpleMASignal: false });
        const lastMACD = macdArr[macdArr.length - 1];

        // --- Calculate Levels ---
        const lastCandle = ohlcv[ohlcv.length - 1];
        const prevCandle = ohlcv[ohlcv.length - 2];
        const levels: TechnicalLevels = {
            pivot: (prevCandle.high + prevCandle.low + prevCandle.close) / 3,
            r1: 0, s1: 0, r2: 0, s2: 0, ma7: SMA.calculate({ period: 7, values: closes }).slice(-1)[0], ma25: SMA.calculate({ period: 25, values: closes }).slice(-1)[0], ma99: SMA.calculate({ period: 99, values: closes }).slice(-1)[0],
            fib618: 0, fib382: 0, fibTarget: 0
        };
        levels.r1 = (2 * levels.pivot) - prevCandle.low;
        levels.s1 = (2 * levels.pivot) - prevCandle.high;
        levels.r2 = levels.pivot + (prevCandle.high - prevCandle.low);
        levels.s2 = levels.pivot - (prevCandle.high - prevCandle.low);

        // Fib
        const fibCandles = ohlcv.slice(-50);
        const maxH = Math.max(...fibCandles.map(c => c.high)), minL = Math.min(...fibCandles.map(c => c.low));
        const diff = maxH - minL;
        levels.fib618 = maxH - (diff * 0.382);
        levels.fib382 = maxH - (diff * 0.618);
        levels.fibTarget = maxH + (diff * 0.618);

        const structure = this.detectMarketStructure(ohlcv);

        const indicators: IndicatorData = {
            macd: { macd: lastMACD?.MACD || 0, signal: lastMACD?.signal || 0, histogram: lastMACD?.histogram || 0 },
            bb: BollingerBands.calculate({ period: 20, values: closes, stdDev: 2 }).slice(-1)[0],
            stochRsi: StochasticRSI.calculate({ values: closes, rsiPeriod: 14, stochasticPeriod: 14, kPeriod: 3, dPeriod: 3 }).slice(-1)[0]?.k || 50,
            cci: CCI.calculate({ period: 20, high: highs, low: lows, close: closes }).slice(-1)[0] || 0,
            williamsR: WilliamsR.calculate({ period: 14, high: highs, low: lows, close: closes }).slice(-1)[0] || -50,
            mfi: MFI.calculate({ period: 14, high: highs, low: lows, close: closes, volume: volumes }).slice(-1)[0] || 50
        };

        const sentiments = this.calculateSentiments(cp, indicators, levels, matrix, structure, vwap, tf, tf, rsi);

        return { indicators, sentiments, rsi, atr, levels, structure, timeframe: tf };
    }

    private analyzeQuantV2(cp: number, data: AnalysisDetails, m: MatrixResult): TradeRecommendation {
        const mfi = data.indicators.mfi || 50;
        const type = mfi < 30 ? 'LONG' : mfi > 70 ? 'SHORT' : (m.percentage >= 50 ? 'LONG' : 'SHORT');
        const winRate = Math.min(60 + Math.abs(mfi - 50) * 0.8, 92);
        
        const slDistance = data.atr * 3;
        return {
            status: `📊 V2 QUANT (${type}) - MFI: ${mfi.toFixed(0)}`,
            type, entry: cp, tp: type === 'LONG' ? cp + (slDistance * 1.5) : cp - (slDistance * 1.5), sl: type === 'LONG' ? cp - slDistance : cp + slDistance,
            timeEstimate: data.timeframe.includes('m') ? 60 : 240, winRate, reverseProb: 100 - winRate
        };
    }

    private analyzeScalpProV4(cp: number, data: AnalysisDetails, m: MatrixResult): TradeRecommendation {
        const isLong = cp <= data.indicators.bb.lower || data.indicators.cci < -100;
        const isShort = cp >= data.indicators.bb.upper || data.indicators.cci > 100;
        const type = isLong ? 'LONG' : 'SHORT';
        const winRate = Math.min(65 + (Math.abs(data.indicators.cci)/10), 94);

        const slDistance = data.atr * 2;
        return {
            status: `⚡ V4 SCALP PRO (${type}) - BB/CCI Confluence`,
            type, entry: cp, tp: type === 'LONG' ? data.indicators.bb.middle : data.indicators.bb.middle, sl: type === 'LONG' ? cp - slDistance : cp + slDistance,
            timeEstimate: data.timeframe.includes('m') ? 15 : 60, winRate, reverseProb: 100 - winRate
        };
    }

    private analyzePredictiveV5(cp: number, data: AnalysisDetails, ohlcv: any[]): TradeRecommendation {
        const pred = this.predictNextPriceLinear(ohlcv, 20);
        const type = pred.predictedPrice > cp ? 'LONG' : 'SHORT';
        const winRate = Math.min(70 + (pred.confidence * 0.1), 96);

        return {
            status: `🔮 V5 PREDICTIVE AI - Expected: $${pred.predictedPrice.toFixed(2)}`,
            type, entry: cp, tp: pred.predictedPrice, sl: type === 'LONG' ? cp - (data.atr * 4) : cp + (data.atr * 4),
            timeEstimate: data.timeframe.includes('m') ? 30 : 120, winRate, reverseProb: 100 - winRate
        };
    }

    private analyzeMatrixMaster(cp: number, data: AnalysisDetails, m: MatrixResult, vwapPrice: number): TradeRecommendation {
        const type = m.percentage >= 50 ? 'LONG' : 'SHORT';
        const winRate = Math.min(m.percentage + 10, 98);
        const slDistance = Math.max(data.atr * 3, cp * 0.01);
        return {
            status: `🏛 V3 MATRIX ${type} ${m.decision}`,
            type, entry: cp, tp: type === 'LONG' ? cp + (slDistance * 2) : cp - (slDistance * 2), sl: type === 'LONG' ? cp - slDistance : cp + slDistance,
            timeEstimate: data.timeframe.includes('m') ? 60 : 240, winRate, reverseProb: 100 - winRate, confidenceScore: m.percentage
        };
    }

    private analyzeProbabilityEngine(cp: number, data: AnalysisDetails, vwap: boolean, m: MatrixResult): TradeRecommendation {
        let score = 0;
        score += vwap ? 25 : -25;
        score += (m.percentage - 50) * 0.8;
        if (data.rsi < 35) score += 15; else if (data.rsi > 65) score -= 15;
        const winRate = Math.min(50 + (Math.abs(score) * 0.6), 96);
        const type = score >= 0 ? 'LONG' : 'SHORT';
        const slDistance = data.atr * 2.5;
        return {
            status: `${type === 'LONG' ? '🟢 احتمالية صعود' : '🔴 احتمالية هبوط'} (${winRate.toFixed(1)}%)`,
            type, entry: cp, tp: type === 'LONG' ? Math.max(data.levels.ma7, cp + data.atr * 2) : Math.min(data.levels.ma7, cp - data.atr * 2), sl: type === 'LONG' ? cp - slDistance : cp + slDistance,
            timeEstimate: data.timeframe.includes('m') ? 20 : 90, winRate, reverseProb: 100 - winRate, confidenceScore: score
        };
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
        const { scalp, swing, matrix, options, prediction } = res;
        
        let r = `💎 **المحلل الاحتمالي المزدوج | ${res.symbol}** 💎\n` +
                `💵 السعر الحالي: **$${res.currentPrice.toFixed(4)}** | **${v}**\n` +
                `━━━━━━━━━━━━━━\n\n`;

        // SCALP SECTION
        const sIcon = scalp.winRate >= 80 ? '🔥' : scalp.winRate >= 65 ? '✅' : '⚠️';
        r += `⚡ **[تحليل السكالبينج - ${options.quickTF}]**\n` +
             `• النتيجة: ${scalp.status} ${sIcon}\n` +
             `• التوصية: **${scalp.type}** | Win: **${scalp.winRate.toFixed(0)}%**\n` +
             `• الأهداف: 🎯 **${scalp.tp.toFixed(4)}** | 🛑 **${scalp.sl.toFixed(4)}**\n` +
             `• المؤشرات: RSI:**${scalp.rsi.toFixed(1)}** | هيكل:**${scalp.structure}**\n` +
             `• المستويات: R1:${scalp.levels.r1.toFixed(3)} | S1:${scalp.levels.s1.toFixed(3)}\n\n`;

        // SWING SECTION
        const wIcon = swing.winRate >= 80 ? '🔥' : swing.winRate >= 65 ? '✅' : '⚠️';
        r += `🌊 **[تحليل السوينج - ${options.longTF}]**\n` +
             `• النتيجة: ${swing.status} ${wIcon}\n` +
             `• التوصية: **${swing.type}** | Win: **${swing.winRate.toFixed(0)}%**\n` +
             `• الأهداف: 🎯 **${swing.tp.toFixed(4)}** | 🛑 **${swing.sl.toFixed(4)}**\n` +
             `• المؤشرات: RSI:**${swing.rsi.toFixed(1)}** | هيكل:**${swing.structure}**\n` +
             `• المستويات: R1:${swing.levels.r1.toFixed(3)} | S1:${swing.levels.s1.toFixed(3)}\n\n`;

        if (matrix) r += `📈 **المصفوفة (MTF):** **${matrix.percentage.toFixed(0)}%** | ${matrix.decision}\n${matrix.details}\n\n`;

        if (prediction) r += `🔮 **التوقع الإحصائي:** **$${prediction.predictedPrice.toFixed(2)}** (${prediction.trendDirection})\n`;

        r += `━━━━━━━━━━━━━━\n`;
        r += `💡 *استخدم التقرير التفصيلي لمعرفة مناطق الدخول الدقيقة.*`;
        
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

    private calculateSentiments(cp: number, ind: IndicatorData, l: TechnicalLevels, m: MatrixResult, struct: string, vwap: number, qTF: string, lTF: string, rsi: number): IndicatorSentiment[] {
        const s: IndicatorSentiment[] = [];

        // RSI
        s.push({
            name: 'RSI', value: rsi.toFixed(1),
            status: rsi < 35 ? 'BULLISH' : rsi > 65 ? 'BEARISH' : 'NEUTRAL',
            description: rsi < 35 ? 'تشبع بيعي - ارتداد صاعد محتمل' : rsi > 65 ? 'تشبع شرائي - جني أرباح محتمل' : 'زخم محايد',
            timeframe: qTF
        });

        // MACD
        const macdStatus = ind.macd.histogram > 0 ? 'BULLISH' : 'BEARISH';
        s.push({
            name: 'MACD', value: ind.macd.histogram.toFixed(4),
            status: macdStatus,
            description: macdStatus === 'BULLISH' ? 'زخم صاعد متزايد' : 'ضغط بيعي مستمر',
            timeframe: qTF
        });

        // VWAP
        s.push({
            name: 'VWAP', value: vwap.toFixed(2),
            status: cp > vwap ? 'BULLISH' : 'BEARISH',
            description: cp > vwap ? 'السعر فوق المتوسط المؤسساتي' : 'السعر تحت المتوسط المؤسساتي',
            timeframe: '1d'
        });

        // Matrix
        s.push({
            name: 'Matrix', value: `${m.percentage.toFixed(0)}%`,
            status: m.percentage >= 55 ? 'BULLISH' : m.percentage <= 45 ? 'BEARISH' : 'NEUTRAL',
            description: m.decision,
            timeframe: 'MTF'
        });

        // Structure
        s.push({
            name: 'Structure', value: struct,
            status: struct.includes('صاعد') ? 'BULLISH' : struct.includes('هابط') ? 'BEARISH' : 'NEUTRAL',
            description: 'هيكل السوق العام',
            timeframe: '1h'
        });

        // MFI
        if (ind.mfi !== undefined) {
            s.push({
                name: 'MFI', value: ind.mfi.toFixed(1),
                status: ind.mfi < 25 ? 'BULLISH' : ind.mfi > 75 ? 'BEARISH' : 'NEUTRAL',
                description: ind.mfi < 25 ? 'تدفق سيولة شرائية' : ind.mfi > 75 ? 'خروج سيولة' : 'تدفق مستقر',
                timeframe: qTF
            });
        }

        // Stoch RSI
        s.push({
            name: 'Stoch RSI', value: ind.stochRsi.toFixed(1),
            status: ind.stochRsi < 20 ? 'BULLISH' : ind.stochRsi > 80 ? 'BEARISH' : 'NEUTRAL',
            description: ind.stochRsi < 20 ? 'قاع لحظي - شراء' : ind.stochRsi > 80 ? 'قمة لحظية - بيع' : 'تذبذب عادي',
            timeframe: qTF
        });

        // CCI
        s.push({
            name: 'CCI', value: ind.cci.toFixed(0),
            status: ind.cci > 100 ? 'BULLISH' : ind.cci < -100 ? 'BEARISH' : 'NEUTRAL',
            description: ind.cci > 100 ? 'بداية ترند صاعد' : ind.cci < -100 ? 'بداية ترند هابط' : 'نطاق عرضي',
            timeframe: qTF
        });

        return s;
    }

    generateDetailedReport(res: AnalysisResult, type: 'scalp' | 'swing'): string {
        const data = type === 'scalp' ? res.scalp : res.swing;
        const tf = type === 'scalp' ? res.options.quickTF : res.options.longTF;
        
        let report = `🔍 **التقرير التقني لـ ${res.symbol} (${type === 'scalp' ? 'Scalp ⚡' : 'Swing 🌊'})**\n\n`;
        report += `💵 السعر الحالي: \`$${res.currentPrice.toFixed(4)}\`\n`;
        report += `⚙️ الفريم المحلل: \`${tf}\`\n\n`;

        report += `📊 **تحليل الزخم والمؤشرات:**\n`;
        data.sentiments.forEach(s => {
            if (s.name === 'Structure') return;
            const emoji = s.status === 'BULLISH' ? '🟢' : s.status === 'BEARISH' ? '🔴' : '⚪';
            report += `${emoji} **${s.name}**: \`${s.value}\` | ${s.description}\n`;
        });

        report += `\n🎯 **مستويات الدعم والمقاومة:**\n`;
        report += `🛑 **R2**: \`${data.levels.r2.toFixed(4)}\`\n`;
        report += `🔸 **R1**: \`${data.levels.r1.toFixed(4)}\`\n`;
        report += `📍 **Pivot**: \`${data.levels.pivot.toFixed(4)}\`\n`;
        report += `🔹 **S1**: \`${data.levels.s1.toFixed(4)}\`\n`;
        report += `🛑 **S2**: \`${data.levels.s2.toFixed(4)}\`\n`;

        report += `\n📐 **مستويات فيبوناتشي الاستراتيجية:**\n`;
        report += `🏁 الهدف (Extension): \`${data.levels.fibTarget.toFixed(4)}\`\n`;
        report += `🟡 الذهبي (0.618): \`${data.levels.fib618.toFixed(4)}\`\n`;
        report += `⚪ تصحيح (0.382): \`${data.levels.fib382.toFixed(4)}\`\n`;

        report += `\n🏛 **هيكل السوق:** ${data.structure || 'عرضي ↔️'}\n`;
        report += `📉 *تمت معالجة بيانات فريم ${tf} لتقديم هذه الأرقام.*`;

        return report;
    }

    generateEducationalGuide(res: AnalysisResult, type: 'scalp' | 'swing'): string {
        const data = type === 'scalp' ? res.scalp : res.swing;
        const tf = type === 'scalp' ? res.options.quickTF : res.options.longTF;

        const getIndicatorStatus = (name: string) => {
            const s = data.sentiments?.find(item => item.name === name);
            if (!s) return '⚪ محايد';
            return s.status === 'BULLISH' ? '🟢 إيجابي' : s.status === 'BEARISH' ? '🔴 سلبي' : '⚪ محايد';
        };

        let r = `🎓 **الدليل التعليمي لمؤشرات (${type === 'scalp' ? 'Scalp ⚡' : 'Swing 🌊'})**\n`;
        r += `━━━━━━━━━━━━━━\n`;
        r += `🕒 تحليل فريم: **${tf}**\n\n`;

        r += `🔹 **RSI (قوة الزخم)**\n`;
        r += `• القيمة: \`${data.rsi.toFixed(1)}\` | **${getIndicatorStatus('RSI')}**\n`;
        r += `• 🟢 دخول LONG: إذا كانت القيمة \`< 30\` (تشبع بيعي)\n`;
        r += `• 🔴 دخول SHORT: إذا كانت القيمة \`> 70\` (تشبع شرائي)\n`;
        r += `• ⚪ توقف: إذا كانت القيمة بين \`45 - 55\` (منطقة حيرة)\n\n`;

        r += `🔹 **MACD (قوة الانفجار)**\n`;
        r += `• القيمة: \`${data.indicators.macd.histogram.toFixed(4)}\` | **${getIndicatorStatus('MACD')}**\n`;
        r += `• 🟢 دخول LONG: تقاطع للأعلى وقيمة موجبة \`> 0\`\n`;
        r += `• 🔴 دخول SHORT: تقاطع للأسفل وقيمة سالبة \`< 0\`\n\n`;

        r += `🔹 **Matrix (توافق السوق)**\n`;
        r += `• القيمة: \`${res.matrix ? res.matrix.percentage.toFixed(0) : '0'}%\` | **${res.matrix?.decision || 'محايد'}**\n`;
        r += `• 🟢 دخول LONG: توافق الفريمات بنسبة \`> 55%\`\n`;
        r += `• 🔴 دخول SHORT: توافق الفريمات بنسبة \`< 45%\`\n\n`;

        r += `🔹 **MFI (تدفق السيولة)**\n`;
        r += `• القيمة: \`${data.indicators.mfi?.toFixed(1) || 'N/A'}\` | **${getIndicatorStatus('MFI')}**\n`;
        r += `• 🟢 دخول LONG: عندما يشتري الحيتان (قيمة \`< 20\`)\n`;
        r += `• 🔴 دخول SHORT: عندما يبيع الحيتان (قيمة \`> 80\`)\n\n`;

        r += `🔹 **CCI (قوة الترند)**\n`;
        r += `• القيمة: \`${data.indicators.cci.toFixed(0)}\` | **${getIndicatorStatus('CCI')}**\n`;
        r += `• 🟢 دخول LONG: بداية ترند صاعد قوي \`> 100\`\n`;
        r += `• 🔴 دخول SHORT: بداية ترند هابط قوي \`< -100\`\n\n`;

        r += `🔹 **Stoch RSI (التوقيت الدقيق)**\n`;
        r += `• القيمة: \`${data.indicators.stochRsi.toFixed(1)}\` | **${getIndicatorStatus('Stoch RSI')}**\n`;
        r += `• 🟢 دخول LONG: وصول السعر لقاع لحظي \`< 20\`\n`;
        r += `• 🔴 دخول SHORT: وصول السعر لقمة لحظية \`> 80\`\n\n`;

        r += `🔹 **ATR (المخاطرة)**\n`;
        r += `• الوضع: **${data.atr > (res.currentPrice * 0.015) ? 'تذبذب عالي (خطير) ⚠️' : 'تذبذب مستقر (آمن) ✅'}**\n`;
        r += `• ⚪ توقف: إذا كان التذبذب "مجنوناً" (ATR مرتفع جداً) لتجنب ضرب الستوب لوز.\n\n`;

        r += `━━━━━━━━━━━━━━\n`;
        r += `🏛 **هيكل السوق:** ${data.structure || 'عرضي ↔️'}\n`;
        r += `💡 *نصيحة: دائماً انتظر توافق 3 مؤشرات على الأقل قبل الدخول.*`;

        return r;
    }
}
