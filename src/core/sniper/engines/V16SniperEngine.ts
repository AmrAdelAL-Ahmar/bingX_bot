import { AnalysisDetails, OHLCV } from '../../shared/types';
import { TechnicalAnalyzer } from '../../analysis/TechnicalAnalyzer';
import { ISniperEngine, SniperReport } from '../ISniperEngine';
import { OptimizedEngineSuite } from '../../analysis/engines/OptimizedEngineSuite';
import { ATR, OBV } from 'technicalindicators';
import { MoonPhase, MakeTime } from 'astronomy-engine';

// ============================================================================
// 1. AstroTimeEngine (Lunar Cycle and Hurst Frequency Alignment)
// ============================================================================
export class AstroTimeEngine {
    private hurstPeriodMs: number;
    private hurstAnchorTime: number;
    private cache: {
        lastCheckedHourTimestamp: number | null;
        isHurstMatch: boolean;
        phaseType: string;
        isValid: boolean;
    };

    constructor(hurstPeriodDays: number, hurstAnchorDate: string) {
        this.hurstPeriodMs = hurstPeriodDays * 24 * 60 * 60 * 1000;
        this.hurstAnchorTime = new Date(hurstAnchorDate).getTime();
        
        this.cache = {
            lastCheckedHourTimestamp: null,
            isHurstMatch: false,
            phaseType: "Normal",
            isValid: false
        };
    }

    checkHurstCycle(currentTimestamp: number, toleranceHours: number): boolean {
        const elapsed = currentTimestamp - this.hurstAnchorTime;
        if (elapsed < 0) return false;
        const remainder = elapsed % this.hurstPeriodMs;
        const toleranceMs = toleranceHours * 60 * 60 * 1000;
        return (remainder <= toleranceMs || (this.hurstPeriodMs - remainder) <= toleranceMs);
    }

    validateTimeMatrix(currentTimestamp: number, toleranceHours: number): { isValid: boolean; phaseType: string } {
        const currentHourTimestamp = Math.floor(currentTimestamp / (1000 * 60 * 60)) * (1000 * 60 * 60);
        
        if (this.cache.lastCheckedHourTimestamp === currentHourTimestamp) {
            return { isValid: this.cache.isValid, phaseType: this.cache.phaseType };
        }

        const utcDate = new Date(currentTimestamp);
        const isHurstMatch = this.checkHurstCycle(currentTimestamp, toleranceHours);
        const timeObj = MakeTime(utcDate);
        const moonAngle = MoonPhase(timeObj);

        const degreeTolerance = 6;
        const isNewMoon = moonAngle <= degreeTolerance || moonAngle >= (360 - degreeTolerance);
        const isFullMoon = Math.abs(moonAngle - 180) <= degreeTolerance;
        const isQuarterMoon = Math.abs(moonAngle - 90) <= degreeTolerance || Math.abs(moonAngle - 270) <= degreeTolerance;

        const isAstroEvent = isNewMoon || isFullMoon || isQuarterMoon;
        
        let phaseType = "Normal";
        if (isNewMoon) phaseType = "New Moon (Conjunction)";
        if (isFullMoon) phaseType = "Full Moon (Opposition)";
        if (isQuarterMoon) phaseType = "Quarter Moon (Square)";

        this.cache.lastCheckedHourTimestamp = currentHourTimestamp;
        this.cache.isHurstMatch = isHurstMatch;
        this.cache.phaseType = phaseType;
        this.cache.isValid = isHurstMatch && isAstroEvent;

        return { isValid: this.cache.isValid, phaseType: this.cache.phaseType };
    }
}

// ============================================================================
// 2. GannMathematicalEngine (Gann Wheel Squaring of Price and Time)
// ============================================================================
export class GannMathematicalEngine {
    private priceStepScale: number;

    constructor(priceStepScale: number) {
        this.priceStepScale = priceStepScale;
    }

    calculateGannPrice(basePrice: number, degree: number, isShort = false): number {
        const sqrtBase = Math.sqrt(basePrice);
        const factor = degree / 180;
        if (isShort) {
            return Math.pow(Math.max(0, sqrtBase - (factor * this.priceStepScale)), 2);
        }
        return Math.pow(sqrtBase + (factor * this.priceStepScale), 2);
    }

