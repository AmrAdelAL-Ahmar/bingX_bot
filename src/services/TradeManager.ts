import { BingXService } from './BingXService';
import { ParsedSignal } from './SignalParser';
import Trade, { ITrade } from '../models/Trade';
import User from '../models/User';
import logger from '../utils/logger';
import { CircuitBreakerService } from './CircuitBreakerService';
import { CorrelationGuardService } from './CorrelationGuardService';

// Helper function to calculate dynamic Take Profit splits mathematically based on RRR and ATR
async function calculateDynamicTpsSplits(
    entryPrice: number,
    stopLoss: number,
    targets: number[],
    symbol: string,
    bingx: BingXService
): Promise<number[]> {
    if (targets.length === 0) return [];
    if (targets.length === 1) return [100];

    try {
        const risk = Math.abs(entryPrice - stopLoss);
        if (risk === 0) {
            return Array(targets.length).fill(100 / targets.length);
        }

        const rrrs = targets.map(tp => Math.abs(tp - entryPrice) / risk);

        // Fetch ATR to scale weights
        let atrRatio = 0.01; // default fallback (1% volatility)
        try {
            const ohlcv = await bingx.fetchOHLCV(symbol, '5m', 30);
            if (ohlcv && ohlcv.length >= 15) {
                const trs: number[] = [];
                for (let i = 1; i < ohlcv.length; i++) {
                    const tr = Math.max(
                        ohlcv[i].high - ohlcv[i].low,
                        Math.abs(ohlcv[i].high - ohlcv[i-1].close),
                        Math.abs(ohlcv[i].low - ohlcv[i-1].close)
                    );
                    trs.push(tr);
                }
                const atr = trs.slice(-14).reduce((acc, v) => acc + v, 0) / 14;
                atrRatio = atr / entryPrice;
            }
        } catch (e) {
            logger.warn(`Could not fetch ATR for dynamic TP splitting. Using default ATR ratio: ${atrRatio}`);
        }

        // Volatility scaling factor: cap at 0.5 (maximum shift)
        const V = Math.min(0.5, 50 * atrRatio);
        const exponent = 1.0 - V;

        // Weights: inverse of RRR scaled by exponent
        const weights = rrrs.map(rrr => Math.pow(1.0 / Math.max(0.1, rrr), exponent));
        const sumWeights = weights.reduce((acc, w) => acc + w, 0);

        if (sumWeights <= 0) {
            return Array(targets.length).fill(100 / targets.length);
        }

        const splits = weights.map(w => (w / sumWeights) * 100);
        const total = splits.reduce((acc, s) => acc + s, 0);
        const adjustedSplits = splits.map(s => Math.round((s / total) * 100));

        const sumAdjusted = adjustedSplits.reduce((acc, s) => acc + s, 0);
        if (sumAdjusted !== 100) {
            adjustedSplits[adjustedSplits.length - 1] += (100 - sumAdjusted);
        }

        logger.info(`[Dynamic TP splits] Calculated for ${symbol}: ${adjustedSplits.join('% / ')}% based on RRR and ATR.`);
        return adjustedSplits;
    } catch (err) {
        logger.error('Error calculating dynamic TP splits, falling back to equal splits:', err);
        return Array(targets.length).fill(100 / targets.length);
    }
}

// Define return interface
export interface TradeResult {
    tradeId: string;
    symbol: string;
    direction: 'LONG' | 'SHORT';
    entryPrice: number;
    amount: number; // Quantity in coins
    margin: number; // USDT used
    marginPercentage: number; // % of total balance
    leverage: number;
    riskPercentage: number;
    targets: { price: number; pnlPercent: number }[];
    stopLoss: { price: number; pnlPercent: number };
    orderType: 'market' | 'limit'; // Resolved order type
    isPending: boolean; // true if limit order not yet filled
}

export class TradeManager {
    private bingx: BingXService;
    private static activeExecutionLocks: Set<string> = new Set();

    constructor(BingXService: BingXService) {
        this.bingx = BingXService;
    }

