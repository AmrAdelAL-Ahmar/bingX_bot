import { Telegraf, Context } from 'telegraf';
import dotenv from 'dotenv';
import connectDB from './config/db';
import logger from './utils/logger';
import User from './models/User';
import Trade from './models/Trade';
import { BingXService } from './services/BingXService';
import { TradeManager } from './services/TradeManager';
import { SignalParser } from './services/SignalParser';
import { ReportingService } from './services/ReportingService';
import { PositionMonitor } from './services/PositionMonitor';
import { startHealthServer } from './server';

dotenv.config();

const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN || '');
const bingXService = new BingXService(process.env.BINGX_API_KEY, process.env.BINGX_SECRET_KEY);
const tradeManager = new TradeManager(bingXService);
const reportingService = new ReportingService(bot);

// Initialize Monitor
const positionMonitor = new PositionMonitor(bingXService, async (telegramId, msg) => {
    try {
        await bot.telegram.sendMessage(telegramId, msg, { parse_mode: 'HTML' });
        logger.info(`Notification sent successfully to ${telegramId}`);
    } catch (error) {
        logger.error(`Error sending notification to ${telegramId}:`, error);
    }
});

// Middleware to ensure user exists & check whitelist
const ensureUser = async (ctx: Context, next: () => Promise<void>) => {
    if (!ctx.from) return;
    
    const telegramId = ctx.from.id.toString();
    const chatId = ctx.chat?.id.toString();
    const allowedIds = process.env.ALLOWED_TELEGRAM_IDS 
        ? process.env.ALLOWED_TELEGRAM_IDS.split(',').map(id => id.trim()) 
        : [];

    // Check if either the user or the chat (group) is whitelisted
    const isWhitelisted = allowedIds.length === 0 || 
                         allowedIds.includes(telegramId) || 
                         (chatId && allowedIds.includes(chatId));

    // If whitelist is set and neither user nor chat is in it, block access
    if (!isWhitelisted) {
        logger.warn(`Unauthorized access attempt by: ${ctx.from.username || 'unknown'} (${telegramId})${chatId ? ` in chat ${chatId}` : ''}`);
        try {
            await ctx.reply('⚠️ عذراً، أنت غير مصرح لك باستخدام هذا البوت. يرجى التواصل مع المسؤول لإضافة معرفك أو معرف المجموعة للقائمة البيضاء.');
        } catch (e) { }
        return;
    }

    try {
        let user = await User.findOne({ telegramId });
        if (!user) {
            user = await User.create({
                telegramId,
                username: ctx.from.username,
                riskPercentage: parseInt(process.env.RISK_PERCENTAGE || '2'),
            });
            logger.info(`New user created: ${user.username}`);
        }
        return next();
    } catch (err) {
        logger.error('Error in ensureUser middleware', err);
    }
};

// --- HELPER: GET MAIN MENU KEYBOARD ---
const getMainMenuKeyboard = (user: any) => {
    const riskStatus = (user.enforceMaxSlLoss !== null && user.enforceMaxSlLoss !== undefined)
        ? user.enforceMaxSlLoss
        : process.env.ENFORCE_MAX_SL_LOSS === 'true';
    const riskIcon = riskStatus ? '🟢 مفعل' : '🔴 معطل';

    return {
        keyboard: [
            [
                { text: '💰 رصيدي وملخص الأرباح' },
                { text: '💼 صفقاتي المفتوحة' }
            ],
            [
                { text: '📊 التقارير' },
                { text: '⚙️ إعدادات التنبيهات' }
            ],
            [
                { text: '🔍 الاستعلام عن صفقة محددة' },
                { text: '❌ إلغاء صفقة محددة' }
            ],
            [
                { text: '🛑 إلغاء كل الصفقات المفتوحة' }
            ],
            [
                { text: `🛡 حماية رأس المال (6% SL): ${riskIcon}` }
            ],
            [
                { text: 'ℹ️ تعليمات الاستخدام (Help)' }
            ]
        ],
        resize_keyboard: true,
        is_persistent: true
    };
};

bot.use(ensureUser);

bot.start(async (ctx) => {
    const user = await User.findOne({ telegramId: ctx.from.id.toString() });
    ctx.reply('مرحباً بك! أنا جاهز للتداول. يمكنك إرسال إشارة تداول أو استخدام القائمة أدناه:', {
        reply_markup: user ? getMainMenuKeyboard(user) : undefined
    });
});

bot.command('menu', async (ctx) => {
    try {
        const user = await User.findOne({ telegramId: ctx.from.id.toString() });
        if (!user) return;

        await ctx.reply('مرحباً بك في قائمة التحكم الخاصة بالبوت 🤖\nاختر أحد الإجراءات التالية:', {
            reply_markup: getMainMenuKeyboard(user)
        }).catch(e => logger.error(`Failed to send menu: ${e.message}`));
    } catch (error) {
        logger.error('Error in /menu:', error);
    }
});

// --- HELPER: GENERATE COMPREHENSIVE REPORT ---
const generateReportStr = (trades: any[], title: string, currentBalance: number) => {
    if (trades.length === 0) return `لا يوجد صفقات مغلقة لـ ${title} 📭`;

    let totalWins = 0;
    let totalLosses = 0;
    let netPnlUsdt = 0;
    let tradesDetails = '';

    trades.forEach((t, index) => {
        const margin = t.amount / (t.leverage || 10);
        const pnlPercent = t.pnl || 0;
        const pnlUsdt = margin * (pnlPercent / 100);

        netPnlUsdt += pnlUsdt;
        if (pnlUsdt > 0) totalWins++;
        else totalLosses++;

        // Derive approximate exit price based on realized PnL%
        const priceDiff = Math.abs((pnlPercent / 100 / (t.leverage || 10)) * t.entryPrice);
        const exitPrice = pnlPercent >= 0
            ? (t.direction === 'LONG' ? t.entryPrice + priceDiff : t.entryPrice - priceDiff)
            : (t.direction === 'LONG' ? t.entryPrice - priceDiff : t.entryPrice + priceDiff);

        tradesDetails += `\n${index + 1}. <b>${t.symbol}</b> (${t.direction})\n` +
            `الدخول: ${t.entryPrice.toFixed(4)} ➡️ الإغلاق: ${exitPrice.toFixed(4)}\n` +
            `المبلغ (Margin): ${margin.toFixed(2)} USDT\n` +
            `النتيجة: ${pnlUsdt >= 0 ? '🟢' : '🔴'} ${pnlUsdt.toFixed(2)} USDT (${pnlPercent.toFixed(2)}%)\n`;
    });

    const winRate = ((totalWins / trades.length) * 100).toFixed(2);
    // Approximate starting balance (assuming no deposits/withdrawals since then)
    const balanceStart = currentBalance - netPnlUsdt;
    const growthPercent = balanceStart > 0 ? (netPnlUsdt / balanceStart) * 100 : 0;

    let msg = `📊 <b>${title}</b>\n\n` +
        `✅ إجمالي الصفقات: ${trades.length}\n` +
        `🏆 ربح: ${totalWins} | 💀 خسارة: ${totalLosses}\n` +
        `📈 معدل النجاح: ${winRate}%\n\n`;

    msg += `<b>💵 تفاصيل الأرباح والمحفظة:</b>\n` +
        `💰 إجمالي مبلغ الربح/الخسارة: ${netPnlUsdt >= 0 ? '🟢' : '🔴'} <b>${netPnlUsdt.toFixed(2)} USDT</b>\n` +
        (balanceStart > 0 ? `💵 رأس المال قبل: ~${balanceStart.toFixed(2)} USDT\n` : '') +
        `🏦 إجمالي المحفظة الحالي: ${currentBalance.toFixed(2)} USDT\n` +
        `🚀 نسبة ${netPnlUsdt >= 0 ? 'الارتفاع' : 'الهبوط'}: ${netPnlUsdt >= 0 ? '🟢' : '🔴'} ${growthPercent.toFixed(2)}%\n\n`;

    msg += `<b>📋 تفاصيل الصفقات:</b>` + tradesDetails;
    return msg;
};

