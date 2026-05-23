import { Telegraf } from 'telegraf';
import logger from '../../utils/logger';
import User from '../../models/User';
import SniperWatch from '../../models/SniperWatch';
import { SniperManager } from '../../services/SniperManager';
import { getSniperEngine, SNIPER_ENGINE_LIST } from '../../services/sniper/SniperRegistry';
import { POPULAR_PAIRS } from '../keyboards/sniperKeyboards';
import { TradeManager } from '../../services/TradeManager';
import TradeRadar from '../../models/TradeRadar';
import Trade from '../../models/Trade';
import { BingXService } from '../../services/BingXService';
import { showPickerForSniper } from './pickerHandlers';
import {
    getSniperMainKeyboard,
    getSniperSymbolKeyboard,
    getSniperEngineKeyboard,
    getSniperDurationKeyboard,
    getActiveWatchesKeyboard,
    getWatchDetailKeyboard,
    getSniperSettingsKeyboard,
    getFireNotificationKeyboard,
    getSniperEngineSelectionKeyboard,
    getSniperBacktestDaysKeyboard,
} from '../keyboards/sniperKeyboards';
import { getMainMenuKeyboard } from '../keyboards/baseKeyboards';

function generateSniperCSVBuffer(trades: any[]): Buffer {
    if (!trades || trades.length === 0) return Buffer.from('');

    // ── الأعمدة الأساسية للصفقة ──
    const baseHeaders = [
        '#', 'Engine', 'Direction', 'Entry Date', 'Close Date', 'Status',
        'Entry Price', 'Stop Loss (SL)', 'Take Profit (TP)', 'Take Profit 2 (TP2)',
        'Close Price', 'PnL (10x %)', 'Duration (Mins)'
    ];

    // ── أعمدة التحليل الذكي (سبب اتخاذ القرار) ──
    const analysisHeaders = [
        'Confidence (%)', 'Win Rate (%)', 'Matrix Score (%)',
        'Conditions Met', 'Conditions Pending', 'Signal Summary'
    ];

    // ── أعمدة كل فريم زمني ──
    const tfList = ['1m', '3m', '5m', '15m', '30m', '1h', '4h', '1d'];
    const tfMetrics = ['RSI', 'Trend', 'ATR', 'MACD', 'MACD_Sig', 'MACD_Hist',
        'BB_Up', 'BB_Low', 'StochRSI', 'CCI', 'WilliamsR',
        'Pivot', 'R1', 'S1', 'Fib382', 'Fib618', 'SwingHigh', 'SwingLow'];
    const tfHeaders: string[] = [];
    tfList.forEach(tf => tfMetrics.forEach(m => tfHeaders.push(`${tf}_${m}`)));

    const allHeaders = [...baseHeaders, ...analysisHeaders, ...tfHeaders];
    let csvContent = '\uFEFF' + allHeaders.map(h => `"${h}"`).join(',') + '\n';

    const safe = (v: any) => {
        if (v === undefined || v === null || v === '') return '""';
        const s = String(v).replace(/"/g, '""');
        return `"${s}"`;
    };

    trades.forEach((tr, index) => {
        const ctx = tr.analysisContext || {};

        const baseRow = [
            index + 1,
            safe(tr.engineId),
            safe(tr.type),
            safe(tr.entryDate),
            safe(tr.closeDate || 'N/A'),
            safe(tr.status),
            tr.entryPrice ?? '',
            tr.sl ?? '',
            tr.tp ?? '',
            tr.tp2 ?? '',
            tr.closePrice ?? '',
            tr.pnlPercentage ? tr.pnlPercentage.toFixed(2) + '%' : '0%',
            tr.durationMinutes ?? 0
        ];

        const analysisRow = [
            ctx.confidence ?? '',
            ctx.winRate ?? '',
            ctx.matrixScore ?? '',
            safe(ctx.completedConditions ?? ''),
            safe(ctx.pendingConditions ?? ''),
            safe(ctx.summary ?? '')
        ];

        const tfRow: any[] = [];
        tfList.forEach(tf => {
            tfMetrics.forEach(m => {
                tfRow.push(ctx[`${tf}_${m}`] ?? '');
            });
        });

        csvContent += [...baseRow, ...analysisRow, ...tfRow].join(',') + '\n';
    });

    return Buffer.from(csvContent, 'utf-8');
}

// ─── registerSniperHandlers ────────────────────────────────────────────────────

export function registerSniperHandlers(bot: Telegraf, sniperManager: SniperManager) {
    // BingXService مشترك عبر Singleton مع pickerHandlers
    const bingxService = new BingXService(
        process.env.BINGX_API_KEY,
        process.env.BINGX_SECRET_KEY
    );

    // ── فتح لوحة الاقتناص الرئيسية ────────────────────────────────────────────
    bot.action('snp_open', async (ctx) => {
        try {
            const telegramId = ctx.from?.id.toString();
            if (!telegramId) return ctx.answerCbQuery().catch(() => {});
            const user = await User.findOne({ telegramId });
            if (!user) return ctx.answerCbQuery('المستخدم غير موجود').catch(() => {});
            const count = await SniperWatch.countDocuments({ userId: user._id, status: 'ACTIVE' });
            await ctx.editMessageText(
                '🎯 *نظام الاقتناص الذكي*\n\nاختر ما تريد:',
                { parse_mode: 'Markdown', reply_markup: getSniperMainKeyboard(count) }
            );
            await ctx.answerCbQuery().catch(() => {});
        } catch (e: any) { logger.error('snp_open:', e); }
    });

    // ── تقرير اقتناص لحظي — اختيار المحرك أولاً ──────────────────────────────
    bot.action('snp_instant', async (ctx) => {
        await ctx.editMessageText(
            '📊 *تقرير اقتناص لحظي*\nاختر محرك الاقتناص أولاً:',
            { parse_mode: 'Markdown', reply_markup: getSniperEngineSelectionKeyboard('instant') }
        );
        await ctx.answerCbQuery().catch(() => {});
    });

    // ── إضافة اقتناص جديد — اختيار المحرك أولاً ──────────────────────────────
    bot.action('snp_add_new', async (ctx) => {
        await ctx.editMessageText(
            '➕ *إضافة اقتناص جديد*\nاختر محرك الاقتناص أولاً:',
            { parse_mode: 'Markdown', reply_markup: getSniperEngineSelectionKeyboard('add') }
        );
        await ctx.answerCbQuery().catch(() => {});
    });

    // ── اختبار رجعي للمحرك — اختيار المحرك أولاً ──────────────────────────────
    bot.action('snp_backtest', async (ctx) => {
        await ctx.editMessageText(
            '🧪 *الاختبار الرجعي لقناص الصفقات*\nاختر محرك الاقتناص أولاً:',
            { parse_mode: 'Markdown', reply_markup: getSniperEngineSelectionKeyboard('backtest') }
        );
        await ctx.answerCbQuery().catch(() => {});
    });

    // ── اختيار المحرك → عرض قائمة أفضل العملات (مع خيار يدوي) ───────────────
    bot.action(/^snp_sel_eng_(instant|add|backtest)_(.+)$/, async (ctx) => {
        const actionType = ctx.match[1];
        const engineId = ctx.match[2];
        const engine = getSniperEngine(engineId);
        if (!engine) return ctx.answerCbQuery('محرك غير موجود').catch(() => {});

        await ctx.answerCbQuery().catch(() => {});

        // ── عرض قائمة أفضل العملات (أو رسالة "لم يتم الفحص") ──
        await showPickerForSniper(ctx, actionType, engineId, bingxService, true);
    });

    // ── اختيار العملة بعد اختيار المحرك ──────────────────────────────────────
    bot.action(/^snp_sel_sym_(instant|add|backtest)_([^_]+(?:-[^_]+)?)_(.+)$/, async (ctx) => {
        const actionType = ctx.match[1];
        const engineId = ctx.match[2];
        const symbol = ctx.match[3];

        let answered = false;

        if (symbol === 'manual') {
            const telegramId = ctx.from?.id.toString();
            if (!telegramId) {
                await ctx.answerCbQuery().catch(() => {});
                return;
            }
            const user = await User.findOne({ telegramId });
            if (user) {
                user.botState = `AWAITING_SNIPER_SYMBOL_${actionType}_${engineId}`;
                await user.save();
            }
            await ctx.editMessageText(
                '✏️ أرسل رمز العملة (مثال: BTC أو ETH):',
                { reply_markup: { inline_keyboard: [[{ text: '❌ إلغاء', callback_data: `snp_sel_eng_${actionType}_${engineId}` }]] } }
            );
        } else {
            const fullSymbol = `${symbol}/USDT:USDT`;
            if (actionType === 'instant') {
                await ctx.answerCbQuery(`⏳ جاري تحليل ${symbol}...`).catch(() => {});
                answered = true;
                const report = await sniperManager.instantReport(fullSymbol, engineId);
                if (!report) {
                    await ctx.editMessageText('❌ فشل جلب البيانات، حاول مرة أخرى.', {
                        reply_markup: { inline_keyboard: [[{ text: '🔙 رجوع', callback_data: `snp_sel_eng_instant_${engineId}` }]] }
                    });
                    return;
                }
                
                const directionExists = report.direction && report.direction !== 'NONE';
                const actionButtons: any[][] = [];
                if (directionExists) {
                    actionButtons.push([
                        { text: '⚡ تنفيذ فوري', callback_data: `snp_direct_exec_${fullSymbol}_${engineId}` },
                        { text: '📝 نسخ الصفقة', callback_data: `snp_copy_${fullSymbol}_${engineId}` }
                    ]);
                }
                
                await ctx.editMessageText(report.details, {
                    parse_mode: 'Markdown',
                    reply_markup: {
                        inline_keyboard: [
                            ...actionButtons,
                            [{ text: `⏱ مراقبة واقتناص الفرص`, callback_data: `snp_watch_${fullSymbol}_${engineId}` }],
                            [{ text: '🔙 رجوع اختيار العملة', callback_data: `snp_sel_eng_instant_${engineId}` }]
                        ]
                    }
                });
            } else if (actionType === 'backtest') {
                const engine = getSniperEngine(engineId);
                await ctx.editMessageText(
                    `🧪 *تحديد مدة الاختبار الرجعي*\nالمحرك: ${engine?.displayName || engineId}\nالعملة: ${symbol}/USDT:USDT\n\nاختر مدة الاختبار الرجعي:`,
                    { parse_mode: 'Markdown', reply_markup: getSniperBacktestDaysKeyboard(engineId, symbol) }
                );
            } else {
                await ctx.editMessageText(
                    `⏱ *تحديد مدة الاقتناص*\nالعملة: ${symbol}\nالمحرك: ${engineId}`,
                    { parse_mode: 'Markdown', reply_markup: getSniperDurationKeyboard(engineId, fullSymbol) }
                );
            }
        }
        if (!answered) {
            await ctx.answerCbQuery().catch(() => {});
        }
    });

    // ── تشغيل الاختبار الرجعي الفعلي لقناص الصفقات ──────────────────────────────────
    bot.action(/^snp_bt_d_([0-9.]+)_([^_]+(?:-[^_]+)?)_(.+)$/, async (ctx) => {
        const days = parseFloat(ctx.match[1]);
        const engineId = ctx.match[2];
        const symbolInput = ctx.match[3];
        const symbol = symbolInput.includes('/') ? symbolInput : `${symbolInput}/USDT:USDT`;

        const telegramId = ctx.from?.id.toString();
        const user = telegramId ? await User.findOne({ telegramId }) : null;

        try {
            await ctx.editMessageText(
                `⏳ *جاري تشغيل الاختبار الرجعي لقناص الصفقات...*\n` +
                `• المحرك: \`${engineId}\`\n` +
                `• العملة: \`${symbol}\`\n` +
                `• المدة: \`آخر ${days} أيام\`\n\n` +
                `*(يرجى الانتظار، قد يستغرق جلب شموع التداول وإجراء المحاكاة الدقيقة بضع دقائق...)*`,
                { parse_mode: 'Markdown' }
            );
        } catch (e) { }

        await ctx.answerCbQuery('بدأ الاختبار الرجعي...').catch(() => { });

        // Run the backtest asynchronously so Telegram webhook does not timeout
        (async () => {
            try {
                const { SniperBacktestService } = require('../../services/sniper/SniperBacktestService');
                const backtestService = new SniperBacktestService(sniperManager.bingx);

                const result = await backtestService.runSniperBacktest(symbol, engineId, {
                    days: days,
                    stepMinutes: days <= 3 ? 5 : 15 // أيام قليلة → دقة أعلى (5d) ، أيام أكثر → سرعة (15d)
                });

                if (user) {
                    await ctx.reply(result.reportText, { parse_mode: 'Markdown', reply_markup: getMainMenuKeyboard(user) });
                } else {
                    await ctx.reply(result.reportText, { parse_mode: 'Markdown' });
                }

                if (result.trades && result.trades.length > 0) {
                    const csvContent = generateSniperCSVBuffer(result.trades);
                    const safeSymbol = symbol.replace(/[\/:]/g, '_');
                    const now = new Date();
                    const dateStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}_${String(now.getHours()).padStart(2, '0')}-${String(now.getMinutes()).padStart(2, '0')}`;
                    const fileName = `SniperBacktest_${engineId}_${safeSymbol}_${dateStr}.csv`;
                    await ctx.replyWithDocument({ source: csvContent, filename: fileName });
                }

            } catch (error: any) {
                logger.error('Error in sniper backtest callback:', error);
                await ctx.reply(`❌ فشل الاختبار الرجعي: ${error.message}`);
            }
        })();
    });

    // ── اختيار المحرك — التقرير اللحظي أو اختيار المدة ─────────────────────────
    // callback: snp_eng_{engineId}_{symbol}
    bot.action(/^snp_eng_([^_]+(?:-[^_]+)?)_(.+)$/, async (ctx) => {
        const engineId = ctx.match[1];
        const symbol = ctx.match[2];
        const engine = getSniperEngine(engineId);
        if (!engine) return ctx.answerCbQuery('محرك غير موجود');

        await ctx.answerCbQuery(`⏳ جاري تحليل ${symbol}...`);

        // تشغيل التقرير اللحظي
        const report = await sniperManager.instantReport(symbol, engineId);
        if (!report) {
            await ctx.editMessageText('❌ فشل جلب البيانات، حاول مرة أخرى.');
            return;
        }

        const directionExists = report.direction && report.direction !== 'NONE';
        const actionButtons: any[][] = [];
        if (directionExists) {
            actionButtons.push([
                { text: '⚡ تنفيذ فوري', callback_data: `snp_direct_exec_${symbol}_${engineId}` },
                { text: '📝 نسخ الصفقة', callback_data: `snp_copy_${symbol}_${engineId}` }
            ]);
        }

        // عرض التقرير مع أزرار المراقبة
        await ctx.editMessageText(report.details, {
            parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: [
                    ...actionButtons,
                    [{ text: `⏱ مراقبة واقتناص الفرص`, callback_data: `snp_watch_${symbol}_${engineId}` }],
                    [{ text: '🔙 رجوع', callback_data: 'snp_instant' }]
                ]
            }
        });
    });

    // ── طلب مدة الاقتناص ────────────────────────────────────────────────────
    bot.action(/^snp_watch_(.+)_([^_]+(?:-[^_]+)?)$/, async (ctx) => {
        const symbol = ctx.match[1];
        const engineId = ctx.match[2];
        await ctx.editMessageText(
            `⏱ *تحديد مدة الاقتناص*\nالعملة: ${symbol.split('/')[0]}\nالمحرك: ${engineId}`,
            { parse_mode: 'Markdown', reply_markup: getSniperDurationKeyboard(engineId, symbol) }
        );
        await ctx.answerCbQuery();
    });

    // ── تأكيد الاقتناص بعد اختيار المدة ──────────────────────────────────────
    // callback: snp_dur_{hours}_{engineId}_{symbol}
    bot.action(/^snp_dur_(\d+)_([^_]+(?:-[^_]+)?)_(.+)$/, async (ctx) => {
        const hours = parseInt(ctx.match[1]);
        const engineId = ctx.match[2];
        const symbol = ctx.match[3];

        const telegramId = ctx.from?.id.toString();
        if (!telegramId) return ctx.answerCbQuery();
        const user = await User.findOne({ telegramId });
        if (!user) return ctx.answerCbQuery('المستخدم غير موجود');

        await sniperManager.addWatch({
            userId: user._id.toString(),
            telegramId,
            symbol,
            engineId,
            hours,
            autoExecute: user.sniperSettings?.autoExecute ?? false,
            notifyOnce: user.sniperSettings?.notifyOnce ?? false,
        });

        await ctx.editMessageText(
            `✅ *تم تفعيل الاقتناص!*\n\n` +
            `🪙 العملة: ${symbol.split('/')[0]}\n` +
            `⚙️ المحرك: ${engineId}\n` +
            `⏱ المدة: ${hours} ساعة\n\n` +
            `سيتم إرسال إشعار فور اكتمال شروط الدخول.`,
            { parse_mode: 'Markdown', reply_markup: { inline_keyboard: [[{ text: '🔙 القائمة الرئيسية', callback_data: 'snp_open' }]] } }
        );
        await ctx.answerCbQuery('✅ تم تفعيل الاقتناص');
    });

    // ── قائمة الاقتناصات النشطة ───────────────────────────────────────────────
    bot.action('snp_list', async (ctx) => {
        const telegramId = ctx.from?.id.toString();
        if (!telegramId) return ctx.answerCbQuery();
        const user = await User.findOne({ telegramId });
        if (!user) return ctx.answerCbQuery();
        const watches = await sniperManager.getActiveWatches(user._id.toString());
        await ctx.editMessageText(
            `📋 *الاقتناصات النشطة* (${watches.length})\n\nاختر اقتناصاً لعرض تفاصيله:`,
            { parse_mode: 'Markdown', reply_markup: getActiveWatchesKeyboard(watches) }
        );
        await ctx.answerCbQuery();
    });

    // ── تفاصيل اقتناص محدد ───────────────────────────────────────────────────
    bot.action(/^snp_view_(.+)$/, async (ctx) => {
        const watchId = ctx.match[1];
        const watch = await SniperWatch.findById(watchId);
        if (!watch) return ctx.answerCbQuery('الاقتناص غير موجود');

        const expiresIn = Math.max(0, Math.round((watch.expiresAt.getTime() - Date.now()) / 60000));
        const lastReport = watch.lastReport as any;
        const condText = lastReport
            ? `\n✅ مكتمل: ${lastReport.completedConditions?.length || 0}\n🔸 منتظر: ${lastReport.pendingConditions?.length || 0}`
            : '\n(لم يتم التحليل بعد)';

        await ctx.editMessageText(
            `🎯 *اقتناص ${watch.symbolShort}*\n` +
            `المحرك: ${watch.engineId}\n` +
            `الحالة: ${watch.status}\n` +
            `ينتهي خلال: ${expiresIn} دقيقة${condText}`,
            { parse_mode: 'Markdown', reply_markup: getWatchDetailKeyboard(watchId) }
        );
        await ctx.answerCbQuery();
    });

    // ── تقرير لحظي لاقتناص قائم ──────────────────────────────────────────────
    bot.action(/^snp_report_(.+)$/, async (ctx) => {
        const watchId = ctx.match[1];
        const watch = await SniperWatch.findById(watchId);
        if (!watch) return ctx.answerCbQuery('الاقتناص غير موجود');

        await ctx.answerCbQuery('⏳ جاري التحليل...');
        const report = await sniperManager.instantReport(watch.symbol, watch.engineId);
        if (!report) {
            await ctx.reply('❌ فشل جلب البيانات');
            return;
        }
        await ctx.reply(report.details, {
            parse_mode: 'Markdown',
            reply_markup: getWatchDetailKeyboard(watchId)
        });
    });

    // ── إلغاء اقتناص ─────────────────────────────────────────────────────────
    bot.action(/^snp_cancel_(.+)$/, async (ctx) => {
        const watchId = ctx.match[1];
        await sniperManager.cancelWatch(watchId);
        await ctx.editMessageText('✅ تم إلغاء الاقتناص.', {
            reply_markup: { inline_keyboard: [[{ text: '🔙 القائمة', callback_data: 'snp_open' }]] }
        });
        await ctx.answerCbQuery('تم الإلغاء');
    });

    // ── إعدادات الاقتناص ──────────────────────────────────────────────────────
    bot.action('snp_settings', async (ctx) => {
        try {
            const telegramId = ctx.from?.id.toString();
            if (!telegramId) return ctx.answerCbQuery();
            const user = await User.findOne({ telegramId });
            if (!user) return ctx.answerCbQuery('المستخدم غير موجود');

            const autoExecute = user.sniperSettings?.autoExecute ?? false;
            const notifyOnce = user.sniperSettings?.notifyOnce ?? false;

            await ctx.editMessageText(
                `⚙️ *إعدادات الاقتناص الافتراضية*\n\n` +
                `اختر الإعدادات المناسبة للاقتناصات الجديدة:`,
                {
                    parse_mode: 'Markdown',
                    reply_markup: getSniperSettingsKeyboard(autoExecute, notifyOnce)
                }
            );
            await ctx.answerCbQuery();
        } catch (e: any) { logger.error('snp_settings:', e); }
    });

    bot.action('snp_toggle_auto', async (ctx) => {
        try {
            const telegramId = ctx.from?.id.toString();
            if (!telegramId) return ctx.answerCbQuery();
            const user = await User.findOne({ telegramId });
            if (!user) return ctx.answerCbQuery();

            if (!user.sniperSettings) {
                user.sniperSettings = { autoExecute: false, notifyOnce: false };
            }
            user.sniperSettings.autoExecute = !user.sniperSettings.autoExecute;
            await user.save();

            const autoExecute = user.sniperSettings.autoExecute;
            const notifyOnce = user.sniperSettings.notifyOnce;
            await ctx.editMessageReplyMarkup(getSniperSettingsKeyboard(autoExecute, notifyOnce) as any);
            await ctx.answerCbQuery(`التنفيذ التلقائي: ${autoExecute ? '✅ مفعل' : '❌ معطل'}`);
        } catch (e: any) { logger.error('snp_toggle_auto:', e); }
    });

    bot.action('snp_toggle_once', async (ctx) => {
        try {
            const telegramId = ctx.from?.id.toString();
            if (!telegramId) return ctx.answerCbQuery();
            const user = await User.findOne({ telegramId });
            if (!user) return ctx.answerCbQuery();

            if (!user.sniperSettings) {
                user.sniperSettings = { autoExecute: false, notifyOnce: false };
            }
            user.sniperSettings.notifyOnce = !user.sniperSettings.notifyOnce;
            await user.save();

            const autoExecute = user.sniperSettings.autoExecute;
            const notifyOnce = user.sniperSettings.notifyOnce;
            await ctx.editMessageReplyMarkup(getSniperSettingsKeyboard(autoExecute, notifyOnce) as any);
            await ctx.answerCbQuery(`إشعار واحد: ${notifyOnce ? '✅ نعم' : '❌ لا'}`);
        } catch (e: any) { logger.error('snp_toggle_once:', e); }
    });

    bot.action('snp_settings_save', async (ctx) => {
        try {
            const telegramId = ctx.from?.id.toString();
            if (!telegramId) return ctx.answerCbQuery();
            const user = await User.findOne({ telegramId });
            if (!user) return ctx.answerCbQuery();

            const count = await SniperWatch.countDocuments({ userId: user._id, status: 'ACTIVE' });
            await ctx.editMessageText(
                '🎯 *نظام الاقتناص الذكي*\n\nتم حفظ الإعدادات بنجاح.',
                {
                    parse_mode: 'Markdown',
                    reply_markup: getSniperMainKeyboard(count)
                }
            );
            await ctx.answerCbQuery('✅ تم حفظ الإعدادات');
        } catch (e: any) { logger.error('snp_settings_save:', e); }
    });

    // ── إغلاق لوحة الاقتناص ──────────────────────────────────────────────────
    bot.action('snp_close', async (ctx) => {
        const telegramId = ctx.from?.id.toString();
        const user = telegramId ? await User.findOne({ telegramId }) : null;
        await ctx.deleteMessage().catch(() => {});
        if (user) {
            await ctx.reply('تم الإغلاق.', { reply_markup: getMainMenuKeyboard(user) });
        }
        await ctx.answerCbQuery();
    });

    // ── تنفيذ صفقة فوري من التقرير اللحظي ─────────────────────────────────────────
    bot.action(/^snp_direct_exec_(.+)_([^_]+)$/, async (ctx) => {
        try {
            const symbol = ctx.match[1];
            const engineId = ctx.match[2];
            const telegramId = ctx.from?.id.toString();
            if (!telegramId) return ctx.answerCbQuery().catch(() => {});
            
            const user = await User.findOne({ telegramId });
            if (!user) return ctx.answerCbQuery('المستخدم غير موجود').catch(() => {});

            await ctx.answerCbQuery('⏳ جاري تنفيذ الصفقة فورا...').catch(() => {});

            const report = await sniperManager.instantReport(symbol, engineId);
            if (!report || report.direction === 'NONE') {
                await ctx.reply('❌ فشل توليد التقرير أو الاتجاه غير صالح للتداول.');
                return;
            }

            const tradeManager = new TradeManager(sniperManager.bingx);

            const signal = {
                type: 'TRADE' as const,
                symbol: report.symbol,
                direction: report.direction as 'LONG' | 'SHORT',
                entry: [report.entry],
                targets: report.tp2 ? [report.tp, report.tp2] : [report.tp],
                stopLoss: report.sl,
                leverage: 10
            };

            const result = await tradeManager.executeSignal(signal, user._id.toString(), ctx.chat?.id.toString());
            if (result) {
                const dirEmoji = result.direction === 'LONG' ? '🟢' : '🔴';
                await ctx.reply(
                    `✅ *تم تنفيذ الصفقة فورياً بنجاح!*\n\n` +
                    `🪙 العملة: *${result.symbol.split('/')[0]}*\n` +
                    `📈 الاتجاه: *${result.direction} ${dirEmoji}*\n` +
                    `💵 سعر الدخول: *${result.entryPrice}*\n` +
                    `🛑 وقف الخسارة: *${result.stopLoss.price}*\n` +
                    `🎯 الأهداف: *${result.targets.map(t => t.price).join(', ')}*\n` +
                    `⚙️ الرافعة: *${result.leverage}x*\n` +
                    `💰 الهامش المستخدم: *${result.margin.toFixed(2)} USDT* (${result.marginPercentage}%)`
                , { parse_mode: 'Markdown' });
            } else {
                await ctx.reply('❌ فشل تنفيذ الصفقة، يرجى مراجعة سجلات البوت.');
            }
        } catch (e: any) {
            logger.error('snp_direct_exec:', e);
            await ctx.reply(`❌ حدث خطأ أثناء تنفيذ الصفقة: ${e.message}`);
        }
    });

    // ── نسخ بيانات الصفقة ────────────────────────────────────────────────────────
    bot.action(/^snp_copy_(.+)_([^_]+)$/, async (ctx) => {
        try {
            const symbol = ctx.match[1];
            const engineId = ctx.match[2];
            const telegramId = ctx.from?.id.toString();
            if (!telegramId) return ctx.answerCbQuery().catch(() => {});

            await ctx.answerCbQuery('⏳ جاري جلب بيانات النسخ...').catch(() => {});

            const report = await sniperManager.instantReport(symbol, engineId);
            if (!report || report.direction === 'NONE') {
                await ctx.reply('❌ فشل توليد التقرير أو الاتجاه غير صالح للنسخ.');
                return;
            }

            const symbolShort = symbol.split('/')[0] || symbol;
            const finalSymbol = symbol.includes('/') ? symbol : `${symbolShort}/USDT:USDT`;
            
            const user = await User.findOne({ telegramId });
            const levVal = user && user.leverageMode === 'fixed' ? user.fixedLeverageValue : 10;

            const dirEmoji = report.direction === 'LONG' ? '🔼' : '🔻';
            const targetsText = report.tp2 ? `${report.tp}\n${report.tp2}` : `${report.tp}`;

            const copyBox = `${finalSymbol}

${dirEmoji}${report.direction}  X${levVal}  

▶️ENTER PRICE(سعر الدخول):
${report.entry}

▶️TARGET  PRICES(الاهداف):
${targetsText}

▶️STOP LOSE(الاستوب)
${report.sl}`;

            await ctx.reply(
                `📝 *إليك بيانات الصفقة جاهزة للنسخ بنقرة واحدة:*\n` +
                `(اضغط على الكود أدناه لنسخه تلقائياً)\n\n` +
                `\`\`\`\n${copyBox}\n\`\`\``
            , { parse_mode: 'Markdown' });
        } catch (e: any) {
            logger.error('snp_copy:', e);
            await ctx.reply(`❌ حدث خطأ أثناء نسخ الصفقة: ${e.message}`);
        }
    });

    // ── تنفيذ صفقة اقتناص من الإشعار ──────────────────────────────────────────────
    bot.action(/^snp_exec_(.+)$/, async (ctx) => {
        try {
            const watchId = ctx.match[1];
            const telegramId = ctx.from?.id.toString();
            if (!telegramId) return ctx.answerCbQuery().catch(() => {});

            await ctx.answerCbQuery('⏳ جاري تنفيذ صفقة الاقتناص...').catch(() => {});

            const watch = await SniperWatch.findById(watchId);
            if (!watch) {
                await ctx.reply('❌ فشل العثور على اقتناص المراقبة هذا.');
                return;
            }

            const user = await User.findById(watch.userId);
            if (!user) {
                await ctx.reply('❌ المستخدم غير موجود في قاعدة البيانات.');
                return;
            }

            const report = await sniperManager.instantReport(watch.symbol, watch.engineId);
            if (!report || report.direction === 'NONE') {
                await ctx.reply('❌ لم يعد اتجاه السوق صالحاً للدخول الآن.');
                return;
            }

            const tradeManager = new TradeManager(sniperManager.bingx);

            const signal = {
                type: 'TRADE' as const,
                symbol: report.symbol,
                direction: report.direction as 'LONG' | 'SHORT',
                entry: [report.entry],
                targets: report.tp2 ? [report.tp, report.tp2] : [report.tp],
                stopLoss: report.sl,
                leverage: 10
            };

            const result = await tradeManager.executeSignal(signal, user._id.toString(), ctx.chat?.id.toString());
            if (result) {
                const dirEmoji = result.direction === 'LONG' ? '🟢' : '🔴';
                watch.status = 'TRIGGERED';
                await watch.save();

                await ctx.reply(
                    `✅ *تم تنفيذ صفقة الاقتناص بنجاح!*\n\n` +
                    `🪙 العملة: *${result.symbol.split('/')[0]}*\n` +
                    `📈 الاتجاه: *${result.direction} ${dirEmoji}*\n` +
                    `💵 سعر الدخول: *${result.entryPrice}*\n` +
                    `🛑 وقف الخسارة: *${result.stopLoss.price}*\n` +
                    `🎯 الأهداف: *${result.targets.map(t => t.price).join(', ')}*\n` +
                    `⚙️ الرافعة: *${result.leverage}x*\n` +
                    `💰 الهامش المستخدم: *${result.margin.toFixed(2)} USDT* (${result.marginPercentage}%)`
                , { parse_mode: 'Markdown' });
            } else {
                await ctx.reply('❌ فشل تنفيذ الصفقة، يرجى مراجعة السجلات.');
            }
        } catch (e: any) {
            logger.error('snp_exec:', e);
            await ctx.reply(`❌ حدث خطأ أثناء تنفيذ صفقة الاقتناص: ${e.message}`);
        }
    });

    // ── تفعيل الرادار من إشعار الاقتناص ──────────────────────────────────────────
    bot.action(/^snp_radar_(.+)$/, async (ctx) => {
        try {
            const watchId = ctx.match[1];
            const telegramId = ctx.from?.id.toString();
            if (!telegramId) return ctx.answerCbQuery().catch(() => {});

            await ctx.answerCbQuery('⏳ جاري ربط صفقة الرادار...').catch(() => {});

            const watch = await SniperWatch.findById(watchId);
            if (!watch) {
                await ctx.reply('❌ فشل العثور على الاقتناص.');
                return;
            }

            const user = await User.findById(watch.userId);
            if (!user) {
                await ctx.reply('❌ المستخدم غير موجود.');
                return;
            }

            const trade = await Trade.findOne({
                userId: watch.userId,
                symbol: watch.symbol,
                currentStatus: { $in: ['OPEN', 'TP1_HIT', 'TP2_HIT'] }
            }).sort({ createdAt: -1 });

            if (!trade) {
                await ctx.reply('❌ لا توجد صفقة مفتوحة نشطة لهذه العملة لتفعيل الرادار عليها. يرجى تنفيذ الصفقة أولاً ثم تفعيل الرادار.');
                return;
            }

            await TradeRadar.findOneAndUpdate(
                { tradeId: trade._id },
                {
                    tradeId: trade._id,
                    userId: trade.userId,
                    telegramId: telegramId,
                    symbol: trade.symbol,
                    direction: trade.direction,
                    entryPrice: trade.entryPrice,
                    currentSL: trade.stopLoss,
                    isActive: true,
                    settings: {
                        notifyOnce: user.radarSettings?.notifyOnce ?? true,
                        trailingEnabled: user.radarSettings?.trailingEnabled ?? false,
                        wickSweepAlert: user.radarSettings?.wickSweepAlert ?? true,
                        reversalAlert: user.radarSettings?.reversalAlert ?? true,
                    },
                    sentEvents: [],
                },
                { upsert: true, new: true }
            );

            await ctx.reply(
                `✅ *تم تفعيل رادار المراقبة بنجاح لهذه الصفقة!*\n\n` +
                `📡 الصفقة: *${trade.symbol.split('/')[0]}* (${trade.direction})\n\n` +
                `سيقوم الرادار الآن بمراقبة الشموع الحية وسعر السوق لحمايتك وتفعيل الميزات الذكية.`
            , { parse_mode: 'Markdown' });

        } catch (e: any) {
            logger.error('snp_radar:', e);
            await ctx.reply(`❌ حدث خطأ أثناء تفعيل الرادار: ${e.message}`);
        }
    });

    // ── معالجة الإدخال اليدوي للعملة ─────────────────────────────────────────
    // يتم التعامل معه في messageHandlers عبر فحص botState === 'AWAITING_SNIPER_SYMBOL'
}
