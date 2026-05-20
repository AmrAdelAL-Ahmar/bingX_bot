import { Telegraf } from 'telegraf';
import logger from '../../utils/logger';
import User from '../../models/User';
import Trade from '../../models/Trade';
import { getMainMenuKeyboard, getTraderSettingsKeyboard, getAlgoVersionKeyboard, getAnalysisActionKeyboard, getAnalysisSettingsKeyboard, getTFSelectionKeyboard, getLimitSelectionKeyboard, getRSISelectionKeyboard, getBacktestVersionKeyboard, getBacktestModeKeyboard, getBacktestIntervalKeyboard, getBacktestDaysKeyboard, getBacktestSettingsKeyboard } from '../keyboards/baseKeyboards';
import { AnalysisService } from '../../services/AnalysisService';
import { BingXService } from '../../services/BingXService';
import { BacktestService } from '../../services/BacktestService';

import { SignalParser } from '../../services/SignalParser';
import { TradeManager } from '../../services/TradeManager';
import { sendTelegramMessage } from '../../utils/telegram';

function generateCSVBuffer(trades: any[], fullReportEnabled: boolean = false): Buffer {
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
    bot.on('message', async (ctx) => {
        try {
            if (!ctx.from || !('text' in ctx.message)) return;

            const message = ctx.message.text;
            const telegramId = ctx.from.id.toString();
            const user = await User.findOne({ telegramId });

            if (!user) return;

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

            // --- SMART ANALYSIS FLOW ---
            if (message === '📊 التحليل الذكي (V1/V2)') {
                return ctx.reply('الرجاء اختيار إصدار خوارزمية التحليل التي تود استخدامها:', {
                    reply_markup: getAlgoVersionKeyboard()
                });
            }

            if (message === 'دليل الخوارزميات 📖') {
                const guide = `📖 **دليل الخوارزميات (V1-V7):**\n\n` +
                    `${analysisService.getAlgorithmExplanation('V1')}\n\n` +
                    `${analysisService.getAlgorithmExplanation('V2')}\n\n` +
                    `${analysisService.getAlgorithmExplanation('V3')}\n\n` +
                    `${analysisService.getAlgorithmExplanation('V4')}\n\n` +
                    `${analysisService.getAlgorithmExplanation('V5')}\n\n` +
                    `${analysisService.getAlgorithmExplanation('V6')}\n\n` +
                    `${analysisService.getAlgorithmExplanation('V7')}`;
                return ctx.reply(guide);
            }

            if (message === 'الخوارزمية V1 (الأساسي)') {
                user.botState = 'AWAITING_ANALYSIS_SYMBOL_V1';
                await user.save();
                return ctx.reply('يرجى إرسال رمز العملة للتحليل باستخدام V1 (مثال: BTC):', {
                    reply_markup: { keyboard: [[{ text: 'إلغاء ❌' }]], resize_keyboard: true }
                });
            }

            if (message === 'الخوارزمية V2 (الكمي - Quant)') {
                user.botState = 'AWAITING_ANALYSIS_SYMBOL_V2';
                await user.save();
                return ctx.reply('يرجى إرسال رمز العملة للتحليل باستخدام V2 (مثال: BTC):', {
                    reply_markup: { keyboard: [[{ text: 'إلغاء ❌' }]], resize_keyboard: true }
                });
            }

            if (message === 'الخوارزمية V3 (المصفوفة)') {
                user.botState = 'AWAITING_ANALYSIS_SYMBOL_V3';
                await user.save();
                return ctx.reply('يرجى إرسال رمز العملة للتحليل باستخدام V3 (مثال: BTC):', {
                    reply_markup: { keyboard: [[{ text: 'إلغاء ❌' }]], resize_keyboard: true }
                });
            }

            if (message === 'الخوارزمية V4 (ثنائي الاتجاه)') {
                user.botState = 'AWAITING_ANALYSIS_SYMBOL_V4';
                await user.save();
                return ctx.reply('يرجى إرسال رمز العملة للتحليل باستخدام V4 (مثال: BTC):', {
                    reply_markup: { keyboard: [[{ text: 'إلغاء ❌' }]], resize_keyboard: true }
                });
            }

            if (message === 'الخوارزمية V5 (تنبؤي AI) 🔮') {
                user.botState = 'AWAITING_ANALYSIS_SYMBOL_V5';
                await user.save();
                return ctx.reply('يرجى إرسال رمز العملة للتحليل باستخدام V5 (التنبؤي) (مثال: BTC):', {
                    reply_markup: { keyboard: [[{ text: 'إلغاء ❌' }]], resize_keyboard: true }
                });
            }

            if (message === 'الخوارزمية V6 (Sniper) 🎯') {
                user.botState = 'AWAITING_ANALYSIS_SYMBOL_V6';
                await user.save();
                return ctx.reply('يرجى إرسال رمز العملة للتحليل باستخدام V6 (Sniper) 🎯 (مثال: BTC):', {
                    reply_markup: { keyboard: [[{ text: 'إلغاء ❌' }]], resize_keyboard: true }
                });
            }

            if (message === 'الخوارزمية V7 (القناص الهجيني) 🏹') {
                user.botState = 'AWAITING_ANALYSIS_SYMBOL_V7';
                await user.save();
                return ctx.reply('يرجى إرسال رمز العملة للتحليل باستخدام V7 (القناص الهجيني) 🏹 (مثال: BTC):', {
                    reply_markup: { keyboard: [[{ text: 'إلغاء ❌' }]], resize_keyboard: true }
                });
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

            if (user.botState && user.botState.startsWith('AWAITING_ANALYSIS_SYMBOL_')) {
                if (message === 'إلغاء ❌' || message === 'رجوع للقائمة الرئيسية 🔙') {
                    user.botState = 'NONE';
                    await user.save();
                    return ctx.reply('تم الإلغاء.', { reply_markup: getMainMenuKeyboard(user) });
                }

                const version = user.botState.split('_').pop() as 'V1' | 'V2' | 'V3' | 'V4' | 'V5' | 'V6' | 'V7';
                const symbol = message.toUpperCase();
                ctx.reply(`⏳ جاري تحليل ${symbol} باستخدام ${version}... (TF: ${user.analysisSettings?.scalpTF || '5m'}/${user.analysisSettings?.swingTF || '1h'})`);

                try {
                    const result = await analysisService.analyze(symbol, version, {
                        quickTF: user.analysisSettings?.scalpTF,
                        longTF: user.analysisSettings?.swingTF,
                        limit: user.analysisSettings?.candleLimit,
                        rsiThreshold: user.analysisSettings?.rsiThreshold
                    });
                    const report = analysisService.formatReport(result, version);

                    // Send the report with a button for comprehensive analysis
                    const shortSym = symbol.split('/')[0];
                    await ctx.replyWithHTML(report, {
                        reply_markup: {
                            inline_keyboard: [[{ text: '📊 التحليل الشامل (MTF)', callback_data: `all_tf_${shortSym}_${version}` }]]
                        }
                    });

                    // Send buttons for Scalp
                    if (result.scalp.type !== 'NONE') {
                        await ctx.reply(`⚡ **إجراءات سريعة لصفقة Scalp:**`, {
                            reply_markup: getAnalysisActionKeyboard(symbol, 'scalp', {
                                direction: result.scalp.type,
                                entry: result.scalp.entry,
                                tp: result.scalp.tp,
                                sl: result.scalp.sl,
                                p: result.pricePrecision
                            }, version)
                        });
                    }

                    // Send buttons for Swing
                    if (result.swing.type !== 'NONE') {
                        await ctx.reply(`🌊 **إجراءات لصفقة Swing:**`, {
                            reply_markup: getAnalysisActionKeyboard(symbol, 'swing', {
                                direction: result.swing.type,
                                entry: result.swing.entry,
                                tp: result.swing.tp,
                                sl: result.swing.sl,
                                p: result.pricePrecision
                            }, version)
                        });
                    }

                    user.botState = 'NONE';
                    await user.save();
                    return ctx.reply('يمكنك الآن تنفيذ الصفقة أو نسخ الإشارة من الأزرار أعلاه.', { reply_markup: getMainMenuKeyboard(user) });

                } catch (error: any) {
                    logger.error(`Analysis failed for ${symbol}:`, error);
                    ctx.reply(`❌ فشل التحليل: ${error.message}`, { reply_markup: getMainMenuKeyboard(user) });
                    user.botState = 'NONE';
                    await user.save();
                    return;
                }
            }

            // --- ANALYSIS SETTINGS FLOW ---
            if (message === '⚙️ إعدادات المحلل الذكي') {
                return ctx.reply('إعدادات المحلل الذكي: يمكنك تخصيص الفريمات الزمنية وعدد الشمعات المستخدمة في التحليل.', {
                    reply_markup: getAnalysisSettingsKeyboard()
                });
            }

            if (message === '⏱️ فريم السكالبينج') {
                return ctx.reply('اختر فريم السكالبينج المفضل:', {
                    reply_markup: getTFSelectionKeyboard('scalp')
                });
            }

            if (message === '🌊 فريم السوينج') {
                return ctx.reply('اختر فريم السوينج المفضل:', {
                    reply_markup: getTFSelectionKeyboard('swing')
                });
            }

            if (message === '📊 عدد الشمعات (Limit)') {
                return ctx.reply('اختر عدد الشمعات التاريخية لتحليلها:', {
                    reply_markup: getLimitSelectionKeyboard()
                });
            }

            if (message === '📉 مؤشر RSI Threshold') {
                return ctx.reply('اختر قيمة RSI المفضلة (قيمة أقل = شروط دخول أقسى، قيمة أعلى = دخول أسرع):', {
                    reply_markup: getRSISelectionKeyboard()
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

    bot.action(/^btw_v_(V[1-7])_(.+)$/, async (ctx) => {
        const version = ctx.match[1];
        const symbol = ctx.match[2];
        await ctx.editMessageText(`اختر نوع الاختبار (هل تريد اختبار الصفقات السريعة أم الاستثمارية؟)\nالإصدار: ${version} - العملة: ${symbol}:`, {
            reply_markup: getBacktestModeKeyboard(version, symbol)
        });
    });

    bot.action(/^btw_m_(SCALP|SWING)_(V[1-7])_(.+)$/, async (ctx) => {
        const mode = ctx.match[1];
        const version = ctx.match[2];
        const symbol = ctx.match[3];
        const modeText = mode === 'SCALP' ? 'سكالبينج ⚡️' : 'سوينج 🌊';

        await ctx.editMessageText(`اختر الفاصل الزمني للتحليل (كل كم دقيقة تريد أن يحلل البوت؟)\nالنوع: ${modeText} - الإصدار: ${version} - العملة: ${symbol}:`, {
            reply_markup: getBacktestIntervalKeyboard(mode, version, symbol)
        });
    });

    bot.action(/^btw_i_([0-9]+[mh])_(SCALP|SWING)_(V[1-7])_(.+)$/, async (ctx) => {
        const interval = ctx.match[1];
        const mode = ctx.match[2];
        const version = ctx.match[3];
        const symbol = ctx.match[4];

        await ctx.editMessageText(`اختر مدة الاختبار (كم يوم للوراء؟)\nالفاصل: كل ${interval} - الإصدار: ${version} - العملة: ${symbol}:`, {
            reply_markup: getBacktestDaysKeyboard(interval, mode, version, symbol)
        });
    });

    bot.action(/^btw_d_([0-9.]+)_([0-9]+[mh])_(SCALP|SWING)_(V[1-7])_(.+)$/, async (ctx) => {
        const days = parseFloat(ctx.match[1]);
        const interval = ctx.match[2];
        const mode = ctx.match[3] as 'SCALP' | 'SWING';
        const version = ctx.match[4];
        const symbolInput = ctx.match[5];

        const symbol = symbolInput.includes('/') ? symbolInput : `${symbolInput}/USDT:USDT`;

        // Parse stepMinutes from interval
        let stepMinutes = 15;
        if (interval.endsWith('m')) stepMinutes = parseInt(interval.replace('m', ''));
        if (interval.endsWith('h')) stepMinutes = parseInt(interval.replace('h', '')) * 60;

        const modeText = mode === 'SCALP' ? 'سكالبينج ⚡️' : 'سوينج 🌊';

        const telegramId = ctx.from?.id.toString();
        const user = await User.findOne({ telegramId });

        const bs = user?.backtestSettings || {
            initialCapital: 1000, marginMode: 'ISOLATED', leverage: 10,
            riskSizingEnabled: false, riskPercentage: 3, maxSlCapEnabled: false, maxSlPercentage: 5, fullReportEnabled: false
        };

        const marginModeText = bs.marginMode === 'CROSS' ? 'متبادل (Cross)' : 'معزول (Isolated)';

        try {
            await ctx.editMessageText(`⏳ جاري إجراء الاختبار الرجعي المتقدم...\nالعملة: ${symbol}\nالإصدار: ${version}\nالنوع: ${modeText}\nالوضع: ${marginModeText}\nإدارة المخاطر بالاستوب: ${bs.riskSizingEnabled ? '✅' : '❌'}\nفاصل التحليل: كل ${stepMinutes} دقيقة\nمدة الاختبار: آخر ${days} أيام\nرأس المال: ${bs.initialCapital}$\n\n*(يرجى الانتظار، قد يستغرق الأمر بعض الوقت...)*`);
        } catch (e) { }

        await ctx.answerCbQuery('بدأ الاختبار الرجعي...').catch(() => { });

        // Execute backtest asynchronously to prevent Telegram Webhook timeouts
        (async () => {
            try {
                const result = await backtestService.runAdvancedBacktest(symbol, version, {
                    quickTF: user?.analysisSettings?.scalpTF || '5m',
                    longTF: user?.analysisSettings?.swingTF || '1h',
                    days: days,
                    stepMinutes: stepMinutes,
                    mode: mode,
                    initialCapital: bs.initialCapital,
                    marginPerTradePercentage: bs.riskPercentage,
                    marginMode: bs.marginMode,
                    leverage: bs.leverage,
                    riskSizingEnabled: bs.riskSizingEnabled,
                    maxSlCapEnabled: bs.maxSlCapEnabled,
                    maxSlPercentage: bs.maxSlPercentage,
                    fullReportEnabled: bs.fullReportEnabled
                });

                if (user) {
                    await ctx.reply(result.reportText, { parse_mode: 'Markdown', reply_markup: getMainMenuKeyboard(user) });
                } else {
                    await ctx.reply(result.reportText, { parse_mode: 'Markdown' });
                }

                if (result.trades && result.trades.length > 0) {
                    const csvBuffer = generateCSVBuffer(result.trades, bs.fullReportEnabled);
                    const safeSymbol = symbol.replace(/[\/:]/g, '_');
                    const now = new Date();
                    const dateStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}_${String(now.getHours()).padStart(2, '0')}-${String(now.getMinutes()).padStart(2, '0')}`;
                    const fileName = `Backtest_${version}_${mode}_${safeSymbol}_${dateStr}.csv`;
                    await ctx.replyWithDocument({ source: csvBuffer, filename: fileName });
                }

            } catch (error: any) {
                logger.error('Error in advanced backtest wizard:', error);
                await ctx.reply(`❌ فشل الاختبار: ${error.message}`);
            }
        })();
    });

    // --- CALLBACK HANDLERS FOR ANALYSIS ACTIONS ---
    bot.action(/^cp_(sc|sw)_(.+)$/, async (ctx) => {
        try {
            const [_, type, rest] = ctx.match;
            const [s, d, e, t1, sl, t2] = rest.split('_');
            const targets = [parseFloat(t1)];
            if (t2 && t2 !== '0') targets.push(parseFloat(t2));
            const precision = await bingxService.getPricePrecision(`${s}/USDT:USDT`);
            const signalText = analysisService.formatSignalText(
                `${s}/USDT:USDT`,
                d === 'L' ? 'LONG' : 'SHORT',
                parseFloat(e),
                targets,
                parseFloat(sl),
                25, // Default leverage
                precision
            );
            await ctx.replyWithMarkdown(signalText);
            await ctx.answerCbQuery('تم إنشاء نموذج ا لإشارة ✅');
        } catch (error: any) {
            logger.error('Error in copy signal action:', error);
            await ctx.answerCbQuery('❌ حدث خطأ أثناء إنشاء الإشارة');
        }
    });

    bot.action(/^ex_(sc|sw)_(.+)$/, async (ctx) => {
        try {
            const [_, type, rest] = ctx.match;
            const [s, d, e, t1, sl, t2] = rest.split('_');
            const telegramId = ctx.from!.id.toString();
            const user = await User.findOne({ telegramId });

            if (!user) return ctx.answerCbQuery('لم يتم العثور على المستخدم');

            const targets = [parseFloat(t1)];
            if (t2 && t2 !== '0') targets.push(parseFloat(t2));

            const signal = {
                type: 'TRADE',
                symbol: `${s}/USDT:USDT`,
                direction: d === 'L' ? 'LONG' : 'SHORT',
                entry: [parseFloat(e)],
                targets: targets,
                stopLoss: parseFloat(sl)
            };

            ctx.answerCbQuery('⏳ جاري تنفيذ الصفقة...');
            await tradeManager.executeSignal(signal as any, user._id.toString(), ctx.chat!.id.toString());

        } catch (error: any) {
            logger.error('Error in execute trade action:', error);
            await ctx.answerCbQuery(`❌ فشل التنفيذ: ${error.message}`);
        }
    });

    bot.action(/^bt_(sc|sw)_(.+)$/, async (ctx) => {
        try {
            const [_, type, rest] = ctx.match;
            const [s, version] = rest.split('_');
            const symbol = `${s}/USDT:USDT`;

            await ctx.answerCbQuery(`⏳ جاري تشغيل الاختبار الرجعي (${version || 'V6'})...`);
            await ctx.reply(`🔍 جاري تحليل البيانات التاريخية لـ ${symbol}... قد يستغرق ذلك بضع ثوانٍ.`);

            const telegramId = ctx.from?.id.toString();
            const user = await User.findOne({ telegramId });

            const mode: 'SCALP' | 'SWING' = type === 'sc' ? 'SCALP' : 'SWING';

            const result = await backtestService.runAdvancedBacktest(symbol, version, {
                quickTF: user?.analysisSettings?.scalpTF || '5m',
                longTF: user?.analysisSettings?.swingTF || '1h',
                days: 1, // Quick test uses 1 day
                stepMinutes: 30, // Default to 30 mins
                mode: mode
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
            }

        } catch (error: any) {
            logger.error('Error in backtest action:', error);
            await ctx.reply(`❌ فشل الاختبار الرجعي: ${error.message}`);
        }
    });

    bot.action(/^dt_(sc|sw)_(.+)$/, async (ctx) => {
        try {
            const [_, type, rest] = ctx.match;
            const parts = rest.split('_');
            const s = parts[0];
            const d = parts[1] === 'L' ? 'LONG' : 'SHORT';
            const v = parts[2] || 'V6';
            const symbol = `${s}/USDT:USDT`;

            await ctx.answerCbQuery(`⏳ جاري جلب التقرير التفصيلي (${v})...`);

            // Re-run analysis to get the latest details
            const user = await User.findOne({ telegramId: ctx.from!.id.toString() });
            const res = await analysisService.analyze(symbol, v as any, {
                quickTF: user?.analysisSettings?.scalpTF,
                longTF: user?.analysisSettings?.swingTF
            });

            const details = analysisService.generateDetailedReport(res, type === 'sc' ? 'scalp' : 'swing');
            await ctx.reply(details, { parse_mode: 'Markdown' });

        } catch (error) {
            logger.error('Error in details action:', error);
            await ctx.reply('❌ فشل جلب التقرير التقني.');
        }
    });

    bot.action(/^ed_(sc|sw)_(.+)$/, async (ctx) => {
        try {
            const [_, type, rest] = ctx.match;
            const parts = rest.split('_');
            const s = parts[0];
            const v = parts[1] || 'V6';
            const symbol = `${s}/USDT:USDT`;
            await ctx.answerCbQuery('📚 جاري فتح الدليل التعليمي...');

            const user = await User.findOne({ telegramId: ctx.from!.id.toString() });
            const res = await analysisService.analyze(symbol, v as any, {
                quickTF: user?.analysisSettings?.scalpTF,
                longTF: user?.analysisSettings?.swingTF
            });

            const guide = analysisService.generateEducationalGuide(res, type === 'sc' ? 'scalp' : 'swing');
            await ctx.reply(guide, { parse_mode: 'Markdown' });
        } catch (error) {
            logger.error('Error in educational guide action:', error);
            await ctx.reply('❌ فشل جلب الدليل التعليمي.');
        }
    });

    // --- ANALYSIS SETTINGS ACTIONS ---
    bot.action(/^sc_tf_(.+)$/, async (ctx) => {
        try {
            const tf = ctx.match[1];
            const user = await User.findOne({ telegramId: ctx.from!.id.toString() });
            if (user) {
                user.analysisSettings.scalpTF = tf;
                await user.save();
                await ctx.answerCbQuery(`✅ تم تحديد فريم السكالبينج: ${tf}`);
                await ctx.editMessageText(`✅ تم تحديث فريم السكالبينج بنجاح إلى: **${tf}**`, { parse_mode: 'Markdown' });
            }
        } catch (error) {
            logger.error('Error updating scalp TF:', error);
        }
    });

    bot.action(/^sw_tf_(.+)$/, async (ctx) => {
        try {
            const tf = ctx.match[1];
            const user = await User.findOne({ telegramId: ctx.from!.id.toString() });
            if (user) {
                user.analysisSettings.swingTF = tf;
                await user.save();
                await ctx.answerCbQuery(`✅ تم تحديد فريم السوينج: ${tf}`);
                await ctx.editMessageText(`✅ تم تحديث فريم السوينج بنجاح إلى: **${tf}**`, { parse_mode: 'Markdown' });
            }
        } catch (error) {
            logger.error('Error updating swing TF:', error);
        }
    });

    bot.action(/^limit_(\d+)$/, async (ctx) => {
        try {
            const limit = parseInt(ctx.match[1]);
            const user = await User.findOne({ telegramId: ctx.from!.id.toString() });
            if (user) {
                user.analysisSettings.candleLimit = limit;
                await user.save();
                await ctx.answerCbQuery(`✅ تم تحديد عدد الشمعات: ${limit}`);
                await ctx.editMessageText(`✅ تم تحديث عدد الشمعات للتحليل بنجاح إلى: **${limit}**`, { parse_mode: 'Markdown' });
            }
        } catch (error) {
            logger.error('Error updating candle limit:', error);
        }
    });

    bot.action(/^rsi_(\d+)$/, async (ctx) => {
        try {
            const rsi = parseInt(ctx.match[1]);
            const user = await User.findOne({ telegramId: ctx.from!.id.toString() });
            if (user) {
                user.analysisSettings.rsiThreshold = rsi;
                await user.save();
                await ctx.answerCbQuery(`✅ تم تحديد RSI Threshold: ${rsi}`);
                await ctx.editMessageText(`✅ تم تحديث قيمة RSI للدخول بنجاح إلى: **${rsi}**`, { parse_mode: 'Markdown' });
            }
        } catch (error) {
            logger.error('Error updating RSI threshold:', error);
        }
    });

    bot.action(/^all_tf_(.+)$/, async (ctx) => {
        try {
            const rest = ctx.match[1];
            const parts = rest.split('_');
            const s = parts[0];
            const v = parts[1] || 'V6';
            const symbol = `${s}/USDT:USDT`;
            await ctx.answerCbQuery(`🌐 جاري توليد التحليل الشامل (${v})...`);

            const user = await User.findOne({ telegramId: ctx.from!.id.toString() });
            const res = await analysisService.analyze(symbol, v as any, {
                quickTF: user?.analysisSettings?.scalpTF,
                longTF: user?.analysisSettings?.swingTF
            });

            const comprehensiveReport = analysisService.generateComprehensiveReport(res);
            await ctx.reply(comprehensiveReport, { parse_mode: 'Markdown' });

        } catch (error) {
            logger.error('Error in comprehensive analysis action:', error);
            await ctx.reply('❌ فشل توليد التحليل الشامل.');
        }
    });

    // Handle Correction Check
    bot.action(/^cor_ck_(.+)$/, async (ctx) => {
        try {
            const rest = ctx.match[1];
            const parts = rest.split('_');
            const s = parts[0];
            const d = parts[1] === 'L' ? 'LONG' : 'SHORT';
            const v = parts[2] || 'V6';

            const symbol = s.includes('/') ? s : `${s}/USDT:USDT`;
            await ctx.answerCbQuery(`🔍 جاري فحص رادار التصحيح (${v})...`);

            const user = await User.findOne({ telegramId: ctx.from!.id.toString() });
            const res = await analysisService.analyze(symbol, v as any, {
                quickTF: user?.analysisSettings?.scalpTF,
                longTF: user?.analysisSettings?.swingTF
            });

            const correctionReport = await analysisService.generateCorrectionReport(res, d);

            await ctx.reply(correctionReport, { parse_mode: 'Markdown' });

        } catch (error) {
            logger.error('Error in correction check action:', error);
            await ctx.reply('❌ فشل فحص رادار التصحيح.');
        }
    });

    // Handle Correction Alert Toggle
    bot.action(/^cor_al_(.+)$/, async (ctx) => {
        try {
            const symbol = ctx.match[1].includes('/') ? ctx.match[1] : `${ctx.match[1]}/USDT:USDT`;
            const user = await User.findOne({ telegramId: ctx.from!.id.toString() });

            if (!user) {
                return await ctx.reply('❌ مستخدم غير مسجل.');
            }

            const userId = user._id;

            // Find the most recent active trade for this symbol
            const activeTrade = await Trade.findOne({
                userId,
                symbol,
                currentStatus: { $in: ['OPEN', 'TP1_HIT', 'TP2_HIT', 'TP3_HIT'] }
            }).sort({ entryTime: -1 });

            if (!activeTrade) {
                return await ctx.reply('❌ لم يتم العثور على صفقة مفتوحة نشطة لهذه العملة لتفعيل التنبيه لها.');
            }

            activeTrade.correctionAlertEnabled = true;
            activeTrade.correctionWarningSent = false; // Reset warning if reactivating
            await activeTrade.save();

            await ctx.answerCbQuery('🔔 تم تفعيل تنبيه التصحيح');
            await ctx.reply(`✅ **تم تفعيل مراقبة التصحيح لعملة ${activeTrade.symbol}**\n\nسأقوم بتنبيهك فوراً في حال كسر الـ Pivot أو ظهور انحراف سلبي حاد على الفريمات الصغيرة لحماية أرباحك.`, { parse_mode: 'Markdown' });

        } catch (error) {
            logger.error('Error in correction alert action:', error);
            await ctx.reply('❌ فشل تفعيل تنبيه التصحيح.');
        }
    });
};
