import { AnalysisDetails, OHLCV } from '../../shared/types';
import { TechnicalAnalyzer } from '../../analysis/TechnicalAnalyzer';
import { ISniperEngine, SniperReport } from '../ISniperEngine';

export class V1SniperEngine implements ISniperEngine {
    readonly engineId: string;
    readonly displayName: string;
    readonly mode: 'SWING' | 'SCALP';
    readonly requiredTFs: string[];

    constructor(mode: 'SWING' | 'SCALP' = 'SCALP') {
        this.mode = mode;
        this.engineId = mode === 'SWING' ? 'V1-SWING' : 'V1-SCALP';
        this.displayName = mode === 'SWING'
            ? '🎯 V1 قناص سوينج فائق الدقة (1D/4H/1H/30m)'
            : '⚡ V1 قناص سكالب فائق الدقة (4H/1H/30m/5m)';
        this.requiredTFs = mode === 'SWING'
            ? ['1d', '4h', '1h', '30m', '15m', '5m']
            : ['4h', '1h', '30m', '15m', '5m', '1m'];
    }

    scan(
        symbol: string,
        cp: number,
        mtfOHLCV: Record<string, OHLCV[]>,
        allTimeframes: Record<string, AnalysisDetails>
    ): SniperReport {
        const now = new Date();
        const completed: string[] = [];
        const pending: string[] = [];

        // 1. Select quick and long data
        const quickTF = this.mode === 'SCALP' ? '5m' : '1h';
        const quickData = allTimeframes[quickTF];
        if (!quickData) {
            return this.noSignal(symbol, cp, `Missing data for quick timeframe: ${quickTF}`, now);
        }

        // 2. Compute VWAP on daily or 4h
        const dailyOHLCV = mtfOHLCV['1d'] || mtfOHLCV['4h'] || mtfOHLCV[quickTF] || [];
        const vwap = dailyOHLCV.length > 0 ? TechnicalAnalyzer.calculateVWAP(dailyOHLCV) : cp;

        // 3. Compute Matrix
        const matrix = TechnicalAnalyzer.calculateMatrix(allTimeframes);

        // 4. Run V1 Scoring logic to determine direction
        let score = 0;
        const reasons: string[] = [];

        if (cp > vwap) { score += 25; reasons.push('Price > VWAP (+25)'); }
        else { score -= 25; reasons.push('Price < VWAP (-25)'); }

        const matrixScore = (matrix.percentage - 50) * 0.8;
        score += matrixScore;
        reasons.push(`Matrix ${matrix.percentage.toFixed(0)}% (${matrixScore > 0 ? '+' : ''}${matrixScore.toFixed(1)})`);

        const rsi = quickData.rsi;
        if (rsi < 35) { score += 15; reasons.push('RSI < 35 long (+15)'); }
        else if (rsi > 65) { score -= 15; reasons.push('RSI > 65 short (-15)'); }

        const cci = quickData.indicators.cci || 0;
        if (cci < -100) { reasons.push('CCI < -100 short'); }
        else if (cci > 100) { reasons.push('CCI > 100 long'); }

        const mfi = quickData.indicators.mfi || 50;
        if (mfi < 20) { reasons.push('MFI < 20 long'); }
        else if (mfi > 80) { reasons.push('MFI > 80 short'); }

        const macd = quickData.indicators.macd?.macd || 0;
        if (macd > 0) { reasons.push('MACD > 0 long'); }
        else if (macd < 0) { reasons.push('MACD < 0 short'); }

        const stochRsi = quickData.indicators.stochRsi || 50;
        if (stochRsi < 20) { reasons.push('StochRSI < 20 long'); }
        else if (stochRsi > 80) { reasons.push('StochRSI > 80 short'); }

        const williamsR = quickData.indicators.williamsR || -50;
        if (williamsR <= -80) { reasons.push('WilliamsR <= -80 long'); }
        else if (williamsR >= -20) { reasons.push('WilliamsR >= -20 short'); }

        const direction = score >= 0 ? 'LONG' : 'SHORT';
        const winRateBase = Math.min(50 + (Math.abs(score) * 0.6), 96);

        // 5. Run the Ultra V3 High-Precision trade filters
        let filtersPassed = true;

        const rsi1h = allTimeframes['1h']?.rsi;
        const rsi4h = allTimeframes['4h']?.rsi;
        const trend4h = allTimeframes['4h']?.structure;
        const trend30m = allTimeframes['30m']?.structure;

        if (direction === 'LONG') {
            // Filter 1: Matrix Score >= 65
            if (matrix.percentage >= 65) {
                completed.push(`✅ Matrix Score: ${matrix.percentage.toFixed(0)}% >= 65%`);
            } else {
                pending.push(`🔸 Matrix Score: ${matrix.percentage.toFixed(0)}% < 65%`);
                filtersPassed = false;
            }

            // Filter 2: 1H RSI >= 48
            if (rsi1h !== undefined && rsi1h >= 48) {
                completed.push(`✅ 1H RSI: ${rsi1h.toFixed(1)} >= 48`);
            } else {
                pending.push(`🔸 1H RSI: ${rsi1h !== undefined ? rsi1h.toFixed(1) : 'N/A'} < 48`);
                filtersPassed = false;
            }

            // Filter 3: Quick RSI <= 70
            if (rsi <= 70) {
                completed.push(`✅ Quick RSI: ${rsi.toFixed(1)} <= 70`);
            } else {
                pending.push(`🔸 Quick RSI: ${rsi.toFixed(1)} > 70`);
                filtersPassed = false;
            }

            // Filter 4: 4H Trend != 'هابط (LH/LL) 📉'
            if (trend4h !== 'هابط (LH/LL) 📉') {
                completed.push(`✅ 4H Trend: ${trend4h || 'N/A'} (Not Bearish)`);
            } else {
                pending.push(`🔸 4H Trend: ${trend4h || 'N/A'} (Is Bearish هابط)`);
                filtersPassed = false;
            }
        } else {
            // Filter 1: Matrix Score <= 35
            if (matrix.percentage <= 35) {
                completed.push(`✅ Matrix Score: ${matrix.percentage.toFixed(0)}% <= 35%`);
            } else {
                pending.push(`🔸 Matrix Score: ${matrix.percentage.toFixed(0)}% > 35%`);
                filtersPassed = false;
            }

            // Filter 2: 4H RSI <= 48 && 1H RSI <= 48
            if (rsi4h !== undefined && rsi1h !== undefined && rsi4h <= 48 && rsi1h <= 48) {
                completed.push(`✅ HTF RSIs: 4H=${rsi4h.toFixed(1)}, 1H=${rsi1h.toFixed(1)} <= 48`);
            } else {
                pending.push(`🔸 HTF RSIs: 4H=${rsi4h !== undefined ? rsi4h.toFixed(1) : 'N/A'}, 1H=${rsi1h !== undefined ? rsi1h.toFixed(1) : 'N/A'} (Must be <= 48)`);
                filtersPassed = false;
            }

            // Filter 3: Quick MACD Histogram < 0
            const quickMacdHist = quickData.indicators?.macd?.histogram;
            if (quickMacdHist !== undefined && quickMacdHist < 0) {
                completed.push(`✅ Quick MACD Histogram: ${quickMacdHist.toFixed(4)} < 0`);
            } else {
                pending.push(`🔸 Quick MACD Histogram: ${quickMacdHist !== undefined ? quickMacdHist.toFixed(4) : 'N/A'} >= 0`);
                filtersPassed = false;
            }

            // Filter 4: Quick Williams %R > -75
            if (williamsR > -75) {
                completed.push(`✅ Quick Williams%R: ${williamsR.toFixed(1)} > -75`);
            } else {
                pending.push(`🔸 Quick Williams%R: ${williamsR.toFixed(1)} <= -75 (Oversold trap)`);
                filtersPassed = false;
            }

            // Filter 5: Quick Stochastic RSI > 15
            if (stochRsi > 15) {
                completed.push(`✅ Quick Stochastic RSI: ${stochRsi.toFixed(1)} > 15`);
            } else {
                pending.push(`🔸 Quick Stochastic RSI: ${stochRsi.toFixed(1)} <= 15`);
                filtersPassed = false;
            }

            // Filter 6: 4H Trend != 'صاعد (HH/HL) 📈'
            if (trend4h !== 'صاعد (HH/HL) 📈') {
                completed.push(`✅ 4H Trend: ${trend4h || 'N/A'} (Not Bullish)`);
            } else {
                pending.push(`🔸 4H Trend: ${trend4h || 'N/A'} (Is Bullish صاعد)`);
                filtersPassed = false;
            }

            // Filter 7: 30m Trend != 'صاعد (HH/HL) 📈'
            if (trend30m !== 'صاعد (HH/HL) 📈') {
                completed.push(`✅ 30m Trend: ${trend30m || 'N/A'} (Not Bullish)`);
            } else {
                pending.push(`🔸 30m Trend: ${trend30m || 'N/A'} (Is Bullish صاعد)`);
                filtersPassed = false;
            }
        }

        const readyToFire = filtersPassed;
        const confidence = readyToFire ? Math.min(60 + Math.abs(score) * 0.5, 95) : 0;
        const winRate = readyToFire ? Math.min(80 + Math.abs(score) * 0.2, 99) : 0;

        // 6. SL / TP Distance based on ATR
        const slDistance = winRateBase > 90 ? quickData.atr * 2.5 : quickData.atr * 6;
        const tp = direction === 'LONG'
            ? Math.max(quickData.levels.ma7, cp + quickData.atr * 2)
            : Math.min(quickData.levels.ma7, cp - quickData.atr * 2);
        const sl = direction === 'LONG' ? cp - slDistance : cp + slDistance;

        const summary = readyToFire
            ? `🚀 V1 Sniper ${direction} جاهز للدخول!`
            : `⏳ في وضع الانتظار (${completed.length}/${completed.length + pending.length} شروط مكتملة)`;

        const rrr = Math.abs(tp - cp) / Math.max(0.0001, Math.abs(cp - sl));
        const details = this.buildDetails(symbol, direction, cp, sl, tp, undefined, confidence, winRate, completed, pending, readyToFire, rrr);

        return {
            symbol,
            engineId: this.engineId,
            direction: readyToFire ? direction : 'NONE',
            entry: cp,
            sl,
            tp,
            readyToFire,
            confidence,
            winRate,
            completedConditions: completed,
            pendingConditions: pending,
            summary,
            details,
            generatedAt: now
        };
    }