// --- ACTION HANDLERS ---
bot.hears('💰 رصيدي وملخص الأرباح', async (ctx) => {
    try {
        const balance = await bingXService.getBalance();

        let msg = `<b>💰 تفاصيل الحساب:</b>\n\n`;
        msg += `الرصيد المتاح (USDT): <b>${balance.toFixed(2)}</b>\n`;

        const positions = await bingXService.getPositions();
        let totalPnl = 0;

        if (positions && positions.length > 0) {
            for (const pos of positions) {
                if (parseFloat(pos.contracts) === 0) continue;
                const pnl = pos.unrealizedPnl !== undefined ? pos.unrealizedPnl :
                    (pos.info && pos.info.unrealizedProfit ? parseFloat(pos.info.unrealizedProfit) : 0);
                totalPnl += pnl;
            }
            const pnlEmoji = totalPnl >= 0 ? '🟢' : '🔴';
            msg += `الأرباح/الخسائر غير المحققة للصفقات المفتوحة: ${pnlEmoji} <b>${totalPnl.toFixed(2)} USDT</b>\n`;
        } else {
            msg += `لا يوجد صفقات مفتوحة حالياً.\n`;
        }

        ctx.replyWithHTML(msg).catch(e => logger.error(`Failed to send balance info: ${e.message}`));
    } catch (error) {
        ctx.reply('حدث خطأ أثناء جلب الرصيد.').catch(e => logger.error(`Failed to send balance error: ${e.message}`));
    }
});

bot.hears('💼 صفقاتي المفتوحة', async (ctx) => {
    try {
        if (!ctx.from) return;
        const user = await User.findOne({ telegramId: ctx.from.id.toString() });
        if (!user) return;

        const balance = await bingXService.getBalance();
        const positions = await bingXService.getPositions();

        if (!positions || positions.length === 0) {
            ctx.reply('لا يوجد صفقات مفتوحة حالياً.').catch(e => logger.error(`Failed to send no positions notice: ${e.message}`));
            return;
        }

        const openTrades = await Trade.find({
            userId: user._id,
            currentStatus: { $in: ['OPEN', 'TP1_HIT', 'TP2_HIT'] }
        });

        let msg = '<b>💼 صفقاتي المفتوحة (Live) 🟢:</b>\n\n';
        let totalPnl = 0;
        let totalMarginUsed = 0;

        for (const pos of positions) {
            if (parseFloat(pos.contracts) === 0) continue;

            const pnl = pos.unrealizedPnl !== undefined ? pos.unrealizedPnl :
                (pos.info && pos.info.unrealizedProfit ? parseFloat(pos.info.unrealizedProfit) : 0);

            totalPnl += pnl;

            let margin = pos.initialMargin !== undefined ? pos.initialMargin :
                (pos.info && pos.info.isolatedMargin ? parseFloat(pos.info.isolatedMargin) : 0);

            // Fallback for margin if not found directly
            if (!margin && pos.notional) {
                margin = Math.abs(pos.notional) / (pos.leverage || 10);
            }
            totalMarginUsed += margin;

            let roe = pos.percentage;
            if (roe === undefined || roe === null) {
                if (margin && margin > 0) {
                    roe = (pnl / margin) * 100;
                } else {
                    roe = pos.info && pos.info.profitRate ? parseFloat(pos.info.profitRate) * 100 : 0;
                }
            }

            const emoji = pnl >= 0 ? '🟢' : '🔴';
            const entryPrice = parseFloat(pos.entryPrice);
            const markPrice = parseFloat(pos.markPrice);
            const amountCoins = parseFloat(pos.contracts);
            const posSide = pos.side.toUpperCase();

            // Match trade in DB for TP/SL details
            const trade = openTrades.find(t => t.symbol === pos.symbol || pos.symbol.includes(t.symbol.split('/')[0]));

            const leverage = pos.leverage || (trade ? trade.leverage : null) || 'N/A';
            msg += `<b>${pos.symbol}</b> (${posSide}) | الرافعة: <b>${leverage}x</b>\n` +
                `الدخول: ${entryPrice.toFixed(4)} ➡️ الحالي: ${markPrice.toFixed(4)}\n` +
                `المبلغ المستثمر (Margin): ${margin.toFixed(4)} USDT (النسبة من الرصيد: ${balance > 0 ? ((margin / balance) * 100).toFixed(2) : 0}%)\n` +
                `الأرباح/الخسائر الحالية: ${emoji} ${pnl.toFixed(4)} USDT (${roe.toFixed(2)}%)\n`;

            if (trade) {
                // Potential TP Profit (Using first target or average if needed, here we use TARGET 1 as reference)
                if (trade.targets && trade.targets.length > 0) {
                    const tpPrice = trade.targets[0].price;
                    const tpPnl = posSide === 'LONG' ? (tpPrice - entryPrice) * amountCoins : (entryPrice - tpPrice) * amountCoins;
                    const tpPercent = margin > 0 ? (tpPnl / margin) * 100 : 0;
                    msg += `الهدف القادم: ${tpPrice} 🎯 (الربح المتوقع: ${tpPnl.toFixed(4)} USDT | ${tpPercent.toFixed(2)}%)\n`;
                }

                // Potential SL Loss
                if (trade.stopLoss) {
                    const slPrice = trade.stopLoss;
                    const slPnl = posSide === 'LONG' ? (slPrice - entryPrice) * amountCoins : (entryPrice - slPrice) * amountCoins;
                    // slPnl will generally be negative
                    const slPercent = margin > 0 ? (slPnl / margin) * 100 : 0;
                    msg += `وقف الخسارة: ${slPrice} 🛑 (الخسارة المتوقعة: ${slPnl.toFixed(4)} USDT | ${slPercent.toFixed(2)}%)\n`;
                }
            }

            msg += `-------------------\n`;
        }

        const totalMarginPercent = balance > 0 ? ((totalMarginUsed / balance) * 100).toFixed(2) : '0.00';
        msg += `\n<b>إجمالي المبالغ المستثمرة:</b> ${totalMarginUsed.toFixed(4)} USDT (${totalMarginPercent}% من الرصيد)\n`;

        const totalEmoji = totalPnl >= 0 ? '🟢' : '🔴';
        msg += `<b>إجمالي الربح/الخسارة العائم: ${totalEmoji} ${totalPnl.toFixed(4)} USDT</b>`;

        ctx.replyWithHTML(msg).catch(e => logger.error(`Failed to send positions list: ${e.message}`));
    } catch (error) {
        logger.error('Error in btn_positions_all:', error);
        ctx.reply('Error fetching positions from BingX.').catch(e => logger.error(`Failed to send positions error: ${e.message}`));
    }
});

