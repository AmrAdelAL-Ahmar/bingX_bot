import { Telegraf } from 'telegraf';
import logger from '../../utils/logger';
import { AutonomousOrchestrator } from '../../services/AutonomousOrchestrator';
import { TradeManager } from '../../services/TradeManager';
import { TradingMemoryService } from '../../services/TradingMemoryService';
import { MacroCalendarService } from '../../services/MacroCalendarService';
import { BingXService } from '../../services/BingXService';
import { EngineConfluenceArbiter } from '../../core/analysis/EngineConfluenceArbiter';
import { MATRIX_TFS } from '../../core/analysis/TechnicalAnalyzer';
import { OHLCV } from '../../core/shared/types';
import { GeminiService } from '../../services/GeminiService';
import { PaperTradingEngine } from '../../services/PaperTradingEngine';
import User from '../../models/User';
import Trade from '../../models/Trade';
import { getMainMenuKeyboard } from '../keyboards/baseKeyboards';

export const registerAutonomousHandlers = (
    bot: Telegraf,
    orchestrator: AutonomousOrchestrator,
    tradeManager: TradeManager,
    bingxService?: BingXService
) => {
    const bingx: BingXService = bingxService || (tradeManager as any).bingx;
    // ── 1. Text Button Triggers (Reply Keyboard) ─────────────────────────────
    bot.hears('🚀 منظومة التداول الذاتي V2 (Auto/Paper)', async (ctx) => {
        try {
            await renderAutonomousDashboard(ctx, orchestrator);
        } catch (e: any) {
            logger.error('Error in hears Autonomous V2:', e);
            ctx.reply('❌ حدث خطأ أثناء فتح لوحة منظومة التداول الذاتي.');
        }
    });

    bot.hears('🎮 المحفظة الافتراضية (Paper Hub)', async (ctx) => {
        try {
            await renderPaperStats(ctx, orchestrator);
        } catch (e: any) {
            logger.error('Error in hears Paper Hub:', e);
            ctx.reply('❌ حدث خطأ أثناء جلب تفاصيل المحفظة الافتراضية.');
        }
    });

    // ── 2. Command Triggers ──────────────────────────────────────────────────
    bot.command(['auto', 'autonomous'], async (ctx) => {
        try {
            await renderAutonomousDashboard(ctx, orchestrator);
        } catch (e: any) {
            logger.error('Error in /auto command:', e);
            ctx.reply('❌ حدث خطأ أثناء فتح لوحة التحكم الذاتي.');
        }
    });

    bot.command('paper', async (ctx) => {
        try {
            await renderPaperStats(ctx, orchestrator);
        } catch (e: any) {
            logger.error('Error in /paper command:', e);
            ctx.reply('❌ حدث خطأ أثناء جلب إحصائيات المحاكاة.');
        }
    });

    bot.command(['set_paper_balance', 'paper_balance', 'paper_capital'], async (ctx) => {
        try {
            const text = ctx.message?.text || '';
            const parts = text.split(/\s+/).filter(Boolean);
            if (parts.length >= 2) {
                const amount = parseFloat(parts[1]);
                if (isNaN(amount) || amount <= 0) {
                    return ctx.reply('⚠️ الرجاء إدخال مبلغ صحيح لرأس المال، مثال:\n<code>/set_paper_balance 1500</code>', { parse_mode: 'HTML' });
                }
                await orchestrator.getPaperEngine().resetAccount(undefined, amount);
                await ctx.reply(`✅ <b>تم تصفير السجل الافتراضي وتعيين رأس المال الأولي إلى: $${amount.toLocaleString()} USDT والبدء من جديد!</b>`, { parse_mode: 'HTML' });
                await renderPaperStats(ctx, orchestrator);
            } else {
                await renderPaperBalancePicker(ctx);
            }
        } catch (e: any) {
            logger.error('Error in /set_paper_balance command:', e);
            ctx.reply('❌ حدث خطأ أثناء ضبط رأس المال الافتراضي.');
        }
    });

    bot.command(['paper_trades', 'paper_active'], async (ctx) => {
        try {
            await renderOpenPaperTrades(ctx, orchestrator);
        } catch (e: any) {
            logger.error('Error in /paper_trades command:', e);
            ctx.reply('❌ حدث خطأ أثناء جلب الصفقات الافتراضية النشطة.');
        }
    });

    bot.command(['paper_history', 'paper_closed'], async (ctx) => {
        try {
            await renderPaperHistory(ctx, orchestrator, 1);
        } catch (e: any) {
            logger.error('Error in /paper_history command:', e);
            ctx.reply('❌ حدث خطأ أثناء جلب سجل الصفقات الافتراضية.');
        }
    });

    bot.command(['engines', 'engine_stats'], async (ctx) => {
        try {
            await renderEngineWeightsHub(ctx, orchestrator);
        } catch (e: any) {
            logger.error('Error in /engines command:', e);
            ctx.reply('❌ حدث خطأ أثناء جلب تقييم المحركات.');
        }
    });

    bot.command(['analyze', 'math', 'dossier'], async (ctx) => {
        try {
            const text = ctx.message?.text || '';
            const parts = text.split(/\s+/).filter(Boolean);
            if (parts.length >= 2) {
                const rawSym = parts[1].trim();
                await renderMathematicalAnalysis(ctx, rawSym, bingx, orchestrator);
            } else {
                await renderAnalyzePicker(ctx);
            }
        } catch (e: any) {
            logger.error('Error in /analyze command:', e);
            ctx.reply('❌ حدث خطأ أثناء تشغيل الفحص الرياضي.');
        }
    });

    bot.command(['help', 'commands', 'all_commands'], async (ctx) => {
        try {
            const helpMsg =
                `📜 <b>دليل أوامر البوت الشامل (اضغط على أي أمر لنسخه):</b>\n` +
                `━━━━━━━━━━━━━━━━━━━━━\n\n` +
                `🚀 <b>منظومة التداول الذاتي والمحاكاة:</b>\n` +
                `• <code>/auto</code> — لوحة القيادة لمنظومة التداول الذاتي V2\n` +
                `• <code>/paper</code> — لوحة المحفظة الافتراضية وإحصائياتها\n` +
                `• <code>/paper_trades</code> — الصفقات الافتراضية المفتوحة الآن\n` +
                `• <code>/paper_history</code> — سجل الصفقات الافتراضية المغلقة\n` +
                `• <code>/set_paper_balance 100</code> — تحديد رأس مال افتراضي وتصفير السجل\n` +
                `• <code>/analyze BTC</code> — الفحص والتحليل الرياضي لأي عملة\n` +
                `• <code>/engines</code> — ميزان أداء وتقييم المحركات والذاكرة\n\n` +
                `💼 <b>إدارة الحساب الحقيقي والمنصة (BingX):</b>\n` +
                `• <code>/status</code> — الصفقات والمراكز الحية النشطة في المنصة\n` +
                `• <code>/balance</code> — الاستعلام عن رصيد حساب BingX الحقيقي\n` +
                `• <code>/macro</code> — رادار الأخبار الكلية وأوقات التوقف\n` +
                `• <code>/heat</code> — فحص حرارة المحفظة وترابط الصفقات\n` +
                `• <code>/circuit_breaker</code> — نظام قاطع الدائرة للحماية من التراجع\n` +
                `• <code>/panic</code> — 🚨 إغلاق فوري لجميع المراكز وإلغاء الأوامر\n` +
                `• <code>/menu</code> — العودة للقائمة الرئيسية للبوت\n` +
                `━━━━━━━━━━━━━━━━━━━━━\n` +
                `💡 <i>يمكنك الضغط على أي أمر مكتوب داخل المربع لنسخه واستخدامه فوراً.</i>`;

            await ctx.replyWithHTML(helpMsg);
        } catch (e: any) {
            logger.error('Error in /help command:', e);
            ctx.reply('❌ حدث خطأ أثناء عرض قائمة الأوامر.');
        }
    });

    bot.action(['menu_autonomous', 'aut_main_menu'], async (ctx) => {
        try {
            await ctx.answerCbQuery().catch(() => {});
            await renderAutonomousDashboard(ctx, orchestrator, true);
        } catch (e: any) {
            logger.error('Error in menu_autonomous action:', e);
        }
    });

    bot.action('aut_view_paper_stats', async (ctx) => {
        try {
            await ctx.answerCbQuery().catch(() => {});
            await renderPaperStats(ctx, orchestrator, true);
        } catch (e: any) {
            logger.error('Error in aut_view_paper_stats:', e);
        }
    });

    bot.action('aut_ai_audit_menu', async (ctx) => {
        try {
            await ctx.answerCbQuery().catch(() => {});
            await renderAiAuditHub(ctx, orchestrator);
        } catch (e: any) {
            logger.error('Error in aut_ai_audit_menu:', e);
        }
    });

    bot.action('aut_engine_weights_menu', async (ctx) => {
        try {
            await ctx.answerCbQuery().catch(() => {});
            await renderEngineWeightsHub(ctx, orchestrator);
        } catch (e: any) {
            logger.error('Error in aut_engine_weights_menu:', e);
        }
    });

    bot.action('aut_macro_menu', async (ctx) => {
        try {
            await ctx.answerCbQuery().catch(() => {});
            await renderMacroHub(ctx, orchestrator);
        } catch (e: any) {
            logger.error('Error in aut_macro_menu:', e);
        }
    });

    // ── 4. Control Toggles (Mode, Pause, AI, Macro) ─────────────────────────
    bot.action('aut_set_paper', async (ctx) => {
        orchestrator.currentMode = 'PAPER_TRADING';
        await ctx.answerCbQuery('✅ تم تفعيل نمط التداول الافتراضي (Paper Trading)').catch(() => {});
        await renderAutonomousDashboard(ctx, orchestrator, true);
    });

    bot.action('aut_set_semi', async (ctx) => {
        orchestrator.currentMode = 'SEMI_AUTO';
        await ctx.answerCbQuery('✅ تم تفعيل نمط التداول شبه التلقائي').catch(() => {});
        await renderAutonomousDashboard(ctx, orchestrator, true);
    });

    bot.action('aut_set_full', async (ctx) => {
        orchestrator.currentMode = 'FULL_AUTO';
        await ctx.answerCbQuery('⚠️ تم تفعيل نمط التداول التلقائي الكامل على الحساب الحقيقي').catch(() => {});
        await renderAutonomousDashboard(ctx, orchestrator, true);
    });

    // ── Trade Style Controls ──
    bot.action('aut_style_scalp', async (ctx) => {
        orchestrator.tradeStyle = 'SCALP';
        await ctx.answerCbQuery('⚡ تم تفعيل نمط السكالب (فريمات سريعة 5m / 15m)').catch(() => {});
        await renderAutonomousDashboard(ctx, orchestrator, true);
    });

    bot.action('aut_style_swing', async (ctx) => {
        orchestrator.tradeStyle = 'SWING';
        await ctx.answerCbQuery('🌊 تم تفعيل نمط السوينغ (فريمات اتجاهية 15m / 4h)').catch(() => {});
        await renderAutonomousDashboard(ctx, orchestrator, true);
    });

    bot.action('aut_style_hybrid', async (ctx) => {
        orchestrator.tradeStyle = 'HYBRID';
        await ctx.answerCbQuery('🔄 تم تفعيل النمط الهجين المتوازن').catch(() => {});
        await renderAutonomousDashboard(ctx, orchestrator, true);
    });

    // ── TP Execution Mode Controls ──
    bot.action('aut_tp_single', async (ctx) => {
        orchestrator.tpExecutionMode = 'single';
        await ctx.answerCbQuery('🎯 تم تفعيل نمط الهدف الأول فقط (خروج كامل 100% عند TP1)').catch(() => {});
        await renderAutonomousDashboard(ctx, orchestrator, true);
    });

    bot.action('aut_tp_multiple', async (ctx) => {
        orchestrator.tpExecutionMode = 'multiple';
        await ctx.answerCbQuery('🏆 تم تفعيل نمط جميع الأهداف (تأمين ونقل الستوب للدخول)').catch(() => {});
        await renderAutonomousDashboard(ctx, orchestrator, true);
    });

    // ── Paper Balance & Reset Picker ──
    bot.action('aut_paper_balance_menu', async (ctx) => {
        try {
            await ctx.answerCbQuery().catch(() => {});
            await renderPaperBalancePicker(ctx, true);
        } catch (e: any) {
            logger.error('Error in aut_paper_balance_menu:', e);
        }
    });

    bot.action(/^aut_set_bal_(\d+)$/, async (ctx) => {
        try {
            const amount = parseInt(ctx.match[1]);
            await ctx.answerCbQuery(`⏳ جاري تعيين رأس المال $${amount}...`).catch(() => {});
            await orchestrator.getPaperEngine().resetAccount(undefined, amount);
            await ctx.reply(`✅ <b>تم تصفير السجل الافتراضي وتعيين رأس المال الأولي إلى: $${amount.toLocaleString()} USDT بنجاح والبدء من جديد!</b>`, { parse_mode: 'HTML' });
            await renderPaperStats(ctx, orchestrator);
        } catch (e: any) {
            logger.error('Error in aut_set_bal callback:', e);
            ctx.reply(`❌ فشل تعيين رأس المال: ${e.message}`);
        }
    });

    bot.action('aut_toggle_pause', async (ctx) => {
        orchestrator.isPaused = !orchestrator.isPaused;
        const stateText = orchestrator.isPaused ? '⏸️ تم إيقاف المنظومة مؤقتاً' : '▶️ تم استئناف تشغيل المنظومة';
        await ctx.answerCbQuery(stateText).catch(() => {});
        await renderAutonomousDashboard(ctx, orchestrator, true);
    });

    bot.action('aut_toggle_ai', async (ctx) => {
        orchestrator.isAiAuditEnabled = !orchestrator.isAiAuditEnabled;
        const stateText = orchestrator.isAiAuditEnabled ? '🧠 تم تفعيل تدقيق الذكاء الاصطناعي الإلزامي' : '⚪ تم تعطيل تدقيق الذكاء الاصطناعي (اعتماد التوافق الرياضي)';
        await ctx.answerCbQuery(stateText).catch(() => {});
        await renderAiAuditHub(ctx, orchestrator);
    });

    bot.action('aut_toggle_macro', async (ctx) => {
        orchestrator.isMacroShieldEnabled = !orchestrator.isMacroShieldEnabled;
        const stateText = orchestrator.isMacroShieldEnabled ? '🛡️ تم تفعيل درع حظر التداول وقت الأخبار' : '⚠️ تم تعطيل درع حظر الأخبار';
        await ctx.answerCbQuery(stateText).catch(() => {});
        await renderMacroHub(ctx, orchestrator);
    });

    bot.action(/^aut_set_conf_(\d+)$/, async (ctx) => {
        const score = parseInt(ctx.match[1]);
        orchestrator.minConfluenceScore = score;
        await ctx.answerCbQuery(`🎯 تم ضبط الحد الأدنى للتوافق الرياضي على ${score}%`).catch(() => {});
        await renderAiAuditHub(ctx, orchestrator);
    });

    // ── 5. Instant Actions (Scan, Reset, Open Trades) ───────────────────────
    bot.action('aut_trigger_scan', async (ctx) => {
        await ctx.answerCbQuery('⏳ جاري إطلاق دورة فحص فورية في السوق...').catch(() => {});
        await orchestrator.runAutonomousCycle();
        await ctx.reply('✅ اكتملت دورة الفحص الشاملة بنجاح، وتمت مطابقة الشروط والتدقيق.');
    });

    bot.action('aut_view_open_paper_trades', async (ctx) => {
        try {
            await ctx.answerCbQuery().catch(() => {});
            await renderOpenPaperTrades(ctx, orchestrator);
        } catch (e: any) {
            logger.error('Error in aut_view_open_paper_trades:', e);
        }
    });

    bot.action('aut_view_paper_history', async (ctx) => {
        try {
            await ctx.answerCbQuery().catch(() => {});
            await renderPaperHistory(ctx, orchestrator, 1);
        } catch (e: any) {
            logger.error('Error in aut_view_paper_history:', e);
        }
    });

    bot.action(/^aut_paper_hist_p_(\d+)$/, async (ctx) => {
        try {
            const page = parseInt(ctx.match[1]) || 1;
            await ctx.answerCbQuery().catch(() => {});
            await renderPaperHistory(ctx, orchestrator, page);
        } catch (e: any) {
            logger.error('Error in aut_paper_hist_p callback:', e);
        }
    });

    bot.action('aut_analyze_picker', async (ctx) => {
        try {
            await ctx.answerCbQuery().catch(() => {});
            await renderAnalyzePicker(ctx, true);
        } catch (e: any) {
            logger.error('Error in aut_analyze_picker action:', e);
        }
    });

    bot.action(/^aut_math_analyze_([A-Z0-9]+)$/, async (ctx) => {
        try {
            const sym = ctx.match[1];
            await ctx.answerCbQuery(`جاري فحص ${sym} رياضياً...`).catch(() => {});
            await renderMathematicalAnalysis(ctx, sym, bingx, orchestrator, true);
        } catch (e: any) {
            logger.error('Error in aut_math_analyze callback:', e);
        }
    });

    bot.action(/^aut_ai_audit_now_([A-Z0-9]+)$/, async (ctx) => {
        try {
            const sym = ctx.match[1];
            await ctx.answerCbQuery(`جاري تدقيق ${sym} بالذكاء الاصطناعي...`).catch(() => {});
            await runOnDemandAiAudit(ctx, sym, bingx, orchestrator);
        } catch (e: any) {
            logger.error('Error in aut_ai_audit_now callback:', e);
        }
    });

    bot.action(/^aut_paper_exec_([A-Z0-9]+)$/, async (ctx) => {
        try {
            const sym = ctx.match[1];
            await ctx.answerCbQuery(`جاري فتح صفقة تجريبية على ${sym}...`).catch(() => {});
            await executeOnDemandPaperTrade(ctx, sym, bingx, orchestrator);
        } catch (e: any) {
            logger.error('Error in aut_paper_exec callback:', e);
        }
    });

    bot.action('aut_reset_paper_confirm', async (ctx) => {
        await ctx.answerCbQuery().catch(() => {});
        const keyboard = {
            inline_keyboard: [
                [
                    { text: '⚠️ تأكيد تصفير المحفظة واستعادة 1000$', callback_data: 'aut_reset_paper_do' }
                ],
                [
                    { text: '🔙 إلغاء وتراجع', callback_data: 'aut_view_paper_stats' }
                ]
            ]
        };
        await ctx.reply(
            '⚠️ <b>تحذير: إعادة ضبط المحفظة الافتراضية</b>\n\n' +
            'هل أنت متأكد من رغبتك في حذف كافة صفقات المحاكاة السابقة واستعادة الرصيد الافتراضي إلى <b>1,000.00 USDT</b>؟\n' +
            'سيتم تصفير معدل الفوز وتاريخ الصفقات الافتراضية بالكامل.',
            { parse_mode: 'HTML', reply_markup: keyboard }
        );
    });

    bot.action('aut_reset_paper_do', async (ctx) => {
        try {
            await ctx.answerCbQuery('⏳ جاري تصفير المحفظة...').catch(() => {});
            await orchestrator.getPaperEngine().resetAccount();
            await ctx.reply('✅ <b>تم بنجاح تصفير المحفظة الافتراضية واستعادة الرصيد إلى 1,000.00 USDT بنجاح.</b>', { parse_mode: 'HTML' });
            await renderPaperStats(ctx, orchestrator);
        } catch (e: any) {
            logger.error('Error resetting paper account:', e);
            ctx.reply(`❌ فشل تصفير المحفظة: ${e.message}`);
        }
    });

    // ── 6. Semi-Auto Execution Button (60s countdown) ───────────────────────
    bot.action(/^aut_exec_([^_]+)_([^_]+)_([^_]+)_([^_]+)_(.+)$/, async (ctx) => {
        try {
            const shortSymbol = ctx.match[1];
            const dir = ctx.match[2] === 'L' ? 'LONG' : 'SHORT';
            const entry = parseFloat(ctx.match[3]);
            const sl = parseFloat(ctx.match[4]);
            const tp = parseFloat(ctx.match[5]);

            await ctx.answerCbQuery('⏳ جاري تنفيذ الصفقة على BingX...').catch(() => {});

            const user = await User.findOne({ telegramId: ctx.from?.id.toString() });
            if (!user) {
                return ctx.reply('❌ المستخدم غير مسجل في قاعدة البيانات.');
            }

            const existingLive = await Trade.findOne({
                userId: user._id,
                symbol: `${shortSymbol}/USDT:USDT`,
                isPaperTrade: { $ne: true },
                currentStatus: { $in: ['OPEN', 'TP1_HIT', 'TP2_HIT'] }
            });
            if (existingLive) {
                return ctx.reply(`⚠️ توجد بالفعل صفقة حية نشطة مفتوحة لعملة <b>${shortSymbol}</b> حالياً.\nلا يمكن فتح صفقة جديدة لنفس العملة حتى تُغلق الصفقة الحالية.`, { parse_mode: 'HTML' });
            }

            const signal = {
                type: 'TRADE' as const,
                symbol: `${shortSymbol}/USDT:USDT`,
                direction: dir as 'LONG' | 'SHORT',
                entry: [entry],
                stopLoss: sl,
                targets: [tp],
                risk: 1.5,
                leverage: 10
            };

            const result = await tradeManager.executeSignal(signal, user._id.toString(), ctx.chat?.id.toString());
            if (result) {
                await ctx.reply(
                    `✅ <b>تم تنفيذ صفقة الاقتناص بنجاح عبر المنظومة الذاتية!</b>\n\n` +
                    `🪙 العملة: <b>${shortSymbol}</b> (${result.direction})\n` +
                    `💵 سعر الدخول: <code>${result.entryPrice}</code>\n` +
                    `🛑 وقف الخسارة: <code>${result.stopLoss.price}</code>\n` +
                    `🎯 الأهداف: <code>${result.targets.map(t => t.price).join(', ')}</code>\n` +
                    `💰 الهامش: <code>${result.margin.toFixed(2)} USDT</code>`,
                    { parse_mode: 'HTML' }
                );
            }
        } catch (err: any) {
            logger.error('Error executing semi-auto trade:', err);
            ctx.reply(`❌ فشل تنفيذ الصفقة: ${err.message}`);
        }
    });

    bot.action('aut_dismiss', async (ctx) => {
        await ctx.answerCbQuery('تم تجاهل الإشارة').catch(() => {});
        await ctx.deleteMessage().catch(() => {});
    });

    bot.action('aut_back_main', async (ctx) => {
        await ctx.answerCbQuery().catch(() => {});
        const user = await User.findOne({ telegramId: ctx.from?.id.toString() });
        if (user) {
            await ctx.reply('🏛️ تم الرجوع للقائمة الرئيسية.', { reply_markup: getMainMenuKeyboard(user) });
        }
    });
};

