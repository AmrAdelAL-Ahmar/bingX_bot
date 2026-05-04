import ccxt from 'ccxt';
import logger from '../utils/logger';
import { IExchangeService } from './IExchangeService';

/**
 * XTService — Handles all communication with XT.com Futures via CCXT.
 * Mirrors the same public API as BinanceService so TradeManager works unchanged.
 */
export class XTService implements IExchangeService {
    private exchange: any;
    private _isHedgeMode: boolean | null = null; // Cached position mode

    constructor(apiKey?: string, secretKey?: string) {
        // Sanitize keys
        const cleanApiKey = apiKey ? apiKey.replace(/['\"]+/g, '').trim() : undefined;
        const cleanSecretKey = secretKey ? secretKey.replace(/['\"]+/g, '').trim() : undefined;

        this.exchange = new (ccxt as any).xt({
            apiKey: cleanApiKey,
            secret: cleanSecretKey,
            options: {
                defaultType: 'swap', // XT uses 'swap' for USDT-M perpetual futures
                adjustForTimeDifference: true,
            },
            enableRateLimit: true,
        });

        // Sandbox mode support
        if (process.env.XT_USE_TESTNET === 'true') {
            logger.info('🚀 XT Sandbox/Testnet mode enabled.');
            try {
                this.exchange.setSandboxMode(true);
            } catch (e) {
                logger.warn('XT sandbox mode not available via CCXT.');
            }
        }

        // Log masked key
        if (cleanApiKey) {
            const masked = cleanApiKey.substring(0, 4) + '...' + cleanApiKey.substring(cleanApiKey.length - 4);
            logger.info(`XT Service initialized with key: ${masked}`);
        }

        this.exchange.loadMarkets().catch((err: any) => {
            logger.error('Failed to load XT markets:', err.message);
        });
    }

    /**
     * Detects if account is in Hedge Mode (dual position mode) or One-Way Mode.
     * XT may return this via fetchPositionMode or positional config.
     * Cached after first call.
     */
    async isHedgeMode(): Promise<boolean> {
        if (this._isHedgeMode !== null) return this._isHedgeMode;
        try {
            // XT uses fetchPositionMode to determine dual/one-way
            const response = await this.exchange.fetchPositionMode();
            // response is typically: { hedged: true/false } or similar
            const hedged = response?.hedged === true || response?.dualSidePosition === true;
            this._isHedgeMode = hedged;
            logger.info(`XT Position Mode: ${hedged ? '✅ Hedge Mode (Dual Side)' : '⚠️ One-Way Mode'}`);
            return this._isHedgeMode;
        } catch (error: any) {
            // If not supported, default to One-Way (safer)
            logger.warn(`Could not detect XT position mode, defaulting to One-Way: ${error.message}`);
            this._isHedgeMode = false;
            return false;
        }
    }

    async setLeverage(symbol: string, leverage: number, side: 'LONG' | 'SHORT' = 'LONG'): Promise<number> {
        const requestedLeverage = Math.floor(leverage);
        // XT leverage tiers to try if requested value exceeds the allowed max for this pair
        const fallbackTiers = [requestedLeverage, 20, 15, 10, 5, 3, 2, 1].filter(
            (v, i, arr) => v <= requestedLeverage && arr.indexOf(v) === i
        );

        await this.exchange.loadMarkets();
        for (const tryLeverage of fallbackTiers) {
            try {
                logger.info(`[XT] Attempting to set leverage: ${tryLeverage}x for ${symbol} (${side})`);
                await this.exchange.setLeverage(tryLeverage, symbol, { positionSide: side });
                if (tryLeverage < requestedLeverage) {
                    logger.warn(`⚠️ [XT] Leverage capped: requested ${requestedLeverage}x → applied ${tryLeverage}x for ${symbol}`);
                } else {
                    logger.info(`✅ [XT] Leverage set to ${tryLeverage}x for ${symbol} (${side})`);
                }
                return tryLeverage;
            } catch (error: any) {
                if (error.message && (
                    error.message.includes('same leverage') ||
                    error.message.includes('no need') ||
                    error.message.includes('already')
                )) {
                    logger.info(`ℹ️ [XT] Leverage already set to ${tryLeverage}x for ${symbol}`);
                    return tryLeverage;
                }
                if (error.message && error.message.includes('exceed_max_leverage')) {
                    logger.warn(`⚠️ [XT] ${tryLeverage}x exceeds max for ${symbol}, trying lower...`);
                    continue; // try next tier
                }
                // Unexpected error
                logger.error(`❌ [XT] Failed to set leverage for ${symbol}: ${error.message}`);
                throw error;
            }
        }
        // If all tiers failed, default to 1x (shouldn't happen)
        logger.error(`❌ [XT] All leverage tiers failed for ${symbol}. Defaulting to 1x.`);
        return 1;
    }

    async setMarginMode(symbol: string, mode: 'CROSS' | 'ISOLATED') {
        // XT requires positionSide for setMarginMode — apply to both LONG and SHORT sides
        await this.exchange.loadMarkets();
        const marginMode = mode.toLowerCase(); // XT expects 'cross' or 'isolated'
        for (const positionSide of ['LONG', 'SHORT']) {
            try {
                logger.info(`[XT] Setting margin mode: ${marginMode} for ${symbol} (${positionSide})`);
                await this.exchange.setMarginMode(marginMode, symbol, { positionSide });
                logger.info(`✅ [XT] Margin mode set to ${marginMode} for ${symbol} (${positionSide})`);
            } catch (error: any) {
                // Ignore "already set" errors — they are expected on 2nd call
                if (error.message && (
                    error.message.includes('already') ||
                    error.message.includes('no need') ||
                    error.message.includes('same')
                )) {
                    logger.info(`ℹ️ [XT] Margin mode already ${marginMode} for ${symbol} (${positionSide})`);
                    continue;
                }
                // Not fatal — log and continue (some XT accounts have cross-only)
                logger.warn(`⚠️ [XT] setMarginMode failed for ${symbol} (${positionSide}): ${error.message}`);
            }
        }
    }

    async priceToPrecision(symbol: string, price: number): Promise<number> {
        await this.exchange.loadMarkets();
        try {
            return parseFloat(this.exchange.priceToPrecision(symbol, price));
        } catch (error: any) {
            logger.warn(`[XT] priceToPrecision fallback for ${symbol}: ${error.message}`);
            // Fallback: round to 8 decimal places
            return parseFloat(price.toFixed(8));
        }
    }

    async amountToPrecision(symbol: string, amount: number): Promise<number> {
        await this.exchange.loadMarkets();
        try {
            return parseFloat(this.exchange.amountToPrecision(symbol, amount));
        } catch (error: any) {
            logger.error(`❌ [XT] amountToPrecision failed for ${symbol}: ${error.message}`);
            if (error.message && error.message.includes('minimum amount')) {
                return 0;
            }
            throw error;
        }
    }

    async getMarketMinAmount(symbol: string): Promise<number> {
        await this.exchange.loadMarkets();
        try {
            const market = this.exchange.market(symbol);
            return market?.limits?.amount?.min || 0;
        } catch (error: any) {
            logger.warn(`[XT] Could not get min amount for ${symbol}: ${error.message}`);
            return 0;
        }
    }

    async getMarketMinCost(symbol: string): Promise<number> {
        await this.exchange.loadMarkets();
        try {
            const market = this.exchange.market(symbol);
            // XT enforces a minimum notional of 10 USDT per order
            return market?.limits?.cost?.min || 10;
        } catch (error: any) {
            logger.warn(`[XT] Could not get min cost for ${symbol}: ${error.message}`);
            return 10; // XT hard minimum
        }
    }

    async getContractSize(symbol: string): Promise<number> {
        await this.exchange.loadMarkets();
        try {
            const market = this.exchange.market(symbol);
            return market?.contractSize || 1;
        } catch (error: any) {
            logger.warn(`[XT] Could not get contract size for ${symbol}: ${error.message}`);
            return 1;
        }
    }

    async getBalance(): Promise<number> {
        try {
            // XT Futures balance — use 'swap' type
            const balance = await this.exchange.fetchBalance({ type: 'swap' });
            // Try USDT free balance
            if (balance.free?.['USDT'] !== undefined) return balance.free['USDT'];
            if (balance['USDT']?.free !== undefined) return balance['USDT'].free;
            return 0;
        } catch (error: any) {
            logger.error('[XT] Error fetching balance:', error.message);
            throw error;
        }
    }

    async getTotalEquity(): Promise<number> {
        try {
            const balance = await this.exchange.fetchBalance({ type: 'swap' });
            if (balance.total?.['USDT'] !== undefined) return balance.total['USDT'];
            if (balance['USDT']?.total !== undefined) return balance['USDT'].total;
            if (balance.free?.['USDT'] !== undefined) return balance.free['USDT'];
            return 0;
        } catch (error: any) {
            logger.error('[XT] Error fetching total equity:', error.message);
            return 0;
        }
    }

    async getMarketPrice(symbol: string): Promise<number> {
        try {
            const ticker = await this.exchange.fetchTicker(symbol);
            return ticker.last || ticker.close || 0;
        } catch (error: any) {
            logger.error(`[XT] Error fetching price for ${symbol}:`, error.message);
            throw error;
        }
    }
    async placeOrder(symbol: string, type: 'market' | 'limit', side: 'buy' | 'sell', amount: number, price?: number, params: any = {}) {
        try {
            const placeParams = { ...params };
            const stopLoss = placeParams.stopLoss;
            const takeProfit = placeParams.takeProfit;
            delete placeParams.stopLoss;
            delete placeParams.takeProfit;

            logger.info(`Placing Order: ${symbol} ${side} ${amount} with params: ${JSON.stringify(placeParams)}`);
            const order = await this.exchange.createOrder(symbol, type, side, amount, price, placeParams);
            logger.info(`Order placed: ${order.id} for ${symbol} ${side} ${amount} `);

            if (stopLoss || takeProfit) {
                const closeSide = side === 'buy' ? 'sell' : 'buy';
                const positionSide = placeParams.positionSide || (side === 'buy' ? 'LONG' : 'SHORT');

                if (stopLoss) {
                    try {
                        const slParams = { positionSide, stopLoss };
                        await this.exchange.createOrder(symbol, 'market', closeSide, amount, undefined, slParams);
                        logger.info(`✅ Stop Loss set at ${stopLoss} for ${symbol}`);
                    } catch (e: any) {
                        logger.error(`❌ Failed to set Stop Loss for ${symbol}: ${e.message}`);
                    }
                }
                if (takeProfit) {
                    try {
                        const tpParams = { positionSide, takeProfit };
                        await this.exchange.createOrder(symbol, 'market', closeSide, amount, undefined, tpParams);
                        logger.info(`✅ Take Profit set at ${takeProfit} for ${symbol}`);
                    } catch (e: any) {
                        logger.error(`❌ Failed to set Take Profit for ${symbol}: ${e.message}`);
                    }
                }
            }

            return order;
        } catch (error: any) {
            logger.error(`[XT] ❌ Error placing order for ${symbol}:`, error.message);
            throw error;
        }
    }


    async getPositions(symbol?: string): Promise<any[]> {
        try {
            await this.exchange.loadMarkets();
            const symbols = symbol ? [symbol] : undefined;
            const positions = await this.exchange.fetchPositions(symbols);
            return positions || [];
        } catch (error: any) {
            logger.error(`[XT] Error fetching positions for ${symbol || 'all'}:`, error.message);
            throw error;
        }
    }

    async getOrder(symbol: string, orderId: string): Promise<any> {
        try {
            return await this.exchange.fetchOrder(orderId, symbol);
        } catch (error: any) {
            logger.error(`[XT] Error fetching order ${orderId}:`, error.message);
            return null;
        }
    }

    async getOpenOrders(symbol?: string): Promise<any[]> {
        try {
            await this.exchange.loadMarkets();
            return await this.exchange.fetchOpenOrders(symbol);
        } catch (error: any) {
            logger.error(`[XT] Error fetching open orders for ${symbol || 'all'}:`, error.message);
            return [];
        }
    }

    /**
     * Places Stop Loss and Take Profit orders on XT Futures.
     *
     * Based on testing:
     *   - 'stop' type with explicit price works for SL on XT
     *   - 'take_profit' type with explicit price works for TP on XT
     *   - STOP_MARKET / TAKE_PROFIT_MARKET cause invalid_price errors on XT
     */
    async placeSLTPOrders(
        symbol: string,
        direction: 'LONG' | 'SHORT',
        amount: number,
        stopLossPrice: number,
        takeProfitPrices: number[],
        hedgeMode: boolean
    ): Promise<void> {
        const closeSide = direction === 'LONG' ? 'sell' : 'buy';
        const baseParams: any = hedgeMode
            ? { positionSide: direction }
            : { reduceOnly: true };

        // --- Stop Loss Order ---
        try {
            const cleanAmount = await this.amountToPrecision(symbol, amount);
            if (cleanAmount > 0) {
                const slParams = { ...baseParams, stopPrice: stopLossPrice };
                // Use 'stop' (limit-stop) with explicit price — works reliably on XT
                await this.exchange.createOrder(symbol, 'stop', closeSide, cleanAmount, stopLossPrice, slParams);
                logger.info(`✅ [XT] Stop Loss placed at ${stopLossPrice.toFixed(6)} for ${symbol} (Qty: ${cleanAmount})`);
            } else {
                logger.error(`❌ [XT] Stop Loss amount too small after precision formatting for ${symbol}: ${amount}`);
            }
        } catch (slErr: any) {
            logger.error(`❌ [XT] Failed to place Stop Loss for ${symbol}: ${slErr.message}`);
        }

        // --- Take Profit Orders ---
        if (takeProfitPrices.length === 0) return;

        let remainingAmount = amount;
        const numTargets = takeProfitPrices.length;

        for (let i = 0; i < numTargets; i++) {
            if (remainingAmount <= 0) break;

            const tpPrice = takeProfitPrices[i];

            try {
                // Determine portion: divide remaining by remaining targets
                const rawPortion = remainingAmount / (numTargets - i);
                let tpAmount = await this.amountToPrecision(symbol, rawPortion);

                // If the precision makes it 0 (e.g. 0.5 contracts), and this is the last target, just use all remaining
                // Or if it's not the last, we might have to floor it or let amountToPrecision handle it.
                if (tpAmount <= 0) {
                    if (i === numTargets - 1) {
                        tpAmount = await this.amountToPrecision(symbol, remainingAmount);
                    } else {
                        logger.warn(`[XT] Take Profit portion too small for ${symbol} target ${i + 1}, skipping this target.`);
                        continue;
                    }
                }

                if (tpAmount > remainingAmount) {
                    tpAmount = await this.amountToPrecision(symbol, remainingAmount);
                }

                if (tpAmount <= 0) continue;

                const tpParams = { ...baseParams, stopPrice: tpPrice };
                // Use 'take_profit' (limit-take-profit) with explicit price — works reliably on XT
                await this.exchange.createOrder(symbol, 'take_profit', closeSide, tpAmount, tpPrice, tpParams);
                logger.info(`✅ [XT] Take Profit placed at ${tpPrice.toFixed(6)} for ${symbol} (Qty: ${tpAmount})`);

                remainingAmount -= tpAmount;
            } catch (tpErr: any) {
                logger.error(`❌ [XT] Failed to place Take Profit at ${tpPrice.toFixed(6)} for ${symbol}: ${tpErr.message}`);
            }
        }
    }
}
