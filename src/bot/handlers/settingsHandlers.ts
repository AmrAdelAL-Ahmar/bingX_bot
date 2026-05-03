import { Telegraf } from 'telegraf';
import logger from '../../utils/logger';
import User from '../../models/User';
import { ALL_TP_THRESHOLDS, buildAlertSettingsKeyboard, buildCapitalProtectionKeyboard, buildLeverageKeyboard, getMainMenuKeyboard, buildVolatilitySlKeyboard, buildHitlarSettingsKeyboard, getHiddenMenuKeyboard, getTraderSettingsKeyboard } from '../keyboards/baseKeyboards';




export const registerSettingsHandlers = (bot: Telegraf) => {

    bot.hears('ℹ️ تعليمات الاستخدام (Help)', async (ctx) => {
        try {
            const helpMsg = `ℹ️ <b>دليل استخدام بوت التداول الآلي:</b>\n\n` +
                `• <b>💰 الرصيد:</b> عرض رصيدك الحالي في منصة Binance وملخص الأرباح والخسائر.\n` +
                `• <b>💼 صفقاتي:</b> متابعة الصفقات المفتوحة حالياً وحالتها لحظة بلحظة.\n` +
                `• <b>📊 التقارير:</b> عرض إحصائيات مفصلة لنتائج تداولاتك (يومي، شهري، سنوي).\n` +
                `• <b>⚙️ إعدادات المتداول:</b>\n` +
                `  - <b>نسبة المخاطرة:</b> تحديد نسبة الدخول من رأس المال لكل صفقة (1% - 5%).\n` +
                `  - <b>نوع التنفيذ:</b> الاختيار بين دخول السوق الفوري (Market) أو انتظار السعر المحدد (Limit).\n` +
                `  - <b>الرافعة المالية:</b> ضبط الرافعة بشكل تلقائي حسب التوصية أو تثبيتها لقيمة معينة.\n` +
                `  - <b>إعدادات الاستوب:</b> تفعيل وقف الخسارة التلقائي بناءً على تذبذب السعر.\n` +
                `  - <b>حماية رأس المال:</b> ضمان عدم خسارة أكثر من نسبة محددة من إجمالي الحساب.\n` +
                `  - <b>وضع هترل (HITLAR):</b> وضع تداول سريع بإعدادات مسبقة الضبط.\n` +
                `  - <b>التنبيهات:</b> تخصيص التنبيهات التي تصلك عند تحقيق الأهداف أو الاستوب.\n\n` +
                `• <b>📱 إخفاء القائمة:</b> لتقليل المساحة التي تأخذها القائمة على الهواتف.\n` +
                `• <b>🔍 الاستعلام/الإلغاء:</b> للبحث عن صفقة محددة أو إغلاقها يدوياً.\n\n` +
                `💡 <b>البوت يعمل بشكل آلي بالكامل بمجرد استقبال إشارة التداول.</b>`;
    
            ctx.replyWithHTML(helpMsg);
        } catch (e) { }
    });

    bot.hears('⚙️ إعدادات المتداول', async (ctx) => {
        try {
            if (!ctx.from) return;
            const user = await User.findOne({ telegramId: ctx.from.id.toString() });
            if (!user) return;

            const msg = `⚙️ <b>لوحة تحكم المتداول</b>\n\n` +
                `تم فتح قائمة الإعدادات في لوحة المفاتيح أدناه. يمكنك الآن ضبط كافة تفاصيل التداول بسهولة.`;

            await ctx.replyWithHTML(msg, {
                reply_markup: getTraderSettingsKeyboard(user)
            });
        } catch (e) {
            ctx.reply('حدث خطأ أثناء فتح إعدادات المتداول.');
        }
    });

    bot.hears('رجوع للقائمة الرئيسية 🔙', async (ctx) => {
        try {
            if (!ctx.from) return;
            const user = await User.findOne({ telegramId: ctx.from.id.toString() });
            if (!user) return;
            await ctx.reply('العودة للقائمة الرئيسية...', {
                reply_markup: getMainMenuKeyboard(user)
            });
        } catch (e) {}
    });


    bot.hears('📱 إخفاء القائمة', async (ctx) => {
        try {
            await ctx.reply('تم إخفاء القائمة. يمكنك إظهارها في أي وقت بالضغط على الزر أدناه أو إرسال /menu', {
                reply_markup: getHiddenMenuKeyboard()
            });
        } catch (e) {}
    });

    bot.hears('📱 إظهار القائمة', async (ctx) => {
        try {
            if (!ctx.from) return;
            const user = await User.findOne({ telegramId: ctx.from.id.toString() });
            if (!user) return;
            await ctx.reply('مرحباً بك مجدداً! تم إظهار القائمة الرئيسية.', {
                reply_markup: getMainMenuKeyboard(user)
            });
        } catch (e) {}
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

            ctx.replyWithHTML(msg, {
                reply_markup: buildLeverageKeyboard(user)
            });
        } catch (e) {
            ctx.reply('حدث خطأ أثناء فتح إعدادات الرافعة.');
        }
    });

    bot.hears('📊 إعدادات الاستوب (التذبذب)', async (ctx) => {
        try {
            if (!ctx.from) return;
            const user = await User.findOne({ telegramId: ctx.from.id.toString() });
            if (!user) return;
    
            const isEnabled = user.volatilitySlEnabled || false;
            const currentPercent = user.volatilitySlPercentage || 5;
    
            const msg = `📊 <b>إعدادات الاستوب حسب تذبذب العملة</b>\n\n` +
                `هذه الميزة تقوم بتحديد الـ Stop Loss تلقائياً بناءً على نسبة مئوية من سعر العملة الحالي عند فتح الصفقة.\n\n` +
                `• <b>في صفقات الـ LONG:</b> يكون الاستوب = السعر الحالي - ${currentPercent}%\n` +
                `• <b>في صفقات الـ SHORT:</b> يكون الاستوب = السعر الحالي + ${currentPercent}%\n\n` +
                `الحالة الآن: <b>${isEnabled ? 'مفعلة 🟢' : 'معطلة 🔴'}</b>\n` +
                `النسبة المحددة: <b>${currentPercent}%</b>\n\n` +
                `اختر الحالة أو النسبة المطلوبة:`;
    
            await ctx.replyWithHTML(msg, {
                reply_markup: buildVolatilitySlKeyboard(user)
            });
        } catch (e) {
            ctx.reply('حدث خطأ أثناء فتح إعدادات الاستوب.');
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

    bot.hears(/🚀 وضع هترل \(HITLAR\)/, async (ctx) => {
        try {
            if (!ctx.from) return;
            const user = await User.findOne({ telegramId: ctx.from.id.toString() });
            if (!user) return;

            user.hitlarModeEnabled = !user.hitlarModeEnabled;
            await user.save();

            const status = user.hitlarModeEnabled ? 'مفعل 🟢' : 'معطل 🔴';
            ctx.reply(`🚀 تم تغيير حالة وضع هترل إلى: ${status}`, {
                reply_markup: getTraderSettingsKeyboard(user)
            });

        } catch (e) {
            ctx.reply('حدث خطأ أثناء تغيير حالة وضع هترل.');
        }
    });

    bot.hears('⚙️ إعدادات وضع هترل', async (ctx) => {
        try {
            if (!ctx.from) return;
            const user = await User.findOne({ telegramId: ctx.from.id.toString() });
            if (!user) return;

            const settings = user.hitlarSettings;
            const msg = `⚙️ <b>إعدادات وضع هترل (HITLAR Mode)</b>\n\n` +
                `في هذا الوضع، يتم تجاهل بعض بارامترات التوصية واستخدام هذه الإعدادات الثابتة:\n\n` +
                `💰 نسبة الدخول من رأس المال: <b>${settings.riskPercentage}%</b>\n` +
                `⚖️ الرافعة المالية الثابتة: <b>x${settings.leverage}</b>\n` +
                `📊 نسبة وقف الخسارة (تذبذب): <b>${settings.volatilitySlPercentage}%</b>\n` +
                `🛡 حماية رأس المال الصارمة: <b>${settings.capitalProtectionEnabled ? 'مفعلة ✅' : 'معطلة ❌'}</b>\n` +
                `🔄 نوع تنفيذ الصفقة: <b>${settings.orderMode === 'limit' ? '📌 حدي (Limit)' : '⚡ سوق (Market)'}</b>\n\n` +
                `يمكنك تعديل أي من القيم بالضغط على الأزرار أدناه:`;

            ctx.replyWithHTML(msg, {
                reply_markup: buildHitlarSettingsKeyboard(user)
            });
        } catch (e) {
            ctx.reply('حدث خطأ أثناء فتح إعدادات وضع هترل.');
        }
    });
    
    // Handle all inline keyboard callbacks
    bot.on('callback_query', async (ctx) => {
        const data = (ctx.callbackQuery as any).data as string;
        if (!data) return;
        if (!ctx.from) return;

        // --- TRADER SETTINGS Callbacks ---
        if (data.startsWith('settings_')) {
            const user = await User.findOne({ telegramId: ctx.from.id.toString() });
            if (!user) return;

            if (data === 'settings_risk') {
                user.botState = 'AWAITING_RISK_PERCENTAGE';
                await user.save();
                await ctx.answerCbQuery().catch(() => {});
                return ctx.reply('قم بإدخال نسبة المخاطرة الجديدة (رقم بين 1 و 5):', {
                    reply_markup: {
                        keyboard: [
                            [{ text: '1%' }, { text: '2%' }, { text: '3%' }, { text: '4%' }, { text: '5%' }],
                            [{ text: 'رجوع 🔙' }]
                        ],
                        resize_keyboard: true,
                        one_time_keyboard: true
                    }
                });
            }

            if (data === 'settings_order_mode') {
                const currentMode = user.orderMode || 'market';
                const msg = `🔄 <b>نوع تنفيذ الصفقات</b>\n\n` +
                    `الوضع الحالي: <b>${currentMode === 'limit' ? '📌 حدي (Limit)' : '⚡ سوق (Market)'}</b>\n\n` +
                    `• <b>أمر السوق (Market):</b> يدخل الصفقة فوراً بأفضل سعر متاح.\n` +
                    `• <b>أمر حدي (Limit):</b> ينتظر السعر المحدد في التوصية.\n\n` +
                    `اختر الوضع الذي تريده:`;
                await ctx.answerCbQuery().catch(() => {});
                return ctx.replyWithHTML(msg, {
                    reply_markup: {
                        inline_keyboard: [
                            [
                                { text: currentMode === 'market' ? '⚡ سوق (Market) ✔️' : '⚡ سوق (Market)', callback_data: 'order_mode_market' },
                                { text: currentMode === 'limit' ? '📌 حدي (Limit) ✔️' : '📌 حدي (Limit)', callback_data: 'order_mode_limit' }
                            ]
                        ]
                    }
                });
            }

            if (data === 'settings_leverage') {
                const mode = user.leverageMode || 'default';
                const val = user.fixedLeverageValue || 10;
                const msg = `⚖️ <b>إعدادات الرافعة المالية (Leverage)</b>\n\n` +
                    `الوضع الحالي: <b>${mode === 'fixed' ? `📌 ثابت (x${val})` : '⚙️ تلقائي (حسب التوصية)'}</b>\n\n` +
                    `اختر الوضع أو القيمة المطلوبة:`;
                await ctx.answerCbQuery().catch(() => {});
                return ctx.replyWithHTML(msg, { reply_markup: buildLeverageKeyboard(user) });
            }

            if (data === 'settings_vol_sl') {
                const isEnabled = user.volatilitySlEnabled || false;
                const currentPercent = user.volatilitySlPercentage || 5;
                const msg = `📊 <b>إعدادات الاستوب حسب تذبذب العملة</b>\n\n` +
                    `الحالة الآن: <b>${isEnabled ? 'مفعلة 🟢' : 'معطلة 🔴'}</b>\n` +
                    `النسبة المحددة: <b>${currentPercent}%</b>\n\n` +
                    `اختر الحالة أو النسبة المطلوبة:`;
                await ctx.answerCbQuery().catch(() => {});
                return ctx.replyWithHTML(msg, { reply_markup: buildVolatilitySlKeyboard(user) });
            }

            if (data === 'settings_cap_prot') {
                const isEnabled = (user.enforceMaxSlLoss !== null && user.enforceMaxSlLoss !== undefined)
                    ? user.enforceMaxSlLoss
                    : process.env.ENFORCE_MAX_SL_LOSS === 'true';
                const currentPercent = user.maxSlRiskPercentage || 6;
                const msg = `🛡 <b>ميزة حماية رأس المال الصارمة</b>\n\n` +
                    `الحالة الآن: <b>${isEnabled ? 'مفعلة 🟢' : 'معطلة 🔴'}</b>\n` +
                    `النسبة المحددة: <b>${currentPercent}%</b>\n\n` +
                    `اختر الحالة أو النسبة المطلوبة:`;
                await ctx.answerCbQuery().catch(() => {});
                return ctx.replyWithHTML(msg, { reply_markup: buildCapitalProtectionKeyboard(user) });
            }


            if (data === 'settings_hitlar_settings') {
                const settings = user.hitlarSettings;
                const msg = `⚙️ <b>إعدادات وضع هترل (HITLAR Mode)</b>\n\n` +
                    `💰 نسبة الدخول: <b>${settings.riskPercentage}%</b>\n` +
                    `⚖️ الرافعة: <b>x${settings.leverage}</b>\n` +
                    `📊 نسبة الاستوب: <b>${settings.volatilitySlPercentage}%</b>\n\n` +
                    `اختر لتعديل القيم:`;
                await ctx.answerCbQuery().catch(() => {});
                return ctx.replyWithHTML(msg, { reply_markup: buildHitlarSettingsKeyboard(user) });
            }

            if (data === 'settings_alerts') {
                const slOn: boolean = user.slWarningEnabled !== false;
                const tpOn: boolean = user.tpWarningEnabled !== false;
                const thresholds: number[] = user.tpWarningThresholds || [70, 90];
                const msg = `⚙️ <b>إعدادات التنبيهات</b>\n\n` +
                    `🔔 تنبيه SL: <b>${slOn ? 'مفعل ✅' : 'معطل ❌'}</b>\n` +
                    `🎯 تنبيه TP: <b>${tpOn ? 'مفعل ✅' : 'معطل ❌'}</b>\n\n` +
                    `اختر لتعديل الإعدادات:`;
                await ctx.answerCbQuery().catch(() => {});
                return ctx.replyWithHTML(msg, { reply_markup: buildAlertSettingsKeyboard(user) });
            }
        }

        // --- HITLAR Callbacks ---

        if (data.startsWith('hitlar_')) {
            const user = await User.findOne({ telegramId: ctx.from.id.toString() });
            if (!user) return;

            if (data === 'hitlar_save') {
                await ctx.deleteMessage().catch(() => {});
                return ctx.answerCbQuery('✅ تم حفظ الإعدادات').catch(() => {});
            }

            if (data === 'hitlar_toggle_cap') {
                user.hitlarSettings.capitalProtectionEnabled = !user.hitlarSettings.capitalProtectionEnabled;
            } else if (data === 'hitlar_toggle_mode') {
                user.hitlarSettings.orderMode = user.hitlarSettings.orderMode === 'limit' ? 'market' : 'limit';
            } else if (data === 'hitlar_edit_risk') {
                user.botState = 'AWAITING_HITLAR_RISK';
                await user.save();
                await ctx.answerCbQuery().catch(() => {});
                return ctx.reply('يرجى إدخال نسبة المخاطرة لوضع هترل (مثال: 5):', {
                    reply_markup: { keyboard: [[{ text: 'رجوع 🔙' }]], resize_keyboard: true }
                });
            } else if (data === 'hitlar_edit_lev') {
                user.botState = 'AWAITING_HITLAR_LEV';
                await user.save();
                await ctx.answerCbQuery().catch(() => {});
                return ctx.reply('يرجى إدخال الرافعة المالية لوضع هترل (مثال: 20):', {
                    reply_markup: { keyboard: [[{ text: 'رجوع 🔙' }]], resize_keyboard: true }
                });
            } else if (data === 'hitlar_edit_sl') {
                user.botState = 'AWAITING_HITLAR_SL';
                await user.save();
                await ctx.answerCbQuery().catch(() => {});
                return ctx.reply('يرجى إدخال نسبة وقف الخسارة لوضع هترل (مثال: 5):', {
                    reply_markup: { keyboard: [[{ text: 'رجوع 🔙' }]], resize_keyboard: true }
                });
            }

            await user.save();
            const settings = user.hitlarSettings;
            const newMsg = `⚙️ <b>إعدادات وضع هترل (HITLAR Mode)</b>\n\n` +
                `في هذا الوضع، يتم تجاهل بعض بارامترات التوصية واستخدام هذه الإعدادات الثابتة:\n\n` +
                `💰 نسبة الدخول من رأس المال: <b>${settings.riskPercentage}%</b>\n` +
                `⚖️ الرافعة المالية الثابتة: <b>x${settings.leverage}</b>\n` +
                `📊 نسبة وقف الخسارة (تذبذب): <b>${settings.volatilitySlPercentage}%</b>\n` +
                `🛡 حماية رأس المال الصارمة: <b>${settings.capitalProtectionEnabled ? 'مفعلة ✅' : 'معطلة ❌'}</b>\n` +
                `🔄 نوع تنفيذ الصفقة: <b>${settings.orderMode === 'limit' ? '📌 حدي (Limit)' : '⚡ سوق (Market)'}</b>\n\n` +
                `يمكنك تعديل أي من القيم بالضغط على الأزرار أدناه:`;

            try {
                await ctx.editMessageText(newMsg, {
                    parse_mode: 'HTML',
                    reply_markup: buildHitlarSettingsKeyboard(user)
                });
            } catch (e) {}
            return ctx.answerCbQuery('✅ تم التحديث').catch(() => {});
        }

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

            // Also update the trader settings keyboard
            await ctx.reply(`✅ تم تحديث نوع التنفيذ إلى: ${modeLabel}`, {
                reply_markup: getTraderSettingsKeyboard(user)
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
            
            // Update trader settings menu
            await ctx.reply(`✅ تم تحديث إعدادات الرافعة إلى: ${mode === 'fixed' ? `ثابت (x${val})` : 'تلقائي'}`, {
                reply_markup: getTraderSettingsKeyboard(user)
            });

            return;
        }

        // --- Volatility SL Callbacks ---
        if (data.startsWith('vol_')) {
            const user = await User.findOne({ telegramId: ctx.from.id.toString() });
            if (!user) return;

            if (data === 'vol_toggle') {
                user.volatilitySlEnabled = !user.volatilitySlEnabled;
            } else if (data.startsWith('vol_perc_')) {
                const perc = parseInt(data.replace('vol_perc_', ''));
                if (!isNaN(perc)) {
                    user.volatilitySlPercentage = perc;
                }
            }

            await user.save();

            const isEnabled = user.volatilitySlEnabled || false;
            const currentPercent = user.volatilitySlPercentage || 5;

            const newMsg = `📊 <b>إعدادات الاستوب حسب تذبذب العملة</b>\n\n` +
                `هذه الميزة تقوم بتحديد الـ Stop Loss تلقائياً بناءً على نسبة مئوية من سعر العملة الحالي عند فتح الصفقة.\n\n` +
                `• <b>في صفقات الـ LONG:</b> يكون الاستوب = السعر الحالي - ${currentPercent}%\n` +
                `• <b>في صفقات الـ SHORT:</b> يكون الاستوب = السعر الحالي + ${currentPercent}%\n\n` +
                `الحالة الآن: <b>${isEnabled ? 'مفعلة 🟢' : 'معطلة 🔴'}</b>\n` +
                `النسبة المحددة: <b>${currentPercent}%</b>\n\n` +
                `اختر الحالة أو النسبة المطلوبة:`;

            try {
                await ctx.editMessageText(newMsg, {
                    parse_mode: 'HTML',
                    reply_markup: buildVolatilitySlKeyboard(user)
                });
            } catch (e) { /* unchanged */ }

            await ctx.answerCbQuery('✅ تم التحديث').catch(() => {});
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