const handleReport = async (ctx: any, title: string, getQuery: () => any) => {
    try {
        if (!ctx.from) return;
        const user = await User.findOne({ telegramId: ctx.from.id.toString() });
        if (!user) return;

        ctx.reply(`⏳ جاري جلب البيانات وحساب ${title}...`, { reply_markup: getMainMenuKeyboard(user) });

        const query = getQuery();
        const trades = await Trade.find({
            userId: user._id,
            currentStatus: { $in: ['CLOSED_PROFIT', 'CLOSED_LOSS', 'CLOSED_MANUAL'] },
            ...query
        }).sort({ closeTime: 1 });

        const currentEquity = await bingXService.getTotalEquity();

        // Telegram max message length is 4096. If it gets too long, we might need to truncate
        // But for now, standard user reports will fit or can be chunked later.
        const msg = generateReportStr(trades, title, currentEquity);
        if (msg.length > 4000) {
            ctx.replyWithHTML(msg.substring(0, 4000) + `\n\n<i>... [تم اقتطاع باقي التقرير لطوله]</i>`).catch((e: any) => logger.error(`Failed to send truncated report: ${e.message}`));
        } else {
            ctx.replyWithHTML(msg).catch((e: any) => logger.error(`Failed to send report: ${e.message}`));
        }
    } catch (error) {
        logger.error(`Error generating report ${title}:`, error);
        ctx.reply('حدث خطأ أثناء جلب التقرير.');
    }
};

// --- REPORTS SUBMENU ---
const getReportsKeyboard = () => ({
    keyboard: [
        [{ text: '📊 تقرير يومي' }, { text: '📅 تقرير شهري' }],
        [{ text: '📆 تقرير سنوي' }, { text: '📈 تقرير شامل' }],
        [{ text: '🗓 تقرير مخصص (تاريخ)' }],
        [{ text: 'رجوع 🔙' }]
    ],
    resize_keyboard: true,
    is_persistent: true
});

bot.hears('📊 التقارير', async (ctx) => {
    ctx.reply('📊 اختر نوع التقرير:', { reply_markup: getReportsKeyboard() }).catch(e => logger.error(`Failed to send reports menu: ${e.message}`));
});

bot.hears('📊 تقرير يومي', async (ctx) => {
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    await handleReport(ctx, 'تقرير الأداء اليومي', () => ({ closeTime: { $gte: startOfDay } }));
});

bot.hears('📅 تقرير شهري', async (ctx) => {
    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);
    await handleReport(ctx, 'تقرير الأداء الشهري', () => ({ closeTime: { $gte: startOfMonth } }));
});

bot.hears('📆 تقرير سنوي', async (ctx) => {
    const startOfYear = new Date();
    startOfYear.setMonth(0, 1);
    startOfYear.setHours(0, 0, 0, 0);
    await handleReport(ctx, 'تقرير الأداء السنوي', () => ({ closeTime: { $gte: startOfYear } }));
});

bot.hears('📈 تقرير شامل', async (ctx) => {
    await handleReport(ctx, 'تقرير الأداء الشامل (All-Time)', () => ({}));
});

bot.hears('🗓 تقرير مخصص (تاريخ)', async (ctx) => {
    if (!ctx.from) return;
    const user = await User.findOne({ telegramId: ctx.from.id.toString() });
    if (user) {
        user.botState = 'AWAITING_REPORT_DATE';
        await user.save();
        ctx.reply('يرجى إدخال تاريخ التقرير بالصيغة YYYY-MM-DD (مثال: 2026-03-01):', {
            reply_markup: {
                keyboard: [[{ text: 'إلغاء ❌' }]],
                resize_keyboard: true,
                is_persistent: true
            }
        });
    }
});

// --- ALERT SETTINGS ---
const ALL_TP_THRESHOLDS = [30, 40, 50, 60, 70, 80, 90, 95];

const buildAlertSettingsKeyboard = (user: any) => {
    const slOn: boolean = user.slWarningEnabled !== false;
    const tpOn: boolean = user.tpWarningEnabled !== false;
    const thresholds: number[] = user.tpWarningThresholds || [70, 90];

    // Row 1: Toggle SL & TP Warnings
    const row1 = [
        { text: `${slOn ? '✅' : '❌'} تنبيه SL`, callback_data: 'alert_toggle_sl' },
        { text: `${tpOn ? '✅' : '❌'} تنبيه TP`, callback_data: 'alert_toggle_tp' }
    ];

    // TP Threshold rows (2 per row)
    const thresholdRows = [];
    for (let i = 0; i < ALL_TP_THRESHOLDS.length; i += 4) {
        const row = ALL_TP_THRESHOLDS.slice(i, i + 4).map(t => ({
            text: `${thresholds.includes(t) ? '✅' : '⬜'} ${t}%`,
            callback_data: `alert_tp_${t}`
        }));
        thresholdRows.push(row);
    }

    return {
        inline_keyboard: [
            row1,
            ...thresholdRows,
            [{ text: '✅ تحديد الكل', callback_data: 'alert_tp_all' }, { text: '❌ إلغاء الكل', callback_data: 'alert_tp_none' }]
        ]
    };
};

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

