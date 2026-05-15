import logger from '../utils/logger';
import { BingXService } from './BingXService';
import { TechnicalAnalyzer, MATRIX_TFS } from './TechnicalAnalyzer';
import { ITradingEngine } from './engines/ITradingEngine';
import { V1Engine } from './engines/V1Engine';
import { V2Engine } from './engines/V2Engine';
import { V3Engine } from './engines/V3Engine';
import { V4Engine } from './engines/V4Engine';
import { V5Engine } from './engines/V5Engine';
import { V6Engine } from './engines/V6Engine';

// --- Types & Interfaces ---

export interface OHLCV {
    timestamp: number;
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
}

export interface CandleData {
    closes: number[];
    highs: number[];
    lows: number[];
    volumes: number[];
    last: OHLCV;
    prev: OHLCV;
    all: OHLCV[];
}

export interface IndicatorData {
    macd: { macd: number, signal: number, histogram: number };
    bb: { upper: number, lower: number, middle: number };
    stochRsi: number;
    cci: number;
    williamsR: number;
    mfi?: number;
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
    ma20: number;
    ma7: number;
    lastSwingHigh: number;
    lastSwingLow: number;
}

export interface IndicatorSentiment {
    name: string;
    value: string | number;
    status: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
    description: string;
    timeframe?: string;
}

export interface AnalysisDetails {
    indicators: IndicatorData;
    sentiments: IndicatorSentiment[];
    rsi: number;
    atr: number;
    levels: TechnicalLevels;
    structure: string;
    timeframe: string;
    isBullishTrend: boolean;
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

export interface AnalysisResult {
    symbol: string;
    currentPrice: number;
    pricePrecision: number;
    isUptrend: boolean;
    matrix: MatrixResult;
    isAboveVWAP: boolean;
    prediction?: PredictionResult;
    scalp: TradeRecommendation & AnalysisDetails;
    swing: TradeRecommendation & AnalysisDetails;
    allTimeframes: Record<string, AnalysisDetails>;
    options: { quickTF: string, longTF: string, limit: number };
    sniper: {
        isStochSynced: boolean;
        isFullBreakout: boolean;
        isAboveGolden: boolean;
    };
}

// --- Engine Registry ---

const ENGINES: Record<string, ITradingEngine> = {
    'V1': new V1Engine(),
    'V2': new V2Engine(),
    'V3': new V3Engine(),
    'V4': new V4Engine(),
    'V5': new V5Engine(),
    'V6': new V6Engine()
};

// --- Report Formatter ---

export class AnalysisFormatter {
    static formatReport(res: AnalysisResult, v: string): string {
        const { scalp, swing, matrix, options, prediction, sniper } = res;

        const p = res.pricePrecision;
        let r = `💎 **المحلل الاحتمالي V7 SNIPER | ${res.symbol}** 💎\n` +
            `💵 السعر الحالي: **$${res.currentPrice.toFixed(p)}** | **${v}**\n` +
            `━━━━━━━━━━━━━━\n`;

        if (sniper.isStochSynced) r += `🔥 **[إشارة قنص ذهبية: قاع مزدوج متزامن]** 🔥\n`;
        if (sniper.isFullBreakout) r += `🚀 **[انفجار سعري وشيك: المصفوفة مكتملة]** 🚀\n`;
        if (sniper.isAboveGolden) r += `✨ **[فوق المستوى الذهبي 0.618]** ✨\n`;
        if (sniper.isStochSynced || sniper.isFullBreakout) r += `━━━━━━━━━━━━━━\n`;

        // SCALP SECTION
        const sIcon = scalp.winRate >= 80 ? '🔥' : scalp.winRate >= 65 ? '✅' : '⚠️';
        r += `⚡ **[تحليل السكالبينج - ${options.quickTF}]**\n` +
            `• النتيجة: ${scalp.status} ${sIcon}\n`;
        if (scalp.rejectionReason) r += `• سبب الرفض: 🛡️ **${scalp.rejectionReason}**\n`;
        r += `• التوصية: **${scalp.type}** | Win: **${scalp.winRate.toFixed(0)}%**\n` +
            `• الأهداف: 🎯 **${scalp.tp.toFixed(p)}** | 🛑 **${scalp.sl.toFixed(p)}**\n` +
            `• المؤشرات: RSI:**${scalp.rsi.toFixed(1)}** | هيكل:**${scalp.structure}**\n` +
            `• المستويات: R1:${scalp.levels.r1.toFixed(p)} | S1:${scalp.levels.s1.toFixed(p)}\n\n`;

        // SWING SECTION
        const wIcon = swing.winRate >= 80 ? '🔥' : swing.winRate >= 65 ? '✅' : '⚠️';
        r += `🌊 **[تحليل السوينج - ${options.longTF}]**\n` +
            `• النتيجة: ${swing.status} ${wIcon}\n`;
        if (swing.rejectionReason) r += `• سبب الرفض: 🛡️ **${swing.rejectionReason}**\n`;
        r += `• التوصية: **${swing.type}** | Win: **${swing.winRate.toFixed(0)}%**\n` +
            `• الأهداف: 🎯 **${swing.tp.toFixed(p)}** | 🛑 **${swing.sl.toFixed(p)}**\n` +
            `• المؤشرات: RSI:**${swing.rsi.toFixed(1)}** | هيكل:**${swing.structure}**\n` +
            `• المستويات: R1:${swing.levels.r1.toFixed(p)} | S1:${swing.levels.s1.toFixed(p)}\n\n`;

        if (matrix) r += `📈 **المصفوفة (MTF):** **${matrix.percentage.toFixed(0)}%** | ${matrix.decision}\n${matrix.details}\n\n`;
        if (prediction) r += `🔮 **التوقع الإحصائي:** **$${prediction.predictedPrice.toFixed(p)}** (${prediction.trendDirection})\n`;

        r += `━━━━━━━━━━━━━━\n`;
        r += `💡 *استخدم التقرير التفصيلي لمعرفة مناطق الدخول الدقيقة.*`;

        return r;
    }

