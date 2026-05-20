import logger from '../utils/logger';
import { BingXService } from './BingXService';
import { TechnicalAnalyzer, MATRIX_TFS } from './TechnicalAnalyzer';
import { MTFDataBuilder } from './MTFDataBuilder';
import { OHLCV, AnalysisDetails } from './AnalysisService';
import { getSniperEngine } from './sniper/SniperRegistry';
import { SniperReport } from './sniper/ISniperEngine';
import SniperWatch, { ISniperWatch } from '../models/SniperWatch';

// ─── SniperManager ─────────────────────────────────────────────────────────────
/**
 * يعمل بدورة مستقلة (كل 60 ثانية) ويراقب قائمة الاقتناصات النشطة
 * عند اكتمال الشروط يُرسل إشعار + زرّا [تنفيذ] و[تفعيل المراقبة]
 */
export class SniperManager {
    private isRunning = false;
    private intervalId?: NodeJS.Timeout;
    private notifier: (telegramId: string, msg: string, extra?: any) => Promise<void>;

    constructor(
        public bingx: BingXService,
        notifier: (telegramId: string, msg: string, extra?: any) => Promise<void>
    ) {
        this.notifier = notifier;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Lifecycle
    // ─────────────────────────────────────────────────────────────────────────

    start(intervalMs = 60_000) {
        if (this.isRunning) return;
        this.isRunning = true;
        logger.info('🎯 SniperManager started');
        this.runCycle();
        this.intervalId = setInterval(() => this.runCycle(), intervalMs);
    }

    stop() {
        this.isRunning = false;
        if (this.intervalId) clearInterval(this.intervalId);
        logger.info('🛑 SniperManager stopped');
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Main Cycle
    // ─────────────────────────────────────────────────────────────────────────

    private async runCycle() {
        try {
            const activeWatches = await SniperWatch.find({ status: 'ACTIVE' });
            if (activeWatches.length === 0) return;

            logger.info(`🎯 SniperManager: checking ${activeWatches.length} active watches`);

            for (const watch of activeWatches) {
                await this.processWatch(watch).catch(err =>
                    logger.error(`SniperManager error for ${watch.symbol}:`, err)
                );
            }
        } catch (err) {
            logger.error('SniperManager runCycle error:', err);
        }
    }

    private async processWatch(watch: ISniperWatch) {
        // 1. انتهت المدة؟
        if (watch.expiresAt < new Date()) {
            watch.status = 'EXPIRED';
            await watch.save();
            await this.notifier(watch.telegramId,
                `⏰ *انتهت مدة اقتناص ${watch.symbolShort}*\n` +
                `المحرك: ${watch.engineId}\n` +
                `لم تتحقق شروط الدخول خلال المدة المحددة.`
            );
            return;
        }

        // 2. جلب البيانات وتشغيل المحرك
        const engine = getSniperEngine(watch.engineId);
        if (!engine) {
            logger.warn(`SniperManager: engine ${watch.engineId} not found`);
            return;
        }

        const report = await this.generateReport(watch.symbol, engine.requiredTFs);
        if (!report) return;

        // 3. تحديث آخر تقرير
        watch.lastReport = report;

        // 4. لا تُرسل إشعارات متكررة إذا notifyOnce === true وتم الإشعار مسبقاً
        if (watch.notifyOnce && watch.notificationCount > 0 && !report.readyToFire) {
            await watch.save();
            return;
        }

        // 5. إذا الزناد جاهز → إشعار مهم
        if (report.readyToFire) {
            await this.sendFireNotification(watch, report);
            watch.status = 'TRIGGERED';
            watch.lastNotifiedAt = new Date();
            watch.notificationCount += 1;
        } else if (this.hasSignificantChange(watch, report)) {
            // تغير في عدد الشروط المكتملة → إشعار تحديث
            await this.sendUpdateNotification(watch, report);
            watch.lastNotifiedAt = new Date();
            watch.notificationCount += 1;
        }

        await watch.save();
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Report Generation
    // ─────────────────────────────────────────────────────────────────────────

    async generateReport(symbol: string, requiredTFs: string[]): Promise<SniperReport | null> {
        try {
            // جلب البيانات لجميع الفريمات المطلوبة + الفريمات الأساسية
            const tfsToFetch = [...new Set([...MATRIX_TFS, ...requiredTFs])];
            const allData: Record<string, OHLCV[]> = {};
            for (const tf of tfsToFetch) {
                const daysNeeded = tf === '1d' ? 210 : tf === '4h' ? 40 : tf === '1h' ? 12 : 3;
                allData[tf] = await this.bingx.fetchDeepHistoricalData(symbol, tf, daysNeeded);
            }

            const currentPrice = allData['5m']?.slice(-1)[0]?.close
                || allData['15m']?.slice(-1)[0]?.close || 0;

            const vwap = TechnicalAnalyzer.calculateVWAP(allData['1d'] || allData['1h'] || []);

            const allTimeframes: Record<string, AnalysisDetails> = {};
            tfsToFetch.forEach(tf => {
                if (allData[tf] && allData[tf].length > 15) {
                    allTimeframes[tf] = TechnicalAnalyzer.calculateTechnicalData(allData[tf], tf, vwap);
                }
            });

            // نشغّل المحرك المناسب
            const engine = getSniperEngine(requiredTFs.length > 0 ? '' : 'V7-SWING');
            if (!engine) return null;

            return engine.scan(symbol, currentPrice, allData, allTimeframes);
        } catch (err) {
            logger.error(`SniperManager: failed to generate report for ${symbol}:`, err);
            return null;
        }
    }

    /**
     * تشغيل اقتناص لحظي (للتقرير الفوري من Telegram)
     */
    async instantReport(symbol: string, engineId: string): Promise<SniperReport | null> {
        try {
            const engine = getSniperEngine(engineId);
            if (!engine) return null;

            const tfsToFetch = [...new Set([...MATRIX_TFS, ...engine.requiredTFs])];
            const allData: Record<string, OHLCV[]> = {};
            for (const tf of tfsToFetch) {
                const daysNeeded = tf === '1d' ? 210 : tf === '4h' ? 40 : tf === '1h' ? 12 : 3;
                allData[tf] = await this.bingx.fetchDeepHistoricalData(symbol, tf, daysNeeded);
            }

            const currentPrice = allData['5m']?.slice(-1)[0]?.close
                || allData['15m']?.slice(-1)[0]?.close || 0;

            const vwap = TechnicalAnalyzer.calculateVWAP(allData['1d'] || allData['1h'] || []);

            const allTimeframes: Record<string, AnalysisDetails> = {};
            tfsToFetch.forEach(tf => {
                if (allData[tf] && allData[tf].length > 15) {
                    allTimeframes[tf] = TechnicalAnalyzer.calculateTechnicalData(allData[tf], tf, vwap);
                }
            });

            return engine.scan(symbol, currentPrice, allData, allTimeframes);
        } catch (err) {
            logger.error(`SniperManager: instantReport failed for ${symbol}:`, err);
            return null;
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Notifications
    // ─────────────────────────────────────────────────────────────────────────

    private async sendFireNotification(watch: ISniperWatch, report: SniperReport) {
        const msg = report.details + '\n\n🔔 *تم رصد فرصة دخول!*';
        const extra = {
            parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: [
                    [
                        { text: '⚡ تنفيذ الصفقة', callback_data: `snp_exec_${watch._id}` },
                        { text: '👁 تفعيل المراقبة', callback_data: `snp_radar_${watch._id}` }
                    ],
                    [
                        { text: '❌ إلغاء الاقتناص', callback_data: `snp_cancel_${watch._id}` }
                    ]
                ]
            }
        };
        await this.notifier(watch.telegramId, msg, extra);
    }

    private async sendUpdateNotification(watch: ISniperWatch, report: SniperReport) {
        const completedNow = report.completedConditions.length;
        const totalCond = completedNow + report.pendingConditions.length;
        const msg = `📊 *تحديث اقتناص ${watch.symbolShort}*\n` +
            `المحرك: ${watch.engineId}\n` +
            `الشروط المكتملة: *${completedNow}/${totalCond}*\n\n` +
            report.completedConditions.join('\n') +
            `\n\n⏳ *المنتظرة:*\n` +
            report.pendingConditions.slice(0, 3).join('\n') +
            `\n\nينتهي: ${watch.expiresAt.toLocaleTimeString('ar-EG')}`;
        await this.notifier(watch.telegramId, msg, { parse_mode: 'Markdown' });
    }

    // تغيّر عدد الشروط المكتملة بين الدورتين؟
    private hasSignificantChange(watch: ISniperWatch, report: SniperReport): boolean {
        const prev = watch.lastReport as SniperReport | undefined;
        if (!prev) return true;
        return prev.completedConditions.length !== report.completedConditions.length;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // CRUD للاقتناصات
    // ─────────────────────────────────────────────────────────────────────────

    async addWatch(params: {
        userId: string;
        telegramId: string;
        symbol: string;
        engineId: string;
        hours: number;
        autoExecute?: boolean;
        notifyOnce?: boolean;
    }): Promise<ISniperWatch> {
        const symbolShort = params.symbol.split('/')[0] || params.symbol;
        const expiresAt = new Date(Date.now() + params.hours * 60 * 60 * 1000);
        const watch = new SniperWatch({
            userId: params.userId,
            telegramId: params.telegramId,
            symbol: params.symbol,
            symbolShort,
            engineId: params.engineId,
            status: 'ACTIVE',
            autoExecute: params.autoExecute ?? false,
            notifyOnce: params.notifyOnce ?? false,
            expiresAt,
        });
        await watch.save();
        logger.info(`🎯 New sniper watch: ${params.symbol} (${params.engineId}) for ${params.hours}h`);
        return watch;
    }

    async cancelWatch(watchId: string): Promise<void> {
        await SniperWatch.findByIdAndUpdate(watchId, { status: 'CANCELLED' });
    }

    async getActiveWatches(userId: string): Promise<ISniperWatch[]> {
        return SniperWatch.find({ userId, status: 'ACTIVE' }).sort({ createdAt: -1 });
    }
}