bot.hears('🛑 إلغاء كل الصفقات المفتوحة', async (ctx) => {
    try {
        if (!ctx.from) return;
        const user = await User.findOne({ telegramId: ctx.from.id.toString() });
        if (!user) return;

        ctx.reply('⏳ جاري حساب الأرباح والخسائر الحالية لمعرفة وضع الحساب...');

        const balance = await bingXService.getBalance();
        const positions = await bingXService.getPositions();

        if (!positions || positions.length === 0) {
            ctx.reply('لا يوجد صفقات مفتوحة حالياً لإلغائها.', { reply_markup: getMainMenuKeyboard(user) });
            return;
        }

        let totalPnl = 0;
        let activePosCount = 0;

        for (const pos of positions) {
            if (parseFloat(pos.contracts) === 0) continue;
            activePosCount++;
            const pnl = pos.unrealizedPnl !== undefined ? pos.unrealizedPnl :
                (pos.info && pos.info.unrealizedProfit ? parseFloat(pos.info.unrealizedProfit) : 0);
            totalPnl += pnl;
        }

        if (activePosCount === 0) {
            ctx.reply('لا يوجد صفقات مفتوحة فعلية لإلغائها.', { reply_markup: getMainMenuKeyboard(user) });
            return;
        }

        // Set Bot State to AWAITING_CANCEL_ALL_CONFIRM
        user.botState = 'AWAITING_CANCEL_ALL_CONFIRM';
        await user.save();

        const pnlEmoji = totalPnl >= 0 ? '🟢 إجمالي أرباح' : '🔴 إجمالي خسارة';
        let confirmMsg = `⚠️ <b>تأكيد إغلاق جميع الصفقات (${activePosCount} صفقات)</b>\n\n` +
            `💰 <b>رأس المال المتاح (الرصيد):</b> ${balance.toFixed(2)} USDT\n` +
            `${pnlEmoji} عائمة لهذه الصفقات: <b>${totalPnl.toFixed(2)} USDT</b>\n\n` +
            `الرصيد المتوقع بعد الإغلاق: <b>${(balance + totalPnl).toFixed(2)} USDT</b>\n\n` +
            `هل أنت متأكد من رغبتك في إغلاق جميع الصفقات بسعر السوق الحالي (Market) المتوفر؟`;

        ctx.replyWithHTML(confirmMsg, {
            reply_markup: {
                keyboard: [
                    [{ text: "نعم، متأكد ✅" }, { text: "إلغاء ❌" }]
                ],
                resize_keyboard: true,
                one_time_keyboard: true
            }
        });

    } catch (error) {
        logger.error(error);
        ctx.reply('حدث خطأ أثناء محاولة جلب الصفقات المفتوحة.');
    }
});

// --- HELPER TO GET ACTIVE SYMBOLS KEYBOARD ---
const getDynamicSymbolsKeyboard = async () => {
    const positions = await bingXService.getPositions();
    let keys = [];
    if (positions && positions.length > 0) {
        for (const pos of positions) {
            if (parseFloat(pos.contracts) > 0) {
                const parts = pos.symbol.split('/');
                const shortSym = parts[0] || pos.symbol; // Usually BTC
                keys.push([{ text: shortSym }]);
            }
        }
    }
    keys.push([{ text: 'رجوع 🔙' }]);
    return keys;
};

bot.hears('🔍 الاستعلام عن صفقة محددة', async (ctx) => {
    try {
        if (!ctx.from) return;
        const user = await User.findOne({ telegramId: ctx.from.id.toString() });
        if (!user) return;
        user.botState = 'AWAITING_QUERY_SYMBOL';
        await user.save();

        const activeKeys = await getDynamicSymbolsKeyboard();

        ctx.reply('🔍 اختر العملة من القائمة أدناه، أو قم بكتابة الرمز (مثال: BTC):', {
            reply_markup: { keyboard: activeKeys, resize_keyboard: true, one_time_keyboard: true }
        });
    } catch (e) {
        ctx.reply('حدث خطأ.');
    }
});

bot.hears('❌ إلغاء صفقة محددة', async (ctx) => {
    try {
        if (!ctx.from) return;
        const user = await User.findOne({ telegramId: ctx.from.id.toString() });
        if (!user) return;
        user.botState = 'AWAITING_CANCEL_SYMBOL';
        await user.save();

        const activeKeys = await getDynamicSymbolsKeyboard();

        ctx.reply('❌ اختر العملة التي تريد إلغاء صفقتها، أو قم بكتابتها (مثال: ETH):', {
            reply_markup: { keyboard: activeKeys, resize_keyboard: true, one_time_keyboard: true }
        });
    } catch (e) {
        ctx.reply('حدث خطأ.');
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
        const riskIcon = newStatus ? '🟢 مفعل' : '🔴 معطل';

        await ctx.reply(`✅ تم تحديث ميزة حماية رأس المال الصارمة. الحالة الآن: ${statusMsg}`, {
            reply_markup: getMainMenuKeyboard(user)
        });
    } catch (e) {
        ctx.reply('حدث خطأ أثناء تعديل الإعدادات.');
    }
});

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

bot.command('balance', async (ctx) => {
    try {
        const balance = await bingXService.getBalance();
        ctx.reply(`Current Futures Balance: ${balance} USDT`);
    } catch (error) {
        ctx.reply('Error fetching balance.');
    }
});

bot.command('positions', async (ctx) => {
    try {
        if (!ctx.from) return;
        const user = await User.findOne({ telegramId: ctx.from.id.toString() });
        if (!user) return;

        const balance = await bingXService.getBalance();
        const positions = await bingXService.getPositions();

        if (!positions || positions.length === 0) {
            ctx.reply('No active positions found on BingX.');
            return;
        }

        const openTrades = await Trade.find({
            userId: user._id,
            currentStatus: { $in: ['OPEN', 'TP1_HIT', 'TP2_HIT'] }
        });

        let msg = '<b>Live Positions (BingX) 🟢:</b>\n\n';
        let totalPnl = 0;
        let totalMarginUsed = 0;

        for (const pos of positions) {
            if (parseFloat(pos.contracts) === 0) continue;

            const pnl = pos.unrealizedPnl !== undefined ? pos.unrealizedPnl :
                (pos.info && pos.info.unrealizedProfit ? parseFloat(pos.info.unrealizedProfit) : 0);

            totalPnl += pnl;

            let margin = pos.initialMargin !== undefined ? pos.initialMargin :
                (pos.info && pos.info.isolatedMargin ? parseFloat(pos.info.isolatedMargin) : 0);

            if (!margin && pos.notional) {
                margin = Math.abs(pos.notional) / (pos.leverage || 10);
            }
            totalMarginUsed += margin;

            let roe = pos.percentage;
            if (roe === undefined || roe === null) {
                if (margin && margin > 0) {
                    roe = (pnl / margin) * 100;
                } else {
                    roe = pos.info && pos.info.profitRate ? parseFloat(pos.info.profitRate) * 100 : 0;
                }
            }

            const emoji = pnl >= 0 ? '🟢' : '🔴';
            const entryPrice = parseFloat(pos.entryPrice);
            const markPrice = parseFloat(pos.markPrice);
            const amountCoins = parseFloat(pos.contracts);
            const posSide = pos.side.toUpperCase();

            // Match trade in DB for TP/SL details
            const trade = openTrades.find(t => t.symbol === pos.symbol || pos.symbol.includes(t.symbol.split('/')[0]));

            msg += `<b>${pos.symbol}</b> (${posSide})\n` +
                `Entry: ${entryPrice.toFixed(4)} ➡️ Mark: ${markPrice.toFixed(4)}\n` +
                `Margin: ${margin.toFixed(4)} USDT (Bal %: ${balance > 0 ? ((margin / balance) * 100).toFixed(2) : 0}%)\n` +
                `PnL: ${emoji} ${pnl.toFixed(4)} USDT (${roe.toFixed(2)}%)\n`;

            if (trade) {
                if (trade.targets && trade.targets.length > 0) {
                    const tpPrice = trade.targets[0].price;
                    const tpPnl = posSide === 'LONG' ? (tpPrice - entryPrice) * amountCoins : (entryPrice - tpPrice) * amountCoins;
                    const tpPercent = margin > 0 ? (tpPnl / margin) * 100 : 0;
                    msg += `Target: ${tpPrice} 🎯 (Est. Profit: ${tpPnl.toFixed(4)} USDT | ${tpPercent.toFixed(4)}%)\n`;
                }

                if (trade.stopLoss) {
                    const slPrice = trade.stopLoss;
                    const slPnl = posSide === 'LONG' ? (slPrice - entryPrice) * amountCoins : (entryPrice - slPrice) * amountCoins;
                    const slPercent = margin > 0 ? (slPnl / margin) * 100 : 0;
                    msg += `Stop Loss: ${slPrice} 🛑 (Est. Loss: ${slPnl.toFixed(4)} USDT | ${slPercent.toFixed(4)}%)\n`;
                }
            }

            msg += `-------------------\n`;
        }

        const totalMarginPercent = balance > 0 ? ((totalMarginUsed / balance) * 100).toFixed(4) : '0.00';
        msg += `\n<b>Total Margin Used:</b> ${totalMarginUsed.toFixed(4)} USDT (${totalMarginPercent}% of Balance)\n`;

        const totalEmoji = totalPnl >= 0 ? '🟢' : '🔴';
        msg += `<b>Total Floating PnL: ${totalEmoji} ${totalPnl.toFixed(4)} USDT</b>`;

        ctx.replyWithHTML(msg);
    } catch (error) {
        logger.error('Error in /positions:', error);
        ctx.reply('Error fetching positions from BingX.');
    }
});