    static formatSignalText(symbol: string, type: 'LONG' | 'SHORT', entry: number, targets: number[], sl: number, leverage: number = 25, pricePrecision: number = 4): string {
        const p = pricePrecision;
        return `\`${symbol}\`\n\n` +
            `${type === 'LONG' ? '🔼LONG' : '🔽SHORT'}  X${leverage}  \n\n` +
            `▶️ENTER PRICE(سعر الدخول):\n${entry.toFixed(p)}\n\n` +
            `▶️TARGET  PRICES(الاهداف):\n${targets.map(t => t.toFixed(p)).join('\n')}\n\n` +
            `▶️STOP LOSE(الاستوب)\n${sl.toFixed(p)}`;
    }

    static generateDetailedReport(res: AnalysisResult, type: 'scalp' | 'swing'): string {
        const data = type === 'scalp' ? res.scalp : res.swing;
        const tf = type === 'scalp' ? res.options.quickTF : res.options.longTF;
        const sentiments = this.calculateSentiments(res.currentPrice, data.indicators, data.levels, res.matrix, data.structure, res.isAboveVWAP, tf, data.rsi);

        let report = `🔍 **التقرير التقني لـ ${res.symbol} (${type === 'scalp' ? 'Scalp ⚡' : 'Swing 🌊'})**\n\n`;
        report += `💵 السعر الحالي: \`$${res.currentPrice.toFixed(res.pricePrecision)}\`\n`;
        report += `⚙️ الفريم المحلل: \`${tf}\`\n\n`;

        report += `📊 **تحليل الزخم والمؤشرات:**\n`;
        sentiments.forEach(s => {
            if (s.name === 'Structure') return;
            const emoji = s.status === 'BULLISH' ? '🟢' : s.status === 'BEARISH' ? '🔴' : '⚪';
            report += `${emoji} **${s.name}**: \`${s.value}\` | ${s.description}\n`;
        });

        const p = res.pricePrecision;
        report += `\n🎯 **مستويات الدعم والمقاومة:**\n`;
        report += `🛑 **R2**: \`${data.levels.r2.toFixed(p)}\`\n`;
        report += `🔸 **R1**: \`${data.levels.r1.toFixed(p)}\`\n`;
        report += `📍 **Pivot**: \`${data.levels.pivot.toFixed(p)}\`\n`;
        report += `🔹 **S1**: \`${data.levels.s1.toFixed(p)}\`\n`;
        report += `🛑 **S2**: \`${data.levels.s2.toFixed(p)}\`\n`;

        report += `\n📐 **مستويات فيبوناتشي الاستراتيجية:**\n`;
        report += `🏁 الهدف (Extension): \`${data.levels.fibTarget.toFixed(p)}\`\n`;
        report += `🟡 الذهبي (0.618): \`${data.levels.fib618.toFixed(p)}\`\n`;
        report += `⚪ تصحيح (0.382): \`${data.levels.fib382.toFixed(p)}\`\n`;

        report += `\n🏛 **هيكل السوق:** ${data.structure || 'عرضي ↔️'}\n`;
        report += `📉 *تمت معالجة بيانات فريم ${tf} لتقديم هذه الأرقام.*`;

        return report;
    }

