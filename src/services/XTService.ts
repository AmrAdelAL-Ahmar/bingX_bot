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

    async setLeverage(symbol: string, leverage: number, side: 'LONG' | 'SHORT' = 'LONG') {
        const cleanLeverage = Math.floor(leverage);
        try {
            await this.exchange.loadMarkets();
            logger.info(`[XT] Attempting to set leverage: ${cleanLeverage}x for ${symbol} (${side})`);
            // XT requires positionSide argument — pass it explicitly
            await this.exchange.setLeverage(cleanLeverage, symbol, { positionSide: side });
            logger.info(`✅ [XT] Leverage set to ${cleanLeverage}x for ${symbol} (${side})`);
        } catch (error: any) {
            if (error.message && (
                error.message.includes('same leverage') ||
                error.message.includes('no need') ||
                error.message.includes('already')
            )) {
                logger.info(`ℹ️ [XT] Leverage already set to ${cleanLeverage}x for ${symbol}`);
                return;
            }
            logger.error(`❌ [XT] Failed to set leverage for ${symbol}: ${error.message}`);
            throw error;
        }
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

    async placeOrder(
        symbol: string,
        type: 'market' | 'limit',
        side: 'buy' | 'sell',
        amount: number,
        price?: number,
        params: any = {}
    ): Promise<any> {
        try {
            logger.info(`[XT] Placing Order: ${symbol} ${type.toUpperCase()} ${side.toUpperCase()} ${amount} ${price ? `@ ${price}` : ''} params: ${JSON.stringify(params)}`);
            const order = await this.exchange.createOrder(symbol, type, side, amount, price, params);
            logger.info(`[XT] ✅ Order placed: ${order.id} for ${symbol} ${side} ${amount}`);
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

    /**
     * Places Stop Loss and Take Profit orders on XT Futures after the main market order.
     *
     * XT supports:
     *   - createStopMarketOrder for Stop Loss
     *   - createTakeProfitOrder for Take Profit
     *   OR via stopLoss/takeProfit params in createOrder (createOrderWithTakeProfitAndStopLoss)
     *
     * Strategy:
     *   One-Way Mode: Use reduceOnly + stopPrice trigger
     *   Hedge Mode:   Use positionSide + proportional amounts
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
        const MIN_NOTIONAL = 5; // Minimum USDT notional (adjust if XT differs)

        // --- Stop Loss Order ---
        try {
            const slParams: any = { stopPrice: stopLossPrice };
            if (hedgeMode) {
                slParams.positionSide = direction; // LONG or SHORT
            } else {
                slParams.reduceOnly = true;
            }

            // Try STOP_MARKET first (supported by XT)
            await this.exchange.createOrder(symbol, 'STOP_MARKET', closeSide, amount, undefined, slParams);
            logger.info(`✅ [XT] Stop Loss order placed at ${stopLossPrice.toFixed(6)} for ${symbol}`);
        } catch (slErr: any) {
            logger.error(`❌ [XT] Failed to place Stop Loss for ${symbol}: ${slErr.message}`);
            // Fallback: try 'stop' type
            try {
                const slParamsFallback: any = { stopPrice: stopLossPrice, reduceOnly: !hedgeMode };
                if (hedgeMode) slParamsFallback.positionSide = direction;
                await this.exchange.createOrder(symbol, 'stop', closeSide, amount, stopLossPrice, slParamsFallback);
                logger.info(`✅ [XT] Stop Loss (fallback) placed at ${stopLossPrice.toFixed(6)} for ${symbol}`);
            } catch (fallbackErr: any) {
                logger.error(`❌ [XT] Stop Loss fallback also failed for ${symbol}: ${fallbackErr.message}`);
            }
        }

        // --- Take Profit Orders ---
        if (takeProfitPrices.length === 0) return;

        if (!hedgeMode) {
            // One-Way Mode: use reduceOnly TP orders
            for (const tpPrice of takeProfitPrices) {
                try {
                    const tpParams: any = {
                        stopPrice: tpPrice,
                        reduceOnly: true,
                    };
                    await this.exchange.createOrder(symbol, 'TAKE_PROFIT_MARKET', closeSide, undefined, undefined, tpParams);
                    logger.info(`✅ [XT] Take Profit placed at ${tpPrice.toFixed(6)} for ${symbol}`);
                } catch (tpErr: any) {
                    // Fallback: try take_profit type with explicit amount
                    logger.warn(`[XT] TAKE_PROFIT_MARKET failed, trying fallback for TP at ${tpPrice}: ${tpErr.message}`);
                    try {
                        await this.exchange.createOrder(symbol, 'take_profit_market', closeSide, amount, undefined, {
                            stopPrice: tpPrice,
                            reduceOnly: true,
                        });
                        logger.info(`✅ [XT] Take Profit (fallback) placed at ${tpPrice.toFixed(6)} for ${symbol}`);
                    } catch (fallbackErr: any) {
                        logger.error(`❌ [XT] Failed to place Take Profit at ${tpPrice.toFixed(6)} for ${symbol}: ${fallbackErr.message}`);
                    }
                }
            }
        } else {
            // Hedge Mode: proportional amounts
            const portionSize = amount / takeProfitPrices.length;
            for (const tpPrice of takeProfitPrices) {
                try {
                    const minAmountForNotional = MIN_NOTIONAL / tpPrice;
                    const tpAmount = parseFloat(Math.max(portionSize, minAmountForNotional).toFixed(6));

                    if (tpAmount > amount) {
                        logger.warn(`⚠️ [XT] TP at ${tpPrice.toFixed(6)} skipped: required amount (${tpAmount}) exceeds total (${amount})`);
                        continue;
                    }

                    const tpParams: any = {
                        stopPrice: tpPrice,
                        positionSide: direction,
                    };
                    await this.exchange.createOrder(symbol, 'TAKE_PROFIT_MARKET', closeSide, tpAmount, undefined, tpParams);
                    logger.info(`✅ [XT] Take Profit placed at ${tpPrice.toFixed(6)} (${tpAmount} contracts) for ${symbol}`);
                } catch (tpErr: any) {
                    logger.error(`❌ [XT] Failed to place Hedge TP at ${tpPrice.toFixed(6)} for ${symbol}: ${tpErr.message}`);
                }
            }
        }
    }
}
