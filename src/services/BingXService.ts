
import ccxt from 'ccxt';
import logger from '../utils/logger';

export class BingXService {
    private exchange: any; // Using any to avoid specific version type mismatches for now

    constructor(apiKey?: string, secretKey?: string) {
        // @ts-ignore
        this.exchange = new ccxt.bingx({
            apiKey: apiKey,
            secret: secretKey,
            options: {
                defaultType: 'swap', // 'swap' for futures/perpetuals
                adjustForTimeDifference: true,
            },
            enableRateLimit: true,
        });
        this.exchange.loadMarkets().catch((err: any) => logger.error('Failed to load markets:', err));
    }

    async setLeverage(symbol: string, leverage: number, side: 'LONG' | 'SHORT' = 'LONG') {
        const cleanSide = side.toUpperCase();
        const cleanLeverage = Math.floor(leverage); // Ensure integer

        try {
            await this.exchange.loadMarkets(); // Ensure markets are loaded for precision
            logger.info(`Attempting to set leverage: ${cleanLeverage}x for ${symbol} side=${cleanSide}`);
            await this.exchange.setLeverage(cleanLeverage, symbol, { side: cleanSide });
            logger.info(`✅ Leverage set to ${cleanLeverage}x for ${symbol} (${cleanSide})`);
        } catch (error: any) {
            logger.error(`❌ Failed to set leverage for ${symbol} ${cleanSide}: ${error.message}`);
            // No retry here, let TradeManager handle logic if needed
            throw error;
        }
    }

    async setMarginMode(symbol: string, mode: 'CROSS' | 'ISOLATED') {
        try {
            await this.exchange.loadMarkets();
            const marginMode = mode.toUpperCase();
            logger.info(`Attempting to set margin mode: ${marginMode} for ${symbol}`);
            // BingX specific params might be needed, but ccxt unified usually handles it
            await this.exchange.setMarginMode(marginMode, symbol);
            logger.info(`✅ Margin mode set to ${marginMode} for ${symbol}`);
        } catch (error: any) {
            logger.error(`❌ Failed to set margin mode for ${symbol}: ${error.message}`);
            // Don't throw fatal error, just log. Some pairs might process differently.
        }
    }

    async priceToPrecision(symbol: string, price: number) {
        await this.exchange.loadMarkets();
        return parseFloat(this.exchange.priceToPrecision(symbol, price));
    }

    async amountToPrecision(symbol: string, amount: number) {
        await this.exchange.loadMarkets();
        try {
            return parseFloat(this.exchange.amountToPrecision(symbol, amount));
        } catch (error: any) {
            logger.error(`❌ (amountToPrecision) Failed to set margin mode for ${symbol}: ${error.message}`);
            // If the amount is too small, CCXT throws an error instead of returning 0
            if (error.message && error.message.includes('minimum amount precision')) {
                return 0;
            }
            throw error;
        }
    }

    async getMarketMinAmount(symbol: string) {
        await this.exchange.loadMarkets();
        const market = this.exchange.market(symbol);
        return market?.limits?.amount?.min || 0;
    }

    async getBalance() {
        try {
            const balance = await this.exchange.fetchBalance({ type: 'swap' });
            // Strictly use 'free' (available) balance. Default to 0 if undefined.
            // Do NOT fallback to 'total' because 'free' might be 0 (falsy) but valid.
            return balance.free['USDT'] !== undefined ? balance.free['USDT'] : 0;
        } catch (error) {
            logger.error('Error fetching balance:', error);
            throw error;
        }
    }

    async getTotalEquity() {
        try {
            const balance = await this.exchange.fetchBalance({ type: 'swap' });
            return balance.total['USDT'] !== undefined ? balance.total['USDT'] : (balance.free['USDT'] || 0);
        } catch (error) {
            logger.error('Error fetching total equity:', error);
            return 0;
        }
    }

    async getMarketPrice(symbol: string) {
        try {
            const ticker = await this.exchange.fetchTicker(symbol);
            return ticker.last;
        } catch (error) {
            logger.error(`Error fetching price for ${symbol}: `, error);
            throw error;
        }
    }

    async fetchOHLCV(symbol: string, timeframe: string, limit: number = 100) {
        try {
            await this.exchange.loadMarkets();
            const ohlcv = await this.exchange.fetchOHLCV(symbol, timeframe, undefined, limit);
            return ohlcv.map((candle: any) => ({
                timestamp: candle[0],
                open: candle[1],
                high: candle[2],
                low: candle[3],
                close: candle[4],
                volume: candle[5]
            }));
        } catch (error) {
            logger.error(`Error fetching OHLCV for ${symbol} (${timeframe}): `, error);
            throw error;
        }
    }

