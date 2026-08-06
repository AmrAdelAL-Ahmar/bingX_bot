import logger from '../utils/logger';

const ALGO_GUIDELINES = `
You are an expert AI trading strategist for the "Sniper Bot" platform. You have detailed knowledge of the platform's 16 mathematical trading engines:
- V1 (Basic/Scoring): Simple score based on price vs VWAP, Matrix, and RSI.
- V2 (Quant): Money Flow Index (MFI) focused. Oversold MFI < 30 triggers LONG, overbought MFI > 70 triggers SHORT.
- V3 (Matrix Consensus): Agreeing trends (SMA 20) across 7 timeframes (Matrix percentage > 55% for LONG, < 45% for SHORT).
- V4 (Bi-Directional): Crossover of fast SMA 7 and slow SMA 20 on scalp and swing separately.
- V5 (AI Linear Regression): Uses linear regression slope of last 50 candles to predict direction and confidence.
- V6 (Sniper Pro): Separation of Scalp/Swing, breakout check of last 15 candles (Swing High/Low breakout), vetoes entries on divergence.
- V7 (Hybrid Sniper): Daily bias (SMA 50/200) -> Meso (OB + Fibonacci 0.618-0.886) -> Micro trigger (RSI divergence + MSS structural breakout).
- V8 (Wave & Liquidity Sweep): Wave trading with EMA 50/200, liquidity sweeps on wick highs/lows, confirmed by volume spikes and Stoch RSI.
- V9 (SMC Smart Order Block & FVG): Market structure (BOS/CHOCH) on multiple timeframes, finding OB and Fair Value Gaps (FVG).
- V10 (Institutional Advanced): SMC (OB + FVG) + Volume Profile (POC) + Heikin-Ashi candles for MSS + SuperTrend filter + Linear Regression.
- V11 (Adaptive Decision & Regime): KAMA filter, automatic switching between SMC (trending markets) and oscillators/Bollinger Bands (ranging markets). Deep discount entry (0.618-0.786 Fibonacci).
- V12 (Order Flow & CVD): Cumulative Volume Delta (CVD) analysis. Detects delta divergence, order block volume spikes (Volume >= meanVolume20 + 1.0 * stdDevVolume20), and equilibrium entries.
- V13 (Wyckoff & Liquidity Sweep): Wyckoff spring/upthrust detection (bottom/top wick ratio >= 50%), Ask/Bid imbalance (BuyVolume/SellVolume >= 3.0), and CVD delta acceleration.
- V14 (Adaptive Renko Cloud): Dynamic Renko brick sizes using Daily ATR, Ichimoku cloud filter, and Kaufman Efficiency Ratio (ER >= 0.60).
- V15 (Quant Harmonic & Chan Pen): Chan Pen (笔) structures, harmonic Bat pattern detection targeting 88.6% PRZ (XABCD retracements), verified by RSI divergence and DXY trend.
- V16 (Master Hybrid Matrix): Wyckoff compression breakouts, Gann angles (180°/360°), Hurst cycle timing, and lunar phase cycles (New/Full Moon confluences) for explosive breakouts.
`;

export interface AiTradeSignal {
    direction: 'LONG' | 'SHORT' | 'NONE';
    entry: number;
    tp: number[];
    sl: number;
    justification: string;
    confidence: number;
}

export interface AiOptimizationResult {
    proposedParams: Record<string, any>;
    expectedRoiIncrease: string;
    explanation: string;
}

export class GeminiService {
    private static getApiKey(): string {
        return process.env.GEMINI_API_KEY || '';
    }

