import { Telegraf } from 'telegraf';
import logger from '../../utils/logger';
import { formatPrice, formatAmount } from '../../utils/formatters';
import User from '../../models/User';
import Trade from '../../models/Trade';
import { getMainMenuKeyboard, getTraderSettingsKeyboard } from '../keyboards/baseKeyboards';

import { SignalParser } from '../../services/SignalParser';
import { TradeManager } from '../../services/TradeManager';

export const registerMessageHandlers = (bot: Telegraf, tradeManager: TradeManager) => {

    bot.start(async (ctx) => {
        const user = await User.findOne({ telegramId: ctx.from.id.toString() });
        const welcomeMsg = `🤖 <b>مرحباً بك في بوت التداول الآلي!</b>\n\n` +
            `أنا مساعدك الذكي لتنفيذ صفقات العملات الرقمية على منصة XT بشكل آلي واحترافي.\n\n` +
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
                } catch (error) {}

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
                                  `💰 إجمالي مبلغ الربح/الخسارة: ${netPnl >= 0 ? '🟢' : '🔴'} <b>${formatAmount(netPnl)} USDT</b>\n`;
                        
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
                        const orderTypeLabel = result.orderType === 'limit'
                            ? `📌 حدي (Limit) عند ${formatPrice(result.entryPrice)}`
                            : '⚡ سوق (Market)';

                        let successMsg = result.isPending
                            ? `⏳ <b>تم وضع أمر حدي بنجاح — ينتظر التنفيذ!</b>
💡 سيتم وضع الأهداف والاستوب تلقائياً عند تنفيذ الأمر.\n\n`
                            : `✅ <b>تم تنفيذ الصفقة بنجاح على XT!</b>\n\n`;

                        successMsg +=
                            `الرمز: <b>${result.symbol}</b>\n` +
                            `الاتجاه: <b>${result.direction}</b>\n` +
                            `نوع التنفيذ: <b>${orderTypeLabel}</b>\n` +
                            `الرافعة المالية: <b>${result.leverage}x</b>\n` +
                            `المبلغ المستثمر (Margin): <b>${formatAmount(result.margin)} USDT</b> (${result.marginPercentage}% من رأس المال)\n` +
                            `سعر الدخول: <b>${formatPrice(result.entryPrice)}</b>\n\n`;

                        if (result.targets.length > 0) {
                            successMsg += `🎯 <b>الأهداف:</b>\n`;
                            result.targets.forEach((t, i) => {
                                successMsg += `الهدف ${i + 1}: ${formatPrice(t.price)} (+${t.pnlPercent.toFixed(2)}%)\n`;
                            });
                            successMsg += '\n';
                        }
                        
                        successMsg += `🛑 <b>وقف الخسارة:</b> ${formatPrice(result.stopLoss.price)} (${result.stopLoss.pnlPercent.toFixed(2)}%)`;

                        await ctx.replyWithHTML(successMsg);

                        // Send notification to user's private bot if different from current chat
                        if (user.telegramId && user.telegramId !== ctx.chat.id.toString()) {
                            await bot.telegram.sendMessage(user.telegramId, successMsg, { parse_mode: 'HTML' })
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
};