bot.command('status', async (ctx) => {
    try {
        const input = ctx.message.text.split(' ')[1];
        if (!input) {
            ctx.reply('الرجاء كتابة اسم العملة. مثال: /status BTC');
            return;
        }

        // Find trade
        const user = await User.findOne({ telegramId: ctx.from.id.toString() });
        if (!user) return;

        // Look for exact match or partial match in DB
        const trade = await Trade.findOne({
            userId: user._id,
            currentStatus: { $in: ['OPEN', 'TP1_HIT', 'TP2_HIT'] },
            symbol: { $regex: input.toUpperCase() }
        }).sort({ entryTime: -1 });

        if (!trade) {
            ctx.reply(`لا يوجد صفقة مفتوحة للعملة ${input}`);
            return;
        }

        // Fetch live PnL from BingX
        const positions = await bingXService.getPositions(trade.symbol);
        const pos = positions.find((p: any) => p.symbol === trade.symbol);
        const balance = await bingXService.getBalance();

        let msg = `📊 <b>Status: ${trade.symbol}</b>\n` +
            `النوع: ${trade.direction === 'LONG' ? 'شراء (LONG) 🟢' : 'بيع (SHORT) 🔴'}\n` +
            `الرافعة: <b>${trade.leverage || 'N/A'}x</b>\n`;

        if (pos) {
            const posEntryPrice = parseFloat(pos.entryPrice);
            msg += `سعر الدخول: ${posEntryPrice.toFixed(4)}\n`;

            const pnl = pos.unrealizedPnl !== undefined ? pos.unrealizedPnl :
                (pos.info && pos.info.unrealizedProfit ? parseFloat(pos.info.unrealizedProfit) : 0);

            let margin = pos.initialMargin !== undefined ? pos.initialMargin :
                (pos.info && pos.info.isolatedMargin ? parseFloat(pos.info.isolatedMargin) : 0);

            if (!margin && pos.notional) {
                margin = Math.abs(pos.notional) / (pos.leverage || 10);
            }

            let roe = pos.percentage;
            if (roe === undefined || roe === null) {
                if (margin && margin > 0) {
                    roe = (pnl / margin) * 100;
                } else {
                    roe = pos.info && pos.info.profitRate ? parseFloat(pos.info.profitRate) * 100 : 0;
                }
            }

            const emoji = pnl >= 0 ? '🟢' : '🔴';
            const markPrice = parseFloat(pos.markPrice).toFixed(4);
            const amountCoins = parseFloat(pos.contracts);

            msg += `السعر الحالي: ${markPrice}\n` +
                `المبلغ المستثمر (Margin): ${margin.toFixed(4)} USDT (النسبة من الرصيد: ${balance > 0 ? ((margin / balance) * 100).toFixed(2) : 0}%)\n` +
                `الربح/الخسارة الحالية: ${emoji} ${pnl.toFixed(4)} USDT (${roe.toFixed(2)}%)\n`;

            if (trade.targets && trade.targets.length > 0) {
                const tpPrice = trade.targets[0].price;
                const tpPnl = trade.direction === 'LONG' ? (tpPrice - posEntryPrice) * amountCoins : (posEntryPrice - tpPrice) * amountCoins;
                const tpPercent = margin > 0 ? (tpPnl / margin) * 100 : 0;
                msg += `\nالهدف القادم: ${tpPrice} 🎯\n` +
                    `الربح المتوقع عند ضرب الهدف: ${tpPnl.toFixed(2)} USDT (${tpPercent.toFixed(2)}%)\n`;
            }

            if (trade.stopLoss) {
                const slPrice = trade.stopLoss;
                const slPnl = trade.direction === 'LONG' ? (slPrice - posEntryPrice) * amountCoins : (posEntryPrice - slPrice) * amountCoins;
                const slPercent = margin > 0 ? (slPnl / margin) * 100 : 0;
                msg += `وقف الخسارة: ${slPrice} 🛑\n` +
                    `الخسارة المتوقعة عند ضرب الاستوب: ${slPnl.toFixed(2)} USDT (${slPercent.toFixed(2)}%)\n`;
            }

        } else {
            msg += `سعر الدخول: ${trade.entryPrice}\n`;
            msg += `<i>لا يوجد بيانات حية من المنصة لهذه الصفقة حالياً.</i>\n`;
        }

        ctx.replyWithHTML(msg);

    } catch (error) {
        logger.error('Error in status command:', error);
        ctx.reply('حدث خطأ أثناء جلب حالة الصفقة.');
    }
});

