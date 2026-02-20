
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
        return parseFloat(this.exchange.amountToPrecision(symbol, amount));
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

    async getMarketPrice(symbol: string) {
        try {
            const ticker = await this.exchange.fetchTicker(symbol);
            return ticker.last;
        } catch (error) {
            logger.error(`Error fetching price for ${symbol}: `, error);
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
}
