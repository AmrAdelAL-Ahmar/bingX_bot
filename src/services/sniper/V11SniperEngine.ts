import { AnalysisDetails, OHLCV } from '../AnalysisService';
import { TechnicalAnalyzer } from '../TechnicalAnalyzer';
import { ISniperEngine, SniperReport } from './ISniperEngine';
import { RSI, BollingerBands } from 'technicalindicators';

interface SRLevel {
    price: number;
    strength: number;
    type: 'SUPPORT' | 'RESISTANCE';
}

export class V11SniperEngine implements ISniperEngine {
    readonly engineId: string;
    readonly displayName: string;
    readonly mode: 'SWING' | 'SCALP';
    readonly requiredTFs: string[];

    constructor(mode: 'SWING' | 'SCALP' = 'SWING') {
        this.mode = mode;
        this.engineId = mode === 'SWING' ? 'V11-SWING' : 'V11-SCALP';
        this.displayName = mode === 'SWING'
            ? '🏆 V11 قناص القرار الذكي (SWING)'
            : '⚡ V11 قناص القرار الذكي (SCALP)';
        this.requiredTFs = mode === 'SWING'
            ? ['1d', '4h', '1h', '15m']
            : ['4h', '1h', '15m', '5m'];
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

        // ── 1. تحديد الفريمات (HTF / MTF / LTF) ─────────────────────────────────
        const htfKey = this.mode === 'SWING' ? '4h' : '1h';
        const mtfKey = this.mode === 'SWING' ? '1h' : '15m';
        const ltfKey = this.mode === 'SWING' ? '15m' : '5m';

        const htfData = mtfOHLCV[htfKey] || [];
        const mtfData = mtfOHLCV[mtfKey] || [];
        const ltfData = mtfOHLCV[ltfKey] || [];

        if (htfData.length < 50 || mtfData.length < 30 || ltfData.length < 15) {
            return this.noSignal(symbol, cp, 'بيانات غير كافية لتحليل V11', now);
        }

        // ── 2. محرك اتخاذ القرار (Decision Engine: Trending vs Ranging) ──────────────
        // حساب KAMA على HTF لتحديد الاتجاه
        const kamaValues = TechnicalAnalyzer.calculateKAMA(htfData, 10);
        const lastKama = kamaValues[kamaValues.length - 1];
        const prevKama = kamaValues[kamaValues.length - 2];
        const kamaSlope = (lastKama - prevKama) / prevKama * 100; // نسبة التغير

        // حساب Bollinger Bands للتحقق من التذبذب العرضي
        const closesHTF = htfData.map(c => c.close);
        const bbValues = BollingerBands.calculate({ period: 20, values: closesHTF, stdDev: 2 });
        const lastBB = bbValues[bbValues.length - 1];

        let isRanging = false;
        let er = 0.5; // KAMA Efficiency Ratio
        try {
            const period = 10;
            const direction = Math.abs(closesHTF[closesHTF.length - 1] - closesHTF[closesHTF.length - 1 - period]);
            let volatility = 0;
            for (let j = closesHTF.length - period; j < closesHTF.length; j++) {
                volatility += Math.abs(closesHTF[j] - closesHTF[j - 1]);
            }
            er = volatility === 0 ? 0 : direction / volatility;
        } catch (e) { }

        // إذا كان er منخفضاً أو الميل مسطحاً، أو نطاق البولنجر ضيق جداً (أقل من 2%)
        const bbWidth = lastBB ? (lastBB.upper - lastBB.lower) / lastBB.middle * 100 : 5;
        if (er < 0.28 || Math.abs(kamaSlope) < 0.015 || bbWidth < 2.5) {
            isRanging = true;
        }

        // ── 3. كاشف الأنماط ذكياً (Regime & Pattern Classifier) ─────────────────────
        let marketRegime: 'ELLIOTT_WAVE_3' | 'LIQUIDITY_RUN' | 'STANDARD_TREND' | 'SIDEWAYS_RANGE' = 'STANDARD_TREND';

        const matrix = TechnicalAnalyzer.calculateMatrix(allTimeframes);
        const recentVols = htfData.slice(-10).map(c => c.volume);
        const avgVol = recentVols.slice(0, -1).reduce((a, b) => a + b, 0) / 9;
        const lastVol = recentVols[recentVols.length - 1];

        if (isRanging) {
            marketRegime = 'SIDEWAYS_RANGE';
        } else if (Math.abs(kamaSlope) > 0.08 && lastVol > avgVol * 1.5 && (matrix.percentage >= 80 || matrix.percentage <= 20)) {
            marketRegime = 'ELLIOTT_WAVE_3'; // موجة اندفاعية ثالثة قوية جداً
        } else {
            // التحقق من Liquidity Run (سحب السيولة بالذيول)
            const recentHighs = htfData.slice(-5, -1).map(c => c.high);
            const recentLows = htfData.slice(-5, -1).map(c => c.low);
            const lastCandle = htfData[htfData.length - 1];

            const prevHigh = Math.max(...recentHighs);
            const prevLow = Math.min(...recentLows);

            // ذيل شمعة يخترق قمة/قاع سابق ويغلق داخله
            const longSweep = lastCandle.low < prevLow && lastCandle.close > prevLow;
            const shortSweep = lastCandle.high > prevHigh && lastCandle.close < prevHigh;
            if (longSweep || shortSweep) {
                marketRegime = 'LIQUIDITY_RUN';
            }
        }

        completed.push(`ℹ️ النمط المكتشف: **${marketRegime === 'ELLIOTT_WAVE_3' ? '🌊 موجة إليوت 3 اندفاعية' :
                marketRegime === 'LIQUIDITY_RUN' ? '⚡ سحب سيولة (Liquidity Run)' :
                    marketRegime === 'SIDEWAYS_RANGE' ? '↔️ سوق عرضي متذبذب (Sideways)' :
                        '📈 اتجاه اعتيادي (Standard Trend)'
            }**`);

        // ── 4. تنفيذ شروط التداول بناءً على النمط والـ Rule-Based Switching ──────
        let direction: 'LONG' | 'SHORT' | 'NONE' = 'NONE';
        let entryPrice = cp;
        let sl = cp * 0.95;
        let tp = cp * 1.05;
        let tp2: number | undefined = undefined;
        let confidence = 40;
        let winRate = 50;

        const srLevels = this.detectSRLevels(htfData, 60);

        if (marketRegime === 'SIDEWAYS_RANGE') {
            // ── استراتيجية التذبذب (Momentum & BB Saturation) ───────────────────
            const ltfRsi = allTimeframes[ltfKey]?.rsi ?? 50;
            const mtfRsi = allTimeframes[mtfKey]?.rsi ?? 50;

            const bbUpper = lastBB ? lastBB.upper : cp * 1.02;
            const bbLower = lastBB ? lastBB.lower : cp * 0.98;

            completed.push(`✅ تعطيل استراتيجيات الاتجاه (SMC) لعدم الوقوع في الكسر الخادع`);

            if (ltfRsi < 32 && cp <= bbLower * 1.005) {
                direction = 'LONG';
                completed.push(`✅ السعر بالقرب من الحد السفلي للبولنجر باند ($${bbLower.toFixed(4)})`);
                completed.push(`✅ مؤشر RSI ذو تشبع بيعي لحظي (${ltfRsi.toFixed(1)})`);

                entryPrice = cp;
                // الستوب أسفل القاع الأخير بقليل
                const recentLow = Math.min(...ltfData.slice(-15).map(c => c.low));
                sl = Math.min(recentLow, bbLower) * 0.995;
                tp = lastBB ? lastBB.middle : cp * 1.015;
                tp2 = bbUpper;
                confidence += 25;
            } else if (ltfRsi > 68 && cp >= bbUpper * 0.995) {
                direction = 'SHORT';
                completed.push(`✅ السعر بالقرب من الحد العلوي للبولنجر باند ($${bbUpper.toFixed(4)})`);
                completed.push(`✅ مؤشر RSI ذو تشبع شرائي لحظي (${ltfRsi.toFixed(1)})`);

                entryPrice = cp;
                const recentHigh = Math.max(...ltfData.slice(-15).map(c => c.high));
                sl = Math.max(recentHigh, bbUpper) * 1.005;
                tp = lastBB ? lastBB.middle : cp * 0.985;
                tp2 = bbLower;
                confidence += 25;
            } else {
                pending.push(`🔸 تذبذب عرضي: انتظار ملامسة حدود البولنجر باند وتشبع RSI`);
                return this.noSignal(symbol, cp, 'سوق متذبذب عرضياً، انتظار ارتداد من الأطراف', now);
            }

        } else {
            // ── استراتيجية الاتجاه والـ SMC / ICT (Trending & Waves) ─────────────
            completed.push(`✅ تفعيل نظام المال الذكي (SMC/ICT) لملاحقة كسر الهيكل`);

            // أ. تحديد اتجاه الكسر (BOS / CHoCH) عبر MSS
            const longMSS = TechnicalAnalyzer.detectMSS(htfData, 'LONG');
            const shortMSS = TechnicalAnalyzer.detectMSS(htfData, 'SHORT');

            if (longMSS.detected || kamaSlope > 0) {
                direction = 'LONG';
                completed.push(`✅ هيكل صاعد: ${longMSS.detected ? 'MSS مؤكد' : 'ميل KAMA صاعد (' + kamaSlope.toFixed(2) + '%)'}`);
            } else if (shortMSS.detected || kamaSlope < 0) {
                direction = 'SHORT';
                completed.push(`✅ هيكل هابط: ${shortMSS.detected ? 'MSS مؤكد' : 'ميل KAMA هابط (' + kamaSlope.toFixed(2) + '%)'}`);
            } else {
                return this.noSignal(symbol, cp, 'عدم كسر الهيكل بالحد المطلوب', now);
            }

            // ب. كتل السيولة وفجوات القيمة العادلة (Order Blocks & FVG)
            const orderBlockResult = TechnicalAnalyzer.detectOrderBlock(mtfData, direction);
            const fvgResult = TechnicalAnalyzer.detectFVG(mtfData, direction);

            let hasPOI = false;
            let poiSource = '';
            let poiTop = 0;
            let poiBottom = 0;

            if (orderBlockResult.found) {
                hasPOI = true;
                poiSource = 'Order Block';
                poiTop = orderBlockResult.top;
                poiBottom = orderBlockResult.bottom;
                completed.push(`✅ تم رصد منطقة طلب وعرض (Order Block): $${poiBottom.toFixed(4)} - $${poiTop.toFixed(4)}`);
            } else if (fvgResult.found) {
                hasPOI = true;
                poiSource = 'Fair Value Gap';
                poiTop = fvgResult.top;
                poiBottom = fvgResult.bottom;
                completed.push(`✅ تم رصد فجوة سيولة (FVG): $${poiBottom.toFixed(4)} - $${poiTop.toFixed(4)}`);
            } else {
                pending.push(`🔸 انتظار تكون كتل سيولة أو فجوات FVG على فريم ${mtfKey}`);
            }

            // ج. الفيبوناتشي الذكي ومنطقة الخصم (Smart Fibonacci & Discount Zone)
            const fib = TechnicalAnalyzer.calculateSmartFibonacci(htfData, direction, 50);
            let inDiscount = false;

            if (direction === 'LONG') {
                inDiscount = cp <= fib.discountTop;
                if (inDiscount) {
                    completed.push(`✅ السعر في منطقة الخصم العميق (Discount Zone <= $${fib.discountTop.toFixed(4)})`);
                } else {
                    pending.push(`🔸 السعر أعلى من منطقة الخصم العميق (انتظار التصحيح لـ $${fib.discountTop.toFixed(4)})`);
                }
            } else {
                inDiscount = cp >= fib.discountBottom;
                if (inDiscount) {
                    completed.push(`✅ السعر في منطقة العلاوة الممتازة (Premium Zone >= $${fib.discountBottom.toFixed(4)})`);
                } else {
                    pending.push(`🔸 السعر أدنى من منطقة العلاوة الممتازة (انتظار التصحيح لـ $${fib.discountBottom.toFixed(4)})`);
                }
            }

            // د. كسر الهيكل المصغر وتأكيد الدخول على LTF (Trigger / CHOCH)
            const ltfMSS = TechnicalAnalyzer.detectMSS(ltfData, direction);
            let ltfConfirmed = false;
            if (ltfMSS.detected) {
                ltfConfirmed = true;
                completed.push(`✅ تأكيد الزناد على فريم ${ltfKey}: كسر هيكل لحظي CHOCH لصالح الصفقة`);
            } else {
                pending.push(`🔸 انتظار كسر هيكل لحظي CHOCH تأكيدي على فريم ${ltfKey}`);
            }

            // هـ. تسعير الصفقة ووضع الاستوب والهدف من مستويات الدعم والمقاومة الحقيقية
            const atr = allTimeframes[ltfKey]?.atr ?? (cp * 0.005);
            const buffer = atr * 0.25;

            entryPrice = cp;

            if (direction === 'LONG') {
                // وقف الخسارة أسفل منطقة الاهتمام أو أدنى دعم
                const support = srLevels.filter(l => l.type === 'SUPPORT' && l.price < cp)[0]?.price;
                sl = Math.min(support || (hasPOI ? poiBottom : cp * 0.98)) - buffer;
                sl = Math.max(sl, cp * 0.965); // كحد أقصى 3.5% حماية

                // الأهداف
                const resistance = srLevels.filter(l => l.type === 'RESISTANCE' && l.price > cp).sort((a, b) => a.price - b.price);
                tp = resistance[0] ? resistance[0].price - buffer : cp + (atr * 3.5);
                tp2 = resistance[1] ? resistance[1].price - buffer : tp + (atr * 2.5);
            } else {
                const resistance = srLevels.filter(l => l.type === 'RESISTANCE' && l.price > cp)[0]?.price;
                sl = Math.max(resistance || (hasPOI ? poiTop : cp * 1.02)) + buffer;
                sl = Math.min(sl, cp * 1.035);

                const support = srLevels.filter(l => l.type === 'SUPPORT' && l.price < cp).sort((a, b) => b.price - a.price);
                tp = support[0] ? support[0].price + buffer : cp - (atr * 3.5);
                tp2 = support[1] ? support[1].price + buffer : tp - (atr * 2.5);
            }

            // احتساب الثقة بناءً على الأنماط والـ Confluences
            if (marketRegime === 'ELLIOTT_WAVE_3') {
                confidence += 20; // احتمالية نجاح عالية في الموجة الثالثة
                completed.push(`✅ تعزيز الثقة: الدخول مع زخم موجة إليوت 3 الاندفاعية`);
            }
            if (marketRegime === 'LIQUIDITY_RUN') {
                confidence += 15;
                completed.push(`✅ تعزيز الثقة: اقتناص كسر السيولة الكاذب`);
            }
            if (hasPOI) confidence += 15;
            if (inDiscount) confidence += 15;
            if (ltfConfirmed) confidence += 15;

            // التحقق من الماتريكس
            const matrixOk = direction === 'LONG' ? matrix.percentage >= 60 : matrix.percentage <= 40;
            if (matrixOk) {
                confidence += 10;
                completed.push(`✅ توافق مصفوفة الفريمات المتعددة (${matrix.percentage.toFixed(0)}%)`);
            } else {
                pending.push(`🔸 ضعف توافق مصفوفة الفريمات المتعددة (${matrix.percentage.toFixed(0)}%)`);
            }
        }

        // ── 5. احتساب RRR والنسب النهائية ─────────────────────────────────────
        const slDist = Math.abs(entryPrice - sl);
        const tpDist = Math.abs(tp - entryPrice);
        const rrr = slDist > 0 ? tpDist / slDist : 0;

        if (rrr < 1.45) {
            pending.push(`🔸 نسبة العائد/المخاطرة RRR ضعيفة: ${rrr.toFixed(2)}:1 (الحد الأدنى 1.5)`);
        } else {
            completed.push(`✅ نسبة العائد/المخاطرة RRR ممتازة: ${rrr.toFixed(2)}:1`);
        }

        confidence = Math.min(Math.max(confidence, 15), 97);
        winRate = Math.min(50 + confidence * 0.48, 96);

        // جاهز للتفعيل الفوري؟
        const readyToFire = (direction == 'LONG' || direction == 'SHORT') &&
            confidence >= 70 &&
            rrr >= 1.45 &&
            (marketRegime === 'SIDEWAYS_RANGE' || (completed.some(c => c.includes('منطقة الخصم')) || completed.some(c => c.includes('منطقة العلاوة'))));

        const summary = readyToFire
            ? `🏆 قناص V11 جاهز للاقتناص (${completed.length} شروط مكتملة)`
            : `⏳ مراقبة قناص V11 (${completed.length} شروط مكتملة)`;

        const details = this.buildDetails(
            symbol, direction, entryPrice, sl, tp, tp2,
            confidence, winRate, rrr, marketRegime, completed, pending, readyToFire
        );

        return {
            symbol,
            engineId: this.engineId,
            direction,
            entry: entryPrice,
            sl,
            tp,
            tp2,
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

    private detectSRLevels(ohlcv: OHLCV[], lookback = 50): SRLevel[] {
        const candles = ohlcv.slice(-lookback);
        const levels: SRLevel[] = [];
        const tolerance = (Math.max(...candles.map(c => c.high)) - Math.min(...candles.map(c => c.low))) * 0.003;

        for (let i = 2; i < candles.length - 2; i++) {
            const c = candles[i];

            if (c.high > candles[i - 1].high && c.high > candles[i - 2].high &&
                c.high > candles[i + 1].high && c.high > candles[i + 2].high) {
                const existing = levels.find(l => l.type === 'RESISTANCE' && Math.abs(l.price - c.high) < tolerance);
                if (existing) existing.strength++;
                else levels.push({ price: c.high, strength: 1, type: 'RESISTANCE' });
            }

            if (c.low < candles[i - 1].low && c.low < candles[i - 2].low &&
                c.low < candles[i + 1].low && c.low < candles[i + 2].low) {
                const existing = levels.find(l => l.type === 'SUPPORT' && Math.abs(l.price - c.low) < tolerance);
                if (existing) existing.strength++;
                else levels.push({ price: c.low, strength: 1, type: 'SUPPORT' });
            }
        }

        return levels.sort((a, b) => b.strength - a.strength);
    }

    private buildDetails(
        symbol: string,
        direction: 'LONG' | 'SHORT' | 'NONE',
        entry: number,
        sl: number,
        tp: number,
        tp2: number | undefined,
        confidence: number,
        winRate: number,
        rrr: number,
        regime: string,
        completed: string[],
        pending: string[],
        readyToFire: boolean
    ): string {
        const sym = symbol.split('/')[0];
        const dirEmoji = direction === 'LONG' ? '🟢 LONG' : '🔴 SHORT';

        let title = `🏆 *محرك قناص القرار الذكي المطور V11 (${this.mode})*`;

        let text = `${title}\n💎 ${sym}/USDT | ${dirEmoji}\n━━━━━━━━━━━━━━\n`;

        text += `📊 *حالة السوق والقرار:*\n` +
            `• البيئة الحالية: \`${regime === 'ELLIOTT_WAVE_3' ? 'موجة إليوت 3 الاندفاعية 🌊' :
                regime === 'LIQUIDITY_RUN' ? 'سحب سيولة خاطف ⚡' :
                    regime === 'SIDEWAYS_RANGE' ? 'سوق متذبذب عرضي ↔️' :
                        'ترند مستقر 📈'
            }\`\n` +
            `• نسبة الثقة: \`${confidence.toFixed(0)}%\` | النجاح المتوقع: \`${winRate.toFixed(1)}%\`\n` +
            `• العائد للمخاطرة RRR: \`${rrr.toFixed(2)}:1\`\n\n`;

        text += `🎯 *المستويات السعرية:*\n` +
            `• الدخول: \`$${entry.toFixed(4)}\`\n` +
            `• وقف الخسارة (SL): \`$${sl.toFixed(4)}\` (${(((sl - entry) / entry) * 100).toFixed(2)}%)\n` +
            `• الهدف الأول (TP1): \`$${tp.toFixed(4)}\` (${(((tp - entry) / entry) * 100).toFixed(2)}%)\n`;

        if (tp2) {
            text += `• الهدف الثاني (TP2): \`$${tp2.toFixed(4)}\` (${(((tp2 - entry) / entry) * 100).toFixed(2)}%)\n`;
        }

        text += `\n✅ *الشروط المكتملة (${completed.length}):*\n` +
            completed.map(c => `• ${c.replace('✅ ', '')}`).join('\n') + `\n\n`;

        if (pending.length > 0) {
            text += `⏳ *الشروط المنتظرة (${pending.length}):*\n` +
                pending.map(p => `• ${p.replace('🔸 ', '')}`).join('\n') + `\n`;
        }

        text += `━━━━━━━━━━━━━━\n` + (readyToFire
            ? `🚀 *محرك القرار يؤكد جاهزية الصفقة بنسبة نجاح عالية جداً!*`
            : `⏳ *قيد مراقبة السيولة وكسر الهيكل اللحظي CHOCH*`);

        return text;
    }

    private noSignal(symbol: string, cp: number, reason: string, now: Date): SniperReport {
        const details = `🏆 *${this.displayName}*\n\n🔍 لا توجد إشارة تداول حالياً\nالسبب الرئيسي: ${reason}`;
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
            summary: `❌ لا توجد إشارة لـ V11 (${reason})`,
            details,
            generatedAt: now
        };
    }
}