// ─────────────────────────────────────────────────────────────────────────────
// UI RENDERERS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 1. Main Autonomous Dashboard Renderer
 */
async function renderAutonomousDashboard(ctx: any, orchestrator: AutonomousOrchestrator, isEdit = false) {
    const mode = orchestrator.currentMode;
    const modeLabel = mode === 'PAPER_TRADING'
        ? '🎮 تداول افتراضي محاكى (Paper Trading - صفر مخاطرة)'
        : mode === 'SEMI_AUTO'
            ? '🟡 نصف تلقائي (تأكيد عبر تيليجرام 60 ثانية)'
            : '🟢 تلقائي كامل على المحفظة الحقيقية (BingX Real Balance)';

    const styleLabel = orchestrator.tradeStyle === 'SCALP'
        ? '⚡ سكالب سريع (5m/15m)'
        : orchestrator.tradeStyle === 'SWING'
            ? '🌊 سوينغ اتجاهي (15m/4h)'
            : '🔄 هجين متوازن (تلقائي)';

    const tpLabel = orchestrator.tpExecutionMode === 'single'
        ? '🎯 الهدف الأول فقط (خروج 100% عند TP1)'
        : '🏆 جميع الأهداف (تأمين الدخول بعد TP1)';

    const statusBadge = orchestrator.isPaused ? '⏸️ متوقفة مؤقتاً' : '🟢 نشطة وتعمل بالخلفية';
    const aiBadge = orchestrator.isAiAuditEnabled ? '🧠 مفعل (Gemini Sovereign)' : '⚪ معطل (توافق رياضي فقط)';
    const macroBadge = orchestrator.isMacroShieldEnabled ? '🛡️ درع الأخبار نشط' : '⚪ درع الأخبار معطل';

    let msg = `🤖 <b>لوحة القيادة لمنظومة التداول الذاتي الفائقة (Autonomous V2)</b>\n`;
    msg += `━━━━━━━━━━━━━━━━━━━━━\n`;
    msg += `• <b>الحالة العامة:</b> <b>${statusBadge}</b>\n`;
    msg += `• <b>نمط التنفيذ:</b>\n  👉 <b>${modeLabel}</b>\n`;
    msg += `• <b>أسلوب التداول:</b> <b>${styleLabel}</b>\n`;
    msg += `• <b>نظام جني الأرباح:</b> <b>${tpLabel}</b>\n\n`;
    msg += `• <b>المشرف الأمني:</b> ${aiBadge}\n`;
    msg += `• <b>درع الاقتصاد الكلي:</b> ${macroBadge}\n`;
    msg += `• <b>عتبة التوافق الرياضي:</b> 🎯 <code>${orchestrator.minConfluenceScore}%</code>\n\n`;
    msg += `• <b>العملات المراقبة الآن:</b>\n  <code>${orchestrator.activeWatchlist.join(' • ')}</code>\n\n`;
    msg += `• <b>مزامنة الشموع:</b> ⏰ <i>كل 15 دقيقة فور إغلاق الشمعة (:00، :15، :30، :45)</i>\n`;
    msg += `━━━━━━━━━━━━━━━━━━━━━\n`;
    msg += `👇 <b>تحكم بالمنظومة والأنماط والأهداف بالضغط على الأزرار أدناه:</b>`;

    const keyboard = {
        inline_keyboard: [
            // Mode Selectors
            [
                { text: mode === 'PAPER_TRADING' ? '🔘 [نشط] محاكاة 🎮' : '🎮 محاكاة (Paper)', callback_data: 'aut_set_paper' },
                { text: mode === 'SEMI_AUTO' ? '🔘 [نشط] نصف تلقائي 🟡' : '🟡 نصف تلقائي', callback_data: 'aut_set_semi' },
                { text: mode === 'FULL_AUTO' ? '🔘 [نشط] حقيقي 🟢' : '🚀 حقيقي (Live)', callback_data: 'aut_set_full' }
            ],
            // Trade Style Selectors (Scalp vs Swing vs Hybrid)
            [
                { text: orchestrator.tradeStyle === 'SCALP' ? '🔘 ⚡ سكالب (5m)' : '⚡ سكالب (5m)', callback_data: 'aut_style_scalp' },
                { text: orchestrator.tradeStyle === 'SWING' ? '🔘 🌊 سوينغ (4h)' : '🌊 سوينغ (4h)', callback_data: 'aut_style_swing' },
                { text: orchestrator.tradeStyle === 'HYBRID' ? '🔘 🔄 هجين' : '🔄 هجين', callback_data: 'aut_style_hybrid' }
            ],
            // TP Mode Selectors (Single TP vs Multiple TPs)
            [
                { text: orchestrator.tpExecutionMode === 'single' ? '🔘 🎯 الهدف الأول فقط' : '🎯 الهدف الأول فقط', callback_data: 'aut_tp_single' },
                { text: orchestrator.tpExecutionMode === 'multiple' ? '🔘 🏆 جميع الأهداف' : '🏆 جميع الأهداف', callback_data: 'aut_tp_multiple' }
            ],
            // Core Hubs
            [
                { text: '🎮 المحفظة الافتراضية (Paper Hub)', callback_data: 'aut_view_paper_stats' },
                { text: '🧠 تدقيق الذكاء (AI Audit)', callback_data: 'aut_ai_audit_menu' }
            ],
            [
                { text: '🔬 فحص وتحليل رياضي لأي عملة', callback_data: 'aut_analyze_picker' },
                { text: '⚖️ أوزان المحركات والذاكرة', callback_data: 'aut_engine_weights_menu' }
            ],
            [
                { text: '🌐 رادار الأخبار الكلية', callback_data: 'aut_macro_menu' },
                { text: '⚡ فحص وقنص الفرص الآن', callback_data: 'aut_trigger_scan' }
            ],
            [
                { text: orchestrator.isPaused ? '▶️ استئناف العمل' : '⏸️ إيقاف مؤقت', callback_data: 'aut_toggle_pause' },
                { text: '🔙 العودة للقائمة الرئيسية', callback_data: 'aut_back_main' }
            ]
        ]
    };

    if (isEdit && ctx.callbackQuery) {
        await ctx.editMessageText(msg, { parse_mode: 'HTML', reply_markup: keyboard }).catch(async () => {
            await ctx.replyWithHTML(msg, { reply_markup: keyboard });
        });
    } else {
        await ctx.replyWithHTML(msg, { reply_markup: keyboard });
    }
}

