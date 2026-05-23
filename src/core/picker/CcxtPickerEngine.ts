import * as ccxt from 'ccxt';
import MarketScanner from '../../models/MarketScannerModel';
import { PickerResult } from './CurrencyPickerEngine';
import logger from '../../utils/logger';

export class CcxtPickerEngine {
    private exchange: ccxt.Exchange;

    constructor() {
        this.exchange = new ccxt.bybit({
            enableRateLimit: true,
            options: { 'defaultType': 'swap' }
        });
    }

    /**
     * Runs the professional CCXT-based market scan
     */
    async run(limit: number = 20, onProgress?: (done: number, total: number) => void): Promise<PickerResult[]> {
        try {
            logger.info('🔄 [CcxtPickerEngine] Loading markets and fetching tickers from Bybit...');
            await this.exchange.loadMarkets();
            const allTickers = await this.exchange.fetchTickers();

            // Filter for USDT perpetual contracts
            const symbols = Object.keys(allTickers).filter(symbol => 
                symbol.endsWith('/USDT:USDT') || (symbol.endsWith('USDT') && !symbol.includes('/'))
            );

            if (symbols.length === 0) {
                logger.warn('[CcxtPickerEngine] No USDT perpetual symbols found on Bybit');
                return [];
            }

            // Sort symbols by quote volume descending
            const sortedSymbols = symbols
                .map(sym => {
                    const ticker = allTickers[sym];
                    const volume = ticker ? (ticker.quoteVolume ?? ((ticker.baseVolume ?? 0) * (ticker.last ?? 0))) : 0;
                    return { symbol: sym, volume };
                })
                .sort((a, b) => b.volume - a.volume)
                .map(x => x.symbol);

            // Take a healthy pool to scan (top Math.max(limit + 15, 35) to find enough qualified non-choppy coins)
            const scanPoolSize = Math.max(limit + 15, 35);
            const targetSymbols = sortedSymbols.slice(0, scanPoolSize);

            logger.info(`[CcxtPickerEngine] Scanning top ${targetSymbols.length} high-volume symbols...`);

            const qualifiedPairs: PickerResult[] = [];
            let done = 0;
            const total = targetSymbols.length;

            // Batch size to respect rate limits
            const BATCH_SIZE = 5;

            for (let i = 0; i < targetSymbols.length; i += BATCH_SIZE) {
                const batch = targetSymbols.slice(i, i + BATCH_SIZE);

                await Promise.all(
                    batch.map(async (symbol) => {
                        try {
                            const ticker = allTickers[symbol];
                            if (!ticker) return;

                            const volume24h = ticker.quoteVolume ?? ((ticker.baseVolume ?? 0) * (ticker.last ?? 0));
                            const currentPrice = ticker.last;
                            const change24h = ticker.percentage ?? 0;

                            // 1. Liquidity filter (min 15M USDT)
                            const MIN_VOLUME_USDT = 15000000;
                            if (volume24h < MIN_VOLUME_USDT) return;

                            // Fetch candles
                            const [ohlcv1D, ohlcv4H] = await Promise.all([
                                this.exchange.fetchOHLCV(symbol, '1d', undefined, 20).catch(() => []),
                                this.exchange.fetchOHLCV(symbol, '4h', undefined, 20).catch(() => [])
                            ]);

                            if (ohlcv1D.length < 15 || ohlcv4H.length < 15) return;

                            // 2. Market Structure (SMC)
                            const structureResult = this.analyzeStructure(ohlcv1D, ohlcv4H);
                            if (structureResult.trend === 'CHOPPY') return; // Skip choppy/sideways markets

                            // 3. Statistical Volatility (ATR 14 on 1D candles)
                            const atr14 = this.calculateATR(ohlcv1D, 14);
                            if (!currentPrice || currentPrice === 0) return;

                            const atrPercentage = (atr14 / currentPrice) * 100;

                            let atrScore = 0;
                            if (atrPercentage >= 1.5 && atrPercentage <= 5.0) {
                                atrScore = 30; // Excellent daily volatility for trading
                            } else if (atrPercentage > 5.0) {
                                atrScore = 15; // High volatility / risk
                            } else {
                                atrScore = 5;  // Low movement
                            }

                            // 4. Fundamental Catalyst (Volume Pump)
                            let fundamentalScore = 10;
                            // Calculate average daily volume over the 20 days
                            const avgVolume = ohlcv1D.reduce((acc: number, c: any) => acc + (c[5] * c[4]), 0) / ohlcv1D.length;
                            if (volume24h > avgVolume * 1.5) {
                                fundamentalScore += 20; // Abnormal volume pump detected!
                            }

                            const totalScore = structureResult.score + atrScore + fundamentalScore;

                            // Save results to MongoDB
                            const updatedDoc = await MarketScanner.findOneAndUpdate(
                                { symbol: symbol },
                                {
                                    symbol: symbol,
                                    marketType: 'CRYPTO',
                                    volume24h: volume24h,
                                    structure1D: structureResult.trend1D,
                                    structure4H: structureResult.trend4H,
                                    atr14_1D: atr14,
                                    atrPercentage: atrPercentage,
                                    finalScore: totalScore,
                                    lastUpdated: new Date()
                                },
                                { upsert: true, new: true }
                            );

                            // Calculate RSI from 4H candles to show in UI
                            const rsi4h = this.calculateRSI(ohlcv4H, 14);

                            const trendLabel = structureResult.trend1D === 'BULLISH' && structureResult.trend4H === 'BULLISH' 
                                ? 'صاعد 📈' 
                                : 'هابط 📉';

                            const reasonLabel = `SMC: ${structureResult.trend1D}/${structureResult.trend4H} | ATR: ${atrPercentage.toFixed(1)}%${fundamentalScore > 10 ? ' | ⚡ Volume Pump' : ''}`;

                            qualifiedPairs.push({
                                symbol: symbol,
                                shortName: symbol.split('/')[0],
                                score: totalScore,
                                label: totalScore >= 70 ? 'READY' : totalScore >= 45 ? 'WATCH' : 'AVOID',
                                volume24h: volume24h,
                                change24h: change24h,
                                rsi15m: rsi4h,
                                trend: trendLabel,
                                reason: reasonLabel,
                                scannedAt: new Date()
                            });

                        } catch (err: any) {
                            logger.warn(`⚠️ [CcxtPickerEngine] Error scanning single symbol ${symbol}: ${err.message}`);
                        }
                    })
                );

                done += batch.length;
                onProgress?.(Math.min(done, total), total);

                // Small delay to avoid hitting Bybit rate limits
                if (i + BATCH_SIZE < targetSymbols.length) {
                    await new Promise(r => setTimeout(r, 200));
                }
            }

            // Sort descending by score and slice to requested limit
            const ranked = qualifiedPairs.sort((a, b) => b.score - a.score).slice(0, limit);
            logger.info(`🏆 [CcxtPickerEngine] Scan complete. Top ${ranked.length} qualified symbols found.`);
            return ranked;

        } catch (error: any) {
            logger.error("🚨 [CcxtPickerEngine] Error in main scan run:", error);
            return [];
        }
    }

