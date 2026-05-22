import { Telegraf } from 'telegraf';
import logger from '../../utils/logger';
import User from '../../models/User';
import Trade from '../../models/Trade';
import { getMainMenuKeyboard, getTraderSettingsKeyboard, getBacktestVersionKeyboard, getBacktestModeKeyboard, getBacktestIntervalKeyboard, getBacktestDaysKeyboard, getBacktestSettingsKeyboard } from '../keyboards/baseKeyboards';
import { AnalysisService } from '../../services/AnalysisService';
import { BingXService } from '../../services/BingXService';
import { BacktestService } from '../../services/BacktestService';


import { SignalParser } from '../../services/SignalParser';
import { TradeManager } from '../../services/TradeManager';
import { sendTelegramMessage } from '../../utils/telegram';

export function generateCSVBuffer(trades: any[], fullReportEnabled: boolean = false): Buffer {
    if (!trades || trades.length === 0) return Buffer.from('');

    const headers = [
        'Type', 'Mode', 'Entry Date', 'Close Date', 'Status', 'Duration (Mins)',
        'Entry Price', 'TP', 'SL', 'Close Price',
        'Margin_Mode', 'Available_Margin_Before', 'Total_Equity_Before', 'Margin_Used', 'Margin_%', 'Leverage', 'PnL_USDT', 'PnL_%', 'Available_Margin_After', 'Total_Equity_After',
        'Signal Reason', 'Matrix Score (%)', 'Candles_Analyzed_Quick', 'Candles_Analyzed_Long',
        'Quick_RSI', 'Quick_MACD', 'Quick_MACD_Sig', 'Quick_MACD_Hist',
        'Quick_BB_Up', 'Quick_BB_Low', 'Quick_StochRSI', 'Quick_CCI', 'Quick_WilliamsR', 'Quick_ATR', 'Quick_Trend',
        'Quick_Pivot', 'Quick_R1', 'Quick_S1', 'Quick_Fib382', 'Quick_Fib618', 'Quick_SwingHigh', 'Quick_SwingLow',
        'Long_RSI', 'Long_MACD', 'Long_MACD_Hist', 'Long_Trend',
        'Long_Pivot', 'Long_R1', 'Long_S1', 'Long_Fib382', 'Long_Fib618', 'Long_SwingHigh', 'Long_SwingLow',
        '5m_RSI', '5m_Trend', '5m_Pivot', '5m_R1', '5m_S1', '5m_Fib382', '5m_Fib618', '5m_SwingHigh', '5m_SwingLow',
        '15m_RSI', '15m_Trend', '15m_Pivot', '15m_R1', '15m_S1', '15m_Fib382', '15m_Fib618', '15m_SwingHigh', '15m_SwingLow',
        '30m_RSI', '30m_Trend', '30m_Pivot', '30m_R1', '30m_S1', '30m_Fib382', '30m_Fib618', '30m_SwingHigh', '30m_SwingLow',
        '1H_RSI', '1H_Trend', '1H_Pivot', '1H_R1', '1H_S1', '1H_Fib382', '1H_Fib618', '1H_SwingHigh', '1H_SwingLow',
        '4H_RSI', '4H_Trend', '4H_Pivot', '4H_R1', '4H_S1', '4H_Fib382', '4H_Fib618', '4H_SwingHigh', '4H_SwingLow',
        '1D_RSI', '1D_Trend', '1D_Pivot', '1D_R1', '1D_S1', '1D_Fib382', '1D_Fib618', '1D_SwingHigh', '1D_SwingLow'
    ];

    if (!fullReportEnabled) {
        headers.splice(24); // Keep only the first 24 basic columns
    }

    let csvContent = headers.join(',') + '\n';

    for (const t of trades) {
        if (t.skipped) continue;

        // Enclose signalReason in quotes to handle commas within the reason string
        const safeReason = t.signalReason ? `"${t.signalReason}"` : '""';

        const row = [
            t.type,
            t.mode || 'UNKNOWN',
            t.entryDate || '',
            t.closeDate || '',
            t.status || '',
            t.durationMinutes || 0,
            t.entry || 0,
            t.tp || 0,
            t.sl || 0,
            t.closePrice || '',
            t.marginMode || 'ISOLATED',
            t.availableCapitalBefore?.toFixed(2) || '',
            t.totalCapitalBefore?.toFixed(2) || '',
            t.marginUsed?.toFixed(2) || '',
            t.marginPercent?.toFixed(2) || '',
            t.leverage || '',
            t.pnlUSDT?.toFixed(2) || '',
            t.pnlPercent?.toFixed(2) || '',
            t.availableCapitalAfter?.toFixed(2) || '',
            t.totalCapitalAfter?.toFixed(2) || '',
            safeReason,
            t.analysisContext?.matrixScore?.toFixed(2) || '',
            t.analysisContext?.candles_quick || '',
            t.analysisContext?.candles_long || '',
            t.analysisContext?.quick_rsi?.toFixed(2) || '',
            t.analysisContext?.quick_macd?.toFixed(4) || '',
            t.analysisContext?.quick_macd_sig?.toFixed(4) || '',
            t.analysisContext?.quick_macd_hist?.toFixed(4) || '',
            t.analysisContext?.quick_bb_up?.toFixed(4) || '',
            t.analysisContext?.quick_bb_low?.toFixed(4) || '',
            t.analysisContext?.quick_stochRsi?.toFixed(2) || '',
            t.analysisContext?.quick_cci?.toFixed(2) || '',
            t.analysisContext?.quick_williamsR?.toFixed(2) || '',
            t.analysisContext?.quick_atr?.toFixed(4) || '',
            t.analysisContext?.quick_trend || '',
            t.analysisContext?.quick_pivot?.toFixed(2) || '',
            t.analysisContext?.quick_r1?.toFixed(2) || '',
            t.analysisContext?.quick_s1?.toFixed(2) || '',
            t.analysisContext?.quick_fib382?.toFixed(2) || '',
            t.analysisContext?.quick_fib618?.toFixed(2) || '',
            t.analysisContext?.quick_lastSwingHigh?.toFixed(2) || '',
            t.analysisContext?.quick_lastSwingLow?.toFixed(2) || '',
            t.analysisContext?.long_rsi?.toFixed(2) || '',
            t.analysisContext?.long_macd?.toFixed(4) || '',
            t.analysisContext?.long_macd_hist?.toFixed(4) || '',
            t.analysisContext?.long_trend || '',
            t.analysisContext?.long_pivot?.toFixed(2) || '',
            t.analysisContext?.long_r1?.toFixed(2) || '',
            t.analysisContext?.long_s1?.toFixed(2) || '',
            t.analysisContext?.long_fib382?.toFixed(2) || '',
            t.analysisContext?.long_fib618?.toFixed(2) || '',
            t.analysisContext?.long_lastSwingHigh?.toFixed(2) || '',
            t.analysisContext?.long_lastSwingLow?.toFixed(2) || '',
            t.analysisContext?.tf5m_rsi?.toFixed(2) || '',
            t.analysisContext?.tf5m_trend || '',
            t.analysisContext?.tf5m_pivot?.toFixed(2) || '',
            t.analysisContext?.tf5m_r1?.toFixed(2) || '',
            t.analysisContext?.tf5m_s1?.toFixed(2) || '',
            t.analysisContext?.tf5m_fib382?.toFixed(2) || '',
            t.analysisContext?.tf5m_fib618?.toFixed(2) || '',
            t.analysisContext?.tf5m_lastSwingHigh?.toFixed(2) || '',
            t.analysisContext?.tf5m_lastSwingLow?.toFixed(2) || '',

            t.analysisContext?.tf15m_rsi?.toFixed(2) || '',
            t.analysisContext?.tf15m_trend || '',
            t.analysisContext?.tf15m_pivot?.toFixed(2) || '',
            t.analysisContext?.tf15m_r1?.toFixed(2) || '',
            t.analysisContext?.tf15m_s1?.toFixed(2) || '',
            t.analysisContext?.tf15m_fib382?.toFixed(2) || '',
            t.analysisContext?.tf15m_fib618?.toFixed(2) || '',
            t.analysisContext?.tf15m_lastSwingHigh?.toFixed(2) || '',
            t.analysisContext?.tf15m_lastSwingLow?.toFixed(2) || '',

            t.analysisContext?.tf30m_rsi?.toFixed(2) || '',
            t.analysisContext?.tf30m_trend || '',
            t.analysisContext?.tf30m_pivot?.toFixed(2) || '',
            t.analysisContext?.tf30m_r1?.toFixed(2) || '',
            t.analysisContext?.tf30m_s1?.toFixed(2) || '',
            t.analysisContext?.tf30m_fib382?.toFixed(2) || '',
            t.analysisContext?.tf30m_fib618?.toFixed(2) || '',
            t.analysisContext?.tf30m_lastSwingHigh?.toFixed(2) || '',
            t.analysisContext?.tf30m_lastSwingLow?.toFixed(2) || '',

            t.analysisContext?.tf1h_rsi?.toFixed(2) || '',
            t.analysisContext?.tf1h_trend || '',
            t.analysisContext?.tf1h_pivot?.toFixed(2) || '',
            t.analysisContext?.tf1h_r1?.toFixed(2) || '',
            t.analysisContext?.tf1h_s1?.toFixed(2) || '',
            t.analysisContext?.tf1h_fib382?.toFixed(2) || '',
            t.analysisContext?.tf1h_fib618?.toFixed(2) || '',
            t.analysisContext?.tf1h_lastSwingHigh?.toFixed(2) || '',
            t.analysisContext?.tf1h_lastSwingLow?.toFixed(2) || '',

            t.analysisContext?.tf4h_rsi?.toFixed(2) || '',
            t.analysisContext?.tf4h_trend || '',
            t.analysisContext?.tf4h_pivot?.toFixed(2) || '',
            t.analysisContext?.tf4h_r1?.toFixed(2) || '',
            t.analysisContext?.tf4h_s1?.toFixed(2) || '',
            t.analysisContext?.tf4h_fib382?.toFixed(2) || '',
            t.analysisContext?.tf4h_fib618?.toFixed(2) || '',
            t.analysisContext?.tf4h_lastSwingHigh?.toFixed(2) || '',
            t.analysisContext?.tf4h_lastSwingLow?.toFixed(2) || '',

            t.analysisContext?.tf1d_rsi?.toFixed(2) || '',
            t.analysisContext?.tf1d_trend || '',
            t.analysisContext?.tf1d_pivot?.toFixed(2) || '',
            t.analysisContext?.tf1d_r1?.toFixed(2) || '',
            t.analysisContext?.tf1d_s1?.toFixed(2) || '',
            t.analysisContext?.tf1d_fib382?.toFixed(2) || '',
            t.analysisContext?.tf1d_fib618?.toFixed(2) || '',
            t.analysisContext?.tf1d_lastSwingHigh?.toFixed(2) || '',
            t.analysisContext?.tf1d_lastSwingLow?.toFixed(2) || ''
        ];

        if (!fullReportEnabled) {
            row.splice(24);
        }

        csvContent += row.join(',') + '\n';
    }

    // Prepend BOM for Excel utf-8 rendering
    return Buffer.from('\uFEFF' + csvContent, 'utf-8');
}