/**
 * 2. Paper Trading Sandbox Renderer
 */
async function renderPaperStats(ctx: any, orchestrator: AutonomousOrchestrator, isEdit = false) {
    const stats = await orchestrator.getPaperEngine().getPerformanceStats();

    const pnlSign = stats.netProfitUSDT >= 0 ? '+' : '';
    const pnlEmoji = stats.netProfitUSDT >= 0 ? '🟢' : '🔴';

    let msg = `🎮 <b>لوحة المحفظة الافتراضية والمحاكاة الحية (Paper Sandbox Hub)</b>\n`;
    msg += `━━━━━━━━━━━━━━━━━━━━━\n`;
    msg += `💰 <b>الرصيد الافتراضي:</b> <code>$${stats.currentBalance.toFixed(2)} USDT</code>\n`;
    msg += `📈 <b>صافي الربح/الخسارة:</b> ${pnlEmoji} <b>${pnlSign}${stats.netProfitUSDT} USDT (${pnlSign}${stats.netProfitPercent}%)</b>\n\n`;
    msg += `📊 <b>سجل الصفقات الافتراضية:</b>\n`;
    msg += `   • إجمالي الصفقات: <b>${stats.totalTrades}</b>\n`;
    msg += `   • الصفقات الرابحة: 🟢 <b>${stats.winningTrades}</b>\n`;
    msg += `   • الصفقات الخاسرة: 🔴 <b>${stats.losingTrades}</b>\n`;
    msg += `   • نسبة الفوز (Win Rate): 🎯 <b>${stats.winRate}%</b>\n`;
    msg += `   • عامل الربحية (Profit Factor): ⚖️ <b>${stats.profitFactor}</b>\n`;
    msg += `   • أقصى تراجع للمحفظة (Max DD): 🛡️ <b>${stats.maxDrawdownPct}%</b>\n`;
    msg += `   • معامل شارب (Sharpe Ratio): 📐 <b>${stats.sharpeRatio}</b>\n`;
    msg += `   • إجمالي العمولات المحسومة: 💸 <code>$${stats.totalCommissionPaid}</code>\n`;
    msg += `   • الصفقات المفتوحة حالياً: ⏳ <b>${stats.openTradesCount}</b>\n`;
    msg += `━━━━━━━━━━━━━━━━━━━━━\n`;

    const isQualified = stats.winRate >= 52 && stats.profitFactor >= 1.65 && stats.totalTrades >= 30;
    if (isQualified) {
        msg += `✨ <b>جاهزية الحساب الحقيقي:</b> 🟢 <i>اجتازت المحفظة مؤشرات الأمان المطلوبة، يمكنك الانتقال للتداول الحقيقي بأمان.</i>\n`;
    } else {
        msg += `🛡️ <b>جاهزية الحساب الحقيقي:</b> 🟡 <i>قيد الاختبار الافتراضي (المطلوب: 30 صفقة على الأقل بنسبة فوز 52%+ وعامل ربح 1.65+).</i>\n`;
    }

    const keyboard = {
        inline_keyboard: [
            [
                { text: '🔄 تحديث', callback_data: 'aut_view_paper_stats' },
                { text: `💼 النشطة (${stats.openTradesCount})`, callback_data: 'aut_view_open_paper_trades' },
                { text: '📜 السجل المغلق', callback_data: 'aut_view_paper_history' }
            ],
            [
                { text: '💵 ضبط رأس المال وتصفير السجل', callback_data: 'aut_paper_balance_menu' },
                { text: '🔬 فحص عملة رياضياً', callback_data: 'aut_analyze_picker' }
            ],
            [
                { text: '🔙 رجوع للوحة التحكم الذاتي', callback_data: 'aut_main_menu' }
            ]
        ]
    };

    if (isEdit && ctx.callbackQuery) {
        await ctx.editMessageText(msg, { parse_mode: 'HTML', reply_markup: keyboard }).catch(async () => {
            await ctx.replyWithHTML(msg, { reply_markup: keyboard });
        });
    } else {
        await ctx.replyWithHTML(msg, { reply_markup: keyboard });
    }
}

