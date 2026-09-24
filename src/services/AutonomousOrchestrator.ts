import logger from '../utils/logger';
import { BingXService } from './BingXService';
import { TradeManager } from './TradeManager';
import { SymbolPickerService, SCAN_SYMBOLS } from './SymbolPickerService';
import { EngineConfluenceArbiter, InstitutionalMarketDossier } from '../core/analysis/EngineConfluenceArbiter';
import { GeminiService } from './GeminiService';
import { PaperTradingEngine } from './PaperTradingEngine';
import { CircuitBreakerService } from './CircuitBreakerService';
import { MacroCalendarService } from './MacroCalendarService';
import { CorrelationGuardService } from './CorrelationGuardService';
import { MATRIX_TFS } from '../core/analysis/TechnicalAnalyzer';
import { OHLCV } from '../core/shared/types';
import User from '../models/User';
import Trade from '../models/Trade';
import { TradingMemoryService } from './TradingMemoryService';

export type AutonomousMode = 'PAPER_TRADING' | 'SEMI_AUTO' | 'FULL_AUTO';

export class AutonomousOrchestrator {
    private isRunning = false;
    private scanIntervalId?: NodeJS.Timeout;
    private paperEvalIntervalId?: NodeJS.Timeout;

    private paperEngine: PaperTradingEngine;
    private pickerService: SymbolPickerService;

    // Configurable state
    public currentMode: AutonomousMode = 'PAPER_TRADING';
    public activeWatchlist: string[] = ['BTC', 'ETH', 'SOL', 'BNB', 'XRP', 'DOGE', 'AVAX', 'NEAR'];
    public lastScanTimestamp: number = 0;
    public lastAuditResults: { symbol: string; approved: boolean; reason: string; timestamp: number }[] = [];
    public isPaused: boolean = false;
    public isAiAuditEnabled: boolean = true;
    public isMacroShieldEnabled: boolean = true;
    public minConfluenceScore: number = 70;
    public maxConcurrentTrades: number = 3;
    public maxNewTradesPerCycle: number = 1;
    public tradeStyle: 'HYBRID' | 'SCALP' | 'SWING' = 'HYBRID';
    public tpExecutionMode: 'single' | 'multiple' = 'multiple';

    constructor(
        private bingx: BingXService,
        private tradeManager: TradeManager,
        private notifier: (telegramId: string, msg: string, extra?: any) => Promise<void>
    ) {
        this.paperEngine = new PaperTradingEngine(bingx);
        this.pickerService = new SymbolPickerService(bingx);
    }

    /**
     * Starts the autonomous orchestrator daemon
     */
    start(): void {
        if (this.isRunning) return;
        this.isRunning = true;
        logger.info('🚀 [AutonomousOrchestrator] Starting Autonomous Quantitative Trading Engine V2...');

        // 0. Pre-load adaptive engine weights and history from database
        TradingMemoryService.initFromDb().catch(e => logger.warn(`[Orchestrator] Memory init warning: ${e.message}`));

        // 1. Initial watchlist refresh
        this.refreshWatchlist().catch(e => logger.warn(`[Orchestrator] Initial picker warning: ${e.message}`));

        // 2. Schedule hourly watchlist refresh
        setInterval(() => {
            this.refreshWatchlist().catch(e => logger.warn(`[Orchestrator] Hourly picker warning: ${e.message}`));
        }, 60 * 60 * 1000);

        // 3. Main Heartbeat loop: Checks timing every 10 seconds for 15M candle close
        this.scanIntervalId = setInterval(() => this.checkCandleCloseTick(), 10 * 1000);

        // 4. Paper trading positions evaluator (runs every 20 seconds)
        this.paperEvalIntervalId = setInterval(() => {
            this.paperEngine.evaluateActivePositions().catch(() => {});
        }, 20 * 1000);

        logger.info(`✅ [AutonomousOrchestrator] Operational! Active Mode: [${this.currentMode}]`);
    }

