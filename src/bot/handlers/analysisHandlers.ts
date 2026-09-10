import { Telegraf } from 'telegraf';
import logger from '../../utils/logger';
import User from '../../models/User';
import Trade from '../../models/Trade';
import { 
    getMainMenuKeyboard,
    getBacktestVersionKeyboard,
    getBacktestModeKeyboard,
    getBacktestIntervalKeyboard,
    getBacktestDaysKeyboard,
    getBacktestSettingsKeyboard
} from '../keyboards/baseKeyboards';
import {
    getAlgoVersionKeyboard,
    getAnalysisActionKeyboard,
    getAnalysisSettingsKeyboard,
    getTFSelectionKeyboard,
    getLimitSelectionKeyboard,
    getRSISelectionKeyboard
} from '../keyboards/analysisKeyboards';
import { AnalysisService } from '../../services/AnalysisService';
import { BingXService } from '../../services/BingXService';
import { BacktestService } from '../../services/BacktestService';
import { TradeManager } from '../../services/TradeManager';
import { generateCSVBuffer } from './messageHandlers';
import { showPickerForAnalysis } from './pickerHandlers';

export const registerAnalysisHandlers = (bot: Telegraf, tradeManager: TradeManager) => {
    const bingxService = new BingXService();
    const analysisService = new AnalysisService(bingxService);
    const backtestService = new BacktestService(bingxService, analysisService);
    // bingxService مشترك مع pickerHandlers عبر Singleton

    // --- CALLBACK HANDLERS FOR ANALYSIS ACTIONS ---
    bot.action(/^cp_(sc|sw)_(.+)$/, async (ctx) => {
        try {
            const [_, type, rest] = ctx.match;
            const [s, d, e, t1, sl, t2] = rest.split('_');
            const targets = [parseFloat(t1)];
            if (t2 && t2 !== '0') targets.push(parseFloat(t2));
            const precision = await bingxService.getPricePrecision(`${s}/USDT:USDT`);
            const signalText = analysisService.formatSignalText(
                `${s}/USDT:USDT`,
                d === 'L' ? 'LONG' : 'SHORT',
                parseFloat(e),
                targets,
                parseFloat(sl),
                25, // Default leverage
                precision
            );
            await ctx.replyWithMarkdown(signalText);
            await ctx.answerCbQuery('تم إنشاء نموذج الإشارة ✅');
        } catch (error: any) {
            logger.error('Error in copy signal action:', error);
            await ctx.answerCbQuery('❌ حدث خطأ أثناء إنشاء الإشارة');
        }
    });

    bot.action(/^ex_(sc|sw)_(.+)$/, async (ctx) => {
        try {
            const [_, type, rest] = ctx.match;
            const [s, d, e, t1, sl, t2] = rest.split('_');
            const telegramId = ctx.from!.id.toString();
            const user = await User.findOne({ telegramId });

            if (!user) return ctx.answerCbQuery('لم يتم العثور على المستخدم');

            const targets = [parseFloat(t1)];
            if (t2 && t2 !== '0') targets.push(parseFloat(t2));

            const signal = {
                type: 'TRADE',
                symbol: `${s}/USDT:USDT`,
                direction: d === 'L' ? 'LONG' : 'SHORT',
                entry: [parseFloat(e)],
                targets: targets,
                stopLoss: parseFloat(sl)
            };

            ctx.answerCbQuery('⏳ جاري تنفيذ الصفقة...');
            await tradeManager.executeSignal(signal as any, user._id.toString(), ctx.chat!.id.toString());

        } catch (error: any) {
            logger.error('Error in execute trade action:', error);
            await ctx.answerCbQuery(`❌ فشل التنفيذ: ${error.message}`);
        }
    });

    bot.action(/^bt_(sc|sw)_(.+)$/, async (ctx) => {
        try {
            const [_, type, rest] = ctx.match;
            const [s, version] = rest.split('_');
            const symbol = `${s}/USDT:USDT`;

            await ctx.answerCbQuery(`⏳ جاري تشغيل الاختبار الرجعي (${version || 'V6'})...`);
            await ctx.reply(`🔍 جاري تحليل البيانات التاريخية لـ ${symbol}... قد يستغرق ذلك بضع ثوانٍ.`);

            const telegramId = ctx.from?.id.toString();
            const user = await User.findOne({ telegramId });

            const mode: 'SCALP' | 'SWING' = type === 'sc' ? 'SCALP' : 'SWING';

            const result = await backtestService.runAdvancedBacktest(symbol, version, {
                quickTF: user?.analysisSettings?.scalpTF || '5m',
                longTF: user?.analysisSettings?.swingTF || '1h',
                days: 1, // Quick test uses 1 day
                stepMinutes: 30, // Default to 30 mins
                mode: mode,
                alignToStartOfDay: user?.backtestSettings?.alignToStartOfDay !== false
            });

            if (user) {
                await ctx.reply(result.reportText, { parse_mode: 'Markdown', reply_markup: getMainMenuKeyboard(user) });
            } else {
                await ctx.reply(result.reportText, { parse_mode: 'Markdown' });
            }

            if (result.trades && result.trades.length > 0) {
                const csvBuffer = generateCSVBuffer(result.trades);
                const safeSymbol = symbol.replace(/[\/:]/g, '_');
                const now = new Date();
                const dateStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}_${String(now.getHours()).padStart(2, '0')}-${String(now.getMinutes()).padStart(2, '0')}`;
                const fileName = `Backtest_${version}_${mode}_${safeSymbol}_${dateStr}.csv`;
                await ctx.replyWithDocument({ source: csvBuffer, filename: fileName });
            }

        } catch (error: any) {
            logger.error('Error in backtest action:', error);
            await ctx.reply(`❌ فشل الاختبار الرجعي: ${error.message}`);
        }
    });

    bot.action(/^dt_(sc|sw)_(.+)$/, async (ctx) => {
        try {
            const [_, type, rest] = ctx.match;
            const parts = rest.split('_');
            const s = parts[0];
            const d = parts[1] === 'L' ? 'LONG' : 'SHORT';
            const v = parts[2] || 'V6';
            const symbol = `${s}/USDT:USDT`;

            await ctx.answerCbQuery(`⏳ جاري جلب التقرير التفصيلي (${v})...`);

            // Re-run analysis to get the latest details
            const user = await User.findOne({ telegramId: ctx.from!.id.toString() });
            const res = await analysisService.analyze(symbol, v as any, {
                quickTF: user?.analysisSettings?.scalpTF,
                longTF: user?.analysisSettings?.swingTF,
                antiRepainting: user?.analysisSettings?.antiRepaintingEnabled
            });

            const details = analysisService.generateDetailedReport(res, type === 'sc' ? 'scalp' : 'swing');
            await ctx.reply(details, { parse_mode: 'Markdown' });

        } catch (error) {
            logger.error('Error in details action:', error);
            await ctx.reply('❌ فشل جلب التقرير التقني.');
        }
    });

    bot.action(/^ed_(sc|sw)_(.+)$/, async (ctx) => {
        try {
            const [_, type, rest] = ctx.match;
            const parts = rest.split('_');
            const s = parts[0];
            const v = parts[1] || 'V6';
            const symbol = `${s}/USDT:USDT`;
            await ctx.answerCbQuery('📚 جاري فتح الدليل التعليمي...');

            const user = await User.findOne({ telegramId: ctx.from!.id.toString() });
            const res = await analysisService.analyze(symbol, v as any, {
                quickTF: user?.analysisSettings?.scalpTF,
                longTF: user?.analysisSettings?.swingTF,
                antiRepainting: user?.analysisSettings?.antiRepaintingEnabled
            });

            const guide = analysisService.generateEducationalGuide(res, type === 'sc' ? 'scalp' : 'swing');
            await ctx.reply(guide, { parse_mode: 'Markdown' });
        } catch (error) {
            logger.error('Error in educational guide action:', error);
            await ctx.reply('❌ فشل جلب الدليل التعليمي.');
        }
    });

    // --- ANALYSIS SETTINGS ACTIONS ---
    bot.action(/^sc_tf_(.+)$/, async (ctx) => {
        try {
            const tf = ctx.match[1];
            const user = await User.findOne({ telegramId: ctx.from!.id.toString() });
            if (user) {
                user.analysisSettings.scalpTF = tf;
                await user.save();
                await ctx.answerCbQuery(`✅ تم تحديد فريم السكالبينج: ${tf}`);
                await ctx.editMessageText(`✅ تم تحديث فريم السكالبينج بنجاح إلى: **${tf}**`, { parse_mode: 'Markdown' });
            }
        } catch (error) {
            logger.error('Error updating scalp TF:', error);
        }
    });

    bot.action(/^sw_tf_(.+)$/, async (ctx) => {
        try {
            const tf = ctx.match[1];
            const user = await User.findOne({ telegramId: ctx.from!.id.toString() });
            if (user) {
                user.analysisSettings.swingTF = tf;
                await user.save();
                await ctx.answerCbQuery(`✅ تم تحديد فريم السوينج: ${tf}`);
                await ctx.editMessageText(`✅ تم تحديث فريم السوينج بنجاح إلى: **${tf}**`, { parse_mode: 'Markdown' });
            }
        } catch (error) {
            logger.error('Error updating swing TF:', error);
        }
    });

    bot.action(/^limit_(\d+)$/, async (ctx) => {
        try {
            const limit = parseInt(ctx.match[1]);
            const user = await User.findOne({ telegramId: ctx.from!.id.toString() });
            if (user) {
                user.analysisSettings.candleLimit = limit;
                await user.save();
                await ctx.answerCbQuery(`✅ تم تحديد عدد الشمعات: ${limit}`);
                await ctx.editMessageText(`✅ تم تحديث عدد الشمعات للتحليل بنجاح إلى: **${limit}**`, { parse_mode: 'Markdown' });
            }
        } catch (error) {
            logger.error('Error updating candle limit:', error);
        }
    });

    bot.action(/^rsi_(\d+)$/, async (ctx) => {
        try {
            const rsi = parseInt(ctx.match[1]);
            const user = await User.findOne({ telegramId: ctx.from!.id.toString() });
            if (user) {
                user.analysisSettings.rsiThreshold = rsi;
                await user.save();
                await ctx.answerCbQuery(`✅ تم تحديد RSI Threshold: ${rsi}`);
                await ctx.editMessageText(`✅ تم تحديث قيمة RSI للدخول بنجاح إلى: **${rsi}**`, { parse_mode: 'Markdown' });
            }
        } catch (error) {
            logger.error('Error updating RSI threshold:', error);
        }
    });

    bot.action(/^rep_(enable|disable)$/, async (ctx) => {
        try {
            const action = ctx.match[1];
            const isEnabled = action === 'enable';
            const user = await User.findOne({ telegramId: ctx.from!.id.toString() });
            if (user) {
                user.analysisSettings.antiRepaintingEnabled = isEnabled;
                await user.save();
                const statusStr = isEnabled ? '🟢 مفعلة' : '🔴 معطلة';
                await ctx.answerCbQuery(`✅ تم تحديث حماية Repainting: ${statusStr}`);
                await ctx.editMessageText(`✅ **تم تحديث حماية الـ Repainting بنجاح إلى:** **${statusStr}**\n\n(سيتم الاعتماد على ${isEnabled ? 'الشموع المغلقة فقط' : 'الشموع الحية والمغلقة'} لحساب المؤشرات الفنية).`, { parse_mode: 'Markdown' });
            }
        } catch (error) {
            logger.error('Error updating Anti-Repainting setting:', error);
        }
    });

    bot.action(/^all_tf_(.+)$/, async (ctx) => {
        try {
            const rest = ctx.match[1];
            const parts = rest.split('_');
            const s = parts[0];
            const v = parts[1] || 'V6';
            const symbol = `${s}/USDT:USDT`;
            await ctx.answerCbQuery(`🌐 جاري توليد التحليل الشامل (${v})...`);

            const user = await User.findOne({ telegramId: ctx.from!.id.toString() });
            const res = await analysisService.analyze(symbol, v as any, {
                quickTF: user?.analysisSettings?.scalpTF,
                longTF: user?.analysisSettings?.swingTF,
                antiRepainting: user?.analysisSettings?.antiRepaintingEnabled
            });

            const comprehensiveReport = analysisService.generateComprehensiveReport(res);
            await ctx.reply(comprehensiveReport, { parse_mode: 'Markdown' });

        } catch (error) {
            logger.error('Error in comprehensive analysis action:', error);
            await ctx.reply('❌ فشل توليد التحليل الشامل.');
        }
    });

    // Handle Correction Check
    bot.action(/^cor_ck_(.+)$/, async (ctx) => {
        try {
            const rest = ctx.match[1];
            const parts = rest.split('_');
            const s = parts[0];
            const d = parts[1] === 'L' ? 'LONG' : 'SHORT';
            const v = parts[2] || 'V6';

            const symbol = s.includes('/') ? s : `${s}/USDT:USDT`;
            await ctx.answerCbQuery(`🔍 جاري فحص رادار التصحيح (${v})...`);

            const user = await User.findOne({ telegramId: ctx.from!.id.toString() });
            const res = await analysisService.analyze(symbol, v as any, {
                quickTF: user?.analysisSettings?.scalpTF,
                longTF: user?.analysisSettings?.swingTF,
                antiRepainting: user?.analysisSettings?.antiRepaintingEnabled
            });

            const correctionReport = await analysisService.generateCorrectionReport(res, d);

            await ctx.reply(correctionReport, { parse_mode: 'Markdown' });

        } catch (error) {
            logger.error('Error in correction check action:', error);
            await ctx.reply('❌ فشل فحص رادار التصحيح.');
        }
    });

    // Handle Correction Alert Toggle
    bot.action(/^cor_al_(.+)$/, async (ctx) => {
        try {
            const symbol = ctx.match[1].includes('/') ? ctx.match[1] : `${ctx.match[1]}/USDT:USDT`;
            const user = await User.findOne({ telegramId: ctx.from!.id.toString() });

            if (!user) {
                return await ctx.reply('❌ مستخدم غير مسجل.');
            }

            const userId = user._id;

            // Find the most recent active trade for this symbol
            const activeTrade = await Trade.findOne({
                userId,
                symbol,
                currentStatus: { $in: ['OPEN', 'TP1_HIT', 'TP2_HIT', 'TP3_HIT'] }
            }).sort({ entryTime: -1 });

            if (!activeTrade) {
                return await ctx.reply('❌ لم يتم العثور على صفقة مفتوحة نشطة لهذه العملة لتفعيل التنبيه لها.');
            }

            activeTrade.correctionAlertEnabled = true;
            activeTrade.correctionWarningSent = false; // Reset warning if reactivating
            await activeTrade.save();

            await ctx.answerCbQuery('🔔 تم تفعيل تنبيه التصحيح');
            await ctx.reply(`✅ **تم تفعيل مراقبة التصحيح لعملة ${activeTrade.symbol}**\n\nسأقوم بتنبيهك فوراً في حال كسر الـ Pivot أو ظهور انحراف سلبي حاد على الفريمات الصغيرة لحماية أرباحك.`, { parse_mode: 'Markdown' });

        } catch (error) {
            logger.error('Error in correction alert action:', error);
            await ctx.reply('❌ فشل تفعيل تنبيه التصحيح.');
        }
    });

    // --- SMART ANALYSIS FLOW ---
    bot.hears(['📊 التحليل الذكي (V1-V16)', '📊 التحليل الكمي (V1-V18 + الهارمونيك)'], async (ctx) => {
        try {
            return ctx.reply('الرجاء اختيار إصدار خوارزمية التحليل التي تود استخدامها:', {
                reply_markup: getAlgoVersionKeyboard()
            });
        } catch (error) {
            logger.error('Error in hears 📊 التحليل الذكي (V1-V16):', error);
        }
    });

    bot.hears('دليل الخوارزميات 📖', async (ctx) => {
        try {
            const guide = `📖 **دليل الخوارزميات (V1-V16):**\n\n` +
                `${analysisService.getAlgorithmExplanation('V1')}\n\n` +
                `${analysisService.getAlgorithmExplanation('V2')}\n\n` +
                `${analysisService.getAlgorithmExplanation('V3')}\n\n` +
                `${analysisService.getAlgorithmExplanation('V4')}\n\n` +
                `${analysisService.getAlgorithmExplanation('V5')}\n\n` +
                `${analysisService.getAlgorithmExplanation('V6')}\n\n` +
                `${analysisService.getAlgorithmExplanation('V7')}\n\n` +
                `${analysisService.getAlgorithmExplanation('V8')}\n\n` +
                `${analysisService.getAlgorithmExplanation('V9')}\n\n` +
                `${analysisService.getAlgorithmExplanation('V10')}\n\n` +
                `${analysisService.getAlgorithmExplanation('V11')}\n\n` +
                `${analysisService.getAlgorithmExplanation('V12')}\n\n` +
                `${analysisService.getAlgorithmExplanation('V13')}\n\n` +
                `${analysisService.getAlgorithmExplanation('V14')}\n\n` +
                `${analysisService.getAlgorithmExplanation('V15')}\n\n` +
                `${analysisService.getAlgorithmExplanation('V16')}`;
            return ctx.reply(guide);
        } catch (error) {
            logger.error('Error in hears دليل الخوارزميات 📖:', error);
        }
    });

    const algos = [
        { text: 'الخوارزمية V1 (الأساسي)', version: 'V1' },
        { text: 'الخوارزمية V2 (الكمي - Quant)', version: 'V2' },
        { text: 'الخوارزمية V3 (المصفوفة)', version: 'V3' },
        { text: 'الخوارزمية V4 (ثنائي الاتجاه)', version: 'V4' },
        { text: 'الخوارزمية V5 (تنبؤي AI) 🔮', version: 'V5' },
        { text: 'الخوارزمية V6 (Sniper) 🎯', version: 'V6' },
        { text: 'الخوارزمية V7 (القناص الهجيني) 🏹', version: 'V7' },
        { text: 'الخوارزمية V8 (قناص الموجات والسيولة) 🌊', version: 'V8' },
        { text: 'الخوارزمية V9 (قناص SMC الذكي) 🏛️', version: 'V9' },
        { text: 'الخوارزمية V10 (المؤسساتي المتقدم) 🏆', version: 'V10' },
        { text: 'الخوارزمية V11 (القرار الذكي التكيفي) 👑', version: 'V11' },
        { text: 'الخوارزمية V12 (تدفق السيولة CVD) 📊', version: 'V12' },
        { text: 'الخوارزمية V13 (مصائد السيولة وايكوف) 🪤', version: 'V13' },
        { text: 'الخوارزمية V14 (رينكو السحابية التكيفية) ☁️', version: 'V14' },
        { text: 'الخوارزمية V15 (تشان الهارمونية الكمية) 🌌', version: 'V15' },
        { text: 'الخوارزمية V16 (مصفوفة الزمان والمكان الهجينة) 🏹', version: 'V16' },
        { text: 'الخوارزمية V17 (نظام السوق الديناميكي) 🌐', version: 'V17' },
        { text: 'الخوارزمية V18 (تدفق السيولة وعمق الأوامر) 📊', version: 'V18' },
        { text: 'منظومة الهارمونيك الكاملة (11 نموذجاً) 🎯', version: 'HARMONIC' }
    ];

    for (const algo of algos) {
        bot.hears(algo.text, async (ctx) => {
            try {
                // ── عرض قائمة أفضل العملات (أو رسالة الفحص) بدلاً من طلب نص مباشرة ──
                await showPickerForAnalysis(ctx, algo.version as any, bingxService, false);
            } catch (error) {
                logger.error(`Error in hears ${algo.text}:`, error);
            }
        });
    }

    bot.hears('منسق المحركات الشاملة (الإجماع) 🤖', async (ctx) => {
        try {
            await showPickerForAnalysis(ctx, 'HARMONIC' as any, bingxService, false);
        } catch (error) {
            logger.error('Error in hears منسق المحركات:', error);
        }
    });

    // --- ANALYSIS SETTINGS FLOW ---
    bot.hears('⚙️ إعدادات المحلل الذكي', async (ctx) => {
        try {
            return ctx.reply('إعدادات المحلل الذكي: يمكنك تخصيص الفريمات الزمنية وعدد الشمعات المستخدمة في التحليل.', {
                reply_markup: getAnalysisSettingsKeyboard()
            });
        } catch (error) {
            logger.error('Error in hears ⚙️ إعدادات المحلل الذكي:', error);
        }
    });

    bot.hears('⏱️ فريم السكالبينج', async (ctx) => {
        try {
            return ctx.reply('اختر فريم السكالبينج المفضل:', {
                reply_markup: getTFSelectionKeyboard('scalp')
            });
        } catch (error) {
            logger.error('Error in hears ⏱️ فريم السكالبينج:', error);
        }
    });

    bot.hears('🌊 فريم السوينج', async (ctx) => {
        try {
            return ctx.reply('اختر فريم السوينج المفضل:', {
                reply_markup: getTFSelectionKeyboard('swing')
            });
        } catch (error) {
            logger.error('Error in hears 🌊 فريم السوينج:', error);
        }
    });

    bot.hears('📊 عدد الشمعات (Limit)', async (ctx) => {
        try {
            return ctx.reply('اختر عدد الشمعات التاريخية لتحليلها:', {
                reply_markup: getLimitSelectionKeyboard()
            });
        } catch (error) {
            logger.error('Error in hears 📊 عدد الشمعات (Limit):', error);
        }
    });

    bot.hears('📉 مؤشر RSI Threshold', async (ctx) => {
        try {
            return ctx.reply('اختر قيمة RSI المفضلة (قيمة أقل = شروط دخول أقسى، قيمة أعلى = دخول أسرع):', {
                reply_markup: getRSISelectionKeyboard()
            });
        } catch (error) {
            logger.error('Error in hears 📉 مؤشر RSI Threshold:', error);
        }
    });

    bot.hears('🛡️ حماية الـ Repainting', async (ctx) => {
        try {
            const user = await User.findOne({ telegramId: ctx.from!.id.toString() });
            const status = user?.analysisSettings?.antiRepaintingEnabled !== false ? '🟢 مفعلة' : '🔴 معطلة';
            return ctx.reply(`🛡️ **نظام حماية التنبيهات من إعادة الرسم (Anti-Repainting):**\n\n` +
                `الحالة الحالية: **${status}**\n\n` +
                `عند تفعيل الحماية، سيقوم المحلل الفني وقناص الصفقات بحساب المؤشرات الفنية بناءً على الشموع المغلقة فقط لمنع صدور إشارات دخول خاطئة ومذبذبة قبل إغلاق الشمعة.`, {
                reply_markup: {
                    inline_keyboard: [
                        [
                            { text: '🟢 تفعيل الحماية', callback_data: 'rep_enable' },
                            { text: '🔴 تعطيل الحماية', callback_data: 'rep_disable' }
                        ]
                    ]
                }
            });
        } catch (error) {
            logger.error('Error in hears 🛡️ حماية الـ Repainting:', error);
        }
    });

    // Handle generic message state for analysis symbols
    bot.on('message', async (ctx, next) => {
        try {
            if (!ctx.from || !('text' in ctx.message)) return next();
            const message = ctx.message.text;
            const telegramId = ctx.from.id.toString();
            const user = await User.findOne({ telegramId });
            if (!user) return next();

            if (user.botState && user.botState.startsWith('AWAITING_ANALYSIS_SYMBOL_')) {
                if (message === 'إلغاء ❌' || message === 'رجوع للقائمة الرئيسية 🔙' || message === 'رجوع 🔙') {
                    user.botState = 'NONE';
                    await user.save();
                    return ctx.reply('تم الإلغاء والعودة للقائمة الرئيسية.', { reply_markup: getMainMenuKeyboard(user) });
                }
                const version = user.botState.split('_').pop() as 'V1' | 'V2' | 'V3' | 'V4' | 'V5' | 'V6' | 'V7' | 'V8' | 'V9' | 'V10' | 'V11' | 'V12' | 'V13' | 'V14';
                const symbol = message.toUpperCase();
                ctx.reply(`⏳ جاري تحليل ${symbol} باستخدام ${version}... (TF: ${user.analysisSettings?.scalpTF || '5m'}/${user.analysisSettings?.swingTF || '1h'})`);
                try {
                    const result = await analysisService.analyze(symbol, version, {
                        quickTF: user.analysisSettings?.scalpTF,
                        longTF: user.analysisSettings?.swingTF,
                        limit: user.analysisSettings?.candleLimit,
                        rsiThreshold: user.analysisSettings?.rsiThreshold,
                        antiRepainting: user.analysisSettings?.antiRepaintingEnabled
                    });
                    const report = analysisService.formatReport(result, version);

                    // Send the report with a button for comprehensive analysis
                    const shortSym = symbol.split('/')[0];
                    await ctx.replyWithHTML(report, {
                        reply_markup: {
                            inline_keyboard: [[{ text: '📊 التحليل الشامل (MTF)', callback_data: `all_tf_${shortSym}_${version}` }]]
                        }
                    });

                    // Send buttons for Scalp
                    if (result.scalp.type !== 'NONE') {
                        await ctx.reply(`⚡ **إجراءات سريعة لصفقة Scalp:**`, {
                            reply_markup: getAnalysisActionKeyboard(symbol, 'scalp', {
                                direction: result.scalp.type,
                                entry: result.scalp.entry,
                                tp: result.scalp.tp,
                                sl: result.scalp.sl,
                                p: result.pricePrecision
                            }, version)
                        });
                    }

                    // Send buttons for Swing
                    if (result.swing.type !== 'NONE') {
                        await ctx.reply(`🌊 **إجراءات لصفقة Swing:**`, {
                            reply_markup: getAnalysisActionKeyboard(symbol, 'swing', {
                                direction: result.swing.type,
                                entry: result.swing.entry,
                                tp: result.swing.tp,
                                sl: result.swing.sl,
                                p: result.pricePrecision
                            }, version)
                        });
                    }

                    user.botState = 'NONE';
                    await user.save();
                    return ctx.reply('يمكنك الآن تنفيذ الصفقة أو نسخ الإشارة من الأزرار أعلاه.', { reply_markup: getMainMenuKeyboard(user) });

                } catch (error: any) {
                    logger.error(`Analysis failed for ${symbol}:`, error);
                    ctx.reply(`❌ فشل التحليل: ${error.message}`, { reply_markup: getMainMenuKeyboard(user) });
                    user.botState = 'NONE';
                    await user.save();
                    return;
                }
            }

            return next();
        } catch (error) {
            logger.error('Error in analysis message handler:', error);
            return next();
        }
    });
};