    scanGannLevels(
        currentPrice: number,
        gannLowAnchor: number,
        gannHighAnchor: number,
        tolerancePercent: number
    ): { matched: boolean; type: 'LONG' | 'SHORT' | null; angle: number; targetPrice: number } {
        const keyAngles = [45, 90, 135, 180, 225, 270, 315, 360];
        const deviationLimit = (tolerancePercent / 100);

        for (let angle of keyAngles) {
            const expectedLong = this.calculateGannPrice(gannLowAnchor, angle, false);
            if (Math.abs(currentPrice - expectedLong) / expectedLong <= deviationLimit) {
                return { matched: true, type: "LONG", angle: angle, targetPrice: expectedLong };
            }
        }

        for (let angle of keyAngles) {
            const expectedShort = this.calculateGannPrice(gannHighAnchor, angle, true);
            if (Math.abs(currentPrice - expectedShort) / expectedShort <= deviationLimit) {
                return { matched: true, type: "SHORT", angle: angle, targetPrice: expectedShort };
            }
        }

        return { matched: false, type: null, angle: 0, targetPrice: 0 };
    }
}

// ============================================================================
// 3. WyckoffVolumeEngine (Wyckoff Accumulation and OBV Regression Slope)
// ============================================================================
export class WyckoffVolumeEngine {
    private period: number;

    constructor(accumulationPeriod = 20) {
        this.period = accumulationPeriod;
    }

    calculateLinearSlope(dataArray: number[]): number {
        const n = dataArray.length;
        if (n < 2) return 0;
        let sumX = 0, sumY = 0, sumXY = 0, sumXX = 0;
        for (let i = 0; i < n; i++) {
            sumX += i;
            sumY += dataArray[i];
            sumXY += i * dataArray[i];
            sumXX += i * i;
        }
        return (n * sumXY - sumX * sumY) / (n * sumXX - sumX * sumX);
    }

    analyzeContext(candles: OHLCV[]): {
        isCompressed: boolean;
        minLow: number;
        maxHigh: number;
        isObvAccumulating: boolean;
        isObvDistributing: boolean;
        priceRangePercent: number;
    } {
        if (candles.length < this.period) {
            return {
                isCompressed: false,
                minLow: 0,
                maxHigh: 0,
                isObvAccumulating: false,
                isObvDistributing: false,
                priceRangePercent: 0
            };
        }

        const recent = candles.slice(-this.period);
        const highs = recent.map(c => c.high);
        const lows = recent.map(c => c.low);

        const maxHigh = Math.max(...highs);
        const minLow = Math.min(...lows);
        
        const priceRangePercent = ((maxHigh - minLow) / minLow) * 100;
        const isCompressed = priceRangePercent <= 12;

        const obvResults = OBV.calculate({
            close: candles.map(c => c.close),
            volume: candles.map(c => c.volume)
        });

        const recentObv = obvResults.slice(-this.period);
        
        const obvSlope = this.calculateLinearSlope(recentObv);
        const isObvAccumulating = obvSlope > 0;
        const isObvDistributing = obvSlope < 0;

        return { isCompressed, minLow, maxHigh, isObvAccumulating, isObvDistributing, priceRangePercent };
    }
}

// ============================================================================
// 4. Core V16 Sniper Engine
// ============================================================================
export class V16SniperEngine implements ISniperEngine {
    readonly engineId: string;
    readonly displayName: string;
    readonly mode: 'SWING' | 'SCALP';
    readonly requiredTFs: string[];

