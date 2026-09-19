import logger from '../utils/logger';
import { GeminiService } from './GeminiService';

export interface MacroEvent {
    id: string;
    title: string;
    currency: string;
    impact: 'HIGH' | 'CRITICAL' | 'MEDIUM';
    timestamp: number; // Unix epoch ms
    dateString: string;
    forecast?: string;
    previous?: string;
    actual?: string;
    source?: 'LIVE_REAL_FEED' | 'AI_GENERATED' | 'SEED';
}

export interface MacroCheckResult {
    isBlackoutActive: boolean;
    reason?: string;
    currentEvent?: MacroEvent;
    minutesToEvent?: number;
}

export class MacroCalendarService {
    // Standard institutional blackout buffer: 15m pre, 30m post
    public static PRE_EVENT_BUFFER_MIN = 15;
    public static POST_EVENT_BUFFER_MIN = 30;
    public static isFilterEnabled = true;

    private static lastSyncTimestamp: number = 0;
    private static cachedAiBriefing: string | null = null;
    private static aiBriefingTimestamp: number = 0;

    // Seed events as initial safe fallback
    private static events: MacroEvent[] = [
        {
            id: 'fomc_rate_default',
            title: 'قرار الفائدة والسياسة النقدية الفيدرالية (FOMC Rate Decision)',
            currency: 'USD',
            impact: 'CRITICAL',
            timestamp: Date.now() + 1000 * 60 * 60 * 24 * 3,
            dateString: new Date(Date.now() + 1000 * 60 * 60 * 24 * 3).toLocaleString('ar-EG'),
            forecast: '5.25%',
            previous: '5.50%',
            source: 'SEED'
        }
    ];

    /**
     * Checks if current time falls within an economic blackout window
     */
    static isBlackout(now: Date = new Date()): MacroCheckResult {
        if (!this.isFilterEnabled) {
            return { isBlackoutActive: false };
        }

        const nowMs = now.getTime();

        for (const event of this.events) {
            // Only enforce blackout on CRITICAL or HIGH events
            if (event.impact === 'MEDIUM') continue;

            const diffMin = (event.timestamp - nowMs) / (60 * 1000);

            // If event is coming within 15 min OR occurred less than 30 min ago
            if (diffMin <= this.PRE_EVENT_BUFFER_MIN && diffMin >= -this.POST_EVENT_BUFFER_MIN) {
                const isUpcoming = diffMin >= 0;
                const reason = isUpcoming
                    ? `⚠️ حظر التداول التلقائي: صدور بيان اقتصادي حاسم (${event.title}) خلال ${Math.round(diffMin)} دقيقة! تجنب التقلب العنيف والانزلاق السعري.`
                    : `⚠️ حظر التداول التلقائي: تم صدور بيان اقتصادي حاسم (${event.title}) قبل ${Math.round(Math.abs(diffMin))} دقيقة. فترة التهدئة جارية (Cooling-off).`;

                logger.warn(`[MacroCalendar] Blackout active: ${reason}`);
                return {
                    isBlackoutActive: true,
                    reason,
                    currentEvent: event,
                    minutesToEvent: Math.round(diffMin)
                };
            }
        }

        return { isBlackoutActive: false };
    }

    /**
     * Fetches real, live economic calendar data from public global calendar feed
     */
    static async syncRealEvents(): Promise<{ count: number; updated: boolean; error?: string }> {
        try {
            logger.info('[MacroCalendar] Fetching real live economic calendar from global feed...');
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 12000);

            const response = await fetch('https://nfs.faireconomy.media/ff_calendar_thisweek.json', {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                    'Accept': 'application/json'
                },
                signal: controller.signal
            });
            clearTimeout(timeoutId);

            if (!response.ok) {
                throw new Error(`Feed responded with HTTP ${response.status}: ${response.statusText}`);
            }

            const data: any[] = await response.json();
            if (!Array.isArray(data) || data.length === 0) {
                throw new Error('Received empty or invalid calendar payload');
            }

            const parsedEvents: MacroEvent[] = [];
            const now = Date.now();

