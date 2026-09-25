import { Telegraf } from 'telegraf';
import logger from '../../utils/logger';
import User from '../../models/User';
import Trade from '../../models/Trade';
import TradeRadar from '../../models/TradeRadar';
import { getMainMenuKeyboard } from '../keyboards/baseKeyboards';
import {
    getRadarMainKeyboard,
    getTradeRadarDetailKeyboard,
    getRadarSettingsKeyboard,
    getRadarDefaultSettingsKeyboard,
} from '../keyboards/radarKeyboards';

// ─── registerRadarHandlers ─────────────────────────────────────────────────────

export function registerRadarHandlers(bot: Telegraf) {

    // ── فتح لوحة مراقبة الصفقات الحية ────────────────────────────────────────
    bot.action('radar_main', async (ctx) => {
        await showRadarMain(ctx);
        await ctx.answerCbQuery();
    });

    // ── تفاصيل صفقة محددة ─────────────────────────────────────────────────────
    bot.action(/^radar_trade_(.+)$/, async (ctx) => {
        const tradeId = ctx.match[1];
        try {
            const trade = await Trade.findById(tradeId);
            if (!trade) return ctx.answerCbQuery('الصفقة غير موجودة');

            const radar = await TradeRadar.findOne({ tradeId, isActive: true });
            const isMonitored = !!radar;
            const sym = trade.symbol.split('/')[0];
            const dirEmoji = trade.direction === 'LONG' ? '🟢' : '🔴';

            await ctx.editMessageText(
                `📡 *مراقبة صفقة ${sym}*\n\n` +
                `الاتجاه: ${dirEmoji} ${trade.direction}\n` +
                `سعر الدخول: ${trade.entryPrice}\n` +
                `وقف الخسارة: ${trade.stopLoss}\n` +
                `الحالة: ${isMonitored ? '✅ تحت المراقبة' : '⭕ غير مراقبة'}\n` +
                (radar ? `\n*الإعدادات النشطة:*\n` +
                    `• كشف Wick Sweep: ${radar.settings.wickSweepAlert ? '✅' : '❌'}\n` +
                    `• تنبيه انعكاس CHoCH: ${radar.settings.reversalAlert ? '✅' : '❌'}\n` +
                    `• Trailing Stop: ${radar.settings.trailingEnabled ? '✅' : '❌'}` : ''),
                {
                    parse_mode: 'Markdown',
                    reply_markup: getTradeRadarDetailKeyboard(tradeId, isMonitored)
                }
            );
            await ctx.answerCbQuery();
        } catch (e: any) {
            logger.error('radar_trade:', e);
            await ctx.answerCbQuery('حدث خطأ');
        }
    });

    // ── تفعيل مراقبة صفقة ────────────────────────────────────────────────────
    bot.action(/^radar_enable_(.+)$/, async (ctx) => {
        const tradeId = ctx.match[1];
        try {
            const trade = await Trade.findById(tradeId);
            if (!trade) return ctx.answerCbQuery('الصفقة غير موجودة');

            const telegramId = ctx.from?.id.toString();
            const user = telegramId ? await User.findOne({ telegramId }) : null;

            // أنشئ radar أو أعد تفعيله
            await TradeRadar.findOneAndUpdate(
                { tradeId },
                {
                    tradeId,
                    userId: trade.userId,
                    telegramId: telegramId || '',
                    symbol: trade.symbol,
                    direction: trade.direction,
                    entryPrice: trade.entryPrice,
                    currentSL: trade.stopLoss,
                    isActive: true,
                    settings: {
                        notifyOnce: user?.radarSettings?.notifyOnce ?? true,
                        trailingEnabled: user?.radarSettings?.trailingEnabled ?? false,
                        wickSweepAlert: user?.radarSettings?.wickSweepAlert ?? true,
                        reversalAlert: user?.radarSettings?.reversalAlert ?? true,
                    },
                    sentEvents: [],
                },
                { upsert: true, new: true }
            );

            await ctx.editMessageText(
                `✅ *تم تفعيل المراقبة!*\n\n` +
                `📡 الصفقة: ${trade.symbol.split('/')[0]} (${trade.direction})\n\n` +
                `سيتم إشعارك فور رصد أي من التالي:\n` +
                `• ⚠️ اختراق ذيل لـ SL وارتداد\n` +
                `• 🚨 خطر انعكاس (CHoCH + Divergence)\n` +
                `• 📈 تحديث Trailing Stop (إذا مفعّل)`,
                {
                    parse_mode: 'Markdown',
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: '⚙️ تخصيص الإعدادات', callback_data: `radar_settings_${tradeId}` }],
                            [{ text: '🔙 رجوع لقائمة الصفقات', callback_data: 'radar_main' }]
                        ]
                    }
                }
            );
            await ctx.answerCbQuery('✅ تم تفعيل المراقبة');
        } catch (e: any) {
            logger.error('radar_enable:', e);
            await ctx.answerCbQuery('حدث خطأ');
        }
    });

    // ── إيقاف مراقبة صفقة ────────────────────────────────────────────────────
    bot.action(/^radar_disable_(.+)$/, async (ctx) => {
        const tradeId = ctx.match[1];
        await TradeRadar.findOneAndUpdate({ tradeId }, { isActive: false });
        await ctx.editMessageText('✅ تم إيقاف المراقبة لهذه الصفقة.', {
            reply_markup: {
                inline_keyboard: [[{ text: '🔙 رجوع', callback_data: 'radar_main' }]]
            }
        });
        await ctx.answerCbQuery('تم الإيقاف');
    });

    // ── فتح إعدادات مراقبة صفقة ──────────────────────────────────────────────
    bot.action(/^radar_settings_(.+)$/, async (ctx) => {
        const tradeId = ctx.match[1];
        const radar = await TradeRadar.findOne({ tradeId });
        if (!radar) return ctx.answerCbQuery('لا توجد مراقبة نشطة');
        await ctx.editMessageText(
            `⚙️ *إعدادات مراقبة ${radar.symbol.split('/')[0]}*\n\nاختر ما تريد تفعيله أو إيقافه:`,
            { parse_mode: 'Markdown', reply_markup: getRadarSettingsKeyboard(tradeId, radar.settings) }
        );
        await ctx.answerCbQuery();
    });

    // ── تبديل إعدادات المراقبة (Toggle) ──────────────────────────────────────

    bot.action(/^radar_tog_wick_(.+)$/, async (ctx) => {
        const tradeId = ctx.match[1];
        const radar = await TradeRadar.findOne({ tradeId });
        if (!radar) return ctx.answerCbQuery();
        radar.settings.wickSweepAlert = !radar.settings.wickSweepAlert;
        await radar.save();
        await ctx.editMessageReplyMarkup(getRadarSettingsKeyboard(tradeId, radar.settings) as any);
        await ctx.answerCbQuery(`Wick Sweep: ${radar.settings.wickSweepAlert ? 'مفعّل ✅' : 'معطّل ❌'}`);
    });

    bot.action(/^radar_tog_reversal_(.+)$/, async (ctx) => {
        const tradeId = ctx.match[1];
        const radar = await TradeRadar.findOne({ tradeId });
        if (!radar) return ctx.answerCbQuery();
        radar.settings.reversalAlert = !radar.settings.reversalAlert;
        await radar.save();
        await ctx.editMessageReplyMarkup(getRadarSettingsKeyboard(tradeId, radar.settings) as any);
        await ctx.answerCbQuery(`تنبيه الانعكاس: ${radar.settings.reversalAlert ? 'مفعّل ✅' : 'معطّل ❌'}`);
    });

    bot.action(/^radar_tog_trailing_(.+)$/, async (ctx) => {
        const tradeId = ctx.match[1];
        const radar = await TradeRadar.findOne({ tradeId });
        if (!radar) return ctx.answerCbQuery();
        radar.settings.trailingEnabled = !radar.settings.trailingEnabled;
        await radar.save();
        await ctx.editMessageReplyMarkup(getRadarSettingsKeyboard(tradeId, radar.settings) as any);
        await ctx.answerCbQuery(`Trailing Stop: ${radar.settings.trailingEnabled ? 'مفعّل ✅' : 'معطّل ❌'}`);
    });

    bot.action(/^radar_tog_once_(.+)$/, async (ctx) => {
        const tradeId = ctx.match[1];
        const radar = await TradeRadar.findOne({ tradeId });
        if (!radar) return ctx.answerCbQuery();
        radar.settings.notifyOnce = !radar.settings.notifyOnce;
        await radar.save();
        await ctx.editMessageReplyMarkup(getRadarSettingsKeyboard(tradeId, radar.settings) as any);
        await ctx.answerCbQuery(`إشعار واحد: ${radar.settings.notifyOnce ? 'نعم ✅' : 'لا ❌'}`);
    });

    // ── حفظ وإغلاق الإعدادات ─────────────────────────────────────────────────
    bot.action(/^radar_save_(.+)$/, async (ctx) => {
        const tradeId = ctx.match[1];
        await ctx.editMessageText('✅ تم حفظ إعدادات المراقبة.', {
            reply_markup: { inline_keyboard: [[{ text: '🔙 رجوع', callback_data: `radar_trade_${tradeId}` }]] }
        });
        await ctx.answerCbQuery('تم الحفظ ✅');
    });

    // ── نقل SL لـ Break-Even من إشعار الانعكاس ───────────────────────────────
    bot.action(/^radar_be_(.+)$/, async (ctx) => {
        const tradeId = ctx.match[1];
        try {
            const trade = await Trade.findById(tradeId);
            if (!trade) return ctx.answerCbQuery('الصفقة غير موجودة');
            // سيُعالج فعلياً عبر PositionMonitor — هنا نرسل إشعاراً فقط
            await ctx.answerCbQuery('⏳ جاري نقل SL لنقطة الدخول...');
            await ctx.reply(
                `🔒 *طلب Break-Even*\n\n` +
                `${trade.symbol} — سعر الدخول: \`${trade.entryPrice}\`\n\n` +
                `سيتم نقل SL لنقطة الدخول تلقائياً في الدورة القادمة للـ PositionMonitor.`,
                { parse_mode: 'Markdown' }
            );
            // نُشير للـ monitor بأن يُطبق BE
            trade.isBreakEvenSet = false; // إعادة تفعيل BE trigger
            await trade.save();
        } catch (e: any) {
            logger.error('radar_be:', e);
            await ctx.answerCbQuery('حدث خطأ');
        }
    });

    // ── إعدادات المراقبة الافتراضية ───────────────────────────────────────────
    bot.action('radar_default_settings', async (ctx) => {
        try {
            const telegramId = ctx.from?.id.toString();
            if (!telegramId) return ctx.answerCbQuery();
            const user = await User.findOne({ telegramId });
            if (!user) return ctx.answerCbQuery('المستخدم غير موجود');

            if (!user.radarSettings) {
                user.radarSettings = {
                    wickSweepAlert: true,
                    reversalAlert: true,
                    trailingEnabled: false,
                    notifyOnce: true
                };
                await user.save();
            }

            await ctx.editMessageText(
                `⚙️ *إعدادات المراقبة الافتراضية*\n\n` +
                `اختر الإعدادات المناسبة للصفقات الجديدة التي سيتم مراقبتها:`,
                {
                    parse_mode: 'Markdown',
                    reply_markup: getRadarDefaultSettingsKeyboard(user.radarSettings)
                }
            );
            await ctx.answerCbQuery();
        } catch (e: any) { logger.error('radar_default_settings:', e); }
    });

    bot.action('radar_def_tog_wick', async (ctx) => {
        try {
            const telegramId = ctx.from?.id.toString();
            if (!telegramId) return ctx.answerCbQuery();
            const user = await User.findOne({ telegramId });
            if (!user) return ctx.answerCbQuery();

            if (!user.radarSettings) {
                user.radarSettings = { wickSweepAlert: true, reversalAlert: true, trailingEnabled: false, notifyOnce: true };
            }
            user.radarSettings.wickSweepAlert = !user.radarSettings.wickSweepAlert;
            await user.save();

            await ctx.editMessageReplyMarkup(getRadarDefaultSettingsKeyboard(user.radarSettings) as any);
            await ctx.answerCbQuery(`Wick Sweep: ${user.radarSettings.wickSweepAlert ? '✅ مفعل' : '❌ معطل'}`);
        } catch (e: any) { logger.error('radar_def_tog_wick:', e); }
    });

    bot.action('radar_def_tog_reversal', async (ctx) => {
        try {
            const telegramId = ctx.from?.id.toString();
            if (!telegramId) return ctx.answerCbQuery();
            const user = await User.findOne({ telegramId });
            if (!user) return ctx.answerCbQuery();

            if (!user.radarSettings) {
                user.radarSettings = { wickSweepAlert: true, reversalAlert: true, trailingEnabled: false, notifyOnce: true };
            }
            user.radarSettings.reversalAlert = !user.radarSettings.reversalAlert;
            await user.save();

            await ctx.editMessageReplyMarkup(getRadarDefaultSettingsKeyboard(user.radarSettings) as any);
            await ctx.answerCbQuery(`تنبيه الانعكاس: ${user.radarSettings.reversalAlert ? '✅ مفعل' : '❌ معطل'}`);
        } catch (e: any) { logger.error('radar_def_tog_reversal:', e); }
    });

    bot.action('radar_def_tog_trailing', async (ctx) => {
        try {
            const telegramId = ctx.from?.id.toString();
            if (!telegramId) return ctx.answerCbQuery();
            const user = await User.findOne({ telegramId });
            if (!user) return ctx.answerCbQuery();

            if (!user.radarSettings) {
                user.radarSettings = { wickSweepAlert: true, reversalAlert: true, trailingEnabled: false, notifyOnce: true };
            }
            user.radarSettings.trailingEnabled = !user.radarSettings.trailingEnabled;
            await user.save();

            await ctx.editMessageReplyMarkup(getRadarDefaultSettingsKeyboard(user.radarSettings) as any);
            await ctx.answerCbQuery(`Trailing Stop: ${user.radarSettings.trailingEnabled ? '✅ مفعل' : '❌ معطل'}`);
        } catch (e: any) { logger.error('radar_def_tog_trailing:', e); }
    });

    bot.action('radar_def_tog_once', async (ctx) => {
        try {
            const telegramId = ctx.from?.id.toString();
            if (!telegramId) return ctx.answerCbQuery();
            const user = await User.findOne({ telegramId });
            if (!user) return ctx.answerCbQuery();

            if (!user.radarSettings) {
                user.radarSettings = { wickSweepAlert: true, reversalAlert: true, trailingEnabled: false, notifyOnce: true };
            }
            user.radarSettings.notifyOnce = !user.radarSettings.notifyOnce;
            await user.save();

            await ctx.editMessageReplyMarkup(getRadarDefaultSettingsKeyboard(user.radarSettings) as any);
            await ctx.answerCbQuery(`إشعار واحد: ${user.radarSettings.notifyOnce ? '✅ نعم' : '❌ لا'}`);
        } catch (e: any) { logger.error('radar_def_tog_once:', e); }
    });

    bot.action('radar_def_save', async (ctx) => {
        try {
            await showRadarMain(ctx);
            await ctx.answerCbQuery('✅ تم حفظ الإعدادات الافتراضية');
        } catch (e: any) { logger.error('radar_def_save:', e); }
    });

    // ── إغلاق لوحة الرادار ───────────────────────────────────────────────────
    bot.action('radar_close', async (ctx) => {
        const telegramId = ctx.from?.id.toString();
        const user = telegramId ? await User.findOne({ telegramId }) : null;
        await ctx.deleteMessage().catch(() => {});
        if (user) await ctx.reply('تم الإغلاق.', { reply_markup: getMainMenuKeyboard(user) });
        await ctx.answerCbQuery();
    });

    // ── لا شيء (noop) ─────────────────────────────────────────────────────────
    bot.action('radar_noop', async (ctx) => ctx.answerCbQuery());

    // ── تنفيذ صفقة تعويضية من الرادار ──
    bot.action(/^radar_exec_comp_(.+)$/, async (ctx) => {
        const tradeId = ctx.match[1];
        try {
            const telegramId = ctx.from?.id.toString();
            if (!telegramId) return ctx.answerCbQuery().catch(() => {});

            const user = await User.findOne({ telegramId });
            if (!user) return ctx.answerCbQuery('المستخدم غير موجود').catch(() => {});

            const radar = await TradeRadar.findOne({ tradeId });
            if (!radar) return ctx.answerCbQuery('لا يوجد رادار نشط لهذه الصفقة').catch(() => {});

            // Find the latest WICK_SWEEP event to get the proposedSL and other parameters
            const sweepEvent = [...radar.sentEvents].reverse().find(e => e.type === 'WICK_SWEEP');
            if (!sweepEvent) {
                await ctx.answerCbQuery('❌ لم يتم العثور على تنبيه سحب سيولة مسجل.').catch(() => {});
                return;
            }

            // Parse details: e.g. "SL=100, low=99, proposedSL=98.5, margin=15"
            const detailsMap: Record<string, string> = {};
            sweepEvent.details.split(', ').forEach(part => {
                const [k, v] = part.split('=');
                if (k && v) detailsMap[k] = v;
            });

            const proposedSL = parseFloat(detailsMap['proposedSL']);
            const marginValue = parseFloat(detailsMap['margin']);

            if (isNaN(proposedSL) || isNaN(marginValue)) {
                await ctx.answerCbQuery('❌ فشل استخراج تفاصيل الصفقة المقترحة.').catch(() => {});
                return;
            }

            const originalTrade = await Trade.findById(tradeId);
            if (!originalTrade) {
                await ctx.answerCbQuery('❌ الصفقة الأصلية غير موجودة.').catch(() => {});
                return;
            }

            await ctx.answerCbQuery('⏳ جاري تنفيذ صفقة التعويض...').catch(() => {});

            const { BingXService } = require('../../services/BingXService');
            const { TradeManager } = require('../../services/TradeManager');

            // Initialize BingXService with user credentials if available
            const userBingX = new BingXService(user.bingxApiKey, user.bingxSecretKey);
            const currentPrice = await userBingX.getMarketPrice(radar.symbol);

            const signal: any = {
                type: 'TRADE',
                symbol: radar.symbol,
                direction: radar.direction,
                entry: [currentPrice],
                stopLoss: proposedSL,
                targets: originalTrade.targets.map((t: any) => t.price),
                leverage: originalTrade.leverage || 10,
                risk: (marginValue / originalTrade.amount) * 100 * (originalTrade.leverage || 10),
                marginMode: 'CROSS'
            };

            const tradeManager = new TradeManager(userBingX);
            const compResult = await tradeManager.executeSignal(signal, user._id.toString(), ctx.chat?.id.toString());

            if (compResult) {
                // record that compensation was executed
                radar.sentEvents.push({
                    type: 'CUSTOM',
                    sentAt: new Date(),
                    details: `Executed WICK_SWEEP_COMPENSATION trade ${compResult.tradeId} at ${currentPrice} with SL ${proposedSL}`
                });
                await radar.save();

                const dirEmoji = compResult.direction === 'LONG' ? '🟢' : '🔴';
                await ctx.reply(
                    `✅ *تم تنفيذ صفقة التعويض التحوطية بنجاح!*\n\n` +
                    `🪙 العملة: *${compResult.symbol.split('/')[0]}*\n` +
                    `📈 الاتجاه: *${compResult.direction} ${dirEmoji}*\n` +
                    `💵 سعر الدخول: *${compResult.entryPrice}*\n` +
                    `🛑 وقف خسارة ضيق: *${proposedSL}*\n` +
                    `🎯 الأهداف: *${compResult.targets.map((t: any) => t.price).join(', ')}*\n` +
                    `💰 الهامش المستخدم: *${compResult.margin.toFixed(2)} USDT*`
                , { parse_mode: 'Markdown' });
            } else {
                await ctx.reply('❌ فشل تنفيذ صفقة التعويض، يرجى مراجعة سجلات البوت.');
            }

        } catch (e: any) {
            logger.error('radar_exec_comp:', e);
            await ctx.reply(`❌ حدث خطأ أثناء تنفيذ صفقة التعويض: ${e.message}`);
        }
    });
}