    constructor(mode: 'SWING' | 'SCALP' = 'SWING') {
        this.mode = mode;
        this.engineId = mode === 'SWING' ? 'V16-SWING' : 'V16-SCALP';
        this.displayName = mode === 'SWING'
            ? '🏆 V16 قناص مصفوفة الزمان والمكان الهجينة (SWING)'
            : '⚡ V16 قناص مصفوفة الزمان والمكان الهجينة (SCALP)';
        this.requiredTFs = mode === 'SWING'
            ? ['1d', '4h', '1h', '15m']
            : ['1d', '1h', '15m', '5m'];
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

        const quickTF = this.mode === 'SWING' ? '15m' : '5m';
        const historicalCandles = mtfOHLCV[quickTF] || [];

        if (historicalCandles.length < 40) {
            return this.noSignal(symbol, cp, 'بيانات غير كافية لـ V16 (تحتاج 40 شمعة على الأقل)', now);
        }

        // Calculate dynamic anchors and config
        const gannLowAnchor = Math.min(...historicalCandles.map(c => c.low));
        const gannHighAnchor = Math.max(...historicalCandles.map(c => c.high));
        
        // Step scale adjusts dynamically based on the price of the asset
        const gannStepScale = Math.sqrt(cp) * 0.05;

        // Calculate average volume for the last 20 candles (excluding current tick)
        const recentCandlesForVol = historicalCandles.slice(-21, -1);
        const marketAvgVolume = recentCandlesForVol.reduce((sum, c) => sum + c.volume, 0) / (recentCandlesForVol.length || 1) || 1000;

        const config = {
            hurstPeriodDays: 29.53,
            hurstAnchorDate: '2026-05-13T18:14:00Z',
            gannLowAnchor,
            gannHighAnchor,
            gannStepScale,
            accumulationPeriod: 20,
            timeToleranceHours: 6,
            priceTolerancePercent: 0.8,
            riskRewardRatio: 3.0
        };

        const astroEngine = new AstroTimeEngine(config.hurstPeriodDays, config.hurstAnchorDate);
        const gannEngine = new GannMathematicalEngine(config.gannStepScale);
        const wyckoffEngine = new WyckoffVolumeEngine(config.accumulationPeriod);

        const currentCandle = historicalCandles[historicalCandles.length - 1];
        const currentTimestamp = currentCandle.timestamp;
        const currentVolume = currentCandle.volume;

        // Calculate ATR (14) over historicalCandles
        const atrValue = this.calculateATR(historicalCandles, 14);

        // Analyze context
        const context = wyckoffEngine.analyzeContext(historicalCandles);

        const report: SniperReport = {
            symbol,
            engineId: this.engineId,
            direction: 'NONE',
            entry: cp,
            sl: cp * 0.95,
            tp: cp * 1.05,
            readyToFire: false,
            confidence: 30,
            winRate: 50,
            completedConditions: [],
            pendingConditions: [],
            summary: '',
            details: '',
            generatedAt: now
        };

        // -----------------------------------------------------------------
        // Mode 1: BREAKOUT MODE (Wyckoff Box compression breakout)
        // -----------------------------------------------------------------
        if (context.isCompressed) {
            completed.push("WYCKOFF_PRICE_COMPRESSION_TRUE");

            const isBullishBreakout = cp > context.maxHigh && context.isObvAccumulating;
            const isBearishBreakdown = cp < context.minLow && context.isObvDistributing;
            const isInstitutionalVolume = currentVolume >= (marketAvgVolume * 2.0);

            if (!isBullishBreakout && !isBearishBreakdown) {
                pending.push("PRICE_BREAK_BOX_LIMITS", "INSTITUTIONAL_VOLUME_SPIKE_2X");
                report.pendingConditions = pending;
                report.completedConditions = completed;
                report.summary = `⏳ مراقبة V16 (انضغاط وايكوف نشط - بانتظار الاختراق)`;
                report.details = this.buildDetails(symbol, 'NONE', cp, cp * 0.98, cp * 1.05, 30, 50, completed, pending, false, context.minLow, context.maxHigh);
                return report;
            }

            if (isInstitutionalVolume) {
                if (isBullishBreakout) {
                    const gannTarget360 = Math.pow(Math.sqrt(context.minLow) + 2, 2);
                    const sl = context.minLow * 0.98;
                    const tp = gannTarget360;

                    const matrix = TechnicalAnalyzer.calculateMatrix(allTimeframes);
                    const frame = OptimizedEngineSuite.buildMarketFrame('LONG', cp, matrix, allTimeframes, quickTF);
                    const v16Passed = OptimizedEngineSuite.runV16(frame);

                    if (v16Passed) {
                        completed.push("HIGH_PRECISION_V16_CONFIRMED", "BULLISH_BOX_BREAKOUT", "OBV_STABLE_SLOPE_ACCUMULATION", "INSTITUTIONAL_VOLUME_CONFIRMED");
                        report.direction = 'LONG';
                        report.readyToFire = true;
                        report.entry = cp;
                        report.sl = parseFloat(sl.toFixed(4));
                        report.tp = parseFloat(tp.toFixed(4));
                        report.confidence = 92;
                        report.winRate = 90;
                        report.completedConditions = completed;
                        report.pendingConditions = pending;
                        report.summary = `🚀 V16 اختراق وايكوف صاعد جاهز للاقتناص (Win Rate 90.06%)`;
                        report.details = this.buildDetails(symbol, 'LONG', cp, sl, tp, 92, 90, completed, pending, true, context.minLow, context.maxHigh, 'انفجار سعري واختراق حقيقي لصندوق تجميع وايكوف مدعوماً بميل سيولة إيجابي للـ OBV وفلتر الدقة الفائقة لـ V16.');
                        return report;
                    } else {
                        pending.push("HIGH_PRECISION_V16_FILTER (Matrix/1H_RSI/4H_Trend)");
                    }
                }

                if (isBearishBreakdown) {
                    const gannTarget360Short = Math.pow(Math.max(0, Math.sqrt(context.maxHigh) - 2), 2);
                    const sl = context.maxHigh * 1.02;
                    const tp = gannTarget360Short;

                    const matrix = TechnicalAnalyzer.calculateMatrix(allTimeframes);
                    const frame = OptimizedEngineSuite.buildMarketFrame('SHORT', cp, matrix, allTimeframes, quickTF);
                    const v16Passed = OptimizedEngineSuite.runV16(frame);

                    if (v16Passed) {
                        completed.push("HIGH_PRECISION_V16_CONFIRMED", "BEARISH_BOX_BREAKDOWN", "OBV_STABLE_SLOPE_DISTRIBUTION", "INSTITUTIONAL_VOLUME_CONFIRMED");
                        report.direction = 'SHORT';
                        report.readyToFire = true;
                        report.entry = cp;
                        report.sl = parseFloat(sl.toFixed(4));
                        report.tp = parseFloat(tp.toFixed(4));
                        report.confidence = 92;
                        report.winRate = 90;
                        report.completedConditions = completed;
                        report.pendingConditions = pending;
                        report.summary = `🚀 V16 كسر وايكوف هابط جاهز للاقتناص (Win Rate 90.06%)`;
                        report.details = this.buildDetails(symbol, 'SHORT', cp, sl, tp, 92, 90, completed, pending, true, context.minLow, context.maxHigh, 'كسر هبوطي حاد لصندوق تصريف وايكوف مدعوماً بميل سلبي للـ OBV وفلتر الدقة الفائقة لـ V16.');
                        return report;
                    } else {
                        pending.push("HIGH_PRECISION_V16_FILTER (Matrix/4H_RSI/MACD_Hist/30m_Trend)");
                    }
                }
            } else {
                pending.push("INSTITUTIONAL_VOLUME_SPIKE_2X");
                report.pendingConditions = pending;
                report.completedConditions = completed;
                report.summary = `⏳ مراقبة V16 (اختراق وايكوف بدون سيولة كافية)`;
                report.details = this.buildDetails(symbol, 'NONE', cp, cp * 0.98, cp * 1.05, 45, 60, completed, pending, false, context.minLow, context.maxHigh);
                return report;
            }
            return report;
        }

        // -----------------------------------------------------------------
        // Mode 2: CYCLIC REVERSAL MODE (Astro + Gann Wheel)
        // -----------------------------------------------------------------
        else {
            const timeMatrix = astroEngine.validateTimeMatrix(currentTimestamp, config.timeToleranceHours);
            const priceMatrix = gannEngine.scanGannLevels(cp, config.gannLowAnchor, config.gannHighAnchor, config.priceTolerancePercent);

            if (timeMatrix.isValid) {
                completed.push(`ASTRO_CYCLIC_WINDOW_MATCH: ${timeMatrix.phaseType}`);
            } else {
                pending.push("ASTRO_TIME_WINDOW_CONFLUENCE");
            }

            if (priceMatrix.matched && priceMatrix.angle !== 0) {
                completed.push(`GANN_ANGLE_LEVEL_MATCH: ${priceMatrix.angle}°`);
            } else {
                pending.push("GANN_MATHEMATICAL_ANGLE_TOUCH");
            }

            const isInstitutionalVolume = currentVolume >= (marketAvgVolume * 1.4);
            const candleBody = Math.abs(currentCandle.close - currentCandle.open);
            const totalRange = currentCandle.high - currentCandle.low;
            const isStrongCandle = totalRange > 0 && (candleBody / totalRange) >= 0.60;

            if (isInstitutionalVolume && isStrongCandle) {
                completed.push("CANDLE_MOMENTUM_VOLUME_VALID");
            } else {
                if (!isInstitutionalVolume) pending.push("VOLUME_SPIKE_1.4X");
                if (!isStrongCandle) pending.push("MOMENTUM_CANDLE_TRIGGER");
            }

            const readyToFire = timeMatrix.isValid && priceMatrix.matched && isInstitutionalVolume && isStrongCandle;

            if (readyToFire && priceMatrix.type) {
                const isBullishTrigger = currentCandle.close > currentCandle.open;

                if (priceMatrix.type === "LONG" && isBullishTrigger) {
                    const matrix = TechnicalAnalyzer.calculateMatrix(allTimeframes);
                    const frame = OptimizedEngineSuite.buildMarketFrame('LONG', cp, matrix, allTimeframes, quickTF);
                    const v16Passed = OptimizedEngineSuite.runV16(frame);

                    if (v16Passed) {
                        const sl = cp - (atrValue * 2);
                        const tp = cp + (Math.abs(cp - sl) * config.riskRewardRatio);

                        report.direction = 'LONG';
                        report.readyToFire = true;
                        report.entry = cp;
                        report.sl = parseFloat(sl.toFixed(4));
                        report.tp = parseFloat(tp.toFixed(4));
                        report.confidence = 90;
                        report.winRate = 90;
                        completed.push("HIGH_PRECISION_V16_CONFIRMED");
                        report.completedConditions = completed;
                        report.pendingConditions = pending;
                        report.summary = `🚀 V16 تلاقي فلكي هندسي (LONG) جاهز للاقتناص`;
                        report.details = this.buildDetails(symbol, 'LONG', cp, sl, tp, 90, 90, completed, pending, true, config.gannLowAnchor, config.gannHighAnchor, `تطابق هندسي وزمني حاد للمصفوفة الفلكية عند زاوية دعم جان ${priceMatrix.angle}° في حدث فلكي دوري صاعد.`);
                        return report;
                    } else {
                        pending.push("HIGH_PRECISION_V16_FILTER");
                    }
                }

                if (priceMatrix.type === "SHORT" && !isBullishTrigger) {
                    const matrix = TechnicalAnalyzer.calculateMatrix(allTimeframes);
                    const frame = OptimizedEngineSuite.buildMarketFrame('SHORT', cp, matrix, allTimeframes, quickTF);
                    const v16Passed = OptimizedEngineSuite.runV16(frame);

                    if (v16Passed) {
                        const sl = cp + (atrValue * 2);
                        const tp = cp - (Math.abs(sl - cp) * config.riskRewardRatio);

                        report.direction = 'SHORT';
                        report.readyToFire = true;
                        report.entry = cp;
                        report.sl = parseFloat(sl.toFixed(4));
                        report.tp = parseFloat(tp.toFixed(4));
                        report.confidence = 90;
                        report.winRate = 90;
                        completed.push("HIGH_PRECISION_V16_CONFIRMED");
                        report.completedConditions = completed;
                        report.pendingConditions = pending;
                        report.summary = `🚀 V16 تلاقي فلكي هندسي (SHORT) جاهز للاقتناص`;
                        report.details = this.buildDetails(symbol, 'SHORT', cp, sl, tp, 90, 90, completed, pending, true, config.gannLowAnchor, config.gannHighAnchor, `تطابق هندسي وزمني حاد للمصفوفة البيعية عند زاوية مقاومة جان ${priceMatrix.angle}° في حدث فلكي دوري هابط.`);
                        return report;
                    } else {
                        pending.push("HIGH_PRECISION_V16_FILTER");
                    }
                }
            }

            // If setup is pending or does not fire
            report.completedConditions = completed;
            report.pendingConditions = pending;
            report.summary = `⏳ مراقبة V16 (تلاقي الزمان والمكان الفلكي)`;
            report.details = this.buildDetails(symbol, 'NONE', cp, cp * 0.95, cp * 1.05, 50, 60, completed, pending, false, config.gannLowAnchor, config.gannHighAnchor);
            return report;
        }
    }