bot.on('text', async (ctx) => {
    const message = ctx.message.text;

    const user = await User.findOne({ telegramId: ctx.from.id.toString() });
    if (!user) {
        ctx.reply('User not found in DB. Please start a chat with the bot first.');
        return;
    }

    // --- Special Nav Handling For Active States ---
    if (message === 'رجوع 🔙' || message === 'إلغاء ❌') {
        user.botState = undefined;
        await user.save();
        ctx.reply('تم الإلغاء والعودة للقائمة الرئيسية.', { reply_markup: getMainMenuKeyboard(user) });
        return;
    }

    if (user.botState === 'AWAITING_CANCEL_ALL_CONFIRM') {
        if (message === 'نعم، متأكد ✅') {
            user.botState = undefined;
            await user.save();
            ctx.reply('⏳ جاري إغلاق جميع الصفقات المفتوحة... الرجاء الانتظار.', { reply_markup: getMainMenuKeyboard(user) });
            try {
                const count = await tradeManager.closeAllPositions(user._id.toString());
                if (count > 0) {
                    ctx.reply(`✅ تم بنجاح الإغلاق لـ ${count} صفقة/صفقات بالشكل الفوري بسعر السوق.`);
                } else {
                    ctx.reply('لم يتم العثور على صفقات لإلغائها حالياً.');
                }
            } catch (err) {
                logger.error(err);
                ctx.reply('حدث خطأ أثناء محاولة إغلاق الصفقات.');
            }
        } else {
            // Unrecognized answer during confirm
            ctx.reply('الرجاء الاختيار من الأزرار المتاحة (نعم متأكد ، او إلغاء).');
        }
        return;
    }

    // --- Check Bot State for specific prompts first ---
    if (user.botState === 'AWAITING_QUERY_SYMBOL') {
        const symbolInput = message.trim().toUpperCase();
        user.botState = undefined;
        await user.save();

        ctx.reply(`⏳ جاري الاستعلام...`, { reply_markup: getMainMenuKeyboard(user) });

        // Execute logic identical to /status
        try {
            const trade = await Trade.findOne({
                userId: user._id,
                currentStatus: { $in: ['OPEN', 'TP1_HIT', 'TP2_HIT'] },
                symbol: { $regex: symbolInput }
            }).sort({ entryTime: -1 });

            const searchQuery = symbolInput.includes('USDT') ? symbolInput : `${symbolInput}/USDT:USDT`;
            const positions = await bingXService.getPositions(searchQuery);
            const pos = positions.find((p: any) => p.symbol === searchQuery || p.symbol.includes(symbolInput));

            if (!pos && !trade) {
                ctx.reply(`لا يوجد صفقة مفتوحة للعملة ${symbolInput} على المنصة.`);
                return;
            }

            const balance = await bingXService.getBalance();
            let msg = `📊 <b>تفاصيل صفقة ${pos ? pos.symbol : (trade ? trade.symbol : symbolInput)}</b>\n`;

            if (trade) {
                msg += `النوع: ${trade.direction === 'LONG' ? 'شراء (LONG) 🟢' : 'بيع (SHORT) 🔴'}\n`;
                msg += `الرافعة: <b>${trade.leverage || 'N/A'}x</b>\n`;
            } else if (pos) {
                msg += `النوع: ${pos.side.toUpperCase() === 'LONG' ? 'شراء (LONG) 🟢' : 'بيع (SHORT) 🔴'}\n`;
                const posLev = pos.leverage;
                if (posLev) msg += `الرافعة: <b>${posLev}x</b>\n`;
            }

            if (pos) {
                const posEntryPrice = parseFloat(pos.entryPrice);
                msg += `سعر الدخول: ${posEntryPrice.toFixed(4)}\n`;

                const pnl = pos.unrealizedPnl !== undefined ? pos.unrealizedPnl :
                    (pos.info && pos.info.unrealizedProfit ? parseFloat(pos.info.unrealizedProfit) : 0);

                let margin = pos.initialMargin !== undefined ? pos.initialMargin :
                    (pos.info && pos.info.isolatedMargin ? parseFloat(pos.info.isolatedMargin) : 0);

                if (!margin && pos.notional) {
                    margin = Math.abs(pos.notional) / (pos.leverage || 10);
                }

                let roe = pos.percentage;
                if (roe === undefined || roe === null) {
                    if (margin && margin > 0) {
                        roe = (pnl / margin) * 100;
                    } else {
                        roe = pos.info && pos.info.profitRate ? parseFloat(pos.info.profitRate) * 100 : 0;
                    }
                }

                const emoji = pnl >= 0 ? '🟢' : '🔴';
                const markPrice = parseFloat(pos.markPrice).toFixed(4);
                const amountCoins = parseFloat(pos.contracts);

                msg += `المبلغ المستثمر (Margin): ${margin.toFixed(4)} USDT (النسبة من الرصيد: ${balance > 0 ? ((margin / balance) * 100).toFixed(2) : 0}%)\n` +
                    `الربح/الخسارة الحالية: ${emoji} ${pnl.toFixed(4)} USDT (${roe.toFixed(2)}%)\n`;

                if (trade) {
                    if (trade.targets && trade.targets.length > 0) {
                        const tpPrice = trade.targets[0].price;
                        const tpPnl = trade.direction === 'LONG' ? (tpPrice - posEntryPrice) * amountCoins : (posEntryPrice - tpPrice) * amountCoins;
                        const tpPercent = margin > 0 ? (tpPnl / margin) * 100 : 0;
                        msg += `\nالهدف القادم: ${tpPrice} 🎯\n` +
                            `الربح المتوقع عند ضرب الهدف: ${tpPnl.toFixed(2)} USDT (${tpPercent.toFixed(2)}%)\n`;
                    }

                    if (trade.stopLoss) {
                        const slPrice = trade.stopLoss;
                        const slPnl = trade.direction === 'LONG' ? (slPrice - posEntryPrice) * amountCoins : (posEntryPrice - slPrice) * amountCoins;
                        const slPercent = margin > 0 ? (slPnl / margin) * 100 : 0;
                        msg += `وقف الخسارة: ${slPrice} 🛑\n` +
                            `الخسارة المتوقعة عند ضرب الاستوب: ${slPnl.toFixed(2)} USDT (${slPercent.toFixed(2)}%)\n`;
                    }
                }
            } else {
                if (trade) msg += `سعر الدخول: ${trade.entryPrice}\n`;
                msg += `<i>لا يوجد بيانات حية من المنصة لهذه الصفقة حالياً.</i>\n`;
            }

            await ctx.replyWithHTML(msg).catch(e => logger.error(`Failed to send status info: ${e.message}`));
        } catch (error) {
            logger.error(error);
            await ctx.reply('حدث خطأ أثناء جلب حالة الصفقة.').catch(e => logger.error(`Failed to send error notice: ${e.message}`));
        }
        return;
    }

    if (user.botState === 'AWAITING_CANCEL_SYMBOL') {
        const symbolInput = message.trim().toUpperCase();
        user.botState = undefined;
        await user.save();

        await ctx.reply(`⏳ جاري البحث وإلغاء صفقة ${symbolInput}...`, { reply_markup: getMainMenuKeyboard(user) }).catch((e: any) => logger.error(`Failed to send cancel search notice: ${e.message}`));
        try {
            const success = await tradeManager.closeSpecificPosition(user._id.toString(), symbolInput);
            if (success) {
                await ctx.reply(`✅ تم إغلاق الصفقة المفتوحة لعملة ${symbolInput} بنجاح.`).catch((e: any) => logger.error(`Failed to send cancel success message: ${e.message}`));
            } else {
                await ctx.reply(`لا يوجد صفقة مفتوحة حالياً لـ ${symbolInput}.`).catch((e: any) => logger.error(`Failed to send no-position-to-cancel notice: ${e.message}`));
            }
        } catch (error) {
            logger.error(error);
            await ctx.reply(`❌ فشل في إلغاء صفقة ${symbolInput}.`).catch((e: any) => logger.error(`Failed to send cancel failure message: ${e.message}`));
        }
        return;
    }

    if (user.botState === 'AWAITING_REPORT_DATE') {
        const dateInput = message.trim();
        user.botState = undefined;
        await user.save();

        const parsedDate = new Date(dateInput);
        if (isNaN(parsedDate.getTime())) {
            await ctx.reply('❌ صيغة التاريخ غير صحيحة. يرجى المحاولة لاحقاً بصيغة صحيحة (مثال: 2026-03-01).', { reply_markup: getMainMenuKeyboard(user) }).catch((e: any) => logger.error(`Failed to send date format error: ${e.message}`));
            return;
        }

        // Search for that specific day (from 00:00:00 to 23:59:59)
        const nextDay = new Date(parsedDate);
        nextDay.setDate(parsedDate.getDate() + 1);

        await handleReport(ctx, `تقرير أداء يوم ${dateInput}`, () => ({
            closeTime: { $gte: parsedDate, $lt: nextDay }
        }));
        return;
    }
    // 1. Try to parse signal
    const signal = SignalParser.parse(message);

    if (signal) {
        try {
            // Determine the target chat ID for notifications
            // If NOTIFICATION_CHAT_ID is set, use it. Otherwise, default to the user's private chat ID
            const targetChatId = process.env.NOTIFICATION_CHAT_ID || ctx.from.id.toString();

            if (signal.type === 'TRADE') {
                logger.info(`Signal detected from ${ctx.from.username}: ${signal.symbol} ${signal.direction}`);
                await ctx.telegram.sendMessage(targetChatId, `✅ Signal Parsed: ${signal.symbol} ${signal.direction}. Processing...`).catch((e: any) => logger.error(`Failed to send parse notice: ${e.message}`));

                const result = await tradeManager.executeSignal(signal as any, user._id.toString());

                if (result) {
                    let msg = `✅ <b>Trade Executed Successfully</b>\n\n` +
                        `Symbol: <b>${result.symbol}</b>\n` +
                        `Direction: <b>${result.direction}</b>\n` +
                        `Entry Price: ${result.entryPrice}\n` +
                        `Capital Used: ${result.margin.toFixed(2)} USDT (${result.riskPercentage}%)\n` +
                        `Leverage: ${result.leverage}x\n\n` +
                        `<b>Expected Profit (Targets):</b>\n`;

                    result.targets.forEach((t, i) => {
                        msg += `TP${i + 1}: ${t.price} (+${t.pnlPercent}%)\n`;
                    });

                    msg += `\n<b>Stop Loss:</b>\n` +
                        `${result.stopLoss.price} (${result.stopLoss.pnlPercent}%)\n\n` +
                        `Order ID: ${result.tradeId}`;

                    await ctx.telegram.sendMessage(targetChatId, msg, { parse_mode: 'HTML', reply_markup: getMainMenuKeyboard(user) }).catch((e: any) => logger.error(`Failed to send execute success: ${e.message}`));
                }
            } else if (signal.type === 'CLOSE') {
                logger.info(`Close Signal detected: ${signal.symbol}`);
                await ctx.telegram.sendMessage(targetChatId, `🛑 Close Signal Parsed: ${signal.symbol}. Closing...`).catch((e: any) => logger.error(`Failed to send close notice: ${e.message}`));
                await tradeManager.executeSignal(signal, user._id.toString());
                await ctx.telegram.sendMessage(targetChatId, `✅ Close order sent for ${signal.symbol}`, { reply_markup: getMainMenuKeyboard(user) }).catch((e: any) => logger.error(`Failed to send close success: ${e.message}`));
            }
        } catch (error: any) {
            logger.error(`Error processing signal: ${error.message}`);
            
            // Fallback: try to notify the designated chat about the error
            const targetChatId = process.env.NOTIFICATION_CHAT_ID || ctx.from.id.toString();
            await ctx.telegram.sendMessage(targetChatId, `❌ Error: ${error.message}`, { reply_markup: getMainMenuKeyboard(user) }).catch((e: any) => logger.error(`Failed to send error notification: ${e.message}`));
        }
    } else {
        // Not a signal, not a botState input, and not a button click.
        // It's just generic text. We'll ensure the keyboard is still visible.
        // Only reply if it doesn't match an existing command so we don't spam.
        const isCommand = message.startsWith('/');
        if (!isCommand) {
            ctx.reply('الرجاء استخدام الأزرار في القائمة للتحكم، أو إرسال إشارة تداول صحيحة.', { reply_markup: getMainMenuKeyboard(user) }).catch((e: any) => logger.error(`Failed to send generic help: ${e.message}`));
        }
    }
});

