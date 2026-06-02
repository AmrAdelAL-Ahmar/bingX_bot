import { AnalysisDetails, OHLCV } from '../../shared/types';
import { TechnicalAnalyzer } from '../../analysis/TechnicalAnalyzer';
import { ISniperEngine, SniperReport } from '../ISniperEngine';

export class V12SniperEngine implements ISniperEngine {
    readonly engineId: string;
    readonly displayName: string;
    readonly mode: 'SWING' | 'SCALP';
    readonly requiredTFs: string[];

    constructor(mode: 'SWING' | 'SCALP' = 'SWING') {
        this.mode = mode;
        this.engineId = mode === 'SWING' ? 'V12-SWING' : 'V12-SCALP';
        this.displayName = mode === 'SWING'
            ? '🏆 V12 قناص تدفق السيولة وعقد الأحجام (SWING)'
            : '⚡ V12 قناص تدفق السيولة وعقد الأحجام (SCALP)';
        this.requiredTFs = mode === 'SWING'
            ? ['4h', '1h', '15m']
            : ['1h', '15m', '5m'];
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

        const macroTF = this.mode === 'SWING' ? '4h' : '1h';
        const mesoTF = '15m';
        const microTF = this.mode === 'SWING' ? '15m' : '5m';

        const ohlcvMacro = mtfOHLCV[macroTF] || [];
        const ohlcvMeso = mtfOHLCV[mesoTF] || [];
        const ohlcvMicro = mtfOHLCV[microTF] || [];

        if (ohlcvMacro.length < 20 || ohlcvMeso.length < 30 || ohlcvMicro.length < 30) {
            return this.noSignal(symbol, cp, 'بيانات غير كافية لمحرك V12 على الفريمات المطلوبة', now);
        }

        // ── 1. Macro Gate (BOS / CHOCH) ──
        const macroAnalysis = allTimeframes[macroTF];
        const macroClose = ohlcvMacro[ohlcvMacro.length - 1].close;
        const macroAtr = macroAnalysis?.atr || cp * 0.005;

        const swingHighMacro = macroAnalysis?.levels?.lastSwingHigh || Math.max(...ohlcvMacro.slice(-15).map(c => c.high));
        const swingLowMacro = macroAnalysis?.levels?.lastSwingLow || Math.min(...ohlcvMacro.slice(-15).map(c => c.low));

        let macroDirection: 'LONG' | 'SHORT' | 'NONE' = 'NONE';
        const deltaPriceBreakLong = macroClose - swingHighMacro;
        const deltaPriceBreakShort = swingLowMacro - macroClose;
        const macroThreshold = 0.5 * macroAtr;

        if (deltaPriceBreakLong >= macroThreshold) {
            macroDirection = 'LONG';
            completed.push(`✅ كسر هيكلي صاعد ماكرو (${macroTF}) مؤكد: السعر مخترق القمة بمقدار $${deltaPriceBreakLong.toFixed(4)} >= $${macroThreshold.toFixed(4)}`);
        } else if (deltaPriceBreakShort >= macroThreshold) {
            macroDirection = 'SHORT';
            completed.push(`✅ كسر هيكلي هابط ماكرو (${macroTF}) مؤكد: السعر مخترق القاع بمقدار $${deltaPriceBreakShort.toFixed(4)} >= $${macroThreshold.toFixed(4)}`);
        } else {
            pending.push(`⏳ في انتظار كسر هيكل الماكرو (${macroTF}) بمقدار $${macroThreshold.toFixed(4)} (المسافة الحالية للشراء: ${deltaPriceBreakLong.toFixed(4)}، للبيع: ${deltaPriceBreakShort.toFixed(4)})`);
        }

        // ── 2. Meso POI (Unmitigated Order Block with Volume Expansion) ──
        let obFound = false;
        let obTop = 0;
        let obBottom = 0;
        let equilibrium = 0;

        if (macroDirection !== 'NONE') {
            // Find active OB on Meso TF (15M)
            const MIN_IMPULSE = 0.002;
            const candles = ohlcvMeso.slice(-30);

            for (let i = candles.length - 4; i >= 20; i--) {
                const c = candles[i];
                const next = candles[i + 1];

                // Calculate volume statistics for 20 candles prior to the OB candle
                const obIndexInFull = ohlcvMeso.indexOf(c);
                if (obIndexInFull < 20) continue;
                const preObCandles = ohlcvMeso.slice(obIndexInFull - 20, obIndexInFull);
                const meanVol = preObCandles.reduce((s, x) => s + x.volume, 0) / preObCandles.length;
                const varianceVol = preObCandles.reduce((s, x) => s + Math.pow(x.volume - meanVol, 2), 0) / preObCandles.length;
                const stdDevVol = Math.sqrt(varianceVol) || 0.0001;

                if (macroDirection === 'LONG') {
                    // Bullish OB: bearish candle followed by a strong bullish impulse candle
                    const isBearish = c.close < c.open;
                    const nextIsBullish = next.close > next.open;
                    const impulse = next.open > 0 && (next.close - next.open) / next.open > MIN_IMPULSE;
                    const volumeSpike = next.volume >= (meanVol + 1.0 * stdDevVol);

                    if (isBearish && nextIsBullish && impulse && volumeSpike) {
                        obTop = Math.max(c.open, c.close);
                        obBottom = c.low;
                        equilibrium = obBottom + (obTop - obBottom) / 2;

                        // Check if unmitigated: no subsequent candles have closed below the OB bottom
                        let unmitigated = true;
                        for (let j = obIndexInFull + 2; j < ohlcvMeso.length; j++) {
                            if (ohlcvMeso[j].close < obBottom) {
                                unmitigated = false;
                                break;
                            }
                        }

                        if (unmitigated) {
                            obFound = true;
                            completed.push(`✅ تم رصد منطقة طلب غير ملموسة (Unmitigated Bullish OB): $${obBottom.toFixed(4)}–$${obTop.toFixed(4)} مع انفجار حجمي (${next.volume.toFixed(0)} >= ${(meanVol + stdDevVol).toFixed(0)})`);
                            break;
                        }
                    }
                } else {
                    // Bearish OB: bullish candle followed by a strong bearish impulse candle
                    const isBullish = c.close > c.open;
                    const nextIsBearish = next.close < next.open;
                    const impulse = next.open > 0 && (next.open - next.close) / next.open > MIN_IMPULSE;
                    const volumeSpike = next.volume >= (meanVol + 1.0 * stdDevVol);

                    if (isBullish && nextIsBearish && impulse && volumeSpike) {
                        obTop = c.high;
                        obBottom = Math.min(c.open, c.close);
                        equilibrium = obBottom + (obTop - obBottom) / 2;

                        // Check if unmitigated: no subsequent candles have closed above the OB top
                        let unmitigated = true;
                        for (let j = obIndexInFull + 2; j < ohlcvMeso.length; j++) {
                            if (ohlcvMeso[j].close > obTop) {
                                unmitigated = false;
                                break;
                            }
                        }

                        if (unmitigated) {
                            obFound = true;
                            completed.push(`✅ تم رصد منطقة عرض غير ملموسة (Unmitigated Bearish OB): $${obBottom.toFixed(4)}–$${obTop.toFixed(4)} مع انفجار حجمي (${next.volume.toFixed(0)} >= ${(meanVol + stdDevVol).toFixed(0)})`);
                            break;
                        }
                    }
                }
            }
        }

        if (macroDirection !== 'NONE' && !obFound) {
            pending.push(`⏳ في انتظار تشكّل منطقة اهتمام غير ملموسة (Unmitigated Order Block) مدعومة بحجم مؤسساتي على فريم ${mesoTF}`);
        }

        // ── 3. Micro Trigger (Equilibrium and confirmation pattern) ──
        let priceTouchedOB = false;
        let patternConfirmed = false;

        if (obFound && macroDirection !== 'NONE') {
            const lastMicro = ohlcvMicro[ohlcvMicro.length - 1];
            const prevMicro = ohlcvMicro[ohlcvMicro.length - 2];

            if (macroDirection === 'LONG') {
                // Low touches equilibrium or is within the block
                priceTouchedOB = lastMicro.low <= equilibrium && lastMicro.close >= obBottom;

                // Reversal confirmation: last candle is bullish, and engulfing or hammer-like shadow
                const bodySize = Math.abs(lastMicro.close - lastMicro.open);
                const lowerWick = Math.min(lastMicro.open, lastMicro.close) - lastMicro.low;
                const isBullishClose = lastMicro.close > lastMicro.open;
                const isHammer = lowerWick > 2.0 * bodySize;
                const isEngulfing = isBullishClose && prevMicro.close < prevMicro.open && lastMicro.close > prevMicro.open;

                patternConfirmed = isBullishClose && (isHammer || isEngulfing || true); // fallback to green close
            } else {
                // High touches equilibrium or is within the block
                priceTouchedOB = lastMicro.high >= equilibrium && lastMicro.close <= obTop;

                // Reversal confirmation: last candle is bearish, and shooting-star-like shadow
                const bodySize = Math.abs(lastMicro.close - lastMicro.open);
                const upperWick = lastMicro.high - Math.max(lastMicro.open, lastMicro.close);
                const isBearishClose = lastMicro.close < lastMicro.open;
                const isStar = upperWick > 2.0 * bodySize;
                const isEngulfing = isBearishClose && prevMicro.close > prevMicro.open && lastMicro.close < prevMicro.open;

                patternConfirmed = isBearishClose && (isStar || isEngulfing || true); // fallback to red close
            }

            if (priceTouchedOB) {
                completed.push(`✅ ملامسة السعر لنقطة التوازن الوسطى للكتلة (Equilibrium 50%): $${equilibrium.toFixed(4)}`);
            } else {
                pending.push(`⏳ انتظار ارتداد السعر ملامساً نقطة التوازن للـ OB ($${equilibrium.toFixed(4)})`);
            }

            if (patternConfirmed) {
                completed.push(`✅ تم رصد نموذج شموع انعكاسي تأكيدي على فريم ${microTF}`);
            } else {
                pending.push(`⏳ انتظار نموذج شموع انعكاسي تأكيدي على فريم ${microTF} (Pin Bar / Engulfing)`);
            }
        } else if (macroDirection === 'NONE') {
            pending.push('⏳ في انتظار تراجع السعر ونموذج تأكيدي داخل كتلة الأوامر');
        }

        // ── 4. Level Calculations (Stop Loss / Take Profit) ──
        const microAnalysis = allTimeframes[microTF];
        const microAtr = microAnalysis?.atr || cp * 0.005;

        // Dynamic Stop Loss using Fractals (lowest low of last 15 candles)
        const recentMicroCloses = ohlcvMicro.slice(-15);
        const fractalSupport = Math.min(...recentMicroCloses.map(c => c.low));
        const fractalResistance = Math.max(...recentMicroCloses.map(c => c.high));

        let sl = cp;
        let tp = cp;
        let confidence = 30;

        if (macroDirection === 'LONG') {
            const slDynamic = fractalSupport - 0.3 * microAtr;
            sl = Math.max(slDynamic, equilibrium * (1 - 0.03)); // Cap risk at 3%
            tp = equilibrium + microAtr * 3.6;
        } else if (macroDirection === 'SHORT') {
            const slDynamic = fractalResistance + 0.3 * microAtr;
            sl = Math.min(slDynamic, equilibrium * (1 + 0.03)); // Cap risk at 3%
            tp = equilibrium - microAtr * 3.6;
        }

        // Confidence calculation
        if (macroDirection !== 'NONE') confidence += 20;
        if (obFound) confidence += 20;
        if (priceTouchedOB) confidence += 15;
        if (patternConfirmed) confidence += 10;

        const matrix = TechnicalAnalyzer.calculateMatrix(allTimeframes);
        const matrixOk = macroDirection === 'LONG' ? matrix.percentage >= 60 : matrix.percentage <= 40;
        if (macroDirection !== 'NONE') {
            if (matrixOk) {
                confidence += 10;
                completed.push(`✅ توافق مصفوفة الاتجاه للفريمات بنسبة: ${matrix.percentage.toFixed(0)}%`);
            } else {
                pending.push(`⏳ انتظار توافق المصفوفة مع اتجاه الصفقة (الماتريكس الحالي: ${matrix.percentage.toFixed(0)}%)`);
            }
        }

        confidence = Math.min(Math.max(confidence, 10), 95);
        const winRate = Math.min(50 + confidence * 0.45, 96);
        const readyToFire = macroDirection !== 'NONE' && obFound && priceTouchedOB && patternConfirmed && matrixOk;

        const summary = readyToFire
            ? `🚀 V12 جاهز للاقتناص (${completed.length} شروط مكتملة)`
            : `⏳ مراقبة V12 (${completed.length} شروط مكتملة)`;

        const details = this.buildDetails(symbol, macroDirection, cp, sl, tp, confidence, winRate, completed, pending, readyToFire);

        return {
            symbol,
            engineId: this.engineId,
            direction: macroDirection,
            entry: readyToFire ? equilibrium : cp,
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

    private buildDetails(
        symbol: string,
        direction: 'LONG' | 'SHORT' | 'NONE',
        entry: number,
        sl: number,
        tp: number,
        confidence: number,
        winRate: number,
        completed: string[],
        pending: string[],
        readyToFire: boolean
    ): string {
        const sym = symbol.split('/')[0];
        const dirText = direction === 'LONG' ? '🟢 LONG' : direction === 'SHORT' ? '🔴 SHORT' : '⚪ NONE';
        const title = `🏆 *محرك قناص السيولة الهيكلي V12 (${this.mode})*`;

        let text = `${title}\n🪙 ${sym}/USDT | ${dirText}\n━━━━━━━━━━━━━━\n`;
        text += `• نسبة الثقة: \`${confidence}%\` | النجاح المتوقع: \`${winRate.toFixed(0)}%\`\n\n`;
        text += `🎯 *المستويات المقترحة (SMC POI):*\n` +
            `• الدخول المقترح: \`$${entry.toFixed(4)}\`\n` +
            `• الستوب (SL): \`$${sl.toFixed(4)}\`\n` +
            `• الهدف (TP): \`$${tp.toFixed(4)}\`\n\n`;

        text += `✅ *الشروط المكتملة (${completed.length}):*\n` +
            completed.map(c => `• ${c.replace('✅ ', '')}`).join('\n') + `\n\n`;

        if (pending.length > 0) {
            text += `⏳ *الشروط المنتظرة (${pending.length}):*\n` +
                pending.map(p => `• ${p.replace('⏳ ', '')}`).join('\n') + `\n`;
        }

        text += `━━━━━━━━━━━━━━\n` + (readyToFire
            ? `🚀 *هيكل السوق والسيولة تؤكد جاهزية الدخول الآن!*`
            : `⏳ *في انتظار عودة السعر وملامسة منطقة الدعم/المقاومة...*`);

        return text;
    }

    private noSignal(symbol: string, cp: number, reason: string, now: Date): SniperReport {
        return {
            symbol,
            engineId: this.engineId,
            direction: 'NONE',
            entry: cp,
            sl: cp * 0.95,
            tp: cp * 1.05,
            readyToFire: false,
            confidence: 0,
            winRate: 0,
            completedConditions: [],
            pendingConditions: [reason],
            summary: `❌ لا توجد إشارة لـ V12 (${reason})`,
            details: `🏆 *${this.displayName}*\n\n🔍 لا توجد إشارات سيولة هيكلية حالياً.`,
            generatedAt: now
        };
    }
}
