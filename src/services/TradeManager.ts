import { BingXService } from './BingXService';
import { ParsedSignal } from './SignalParser';
import Trade, { ITrade } from '../models/Trade';
import User from '../models/User';
import logger from '../utils/logger';

// Define return interface
export interface TradeResult {
    tradeId: string;
    symbol: string;
    direction: 'LONG' | 'SHORT';
    entryPrice: number;
    amount: number; // Quantity in coins
    margin: number; // USDT used
    leverage: number;
    riskPercentage: number;
    targets: { price: number; pnlPercent: number }[];
    stopLoss: { price: number; pnlPercent: number };
}

export class TradeManager {
    private bingX: BingXService;

    constructor(bingXService: BingXService) {
        this.bingX = bingXService;
    }

    async executeSignal(signal: ParsedSignal, userId: string): Promise<TradeResult | undefined> {
        try {
            const user = await User.findById(userId);
            if (!user || !user.isActive) {
                logger.warn(`User ${userId} not found or inactive`);
                return;
            }

            // 1. Calculate Position Size
            const balance = await this.bingX.getBalance();
            logger.info(`Available Balance: ${balance} USDT`);

            if (!balance || balance <= 0) {
                logger.error(`Cannot trade: Wallet balance is ${balance}`);
                throw new Error('Insufficient USDT Balance in Futures Wallet. Please ensure you have funds in your Perpetual Futures account.');
            }

            if (signal.type === 'CLOSE') {
                logger.info(`Processing CLOSE signal for ${signal.symbol}`);
                await this.closeSpecificPosition(userId, signal.symbol);
                return; // CLOSE signals don't return a TradeResult for now
            }

            // --- Standard Trade Execution ---
            if (signal.type === 'TRADE') {
                if (!signal.targets || !signal.stopLoss || !signal.direction) {
                    logger.error('Missing required trade components', { signal });
                    return;
                }

                let entryPrice: number;
                if (signal.entry && signal.entry.length > 0) {
                    entryPrice = signal.entry[0];
                } else {
                    logger.info(`No entry price provided for ${signal.symbol}. Fetching current market price...`);
                    entryPrice = await this.bingX.getMarketPrice(signal.symbol);
                    logger.info(`Fetched Market Price for ${signal.symbol}: ${entryPrice}`);
                }
                const stopLossPrice = await this.bingX.priceToPrecision(signal.symbol, signal.stopLoss);
                const takeProfitPrices = await Promise.all(signal.targets.map(t => this.bingX.priceToPrecision(signal.symbol, t)));

                // 2. Position Sizing & Risk Caps
                let riskPercentage = signal.risk || user.riskPercentage || 2;
                if (riskPercentage > 5) {
                    logger.warn(`Requested risk ${riskPercentage}% exceeds single trade limit of 5%. Capping at 5%.`);
                    riskPercentage = 5;
                }

                const leverage = signal.leverage || 10;
                let marginUsed = balance * (riskPercentage / 100);

                // 2.5 Total Exposure Limit check (Max 10%)
                const positions = await this.bingX.getPositions();
                let totalMarginUsed = 0;
                for (const pos of positions) {
                    const posMargin = pos.initialMargin || (pos.notional ? Math.abs(pos.notional) / (pos.leverage || 1) : 0);
                    totalMarginUsed += posMargin;
                }

                const maxAllowedExposure = balance * 0.10; // 10% max global risk
                const availableMarginForNewTrade = maxAllowedExposure - totalMarginUsed;

                if (availableMarginForNewTrade <= 0) {
                    const msg = `Trade rejected: Current total margin (${totalMarginUsed.toFixed(2)} USDT) has already reached or exceeded the 10% global exposure limit (${maxAllowedExposure.toFixed(2)} USDT).`;
                    logger.error(msg);
                    throw new Error(msg);
                }

                let scaledByExposure = false;
                if (marginUsed > availableMarginForNewTrade) {
                    logger.warn(`Requested margin (${marginUsed.toFixed(2)} USDT) exceeds the available remaining global limit. Scaling down to the remaining margin: ${availableMarginForNewTrade.toFixed(2)} USDT.`);
                    marginUsed = availableMarginForNewTrade;
                    scaledByExposure = true;
                }

                let positionSizeUSDT = marginUsed * leverage;

                // Calculate Contracts first to check sizes

                const rawAmount = positionSizeUSDT / entryPrice;
                let amountContracts = await this.bingX.amountToPrecision(signal.symbol, rawAmount);
                const minAmount = await this.bingX.getMarketMinAmount(signal.symbol);

                // Check min constraints immediately before SL check
                if (amountContracts === 0 || amountContracts < minAmount) {
                    let reason = `حجم الصفقة المطلوبة أصغر من الحد الأدنى المسموح به في المنصة (${minAmount}).`;
                    if (scaledByExposure) {
                        reason += `\n⚠️ تم تقليل الحجم إجبارياً بسبب وصولك للحد الأقصى للمخاطرة الكلية المفتوحة (10% من الحساب). لديك صفقات أخرى تستهلك الرصيد المسموح.`;
                    } else {
                        reason += `\nيرجى زيادة رأس المال أو رفع نسبة المخاطرة قليلاً لتتمكن من فتح صفقات بهذه العملة.`;
                    }
                    throw new Error(reason);
                }

                let scaledBySL = false;
                // 4.5 Maximum Stop Loss Capital Risk Limit Check (Max 6% Loss)
                const shouldEnforceMaxSlLoss = user.enforceMaxSlLoss !== null && user.enforceMaxSlLoss !== undefined
                    ? user.enforceMaxSlLoss
                    : process.env.ENFORCE_MAX_SL_LOSS === 'true';

                if (shouldEnforceMaxSlLoss) {
                    // Maximum amount of money we are willing to lose completely if SL is hit
                    const maxAllowedSLLoss = balance * 0.06;

                    // Calculate the literal price difference per coin
                    const lossPerCoin = Math.abs(entryPrice - stopLossPrice);

                    // If direction is long and SL is above entry (or short and SL below entry), it's not a loss, it's weird data, but we use Math.abs to be safe.
                    // The total USDT lost equals the number of coins * price delta per coin
                    const projectedLoss = amountContracts * lossPerCoin;

                    if (projectedLoss > maxAllowedSLLoss) {
                        // How many max coins can we afford to lose?
                        const maxSafeContracts = maxAllowedSLLoss / lossPerCoin;
                        const precisionSafeContracts = await this.bingX.amountToPrecision(signal.symbol, maxSafeContracts);

                        logger.warn(`Projected SL loss (${projectedLoss.toFixed(2)} USDT) exceeds 6% of capital (${maxAllowedSLLoss.toFixed(2)} USDT). Scaling down position to ${precisionSafeContracts} contracts.`);

                        amountContracts = precisionSafeContracts;

                        // We must also scale down the officially reserved margin needed to open this smaller trade, so the DB and API stays perfectly synced.
                        positionSizeUSDT = amountContracts * entryPrice;
                        marginUsed = positionSizeUSDT / leverage;
                        scaledBySL = true;
                    }
                }

                if (amountContracts === 0 || amountContracts < minAmount) {
                    let reason = `حجم الصفقة المطلوبة أصغر من الحد الأدنى المسموح به في المنصة (${minAmount}).`;
                    if (scaledBySL) {
                        reason += `\n⚠️ تم تقليل الحجم إجبارياً لأن الخسارة المتوقعة من الاستوب لوز كانت ستتجاوز الحد الأقصى المسموح (6% من رصيد الحساب).`;
                    }
                    throw new Error(reason);
                }

                // 5. Set Leverage, Margin Mode, and Place Market Order
                await this.bingX.setMarginMode(signal.symbol, signal.marginMode || 'CROSS');
                await this.bingX.setLeverage(signal.symbol, leverage, signal.direction);

                let order: any;
                try {
                    order = await this.bingX.placeOrder(
                        signal.symbol,
                        'market',
                        signal.direction === 'LONG' ? 'buy' : 'sell',
                        amountContracts,
                        undefined,
                        {
                            positionSide: signal.direction,
                            stopLoss: stopLossPrice,
                            takeProfit: takeProfitPrices[0]
                        }
                    );
                } catch (err: any) {
                    // Retry with 50% size if Insufficient Margin
                    if (err.message && err.message.includes('Insufficient margin')) {
                        logger.warn(`Insufficient margin for full size. Retrying with 50% size...`);
                        const reducedAmount = amountContracts * 0.5;
                        order = await this.bingX.placeOrder(
                            signal.symbol,
                            'market',
                            signal.direction === 'LONG' ? 'buy' : 'sell',
                            reducedAmount,
                            undefined,
                            {
                                positionSide: signal.direction,
                                stopLoss: stopLossPrice,
                                takeProfit: takeProfitPrices[0]
                            }
                        );
                    } else {
                        throw err;
                    }
                }

                // 6. Save to DB
                const trade = new Trade({
                    userId: user._id,
                    symbol: signal.symbol,
                    direction: signal.direction,
                    entryPrice: order.average || entryPrice,
                    stopLoss: signal.stopLoss,
                    targets: signal.targets.map(t => ({ price: t, hit: false })),
                    amount: positionSizeUSDT,
                    leverage: leverage,
                    bingxOrderId: order.id,
                    currentStatus: 'OPEN',
                    logs: [`Opened trade at ${new Date().toISOString()} via Signal. Risk: ${riskPercentage}%, Lev: ${leverage}x`]
                });
                await trade.save();

                logger.info(`✅ Trade successfully executed for ${signal.symbol}: ${order.id}`);

                // 7. Calculate PnL stats for reporting
                const calculatePnL = (entry: number, exit: number, direction: string, lev: number) => {
                    const diff = direction === 'LONG' ? (exit - entry) : (entry - exit);
                    return (diff / entry) * 100 * lev;
                };

                const targetsResult = signal.targets.map(t => ({
                    price: t,
                    pnlPercent: parseFloat(calculatePnL(entryPrice, t, signal.direction!, leverage).toFixed(2))
                }));

                const slResult = {
                    price: signal.stopLoss,
                    pnlPercent: parseFloat(calculatePnL(entryPrice, signal.stopLoss, signal.direction!, leverage).toFixed(2))
                };

                return {
                    tradeId: trade._id.toString(),
                    symbol: signal.symbol,
                    direction: signal.direction!,
                    entryPrice: order.average || entryPrice,
                    amount: amountContracts,
                    margin: parseFloat(marginUsed.toFixed(2)),
                    leverage,
                    riskPercentage,
                    targets: targetsResult,
                    stopLoss: slResult
                };
            }

        } catch (error) {
            logger.error('Error executing trade:', error);
            throw error;
        }
    }