    /**
     * Stops the autonomous orchestrator
     */
    stop(): void {
        this.isRunning = false;
        if (this.scanIntervalId) clearInterval(this.scanIntervalId);
        if (this.paperEvalIntervalId) clearInterval(this.paperEvalIntervalId);
        logger.info('🛑 [AutonomousOrchestrator] Stopped.');
    }

    /**
     * Checks if current second falls in the 15m candle close execution window (:00, :15, :30, :45)
     */
    private async checkCandleCloseTick(): Promise<void> {
        const now = new Date();
        const mins = now.getMinutes();
        const secs = now.getSeconds();

        // Execution window: 0 to 20 seconds after 15m candle close (:00, :15, :30, :45)
        const isCandleClose = (mins % 15 === 0) && (secs >= 2 && secs <= 20);
        if (!isCandleClose) return;

        // Prevent double execution within the same candle
        if (Date.now() - this.lastScanTimestamp < 60 * 1000) return;
        this.lastScanTimestamp = Date.now();

        logger.info(`[AutonomousOrchestrator] ⏰ 15M Candle Closed (${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}). Initiating Autonomous Market Scan...`);
        await this.runAutonomousCycle();
    }

    /**
     * Refreshes the top-8 high quality watchlist using SymbolPickerService
     */
    async refreshWatchlist(): Promise<void> {
        try {
            logger.info('[AutonomousOrchestrator] Refreshing top watchlist via SymbolPickerService...');
            const results = await this.pickerService.refreshScan(15);
            if (results && results.length > 0) {
                // Pick top 8 ready or watch coins
                const top = results
                    .filter(r => r.label !== 'AVOID')
                    .slice(0, 8)
                    .map(r => r.shortName);

                if (top.length >= 4) {
                    this.activeWatchlist = top;
                    logger.info(`[AutonomousOrchestrator] Active watchlist updated: [${this.activeWatchlist.join(', ')}]`);
                }
            }
        } catch (e: any) {
            logger.warn(`[AutonomousOrchestrator] Could not refresh watchlist: ${e.message}`);
        }
    }

