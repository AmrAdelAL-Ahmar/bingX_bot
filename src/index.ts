import { Telegraf, Context } from 'telegraf';
import dotenv from 'dotenv';
import connectDB from './config/db';
import logger from './utils/logger';
import User from './models/User';
import { BingXService } from './services/BingXService';
import { TradeManager } from './services/TradeManager';
import { SignalParser } from './services/SignalParser';
import { ReportingService } from './services/ReportingService'; // Import

dotenv.config();

const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN || '');
const bingXService = new BingXService(process.env.BINGX_API_KEY, process.env.BINGX_SECRET_KEY);
const tradeManager = new TradeManager(bingXService);
const reportingService = new ReportingService(bot); // Init

// Middleware to ensure user exists
const ensureUser = async (ctx: Context, next: () => Promise<void>) => {
    if (!ctx.from) return;
    try {
        let user = await User.findOne({ telegramId: ctx.from.id.toString() });
        if (!user) {
            user = await User.create({
                telegramId: ctx.from.id.toString(),
                username: ctx.from.username,
                riskPercentage: parseInt(process.env.RISK_PERCENTAGE || '2'),
            });
            logger.info(`New user created: ${user.username}`);
        }
        // Attach user to context if needed, or just proceed
        return next();
    } catch (err) {
        logger.error('Error in ensureUser middleware', err);
    }
};

bot.use(ensureUser);

bot.start((ctx) => {
    ctx.reply('Welcome! I am ready to trade. Send me a signal or add me to your signal channel.');
});

bot.command('balance', async (ctx) => {
    try {
        const balance = await bingXService.getBalance();
        ctx.reply(`Current Futures Balance: ${balance} USDT`);
    } catch (error) {
        ctx.reply('Error fetching balance.');
    }
});

bot.on('text', async (ctx) => {
    const message = ctx.message.text;

    // 1. Try to parse signal
    const signal = SignalParser.parse(message);

    if (signal) {
        const user = await User.findOne({ telegramId: ctx.from.id.toString() });
        if (!user) {
            ctx.reply('User not found in DB. Please start a chat with the bot first.');
            return;
        }

        try {
            if (signal.type === 'TRADE') {
                logger.info(`Signal detected from ${ctx.from.username}: ${signal.symbol} ${signal.direction} Entry=${signal.entry?.[0]}`);
                ctx.reply(`✅ Trade Signal Parsed: ${signal.symbol}\nDirection: ${signal.direction}\nEntry: ${signal.entry?.[0]}\nTarget: ${signal.targets?.[0]}\nSL: ${signal.stopLoss}\nProcessing...`);
                const trade = await tradeManager.executeSignal(signal, user._id.toString());
                if (trade) {
                    ctx.reply(`✅ Trade Executed!\nID: ${trade.bingxOrderId}\nSize: ${trade.amount.toFixed(2)} USDT`);
                }
            } else if (signal.type === 'CLOSE') {
                logger.info(`Close Signal detected from ${ctx.from.username}: ${signal.symbol}`);
                ctx.reply(`🛑 Close Signal Parsed: ${signal.symbol}\nAttempting to close position...`);
                await tradeManager.executeSignal(signal, user._id.toString());
                ctx.reply(`✅ Close order sent for ${signal.symbol}`);
            }
        } catch (error: any) {
            logger.error(`Error processing signal: ${error.message}`);
            ctx.reply(`❌ Error: ${error.message}`);
        }
    } else {
        // Optional: Reply validation error or ignore non-signal messages
        // ctx.reply('Message received, but no valid signal found.');
    }
});

const start = async () => {
    await connectDB();

    bot.launch().then(() => {
        logger.info('Telegram Bot Started');
        reportingService.init(); // Start Cron
    }).catch((err) => {
        logger.error('Bot launch failed', err);
    });

    // Enable graceful stop
    process.once('SIGINT', () => bot.stop('SIGINT'));
    process.once('SIGTERM', () => bot.stop('SIGTERM'));
};

start();
