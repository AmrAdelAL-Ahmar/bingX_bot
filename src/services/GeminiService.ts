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
     * Internal helper to make a single REST call to Gemini API (no retry)
     */
    private static async callGeminiOnce(
        url: string,
        payload: any
    ): Promise<{ ok: boolean; status: number; data?: any; errorMessage?: string }> {
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        if (!response.ok) {
            const errData = await response.json().catch(() => ({}));
            return {
                ok: false,
                status: response.status,
                errorMessage: errData?.error?.message || response.statusText
            };
        }

        const data = await response.json();
        return { ok: true, status: response.status, data };
    }

    /**
     * Internal helper to make REST calls to Gemini API with automatic retry on 503/429
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

        const MAX_RETRIES = 3;
        const RETRYABLE_STATUSES = [429, 503];
        let lastError: Error | null = null;

        for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
            try {
                const result = await this.callGeminiOnce(url, payload);

                if (result.ok) {
                    const text = result.data?.candidates?.[0]?.content?.parts?.[0]?.text;
                    if (!text) {
                        throw new Error('عذراً، لم يقم نموذج الذكاء الاصطناعي بإرجاع رد صالح.');
                    }
                    return text;
                }

                // Retryable errors: overloaded (503) or rate limit (429)
                if (RETRYABLE_STATUSES.includes(result.status)) {
                    const waitMs = Math.pow(2, attempt - 1) * 1000; // 1s, 2s, 4s
                    logger.warn(
                        `Gemini API returned ${result.status} (attempt ${attempt}/${MAX_RETRIES}). ` +
                        `Retrying in ${waitMs / 1000}s... Reason: ${result.errorMessage}`
                    );
                    lastError = new Error(`Gemini API error: ${result.status} - ${result.errorMessage}`);
                    await new Promise(resolve => setTimeout(resolve, waitMs));
                    continue;
                }

                // Non-retryable error — throw immediately
                logger.error(`Gemini API request failed (${result.status}):`, result.errorMessage);
                throw new Error(`Gemini API error: ${result.status} - ${result.errorMessage}`);

            } catch (error: any) {
                // Re-throw immediately if it's a non-retryable error we just threw
                if (!RETRYABLE_STATUSES.some(s => error.message?.includes(String(s)))) {
                    logger.error('Error in callGemini:', error);
                    throw error;
                }
                lastError = error;
            }
        }

        // All retries exhausted
        logger.error(`Gemini API failed after ${MAX_RETRIES} attempts.`);
        throw lastError ?? new Error('فشل الاتصال بـ Gemini API بعد عدة محاولات. يرجى المحاولة لاحقاً.');
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

    /**
     * AI Fallback Signal Parser: parses unstructured or multilingual trade messages into structured JSON
     */
    static async parseSignalWithAI(message: string): Promise<any> {
        const prompt = `
أنت محلل إشارات تداول عالي الدقة (AI Signal Parser).
قم بتحليل نص التوصية التالي واستخرج بيانات الصفقة بدقة بصيغة JSON حصراً:

النص المراد تحليله:
"""
${message}
"""

القواعد:
1. الرمز Symbol: حوله إلى صيغة المنصة القياسية مثل "BTC-USDT" أو "BTC/USDT:USDT" أو "BTC".
2. الاتجاه Direction: LONG أو SHORT (شراء = LONG، بيع = SHORT).
3. نوع الإشارة Type: TRADE أو CLOSE.
4. الدخول Entry: مصفوفة أرقام [123.45].
5. الأهداف Targets: مصفوفة أرقام للأهداف [tp1, tp2...].
6. الوقف StopLoss: رقم مفرد.
7. الرافعة Leverage: رقم إن وجد أو 10 كافتراضي.

أرجع النتيجة بصيغة JSON فقط:
{
  "type": "TRADE",
  "symbol": "BTC-USDT",
  "direction": "LONG",
  "entry": [65000],
  "targets": [67000, 69000],
  "stopLoss": 63000,
  "leverage": 10
}
`;
        try {
            const responseText = await this.callGemini(prompt, 'You are an accurate JSON extractor for financial signals.');
            return this.parseJsonResponse<any>(responseText);
        } catch (e) {
            logger.error('AI Signal Parser failed:', e);
            return null;
        }
    }

    /**
     * AI Post-Mortem Advisor: analyzes closed trade performance and reasons for win/loss
     */
    static async analyzeTradePostMortem(tradeData: {
        symbol: string;
        direction: string;
        entryPrice: number;
        exitPrice: number;
        pnlPercent: number;
        outcome: 'PROFIT' | 'LOSS' | 'BREAKEVEN';
        engineId?: string;
        exitReason?: string;
    }): Promise<string> {
        const prompt = `
أنت كبير مستشاري التداول الكمي (Quant Trading Post-Mortem Advisor).
قم بمراجعة تشخيصية شاملة لصفقة مغلقة للتو وتقديم خلاصة مهنية ودروس مستفادة للمتداول:

بيانات الصفقة:
- الرمز: ${tradeData.symbol}
- الاتجاه: ${tradeData.direction}
- سعر الدخول: ${tradeData.entryPrice}
- سعر الخروج: ${tradeData.exitPrice}
- النتيجة: ${tradeData.outcome} (${tradeData.pnlPercent.toFixed(2)}%)
- المحرك المستخدم: ${tradeData.engineId || 'غير محدد'}
- سبب الإغلاق: ${tradeData.exitReason || 'ضرب الهدف / الوقف'}

المطلوب باللغة العربية بأسلوب احترافي مقتضب:
1. 🔍 **تشخيص الأداء**: هل كانت نقطة الدخول ملائمة لظروف السوق؟
2. ⚠️ **سبب النتيجة**: لماذا حققت الصفقة هدفها أو ضربت الوقف (تقلب لحظي، انعكاس اتجاه، أو كسر هيكل)؟
3. 💡 **الدرس المستفاد**: نصيحة عملية واحدة لتطوير الصفقات القادمة.
`;
        try {
            return await this.callGemini(prompt, ALGO_GUIDELINES);
        } catch (e) {
            logger.warn('AI Post-Mortem generation failed:', e);
            return 'تعذر توليد التقرير التحليلي التلقائي من نموذج الذكاء الاصطناعي.';
        }
    }
}
