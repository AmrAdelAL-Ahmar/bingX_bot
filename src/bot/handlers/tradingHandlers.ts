import { Telegraf } from 'telegraf';
import logger from '../../utils/logger';
import { BinanceService } from '../../services/BinanceService';
import User from '../../models/User';
import Trade from '../../models/Trade';
import { getDynamicSymbolsKeyboard, getMainMenuKeyboard } from '../keyboards/baseKeyboards';

export const registerTradingHandlers = (bot: Telegraf, binanceService: BinanceService) => {

    bot.hears('🛑 إلغاء كل الصفقات المفتوحة', async (ctx) => {
        try {
            if (!ctx.from) return;
            const user = await User.findOne({ telegramId: ctx.from.id.toString() });
            if (!user) return;

            ctx.reply('⏳ جاري حساب الأرباح والخسائر الحالية لمعرفة وضع الحساب على Binance...');

            const balance = await binanceService.getBalance();
            const positions = await binanceService.getPositions();

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
            let confirmMsg = `⚠️ <b>تأكيد إغلاق جميع الصفقات (${activePosCount} صفقات) على Binance</b>\n\n` +
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
            ctx.reply('حدث خطأ أثناء محاولة جلب الصفقات المفتوحة من Binance.');
        }
    });

    bot.hears('🔍 الاستعلام عن صفقة محددة', async (ctx) => {
        try {
            if (!ctx.from) return;
            const user = await User.findOne({ telegramId: ctx.from.id.toString() });
            if (!user) return;
            user.botState = 'AWAITING_QUERY_SYMBOL';
            await user.save();

            const activeKeys = await getDynamicSymbolsKeyboard(binanceService);

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

            const activeKeys = await getDynamicSymbolsKeyboard(binanceService);

            ctx.reply('❌ اختر العملة التي تريد إلغاء صفقتها، أو قم بكتابتها (مثال: ETH):', {
                reply_markup: { keyboard: activeKeys, resize_keyboard: true, one_time_keyboard: true }
            });
        } catch (e) {
            ctx.reply('حدث خطأ.');
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
    
            // Fetch live PnL from Binance
            const positions = await binanceService.getPositions(trade.symbol);
            const pos = positions.find((p: any) => p.symbol === trade.symbol);
            const balance = await binanceService.getBalance();
    
            let msg = `📊 <b>Binance Status: ${trade.symbol}</b>\n` +
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
    
                const roe = pos.percentage !== undefined ? pos.percentage : (margin > 0 ? (pnl / margin) * 100 : 0);
    
                msg += `الربح/الخسارة العائمة: ${pnl >= 0 ? '🟢' : '🔴'} <b>${pnl.toFixed(4)} USDT</b> (${roe.toFixed(2)}%)\n`;
                msg += `النسبة من المحفظة: ${((margin / balance) * 100).toFixed(2)}%\n`;
            } else {
                msg += `الصفقة موجودة في النظام ولكن غير متصلة مؤقتاً بالمنصة.\n`;
            }
    
            ctx.replyWithHTML(msg);
        } catch (error) {
            ctx.reply('Error fetching status from Binance.');
        }
    });

};
