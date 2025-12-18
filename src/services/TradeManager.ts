import { BingXService } from './BingXService';
import { ParsedSignal } from './SignalParser';
import Trade, { ITrade } from '../models/Trade';
import User from '../models/User';
import logger from '../utils/logger';

export class TradeManager {
    private bingX: BingXService;

    constructor(bingXService: BingXService) {
        this.bingX = bingXService;
    }

    async executeSignal(signal: ParsedSignal, userId: string) {
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
                // Logic to close existing position
                try {
                    // Fetch open position to see if we have one and what side it is
                    const positions = await this.bingX.getPositions(signal.symbol);
                    if (positions.length === 0) {
                        logger.info(`No open positions found for ${signal.symbol} to close.`);
                        return;
                    }

                    for (const pos of positions) {
                        const side = pos.side.toLowerCase() === 'long' ? 'sell' : 'buy';
                        const amount = pos.contracts;
                        await this.bingX.placeOrder(
                            signal.symbol,
                            'market',
                            side,
                            amount,
                            undefined,
                            { positionSide: pos.side.toUpperCase() }
                        );
                        logger.info(`✅ Successfully closed ${pos.side} position for ${signal.symbol}`);
                    }
                } catch (error) {
                    logger.error(`Error closing position for ${signal.symbol}:`, error);
                }
                return;
            }

            // --- Standard Trade Execution ---
            if (signal.type === 'TRADE') {
                if (!signal.entry || !signal.targets || !signal.stopLoss || !signal.direction) {
                    logger.error('Missing required trade components', { signal });
                    return;
                }

                const entryPrice = signal.entry[0];
                const stopLossPrice = await this.bingX.priceToPrecision(signal.symbol, signal.stopLoss);
                const takeProfitPrice = await this.bingX.priceToPrecision(signal.symbol, signal.targets[0]);

                // 2. Position Sizing
                const riskPercentage = signal.risk || user.riskPercentage || 2;
                const leverage = signal.leverage || 10;

                // Position size in USDT = Balance * (Risk %) * Leverage
                const positionSizeUSDT = (balance * (riskPercentage / 100)) * leverage;
                logger.info(`Trade Setup: Symbol=${signal.symbol}, Risk=${riskPercentage}%, Lev=${leverage}, PosSize=${positionSizeUSDT.toFixed(2)} USDT`);

                // 3. Set Leverage
                await this.bingX.setLeverage(signal.symbol, leverage, signal.direction);

                // 4. Calculate Contracts
                const rawAmount = positionSizeUSDT / entryPrice;
                const amountContracts = await this.bingX.amountToPrecision(signal.symbol, rawAmount);

                if (amountContracts <= 0) {
                    logger.error(`Calculated amount ${amountContracts} is too small for ${signal.symbol}`);
                    throw new Error(`Trade size is too small for ${signal.symbol}. Check your balance or risk settings.`);
                }

                logger.info(`Placing Order: ${amountContracts} contracts at Market`);

                // 5. Place Market Order
                const order = await this.bingX.placeOrder(
                    signal.symbol,
                    'market',
                    signal.direction === 'LONG' ? 'buy' : 'sell',
                    amountContracts,
                    undefined,
                    {
                        positionSide: signal.direction,
                        stopLoss: stopLossPrice,
                        takeProfit: takeProfitPrice
                    }
                );

                // 5. Save to DB
                const trade = new Trade({
                    userId: user._id,
                    symbol: signal.symbol,
                    direction: signal.direction,
                    entryPrice: order.average || entryPrice,
                    stopLoss: signal.stopLoss,
                    targets: signal.targets.map(t => ({ price: t, hit: false })),
                    amount: positionSizeUSDT,
                    bingxOrderId: order.id,
                    currentStatus: 'OPEN',
                    logs: [`Opened trade at ${new Date().toISOString()} via Signal. Risk: ${riskPercentage}%, Lev: ${leverage}x`]
                });
                await trade.save();

                logger.info(`✅ Trade successfully executed for ${signal.symbol}: ${order.id}`);
                return trade;
            }

        } catch (error) {
            logger.error('Error executing trade:', error);
            throw error;
        }
    }
}