    /*
     * Place an order
     * @param symbol e.g., 'BTC/USDT:USDT'
     * @param type 'market' or 'limit'
     * @param side 'buy' or 'sell'
     * @param amount quantity in contracts or base currency
     * @param price limit price (optional)
     * @param params params for SL/TP
     */
    async placeOrder(symbol: string, type: 'market' | 'limit', side: 'buy' | 'sell', amount: number, price?: number, params: any = {}) {
        try {
            logger.info(`Placing Order: ${symbol} ${side} ${amount} with params: ${JSON.stringify(params)}`);
            const order = await this.exchange.createOrder(symbol, type, side, amount, price, params);
            logger.info(`Order placed: ${order.id} for ${symbol} ${side} ${amount} `);
            return order;
        } catch (error) {
            logger.error(`Error placing order for ${symbol}: `, error);
            throw error;
        }
    }

    async getPositions(symbol?: string) {
        try {
            await this.exchange.loadMarkets();
            const symbols = symbol ? [symbol] : undefined;
            const positions = await this.exchange.fetchPositions(symbols);
            return positions;
        } catch (error) {
            logger.error(`Error fetching positions for ${symbol || 'all'}: `, error);
            throw error;
        }
    }

    async getOrder(symbol: string, orderId: string) {
        try {
            return await this.exchange.fetchOrder(orderId, symbol);
        } catch (error) {
            logger.error(`Error fetching order ${orderId}:`, error);
            // Don't throw, return null to handle gracefully in monitor
            return null;
        }
    }

    async setStopLoss(symbol: string, stopPrice: number, side: 'LONG' | 'SHORT') {
        try {
            await this.exchange.loadMarkets();
            const orderSide = side === 'LONG' ? 'sell' : 'buy';
            const params = {
                stopPrice: stopPrice,
                positionSide: side,
                type: 'STOP'
            };
            return await this.exchange.createOrder(symbol, 'STOP', orderSide, 0, undefined, params);
        } catch (error) {
            logger.error(`Error setting stop loss for ${symbol}: `, error);
            throw error;
        }
    }

    async isHedgeMode(): Promise<boolean> {
        // BingX Futures accounts are usually in Hedge Mode by default.
        return true;
    }

    async placeSLTPOrders(
        symbol: string,
        direction: 'LONG' | 'SHORT',
        amount: number,
        stopLossPrice: number,
        takeProfitPrices: number[],
        hedgeMode: boolean,
        tpProfitSplits?: number[]
    ) {
        const closeSide = direction === 'LONG' ? 'sell' : 'buy';

        // --- Stop Loss Order ---
        try {
            const slParams: any = { stopPrice: stopLossPrice, type: 'STOP' };
            if (hedgeMode) {
                slParams.positionSide = direction;
            } else {
                slParams.reduceOnly = true;
            }
            await this.exchange.createOrder(symbol, 'STOP', closeSide, amount, undefined, slParams);
            logger.info(`✅ Stop Loss order placed at ${stopLossPrice.toFixed(6)} for ${symbol}`);
        } catch (err: any) {
            logger.error(`❌ Failed to place Stop Loss for ${symbol}: ${err.message}`);
        }

        // --- Take Profit Orders ---
        if (takeProfitPrices.length === 0) return;

        let remainingAmount = amount;
        for (let i = 0; i < takeProfitPrices.length; i++) {
            const tpPrice = takeProfitPrices[i];
            const isLastTP = i === takeProfitPrices.length - 1;

            let portionSize = amount / takeProfitPrices.length;
            if (tpProfitSplits && tpProfitSplits.length > i) {
                portionSize = amount * (tpProfitSplits[i] / 100);
            }

            try {
                const tpParams: any = {
                    stopPrice: tpPrice,
                    type: 'TAKE_PROFIT'
                };

                if (hedgeMode) {
                    tpParams.positionSide = direction;
                } else {
                    tpParams.reduceOnly = true;
                }

                let tpAmount = isLastTP ? remainingAmount : portionSize;
                tpAmount = await this.amountToPrecision(symbol, tpAmount);

                if (tpAmount <= 0) continue;

                await this.exchange.createOrder(symbol, 'TAKE_PROFIT', closeSide, tpAmount, undefined, tpParams);
                remainingAmount -= tpAmount;
                logger.info(`✅ Take Profit order placed at ${tpPrice.toFixed(6)} (${tpAmount} contracts) for ${symbol}`);
            } catch (err: any) {
                logger.error(`❌ Failed to place Take Profit at ${tpPrice.toFixed(6)} for ${symbol}: ${err.message}`);
            }
        }
    }
}
