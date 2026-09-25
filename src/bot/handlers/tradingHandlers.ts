import { Telegraf } from 'telegraf';
import logger from '../../utils/logger';
import { BingXService } from '../../services/BingXService';
import { TradeManager } from '../../services/TradeManager';
import User from '../../models/User';
import Trade from '../../models/Trade';
import { getDynamicSymbolsKeyboard, getMainMenuKeyboard } from '../keyboards/baseKeyboards';
import { CircuitBreakerService } from '../../services/CircuitBreakerService';
import { CorrelationGuardService } from '../../services/CorrelationGuardService';
import { DynamicZigZag, HarmonicPatternDetector } from '../../core/shared/harmonic';
import { EngineOrchestrator } from '../../core/analysis/EngineOrchestrator';
import { MacroCalendarService } from '../../services/MacroCalendarService';

export const registerTradingHandlers = (bot: Telegraf, BingXService: BingXService) => {

    bot.hears('🛑 إلغاء كل الصفقات المفتوحة', async (ctx) => {
        try {
            if (!ctx.from) return;
            const user = await User.findOne({ telegramId: ctx.from.id.toString() });
            if (!user) return;

            ctx.reply('⏳ جاري حساب الأرباح والخسائر الحالية لمعرفة وضع الحساب على bingXService...');

            const balance = await BingXService.getBalance();
            const positions = await BingXService.getPositions();

            if (!positions || positions.length === 0) {
                ctx.reply('لا يوجد صفقات مفتوحة حالياً لإلغائها.', { reply_markup: getMainMenuKeyboard(user) });
                return;
            }

            let totalPnl = 0;
            let activePosCount = 0;

            for (const pos of positions) {
                if (parseFloat(pos.contracts) === 0) continue;
                activePosCount++;
                const pnl = pos.unrealizedPnl !== undefined ? pos.unrealizedPnl :
                    (pos.info && pos.info.unrealizedProfit ? parseFloat(pos.info.unrealizedProfit) : 0);
                totalPnl += pnl;
            }

            if (activePosCount === 0) {
                ctx.reply('لا يوجد صفقات مفتوحة فعلية لإلغائها.', { reply_markup: getMainMenuKeyboard(user) });
                return;
            }

            // Set Bot State to AWAITING_CANCEL_ALL_CONFIRM
            user.botState = 'AWAITING_CANCEL_ALL_CONFIRM';
            await user.save();

            const pnlEmoji = totalPnl >= 0 ? '🟢 إجمالي أرباح' : '🔴 إجمالي خسارة';
            let confirmMsg = `⚠️ <b>تأكيد إغلاق جميع الصفقات (${activePosCount} صفقات) على Bingx </b>\n\n` +
                `💰 <b>رأس المال المتاح (الرصيد):</b> ${balance.toFixed(2)} USDT\n` +
                `${pnlEmoji} عائمة لهذه الصفقات: <b>${totalPnl.toFixed(2)} USDT</b>\n\n` +
                `الرصيد المتوقع بعد الإغلاق: <b>${(balance + totalPnl).toFixed(2)} USDT</b>\n\n` +
                `هل أنت متأكد من رغبتك في إغلاق جميع الصفقات بسعر السوق الحالي (Market) المتوفر؟`;

            ctx.replyWithHTML(confirmMsg, {
                reply_markup: {
                    keyboard: [
                        [{ text: "نعم، متأكد ✅" }, { text: "إلغاء ❌" }]
                    ],
                    resize_keyboard: true,
                    one_time_keyboard: true
                }
            });

        } catch (error) {
            logger.error(error);
            ctx.reply('حدث خطأ أثناء محاولة جلب الصفقات المفتوحة من bingXService.');
        }
    });

    bot.hears('🔍 الاستعلام عن صفقة محددة', async (ctx) => {
        try {
            if (!ctx.from) return;
            const user = await User.findOne({ telegramId: ctx.from.id.toString() });
            if (!user) return;
            user.botState = 'AWAITING_QUERY_SYMBOL';
            await user.save();

            const activeKeys = await getDynamicSymbolsKeyboard(BingXService);

            ctx.reply('🔍 اختر العملة من القائمة أدناه، أو قم بكتابة الرمز (مثال: BTC):', {
                reply_markup: { keyboard: activeKeys, resize_keyboard: true, one_time_keyboard: true }
            });
        } catch (e) {
            ctx.reply('حدث خطأ.');
        }
    });

    bot.hears('❌ إلغاء صفقة محددة', async (ctx) => {
        try {
            if (!ctx.from) return;
            const user = await User.findOne({ telegramId: ctx.from.id.toString() });
            if (!user) return;
            user.botState = 'AWAITING_CANCEL_SYMBOL';
            await user.save();

            const activeKeys = await getDynamicSymbolsKeyboard(BingXService);

            ctx.reply('❌ اختر العملة التي تريد إلغاء صفقتها، أو قم بكتابتها (مثال: ETH):', {
                reply_markup: { keyboard: activeKeys, resize_keyboard: true, one_time_keyboard: true }
            });
        } catch (e) {
            ctx.reply('حدث خطأ.');
        }
    });

    bot.command('status', async (ctx) => {
        try {
            const input = ctx.message.text.split(' ')[1];
            if (!input) {
                ctx.reply('الرجاء كتابة اسم العملة. مثال: /status BTC');
                return;
            }

            // Find trade
            const user = await User.findOne({ telegramId: ctx.from.id.toString() });
            if (!user) return;

            // Look for exact match or partial match in DB
            const trade = await Trade.findOne({
                userId: user._id,
                currentStatus: { $in: ['OPEN', 'TP1_HIT', 'TP2_HIT'] },
                symbol: { $regex: input.toUpperCase() }
            }).sort({ entryTime: -1 });

            if (!trade) {
                ctx.reply(`لا يوجد صفقة مفتوحة للعملة ${input}`);
                return;
            }

            // Fetch live PnL from Bingx 
            const positions = await BingXService.getPositions(trade.symbol);
            const pos = positions.find((p: any) => p.symbol === trade.symbol);
            const balance = await BingXService.getBalance();

            let msg = `📊 <b>Bingx  Status: ${trade.symbol}</b>\n` +
                `النوع: ${trade.direction === 'LONG' ? 'شراء (LONG) 🟢' : 'بيع (SHORT) 🔴'}\n` +
                `الرافعة: <b>${trade.leverage || 'N/A'}x</b>\n`;

            if (pos) {
                const posEntryPrice = parseFloat(pos.entryPrice);
                msg += `سعر الدخول: ${posEntryPrice.toFixed(4)}\n`;

                const pnl = pos.unrealizedPnl !== undefined ? pos.unrealizedPnl :
                    (pos.info && pos.info.unrealizedProfit ? parseFloat(pos.info.unrealizedProfit) : 0);

                let margin = pos.initialMargin !== undefined ? pos.initialMargin :
                    (pos.info && pos.info.isolatedMargin ? parseFloat(pos.info.isolatedMargin) : 0);

                if (!margin && pos.notional) {
                    margin = Math.abs(pos.notional) / (pos.leverage || 10);
                }

                const roe = pos.percentage !== undefined ? pos.percentage : (margin > 0 ? (pnl / margin) * 100 : 0);

                msg += `الربح/الخسارة العائمة: ${pnl >= 0 ? '🟢' : '🔴'} <b>${pnl.toFixed(4)} USDT</b> (${roe.toFixed(2)}%)\n`;
                msg += `النسبة من المحفظة: ${((margin / balance) * 100).toFixed(2)}%\n`;
            } else {
                msg += `الصفقة موجودة في النظام ولكن غير متصلة مؤقتاً بالمنصة.\n`;
            }

            ctx.replyWithHTML(msg);
        } catch (error) {
            ctx.reply('Error fetching status from bingXService.');
        }
    });

    // 🚨 Emergency Panic Button / Command: /panic
    bot.command('panic', async (ctx) => {
        try {
            if (!ctx.from) return;
            const user = await User.findOne({ telegramId: ctx.from.id.toString() });
            if (!user) return;

            ctx.reply('🚨 <b>جاري تنفيذ أمر الطوارئ الفوري (EMERGENCY PANIC)...</b>', { parse_mode: 'HTML' });

            const tradeManager = new TradeManager(BingXService);
            const closedCount = await tradeManager.closeAllPositions(user._id.toString());

            // Close active DB trades
            await Trade.updateMany(
                { userId: user._id, currentStatus: { $in: ['OPEN', 'TP1_HIT', 'TP2_HIT'] } },
                { $set: { currentStatus: 'CLOSED_MANUAL', closeTime: new Date() } }
            );

            ctx.replyWithHTML(
                `🛑 <b>تم تنفيذ إيقاف الطوارئ بنجاح!</b>\n` +
                `تم إغلاق <b>${closedCount}</b> مركزاً في منصة BingX وإلغاء أوامر الحماية المعلقة.`
            );
        } catch (e: any) {
            logger.error('Error in /panic handler:', e);
            ctx.reply(`حدث خطأ أثناء تنفيذ أمر الطوارئ: ${e.message}`);
        }
    });

    // 🛡️ Circuit Breaker Status & Management: /circuit_breaker
    bot.command('circuit_breaker', async (ctx) => {
        try {
            if (!ctx.from) return;
            const status = await CircuitBreakerService.checkStatus(ctx.from.id.toString(), BingXService);

            let msg = `🛡️ <b>حالة قاطع الدائرة وحماية المحفظة (Circuit Breaker)</b>\n━━━━━━━━━━━━━━━━━━\n`;
            msg += `الحالة: ${status.isTripped ? '🚨 <b>مفعل (محظور مؤقتاً)</b>' : '🟢 <b>طبيعي (التداول متاح)</b>'}\n`;
            msg += `التراجع اليومي المحسوب: <b>${status.dailyDrawdownPct}%</b> (الحد الأقصى: ${status.thresholdPct}%)\n`;
            msg += `الخسائر المحققة لآخر 24 ساعة: <b>$${status.realizedLoss24h.toFixed(2)}</b>\n`;
            msg += `الربح/الخسارة العائمة: <b>$${status.unrealizedPnL.toFixed(2)}</b>\n`;

            if (status.isTripped && status.cooldownUntil) {
                msg += `\n⏳ فترة التهدئة الإجبارية تنتهي في: <b>${status.cooldownUntil.toLocaleTimeString()}</b>\n`;
                msg += `السبب: <i>${status.tripReason}</i>\n`;
            }

            ctx.replyWithHTML(msg, {
                reply_markup: status.isTripped ? {
                    inline_keyboard: [
                        [{ text: '🔄 إعادة ضبط القاطع يدوياً (Manual Reset)', callback_data: 'RESET_CIRCUIT_BREAKER' }]
                    ]
                } : undefined
            });
        } catch (e: any) {
            ctx.reply(`حدث خطأ: ${e.message}`);
        }
    });

    bot.action('RESET_CIRCUIT_BREAKER', async (ctx) => {
        if (!ctx.from) return;
        CircuitBreakerService.manualReset(ctx.from.id.toString());
        await ctx.answerCbQuery('تمت إعادة ضبط قاطع الدائرة بنجاح واستئناف التداول!');
        ctx.editMessageText('✅ <b>تمت إعادة ضبط قاطع الدائرة يدوياً. التداول متاح الآن بشكل طبيعي.</b>', { parse_mode: 'HTML' });
    });

    // 🌡️ Portfolio Heat & Correlation Guard: /heat
    bot.command('heat', async (ctx) => {
        try {
            if (!ctx.from) return;
            const positions = await BingXService.getPositions();
            const activePos = positions.filter((p: any) => parseFloat(p.contracts) > 0);

            let totalHeat = activePos.length * 2.0; // 2% per position
            let msg = `🌡️ <b>مقياس حرارة المحفظة ومخاطر الارتباط (Portfolio Heat)</b>\n━━━━━━━━━━━━━━━━━━\n`;
            msg += `المراكز المفتوحة حالياً: <b>${activePos.length}</b>\n`;
            msg += `حرارة المحفظة التقديرية: <b>${totalHeat.toFixed(1)}%</b> / ${CorrelationGuardService.MAX_PORTFOLIO_HEAT_PCT}%\n`;
            msg += `سقف الارتباط المالي المسموح: <b>${(CorrelationGuardService.MAX_ALLOWED_CORRELATION * 100)}%</b>\n\n`;

            if (activePos.length > 0) {
                msg += `📌 <b>المراكز النشطة:</b>\n`;
                for (const p of activePos) {
                    msg += `• ${p.symbol} (${p.side}) - حجم: ${p.contracts}\n`;
                }
            } else {
                msg += `✅ لا توجد مراكز مفتوحة. المحفظة في وضع أمان كامل (Zero Heat).`;
            }

            ctx.replyWithHTML(msg);
        } catch (e: any) {
            ctx.reply(`حدث خطأ: ${e.message}`);
        }
    });

    // 📐 Instant Harmonic Scanner: /harmonic [symbol]
    bot.command('harmonic', async (ctx) => {
        try {
            const parts = ctx.message.text.split(' ');
            const rawSymbol = parts[1] ? parts[1].toUpperCase() : 'BTC-USDT';
            const symbol = rawSymbol.includes('-') || rawSymbol.includes('/') ? rawSymbol : `${rawSymbol}-USDT`;

            ctx.reply(`⏳ جاري فحص نماذج الهارمونيك الـ 11 ومناطق الـ PRZ لعملة <b>${symbol}</b>...`, { parse_mode: 'HTML' });

            const candles = await BingXService.fetchOHLCV(symbol, '1h', 60);
            if (!candles || candles.length < 25) {
                ctx.reply(`تعذر جلب بيانات شموع كافية لعملة ${symbol}.`);
                return;
            }

            const currentPrice = candles[candles.length - 1].close;
            const swings = DynamicZigZag.findSwings(candles, 1.8, 2);
            const matches = HarmonicPatternDetector.detectPatterns(swings, currentPrice);

            if (matches.length === 0) {
                ctx.replyWithHTML(
                    `📐 <b>نتائج فاحص الهارمونيك (11 نموذجاً)</b>\n` +
                    `الرمز: <b>${symbol}</b> | السعر الحالي: <b>$${currentPrice}</b>\n` +
                    `لا توجد نماذج توافقية مكتملة أو قريبة من الـ PRZ في الوقت الحالي.`
                );
                return;
            }

            const best = matches[0];
            let msg = `🎯 <b>اكتشاف نموذج هارمونيك توافقي نشط!</b>\n━━━━━━━━━━━━━━━━━━\n`;
            msg += `الرمز: <b>${symbol}</b> (${best.direction === 'BULLISH' ? 'صاعد 🟢' : 'هابط 🔴'})\n`;
            msg += `النموذج: <b>${best.pattern}</b>\n`;
            msg += `نسبة الدقة الرياضية: <b>${best.score.toFixed(0)}%</b>\n`;
            msg += `الحالة: <b>${best.status === 'IN_PRZ' ? 'داخل منطقة الانعكاس PRZ ⚡' : 'قيد التكوين ⏳'}</b>\n`;
            msg += `منطقة الانعكاس PRZ: <b>[${best.prz.min.toFixed(4)} - ${best.prz.max.toFixed(4)}]</b>\n`;
            msg += `وقف الخسارة (SL): <b>${best.stopLoss.toFixed(4)}</b>\n`;
            msg += `الهدف الأول (TP1): <b>${best.targets.tp1.toFixed(4)}</b>\n`;
            msg += `الهدف الثاني (TP2): <b>${best.targets.tp2.toFixed(4)}</b>\n`;
            msg += `معامل المخاطرة/العائد (RRR): <b>1:${best.riskRewardRatio}</b>\n`;

            ctx.replyWithHTML(msg);
        } catch (e: any) {
            ctx.reply(`حدث خطأ أثناء فحص الهارمونيك: ${e.message}`);
        }
    });

    // 🚀 Multi-Engine Consensus & Orchestration: /engines [symbol]
    bot.command('engines', async (ctx) => {
        try {
            const parts = ctx.message.text.split(' ');
            const rawSymbol = parts[1] ? parts[1].toUpperCase() : 'BTC-USDT';
            const symbol = rawSymbol.includes('-') || rawSymbol.includes('/') ? rawSymbol : `${rawSymbol}-USDT`;

            ctx.reply(`⚡ جاري استطلاع آراء المحركات الـ 19 مجتمعة (V1-V18 + الهارمونيك) لعملة <b>${symbol}</b>...`, { parse_mode: 'HTML' });

            const candles5m = await BingXService.fetchOHLCV(symbol, '5m', 60);
            const candles1h = await BingXService.fetchOHLCV(symbol, '1h', 60);
            const candles1d = await BingXService.fetchOHLCV(symbol, '1d', 30);
            const precision = await BingXService.getPricePrecision(symbol);

            const mtf = { '5m': candles5m, '1h': candles1h, '1d': candles1d };

            const orchestrated = EngineOrchestrator.orchestrate(symbol, precision, mtf, 'CONSENSUS', {
                quickTF: '5m',
                longTF: '1h',
                limit: 60
            });

            let msg = `🤖 <b>منسق المحركات الشاملة (Multi-Engine Orchestrator)</b>\n━━━━━━━━━━━━━━━━━━\n`;
            msg += `الرمز: <b>${symbol}</b>\n`;
            msg += `نظام السوق المكتشف (V17): <b>${orchestrated.regime}</b>\n`;
            msg += `القرار الموحد: <b>${orchestrated.action === 'LONG' ? 'شراء 🟢' : orchestrated.action === 'SHORT' ? 'بيع 🔴' : 'انتظار / توازن ⚖️'}</b>\n`;
            msg += `نسبة الثقة المجمعة: <b>${orchestrated.confidence}%</b>\n\n`;

            msg += `🗳️ <b>أصوات المحركات:</b>\n`;
            const buyVotes = orchestrated.votes.filter(v => v.decision === 'LONG').map(v => v.engineId).join(', ');
            const sellVotes = orchestrated.votes.filter(v => v.decision === 'SHORT').map(v => v.engineId).join(', ');
            msg += `• شراء (${orchestrated.votes.filter(v => v.decision === 'LONG').length}): ${buyVotes || 'لا يوجد'}\n`;
            msg += `• بيع (${orchestrated.votes.filter(v => v.decision === 'SHORT').length}): ${sellVotes || 'لا يوجد'}\n`;
            msg += `• محايد/انتظار: ${orchestrated.votes.filter(v => v.decision === 'NONE').length} محركاً\n`;

            ctx.replyWithHTML(msg);
        } catch (e: any) {
            ctx.reply(`حدث خطأ أثناء تشغيل منسق المحركات: ${e.message}`);
        }
    });

    // Helper function to build macro keyboard
    const getMacroInlineKeyboard = () => ({
        inline_keyboard: [
            [
                { text: '🧠 تقرير وتحليل الذكاء الاصطناعي للأخبار', callback_data: 'VIEW_MACRO_AI_BRIEFING' }
            ],
            [
                { 
                    text: MacroCalendarService.isFilterEnabled ? '🔴 تعطيل فلتر الأخبار' : '🟢 تفعيل فلتر الأخبار', 
                    callback_data: 'TOGGLE_MACRO_FILTER' 
                },
                { text: '📡 جلب الأخبار الحية', callback_data: 'SYNC_MACRO_LIVE' }
            ],
            [
                { text: '🔄 تحديث الجدول', callback_data: 'REFRESH_MACRO_FILTER' }
            ]
        ]
    });

    // 🌐 Macro Calendar News Filter: /macro
    bot.command('macro', async (ctx) => {
        try {
            const report = MacroCalendarService.getFormattedReport();
            ctx.replyWithHTML(report, {
                reply_markup: getMacroInlineKeyboard()
            });
        } catch (e: any) {
            ctx.reply(`حدث خطأ: ${e.message}`);
        }
    });

    bot.action('TOGGLE_MACRO_FILTER', async (ctx) => {
        try {
            const newState = MacroCalendarService.toggleFilter();
            await ctx.answerCbQuery(newState ? 'تم تفعيل فلتر الأخبار بنجاح!' : 'تم تعطيل فلتر الأخبار!').catch(() => {});
            const report = MacroCalendarService.getFormattedReport();
            await ctx.editMessageText(report, {
                parse_mode: 'HTML',
                reply_markup: getMacroInlineKeyboard()
            }).catch((err: any) => {
                if (!err.message?.includes('message is not modified')) {
                    logger.warn('Failed to edit macro message:', err.message);
                }
            });
        } catch (e: any) {
            logger.error('Error in TOGGLE_MACRO_FILTER:', e);
        }
    });

    bot.action('REFRESH_MACRO_FILTER', async (ctx) => {
        try {
            await ctx.answerCbQuery('تم التحديث').catch(() => {});
            const report = MacroCalendarService.getFormattedReport();
            await ctx.editMessageText(report, {
                parse_mode: 'HTML',
                reply_markup: getMacroInlineKeyboard()
            }).catch((err: any) => {
                if (!err.message?.includes('message is not modified')) {
                    logger.warn('Failed to edit macro message:', err.message);
                }
            });
        } catch (e: any) {
            logger.error('Error in REFRESH_MACRO_FILTER:', e);
        }
    });

    bot.action('SYNC_MACRO_LIVE', async (ctx) => {
        try {
            await ctx.answerCbQuery('⏳ جاري جلب الأخبار الحية من التقويم الاقتصادي العالمي...').catch(() => {});
            const syncResult = await MacroCalendarService.syncRealEvents();
            const alertMsg = syncResult.updated 
                ? `✅ تم بنجاح جلب ${syncResult.count} حدثاً اقتصادياً حقيقياً!`
                : `ℹ️ تم الفحص. الجدول محدث بالكامل (${syncResult.count} حدثاً).`;
            await ctx.reply(alertMsg);

            const report = MacroCalendarService.getFormattedReport();
            await ctx.replyWithHTML(report, {
                reply_markup: getMacroInlineKeyboard()
            });
        } catch (e: any) {
            logger.error('Error in SYNC_MACRO_LIVE:', e);
            ctx.reply(`تعذر جلب الأخبار: ${e.message}`);
        }
    });

    // 🧠 AI Supervision Briefing Action
    bot.action('VIEW_MACRO_AI_BRIEFING', async (ctx) => {
        try {
            await ctx.answerCbQuery('🧠 جاري إعداد تقرير الخبير الاقتصادي بالذكاء الاصطناعي...').catch(() => {});
            const waitMsg = await ctx.reply('⏳ <b>جاري تحليل الأخبار الحقيقية وتقدير أثرها على سيولة البيتكوين بواسطة الذكاء الاصطناعي...</b>', { parse_mode: 'HTML' });
            
            const briefing = await MacroCalendarService.getAiSupervisionBriefing(false);
            
            await ctx.deleteMessage(waitMsg.message_id).catch(() => {});
            await ctx.replyWithHTML(
                `🧠 <b>تقرير المشرف الاقتصادي الذكي (AI Macro Supervisor)</b>\n━━━━━━━━━━━━━━━━━━━━━\n\n${briefing}`,
                {
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: '🔄 إعادة التحليل وتحديث الاستشارة', callback_data: 'REFRESH_MACRO_AI' }],
                            [{ text: '🔙 العودة لجدول الأخبار', callback_data: 'REFRESH_MACRO_FILTER' }]
                        ]
                    }
                }
            ).catch(async () => {
                // Fallback to plain text if HTML parsing has issues
                await ctx.reply(
                    `🧠 تقرير المشرف الاقتصادي الذكي (AI Macro Supervisor)\n━━━━━━━━━━━━━━━━━━━━━\n\n${briefing}`,
                    {
                        reply_markup: {
                            inline_keyboard: [
                                [{ text: '🔄 إعادة التحليل وتحديث الاستشارة', callback_data: 'REFRESH_MACRO_AI' }],
                                [{ text: '🔙 العودة لجدول الأخبار', callback_data: 'REFRESH_MACRO_FILTER' }]
                            ]
                        }
                    }
                );
            });
        } catch (e: any) {
            logger.error('Error in VIEW_MACRO_AI_BRIEFING:', e);
            ctx.reply(`تعذر إعداد تقرير الذكاء الاصطناعي: ${e.message}`);
        }
    });

    bot.action('REFRESH_MACRO_AI', async (ctx) => {
        try {
            await ctx.answerCbQuery('🧠 جاري تحديث الاستشارة الفورية بالذكاء الاصطناعي...').catch(() => {});
            const briefing = await MacroCalendarService.getAiSupervisionBriefing(true);
            await ctx.replyWithHTML(
                `🧠 <b>التقرير المحدث للمشرف الاقتصادي الذكي (AI Macro Supervisor)</b>\n━━━━━━━━━━━━━━━━━━━━━\n\n${briefing}`,
                {
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: '🔙 العودة لجدول الأخبار', callback_data: 'REFRESH_MACRO_FILTER' }]
                        ]
                    }
                }
            ).catch(async () => {
                await ctx.reply(`🧠 التقرير المحدث للمشرف الاقتصادي الذكي:\n\n${briefing}`);
            });
        } catch (e: any) {
            logger.error('Error in REFRESH_MACRO_AI:', e);
            ctx.reply(`تعذر تحديث تقرير الذكاء الاصطناعي: ${e.message}`);
        }
    });

    // ── Button Listeners for Reply Keyboard ──
    bot.hears('🚨 زر الطوارئ (Panic)', async (ctx) => {
        ctx.replyWithHTML(
            `⚠️ <b>هل أنت متأكد من رغبتك في تنفيذ أمر الطوارئ الفوري (Panic Stop)؟</b>\n\n` +
            `سيتم إغلاق كافة الصفقات المفتوحة فوراً بسعر السوق وإلغاء أوامر الحماية المعلقة على BingX!`,
            {
                reply_markup: {
                    inline_keyboard: [
                        [{ text: '🚨 نعم، نفّذ إغلاق الطوارئ فوراً!', callback_data: 'CONFIRM_PANIC_STOP' }],
                        [{ text: 'إلغاء ❌', callback_data: 'CANCEL_PANIC' }]
                    ]
                }
            }
        );
    });

    bot.action('CONFIRM_PANIC_STOP', async (ctx) => {
        if (!ctx.from) return;
        const user = await User.findOne({ telegramId: ctx.from.id.toString() });
        if (!user) return;
        await ctx.answerCbQuery('جاري تنفيذ إغلاق الطوارئ...');
        const tradeManager = new TradeManager(BingXService);
        const closedCount = await tradeManager.closeAllPositions(user._id.toString());
        await Trade.updateMany(
            { userId: user._id, currentStatus: { $in: ['OPEN', 'TP1_HIT', 'TP2_HIT'] } },
            { $set: { currentStatus: 'CLOSED_MANUAL', closeTime: new Date() } }
        );
        ctx.editMessageText(`🛑 <b>تم إغلاق ${closedCount} مركزاً وإيقاف الطوارئ بنجاح!</b>`, { parse_mode: 'HTML' });
    });

    bot.action('CANCEL_PANIC', async (ctx) => {
        await ctx.answerCbQuery('تم الإلغاء');
        ctx.editMessageText('✅ تم إلغاء أمر الطوارئ. الحساب يعمل بشكل طبيعي.');
    });

    bot.hears('🛡️ قاطع الدائرة وحرارة المحفظة', async (ctx) => {
        if (!ctx.from) return;
        const status = await CircuitBreakerService.checkStatus(ctx.from.id.toString(), BingXService);
        let msg = `🛡️ <b>حالة قاطع الدائرة وحماية المحفظة (Circuit Breaker)</b>\n━━━━━━━━━━━━━━━━━━\n`;
        msg += `الحالة: ${status.isTripped ? '🚨 <b>مفعل (محظور مؤقتاً)</b>' : '🟢 <b>طبيعي (التداول متاح)</b>'}\n`;
        msg += `التراجع اليومي المحسوب: <b>${status.dailyDrawdownPct}%</b> (الحد الأقصى: ${status.thresholdPct}%)\n`;
        msg += `الخسائر المحققة لآخر 24 ساعة: <b>$${status.realizedLoss24h.toFixed(2)}</b>\n`;
        msg += `الربح/الخسارة العائمة: <b>$${status.unrealizedPnL.toFixed(2)}</b>\n`;

        if (status.isTripped && status.cooldownUntil) {
            msg += `\n⏳ فترة التهدئة الإجبارية تنتهي في: <b>${status.cooldownUntil.toLocaleTimeString()}</b>\n`;
            msg += `السبب: <i>${status.tripReason}</i>\n`;
        }

        ctx.replyWithHTML(msg, {
            reply_markup: {
                inline_keyboard: [
                    status.isTripped ? [{ text: '🔄 إعادة ضبط القاطع يدوياً', callback_data: 'RESET_CIRCUIT_BREAKER' }] : [],
                    [{ text: '🌡️ فحص حرارة المحفظة ومخاطر الارتباط', callback_data: 'VIEW_HEAT' }],
                    [{ text: '🌐 فلتر أخبار الاقتصاد الكلي (Macro News)', callback_data: 'VIEW_MACRO_REPORT' }]
                ].filter(r => r.length > 0)
            }
        });
    });

    bot.action('VIEW_HEAT', async (ctx) => {
        await ctx.answerCbQuery();
        const positions = await BingXService.getPositions();
        const activePos = positions.filter((p: any) => parseFloat(p.contracts) > 0);
        let totalHeat = activePos.length * 2.0;
        let msg = `🌡️ <b>مقياس حرارة المحفظة والارتباط:</b>\nالمراكز المفتوحة: ${activePos.length} | الحرارة: ${totalHeat.toFixed(1)}% / ${CorrelationGuardService.MAX_PORTFOLIO_HEAT_PCT}%\nسقف الارتباط المسموح: ${(CorrelationGuardService.MAX_ALLOWED_CORRELATION * 100)}%`;
        ctx.replyWithHTML(msg);
    });

    bot.hears('🌐 فلتر أخبار الاقتصاد الكلي', async (ctx) => {
        const report = MacroCalendarService.getFormattedReport();
        ctx.replyWithHTML(report, {
            reply_markup: getMacroInlineKeyboard()
        });
    });

    bot.action('VIEW_MACRO_REPORT', async (ctx) => {
        await ctx.answerCbQuery().catch(() => {});
        const report = MacroCalendarService.getFormattedReport();
        ctx.replyWithHTML(report, {
            reply_markup: getMacroInlineKeyboard()
        });
    });

    bot.hears('📐 فاحص الهارمونيك اللحظي', async (ctx) => {
        ctx.replyWithHTML('📐 <b>فاحص نماذج الهارمونيك الـ 11 ومناطق الـ PRZ</b>\nاختر عملة للفحص الفوري أو اكتب: <code>/harmonic BTC-USDT</code>', {
            reply_markup: {
                inline_keyboard: [
                    [{ text: '🎯 فحص BTC-USDT', callback_data: 'SCAN_H_BTC' }, { text: '🎯 فحص ETH-USDT', callback_data: 'SCAN_H_ETH' }],
                    [{ text: '🎯 فحص SOL-USDT', callback_data: 'SCAN_H_SOL' }, { text: '🎯 فحص BNB-USDT', callback_data: 'SCAN_H_BNB' }]
                ]
            }
        });
    });

    const triggerHarmonicScan = async (ctx: any, symbol: string) => {
        await ctx.answerCbQuery(`جاري فحص ${symbol}...`);
        const candles = await BingXService.fetchOHLCV(symbol, '1h', 60);
        if (!candles || candles.length < 25) {
            ctx.reply(`تعذر جلب بيانات شموع كافية لعملة ${symbol}.`);
            return;
        }
        const currentPrice = candles[candles.length - 1].close;
        const swings = DynamicZigZag.findSwings(candles, 1.8, 2);
        const matches = HarmonicPatternDetector.detectPatterns(swings, currentPrice);

        if (matches.length === 0) {
            ctx.replyWithHTML(`📐 <b>نتائج فاحص الهارمونيك (${symbol})</b>\nالسعر الحالي: $${currentPrice}\nلا توجد نماذج توافقية مكتملة حالياً.`);
            return;
        }
        const best = matches[0];
        let msg = `🎯 <b>اكتشاف نموذج هارمونيك توافقي!</b>\n━━━━━━━━━━━━━━━━━━\n`;
        msg += `الرمز: <b>${symbol}</b> (${best.direction === 'BULLISH' ? 'صاعد 🟢' : 'هابط 🔴'})\n`;
        msg += `النموذج: <b>${best.pattern}</b> | الدقة: <b>${best.score.toFixed(0)}%</b>\n`;
        msg += `الحالة: <b>${best.status === 'IN_PRZ' ? 'داخل منطقة الانعكاس PRZ ⚡' : 'قيد التكوين ⏳'}</b>\n`;
        msg += `منطقة الانعكاس PRZ: <b>[${best.prz.min.toFixed(4)} - ${best.prz.max.toFixed(4)}]</b>\n`;
        msg += `وقف الخسارة: <b>${best.stopLoss.toFixed(4)}</b> | RRR: <b>1:${best.riskRewardRatio}</b>\n`;
        ctx.replyWithHTML(msg);
    };

    bot.action('SCAN_H_BTC', (ctx) => triggerHarmonicScan(ctx, 'BTC-USDT'));
    bot.action('SCAN_H_ETH', (ctx) => triggerHarmonicScan(ctx, 'ETH-USDT'));
    bot.action('SCAN_H_SOL', (ctx) => triggerHarmonicScan(ctx, 'SOL-USDT'));
    bot.action('SCAN_H_BNB', (ctx) => triggerHarmonicScan(ctx, 'BNB-USDT'));

    bot.hears('🤖 منسق المحركات الموحد', async (ctx) => {
        ctx.replyWithHTML('🤖 <b>استطلاع رأي المحركات الـ 19 مجتمعة وإصدار قرار إجماع</b>\nاختر عملة للاستطلاع الفوري أو اكتب: <code>/engines BTC-USDT</code>', {
            reply_markup: {
                inline_keyboard: [
                    [{ text: '⚡ استطلاع إجماع BTC', callback_data: 'ENG_BTC' }, { text: '⚡ استطلاع إجماع ETH', callback_data: 'ENG_ETH' }]
                ]
            }
        });
    });

    const triggerOrchestrator = async (ctx: any, symbol: string) => {
        await ctx.answerCbQuery(`جاري استطلاع المحركات لـ ${symbol}...`);
        const candles5m = await BingXService.fetchOHLCV(symbol, '5m', 60);
        const candles1h = await BingXService.fetchOHLCV(symbol, '1h', 60);
        const candles1d = await BingXService.fetchOHLCV(symbol, '1d', 30);
        const precision = await BingXService.getPricePrecision(symbol);

        const mtf = { '5m': candles5m, '1h': candles1h, '1d': candles1d };
        const orchestrated = EngineOrchestrator.orchestrate(symbol, precision, mtf, 'CONSENSUS');

        let msg = `🤖 <b>منسق المحركات الشاملة (${symbol})</b>\n━━━━━━━━━━━━━━━━━━\n`;
        msg += `نظام السوق (V17): <b>${orchestrated.regime}</b>\n`;
        msg += `القرار الموحد: <b>${orchestrated.action === 'LONG' ? 'شراء 🟢' : orchestrated.action === 'SHORT' ? 'بيع 🔴' : 'انتظار / توازن ⚖️'}</b>\n`;
        msg += `نسبة الثقة المجمعة: <b>${orchestrated.confidence}%</b>\n\n`;
        const buyVotes = orchestrated.votes.filter(v => v.decision === 'LONG').map(v => v.engineId).join(', ');
        const sellVotes = orchestrated.votes.filter(v => v.decision === 'SHORT').map(v => v.engineId).join(', ');
        msg += `• شراء (${orchestrated.votes.filter(v => v.decision === 'LONG').length}): ${buyVotes || 'لا يوجد'}\n`;
        msg += `• بيع (${orchestrated.votes.filter(v => v.decision === 'SHORT').length}): ${sellVotes || 'لا يوجد'}\n`;
        ctx.replyWithHTML(msg);
    };

    bot.action('ENG_BTC', (ctx) => triggerOrchestrator(ctx, 'BTC-USDT'));
    bot.action('ENG_ETH', (ctx) => triggerOrchestrator(ctx, 'ETH-USDT'));

};

