import ccxt from 'ccxt';
import logger from '../utils/logger';

export class BingXService {
    private exchange: any; // Using any to avoid specific version type mismatches for now
    private candleCache: Map<string, { timestamp: number; data: any }> = new Map();

    constructor(apiKey?: string, secretKey?: string) {
        // @ts-ignore
        this.exchange = new ccxt.bingx({
            apiKey: apiKey,
            secret: secretKey,
            timeout: 30000,
            options: {
                defaultType: 'swap', // 'swap' for futures/perpetuals
                adjustForTimeDifference: true,
                recvWindow: 60000,
            },
            enableRateLimit: true,
        });
        this.exchange.loadMarkets().catch((err: any) => logger.error('Failed to load markets:', err));
    }

    /**
     * Resolves the symbol format dynamically based on loaded BingX markets
     */
    private resolveSymbol(symbol: string): string {
        if (!this.exchange.markets) return symbol;
        if (symbol in this.exchange.markets) return symbol;

        // Try base symbol (split by :)
        const baseSymbol = symbol.split(':')[0]; // e.g. BTC/USDT
        if (baseSymbol in this.exchange.markets) return baseSymbol;

        // Try clean uppercase comparisons
        const symbolClean = symbol.toUpperCase().replace('/', '').replace(':', '').replace('-', '');

        // Search in markets
        const match = Object.keys(this.exchange.markets).find(m => {
            const mClean = m.toUpperCase().replace('/', '').replace(':', '').replace('-', '');
            return mClean === symbolClean || mClean === baseSymbol.toUpperCase().replace('/', '').replace('-', '');
        });

        if (match) return match;
        return symbol; // fallback
    }

    async setLeverage(symbol: string, leverage: number, side: 'LONG' | 'SHORT' = 'LONG') {
        const cleanSide = side.toUpperCase();
        const cleanLeverage = Math.floor(leverage); // Ensure integer

        try {
            await this.exchange.loadMarkets(); // Ensure markets are loaded for precision
            const targetSymbol = this.resolveSymbol(symbol);
            logger.info(`Attempting to set leverage: ${cleanLeverage}x for ${targetSymbol} side=${cleanSide}`);
            await this.exchange.setLeverage(cleanLeverage, targetSymbol, { side: cleanSide });
            logger.info(`✅ Leverage set to ${cleanLeverage}x for ${targetSymbol} (${cleanSide})`);
        } catch (error: any) {
            logger.error(`❌ Failed to set leverage for ${symbol} ${cleanSide}: ${error.message}`);
            // No retry here, let TradeManager handle logic if needed
            throw error;
        }
    }

    async setMarginMode(symbol: string, mode: 'CROSS' | 'ISOLATED') {
        try {
            await this.exchange.loadMarkets();
            const targetSymbol = this.resolveSymbol(symbol);
            const marginMode = mode.toUpperCase();
            logger.info(`Attempting to set margin mode: ${marginMode} for ${targetSymbol}`);
            // BingX specific params might be needed, but ccxt unified usually handles it
            await this.exchange.setMarginMode(marginMode, targetSymbol);
            logger.info(`✅ Margin mode set to ${marginMode} for ${targetSymbol}`);
        } catch (error: any) {
            logger.error(`❌ Failed to set margin mode for ${symbol}: ${error.message}`);
            // Don't throw fatal error, just log. Some pairs might process differently.
        }
    }

    async priceToPrecision(symbol: string, price: number) {
        await this.exchange.loadMarkets();
        const targetSymbol = this.resolveSymbol(symbol);
        return parseFloat(this.exchange.priceToPrecision(targetSymbol, price));
    }

    async amountToPrecision(symbol: string, amount: number) {
        await this.exchange.loadMarkets();
        const targetSymbol = this.resolveSymbol(symbol);
        try {
            return parseFloat(this.exchange.amountToPrecision(targetSymbol, amount));
        } catch (error: any) {
            logger.error(`❌ (amountToPrecision) Failed to set precision for ${targetSymbol}: ${error.message}`);
            // If the amount is too small, CCXT throws an error instead of returning 0
            if (error.message && error.message.includes('minimum amount precision')) {
                return 0;
            }
            throw error;
        }
    }

