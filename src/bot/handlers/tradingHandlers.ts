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

};

