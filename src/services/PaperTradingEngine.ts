import mongoose from 'mongoose';
import Trade, { ITrade } from '../models/Trade';
import User from '../models/User';
import logger from '../utils/logger';
import { BingXService } from './BingXService';
import { TradingMemoryService } from './TradingMemoryService';

export interface PaperPerformanceStats {
    initialBalance: number;
    currentBalance: number;
    totalTrades: number;
    winningTrades: number;
    losingTrades: number;
    winRate: number; // %
    profitFactor: number;
    netProfitUSDT: number;
    netProfitPercent: number;
    maxDrawdownPct: number;
    sharpeRatio: number;
    totalCommissionPaid: number;
    openTradesCount: number;
}

export class PaperTradingEngine {
    public static initialBalance = 1000; // Default 1,000 USDT (Configurable and DB-persisted)
    public static MAKER_FEE_PCT = 0.02; // 0.02%
    public static TAKER_FEE_PCT = 0.05; // 0.05%
    public static SIMULATED_SLIPPAGE_PCT = 0.04; // 0.04%

    constructor(private bingx: BingXService) {}

    /**
     * Resolves the persisted paper starting capital from DB or cache
     */
    async getInitialBalance(userId?: string): Promise<number> {
        try {
            const userObjId = await this.resolveUserObjectId(userId);
            const user = userObjId ? await User.findById(userObjId) : (await User.findOne({ isActive: true }) || await User.findOne({}));
            if (user && user.paperInitialBalance && user.paperInitialBalance > 0) {
                PaperTradingEngine.initialBalance = user.paperInitialBalance;
                return user.paperInitialBalance;
            }
        } catch (e: any) {
            logger.warn(`[PaperTradingEngine] Error loading paper balance from DB: ${e.message}`);
        }
        return PaperTradingEngine.initialBalance || 1000;
    }

    /**
     * Gracefully resolves any userId string (Telegram ID or Mongo ObjectId string) to a valid ObjectId
     */
    private async resolveUserObjectId(userId?: string): Promise<mongoose.Types.ObjectId | null> {
        if (!userId) return null;
        if (mongoose.Types.ObjectId.isValid(userId) && /^[0-9a-fA-F]{24}$/.test(userId)) {
            return new mongoose.Types.ObjectId(userId);
        }
        try {
            const user = await User.findOne({ telegramId: userId.toString() });
            if (user) {
                return user._id as mongoose.Types.ObjectId;
            }
            const fallback = await User.findOne({ isActive: true }) || await User.findOne({});
            if (fallback) {
                return fallback._id as mongoose.Types.ObjectId;
            }
        } catch (e: any) {
            logger.warn(`[PaperTradingEngine] Error resolving user ObjectId for ${userId}: ${e.message}`);
        }
        return null;
    }