    async getMarketMinAmount(symbol: string) {
        await this.exchange.loadMarkets();
        const targetSymbol = this.resolveSymbol(symbol);
        const market = this.exchange.market(targetSymbol);
        return market?.limits?.amount?.min || 0;
    }

    async getPricePrecision(symbol: string): Promise<number> {
        try {
            await this.exchange.loadMarkets();
            const targetSymbol = this.resolveSymbol(symbol);

            // Try direct lookup
            let market = this.exchange.markets[targetSymbol];
            const pricePrecision = market?.info?.pricePrecision;

            return pricePrecision;
        } catch (e) {
            logger.error(`Error getting precision for ${symbol}:`, e);
            return 4;
        }
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
            await this.exchange.loadMarkets();
            const targetSymbol = this.resolveSymbol(symbol);
            const ticker = await this.exchange.fetchTicker(targetSymbol);
            return ticker.last;
        } catch (error) {
            logger.error(`Error fetching price for ${symbol}: `, error);
            throw error;
        }
    }

    async fetchOHLCV(symbol: string, timeframe: string, limit: number = 100) {
        const key = `ohlcv:${symbol}:${timeframe}:${limit}`;
        const now = Date.now();
        const cached = this.candleCache.get(key);
        if (cached && (now - cached.timestamp < 45000)) {
            return cached.data;
        }

        try {
            await this.exchange.loadMarkets();
            const targetSymbol = this.resolveSymbol(symbol);
            const ohlcv = await this.exchange.fetchOHLCV(targetSymbol, timeframe, undefined, limit);
            const result = ohlcv.map((candle: any) => ({
                timestamp: candle[0],
                open: candle[1],
                high: candle[2],
                low: candle[3],
                close: candle[4],
                volume: candle[5]
            }));
            this.candleCache.set(key, { timestamp: now, data: result });
            return result;
        } catch (error) {
            logger.error(`Error fetching OHLCV for ${symbol} (${timeframe}): `, error);
            throw error;
        }
    }

    async fetchDeepHistoricalData(symbol: string, timeframe: string, days: number = 7) {
        const key = `deep:${symbol}:${timeframe}:${days}`;
        const now = Date.now();
        const cached = this.candleCache.get(key);
        if (cached && (now - cached.timestamp < 45000)) {
            return cached.data;
        }

        try {
            await this.exchange.loadMarkets();
            const targetSymbol = this.resolveSymbol(symbol);
            let since = now - (days * 24 * 60 * 60 * 1000);
            const allCandles: any[] = [];
            const limit = 500; // Safe limit for CCXT/BingX usually

            logger.info(`Fetching deep historical data for ${targetSymbol} (${timeframe}) for the last ${days} days...`);

            while (since < now) {
                const ohlcv = await this.exchange.fetchOHLCV(targetSymbol, timeframe, since, limit);
                if (!ohlcv || ohlcv.length === 0) break;

                const mapped = ohlcv.map((candle: any) => ({
                    timestamp: candle[0],
                    open: candle[1],
                    high: candle[2],
                    low: candle[3],
                    close: candle[4],
                    volume: candle[5]
                }));

                allCandles.push(...mapped);

                const lastCandleTime = ohlcv[ohlcv.length - 1][0];

                // If the last candle time is not progressing, break to avoid infinite loop
                if (lastCandleTime <= since) {
                    break;
                }

                since = lastCandleTime + 1; // move to next ms

                // Small delay to avoid rate limits
                await new Promise(resolve => setTimeout(resolve, 200));
            }

            // CCXT might return overlapping or duplicate candles if we fetch exactly by timestamp, so let's deduplicate
            const uniqueCandles = Array.from(new Map(allCandles.map(item => [item.timestamp, item])).values());

            // Sort to ensure chronological order
            uniqueCandles.sort((a, b) => a.timestamp - b.timestamp);

            logger.info(`Successfully fetched ${uniqueCandles.length} candles for ${targetSymbol} (${timeframe})`);
            this.candleCache.set(key, { timestamp: now, data: uniqueCandles });
            return uniqueCandles;

        } catch (error) {
            logger.error(`Error fetching deep OHLCV for ${symbol} (${timeframe}): `, error);
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
            await this.exchange.loadMarkets();
            const targetSymbol = this.resolveSymbol(symbol);
            logger.info(`Placing Order: ${targetSymbol} ${side} ${amount} with params: ${JSON.stringify(params)}`);
            const order = await this.exchange.createOrder(targetSymbol, type, side, amount, price, params);
            logger.info(`Order placed: ${order.id} for ${targetSymbol} ${side} ${amount} `);
            return order;
        } catch (error) {
            logger.error(`Error placing order for ${symbol}: `, error);
            throw error;
        }
    }

    async getPositions(symbol?: string) {
        try {
            await this.exchange.loadMarkets();
            const targetSymbol = symbol ? this.resolveSymbol(symbol) : undefined;
            const symbols = targetSymbol ? [targetSymbol] : undefined;
            const positions = await this.exchange.fetchPositions(symbols);
            return positions;
        } catch (error) {
            logger.error(`Error fetching positions for ${symbol || 'all'}: `, error);
            throw error;
        }
    }

    async getOrder(symbol: string, orderId: string) {
        try {
            await this.exchange.loadMarkets();
            const targetSymbol = this.resolveSymbol(symbol);
            return await this.exchange.fetchOrder(orderId, targetSymbol);
        } catch (error) {
            logger.error(`Error fetching order ${orderId}:`, error);
            // Don't throw, return null to handle gracefully in monitor
            return null;
        }
    }

    async setStopLoss(symbol: string, stopPrice: number, side: 'LONG' | 'SHORT', amount?: number) {
        try {
            await this.exchange.loadMarkets();
            const targetSymbol = this.resolveSymbol(symbol);
            const orderSide = side === 'LONG' ? 'sell' : 'buy';

            let finalAmount = amount;
            if (!finalAmount || finalAmount <= 0) {
                const positions = await this.getPositions(targetSymbol);
                const matchingPos = positions.find((p: any) =>
                    ((side === 'LONG' && p.side.toLowerCase() === 'long') ||
                        (side === 'SHORT' && p.side.toLowerCase() === 'short')) &&
                    parseFloat(p.contracts || '0') > 0
                );
                if (matchingPos) {
                    finalAmount = parseFloat(matchingPos.contracts);
                }
            }

            if (!finalAmount || finalAmount <= 0) {
                throw new Error(`No active position found for ${targetSymbol} to set stop loss.`);
            }

            const params = {
                stopPrice: stopPrice,
                positionSide: side
            };
            return await this.exchange.createOrder(targetSymbol, 'TRIGGER_MARKET', orderSide, finalAmount, undefined, params);
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
        await this.exchange.loadMarkets();
        const targetSymbol = this.resolveSymbol(symbol);
        const closeSide = direction === 'LONG' ? 'sell' : 'buy';

        // --- Stop Loss Order ---
        try {
            const slParams: any = { stopPrice: stopLossPrice, type: 'STOP' };
            if (hedgeMode) {
                slParams.positionSide = direction;
            } else {
                slParams.reduceOnly = true;
            }
            await this.exchange.createOrder(targetSymbol, 'STOP', closeSide, amount, undefined, slParams);
            logger.info(`✅ Stop Loss order placed at ${stopLossPrice.toFixed(6)} for ${targetSymbol}`);
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
                tpAmount = await this.amountToPrecision(targetSymbol, tpAmount);

                if (tpAmount <= 0) continue;

                await this.exchange.createOrder(targetSymbol, 'TAKE_PROFIT', closeSide, tpAmount, undefined, tpParams);
                remainingAmount -= tpAmount;
                logger.info(`✅ Take Profit order placed at ${tpPrice.toFixed(6)} (${tpAmount} contracts) for ${targetSymbol}`);
            } catch (err: any) {
                logger.error(`❌ Failed to place Take Profit at ${tpPrice.toFixed(6)} for ${symbol}: ${err.message}`);
            }
        }
    }
}
