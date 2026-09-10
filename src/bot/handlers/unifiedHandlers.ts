import { Telegraf } from 'telegraf';
import logger from '../../utils/logger';
import User from '../../models/User';
import UnifiedSession from '../../models/UnifiedSession';
import { UnifiedScannerService } from '../../services/UnifiedScannerService';
import { BingXService } from '../../services/BingXService';
import { TradeManager } from '../../services/TradeManager';
import { getMainMenuKeyboard } from '../keyboards/baseKeyboards';

const ALL_ANALYSIS_ENGINES = [
    'V1', 'V2', 'V3', 'V4', 'V5', 'V6', 'V7', 'V8',
    'V9', 'V10', 'V11', 'V12', 'V13', 'V14', 'V15', 'V16',
    'V17', 'V18', 'HARMONIC'
];

const ALL_SNIPER_ENGINES = [
    'HARMONIC-SWING', 'HARMONIC-SCALP',
    'V18-SWING', 'V18-SCALP',
    'V17-SWING', 'V17-SCALP',
    'V16-SWING', 'V16-SCALP',
    'V15-SWING', 'V15-SCALP',
    'V14-SWING', 'V14-SCALP',
    'V13-SWING', 'V13-SCALP',
    'V12-SWING', 'V12-SCALP',
    'V11-SWING', 'V11-SCALP',
    'V10-SWING', 'V10-SCALP',
    'V9-SWING', 'V9-SCALP',
    'V8-SWING', 'V8-SCALP',
    'V7-SWING', 'V7-SCALP',
    'V1-SWING', 'V1-SCALP'
];

export function getAnalysisSelectionKeyboard(sessionId: string, selected: string[]) {
    const inline_keyboard: any[][] = [];
    const rowSize = 3;
    for (let i = 0; i < ALL_ANALYSIS_ENGINES.length; i += rowSize) {
        const row = ALL_ANALYSIS_ENGINES.slice(i, i + rowSize).map(eng => {
            const isSel = selected.includes(eng);
            return {
                text: `${isSel ? '✅' : '⬜'} ${eng}`,
                callback_data: `uni_tgl_${sessionId}_${eng}`
            };
        });
        inline_keyboard.push(row);
    }
    inline_keyboard.push([
        { text: '➕ تحديد الكل', callback_data: `uni_all_${sessionId}` },
        { text: '➖ إلغاء الكل', callback_data: `uni_none_${sessionId}` }
    ]);
    inline_keyboard.push([
        { text: '🚀 تشغيل التحليل الموحد', callback_data: `uni_run_${sessionId}` }
    ]);
    inline_keyboard.push([
        { text: '🔙 رجوع للقائمة', callback_data: 'uni_back_to_main' }
    ]);
    return { inline_keyboard };
}

export function getSniperSelectionKeyboard(sessionId: string, selected: string[]) {
    const inline_keyboard: any[][] = [];
    const rowSize = 2;
    for (let i = 0; i < ALL_SNIPER_ENGINES.length; i += rowSize) {
        const row = ALL_SNIPER_ENGINES.slice(i, i + rowSize).map(eng => {
            const isSel = selected.includes(eng);
            const label = eng.replace('-SCALP', '⚡').replace('-SWING', '🌊');
            return {
                text: `${isSel ? '✅' : '⬜'} ${label}`,
                callback_data: `uni_tgl_${sessionId}_${eng}`
            };
        });
        inline_keyboard.push(row);
    }
    inline_keyboard.push([
        { text: '➕ تحديد الكل', callback_data: `uni_all_${sessionId}` },
        { text: '➖ إلغاء الكل', callback_data: `uni_none_${sessionId}` }
    ]);
    inline_keyboard.push([
        { text: '🚀 تشغيل القنص الموحد', callback_data: `uni_run_${sessionId}` }
    ]);
    inline_keyboard.push([
        { text: '🔙 رجوع للقائمة', callback_data: 'uni_back_to_main' }
    ]);
    return { inline_keyboard };
}

