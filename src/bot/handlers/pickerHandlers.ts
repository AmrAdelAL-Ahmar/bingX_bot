import { Telegraf } from 'telegraf';
import logger from '../../utils/logger';
import User from '../../models/User';
import { BingXService } from '../../services/BingXService';
import { getSymbolPickerService } from '../../services/SymbolPickerService';
import {
    getPickerListKeyboard,
    getPickerNoDataKeyboard,
    getPickerScanningKeyboard,
    buildPickerMessageText
} from '../keyboards/pickerKeyboards';
import { getMainMenuKeyboard } from '../keyboards/baseKeyboards';

// ─── دالة مساعدة: عرض نتائج الفحص أو رسالة "لم يتم الفحص" ──────────────────

async function showPickerResults(
    ctx: any,
    context: 'analysis' | 'sniper',
    subContext: string,
    bingx: BingXService,
    editMode: boolean = true
) {
    const telegramId = ctx.from?.id.toString();
    const user = telegramId ? await User.findOne({ telegramId }) : null;
    const limit = user?.pickerSettings?.limit || 20;

    const picker = getSymbolPickerService(bingx);
    const { results, lastScanTime } = picker.getLastResults();
    const contextTitle = context === 'analysis' ? 'اختر عملة للتحليل' : 'اختر عملة للاقتناص';
    const slicedResults = results.slice(0, limit);

    if (slicedResults.length === 0) {
        // لم يتم الفحص بعد
        const text = `📊 *${contextTitle}*\n\n⚠️ لم يتم فحص السوق بعد.\nاضغط على زر الفحص لرؤية أفضل العملات، أو أدخل رمزاً يدوياً.`;
        const markup = getPickerNoDataKeyboard(context, subContext);

        if (editMode) {
            await ctx.editMessageText(text, { parse_mode: 'Markdown', reply_markup: markup })
                .catch(() => ctx.reply(text, { parse_mode: 'Markdown', reply_markup: markup }));
        } else {
            await ctx.reply(text, { parse_mode: 'Markdown', reply_markup: markup });
        }
    } else {
        // يوجد نتائج محفوظة
        const text = buildPickerMessageText(slicedResults, lastScanTime, contextTitle);
        const markup = getPickerListKeyboard(slicedResults, context, subContext, lastScanTime);

        if (editMode) {
            await ctx.editMessageText(text, { parse_mode: 'Markdown', reply_markup: markup })
                .catch(() => ctx.reply(text, { parse_mode: 'Markdown', reply_markup: markup }));
        } else {
            await ctx.reply(text, { parse_mode: 'Markdown', reply_markup: markup });
        }
    }
}

// ─── registerPickerHandlers ────────────────────────────────────────────────────