    private noSignal(symbol: string, cp: number, reason: string, now: Date): SniperReport {
        const details = `🏛️ *${this.displayName}*\n\n🔍 لا توجد إشارة حالياً\nالسبب: ${reason}`;
        return {
            symbol, engineId: this.engineId, direction: 'NONE',
            entry: cp, sl: cp, tp: cp, readyToFire: false,
            confidence: 0, winRate: 0,
            completedConditions: [],
            pendingConditions: [reason],
            summary: `🔍 ${reason}`,
            details, generatedAt: now
        };
    }

    private buildDetails(
        symbol: string, direction: 'LONG' | 'SHORT',
        entry: number, sl: number, tp: number, tp2: number | undefined,
        confidence: number, winRate: number,
        completed: string[], pending: string[],
        readyToFire: boolean, rrr: number
    ): string {
        const sym = symbol.split('/')[0];
        const dirEmoji = direction === 'LONG' ? '🟢 LONG' : '🔴 SHORT';
        const title = `🏛️ *${this.displayName}*`;

        let text = `${title}\n💎 ${sym}/USDT | ${dirEmoji}\n━━━━━━━━━━━━━━\n📊 *التقرير التفصيلي:*\n` +
            `• الدخول: \`$${entry.toFixed(4)}\`\n` +
            `• وقف الخسارة: \`$${sl.toFixed(4)}\` (${(((sl - entry) / entry) * 100).toFixed(2)}%)\n` +
            `• الهدف الأول: \`$${tp.toFixed(4)}\` (${(((tp - entry) / entry) * 100).toFixed(2)}%)\n`;

        text += `• نسبة العائد/الخطر: \`${rrr.toFixed(2)}:1\`\n` +
            `• الثقة: \`${confidence.toFixed(1)}%\` | معدل النجاح: \`${winRate.toFixed(1)}%\`\n`;

        text += `━━━━━━━━━━━━━━\n✅ *الشروط المكتملة (${completed.length}):*\n` +
            completed.map(c => `✅ ${c.replace('✅ ', '')}`).join('\n') + '\n\n';

        if (pending.length > 0) {
            text += `🔸 *الشروط المنتظرة (${pending.length}):*\n` +
                pending.map(p => `🔸 ${p.replace('🔸 ', '')}`).join('\n') + '\n';
        }

        text += `━━━━━━━━━━━━━━\n` + (readyToFire
            ? `🚀 *إشارة V1 ممتازة — الدخول مؤكد!*`
            : `⏳ *في وضع الانتظار — سيتم إشعارك عند اكتمال الشروط*`);

        return text;
    }
}
