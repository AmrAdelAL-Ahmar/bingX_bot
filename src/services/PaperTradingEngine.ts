import mongoose from 'mongoose';
import Trade, { ITrade } from '../models/Trade';
import User from '../models/User';
import logger from '../utils/logger';
import { BingXService } from './BingXService';

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
    private static DEFAULT_INITIAL_BALANCE = 1000; // 1,000 USDT
    public static MAKER_FEE_PCT = 0.02; // 0.02%
    public static TAKER_FEE_PCT = 0.05; // 0.05%
    public static SIMULATED_SLIPPAGE_PCT = 0.04; // 0.04%

    constructor(private bingx: BingXService) {}

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
        leverage?: number;
        engineId?: string;
        aiJustification?: string;
    }): Promise<ITrade> {
        const userObjectId = await this.resolveUserObjectId(params.userId);
        const stats = await this.getPerformanceStats(userObjectId ? userObjectId.toString() : undefined);
        const balance = stats.currentBalance > 0 ? stats.currentBalance : PaperTradingEngine.DEFAULT_INITIAL_BALANCE;

        const riskPct = params.riskPercentage || 1.5; // Default 1.5%
        const leverage = params.leverage || 10;

        // Position sizing based on distance to stop loss
        const riskAmountUSDT = balance * (riskPct / 100);
        const slDistPct = Math.abs(params.entryPrice - params.stopLoss) / params.entryPrice;
        const positionNotional = slDistPct > 0 ? Math.min(riskAmountUSDT / slDistPct, balance * 0.10 * leverage) : riskAmountUSDT * leverage;
        const marginUsed = positionNotional / leverage;

        // Apply entry slippage
        const slippageMultiplier = params.direction === 'LONG'
            ? (1 + PaperTradingEngine.SIMULATED_SLIPPAGE_PCT / 100)
            : (1 - PaperTradingEngine.SIMULATED_SLIPPAGE_PCT / 100);
        const actualEntryPrice = Number((params.entryPrice * slippageMultiplier).toFixed(6));

        // Deduct taker fee
        const entryFee = positionNotional * (PaperTradingEngine.TAKER_FEE_PCT / 100);

        const paperTrade = new Trade({
            userId: userObjectId,
            symbol: params.symbol,
            direction: params.direction,
            entryPrice: actualEntryPrice,
            stopLoss: params.stopLoss,
            targets: params.targets.map(t => ({ price: t, hit: false })),
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

                // 1. Check Stop Loss Hit
                const slHit = isLong ? (currentPrice <= trade.stopLoss) : (currentPrice >= trade.stopLoss);
                if (slHit) {
                    const exitFee = trade.amount * (PaperTradingEngine.TAKER_FEE_PCT / 100);
                    const diffPct = isLong ? (trade.stopLoss - entry) / entry : (entry - trade.stopLoss) / entry;
                    const lossAmount = (margin * diffPct * lev) - exitFee - (trade.commissionPaid || 0);
                    const pnlPct = (lossAmount / margin) * 100;

                    trade.currentStatus = 'CLOSED_LOSS';
                    trade.closeTime = new Date();
                    trade.exitPrice = currentPrice;
                    trade.pnl = pnlPct;
                    trade.realizedPnl = lossAmount;
                    trade.commissionPaid = (trade.commissionPaid || 0) + exitFee;
                    trade.logs.push(`[PaperTrading] SL hit at ${currentPrice}. Realized loss: $${lossAmount.toFixed(2)}`);
                    await trade.save();
                    logger.info(`[PaperTrading] ${trade.symbol} hit SL at ${currentPrice}. Closed.`);
                    continue;
                }

                // 2. Check Take Profit Hits
                if (trade.targets && trade.targets.length > 0) {
                    const tp1 = trade.targets[0].price;
                    const tp1Hit = isLong ? (currentPrice >= tp1) : (currentPrice <= tp1);

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
                    const finalHit = isLong ? (currentPrice >= lastTarget) : (currentPrice <= lastTarget);
                    if (finalHit) {
                        const exitFee = trade.amount * (PaperTradingEngine.MAKER_FEE_PCT / 100);
                        const diffPct = isLong ? (lastTarget - entry) / entry : (entry - lastTarget) / entry;
                        const profitAmount = (margin * diffPct * lev) - exitFee - (trade.commissionPaid || 0);
                        const pnlPct = (profitAmount / margin) * 100;

                        trade.currentStatus = 'CLOSED_PROFIT';
                        trade.closeTime = new Date();
                        trade.exitPrice = currentPrice;
                        trade.pnl = pnlPct;
                        trade.realizedPnl = profitAmount;
                        trade.commissionPaid = (trade.commissionPaid || 0) + exitFee;
                        trade.logs.push(`[PaperTrading] Final TP hit at ${currentPrice}! Realized profit: $${profitAmount.toFixed(2)}`);
                        await trade.save();
                        logger.info(`[PaperTrading] ${trade.symbol} closed with full profit at ${currentPrice}.`);
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
        if (userId) {
            const resolvedId = await this.resolveUserObjectId(userId);
            if (resolvedId) {
                query.userId = resolvedId;
            }
        }

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

        let runningBalance = PaperTradingEngine.DEFAULT_INITIAL_BALANCE;
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
        const netProfitPercent = Number(((netProfitUSDT / PaperTradingEngine.DEFAULT_INITIAL_BALANCE) * 100).toFixed(2));
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
            initialBalance: PaperTradingEngine.DEFAULT_INITIAL_BALANCE,
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
     * Resets the paper trading sandbox history and restores 1,000 USDT virtual balance
     */
    async resetAccount(userId?: string): Promise<void> {
        const query: any = { isPaperTrade: true };
        if (userId) query.userId = userId;
        await Trade.deleteMany(query);
        logger.info(`[PaperTradingEngine] Reset paper sandbox trades for user: ${userId || 'ALL'}`);
    }
}
