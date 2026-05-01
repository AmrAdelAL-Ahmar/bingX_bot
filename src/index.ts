import { Telegraf } from 'telegraf';
import dotenv from 'dotenv';
import connectDB from './config/db';
import logger from './utils/logger';
import { BinanceService } from './services/BinanceService';
import { TradeManager } from './services/TradeManager';
import { SignalParser } from './services/SignalParser';
import { ReportingService } from './services/ReportingService';
import { PositionMonitor } from './services/PositionMonitor';
import { startHealthServer } from './server';
import { ensureUser } from './bot/middlewares/userMiddleware';

// Import newly extracted bot handlers
import { registerMessageHandlers } from './bot/handlers/messageHandlers';
import { registerPortfolioHandlers } from './bot/handlers/portfolioHandlers';
import { registerReportHandlers } from './bot/handlers/reportHandlers';
import { registerTradingHandlers } from './bot/handlers/tradingHandlers';
import { registerSettingsHandlers } from './bot/handlers/settingsHandlers';

dotenv.config();

const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN_Binance || process.env.TELEGRAM_BOT_TOKEN || '');
const binanceService = new BinanceService(process.env.Binance_API_KEY, process.env.Binance_SECRET_KEY);
const tradeManager = new TradeManager(binanceService);
const reportingService = new ReportingService(bot);

// Initialize Monitor
const positionMonitor = new PositionMonitor(binanceService, async (telegramId, msg) => {
    try {
        await bot.telegram.sendMessage(telegramId, msg, { parse_mode: 'HTML' });
        logger.info(`Notification sent successfully to ${telegramId}`);
    } catch (error) {
        logger.error(`Error sending notification to ${telegramId}:`, error);
    }
});

// Setup bot middlewares
bot.use(ensureUser);

// Register Command Handlers
registerPortfolioHandlers(bot, binanceService);
registerReportHandlers(bot, binanceService);
registerTradingHandlers(bot, binanceService);
registerSettingsHandlers(bot);
registerMessageHandlers(bot, tradeManager);

const start = async () => {
    await connectDB();

    // Start HTTP health check server for Render deployment
    const port = parseInt(process.env.PORT || '3000');
    startHealthServer(port);

    // Start Monitor before bot launch
    positionMonitor.start();
    logger.info('Position Monitor Started');

    bot.launch().then(() => {
        logger.info('Telegram Bot Started Successfully');
        reportingService.init();
    }).catch((err) => {
        logger.error('Bot launch failed', err);
    });

    // Enable graceful stop
    process.once('SIGINT', () => {
        positionMonitor.stop();
        bot.stop('SIGINT');
    });
    process.once('SIGTERM', () => {
        positionMonitor.stop();
        bot.stop('SIGTERM');
    });
};

start();