/**
 * 3. Open Paper Trades List Renderer
 */
async function renderOpenPaperTrades(ctx: any, orchestrator: AutonomousOrchestrator) {
    const openTrades = await Trade.find({
        isPaperTrade: true,
        currentStatus: { $in: ['OPEN', 'TP1_HIT', 'TP2_HIT'] }
    }).sort({ entryTime: -1 }).limit(10);

    if (openTrades.length === 0) {
        const emptyKeyboard = {
            inline_keyboard: [
                [
                    { text: '📜 عرض سجل الصفقات المغلقة', callback_data: 'aut_view_paper_history' },
                    { text: '🔙 رجوع للمحفظة', callback_data: 'aut_view_paper_stats' }
                ]
            ]
        };
        return ctx.reply('ℹ️ لا توجد صفقات افتراضية مفتوحة حالياً في المحفظة التجريبية.', { reply_markup: emptyKeyboard });
    }

    let msg = `💼 <b>الصفقات الافتراضية النشطة حالياً (${openTrades.length}):</b>\n`;
    msg += `━━━━━━━━━━━━━━━━━━━━━\n`;

    for (const t of openTrades) {
        const dirEmoji = t.direction === 'LONG' ? '🟢 LONG' : '🔴 SHORT';
        const margin = (t.amount && t.leverage) ? (t.amount / t.leverage).toFixed(2) : '10.00';
        const entryDate = t.entryTime ? new Date(t.entryTime).toLocaleString('ar-EG', { timeZone: 'UTC', hour12: false }) : 'غير محدد';
        const statusBadge = t.currentStatus === 'TP1_HIT' ? '🎯 تم حجز الهدف 1 ومؤمنة على الدخول' : '⏳ جارية';

        // Calculate current elapsed time
        let elapsedStr = '0 دقيقة';
        if (t.entryTime) {
            const elMs = Date.now() - new Date(t.entryTime).getTime();
            const elMin = Math.floor(elMs / 60000);
            const elHour = Math.floor(elMin / 60);
            elapsedStr = elHour > 0 ? `${elHour} س و ${elMin % 60} د` : `${elMin} د`;
        }

        msg += `${dirEmoji} <b>${t.symbol}</b> (${t.leverage || 10}x) [${statusBadge}]\n`;
        msg += `   • 💵 سعر الدخول: <code>${t.entryPrice}</code>\n`;
        msg += `   • 🛑 وقف الخسارة: <code>${t.stopLoss}</code>\n`;
        if (t.targets && t.targets.length > 0) {
            msg += `   • 🎯 الأهداف: <code>${t.targets.map(x => x.price).join(' | ')}</code>\n`;
        }
        msg += `   • 💰 الهامش: <code>$${margin} USDT</code> (القيمة: <code>$${t.amount?.toFixed(2)}</code>)\n`;
        msg += `   • ⏱️ وقت البدء: <code>${entryDate} UTC</code> (منذ ${elapsedStr})\n`;
        if (t.aiJustification) {
            msg += `   • 🧠 التبرير: <i>${t.aiJustification.substring(0, 80)}...</i>\n`;
        }
        msg += `─────────────────────\n`;
    }

    const keyboard = {
        inline_keyboard: [
            [
                { text: '🔄 تحديث', callback_data: 'aut_view_open_paper_trades' },
                { text: '📜 سجل الصفقات المغلقة', callback_data: 'aut_view_paper_history' }
            ],
            [{ text: '🔙 رجوع لإحصائيات المحفظة', callback_data: 'aut_view_paper_stats' }]
        ]
    };

    await ctx.replyWithHTML(msg, { reply_markup: keyboard });
}