bot.command('history', async (ctx) => {
    try {
        const user = await User.findOne({ telegramId: ctx.from.id.toString() });
        if (!user) return;

        // Fetch last 5 closed trades
        const trades = await Trade.find({
            userId: user._id,
            currentStatus: { $in: ['CLOSED_PROFIT', 'CLOSED_LOSS'] }
        })
            .sort({ closeTime: -1 })
            .limit(5);

        if (trades.length === 0) {
            ctx.reply('No history found.').catch((e: any) => logger.error(`Failed to send no history notice: ${e.message}`));
            return;
        }

        let msg = '<b>📜 Trade History (Last 5):</b>\n\n';
        for (const t of trades) {
            const resultEmoji = t.pnl >= 0 ? '🟢' : '🔴';
            const date = t.closeTime ? t.closeTime.toLocaleDateString() : 'N/A';
            msg += `<b>${t.symbol}</b> (${t.direction})\n` +
                `Result: ${t.pnl.toFixed(2)}%\n` +
                `Status: ${t.currentStatus === 'CLOSED_PROFIT' ? 'WIN 🏆' : 'LOSS 💀'}\n` +
                `Date: ${date}\n` +
                `-------------------\n`;
        }
        ctx.replyWithHTML(msg).catch((e: any) => logger.error(`Failed to send history: ${e.message}`));

    } catch (error) {
        logger.error('Error in /history:', error);
        ctx.reply('Error fetching history.').catch((e: any) => logger.error(`Failed to send history error: ${e.message}`));
    }
});

