import { Telegraf } from 'telegraf';
import logger from '../../utils/logger';
import User from '../../models/User';
import Trade from '../../models/Trade';
import { getMainMenuKeyboard, getTraderSettingsKeyboard, getAlgoVersionKeyboard, getAnalysisActionKeyboard, getAnalysisSettingsKeyboard, getTFSelectionKeyboard, getLimitSelectionKeyboard, getRSISelectionKeyboard, getBacktestVersionKeyboard, getBacktestModeKeyboard, getBacktestStepKeyboard, getBacktestDaysKeyboard } from '../keyboards/baseKeyboards';
import { AnalysisService } from '../../services/AnalysisService';
import { BingXService } from '../../services/BingXService';
import { BacktestService } from '../../services/BacktestService';

import { SignalParser } from '../../services/SignalParser';
import { TradeManager } from '../../services/TradeManager';
import { sendTelegramMessage } from '../../utils/telegram';

function generateCSVBuffer(trades: any[]): Buffer {
    if (!trades || trades.length === 0) return Buffer.from('');

    const headers = [
        'Type', 'Mode', 'Entry Date', 'Close Date', 'Status', 'Duration (Mins)',
        'Entry Price', 'TP', 'SL', 'Close Price',
        'Signal Reason', 'Matrix Score (%)',
        'Quick_RSI', 'Quick_MACD', 'Quick_MACD_Sig', 'Quick_MACD_Hist',
        'Quick_BB_Up', 'Quick_BB_Low', 'Quick_StochRSI', 'Quick_CCI', 'Quick_WilliamsR', 'Quick_ATR', 'Quick_Trend',
        'Long_RSI', 'Long_MACD', 'Long_MACD_Hist', 'Long_Trend'
    ];

    let csvContent = headers.join(',') + '\n';

    for (const t of trades) {
        // Enclose signalReason in quotes to handle commas within the reason string
        const safeReason = t.signalReason ? `"${t.signalReason}"` : '""';
        
        const row = [
            t.type,
            t.mode || 'UNKNOWN',
            t.entryDate || '',
            t.closeDate || '',
            t.status || '',
            t.durationMinutes || 0,
            t.entry || 0,
            t.tp || 0,
            t.sl || 0,
            t.closePrice || '',
            safeReason,
            t.analysisContext?.matrixScore?.toFixed(2) || '',
            t.analysisContext?.quick_rsi?.toFixed(2) || '',
            t.analysisContext?.quick_macd?.toFixed(4) || '',
            t.analysisContext?.quick_macd_sig?.toFixed(4) || '',
            t.analysisContext?.quick_macd_hist?.toFixed(4) || '',
            t.analysisContext?.quick_bb_up?.toFixed(4) || '',
            t.analysisContext?.quick_bb_low?.toFixed(4) || '',
            t.analysisContext?.quick_stochRsi?.toFixed(2) || '',
            t.analysisContext?.quick_cci?.toFixed(2) || '',
            t.analysisContext?.quick_williamsR?.toFixed(2) || '',
            t.analysisContext?.quick_atr?.toFixed(4) || '',
            t.analysisContext?.quick_trend || '',
            t.analysisContext?.long_rsi?.toFixed(2) || '',
            t.analysisContext?.long_macd?.toFixed(4) || '',
            t.analysisContext?.long_macd_hist?.toFixed(4) || '',
            t.analysisContext?.long_trend || ''
        ];
        csvContent += row.join(',') + '\n';
    }

    // Prepend BOM for Excel utf-8 rendering
    return Buffer.from('\uFEFF' + csvContent, 'utf-8');
}