/**
 * 4. Closed Paper Trades History Renderer (with pagination)
 */
async function renderPaperHistory(ctx: any, orchestrator: AutonomousOrchestrator, page: number = 1) {
    const limit = 5;
    const skip = (page - 1) * limit;

    const totalClosed = await Trade.countDocuments({
        isPaperTrade: true,
        currentStatus: { $in: ['CLOSED_PROFIT', 'CLOSED_LOSS', 'CLOSED_MANUAL'] }
    });

    const trades = await Trade.find({
        isPaperTrade: true,
        currentStatus: { $in: ['CLOSED_PROFIT', 'CLOSED_LOSS', 'CLOSED_MANUAL'] }
    })
    .sort({ closeTime: -1, entryTime: -1 })
    .skip(skip)
    .limit(limit);

    if (trades.length === 0) {
        const emptyKb = {
            inline_keyboard: [
                [{ text: '🔙 رجوع لإحصائيات المحفظة', callback_data: 'aut_view_paper_stats' }]
            ]
        };
        return ctx.reply('ℹ️ لا توجد صفقات افتراضية مغلقة سابقة حتى الآن.', { reply_markup: emptyKb });
    }

    const totalPages = Math.max(1, Math.ceil(totalClosed / limit));
    let msg = `📜 <b>سجل الصفقات الافتراضية السابقة (${totalClosed} صفقة مسجلة):</b>\n`;
    msg += `📄 <i>الصفحة ${page} من ${totalPages}</i>\n`;
    msg += `━━━━━━━━━━━━━━━━━━━━━\n`;
    for (const t of trades) {
        const margin = (t.amount && t.leverage) ? (t.amount / t.leverage).toFixed(2) : '10.00';
        const realizedVal = t.realizedPnl !== undefined ? t.realizedPnl : (margin ? parseFloat(margin) * ((t.pnl || 0) / 100) : (t.pnl || 0));
        const isWin = realizedVal > 0 || (realizedVal === 0 && (t.pnl || 0) >= 0);
        const statusBadge = isWin ? '🟢 ربح' : '🔴 خسارة';
        const pnlSign = (t.pnl || 0) >= 0 ? '+' : '';
        const entryStr = t.entryTime ? new Date(t.entryTime).toLocaleString('ar-EG', { timeZone: 'UTC', hour12: false }) : 'غير محدد';
        const closeStr = t.closeTime ? new Date(t.closeTime).toLocaleString('ar-EG', { timeZone: 'UTC', hour12: false }) : 'غير محدد';

        // Calculate trade duration
        let durationStr = 'N/A';
        if (t.entryTime && t.closeTime) {
            const durMs = new Date(t.closeTime).getTime() - new Date(t.entryTime).getTime();
            const durSec = Math.floor(durMs / 1000);
            const durMin = Math.floor(durSec / 60);
            const durHour = Math.floor(durMin / 60);
            const durDay = Math.floor(durHour / 24);
            if (durDay > 0) durationStr = `${durDay} يوم و ${durHour % 24} س`;
            else if (durHour > 0) durationStr = `${durHour} ساعة و ${durMin % 60} دقيقة`;
            else if (durMin > 0) durationStr = `${durMin} دقيقة و ${durSec % 60} ثانية`;
            else durationStr = `${durSec} ثانية`;
        }

        // Determine exit/closing price
        let exitPriceStr = t.exitPrice ? String(t.exitPrice) : '';
        if (!exitPriceStr && t.logs) {
            for (const log of t.logs) {
                const m = log.match(/hit (?:SL|TP\d?|at) (?:at )?([\d\.]+)/i);
                if (m && m[1]) {
                    exitPriceStr = m[1];
                    break;
                }
            }
        }
        if (!exitPriceStr) {
            exitPriceStr = String(t.stopLoss);
        }

        const realizedText = t.realizedPnl !== undefined
            ? `${t.realizedPnl >= 0 ? '+' : ''}$${t.realizedPnl.toFixed(2)} USDT`
            : `${pnlSign}${(margin ? (parseFloat(margin) * ((t.pnl || 0) / 100)).toFixed(2) : '0.00')} USDT`;

        msg += `${isWin ? '🟢' : '🔴'} <b>${t.symbol}</b> | <b>${t.direction}</b> [${statusBadge}]\n`;
        msg += `   • ⚡ <b>الرافعة المالية:</b> <code>${t.leverage || 10}x</code>\n`;
        msg += `   • 💵 <b>سعر الدخول:</b> <code>${t.entryPrice}</code>\n`;
        msg += `   • 🏁 <b>سعر الإغلاق:</b> <code>${exitPriceStr}</code>\n`;
        msg += `   • 🛑 <b>وقف الخسارة المحدد:</b> <code>${t.stopLoss}</code>\n`;
        if (t.targets && t.targets.length > 0) {
            const targetsStr = t.targets.map((tgt, idx) => `${tgt.hit ? '✅ TP' : '⚪ TP'}${idx + 1}: ${tgt.price}`).join(' | ');
            msg += `   • 🎯 <b>الأهداف المحددة:</b> <code>${targetsStr}</code>\n`;
        }
        msg += `   • 💰 <b>صافي الربح / الخسارة:</b> <b>${realizedText}</b> (النسبة: <code>${pnlSign}${t.pnl?.toFixed(2)}%</code>)\n`;
        msg += `   • 💼 <b>الهامش المستخدم:</b> <code>$${margin} USDT</code> (القيمة الكلية: <code>$${t.amount?.toFixed(2)}</code>)\n`;
        msg += `   • 💸 <b>العمولة المحسومة:</b> <code>$${(t.commissionPaid || 0).toFixed(3)} USDT</code>\n`;
        msg += `   • ⏱️ <b>تاريخ ووقت الدخول:</b> <code>${entryStr} UTC</code>\n`;
        msg += `   • 🏁 <b>تاريخ ووقت الإغلاق:</b> <code>${closeStr} UTC</code>\n`;
        msg += `   • ⏳ <b>مدة بقاء الصفقة:</b> <b>${durationStr}</b>\n`;
        if (t.aiJustification) {
            msg += `   • 🧠 <b>التبرير الفني:</b> <i>${t.aiJustification.substring(0, 80)}...</i>\n`;
        }
        if (t.logs && t.logs.length > 0) {
            const lastLog = t.logs[t.logs.length - 1];
            msg += `   • 📝 <b>سبب الخروج:</b> <code>${lastLog.substring(0, 75)}</code>\n`;
        }
        msg += `─────────────────────\n`;
    }

    const navButtons: any[] = [];
    if (page > 1) {
        navButtons.push({ text: '⬅️ السابق', callback_data: `aut_paper_hist_p_${page - 1}` });
    }
    if (page < totalPages) {
        navButtons.push({ text: 'التالي ➡️', callback_data: `aut_paper_hist_p_${page + 1}` });
    }

    const keyboard = {
        inline_keyboard: [
            navButtons.length > 0 ? navButtons : [],
            [
                { text: '🔄 تحديث السجل', callback_data: `aut_paper_hist_p_${page}` },
                { text: `💼 الصفقات النشطة`, callback_data: 'aut_view_open_paper_trades' }
            ],
            [{ text: '🔙 رجوع لإحصائيات المحفظة', callback_data: 'aut_view_paper_stats' }]
        ].filter(r => r.length > 0)
    };

    if (ctx.callbackQuery) {
        await ctx.editMessageText(msg, { parse_mode: 'HTML', reply_markup: keyboard }).catch(async () => {
            await ctx.replyWithHTML(msg, { reply_markup: keyboard });
        });
    } else {
        await ctx.replyWithHTML(msg, { reply_markup: keyboard });
    }
}

/**
 * 4. AI Sovereign Audit Hub Renderer
 */
