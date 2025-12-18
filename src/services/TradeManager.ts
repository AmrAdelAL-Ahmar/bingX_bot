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

            if (!balance || balance <= 0) {
                logger.error(`Cannot trade: Wallet balance is ${balance}`);
                throw new Error('Insufficient USDT Balance in Futures Wallet');
            }

            // Use signal risk if provided, otherwise user default
            const riskPercentage = signal.risk || user.riskPercentage;
            const riskAmount = balance * (riskPercentage / 100);

            // Stop Loss % distance from entry
            const entryPrice = signal.entry[0];
            const slDistance = Math.abs(entryPrice - signal.stopLoss);
            const slPercent = slDistance / entryPrice;

            if (slPercent === 0) {
                throw new Error('Invalid SL: Stop Loss cannot be same as Entry');
            }

            // Position Amount in USDT = Risk Amount / (SL Percent)
            let positionSizeUSDT = riskAmount / slPercent;

            // 2. Validate Leverage
            // Use signal leverage if provided, otherwise calculate
            let leverage = signal.leverage;
            if (!leverage) {
                const calculatedLeverage = Math.ceil(positionSizeUSDT / balance);
                leverage = Math.min(isNaN(calculatedLeverage) ? 1 : calculatedLeverage, 20);
            }

            logger.info(`Trade Setup: Symbol=${signal.symbol}, Risk=${riskPercentage}%, Lev=${leverage}x, PosSize=${positionSizeUSDT.toFixed(2)} USDT`);

            // Apply Leverage
            await this.bingX.setLeverage(signal.symbol, leverage, signal.direction);

            // 3. Prepare Order Parameters with Precision
            const amountContracts = await this.bingX.amountToPrecision(signal.symbol, positionSizeUSDT / entryPrice);
            const stopLossPrice = await this.bingX.priceToPrecision(signal.symbol, signal.stopLoss);
            const takeProfitPrice = await this.bingX.priceToPrecision(signal.symbol, signal.targets[0]);

            logger.info(`Placing Order: ${amountContracts} contracts at Market`);

            // 4. Place Market Order
            const order = await this.bingX.placeOrder(
                signal.symbol,
                'market',
                signal.direction === 'LONG' ? 'buy' : 'sell',
                amountContracts,
                undefined,
                {
                    // BingX Hedge mode requires positionSide
                    positionSide: signal.direction,
                    // BingX V2 Raw API fields for SL/TP in a single call (Must be numbers)
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

        } catch (error) {
            logger.error('Error executing trade:', error);
            throw error;
        }
    }
}