    async executeSignal(signal: ParsedSignal, userId: string, sourceChatId?: string): Promise<TradeResult | undefined> {
        const lockKey = `${userId}:${signal.symbol}`;
        if (TradeManager.activeExecutionLocks.has(lockKey)) {
            logger.warn(`[Concurrency Guard] Order processing already active for ${signal.symbol}. Skipping duplicate entry.`);
            return;
        }
        TradeManager.activeExecutionLocks.add(lockKey);

        try {
            const user = await User.findById(userId);
            if (!user || !user.isActive) {
                logger.warn(`User ${userId} not found or inactive`);
                return;
            }

            // 0. Institutional Circuit Breaker Guard (24h Daily Drawdown Protection)
            const cbStatus = await CircuitBreakerService.checkStatus(user.telegramId, this.bingx);
            if (cbStatus.isTripped) {
                const tripMsg = `🚨 [قاطع الدائرة الكهربائية مفعل] ${cbStatus.tripReason}. تم حظر فتح صفقات جديدة حتى: ${cbStatus.cooldownUntil?.toLocaleTimeString()}`;
                logger.error(tripMsg);
                throw new Error(tripMsg);
            }

            // 1. Calculate Position Size
            const balance = await this.bingx.getBalance();
            logger.info(`Available Balance: ${balance} USDT`);

            if (!balance || balance <= 0) {
                logger.error(`Cannot trade: Wallet balance is ${balance}`);
                throw new Error('Insufficient USDT Balance in Futures Wallet. Please ensure you have funds in your Perpetual Futures account.');
            }

            if (signal.type === 'CLOSE') {
                logger.info(`Processing CLOSE signal for ${signal.symbol}`);
                await this.closeSpecificPosition(userId, signal.symbol);
                return; // CLOSE signals don't return a TradeResult for now
            }

            // --- Standard Trade Execution ---
            if (signal.type === 'TRADE') {
                if (!signal.targets || !signal.stopLoss || !signal.direction) {
                    logger.error('Missing required trade components', { signal });
                    return;
                }

                // Check if HITLAR mode is enabled
                const isHitlar = user.hitlarModeEnabled;
                const hitlar = user.hitlarSettings || {
                    riskPercentage: 3,
                    leverage: 20,
                    volatilitySlPercentage: 5,
                    capitalProtectionEnabled: false,
                    orderMode: 'limit'
                };

                // Read user's order mode preference
                const userOrderMode: 'market' | 'limit' = isHitlar ? hitlar.orderMode : (user.orderMode || 'market');

                // Fetch current market price (needed for both modes)
                const currentMarketPrice = await this.bingx.getMarketPrice(signal.symbol);

                let entryPrice: number;
                let resolvedOrderType: 'market' | 'limit' = 'market'; // final resolved type

                if (userOrderMode === 'limit' && signal.entry && signal.entry.length > 0) {
                    const rawEntry = signal.entry[0];

                    // Smart check: for LONG, if entry > market → price already passed, use market
                    // For SHORT, if entry < market → price already passed, use market
                    const entryAlreadyPassed =
                        (signal.direction === 'LONG' && rawEntry > currentMarketPrice) ||
                        (signal.direction === 'SHORT' && rawEntry < currentMarketPrice);

                    if (entryAlreadyPassed) {
                        logger.warn(`[Limit→Market Fallback] Entry price (${rawEntry}) is past market (${currentMarketPrice}) for ${signal.direction}. Falling back to market order.`);
                        entryPrice = currentMarketPrice;
                        resolvedOrderType = 'market';
                    } else {
                        entryPrice = await this.bingx.priceToPrecision(signal.symbol, rawEntry);
                        resolvedOrderType = 'limit';
                        logger.info(`[Limit Order] Using entry price: ${entryPrice} for ${signal.symbol}`);
                    }
                } else {
                    // Market mode or no entry price in signal
                    if (signal.entry && signal.entry.length > 0) {
                        // Use signal entry for position sizing calculations only
                        entryPrice = await this.bingx.priceToPrecision(signal.symbol, signal.entry[0]);
                    } else {
                        entryPrice = currentMarketPrice;
                        logger.info(`No entry price provided for ${signal.symbol}. Using market price: ${entryPrice}`);
                    }
                    resolvedOrderType = 'market';
                }

                // 1.5 Calculate SL/TP prices
                let stopLossPrice = signal.stopLoss || 0;
                let takeProfitPrices = signal.targets || [];

                // Use Volatility SL if enabled OR if HITLAR mode is enabled OR if missing from signal + mitigation enabled
                const needsAutoSl = (stopLossPrice === 0 && user.errorMitigationEnabled);
                if (user.volatilitySlEnabled || isHitlar || needsAutoSl) {
                    const percentage = isHitlar ? hitlar.volatilitySlPercentage : (user.volatilitySlPercentage || 5);
                    if (signal.direction === 'LONG') {
                        stopLossPrice = entryPrice * (1 - percentage / 100);
                    } else {
                        stopLossPrice = entryPrice * (1 + percentage / 100);
                    }
                    if (needsAutoSl) {
                        logger.info(`[Auto-Mitigation] Missing SL for ${signal.symbol}. Applied volatility SL: ${stopLossPrice.toFixed(6)} (${percentage}%)`);
                    } else {
                        logger.info(`[${isHitlar ? 'HITLAR ' : ''}Volatility SL] Using calculated SL: ${stopLossPrice.toFixed(6)} (${percentage}%)`);
                    }
                }

                // Auto TP if missing + mitigation enabled
                if (takeProfitPrices.length === 0 && user.errorMitigationEnabled) {
                    const tpPercentage = (user.volatilitySlPercentage || 5) * 2;
                    const tp1 = signal.direction === 'LONG'
                        ? entryPrice * (1 + tpPercentage / 100)
                        : entryPrice * (1 - tpPercentage / 100);
                    takeProfitPrices = [tp1];
                    logger.info(`[Auto-Mitigation] Missing TP for ${signal.symbol}. Applied default TP: ${tp1.toFixed(6)} (${tpPercentage}%)`);
                }

                // Final Validation: If still missing, we cannot proceed
                if (stopLossPrice === 0 || takeProfitPrices.length === 0) {
                    const errMsg = `Trade rejected for ${signal.symbol}: Missing ${stopLossPrice === 0 ? 'SL' : 'TP'} and mitigation could not resolve it.`;
                    logger.error(errMsg);
                    throw new Error(errMsg);
                }

                // Final precision check
                stopLossPrice = await this.bingx.priceToPrecision(signal.symbol, stopLossPrice);
                const finalTpPrices = await Promise.all(takeProfitPrices.map(t => this.bingx.priceToPrecision(signal.symbol, t)));

                // 2. Position Sizing & Risk Caps
                let riskPercentage = isHitlar ? hitlar.riskPercentage : (signal.risk || user.riskPercentage || 2);
                if (riskPercentage > 100) riskPercentage = 100; // safety

                // --- 🛡️ Dynamic Drawdown Shield (Past 24h Drawdown > 5%) ---
                let finalRiskPercentage = riskPercentage;
                try {
                    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
                    const recentTrades = await Trade.find({
                        userId: user._id,
                        closeTime: { $gte: twentyFourHoursAgo },
                        currentStatus: { $in: ['CLOSED_PROFIT', 'CLOSED_LOSS', 'CLOSED_MANUAL'] }
                    });

                    let netPnL = 0;
                    for (const t of recentTrades) {
                        const margin = t.amount / (t.leverage || 10);
                        const tradePnlUSDT = margin * (t.pnl / 100);
                        netPnL += tradePnlUSDT;
                    }

                    if (netPnL < 0 && balance > 0) {
                        const drawdownPercentage = (Math.abs(netPnL) / balance) * 100;
                        if (drawdownPercentage >= 5) {
                            logger.warn(`[Dynamic Drawdown Shield] Active! Past 24h net loss is ${drawdownPercentage.toFixed(2)}% of equity (>= 5%). Reducing risk from ${riskPercentage}% to 1%.`);
                            finalRiskPercentage = 1;
                        }
                    }
                } catch (drawdownErr) {
                    logger.error('Error calculating 24h Drawdown Shield:', drawdownErr);
                }

                // 2.3 Institutional Correlation & Portfolio Heat Guard
                const corrResult = await CorrelationGuardService.validateTrade(signal.symbol, signal.direction, finalRiskPercentage, this.bingx);
                if (!corrResult.allowed) {
                    const corrMsg = `🚨 [حظر الارتباط ومخاطر المحفظة] ${corrResult.reason}`;
                    logger.warn(corrMsg);
                    throw new Error(corrMsg);
                }

                // 3. Leverage Calculation
                let leverage = 10;
                if (isHitlar) {
                    leverage = hitlar.leverage || 20;
                } else if (user.leverageMode === 'fixed') {
                    leverage = user.fixedLeverageValue || 10;
                } else {
                    // Default mode: use signal leverage or fallback to 10
                    leverage = signal.leverage || 10;
                }
                let marginUsed = balance * (finalRiskPercentage / 100);

                // 2.5 Total Exposure Limit check (Max 10%)
                const positions = await this.bingx.getPositions();
                let totalMarginUsed = 0;
                for (const pos of positions) {
                    const posMargin = pos.initialMargin || (pos.notional ? Math.abs(pos.notional) / (pos.leverage || 1) : 0);
                    totalMarginUsed += posMargin;
                }

                const maxAllowedExposure = balance * 0.10; // 10% max global risk
                const availableMarginForNewTrade = maxAllowedExposure - totalMarginUsed;

                if (availableMarginForNewTrade <= 0) {
                    const msg = `Trade rejected: Current total margin (${totalMarginUsed.toFixed(2)} USDT) has already reached or exceeded the 10% global exposure limit (${maxAllowedExposure.toFixed(2)} USDT).`;
                    logger.error(msg);
                    throw new Error(msg);
                }

                let scaledByExposure = false;
                if (marginUsed > availableMarginForNewTrade) {
                    logger.warn(`Requested margin (${marginUsed.toFixed(2)} USDT) exceeds the available remaining global limit. Scaling down to the remaining margin: ${availableMarginForNewTrade.toFixed(2)} USDT.`);
                    marginUsed = availableMarginForNewTrade;
                    scaledByExposure = true;
                }

                let positionSizeUSDT = marginUsed * leverage;

                // Calculate Contracts first to check sizes
                const rawAmount = positionSizeUSDT / entryPrice;
                let amountContracts = await this.bingx.amountToPrecision(signal.symbol, rawAmount);
                const minAmount = await this.bingx.getMarketMinAmount(signal.symbol);

                // Check min constraints immediately before SL check
                if (amountContracts === 0 || amountContracts < minAmount) {
                    let reason = `حجم الصفقة المطلوبة أصغر من الحد الأدنى المسموح به في المنصة (${minAmount}).`;
                    if (scaledByExposure) {
                        reason += `\n⚠️ تم تقليل الحجم إجبارياً بسبب وصولك للحد الأقصى للمخاطرة الكلية المفتوحة (10% من الحساب). لديك صفقات أخرى تستهلك الرصيد المسموح.`;
                    } else {
                        reason += `\nيرجى زيادة رأس المال أو رفع نسبة المخاطرة قليلاً لتتمكن من فتح صفقات بهذه العملة.`;
                    }
                    throw new Error(reason);
                }

                // --- Bingx  Minimum Notional Check (5 USDT) ---
                const MIN_NOTIONAL = 5.1; // Using 5.1 for safety margin
                if (user.errorMitigationEnabled && positionSizeUSDT < MIN_NOTIONAL) {
                    logger.warn(`Position notional (${positionSizeUSDT.toFixed(2)} USDT) is below minimum (${MIN_NOTIONAL} USDT). Scaling up to minimum.`);
                    positionSizeUSDT = MIN_NOTIONAL;
                    // Recalculate contracts based on new notional
                    const adjustedRawAmount = positionSizeUSDT / entryPrice;
                    amountContracts = await this.bingx.amountToPrecision(signal.symbol, adjustedRawAmount);
                }

                let scaledBySL = false;
                // 4.5 Maximum Stop Loss Capital Risk Limit Check (Max 6% Loss)
                const shouldEnforceMaxSlLoss = isHitlar ? hitlar.capitalProtectionEnabled : (
                    (user.enforceMaxSlLoss !== null && user.enforceMaxSlLoss !== undefined)
                        ? user.enforceMaxSlLoss
                        : process.env.ENFORCE_MAX_SL_LOSS === 'true'
                );

                if (shouldEnforceMaxSlLoss) {
                    // Maximum amount of money we are willing to lose completely if SL is hit
                    const maxSlRisk = (user.maxSlRiskPercentage || 6) / 100;
                    const maxAllowedSLLoss = balance * maxSlRisk;

                    // Calculate the literal price difference per coin
                    const lossPerCoin = Math.abs(entryPrice - stopLossPrice);

                    // If direction is long and SL is above entry (or short and SL below entry), it's not a loss, it's weird data, but we use Math.abs to be safe.
                    // The total USDT lost equals the number of coins * price delta per coin
                    const projectedLoss = amountContracts * lossPerCoin;

                    if (projectedLoss > maxAllowedSLLoss) {
                        // How many max coins can we afford to lose?
                        const maxSafeContracts = maxAllowedSLLoss / lossPerCoin;
                        const precisionSafeContracts = await this.bingx.amountToPrecision(signal.symbol, maxSafeContracts);

                        logger.warn(`Projected SL loss (${projectedLoss.toFixed(2)} USDT) exceeds ${(maxSlRisk * 100).toFixed(1)}% of capital (${maxAllowedSLLoss.toFixed(2)} USDT). Scaling down position to ${precisionSafeContracts} contracts.`);

                        amountContracts = precisionSafeContracts;

                        // We must also scale down the officially reserved margin needed to open this smaller trade, so the DB and API stays perfectly synced.
                        positionSizeUSDT = amountContracts * entryPrice;
                        marginUsed = positionSizeUSDT / leverage;
                        scaledBySL = true;
                    }
                }

                if (amountContracts === 0 || amountContracts < minAmount) {
                    let reason = `حجم الصفقة المطلوبة أصغر من الحد الأدنى المسموح به في المنصة (${minAmount}).`;
                    if (scaledBySL) {
                        const maxSlRisk = (user.maxSlRiskPercentage || 6) / 100;
                        const maxSlRiskPercentage = (maxSlRisk * 100).toFixed(1);
                        reason += `\n⚠️ تم تقليل الحجم إجبارياً لأن الخسارة المتوقعة من الاستوب لوز كانت ستتجاوز الحد الأقصى المسموح (${maxSlRiskPercentage}% من رصيد الحساب).`;
                    }
                    throw new Error(reason);
                }

                // 5. Set Leverage, Margin Mode, and Place Market Order
                await this.bingx.setMarginMode(signal.symbol, signal.marginMode || 'CROSS');
                try {
                    await this.bingx.setLeverage(signal.symbol, leverage, signal.direction);
                } catch (levErr: any) {
                    if (user.errorMitigationEnabled) {
                        logger.warn(`Failed to set leverage to ${leverage}x for ${signal.symbol}: ${levErr.message}. Continuing with existing leverage.`);
                    } else {
                        throw levErr;
                    }
                }

                // Detect position mode ONCE before placing orders
                const hedgeMode = await this.bingx.isHedgeMode();

                const tpExecutionMode = user.tpExecutionMode || 'multiple';
                const isMultiple = tpExecutionMode === 'multiple' && finalTpPrices.length > 1;

                let tpSplits: number[] = [];
                if (isMultiple) {
                    if (user.tpSplitMode === 'manual' && user.tpProfitSplits && user.tpProfitSplits.length >= finalTpPrices.length) {
                        tpSplits = user.tpProfitSplits;
                    } else {
                        // Calculate dynamic splits using mathematical equation
                        tpSplits = await calculateDynamicTpsSplits(
                            entryPrice,
                            stopLossPrice,
                            finalTpPrices,
                            signal.symbol,
                            this.bingx
                        );
                    }
                }

                let order: any;
                try {
                    const orderParams: any = {};
                    if (hedgeMode) {
                        // Hedge Mode: positionSide is required (LONG or SHORT)
                        orderParams.positionSide = signal.direction;
                    }

                    // Attach Stop Loss directly to the main order for safety
                    orderParams.stopLoss = {
                        triggerPrice: stopLossPrice,
                        type: 'STOP_MARKET'
                    };

                    // Only attach TP1 directly to the main order if NOT multiple
                    if (!isMultiple) {
                        orderParams.takeProfit = {
                            triggerPrice: finalTpPrices[0],
                            type: 'TAKE_PROFIT_MARKET'
                        };
                    }

                    const executionPrice = resolvedOrderType === 'limit' ? entryPrice : undefined;

                    order = await this.bingx.placeOrder(
                        signal.symbol,
                        resolvedOrderType,
                        signal.direction === 'LONG' ? 'buy' : 'sell',
                        amountContracts,
                        executionPrice,
                        orderParams
                    );

                    logger.info(`[Order Placed] Type: ${resolvedOrderType.toUpperCase()}, Price: ${executionPrice || 'MARKET'}, Qty: ${amountContracts}`);

                } catch (err: any) {
                    // Retry with 50% size if Insufficient Margin
                    if (err.message && err.message.includes('Insufficient margin')) {
                        logger.warn(`Insufficient margin for full size. Retrying with 50% size...`);
                        const reducedAmount = amountContracts * 0.5;
                        const retryParams: any = {};
                        const hedgeModeRetry = await this.bingx.isHedgeMode();
                        if (hedgeModeRetry) {
                            retryParams.positionSide = signal.direction;
                        }

                        retryParams.stopLoss = {
                            triggerPrice: stopLossPrice,
                            type: 'STOP_MARKET'
                        };
                        retryParams.takeProfit = {
                            triggerPrice: finalTpPrices[0],
                            type: 'TAKE_PROFIT_MARKET'
                        };

                        const executionPriceRetry = resolvedOrderType === 'limit' ? entryPrice : undefined;

                        order = await this.bingx.placeOrder(
                            signal.symbol,
                            resolvedOrderType,
                            signal.direction === 'LONG' ? 'buy' : 'sell',
                            reducedAmount,
                            executionPriceRetry,
                            retryParams
                        );
                    } else if (err.message && err.message.includes('PositionSide')) {
                        logger.warn(`Position mode mismatch detected. Retrying with flipped hedgeMode assumption...`);
                        const retryParams: any = {};

                        // Flip the assumption: if hedgeMode was true, we didn't send positionSide. 
                        // Wait, if hedgeMode was true, we DID send positionSide. So we remove it.
                        // If hedgeMode was false, we didn't send it, so we ADD it.
                        if (!hedgeMode) {
                            retryParams.positionSide = signal.direction;
                        }

                        retryParams.stopLoss = {
                            triggerPrice: stopLossPrice,
                            type: 'STOP_MARKET'
                        };
                        retryParams.takeProfit = {
                            triggerPrice: finalTpPrices[0],
                            type: 'TAKE_PROFIT_MARKET'
                        };

                        const executionPriceRetry = resolvedOrderType === 'limit' ? entryPrice : undefined;

                        order = await this.bingx.placeOrder(
                            signal.symbol,
                            resolvedOrderType,
                            signal.direction === 'LONG' ? 'buy' : 'sell',
                            amountContracts,
                            executionPriceRetry,
                            retryParams
                        );
                    } else {
                        throw err;
                    }
                }

                const tradeLog = resolvedOrderType === 'limit'
                    ? `Limit order placed at ${entryPrice} on ${new Date().toISOString()} via Signal. Risk: ${finalRiskPercentage}%, Lev: ${leverage}x. SL/TP pending fill.`
                    : `Opened trade at ${new Date().toISOString()} via Signal. Risk: ${finalRiskPercentage}%, Lev: ${leverage}x`;

                const trade = new Trade({
                    userId: user._id,
                    symbol: signal.symbol,
                    direction: signal.direction,
                    entryPrice: order.average || entryPrice,
                    stopLoss: stopLossPrice,
                    targets: finalTpPrices.map(t => ({ price: t, hit: false })),
                    amount: positionSizeUSDT,
                    leverage: leverage,
                    bingxOrderId: order.id,
                    sourceChatId: sourceChatId,
                    currentStatus: resolvedOrderType === 'limit' && order.status === 'open' ? 'PENDING' : 'OPEN',
                    logs: [tradeLog],
                    engineId: signal.engineId
                });
                await trade.save();

                logger.info(`✅ Trade successfully executed for ${signal.symbol}: ${order.id}`);

                // 6.5 Place separate split Take Profit limit orders if multiple targets are active
                if (isMultiple) {
                    logger.info(`[Dynamic TP Execution] Placing separate split Take Profit orders...`);
                    let remainingAmount = amountContracts;
                    const closeSide = signal.direction === 'LONG' ? 'sell' : 'buy';

                    for (let i = 0; i < finalTpPrices.length; i++) {
                        const tpPrice = finalTpPrices[i];
                        const isLastTP = i === finalTpPrices.length - 1;

                        const portionSize = amountContracts * (tpSplits[i] / 100);
                        let tpAmount = isLastTP ? remainingAmount : portionSize;
                        tpAmount = await this.bingx.amountToPrecision(signal.symbol, tpAmount);

                        if (tpAmount <= 0) continue;

                        try {
                            const tpParams: any = {
                                stopPrice: tpPrice,
                                type: 'TAKE_PROFIT'
                            };
                            if (hedgeMode) {
                                tpParams.positionSide = signal.direction;
                            } else {
                                tpParams.reduceOnly = true;
                            }

                            await this.bingx.placeOrder(signal.symbol, 'market', closeSide, tpAmount, undefined, {
                                stopPrice: tpPrice,
                                type: 'TAKE_PROFIT',
                                ...tpParams
                            });
                            remainingAmount -= tpAmount;
                            logger.info(`✅ Dynamic Take Profit placed at ${tpPrice.toFixed(6)} (${tpAmount} contracts) representing ${tpSplits[i]}%`);
                        } catch (err: any) {
                            logger.error(`❌ Failed to place split Take Profit at ${tpPrice.toFixed(6)}: ${err.message}`);
                        }
                    }
                } else if (resolvedOrderType === 'market' || order.status === 'closed' || order.status === 'filled') {
                    logger.info(`✅ Main order executed. Attached SL at ${stopLossPrice.toFixed(6)} and TP at ${finalTpPrices[0].toFixed(6)} are active.`);
                } else {
                    logger.info(`⏳ [Limit Order] Attached SL and TP will activate when order ${order.id} is filled.`);
                }


                // 7. Calculate PnL stats for reporting
                const calculatePnL = (entry: number, exit: number, direction: string, lev: number) => {
                    const diff = direction === 'LONG' ? (exit - entry) : (entry - exit);
                    return (diff / entry) * 100 * lev;
                };

                const targetsResult = signal.targets.map(t => ({
                    price: t,
                    pnlPercent: parseFloat(calculatePnL(entryPrice, t, signal.direction!, leverage).toFixed(6))
                }));

                const slResult = {
                    price: stopLossPrice,
                    pnlPercent: parseFloat(calculatePnL(entryPrice, stopLossPrice, signal.direction!, leverage).toFixed(6))
                };

                const marginPercentage = parseFloat(((marginUsed / balance) * 100).toFixed(2));

                return {
                    tradeId: trade._id.toString(),
                    symbol: signal.symbol,
                    direction: signal.direction!,
                    entryPrice: parseFloat((order.average || entryPrice).toFixed(6)),
                    amount: parseFloat(amountContracts.toFixed(6)),
                    margin: parseFloat(marginUsed.toFixed(6)),
                    marginPercentage,
                    leverage,
                    riskPercentage: finalRiskPercentage,
                    targets: targetsResult,
                    stopLoss: slResult,
                    orderType: resolvedOrderType,
                    isPending: resolvedOrderType === 'limit' && order.status === 'open'
                };

            }

        } catch (error) {
            logger.error('Error executing trade:', error);
            throw error;
        } finally {
            TradeManager.activeExecutionLocks.delete(lockKey);
        }
    }

