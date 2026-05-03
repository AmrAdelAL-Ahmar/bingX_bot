import cron from 'node-cron';
import { Telegraf } from 'telegraf';
import Trade from '../models/Trade';
import User from '../models/User';
import logger from '../utils/logger';
import { sendTelegramMessage } from '../utils/telegram';

export class ReportingService {
    private bot: Telegraf;

    constructor(bot: Telegraf) {
        this.bot = bot;
    }

    init() {
        // Schedule Weekly Report: Every Sunday at 00:00
        cron.schedule('0 0 * * 0', async () => {
            logger.info('Running weekly report job');
            await this.generateAndSendReports('weekly');
        });

        // Schedule Monthly Report: 1st of month at 00:00
        cron.schedule('0 0 1 * *', async () => {
            logger.info('Running monthly report job');
            await this.generateAndSendReports('monthly');
        });
    }

    async generateAndSendReports(type: 'weekly' | 'monthly') {
        const users = await User.find({ isActive: true });

        const now = new Date();
        let startTime = new Date();
        if (type === 'weekly') {
            startTime.setDate(now.getDate() - 7);
        } else {
            startTime.setMonth(now.getMonth() - 1);
        }

        for (const user of users) {
            try {
                const trades = await Trade.find({
                    userId: user._id,
                    entryTime: { $gte: startTime, $lte: now },
                    currentStatus: { $in: ['CLOSED_PROFIT', 'CLOSED_LOSS'] }
                });

                if (trades.length === 0) continue;

                let totalPnL = 0;
                let wins = 0;

                trades.forEach(t => {
                    totalPnL += t.pnl || 0;
                    if ((t.pnl || 0) > 0) wins++;
                });

                const winRate = (wins / trades.length) * 100;

                const message = `
📊 **${type.toUpperCase()} TRADING REPORT** 📊
Period: ${startTime.toLocaleDateString()} - ${now.toLocaleDateString()}

Total Trades: ${trades.length}
Win Rate: ${winRate.toFixed(1)}%
Total PnL: ${totalPnL.toFixed(2)} USDT

Keep it up! 🚀
            `;

                await sendTelegramMessage(this.bot, user.telegramId, message);
                logger.info(`Report sent to ${user.telegramId}`);

            } catch (error) {
                logger.error(`Failed to send report to ${user.telegramId}`, error);
            }
        }
    }
}
