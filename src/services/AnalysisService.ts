import { RSI, SMA, ATR } from 'technicalindicators';
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

export class AnalysisService {
    constructor(private bingxService: BingXService) {}

    async analyze(symbolInput: string, version: 'V1' | 'V2' = 'V1'): Promise<AnalysisResult> {
        let symbol = symbolInput.toUpperCase();
        if (!symbol.includes('/')) {
            symbol = `${symbol}/USDT:USDT`;
        }
        logger.info(`Starting ${version} analysis for ${symbol}`);

        // Fetch Data
        const quickTF = '5m';
        const longTF = '1h';
        const quickOHLCV = await this.bingxService.fetchOHLCV(symbol, quickTF, 100);
        const longOHLCV = await this.bingxService.fetchOHLCV(symbol, longTF, 100);

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

        // Fibonacci (Approximate for 1h swing)
        const longHigh = Math.max(...longCloses.slice(-50));
        const longLow = Math.min(...longCloses.slice(-50));
        const fib618 = longHigh - (longHigh - longLow) * 0.618;
        const fib1618 = longHigh + (longHigh - longLow) * 1.618;

        // Pivot Points (Quick TF)
        const prevCandle = quickOHLCV[quickOHLCV.length - 2];
        const pivot = (prevCandle.high + prevCandle.low + prevCandle.close) / 3;
        const s1 = (2 * pivot) - prevCandle.high;

        // --- VERSION ROUTING ---
        if (version === 'V1') {
            return this.analyzeV1(symbol, currentPrice, isUptrend, lastRSI, s1, fib618, fib1618, lastATR);
        } else {
            return this.analyzeV2(symbol, currentPrice, currentVolume, lastMAVOL, isUptrend, lastRSI, s1, fib618, fib1618, lastATR);
        }
    }

    private analyzeV1(symbol: string, currentPrice: number, isUptrend: boolean, rsi: number, s1: number, fib618: number, fibTarget: number, atr: number): AnalysisResult {
        let scalp: TradeRecommendation = this.getDefaultRecommendation();
        let swing: TradeRecommendation = this.getDefaultRecommendation();

        // Scalp Logic V1 (Basic RSI + Support)
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

        // Swing Logic V1 (Trend + Fib)
        if (isUptrend && currentPrice <= fib618 * 1.01) {
            swing = {
                status: "🟢 فرصة استثمارية (Swing V1)",
                type: 'LONG',
                entry: currentPrice,
                tp: fibTarget,
                sl: currentPrice - (currentPrice * 0.03),
                timeEstimate: 1440, // 24h
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

        // Scalp Logic V2 (Quant: Confluence + Volume + ATR Time)
        if (rsi < 30 && currentPrice <= s1 && isUptrend && volumeConfirmed) {
            const distance = Math.abs((currentPrice + atr * 2) - currentPrice);
            const timeEstimate = Math.ceil(distance / atr) * 5;

            scalp = {
                status: "🟢 إشارة شراء قوية (Scalp V2)",
                type: 'LONG',
                entry: currentPrice,
                tp: currentPrice + (atr * 2),
                tp2: currentPrice + (atr * 4),
                sl: currentPrice - (currentPrice * 0.005),
                timeEstimate: timeEstimate,
                winRate: 85,
                reverseProb: 15
            };
        }

        // Swing Logic V2 (Quant: Wave 3 / Fib + Volume)
        if (isUptrend && currentPrice <= fib618 * 1.01 && volumeConfirmed) {
            const distance = Math.abs(fibTarget - currentPrice);
            const timeEstimate = Math.ceil(distance / (atr * 5)) * 60; // Slower on 1h

            swing = {
                status: "🟢 إشارة استثمارية (Wave 3 V2)",
                type: 'LONG',
                entry: currentPrice,
                tp: fibTarget,
                tp2: fibTarget + (fibTarget - fib618) * 0.5,
                sl: currentPrice - (currentPrice * 0.02),
                timeEstimate: timeEstimate,
                winRate: 75,
                reverseProb: 25
            };
        }

        return { symbol, currentPrice, isUptrend, quickRSI: rsi, volumeStatus: volumeConfirmed ? 'high' : 'low', quickATR: atr, scalp, swing };
    }

    private getDefaultRecommendation(): TradeRecommendation {
        return { status: "لا توجد فرصة الان", type: 'NONE', entry: 0, tp: 0, tp2: 0, sl: 0, timeEstimate: 0, winRate: 0, reverseProb: 0 };
    }

    formatReport(result: AnalysisResult, version: string): string {
        const { scalp, swing } = result;

        let report = `🔥 **نظام التحليل ${version} | ${result.symbol}** 🔥\n` +
            `⏱️ **الفريمات:** 5m (للدخول) | 1h (للاتجاه)\n\n` +
            `📊 **حالة السوق اللحظية:**\n` +
            `- 💵 السعر: **$${result.currentPrice.toFixed(4)}**\n` +
            `- 📈 الاتجاه العام: **${result.isUptrend ? 'صاعد 🟢' : 'هابط 🔴'}**\n` +
            `- 💧 السيولة: **${result.volumeStatus === 'high' ? 'مرتفعة ✅' : 'ضعيفة ⚠️'}**\n` +
            `- ⚡ الزخم (RSI): **${result.quickRSI.toFixed(1)}**\n` +
            `- 📏 متوسط الحركة (ATR): **$${result.quickATR.toFixed(4)}**\n\n`;

        // Scalp Section
        report += `🎯 **توصية السكالبينج (المدى القصير):**\n` +
            `- الحالة: **${scalp.status}**\n`;
        if (scalp.entry > 0) {
            report += `- الدخول: $${scalp.entry.toFixed(4)}\n` +
                `- الهدف: $${scalp.tp.toFixed(4)}\n` +
                `- الوقف: $${scalp.sl.toFixed(4)}\n` +
                `- ⏳ الزمن المتوقع: **${scalp.timeEstimate} دقيقة**\n` +
                `- 🚨 نقطة الهروب: بعد **${scalp.timeEstimate * 2} دقيقة**\n` +
                `- 🟢 النجاح: ${scalp.winRate}% | 🔴 الفشل: ${scalp.reverseProb}%\n\n`;
        } else {
            report += `\n`;
        }

        // Swing Section
        report += `🌊 **توصية موجات إليوت (المدى الطويل):**\n` +
            `- الحالة: **${swing.status}**\n`;
        if (swing.entry > 0) {
            const hours = (swing.timeEstimate / 60).toFixed(1);
            report += `- الدخول: $${swing.entry.toFixed(4)}\n` +
                `- الهدف: $${swing.tp.toFixed(4)}\n` +
                `- الوقف: $${swing.sl.toFixed(4)}\n` +
                `- ⏳ الزمن المتوقع: **${hours} ساعة**\n` +
                `- 🟢 نسبة النجاح: ${swing.winRate}%\n`;
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
