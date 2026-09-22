import logger from '../utils/logger';
import { BingXService } from './BingXService';
import { CurrencyPickerEngine, PickerResult, SymbolScanData } from '../core/picker/CurrencyPickerEngine';
import { CcxtPickerEngine } from '../core/picker/CcxtPickerEngine';

// ─── قائمة العملات للفحص (~50 عملة مشهورة) ─────────────────────────────────
// يمكن تعديل هذه القائمة لإضافة أو حذف عملات مستقبلاً

export const SCAN_SYMBOLS = [
    'BTC', 'ETH', 'SOL', 'BNB', 'XRP', 'DOGE', 'ADA', 'AVAX',
    'DOT', 'LINK', 'LTC', 'UNI', 'ATOM', 'FIL', 'APT',
    'ARB', 'OP', 'INJ', 'SUI', 'TRX', 'NEAR', 'PEPE', 'SAND',
    'MANA', 'AAVE', 'SNX', 'CRV', 'COMP', '1INCH', 'ZIL',
    'ALGO', 'VET', 'THETA', 'GRT', 'ICP', 'RENDER', 'CHZ',
    'ENJ', 'GALA', 'AXS', 'ROSE', 'HBAR', 'EGLD', 'FLOW',
    'POL', 'IMX', 'RUNE', 'STX', 'KAVA', 'WLD', 'FET', 'TAO'
];

// ─── SymbolPickerService ─────────────────────────────────────────────────────

export class SymbolPickerService {
    private bingx: BingXService;
    private engine: CurrencyPickerEngine;
    private ccxtEngine: CcxtPickerEngine;

    // ── الكاش في الذاكرة ──────────────────────────────────────────────────────
    private cachedResults: PickerResult[] = [];
    private lastScanTime: Date | null = null;
    private isScanning: boolean = false;

    constructor(bingxService: BingXService) {
        this.bingx = bingxService;
        this.engine = new CurrencyPickerEngine();
        this.ccxtEngine = new CcxtPickerEngine();
    }

    /**
     * يُعيد النتائج المحفوظة مباشرة — بدون فحص جديد
     */
    getLastResults(): { results: PickerResult[]; lastScanTime: Date | null } {
        return {
            results: this.cachedResults,
            lastScanTime: this.lastScanTime
        };
    }

    /**
     * هل يوجد نتائج محفوظة؟
     */
    hasResults(): boolean {
        return this.cachedResults.length > 0;
    }

    /**
     * هل الفحص جارٍ الآن؟
     */
    isScanRunning(): boolean {
        return this.isScanning;
    }

    /**
     * يُطلق فحصاً جديداً كاملاً، يُحدّث الكاش، يُعيد النتائج.
     * يتحمل الوقت (10-30 ثانية) حسب عدد العملات.
     */
    async refreshScan(
        limit: number = 20,
        engineType: 'multicriteria' | 'ccxt' = 'multicriteria',
        onProgress?: (done: number, total: number) => void
    ): Promise<PickerResult[]> {
        if (this.isScanning) {
            logger.warn('[SymbolPickerService] Scan already running, returning cached results');
            return this.cachedResults;
        }

        this.isScanning = true;
        logger.info(`[SymbolPickerService] Starting market scan for top ${limit} symbols using ${engineType} engine...`);

        let ranked: PickerResult[] = [];

        try {
            if (engineType === 'ccxt') {
                ranked = await this.ccxtEngine.run(limit, onProgress);
            } else {
                const results: PickerResult[] = [];
                let done = 0;
                const total = SCAN_SYMBOLS.length;

                // فحص العملات بشكل متوازٍ (على دفعات لتجنب rate limits)
                const BATCH_SIZE = 5;

                for (let i = 0; i < SCAN_SYMBOLS.length; i += BATCH_SIZE) {
                    const batch = SCAN_SYMBOLS.slice(i, i + BATCH_SIZE);

                    const batchResults = await Promise.allSettled(
                        batch.map(sym => this.scanSingleSymbol(sym))
                    );

                    for (const res of batchResults) {
                        if (res.status === 'fulfilled' && res.value !== null) {
                            results.push(res.value);
                        }
                        done++;
                        onProgress?.(done, total);
                    }

                    // تأخير بسيط بين الدفعات لتجنب rate limit
                    if (i + BATCH_SIZE < SCAN_SYMBOLS.length) {
                        await new Promise(r => setTimeout(r, 300));
                    }
                }

                // ترتيب النتائج وأخذ أفضل N
                ranked = this.engine.rankResults(results).slice(0, limit);
            }

            // تحديث الكاش
            this.cachedResults = ranked;
            this.lastScanTime = new Date();
        } catch (err: any) {
            logger.error(`[SymbolPickerService] Error running market scan: ${err.message}`);
        } finally {
            this.isScanning = false;
        }

        logger.info(`[SymbolPickerService] Scan complete. Top ${ranked.length} symbols found.`);
        return ranked;
    }