    static generateEducationalGuide(res: AnalysisResult, type: 'scalp' | 'swing'): string {
        const data = type === 'scalp' ? res.scalp : res.swing;
        const tf = type === 'scalp' ? res.options.quickTF : res.options.longTF;
        const sentiments = this.calculateSentiments(res.currentPrice, data.indicators, data.levels, res.matrix, data.structure, res.isAboveVWAP, tf, data.rsi);

        const getIndicatorStatus = (name: string) => {
            const s = sentiments.find(item => item.name === name);
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
        r += `• القيمة: \`${res.matrix.percentage.toFixed(0)}%\` | **${res.matrix.decision}**\n`;
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

        r += `🔹 **VWAP (خط المؤسسات)**\n`;
        r += `• الحالة: **${res.isAboveVWAP ? '🟢 السعر فوق المتوسط المؤسساتي' : '🔴 السعر تحت المتوسط المؤسساتي'}**\n`;
        r += `• 🟢 دخول LONG: عندما يكون السعر فوق الـ VWAP.\n`;
        r += `• 🔴 دخول SHORT: عندما يكون السعر تحت الـ VWAP.\n\n`;

        r += `🔹 **ATR (المخاطرة)**\n`;
        r += `• الوضع: **${data.atr > (res.currentPrice * 0.015) ? 'تذبذب عالي (خطير) ⚠️' : 'تذبذب مستقر (آمن) ✅'}**\n`;

        r += `━━━━━━━━━━━━━━\n`;
        r += `🏛 **هيكل السوق:** ${data.structure || 'عرضي ↔️'}\n`;
        r += `💡 *نصيحة: دائماً انتظر توافق 3 مؤشرات على الأقل قبل الدخول.*`;

        return r;
    }

    static generateComprehensiveReport(res: AnalysisResult): string {
        const p = res.pricePrecision;
        let r = `🌐 **التقرير الفني الشامل (Multi-Timeframe Analysis)** 🌐\n`;
        r += `━━━━━━━━━━━━━━\n`;
        r += `💵 السعر: **$${res.currentPrice.toFixed(p)}** | العملة: **${res.symbol}**\n\n`;

        const tfs = ['1m', '5m', '15m', '1h', '4h', '1d'];
        let bullishCount = 0;

        tfs.forEach(tf => {
            const data = res.allTimeframes[tf];
            if (!data) return;

            const isBullish = res.currentPrice > data.levels.ma20;
            if (isBullish) bullishCount++;

            const trendEmoji = isBullish ? '🟢' : '🔴';
            const rsiEmoji = data.rsi < 30 ? '🔵 (قاع)' : data.rsi > 70 ? '🟠 (قمة)' : '⚪';

            r += `📊 **فريم [${tf}]**: ${data.structure} | ${trendEmoji}\n`;
            r += `• RSI: \`${data.rsi.toFixed(1)}\`${rsiEmoji} | MFI: \`${data.indicators.mfi?.toFixed(0)}\`\n`;
            r += `• الدعم: \`${data.levels.s1.toFixed(p)}\` | المقاومة: \`${data.levels.r1.toFixed(p)}\`\n`;
            r += `━━━━━━━━━━━━━━\n`;
        });

        r += `\n💡 **خلاصة التوافق (Confluence):**\n`;
        r += `• عدد الفريمات الإيجابية (ترند): **${bullishCount} / ${tfs.length}**\n`;

        let conclusion = "محايد ⚪";
        if (bullishCount >= 5) conclusion = "صعود قوي 🔥 (توافق كامل)";
        else if (bullishCount >= 3) conclusion = "صعود متذبذب ✅";
        else if (bullishCount <= 1) conclusion = "هبوط مستمر 🔴";

        r += `• الاتجاه العام: **${conclusion}**\n`;

        return r;
    }

    private static calculateSentiments(cp: number, ind: IndicatorData, l: TechnicalLevels, m: MatrixResult, struct: string, isAboveVWAP: boolean, qTF: string, rsi: number): IndicatorSentiment[] {
        const s: IndicatorSentiment[] = [];

        s.push({
            name: 'RSI', value: rsi.toFixed(1),
            status: rsi < 35 ? 'BULLISH' : rsi > 65 ? 'BEARISH' : 'NEUTRAL',
            description: rsi < 35 ? 'تشبع بيعي - ارتداد صاعد محتمل' : rsi > 65 ? 'تشبع شرائي - جني أرباح محتمل' : 'زخم محايد',
            timeframe: qTF
        });

        const macdStatus = ind.macd.histogram > 0 ? 'BULLISH' : 'BEARISH';
        s.push({
            name: 'MACD', value: ind.macd.histogram.toFixed(4),
            status: macdStatus,
            description: macdStatus === 'BULLISH' ? 'زخم صاعد متزايد' : 'ضغط بيعي مستمر',
            timeframe: qTF
        });

        s.push({
            name: 'VWAP', value: isAboveVWAP ? 'Above' : 'Below',
            status: isAboveVWAP ? 'BULLISH' : 'BEARISH',
            description: isAboveVWAP ? 'السعر فوق المتوسط المؤسساتي' : 'السعر تحت المتوسط المؤسساتي',
            timeframe: '1d'
        });

        s.push({
            name: 'Matrix', value: `${m.percentage.toFixed(0)}%`,
            status: m.percentage >= 55 ? 'BULLISH' : m.percentage <= 45 ? 'BEARISH' : 'NEUTRAL',
            description: m.decision,
            timeframe: 'MTF'
        });

        s.push({
            name: 'Structure', value: struct,
            status: struct.includes('صاعد') ? 'BULLISH' : struct.includes('هابط') ? 'BEARISH' : 'NEUTRAL',
            description: 'هيكل السوق العام',
            timeframe: '1h'
        });

        if (ind.mfi !== undefined) {
            s.push({
                name: 'MFI', value: ind.mfi.toFixed(1),
                status: ind.mfi < 25 ? 'BULLISH' : ind.mfi > 75 ? 'BEARISH' : 'NEUTRAL',
                description: ind.mfi < 25 ? 'تدفق سيولة شرائية' : ind.mfi > 75 ? 'خروج سيولة' : 'تدفق مستقر',
                timeframe: qTF
            });
        }

        s.push({
            name: 'Stoch RSI', value: ind.stochRsi.toFixed(1),
            status: ind.stochRsi < 20 ? 'BULLISH' : ind.stochRsi > 80 ? 'BEARISH' : 'NEUTRAL',
            description: ind.stochRsi < 20 ? 'قاع لحظي - شراء' : ind.stochRsi > 80 ? 'قمة لحظية - بيع' : 'تذبذب عادي',
            timeframe: qTF
        });

        s.push({
            name: 'CCI', value: ind.cci.toFixed(0),
            status: ind.cci > 100 ? 'BULLISH' : ind.cci < -100 ? 'BEARISH' : 'NEUTRAL',
            description: ind.cci > 100 ? 'بداية ترند صاعد' : ind.cci < -100 ? 'بداية ترند هابط' : 'نطاق عرضي',
            timeframe: qTF
        });

        return s;
    }
}

// --- Main Service ---

export class AnalysisService {
    constructor(private bingxService: BingXService) { }