    /**
     * Executes a virtual trade in the sandbox environment
     */
    async executePaperTrade(params: {
        userId: string;
        symbol: string;
        direction: 'LONG' | 'SHORT';
        entryPrice: number;
        stopLoss: number;
        targets: number[];
        riskPercentage?: number;
        marginPercentage?: number;
        maxCapitalRiskPercentage?: number;
        leverage?: number;
        isTurboScalp?: boolean;
        engineId?: string;
        aiJustification?: string;
    }): Promise<ITrade> {
        // 0. Prevent duplicate concurrent trades on the exact same symbol
        const existingActive = await Trade.findOne({
            isPaperTrade: true,
            symbol: params.symbol,
            currentStatus: { $in: ['OPEN', 'TP1_HIT', 'TP2_HIT'] }
        });
        if (existingActive) {
            const warnMsg = `[PaperTradingEngine] 🛑 رفض فتح صفقة افتراضية لـ ${params.symbol}: توجد صفقة نشطة بالفعل لنفس العملة (ID: ${existingActive._id}).`;
            logger.warn(warnMsg);
            throw new Error(`توجد صفقة نشطة بالفعل لنفس العملة (${params.symbol})`);
        }

        const userObjectId = await this.resolveUserObjectId(params.userId);
        const stats = await this.getPerformanceStats(userObjectId ? userObjectId.toString() : undefined);
        const initialBal = await this.getInitialBalance(userObjectId ? userObjectId.toString() : undefined);
        const balance = stats.currentBalance > 0 ? stats.currentBalance : initialBal;

        const isTurbo = params.isTurboScalp || params.marginPercentage === 3;
        const leverage = params.leverage || (isTurbo ? 25 : 10);

        let positionNotional: number;
        let marginUsed: number;

        if (isTurbo || params.marginPercentage) {
            // Turbo Scalp: fixed margin (e.g. 3% of capital)
            const marginPct = params.marginPercentage || 3;
            marginUsed = balance * (marginPct / 100);
            positionNotional = marginUsed * leverage;
        } else {
            const riskPct = params.riskPercentage || 1.5; // Default 1.5%
            const riskAmountUSDT = balance * (riskPct / 100);
            const slDistPct = Math.abs(params.entryPrice - params.stopLoss) / params.entryPrice;
            positionNotional = slDistPct > 0 ? Math.min(riskAmountUSDT / slDistPct, balance * 0.10 * leverage) : riskAmountUSDT * leverage;
            marginUsed = positionNotional / leverage;
        }

        // Apply entry slippage
        const slippageMultiplier = params.direction === 'LONG'
            ? (1 + PaperTradingEngine.SIMULATED_SLIPPAGE_PCT / 100)
            : (1 - PaperTradingEngine.SIMULATED_SLIPPAGE_PCT / 100);
        const actualEntryPrice = Number((params.entryPrice * slippageMultiplier).toFixed(6));

        // Deduct taker fee
        const entryFee = positionNotional * (PaperTradingEngine.TAKER_FEE_PCT / 100);

        // Sanitize Stop Loss and Targets
        const isLong = params.direction === 'LONG';
        const defaultRiskPct = 0.015;
        let safeSL = params.stopLoss;

        if (isLong) {
            if (!safeSL || safeSL >= actualEntryPrice) {
                safeSL = Number((actualEntryPrice * (1 - defaultRiskPct)).toFixed(6));
            }
        } else {
            if (!safeSL || safeSL <= actualEntryPrice) {
                safeSL = Number((actualEntryPrice * (1 + defaultRiskPct)).toFixed(6));
            }
        }

        // Enforce strict Max Capital Loss limit (e.g. max 6% of total account balance)
        const maxCapitalRiskPct = params.maxCapitalRiskPercentage || (isTurbo ? 6 : 15);
        const maxAllowedLossUSDT = balance * (maxCapitalRiskPct / 100);
        const maxAllowedDistPct = positionNotional > 0 ? (maxAllowedLossUSDT / positionNotional) : 0.06;

        if (isLong) {
            const maxSlPrice = Number((actualEntryPrice * (1 - maxAllowedDistPct)).toFixed(6));
            if (safeSL < maxSlPrice) {
                safeSL = maxSlPrice; // Pull up SL so loss does not exceed 6% of capital
            }
            if (isTurbo) {
                const turboMinSl = Number((actualEntryPrice * (1 - 0.010)).toFixed(6));
                if (safeSL < turboMinSl) {
                    safeSL = turboMinSl; // Clamp turbo SL to max 1.0% loss
                }
            }
        } else {
            const maxSlPrice = Number((actualEntryPrice * (1 + maxAllowedDistPct)).toFixed(6));
            if (safeSL > maxSlPrice) {
                safeSL = maxSlPrice; // Pull down SL so loss does not exceed 6% of capital
            }
            if (isTurbo) {
                const turboMaxSl = Number((actualEntryPrice * (1 + 0.010)).toFixed(6));
                if (safeSL > turboMaxSl) {
                    safeSL = turboMaxSl; // Clamp turbo SL to max 1.0% loss
                }
            }
        }

        const riskDist = Math.abs(actualEntryPrice - safeSL);
        let safeTargets: number[] = [];

        if (params.targets && params.targets.length > 0) {
            if (isLong) {
                safeTargets = params.targets.filter(p => p > actualEntryPrice).sort((a, b) => a - b);
            } else {
                safeTargets = params.targets.filter(p => p < actualEntryPrice).sort((a, b) => b - a);
            }
        }

        if (safeTargets.length === 0) {
            safeTargets = isLong
                ? [
                    Number((actualEntryPrice + riskDist * 1.5).toFixed(6)),
                    Number((actualEntryPrice + riskDist * 2.5).toFixed(6)),
                    Number((actualEntryPrice + riskDist * 4.0).toFixed(6))
                ]
                : [
                    Number((actualEntryPrice - riskDist * 1.5).toFixed(6)),
                    Number((actualEntryPrice - riskDist * 2.5).toFixed(6)),
                    Number((actualEntryPrice - riskDist * 4.0).toFixed(6))
                ];
        }

        const paperTrade = new Trade({
            userId: userObjectId,
            symbol: params.symbol,
            direction: params.direction,
            entryPrice: actualEntryPrice,
            stopLoss: safeSL,
            targets: safeTargets.map(t => ({ price: t, hit: false })),
            currentStatus: 'OPEN',
            amount: positionNotional,
            leverage,
            pnl: 0,
            isBreakEvenSet: false,
            isPaperTrade: true,
            commissionPaid: entryFee,
            aiJustification: params.aiJustification,
            engineId: params.engineId || 'AUTONOMOUS_V2',
            entryTime: new Date(),
            logs: [
                `[PaperTrading] Opened ${params.direction} at ${actualEntryPrice} (Slippage: ${PaperTradingEngine.SIMULATED_SLIPPAGE_PCT}%, Fee: $${entryFee.toFixed(3)})`
            ]
        });

        await paperTrade.save();
        logger.info(`[PaperTrading] Simulated order placed for ${params.symbol} (${params.direction}) with size $${positionNotional.toFixed(2)}.`);
        return paperTrade;
    }