    async closeAllPositions(userId: string): Promise<number> {
        let closedCount = 0;
        try {
            const user = await User.findById(userId);
            if (!user) throw new Error('User not found');

            const positions = await this.bingx.getPositions();
            if (!positions || positions.length === 0) {
                return 0; // No positions to close
            }

            for (const pos of positions) {
                if (parseFloat(pos.contracts) === 0) continue;

                try {
                    const side = pos.side.toLowerCase() === 'long' ? 'sell' : 'buy';
                    const hedgeMode = await this.bingx.isHedgeMode();
                    const closeParams: any = {};
                    if (hedgeMode) {
                        closeParams.positionSide = pos.side.toUpperCase();
                    } else {
                        closeParams.reduceOnly = true;
                    }
                    await this.bingx.placeOrder(
                        pos.symbol,
                        'market',
                        side,
                        parseFloat(pos.contracts),
                        undefined,
                        closeParams
                    );
                    logger.info(`✅ Successfully closed ${pos.side} position for ${pos.symbol} via 'Close All'`);
                    closedCount++;

                    // Optimistically update the database
                    // await Trade.updateMany(
                    //     { userId: user._id, symbol: pos.symbol, currentStatus: 'OPEN' },
                    //     { currentStatus: 'CLOSED_MANUAL', closeTime: new Date() } // We'll use CLOSED_MANUAL
                    // );

                } catch (err: any) {
                    logger.error(`Failed to close position ${pos.symbol}: ${err.message}`);
                }
            }
        } catch (error: any) {
            logger.error('Error in closeAllPositions:', error);
            throw error;
        }
        return closedCount;
    }

