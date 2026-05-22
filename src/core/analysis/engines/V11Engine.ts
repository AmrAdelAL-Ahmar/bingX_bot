import { AnalysisDetails, MatrixResult, OHLCV, TradeRecommendation } from '../../shared/types';
import { ITradingEngine, EngineResult } from './ITradingEngine';
import { TechnicalAnalyzer } from '../TechnicalAnalyzer';
import { BollingerBands } from 'technicalindicators';

interface SRLevel {
    price: number;
    strength: number;
    type: 'SUPPORT' | 'RESISTANCE';
}

/**
 * 🏆 V11 Adaptive Decision & Regime Engine — المحرك التكيفي الحادي عشر المطور
 *
 * الميزات الفريدة للإصدار V11:
 * 1. دمج مصفوفة المتوسطات التكيفية (KAMA) لفرز بيئة السوق وحالة الاتجاه بدقة متناهية.
 * 2. التبديل التلقائي (Rule-Based Switching) لتشغيل SMC في السوق الاتجاهي أو تفعيل مؤشرات الزخم والبولنجر في السوق العرضي التذبذبي.
 * 3. كاشف الأنماط ذكياً (Regime Classifier) للتعرف على موجات إليوت الثالثة وسحب السيولة بالذيول (Liquidity Run).
 * 4. حساب أهداف موجة إليوت 3 الاندفاعية بنسب امتداد فيبوناتشي 1.618 و 2.618 منسجمة هيكلياً مع الدعوم والمقاومات.
 */
export class V11Engine implements ITradingEngine {
    analyze(
        cp: number,
        vwap: number,
        allTimeframes: Record<string, AnalysisDetails>,
        mtfOHLCV: Record<string, OHLCV[]>,
        options: { quickTF: string; longTF: string }
    ): EngineResult {
        const matrix = TechnicalAnalyzer.calculateMatrix(allTimeframes);

        return {
            matrix,
            scalp: this.runV11Pipeline(cp, vwap, allTimeframes, mtfOHLCV, matrix, 'SCALP'),
            swing: this.runV11Pipeline(cp, vwap, allTimeframes, mtfOHLCV, matrix, 'SWING'),
        };
    }