    async analyze(
        symbolInput: string,
        version: 'V1' | 'V2' | 'V3' | 'V4' | 'V5' | 'V6' = 'V1',
        options: { quickTF?: string, longTF?: string, limit?: number, rsiThreshold?: number } = {}
    ): Promise<AnalysisResult> {
        let symbol = symbolInput.toUpperCase();
        if (!symbol.includes('/')) symbol = `${symbol}/USDT:USDT`;

        const quickTF = options.quickTF || '5m';
        const longTF = options.longTF || '1h';
        const limit = options.limit || 200;

        // Fetch Precision and OHLCV in parallel
        const [pricePrecision, ...fetchResults] = await Promise.all([
            this.bingxService.getPricePrecision(symbol),
            ...MATRIX_TFS.map(async tf => {
                const fetchLimit = (tf === quickTF || tf === longTF) ? Math.max(limit, 200) : 200;
                const ohlcv = await this.bingxService.fetchOHLCV(symbol, tf, fetchLimit);
                return { tf, ohlcv };
            })
        ]);
        const mtfOHLCV: Record<string, OHLCV[]> = {};
        fetchResults.forEach(res => mtfOHLCV[res.tf] = res.ohlcv);

        const quickOHLCV = mtfOHLCV[quickTF] || mtfOHLCV['5m'];
        const dailyOHLCV = mtfOHLCV['1d'];
        const currentPrice = quickOHLCV[quickOHLCV.length - 1].close;

        const vwap = TechnicalAnalyzer.calculateVWAP(dailyOHLCV);

        // Technical Data Calculation
        const allTimeframes: Record<string, AnalysisDetails> = {};
        MATRIX_TFS.forEach(tf => {
            if (mtfOHLCV[tf]) {
                allTimeframes[tf] = TechnicalAnalyzer.calculateTechnicalData(mtfOHLCV[tf], tf, vwap);
            }
        });

        // Engine Execution
        const engine = ENGINES[version] || ENGINES['V1'];
        const result = engine.analyze(currentPrice, vwap, allTimeframes, mtfOHLCV, { quickTF, longTF });

        const scalpData = allTimeframes[quickTF] || allTimeframes['5m'];
        const swingData = allTimeframes[longTF] || allTimeframes['1h'];

        // Sniper Logic (V7)
        const isStochSynced = scalpData.indicators.stochRsi < 25 && swingData.indicators.stochRsi < 25;
        const isFullBreakout = result.matrix.percentage >= 95;
        const isAboveGolden = currentPrice > scalpData.levels.fib618;

        return {
            symbol,
            currentPrice,
            pricePrecision,
            isUptrend: scalpData.rsi < 50,
            matrix: result.matrix,
            isAboveVWAP: currentPrice > vwap,
            scalp: { ...result.scalp, ...scalpData },
            swing: { ...result.swing, ...swingData },
            allTimeframes,
            options: { quickTF, longTF, limit },
            sniper: { isStochSynced, isFullBreakout, isAboveGolden }
        };
    }

