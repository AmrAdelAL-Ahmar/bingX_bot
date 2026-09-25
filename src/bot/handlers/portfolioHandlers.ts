import { Telegraf } from 'telegraf';
import logger from '../../utils/logger';
import { BingXService } from '../../services/BingXService';
import User from '../../models/User';
import Trade from '../../models/Trade';
import { TradeManager } from '../../services/TradeManager';
import { getMainMenuKeyboard } from '../keyboards/baseKeyboards';
import { buildNumpadKeyboard } from '../menus/settingsMenu';

export const registerPortfolioHandlers = (bot: Telegraf, bingXService: BingXService) => {
    const tradeManager = new TradeManager(bingXService);

    // --- HELPER: GET BALANCE MESSAGE & KEYBOARD ---
    const getBalanceInfo = async () => {
        const balance = await bingXService.getBalance();
        let msg = `💰 <b>تفاصيل الحساب والأرصدة (BingX Live):</b>\n\n`;
        msg += `• الرصيد المتاح (USDT): <b>${balance.toFixed(2)} USDT</b>\n`;

        const positions = await bingXService.getPositions();
        let totalPnl = 0;
        let activeCount = 0;

        if (positions && positions.length > 0) {
            for (const pos of positions) {
                if (parseFloat(pos.contracts) === 0) continue;
                const pnl = pos.unrealizedPnl !== undefined ? pos.unrealizedPnl :
                    (pos.info && pos.info.unrealizedProfit ? parseFloat(pos.info.unrealizedProfit) : 0);
                totalPnl += pnl;
                activeCount++;
            }
            const pnlEmoji = totalPnl >= 0 ? '🟢' : '🔴';
            msg += `• الصفقات المفتوحة حالياً: <b>${activeCount} صفقات</b>\n`;
            msg += `• الأرباح/الخسائر غير المحققة: ${pnlEmoji} <b>${totalPnl.toFixed(2)} USDT</b>\n`;
        } else {
            msg += `• لا توجد صفقات مفتوحة حالياً.\n`;
        }
        return { msg, balance };
    };

    // --- HELPER: GET OPEN POSITIONS DETAILS & KEYBOARD ---
    const getOpenPositionsInfo = async (telegramId: string) => {
        const user = await User.findOne({ telegramId });
        if (!user) throw new Error('User not found');

        const balance = await bingXService.getBalance();
        const positions = await bingXService.getPositions();

        if (!positions || positions.length === 0) {
            return {
                msg: '💼 <b>صفقاتي المفتوحة (BingX Live)</b>\n\n📭 لا توجد صفقات مفتوحة حالياً في حسابك.',
                keyboard: {
                    inline_keyboard: [
                        [{ text: '🔄 تحديث الصفحة', callback_data: 'menu_positions' }],
                        [{ text: '🔙 القائمة الرئيسية', callback_data: 'menu_open' }]
                    ]
                }
            };
        }

        const openTrades = await Trade.find({
            currentStatus: { $in: ['OPEN', 'TP1_HIT', 'TP2_HIT'] }
        });

        let msg = '💼 <b>صفقاتي المفتوحة (BingX Live) 🟢:</b>\n\n';
        let totalPnl = 0;
        let totalMarginUsed = 0;
        const inlineKeyboardRows: any[] = [];

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

            const trade = openTrades.find(t => t.symbol === pos.symbol || pos.symbol.includes(t.symbol.split('/')[0]));
            const leverage = pos.leverage || (trade ? trade.leverage : null) || 'N/A';
            const cleanSym = pos.symbol.split('/')[0];

            msg += `<b>${pos.symbol}</b> (${posSide}) | الرافعة: <b>${leverage}x</b>\n` +
                `الدخول: ${entryPrice.toFixed(4)} ➡️ الحالي: ${markPrice.toFixed(4)}\n` +
                `الهامش (Margin): ${margin.toFixed(2)} USDT (${balance > 0 ? ((margin / balance) * 100).toFixed(1) : 0}%)\n` +
                `الأرباح: ${emoji} <b>${pnl.toFixed(2)} USDT</b> (<b>${roe.toFixed(2)}%</b>)\n`;

            if (trade) {
                if (trade.targets && trade.targets.length > 0) {
                    const tpPrice = trade.targets[0].price;
                    const tpPnl = posSide === 'LONG' ? (tpPrice - entryPrice) * amountCoins : (entryPrice - tpPrice) * amountCoins;
                    const tpPercent = margin > 0 ? (tpPnl / margin) * 100 : 0;
                    msg += `🎯 الهدف القادم: ${tpPrice} (الربح: +${tpPnl.toFixed(2)} USDT | ${tpPercent.toFixed(1)}%)\n`;
                }
                if (trade.stopLoss) {
                    const slPrice = trade.stopLoss;
                    const slPnl = posSide === 'LONG' ? (slPrice - entryPrice) * amountCoins : (entryPrice - slPrice) * amountCoins;
                    const slPercent = margin > 0 ? (slPnl / margin) * 100 : 0;
                    msg += `🛑 وقف الخسارة: ${slPrice} (الخسارة: ${slPnl.toFixed(2)} USDT | ${slPercent.toFixed(1)}%)\n`;
                }
            }

            msg += `-------------------\n`;

            // Add interactive control rows for this position
            inlineKeyboardRows.push([
                { text: `🚨 تصفية ${cleanSym}`, callback_data: `pos_close_${cleanSym}` },
                { text: `🔒 تأمين ${cleanSym}`, callback_data: `pos_be_${cleanSym}` },
                { text: `🔄 تعديل الستوب`, callback_data: `pos_sl_${cleanSym}` }
            ]);
        }

        const totalMarginPercent = balance > 0 ? ((totalMarginUsed / balance) * 100).toFixed(1) : '0.0';
        msg += `\n<b>إجمالي الهامش المستخدم:</b> ${totalMarginUsed.toFixed(2)} USDT (${totalMarginPercent}%)\n`;
        const totalEmoji = totalPnl >= 0 ? '🟢' : '🔴';
        msg += `<b>إجمالي الأرباح/الخسائر العائمة: ${totalEmoji} ${totalPnl.toFixed(2)} USDT</b>`;

        inlineKeyboardRows.push([
            { text: '🔄 تحديث الصفقات', callback_data: 'menu_positions' },
            { text: '🔙 القائمة الرئيسية', callback_data: 'menu_open' }
        ]);

        return {
            msg,
            keyboard: { inline_keyboard: inlineKeyboardRows }
        };
    };

    // --- TELEGRAM HEARS REGISTRATIONS ---

    bot.hears('💰 رصيدي وملخص الأرباح', async (ctx) => {
        try {
            const { msg } = await getBalanceInfo();
            ctx.replyWithHTML(msg, {
                reply_markup: {
                    inline_keyboard: [
                        [{ text: '🔄 تحديث الرصيد', callback_data: 'menu_balance' }],
                        [{ text: '🔙 القائمة الرئيسية', callback_data: 'menu_open' }]
                    ]
                }
            }).catch(e => logger.error(`Failed to send balance info: ${e.message}`));
        } catch (error) {
            ctx.reply('حدث خطأ أثناء جلب الرصيد من BingX.').catch(e => logger.error(`Failed to send balance error: ${e.message}`));
        }
    });

    bot.hears('💼 صفقاتي المفتوحة', async (ctx) => {
        try {
            if (!ctx.from) return;
            const { msg, keyboard } = await getOpenPositionsInfo(ctx.from.id.toString());
            ctx.replyWithHTML(msg, { reply_markup: keyboard }).catch(e => logger.error(`Failed to send positions: ${e.message}`));
        } catch (error) {
            ctx.reply('حدث خطأ أثناء جلب صفقاتك المفتوحة.').catch(e => logger.error(`Failed to send positions error: ${e.message}`));
        }
    });

    bot.command('balance', async (ctx) => {
        try {
            const balance = await bingXService.getBalance();
            ctx.reply(`Current BingX Futures Balance: ${balance.toFixed(2)} USDT`);
        } catch (error) {
            ctx.reply('Error fetching balance from bingXService.');
        }
    });

    // --- TELEGRAM CALLBACK HANDLING ---

    bot.action('menu_balance', async (ctx) => {
        try {
            const { msg } = await getBalanceInfo();
            await ctx.editMessageText(msg, {
                parse_mode: 'HTML',
                reply_markup: {
                    inline_keyboard: [
                        [{ text: '🔄 تحديث الرصيد', callback_data: 'menu_balance' }],
                        [{ text: '🔙 القائمة الرئيسية', callback_data: 'menu_open' }]
                    ]
                }
            });
            await ctx.answerCbQuery('تم تحديث الرصيد 💰');
        } catch (e: any) {
            await ctx.answerCbQuery('حدث خطأ أثناء التحديث');
        }
    });

    bot.action('menu_positions', async (ctx) => {
        try {
            if (!ctx.from) return;
            const { msg, keyboard } = await getOpenPositionsInfo(ctx.from.id.toString());
            await ctx.editMessageText(msg, {
                parse_mode: 'HTML',
                reply_markup: keyboard
            });
            await ctx.answerCbQuery('تم تحديث قائمة الصفقات 💼');
        } catch (e: any) {
            await ctx.answerCbQuery('حدث خطأ أثناء التحديث');
        }
    });

    // --- CALLBACK: ONE-CLICK CLOSE ---
    bot.action(/^pos_close_(.+)$/, async (ctx) => {
        try {
            if (!ctx.from) return;
            const symbol = ctx.match[1];
            await ctx.answerCbQuery(`⏳ جاري إغلاق ${symbol}...`);

            const user = await User.findOne({ telegramId: ctx.from.id.toString() });
            if (!user) return;

            const closed = await tradeManager.closeSpecificPosition(user._id.toString(), symbol);
            if (closed) {
                await ctx.reply(`✅ تم تصفية وإغلاق صفقة <b>${symbol}</b> بنجاح بسعر السوق.`, { parse_mode: 'HTML' });
            } else {
                await ctx.reply(`⚠️ لم نتمكن من إيجاد صفقة مفتوحة للعملة ${symbol} في المنصة.`);
            }

            // Refresh open positions panel
            const { msg, keyboard } = await getOpenPositionsInfo(ctx.from.id.toString());
            await ctx.editMessageText(msg, { parse_mode: 'HTML', reply_markup: keyboard }).catch(() => { });
        } catch (error: any) {
            logger.error(`Error closing position from callback: ${error.message}`);
            await ctx.reply(`❌ حدث خطأ أثناء محاولة إغلاق صفقة ${ctx.match[1]}`);
        }
    });

    // --- CALLBACK: ONE-CLICK SECURE (BREAK-EVEN) ---
    bot.action(/^pos_be_(.+)$/, async (ctx) => {
        try {
            if (!ctx.from) return;
            const symbol = ctx.match[1];
            await ctx.answerCbQuery(`⏳ جاري تأمين صفقة ${symbol}...`);

            const user = await User.findOne({ telegramId: ctx.from.id.toString() });
            if (!user) return;

            // Find match position on CCXT
            const positions = await bingXService.getPositions();
            const pos = positions.find((p: any) => p.symbol.startsWith(symbol) && parseFloat(p.contracts) > 0);

            if (!pos) {
                return ctx.reply(`⚠️ لم نجد صفقة مفتوحة للعملة ${symbol} لتأمينها.`);
            }

            const entryPrice = parseFloat(pos.entryPrice);
            const side = pos.side.toUpperCase();

            // Place new SL order at Entry Price
            await bingXService.setStopLoss(pos.symbol, entryPrice, side);

            // Update in DB
            const trade = await Trade.findOne({
                userId: user._id,
                symbol: pos.symbol,
                currentStatus: { $in: ['OPEN', 'TP1_HIT', 'TP2_HIT'] }
            });

            if (trade) {
                trade.stopLoss = entryPrice;
                trade.isBreakEvenSet = true;
                await trade.save();
            }

            await ctx.reply(`🔒 تم تأمين صفقة <b>${symbol}</b> بنجاح ونقل وقف الخسارة إلى سعر الدخول (<b>${entryPrice}</b>).`, { parse_mode: 'HTML' });

            // Refresh
            const { msg, keyboard } = await getOpenPositionsInfo(ctx.from.id.toString());
            await ctx.editMessageText(msg, { parse_mode: 'HTML', reply_markup: keyboard }).catch(() => { });
        } catch (error: any) {
            logger.error(`Error securing position from callback: ${error.message}`);
            await ctx.reply(`❌ حدث خطأ أثناء محاولة تأمين صفقة ${ctx.match[1]}`);
        }
    });

    // --- CALLBACK: EDIT STOP LOSS VIA NUMPAD ---
    bot.action(/^pos_sl_(.+)$/, async (ctx) => {
        try {
            if (!ctx.from) return;
            const symbol = ctx.match[1];
            await ctx.answerCbQuery();

            // Find current stop loss value if any
            const positions = await bingXService.getPositions();
            const pos = positions.find((p: any) => p.symbol.startsWith(symbol) && parseFloat(p.contracts) > 0);

            let currentSl = '0';
            if (pos) {
                const user = await User.findOne({ telegramId: ctx.from.id.toString() });
                const trade = await Trade.findOne({
                    userId: user?._id,
                    symbol: pos.symbol,
                    currentStatus: { $in: ['OPEN', 'TP1_HIT', 'TP2_HIT'] }
                });
                if (trade && trade.stopLoss) {
                    currentSl = trade.stopLoss.toString();
                }
            }

            await ctx.reply(`🔄 <b>تعديل وقف الخسارة (SL) لعملة ${symbol}:</b>\nاستخدم لوحة الأرقام أدناه لإدخال السعر المطلوب بدقة:`, {
                parse_mode: 'HTML',
                reply_markup: buildNumpadKeyboard(`sl_${symbol}`, '', `سعر وقف الخسارة`)
            });
        } catch (error: any) {
            logger.error(`Error invoking numpad for SL: ${error.message}`);
        }
    });
};
