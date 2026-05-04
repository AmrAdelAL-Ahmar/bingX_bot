/**
 * IExchangeService — Common interface that both BinanceService and XTService implement.
 * This allows TradeManager and PositionMonitor to work with any supported exchange.
 */
export interface IExchangeService {
    /**
     * Detects if account uses Hedge/Dual-side mode (true) or One-Way mode (false).
     * Result is cached after first call.
     */
    isHedgeMode(): Promise<boolean>;

    /**
     * Sets leverage for a symbol.
     * Returns the actual leverage that was successfully applied
     * (may be lower than requested if the exchange caps it).
     */
    setLeverage(symbol: string, leverage: number, side?: 'LONG' | 'SHORT'): Promise<number>;

    /**
     * Sets margin mode (CROSS or ISOLATED) for a symbol.
     */
    setMarginMode(symbol: string, mode: 'CROSS' | 'ISOLATED'): Promise<void>;

    /**
     * Rounds a price to the exchange's required precision for a given symbol.
     */
    priceToPrecision(symbol: string, price: number): Promise<number>;

    /**
     * Rounds an amount/quantity to the exchange's required precision for a given symbol.
     * Returns 0 if the amount is below minimum.
     */
    amountToPrecision(symbol: string, amount: number): Promise<number>;

    /**
     * Returns the minimum tradeable amount for a given symbol.
     */
    getMarketMinAmount(symbol: string): Promise<number>;

    /**
     * Returns the minimum order cost (notional value in USDT) for a given symbol.
     * For example, XT requires a minimum of 10 USDT per order.
     */
    getMarketMinCost(symbol: string): Promise<number>;

    /**
     * Returns the contract size for a given symbol (usually 1 for USDT-M perpetuals).
     */
    getContractSize(symbol: string): Promise<number>;

    /**
     * Returns the free/available USDT balance in the Futures/Swap wallet.
     */
    getBalance(): Promise<number>;

    /**
     * Returns total USDT equity (free + used) in the Futures/Swap wallet.
     */
    getTotalEquity(): Promise<number>;

    /**
     * Returns the latest market price (last traded price) for a symbol.
     */
    getMarketPrice(symbol: string): Promise<number>;

    /**
     * Places an order (market or limit).
     */
    placeOrder(
        symbol: string,
        type: 'market' | 'limit',
        side: 'buy' | 'sell',
        amount: number,
        price?: number,
        params?: any
    ): Promise<any>;

    /**
     * Fetches open positions. Optionally filtered by symbol.
     */
    getPositions(symbol?: string): Promise<any[]>;

    /**
     * Fetches a specific order by its exchange orderId and symbol.
     * Returns null if not found.
     */
    getOrder(symbol: string, orderId: string): Promise<any | null>;

    /**
     * Places Stop Loss and Take Profit orders after the main order has been executed.
     */
    placeSLTPOrders(
        symbol: string,
        direction: 'LONG' | 'SHORT',
        amount: number,
        stopLossPrice: number,
        takeProfitPrices: number[],
        hedgeMode: boolean
    ): Promise<void>;
}