            for (const item of data) {
                const country = (item.country || '').toUpperCase();
                const impactStr = (item.impact || '').toLowerCase();
                const title = item.title || 'Economic Event';
                const timeMs = Date.parse(item.date);

                if (isNaN(timeMs)) continue;

                // We prioritize USD events that affect crypto liquidity and market volatility
                const isUsd = country === 'USD';
                const isHigh = impactStr === 'high';
                const isMedium = impactStr === 'medium';

                const isCryptoSensitiveTitle = /cpi|ppi|fomc|fed|powell|payrolls|unemployment|gdp|pce|retail sales|rate/i.test(title);

                if ((isUsd && (isHigh || (isMedium && isCryptoSensitiveTitle))) || (isHigh && ['EUR', 'GBP', 'JPY'].includes(country))) {
                    let impact: 'HIGH' | 'CRITICAL' | 'MEDIUM' = 'HIGH';
                    if (/fomc|cpi|powell|payrolls/i.test(title)) {
                        impact = 'CRITICAL';
                    } else if (isMedium) {
                        impact = 'MEDIUM';
                    }

                    parsedEvents.push({
                        id: `ff_${timeMs}_${title.replace(/[^a-zA-Z0-9]/g, '_')}`,
                        title: `${title} (${country})`,
                        currency: country,
                        impact,
                        timestamp: timeMs,
                        dateString: new Date(timeMs).toLocaleString('ar-EG', { timeZone: 'UTC' }) + ' UTC',
                        forecast: item.forecast || undefined,
                        previous: item.previous || undefined,
                        actual: item.actual || undefined,
                        source: 'LIVE_REAL_FEED'
                    });
                }
            }

            if (parsedEvents.length > 0) {
                // Keep events sorted chronologically
                parsedEvents.sort((a, b) => a.timestamp - b.timestamp);
                this.events = parsedEvents;
                this.lastSyncTimestamp = now;
                logger.info(`[MacroCalendar] Successfully synced ${parsedEvents.length} real macro events.`);
                return { count: parsedEvents.length, updated: true };
            }