async function renderAiAuditHub(ctx: any, orchestrator: AutonomousOrchestrator) {
    const statusEmoji = orchestrator.isAiAuditEnabled ? '🟢 مفعل' : '⚪ معطل';

    let msg = `🧠 <b>مركز تدقيق الذكاء الاصطناعي السيادي (Gemini Sovereign Audit)</b>\n`;
    msg += `━━━━━━━━━━━━━━━━━━━━━\n`;
    msg += `• <b>حالة التدقيق:</b> <b>${statusEmoji}</b>\n`;
    msg += `• <b>الحد الأدنى للتوافق الرياضي:</b> 🎯 <code>${orchestrator.minConfluenceScore}%</code>\n`;
    msg += `• <b>صلاحية الفيتو (Veto Power):</b> 🛡️ <i>الذكاء الاصطناعي يملك حق الرفض الفوري إذا اكتشف فخاخ سيولة أو مصائد سعرية.</i>\n\n`;

    msg += `📋 <b>آخر قرارات الفحص والتدقيق:</b>\n`;
    if (orchestrator.lastAuditResults.length === 0) {
        msg += `<i>لم تُجرَ أي عمليات تدقيق بعد في هذه الجلسة.</i>\n`;
    } else {
        orchestrator.lastAuditResults.slice(0, 5).forEach((item, idx) => {
            const badge = item.approved ? '✅ معتمدة' : '🛑 فيتو (مرفوضة)';
            msg += `${idx + 1}. <b>${item.symbol}</b>: ${badge}\n   💬 <i>${item.reason.substring(0, 80)}</i>\n`;
        });
    }
    msg += `━━━━━━━━━━━━━━━━━━━━━\n`;
    msg += `👇 <b>تعديل إعدادات الرقابة الذكية:</b>`;

    const keyboard = {
        inline_keyboard: [
            [
                {
                    text: orchestrator.isAiAuditEnabled ? '🛑 تعطيل تدقيق الذكاء' : '✅ تفعيل تدقيق الذكاء',
                    callback_data: 'aut_toggle_ai'
                }
            ],
            [
                { text: orchestrator.minConfluenceScore === 70 ? '🔘 توافق 70% (معتدل)' : 'توافق 70%', callback_data: 'aut_set_conf_70' },
                { text: orchestrator.minConfluenceScore === 75 ? '🔘 توافق 75% (متشدد)' : 'توافق 75%', callback_data: 'aut_set_conf_75' },
                { text: orchestrator.minConfluenceScore === 80 ? '🔘 توافق 80% (قناص نخبوي)' : 'توافق 80%', callback_data: 'aut_set_conf_80' }
            ],
            [
                { text: '🔙 رجوع للوحة التحكم الذاتي', callback_data: 'aut_main_menu' }
            ]
        ]
    };

    if (ctx.callbackQuery) {
        await ctx.editMessageText(msg, { parse_mode: 'HTML', reply_markup: keyboard }).catch(async () => {
            await ctx.replyWithHTML(msg, { reply_markup: keyboard });
        });
    } else {
        await ctx.replyWithHTML(msg, { reply_markup: keyboard });
    }
}

/**
 * 5. Dynamic Engine Weights & Memory Renderer
 */
async function renderEngineWeightsHub(ctx: any, orchestrator: AutonomousOrchestrator) {
    const stats = TradingMemoryService.getAllEngineStats();

    let msg = `⚖️ <b>الذاكرة الذاتية ومصفوفة أوزان المحركات الفنية</b>\n`;
    msg += `━━━━━━━━━━━━━━━━━━━━━\n`;
    msg += `تتعلم المنظومة ذاتياً من نتائج آخر 50 صفقة؛ فيتم رفع وزن المحرك الأكثر ربحية حتى <b>1.4x</b> وخفض المحرك المتراجع حتى <b>0.75x</b>:\n\n`;

    stats.forEach(rec => {
        let title = `محرك [${rec.engineId}]`;
        if (rec.engineId === 'AUTONOMOUS_V2') {
            title = '👑 المحرك الذاتي الشامل [AUTONOMOUS V2]';
        }
        const weightEmoji = rec.dynamicWeight >= 1.2 ? '🔥' : rec.dynamicWeight < 1.0 ? '❄️' : '⚡';
        msg += `${weightEmoji} <b>${title}:</b>\n`;
        msg += `   • الوزن الديناميكي: <code>${rec.dynamicWeight}x</code>\n`;
        msg += `   • نسبة النجاح: <code>${rec.winRate}%</code> (رابحة: ${rec.winningSignals} / إجمالي: ${rec.totalSignals})\n\n`;
    });

    msg += `━━━━━━━━━━━━━━━━━━━━━\n`;
    msg += `💡 <i>تتحدث هذه الأوزان آلياً في كل مرة تغلق فيها صفقة بأرباح أو خسائر.</i>`;

    const keyboard = {
        inline_keyboard: [
            [{ text: '🔙 رجوع للوحة التحكم الذاتي', callback_data: 'aut_main_menu' }]
        ]
    };

    if (ctx.callbackQuery) {
        await ctx.editMessageText(msg, { parse_mode: 'HTML', reply_markup: keyboard }).catch(async () => {
            await ctx.replyWithHTML(msg, { reply_markup: keyboard });
        });
    } else {
        await ctx.replyWithHTML(msg, { reply_markup: keyboard });
    }
}

/**
 * 6. Macro Calendar & Blackout Shield Hub Renderer
 */
async function renderMacroHub(ctx: any, orchestrator: AutonomousOrchestrator) {
    const upcoming = MacroCalendarService.getUpcomingEvents().slice(0, 6);
    const blackout = MacroCalendarService.isBlackout();
    const shieldStatus = orchestrator.isMacroShieldEnabled ? '🛡️ درع الحظر مفعل' : '⚪ درع الحظر معطل';

    let msg = `🌐 <b>رادار الاقتصاد الكلي ودرع حظر التداول وقت الأخبار</b>\n`;
    msg += `━━━━━━━━━━━━━━━━━━━━━\n`;
    msg += `• <b>حالة الدرع الأمني:</b> <b>${shieldStatus}</b>\n`;
    msg += `• <b>حالة السوق الحالية:</b> ${blackout.isBlackoutActive ? '🛑 <b>فترة حظر نشطة (Macro Blackout)!</b>' : '🟢 <b>لا توجد أخبار حارقة حالياً (آمن للتداول)</b>'}\n`;
    if (blackout.isBlackoutActive) {
        msg += `  ⚠️ <i>السبب: ${blackout.reason}</i>\n`;
    }
    msg += `\n📅 <b>أهم الأخبار الاقتصادية القادمة:</b>\n`;

    if (upcoming.length === 0) {
        msg += `<i>لا توجد بيانات اقتصادية عالية التأثير مسجلة حالياً.</i>\n`;
    } else {
        upcoming.forEach(ev => {
            const impactBadge = ev.impact === 'CRITICAL' ? '🛑 حرج جداً' : ev.impact === 'HIGH' ? '🔴 عالي' : '🟠 متوسط';
            const insight = MacroCalendarService.getScenarioInsight(ev);
            msg += `• <b>${ev.title}</b> (${ev.currency}) - ${impactBadge}\n`;
            msg += `  ⏰ الموعد: <code>${ev.dateString}</code> | المتوقع: <code>${ev.forecast || '-'}</code>\n`;
            if (insight) {
                msg += `  ${insight}\n`;
            }
        });
    }

    msg += `━━━━━━━━━━━━━━━━━━━━━\n`;

    const keyboard = {
        inline_keyboard: [
            [
                {
                    text: orchestrator.isMacroShieldEnabled ? '🛑 تعطيل درع الأخبار' : '🛡️ تفعيل درع الأخبار',
                    callback_data: 'aut_toggle_macro'
                }
            ],
            [
                { text: '🔙 رجوع للوحة التحكم الذاتي', callback_data: 'aut_main_menu' }
            ]
        ]
    };

    if (ctx.callbackQuery) {
        await ctx.editMessageText(msg, { parse_mode: 'HTML', reply_markup: keyboard }).catch(async () => {
            await ctx.replyWithHTML(msg, { reply_markup: keyboard });
        });
    } else {
        await ctx.replyWithHTML(msg, { reply_markup: keyboard });
    }
}

/**
 * 7. On-Demand Quantitative Coin Picker Renderer
 */
async function renderAnalyzePicker(ctx: any, isEdit = false) {
    const msg = `🔬 <b>منظار الفحص الرياضي المخصص (Custom Quantitative Scanner)</b>\n` +
        `━━━━━━━━━━━━━━━━━━━━━\n` +
        `يمكنك فحص وتحليل أي عملة رقمية فوراً عبر مصفوفة الـ 18 محركاً كمياً، وحساب خط الـ VWAP المؤسساتي، ومستويات الدعم والمقاومة، ونقاط فيبوناتشي الرقمية.\n\n` +
        `👇 <b>اختر إحدى العملات السريعة أدناه، أو أرسل أمر الفحص المباشر لأي عملة:</b>\n` +
        `💡 مثال: <code>/analyze SOL</code> أو <code>/analyze PEPE</code> أو <code>/analyze SUI</code>`;

    const keyboard = {
        inline_keyboard: [
            [
                { text: 'BTC', callback_data: 'aut_math_analyze_BTC' },
                { text: 'ETH', callback_data: 'aut_math_analyze_ETH' },
                { text: 'SOL', callback_data: 'aut_math_analyze_SOL' }
            ],
            [
                { text: 'BNB', callback_data: 'aut_math_analyze_BNB' },
                { text: 'XRP', callback_data: 'aut_math_analyze_XRP' },
                { text: 'DOGE', callback_data: 'aut_math_analyze_DOGE' }
            ],
            [
                { text: 'SUI', callback_data: 'aut_math_analyze_SUI' },
                { text: 'AVAX', callback_data: 'aut_math_analyze_AVAX' },
                { text: 'NEAR', callback_data: 'aut_math_analyze_NEAR' }
            ],
            [
                { text: 'PEPE', callback_data: 'aut_math_analyze_PEPE' },
                { text: 'LINK', callback_data: 'aut_math_analyze_LINK' },
                { text: 'ARB', callback_data: 'aut_math_analyze_ARB' }
            ],
            [
                { text: '🔙 رجوع للوحة التحكم الذاتي', callback_data: 'aut_main_menu' }
            ]
        ]
    };

    if (isEdit && ctx.callbackQuery) {
        await ctx.editMessageText(msg, { parse_mode: 'HTML', reply_markup: keyboard }).catch(async () => {
            await ctx.replyWithHTML(msg, { reply_markup: keyboard });
        });
    } else {
        await ctx.replyWithHTML(msg, { reply_markup: keyboard });
    }
}