    /**
     * Main autonomous cycle executed on candle close
     */
    async runAutonomousCycle(): Promise<void> {
        try {
            if (this.isPaused) {
                logger.info('[AutonomousOrchestrator] Cycle skipped: Engine is currently PAUSED by user.');
                return;
            }

            // ── 0. Pre-Flight Safety Checks ─────────────────────────────────
            // A. Macro News Filter Check
            if (this.isMacroShieldEnabled) {
                const macroCheck = MacroCalendarService.isBlackout();
                if (macroCheck.isBlackoutActive) {
                    logger.warn(`[AutonomousOrchestrator] Cycle skipped due to Macro Blackout: ${macroCheck.reason}`);
                    return;
                }
            }

            // B. Find Admin / Active User
            const adminUser = await User.findOne({ isActive: true });
            if (!adminUser) {
                logger.warn('[AutonomousOrchestrator] No active user found in database.');
                return;
            }

            // C. Circuit Breaker Check
            const cbStatus = await CircuitBreakerService.checkStatus(adminUser.telegramId, this.bingx);
            if (cbStatus.isTripped) {
                logger.error(`[AutonomousOrchestrator] Cycle halted: Circuit Breaker active! (${cbStatus.tripReason})`);
                return;
            }

            // ── 1. Check Existing Active Positions & Active Symbols ───────────────────
            const isPaper = this.currentMode === 'PAPER_TRADING';
            const activeTrades = await Trade.find({
                isPaperTrade: isPaper ? true : { $ne: true },
                currentStatus: { $in: ['OPEN', 'TP1_HIT', 'TP2_HIT'] }
            }, { symbol: 1 });

            const activeSymbols = new Set(
                activeTrades.map(t => t.symbol.toUpperCase().replace('/USDT:USDT', '').replace('-USDT', '').replace('/USDT', ''))
            );
            const openPositionsCount = activeTrades.length;

            // ── 2. Phase 1: Mathematical Pre-screening of all symbols (0 AI calls) ──
            const candidatePool: {
                shortSymbol: string;
                fullSymbol: string;
                score: number;
                recDir: 'LONG' | 'SHORT';
                dossier: InstitutionalMarketDossier;
            }[] = [];

            const evaluations: { symbol: string; score: number; direction: string; executed: boolean }[] = [];

            for (const sym of this.activeWatchlist) {
                const cleanSym = sym.toUpperCase().replace('/USDT:USDT', '').replace('-USDT', '').replace('/USDT', '');
                if (activeSymbols.has(cleanSym)) {
                    evaluations.push({
                        symbol: sym,
                        score: 0,
                        direction: 'صفقة نشطة حالياً 🔒',
                        executed: false
                    });
                    continue;
                }

                try {
                    const fullSymbol = `${sym}/USDT:USDT`;
                    const [pricePrecision, ...fetchResults] = await Promise.all([
                        this.bingx.getPricePrecision(fullSymbol),
                        ...MATRIX_TFS.map(async tf => {
                            const ohlcv = await this.bingx.fetchOHLCV(fullSymbol, tf, 100);
                            return { tf, ohlcv };
                        })
                    ]);

                    const mtfOHLCV: Record<string, OHLCV[]> = {};
                    fetchResults.forEach(r => mtfOHLCV[r.tf] = r.ohlcv);

                    const quickTF = this.tradeStyle === 'SCALP' ? '5m' : '15m';
                    const longTF = this.tradeStyle === 'SWING' ? '4h' : (this.tradeStyle === 'SCALP' ? '15m' : '1h');

                    const dossier = EngineConfluenceArbiter.buildDossier(fullSymbol, pricePrecision, mtfOHLCV, {
                        quickTF,
                        longTF,
                        tradeStyle: this.tradeStyle
                    });

                    const score = dossier.confluenceMetrics.overallScore;
                    const recDir = dossier.confluenceMetrics.recommendedDirection;

                    if (score >= this.minConfluenceScore && recDir !== 'NONE') {
                        candidatePool.push({ shortSymbol: sym, fullSymbol, score, recDir, dossier });
                    } else {
                        evaluations.push({ symbol: sym, score, direction: recDir, executed: false });
                    }
                } catch (symErr: any) {
                    logger.error(`[AutonomousOrchestrator] Error screening ${sym}: ${symErr.message}`);
                }
            }

            // ── 3. Phase 2: Prioritize Top Candidate(s) ───────────────────────
            // Sort qualified candidates by score descending
            candidatePool.sort((a, b) => b.score - a.score);

            const availableSlots = Math.max(0, this.maxConcurrentTrades - openPositionsCount);
            const slotsToExecute = Math.min(availableSlots, this.maxNewTradesPerCycle);

            if (candidatePool.length > 0 && slotsToExecute <= 0) {
                logger.info(`[AutonomousOrchestrator] 🔒 سقف المراكز النشطة مكتمل (${openPositionsCount}/${this.maxConcurrentTrades}). لن يتم فتح صفقات جديدة.`);
            }

            let executedInThisCycle = 0;

            for (const cand of candidatePool) {
                const canExecute = executedInThisCycle < slotsToExecute;

                if (!canExecute) {
                    evaluations.push({
                        symbol: cand.shortSymbol,
                        score: cand.score,
                        direction: `${cand.recDir} (انتظار شاغر)`,
                        executed: false
                    });
                    continue;
                }

                // Process single qualified candidate
                const result = await this.auditAndExecuteCandidate(cand, adminUser, isPaper);
                if (result) {
                    evaluations.push(result);
                    if (result.executed) {
                        executedInThisCycle++;
                    }
                }
            }

            // Summary Log for Transparency
            if (evaluations.length > 0) {
                const scoreDetails = evaluations.map(e => `${e.symbol}: ${e.score}% [${e.direction}]${e.executed ? ' 🚀(نفذت)' : ''}`).join(' | ');
                logger.info(`[AutonomousOrchestrator] 📊 تقرير فحص الشمعة (${evaluations.length} عملات | صفقات نشطة: ${openPositionsCount}/${this.maxConcurrentTrades}):\n👉 ${scoreDetails}\n🎯 شرط الدخول الأدنى: >= ${this.minConfluenceScore}% توافق`);
            }
        } catch (err: any) {
            if (err.message && (err.message.includes('ENOTFOUND') || err.message.includes('topology'))) {
                logger.warn('[AutonomousOrchestrator] 🌐 الشبكة أو قاعدة البيانات غير متصلة مؤقتاً، في انتظار عودة الاتصال...');
                return;
            }
            logger.error(`[AutonomousOrchestrator] Critical error in runAutonomousCycle: ${err.message}`, err);
        }
    }

