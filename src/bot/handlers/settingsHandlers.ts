import { Telegraf } from 'telegraf';
import logger from '../../utils/logger';
import User from '../../models/User';
import { ALL_TP_THRESHOLDS, buildAlertSettingsKeyboard, buildCapitalProtectionKeyboard, buildLeverageKeyboard, getMainMenuKeyboard, buildVolatilitySlKeyboard, buildHitlarSettingsKeyboard, getHiddenMenuKeyboard, getTraderSettingsKeyboard, buildStrategySettingsKeyboard, getBacktestSettingsKeyboard, getBacktestSettingsIntervals } from '../keyboards/baseKeyboards';




export const registerSettingsHandlers = (bot: Telegraf) => {

    bot.action('menu_open', async (ctx) => {
        try {
            if (!ctx.from) return;
            const user = await User.findOne({ telegramId: ctx.from.id.toString() });
            if (!user) return;

            const { BingXService } = require('../../services/BingXService');
            const TradeModel = require('../../models/Trade').default;
            const SniperWatchModel = require('../../models/SniperWatch').default;
            
            const bx = new BingXService();
            const balance = await bx.getBalance().catch(() => 0);
            
            const activeTrades = await TradeModel.find({
                currentStatus: { $in: ['OPEN', 'TP1_HIT', 'TP2_HIT'] }
            });
            let totalPnl = 0;
            for (const pos of activeTrades) {
                totalPnl += (pos.pnl || 0);
            }
            
            const activeWatchesCount = await SniperWatchModel.countDocuments({ userId: user._id, status: 'ACTIVE' });
            
            const { getMainMenuText, getMainMenuInlineKeyboard } = require('../menus/mainMenu');
            
            await ctx.editMessageText(getMainMenuText(ctx.from.first_name, balance, activeTrades.length, totalPnl), {
                parse_mode: 'HTML',
                reply_markup: getMainMenuInlineKeyboard(activeTrades.length, activeWatchesCount)
            });
            await ctx.answerCbQuery().catch(() => {});
        } catch (e: any) {
            logger.error(`Error in menu_open action: ${e.message}`);
        }
    });

    bot.action('menu_settings', async (ctx) => {
        try {
            if (!ctx.from) return;
            const user = await User.findOne({ telegramId: ctx.from.id.toString() });
            if (!user) return;
            
            const { getTraderSettingsText, getTraderSettingsInlineKeyboard } = require('../menus/settingsMenu');
            await ctx.editMessageText(getTraderSettingsText(user), {
                parse_mode: 'HTML',
                reply_markup: getTraderSettingsInlineKeyboard(user)
            });
            await ctx.answerCbQuery().catch(() => {});
        } catch (e: any) {
            logger.error(`Error in menu_settings action: ${e.message}`);
        }
    });

    bot.action(/^sett_edit_(risk|leverage)$/, async (ctx) => {
        try {
            if (!ctx.from) return;
            const type = ctx.match[1];
            const user = await User.findOne({ telegramId: ctx.from.id.toString() });
            if (!user) return;
            
            const { buildNumpadKeyboard } = require('../menus/settingsMenu');
            const label = type === 'risk' ? 'نسبة المخاطرة (%)' : 'الرافعة المالية الثابتة (x)';
            
            await ctx.editMessageText(`✏️ <b>تعديل ${label}:</b>\nاستخدم لوحة الأرقام للتعديل ثم اضغط تأكيد:`, {
                parse_mode: 'HTML',
                reply_markup: buildNumpadKeyboard(type, '', label)
            });
            await ctx.answerCbQuery().catch(() => {});
        } catch (e: any) {
            logger.error(`Error in sett_edit action: ${e.message}`);
        }
    });

    bot.action('sett_toggle_ordermode', async (ctx) => {
        try {
            if (!ctx.from) return;
            const user = await User.findOne({ telegramId: ctx.from.id.toString() });
            if (!user) return;
            
            user.orderMode = user.orderMode === 'limit' ? 'market' : 'limit';
            await user.save();
            
            const { getTraderSettingsText, getTraderSettingsInlineKeyboard } = require('../menus/settingsMenu');
            await ctx.editMessageText(getTraderSettingsText(user), {
                parse_mode: 'HTML',
                reply_markup: getTraderSettingsInlineKeyboard(user)
            });
            await ctx.answerCbQuery(`تم تغيير وضع التنفيذ إلى ${user.orderMode}`).catch(() => {});
        } catch (e: any) {
            logger.error(`Error in sett_toggle_ordermode action: ${e.message}`);
        }
    });

    bot.action('sett_toggle_volatilitysl', async (ctx) => {
        try {
            if (!ctx.from) return;
            const user = await User.findOne({ telegramId: ctx.from.id.toString() });
            if (!user) return;
            
            user.volatilitySlEnabled = !user.volatilitySlEnabled;
            await user.save();
            
            const { getTraderSettingsText, getTraderSettingsInlineKeyboard } = require('../menus/settingsMenu');
            await ctx.editMessageText(getTraderSettingsText(user), {
                parse_mode: 'HTML',
                reply_markup: getTraderSettingsInlineKeyboard(user)
            });
            await ctx.answerCbQuery(user.volatilitySlEnabled ? 'تم تفعيل الاستوب التلقائي 🟢' : 'تم تعطيل الاستوب التلقائي 🔴').catch(() => {});
        } catch (e: any) {
            logger.error(`Error in sett_toggle_volatilitysl: ${e.message}`);
        }
    });

    bot.action('sett_toggle_capprotection', async (ctx) => {
        try {
            if (!ctx.from) return;
            const user = await User.findOne({ telegramId: ctx.from.id.toString() });
            if (!user) return;
            
            user.enforceMaxSlLoss = !user.enforceMaxSlLoss;
            await user.save();
            
            const { getTraderSettingsText, getTraderSettingsInlineKeyboard } = require('../menus/settingsMenu');
            await ctx.editMessageText(getTraderSettingsText(user), {
                parse_mode: 'HTML',
                reply_markup: getTraderSettingsInlineKeyboard(user)
            });
            await ctx.answerCbQuery(user.enforceMaxSlLoss ? 'تم تفعيل درع رأس المال 🟢' : 'تم تعطيل درع رأس المال 🔴').catch(() => {});
        } catch (e: any) {
            logger.error(`Error in sett_toggle_capprotection: ${e.message}`);
        }
    });

    bot.action('sett_toggle_hitlar', async (ctx) => {
        try {
            if (!ctx.from) return;
            const user = await User.findOne({ telegramId: ctx.from.id.toString() });
            if (!user) return;
            
            user.hitlarModeEnabled = !user.hitlarModeEnabled;
            await user.save();
            
            const { getTraderSettingsText, getTraderSettingsInlineKeyboard } = require('../menus/settingsMenu');
            await ctx.editMessageText(getTraderSettingsText(user), {
                parse_mode: 'HTML',
                reply_markup: getTraderSettingsInlineKeyboard(user)
            });
            await ctx.answerCbQuery(user.hitlarModeEnabled ? 'تم تفعيل وضع هترل 🟢' : 'تم تعطيل وضع هترل 🔴').catch(() => {});
        } catch (e: any) {
            logger.error(`Error in sett_toggle_hitlar: ${e.message}`);
        }
    });

    bot.action('sett_toggle_tpmode', async (ctx) => {
        try {
            if (!ctx.from) return;
            const user = await User.findOne({ telegramId: ctx.from.id.toString() });
            if (!user) return;
            
            user.tpExecutionMode = user.tpExecutionMode === 'single' ? 'multiple' : 'single';
            if (user.tpExecutionMode === 'single') {
                user.tpProfitSplits = [100];
            } else {
                user.tpProfitSplits = [50, 50];
            }
            await user.save();
            
            const { getTraderSettingsText, getTraderSettingsInlineKeyboard } = require('../menus/settingsMenu');
            await ctx.editMessageText(getTraderSettingsText(user), {
                parse_mode: 'HTML',
                reply_markup: getTraderSettingsInlineKeyboard(user)
            });
            await ctx.answerCbQuery(`تم تغيير جني الأرباح إلى: ${user.tpExecutionMode === 'single' ? 'هدف واحد' : 'أهداف متعددة'}`).catch(() => {});
        } catch (e: any) {
            logger.error(`Error in sett_toggle_tpmode: ${e.message}`);
        }
    });

    bot.action('sett_strategy_details', async (ctx) => {
        try {
            if (!ctx.from) return;
            const user = await User.findOne({ telegramId: ctx.from.id.toString() });
            if (!user) return;
            
            const { getStrategyInlineKeyboard } = require('../menus/settingsMenu');
            await ctx.editMessageText('🎯 <b>استراتيجية الأهداف ومعالجة الأخطاء الذكية:</b>\n\nاضبط قواعد جني الأرباح الجزئي التلقائي وتأمين الصفقات:', {
                parse_mode: 'HTML',
                reply_markup: getStrategyInlineKeyboard(user)
            });
            await ctx.answerCbQuery().catch(() => {});
        } catch (e: any) {
            logger.error(`Error in sett_strategy_details: ${e.message}`);
        }
    });

    bot.action('sett_hitlar_details', async (ctx) => {
        try {
            if (!ctx.from) return;
            const user = await User.findOne({ telegramId: ctx.from.id.toString() });
            if (!user) return;
            
            const { getHitlarSettingsInlineKeyboard } = require('../menus/settingsMenu');
            await ctx.editMessageText('🚀 <b>إعدادات وضع هترل (HITLAR Mode):</b>\n\nتثبيت بارامترات التداول السريعة للمركز:', {
                parse_mode: 'HTML',
                reply_markup: getHitlarSettingsInlineKeyboard(user)
            });
            await ctx.answerCbQuery().catch(() => {});
        } catch (e: any) {
            logger.error(`Error in sett_hitlar_details: ${e.message}`);
        }
    });

    bot.action('sett_alerts_details', async (ctx) => {
        try {
            if (!ctx.from) return;
            const user = await User.findOne({ telegramId: ctx.from.id.toString() });
            if (!user) return;
            
            await ctx.editMessageText('🔔 <b>إعدادات التنبيهات والتحذيرات:</b>\n\nتحكم في إشعارات ضرب الأهداف والوقف:', {
                parse_mode: 'HTML',
                reply_markup: buildAlertSettingsKeyboard(user)
            });
            await ctx.answerCbQuery().catch(() => {});
        } catch (e: any) {
            logger.error(`Error in sett_alerts_details: ${e.message}`);
        }
    });

    // ─── PICKER / SCANNER SETTINGS CALLBACKS ──────────────────────────────────
    bot.action('sett_picker_details', async (ctx) => {
        try {
            if (!ctx.from) return;
            const user = await User.findOne({ telegramId: ctx.from.id.toString() });
            if (!user) return;
            
            const { getPickerSettingsText, getPickerSettingsInlineKeyboard } = require('../menus/settingsMenu');
            await ctx.editMessageText(getPickerSettingsText(user), {
                parse_mode: 'HTML',
                reply_markup: getPickerSettingsInlineKeyboard(user)
            });
            await ctx.answerCbQuery().catch(() => {});
        } catch (e: any) {
            logger.error(`Error in sett_picker_details callback: ${e.message}`);
        }
    });

    bot.action('sett_toggle_picker_engine', async (ctx) => {
        try {
            if (!ctx.from) return;
            const user = await User.findOne({ telegramId: ctx.from.id.toString() });
            if (!user) return;
            
            if (!user.pickerSettings) {
                user.pickerSettings = { engine: 'ccxt', limit: 20 };
            } else {
                user.pickerSettings.engine = user.pickerSettings.engine === 'ccxt' ? 'multicriteria' : 'ccxt';
            }
            user.markModified('pickerSettings');
            await user.save();
            
            const { getPickerSettingsText, getPickerSettingsInlineKeyboard } = require('../menus/settingsMenu');
            await ctx.editMessageText(getPickerSettingsText(user), {
                parse_mode: 'HTML',
                reply_markup: getPickerSettingsInlineKeyboard(user)
            });
            await ctx.answerCbQuery(`تم تبديل محرك الفحص إلى: ${user.pickerSettings.engine === 'ccxt' ? 'CCXT Pro' : 'BingX'}`).catch(() => {});
        } catch (e: any) {
            logger.error(`Error in sett_toggle_picker_engine callback: ${e.message}`);
        }
    });

    bot.action('sett_edit_picker_limit', async (ctx) => {
        try {
            if (!ctx.from) return;
            const user = await User.findOne({ telegramId: ctx.from.id.toString() });
            if (!user) return;
            
            const { buildNumpadKeyboard } = require('../menus/settingsMenu');
            const label = 'أقصى عدد عملات بالقائمة';
            
            await ctx.editMessageText(`✏️ <b>تعديل ${label}:</b>\nاستخدم لوحة الأرقام للتعديل ثم اضغط تأكيد:`, {
                parse_mode: 'HTML',
                reply_markup: buildNumpadKeyboard('picker_limit', '', label)
            });
            await ctx.answerCbQuery().catch(() => {});
        } catch (e: any) {
            logger.error(`Error in sett_edit_picker_limit callback: ${e.message}`);
        }
    });

    // --- INTERACTIVE NUMPAD ACTIONS (STATELESS) ---
    bot.action(/^np_([a-zA-Z0-9_]+)_([a-zA-Z0-9_]+)_(.*)$/, async (ctx) => {
        try {
            if (!ctx.from) return;
            const type = ctx.match[1];
            const action = ctx.match[2];
            const val = ctx.match[3] || '';
            
            const user = await User.findOne({ telegramId: ctx.from.id.toString() });
            if (!user) return;
            
            const { buildNumpadKeyboard, getTraderSettingsInlineKeyboard, getTraderSettingsText } = require('../menus/settingsMenu');
            
            let label = '';
            if (type === 'risk') label = 'نسبة المخاطرة (%)';
            else if (type === 'leverage') label = 'الرافعة المالية الثابتة (x)';
            else if (type.startsWith('sl_')) label = `سعر الاستوب لـ ${type.split('_')[1]}`;
            else if (type === 'hit_risk') label = 'نسبة دخول هترل (%)';
            else if (type === 'hit_lev') label = 'رافعة هترل (x)';
            else if (type === 'hit_sl') label = 'ستوب هترل (%)';
            else if (type === 'picker_limit') label = 'أقصى عدد عملات بالقائمة';
            
            if (action === 'cancel') {
                await ctx.deleteMessage().catch(() => {});
                await ctx.answerCbQuery('تم الإلغاء ❌').catch(() => {});
                
                if (type === 'picker_limit') {
                    const { getPickerSettingsText, getPickerSettingsInlineKeyboard } = require('../menus/settingsMenu');
                    await ctx.reply(getPickerSettingsText(user), {
                        parse_mode: 'HTML',
                        reply_markup: getPickerSettingsInlineKeyboard(user)
                    });
                } else if (!type.startsWith('sl_')) {
                    await ctx.reply(getTraderSettingsText(user), {
                        parse_mode: 'HTML',
                        reply_markup: getTraderSettingsInlineKeyboard(user)
                    });
                }
                return;
            }
            
            let newVal = val;
            
            if (action === 'clear') {
                newVal = '';
            } else if (action === 'back') {
                newVal = val.slice(0, -1);
            } else if (action === 'dot') {
                newVal = val.includes('.') ? val : (val ? val + '.' : '0.');
            } else if (action === 'ok') {
                const num = parseFloat(val);
                if (isNaN(num) || num <= 0) {
                    return ctx.answerCbQuery('⚠️ قيمة غير صحيحة! يرجى إدخال رقم أكبر من الصفر.', { show_alert: true });
                }
                
                if (type === 'risk') {
                    if (num < 1 || num > 100) return ctx.answerCbQuery('⚠️ القيمة يجب أن تكون بين 1 و 100.', { show_alert: true });
                    user.riskPercentage = num;
                } else if (type === 'leverage') {
                    if (num < 1 || num > 125) return ctx.answerCbQuery('⚠️ القيمة يجب أن تكون بين 1 و 125.', { show_alert: true });
                    user.fixedLeverageValue = Math.round(num);
                    user.leverageMode = 'fixed';
                } else if (type === 'hit_risk') {
                    if (num < 1 || num > 100) return ctx.answerCbQuery('⚠️ القيمة يجب أن تكون بين 1 و 100.', { show_alert: true });
                    user.hitlarSettings.riskPercentage = num;
                } else if (type === 'hit_lev') {
                    if (num < 1 || num > 125) return ctx.answerCbQuery('⚠️ القيمة يجب أن تكون بين 1 و 125.', { show_alert: true });
                    user.hitlarSettings.leverage = Math.round(num);
                } else if (type === 'hit_sl') {
                    if (num < 1 || num > 50) return ctx.answerCbQuery('⚠️ القيمة يجب أن تكون بين 1 و 50.', { show_alert: true });
                    user.hitlarSettings.volatilitySlPercentage = num;
                } else if (type === 'picker_limit') {
                    if (num < 1 || num > 50) return ctx.answerCbQuery('⚠️ يجب أن يكون العدد بين 1 و 50.', { show_alert: true });
                    if (!user.pickerSettings) {
                        user.pickerSettings = { engine: 'multicriteria', limit: 20 };
                    }
                    user.pickerSettings.limit = Math.round(num);
                    user.markModified('pickerSettings');
                } else if (type.startsWith('sl_')) {
                    const symbol = type.split('_')[1];
                    const fullSymbol = `${symbol}/USDT:USDT`;
                    
                    const bx = new (require('../../services/BingXService').BingXService)();
                    const positions = await bx.getPositions();
                    const pos = positions.find((p: any) => p.symbol.startsWith(symbol) && parseFloat(p.contracts) > 0);
                    
                    if (!pos) {
                        return ctx.answerCbQuery(`⚠️ لا توجد صفقة مفتوحة لـ ${symbol}`, { show_alert: true });
                    }
                    
                    const side = pos.side.toUpperCase();
                    await bx.setStopLoss(pos.symbol, side, num);
                    
                    const TradeModel = require('../../models/Trade').default;
                    const trade = await TradeModel.findOne({
                        userId: user._id,
                        symbol: pos.symbol,
                        currentStatus: { $in: ['OPEN', 'TP1_HIT', 'TP2_HIT'] }
                    });
                    if (trade) {
                        trade.stopLoss = num;
                        await trade.save();
                    }
                    
                    await ctx.deleteMessage().catch(() => {});
                    await ctx.answerCbQuery(`✅ تم تعديل الوقف إلى ${num}`).catch(() => {});
                    await ctx.reply(`✅ تم بنجاح تعديل سعر وقف الخسارة (SL) لعملة <b>${symbol}</b> إلى <b>${num}</b>.`, { parse_mode: 'HTML' });
                    return;
                }
                
                await user.save();
                await ctx.deleteMessage().catch(() => {});
                await ctx.answerCbQuery('✅ تم حفظ القيمة بنجاح').catch(() => {});
                
                if (type === 'picker_limit') {
                    const { getPickerSettingsText, getPickerSettingsInlineKeyboard } = require('../menus/settingsMenu');
                    await ctx.reply(getPickerSettingsText(user), {
                        parse_mode: 'HTML',
                        reply_markup: getPickerSettingsInlineKeyboard(user)
                    });
                } else {
                    await ctx.reply(getTraderSettingsText(user), {
                        parse_mode: 'HTML',
                        reply_markup: getTraderSettingsInlineKeyboard(user)
                    });
                }
                return;
            } else {
                if (val === '0') newVal = action;
                else newVal = val + action;
            }
            
            await ctx.editMessageText(`✏️ <b>تعديل ${label}:</b>\nاستخدم لوحة الأرقام للتعديل ثم اضغط تأكيد:`, {
                parse_mode: 'HTML',
                reply_markup: buildNumpadKeyboard(type, newVal, label)
            });
            await ctx.answerCbQuery().catch(() => {});
        } catch (e: any) {
            logger.error(`Error in np numpad action: ${e.message}`);
        }
    });

    bot.hears('ℹ️ تعليمات الاستخدام (Help)', async (ctx) => {
        try {
            const helpMsg = `ℹ️ <b>دليل استخدام بوت التداول الآلي:</b>\n\n` +
                `• <b>💰 الرصيد:</b> عرض رصيدك الحالي في منصة Bingx  وملخص الأرباح والخسائر.\n` +
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

    bot.hears('⚙️ إعدادات الاختبار الرجعي', async (ctx) => {
        try {
            if (!ctx.from) return;
            const user = await User.findOne({ telegramId: ctx.from.id.toString() });
            if (!user) return;

            const msg = `⚙️ <b>لوحة تحكم الاختبار الرجعي (Backtest Settings)</b>\n\n` +
                `من هنا يمكنك ضبط المعايير الافتراضية وإدارة المخاطر لمحرك الاختبار بدقة متناهية.`;

            await ctx.replyWithHTML(msg, {
                reply_markup: getBacktestSettingsKeyboard(user)
            });
        } catch (e) {
            ctx.reply('حدث خطأ أثناء فتح إعدادات الاختبار الرجعي.');
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
        } catch (e) { }
    });


    bot.hears('📱 إخفاء القائمة', async (ctx) => {
        try {
            await ctx.reply('تم إخفاء القائمة. يمكنك إظهارها في أي وقت بالضغط على الزر أدناه أو إرسال /menu', {
                reply_markup: getHiddenMenuKeyboard()
            });
        } catch (e) { }
    });

    bot.hears('📱 إظهار القائمة', async (ctx) => {
        try {
            if (!ctx.from) return;
            const user = await User.findOne({ telegramId: ctx.from.id.toString() });
            if (!user) return;
            await ctx.reply('مرحباً بك مجدداً! تم إظهار القائمة الرئيسية.', {
                reply_markup: getMainMenuKeyboard(user)
            });
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

    bot.hears('🎯 استراتيجية الأهداف والأخطاء', async (ctx) => {
        try {
            if (!ctx.from) return;
            const user = await User.findOne({ telegramId: ctx.from.id.toString() });
            if (!user) return;

            const msg = `🎯 <b>استراتيجية الأهداف ومعالجة الأخطاء</b>\n\n` +
                `تحكم في كيفية جني الأرباح وحماية الصفقة تلقائياً:\n\n` +
                `• <b>وضع الأهداف:</b> اختر بين الاكتفاء بالهدف الأول فقط أو الاستمرار لجميع الأهداف.\n` +
                `• <b>نقل الاستوب (Break-Even):</b> عند ضرب الهدف الأول، يتم نقل الـ SL لسعر الدخول تلقائياً.\n` +
                `• <b>معالجة الأخطاء:</b> تفعيل الإصلاحات التلقائية (مثل تعديل حجم الصفقة الصغير جداً أو الرافعة غير المدعومة).\n\n` +
                `اختر من القائمة أدناه لتعديل الاستراتيجية:`;

            await ctx.replyWithHTML(msg, {
                reply_markup: buildStrategySettingsKeyboard(user)
            });
        } catch (e) {
            ctx.reply('حدث خطأ أثناء فتح إعدادات الاستراتيجية.');
        }
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

    // --- SETTINGS Callbacks ---
    bot.action(/^settings_/, async (ctx) => {
        const data = (ctx.callbackQuery as any).data as string;
        if (!ctx.from) return;

        const user = await User.findOne({ telegramId: ctx.from.id.toString() });
        if (!user) return;

        if (data === 'settings_risk') {
            user.botState = 'AWAITING_RISK_PERCENTAGE';
            await user.save();
            await ctx.answerCbQuery().catch(() => { });
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
            await ctx.answerCbQuery().catch(() => { });
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
            await ctx.answerCbQuery().catch(() => { });
            return ctx.replyWithHTML(msg, { reply_markup: buildLeverageKeyboard(user) });
        }

        if (data === 'settings_vol_sl') {
            const isEnabled = user.volatilitySlEnabled || false;
            const currentPercent = user.volatilitySlPercentage || 5;
            const msg = `📊 <b>إعدادات الاستوب حسب تذبذب العملة</b>\n\n` +
                `الحالة الآن: <b>${isEnabled ? 'مفعلة 🟢' : 'معطلة 🔴'}</b>\n` +
                `النسبة المحددة: <b>${currentPercent}%</b>\n\n` +
                `اختر الحالة أو النسبة المطلوبة:`;
            await ctx.answerCbQuery().catch(() => { });
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
            await ctx.answerCbQuery().catch(() => { });
            return ctx.replyWithHTML(msg, { reply_markup: buildCapitalProtectionKeyboard(user) });
        }


        if (data === 'settings_hitlar_settings') {
            const settings = user.hitlarSettings;
            const msg = `⚙️ <b>إعدادات وضع هترل (HITLAR Mode)</b>\n\n` +
                `💰 نسبة الدخول: <b>${settings.riskPercentage}%</b>\n` +
                `⚖️ الرافعة: <b>x${settings.leverage}</b>\n` +
                `📊 نسبة الاستوب: <b>${settings.volatilitySlPercentage}%</b>\n\n` +
                `اختر لتعديل القيم:`;
            await ctx.answerCbQuery().catch(() => { });
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
            await ctx.answerCbQuery().catch(() => { });
            return ctx.replyWithHTML(msg, { reply_markup: buildAlertSettingsKeyboard(user) });
        }
    });

    // --- HITLAR Callbacks ---
    bot.action(/^hitlar_/, async (ctx) => {
        const data = (ctx.callbackQuery as any).data as string;
        if (!ctx.from) return;

        const user = await User.findOne({ telegramId: ctx.from.id.toString() });
        if (!user) return;

        if (data === 'hitlar_save') {
            await ctx.deleteMessage().catch(() => { });
            return ctx.answerCbQuery('✅ تم حفظ الإعدادات').catch(() => { });
        }

        if (data === 'hitlar_toggle_cap') {
            user.hitlarSettings.capitalProtectionEnabled = !user.hitlarSettings.capitalProtectionEnabled;
        } else if (data === 'hitlar_toggle_mode') {
            user.hitlarSettings.orderMode = user.hitlarSettings.orderMode === 'limit' ? 'market' : 'limit';
        } else if (data === 'hitlar_edit_risk') {
            user.botState = 'AWAITING_HITLAR_RISK';
            await user.save();
            await ctx.answerCbQuery().catch(() => { });
            return ctx.reply('يرجى إدخال نسبة المخاطرة لوضع هترل (مثال: 5):', {
                reply_markup: { keyboard: [[{ text: 'رجوع 🔙' }]], resize_keyboard: true }
            });
        } else if (data === 'hitlar_edit_lev') {
            user.botState = 'AWAITING_HITLAR_LEV';
            await user.save();
            await ctx.answerCbQuery().catch(() => { });
            return ctx.reply('يرجى إدخال الرافعة المالية لوضع هترل (مثال: 20):', {
                reply_markup: { keyboard: [[{ text: 'رجوع 🔙' }]], resize_keyboard: true }
            });
        } else if (data === 'hitlar_edit_sl') {
            user.botState = 'AWAITING_HITLAR_SL';
            await user.save();
            await ctx.answerCbQuery().catch(() => { });
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
        } catch (e) { }
        return ctx.answerCbQuery('✅ تم التحديث').catch(() => { });
    });

    // --- Order Mode Callbacks ---
    bot.action(/^order_mode_/, async (ctx) => {
        const data = (ctx.callbackQuery as any).data as string;
        if (!ctx.from) return;

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

        await ctx.answerCbQuery(`✅ تم التحويل إلى ${modeLabel}`).catch(() => { });

        // Also update the trader settings keyboard
        await ctx.reply(`✅ تم تحديث نوع التنفيذ إلى: ${modeLabel}`, {
            reply_markup: getTraderSettingsKeyboard(user)
        });
    });

    // --- Capital Protection Callbacks ---
    bot.action(/^cap_/, async (ctx) => {
        const data = (ctx.callbackQuery as any).data as string;
        if (!ctx.from) return;

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

        await ctx.answerCbQuery('✅ تم التحديث').catch(() => { });
    });

    // --- Leverage Callbacks ---
    bot.action(/^lev_/, async (ctx) => {
        const data = (ctx.callbackQuery as any).data as string;
        if (!ctx.from) return;

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

        await ctx.answerCbQuery('✅ تم التحديث').catch(() => { });

        // Update trader settings menu
        await ctx.reply(`✅ تم تحديث إعدادات الرافعة إلى: ${mode === 'fixed' ? `ثابت (x${val})` : 'تلقائي'}`, {
            reply_markup: getTraderSettingsKeyboard(user)
        });
    });

    // --- Volatility SL Callbacks ---
    bot.action(/^vol_/, async (ctx) => {
        const data = (ctx.callbackQuery as any).data as string;
        if (!ctx.from) return;

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

        await ctx.answerCbQuery('✅ تم التحديث').catch(() => { });
    });

    // --- Alert Settings Callbacks ---
    bot.action(/^alert_/, async (ctx) => {
        const data = (ctx.callbackQuery as any).data as string;
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


    // --- STRATEGY SETTINGS Callbacks ---
    bot.action(/^strat_/, async (ctx) => {
        const data = (ctx.callbackQuery as any).data as string;
        if (!ctx.from) return;

        const user = await User.findOne({ telegramId: ctx.from.id.toString() });
        if (!user) return;

        if (data === 'strat_toggle_tp_mode') {
            user.tpExecutionMode = user.tpExecutionMode === 'single' ? 'multiple' : 'single';
            if (user.tpExecutionMode === 'single') {
                user.tpProfitSplits = [100];
            } else {
                user.tpProfitSplits = [50, 50]; // default multiple
            }
        } else if (data === 'strat_toggle_be') {
            user.autoBreakEven = !user.autoBreakEven;
        } else if (data === 'strat_toggle_err_mit') {
            user.errorMitigationEnabled = !user.errorMitigationEnabled;
        } else if (data === 'strat_close') {
            await ctx.deleteMessage().catch(() => { });
            return ctx.answerCbQuery('✅ تم الحفظ').catch(() => { });
        } else if (data === 'strat_info_err_mit') {
            await ctx.answerCbQuery().catch(() => { });
            const infoMsg = `ℹ️ <b>كيف يعمل نظام معالجة الأخطاء؟</b>\n\n` +
                `<b>1. رفع حجم الصفقة (Minimum Notional):</b>\n` +
                `إذا كانت قيمة صفقتك المحسوبة أقل من المسموح (مثلاً أقل من 5 USDT)، سيقوم البوت تلقائياً برفعها إلى الحد الأدنى لضمان الدخول بدلاً من رفض الصفقة.\n\n` +
                `<b>2. توليد الاستوب والأهداف المفقودة:</b>\n` +
                `إذا وصلت توصية بدون SL أو TP، سيقوم البوت بحسابها تلقائياً بناءً على "نسبة التذبذب" التي حددتها في الإعدادات لتأمين الصفقة.\n\n` +
                `<b>3. الرافعة الاحتياطية (Leverage Fallback):</b>\n` +
                `إذا فشلت المنصة في ضبط الرافعة المطلوبة (مثلاً العملة لا تدعم 100x)، سيحاول البوت استخدام رافعة آمنة (مثل 20x أو أقل) لتمرير الصفقة.\n\n` +
                `<b>4. التقسيم الذكي للأهداف:</b>\n` +
                `يمنع البوت تعارض الأوامر في وضع One-Way عن طريق تقسيم كميات البيع على الأهداف بذكاء.`;
            return ctx.replyWithHTML(infoMsg, {
                reply_markup: {
                    inline_keyboard: [[{ text: 'إغلاق الرسالة ❌', callback_data: 'strat_close_info' }]]
                }
            });
        } else if (data === 'strat_toggle_split_mode') {
            if (user.tpExecutionMode === 'single') {
                return ctx.answerCbQuery('لا يمكن تغيير نوع التقسيم في وضع "هدف واحد فقط".', { show_alert: true });
            }
            user.tpSplitMode = user.tpSplitMode === 'manual' ? 'auto' : 'manual';
        } else if (data === 'strat_close_info') {
            await ctx.deleteMessage().catch(() => { });
            return ctx.answerCbQuery().catch(() => { });
        } else if (data === 'strat_edit_splits') {
            if (user.tpExecutionMode === 'single') {
                return ctx.answerCbQuery('لا يمكن تخصيص التقسيم في وضع "هدف واحد فقط". يرجى تغييره أولاً.', { show_alert: true });
            }
            if (user.tpSplitMode !== 'manual') {
                return ctx.answerCbQuery('يرجى تغيير وضع التقسيم إلى "يدوي (مخصص)" أولاً لتتمكن من إدخال النسب.', { show_alert: true });
            }
            user.botState = 'AWAITING_TP_SPLITS';
            await user.save();
            await ctx.answerCbQuery().catch(() => { });
            return ctx.reply('📊 <b>تخصيص تقسيم الأرباح</b>\n\nقم بكتابة نسب الأهداف مفصولة بمسافة أو فاصلة (مثال: 50 30 20 أو 40,60).\nيجب أن يكون المجموع 100.', {
                parse_mode: 'HTML',
                reply_markup: { keyboard: [[{ text: 'رجوع 🔙' }]], resize_keyboard: true }
            });
        }


        await user.save();
        const tpMode = user.tpExecutionMode === 'single' ? '🎯 هدف واحد فقط (TP1)' : '🎯 أهداف متعددة';
        const splitMode = user.tpSplitMode === 'manual' ? 'يدوي (مخصص)' : 'تلقائي (متساوي)';
        const beStatus = user.autoBreakEven ? '🟢 مفعل' : '🔴 معطل';
        const errorMitStatus = user.errorMitigationEnabled ? '🟢 مفعل' : '🔴 معطل';

        const newMsg = `🎯 <b>استراتيجية الأهداف ومعالجة الأخطاء</b>\n\n` +
            `وضع الأهداف: <b>${tpMode}</b>\n` +
            `تقسيم الأرباح: <b>${splitMode}</b>\n` +
            `نقل الاستوب للدخول (BE): <b>${beStatus}</b>\n` +
            `معالجة الأخطاء تلقائياً: <b>${errorMitStatus}</b>\n\n` +
            `اختر من القائمة أدناه لتعديل الاستراتيجية:`;

        try {
            await ctx.editMessageText(newMsg, {
                parse_mode: 'HTML',
                reply_markup: buildStrategySettingsKeyboard(user)
            });
        } catch (e) { }
        await ctx.answerCbQuery('✅ تم التحديث').catch(() => { });
    });

    // --- BACKTEST SETTINGS Callbacks ---
    bot.action(/^bts_/, async (ctx) => {
        const data = (ctx.callbackQuery as any).data as string;
        if (!ctx.from) return;

        const user = await User.findOne({ telegramId: ctx.from.id.toString() });
        if (!user) return;
        
        // Ensure bs object exists
        if (!user.backtestSettings) {
            user.backtestSettings = {
                interval: '15m', initialCapital: 1000, marginMode: 'ISOLATED', leverage: 10,
                riskSizingEnabled: false, riskPercentage: 3, maxSlCapEnabled: false, maxSlPercentage: 5, fullReportEnabled: false
            };
        }

        if (data === 'bts_close') {
            await ctx.deleteMessage().catch(() => { });
            return ctx.answerCbQuery('✅ تم إغلاق لوحة الإعدادات').catch(() => { });
        }

        if (data === 'bts_set_interval') {
            await ctx.answerCbQuery().catch(() => { });
            return ctx.editMessageText('⏱ <b>تعديل الفاصل الزمني (Step Interval)</b>\nاختر الفاصل من القائمة أدناه:', {
                parse_mode: 'HTML',
                reply_markup: getBacktestSettingsIntervals()
            });
        }

        if (data.startsWith('bts_val_int_')) {
            const val = data.replace('bts_val_int_', '');
            user.backtestSettings.interval = val;
            await user.save();
        }

        if (data === 'bts_cancel') {
            // just re-render
        }

        if (data === 'bts_toggle_risksizing') {
            user.backtestSettings.riskSizingEnabled = !user.backtestSettings.riskSizingEnabled;
            await user.save();
        }
        
        if (data === 'bts_toggle_maxslcap') {
            user.backtestSettings.maxSlCapEnabled = !user.backtestSettings.maxSlCapEnabled;
            await user.save();
        }
        
        if (data === 'bts_toggle_fullreport') {
            user.backtestSettings.fullReportEnabled = !user.backtestSettings.fullReportEnabled;
            await user.save();
        }

        if (data === 'bts_set_marginmode') {
            user.backtestSettings.marginMode = user.backtestSettings.marginMode === 'CROSS' ? 'ISOLATED' : 'CROSS';
            await user.save();
        }

        if (data === 'bts_sync_live') {
            user.backtestSettings.initialCapital = 1000; // Reset to 1000 for safety, we can't sync actual wallet balance easily here without API call, and usually user wants simulated balance
            user.backtestSettings.riskPercentage = user.riskPercentage || 3;
            user.backtestSettings.leverage = user.fixedLeverageValue || 10;
            user.backtestSettings.maxSlCapEnabled = user.enforceMaxSlLoss || false;
            user.backtestSettings.maxSlPercentage = user.maxSlRiskPercentage || 5;
            user.backtestSettings.riskSizingEnabled = true; // Typically live uses risk sizing
            await user.save();
            await ctx.answerCbQuery('✅ تم استنساخ إعداداتك الحية بنجاح').catch(() => { });
        }

        if (data === 'bts_set_capital') {
            user.botState = 'AWAITING_BTS_CAPITAL';
            await user.save();
            await ctx.answerCbQuery().catch(() => { });
            return ctx.reply('يرجى إدخال رأس المال الابتدائي للاختبار (رقم فقط، مثال: 5000):', {
                reply_markup: { keyboard: [[{ text: 'رجوع 🔙' }]], resize_keyboard: true }
            });
        }

        if (data === 'bts_set_leverage') {
            user.botState = 'AWAITING_BTS_LEVERAGE';
            await user.save();
            await ctx.answerCbQuery().catch(() => { });
            return ctx.reply('يرجى إدخال الرافعة المالية الافتراضية للاختبار (مثال: 20):', {
                reply_markup: { keyboard: [[{ text: 'رجوع 🔙' }]], resize_keyboard: true }
            });
        }

        if (data === 'bts_set_riskpercentage') {
            user.botState = 'AWAITING_BTS_RISK';
            await user.save();
            await ctx.answerCbQuery().catch(() => { });
            return ctx.reply('يرجى إدخال النسبة (دخول/مخاطرة) للاختبار (مثال: 3):', {
                reply_markup: { keyboard: [[{ text: 'رجوع 🔙' }]], resize_keyboard: true }
            });
        }

        if (data === 'bts_set_maxslpercentage') {
            user.botState = 'AWAITING_BTS_MAX_SL';
            await user.save();
            await ctx.answerCbQuery().catch(() => { });
            return ctx.reply('يرجى إدخال أقصى نسبة خسارة للاستوب (مثال: 5):', {
                reply_markup: { keyboard: [[{ text: 'رجوع 🔙' }]], resize_keyboard: true }
            });
        }

        const msg = `⚙️ <b>لوحة تحكم الاختبار الرجعي (Backtest Settings)</b>\n\n` +
            `من هنا يمكنك ضبط المعايير الافتراضية وإدارة المخاطر لمحرك الاختبار بدقة متناهية.`;

        try {
            await ctx.editMessageText(msg, {
                parse_mode: 'HTML',
                reply_markup: getBacktestSettingsKeyboard(user)
            });
        } catch (e) { }
        
        if (!['bts_set_interval', 'bts_cancel'].includes(data) && !data.startsWith('bts_val_')) {
            await ctx.answerCbQuery('✅ تم التحديث').catch(() => { });
        } else if (data.startsWith('bts_val_')) {
            await ctx.answerCbQuery('✅ تم حفظ الفاصل الزمني').catch(() => { });
        }
    });

};