/**
 * 8. On-Demand Mathematical Confluence Analyzer for Any Symbol
 */
async function renderMathematicalAnalysis(
    ctx: any,
    rawSymbol: string,
    bingx: BingXService,
    orchestrator: AutonomousOrchestrator,
    isEdit = false
) {
    try {
        let cleanSymbol = rawSymbol.toUpperCase().replace('/USDT:USDT', '').replace('-USDT', '').replace('/USDT', '').replace('USDT', '').trim();
        if (!cleanSymbol) cleanSymbol = 'BTC';
        const fullSymbol = `${cleanSymbol}/USDT:USDT`;

        let loadingMsg: any;
        if (!isEdit) {
            loadingMsg = await ctx.reply(`⏳ <i>جاري سحب شموع MTF وحساب مصفوفة التوافق الرياضي لعملة <b>${cleanSymbol}</b> عبر 18 محركاً...</i>`, { parse_mode: 'HTML' });
        }

        // 1. Fetch MTF OHLCV and price precision
        const [pricePrecision, ...fetchResults] = await Promise.all([
            bingx.getPricePrecision(fullSymbol),
            ...MATRIX_TFS.map(async tf => {
                const ohlcv = await bingx.fetchOHLCV(fullSymbol, tf, 100);
                return { tf, ohlcv };
            })
        ]);

        const mtfOHLCV: Record<string, OHLCV[]> = {};
        fetchResults.forEach(r => mtfOHLCV[r.tf] = r.ohlcv);

        // 2. Build complete Institutional Market Dossier
        const dossier = EngineConfluenceArbiter.buildDossier(fullSymbol, pricePrecision, mtfOHLCV, {
            quickTF: '15m',
            longTF: '1h'
        });

        const p = pricePrecision || 4;
        const metrics = dossier.confluenceMetrics;
        const dirEmoji = metrics.recommendedDirection === 'LONG' ? '🟢 صعود (LONG)' : metrics.recommendedDirection === 'SHORT' ? '🔴 هبوط (SHORT)' : '⚪ حياد (NEUTRAL)';
        const scoreBadge = metrics.overallScore >= 75 ? '🔥 توافق عالي ممتاز' : metrics.overallScore >= 60 ? '⚡ توافق متوسط' : '❄️ توافق ضعيف / متضارب';
        const vwapStatus = dossier.isAboveVWAP ? '🟢 أعلى من VWAP (زخم صاعد)' : '🔴 أسفل VWAP (ضغط بيعي)';

        let msg = `🔬 <b>تقرير الفحص والتحليل الرياضي المؤسساتي (2D Confluence)</b>\n`;
        msg += `━━━━━━━━━━━━━━━━━━━━━\n`;
        msg += `🪙 <b>العملة:</b> <b>${cleanSymbol}/USDT</b> | 💵 <b>السعر الحالي:</b> <code>$${dossier.currentPrice.toFixed(p)}</code>\n`;
        msg += `📊 <b>خط الـ VWAP المؤسساتي:</b> <code>$${dossier.vwap.toFixed(p)}</code> (${vwapStatus})\n\n`;

        msg += `🎯 <b>قرار حكم التوافق الرياضي المشترك:</b>\n`;
        msg += `   • الاتجاه المرجح: <b>${dirEmoji}</b>\n`;
        msg += `   • قوة التوافق الإجمالية: <b>${metrics.overallScore}%</b> [${scoreBadge}]\n`;
        msg += `   • نقطة الدخول المقترحة: <code>$${metrics.suggestedEntry.toFixed(p)}</code>\n`;
        msg += `   • وقف الخسارة المقترح: <code>$${metrics.suggestedSL.toFixed(p)}</code>\n`;
        if (metrics.suggestedTPs && metrics.suggestedTPs.length > 0) {
            msg += `   • الأهداف الرقمية: <code>${metrics.suggestedTPs.map(t => `$${t.toFixed(p)}`).join(' | ')}</code>\n`;
        }
        const alignedCount = dossier.enginesSummary.filter(e => e.direction === metrics.recommendedDirection).length;
        msg += `   • نسبة العائد للمخاطرة (RRR): ⚖️ <b>1 : ${metrics.riskRewardRatio}</b>\n`;
        msg += `   • عدد المحركات المتوافقة: <b>${alignedCount}</b> من أصل ${dossier.enginesSummary.length} محركات\n\n`;

        msg += `🧱 <b>مستويات الدعم والمقاومة الرياضية (Classic Pivots):</b>\n`;
        msg += `   • المقاومة R2: <code>${dossier.supportResistance.r2.toFixed(p)}</code> | R1: <code>${dossier.supportResistance.r1.toFixed(p)}</code>\n`;
        msg += `   • خط الارتكاز Pivot: <code>${dossier.supportResistance.pivot.toFixed(p)}</code>\n`;
        msg += `   • الدعم S1: <code>${dossier.supportResistance.s1.toFixed(p)}</code> | S2: <code>${dossier.supportResistance.s2.toFixed(p)}</code>\n\n`;

        msg += `🌀 <b>مناطق فيبوناتشي الرقمية (Fibonacci Matrix):</b>\n`;
        msg += `   • الجيب الذهبي (0.618 Fib): <code>$${dossier.fibonacci.fib618.toFixed(p)}</code>\n`;
        msg += `   • الخصم المؤسساتي (0.786 Fib): <code>$${dossier.fibonacci.fib786.toFixed(p)}</code>\n`;
        msg += `   • الامتداد الانفجاري (1.618 Fib): <code>$${dossier.fibonacci.fibTarget1618.toFixed(p)}</code>\n\n`;

        msg += `🤖 <b>عينة من تقييم وقرارات المحركات الـ 18:</b>\n`;
        const topEngines = dossier.enginesSummary.slice(0, 5);
        for (const eng of topEngines) {
            const eEmoji = eng.direction === 'LONG' ? '🟢' : eng.direction === 'SHORT' ? '🔴' : '⚪';
            msg += `   ${eEmoji} <b>[${eng.engineId}]:</b> ${eng.direction} (${eng.confidence}%) - <i>${eng.reason}</i>\n`;
        }
        msg += `━━━━━━━━━━━━━━━━━━━━━\n`;
        msg += `👇 <i>اختر الإجراء المطلوب لهذه العملة:</i>`;

        const keyboard = {
            inline_keyboard: [
                [
                    { text: '🧠 تدقيق الذكاء الاصطناعي (Gemini)', callback_data: `aut_ai_audit_now_${cleanSymbol}` },
                    { text: '🎮 فتح صفقة تجريبية فورية', callback_data: `aut_paper_exec_${cleanSymbol}` }
                ],
                [
                    { text: '🔄 إعادة فحص هذه العملة', callback_data: `aut_math_analyze_${cleanSymbol}` },
                    { text: '🔍 اختيار عملة أخرى', callback_data: 'aut_analyze_picker' }
                ],
                [
                    { text: '🔙 رجوع للوحة التحكم الذاتي', callback_data: 'aut_main_menu' }
                ]
            ]
        };

        if (isEdit && ctx.callbackQuery) {
            await ctx.editMessageText(msg, { parse_mode: 'HTML', reply_markup: keyboard }).catch(async () => {
                await ctx.replyWithHTML(msg, { reply_markup: keyboard });
            });
        } else {
            if (loadingMsg) {
                await ctx.telegram.deleteMessage(ctx.chat.id, loadingMsg.message_id).catch(() => {});
            }
            await ctx.replyWithHTML(msg, { reply_markup: keyboard });
        }
    } catch (e: any) {
        logger.error(`Error in renderMathematicalAnalysis for ${rawSymbol}:`, e);
        ctx.reply(`❌ فشل فحص العملة ${rawSymbol}: ${e.message}`);
    }
}

/**
 * 9. On-Demand AI Sovereign Audit for Any Symbol
 */
