import { Telegraf } from 'telegraf';
import logger from '../../utils/logger';
import { BingXService } from '../../services/BingXService';
import User from '../../models/User';
import Trade from '../../models/Trade';

export const registerPortfolioHandlers = (bot: Telegraf, BingXService: BingXService) => {

    bot.hears('💰 رصيدي وملخص الأرباح', async (ctx) => {
        try {
            const balance = await BingXService.getBalance();

            let msg = `<b>💰 تفاصيل الحساب (Bingx ):</b>\n\n`;
            msg += `الرصيد المتاح (USDT): <b>${balance.toFixed(2)}</b>\n`;

            const positions = await BingXService.getPositions();
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
            ctx.reply('حدث خطأ أثناء جلب الرصيد من bingXService.').catch(e => logger.error(`Failed to send balance error: ${e.message}`));
        }
    });

    bot.hears('💼 صفقاتي المفتوحة', async (ctx) => {
        try {
            if (!ctx.from) return;
            const user = await User.findOne({ telegramId: ctx.from.id.toString() });
            if (!user) return;

            const balance = await BingXService.getBalance();
            const positions = await BingXService.getPositions();

            if (!positions || positions.length === 0) {
                ctx.reply('لا يوجد صفقات مفتوحة حالياً.').catch(e => logger.error(`Failed to send no positions notice: ${e.message}`));
                return;
            }

            const openTrades = await Trade.find({
                userId: user._id,
                currentStatus: { $in: ['OPEN', 'TP1_HIT', 'TP2_HIT'] }
            });

            let msg = '<b>💼 صفقاتي المفتوحة (Bingx  Live) 🟢:</b>\n\n';
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
                    // Potential TP Profit
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
            ctx.reply('Error fetching positions from bingXService.').catch(e => logger.error(`Failed to send positions error: ${e.message}`));
        }
    });

    bot.command('balance', async (ctx) => {
        try {
            const balance = await BingXService.getBalance();
            ctx.reply(`Current Bingx  Futures Balance: ${balance} USDT`);
        } catch (error) {
            ctx.reply('Error fetching balance from bingXService.');
        }
    });

};