    private runV11Pipeline(
        cp: number,
        vwap: number,
        allTimeframes: Record<string, AnalysisDetails>,
        mtfOHLCV: Record<string, OHLCV[]>,
        matrix: MatrixResult,
        mode: 'SCALP' | 'SWING'
    ): TradeRecommendation {
        // ── 1. تحديد الفريمات (HTF / MTF / LTF) ──
        const htfKey = mode === 'SWING' ? '4h' : '1h';
        const mtfKey = mode === 'SWING' ? '1h' : '15m';
        const ltfKey = mode === 'SWING' ? '15m' : '5m';

        const htfData = mtfOHLCV[htfKey] || [];
        const mtfData = mtfOHLCV[mtfKey] || [];
        const ltfData = mtfOHLCV[ltfKey] || [];

        if (htfData.length < 50 || mtfData.length < 30 || ltfData.length < 15) {
            return this.cancel(cp, 'بيانات غير كافية للتحليل V11', mode, 0, 'Insufficient data');
        }

        // ── 2. محرك اتخاذ القرار (Decision Engine: Trending vs Ranging) ──
        const closesHTF = htfData.map(c => c.close);
        const kamaValues = TechnicalAnalyzer.calculateKAMA(htfData, 10);
        const lastKama = kamaValues[kamaValues.length - 1];
        const prevKama = kamaValues[kamaValues.length - 2];
        const kamaSlope = (lastKama - prevKama) / prevKama * 100; // نسبة التغير

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

        const bbWidth = lastBB ? (lastBB.upper - lastBB.lower) / lastBB.middle * 100 : 5;
        if (er < 0.28 || Math.abs(kamaSlope) < 0.015 || bbWidth < 2.5) {
            isRanging = true;
        }

        // ── 3. كاشف الأنماط ذكياً (Regime & Pattern Classifier) ──
        let marketRegime: 'ELLIOTT_WAVE_3' | 'LIQUIDITY_RUN' | 'STANDARD_TREND' | 'SIDEWAYS_RANGE' = 'STANDARD_TREND';

        const recentVols = htfData.slice(-10).map(c => c.volume);
        const avgVol = recentVols.slice(0, -1).reduce((a, b) => a + b, 0) / 9;
        const lastVol = recentVols[recentVols.length - 1];

        if (isRanging) {
            marketRegime = 'SIDEWAYS_RANGE';
        } else if (Math.abs(kamaSlope) > 0.08 && lastVol > avgVol * 1.5 && (matrix.percentage >= 80 || matrix.percentage <= 20)) {
            marketRegime = 'ELLIOTT_WAVE_3';
        } else {
            const recentHighs = htfData.slice(-5, -1).map(c => c.high);
            const recentLows = htfData.slice(-5, -1).map(c => c.low);
            const lastCandle = htfData[htfData.length - 1];

            const prevHigh = Math.max(...recentHighs);
            const prevLow = Math.min(...recentLows);

            const longSweep = lastCandle.low < prevLow && lastCandle.close > prevLow;
            const shortSweep = lastCandle.high > prevHigh && lastCandle.close < prevHigh;
            if (longSweep || shortSweep) {
                marketRegime = 'LIQUIDITY_RUN';
            }
        }

        const completed: string[] = [];
        const pending: string[] = [];

        completed.push(`النمط: ${marketRegime === 'ELLIOTT_WAVE_3' ? '🌊 موجة إليوت 3 اندفاعية' :
                marketRegime === 'LIQUIDITY_RUN' ? '⚡ سحب سيولة (Liquidity Run)' :
                    marketRegime === 'SIDEWAYS_RANGE' ? '↔️ سوق عرضي متذبذب (Sideways)' :
                        '📈 اتجاه اعتيادي (Standard Trend)'
            }`);

        // ── 4. تنفيذ شروط التداول بناءً على النمط والـ Rule-Based Switching ──
        let direction: 'LONG' | 'SHORT' | 'NONE' = 'NONE';
        let entryPrice = cp;
        let sl = cp * 0.95;
        let tp = cp * 1.05;
        let tp2: number | undefined = undefined;
        let confidence = 40;

        const srLevels = this.detectSRLevels(htfData, 60);

        if (marketRegime === 'SIDEWAYS_RANGE') {
            const ltfRsi = allTimeframes[ltfKey]?.rsi ?? 50;
            const bbUpper = lastBB ? lastBB.upper : cp * 1.02;
            const bbLower = lastBB ? lastBB.lower : cp * 0.98;

            completed.push(`تعطيل SMC للتذبذب العرضي`);

            if (ltfRsi < 32 && cp <= bbLower * 1.005) {
                direction = 'LONG';
                completed.push(`شراء من حدود البولنجر ($${bbLower.toFixed(4)})`);
                completed.push(`تشبع بيعي لحظي RSI (${ltfRsi.toFixed(1)})`);

                entryPrice = cp;
                const recentLow = Math.min(...ltfData.slice(-15).map(c => c.low));
                sl = Math.min(recentLow, bbLower) * 0.995;
                tp = lastBB ? lastBB.middle : cp * 1.015;
                tp2 = bbUpper;
                confidence += 25;
            } else if (ltfRsi > 68 && cp >= bbUpper * 0.995) {
                direction = 'SHORT';
                completed.push(`بيع من حدود البولنجر ($${bbUpper.toFixed(4)})`);
                completed.push(`تشبع شرائي لحظي RSI (${ltfRsi.toFixed(1)})`);

                entryPrice = cp;
                const recentHigh = Math.max(...ltfData.slice(-15).map(c => c.high));
                sl = Math.max(recentHigh, bbUpper) * 1.005;
                tp = lastBB ? lastBB.middle : cp * 0.985;
                tp2 = bbLower;
                confidence += 25;
            } else {
                pending.push(`انتظار ملامسة حدود البولنجر باند وتشبع RSI`);
                return this.cancel(cp, '⏳ تذبذب عرضي: انتظار الأطراف', mode, confidence, 'Sideways: waiting for BB boundaries');
            }
        } else {
            completed.push(`تفعيل نظام المال الذكي (SMC/ICT)`);

            const longMSS = TechnicalAnalyzer.detectMSS(htfData, 'LONG');
            const shortMSS = TechnicalAnalyzer.detectMSS(htfData, 'SHORT');

            if (longMSS.detected || kamaSlope > 0) {
                direction = 'LONG';
                completed.push(`هيكل صاعد: ${longMSS.detected ? 'MSS مؤكد' : 'ميل KAMA صاعد (' + kamaSlope.toFixed(2) + '%)'}`);
            } else if (shortMSS.detected || kamaSlope < 0) {
                direction = 'SHORT';
                completed.push(`هيكل هابط: ${shortMSS.detected ? 'MSS مؤكد' : 'ميل KAMA هابط (' + kamaSlope.toFixed(2) + '%)'}`);
            } else {
                return this.cancel(cp, '⏳ انتظار اتجاه أو كسر هيكل واضح', mode, confidence, 'Waiting for MSS or KAMA slope confirmation');
            }

            // Order Block & FVG POIs
            const orderBlockResult = TechnicalAnalyzer.detectOrderBlock(mtfData, direction);
            const fvgResult = TechnicalAnalyzer.detectFVG(mtfData, direction);

            let hasPOI = false;
            let poiTop = 0;
            let poiBottom = 0;

            if (orderBlockResult.found) {
                hasPOI = true;
                poiTop = orderBlockResult.top;
                poiBottom = orderBlockResult.bottom;
                completed.push(`كتلة أوامر OB: $${poiBottom.toFixed(4)} - $${poiTop.toFixed(4)}`);
            } else if (fvgResult.found) {
                hasPOI = true;
                poiTop = fvgResult.top;
                poiBottom = fvgResult.bottom;
                completed.push(`فجوة سيولة FVG: $${poiBottom.toFixed(4)} - $${poiTop.toFixed(4)}`);
            } else {
                pending.push(`انتظار تكون مناطق اهتمام OB/FVG`);
            }

            // Smart Fibonacci Discount/Premium Zone
            const fib = TechnicalAnalyzer.calculateSmartFibonacci(htfData, direction, 50);
            let inDiscount = false;

            if (direction === 'LONG') {
                inDiscount = cp <= fib.discountTop;
                if (inDiscount) {
                    completed.push(`منطقة الخصم (<= $${fib.discountTop.toFixed(4)})`);
                } else {
                    pending.push(`انتظار هبوط للمنطقة الذهبية (<= $${fib.discountTop.toFixed(4)})`);
                }
            } else {
                inDiscount = cp >= fib.discountBottom;
                if (inDiscount) {
                    completed.push(`منطقة العلاوة الممتازة (>= $${fib.discountBottom.toFixed(4)})`);
                } else {
                    pending.push(`انتظار تصحيح للأعلى (>= $${fib.discountBottom.toFixed(4)})`);
                }
            }

            // LTF Confirmation
            const ltfMSS = TechnicalAnalyzer.detectMSS(ltfData, direction);
            let ltfConfirmed = false;
            if (ltfMSS.detected) {
                ltfConfirmed = true;
                completed.push(`تأكيد الزناد كسر هيكل مصغر CHOCH`);
            } else {
                pending.push(`انتظار كسر هيكل لحظي CHOCH تأكيدي`);
            }

            const atr = allTimeframes[ltfKey]?.atr ?? (cp * 0.005);
            const buffer = atr * 0.25;

            entryPrice = cp;

            if (direction === 'LONG') {
                const support = srLevels.filter(l => l.type === 'SUPPORT' && l.price < cp)[0]?.price;
                sl = Math.min(support || (hasPOI ? poiBottom : cp * 0.98)) - buffer;
                sl = Math.max(sl, cp * 0.965); // كحد أقصى 3.5% حماية

                if (marketRegime === 'ELLIOTT_WAVE_3') {
                    const wave1Size = fib.maxHigh - fib.minLow;
                    tp = cp + wave1Size * 1.618;
                    tp2 = cp + wave1Size * 2.618;
                    completed.push(`أهداف موجة إليوت 3 الاندفاعية (TP1 1.618, TP2 2.618)`);
                } else {
                    const resistance = srLevels.filter(l => l.type === 'RESISTANCE' && l.price > cp).sort((a, b) => a.price - b.price);
                    tp = resistance[0] ? resistance[0].price - buffer : cp + (atr * 3.5);
                    tp2 = resistance[1] ? resistance[1].price - buffer : tp + (atr * 2.5);
                }
            } else {
                const resistance = srLevels.filter(l => l.type === 'RESISTANCE' && l.price > cp)[0]?.price;
                sl = Math.max(resistance || (hasPOI ? poiTop : cp * 1.02)) + buffer;
                sl = Math.min(sl, cp * 1.035);

                if (marketRegime === 'ELLIOTT_WAVE_3') {
                    const wave1Size = fib.maxHigh - fib.minLow;
                    tp = cp - wave1Size * 1.618;
                    tp2 = cp - wave1Size * 2.618;
                    completed.push(`أهداف موجة إليوت 3 الاندفاعية الهابطة (TP1 1.618, TP2 2.618)`);
                } else {
                    const support = srLevels.filter(l => l.type === 'SUPPORT' && l.price < cp).sort((a, b) => b.price - a.price);
                    tp = support[0] ? support[0].price + buffer : cp - (atr * 3.5);
                    tp2 = support[1] ? support[1].price + buffer : tp - (atr * 2.5);
                }
            }

            if (marketRegime === 'ELLIOTT_WAVE_3') {
                confidence += 20;
                completed.push(`زخم موجة إليوت 3`);
            }
            if (marketRegime === 'LIQUIDITY_RUN') {
                confidence += 15;
                completed.push(`سحب سيولة خاطف`);
            }
            if (hasPOI) confidence += 15;
            if (inDiscount) confidence += 15;
            if (ltfConfirmed) confidence += 15;

            const matrixOk = direction === 'LONG' ? matrix.percentage >= 60 : matrix.percentage <= 40;
            if (matrixOk) {
                confidence += 10;
                completed.push(`توافق المصفوفة (${matrix.percentage.toFixed(0)}%)`);
            } else {
                pending.push(`ضعف توافق المصفوفة (${matrix.percentage.toFixed(0)}%)`);
            }
        }

        // ── 5. احتساب RRR والنسب النهائية ──
        const slDist = Math.abs(entryPrice - sl);
        const tpDist = Math.abs(tp - entryPrice);
        const rrr = slDist > 0 ? tpDist / slDist : 0;

        if (rrr < 1.45) {
            pending.push(`نسبة RRR ضعيفة: ${rrr.toFixed(2)}:1`);
        } else {
            completed.push(`نسبة RRR ممتازة: ${rrr.toFixed(2)}:1`);
        }

        confidence = Math.min(Math.max(confidence, 15), 97);
        const winRate = Math.min(50 + confidence * 0.48, 96);

        const readyToFire = (direction === 'LONG' || direction === 'SHORT') &&
            confidence >= 70 &&
            rrr >= 1.45 &&
            (marketRegime === 'SIDEWAYS_RANGE' || (completed.some(c => c.includes('منطقة الخصم')) || completed.some(c => c.includes('منطقة العلاوة'))));

        const signalReason = [
            `🏆 V11 Adaptive [${mode}]`,
            `النمط: ${marketRegime}`,
            `الشروط المكتملة: ${completed.length}`,
            `الشروط المنتظرة: ${pending.length}`,
            `العائد/المخاطرة RRR: ${rrr.toFixed(2)}:1`,
            `نسبة النجاح المتوقعة: ${winRate.toFixed(0)}%`,
        ].join(' | ');

        const status = readyToFire
            ? `${direction === 'LONG' ? '🟢 قناص صاعد' : '🔴 قناص هابط'} V11 (${winRate.toFixed(0)}%)`
            : `⏳ مراقبة قناص V11 (${completed.length} شروط مكتملة)`;

        return {
            status,
            type: direction,
            entry: entryPrice,
            tp,
            tp2,
            sl,
            timeEstimate: mode === 'SCALP' ? 30 : 240,
            winRate,
            reverseProb: 100 - winRate,
            confidenceScore: confidence,
            signalReason,
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

    private cancel(
        cp: number,
        status: string,
        mode: string,
        score: number,
        reason: string
    ): TradeRecommendation {
        return {
            status,
            type: 'NONE',
            entry: cp, tp: cp, sl: cp,
            timeEstimate: mode === 'SCALP' ? 30 : 240,
            winRate: 0,
            reverseProb: 0,
            confidenceScore: score,
            signalReason: reason,
        };
    }
}