export function registerUnifiedHandlers(bot: Telegraf, tradeManager: TradeManager) {
    const bingxService = new BingXService();
    const unifiedScannerService = new UnifiedScannerService(bingxService);

    // --- MAIN HEARS ENTRY ---
    bot.hears('🔍 التحليل والقنص الموحد', async (ctx) => {
        try {
            const telegramId = ctx.from!.id.toString();
            const user = await User.findOne({ telegramId });
            if (!user) return ctx.reply('❌ مستخدم غير مسجل.');

            await ctx.reply('🔍 **لوحة التحليل والقنص الموحد**\n\nتتيح لك هذه الوحدة إجراء فحص متعدد للمؤشرات والمحركات على عملة واحدة أو عدة عملات دفعة واحدة.\n\nاختر نوع المسح المطلوب:', {
                reply_markup: {
                    inline_keyboard: [
                        [
                            { text: '📊 التحليل الفني الموحد', callback_data: 'uni_init_analysis' },
                            { text: '🎯 القنص/الفرص الموحد', callback_data: 'uni_init_sniper' }
                        ],
                        [
                            { text: '❌ إغلاق', callback_data: 'uni_close' }
                        ]
                    ]
                }
            });
        } catch (error) {
            logger.error('Error in hears 🔍 التحليل والقنص الموحد:', error);
        }
    });

    // --- CALLBACK HANDLERS ---
    bot.action('uni_close', async (ctx) => {
        try {
            await ctx.deleteMessage().catch(() => {});
            await ctx.answerCbQuery().catch(() => {});
        } catch (e) {}
    });

    bot.action('uni_back_to_main', async (ctx) => {
        try {
            await ctx.editMessageText('🔍 **لوحة التحليل والقنص الموحد**\n\nتتيح لك هذه الوحدة إجراء فحص متعدد للمؤشرات والمحركات على عملة واحدة أو عدة عملات دفعة واحدة.\n\nاختر نوع المسح المطلوب:', {
                reply_markup: {
                    inline_keyboard: [
                        [
                            { text: '📊 التحليل الفني الموحد', callback_data: 'uni_init_analysis' },
                            { text: '🎯 القنص/الفرص الموحد', callback_data: 'uni_init_sniper' }
                        ],
                        [
                            { text: '❌ إغلاق', callback_data: 'uni_close' }
                        ]
                    ]
                }
            });
            await ctx.answerCbQuery().catch(() => {});
        } catch (e) {}
    });

    bot.action('uni_init_analysis', async (ctx) => {
        try {
            const telegramId = ctx.from!.id.toString();
            const user = await User.findOne({ telegramId });
            if (!user) return ctx.answerCbQuery('المستخدم غير موجود');

            user.botState = 'AWAITING_UNIFIED_SYMBOLS_ANALYSIS';
            await user.save();

            await ctx.editMessageText(
                '✏️ **يرجى إرسال رمز العملة أو العملات مفصولة بمسافة أو فاصلة**\n\n(مثال: `BTC, ETH, SOL` أو `BTC` لعملة واحدة فقط):',
                {
                    parse_mode: 'Markdown',
                    reply_markup: {
                        inline_keyboard: [[{ text: '❌ إلغاء والعودة', callback_data: 'uni_back_to_main' }]]
                    }
                }
            );
            await ctx.answerCbQuery().catch(() => {});
        } catch (e) {
            logger.error('uni_init_analysis error:', e);
        }
    });

    bot.action('uni_init_sniper', async (ctx) => {
        try {
            const telegramId = ctx.from!.id.toString();
            const user = await User.findOne({ telegramId });
            if (!user) return ctx.answerCbQuery('المستخدم غير موجود');

            user.botState = 'AWAITING_UNIFIED_SYMBOLS_SNIPER';
            await user.save();

            await ctx.editMessageText(
                '✏️ **يرجى إرسال رمز العملة أو العملات مفصولة بمسافة أو فاصلة**\n\n(مثال: `BTC, ETH, SOL` أو `BTC` لعملة واحدة فقط):',
                {
                    parse_mode: 'Markdown',
                    reply_markup: {
                        inline_keyboard: [[{ text: '❌ إلغاء والعودة', callback_data: 'uni_back_to_main' }]]
                    }
                }
            );
            await ctx.answerCbQuery().catch(() => {});
        } catch (e) {
            logger.error('uni_init_sniper error:', e);
        }
    });

    // Toggle engines
    bot.action(/^uni_tgl_([^_]+)_(.+)$/, async (ctx) => {
        try {
            const sessionId = ctx.match[1];
            const engineId = ctx.match[2];

            const session = await UnifiedSession.findById(sessionId);
            if (!session) return ctx.answerCbQuery('⚠️ الجلسة منتهية، يرجى المحاولة مجدداً.');

            if (session.selectedEngines.includes(engineId)) {
                session.selectedEngines = session.selectedEngines.filter(e => e !== engineId);
            } else {
                session.selectedEngines.push(engineId);
            }
            await session.save();

            const isAnalysis = session.type === 'analysis';
            const keyboard = isAnalysis 
                ? getAnalysisSelectionKeyboard(sessionId, session.selectedEngines)
                : getSniperSelectionKeyboard(sessionId, session.selectedEngines);

            const displaySymbols = session.symbols.map(s => s.split('/')[0]).join(', ');
            await ctx.editMessageText(
                `⚙️ **لوحة تحديد محركات ${isAnalysis ? 'التحليل' : 'القنص'}:**\n\nالعملات المحددة: \`${displaySymbols}\`\n\nقم بتحديد المحركات المطلوبة أدناه:`,
                { parse_mode: 'Markdown', reply_markup: keyboard }
            ).catch(() => {});
            await ctx.answerCbQuery().catch(() => {});
        } catch (e) {
            logger.error('Toggle engine error:', e);
        }
    });

    // Select All engines
    bot.action(/^uni_all_(.+)$/, async (ctx) => {
        try {
            const sessionId = ctx.match[1];
            const session = await UnifiedSession.findById(sessionId);
            if (!session) return ctx.answerCbQuery('⚠️ الجلسة منتهية.');

            const isAnalysis = session.type === 'analysis';
            session.selectedEngines = isAnalysis ? ALL_ANALYSIS_ENGINES : ALL_SNIPER_ENGINES;
            await session.save();

            const keyboard = isAnalysis 
                ? getAnalysisSelectionKeyboard(sessionId, session.selectedEngines)
                : getSniperSelectionKeyboard(sessionId, session.selectedEngines);

            const displaySymbols = session.symbols.map(s => s.split('/')[0]).join(', ');
            await ctx.editMessageText(
                `⚙️ **لوحة تحديد محركات ${isAnalysis ? 'التحليل' : 'القنص'}:**\n\nالعملات المحددة: \`${displaySymbols}\`\n\nقم بتحديد المحركات المطلوبة أدناه:`,
                { parse_mode: 'Markdown', reply_markup: keyboard }
            ).catch(() => {});
            await ctx.answerCbQuery('تم تحديد الكل ✅').catch(() => {});
        } catch (e) {
            logger.error('Select all error:', e);
        }
    });

    // Deselect All engines
    bot.action(/^uni_none_(.+)$/, async (ctx) => {
        try {
            const sessionId = ctx.match[1];
            const session = await UnifiedSession.findById(sessionId);
            if (!session) return ctx.answerCbQuery('⚠️ الجلسة منتهية.');

            const isAnalysis = session.type === 'analysis';
            session.selectedEngines = [];
            await session.save();

            const keyboard = isAnalysis 
                ? getAnalysisSelectionKeyboard(sessionId, session.selectedEngines)
                : getSniperSelectionKeyboard(sessionId, session.selectedEngines);

            const displaySymbols = session.symbols.map(s => s.split('/')[0]).join(', ');
            await ctx.editMessageText(
                `⚙️ **لوحة تحديد محركات ${isAnalysis ? 'التحليل' : 'القنص'}:**\n\nالعملات المحددة: \`${displaySymbols}\`\n\nقم بتحديد المحركات المطلوبة أدناه:`,
                { parse_mode: 'Markdown', reply_markup: keyboard }
            ).catch(() => {});
            await ctx.answerCbQuery('تم إلغاء تحديد الكل ❌').catch(() => {});
        } catch (e) {
            logger.error('Deselect all error:', e);
        }
    });

    // Run Scanner
    bot.action(/^uni_run_(.+)$/, async (ctx) => {
        try {
            const sessionId = ctx.match[1];
            const session = await UnifiedSession.findById(sessionId);
            if (!session) return ctx.answerCbQuery('⚠️ الجلسة منتهية.');

            if (session.selectedEngines.length === 0) {
                return ctx.answerCbQuery('⚠️ يجب تحديد محرك واحد على الأقل للتشغيل!');
            }

            const telegramId = ctx.from!.id.toString();
            const user = await User.findOne({ telegramId });

            await ctx.editMessageText(
                `⏳ **جاري جلب البيانات وتشغيل المحركات المحددة...**\n\n` +
                `العملات: \`${session.symbols.map(s => s.split('/')[0]).join(', ')}\`\n` +
                `عدد المحركات: \`${session.selectedEngines.length}\`\n\n` +
                `_قد يستغرق ذلك من 10 إلى 25 ثانية، يرجى الانتظار..._`,
                { parse_mode: 'Markdown' }
            );
            await ctx.answerCbQuery('⏳ بدأ تشغيل التحليل...').catch(() => {});

            const isAnalysis = session.type === 'analysis';
            const cacheUpdates: any[] = [];

            if (isAnalysis) {
                const scanResults = await unifiedScannerService.runUnifiedAnalysis(session.symbols, session.selectedEngines, {
                    quickTF: user?.analysisSettings?.scalpTF,
                    longTF: user?.analysisSettings?.swingTF,
                    limit: user?.analysisSettings?.candleLimit,
                    antiRepainting: user?.analysisSettings?.antiRepaintingEnabled
                });

                for (const result of scanResults) {
                    if (result.error) {
                        await ctx.reply(result.reportText, { parse_mode: 'Markdown' });
                        continue;
                    }

                    // Cache the main unified summary report
                    cacheUpdates.push({
                        symbol: result.symbol,
                        engineId: 'SUMMARY',
                        reportText: result.reportText
                    });

                    // Format inline keyboard buttons for each engine to view details & copy
                    const inline_keyboard: any[][] = [];
                    result.engines.forEach((er: any) => {
                        const hasSignal = er.analysisResult.scalp.type !== 'NONE' || er.analysisResult.swing.type !== 'NONE';
                        const symbolShort = result.symbol.split('/')[0];
                        const row = [
                            { text: `🔍 تفاصيل ${er.engineId}`, callback_data: `uni_det_${sessionId}_${symbolShort}_${er.engineId}` }
                        ];
                        if (hasSignal) {
                            row.push({ text: `📝 نسخ ${er.engineId}`, callback_data: `uni_cp_${sessionId}_${symbolShort}_${er.engineId}` });
                            row.push({ text: `⚡ تنفيذ ${er.engineId}`, callback_data: `uni_ex_${sessionId}_${symbolShort}_${er.engineId}` });
                        }
                        inline_keyboard.push(row);
                        
                        // Extract signal fields for caching
                        const activeRec = er.analysisResult.scalp.type !== 'NONE' ? er.analysisResult.scalp : er.analysisResult.swing;
                        cacheUpdates.push({
                            symbol: result.symbol,
                            engineId: er.engineId,
                            reportText: er.reportText,
                            signal: {
                                direction: activeRec.type,
                                entry: activeRec.entry,
                                tp: activeRec.tp,
                                tp2: activeRec.tp2 || 0,
                                sl: activeRec.sl,
                                precision: result.pricePrecision
                            }
                        });
                    });

                    // Send the unified report for this coin
                    await ctx.reply(result.reportText, {
                        parse_mode: 'Markdown',
                        reply_markup: { inline_keyboard }
                    });
                }
            } else {
                // Sniper Mode
                const scanResults = await unifiedScannerService.runUnifiedSniper(session.symbols, session.selectedEngines);

                for (const result of scanResults) {
                    if (result.error) {
                        await ctx.reply(result.reportText, { parse_mode: 'Markdown' });
                        continue;
                    }

                    // Cache the main unified summary report
                    cacheUpdates.push({
                        symbol: result.symbol,
                        engineId: 'SUMMARY',
                        reportText: result.reportText
                    });

                    // Cache all engine reports
                    result.engines.forEach((er: any) => {
                        cacheUpdates.push({
                            symbol: result.symbol,
                            engineId: er.engineId,
                            reportText: er.reportText,
                            signal: {
                                direction: er.sniperReport.direction,
                                entry: er.sniperReport.entry,
                                tp: er.sniperReport.tp,
                                tp2: er.sniperReport.tp2 || 0,
                                sl: er.sniperReport.sl,
                                precision: result.pricePrecision
                            }
                        });
                    });

                    // Build smart keyboard for top active engines (up to 8 rows) to keep UI clean and avoid payload limits
                    const inline_keyboard: any[][] = [];
                    const activeEngines = result.engines.filter((er: any) => er.sniperReport.direction !== 'NONE' || er.sniperReport.readyToFire);
                    const keyboardEngines = (activeEngines.length > 0 ? activeEngines : result.engines).slice(0, 8);

                    keyboardEngines.forEach((er: any) => {
                        const hasSignal = er.sniperReport.direction !== 'NONE';
                        const symbolShort = result.symbol.split('/')[0];
                        const row = [
                            { text: `🔍 تفاصيل ${er.engineId}`, callback_data: `uni_det_${sessionId}_${symbolShort}_${er.engineId}` }
                        ];
                        if (hasSignal) {
                            row.push({ text: `📝 نسخ`, callback_data: `uni_cp_${sessionId}_${symbolShort}_${er.engineId}` });
                            row.push({ text: `⚡ تنفيذ`, callback_data: `uni_ex_${sessionId}_${symbolShort}_${er.engineId}` });
                        }
                        inline_keyboard.push(row);
                    });

                    // Send unified sniper report safely (with markdown error fallback)
                    try {
                        await ctx.reply(result.reportText, {
                            parse_mode: 'Markdown',
                            reply_markup: { inline_keyboard }
                        });
                    } catch (sendErr: any) {
                        logger.warn('Markdown parse failed, sending without parse_mode:', sendErr.message);
                        await ctx.reply(result.reportText, {
                            reply_markup: { inline_keyboard }
                        });
                    }
                }
            }

            // Save cache updates to session document
            session.cachedResults = cacheUpdates;
            await session.save();

            // Clean up loading message
            await ctx.deleteMessage().catch(() => {});
        } catch (e: any) {
            logger.error('uni_run error:', e);
            await ctx.reply(`❌ حدث خطأ أثناء تشغيل الفحص الموحد: ${e.message}`);
        }
    });

    // View Engine Details
    bot.action(/^uni_det_([^_]+)_([^_]+)_(.+)$/, async (ctx) => {
        try {
            const sessionId = ctx.match[1];
            const symbolShort = ctx.match[2];
            const engineId = ctx.match[3];

            const session = await UnifiedSession.findById(sessionId);
            if (!session) return ctx.answerCbQuery('⚠️ الجلسة منتهية.').catch(() => {});

            const result = session.cachedResults?.find(r => r.symbol.startsWith(symbolShort) && r.engineId === engineId);
            if (!result) return ctx.answerCbQuery('⚠️ لم يتم العثور على التفاصيل المخزنة.').catch(() => {});

            await ctx.answerCbQuery().catch(() => {});

            const replyMarkup = {
                inline_keyboard: [
                    [
                        { text: '🔙 رجوع للتقرير الموحد', callback_data: `uni_back_rep_${sessionId}_${symbolShort}` }
                    ]
                ]
            };

            // Show standalone details page with safe entity parsing fallback
            try {
                await ctx.editMessageText(result.reportText, {
                    parse_mode: 'Markdown',
                    reply_markup: replyMarkup
                });
            } catch (err: any) {
                if (err.message?.includes('can\'t parse entities') || err.message?.includes('Bad Request')) {
                    await ctx.editMessageText(result.reportText, {
                        reply_markup: replyMarkup
                    }).catch(() => {});
                } else if (!err.message?.includes('message is not modified')) {
                    logger.warn('Failed to edit details message:', err.message);
                }
            }
        } catch (e) {
            logger.error('View details action error:', e);
        }
    });


    // Re-render unified report back callback handler
    bot.action(/^uni_back_rep_([^_]+)_(.+)$/, async (ctx) => {
        try {
            const sessionId = ctx.match[1];
            const symbolShort = ctx.match[2];

            const session = await UnifiedSession.findById(sessionId);
            if (!session) return ctx.answerCbQuery('⚠️ الجلسة منتهية.').catch(() => {});

            const summaryEntry = session.cachedResults?.find(r => r.symbol.startsWith(symbolShort) && r.engineId === 'SUMMARY');
            if (!summaryEntry) return ctx.answerCbQuery('⚠️ لم يتم العثور على التقرير الموحد.').catch(() => {});

            // Reconstruct keyboard for active engines
            const inline_keyboard: any[][] = [];
            const symbolEntries = session.cachedResults?.filter(r => r.symbol.startsWith(symbolShort) && r.engineId !== 'SUMMARY') || [];
            const activeEntries = symbolEntries.filter(r => r.signal && r.signal.direction !== 'NONE');
            const displayEntries = (activeEntries.length > 0 ? activeEntries : symbolEntries).slice(0, 8);

            displayEntries.forEach(r => {
                const hasSignal = r.signal && r.signal.direction !== 'NONE';
                const row = [
                    { text: `🔍 تفاصيل ${r.engineId}`, callback_data: `uni_det_${sessionId}_${symbolShort}_${r.engineId}` }
                ];
                if (hasSignal) {
                    row.push({ text: `📝 نسخ`, callback_data: `uni_cp_${sessionId}_${symbolShort}_${r.engineId}` });
                    row.push({ text: `⚡ تنفيذ`, callback_data: `uni_ex_${sessionId}_${symbolShort}_${r.engineId}` });
                }
                inline_keyboard.push(row);
            });

            try {
                await ctx.editMessageText(summaryEntry.reportText, {
                    parse_mode: 'Markdown',
                    reply_markup: { inline_keyboard }
                });
            } catch (err: any) {
                if (err.message?.includes('can\'t parse entities')) {
                    await ctx.editMessageText(summaryEntry.reportText, {
                        reply_markup: { inline_keyboard }
                    }).catch(() => {});
                } else if (!err.message?.includes('message is not modified')) {
                    logger.warn('Failed to edit back-to-summary message:', err.message);
                }
            }
            await ctx.answerCbQuery().catch(() => {});
        } catch (e) {
            logger.error('Re-render unified report error:', e);
        }
    });

    // Copy Trade Code Block
    bot.action(/^uni_cp_([^_]+)_([^_]+)_(.+)$/, async (ctx) => {
        try {
            const sessionId = ctx.match[1];
            const symbolShort = ctx.match[2];
            const engineId = ctx.match[3];

            const session = await UnifiedSession.findById(sessionId);
            if (!session) return ctx.answerCbQuery('⚠️ الجلسة منتهية.');

            const result = session.cachedResults?.find(r => r.symbol.startsWith(symbolShort) && r.engineId === engineId);
            if (!result || !result.signal || result.signal.direction === 'NONE') {
                return ctx.answerCbQuery('⚠️ لا توجد إشارة صالحة للنسخ.');
            }

            const telegramId = ctx.from!.id.toString();
            const user = await User.findOne({ telegramId });
            const levVal = user && user.leverageMode === 'fixed' ? user.fixedLeverageValue : 10;
            const finalSymbol = result.symbol;

            const dirEmoji = result.signal.direction === 'LONG' ? '🔼' : '🔻';
            const tpText = result.signal.tp2 && result.signal.tp2 !== 0 
                ? `${result.signal.tp.toFixed(result.signal.precision)}\n${result.signal.tp2.toFixed(result.signal.precision)}` 
                : `${result.signal.tp.toFixed(result.signal.precision)}`;

            const copyBox = `${finalSymbol}

${dirEmoji}${result.signal.direction}  X${levVal}  

▶️ENTER PRICE(سعر الدخول):
${result.signal.entry.toFixed(result.signal.precision)}

▶️TARGET  PRICES(الاهداف):
${tpText}

▶️STOP LOSE(الاستوب)
${result.signal.sl.toFixed(result.signal.precision)}`;

            await ctx.reply(
                `📝 *إليك بيانات الصفقة جاهزة للنسخ بنقرة واحدة:*\n` +
                `(اضغط على الكود أدناه لنسخه تلقائياً)\n\n` +
                `\`\`\`\n${copyBox}\n\`\`\``,
                { parse_mode: 'Markdown' }
            );
            await ctx.answerCbQuery('تم توليد كود النسخ ✅').catch(() => {});
        } catch (e) {
            logger.error('Copy trade action error:', e);
            await ctx.reply('❌ فشل توليد كود النسخ.');
        }
    });

    // Execute Trade
    bot.action(/^uni_ex_([^_]+)_([^_]+)_(.+)$/, async (ctx) => {
        try {
            const sessionId = ctx.match[1];
            const symbolShort = ctx.match[2];
            const engineId = ctx.match[3];

            const session = await UnifiedSession.findById(sessionId);
            if (!session) return ctx.answerCbQuery('⚠️ الجلسة منتهية.');

            const result = session.cachedResults?.find(r => r.symbol.startsWith(symbolShort) && r.engineId === engineId);
            if (!result || !result.signal || result.signal.direction === 'NONE') {
                return ctx.answerCbQuery('⚠️ لا توجد إشارة صالحة للتنفيذ.');
            }

            const telegramId = ctx.from!.id.toString();
            const user = await User.findOne({ telegramId });
            if (!user) return ctx.answerCbQuery('لم يتم العثور على المستخدم');

            await ctx.answerCbQuery('⏳ جاري تنفيذ الصفقة...').catch(() => {});

            const targets = [result.signal.tp];
            if (result.signal.tp2 && result.signal.tp2 !== 0) {
                targets.push(result.signal.tp2);
            }

            const signal = {
                type: 'TRADE' as const,
                symbol: result.symbol,
                direction: result.signal.direction,
                entry: [result.signal.entry],
                targets,
                stopLoss: result.signal.sl
            };

            await ctx.reply(`⏳ جاري إرسال إشارة الدخول لـ ${symbolShort} (${result.signal.direction}) للمنصة...`);
            await tradeManager.executeSignal(signal, user._id.toString(), ctx.chat!.id.toString());

        } catch (e: any) {
            logger.error('Execute trade action error:', e);
            await ctx.reply(`❌ فشل تنفيذ الصفقة: ${e.message}`);
        }
    });
}