    /**
     * Internal helper to make REST calls to Gemini API
     */
    private static async callGemini(prompt: string, systemInstruction?: string): Promise<string> {
        const apiKey = this.getApiKey();
        if (!apiKey) {
            throw new Error('⚠️ لم يتم العثور على مفتاح GEMINI_API_KEY في ملف الـ .env. يرجى إضافته لاستخدام الذكاء الاصطناعي.');
        }

        const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent?key=${apiKey}`;

        const payload: any = {
            contents: [{
                parts: [{ text: prompt }]
            }],
            generationConfig: {
                temperature: 0.2,
                topP: 0.95,
                maxOutputTokens: 2548
            }
        };

        if (systemInstruction) {
            payload.systemInstruction = {
                parts: [{ text: systemInstruction }]
            };
        }

        try {
            const response = await fetch(url, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(payload)
            });

            if (!response.ok) {
                const errData = await response.json().catch(() => ({}));
                logger.error('Gemini API request failed:', response.statusText, errData);
                throw new Error(`Gemini API error: ${response.status} - ${errData?.error?.message || response.statusText}`);
            }

            const data = await response.json();
            const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
            if (!text) {
                throw new Error('عذراً، لم يقم نموذج الذكاء الاصطناعي بإرجاع رد صالح.');
            }

            return text;
        } catch (error: any) {
            logger.error('Error in callGemini:', error);
            throw error;
        }
    }

    /**
     * Parses JSON safely from markdown or plain text returned by AI
     */
    private static parseJsonResponse<T>(text: string): T {
        try {
            // Remove markdown wrappers if any
            let clean = text.replace(/```json/i, '').replace(/```/g, '').trim();
            return JSON.parse(clean) as T;
        } catch (err) {
            logger.error('Failed to parse JSON response from Gemini:', text);
            throw new Error('فشل في معالجة استجابة الذكاء الاصطناعي بصيغة JSON.');
        }
    }

    /**
     * Runs AI Single Engine analysis on indicators and signal
     */
    static async generateEngineAiAnalysis(
        engineId: string,
        symbol: string,
        currentPrice: number,
        analysisResult: any
    ): Promise<string> {
        const prompt = `
تحليل فني باستخدام الذكاء الاصطناعي لرمز العملة: ${symbol}
المحرك المستخدم: ${engineId}
السعر الحالي: $${currentPrice}

نتائج المحرك الحالية:
- السكالبينج: ${analysisResult.scalp?.type || 'NONE'} (سعر الدخول المقترح: ${analysisResult.scalp?.entry || 'لا يوجد'}, الستوب: ${analysisResult.scalp?.sl || 'لا يوجد'}, الهدف: ${analysisResult.scalp?.tp || 'لا يوجد'})
- السوينج: ${analysisResult.swing?.type || 'NONE'} (سعر الدخول المقترح: ${analysisResult.swing?.entry || 'لا يوجد'}, الستوب: ${analysisResult.swing?.sl || 'لا يوجد'}, الهدف: ${analysisResult.swing?.tp || 'لا يوجد'})
- قوة التوافق الإجمالية (Matrix): ${analysisResult.matrix?.percentage || 0}%
- حالة الزخم السريع (RSI فريم صغير): ${analysisResult.scalp?.rsi || 'غير متوفر'}
- اتجاه الفريم السريع: ${analysisResult.scalp?.structure || 'غير معروف'}
- اتجاه الفريم الكبير: ${analysisResult.swing?.structure || 'غير معروف'}

الرجاء تقديم تحليل فني دقيق باللغة العربية بناءً على قوانين المحرك ${engineId}:
1. هل شروط دخول الصفقة قوية وآمنة وفقاً لمعطيات المؤشرات؟
2. ما هي التنبيهات أو المخاطر المحتملة (انحرافات، عدم توافق السيولة، إلخ)؟
3. التوصية النهائية للمتداول: (تأكيد الدخول / الانتظار / تجنب الدخول بالكامل).

اجعل التقرير منسقاً ومنظماً ومكتوباً بأسلوب احترافي مشوق باللغة العربية مع استخدام الرموز التعبيرية (Emojis).
`;

        return this.callGemini(prompt, ALGO_GUIDELINES);
    }

    /**
     * Standalone Comprehensive Analysis: synthesizes all engines + sniper results to find the absolute best setup
     */
    static async generateComprehensiveAnalysis(
        symbol: string,
        currentPrice: number,
        pricePrecision: number,
        allEngineResults: { engineId: string; analysisResult: any }[],
        allSniperResults: { engineId: string; sniperReport: any }[]
    ): Promise<AiTradeSignal> {
        // Prepare simplified summary of all engines to fit token space
        const simplifiedEngines = allEngineResults.map(r => ({
            engine: r.engineId,
            scalp: r.analysisResult.scalp?.type || 'NONE',
            swing: r.analysisResult.swing?.type || 'NONE',
            matrix: r.analysisResult.matrix?.percentage || 0
        }));

        const simplifiedSnipers = allSniperResults.map(s => ({
            engine: s.engineId,
            direction: s.sniperReport?.direction || 'NONE',
            readyToFire: s.sniperReport?.readyToFire || false,
            confidence: s.sniperReport?.confidence || 0
        }));

        const prompt = `
أنت رئيس المحللين الكميين في صندوق استثمار. الرجاء دراسة نتائج 16 محرك تحليل فني ومحركات القنص الموحدة لعملة ${symbol} عند السعر الحالي: $${currentPrice}.

بيانات نتائج المحركات الفنية:
${JSON.stringify(simplifiedEngines, null, 2)}

بيانات نتائج محركات القنص:
${JSON.stringify(simplifiedSnipers, null, 2)}

الرجاء تحليل هذه البيانات بذكاء، واستخلاص التوافق الأكبر (Confluence) لتوليد إشارة تداول ذهبية موحدة.
يجب أن ترجع استجابتك بصيغة JSON حصراً، دون أي كلام قبله أو بعده، بالهيكل التالي:
{
  "direction": "LONG" | "SHORT" | "NONE",
  "entry": رقم سعر الدخول المقترح بدقة,
  "tp": [مصفوفة تحتوي على 3 أهداف صعوداً/هبوطاً كأرقام],
  "sl": رقم وقف الخسارة المقترح بدقة,
  "justification": "شرح وتحليل فني مفصل باللغة العربية يلخص سبب الاختيار بناءً على التوافق بين المدارس الفنية كوايكوف وSMC والهارمونيك والـ CVD والأحجام وغيرها",
  "confidence": نسبة مئوية تمثل ثقتك بالصفقة من 0 إلى 100
}

تنبيهات هامة:
- سعر الدخول والأهداف والاستوب لابد أن تكون أرقاماً متسقة رياضياً مع السعر الحالي $${currentPrice}.
- إذا كانت اتجاهات المحركات مشتتة أو متعارضة بنسبة كبيرة، اختر "direction": "NONE".
`;

        const responseText = await this.callGemini(prompt, ALGO_GUIDELINES);
        return this.parseJsonResponse<AiTradeSignal>(responseText);
    }

    /**
     * Analyzes closed trades from backtests/live to explain hits and suggest math corrections
     */
    static async analyzeBacktestHits(
        symbol: string,
        version: string,
        stats: any,
        sampleTrades: any[]
    ): Promise<string> {
        // Filter and simplify sample trades to reduce tokens
        const simplifiedTrades = sampleTrades.slice(0, 10).map(t => ({
            type: t.type,
            entry: t.entry,
            tp: t.tp,
            sl: t.sl,
            status: t.status,
            pnlPercent: t.pnlPercent,
            reason: t.signalReason,
            entryDate: t.entryDate,
            closeDate: t.closeDate,
            duration: t.durationMinutes,
            context: {
                matrix: t.analysisContext?.matrixScore,
                quick_rsi: t.analysisContext?.quick_rsi,
                quick_trend: t.analysisContext?.quick_trend,
                long_trend: t.analysisContext?.long_trend,
                quick_atr: t.analysisContext?.quick_atr
            }
        }));

        const prompt = `
مطلوب تحليل نتائج الاختبار الرجعي (Backtest) لعملة ${symbol} باستخدام خوارزمية المحرك: ${version}.

إحصائيات الأداء الحالية:
- إجمالي الصفقات: ${stats.total || 0}
- نسبة النجاح (Win Rate): ${stats.winRate?.toFixed(1) || '0'}%
- العائد على الاستثمار (ROI): ${stats.roi?.toFixed(2) || '0'}%
- أقصى تراجع (Max Drawdown): ${stats.maxDrawdown?.toFixed(2) || '0'}%
- صفقات الرابحة: ${stats.totalWins || 0} | صفقات الخاسرة: ${stats.totalLosses || 0}

عينة من الصفقات المغلقة (تشمل المؤشرات الفنية عند الدخول):
${JSON.stringify(simplifiedTrades, null, 2)}

الرجاء تحليل هذه البيانات هندسياً ورياضياً واكتب تقريراً باللغة العربية يوضح:
1. **لماذا ضربت الصفقات الخاسرة وقف الخسارة (SL)؟** (هل بسبب تذبذب شديد، وقف خسارة ضيق جداً مقارنة بـ ATR، دخول خاطئ ضد الاتجاه العام، أم فخاخ سيولة؟).
2. **لماذا ضربت الصفقات الناجحة الأهداف (TP)؟** ما الذي جعل نقاط الدخول ممتازة؟
3. **نصائح لتعديل المعادلات الحسابية وطريقة التحليل**: قدم اقتراحات ملموسة ورياضية لتعديل محددات المحرك ${version} (مثال: زيادة معامل ضرب ATR، تعديل شروط RSI، تصفية الدخول باتجاه الترند اليومي فقط، تعديل نسبة كسر القمة، إلخ) لتحسين الأداء.

اجعل التقرير منسقاً وسهلاً في القراءة للمتداول.
`;

        return this.callGemini(prompt, ALGO_GUIDELINES);
    }

    /**
     * Proposes parameter optimization values for the next backtest loop run
     */
    static async optimizeEngineParameters(
        symbol: string,
        version: string,
        stats: any,
        sampleTrades: any[]
    ): Promise<AiOptimizationResult> {
        // Filter and simplify sample trades
        const simplifiedTrades = sampleTrades.slice(0, 10).map(t => ({
            type: t.type,
            entry: t.entry,
            tp: t.tp,
            sl: t.sl,
            status: t.status,
            pnlPercent: t.pnlPercent,
            reason: t.signalReason,
            context: {
                matrix: t.analysisContext?.matrixScore,
                quick_rsi: t.analysisContext?.quick_rsi,
                quick_atr: t.analysisContext?.quick_atr
            }
        }));

        const prompt = `
أنت مهندس خوارزميات كمي (Quantitative Algorithm Optimizer).
مطلوب منك اقتراح قيم متغيرات جديدة وحاسمة لتحسين أداء خوارزمية التداول ${version} على عملة ${symbol} بناءً على عينة الصفقات والنتائج الحالية.

إحصائيات الأداء Baseline:
- نسبة النجاح الحالية: ${stats.winRate?.toFixed(1) || '0'}%
- العائد ROI الحالي: ${stats.roi?.toFixed(2) || '0'}%
- أقصى تراجع: ${stats.maxDrawdown?.toFixed(2) || '0'}%

عينة صفقات:
${JSON.stringify(simplifiedTrades, null, 2)}

الرجاء تقديم قيم معاملات محسنة لإعادة تشغيل الاختبار الفني عليها.
يمكنك تحسين معاملات عامة للاختبار (كـ leverage و maxSlPercentage و quickTF و longTF) أو معاملات مخصصة داخل المحرك (مثل rsiThreshold, meanVolMultiplier, volumeSpikeMultiplier, atrMultiplier, minImpulse).

أرجع النتيجة بصيغة JSON حصراً، دون أي كود ماركداون خارجي، بالهيكل التالي:
{
  "proposedParams": {
    "leverage": 15,
    "maxSlPercentage": 3.5,
    "rsiThreshold": 25,
    "atrMultiplier": 2.5,
    "minImpulse": 0.0035
  },
  "expectedRoiIncrease": "+8.5% ROI (أو أي توقع تقريبي مبني على الدراسة)",
  "explanation": "شرح مفصل باللغة العربية للسبب الذي يجعلك تعتقد أن هذه المتغيرات ستحسن أداء البوت وتقلل الخسائر"
}
`;

        const responseText = await this.callGemini(prompt, ALGO_GUIDELINES);
        return this.parseJsonResponse<AiOptimizationResult>(responseText);
    }
}
