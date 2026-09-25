
import ccxt from 'ccxt';
import logger from '../utils/logger';

export class BinanceService {
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
            await this.exchange.setLeverage(cleanLeverage, symbol);
            logger.info(`✅ Leverage set to ${cleanLeverage}x for ${symbol}`);
        } catch (error: any) {
            logger.error(`❌ Failed to set leverage for ${symbol}: ${error.message}`);
            
            // Fallback for common leverage errors (e.g. -4028 Leverage is not valid)
            if (error.message && (error.message.includes('-4028') || error.message.includes('Leverage'))) {
                const fallbackLev = Math.min(20, cleanLeverage); // Try 20x or less
                logger.info(`🔄 Retrying with fallback leverage: ${fallbackLev}x`);
                try {
                    await this.exchange.setLeverage(fallbackLev, symbol);
                    logger.info(`✅ Successfully set fallback leverage: ${fallbackLev}x`);
                    return;
                } catch (e2) {
                    logger.error(`❌ Fallback leverage also failed.`);
                }
            }
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
            // Error -4067: Position side cannot be changed if there exists open orders.
            if (error.message && error.message.includes('-4067')) {
                logger.warn(`⚠️ Cannot change margin mode for ${symbol} while orders/positions are open.`);
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
     * Cancels existing Stop Loss orders for a symbol and places a new one.
     */
    async setStopLoss(symbol: string, stopPrice: number, direction: 'LONG' | 'SHORT') {
        try {
            await this.exchange.loadMarkets();
            const closeSide = direction === 'LONG' ? 'sell' : 'buy';
            const hedgeMode = await this.isHedgeMode();

            // 1. Fetch open orders to find existing SL
            const openOrders = await this.exchange.fetchOpenOrders(symbol);
            const slOrders = openOrders.filter((o: any) => o.type === 'STOP_MARKET' || o.type === 'stop_market');

            // 2. Cancel them
            for (const order of slOrders) {
                logger.info(`Cancelling existing SL order: ${order.id}`);
                await this.exchange.cancelOrder(order.id, symbol);
            }

            // 3. Place new SL
            const slParams: any = { stopPrice: stopPrice };
            if (hedgeMode) {
                slParams.positionSide = direction;
                await this.exchange.createOrder(symbol, 'STOP_MARKET', closeSide, undefined, undefined, slParams);
            } else {
                slParams.closePosition = true;
                await this.exchange.createOrder(symbol, 'STOP_MARKET', closeSide, undefined, undefined, slParams);
            }
            logger.info(`✅ New Stop Loss order placed at ${stopPrice} for ${symbol}`);
        } catch (error: any) {
            logger.error(`❌ Failed to update Stop Loss for ${symbol}: ${error.message}`);
            throw error;
        }
    }

    /**
     * Places Stop Loss and Take Profit orders on Binance Futures after the main market order.
     * Enforces minimum notional for partial TPs.
     */
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
        const MIN_NOTIONAL = 5.1; // Binance minimum notional in USDT + safety margin

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

        // Common logic for splitting amount among TP levels
        let remainingAmount = amount;

        for (let i = 0; i < takeProfitPrices.length; i++) {
            const tpPrice = takeProfitPrices[i];
            const isLastTP = i === takeProfitPrices.length - 1;

            // Calculate portion size based on custom split or equal division
            let portionSize = amount / takeProfitPrices.length;
            if (tpProfitSplits && tpProfitSplits.length > i) {
                portionSize = amount * (tpProfitSplits[i] / 100);
            } else if (tpProfitSplits && tpProfitSplits.length > 0) {
                // If there are more targets than splits, use the last split or divide equally among remaining
                // Since this is edge case, we can just use equal division of the remaining targets
                const remainingTargets = takeProfitPrices.length - tpProfitSplits.length;
                let usedPercent = tpProfitSplits.reduce((a,b)=>a+b, 0);
                if (usedPercent > 100) usedPercent = 100;
                portionSize = amount * ((100 - usedPercent) / 100) / remainingTargets;
            }

            try {
                const tpParams: any = {
                    stopPrice: tpPrice,
                };

                if (hedgeMode) {
                    tpParams.positionSide = direction;
                } else {
                    tpParams.reduceOnly = true;
                }

                // If only one TP or it's the last one, and we're in One-Way mode, we COULD use closePosition.
                // But if we have multiple TPs, we MUST split the amount.
                if (!hedgeMode && takeProfitPrices.length === 1) {
                    tpParams.closePosition = true;
                    await this.exchange.createOrder(symbol, 'TAKE_PROFIT_MARKET', closeSide, undefined, undefined, tpParams);
                } else {
                    // Split mode
                    let tpAmount: number;
                    if (isLastTP) {
                        tpAmount = await this.amountToPrecision(symbol, remainingAmount);
                    } else {
                        // Ensure amount * price >= MIN_NOTIONAL
                        const minAmountForNotional = MIN_NOTIONAL / tpPrice;
                        tpAmount = await this.amountToPrecision(symbol, Math.max(portionSize, minAmountForNotional));
                    }

                    if (tpAmount <= 0) {
                        logger.warn(`⚠️ TP at ${tpPrice.toFixed(6)} skipped: calculated amount is 0.`);
                        continue;
                    }

                    if (tpAmount > remainingAmount && !isLastTP) {
                        logger.warn(`⚠️ TP at ${tpPrice.toFixed(6)} skipped: required amount (${tpAmount}) exceeds remaining (${remainingAmount})`);
                        continue;
                    }

                    await this.exchange.createOrder(symbol, 'TAKE_PROFIT_MARKET', closeSide, tpAmount, undefined, tpParams);
                    remainingAmount -= tpAmount;
                    logger.info(`✅ Take Profit order placed at ${tpPrice.toFixed(6)} (${tpAmount} contracts) for ${symbol}`);
                }
            } catch (err: any) {
                logger.error(`❌ Failed to place Take Profit at ${tpPrice.toFixed(6)} for ${symbol}: ${err.message}`);
            }
        }
    }
}