export const registerMessageHandlers = (bot: Telegraf, tradeManager: TradeManager) => {
    const bingxService = new BingXService();
    const analysisService = new AnalysisService(bingxService);
    const backtestService = new BacktestService(bingxService, analysisService);

    // ── نظام الاقتناص الذكي — فتح اللوحة الرئيسية ─────────────────────────────
    // يُرسل رسالة تحتوي زر inline يُفتح بـ snp_open (معالَج في sniperHandlers)
    bot.hears('🎯 نظام الاقتناص الذكي', async (ctx) => {
        try {
            const telegramId = ctx.from?.id.toString();
            if (!telegramId) return;
            const SniperWatch = require('../../models/SniperWatch').default;
            const { getSniperMainKeyboard } = require('../keyboards/sniperKeyboards');
            const user = await User.findOne({ telegramId });
            const count = user ? await SniperWatch.countDocuments({ userId: user._id, status: 'ACTIVE' }) : 0;
            await ctx.reply('🎯 *نظام الاقتناص الذكي*\n\nاختر ما تريد:', {
                parse_mode: 'Markdown',
                reply_markup: getSniperMainKeyboard(count)
            });
        } catch (e) { logger.error('sniper main menu error:', e); }
    });

    // ── مراقبة الصفقات الحية — فتح لوحة الرادار ───────────────────────────────
    bot.hears('📡 مراقبة الصفقات الحية', async (ctx) => {
        try {
            const telegramId = ctx.from?.id.toString();
            if (!telegramId) return;
            const user = await User.findOne({ telegramId });
            if (!user) return;

            const TradeModel = require('../../models/Trade').default;
            const TradeRadarModel = require('../../models/TradeRadar').default;

            const activeTrades = await TradeModel.find({
                // userId: user._id,
                currentStatus: { $in: ['OPEN', 'TP1_HIT', 'TP2_HIT'] }
            });
            const activeRadars = await TradeRadarModel.find({ userId: user._id, isActive: true });
            const monitoredIds = activeRadars.map((r: any) => r.tradeId.toString());

            const tradeRows = activeTrades.length > 0
                ? activeTrades.map((trade: any) => {
                    const isMonitored = monitoredIds.includes(trade._id.toString());
                    const sym = trade.symbol.split('/')[0];
                    const dirEmoji = trade.direction === 'LONG' ? '🟢' : '🔴';
                    const statusEmoji = isMonitored ? '📡' : '⭕';
                    return [{ text: `${statusEmoji} ${dirEmoji} ${sym} ${isMonitored ? '(مراقب)' : ''}`, callback_data: `radar_trade_${trade._id}` }];
                })
                : [[{ text: '📭 لا توجد صفقات مفتوحة', callback_data: 'radar_noop' }]];

            await ctx.reply('📡 *مراقبة الصفقات الحية*\n\nاختر صفقة لإدارة مراقبتها:', {
                parse_mode: 'Markdown',
                reply_markup: {
                    inline_keyboard: [
                        ...tradeRows,
                        [{ text: '⚙️ إعدادات المراقبة', callback_data: 'radar_default_settings' }],
                        [{ text: '🔙 إغلاق', callback_data: 'radar_close' }]
                    ]
                }
            });
        } catch (e) { logger.error('radar main menu error:', e); }
    });

    bot.start(async (ctx) => {
        const user = await User.findOne({ telegramId: ctx.from.id.toString() });
        const welcomeMsg = `🤖 <b>مرحباً بك في بوت التداول الآلي!</b>\n\n` +
            `أنا مساعدك الذكي لتنفيذ صفقات العملات الرقمية على منصة Bingx  بشكل آلي واحترافي.\n\n` +
            `🚀 <b>ماذا يمكنني أن أفعل لك؟</b>\n` +
            `• تنفيذ الصفقات فور استقبال الإشارات.\n` +
            `• إدارة المخاطر وحماية رأس المال.\n` +
            `• متابعة صفقاتك وعرض تقارير الأرباح.\n\n` +
            `استخدم القائمة أدناه للتحكم في كافة الإعدادات.`;

        ctx.replyWithHTML(welcomeMsg, {
            reply_markup: user ? getMainMenuKeyboard(user) : undefined
        });
    });

    bot.command('menu', async (ctx) => {
        try {
            const user = await User.findOne({ telegramId: ctx.from.id.toString() });
            if (!user) return;

            await ctx.reply('🤖 <b>قائمة التحكم - بوت التداول الآلي</b>\nاختر أحد الإجراءات التالية:', {
                parse_mode: 'HTML',
                reply_markup: getMainMenuKeyboard(user)
            }).catch(e => logger.error(`Failed to send menu: ${e.message}`));
        } catch (error) {
            logger.error('Error in /menu:', error);
        }
    });


    // Handle generic text messages (Signals, Cancellations, Report Dates)
    bot.on('message', async (ctx, next) => {
        try {
            if (!ctx.from || !('text' in ctx.message)) return next();

            const message = ctx.message.text;
            const telegramId = ctx.from.id.toString();
            const user = await User.findOne({ telegramId });

            if (!user) return next();

            // --- UNIVERSAL CANCEL ---
            if (message === 'إلغاء ❌' || message === 'رجوع للقائمة الرئيسية 🔙' || message === 'رجوع 🔙') {
                user.botState = 'NONE';
                await user.save();
                return ctx.reply('تم الإلغاء والعودة للقائمة الرئيسية.', { reply_markup: getMainMenuKeyboard(user) });
            }

            // 1. Check AWAITING States
            if (user.botState && user.botState.startsWith('AWAITING_SNIPER_SYMBOL')) {
                if (message === 'رجوع 🔙' || message === 'إلغاء ❌') {
                    user.botState = 'NONE';
                    await user.save();
                    const count = await require('../../models/SniperWatch').default.countDocuments({ userId: user._id, status: 'ACTIVE' });
                    const { getSniperMainKeyboard } = require('../keyboards/sniperKeyboards');
                    return ctx.reply('🎯 *نظام الاقتناص الذكي*\n\nاختر ما تريد:', {
                        parse_mode: 'Markdown',
                        reply_markup: getSniperMainKeyboard(count)
                    });
                }

                const symbolClean = message.trim().toUpperCase().replace('/USDT', '').replace(':USDT', '');
                if (symbolClean.length < 2 || symbolClean.length > 10) {
                    return ctx.reply('⚠️ رمز العملة غير صحيح. يرجى إدخال رمز صحيح (مثل: BTC أو ETH):');
                }

                const fullSymbol = `${symbolClean}/USDT:USDT`;
                const state = user.botState;
                user.botState = 'NONE';
                await user.save();

                if (state === 'AWAITING_SNIPER_SYMBOL') {
                    const { getSniperEngineKeyboard } = require('../keyboards/sniperKeyboards');
                    return ctx.reply(
                        `🎯 *اقتناص ${symbolClean}*\nاختر محرك الاقتناص:`,
                        {
                            parse_mode: 'Markdown',
                            reply_markup: getSniperEngineKeyboard(fullSymbol)
                        }
                    );
                } else {
                    // Format: AWAITING_SNIPER_SYMBOL_${actionType}_${engineId}
                    const parts = state.split('_');
                    const actionType = parts[3]; // 'instant' or 'add'
                    const engineId = parts[4]; // e.g. 'V8-SCALP'

                    if (actionType === 'instant') {
                        ctx.reply(`⏳ جاري تحليل ${symbolClean}...`);
                        const sniperManager = (bot as any).sniperManager;
                        if (!sniperManager) {
                            return ctx.reply('❌ فشل النظام، حاول مرة أخرى.');
                        }
                        const report = await sniperManager.instantReport(fullSymbol, engineId);
                        if (!report) {
                            return ctx.reply('❌ فشل جلب البيانات، حاول مرة أخرى.');
                        }
                        return ctx.reply(report.details, {
                            parse_mode: 'Markdown',
                            reply_markup: {
                                inline_keyboard: [
                                    ...(report.readyToFire ? [[
                                        { text: '⚡ تنفيذ فوري', callback_data: `snp_direct_exec_${fullSymbol}_${engineId}` }
                                    ]] : []),
                                    [{ text: `⏱ مراقبة واقتناص الفرص`, callback_data: `snp_watch_${fullSymbol}_${engineId}` }],
                                    [{ text: '🔙 القائمة الرئيسية', callback_data: 'snp_open' }]
                                ]
                            }
                        });
                    } else if (actionType === 'backtest') {
                        const { getSniperBacktestDaysKeyboard } = require('../keyboards/sniperKeyboards');
                        const engine = require('../../services/sniper/SniperRegistry').getSniperEngine(engineId);
                        return ctx.reply(
                            `🧪 *تحديد مدة الاختبار الرجعي*\nالمحرك: ${engine?.displayName || engineId}\nالعملة: ${symbolClean}/USDT:USDT\n\nاختر مدة الاختبار الرجعي:`,
                            {
                                parse_mode: 'Markdown',
                                reply_markup: getSniperBacktestDaysKeyboard(engineId, fullSymbol)
                            }
                        );
                    } else {
                        const { getSniperDurationKeyboard } = require('../keyboards/sniperKeyboards');
                        return ctx.reply(
                            `⏱ *تحديد مدة الاقتناص*\nالعملة: ${symbolClean}\nالمحرك: ${engineId}`,
                            {
                                parse_mode: 'Markdown',
                                reply_markup: getSniperDurationKeyboard(engineId, fullSymbol)
                            }
                        );
                    }
                }
            }

            if (user.botState === 'AWAITING_RISK_PERCENTAGE') {
                if (message === 'رجوع 🔙') {
                    user.botState = 'NONE';
                    await user.save();
                    return ctx.reply('تم الإلغاء.', { reply_markup: getTraderSettingsKeyboard(user) });
                }


                const riskValue = parseInt(message.replace('%', ''));
                if (!isNaN(riskValue) && riskValue >= 1 && riskValue <= 5) {
                    user.riskPercentage = riskValue;
                    user.botState = 'NONE';
                    await user.save();
                    return ctx.reply(`✅ تم تحديث نسبة المخاطرة إلى ${riskValue}%.`, {
                        reply_markup: getTraderSettingsKeyboard(user)
                    });

                } else {
                    return ctx.reply('يرجى إدخال رقم صحيح بين 1 و 5:');
                }
            }

            if (user.botState === 'AWAITING_TP_SPLITS') {
                if (message === 'رجوع 🔙') {
                    user.botState = 'NONE';
                    await user.save();
                    return ctx.reply('تم الإلغاء.', { reply_markup: getTraderSettingsKeyboard(user) });
                }

                const parts = message.replace(/,/g, ' ').split(/\s+/).filter(p => p.trim() !== '');
                const splits = parts.map(p => parseInt(p));
                const sum = splits.reduce((a, b) => a + b, 0);

                if (splits.some(isNaN) || sum !== 100 || splits.length === 0) {
                    return ctx.reply('⚠️ إدخال غير صحيح. الرجاء التأكد من إدخال أرقام صحيحة وأن المجموع يساوي 100.\nمثال: 50 30 20');
                }

                user.tpProfitSplits = splits;
                user.botState = 'NONE';
                await user.save();
                return ctx.reply(`✅ تم تحديث نسب تقسيم الأرباح بنجاح: ${splits.join('% - ')}%`, {
                    reply_markup: getTraderSettingsKeyboard(user)
                });
            }


            if (user.botState === 'AWAITING_CANCEL_ALL_CONFIRM') {
                if (message === 'نعم، متأكد ✅') {
                    ctx.reply('⏳ جاري إغلاق جميع الصفقات بسعر السوق...');
                    try {
                        const closedCount = await tradeManager.closeAllPositions(user._id.toString());
                        ctx.reply(`✅ تم بنجاح إغلاق ${closedCount} صفقات بسعر السوق.`, { reply_markup: getMainMenuKeyboard(user) });
                    } catch (error) {
                        ctx.reply('❌ حدث خطأ أثناء إغلاق الصفقات.', { reply_markup: getMainMenuKeyboard(user) });
                    }
                } else {
                    ctx.reply('تم الإلغاء.', { reply_markup: getMainMenuKeyboard(user) });
                }
                user.botState = 'NONE';
                await user.save();
                return;
            }

            if (user.botState === 'AWAITING_CANCEL_SYMBOL') {
                if (message === 'رجوع 🔙') {
                    user.botState = 'NONE';
                    await user.save();
                    ctx.reply('تم الإلغاء.', { reply_markup: getMainMenuKeyboard(user) });
                    return;
                }
                const symbol = message.toUpperCase();
                ctx.reply(`⏳ جاري محاولة إغلاق صفقة ${symbol} بسعر السوق...`);
                try {
                    const closed = await tradeManager.closeSpecificPosition(user._id.toString(), symbol);
                    if (closed) {
                        ctx.reply(`✅ تم بنجاح إغلاق صفقة ${symbol}.`, { reply_markup: getMainMenuKeyboard(user) });
                    } else {
                        ctx.reply(`⚠️ لم يتم العثور على صفقة مفتوحة للعملة ${symbol}.`, { reply_markup: getMainMenuKeyboard(user) });
                    }
                } catch (error) {
                    ctx.reply('❌ حدث خطأ، يرجى التأكد من الرمز (مثال: BTC).', { reply_markup: getMainMenuKeyboard(user) });
                }
                user.botState = 'NONE';
                await user.save();
                return;
            }

            if (user.botState === 'AWAITING_QUERY_SYMBOL') {
                if (message === 'رجوع 🔙') {
                    user.botState = 'NONE';
                    await user.save();
                    ctx.reply('تم الإلغاء.', { reply_markup: getMainMenuKeyboard(user) });
                    return;
                }

                // Let's forward the query logic back to the command simulation or manual trigger
                // Since `/status` logic was defined in trading, we reuse that logic basically.
                // We mock message to let the existing /status command handle it nicely if we want, or do inline.
                // It's cleaner to handle inline:
                const symbolInput = message.toUpperCase();
                try {
                    const trade = await Trade.findOne({
                        userId: user._id,
                        currentStatus: { $in: ['OPEN', 'TP1_HIT', 'TP2_HIT'] },
                        symbol: { $regex: symbolInput }
                    }).sort({ entryTime: -1 });

                    if (!trade) {
                        ctx.reply(`لا يوجد صفقة مفتوحة للعملة ${symbolInput}`, { reply_markup: getMainMenuKeyboard(user) });
                    } else {
                        ctx.reply(`يتم الاستعلام، جرب استخدام زر "صفقاتي المفتوحة" لمعرفة التفاصيل بديهيا.`, { reply_markup: getMainMenuKeyboard(user) });
                    }
                } catch (error) { }

                user.botState = 'NONE';
                await user.save();
                return;
            }

            if (user.botState === 'AWAITING_REPORT_DATE') {
                if (message === 'إلغاء ❌') {
                    user.botState = 'NONE';
                    await user.save();
                    ctx.reply('تم الإلغاء.', { reply_markup: getMainMenuKeyboard(user) });
                    return;
                }

                const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
                if (dateRegex.test(message)) {
                    const dateObj = new Date(message);
                    if (!isNaN(dateObj.getTime())) {
                        dateObj.setHours(0, 0, 0, 0); // Start of selected day
                        const nextDay = new Date(dateObj);
                        nextDay.setDate(dateObj.getDate() + 1);

                        ctx.reply(`⏳ جاري جلب التقرير المخصص لتاريخ ${message}...`, { reply_markup: getMainMenuKeyboard(user) });

                        // Quick inline resolution of the report to keep message handler clean, or delegate:
                        const trades = await Trade.find({
                            userId: user._id,
                            currentStatus: { $in: ['CLOSED_PROFIT', 'CLOSED_LOSS', 'CLOSED_MANUAL'] },
                            closeTime: { $gte: dateObj, $lt: nextDay }
                        }).sort({ closeTime: 1 });

                        let netPnl = 0;
                        trades.forEach(t => {
                            const margin = t.amount / (t.leverage || 10);
                            netPnl += margin * ((t.pnl || 0) / 100);
                        });

                        let msg = `📊 <b>تقرير مخصص ليوم ${message}</b>\n\n` +
                            `✅ إجمالي الصفقات المغلقة: <b>${trades.length}</b>\n` +
                            `💰 إجمالي مبلغ الربح/الخسارة: ${netPnl >= 0 ? '🟢' : '🔴'} <b>${netPnl.toFixed(2)} USDT</b>\n`;

                        ctx.replyWithHTML(msg).catch(e => logger.error(`Failed to send custom report: ${e.message}`));
                    } else {
                        ctx.reply('❌ تاريخ غير صحيح، يرجى الإلغاء والمحاولة مرة أخرى.');
                        return; // keep state
                    }
                } else {
                    ctx.reply('❌ صيغة التاريخ غير صحيحة، يرجى كتابتها بالشكل 2026-03-01');
                    return; // keep state
                }

                user.botState = 'NONE';
                await user.save();
                return;
            }

            if (user.botState === 'AWAITING_HITLAR_RISK') {
                if (message === 'رجوع 🔙') {
                    user.botState = 'NONE';
                    await user.save();
                    return ctx.reply('تم الإلغاء.', { reply_markup: getTraderSettingsKeyboard(user) });
                }

                const val = parseInt(message.replace('%', ''));
                if (!isNaN(val) && val >= 1 && val <= 100) {
                    user.hitlarSettings.riskPercentage = val;
                    user.botState = 'NONE';
                    await user.save();
                    return ctx.reply(`✅ تم تحديث نسبة الدخول لوضع هترل إلى ${val}%.`, { reply_markup: getTraderSettingsKeyboard(user) });

                } else {
                    return ctx.reply('يرجى إدخال رقم بين 1 و 100:');
                }
            }

            if (user.botState === 'AWAITING_HITLAR_LEV') {
                if (message === 'رجوع 🔙') {
                    user.botState = 'NONE';
                    await user.save();
                    return ctx.reply('تم الإلغاء.', { reply_markup: getTraderSettingsKeyboard(user) });
                }

                const val = parseInt(message.replace('x', ''));
                if (!isNaN(val) && val >= 1 && val <= 125) {
                    user.hitlarSettings.leverage = val;
                    user.botState = 'NONE';
                    await user.save();
                    return ctx.reply(`✅ تم تحديث الرافعة المالية لوضع هترل إلى x${val}.`, { reply_markup: getTraderSettingsKeyboard(user) });

                } else {
                    return ctx.reply('يرجى إدخال رقم بين 1 و 125:');
                }
            }

            if (user.botState === 'AWAITING_HITLAR_SL') {
                if (message === 'رجوع 🔙') {
                    user.botState = 'NONE';
                    await user.save();
                    return ctx.reply('تم الإلغاء.', { reply_markup: getTraderSettingsKeyboard(user) });
                }

                const val = parseInt(message.replace('%', ''));
                if (!isNaN(val) && val >= 1 && val <= 50) {
                    user.hitlarSettings.volatilitySlPercentage = val;
                    user.botState = 'NONE';
                    await user.save();
                    return ctx.reply(`✅ تم تحديث نسبة وقف الخسارة لوضع هترل إلى ${val}%.`, { reply_markup: getTraderSettingsKeyboard(user) });

                } else {
                    return ctx.reply('يرجى إدخال رقم بين 1 و 50:');
                }
            }

            if (user.botState === 'AWAITING_BTS_CAPITAL') {
                if (message === 'رجوع 🔙') {
                    user.botState = 'NONE';
                    await user.save();
                    return ctx.reply('تم الإلغاء.', { reply_markup: getBacktestSettingsKeyboard(user) });
                }

                const val = parseInt(message);
                if (!isNaN(val) && val >= 10) {
                    if (!user.backtestSettings) user.backtestSettings = { interval: '15m', initialCapital: 1000, marginMode: 'ISOLATED', leverage: 10, riskSizingEnabled: false, riskPercentage: 3, maxSlCapEnabled: false, maxSlPercentage: 5, fullReportEnabled: false };
                    user.backtestSettings.initialCapital = val;
                    user.botState = 'NONE';
                    await user.save();
                    return ctx.reply(`✅ تم تحديث رأس مال الاختبار الرجعي إلى ${val}$.`, { reply_markup: getBacktestSettingsKeyboard(user) });
                } else {
                    return ctx.reply('يرجى إدخال رقم صحيح أكبر من 10 (مثال: 5000):');
                }
            }

            if (user.botState === 'AWAITING_BTS_LEVERAGE') {
                if (message === 'رجوع 🔙') {
                    user.botState = 'NONE';
                    await user.save();
                    return ctx.reply('تم الإلغاء.', { reply_markup: getBacktestSettingsKeyboard(user) });
                }

                const val = parseInt(message.replace('x', ''));
                if (!isNaN(val) && val >= 1 && val <= 150) {
                    if (!user.backtestSettings) user.backtestSettings = { interval: '15m', initialCapital: 1000, marginMode: 'ISOLATED', leverage: 10, riskSizingEnabled: false, riskPercentage: 3, maxSlCapEnabled: false, maxSlPercentage: 5, fullReportEnabled: false };
                    user.backtestSettings.leverage = val;
                    user.botState = 'NONE';
                    await user.save();
                    return ctx.reply(`✅ تم تحديث رافعة الاختبار الرجعي إلى x${val}.`, { reply_markup: getBacktestSettingsKeyboard(user) });
                } else {
                    return ctx.reply('يرجى إدخال رقم صحيح بين 1 و 150 (مثال: 20):');
                }
            }

            if (user.botState === 'AWAITING_BTS_RISK') {
                if (message === 'رجوع 🔙') {
                    user.botState = 'NONE';
                    await user.save();
                    return ctx.reply('تم الإلغاء.', { reply_markup: getBacktestSettingsKeyboard(user) });
                }

                const val = parseInt(message.replace('%', ''));
                if (!isNaN(val) && val >= 1 && val <= 100) {
                    if (!user.backtestSettings) user.backtestSettings = { interval: '15m', initialCapital: 1000, marginMode: 'ISOLATED', leverage: 10, riskSizingEnabled: false, riskPercentage: 3, maxSlCapEnabled: false, maxSlPercentage: 5, fullReportEnabled: false };
                    user.backtestSettings.riskPercentage = val;
                    user.botState = 'NONE';
                    await user.save();
                    return ctx.reply(`✅ تم تحديث نسبة الدخول/المخاطرة للاختبار إلى ${val}%.`, { reply_markup: getBacktestSettingsKeyboard(user) });
                } else {
                    return ctx.reply('يرجى إدخال رقم صحيح بين 1 و 100 (مثال: 3):');
                }
            }

            if (user.botState === 'AWAITING_BTS_MAX_SL') {
                if (message === 'رجوع 🔙') {
                    user.botState = 'NONE';
                    await user.save();
                    return ctx.reply('تم الإلغاء.', { reply_markup: getBacktestSettingsKeyboard(user) });
                }

                const val = parseInt(message.replace('%', ''));
                if (!isNaN(val) && val >= 1 && val <= 100) {
                    if (!user.backtestSettings) user.backtestSettings = { interval: '15m', initialCapital: 1000, marginMode: 'ISOLATED', leverage: 10, riskSizingEnabled: false, riskPercentage: 3, maxSlCapEnabled: false, maxSlPercentage: 5, fullReportEnabled: false };
                    user.backtestSettings.maxSlPercentage = val;
                    user.botState = 'NONE';
                    await user.save();
                    return ctx.reply(`✅ تم تحديث أقصى نسبة للاستوب إلى ${val}%.`, { reply_markup: getBacktestSettingsKeyboard(user) });
                } else {
                    return ctx.reply('يرجى إدخال رقم صحيح بين 1 و 100 (مثال: 5):');
                }
            }

            if (message === '🔬 اختبار الاستراتيجيات') {
                user.botState = 'AWAITING_BT_SYMBOL';
                await user.save();
                return ctx.reply('يرجى إرسال رمز العملة الذي تريد اختباره (مثال: BTC):', {
                    reply_markup: { keyboard: [[{ text: 'إلغاء ❌' }]], resize_keyboard: true }
                });
            }

            if (user.botState === 'AWAITING_BT_SYMBOL') {
                if (message === 'إلغاء ❌' || message === 'رجوع للقائمة الرئيسية 🔙') {
                    user.botState = 'NONE';
                    await user.save();
                    return ctx.reply('تم الإلغاء.', { reply_markup: getMainMenuKeyboard(user) });
                }
                const symbol = message.toUpperCase();
                user.botState = 'NONE';
                await user.save();
                return ctx.reply(`اختر إصدار الخوارزمية لاختبار ${symbol}:`, {
                    reply_markup: getBacktestVersionKeyboard(symbol)
                });
            }

            // 2. Default: Attempt to parse signal
            const signal = SignalParser.parse(message);
            if (signal) {
                logger.info(`Received valid signal from ${ctx.from.username || telegramId}`);
                ctx.reply(`📡 تم التعرف على الإشارة (${signal.symbol} - ${signal.direction || signal.type}).\n⏳ جاري إرسال الطلب للمنصة...`);

                try {
                    const result = await tradeManager.executeSignal(signal, user._id.toString(), ctx.chat.id.toString());

                    if (signal.type === 'CLOSE') {
                        ctx.reply(`✅ تم إغلاق الصفقة (أو الصفقات) للعملة ${signal.symbol} بنجاح.`);
                    } else if (result) {
                        const precision = await bingxService.getPricePrecision(result.symbol);
                        const orderTypeLabel = result.orderType === 'limit'
                            ? `📌 حدي (Limit) عند ${result.entryPrice.toFixed(precision)}`
                            : '⚡ سوق (Market)';

                        let successMsg = result.isPending
                            ? `⏳ <b>تم وضع أمر حدي بنجاح — ينتظر التنفيذ!</b>
💡 سيتم وضع الأهداف والاستوب تلقائياً عند تنفيذ الأمر.\n\n`
                            : `✅ <b>تم تنفيذ الصفقة بنجاح على Bingx !</b>\n\n`;

                        successMsg +=
                            `الرمز: <b>${result.symbol}</b>\n` +
                            `الاتجاه: <b>${result.direction}</b>\n` +
                            `نوع التنفيذ: <b>${orderTypeLabel}</b>\n` +
                            `الرافعة المالية: <b>${result.leverage}x</b>\n` +
                            `المبلغ المستثمر (Margin): <b>${result.margin.toFixed(precision)} USDT</b> (${result.marginPercentage}% من رأس المال)\n` +
                            `سعر الدخول: <b>${result.entryPrice.toFixed(precision)}</b>\n\n`;

                        if (result.targets.length > 0) {
                            successMsg += `🎯 <b>الأهداف:</b>\n`;
                            result.targets.forEach((t, i) => {
                                successMsg += `الهدف ${i + 1}: ${t.price.toFixed(precision)} (+${t.pnlPercent.toFixed(2)}%)\n`;
                            });
                            successMsg += '\n';
                        }

                        successMsg += `🛑 <b>وقف الخسارة:</b> ${result.stopLoss.price.toFixed(precision)} (${result.stopLoss.pnlPercent.toFixed(2)}%)`;

                        await sendTelegramMessage(bot, ctx.chat.id, successMsg);

                        // Send notification to user's private bot if different from current chat
                        if (user.telegramId && user.telegramId !== ctx.chat.id.toString()) {
                            await sendTelegramMessage(bot, user.telegramId, successMsg)
                                .catch(e => logger.error(`Failed to send duplicate notification to user: ${e.message}`));
                        }
                    }
                } catch (error: any) {
                    logger.error(`Signal validation failed for ${ctx.from.username || telegramId}`, error);
                    ctx.reply(`❌ فشل تنفيذ الصفقة:\n${error.message}`);
                }
            } else {
                return next();
            }

        } catch (error) {
            logger.error('Error in general message handler:', error);
            ctx.reply('حدث خطأ غير متوقع.');
        }
    });

    // --- BACKTEST WIZARD CALLBACKS ---
    bot.action('btw_cancel', async (ctx) => {
        await ctx.answerCbQuery('تم الإلغاء');
        await ctx.deleteMessage().catch(() => { });
        const telegramId = ctx.from?.id.toString();
        const user = await User.findOne({ telegramId });
        if (user) {
            await ctx.reply('تم الإلغاء والعودة للقائمة الرئيسية.', { reply_markup: getMainMenuKeyboard(user) });
        }
    });

    bot.action(/^btw_v_(V[0-9]+)_(.+)$/, async (ctx) => {
        const version = ctx.match[1];
        const symbol = ctx.match[2];
        await ctx.editMessageText(`اختر نوع الاختبار (هل تريد اختبار الصفقات السريعة أم الاستثمارية؟)\nالإصدار: ${version} - العملة: ${symbol}:`, {
            reply_markup: getBacktestModeKeyboard(version, symbol)
        });
    });

    bot.action(/^btw_m_(SCALP|SWING)_(V[0-9]+)_(.+)$/, async (ctx) => {
        const mode = ctx.match[1];
        const version = ctx.match[2];
        const symbol = ctx.match[3];
        const modeText = mode === 'SCALP' ? 'سكالبينج ⚡️' : 'سوينج 🌊';

        await ctx.editMessageText(`اختر الفاصل الزمني للتحليل (كل كم دقيقة تريد أن يحلل البوت؟)\nالنوع: ${modeText} - الإصدار: ${version} - العملة: ${symbol}:`, {
            reply_markup: getBacktestIntervalKeyboard(mode, version, symbol)
        });
    });


    bot.action(/^btw_i_([0-9]+[mh])_(SCALP|SWING)_(V[0-9]+)_(.+)$/, async (ctx) => {
        const interval = ctx.match[1];
        const mode = ctx.match[2];
        const version = ctx.match[3];
        const symbol = ctx.match[4];

        await ctx.editMessageText(`اختر مدة الاختبار (كم يوم للوراء؟)\nالفاصل: كل ${interval} - الإصدار: ${version} - العملة: ${symbol}:`, {
            reply_markup: getBacktestDaysKeyboard(interval, mode, version, symbol)
        });
    });

    bot.action(/^btw_d_([0-9.]+)_([0-9]+[mh])_(SCALP|SWING)_(V[0-9]+)_(.+)$/, async (ctx) => {
        try {
            const days = parseFloat(ctx.match[1]);
            const interval = ctx.match[2];
            const mode = ctx.match[3] as 'SCALP' | 'SWING';
            const version = ctx.match[4];
            const s = ctx.match[5];
            const symbol = `${s}/USDT:USDT`;

            await ctx.answerCbQuery(`⏳ جاري تشغيل اختبار الاستراتيجية (${version})...`);
            await ctx.editMessageText(`🔍 جاري تشغيل الاختبار الرجعي لـ ${symbol}...\nالفاصل: ${interval}\nإصدار: ${version}\nالمدة: ${days} أيام\n\nيرجى الانتظار، قد يستغرق هذا بعض الوقت...`);

            const telegramId = ctx.from?.id.toString();
            const user = await User.findOne({ telegramId });

            const bts = user?.backtestSettings;
            const result = await backtestService.runAdvancedBacktest(symbol, version, {
                quickTF: mode === 'SCALP' ? interval : (user?.analysisSettings?.scalpTF || '5m'),
                longTF: mode === 'SCALP' ? (user?.analysisSettings?.swingTF || '1h') : interval,
                days: days,
                stepMinutes: interval.endsWith('h') ? parseInt(interval) * 60 : parseInt(interval),
                mode: mode,
                initialCapital: bts?.initialCapital ?? 1000,
                marginPerTradePercentage: bts?.riskPercentage ?? 3,
                marginMode: bts?.marginMode ?? 'ISOLATED',
                leverage: bts?.leverage ?? 10,
                riskSizingEnabled: bts?.riskSizingEnabled ?? false,
                maxSlCapEnabled: bts?.maxSlCapEnabled ?? false,
                maxSlPercentage: bts?.maxSlPercentage ?? 5,
            });

            if (user) {
                await ctx.reply(result.reportText, { parse_mode: 'Markdown', reply_markup: getMainMenuKeyboard(user) });
            } else {
                await ctx.reply(result.reportText, { parse_mode: 'Markdown' });
            }

            if (result.trades && result.trades.length > 0) {
                const csvBuffer = generateCSVBuffer(result.trades);
                const safeSymbol = symbol.replace(/[\/:]/g, '_');
                const now = new Date();
                const dateStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}_${String(now.getHours()).padStart(2, '0')}-${String(now.getMinutes()).padStart(2, '0')}`;
                const fileName = `Backtest_${version}_${mode}_${safeSymbol}_${dateStr}.csv`;
                await ctx.replyWithDocument({ source: csvBuffer, filename: fileName });
            } else {
                await ctx.reply('⚠️ لم يتم تنفيذ أي صفقات خلال فترة الاختبار.');
            }

            await ctx.deleteMessage().catch(() => {});
        } catch (error: any) {
            logger.error('Error in backtest wizard run action:', error);
            await ctx.reply(`❌ فشل تشغيل الاختبار الرجعي: ${error.message}`);
        }
    });
};
