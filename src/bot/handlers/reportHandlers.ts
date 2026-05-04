import { Telegraf } from 'telegraf';
import logger from '../../utils/logger';
import { IExchangeService } from '../../services/IExchangeService';
import User from '../../models/User';
import Trade from '../../models/Trade';
import { generateReportStr } from '../utils/views';
import { getMainMenuKeyboard, getReportsKeyboard } from '../keyboards/baseKeyboards';

export const registerReportHandlers = (bot: Telegraf, xtService: IExchangeService) => {
    
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
    
            const currentEquity = await xtService.getTotalEquity();
    
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

};
