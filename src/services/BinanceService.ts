
import ccxt from 'ccxt';
import logger from '../utils/logger';
import { IExchangeService } from './IExchangeService';

export class BinanceService implements IExchangeService {
    private exchange: any;
    private _isHedgeMode: boolean | null = null; // Cached position mode

    constructor(apiKey?: string, secretKey?: string) {
        // Sanitize keys to remove any surrounding quotes or whitespace that might come from .env
        const cleanApiKey = apiKey ? apiKey.replace(/['"]+/g, '').trim() : undefined;
        const cleanSecretKey = secretKey ? secretKey.replace(/['"]+/g, '').trim() : undefined;

        this.exchange = new ccxt.binance({
            apiKey: cleanApiKey,
            secret: cleanSecretKey,
            options: {
                defaultType: 'future', // USDS-M Futures
                adjustForTimeDifference: true,
                recvWindow: 10000,
            },
            // Disable fetchCurrencies as it often causes -2015 errors with limited keys
            // and it's not strictly needed for Futures trading.
            has: {
                fetchCurrencies: false,
            },
            enableRateLimit: true,
        });

        // If TEST_MODE is true or BINANCE_USE_TESTNET is true, we can enable sandbox mode
        if (process.env.BINANCE_USE_TESTNET === 'true') {
            logger.info('🚀 Binance Sandbox (Testnet) mode enabled.');
            this.exchange.setSandboxMode(true);
        } else if (process.env.TEST_MODE === 'true') {
            logger.info('ℹ️ TEST_MODE is active. If you are using Testnet keys, please set BINANCE_USE_TESTNET=true in .env');
        }

        // Log masked key for verification
        if (cleanApiKey) {
            const masked = cleanApiKey.substring(0, 4) + '...' + cleanApiKey.substring(cleanApiKey.length - 4);
            logger.info(`Binance Service initialized with key: ${masked}`);
        }

        this.exchange.loadMarkets().catch((err: any) => {
            logger.error('Failed to load Binance markets:', err);
            if (err.message && err.message.includes('-2015')) {
                logger.error('🚨 CRITICAL: Binance error -2015 detected.');
                logger.error('👉 Please follow these steps in your Binance account:');
                logger.error('1. Go to "API Management".');
                logger.error('2. Find your API Key and click "Edit Restrictions".');
                logger.error('3. Check the box "Enable Futures". (IMPORTANT)');
                logger.error('4. If you have IP restriction enabled, ensure your IP is whitelisted.');
                logger.error('5. Click "Save" and enter your 2FA code.');
            }
        });
    }

    /**
     * Detects if the account is in Hedge Mode (true) or One-Way Mode (false).
     * Result is cached after first call to avoid repeated API requests.
     */
    async isHedgeMode(): Promise<boolean> {
        if (this._isHedgeMode !== null) return this._isHedgeMode;
        try {
            const response = await this.exchange.fapiPrivateGetPositionSideDual();
            this._isHedgeMode = response.dualSidePosition === true;
            logger.info(`Binance Position Mode: ${this._isHedgeMode ? '✅ Hedge Mode (Dual Side)' : '⚠️ One-Way Mode (positionSide will be omitted)'}`);
            return this._isHedgeMode;
        } catch (error: any) {
            logger.warn(`Could not detect position mode, defaulting to One-Way: ${error.message}`);
            this._isHedgeMode = false;
            return false;
        }
    }

    async setLeverage(symbol: string, leverage: number, side: 'LONG' | 'SHORT' = 'LONG') {
        const cleanLeverage = Math.floor(leverage);

        try {
            await this.exchange.loadMarkets();
            logger.info(`Attempting to set leverage: ${cleanLeverage}x for ${symbol}`);
            // Binance unified setLeverage doesn't always need side, but we can pass it in params if needed
            await this.exchange.setLeverage(cleanLeverage, symbol);
            logger.info(`✅ Leverage set to ${cleanLeverage}x for ${symbol}`);
        } catch (error: any) {
            logger.error(`❌ Failed to set leverage for ${symbol}: ${error.message}`);
            throw error;
        }
    }

    async setMarginMode(symbol: string, mode: 'CROSS' | 'ISOLATED') {
        try {
            await this.exchange.loadMarkets();
            const marginMode = mode.toUpperCase();
            logger.info(`Attempting to set margin mode: ${marginMode} for ${symbol}`);
            await this.exchange.setMarginMode(marginMode, symbol);
            logger.info(`✅ Margin mode set to ${marginMode} for ${symbol}`);
        } catch (error: any) {
            // Binance throws error if margin mode is already set to the same value
            if (error.message && (error.message.includes('No need to change margin type') || error.message.includes('11005'))) {
                logger.info(`ℹ️ Margin mode already set to ${mode} for ${symbol}`);
                return;
            }
            logger.error(`❌ Failed to set margin mode for ${symbol}: ${error.message}`);
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
            logger.error(`❌ (amountToPrecision) Failed for ${symbol}: ${error.message}`);
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
            const balance = await this.exchange.fetchBalance({ type: 'future' });
            return balance.free['USDT'] !== undefined ? balance.free['USDT'] : 0;
        } catch (error) {
            logger.error('Error fetching Binance balance:', error);
            throw error;
        }
    }

    async getTotalEquity() {
        try {
            const balance = await this.exchange.fetchBalance({ type: 'future' });
            return balance.total['USDT'] !== undefined ? balance.total['USDT'] : (balance.free['USDT'] || 0);
        } catch (error) {
            logger.error('Error fetching Binance total equity:', error);
            return 0;
        }
    }

    async getMarketPrice(symbol: string) {
        try {
            const ticker = await this.exchange.fetchTicker(symbol);
            return ticker.last;
        } catch (error) {
            logger.error(`Error fetching Binance price for ${symbol}: `, error);
            throw error;
        }
    }

    async placeOrder(symbol: string, type: 'market' | 'limit', side: 'buy' | 'sell', amount: number, price?: number, params: any = {}) {
        try {
            logger.info(`Placing Binance Order: ${symbol} ${side} ${amount} with params: ${JSON.stringify(params)}`);
            
            // Binance specific: for stopLoss and takeProfit in market orders, 
            // ccxt unified might need specific params or separate calls depending on how it's implemented.
            // But usually 'stopLoss' and 'takeProfit' in params works for some exchanges.
            // For Binance Futures, we often use 'stopPrice' for triggers.
            
            const order = await this.exchange.createOrder(symbol, type, side, amount, price, params);
            logger.info(`Binance Order placed: ${order.id} for ${symbol} ${side} ${amount}`);
            return order;
        } catch (error) {
            logger.error(`Error placing Binance order for ${symbol}: `, error);
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
            logger.error(`Error fetching Binance positions for ${symbol || 'all'}: `, error);
            throw error;
        }
    }

    async getOrder(symbol: string, orderId: string) {
        try {
            return await this.exchange.fetchOrder(orderId, symbol);
        } catch (error) {
            logger.error(`Error fetching Binance order ${orderId}:`, error);
            return null;
        }
    }

    /**
     * Places Stop Loss and Take Profit orders on Binance Futures after the main market order.
     * 
     * One-Way Mode:
     *   - SL: STOP_MARKET with closePosition: true  (closes full position)
     *   - TP: TAKE_PROFIT_MARKET with closePosition: true per level
     *         Note: only the first level hit will close the position since they all use closePosition.
     *         If you want partial TP closes, ensure each portion meets the 5 USDT minimum notional.
     * 
     * Hedge Mode:
     *   - SL/TP: use positionSide and proportional amounts, enforcing min notional.
     */
    async placeSLTPOrders(
        symbol: string,
        direction: 'LONG' | 'SHORT',
        amount: number,
        stopLossPrice: number,
        takeProfitPrices: number[],
        hedgeMode: boolean
    ) {
        const closeSide = direction === 'LONG' ? 'sell' : 'buy';
        const MIN_NOTIONAL = 5; // Binance minimum notional in USDT

        // --- Stop Loss Order (STOP_MARKET) ---
        try {
            const slParams: any = { stopPrice: stopLossPrice };
            if (hedgeMode) {
                slParams.positionSide = direction;
                await this.exchange.createOrder(symbol, 'STOP_MARKET', closeSide, amount, undefined, slParams);
            } else {
                // One-Way Mode: closePosition closes the full position automatically
                slParams.closePosition = true;
                await this.exchange.createOrder(symbol, 'STOP_MARKET', closeSide, undefined, undefined, slParams);
            }
            logger.info(`✅ Stop Loss order placed at ${stopLossPrice.toFixed(6)} for ${symbol}`);
        } catch (err: any) {
            logger.error(`❌ Failed to place Stop Loss for ${symbol}: ${err.message}`);
        }

        // --- Take Profit Orders (TAKE_PROFIT_MARKET) ---
        if (takeProfitPrices.length === 0) return;

        if (!hedgeMode) {
            // One-Way Mode: Use closePosition: true for each TP level.
            // When the first TP price is hit, the full position is closed.
            // Remaining TP orders become orphaned and can be cancelled manually.
            for (const tpPrice of takeProfitPrices) {
                try {
                    const tpParams: any = {
                        stopPrice: tpPrice,
                        closePosition: true,
                    };
                    await this.exchange.createOrder(symbol, 'TAKE_PROFIT_MARKET', closeSide, undefined, undefined, tpParams);
                    logger.info(`✅ Take Profit order placed at ${tpPrice.toFixed(6)} for ${symbol}`);
                } catch (err: any) {
                    logger.error(`❌ Failed to place Take Profit at ${tpPrice.toFixed(6)} for ${symbol}: ${err.message}`);
                }
            }
        } else {
            // Hedge Mode: Split amount proportionally, enforce min notional
            const portionSize = amount / takeProfitPrices.length;
            for (const tpPrice of takeProfitPrices) {
                try {
                    // Ensure amount * price >= MIN_NOTIONAL
                    const minAmountForNotional = MIN_NOTIONAL / tpPrice;
                    const tpAmount = parseFloat(Math.max(portionSize, minAmountForNotional).toFixed(6));

                    if (tpAmount > amount) {
                        logger.warn(`⚠️ TP at ${tpPrice.toFixed(6)} skipped: required amount (${tpAmount}) exceeds total position (${amount})`);
                        continue;
                    }

                    const tpParams: any = {
                        stopPrice: tpPrice,
                        positionSide: direction,
                    };
                    await this.exchange.createOrder(symbol, 'TAKE_PROFIT_MARKET', closeSide, tpAmount, undefined, tpParams);
                    logger.info(`✅ Take Profit order placed at ${tpPrice.toFixed(6)} (${tpAmount} contracts) for ${symbol}`);
                } catch (err: any) {
                    logger.error(`❌ Failed to place Take Profit at ${tpPrice.toFixed(6)} for ${symbol}: ${err.message}`);
                }
            }
        }
    }
}