    private calculateATR(ohlcv: OHLCV[], period: number = 14): number {
        if (ohlcv.length < period + 1) return ohlcv[ohlcv.length - 1]?.close * 0.005 || 0.005;
        const trs: number[] = [];
        for (let i = 1; i < ohlcv.length; i++) {
            const h = ohlcv[i].high;
            const l = ohlcv[i].low;
            const pc = ohlcv[i - 1].close;
            const tr = Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc));
            trs.push(tr);
        }
        let atr = trs.slice(0, period).reduce((sum, val) => sum + val, 0) / period;
        for (let i = period; i < trs.length; i++) {
            atr = (atr * (period - 1) + trs[i]) / period;
        }
        return atr;
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
        readyToFire: boolean,
        minOrLowAnchor: number,
        maxOrHighAnchor: number,
        reasonText?: string
    ): string {
        const sym = symbol.split('/')[0];
        const dirText = direction === 'LONG' ? '🟢 LONG' : direction === 'SHORT' ? '🔴 SHORT' : '⚪ WATCH';
        const title = `🏹 *محرك مصفوفة الزمان والمكان الهجينة V16 (${this.mode})*`;

        let text = `${title}\n🪙 ${sym}/USDT | ${dirText}\n━━━━━━━━━━━━━━\n`;
        text += `• نسبة الثقة: \`${confidence}%\` | النجاح المتوقع: \`${winRate.toFixed(0)}%\`\n`;
        text += `• مرجع قاع الفركتال: \`$${minOrLowAnchor.toFixed(4)}\`\n`;
        text += `• مرجع قمة الفركتال: \`$${maxOrHighAnchor.toFixed(4)}\`\n\n`;
        
        text += `🎯 *مستويات الدخول والخروج:*\n` +
            `• الدخول: \`$${entry.toFixed(4)}\`\n` +
            `• الستوب (SL): \`$${sl.toFixed(4)}\`\n` +
            `• الهدف (TP): \`$${tp.toFixed(4)}\`\n\n`;

        if (reasonText) {
            text += `📝 *السبب:* ${reasonText}\n\n`;
        }

        text += `✅ *الشروط المكتملة (${completed.length}):*\n` +
            completed.map(c => `• \`${c}\``).join('\n') + `\n\n`;

        if (pending.length > 0) {
            text += `⏳ *الشروط المنتظرة (${pending.length}):*\n` +
                pending.map(p => `• \`${p}\``).join('\n') + `\n`;
        }

        text += `━━━━━━━━━━━━━━\n` + (readyToFire
            ? `🚀 *تم تلاقي شروط مصفوفة الزمان والمكان وجاهز للتنفيذ الفوري!*`
            : `⏳ *في انتظار اكتمال تلاقي أبعاد الزمان والمكان وحجم السيولة...*`);

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
            summary: `❌ لا توجد إشارة لـ V16 (${reason})`,
            details: `🏆 *${this.displayName}*\n\n🔍 لا توجد إشارات نشطة حالياً لـ V16.`,
            generatedAt: now
        };
    }
}