    /**
     * Calculates the ATR 14 from daily candles
     */
    private calculateATR(ohlcv: any[], period = 14): number {
        const trueRanges: number[] = [];
        for (let i = 1; i < ohlcv.length; i++) {
            const currentHigh = ohlcv[i][2];
            const currentLow = ohlcv[i][3];
            const previousClose = ohlcv[i - 1][4];

            const tr1 = currentHigh - currentLow;
            const tr2 = Math.abs(currentHigh - previousClose);
            const tr3 = Math.abs(currentLow - previousClose);

            const trueRange = Math.max(tr1, tr2, tr3);
            trueRanges.push(trueRange);
        }

        const recentTr = trueRanges.slice(-period);
        const sum = recentTr.reduce((acc, val) => acc + val, 0);
        return sum / Math.max(recentTr.length, 1);
    }

    /**
     * Calculates the manual RSI 14
     */
    private calculateRSI(ohlcv: any[], period = 14): number {
        if (ohlcv.length < period + 1) return 50;
        const closes = ohlcv.map(c => c[4]);
        
        let gains = 0;
        let losses = 0;
        for (let i = 1; i <= period; i++) {
            const diff = closes[i] - closes[i - 1];
            if (diff > 0) gains += diff;
            else losses -= diff;
        }

        let avgGain = gains / period;
        let avgLoss = losses / period;

        for (let i = period + 1; i < closes.length; i++) {
            const diff = closes[i] - closes[i - 1];
            const gain = diff > 0 ? diff : 0;
            const loss = diff < 0 ? -diff : 0;
            avgGain = (avgGain * (period - 1) + gain) / period;
            avgLoss = (avgLoss * (period - 1) + loss) / period;
        }

        if (avgLoss === 0) return 100;
        const rs = avgGain / avgLoss;
        return Math.round(100 - (100 / (1 + rs)));
    }

    /**
     * Analyzes structure by comparing current close with past close
     */
    private analyzeStructure(ohlcv1D: any[], ohlcv4H: any[]) {
        const getTrend = (candles: any[]) => {
            const lastIndex = candles.length - 1;
            const closeCurrent = candles[lastIndex][4];
            const closePast = candles[lastIndex - 10][4]; // Compare current price with 10 candles ago

            if (closeCurrent > closePast) return 'BULLISH';
            if (closeCurrent < closePast) return 'BEARISH';
            return 'CHOPPY';
        };

        const trend1D = getTrend(ohlcv1D);
        const trend4H = getTrend(ohlcv4H);

        let score = 0;
        let finalTrend = 'CHOPPY';

        if (trend1D === 'BULLISH' && trend4H === 'BULLISH') {
            score = 40; // Synchronized strong bullish
            finalTrend = 'TRENDING';
        } else if (trend1D === 'BEARISH' && trend4H === 'BEARISH') {
            score = 40; // Synchronized strong bearish
            finalTrend = 'TRENDING';
        } else {
            score = 10; // Mixed trends, non-clear structure
            finalTrend = 'CHOPPY';
        }

        return { trend: finalTrend, trend1D, trend4H, score };
    }
}