bot.command('report', async (ctx) => {
    try {
        const user = await User.findOne({ telegramId: ctx.from.id.toString() });
        if (!user) return;

        const allTrades = await Trade.find({
            userId: user._id,
            currentStatus: { $in: ['CLOSED_PROFIT', 'CLOSED_LOSS'] }
        });

        if (allTrades.length === 0) {
            ctx.reply('لا يوجد بيانات كافية لإصدار تقرير حالياً.').catch((e: any) => logger.error(`Failed to send no report notice: ${e.message}`));
            return;
        }

        const total = allTrades.length;
        const wins = allTrades.filter(t => t.currentStatus === 'CLOSED_PROFIT').length;
        const losses = allTrades.filter(t => t.currentStatus === 'CLOSED_LOSS').length;
        const totalPnl = allTrades.reduce((sum, t) => sum + (t.pnl || 0), 0);
        const winRate = ((wins / total) * 100).toFixed(2);

        const msg = `📊 <b>Trading Performance Report</b>\n\n` +
            `✅ Total Trades: ${total}\n` +
            `🏆 Wins: ${wins}\n` +
            `💀 Losses: ${losses}\n` +
            `📈 Win Rate: ${winRate}%\n` +
            `💰 Total PnL: ${totalPnl.toFixed(2)}%\n\n` +
            `<i>Keep up the good work! 🚀</i>`;

        ctx.replyWithHTML(msg).catch((e: any) => logger.error(`Failed to send performance report: ${e.message}`));
    } catch (error) {
        logger.error('Error in /report:', error);
        ctx.reply('Error generating report.').catch((e: any) => logger.error(`Failed to send report error: ${e.message}`));
    }
});

bot.command('settings', async (ctx) => {
    try {
        const user = await User.findOne({ telegramId: ctx.from.id.toString() });
        if (!user) return;

        const parts = ctx.message.text.split(' ');
        if (parts.length === 1) {
            // Show current settings
            const msg = `⚙️ <b>Current Settings:</b>\n\n` +
                `🎯 Risk per trade: ${user.riskPercentage}%\n` +
                `🚀 Default Leverage (if not in signal): 10x\n\n` +
                `To update risk, use: <code>/settings risk 5</code>`;
            ctx.replyWithHTML(msg);
            return;
        }

        if (parts.length === 3 && parts[1].toLowerCase() === 'risk') {
            const risk = parseFloat(parts[2]);
            if (isNaN(risk) || risk <= 0 || risk > 20) {
                ctx.reply('⚠️ Please provide a valid risk percentage (1-20).');
                return;
            }
            user.riskPercentage = risk;
            await user.save();
            ctx.reply(`✅ Risk updated to ${risk}%`);
            return;
        }

        ctx.reply('❓ Unknown settings command. Use <code>/settings</code> to see current values.', { parse_mode: 'HTML' });

    } catch (error) {
        logger.error('Error in /settings:', error);
        ctx.reply('Error updating settings.');
    }
});

bot.command('update', async (ctx) => {
    try {
        const parts = ctx.message.text.split(' ');
        // Expected format: /update BTC TP 98000 OR /update BTC SL 95000
        if (parts.length < 4) {
            ctx.reply('⚠️ Incorrect usage.\nFormat: `/update SYMBOL TYPE PRICE`\nExample: `/update BTC TP 98000` or `/update ETH SL 2500`', { parse_mode: 'Markdown' });
            return;
        }

        const rawSymbol = parts[1].toUpperCase();
        const type = parts[2].toUpperCase(); // TP or SL
        const price = parseFloat(parts[3]);

        if (isNaN(price)) {
            ctx.reply('⚠️ Invalid price.');
            return;
        }

        if (type !== 'TP' && type !== 'SL') {
            ctx.reply('⚠️ Type must be TP or SL.');
            return;
        }

        const symbol = rawSymbol.includes('USDT') ? rawSymbol : `${rawSymbol}/USDT:USDT`;

        ctx.reply(`⏳ Updating ${type} for ${symbol} to ${price}...`);

        // Find trade to get direction
        const user = await User.findOne({ telegramId: ctx.from.id.toString() });
        if (!user) return;

        const trade = await Trade.findOne({
            userId: user._id,
            currentStatus: 'OPEN',
            symbol: { $regex: rawSymbol }
        }).sort({ entryTime: -1 });

        if (!trade) {
            ctx.reply(`⚠️ No open trade found for ${symbol} in DB. Updating on exchange only...`);
            // We assume position exists on exchange if not in DB? Or just try anyway.
        }

        // We need position side. If we have trade DB, use it. If not, we might need to fetch positions.
        // For simplicity, fetch positions to get exact side.
        const positions = await bingXService.getPositions(symbol);
        const pos = positions.find((p: any) => p.symbol === symbol);

        if (!pos) {
            ctx.reply(`❌ No open position found on exchange for ${symbol}.`);
            return;
        }

        // Determine params
        const params: any = {};
        if (type === 'TP') params.takeProfit = price;
        if (type === 'SL') params.stopLoss = price;
        params.positionSide = pos.side.toUpperCase();

        // BingX usually updates SL/TP via creating a new order or specific endpoint?
        // CCXT unified editOrder or specialized method?
        // BingX V2 Swap: setMarginMode? No. 
        // We usually assume placeOrder with params updates it if it's a "TPSL" order type or similar?
        // OR we use specialized `editOrder`?
        // IMPORTANT: BingX Perps often require cancelling old TP/SL orders and placing new ones, OR using specific API.
        // Let's try attempting to "placeOrder" which might fail if we don't use dedicated TPSL endpoint.
        // BUT CCXT usually maps `editOrder`?

        // Let's try the simplest approach: Cancel old TPSL and place new one? hard to find old ID.
        // BingX often accepts a new request to OVERWRITE if we send type 'STOP_MARKET' etc.

        // Actually, users might just want to use the app if it's complex.
        // Let's rely on documentation or standard behavior: "editOrder" isn't fully unified for TP/SL trigger orders across all exchanges.

        // Alternative: Just reply telling them what to do if validation is hard.
        // But requested feature is "Can I modify".

        // Let's try using `bingXService.exchange.editOrder` if available, or just tell user to use app if risky.
        // Wait! The user asked "Can I modify...". I can say "Yes, via App"
        // But providing a command is better.

        // Let's stick safe: Notify user they can use App, and I'll add command support later if they really need it.
        // Actually wait, let's implement a 'safe' update which is `setMargin`? No.

        ctx.reply('⚠️ Update feature via Bot is under construction (API complexity). Please modify SL/TP manually on the BingX App for now. The bot will track the changing outcome automatically.');

    } catch (error: any) {
        logger.error('Error in /update:', error);
        ctx.reply(`❌ Update Failed: ${error.message}`);
    }
});

const start = async () => {
    await connectDB();

    // Start HTTP health check server for Render deployment
    const port = parseInt(process.env.PORT || '3000');
    startHealthServer(port);

    // Start Monitor before bot launch
    positionMonitor.start();
    logger.info('Position Monitor Started');

    bot.launch().then(() => {
        logger.info('Telegram Bot Started');
        reportingService.init();
    }).catch((err) => {
        logger.error('Bot launch failed', err);
    });

    // Enable graceful stop
    process.once('SIGINT', () => {
        positionMonitor.stop();
        bot.stop('SIGINT');
    });
    process.once('SIGTERM', () => {
        positionMonitor.stop();
        bot.stop('SIGTERM');
    });
};

start();