            return { count: this.events.length, updated: false };
        } catch (err: any) {
            logger.warn(`[MacroCalendar] Live sync failed (${err.message}). Retaining cached schedule.`);
            return { count: this.events.length, updated: false, error: err.message };
        }
    }

    /**
     * AI-Powered Macro Supervision Briefing (تحليل وإشراف الذكاء الاصطناعي)
     */
    static async getAiSupervisionBriefing(forceRefresh: boolean = false): Promise<string> {
        const now = Date.now();

        // Use cache if under 1 hour old and not forcing refresh
        if (!forceRefresh && this.cachedAiBriefing && (now - this.aiBriefingTimestamp < 60 * 60 * 1000)) {
            return this.cachedAiBriefing;
        }

        // Auto-sync real events if empty or stale
        if (this.events.length <= 1 || now - this.lastSyncTimestamp > 4 * 60 * 60 * 1000) {
            await this.syncRealEvents().catch(() => {});
        }

        const upcoming = this.getUpcomingEvents().slice(0, 8);
        if (upcoming.length === 0) {
            return '✅ <b>تقرير الذكاء الاصطناعي:</b> لا توجد أحداث كبرى مجدولة حالياً. حركة السوق خاضعة للسيولة الفنية الطبيعية.';
        }

        const eventsPayload = upcoming.map(e => ({
            title: e.title,
            currency: e.currency,
            impact: e.impact,
            date: e.dateString,
            forecast: e.forecast || 'N/A',
            previous: e.previous || 'N/A'
        }));

        try {
            const briefing = await GeminiService.analyzeMacroEventsAI(JSON.stringify(eventsPayload, null, 2));
            this.cachedAiBriefing = briefing;
            this.aiBriefingTimestamp = now;
            return briefing;
        } catch (e: any) {
            return `⚠️ تعذر توليد تقرير الذكاء الاصطناعي: ${e.message}`;
        }
    }

    /**
     * Registers an upcoming high-impact economic event manually
     */
    static registerEvent(event: Omit<MacroEvent, 'id'> & { id?: string }): MacroEvent {
        const fullEvent: MacroEvent = {
            id: event.id || `macro_${Date.now()}_${Math.random().toString(36).substring(7)}`,
            ...event,
            source: 'AI_GENERATED'
        };
        this.events.push(fullEvent);
        this.events.sort((a, b) => a.timestamp - b.timestamp);
        logger.info(`[MacroCalendar] Registered macro event: ${fullEvent.title} at ${fullEvent.dateString}`);
        return fullEvent;
    }

    /**
     * Toggle filter enabled state
     */
    static toggleFilter(enable?: boolean): boolean {
        this.isFilterEnabled = enable !== undefined ? enable : !this.isFilterEnabled;
        logger.info(`[MacroCalendar] Filter enabled state changed to: ${this.isFilterEnabled}`);
        return this.isFilterEnabled;
    }

    /**
     * Set buffer minutes
     */
    static setBuffers(preMin: number, postMin: number): void {
        this.PRE_EVENT_BUFFER_MIN = Math.max(1, preMin);
        this.POST_EVENT_BUFFER_MIN = Math.max(1, postMin);
        logger.info(`[MacroCalendar] Buffers updated: Pre=${this.PRE_EVENT_BUFFER_MIN}m, Post=${this.POST_EVENT_BUFFER_MIN}m`);
    }

    /**
     * List all scheduled high impact events
     */
    static getUpcomingEvents(): MacroEvent[] {
        const now = Date.now();
        return this.events
            .filter(e => e.timestamp >= now - this.POST_EVENT_BUFFER_MIN * 60 * 1000)
            .sort((a, b) => a.timestamp - b.timestamp);
    }

    /**
     * Provides concise, institutional macroeconomic scenario analysis for an event
     */
    static getScenarioInsight(event: MacroEvent): string {
        const title = event.title.toLowerCase();

        // 1. Inflation & Price Indexes (CPI, Core CPI, PPI, PCE)
        if (/cpi|pce|ppi|inflation/i.test(title)) {
            return `💡 السيناريو: إذا جاءت القيمة أعلى من المتوقع 🟢 للدولار | 🔴 سلبي للكريبتو (تشديد الفائدة). إذا جاءت أدنى 🔴 للدولار | 🟢 إيجابي للكريبتو والبيتكوين.`;
        }

        // 2. Interest Rates & Federal Reserve (FOMC, Fed Rate, Powell)
        if (/fomc|fed|powell|interest rate|funds rate/i.test(title)) {
            return `💡 السيناريو: تثبيت أو خفض الفائدة / لهجة تيسيرية 🟢 صعود قوي للكريبتو. رفع الفائدة / تشديد نقدي صارم 🔴 هبوط للأسواق وهروب للدولار.`;
        }

        // 3. Unemployment Rate
        if (/unemployment rate/i.test(title)) {
            return `💡 السيناريو: ارتفاع نسبة البطالة (أعلى من المتوقع) 🔴 ضعف للدولار | 🟢 إيجابي للكريبتو (يُعجل بالخفض). انخفاضها 🟢 قوة للدولار.`;
        }

        // 4. Employment & Jobs (NFP, Non-Farm Payrolls, ADP)
        if (/payrolls|nfp|employment change|adp/i.test(title)) {
            return `💡 السيناريو: وظائف أكثر من المتوقع 🟢 قوة للدولار | 🔴 ضغط هابط على الكريبتو (اقتصاد ساخن). وظائف أقل 🔴 للدولار | 🟢 انتعاش للكريبتو.`;
        }

        // 5. Economic Growth (GDP, Retail Sales, ISM PMI)
        if (/gdp|retail sales|ism|pmi/i.test(title)) {
            return `💡 السيناريو: بيانات أعلى من المتوقع 🟢 تدل على متانة الاقتصاد وقوة للدولار | بيانات أضعف تدعم التيسير النقدي وانتعاش الأصول الخطرة.`;
        }

        return `💡 السيناريو: مراقبة الفارق بين الفعلي والمتوقع؛ الأرقام المفاجئة تحدث تقلبات وانزلاقاً سعرياً حاداً.`;
    }

    /**
     * Format a rich summary report for Telegram or UI
     */
    static getFormattedReport(): string {
        const status = this.isBlackout();
        const upcoming = this.getUpcomingEvents();
        const now = Date.now();

        let report = `🌐 <b>فلتر أخبار الاقتصاد الكلي الحقيقي (Real-Time Macro Calendar)</b>\n`;
        report += `🧠 <i>تحت إشراف وتحليل الذكاء الاصطناعي المؤسساتي</i>\n━━━━━━━━━━━━━━━━━━━━━\n`;
        report += `• <b>حالة الفلتر:</b> ${this.isFilterEnabled ? '🟢 مفعل (حظر تلقائي نشط)' : '🔴 معطل'}\n`;
        report += `• <b>نافذة الحظر الأمني:</b> قبل الخبر بـ <code>${this.PRE_EVENT_BUFFER_MIN} دقيقة</code> وحتى بعده بـ <code>${this.POST_EVENT_BUFFER_MIN} دقيقة</code>\n`;
        report += `• <b>وضع السوق الحالي:</b> ${status.isBlackoutActive ? '🚨 <b>محظور التداول (فترة خبر حاسم)</b>' : '✅ <b>آمن للتداول (لا يوجد حظر)</b>'}\n`;

        if (this.lastSyncTimestamp > 0) {
            const syncAgoMin = Math.round((now - this.lastSyncTimestamp) / (60 * 1000));
            report += `• <b>مصدر البيانات:</b> 📡 <i>تقويم عالمي مباشر حي (تم التحديث منذ ${syncAgoMin} دقيقة)</i>\n`;
        }

        if (status.isBlackoutActive && status.reason) {
            report += `\n⚠️ <b>سبب الحظر النشط:</b>\n<i>${status.reason}</i>\n`;
        }

        report += `\n📅 <b>البيانات والأخبار الاقتصادية المجدولة لهذا الأسبوع (${upcoming.length} حدثاً):</b>\n`;
        if (upcoming.length === 0) {
            report += `<i>لا توجد أحداث كبرى مجدولة حالياً لهذا الأسبوع.</i>\n`;
        } else {
            // Display up to 15 events so the user sees the full week's schedule
            upcoming.slice(0, 15).forEach((ev, idx) => {
                const diffMin = (ev.timestamp - now) / (60 * 1000);
                let timeStr = '';
                if (diffMin < 0) {
                    timeStr = `(صدر منذ ${Math.round(Math.abs(diffMin))} د)`;
                } else if (diffMin < 60) {
                    timeStr = `(خلال ${Math.round(diffMin)} دقيقة 🔥)`;
                } else if (diffMin < 24 * 60) {
                    timeStr = `(خلال ${(diffMin / 60).toFixed(1)} ساعة)`;
                } else {
                    timeStr = `(خلال ${(diffMin / (24 * 60)).toFixed(1)} يوم)`;
                }

                const impactEmoji = ev.impact === 'CRITICAL' ? '🚨 حرج جداً' : ev.impact === 'HIGH' ? '🔥 عالي التأثير' : '⚠️ متوسط';

                report += `${idx + 1}. <b>${ev.title}</b>\n`;
                report += `   ▫️ العملة: <code>${ev.currency}</code> | الخطر: <b>${impactEmoji}</b>\n`;
                report += `   ▫️ التوقيت: <code>${ev.dateString}</code> ${timeStr}\n`;
                if (ev.forecast || ev.previous) {
                    report += `   ▫️ المتوقع: <code>${ev.forecast || '-'}</code> | السابق: <code>${ev.previous || '-'}</code>\n`;
                }
                if (ev.actual) {
                    report += `   ▫️ ⚡ <b>النتيجة الفعلية (Actual):</b> <code>${ev.actual}</code>\n`;
                }
                report += `   ▫️ ${this.getScenarioInsight(ev)}\n`;
                report += `\n`;
            });
        }

        report += `💡 <i>اضغط على زر <b>«🧠 تقرير الذكاء الاصطناعي»</b> للحصول على تقييم تفصيلي لتأثير الأخبار الحقيقية على البيتكوين.</i>`;
        return report;
    }
}
