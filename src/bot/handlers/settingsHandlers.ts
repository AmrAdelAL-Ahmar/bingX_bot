import { Telegraf } from 'telegraf';
import logger from '../../utils/logger';
import User from '../../models/User';
import { ALL_TP_THRESHOLDS, buildAlertSettingsKeyboard, buildCapitalProtectionKeyboard, buildLeverageKeyboard, getMainMenuKeyboard } from '../keyboards/baseKeyboards';

export const registerSettingsHandlers = (bot: Telegraf) => {

    bot.hears('ℹ️ تعليمات الاستخدام (Help)', async (ctx) => {
        try {
            const helpMsg = `ℹ️ <b>دليل الاستخدام السريع:</b>\n\n` +
                `• <b>رصيدي:</b> يعرض كمية الـ USDT والأرباح العائمة حالياً.\n` +
                `• <b>صفقاتي المفتوحة:</b> يعرض الصفقات المفتوحة وحالة الربح/الخسارة لكل واحدة.\n` +
                `• <b>التقارير:</b> يعرض ملخص نتائج الصفقات المغلقة (يومياً أو بصفة عامة).\n` +
                `• <b>إلغاء الصفقات:</b> يمكنك اختيارياً إلغاء كل الصفقات أو تحديد عملة معينة ليتم إغلاقها بسعر السوق (Market).\n` +
                `• <b>حماية رأس المال:</b> إذا كانت مفعلة، سيقوم البوت بتقليل حجم الصفقة إجبارياً بحيث لا تتجاوز خسارة الـ Stop Loss حاجز الـ 6% من حسابك.\n` +
                `• <b>نوع تنفيذ الصفقة:</b> اختر بين أمر السوق (Market) للدخول الفوري، أو أمر حدي (Limit) للانتظار على سعر محدد.`;
    
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

    bot.hears('🛡 حماية رأس المال الصارمة', async (ctx) => {
        try {
            if (!ctx.from) return;
            const user = await User.findOne({ telegramId: ctx.from.id.toString() });
            if (!user) return;
    
            const isEnabled = (user.enforceMaxSlLoss !== null && user.enforceMaxSlLoss !== undefined)
                ? user.enforceMaxSlLoss
                : process.env.ENFORCE_MAX_SL_LOSS === 'true';
            
            const currentPercent = user.maxSlRiskPercentage || 6;
    
            const msg = `🛡 <b>ميزة حماية رأس المال الصارمة</b>\n\n` +
                `هذه الميزة تقوم بتقليل حجم الصفقة إجبارياً بحيث لا تتجاوز خسارة الـ Stop Loss النسبة المحددة من إجمالي رأس مالك.\n\n` +
                `الحالة الآن: <b>${isEnabled ? 'مفعلة 🟢' : 'معطلة 🔴'}</b>\n` +
                `النسبة المحددة: <b>${currentPercent}%</b>\n\n` +
                `اختر الحالة أو النسبة المطلوبة:`;
    
            await ctx.replyWithHTML(msg, {
                reply_markup: buildCapitalProtectionKeyboard(user)
            });
        } catch (e) {
            ctx.reply('حدث خطأ أثناء فتح إعدادات حماية رأس المال.');
        }
    });

    // --- Order Execution Mode ---
    bot.hears(/🔄 نوع تنفيذ الصفقة/, async (ctx) => {
        try {
            if (!ctx.from) return;
            const user = await User.findOne({ telegramId: ctx.from.id.toString() });
            if (!user) return;

            const currentMode = user.orderMode || 'market';

            const msg =
                `🔄 <b>نوع تنفيذ الصفقات</b>\n\n` +
                `الوضع الحالي: <b>${currentMode === 'limit' ? '📌 حدي (Limit)' : '⚡ سوق (Market)'}</b>\n\n` +
                `• <b>أمر السوق (Market):</b> يدخل الصفقة فوراً بأفضل سعر متاح.\n` +
                `• <b>أمر حدي (Limit):</b> ينتظر السعر المحدد في التوصية. يتم وضع الأهداف والاستوب بعد التنفيذ.\n` +
                `  <i>ℹ️ إذا كان سعر الدخول غير مناسب (أكبر من السوق للشراء أو أصغر للبيع) يدخل بسعر السوق مباشرة.</i>\n\n` +
                `اختر الوضع الذي تريده:`;

            await ctx.replyWithHTML(msg, {
                reply_markup: {
                    inline_keyboard: [
                        [
                            {
                                text: currentMode === 'market' ? '⚡ سوق (Market) ✔️' : '⚡ سوق (Market)',
                                callback_data: 'order_mode_market'
                            },
                            {
                                text: currentMode === 'limit' ? '📌 حدي (Limit) ✔️' : '📌 حدي (Limit)',
                                callback_data: 'order_mode_limit'
                            }
                        ]
                    ]
                }
            });
        } catch (e) {
            ctx.reply('حدث خطأ أثناء فتح إعدادات التنفيذ.');
        }
    });

    // --- Leverage Settings ---
    bot.hears(/⚖️ إعدادات الرافعة/, async (ctx) => {
        try {
            if (!ctx.from) return;
            const user = await User.findOne({ telegramId: ctx.from.id.toString() });
            if (!user) return;

            const mode = user.leverageMode || 'default';
            const val = user.fixedLeverageValue || 10;

            const msg = `⚖️ <b>إعدادات الرافعة المالية (Leverage)</b>\n\n` +
                `الوضع الحالي: <b>${mode === 'fixed' ? `📌 ثابت (x${val})` : '⚙️ تلقائي (حسب التوصية)'}</b>\n\n` +
                `• <b>تلقائي:</b> يتبع الرافعة المذكورة في التوصية. إذا لم تذكر، يستخدم <b>x10</b>.\n` +
                `• <b>ثابت:</b> يتم تجاهل الرافعة في التوصية واستخدام القيمة المحددة أدناه لجميع الصفقات.\n\n` +
                `اختر الوضع أو القيمة المطلوبة:`;

            await ctx.replyWithHTML(msg, {
                reply_markup: buildLeverageKeyboard(user)
            });
        } catch (e) {
            ctx.reply('حدث خطأ أثناء فتح إعدادات الرافعة.');
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
    
    // Handle all inline keyboard callbacks
    bot.on('callback_query', async (ctx) => {
        const data = (ctx.callbackQuery as any).data as string;
        if (!data) return;
        if (!ctx.from) return;

        // --- Order Mode Callbacks ---
        if (data === 'order_mode_market' || data === 'order_mode_limit') {
            const user = await User.findOne({ telegramId: ctx.from.id.toString() });
            if (!user) return;

            const newMode = data === 'order_mode_limit' ? 'limit' : 'market';
            user.orderMode = newMode;
            await user.save();

            const modeLabel = newMode === 'limit' ? '📌 حدي (Limit)' : '⚡ سوق (Market)';
            const msg =
                `🔄 <b>نوع تنفيذ الصفقات</b>\n\n` +
                `تم التحديث! الوضع الحالي: <b>${modeLabel}</b>\n\n` +
                `• <b>أمر السوق (Market):</b> يدخل الصفقة فوراً بأفضل سعر متاح.\n` +
                `• <b>أمر حدي (Limit):</b> ينتظر السعر المحدد في التوصية. يتم وضع الأهداف والاستوب بعد التنفيذ.\n` +
                `  <i>ℹ️ إذا كان سعر الدخول غير مناسب (أكبر من السوق للشراء أو أصغر للبيع) يدخل بسعر السوق مباشرة.</i>\n\n` +
                `اختر الوضع الذي تريده:`;

            try {
                await ctx.editMessageText(msg, {
                    parse_mode: 'HTML',
                    reply_markup: {
                        inline_keyboard: [
                            [
                                {
                                    text: newMode === 'market' ? '⚡ سوق (Market) ✔️' : '⚡ سوق (Market)',
                                    callback_data: 'order_mode_market'
                                },
                                {
                                    text: newMode === 'limit' ? '📌 حدي (Limit) ✔️' : '📌 حدي (Limit)',
                                    callback_data: 'order_mode_limit'
                                }
                            ]
                        ]
                    }
                });
            } catch (e) { /* message unchanged */ }

            await ctx.answerCbQuery(`✅ تم التحويل إلى ${modeLabel}`).catch(() => {});

            // Also update the main menu keyboard
            await ctx.reply(`✅ تم تحديث نوع التنفيذ إلى: ${modeLabel}`, {
                reply_markup: getMainMenuKeyboard(user)
            });
            return;
        }

        // --- Capital Protection Callbacks ---
        if (data.startsWith('cap_')) {
            const user = await User.findOne({ telegramId: ctx.from.id.toString() });
            if (!user) return;

            if (data === 'cap_toggle') {
                const currentStatus = (user.enforceMaxSlLoss !== null && user.enforceMaxSlLoss !== undefined)
                    ? user.enforceMaxSlLoss
                    : process.env.ENFORCE_MAX_SL_LOSS === 'true';
                user.enforceMaxSlLoss = !currentStatus;
            } else if (data.startsWith('cap_perc_')) {
                const perc = parseInt(data.replace('cap_perc_', ''));
                if (!isNaN(perc)) {
                    user.maxSlRiskPercentage = perc;
                }
            }

            await user.save();

            const isEnabled = user.enforceMaxSlLoss;
            const currentPercent = user.maxSlRiskPercentage || 6;

            const newMsg = `🛡 <b>ميزة حماية رأس المال الصارمة</b>\n\n` +
                `هذه الميزة تقوم بتقليل حجم الصفقة إجبارياً بحيث لا تتجاوز خسارة الـ Stop Loss النسبة المحددة من إجمالي رأس مالك.\n\n` +
                `الحالة الآن: <b>${isEnabled ? 'مفعلة 🟢' : 'معطلة 🔴'}</b>\n` +
                `النسبة المحددة: <b>${currentPercent}%</b>\n\n` +
                `اختر الحالة أو النسبة المطلوبة:`;

            try {
                await ctx.editMessageText(newMsg, {
                    parse_mode: 'HTML',
                    reply_markup: buildCapitalProtectionKeyboard(user)
                });
            } catch (e) { /* unchanged */ }

            await ctx.answerCbQuery('✅ تم التحديث').catch(() => {});
            return;
        }

        // --- Leverage Callbacks ---
        if (data.startsWith('lev_')) {
            const user = await User.findOne({ telegramId: ctx.from.id.toString() });
            if (!user) return;

            if (data === 'lev_mode_default') {
                user.leverageMode = 'default';
            } else if (data === 'lev_mode_fixed') {
                user.leverageMode = 'fixed';
            } else if (data.startsWith('lev_val_')) {
                const val = parseInt(data.replace('lev_val_', ''));
                if (!isNaN(val)) {
                    user.fixedLeverageValue = val;
                    user.leverageMode = 'fixed'; // Auto-switch to fixed if a value is selected
                }
            }

            await user.save();

            const mode = user.leverageMode || 'default';
            const val = user.fixedLeverageValue || 10;

            const newMsg = `⚖️ <b>إعدادات الرافعة المالية (Leverage)</b>\n\n` +
                `تم التحديث! الوضع الحالي: <b>${mode === 'fixed' ? `📌 ثابت (x${val})` : '⚙️ تلقائي (حسب التوصية)'}</b>\n\n` +
                `• <b>تلقائي:</b> يتبع الرافعة المذكورة في التوصية. إذا لم تذكر، يستخدم <b>x10</b>.\n` +
                `• <b>ثابت:</b> يتم تجاهل الرافعة في التوصية واستخدام القيمة المحددة أدناه لجميع الصفقات.\n\n` +
                `اختر الوضع أو القيمة المطلوبة:`;

            try {
                await ctx.editMessageText(newMsg, {
                    parse_mode: 'HTML',
                    reply_markup: buildLeverageKeyboard(user)
                });
            } catch (e) { /* unchanged */ }

            await ctx.answerCbQuery('✅ تم التحديث').catch(() => {});
            
            // Update main menu
            await ctx.reply(`✅ تم تحديث إعدادات الرافعة إلى: ${mode === 'fixed' ? `ثابت (x${val})` : 'تلقائي'}`, {
                reply_markup: getMainMenuKeyboard(user)
            });
            return;
        }

        // --- Alert Settings Callbacks ---
        if (!data.startsWith('alert_')) return;
    
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