    /**
     * Audits and executes a single prioritized candidate through the complete pipeline
     */
    private async auditAndExecuteCandidate(
        cand: { shortSymbol: string; fullSymbol: string; score: number; recDir: 'LONG' | 'SHORT'; dossier: InstitutionalMarketDossier },
        user: any,
        isPaper: boolean
    ): Promise<{ symbol: string; score: number; direction: string; executed: boolean }> {
        const { shortSymbol, fullSymbol, score, recDir, dossier } = cand;
        let finalDirection: 'LONG' | 'SHORT' | 'NONE' = recDir;
        let finalStopLoss = dossier.confluenceMetrics.suggestedSL;
        let finalTargets = dossier.confluenceMetrics.suggestedTPs;
        let justification = `التوافق الرياضي (${score}%)`;

        // 1. Gemini Supreme AI Audit (if enabled)
        if (this.isAiAuditEnabled) {
            logger.info(`[AutonomousOrchestrator] 🎯 Candidate Found for ${shortSymbol}: Direction=${recDir}, Score=${score}%. Escalating to Gemini Supreme Audit...`);

            const audit = await GeminiService.auditQuantitativeDossier(dossier);
            this.lastAuditResults.unshift({
                symbol: shortSymbol,
                approved: audit.approved,
                reason: audit.auditJustification || audit.vetoReason || 'تم التدقيق',
                timestamp: Date.now()
            });
            if (this.lastAuditResults.length > 20) this.lastAuditResults.pop();

            if (!audit.approved || audit.finalDirection === 'NONE') {
                logger.warn(`[AutonomousOrchestrator] 🛑 Gemini AI VETO for ${shortSymbol}: ${audit.vetoReason}`);
                return { symbol: shortSymbol, score, direction: `فيتو الذكاء (${audit.vetoReason || 'مرفوض'})`, executed: false };
            }

            finalDirection = audit.finalDirection;
            finalStopLoss = audit.recommendedSL || finalStopLoss;
            finalTargets = audit.recommendedTPs && audit.recommendedTPs.length > 0 ? audit.recommendedTPs : finalTargets;
            justification = audit.auditJustification || justification;
        }

        // Apply single or multiple target mode
        if (this.tpExecutionMode === 'single' && finalTargets.length > 0) {
            finalTargets = [finalTargets[0]];
        }

        // 2. Portfolio Heat & Correlation Guard (Aware of Paper and Live trades)
        const corrResult = await CorrelationGuardService.validateTrade(fullSymbol, finalDirection, 1.5, this.bingx, isPaper);
        if (!corrResult.allowed) {
            logger.warn(`[AutonomousOrchestrator] Correlation guard rejected ${shortSymbol}: ${corrResult.reason}`);
            return { symbol: shortSymbol, score, direction: `حظر الارتباط (${corrResult.reason})`, executed: false };
        }

        // Check if trade already exists for this symbol (double check before execution)
        const isAlreadyActive = await Trade.exists({
            isPaperTrade: isPaper ? true : { $ne: true },
            symbol: fullSymbol,
            currentStatus: { $in: ['OPEN', 'TP1_HIT', 'TP2_HIT'] }
        });
        if (isAlreadyActive) {
            logger.warn(`[AutonomousOrchestrator] 🛑 تم منع فتح صفقة لـ ${shortSymbol}: توجد صفقة نشطة بالفعل لنفس العملة.`);
            return { symbol: shortSymbol, score, direction: 'توجد صفقة نشطة بالفعل 🔒', executed: false };
        }

        // ── 3. Execution Routing based on Active Mode ───────────────────────
        const alignedEngines = dossier.enginesSummary
            .filter(e => e.direction === finalDirection)
            .sort((a, b) => b.confidence - a.confidence);
        const primaryEngine = alignedEngines.length > 0 ? alignedEngines[0].engineId : 'AUTONOMOUS_V2';
        const engineTags = alignedEngines.map(e => e.engineId).join(', ');
        const fullJustification = `${justification} (المحركات: ${engineTags})`;

        if (this.currentMode === 'PAPER_TRADING') {
            // A. Paper Sandbox Execution
            await this.paperEngine.executePaperTrade({
                userId: user._id.toString(),
                symbol: fullSymbol,
                direction: finalDirection,
                entryPrice: dossier.currentPrice,
                stopLoss: finalStopLoss,
                targets: finalTargets,
                riskPercentage: 1.5,
                leverage: 10,
                engineId: primaryEngine,
                aiJustification: fullJustification
            });
        } else if (this.currentMode === 'SEMI_AUTO') {
            // B. Semi-Autonomous Confirmation Card (Interactive Telegram Button)
            const expireSec = 60;
            const dirEmoji = finalDirection === 'LONG' ? '🟢 LONG' : '🔴 SHORT';
            const cardMsg =
                `🚨 <b>إشارة تداول ذاتية معتمدة (تأكيد نصف تلقائي)</b>\n\n` +
                `🪙 العملة: <b>${shortSymbol}</b>\n` +
                `📊 الاتجاه: <b>${dirEmoji}</b>\n` +
                `💵 سعر الدخول المقترح: <code>${dossier.currentPrice}</code>\n` +
                `🛑 وقف الخسارة: <code>${finalStopLoss}</code>\n` +
                `🎯 الأهداف: <code>${finalTargets.join(' | ')}</code>\n` +
                `🧠 تبرير القرار: <i>${justification}</i>\n\n` +
                `⏳ <i>هذا الزر صالح لمدة ${expireSec} ثانية فقط قبل إلغاء الفرصة تلقائياً...</i>`;

            const inlineKeyboard = {
                inline_keyboard: [
                    [
                        {
                            text: `⚡ تنفيذ فوري (${shortSymbol} ${dirEmoji})`,
                            callback_data: `aut_exec_${shortSymbol}_${finalDirection === 'LONG' ? 'L' : 'S'}_${dossier.currentPrice}_${finalStopLoss}_${finalTargets[0]}`
                        },
                        { text: '❌ تجاهل', callback_data: 'aut_dismiss' }
                    ]
                ]
            };

            await this.notifier(user.telegramId, cardMsg, { reply_markup: inlineKeyboard });
        } else if (this.currentMode === 'FULL_AUTO') {
            // C. Fully Autonomous Live Order on BingX
            const signal = {
                type: 'TRADE' as const,
                symbol: fullSymbol,
                direction: finalDirection,
                entry: [dossier.currentPrice],
                stopLoss: finalStopLoss,
                targets: finalTargets,
                risk: 1.5,
                leverage: 10
            };

            const result = await this.tradeManager.executeSignal(signal, user._id.toString());
            if (result) {
                const autoMsg = `🤖✅ <b>تم تنفيذ صفقة تلقائية حية بنجاح!</b>\n` +
                    `🪙 العملة: <b>${shortSymbol}</b> (${result.direction})\n` +
                    `💵 الدخول: <code>${result.entryPrice}</code> | الستوب: <code>${result.stopLoss.price}</code>\n` +
                    `🎯 الهدف: <code>${result.targets.map(t => t.price).join(', ')}</code>\n` +
                    `💰 الهامش: <code>${result.margin.toFixed(2)} USDT</code>`;
                await this.notifier(user.telegramId, autoMsg);
            }
        }

        return { symbol: shortSymbol, score, direction: finalDirection, executed: true };
    }

    /**
     * Gets public paper trading engine instance
     */
    getPaperEngine(): PaperTradingEngine {
        return this.paperEngine;
    }
}
