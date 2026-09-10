import { ITradingEngine, EngineResult } from './ITradingEngine';
import { AnalysisDetails, MatrixResult, OHLCV, TradeRecommendation } from '../../shared/types';

export interface OrderBookLevel {
    price: number;
    size: number;
}

export interface OrderBookData {
    bids: OrderBookLevel[];
    asks: OrderBookLevel[];
}

export interface MicrostructureAnalysis {
    imbalance: number; // -1.0 (Heavy Sell) to +1.0 (Heavy Buy)
    totalBidVolume: number;
    totalAskVolume: number;
    bidWallPrice?: number;
    askWallPrice?: number;
    pressure: 'BUY_HEAVY' | 'SELL_HEAVY' | 'BALANCED';
    details: string;
}

export class V18Engine implements ITradingEngine {
    /**
     * Calculates L2 Order Book Depth Imbalance and Liquidity Walls
     */
    static analyzeDepth(orderBook: OrderBookData): MicrostructureAnalysis {
        if (!orderBook || !orderBook.bids || !orderBook.asks || orderBook.bids.length === 0 || orderBook.asks.length === 0) {
            return {
                imbalance: 0,
                totalBidVolume: 0,
                totalAskVolume: 0,
                pressure: 'BALANCED',
                details: 'بيانات عمق السوق غير متوفرة'
            };
        }

        const totalBidVolume = orderBook.bids.reduce((acc, b) => acc + b.size, 0);
        const totalAskVolume = orderBook.asks.reduce((acc, a) => acc + a.size, 0);
        const denom = totalBidVolume + totalAskVolume || 1;

        const imbalance = Number(((totalBidVolume - totalAskVolume) / denom).toFixed(3));

        // Find largest bid and ask walls
        const maxBid = orderBook.bids.reduce((max, b) => b.size > max.size ? b : max, orderBook.bids[0]);
        const maxAsk = orderBook.asks.reduce((max, a) => a.size > max.size ? a : max, orderBook.asks[0]);

        let pressure: 'BUY_HEAVY' | 'SELL_HEAVY' | 'BALANCED' = 'BALANCED';
        if (imbalance >= 0.25) {
            pressure = 'BUY_HEAVY';
        } else if (imbalance <= -0.25) {
            pressure = 'SELL_HEAVY';
        }

        return {
            imbalance,
            totalBidVolume,
            totalAskVolume,
            bidWallPrice: maxBid.price,
            askWallPrice: maxAsk.price,
            pressure,
            details: `L2 Imbalance: ${(imbalance * 100).toFixed(1)}% | ضغط السيولة: ${pressure}`
        };
    }

    /**
     * Fallback to synthetic microstructure using recent volume delta when depth isn't passed
     */
    static estimateFromCandles(candles: OHLCV[]): MicrostructureAnalysis {
        if (!candles || candles.length < 10) {
            return { imbalance: 0, totalBidVolume: 0, totalAskVolume: 0, pressure: 'BALANCED', details: 'بيانات غير كافية' };
        }

        let buyVol = 0;
        let sellVol = 0;

        for (let i = candles.length - 10; i < candles.length; i++) {
            const c = candles[i];
            const range = c.high - c.low || 0.0001;
            const buyRatio = (c.close - c.low) / range;
            const sellRatio = (c.high - c.close) / range;

            buyVol += c.volume * buyRatio;
            sellVol += c.volume * sellRatio;
        }

        const denom = buyVol + sellVol || 1;
        const imbalance = Number(((buyVol - sellVol) / denom).toFixed(3));
        const pressure = imbalance >= 0.20 ? 'BUY_HEAVY' : imbalance <= -0.20 ? 'SELL_HEAVY' : 'BALANCED';

        return {
            imbalance,
            totalBidVolume: buyVol,
            totalAskVolume: sellVol,
            pressure,
            details: `Volume Delta Imbalance: ${(imbalance * 100).toFixed(1)}%`
        };
    }

    analyze(
        cp: number,
        vwap: number,
        allTimeframes: Record<string, AnalysisDetails>,
        mtfOHLCV: Record<string, OHLCV[]>,
        options: { quickTF: string; longTF: string; params?: Record<string, any> }
    ): EngineResult {
        const quickTF = options.quickTF || '5m';
        const longTF = options.longTF || '1h';

        const quickCandles = mtfOHLCV[quickTF] || mtfOHLCV['5m'] || [];
        const micro = options.params?.orderBook
            ? V18Engine.analyzeDepth(options.params.orderBook)
            : V18Engine.estimateFromCandles(quickCandles);

        let matrixScore = 50;
        let scalpType: 'LONG' | 'SHORT' | 'NONE' = 'NONE';
        let decision = 'محايد - تدفق السيولة متوازن بين العرض والطلب';

        if (micro.pressure === 'BUY_HEAVY') {
            matrixScore = Math.min(95, 75 + Math.round(micro.imbalance * 30));
            scalpType = 'LONG';
            decision = `🟢 تدفق سيولة شرائية قوية في دفتر الأوامر (L2 Buy Imbalance +${(micro.imbalance * 100).toFixed(1)}%)`;
        } else if (micro.pressure === 'SELL_HEAVY') {
            matrixScore = Math.max(5, 25 + Math.round(micro.imbalance * 30));
            scalpType = 'SHORT';
            decision = `🔴 ضغط بيعي جداري في دفتر الأوامر (L2 Sell Imbalance ${(micro.imbalance * 100).toFixed(1)}%)`;
        }

        const matrix: MatrixResult = {
            score: matrixScore,
            percentage: matrixScore,
            decision,
            details: micro.details
        };

        const atr = allTimeframes[quickTF]?.atr || cp * 0.01;
        const scalpRec: TradeRecommendation = scalpType !== 'NONE' ? {
            status: `V18_${micro.pressure}`,
            type: scalpType,
            entry: cp,
            tp: scalpType === 'LONG' ? Number((cp + atr * 2).toFixed(4)) : Number((cp - atr * 2).toFixed(4)),
            tp2: scalpType === 'LONG' ? Number((cp + atr * 3.2).toFixed(4)) : Number((cp - atr * 3.2).toFixed(4)),
            sl: scalpType === 'LONG' ? Number((cp - atr * 1.3).toFixed(4)) : Number((cp + atr * 1.3).toFixed(4)),
            timeEstimate: 15,
            winRate: 88,
            reverseProb: 12,
            signalReason: `V18 Order Flow: ${micro.pressure}`
        } : {
            status: 'BALANCED_FLOW',
            type: 'NONE',
            entry: cp,
            tp: cp,
            sl: cp,
            timeEstimate: 0,
            winRate: 50,
            reverseProb: 50,
            rejectionReason: 'دفتر الأوامر متوازن ولا توجد فجوة سيولة واضحة'
        };

        return {
            matrix,
            scalp: scalpRec,
            swing: { ...scalpRec, timeEstimate: 60 }
        };
    }
}
