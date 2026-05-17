// import { AnalysisDetails, MatrixResult, OHLCV, TradeRecommendation } from '../AnalysisService';
// import { ITradingEngine, EngineResult } from './ITradingEngine';
// import { TechnicalAnalyzer } from '../TechnicalAnalyzer';

// export class V3Engine implements ITradingEngine {
//     analyze(
//         cp: number, 
//         vwap: number, 
//         allTimeframes: Record<string, AnalysisDetails>, 
//         mtfOHLCV: Record<string, OHLCV[]>,
//         options: { quickTF: string, longTF: string }
//     ): EngineResult {
//         const matrix = this.calculateMatrix(allTimeframes);

//         const scalpData = allTimeframes[options.quickTF] || allTimeframes['5m'];
//         const swingData = allTimeframes[options.longTF] || allTimeframes['1h'];

//         return {
//             matrix,
//             scalp: this.analyzeScalp(cp, scalpData, matrix),
//             swing: this.analyzeSwing(cp, swingData, matrix)
//         };
//     }

//     private calculateMatrix(allTimeframes: Record<string, AnalysisDetails>): MatrixResult {
//         return TechnicalAnalyzer.calculateMatrix(allTimeframes);
//     }

//     private analyzeScalp(cp: number, data: AnalysisDetails, m: MatrixResult): TradeRecommendation {
//         return this.runMatrixLogic(cp, data, m);
//     }

//     private analyzeSwing(cp: number, data: AnalysisDetails, m: MatrixResult): TradeRecommendation {
//         return this.runMatrixLogic(cp, data, m);
//     }

//     private runMatrixLogic(cp: number, data: AnalysisDetails, m: MatrixResult): TradeRecommendation {
//         const type = m.percentage >= 50 ? 'LONG' : 'SHORT';
//         const winRate = Math.min(m.percentage + 10, 98);
//         const slDistance = Math.max(data.atr * 3, cp * 0.01);

//         const finalReason = `Matrix Score: ${m.percentage.toFixed(1)}% -> ${type}`;

//         return {
//             status: `🏛 V3 MATRIX ${type} ${m.decision}`,
//             type, entry: cp,
//             tp: type === 'LONG' ? cp + (slDistance * 2) : cp - (slDistance * 2),
//             sl: type === 'LONG' ? cp - slDistance : cp + slDistance,
//             timeEstimate: data.timeframe.includes('m') ? 60 : 240,
//             winRate, reverseProb: 100 - winRate,
//             confidenceScore: m.percentage,
//             signalReason: finalReason
//         };
//     }
// }
import { AnalysisDetails, MatrixResult, OHLCV, TradeRecommendation } from '../AnalysisService';
import { ITradingEngine, EngineResult } from './ITradingEngine';
import { TechnicalAnalyzer } from '../TechnicalAnalyzer';

export class V3Engine implements ITradingEngine {
    analyze(
        cp: number,
        vwap: number,
        allTimeframes: Record<string, AnalysisDetails>,
        mtfOHLCV: Record<string, OHLCV[]>,
        options: { quickTF: string, longTF: string }
    ): EngineResult {
        const matrix = this.calculateMatrix(allTimeframes);

        // استخراج بيانات الفريم اللحظي (السكالبينج) والفريم الأكبر (للتأكيد)
        const scalpData = allTimeframes[options.quickTF] || allTimeframes['5m'];
        const scalpOHLCV = mtfOHLCV[options.quickTF] || mtfOHLCV['5m'];
        const swingData = allTimeframes[options.longTF] || allTimeframes['1h'];
        const swingOHLCV = mtfOHLCV[options.longTF] || mtfOHLCV['1h'];

        // فريم التأكيد (Macro) للسكالب هو الساعة، وللسوينج هو 4 ساعات (إن وجد)
        const scalpMacroData = allTimeframes['1h'];
        const swingMacroData = allTimeframes['4h'];

        return {
            matrix,
            scalp: this.runProbabilityLogic(cp, scalpData, scalpOHLCV, scalpMacroData, vwap, matrix, 'SCALP'),
            swing: this.runProbabilityLogic(cp, swingData, swingOHLCV, swingMacroData, vwap, matrix, 'SWING')
        };
    }

    private calculateMatrix(allTimeframes: Record<string, AnalysisDetails>): MatrixResult {
        return TechnicalAnalyzer.calculateMatrix(allTimeframes);
    }

