import { Telegraf } from 'telegraf';
import dotenv from 'dotenv';
import connectDB from './config/db';
import logger from './utils/logger';
import { BingXService } from './services/BingXService';
import { AnalysisService } from './services/AnalysisService';
import { TradeManager } from './services/TradeManager';
import { SignalParser } from './services/SignalParser';
import { ReportingService } from './services/ReportingService';
import { PositionMonitor } from './services/PositionMonitor';
import { startHealthServer } from './server';
import { ensureUser } from './bot/middlewares/userMiddleware';
import { sendTelegramMessage } from './utils/telegram';

// Import newly extracted bot handlers
import { registerMessageHandlers } from './bot/handlers/messageHandlers';
import { registerPortfolioHandlers } from './bot/handlers/portfolioHandlers';
import { registerReportHandlers } from './bot/handlers/reportHandlers';
import { registerTradingHandlers } from './bot/handlers/tradingHandlers';
import { registerSettingsHandlers } from './bot/handlers/settingsHandlers';
import { registerSniperHandlers } from './bot/handlers/sniperHandlers';
import { registerRadarHandlers } from './bot/handlers/radarHandlers';
import { SniperManager } from './services/SniperManager';

dotenv.config();

const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN || '');
const bingXService = new BingXService(process.env.BINGX_API_KEY, process.env.BINGX_SECRET_KEY);
const analysisService = new AnalysisService(bingXService);
const tradeManager = new TradeManager(bingXService);
const reportingService = new ReportingService(bot);

// Initialize Monitor
const positionMonitor = new PositionMonitor(bingXService, analysisService, async (telegramId, msg) => {
    try {
        await sendTelegramMessage(bot, telegramId, msg);
    } catch (error) {
        // Error already logged in utility
    }
});

// Initialize SniperManager
const sniperManager = new SniperManager(bingXService, async (telegramId, msg, extra) => {
    try {
        await (bot.telegram.sendMessage as any)(telegramId, msg, extra || { parse_mode: 'Markdown' });
    } catch (error: any) {
        logger.error(`SniperManager notifier error: ${error.message}`);
    }
});

// Setup bot middlewares
bot.use(ensureUser);

// Global Telegraf error handler to catch API errors gracefully (e.g. message is not modified)
bot.catch((err: any, ctx) => {
    logger.error(`Telegraf global error catcher caught: ${err.message || err}`, err);
    // Ignore minor/annoying Telegram API errors like message is not modified or delete failure
    if (err.description && (err.description.includes('message is not modified') || err.description.includes('message to delete not found'))) {
        return;
    }
    ctx.reply('⚠️ حدث خطأ غير متوقع أثناء معالجة الطلب.').catch(() => {});
});

// Register Command Handlers
registerPortfolioHandlers(bot, bingXService);
registerReportHandlers(bot, bingXService);
registerTradingHandlers(bot, bingXService);
registerSettingsHandlers(bot);
(bot as any).sniperManager = sniperManager;
registerSniperHandlers(bot, sniperManager);
registerRadarHandlers(bot);
registerMessageHandlers(bot, tradeManager);

const start = async () => {
    await connectDB();

    // Start HTTP health check server for Render deployment
    const port = parseInt(process.env.PORT || '3000');
    startHealthServer(port);

    // Start Monitor before bot launch
    positionMonitor.start();
    logger.info('Position Monitor Started');

    // Start SniperManager
    sniperManager.start();
    logger.info('🎯 Sniper Manager Started');

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
