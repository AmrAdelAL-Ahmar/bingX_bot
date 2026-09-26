import { BingXService } from '../../services/BingXService';
import { TechnicalAnalyzer } from './TechnicalAnalyzer';
import { EMA } from 'technicalindicators';
import { OHLCV } from '../shared/types';
import logger from '../../utils/logger';

export interface BtcCompassReport {
    timestamp: number;
    currentBtcPrice: number;
    trend15m: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
    macroTrend: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
    isAboveVwap: boolean;
    isBlackout: boolean;
    blackoutReason?: string;
    allowLongs: boolean;
    allowShorts: boolean;
    btcChange15m: number;
    change15mPct: number;
    btcChange1h: number;
    ema20: number;
    ema50: number;
    statusSummary: string;
}

export class BtcMarketCompass {
    private static cachedReport: BtcCompassReport | null = null;
    private static lastCheckTime: number = 0;
    private static readonly CACHE_TTL_MS = 60 * 1000; // 1-minute cache

    /**
     * Analyzes Bitcoin (BTC/USDT) to establish the macro market compass
     */
    static async getMarketCompass(bingx: BingXService, forceRefresh = false): Promise<BtcCompassReport> {
        const now = Date.now();
        if (!forceRefresh && this.cachedReport && (now - this.lastCheckTime < this.CACHE_TTL_MS)) {
            return this.cachedReport;
        }

        const btcSymbol = 'BTC/USDT:USDT';

        try {
            const [candles15m, candles1h, candles1d] = await Promise.all([
                bingx.fetchOHLCV(btcSymbol, '15m', 50).catch(() => [] as OHLCV[]),
                bingx.fetchOHLCV(btcSymbol, '1h', 50).catch(() => [] as OHLCV[]),
                bingx.fetchOHLCV(btcSymbol, '1d', 30).catch(() => [] as OHLCV[])
            ]);

            if (!candles15m || candles15m.length < 25) {
                return this.createFallbackReport();
            }

            const currentPrice = candles15m[candles15m.length - 1].close;
            const prev15mClose = candles15m[candles15m.length - 2].close;
            const btcChange15m = ((currentPrice - prev15mClose) / prev15mClose) * 100;

            const prev1hClose = candles1h && candles1h.length >= 2 ? candles1h[candles1h.length - 2].close : currentPrice;
            const btcChange1h = ((currentPrice - prev1hClose) / prev1hClose) * 100;

            // 1. Check for Sudden Crash / Violent Blackout (Drop > 1.2% in 15m)
            const isBlackout = btcChange15m <= -1.20 || btcChange1h <= -2.50;
            const blackoutReason = isBlackout ? `هبوط عنيف في البيتكوين (${btcChange15m.toFixed(2)}% في 15 دقيقة)` : undefined;

            // 2. Institutional VWAP positioning
            const vwap = candles1d && candles1d.length > 0
                ? TechnicalAnalyzer.calculateVWAP(candles1d)
                : currentPrice;
            const isAboveVwap = currentPrice >= vwap;

            // 3. 15m Exponential Moving Averages (EMA 20 vs EMA 50)
            const closes15m = candles15m.map((c: OHLCV) => c.close);
            const ema20Arr = EMA.calculate({ period: 20, values: closes15m });
            const ema50Arr = EMA.calculate({ period: 50, values: closes15m });
            const ema20 = ema20Arr[ema20Arr.length - 1] || currentPrice;
            const ema50 = ema50Arr[ema50Arr.length - 1] || currentPrice;

            let trend15m: 'BULLISH' | 'BEARISH' | 'NEUTRAL' = 'NEUTRAL';
            if (currentPrice > ema20 && ema20 >= ema50) {
                trend15m = 'BULLISH';
            } else if (currentPrice < ema20 && ema20 <= ema50) {
                trend15m = 'BEARISH';
            }

            // 4. Directional Permissions
            let allowLongs = false;
            let allowShorts = false;
            let statusSummary = '';

            if (isBlackout) {
                allowLongs = false;
                allowShorts = false;
                statusSummary = `🚨 حظر انهيار البيتكوين (تغير ${btcChange15m.toFixed(2)}% في 15 دقيقة) - تجميد الصفقات مؤقتاً`;
            } else if (trend15m === 'BULLISH' && isAboveVwap) {
                allowLongs = true;
                allowShorts = false;
                statusSummary = `🟢 بيتكوين صاعد بقوة (فوق VWAP بـ $${currentPrice.toFixed(0)}) | السماح بالشراء LONG فقط`;
            } else if (trend15m === 'BEARISH' || !isAboveVwap) {
                allowLongs = false;
                allowShorts = true;
                statusSummary = `🔴 بيتكوين هابط/تحت VWAP ($${currentPrice.toFixed(0)}) | حظر الشراء وتوجيه الصفقات للبيع SHORT`;
            } else {
                allowLongs = currentPrice >= ema20;
                allowShorts = currentPrice <= ema20;
                statusSummary = `⚪ بيتكوين في تذبذب عرضي ($${currentPrice.toFixed(0)}) | السماح بكلا الاتجاهين بحذر`;
            }

            const report: BtcCompassReport = {
                timestamp: now,
                currentBtcPrice: currentPrice,
                trend15m,
                macroTrend: trend15m,
                isAboveVwap,
                isBlackout,
                blackoutReason,
                allowLongs,
                allowShorts,
                btcChange15m,
                change15mPct: btcChange15m,
                btcChange1h,
                ema20,
                ema50,
                statusSummary
            };

            this.cachedReport = report;
            this.lastCheckTime = now;
            return report;
        } catch (error: any) {
            logger.warn(`[BtcMarketCompass] Failed to evaluate BTC compass: ${error.message}`);
            return this.createFallbackReport();
        }
    }

    private static createFallbackReport(): BtcCompassReport {
        return {
            timestamp: Date.now(),
            currentBtcPrice: 0,
            trend15m: 'NEUTRAL',
            macroTrend: 'NEUTRAL',
            isAboveVwap: true,
            isBlackout: false,
            allowLongs: true,
            allowShorts: true,
            btcChange15m: 0,
            change15mPct: 0,
            btcChange1h: 0,
            ema20: 0,
            ema50: 0,
            statusSummary: '⚪ تقرير البيتكوين الاحتياطي (محايد)'
        };
    }
}