    async closeAllPositions(userId: string): Promise<number> {
        let closedCount = 0;
        try {
            const user = await User.findById(userId);
            if (!user) throw new Error('User not found');

            const positions = await this.bingX.getPositions();
            if (!positions || positions.length === 0) {
                return 0; // No positions to close
            }

            for (const pos of positions) {
                if (parseFloat(pos.contracts) === 0) continue;

                try {
                    const side = pos.side.toLowerCase() === 'long' ? 'sell' : 'buy';
                    await this.bingX.placeOrder(
                        pos.symbol,
                        'market',
                        side,
                        parseFloat(pos.contracts),
                        undefined,
                        { positionSide: pos.side.toUpperCase() }
                    );
                    logger.info(`✅ Successfully closed ${pos.side} position for ${pos.symbol} via 'Close All'`);
                    closedCount++;

                    // Optimistically update the database
                    await Trade.updateMany(
                        { userId: user._id, symbol: pos.symbol, currentStatus: 'OPEN' },
                        { currentStatus: 'CLOSED_MANUAL', closeTime: new Date() } // We'll use CLOSED_MANUAL
                    );

                } catch (err: any) {
                    logger.error(`Failed to close position ${pos.symbol}: ${err.message}`);
                }
            }
        } catch (error: any) {
            logger.error('Error in closeAllPositions:', error);
            throw error;
        }
        return closedCount;
    }