    async generateCorrectionReport(res: AnalysisResult): Promise<string> {
        const symbol = res.symbol;
        const tfs = ['5m', '15m', '1h'];

        // Parallel fetching for correction report
        const results = await Promise.all(tfs.map(async tf => {
            const ohlcv = await this.bingxService.fetchOHLCV(symbol, tf, 50);
            const div = TechnicalAnalyzer.detectBearishDivergence(ohlcv);
            const direction = res.scalp.type === 'NONE' ? 'LONG' : res.scalp.type;
            const fib = TechnicalAnalyzer.calculateCorrectionFibLevels(ohlcv, direction);
            return { tf, div, fib, price: ohlcv[ohlcv.length - 1].close };
        }));

        let r = `🔍 **رادار التصحيح المتعدد (MTF Correction) - ${symbol}** 🔍\n`;
        r += `━━━━━━━━━━━━━━\n`;
        r += `💵 السعر الحالي: **$${res.currentPrice.toFixed(4)}**\n\n`;

        results.forEach(item => {
            const divEmoji = item.div.detected ? '⚠️' : '✅';
            r += `📊 **فريم [${item.tf}]**:\n`;
            r += `• الحالة: ${divEmoji} ${item.div.description}\n`;
            r += `• مستوى 0.382: \`$${item.fib.fib382.toFixed(4)}\`\n`;
            r += `• مستوى 0.500: \`$${item.fib.fib500.toFixed(4)}\`\n`;
            r += `• مستوى 0.618: \`$${item.fib.fib618.toFixed(4)}\` 🔥\n`;
            r += `━━━━━━━━━━━━━━\n`;
        });

        r += `⚠️ **توصية الحماية الشاملة:**\n`;
        const detectedCount = results.filter(i => i.div.detected).length;
        const isLong = res.scalp.type !== 'SHORT';

        let warning = '';
        if (detectedCount >= 2) {
            warning = `🚨 **خطر انعكاس مؤكد (Confluence):** تصحيح مرصود على فريمات متعددة. اخرج الآن لحماية محفظتك!`;
        } else if (detectedCount === 1) {
            warning = `🟠 **تحذير: بداية ضعف:** هناك بوادر تصحيح على فريم واحد. ارفع الستوب لوز فوراً.`;
        } else {
            const f5 = results[0].fib;
            if (isLong && res.currentPrice < f5.fib500) {
                warning = `🟠 **تصحيح عميق (5m):** السعر كسر مستوى 0.500. راقب الهدف $${f5.fib618.toFixed(4)}.`;
            } else {
                warning = `🟢 **وضع مستقر:** لا يوجد توافق على التصحيح حالياً. الاتجاه لا يزال يحافظ على قوته.`;
            }
        }

        return r + `${warning}\n━━━━━━━━━━━━━━\n💡 *هذا التقرير يجمع بين التحليل التكتيكي والاستراتيجي.*`;
    }

