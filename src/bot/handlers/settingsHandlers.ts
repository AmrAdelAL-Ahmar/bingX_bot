import { Telegraf } from 'telegraf';
import logger from '../../utils/logger';
import User from '../../models/User';
import { ALL_TP_THRESHOLDS, buildAlertSettingsKeyboard, getMainMenuKeyboard } from '../keyboards/baseKeyboards';

export const registerSettingsHandlers = (bot: Telegraf) => {

    bot.hears('ℹ️ تعليمات الاستخدام (Help)', async (ctx) => {
        try {
            const helpMsg = `ℹ️ <b>دليل الاستخدام السريع:</b>\n\n` +
                `• <b>رصيدي:</b> يعرض كمية الـ USDT والأرباح العائمة حالياً.\n` +
                `• <b>صفقاتي المفتوحة:</b> يعرض الصفقات المفتوحة وحالة الربح/الخسارة لكل واحدة.\n` +
                `• <b>التقارير:</b> يعرض ملخص نتائج الصفقات المغلقة (يومياً أو بصفة عامة).\n` +
                `• <b>إلغاء الصفقات:</b> يمكنك اختيارياً إلغاء كل الصفقات أو تحديد عملة معينة ليتم إغلاقها بسعر السوق (Market).\n` +
                `• <b>حماية رأس المال:</b> إذا كانت مفعلة، سيقوم البوت بتقليل حجم الصفقة إجبارياً بحيث لا تتجاوز خسارة الـ Stop Loss حاجز الـ 6% من حسابك.`;
    
            ctx.replyWithHTML(helpMsg);
        } catch (e) { }
    });
    
    bot.hears(/⚡ نسبة المخاطرة/, async (ctx) => {
        try {
            if (!ctx.from) return;
            const user = await User.findOne({ telegramId: ctx.from.id.toString() });
            if (!user) return;

            user.botState = 'AWAITING_RISK_PERCENTAGE';
            await user.save();

            ctx.reply('قم بإدخال نسبة المخاطرة الجديدة (رقم بين 1 و 5):', {
                reply_markup: {
                    keyboard: [
                        [{ text: '1%' }, { text: '2%' }, { text: '3%' }, { text: '4%' }, { text: '5%' }],
                        [{ text: 'رجوع 🔙' }]
                    ],
                    resize_keyboard: true,
                    one_time_keyboard: true
                }
            });
        } catch (e) {
            ctx.reply('حدث خطأ أثناء تعديل الإعدادات.');
        }
    });

    bot.hears(/🛡 حماية رأس المال/, async (ctx) => {
        try {
            if (!ctx.from) return;
            const user = await User.findOne({ telegramId: ctx.from.id.toString() });
            if (!user) return;
    
            const currentStatus = (user.enforceMaxSlLoss !== null && user.enforceMaxSlLoss !== undefined)
                ? user.enforceMaxSlLoss
                : process.env.ENFORCE_MAX_SL_LOSS === 'true';
    
            const newStatus = !currentStatus;
            user.enforceMaxSlLoss = newStatus;
            await user.save();
    
            const statusMsg = newStatus ? 'مفعل 🟢' : 'معطل 🔴';
    
            await ctx.reply(`✅ تم تحديث ميزة حماية رأس المال الصارمة. الحالة الآن: ${statusMsg}`, {
                reply_markup: getMainMenuKeyboard(user)
            });
        } catch (e) {
            ctx.reply('حدث خطأ أثناء تعديل الإعدادات.');
        }
    });

    bot.hears('⚙️ إعدادات التنبيهات', async (ctx) => {
        if (!ctx.from) return;
        const user = await User.findOne({ telegramId: ctx.from.id.toString() });
        if (!user) return;
    
        const slOn: boolean = user.slWarningEnabled !== false;
        const tpOn: boolean = user.tpWarningEnabled !== false;
        const thresholds: number[] = user.tpWarningThresholds || [70, 90];
    
        const msg = `⚙️ <b>إعدادات التنبيهات</b>\n\n` +
            `🔔 تنبيه وقف الخسارة (SL): <b>${slOn ? 'مفعل ✅' : 'معطل ❌'}</b>\n` +
            `   يُرسل تحذير عندما تصل الخسارة إلى 5% من رأس المال.\n\n` +
            `🎯 تنبيه الهدف (TP): <b>${tpOn ? 'مفعل ✅' : 'معطل ❌'}</b>\n` +
            `   النسب المفعّلة: <b>${thresholds.sort((a, b) => a - b).join('%, ')}%</b>\n\n` +
            `اضغط على الأزرار أدناه لتعديل الإعدادات:`;
    
        await ctx.replyWithHTML(msg, { reply_markup: buildAlertSettingsKeyboard(user) });
    });
    
    // Handle alert settings inline keyboard
    bot.on('callback_query', async (ctx) => {
        const data = (ctx.callbackQuery as any).data as string;
        if (!data || !data.startsWith('alert_')) return;
    
        if (!ctx.from) return;
        const user = await User.findOne({ telegramId: ctx.from.id.toString() });
        if (!user) return;
    
        if (data === 'alert_toggle_sl') {
            user.slWarningEnabled = !(user.slWarningEnabled !== false);
        } else if (data === 'alert_toggle_tp') {
            user.tpWarningEnabled = !(user.tpWarningEnabled !== false);
        } else if (data === 'alert_tp_all') {
            user.tpWarningThresholds = [...ALL_TP_THRESHOLDS];
        } else if (data === 'alert_tp_none') {
            user.tpWarningThresholds = [];
        } else if (data.startsWith('alert_tp_')) {
            const val = parseInt(data.replace('alert_tp_', ''));
            if (!isNaN(val)) {
                const current: number[] = user.tpWarningThresholds || [];
                if (current.includes(val)) {
                    user.tpWarningThresholds = current.filter(t => t !== val);
                } else {
                    user.tpWarningThresholds = [...current, val];
                }
            }
        } else {
            return;
        }
    
        await user.save();
    
        // Update the inline keyboard message
        const slOn: boolean = user.slWarningEnabled !== false;
        const tpOn: boolean = user.tpWarningEnabled !== false;
        const thresholds: number[] = user.tpWarningThresholds || [];
    
        const newMsg = `⚙️ <b>إعدادات التنبيهات</b>\n\n` +
            `🔔 تنبيه وقف الخسارة (SL): <b>${slOn ? 'مفعل ✅' : 'معطل ❌'}</b>\n` +
            `   يُرسل تحذير عندما تصل الخسارة إلى 5% من رأس المال.\n\n` +
            `🎯 تنبيه الهدف (TP): <b>${tpOn ? 'مفعل ✅' : 'معطل ❌'}</b>\n` +
            `   النسب المفعّلة: <b>${thresholds.length > 0 ? thresholds.sort((a, b) => a - b).join('%, ') + '%' : 'لا يوجد'}</b>\n\n` +
            `اضغط على الأزرار أدناه لتعديل الإعدادات:`;
    
        try {
            await ctx.editMessageText(newMsg, {
                parse_mode: 'HTML',
                reply_markup: buildAlertSettingsKeyboard(user)
            });
            await ctx.answerCbQuery('✅ تم الحفظ').catch(e => logger.error(`Failed to answer alerts cb: ${e.message}`));
        } catch (e) {
            await ctx.answerCbQuery('✅ تم الحفظ').catch(e => logger.error(`Failed to answer alerts cb error: ${e.message}`));
        }
    });

};
