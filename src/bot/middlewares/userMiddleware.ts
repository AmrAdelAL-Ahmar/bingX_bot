import { Context } from 'telegraf';
import logger from '../../utils/logger';
import User from '../../models/User';

// Middleware to ensure user exists & check whitelist
export const ensureUser = async (ctx: Context, next: () => Promise<void>) => {
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