    async closeSpecificPosition(userId: string, symbol: string): Promise<boolean> {
        try {
            const user = await User.findById(userId);
            if (!user) throw new Error('User not found');

            const matchedSymbol = symbol.includes('USDT') ? symbol.toUpperCase() : `${symbol.toUpperCase()}/USDT:USDT`;
            const positions = await this.bingX.getPositions(matchedSymbol);

            // Filter out empty
            const activePos = positions.filter((p: any) => parseFloat(p.contracts) > 0);

            if (activePos.length === 0) {
                logger.info(`No open positions found for ${matchedSymbol} to close.`);
                return false;
            }

            for (const pos of activePos) {
                const side = pos.side.toLowerCase() === 'long' ? 'sell' : 'buy';
                const amount = parseFloat(pos.contracts);
                await this.bingX.placeOrder(
                    pos.symbol,
                    'market',
                    side,
                    amount,
                    undefined,
                    { positionSide: pos.side.toUpperCase() }
                );
                logger.info(`✅ Successfully closed ${pos.side} position for ${pos.symbol} via 'Close Specific'`);

                // Optimistically update DB
                await Trade.updateMany(
                    { userId: user._id, symbol: pos.symbol, currentStatus: 'OPEN' },
                    { currentStatus: 'CLOSED_MANUAL', closeTime: new Date() }
                );
            }
            return true;
        } catch (error: any) {
            logger.error(`Error closing position for ${symbol}:`, error);
            throw error;
        }
    }
}
