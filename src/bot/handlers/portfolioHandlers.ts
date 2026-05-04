import { Telegraf } from 'telegraf';
import logger from '../../utils/logger';
import { IExchangeService } from '../../services/IExchangeService';
import User from '../../models/User';
import Trade from '../../models/Trade';
import { formatPrice, formatAmount } from '../../utils/formatters';

export const registerPortfolioHandlers = (bot: Telegraf, xtService: IExchangeService) => {
    
    bot.hears('💰 رصيدي وملخص الأرباح', async (ctx) => {
        try {
            const balance = await xtService.getBalance();

            let msg = `<b>💰 تفاصيل الحساب (XT):</b>\n\n`;
            msg += `الرصيد المتاح (USDT): <b>${formatAmount(balance)}</b>\n`;

            const positions = await xtService.getPositions();
            let totalPnl = 0;

            if (positions && positions.length > 0) {
                for (const pos of positions) {
                    if (parseFloat(pos.contracts) === 0) continue;
                    const pnl = pos.unrealizedPnl !== undefined ? pos.unrealizedPnl :
                        (pos.info && pos.info.unrealizedProfit ? parseFloat(pos.info.unrealizedProfit) : 0);
                    totalPnl += pnl;
                }
                const pnlEmoji = totalPnl >= 0 ? '🟢' : '🔴';
                msg += `الأرباح/الخسائر غير المحققة للصفقات المفتوحة: ${pnlEmoji} <b>${formatAmount(totalPnl)} USDT</b>\n`;
            } else {
                msg += `لا يوجد صفقات مفتوحة حالياً.\n`;
            }

            ctx.replyWithHTML(msg).catch(e => logger.error(`Failed to send balance info: ${e.message}`));
        } catch (error) {
            ctx.reply('حدث خطأ أثناء جلب الرصيد من XT.').catch(e => logger.error(`Failed to send balance error: ${e.message}`));
        }
    });

    bot.hears('💼 صفقاتي المفتوحة', async (ctx) => {
        try {
            if (!ctx.from) return;
            const user = await User.findOne({ telegramId: ctx.from.id.toString() });
            if (!user) return;

            const balance = await xtService.getBalance();
            const positions = await xtService.getPositions();

            if (!positions || positions.length === 0) {
                ctx.reply('لا يوجد صفقات مفتوحة حالياً.').catch(e => logger.error(`Failed to send no positions notice: ${e.message}`));
                return;
            }

            const openTrades = await Trade.find({
                userId: user._id,
                currentStatus: { $in: ['OPEN', 'TP1_HIT', 'TP2_HIT'] }
            });

            let msg = '<b>💼 صفقاتي المفتوحة (XT Live) 🟢:</b>\n\n';
            let totalPnl = 0;
            let totalMarginUsed = 0;

            for (const pos of positions) {
                if (parseFloat(pos.contracts) === 0) continue;

                const pnl = pos.unrealizedPnl !== undefined && pos.unrealizedPnl !== null
                    ? pos.unrealizedPnl
                    : (pos.info?.unrealizedPnl !== undefined ? parseFloat(pos.info.unrealizedPnl)
                    : (pos.info?.unrealizedProfit !== undefined ? parseFloat(pos.info.unrealizedProfit) : 0));

                totalPnl += pnl;

                let margin = pos.initialMargin !== undefined && pos.initialMargin !== null
                    ? pos.initialMargin
                    : (pos.info?.isolatedMargin ? parseFloat(pos.info.isolatedMargin) : 0);

                if (!margin && pos.notional) {
                    margin = Math.abs(pos.notional) / (pos.leverage || 10);
                }
                totalMarginUsed += margin;

                let roe = pos.percentage;
                if (roe === undefined || roe === null) {
                    if (margin && margin > 0) {
                        roe = (pnl / margin) * 100;
                    } else {
                        roe = pos.info?.profitRate ? parseFloat(pos.info.profitRate) * 100 : 0;
                    }
                }

                const emoji = pnl >= 0 ? '🟢' : '🔴';
                const entryPrice = parseFloat(pos.entryPrice) || parseFloat(pos.info?.entryPrice) || 0;
                // XT may return markPrice in info or as a separate field
                const rawMarkPrice = pos.markPrice ?? pos.info?.markPrice ?? pos.info?.markValue ?? entryPrice;
                const markPrice = parseFloat(rawMarkPrice) || entryPrice;
                const amountCoins = parseFloat(pos.contracts) || parseFloat(pos.info?.positionAmt) || 0;
                const posSide = (pos.side || pos.info?.side || 'LONG').toString().toUpperCase();

                const trade = openTrades.find(t => t.symbol === pos.symbol || pos.symbol.includes(t.symbol.split('/')[0]));

                const leverage = pos.leverage || (trade ? trade.leverage : null) || 'N/A';
                msg += `<b>${pos.symbol}</b> (${posSide}) | الرافعة: <b>${leverage}x</b>\n` +
                    `الدخول: ${formatPrice(entryPrice)} ➡️ الحالي: ${formatPrice(markPrice)}\n` +
                    `المبلغ المستثمر (Margin): ${formatAmount(margin)} USDT (النسبة من الرصيد: ${balance > 0 ? ((margin / balance) * 100).toFixed(2) : 0}%)\n` +
                    `الأرباح/الخسائر الحالية: ${emoji} ${formatAmount(pnl)} USDT (${roe.toFixed(2)}%)\n`;

                if (trade) {
                    if (trade.targets && trade.targets.length > 0) {
                        const tpPrice = trade.targets[0].price;
                        const tpPnl = posSide === 'LONG' ? (tpPrice - entryPrice) * amountCoins : (entryPrice - tpPrice) * amountCoins;
                        const tpPercent = margin > 0 ? (tpPnl / margin) * 100 : 0;
                        msg += `الهدف القادم: ${formatPrice(tpPrice)} 🎯 (الربح المتوقع: ${formatAmount(tpPnl)} USDT | ${tpPercent.toFixed(2)}%)\n`;
                    }

                    if (trade.stopLoss) {
                        const slPrice = trade.stopLoss;
                        const slPnl = posSide === 'LONG' ? (slPrice - entryPrice) * amountCoins : (entryPrice - slPrice) * amountCoins;
                        const slPercent = margin > 0 ? (slPnl / margin) * 100 : 0;
                        msg += `وقف الخسارة: ${formatPrice(slPrice)} 🛑 (الخسارة المتوقعة: ${formatAmount(slPnl)} USDT | ${slPercent.toFixed(2)}%)\n`;
                    }
                }

                msg += `-------------------\n`;
            }

            const totalMarginPercent = balance > 0 ? ((totalMarginUsed / balance) * 100).toFixed(2) : '0.00';
            msg += `\n<b>إجمالي المبالغ المستثمرة:</b> ${formatAmount(totalMarginUsed)} USDT (${totalMarginPercent}% من الرصيد)\n`;

            const totalEmoji = totalPnl >= 0 ? '🟢' : '🔴';
            msg += `<b>إجمالي الربح/الخسارة العائم: ${totalEmoji} ${formatAmount(totalPnl)} USDT</b>`;

            ctx.replyWithHTML(msg).catch(e => logger.error(`Failed to send positions list: ${e.message}`));
        } catch (error) {
            logger.error('Error in positions handler:', error);
            ctx.reply('حدث خطأ أثناء جلب الصفقات من XT.').catch(e => logger.error(`Failed to send positions error: ${e.message}`));
        }
    });

    bot.command('balance', async (ctx) => {
        try {
            const balance = await xtService.getBalance();
            ctx.reply(`💰 رصيد XT Futures الحالي: ${formatAmount(balance)} USDT`);
        } catch (error) {
            ctx.reply('حدث خطأ أثناء جلب الرصيد من XT.');
        }
    });

};