async function runOnDemandAiAudit(ctx: any, cleanSymbol: string, bingx: BingXService, orchestrator: AutonomousOrchestrator) {
    const fullSymbol = `${cleanSymbol}/USDT:USDT`;
    const waitMsg = await ctx.reply(`🧠 <i>جاري إرسال ملف ${cleanSymbol} الفني إلى لجنة التدقيق السيادي (Gemini AI)...</i>`, { parse_mode: 'HTML' });

    try {
        const [pricePrecision, ...fetchResults] = await Promise.all([
            bingx.getPricePrecision(fullSymbol),
            ...MATRIX_TFS.map(async tf => {
                const ohlcv = await bingx.fetchOHLCV(fullSymbol, tf, 100);
                return { tf, ohlcv };
            })
        ]);

        const mtfOHLCV: Record<string, OHLCV[]> = {};
        fetchResults.forEach(r => mtfOHLCV[r.tf] = r.ohlcv);

        const dossier = EngineConfluenceArbiter.buildDossier(fullSymbol, pricePrecision, mtfOHLCV);
        const audit = await GeminiService.auditQuantitativeDossier(dossier);

        const badge = audit.approved ? '✅ معتمدة من الذكاء الاصطناعي' : '🛑 فيتو / مرفوضة أمنياً';
        let report = `🧠 <b>تقرير تدقيق الذكاء الاصطناعي (Gemini Sovereign Audit)</b>\n`;
        report += `━━━━━━━━━━━━━━━━━━━━━\n`;
        report += `🪙 <b>العملة:</b> <b>${cleanSymbol}</b> | <b>القرار:</b> ${badge}\n`;
        report += `📊 <b>الاتجاه المعتمد:</b> <b>${audit.finalDirection}</b>\n`;
        report += `🎯 <b>نسبة ثقة الذكاء:</b> <b>${audit.confidence}%</b>\n\n`;
        report += `📝 <b>تقرير التبرير والتحليل:</b>\n<i>${audit.auditJustification || audit.vetoReason || 'تم التدقيق الفني والمطابقة'}</i>\n`;
        if (audit.recommendedSL) {
            report += `\n🛑 <b>الستوب المعدل:</b> <code>${audit.recommendedSL}</code>\n`;
        }
        if (audit.recommendedTPs && audit.recommendedTPs.length > 0) {
            report += `🎯 <b>الأهداف:</b> <code>${audit.recommendedTPs.join(' | ')}</code>\n`;
        }
        report += `━━━━━━━━━━━━━━━━━━━━━\n`;

        const keyboard = {
            inline_keyboard: [
                [
                    { text: '🎮 فتح صفقة تجريبية فورية', callback_data: `aut_paper_exec_${cleanSymbol}` },
                    { text: '🔬 عودة للتحليل الرياضي', callback_data: `aut_math_analyze_${cleanSymbol}` }
                ],
                [{ text: '🔙 القائمة الرئيسية', callback_data: 'aut_main_menu' }]
            ]
        };

        await ctx.telegram.deleteMessage(ctx.chat.id, waitMsg.message_id).catch(() => {});
        await ctx.replyWithHTML(report, { reply_markup: keyboard });
    } catch (e: any) {
        logger.error(`Error in on-demand AI audit for ${cleanSymbol}:`, e);
        await ctx.reply(`❌ تعذر تدقيق العملة: ${e.message}`);
    }
}

/**
 * 10. On-Demand Instant Paper Trade Execution for Analyzed Symbol
 */
async function executeOnDemandPaperTrade(ctx: any, cleanSymbol: string, bingx: BingXService, orchestrator: AutonomousOrchestrator) {
    const fullSymbol = `${cleanSymbol}/USDT:USDT`;
    try {
        const [pricePrecision, ...fetchResults] = await Promise.all([
            bingx.getPricePrecision(fullSymbol),
            ...MATRIX_TFS.map(async tf => {
                const ohlcv = await bingx.fetchOHLCV(fullSymbol, tf, 100);
                return { tf, ohlcv };
            })
        ]);

        const mtfOHLCV: Record<string, OHLCV[]> = {};
        fetchResults.forEach(r => mtfOHLCV[r.tf] = r.ohlcv);

        const dossier = EngineConfluenceArbiter.buildDossier(fullSymbol, pricePrecision, mtfOHLCV);
        const direction = dossier.confluenceMetrics.recommendedDirection;

        if (direction === 'NONE') {
            return ctx.reply(`⚠️ لا يمكن فتح صفقة محاكاة لـ ${cleanSymbol}؛ لأن محركات التحليل في حالة حياد (NEUTRAL).`);
        }

        let dbUser = await User.findOne({ telegramId: ctx.from.id.toString() });
        if (!dbUser) {
            dbUser = await User.findOne({ isActive: true }) || await User.findOne({});
        }
        const userRefId = dbUser ? dbUser._id.toString() : ctx.from.id.toString();

        // Check if trade already active for this symbol
        const existingActive = await Trade.findOne({
            isPaperTrade: true,
            symbol: fullSymbol,
            currentStatus: { $in: ['OPEN', 'TP1_HIT', 'TP2_HIT'] }
        });
        if (existingActive) {
            return ctx.reply(`⚠️ توجد بالفعل صفقة افتراضية نشطة مفتوحة لعملة <b>${cleanSymbol}</b> حالياً.\nلا يمكن فتح صفقة جديدة لنفس العملة حتى تُغلق الصفقة الحالية.`, { parse_mode: 'HTML' });
        }

        const trade = await orchestrator.getPaperEngine().executePaperTrade({
            userId: userRefId,
            symbol: fullSymbol,
            direction,
            entryPrice: dossier.currentPrice,
            stopLoss: dossier.confluenceMetrics.suggestedSL,
            targets: dossier.confluenceMetrics.suggestedTPs,
            riskPercentage: 1.5,
            leverage: 10,
            engineId: 'MANUAL_MATH_SCAN',
            aiJustification: `تنفيذ يدوي بطلب من المستخدم بناءً على فحص التوافق الرياضي (${dossier.confluenceMetrics.overallScore}%)`
        });

        const msg = `🎮✅ <b>تم فتح صفقة افتراضية تجريبية بنجاح!</b>\n` +
            `━━━━━━━━━━━━━━━━━━━━━\n` +
            `🪙 <b>العملة:</b> <b>${cleanSymbol}</b> (${trade.direction} 10x)\n` +
            `💵 <b>سعر الدخول:</b> <code>${trade.entryPrice}</code>\n` +
            `🛑 <b>وقف الخسارة:</b> <code>${trade.stopLoss}</code>\n` +
            `🎯 <b>الأهداف:</b> <code>${trade.targets.map(t => t.price).join(' | ')}</code>\n` +
            `💰 <b>الهامش المستخدم:</b> <code>$${(trade.amount / trade.leverage).toFixed(2)} USDT</code>\n` +
            `⏱️ <b>وقت التنفيذ:</b> <code>${new Date().toLocaleTimeString()}</code>\n` +
            `━━━━━━━━━━━━━━━━━━━━━\n` +
            `<i>يمكنك متابعة هذه الصفقة في أي وقت عبر أمر /paper_trades</i>`;

        const keyboard = {
            inline_keyboard: [
                [
                    { text: '💼 الصفقات النشطة الآن', callback_data: 'aut_view_open_paper_trades' },
                    { text: '🎮 لوحة المحفظة', callback_data: 'aut_view_paper_stats' }
                ]
            ]
        };

        await ctx.replyWithHTML(msg, { reply_markup: keyboard });
    } catch (e: any) {
        logger.error(`Error executing paper trade for ${cleanSymbol}:`, e);
        ctx.reply(`❌ فشل فتح الصفقة التجريبية: ${e.message}`);
    }
}

/**
 * 11. Paper Trading Balance Picker & Reset Menu
 */
async function renderPaperBalancePicker(ctx: any, isEdit = false) {
    const currentBal = PaperTradingEngine.initialBalance;
    const msg =
        `💰 <b>تحديد رأس المال للمحفظة الافتراضية والبدء من جديد</b>\n` +
        `━━━━━━━━━━━━━━━━━━━━━\n` +
        `• <b>رأس المال المعتمد حالياً:</b> <code>$${currentBal.toLocaleString()} USDT</code>\n\n` +
        `اختر رأس المال الافتراضي الذي تريد محاكاته وبدء سجل تداول جديد به، أو يمكنك كتابة أمر مخصص:\n` +
        `👉 <code>/set_paper_balance 1500</code>\n\n` +
        `⚠️ <i>تنبيه: اختيار أي مبلغ سيقوم بتصفير سجل الصفقات الافتراضية والبدء من جديد بهذا الرصيد.</i>`;

    const keyboard = {
        inline_keyboard: [
            [
                { text: '$50 USDT 🪙', callback_data: 'aut_set_bal_50' },
                { text: '$100 USDT 💵', callback_data: 'aut_set_bal_100' },
                { text: '$250 USDT 💵', callback_data: 'aut_set_bal_250' }
            ],
            [
                { text: '$500 USDT 💵', callback_data: 'aut_set_bal_500' },
                { text: '$1,000 USDT 💼', callback_data: 'aut_set_bal_1000' },
                { text: '$5,000 USDT 🏦', callback_data: 'aut_set_bal_5000' }
            ],
            [
                { text: '🔙 رجوع للمحفظة الافتراضية', callback_data: 'aut_view_paper_stats' }
            ]
        ]
    };

    if (isEdit && ctx.callbackQuery) {
        await ctx.editMessageText(msg, { parse_mode: 'HTML', reply_markup: keyboard }).catch(async () => {
            await ctx.replyWithHTML(msg, { reply_markup: keyboard });
        });
    } else {
        await ctx.replyWithHTML(msg, { reply_markup: keyboard });
    }
}
