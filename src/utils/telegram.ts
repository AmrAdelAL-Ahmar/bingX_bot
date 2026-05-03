
import { Telegraf } from 'telegraf';
import logger from './logger';

/**
 * Sends a message via Telegram with automatic retry on 429 (Too Many Requests)
 */
export async function sendTelegramMessage(bot: Telegraf, chatId: string | number, text: string, options: any = {}) {
    const maxRetries = 3;
    let attempt = 0;

    while (attempt < maxRetries) {
        try {
            await bot.telegram.sendMessage(chatId, text, {
                parse_mode: 'HTML',
                ...options
            });
            return;
        } catch (error: any) {
            if (error.code === 429 || (error.description && error.description.includes('Too Many Requests'))) {
                const retryAfter = error.parameters?.retry_after || 5;
                logger.warn(`Telegram 429 detected. Retrying after ${retryAfter}s (Attempt ${attempt + 1}/${maxRetries})`);
                await new Promise(resolve => setTimeout(resolve, (retryAfter + 1) * 1000));
                attempt++;
            } else {
                logger.error(`Failed to send Telegram message to ${chatId}: ${error.message}`);
                throw error;
            }
        }
    }
    throw new Error(`Failed to send Telegram message after ${maxRetries} attempts due to rate limits.`);
}