    async closeSpecificPosition(userId: string, symbol: string): Promise<boolean> {
        try {
            const user = await User.findById(userId);
            if (!user) throw new Error('User not found');

            const matchedSymbol = symbol.includes('USDT') ? symbol.toUpperCase() : `${symbol.toUpperCase()}/USDT:USDT`;
            const positions = await this.bingx.getPositions(matchedSymbol);

            // Filter out empty
            const activePos = positions.filter((p: any) => parseFloat(p.contracts) > 0);

            if (activePos.length === 0) {
                logger.info(`No open positions found for ${matchedSymbol} to close.`);
                return false;
            }

            for (const pos of activePos) {
                const side = pos.side.toLowerCase() === 'long' ? 'sell' : 'buy';
                const amount = parseFloat(pos.contracts);
                const hedgeMode = await this.bingx.isHedgeMode();
                const closeParams: any = {};
                if (hedgeMode) {
                    closeParams.positionSide = pos.side.toUpperCase();
                } else {
                    closeParams.reduceOnly = true;
                }
                await this.bingx.placeOrder(
                    pos.symbol,
                    'market',
                    side,
                    amount,
                    undefined,
                    closeParams
                );
                logger.info(`✅ Successfully closed ${pos.side} position for ${pos.symbol} via 'Close Specific'`);

                // Optimistically update DB
                // await Trade.updateMany(
                //     { userId: user._id, symbol: pos.symbol, currentStatus: 'OPEN' },
                //     { currentStatus: 'CLOSED_MANUAL', closeTime: new Date() }
                // );
            }
            return true;
        } catch (error: any) {
            logger.error(`Error closing position for ${symbol}:`, error);
            throw error;
        }
    }
}