    private runProbabilityLogic(
        cp: number,
        data: AnalysisDetails,
        ohlcv: OHLCV[],
        macroData: AnalysisDetails | undefined,
        vwap: number,
        m: MatrixResult,
        mode: string
    ): TradeRecommendation {
        let score = 0;
        let reason: string[] = [];
        let type: 'LONG' | 'SHORT' | 'NEUTRAL' = 'NEUTRAL';

        // ==========================================
        // 1. طبقة فلتر الهيكل (Market Structure)
        // ==========================================
        const isBullishStruct = data.structure.includes('صاعد');
        const isBearishStruct = data.structure.includes('هابط');
        const isSideways = data.structure.includes('عرضي');

        // تحديد الاتجاه المبدئي بناءً على الهيكل
        if (isBullishStruct || (isSideways && cp > data.levels.pivot)) {
            type = 'LONG';
        } else if (isBearishStruct || (isSideways && cp < data.levels.pivot)) {
            type = 'SHORT';
        }

        // إذا كان الهيكل غير صالح للتداول
        if (type === 'NEUTRAL') {
            return this.createCancelResponse(cp, '⚪ محايد (هيكل غير واضح أو متضارب)', type, 0, mode);
        }

        // ==========================================
        // 2. طبقة درع الانحراف (Divergence Shield)
        // ==========================================
        const divergence = TechnicalAnalyzer.detectDivergence(ohlcv, type);
        if (divergence.detected) {
            // إلغاء الصفقة فوراً لتجنب فخ الانعكاس
            return this.createCancelResponse(cp, `⚠️ ملغاة: ${divergence.description}`, type, 0, mode);
        }

        // ==========================================
        // 3. تأكيد الفريم الأكبر (MTF Validation)
        // ==========================================
        if (macroData) {
            if (type === 'LONG') {
                if (macroData.structure.includes('هابط')) {
                    score -= 20; reason.push('تحذير: الفريم الأكبر هابط (-20)');
                } else if (macroData.structure.includes('صاعد')) {
                    score += 20; reason.push('توافق الهيكل مع الفريم الأكبر (+20)');
                }
            } else {
                if (macroData.structure.includes('صاعد')) {
                    score -= 20; reason.push('تحذير: الفريم الأكبر صاعد (-20)');
                } else if (macroData.structure.includes('هابط')) {
                    score += 20; reason.push('توافق الهيكل مع الفريم الأكبر (+20)');
                }
            }
        }

        // ==========================================
        // 4. دمج السيولة والزخم (VWAP & RSI)
        // ==========================================
        const isAboveVWAP = cp > vwap;
        if (type === 'LONG') {
            if (isAboveVWAP) { score += 15; reason.push('فوق VWAP (+15)'); }
            else { score -= 10; reason.push('تحت VWAP (-10)'); }

            if (data.rsi < 45 && cp > data.levels.s1) {
                score += 20; reason.push('RSI ارتداد من الدعم (+20)');
            } else if (data.rsi > 70) {
                score -= 20; reason.push('RSI تشبع شرائي خطير (-20)');
            }
        } else { // SHORT
            if (!isAboveVWAP) { score += 15; reason.push('تحت VWAP (+15)'); }
            else { score -= 10; reason.push('فوق VWAP (-10)'); }

            if (data.rsi > 55 && cp < data.levels.r1) {
                score += 20; reason.push('RSI ارتداد من المقاومة (+20)');
            } else if (data.rsi < 30) {
                score -= 20; reason.push('RSI تشبع بيعي خطير (-20)');
            }
        }

        // تأثير الماتريكس (مُخفف لتجنب التضارب)
        const matrixScore = (m.percentage - 50) * 0.5;
        score += matrixScore;
        reason.push(`الماتريكس ${m.percentage.toFixed(1)}% (${matrixScore > 0 ? '+' : ''}${matrixScore.toFixed(1)})`);

        // ==========================================
        // 5. الأهداف الديناميكية (Dynamic TP/SL & RR)
        // ==========================================
        let sl = 0, tp = 0;
        const safetyBuffer = data.atr * 0.5; // مسافة أمان إضافية لتجنب ضرب الاستوب العشوائي

        if (type === 'LONG') {
            // الاستوب تحت أدنى قاع سابق أو تحت مستوى دعم S2 (أيهما أأمن)
            sl = Math.min(data.levels.lastSwingLow - safetyBuffer, data.levels.s2);

            // الهدف عند المقاومة الأولى أو هدف الفيبوناتشي
            tp = Math.max(data.levels.r1, data.levels.fibTarget || (cp + data.atr * 3));

            // ضمان أن العائد مقابل المخاطرة (R/R) منطقي (1:1.5 على الأقل)
            const risk = cp - sl;
            const reward = tp - cp;
            if (reward < risk * 1.5) {
                tp = cp + (risk * 1.5);
                reason.push('تعديل TP لضمان نسبة 1:1.5 للمخاطرة');
            }
        } else {
            // SHORT
            sl = Math.max(data.levels.lastSwingHigh + safetyBuffer, data.levels.r2);
            tp = Math.min(data.levels.s1, data.levels.fib382 || (cp - data.atr * 3));

            const risk = sl - cp;
            const reward = cp - tp;
            if (reward < risk * 1.5) {
                tp = cp - (risk * 1.5);
                reason.push('تعديل TP لضمان نسبة 1:1.5 للمخاطرة');
            }
        }

        // ==========================================
        // 6. القرار النهائي وتقييم الصفقة
        // ==========================================
        const winRate = Math.max(0, Math.min(50 + (score * 0.8), 95));
        const finalReason = `Score: ${score.toFixed(1)} | Factors: [${reason.join(', ')}]`;

        // فلتر الأمان النهائي: عدم الدخول إذا كانت نسبة النجاح المتوقعة ضعيفة
        if (winRate < 60) {
            return this.createCancelResponse(cp, `⚪ إشارة ضعيفة (${winRate.toFixed(1)}%)`, type, score, mode, finalReason);
        }

        return {
            status: `${type === 'LONG' ? '🟢 شراء' : '🔴 بيع'} (${winRate.toFixed(1)}%)`,
            type, entry: cp, tp, sl,
            timeEstimate: mode === 'SCALP' ? 20 : 90,
            winRate, reverseProb: 100 - winRate,
            confidenceScore: score,
            signalReason: finalReason
        };
    }

    // دالة مساعدة لترتيب الردود الملغاة بشكل أنظف
    private createCancelResponse(cp: number, statusText: string, type: string, score: number, mode: string, reason: string = ''): TradeRecommendation {
        return {
            status: statusText,
            type: type as any, entry: cp, tp: cp, sl: cp,
            timeEstimate: mode === 'SCALP' ? 20 : 90,
            winRate: 0, reverseProb: 0,
            confidenceScore: score,
            signalReason: reason || 'لم تتحقق شروط الدخول'
        };
    }
}