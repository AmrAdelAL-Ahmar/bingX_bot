import cron from 'node-cron';
import { Telegraf } from 'telegraf';
import Trade from '../models/Trade';
import User from '../models/User';
import { BingXService } from './BingXService';
import logger from '../utils/logger';

export class ReportingService {
    private bot: Telegraf;
    private bingX: BingXService;
    private reportByTradingAccount: boolean;

    constructor(bot: Telegraf, bingX: BingXService) {
        this.bot = bot;
        this.bingX = bingX;
        this.reportByTradingAccount = process.env.REPORT_BY_TRADING_ACCOUNT === 'true';
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
        const now = new Date();
        let startTime = new Date();
        if (type === 'weekly') {
            startTime.setDate(now.getDate() - 7);
        } else {
            startTime.setMonth(now.getMonth() - 1);
        }

        if (this.reportByTradingAccount) {
            // === MODE: Report by BingX trading account (all trades on the exchange) ===
            const reports = await this.generateBingXAccountReport(
                type, 
                startTime, 
                now, 
                type === 'weekly' ? 'التقرير الأسبوعي' : 'التقرير الشهري'
            );
            const notifChat = process.env.NOTIFICATION_CHAT_ID;
            if (notifChat) {
                for (const msg of reports) {
                    await this.safeSendMessage(notifChat, msg, 'HTML');
                }
            }
        } else {
            // === MODE: Report per Telegram user (existing behavior) ===
            const users = await User.find({ isActive: true });
            for (const user of users) {
                try {
                    const trades = await Trade.find({
                        userId: user._id,
                        entryTime: { $gte: startTime, $lte: now },
                        currentStatus: { $in: ['CLOSED_PROFIT', 'CLOSED_LOSS', 'CLOSED_MANUAL'] }
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

                    await this.safeSendMessage(user.telegramId, message, 'Markdown');
                    logger.info(`Report sent to ${user.telegramId}`);

                } catch (error) {
                    logger.error(`Failed to send report to ${user.telegramId}`, error);
                }
            }
        }
    }

    /**
     * Generate a comprehensive report from BingX trade history directly,
     * matching each trade to a Telegram user from MongoDB.
     * Returns an array of message strings (chunked if too long).
     */
    async generateBingXAccountReport(type: string, startTime: Date, endTime: Date, title: string): Promise<string[]> {
        try {
            logger.info(`Generating BingX account report (${type}) from ${startTime.toISOString()} to ${endTime.toISOString()}`);

            // Fetch all closed trades from BingX exchange directly, set limit higher for "all"
            const bingxTrades = await this.bingX.getClosedTrades(startTime.getTime(), 1000);

            if (!bingxTrades || bingxTrades.length === 0) {
                return [`📊 ${title}\n\nلا يوجد صفقات مغلقة في هذه الفترة على حساب BingX.`];
            }

            // Filter trades within the date range
            const filteredTrades = bingxTrades.filter((t: any) => {
                const ts = t.timestamp || 0;
                return ts >= startTime.getTime() && ts <= endTime.getTime();
            });

            if (filteredTrades.length === 0) {
                return [`📊 ${title}\n\nلا يوجد صفقات مغلقة في هذه الفترة المُحددة.`];
            }

            // Filter out "opening" orders, we only want orders that CLOSE a position
            const closingTrades = filteredTrades.filter((bt: any) => {
                const side = (bt.info?.side || '').toUpperCase();
                const posSide = (bt.info?.positionSide || '').toUpperCase();
                
                if (bt.reduceOnly === true || bt.info?.reduceOnly === 'true' || bt.info?.closePosition === 'true') return true;
                if (side === 'SELL' && posSide === 'LONG') return true;
                if (side === 'BUY' && posSide === 'SHORT') return true;
                
                // Fallback: if it has non-zero PnL, it must be a closing order
                const pnlVal = bt.info?.profit !== undefined ? parseFloat(bt.info.profit) : 
                              (bt.info?.realisedProfit !== undefined ? parseFloat(bt.info.realisedProfit) : (bt.realizedPnl || bt.info?.realizedPnl || 0));
                if (Math.abs(pnlVal) > 0) return true;
                
                return false;
            });

            if (closingTrades.length === 0) {
                return [`📊 ${title}\n\nلا يوجد صفقات مغلقة فعلياً في هذه الفترة المُحددة.`];
            }

            // Load all users from DB to match trades to telegram accounts
            const allUsers = await User.find({ isActive: true });
            const allDbTrades = await Trade.find({
                entryTime: { $gte: startTime, $lte: endTime },
                currentStatus: { $in: ['CLOSED_PROFIT', 'CLOSED_LOSS', 'CLOSED_MANUAL'] }
            }).populate('userId');

            // Build a user lookup map: userId (string) -> user object
            const userMap: Record<string, any> = {};
            for (const u of allUsers) {
                userMap[u._id.toString()] = u;
            }

            // Aggregate stats
            let totalPnl = 0;
            let wins = 0;
            let losses = 0;
            const tradesStrings: string[] = [];

            // Group BingX trades by symbol and match with DB records
            for (let i = 0; i < closingTrades.length; i++) {
                const bt = closingTrades[i];
                const symbol = bt.symbol || 'Unknown';
                const side = bt.side || 'unknown';
                
                // For BingX: PnL is in info.profit or info.realisedProfit or realizedPnl
                const pnl = bt.info?.profit !== undefined
                    ? parseFloat(bt.info.profit)
                    : (bt.info?.realisedProfit !== undefined
                        ? parseFloat(bt.info.realisedProfit)
                        : (bt.realizedPnl || bt.info?.realizedPnl || 0));
                
                const price = typeof bt.price !== 'undefined' && bt.price !== null ? bt.price : (bt.average || 0);
                
                // Use Gregorian Date format like 2026-04-22 23:44:00
                const timestamp = bt.timestamp 
                    ? new Date(bt.timestamp).toISOString().replace('T', ' ').substring(0, 19) 
                    : 'N/A';

                totalPnl += pnl;
                if (pnl > 0) wins++;
                else losses++;

                // Try to find which user/trader placed this trade in MongoDB
                let traderLabel = '—';
                let entryPriceStr = 'غير متوفر';
                let entryAmountStr = 'غير متوفر';

                const matchedDbTrade = allDbTrades.find((d: any) =>
                    d.symbol === symbol || symbol.includes(d.symbol.split('/')[0])
                );
                
                if (matchedDbTrade) {
                    const lev = matchedDbTrade.leverage || 1;
                    const margin = matchedDbTrade.amount / lev;
                    entryPriceStr = matchedDbTrade.entryPrice.toFixed(5);
                    entryAmountStr = `${margin.toFixed(5)} USDT (Lev: ${lev}x)`;

                    const traderUser = userMap[(matchedDbTrade as any).userId?.toString()];
                    if (traderUser) {
                        traderLabel = traderUser.username
                            ? `@${traderUser.username}`
                            : `t.me/user?id=${traderUser.telegramId}`;
                    }
                }

                const pnlEmoji = pnl >= 0 ? '🟢' : '🔴';
                const pnlSign = pnl >= 0 ? '+' : '';
                const tradeDetail = `\n${i + 1}. <b>${symbol}</b> (${side.toUpperCase()})\n` +
                    `سعر الدخول: ${entryPriceStr} | مبلغ الدخول: ${entryAmountStr}\n` +
                    `سعر الإغلاق: ${parseFloat(price).toFixed(5)}\n` +
                    `وقت الإغلاق: ${timestamp}\n` +
                    `النتيجة: ${pnlEmoji} ${pnlSign}${parseFloat(pnl).toFixed(5)} USDT\n` +
                    `👤 المتداول: ${traderLabel}\n`;
                
                tradesStrings.push(tradeDetail);
            }

            const winRate = closingTrades.length > 0 ? ((wins / closingTrades.length) * 100).toFixed(1) : '0.0';
            const pnlEmoji = totalPnl >= 0 ? '🟢' : '🔴';

            let periodText = '';
            const startDateStr = startTime.toISOString().substring(0, 10);
            
            // if difference is exactly 24h, we know it's a 1-day report
            if (endTime.getTime() - startTime.getTime() <= 86400000 && title.includes('يوم')) {
                periodText = startDateStr;
            } else {
                periodText = `${startDateStr} → ${endTime.toISOString().substring(0, 10)}`;
            }

            const header = `📊 <b>${title} - حساب BingX</b>\n` +
                `📅 الفترة: ${periodText}\n\n` +
                `✅ إجمالي الصفقات: <b>${closingTrades.length}</b>\n` +
                `🏆 رابح: ${wins} | 💀 خاسر: ${losses}\n` +
                `📈 معدل النجاح: <b>${winRate}%</b>\n` +
                `${pnlEmoji} إجمالي الربح/الخسارة: <b>${totalPnl >= 0 ? '+' : ''}${totalPnl.toFixed(5)} USDT</b>\n\n` +
                `<b>📋 تفاصيل الصفقات:</b>`;

            // Chunk messages to avoid exceeding Telegram's 4096 character limit
            const MAX_LENGTH = 3800; 
            const parts: string[] = [];
            let currentPart = header;

            for (const ts of tradesStrings) {
                if (currentPart.length + ts.length > MAX_LENGTH) {
                    parts.push(currentPart);
                    currentPart = ts; // start new string with current trade
                } else {
                    currentPart += ts;
                }
            }
            if (currentPart.length > 0) {
                parts.push(currentPart);
            }

            logger.info(`BingX account report generated in ${parts.length} parts. Trades: ${closingTrades.length}, PnL: ${totalPnl.toFixed(5)}`);
            return parts;
        } catch (error: any) {
            logger.error('Error generating BingX account report:', error.message);
            return ['حدث خطأ أثناء جلب التقرير من BingX.'];
        }
    }

    /**
     * Generate an on-demand BingX account report for a given date range.
     * Used when REPORT_BY_TRADING_ACCOUNT=true and user requests a report via bot.
     */
    async generateBingXReportForPeriod(startTime: Date, endTime: Date, title: string): Promise<string[]> {
        return this.generateBingXAccountReport('custom', startTime, endTime, title);
    }

    private async safeSendMessage(chatId: string, message: string, parseMode: 'HTML' | 'Markdown' = 'HTML'): Promise<void> {
        try {
            await this.bot.telegram.sendMessage(chatId, message, { parse_mode: parseMode });
        } catch (error: any) {
            if (error.code === 429) {
                const retryAfter = (error.response?.parameters?.retry_after || 5) * 1000;
                await new Promise(r => setTimeout(r, retryAfter));
                await this.bot.telegram.sendMessage(chatId, message, { parse_mode: parseMode });
            } else {
                logger.error(`Failed to send message to ${chatId}: ${error.message}`);
            }
        }
    }
}