    /**
     * Updates and checks active paper positions against live market prices
     */
    async evaluateActivePositions(): Promise<void> {
        try {
            const activeTrades = await Trade.find({ isPaperTrade: true, currentStatus: { $in: ['OPEN', 'TP1_HIT', 'TP2_HIT'] } });
            if (activeTrades.length === 0) return;

            for (const trade of activeTrades) {
                const currentPrice = await this.bingx.getMarketPrice(trade.symbol);
                if (!currentPrice || currentPrice <= 0) continue;

                const isLong = trade.direction === 'LONG';
                const entry = trade.entryPrice;
                const lev = trade.leverage || 10;
                const margin = trade.amount / lev;

                const priceDiff = isLong ? (currentPrice - entry) : (entry - currentPrice);
                const currentMovePct = (priceDiff / entry) * 100;

                // ── Auto Break-Even Check ────────────────────────────────────
                // If price moved >= 0.35% towards target (or 60% of distance to TP1)
                // and break-even is not yet set, move SL to entry + 0.05% buffer (covers taker fee)
                if (!trade.isBreakEvenSet && trade.targets && trade.targets.length > 0) {
                    const tp1Price = trade.targets[0].price;
                    const totalTargetDist = Math.abs(tp1Price - entry);
                    const targetProgressRatio = totalTargetDist > 0 ? (priceDiff / totalTargetDist) : 0;

                    if (currentMovePct >= 0.35 || targetProgressRatio >= 0.60) {
                        const bePrice = isLong
                            ? Number((entry * 1.0005).toFixed(6))
                            : Number((entry * 0.9995).toFixed(6));
                        
                        const isBetter = isLong ? bePrice > trade.stopLoss : bePrice < trade.stopLoss;
                        if (isBetter) {
                            trade.stopLoss = bePrice;
                            trade.isBreakEvenSet = true;
                            trade.logs.push(`[PaperTrading] 🛡️ Auto Break-Even triggered at ${currentPrice} (+${currentMovePct.toFixed(2)}% | ${(targetProgressRatio * 100).toFixed(0)}% to TP)! SL secured at ${bePrice}`);
                            await trade.save();
                            logger.info(`[PaperTrading] 🛡️ ${trade.symbol} Auto Break-Even secured at ${bePrice} (+${currentMovePct.toFixed(2)}%)`);
                        }
                    }
                }

                // 1. Check Stop Loss Hit
                const slHit = isLong ? (currentPrice <= trade.stopLoss) : (currentPrice >= trade.stopLoss);
                if (slHit) {
                    const exitFee = trade.amount * (PaperTradingEngine.TAKER_FEE_PCT / 100);
                    const grossPnl = (priceDiff / entry) * trade.amount;
                    const netPnl = grossPnl - exitFee - (trade.commissionPaid || 0);
                    const pnlPct = (netPnl / margin) * 100;

                    trade.currentStatus = netPnl >= 0 ? 'CLOSED_PROFIT' : 'CLOSED_LOSS';
                    trade.closeTime = new Date();
                    trade.exitPrice = currentPrice;
                    trade.pnl = pnlPct;
                    trade.realizedPnl = netPnl;
                    trade.commissionPaid = (trade.commissionPaid || 0) + exitFee;
                    trade.logs.push(`[PaperTrading] SL hit at ${currentPrice}. Realized: $${netPnl.toFixed(2)} (${pnlPct.toFixed(2)}%)`);
                    await trade.save();
                    await TradingMemoryService.recordTradeResult(trade);
                    logger.info(`[PaperTrading] ${trade.symbol} hit SL at ${currentPrice}. Status: ${trade.currentStatus} (${netPnl.toFixed(2)} USDT)`);
                    continue;
                }

                // 2. Check Take Profit Hits
                if (trade.targets && trade.targets.length > 0) {
                    const tp1 = trade.targets[0].price;
                    const tp1Hit = isLong
                        ? (currentPrice >= tp1 && currentPrice > entry)
                        : (currentPrice <= tp1 && currentPrice < entry);

                    if (trade.targets.length === 1 && tp1Hit) {
                        const exitFee = trade.amount * (PaperTradingEngine.MAKER_FEE_PCT / 100);
                        const priceDiff = isLong ? (currentPrice - entry) : (entry - currentPrice);
                        const grossPnl = (priceDiff / entry) * trade.amount;
                        const netPnl = grossPnl - exitFee - (trade.commissionPaid || 0);
                        const pnlPct = (netPnl / margin) * 100;

                        trade.currentStatus = netPnl >= 0 ? 'CLOSED_PROFIT' : 'CLOSED_LOSS';
                        trade.closeTime = new Date();
                        trade.exitPrice = currentPrice;
                        trade.pnl = pnlPct;
                        trade.realizedPnl = netPnl;
                        trade.commissionPaid = (trade.commissionPaid || 0) + exitFee;
                        trade.targets[0].hit = true;
                        trade.logs.push(`[PaperTrading] Target 1 reached at ${currentPrice} (Single TP Mode)! Realized: $${netPnl.toFixed(2)} (${pnlPct.toFixed(2)}%)`);
                        await trade.save();
                        await TradingMemoryService.recordTradeResult(trade);
                        logger.info(`[PaperTrading] ${trade.symbol} closed with single TP at ${currentPrice}. Status: ${trade.currentStatus} (${netPnl.toFixed(2)} USDT)`);
                        continue;
                    }

                    if (tp1Hit && !trade.isBreakEvenSet) {
                        // Move SL to Entry (Break Even)
                        trade.stopLoss = entry;
                        trade.isBreakEvenSet = true;
                        trade.currentStatus = 'TP1_HIT';
                        trade.targets[0].hit = true;
                        trade.logs.push(`[PaperTrading] TP1 reached at ${currentPrice}! SL moved to Break-Even (${entry})`);
                        await trade.save();
                        logger.info(`[PaperTrading] ${trade.symbol} reached TP1! Moved SL to Break-Even.`);
                    }

                    // Check Final Target (Full Profit)
                    const lastTarget = trade.targets[trade.targets.length - 1].price;
                    const finalHit = isLong
                        ? (currentPrice >= lastTarget && currentPrice > entry)
                        : (currentPrice <= lastTarget && currentPrice < entry);

                    if (finalHit) {
                        const exitFee = trade.amount * (PaperTradingEngine.MAKER_FEE_PCT / 100);
                        const priceDiff = isLong ? (currentPrice - entry) : (entry - currentPrice);
                        const grossPnl = (priceDiff / entry) * trade.amount;
                        const netPnl = grossPnl - exitFee - (trade.commissionPaid || 0);
                        const pnlPct = (netPnl / margin) * 100;

                        trade.currentStatus = netPnl >= 0 ? 'CLOSED_PROFIT' : 'CLOSED_LOSS';
                        trade.closeTime = new Date();
                        trade.exitPrice = currentPrice;
                        trade.pnl = pnlPct;
                        trade.realizedPnl = netPnl;
                        trade.commissionPaid = (trade.commissionPaid || 0) + exitFee;
                        trade.targets.forEach(t => t.hit = true);
                        trade.logs.push(`[PaperTrading] Final TP hit at ${currentPrice}! Realized: $${netPnl.toFixed(2)} (${pnlPct.toFixed(2)}%)`);
                        await trade.save();
                        await TradingMemoryService.recordTradeResult(trade);
                        logger.info(`[PaperTrading] ${trade.symbol} closed with Final TP at ${currentPrice}. Status: ${trade.currentStatus} (${netPnl.toFixed(2)} USDT)`);
                    }
                }
            }
        } catch (e: any) {
            if (e.message && (e.message.includes('ENOTFOUND') || e.message.includes('topology'))) {
                return; // Gracefully wait for internet connection restoration
            }
            logger.error(`[PaperTrading] evaluateActivePositions error: ${e.message}`);
        }
    }