// ─── Helper: عرض القائمة الرئيسية للرادار ─────────────────────────────────────

async function showRadarMain(ctx: any) {
    const telegramId = ctx.from?.id.toString();
    if (!telegramId) return;

    const user = await User.findOne({ telegramId });
    if (!user) return;

    // جلب الصفقات المفتوحة لهذا المستخدم
    const activeTrades = await Trade.find({
        userId: user._id,
        currentStatus: { $in: ['OPEN', 'TP1_HIT', 'TP2_HIT'] }
    });

    // جلب IDs الصفقات التي تحت المراقبة
    const activeRadars = await TradeRadar.find({ userId: user._id, isActive: true });
    const monitoredIds = activeRadars.map(r => r.tradeId.toString());

    const msgText = activeTrades.length > 0
        ? `📡 *مراقبة الصفقات الحية*\n\nصفقاتك الحالية (${activeTrades.length}):\nاختر صفقة لتفعيل أو إدارة مراقبتها:`
        : `📡 *مراقبة الصفقات الحية*\n\nلا توجد صفقات مفتوحة حالياً.`;

    try {
        await ctx.editMessageText(msgText, {
            parse_mode: 'Markdown',
            reply_markup: getRadarMainKeyboard(activeTrades, monitoredIds)
        });
    } catch {
        await ctx.reply(msgText, {
            parse_mode: 'Markdown',
            reply_markup: getRadarMainKeyboard(activeTrades, monitoredIds)
        });
    }
}