    isPivotBroken(cp: number, pivot: number, direction: 'LONG' | 'SHORT'): boolean {
        return direction === 'LONG' ? cp < pivot : cp > pivot;
    }

    // Proxy methods for backward compatibility
    formatReport(res: AnalysisResult, v: string): string {
        return AnalysisFormatter.formatReport(res, v);
    }

    formatSignalText(symbol: string, type: 'LONG' | 'SHORT', entry: number, targets: number[], sl: number, leverage: number = 25, pricePrecision: number = 4): string {
        return AnalysisFormatter.formatSignalText(symbol, type, entry, targets, sl, leverage, pricePrecision);
    }

    detectBearishDivergence(ohlcv: OHLCV[]): { detected: boolean, description: string } {
        return TechnicalAnalyzer.detectBearishDivergence(ohlcv);
    }

    calculateCorrectionFibLevels(ohlcv: OHLCV[], direction: 'LONG' | 'SHORT' = 'LONG') {
        return TechnicalAnalyzer.calculateCorrectionFibLevels(ohlcv, direction);
    }

    generateDetailedReport(res: AnalysisResult, type: 'scalp' | 'swing'): string {
        return AnalysisFormatter.generateDetailedReport(res, type);
    }

    generateEducationalGuide(res: AnalysisResult, type: 'scalp' | 'swing'): string {
        return AnalysisFormatter.generateEducationalGuide(res, type);
    }

    generateComprehensiveReport(res: AnalysisResult): string {
        return AnalysisFormatter.generateComprehensiveReport(res);
    }

    getAlgorithmExplanation(v: string): string {
        if (v === 'V6') return "🎯 **V6 Sniper V7:** الإصدار الأقوى. يستخدم جدار حماية زمني لفصل السكالب عن السوينج، مع فلاتر هيكل السوق (Price Action) لمنع الدخول العكسي الخاطئ وربط رادار التصحيح كصمام أمان.";
        return "📘 **نظام التداول المتعدد الاستراتيجيات:** يضم 6 محركات تحليل مختلفة لتغطية كافة ظروف السوق.";
    }
}
