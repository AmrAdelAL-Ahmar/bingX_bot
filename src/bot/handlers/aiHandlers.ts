import { Telegraf } from 'telegraf';
import logger from '../../utils/logger';
import User from '../../models/User';
import { BingXService } from '../../services/BingXService';
import { AnalysisService } from '../../services/AnalysisService';
import { BacktestService } from '../../services/BacktestService';
import { TradeManager } from '../../services/TradeManager';
import { GeminiService, AiTradeSignal } from '../../services/GeminiService';
import { CoreAnalysisService } from '../../core/analysis/CoreAnalysisService';
import { CoreSniperScanner } from '../../core/sniper/CoreSniperScanner';
import { getSniperEngine, SNIPER_ENGINES } from '../../core/sniper/SniperRegistry';
import { MATRIX_TFS } from '../../core/analysis/TechnicalAnalyzer';
import { getMainMenuKeyboard } from '../keyboards/baseKeyboards';
import { getAlgoVersionKeyboard } from '../keyboards/analysisKeyboards';
import { OHLCV } from '../../core/shared/types';

function markdownToHtml(text: string): string {
    let html = text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');

    // Code blocks
    html = html.replace(/```(?:[a-zA-Z0-9]+)?\n([\s\S]*?)```/g, '<pre>$1</pre>');

    // Inline code
    html = html.replace(/`([^`]+)`/g, '<code>$1</code>');

    // Bold
    html = html.replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>');

    // Italic
    html = html.replace(/\*(?=\S)([^*]+?)(?<=\S)\*/g, '<i>$1</i>');

    // Headers
    html = html.replace(/^###+\s+(.+)$/gm, '<b>$1</b>');
    html = html.replace(/^##+\s+(.+)$/gm, '<b>$1</b>');
    html = html.replace(/^#+\s+(.+)$/gm, '<b>$1</b>');

    return html;
}

// In-memory cache for pending AI signals and optimization states
interface AiSession {
    comprehensiveSignal?: AiTradeSignal;
    optimizedParams?: Record<string, any>;
    optEngine?: string;
    optSymbol?: string;
    optMode?: 'SCALP' | 'SWING';
    optDays?: number;
    optInterval?: string;
}

const aiSessions: Record<string, AiSession> = {};

function getSession(telegramId: string): AiSession {
    if (!aiSessions[telegramId]) {
        aiSessions[telegramId] = {};
    }
    return aiSessions[telegramId];
}

export const registerAiHandlers = (
    bot: Telegraf,
    tradeManager: TradeManager
) => {
    const bingxService = new BingXService();
    const analysisService = new AnalysisService(bingxService);
    const backtestService = new BacktestService(bingxService, analysisService);

    // --- 1. standalone: Comprehensive AI Analysis (التحليل الشامل بالذكاء) ---
    bot.hears('🧠 التحليل الشامل بالذكاء', async (ctx) => {
        try {
            const telegramId = ctx.from!.id.toString();
            const user = await User.findOne({ telegramId });
            if (!user) return ctx.reply('❌ مستخدم غير مسجل.');

            user.botState = 'AWAITING_AI_COMP_SYMBOL';
            await user.save();

            return ctx.reply('✏️ **يرجى إرسال رمز العملة للتحليل الشامل بالذكاء الاصطناعي**\n\n(مثال: `BTC` أو `ETH`):', {
                reply_markup: {
                    keyboard: [[{ text: 'رجوع 🔙' }]],
                    resize_keyboard: true
                }
            });
        } catch (error) {
            logger.error('Error in hears 🧠 التحليل الشامل بالذكاء:', error);
        }
    });

    // --- 2. standalone: AI Engine Test & Optimize (اختبار وتحسين المحركات) ---
    bot.hears('🧠 اختبار وتحسين المحركات', async (ctx) => {
        try {
            const telegramId = ctx.from!.id.toString();
            const user = await User.findOne({ telegramId });
            if (!user) return ctx.reply('❌ مستخدم غير مسجل.');

            user.botState = 'AWAITING_AI_OPT_ENGINE';
            await user.save();

            return ctx.reply('🎯 **يرجى اختيار إصدار الخوارزمية التي تود اختبارها وتحسينها بالذكاء:**', {
                reply_markup: getAlgoVersionKeyboard()
            });
        } catch (error) {
            logger.error('Error in hears 🧠 اختبار وتحسين المحركات:', error);
        }
    });

    // --- 3. Callback: Single-Engine AI Analysis (التحليل بالذكاء لمحرك محدد) ---
    bot.action(/^ai_an_(sc|sw)_([^_]+)_(.+)$/, async (ctx) => {
        try {
            const [_, modeType, s, version] = ctx.match;
            const symbol = `${s}/USDT:USDT`;

            await ctx.answerCbQuery('🧠 جاري إرسال البيانات للتحليل الفني بالذكاء...');
            await ctx.reply(`🔍 جاري قياس قيم المؤشرات وتحليل معادلات ${version} لعملة ${symbol} باستخدام Gemini...`);

            const user = await User.findOne({ telegramId: ctx.from!.id.toString() });
            const res = await analysisService.analyze(symbol, version as any, {
                quickTF: user?.analysisSettings?.scalpTF,
                longTF: user?.analysisSettings?.swingTF,
                antiRepainting: user?.analysisSettings?.antiRepaintingEnabled
            });

            const aiReport = await GeminiService.generateEngineAiAnalysis(version, symbol, res.currentPrice, res);

            // Send report with executable actions if engine generated a signal
            const scalpOrSwing = modeType === 'sc' ? 'scalp' : 'swing';
            const sig = res[scalpOrSwing];
            const hasSignal = sig && sig.type !== 'NONE';

            if (hasSignal && user) {
                const p = res.pricePrecision;
                const d = sig.type === 'LONG' ? 'L' : 'S';
                const tpVal = sig.tp;
                const slVal = sig.sl;

                const exCallback = `ex_${modeType}_${s}_${d}_${sig.entry.toFixed(p)}_${tpVal.toFixed(p)}_${slVal.toFixed(p)}_0`;
                const cpCallback = `cp_${modeType}_${s}_${d}_${sig.entry.toFixed(p)}_${tpVal.toFixed(p)}_${slVal.toFixed(p)}_0`;

                await ctx.reply(markdownToHtml(aiReport), {
                    parse_mode: 'HTML',
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: `⚡ تنفيذ صفقة ${version}`, callback_data: exCallback }],
                            [{ text: `📋 نسخ الصفقة كود`, callback_data: cpCallback }]
                        ]
                    }
                });
            } else {
                await ctx.reply(markdownToHtml(aiReport), { parse_mode: 'HTML' });
            }
        } catch (error: any) {
            logger.error('Error in single engine AI analysis callback:', error);
            await ctx.reply(`❌ فشل التحليل بالذكاء: ${error.message}`);
        }
    });

    // --- 4. Callback: Analyze Backtest Hits (تحليل ضرب الهدف والاستوب بالذكاء) ---
    bot.action(/^ai_bt_hits_([^_]+)_([^_]+)_(SCALP|SWING)_([0-9.]+)$/, async (ctx) => {
        try {
            const symbolShort = ctx.match[1];
            const version = ctx.match[2];
            const mode = ctx.match[3] as 'SCALP' | 'SWING';
            const days = parseFloat(ctx.match[4]);
            const symbol = `${symbolShort}/USDT:USDT`;

            await ctx.answerCbQuery('🧠 جاري تحليل صفقات الاختبار...');
            await ctx.reply(`⏳ جاري دراسة صفقات ${version} الخاسرة والرابحة على ${symbolShort} وربطها بالمؤشرات... قد يستغرق ذلك دقيقة.`);

            const user = await User.findOne({ telegramId: ctx.from!.id.toString() });
            const bts = user?.backtestSettings;

            // Run backtest to get list of trades for AI to study
            const result = await backtestService.runAdvancedBacktest(symbol, version, {
                quickTF: mode === 'SCALP' ? (bts?.interval || '15m') : (user?.analysisSettings?.scalpTF || '5m'),
                longTF: mode === 'SCALP' ? (user?.analysisSettings?.swingTF || '1h') : (bts?.interval || '1h'),
                days: days,
                stepMinutes: 30, // standard interval
                mode: mode,
                initialCapital: bts?.initialCapital ?? 1000,
                marginPerTradePercentage: bts?.riskPercentage ?? 3,
                marginMode: bts?.marginMode ?? 'ISOLATED',
                leverage: bts?.leverage ?? 10,
                riskSizingEnabled: bts?.riskSizingEnabled ?? false,
                maxSlCapEnabled: bts?.maxSlCapEnabled ?? false,
                maxSlPercentage: bts?.maxSlPercentage ?? 5,
                alignToStartOfDay: bts?.alignToStartOfDay !== false
            });

            const winRate = result.trades.length > 0 
                ? (result.trades.filter(t => t.status === 'WIN').length / result.trades.filter(t => t.status !== 'OPEN').length) * 100 
                : 0;

            const roi = result.trades.length > 0 ? ((result.trades[result.trades.length - 1].totalCapitalAfter - (bts?.initialCapital ?? 1000)) / (bts?.initialCapital ?? 1000)) * 100 : 0;

            const stats = {
                total: result.trades.length,
                winRate: isNaN(winRate) ? 0 : winRate,
                roi: roi,
                maxDrawdown: 0, // Simplified or extracted
                totalWins: result.trades.filter(t => t.status === 'WIN').length,
                totalLosses: result.trades.filter(t => t.status === 'LOSS').length
            };

            const report = await GeminiService.analyzeBacktestHits(symbol, version, stats, result.trades);
            await ctx.reply(markdownToHtml(report), { parse_mode: 'HTML' });
        } catch (error: any) {
            logger.error('Error in analyze backtest hits callback:', error);
            await ctx.reply(`❌ فشل تحليل صفقات الاختبار بالذكاء: ${error.message}`);
        }
    });

    // --- 5. Callback: Apply AI Backtest Optimization (تطبيق تحسينات الذكاء) ---
    bot.action(/^ai_opt_apply_([^_]+)_([^_]+)$/, async (ctx) => {
        try {
            const telegramId = ctx.from!.id.toString();
            const session = getSession(telegramId);
            const user = await User.findOne({ telegramId });

            if (!session.optEngine || !session.optSymbol || !session.optimizedParams) {
                return ctx.reply('❌ انتهت صلاحية جلسة التحسين الحالية. يرجى البدء من جديد.');
            }

            await ctx.answerCbQuery('🔄 جاري تطبيق قيم المعاملات وإعادة الاختبار الرجعي...');
            const symbol = session.optSymbol;
            const version = session.optEngine;
            const days = session.optDays || 3;
            const mode = session.optMode || 'SCALP';
            const interval = session.optInterval || '15m';

            await ctx.reply(`⏳ تم حقن المعاملات المقترحة بنجاح!\nجاري تشغيل الاختبار المحسن لـ ${symbol.split('/')[0]}...`);

            // Run backtest passing the optimized parameter overrides
            const result = await backtestService.runAdvancedBacktest(symbol, version, {
                quickTF: mode === 'SCALP' ? interval : '5m',
                longTF: mode === 'SCALP' ? '1h' : interval,
                days: days,
                stepMinutes: interval.endsWith('h') ? parseInt(interval) * 60 : parseInt(interval),
                mode: mode,
                initialCapital: user?.backtestSettings?.initialCapital ?? 1000,
                marginPerTradePercentage: user?.backtestSettings?.riskPercentage ?? 3,
                marginMode: user?.backtestSettings?.marginMode ?? 'ISOLATED',
                leverage: session.optimizedParams.leverage || user?.backtestSettings?.leverage || 10,
                riskSizingEnabled: user?.backtestSettings?.riskSizingEnabled ?? false,
                maxSlCapEnabled: user?.backtestSettings?.maxSlCapEnabled ?? false,
                maxSlPercentage: session.optimizedParams.maxSlPercentage || user?.backtestSettings?.maxSlPercentage || 5,
                alignToStartOfDay: user?.backtestSettings?.alignToStartOfDay !== false,
                params: session.optimizedParams // <-- INJECTING AI PROPOSED OVERRIDES
            });

            // Display results
            await ctx.reply(markdownToHtml(`📈 **نتائج الاختبار الرجعي المحسن بالذكاء:**\n${result.reportText}`), { parse_mode: 'HTML' });

            // Feed new results back to optimization to see if they can be optimized further (loop)
            const winRate = result.trades.length > 0 
                ? (result.trades.filter(t => t.status === 'WIN').length / result.trades.filter(t => t.status !== 'OPEN').length) * 100 
                : 0;
            const roi = result.trades.length > 0 ? ((result.trades[result.trades.length - 1].totalCapitalAfter - (user?.backtestSettings?.initialCapital ?? 1000)) / (user?.backtestSettings?.initialCapital ?? 1000)) * 100 : 0;

            const stats = {
                total: result.trades.length,
                winRate: isNaN(winRate) ? 0 : winRate,
                roi,
                maxDrawdown: 0,
                totalWins: result.trades.filter(t => t.status === 'WIN').length,
                totalLosses: result.trades.filter(t => t.status === 'LOSS').length
            };

            await ctx.reply('⏳ جاري استشارة الذكاء الاصطناعي لتحليل الفوارق وتقديم مستويات تحسين إضافية...');
            const nextOpt = await GeminiService.optimizeEngineParameters(symbol, version, stats, result.trades);

            session.optimizedParams = nextOpt.proposedParams;

            let nextMsg = `💡 **التوصية التالية للتحسين:**\n`;
            nextMsg += `• الزيادة المتوقعة: **${nextOpt.expectedRoiIncrease}**\n`;
            nextMsg += `• المعاملات المقترحة: \`${JSON.stringify(nextOpt.proposedParams)}\`\n\n`;
            nextMsg += `💬 **التوضيح:** ${nextOpt.explanation}\n\n`;
            nextMsg += `هل ترغب في إعادة تشغيل الاختبار الرجعي بالتحسينات الجديدة؟`;

            await ctx.reply(markdownToHtml(nextMsg), {
                parse_mode: 'HTML',
                reply_markup: {
                    inline_keyboard: [
                        [{ text: '✅ نعم، تطبيق وإعادة الاختبار', callback_data: `ai_opt_apply_${version}_${symbol.split('/')[0]}` }],
                        [{ text: '❌ لا، رفض وإنهاء التحسين', callback_data: 'ai_opt_cancel' }]
                    ]
                }
            });
        } catch (error: any) {
            logger.error('Error applying AI optimization:', error);
            await ctx.reply(`❌ فشل تشغيل التحسين: ${error.message}`);
        }
    });

    bot.action('ai_opt_cancel', async (ctx) => {
        try {
            const telegramId = ctx.from!.id.toString();
            delete aiSessions[telegramId];
            await ctx.answerCbQuery('تم إنهاء التحسين');
            await ctx.deleteMessage().catch(() => {});
            const user = await User.findOne({ telegramId });
            if (user) {
                await ctx.reply('تم إغلاق لوحة التحسين بنجاح.', { reply_markup: getMainMenuKeyboard(user) });
            }
        } catch (e) {}
    });

    // --- 6. Execution Callback: Comprehensive AI trade Execution ---
    bot.action(/^ai_ex_execute$/, async (ctx) => {
        try {
            const telegramId = ctx.from!.id.toString();
            const session = getSession(telegramId);
            const user = await User.findOne({ telegramId });

            if (!user) return ctx.answerCbQuery('مستخدم غير مسجل');
            if (!session.comprehensiveSignal || session.comprehensiveSignal.direction === 'NONE') {
                return ctx.answerCbQuery('⚠️ لا توجد صفقة ذكاء صالحة للتنفيذ حالياً.');
            }

            await ctx.answerCbQuery('⏳ جاري تنفيذ صفقة الذكاء الشامل...');
            const sig = session.comprehensiveSignal;

            const savedSymbol = (session as any).symbol || 'BTC/USDT:USDT';

            const signal = {
                type: 'TRADE' as const,
                symbol: savedSymbol,
                direction: sig.direction as 'LONG' | 'SHORT',
                entry: [sig.entry],
                targets: sig.tp,
                stopLoss: sig.sl
            };

            await ctx.reply(`⏳ جاري إرسال إشارة الدخول لـ ${savedSymbol.split('/')[0]} (${sig.direction}) للمنصة...`);
            await tradeManager.executeSignal(signal, user._id.toString(), ctx.chat!.id.toString());

            // Clear cache
            delete session.comprehensiveSignal;
        } catch (error: any) {
            logger.error('AI comprehensive execute error:', error);
            await ctx.reply(`❌ فشل تنفيذ الصفقة: ${error.message}`);
        }
    });

    // --- 7. Copy Callback: Comprehensive AI trade Copy ---
    bot.action(/^ai_ex_copy$/, async (ctx) => {
        try {
            const telegramId = ctx.from!.id.toString();
            const session = getSession(telegramId);
            const user = await User.findOne({ telegramId });

            if (!session.comprehensiveSignal) {
                return ctx.answerCbQuery('⚠️ لا توجد صفقة صالحة للنسخ.');
            }

            const sig = session.comprehensiveSignal;
            const symbol = (session as any).symbol || 'BTC/USDT:USDT';
            const precision = await bingxService.getPricePrecision(symbol);
            const levVal = user && user.leverageMode === 'fixed' ? user.fixedLeverageValue : 10;

            const dirEmoji = sig.direction === 'LONG' ? '🔼' : '🔻';
            const tpText = sig.tp.map(t => t.toFixed(precision)).join('\n');

            const copyBox = `${symbol}

${dirEmoji}${sig.direction}  X${levVal}  

▶️ENTER PRICE(سعر الدخول):
${sig.entry.toFixed(precision)}

▶️TARGET  PRICES(الاهداف):
${tpText}

▶️STOP LOSE(الاستوب)
${sig.sl.toFixed(precision)}`;

            await ctx.reply(
                `📝 *إليك بيانات صفقة الذكاء جاهزة للنسخ بنقرة واحدة:*\n` +
                `(اضغط على الكود أدناه لنسخه تلقائياً)\n\n` +
                `\`\`\`\n${copyBox}\n\`\`\``,
                { parse_mode: 'Markdown' }
            );
            await ctx.answerCbQuery('تم توليد كود النسخ ✅').catch(() => {});
        } catch (error: any) {
            logger.error('AI comprehensive copy error:', error);
        }
    });

    // --- MESSAGE HANDLER: WIZARD STATES ---
    bot.on('message', async (ctx, next) => {
        try {
            if (!ctx.from || !('text' in ctx.message)) return next();
            const message = ctx.message.text;
            const telegramId = ctx.from.id.toString();
            const user = await User.findOne({ telegramId });
            if (!user) return next();

            // A. state: Comprehensive AI analysis symbol
            if (user.botState === 'AWAITING_AI_COMP_SYMBOL') {
                user.botState = 'NONE';
                await user.save();

                if (message === 'رجوع 🔙' || message === 'إلغاء ❌') {
                    return ctx.reply('تم الإلغاء والعودة للقائمة الرئيسية.', { reply_markup: getMainMenuKeyboard(user) });
                }

                let cleanSymbol = message.toUpperCase().trim().replace('/USDT:USDT', '').replace('-USDT', '').replace('/USDT', '').replace('USDT', '');
                if (!cleanSymbol || cleanSymbol.length < 2 || cleanSymbol.length > 15 || cleanSymbol.includes(' ')) {
                    return ctx.reply('⚠️ رمز العملة غير صالح، يرجى كتابة الرمز مثل: BTC أو ETH أو SOL', { reply_markup: getMainMenuKeyboard(user) });
                }
                const symbol = `${cleanSymbol}/USDT:USDT`;

                ctx.reply(`⏳ جاري جلب البيانات وتشغيل الـ 16 محرك ومحركات القنص لعملة ${cleanSymbol}...`);

                try {
                    const [pricePrecision, candle5m] = await Promise.all([
                        bingxService.getPricePrecision(symbol),
                        bingxService.fetchOHLCV(symbol, '5m', 1)
                    ]);

                    if (!candle5m || candle5m.length === 0) {
                        return ctx.reply(`❌ تعذر جلب بيانات الشموع لعملة ${cleanSymbol} من منصة BingX. يرجى التأكد من توفر العملة في العقود الآجلة.`, { reply_markup: getMainMenuKeyboard(user) });
                    }
                    const currentPrice = candle5m[candle5m.length - 1].close;
                    
                    // 1. Fetch MTF data
                    const fetchResults = await Promise.all(
                        MATRIX_TFS.map(async tf => {
                            const ohlcv = await bingxService.fetchOHLCV(symbol, tf, 100);
                            return { tf, ohlcv };
                        })
                    );

                    const mtfOHLCV: Record<string, OHLCV[]> = {};
                    fetchResults.forEach(res => mtfOHLCV[res.tf] = res.ohlcv);

                    // 2. Run analysis engines in-memory
                    const engineResults: any[] = [];
                    const engines = ['V1', 'V2', 'V3', 'V4', 'V5', 'V6', 'V7', 'V8', 'V9', 'V10', 'V11', 'V12', 'V13', 'V14', 'V15', 'V16'];
                    for (const engineId of engines) {
                        try {
                            const res = CoreAnalysisService.analyze(symbol, pricePrecision, mtfOHLCV, engineId as any, {
                                quickTF: '5m',
                                longTF: '1h',
                                limit: 200
                            });
                            engineResults.push({ engineId, analysisResult: res });
                        } catch (e) {}
                    }

                    // 3. Run sniper engines in-memory
                    const sniperResults: any[] = [];
                    const sniperEngines = Object.keys(SNIPER_ENGINES);
                    for (const engineId of sniperEngines) {
                        try {
                            const report = CoreSniperScanner.scan(symbol, engineId, mtfOHLCV);
                            if (report) {
                                sniperResults.push({ engineId, sniperReport: report });
                            }
                        } catch (e) {}
                    }

                    // 4. Call Gemini
                    const signal = await GeminiService.generateComprehensiveAnalysis(
                        symbol,
                        currentPrice,
                        pricePrecision,
                        engineResults,
                        sniperResults
                    );

                    // 5. Store session context
                    const session = getSession(telegramId);
                    session.comprehensiveSignal = signal;
                    (session as any).symbol = symbol;

                    user.botState = 'NONE';
                    await user.save();

                    // Format beautiful response in Arabic
                    let reportText = `🧠 **تقرير التحليل الشامل الموحد بالذكاء الاصطناعي (Gemini)** 🧠\n`;
                    reportText += `━━━━━━━━━━━━━━\n`;
                    reportText += `🪙 العملة: **${symbol.split('/')[0]}**\n`;
                    reportText += `💵 السعر الحالي: **$${currentPrice.toFixed(pricePrecision)}**\n`;
                    reportText += `🎯 التوصية المقترحة: **${signal.direction === 'LONG' ? '🔼 LONG (شراء)' : signal.direction === 'SHORT' ? '🔻 SHORT (بيع)' : '⚪ NEUTRAL (انتظار)'}**\n`;
                    reportText += `📈 نسبة الثقة بالصفقة: **${signal.confidence}%**\n\n`;

                    if (signal.direction !== 'NONE') {
                        reportText += `▶️ **سعر الدخول:** \`${signal.entry.toFixed(pricePrecision)}\`\n`;
                        reportText += `▶️ **الأهداف (TP):**\n`;
                        signal.tp.forEach((t, i) => {
                            reportText += `   • هدف ${i + 1}: \`${t.toFixed(pricePrecision)}\`\n`;
                        });
                        reportText += `▶️ **وقف الخسارة (SL):** \`${signal.sl.toFixed(pricePrecision)}\`\n\n`;
                    }

                    reportText += `💬 **مبررات التداول (التحليل الكمي والسيولة):**\n${signal.justification}\n`;
                    reportText += `━━━━━━━━━━━━━━\n`;

                    const inlineButtons: any[][] = [];
                    if (signal.direction !== 'NONE') {
                        inlineButtons.push([
                            { text: '⚡ تنفيذ الصفقة تلقائياً', callback_data: 'ai_ex_execute' },
                            { text: '📋 نسخ الصفقة', callback_data: 'ai_ex_copy' }
                        ]);
                    }
                    inlineButtons.push([
                        { text: '🔙 رجوع للقائمة', callback_data: 'ai_opt_cancel' }
                    ]);

                    return ctx.reply(markdownToHtml(reportText), {
                        parse_mode: 'HTML',
                        reply_markup: {
                            inline_keyboard: inlineButtons
                        }
                    });

                } catch (error: any) {
                    logger.error('Comprehensive AI analysis failed:', error);
                    ctx.reply(`❌ فشل التحليل الشامل بالذكاء: ${error.message}`, { reply_markup: getMainMenuKeyboard(user) });
                    user.botState = 'NONE';
                    await user.save();
                    return;
                }
            }

            // B. state: Optimization wizard - select engine
            if (user.botState === 'AWAITING_AI_OPT_ENGINE') {
                if (message === 'رجوع 🔙' || message === 'إلغاء ❌' || message === 'رجوع للقائمة الرئيسية 🔙') {
                    user.botState = 'NONE';
                    await user.save();
                    return ctx.reply('تم الإلغاء.', { reply_markup: getMainMenuKeyboard(user) });
                }

                // Match algorithm text or exact name
                const matched = message.match(/الخوارزمية (V[0-9]+)/i);
                const engineId = matched ? matched[1] : message.trim();

                const validEngines = ['V1', 'V2', 'V3', 'V4', 'V5', 'V6', 'V7', 'V8', 'V9', 'V10', 'V11', 'V12', 'V13', 'V14', 'V15', 'V16'];
                if (!validEngines.includes(engineId)) {
                    return ctx.reply('⚠️ يرجى اختيار خوارزمية صالحة من اللوحة أدناه.');
                }

                const session = getSession(telegramId);
                session.optEngine = engineId;

                user.botState = `AWAITING_AI_OPT_SYMBOL`;
                await user.save();

                return ctx.reply(`✏️ **لقد اخترت المحرك ${engineId}**\n\nيرجى إرسال رمز العملة المراد تشغيل اختبار التحسين عليها (مثال: BTC):`, {
                    reply_markup: { keyboard: [[{ text: 'إلغاء ❌' }]], resize_keyboard: true }
                });
            }

            // C. state: Optimization wizard - select symbol
            if (user.botState === 'AWAITING_AI_OPT_SYMBOL') {
                if (message === 'إلغاء ❌') {
                    user.botState = 'NONE';
                    await user.save();
                    return ctx.reply('تم الإلغاء والعودة للقائمة الرئيسية.', { reply_markup: getMainMenuKeyboard(user) });
                }

                const symbol = message.toUpperCase();
                const session = getSession(telegramId);
                session.optSymbol = symbol.includes('/') ? symbol : `${symbol}/USDT:USDT`;

                user.botState = 'NONE';
                await user.save();

                // Setup default optimization test over 3 days, 15m interval, SCALP mode
                session.optDays = 3;
                session.optMode = 'SCALP';
                session.optInterval = '15m';

                ctx.reply(`⏳ جاري تشغيل اختبار الـ Baseline الأولي لـ ${symbol} باستخدام ${session.optEngine} (أخر 3 أيام)...\nيرجى الانتظار، قد يستغرق ذلك 20 ثانية.`);

                try {
                    const bts = user.backtestSettings;

                    // 1. Run Baseline Backtest
                    const result = await backtestService.runAdvancedBacktest(session.optSymbol, session.optEngine!, {
                        quickTF: '15m',
                        longTF: '1h',
                        days: 3,
                        stepMinutes: 15,
                        mode: 'SCALP',
                        initialCapital: bts?.initialCapital ?? 1000,
                        marginPerTradePercentage: bts?.riskPercentage ?? 3,
                        marginMode: bts?.marginMode ?? 'ISOLATED',
                        leverage: bts?.leverage ?? 10,
                        riskSizingEnabled: bts?.riskSizingEnabled ?? false,
                        maxSlCapEnabled: bts?.maxSlCapEnabled ?? false,
                        maxSlPercentage: bts?.maxSlPercentage ?? 5,
                        alignToStartOfDay: bts?.alignToStartOfDay !== false
                    });

                    // Send baseline report
                    await ctx.reply(markdownToHtml(`📊 **نتائج اختبار الـ Baseline الأولي (قبل التحسين):**\n${result.reportText}`), { parse_mode: 'HTML' });

                    // 2. Call Gemini to optimize parameters
                    const winRate = result.trades.length > 0 
                        ? (result.trades.filter(t => t.status === 'WIN').length / result.trades.filter(t => t.status !== 'OPEN').length) * 100 
                        : 0;
                    const roi = result.trades.length > 0 ? ((result.trades[result.trades.length - 1].totalCapitalAfter - (bts?.initialCapital ?? 1000)) / (bts?.initialCapital ?? 1000)) * 100 : 0;

                    const stats = {
                        total: result.trades.length,
                        winRate: isNaN(winRate) ? 0 : winRate,
                        roi,
                        maxDrawdown: 0,
                        totalWins: result.trades.filter(t => t.status === 'WIN').length,
                        totalLosses: result.trades.filter(t => t.status === 'LOSS').length
                    };

                    await ctx.reply('🔮 جاري إرسال نتائج Baseline الذاتي لـ Gemini لاستنتاج المعاملات الرياضية المحسنة...');

                    const optResult = await GeminiService.optimizeEngineParameters(session.optSymbol, session.optEngine!, stats, result.trades);

                    // Save proposed params to session
                    session.optimizedParams = optResult.proposedParams;

                    let optMsg = `💡 **اقتراحات تحسين محرك ${session.optEngine}:**\n`;
                    optMsg += `• الزيادة المتوقعة: **${optResult.expectedRoiIncrease}**\n`;
                    optMsg += `• المعاملات المقترحة: \`${JSON.stringify(optResult.proposedParams)}\`\n\n`;
                    optMsg += `💬 **التوضيح الفني:**\n${optResult.explanation}\n\n`;
                    optMsg += `هل ترغب في إعادة تشغيل الاختبار الرجعي بالتحسينات والمعادلات المقترحة؟`;

                    return ctx.reply(markdownToHtml(optMsg), {
                        parse_mode: 'HTML',
                        reply_markup: {
                            inline_keyboard: [
                                [{ text: '✅ نعم، تطبيق وإعادة الاختبار', callback_data: `ai_opt_apply_${session.optEngine}_${symbol}` }],
                                [{ text: '❌ لا، إلغاء', callback_data: 'ai_opt_cancel' }]
                            ]
                        }
                    });

                } catch (error: any) {
                    logger.error('Initial AI backtest wizard fail:', error);
                    ctx.reply(`❌ فشل الاختبار الأولي: ${error.message}`, { reply_markup: getMainMenuKeyboard(user) });
                    return;
                }
            }

            return next();
        } catch (error) {
            logger.error('Error in AI message handler state machine:', error);
            return next();
        }
    });
};