export function registerPickerHandlers(bot: Telegraf, bingx: BingXService) {

    // ── بدء فحص جديد (من زر "لم يتم الفحص بعد") ─────────────────────────────
    // callback: pkr_scan_{context}_{subContext}
    bot.action(/^pkr_scan_(analysis|sniper)_(.+)$/, async (ctx) => {
        const context = ctx.match[1] as 'analysis' | 'sniper';
        const subContext = ctx.match[2];

        await ctx.answerCbQuery('⏳ بدأ الفحص...').catch(() => { });

        const telegramId = ctx.from?.id.toString();
        const user = telegramId ? await User.findOne({ telegramId }) : null;
        const engineType = user?.pickerSettings?.engine || 'ccxt';
        const limit = user?.pickerSettings?.limit || 20;

        const picker = getSymbolPickerService(bingx);

        if (picker.isScanRunning()) {
            await ctx.answerCbQuery('⏳ الفحص جارٍ بالفعل، انتظر قليلاً...').catch(() => { });
            return;
        }

        // عرض رسالة "جاري الفحص"
        try {
            const descText = engineType === 'ccxt'
                ? `⏳ *جاري فحص السوق (CCXT Pro)...*\nنقوم بتحليل السيولة وSMC والتقلب لأهم عملات العقود الآجلة.\n_يستغرق ذلك 15-25 ثانية..._`
                : `⏳ *جاري فحص السوق...*\nنقوم بتحليل ~50 عملة وترتيبها حسب الجاهزية للتداول.\n_يستغرق ذلك 15-30 ثانية..._`;
            await ctx.editMessageText(
                descText,
                { parse_mode: 'Markdown', reply_markup: getPickerScanningKeyboard() }
            );
        } catch { /* تجاهل */ }

        // تشغيل الفحص في الخلفية
        (async () => {
            try {
                await picker.refreshScan(limit, engineType);
                // بعد الانتهاء، عرض النتائج
                await showPickerResults(ctx, context, subContext, bingx, true);
            } catch (e: any) {
                logger.error('[pickerHandlers] Scan error:', e);
                await ctx.reply(`❌ فشل فحص السوق: ${e.message}`).catch(() => { });
            }
        })();
    });

    // ── تحديث القائمة (إعادة الفحص) ──────────────────────────────────────────
    // callback: pkr_refresh_{context}_{subContext}
    bot.action(/^pkr_refresh_(analysis|sniper)_(.+)$/, async (ctx) => {
        const context = ctx.match[1] as 'analysis' | 'sniper';
        const subContext = ctx.match[2];

        await ctx.answerCbQuery('⏳ جاري التحديث...').catch(() => { });

        const telegramId = ctx.from?.id.toString();
        const user = telegramId ? await User.findOne({ telegramId }) : null;
        const engineType = user?.pickerSettings?.engine || 'multicriteria';
        const limit = user?.pickerSettings?.limit || 20;

        const picker = getSymbolPickerService(bingx);

        if (picker.isScanRunning()) {
            await ctx.answerCbQuery('⏳ الفحص جارٍ بالفعل...').catch(() => { });
            return;
        }

        try {
            const descText = engineType === 'ccxt'
                ? `⏳ *جاري تحديث قائمة العملات (CCXT Pro)...*\n_يستغرق ذلك 15-25 ثانية..._`
                : `⏳ *جاري تحديث قائمة العملات...*\n_يستغرق ذلك 15-30 ثانية..._`;
            await ctx.editMessageText(
                descText,
                { parse_mode: 'Markdown', reply_markup: getPickerScanningKeyboard() }
            );
        } catch { /* تجاهل */ }

        (async () => {
            try {
                await picker.refreshScan(limit, engineType);
                await showPickerResults(ctx, context, subContext, bingx, true);
            } catch (e: any) {
                logger.error('[pickerHandlers] Refresh error:', e);
                await ctx.reply(`❌ فشل التحديث: ${e.message}`).catch(() => { });
            }
        })();
    });

    // ── الإدخال اليدوي — تحليل ───────────────────────────────────────────────
    // callback: pkr_manual_analysis_{version}
    bot.action(/^pkr_manual_analysis_(.+)$/, async (ctx) => {
        const version = ctx.match[1];
        const telegramId = ctx.from?.id.toString();
        if (!telegramId) return ctx.answerCbQuery().catch(() => { });

        const user = await User.findOne({ telegramId });
        if (!user) return ctx.answerCbQuery('المستخدم غير موجود').catch(() => { });

        user.botState = `AWAITING_ANALYSIS_SYMBOL_${version}`;
        await user.save();

        await ctx.answerCbQuery().catch(() => { });
        await ctx.editMessageText(
            `✏️ *إدخال يدوي*\nأرسل رمز العملة للتحليل باستخدام ${version} (مثال: BTC أو ETH):`,
            {
                parse_mode: 'Markdown',
                reply_markup: {
                    inline_keyboard: [[
                        { text: '❌ إلغاء', callback_data: 'back_algo_menu' }
                    ]]
                }
            }
        ).catch(() => { });
    });

    // ── الإدخال اليدوي — اقتناص ──────────────────────────────────────────────
    // callback: pkr_manual_sniper_{actionType}_{engineId}
    bot.action(/^pkr_manual_sniper_(.+)_(.+)$/, async (ctx) => {
        const actionType = ctx.match[1];
        const engineId = ctx.match[2];
        const telegramId = ctx.from?.id.toString();
        if (!telegramId) return ctx.answerCbQuery().catch(() => { });

        const user = await User.findOne({ telegramId });
        if (!user) return ctx.answerCbQuery('المستخدم غير موجود').catch(() => { });

        user.botState = `AWAITING_SNIPER_SYMBOL_${actionType}_${engineId}`;
        await user.save();

        await ctx.answerCbQuery().catch(() => { });
        await ctx.editMessageText(
            `✏️ *إدخال يدوي*\nأرسل رمز العملة (مثال: BTC أو ETH):`,
            {
                parse_mode: 'Markdown',
                reply_markup: {
                    inline_keyboard: [[
                        { text: '❌ إلغاء', callback_data: `snp_sel_eng_${actionType}_${engineId}` }
                    ]]
                }
            }
        ).catch(() => { });
    });

    // ── اختيار عملة من القائمة — تحليل ──────────────────────────────────────
    // callback: pkr_sel_analysis_{version}_{symbol}
    bot.action(/^pkr_sel_analysis_([^_]+)_([^_]+)$/, async (ctx) => {
        const version = ctx.match[1] as 'V1' | 'V2' | 'V3' | 'V4' | 'V5' | 'V6' | 'V7' | 'V10' | 'V11';
        const symbolShort = ctx.match[2];
        const fullSymbol = `${symbolShort}/USDT:USDT`;

        await ctx.answerCbQuery(`⏳ جاري تحليل ${symbolShort}...`).catch(() => { });

        const telegramId = ctx.from?.id.toString();
        const user = telegramId ? await User.findOne({ telegramId }) : null;

        try {
            await ctx.editMessageText(
                `⏳ *جاري تحليل ${symbolShort} باستخدام ${version}...*\n(TF: ${user?.analysisSettings?.scalpTF || '5m'}/${user?.analysisSettings?.swingTF || '1h'})`,
                { parse_mode: 'Markdown' }
            ).catch(() => { });

            // استدعاء AnalysisService مباشرة
            const { AnalysisService } = require('../../services/AnalysisService');
            const analysisService = new AnalysisService(bingx);
            const result = await analysisService.analyze(fullSymbol, version, {
                quickTF: user?.analysisSettings?.scalpTF,
                longTF: user?.analysisSettings?.swingTF,
                limit: user?.analysisSettings?.candleLimit,
                rsiThreshold: user?.analysisSettings?.rsiThreshold
            });

            const report = analysisService.formatReport(result, version);
            const shortSym = symbolShort;

            await ctx.reply(report, {
                parse_mode: 'HTML',
                reply_markup: {
                    inline_keyboard: [[
                        { text: '📊 التحليل الشامل (MTF)', callback_data: `all_tf_${shortSym}_${version}` }
                    ]]
                }
            });

            // إجراءات Scalp
            if (result.scalp.type !== 'NONE') {
                const { getAnalysisActionKeyboard } = require('../keyboards/analysisKeyboards');
                await ctx.reply(`⚡ *إجراءات لصفقة Scalp:*`, {
                    parse_mode: 'Markdown',
                    reply_markup: getAnalysisActionKeyboard(fullSymbol, 'scalp', {
                        direction: result.scalp.type,
                        entry: result.scalp.entry,
                        tp: result.scalp.tp,
                        sl: result.scalp.sl,
                        p: result.pricePrecision
                    }, version)
                });
            }

            // إجراءات Swing
            if (result.swing.type !== 'NONE') {
                const { getAnalysisActionKeyboard } = require('../keyboards/analysisKeyboards');
                await ctx.reply(`🌊 *إجراءات لصفقة Swing:*`, {
                    parse_mode: 'Markdown',
                    reply_markup: getAnalysisActionKeyboard(fullSymbol, 'swing', {
                        direction: result.swing.type,
                        entry: result.swing.entry,
                        tp: result.swing.tp,
                        sl: result.swing.sl,
                        p: result.pricePrecision
                    }, version)
                });
            }

            if (user) {
                await ctx.reply('يمكنك الآن تنفيذ الصفقة أو نسخ الإشارة.', {
                    reply_markup: getMainMenuKeyboard(user)
                });
            }
        } catch (e: any) {
            logger.error('[pickerHandlers] Analysis error:', e);
            await ctx.reply(`❌ فشل التحليل: ${e.message}`).catch(() => { });
        }
    });

    // ── اختيار عملة من القائمة — اقتناص ─────────────────────────────────────
    // callback: pkr_sel_sniper_{actionType}_{engineId}_{symbol}
    bot.action(/^pkr_sel_sniper_([^_]+)_([^_]+(?:-[^_]+)?)_([^_]+)$/, async (ctx) => {
        const actionType = ctx.match[1];
        const engineId = ctx.match[2];
        const symbolShort = ctx.match[3];
        const fullSymbol = `${symbolShort}/USDT:USDT`;

        await ctx.answerCbQuery().catch(() => { });

        try {
            const { getSniperEngine } = require('../../services/sniper/SniperRegistry');
            const { getSniperDurationKeyboard, getSniperBacktestDaysKeyboard } = require('../keyboards/sniperKeyboards');
            const { SniperManager } = require('../../services/SniperManager');
            const sniperManager: InstanceType<typeof SniperManager> = (bot as any).sniperManager;

            if (actionType === 'instant') {
                await ctx.editMessageText(`⏳ *جاري تحليل ${symbolShort}...*`, { parse_mode: 'Markdown' }).catch(() => { });

                const report = await sniperManager.instantReport(fullSymbol, engineId);
                if (!report) {
                    await ctx.reply('❌ فشل جلب البيانات، حاول مرة أخرى.');
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

                await ctx.reply(report.details, {
                    parse_mode: 'Markdown',
                    reply_markup: {
                        inline_keyboard: [
                            ...actionButtons,
                            [{ text: `⏱ مراقبة واقتناص الفرص`, callback_data: `snp_watch_${fullSymbol}_${engineId}` }],
                            [{ text: '🔙 رجوع', callback_data: `snp_sel_eng_instant_${engineId}` }]
                        ]
                    }
                });
            } else if (actionType === 'backtest') {
                const engine = getSniperEngine(engineId);
                await ctx.editMessageText(
                    `🧪 *تحديد مدة الاختبار الرجعي*\nالمحرك: ${engine?.displayName || engineId}\nالعملة: ${symbolShort}/USDT:USDT\n\nاختر مدة الاختبار الرجعي:`,
                    { parse_mode: 'Markdown', reply_markup: getSniperBacktestDaysKeyboard(engineId, symbolShort) }
                );
            } else {
                // actionType === 'add'
                await ctx.editMessageText(
                    `⏱ *تحديد مدة الاقتناص*\nالعملة: ${symbolShort}\nالمحرك: ${engineId}`,
                    { parse_mode: 'Markdown', reply_markup: getSniperDurationKeyboard(engineId, fullSymbol) }
                );
            }
        } catch (e: any) {
            logger.error('[pickerHandlers] Sniper select error:', e);
            await ctx.reply(`❌ حدث خطأ: ${e.message}`).catch(() => { });
        }
    });

    // ── noop (زر معطل أثناء الفحص) ──────────────────────────────────────────
    bot.action('pkr_noop', async (ctx) => {
        await ctx.answerCbQuery('⏳ جاري الفحص، انتظر قليلاً...').catch(() => { });
    });

    // ── رجوع لقائمة اختيار الخوارزمية ───────────────────────────────────────
    bot.action('back_algo_menu', async (ctx) => {
        try {
            const { getAlgoVersionKeyboard } = require('../keyboards/analysisKeyboards');
            await ctx.editMessageText(
                'الرجاء اختيار إصدار خوارزمية التحليل التي تود استخدامها:',
                { reply_markup: getAlgoVersionKeyboard() }
            );
            await ctx.answerCbQuery().catch(() => { });
        } catch (e) {
            await ctx.answerCbQuery().catch(() => { });
        }
    });
}

// ─── دالة مساعدة للاستخدام في analysisHandlers و sniperHandlers ──────────────

/**
 * عرض قائمة العملات (للاستخدام في الـ Handlers الأخرى)
 */
export async function showPickerForAnalysis(
    ctx: any,
    version: string,
    bingx: BingXService,
    editMode: boolean = false
) {
    const telegramId = ctx.from?.id.toString();
    const user = telegramId ? await User.findOne({ telegramId }) : null;
    const limit = user?.pickerSettings?.limit || 20;

    const picker = getSymbolPickerService(bingx);
    const { results, lastScanTime } = picker.getLastResults();
    const contextTitle = `اختر عملة للتحليل (${version})`;
    const slicedResults = results.slice(0, limit);

    if (slicedResults.length === 0) {
        const text = `📊 *${contextTitle}*\n\n⚠️ لم يتم فحص السوق بعد.\nاضغط على زر الفحص لرؤية أفضل العملات، أو أدخل رمزاً يدوياً.`;
        const markup = getPickerNoDataKeyboard('analysis', version);
        if (editMode) {
            await ctx.editMessageText(text, { parse_mode: 'Markdown', reply_markup: markup }).catch(() => ctx.reply(text, { parse_mode: 'Markdown', reply_markup: markup }));
        } else {
            await ctx.reply(text, { parse_mode: 'Markdown', reply_markup: markup });
        }
    } else {
        const text = buildPickerMessageText(slicedResults, lastScanTime, contextTitle);
        const markup = getPickerListKeyboard(slicedResults, 'analysis', version, lastScanTime);
        if (editMode) {
            await ctx.editMessageText(text, { parse_mode: 'Markdown', reply_markup: markup }).catch(() => ctx.reply(text, { parse_mode: 'Markdown', reply_markup: markup }));
        } else {
            await ctx.reply(text, { parse_mode: 'Markdown', reply_markup: markup });
        }
    }
}

export async function showPickerForSniper(
    ctx: any,
    actionType: string,
    engineId: string,
    bingx: BingXService,
    editMode: boolean = true
) {
    const telegramId = ctx.from?.id.toString();
    const user = telegramId ? await User.findOne({ telegramId }) : null;
    const limit = user?.pickerSettings?.limit || 20;

    const picker = getSymbolPickerService(bingx);
    const { results, lastScanTime } = picker.getLastResults();
    const contextTitle = 'اختر عملة للاقتناص';
    const subContext = `${actionType}_${engineId}`;
    const slicedResults = results.slice(0, limit);

    if (slicedResults.length === 0) {
        const text = `🎯 *${contextTitle}*\n\n⚠️ لم يتم فحص السوق بعد.\nاضغط على زر الفحص لرؤية أفضل العملات، أو أدخل رمزاً يدوياً.`;
        const markup = getPickerNoDataKeyboard('sniper', subContext);
        if (editMode) {
            await ctx.editMessageText(text, { parse_mode: 'Markdown', reply_markup: markup }).catch(() => ctx.reply(text, { parse_mode: 'Markdown', reply_markup: markup }));
        } else {
            await ctx.reply(text, { parse_mode: 'Markdown', reply_markup: markup });
        }
    } else {
        const text = buildPickerMessageText(slicedResults, lastScanTime, contextTitle);
        const markup = getPickerListKeyboard(slicedResults, 'sniper', subContext, lastScanTime);
        if (editMode) {
            await ctx.editMessageText(text, { parse_mode: 'Markdown', reply_markup: markup }).catch(() => ctx.reply(text, { parse_mode: 'Markdown', reply_markup: markup }));
        } else {
            await ctx.reply(text, { parse_mode: 'Markdown', reply_markup: markup });
        }
    }
}
