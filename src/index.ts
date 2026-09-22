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
import { registerAnalysisHandlers } from './bot/handlers/analysisHandlers';
import { registerPickerHandlers } from './bot/handlers/pickerHandlers';
import { registerUnifiedHandlers } from './bot/handlers/unifiedHandlers';
import { registerAiHandlers } from './bot/handlers/aiHandlers';
import { registerAutonomousHandlers } from './bot/handlers/autonomousHandlers';
import { SniperManager } from './services/SniperManager';
import { MacroCalendarService } from './services/MacroCalendarService';
import { AutonomousOrchestrator } from './services/AutonomousOrchestrator';

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

// Initialize AutonomousOrchestrator Engine V2
const autonomousOrchestrator = new AutonomousOrchestrator(bingXService, tradeManager, async (telegramId, msg, extra) => {
    try {
        await (bot.telegram.sendMessage as any)(telegramId, msg, extra || { parse_mode: 'HTML' });
    } catch (error: any) {
        logger.error(`Autonomous notifier error: ${error.message}`);
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
registerPickerHandlers(bot, bingXService);      // ← محرك اختيار العملات
registerSniperHandlers(bot, sniperManager);
registerRadarHandlers(bot);
registerAnalysisHandlers(bot, tradeManager);
registerUnifiedHandlers(bot, tradeManager);
registerMessageHandlers(bot, tradeManager);
registerAiHandlers(bot, tradeManager);
registerAutonomousHandlers(bot, autonomousOrchestrator, tradeManager, bingXService);

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

    // Start Autonomous Orchestrator V2
    autonomousOrchestrator.start();
    logger.info('🚀 Autonomous Orchestrator V2 Engine Started');

    // Sync Real Macro Economic Events from Global Live Feed
    MacroCalendarService.syncRealEvents().then(res => {
        logger.info(`[MacroCalendar] Initial real calendar sync finished: ${res.count} events loaded.`);
    }).catch(err => {
        logger.warn(`[MacroCalendar] Initial real calendar sync warning: ${err.message}`);
    });

    // Schedule automatic sync every 4 hours
    setInterval(() => {
        MacroCalendarService.syncRealEvents().catch(err => {
            logger.warn(`[MacroCalendar] Periodic sync error: ${err.message}`);
        });
    }, 4 * 60 * 60 * 1000);

    bot.launch().then(() => {
        logger.info('Telegram Bot Started Successfully');
        reportingService.init();
    }).catch((err) => {
        logger.error('Bot launch failed', err);
    });

    // Enable graceful stop
    process.once('SIGINT', () => {
        positionMonitor.stop();
        autonomousOrchestrator.stop();
        bot.stop('SIGINT');
    });
    process.once('SIGTERM', () => {
        positionMonitor.stop();
        autonomousOrchestrator.stop();
        bot.stop('SIGTERM');
    });
};

start();