export const registerMessageHandlers = (bot: Telegraf, tradeManager: TradeManager) => {
    const bingxService = new BingXService();
    const analysisService = new AnalysisService(bingxService);
    const backtestService = new BacktestService(bingxService, analysisService);

    bot.start(async (ctx) => {
        const user = await User.findOne({ telegramId: ctx.from.id.toString() });
        const welcomeMsg = `🤖 <b>مرحباً بك في بوت التداول الآلي!</b>\n\n` +
            `أنا مساعدك الذكي لتنفيذ صفقات العملات الرقمية على منصة Bingx  بشكل آلي واحترافي.\n\n` +
            `🚀 <b>ماذا يمكنني أن أفعل لك؟</b>\n` +
            `• تنفيذ الصفقات فور استقبال الإشارات.\n` +
            `• إدارة المخاطر وحماية رأس المال.\n` +
            `• متابعة صفقاتك وعرض تقارير الأرباح.\n\n` +
            `استخدم القائمة أدناه للتحكم في كافة الإعدادات.`;

        ctx.replyWithHTML(welcomeMsg, {
            reply_markup: user ? getMainMenuKeyboard(user) : undefined
        });
    });

    bot.command('menu', async (ctx) => {
        try {
            const user = await User.findOne({ telegramId: ctx.from.id.toString() });
            if (!user) return;

            await ctx.reply('🤖 <b>قائمة التحكم - بوت التداول الآلي</b>\nاختر أحد الإجراءات التالية:', {
                parse_mode: 'HTML',
                reply_markup: getMainMenuKeyboard(user)
            }).catch(e => logger.error(`Failed to send menu: ${e.message}`));
        } catch (error) {
            logger.error('Error in /menu:', error);
        }
    });


    // Handle generic text messages (Signals, Cancellations, Report Dates)
    bot.on('message', async (ctx) => {
        try {
            if (!ctx.from || !('text' in ctx.message)) return;

            const message = ctx.message.text;
            const telegramId = ctx.from.id.toString();
            const user = await User.findOne({ telegramId });

            if (!user) return;

            // 1. Check AWAITING States
            if (user.botState === 'AWAITING_RISK_PERCENTAGE') {
                if (message === 'رجوع 🔙') {
                    user.botState = 'NONE';
                    await user.save();
                    return ctx.reply('تم الإلغاء.', { reply_markup: getTraderSettingsKeyboard(user) });
                }


                const riskValue = parseInt(message.replace('%', ''));
                if (!isNaN(riskValue) && riskValue >= 1 && riskValue <= 5) {
                    user.riskPercentage = riskValue;
                    user.botState = 'NONE';
                    await user.save();
                    return ctx.reply(`✅ تم تحديث نسبة المخاطرة إلى ${riskValue}%.`, {
                        reply_markup: getTraderSettingsKeyboard(user)
                    });

                } else {
                    return ctx.reply('يرجى إدخال رقم صحيح بين 1 و 5:');
                }
            }

            if (user.botState === 'AWAITING_TP_SPLITS') {
                if (message === 'رجوع 🔙') {
                    user.botState = 'NONE';
                    await user.save();
                    return ctx.reply('تم الإلغاء.', { reply_markup: getTraderSettingsKeyboard(user) });
                }

                const parts = message.replace(/,/g, ' ').split(/\s+/).filter(p => p.trim() !== '');
                const splits = parts.map(p => parseInt(p));
                const sum = splits.reduce((a, b) => a + b, 0);

                if (splits.some(isNaN) || sum !== 100 || splits.length === 0) {
                    return ctx.reply('⚠️ إدخال غير صحيح. الرجاء التأكد من إدخال أرقام صحيحة وأن المجموع يساوي 100.\nمثال: 50 30 20');
                }

                user.tpProfitSplits = splits;
                user.botState = 'NONE';
                await user.save();
                return ctx.reply(`✅ تم تحديث نسب تقسيم الأرباح بنجاح: ${splits.join('% - ')}%`, {
                    reply_markup: getTraderSettingsKeyboard(user)
                });
            }


            if (user.botState === 'AWAITING_CANCEL_ALL_CONFIRM') {
                if (message === 'نعم، متأكد ✅') {
                    ctx.reply('⏳ جاري إغلاق جميع الصفقات بسعر السوق...');
                    try {
                        const closedCount = await tradeManager.closeAllPositions(user._id.toString());
                        ctx.reply(`✅ تم بنجاح إغلاق ${closedCount} صفقات بسعر السوق.`, { reply_markup: getMainMenuKeyboard(user) });
                    } catch (error) {
                        ctx.reply('❌ حدث خطأ أثناء إغلاق الصفقات.', { reply_markup: getMainMenuKeyboard(user) });
                    }
                } else {
                    ctx.reply('تم الإلغاء.', { reply_markup: getMainMenuKeyboard(user) });
                }
                user.botState = 'NONE';
                await user.save();
                return;
            }

            if (user.botState === 'AWAITING_CANCEL_SYMBOL') {
                if (message === 'رجوع 🔙') {
                    user.botState = 'NONE';
                    await user.save();
                    ctx.reply('تم الإلغاء.', { reply_markup: getMainMenuKeyboard(user) });
                    return;
                }
                const symbol = message.toUpperCase();
                ctx.reply(`⏳ جاري محاولة إغلاق صفقة ${symbol} بسعر السوق...`);
                try {
                    const closed = await tradeManager.closeSpecificPosition(user._id.toString(), symbol);
                    if (closed) {
                        ctx.reply(`✅ تم بنجاح إغلاق صفقة ${symbol}.`, { reply_markup: getMainMenuKeyboard(user) });
                    } else {
                        ctx.reply(`⚠️ لم يتم العثور على صفقة مفتوحة للعملة ${symbol}.`, { reply_markup: getMainMenuKeyboard(user) });
                    }
                } catch (error) {
                    ctx.reply('❌ حدث خطأ، يرجى التأكد من الرمز (مثال: BTC).', { reply_markup: getMainMenuKeyboard(user) });
                }
                user.botState = 'NONE';
                await user.save();
                return;
            }

            if (user.botState === 'AWAITING_QUERY_SYMBOL') {
                if (message === 'رجوع 🔙') {
                    user.botState = 'NONE';
                    await user.save();
                    ctx.reply('تم الإلغاء.', { reply_markup: getMainMenuKeyboard(user) });
                    return;
                }

                // Let's forward the query logic back to the command simulation or manual trigger
                // Since `/status` logic was defined in trading, we reuse that logic basically.
                // We mock message to let the existing /status command handle it nicely if we want, or do inline.
                // It's cleaner to handle inline:
                const symbolInput = message.toUpperCase();
                try {
                    const trade = await Trade.findOne({
                        userId: user._id,
                        currentStatus: { $in: ['OPEN', 'TP1_HIT', 'TP2_HIT'] },
                        symbol: { $regex: symbolInput }
                    }).sort({ entryTime: -1 });

                    if (!trade) {
                        ctx.reply(`لا يوجد صفقة مفتوحة للعملة ${symbolInput}`, { reply_markup: getMainMenuKeyboard(user) });
                    } else {
                        ctx.reply(`يتم الاستعلام، جرب استخدام زر "صفقاتي المفتوحة" لمعرفة التفاصيل بديهيا.`, { reply_markup: getMainMenuKeyboard(user) });
                    }
                } catch (error) { }

                user.botState = 'NONE';
                await user.save();
                return;
            }

            if (user.botState === 'AWAITING_REPORT_DATE') {
                if (message === 'إلغاء ❌') {
                    user.botState = 'NONE';
                    await user.save();
                    ctx.reply('تم الإلغاء.', { reply_markup: getMainMenuKeyboard(user) });
                    return;
                }

                const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
                if (dateRegex.test(message)) {
                    const dateObj = new Date(message);
                    if (!isNaN(dateObj.getTime())) {
                        dateObj.setHours(0, 0, 0, 0); // Start of selected day
                        const nextDay = new Date(dateObj);
                        nextDay.setDate(dateObj.getDate() + 1);

                        ctx.reply(`⏳ جاري جلب التقرير المخصص لتاريخ ${message}...`, { reply_markup: getMainMenuKeyboard(user) });

                        // Quick inline resolution of the report to keep message handler clean, or delegate:
                        const trades = await Trade.find({
                            userId: user._id,
                            currentStatus: { $in: ['CLOSED_PROFIT', 'CLOSED_LOSS', 'CLOSED_MANUAL'] },
                            closeTime: { $gte: dateObj, $lt: nextDay }
                        }).sort({ closeTime: 1 });

                        let netPnl = 0;
                        trades.forEach(t => {
                            const margin = t.amount / (t.leverage || 10);
                            netPnl += margin * ((t.pnl || 0) / 100);
                        });

                        let msg = `📊 <b>تقرير مخصص ليوم ${message}</b>\n\n` +
                            `✅ إجمالي الصفقات المغلقة: <b>${trades.length}</b>\n` +
                            `💰 إجمالي مبلغ الربح/الخسارة: ${netPnl >= 0 ? '🟢' : '🔴'} <b>${netPnl.toFixed(2)} USDT</b>\n`;

                        ctx.replyWithHTML(msg).catch(e => logger.error(`Failed to send custom report: ${e.message}`));
                    } else {
                        ctx.reply('❌ تاريخ غير صحيح، يرجى الإلغاء والمحاولة مرة أخرى.');
                        return; // keep state
                    }
                } else {
                    ctx.reply('❌ صيغة التاريخ غير صحيحة، يرجى كتابتها بالشكل 2026-03-01');
                    return; // keep state
                }

                user.botState = 'NONE';
                await user.save();
                return;
            }

            if (user.botState === 'AWAITING_HITLAR_RISK') {
                if (message === 'رجوع 🔙') {
                    user.botState = 'NONE';
                    await user.save();
                    return ctx.reply('تم الإلغاء.', { reply_markup: getTraderSettingsKeyboard(user) });
                }

                const val = parseInt(message.replace('%', ''));
                if (!isNaN(val) && val >= 1 && val <= 100) {
                    user.hitlarSettings.riskPercentage = val;
                    user.botState = 'NONE';
                    await user.save();
                    return ctx.reply(`✅ تم تحديث نسبة الدخول لوضع هترل إلى ${val}%.`, { reply_markup: getTraderSettingsKeyboard(user) });

                } else {
                    return ctx.reply('يرجى إدخال رقم بين 1 و 100:');
                }
            }

            if (user.botState === 'AWAITING_HITLAR_LEV') {
                if (message === 'رجوع 🔙') {
                    user.botState = 'NONE';
                    await user.save();
                    return ctx.reply('تم الإلغاء.', { reply_markup: getTraderSettingsKeyboard(user) });
                }

                const val = parseInt(message.replace('x', ''));
                if (!isNaN(val) && val >= 1 && val <= 125) {
                    user.hitlarSettings.leverage = val;
                    user.botState = 'NONE';
                    await user.save();
                    return ctx.reply(`✅ تم تحديث الرافعة المالية لوضع هترل إلى x${val}.`, { reply_markup: getTraderSettingsKeyboard(user) });

                } else {
                    return ctx.reply('يرجى إدخال رقم بين 1 و 125:');
                }
            }

            if (user.botState === 'AWAITING_HITLAR_SL') {
                if (message === 'رجوع 🔙') {
                    user.botState = 'NONE';
                    await user.save();
                    return ctx.reply('تم الإلغاء.', { reply_markup: getTraderSettingsKeyboard(user) });
                }

                const val = parseInt(message.replace('%', ''));
                if (!isNaN(val) && val >= 1 && val <= 50) {
                    user.hitlarSettings.volatilitySlPercentage = val;
                    user.botState = 'NONE';
                    await user.save();
                    return ctx.reply(`✅ تم تحديث نسبة وقف الخسارة لوضع هترل إلى ${val}%.`, { reply_markup: getTraderSettingsKeyboard(user) });

                } else {
                    return ctx.reply('يرجى إدخال رقم بين 1 و 50:');
                }
            }

            // --- SMART ANALYSIS FLOW ---
            if (message === '📊 التحليل الذكي (V1/V2)') {
                return ctx.reply('الرجاء اختيار إصدار خوارزمية التحليل التي تود استخدامها:', {
                    reply_markup: getAlgoVersionKeyboard()
                });
            }

            if (message === 'دليل الخوارزميات 📖') {
                const guide = `📖 **دليل الخوارزميات (V1-V6):**\n\n` +
                    `${analysisService.getAlgorithmExplanation('V1')}\n\n` +
                    `${analysisService.getAlgorithmExplanation('V2')}\n\n` +
                    `${analysisService.getAlgorithmExplanation('V3')}\n\n` +
                    `${analysisService.getAlgorithmExplanation('V4')}\n\n` +
                    `${analysisService.getAlgorithmExplanation('V5')}\n\n` +
                    `${analysisService.getAlgorithmExplanation('V6')}`;
                return ctx.reply(guide);
            }

            if (message === 'الخوارزمية V1 (الأساسي)') {
                user.botState = 'AWAITING_ANALYSIS_SYMBOL_V1';
                await user.save();
                return ctx.reply('يرجى إرسال رمز العملة للتحليل باستخدام V1 (مثال: BTC):', {
                    reply_markup: { keyboard: [[{ text: 'إلغاء ❌' }]], resize_keyboard: true }
                });
            }

            if (message === 'الخوارزمية V2 (الكمي - Quant)') {
                user.botState = 'AWAITING_ANALYSIS_SYMBOL_V2';
                await user.save();
                return ctx.reply('يرجى إرسال رمز العملة للتحليل باستخدام V2 (مثال: BTC):', {
                    reply_markup: { keyboard: [[{ text: 'إلغاء ❌' }]], resize_keyboard: true }
                });
            }

            if (message === 'الخوارزمية V3 (المصفوفة)') {
                user.botState = 'AWAITING_ANALYSIS_SYMBOL_V3';
                await user.save();
                return ctx.reply('يرجى إرسال رمز العملة للتحليل باستخدام V3 (مثال: BTC):', {
                    reply_markup: { keyboard: [[{ text: 'إلغاء ❌' }]], resize_keyboard: true }
                });
            }

            if (message === 'الخوارزمية V4 (ثنائي الاتجاه)') {
                user.botState = 'AWAITING_ANALYSIS_SYMBOL_V4';
                await user.save();
                return ctx.reply('يرجى إرسال رمز العملة للتحليل باستخدام V4 (مثال: BTC):', {
                    reply_markup: { keyboard: [[{ text: 'إلغاء ❌' }]], resize_keyboard: true }
                });
            }

            if (message === 'الخوارزمية V5 (تنبؤي AI) 🔮') {
                user.botState = 'AWAITING_ANALYSIS_SYMBOL_V5';
                await user.save();
                return ctx.reply('يرجى إرسال رمز العملة للتحليل باستخدام V5 (التنبؤي) (مثال: BTC):', {
                    reply_markup: { keyboard: [[{ text: 'إلغاء ❌' }]], resize_keyboard: true }
                });
            }

            if (message === 'الخوارزمية V6 (Sniper V7) 🎯') {
                user.botState = 'AWAITING_ANALYSIS_SYMBOL_V6';
                await user.save();
                return ctx.reply('يرجى إرسال رمز العملة للتحليل باستخدام V6 (Sniper V7) 🎯 (مثال: BTC):', {
                    reply_markup: { keyboard: [[{ text: 'إلغاء ❌' }]], resize_keyboard: true }
                });
            }

            if (message === '🔬 اختبار الاستراتيجيات') {
                user.botState = 'AWAITING_BT_SYMBOL';
                await user.save();
                return ctx.reply('يرجى إرسال رمز العملة الذي تريد اختباره (مثال: BTC):', {
                    reply_markup: { keyboard: [[{ text: 'إلغاء ❌' }]], resize_keyboard: true }
                });
            }

            if (user.botState === 'AWAITING_BT_SYMBOL') {
                if (message === 'إلغاء ❌' || message === 'رجوع للقائمة الرئيسية 🔙') {
                    user.botState = 'NONE';
                    await user.save();
                    return ctx.reply('تم الإلغاء.', { reply_markup: getMainMenuKeyboard(user) });
                }
                const symbol = message.toUpperCase();
                user.botState = 'NONE';
                await user.save();
                return ctx.reply(`اختر إصدار الخوارزمية لاختبار ${symbol}:`, {
                    reply_markup: getBacktestVersionKeyboard(symbol)
                });
            }

            if (user.botState && user.botState.startsWith('AWAITING_ANALYSIS_SYMBOL_')) {
                if (message === 'إلغاء ❌' || message === 'رجوع للقائمة الرئيسية 🔙') {
                    user.botState = 'NONE';
                    await user.save();
                    return ctx.reply('تم الإلغاء.', { reply_markup: getMainMenuKeyboard(user) });
                }

                const version = user.botState.split('_').pop() as 'V1' | 'V2' | 'V3' | 'V4' | 'V5' | 'V6';
                const symbol = message.toUpperCase();
                ctx.reply(`⏳ جاري تحليل ${symbol} باستخدام ${version}... (TF: ${user.analysisSettings?.scalpTF || '5m'}/${user.analysisSettings?.swingTF || '1h'})`);

                try {
                    const result = await analysisService.analyze(symbol, version, {
                        quickTF: user.analysisSettings?.scalpTF,
                        longTF: user.analysisSettings?.swingTF,
                        limit: user.analysisSettings?.candleLimit,
                        rsiThreshold: user.analysisSettings?.rsiThreshold
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

            // --- ANALYSIS SETTINGS FLOW ---
            if (message === '⚙️ إعدادات المحلل الذكي') {
                return ctx.reply('إعدادات المحلل الذكي: يمكنك تخصيص الفريمات الزمنية وعدد الشمعات المستخدمة في التحليل.', {
                    reply_markup: getAnalysisSettingsKeyboard()
                });
            }

            if (message === '⏱️ فريم السكالبينج') {
                return ctx.reply('اختر فريم السكالبينج المفضل:', {
                    reply_markup: getTFSelectionKeyboard('scalp')
                });
            }

            if (message === '🌊 فريم السوينج') {
                return ctx.reply('اختر فريم السوينج المفضل:', {
                    reply_markup: getTFSelectionKeyboard('swing')
                });
            }

            if (message === '📊 عدد الشمعات (Limit)') {
                return ctx.reply('اختر عدد الشمعات التاريخية لتحليلها:', {
                    reply_markup: getLimitSelectionKeyboard()
                });
            }

            if (message === '📉 مؤشر RSI Threshold') {
                return ctx.reply('اختر قيمة RSI المفضلة (قيمة أقل = شروط دخول أقسى، قيمة أعلى = دخول أسرع):', {
                    reply_markup: getRSISelectionKeyboard()
                });
            }

            // 2. Default: Attempt to parse signal
            const signal = SignalParser.parse(message);
            if (signal) {
                logger.info(`Received valid signal from ${ctx.from.username || telegramId}`);
                ctx.reply(`📡 تم التعرف على الإشارة (${signal.symbol} - ${signal.direction || signal.type}).\n⏳ جاري إرسال الطلب للمنصة...`);

                try {
                    const result = await tradeManager.executeSignal(signal, user._id.toString(), ctx.chat.id.toString());

                    if (signal.type === 'CLOSE') {
                        ctx.reply(`✅ تم إغلاق الصفقة (أو الصفقات) للعملة ${signal.symbol} بنجاح.`);
                    } else if (result) {
                        const precision = await bingxService.getPricePrecision(result.symbol);
                        const orderTypeLabel = result.orderType === 'limit'
                            ? `📌 حدي (Limit) عند ${result.entryPrice.toFixed(precision)}`
                            : '⚡ سوق (Market)';

                        let successMsg = result.isPending
                            ? `⏳ <b>تم وضع أمر حدي بنجاح — ينتظر التنفيذ!</b>
💡 سيتم وضع الأهداف والاستوب تلقائياً عند تنفيذ الأمر.\n\n`
                            : `✅ <b>تم تنفيذ الصفقة بنجاح على Bingx !</b>\n\n`;

                        successMsg +=
                            `الرمز: <b>${result.symbol}</b>\n` +
                            `الاتجاه: <b>${result.direction}</b>\n` +
                            `نوع التنفيذ: <b>${orderTypeLabel}</b>\n` +
                            `الرافعة المالية: <b>${result.leverage}x</b>\n` +
                            `المبلغ المستثمر (Margin): <b>${result.margin.toFixed(precision)} USDT</b> (${result.marginPercentage}% من رأس المال)\n` +
                            `سعر الدخول: <b>${result.entryPrice.toFixed(precision)}</b>\n\n`;

                        if (result.targets.length > 0) {
                            successMsg += `🎯 <b>الأهداف:</b>\n`;
                            result.targets.forEach((t, i) => {
                                successMsg += `الهدف ${i + 1}: ${t.price.toFixed(precision)} (+${t.pnlPercent.toFixed(2)}%)\n`;
                            });
                            successMsg += '\n';
                        }

                        successMsg += `🛑 <b>وقف الخسارة:</b> ${result.stopLoss.price.toFixed(precision)} (${result.stopLoss.pnlPercent.toFixed(2)}%)`;

                        await sendTelegramMessage(bot, ctx.chat.id, successMsg);

                        // Send notification to user's private bot if different from current chat
                        if (user.telegramId && user.telegramId !== ctx.chat.id.toString()) {
                            await sendTelegramMessage(bot, user.telegramId, successMsg)
                                .catch(e => logger.error(`Failed to send duplicate notification to user: ${e.message}`));
                        }
                    }
                } catch (error: any) {
                    logger.error(`Signal validation failed for ${ctx.from.username || telegramId}`, error);
                    ctx.reply(`❌ فشل تنفيذ الصفقة:\n${error.message}`);
                }
            }

        } catch (error) {
            logger.error('Error in general message handler:', error);
            ctx.reply('حدث خطأ غير متوقع.');
        }
    });

    // --- BACKTEST WIZARD CALLBACKS ---
    bot.action('btw_cancel', async (ctx) => {
        await ctx.answerCbQuery('تم الإلغاء');
        await ctx.deleteMessage().catch(() => {});
    });

    bot.action(/^btw_v_(V[1-6])_(.+)$/, async (ctx) => {
        const version = ctx.match[1];
        const symbol = ctx.match[2];
        await ctx.editMessageText(`اختر نوع الاختبار (هل تريد اختبار الصفقات السريعة أم الاستثمارية؟)\nالإصدار: ${version} - العملة: ${symbol}:`, {
            reply_markup: getBacktestModeKeyboard(version, symbol)
        });
    });

    bot.action(/^btw_m_(SCALP|SWING)_(V[1-6])_(.+)$/, async (ctx) => {
        const mode = ctx.match[1];
        const version = ctx.match[2];
        const symbol = ctx.match[3];
        const modeText = mode === 'SCALP' ? 'سكالبينج ⚡️' : 'سوينج 🌊';
        
        await ctx.editMessageText(`اختر الفاصل الزمني للتحليل (كل كم دقيقة تريد أن يحلل البوت؟)\nالنوع: ${modeText} - الإصدار: ${version} - العملة: ${symbol}:`, {
            reply_markup: getBacktestStepKeyboard(mode, version, symbol)
        });
    });

    bot.action(/^btw_s_(15|30|60)_(SCALP|SWING)_(V[1-6])_(.+)$/, async (ctx) => {
        const step = ctx.match[1];
        const mode = ctx.match[2];
        const version = ctx.match[3];
        const symbol = ctx.match[4];
        await ctx.editMessageText(`اختر مدة الاختبار (كم يوم للوراء؟)\nالفاصل: كل ${step} دقيقة - الإصدار: ${version} - العملة: ${symbol}:`, {
            reply_markup: getBacktestDaysKeyboard(step, mode, version, symbol)
        });
    });

    bot.action(/^btw_d_(\d+)_(15|30|60)_(SCALP|SWING)_(V[1-6])_(.+)$/, async (ctx) => {
        const days = parseInt(ctx.match[1]);
        const stepMinutes = parseInt(ctx.match[2]);
        const mode = ctx.match[3] as 'SCALP' | 'SWING';
        const version = ctx.match[4];
        const symbolInput = ctx.match[5];
        
        const symbol = symbolInput.includes('/') ? symbolInput : `${symbolInput}/USDT:USDT`;
        const modeText = mode === 'SCALP' ? 'سكالبينج ⚡️' : 'سوينج 🌊';

        await ctx.editMessageText(`⏳ جاري إجراء الاختبار الرجعي المتقدم...\nالعملة: ${symbol}\nالإصدار: ${version}\nالنوع: ${modeText}\nفاصل التحليل: كل ${stepMinutes} دقيقة\nمدة الاختبار: آخر ${days} أيام\n\n*(يرجى الانتظار، قد يستغرق سحب البيانات الدقيقة وتحليلها وقتاً طويلاً)*`);
        
        try {
            // Using user's default TFs for quick and long TF
            const quickTF = '5m';
            const longTF = '1h';

            const telegramId = ctx.from?.id.toString();
            const user = await User.findOne({ telegramId });
            
            const result = await backtestService.runAdvancedBacktest(symbol, version, {
                quickTF: quickTF,
                longTF: longTF,
                days: days,
                stepMinutes: stepMinutes,
                mode: mode
            });
            
            if (user) {
                await ctx.reply(result.reportText, { parse_mode: 'Markdown', reply_markup: getMainMenuKeyboard(user) });
            } else {
                await ctx.reply(result.reportText, { parse_mode: 'Markdown' });
            }

            if (result.trades && result.trades.length > 0) {
                const csvBuffer = generateCSVBuffer(result.trades);
                const safeSymbol = symbol.replace(/[\/:]/g, '_');
                const fileName = `Backtest_${version}_${mode}_${safeSymbol}.csv`;
                await ctx.replyWithDocument({ source: csvBuffer, filename: fileName });
            }
            
            // Note: The `result.trades` array is saved and available here for future JSON/CSV export functionality.
        } catch (error: any) {
            logger.error('Error in advanced backtest wizard:', error);
            await ctx.reply(`❌ فشل الاختبار: ${error.message}`);
        }
    });

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
            await ctx.answerCbQuery('تم إنشاء نموذج ا لإشارة ✅');
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
                quickTF: '5m',
                longTF: '1h',
                days: 1, // Quick test uses 1 day
                stepMinutes: 30, // Default to 30 mins
                mode: mode
            });
            
            if (user) {
                await ctx.reply(result.reportText, { parse_mode: 'Markdown', reply_markup: getMainMenuKeyboard(user) });
            } else {
                await ctx.reply(result.reportText, { parse_mode: 'Markdown' });
            }

            if (result.trades && result.trades.length > 0) {
                const csvBuffer = generateCSVBuffer(result.trades);
                const safeSymbol = symbol.replace(/[\/:]/g, '_');
                const fileName = `Backtest_${version}_${mode}_${safeSymbol}.csv`;
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
                longTF: user?.analysisSettings?.swingTF
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
                longTF: user?.analysisSettings?.swingTF
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
                longTF: user?.analysisSettings?.swingTF
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
                longTF: user?.analysisSettings?.swingTF
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
};