    /**
     * يفحص عملة واحدة ويُعيد النتيجة أو null إذا فشل
     */
    private async scanSingleSymbol(shortName: string): Promise<PickerResult | null> {
        const symbol = `${shortName}/USDT:USDT`;
        try {
            const isSupported = await this.bingx.isSymbolSupported(symbol);
            if (!isSupported) {
                return null;
            }

            // جلب بيانات الأطر الزمنية المطلوبة بشكل متوازٍ
            const [ohlcv15m, ohlcv1h, ohlcv4h, ticker] = await Promise.all([
                this.bingx.fetchOHLCV(symbol, '15m', 100).catch(() => []),
                this.bingx.fetchOHLCV(symbol, '1h', 100).catch(() => []),
                this.bingx.fetchOHLCV(symbol, '4h', 60).catch(() => []),
                this.fetchTicker(symbol).catch(() => null)
            ]);

            if (!ticker || ohlcv15m.length < 20 || ohlcv1h.length < 30) {
                return null;
            }

            const data: SymbolScanData = {
                symbol,
                shortName,
                ohlcv15m,
                ohlcv1h,
                ohlcv4h,
                ticker
            };

            return this.engine.scoreSymbol(data);
        } catch (err: any) {
            logger.warn(`[SymbolPickerService] Failed to scan ${symbol}: ${err.message}`);
            return null;
        }
    }

    /**
     * جلب بيانات التيكر لعملة محددة
     */
    private async fetchTicker(symbol: string): Promise<{ volume: number; percentage: number; last: number }> {
        try {
            // استخدام fetchOHLCV لحساب التغيير اليومي مباشرة من الشموع
            const daily = await this.bingx.fetchOHLCV(symbol, '1d', 2);
            if (!daily || daily.length < 1) {
                return { volume: 0, percentage: 0, last: 0 };
            }

            const lastCandle = daily[daily.length - 1];
            const prevCandle = daily.length >= 2 ? daily[daily.length - 2] : null;

            const volume = lastCandle.volume * lastCandle.close; // تحويل للـ USDT
            const last = lastCandle.close;
            const percentage = prevCandle && prevCandle.close > 0
                ? ((lastCandle.close - prevCandle.close) / prevCandle.close) * 100
                : 0;

            return { volume, percentage, last };
        } catch {
            return { volume: 0, percentage: 0, last: 0 };
        }
    }
}

// ─── Singleton Instance ───────────────────────────────────────────────────────
// نستخدم instance واحد مشترك لحفظ الكاش بين الطلبات

let _pickerServiceInstance: SymbolPickerService | null = null;

export function getSymbolPickerService(bingxService: BingXService): SymbolPickerService {
    if (!_pickerServiceInstance) {
        _pickerServiceInstance = new SymbolPickerService(bingxService);
    }
    return _pickerServiceInstance;
}