    /**
     * Calculates comprehensive performance metrics (Win Rate, Profit Factor, Sharpe, Max DD)
     */
    async getPerformanceStats(userId?: string): Promise<PaperPerformanceStats> {
        const query: any = { isPaperTrade: true };
        let resolvedId: mongoose.Types.ObjectId | null = null;
        if (userId) {
            resolvedId = await this.resolveUserObjectId(userId);
            if (resolvedId) {
                query.userId = resolvedId;
            }
        }

        const initialBalance = await this.getInitialBalance(resolvedId ? resolvedId.toString() : userId);

        const closedTrades = await Trade.find({
            ...query,
            currentStatus: { $in: ['CLOSED_PROFIT', 'CLOSED_LOSS'] }
        });

        const openTradesCount = await Trade.countDocuments({
            ...query,
            currentStatus: { $in: ['OPEN', 'TP1_HIT', 'TP2_HIT'] }
        });

        let grossProfit = 0;
        let grossLoss = 0;
        let totalCommission = 0;
        let wins = 0;
        let losses = 0;
        const returns: number[] = [];

        let runningBalance = initialBalance;
        let peakBalance = runningBalance;
        let maxDrawdownUSDT = 0;

        for (const t of closedTrades) {
            const realized = t.realizedPnl !== undefined ? t.realizedPnl : 0;
            totalCommission += t.commissionPaid || 0;

            if (realized > 0) {
                grossProfit += realized;
                wins++;
            } else {
                grossLoss += Math.abs(realized);
                losses++;
            }

            returns.push(realized);
            runningBalance += realized;

            if (runningBalance > peakBalance) peakBalance = runningBalance;
            const dd = peakBalance - runningBalance;
            if (dd > maxDrawdownUSDT) maxDrawdownUSDT = dd;
        }

        const totalTrades = wins + losses;
        const winRate = totalTrades > 0 ? Number(((wins / totalTrades) * 100).toFixed(1)) : 0;
        const profitFactor = grossLoss > 0 ? Number((grossProfit / grossLoss).toFixed(2)) : (grossProfit > 0 ? 99 : 0);
        const netProfitUSDT = Number((grossProfit - grossLoss).toFixed(2));
        const netProfitPercent = Number(((netProfitUSDT / initialBalance) * 100).toFixed(2));
        const maxDrawdownPct = peakBalance > 0 ? Number(((maxDrawdownUSDT / peakBalance) * 100).toFixed(2)) : 0;

        // Sharpe Ratio Calculation (assumed risk-free rate = 0)
        let sharpeRatio = 0;
        if (returns.length > 3) {
            const meanReturn = returns.reduce((a, b) => a + b, 0) / returns.length;
            const variance = returns.reduce((sum, r) => sum + Math.pow(r - meanReturn, 2), 0) / returns.length;
            const stdDev = Math.sqrt(variance);
            if (stdDev > 0) {
                sharpeRatio = Number(((meanReturn / stdDev) * Math.sqrt(365)).toFixed(2));
            }
        }

        return {
            initialBalance,
            currentBalance: Number(runningBalance.toFixed(2)),
            totalTrades,
            winningTrades: wins,
            losingTrades: losses,
            winRate,
            profitFactor,
            netProfitUSDT,
            netProfitPercent,
            maxDrawdownPct,
            sharpeRatio,
            totalCommissionPaid: Number(totalCommission.toFixed(2)),
            openTradesCount
        };
    }

    /**
     * Resets the paper trading sandbox history and restores virtual balance
     */
    async resetAccount(userId?: string, newBalance?: number): Promise<void> {
        if (newBalance && newBalance > 0) {
            PaperTradingEngine.initialBalance = newBalance;
            try {
                const userObjId = await this.resolveUserObjectId(userId);
                if (userObjId) {
                    await User.findByIdAndUpdate(userObjId, { paperInitialBalance: newBalance });
                } else {
                    await User.updateMany({}, { paperInitialBalance: newBalance });
                }
                logger.info(`[PaperTradingEngine] Persisted initial balance of $${newBalance} USDT to MongoDB.`);
            } catch (e: any) {
                logger.warn(`[PaperTradingEngine] Failed to persist paper initial balance: ${e.message}`);
            }
        }
        const query: any = { isPaperTrade: true };
        if (userId) query.userId = userId;
        await Trade.deleteMany(query);
        logger.info(`[PaperTradingEngine] Reset paper sandbox trades for user: ${userId || 'ALL'}. Starting capital set to: ${PaperTradingEngine.initialBalance} USDT`);
    }
}

