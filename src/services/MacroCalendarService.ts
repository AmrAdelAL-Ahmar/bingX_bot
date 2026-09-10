import logger from '../utils/logger';

export interface MacroEvent {
    id: string;
    title: string;
    currency: string;
    impact: 'HIGH' | 'CRITICAL';
    timestamp: number; // Unix epoch ms
    dateString: string;
}

export interface MacroCheckResult {
    isBlackoutActive: boolean;
    reason?: string;
    currentEvent?: MacroEvent;
    minutesToEvent?: number;
}

export class MacroCalendarService {
    // High impact recurring economic events (e.g. FOMC, CPI, NFP)
    // Blackout windows: 15 minutes before, 30 minutes after
    public static PRE_EVENT_BUFFER_MIN = 15;
    public static POST_EVENT_BUFFER_MIN = 30;
    public static isFilterEnabled = true;

    // Seeded schedule of high-impact events
    private static events: MacroEvent[] = [
        {
            id: 'fomc_rate',
            title: 'قرار الفائدة الفيدرالية الأمريكية (FOMC Rate Decision)',
            currency: 'USD',
            impact: 'CRITICAL',
            timestamp: Date.now() + 1000 * 60 * 60 * 24 * 3, // In 3 days by default
            dateString: new Date(Date.now() + 1000 * 60 * 60 * 24 * 3).toLocaleString('ar-EG')
        },
        {
            id: 'cpi_report',
            title: 'مؤشر أسعار المستهلكين والتضخم الأمريكي (US CPI Inflation)',
            currency: 'USD',
            impact: 'HIGH',
            timestamp: Date.now() + 1000 * 60 * 60 * 24 * 7, // In 7 days
            dateString: new Date(Date.now() + 1000 * 60 * 60 * 24 * 7).toLocaleString('ar-EG')
        },
        {
            id: 'nfp_jobs',
            title: 'تقرير الوظائف غير الزراعية الأمريكية (US Non-Farm Payrolls - NFP)',
            currency: 'USD',
            impact: 'HIGH',
            timestamp: Date.now() + 1000 * 60 * 60 * 24 * 14, // In 14 days
            dateString: new Date(Date.now() + 1000 * 60 * 60 * 24 * 14).toLocaleString('ar-EG')
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
     * Registers upcoming high-impact economic event
     */
    static registerEvent(event: Omit<MacroEvent, 'id'> & { id?: string }): MacroEvent {
        const fullEvent: MacroEvent = {
            id: event.id || `macro_${Date.now()}_${Math.random().toString(36).substring(7)}`,
            ...event
        };
        this.events.push(fullEvent);
        logger.info(`[MacroCalendar] Registered high impact event: ${fullEvent.title} at ${fullEvent.dateString}`);
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
     * Format a rich summary report for Telegram or UI
     */
    static getFormattedReport(): string {
        const status = this.isBlackout();
        const upcoming = this.getUpcomingEvents();
        const now = Date.now();

        let report = `🌐 <b>فلتر أخبار الاقتصاد الكلي (Macro News Filter)</b>\n━━━━━━━━━━━━━━━━━━━━━\n`;
        report += `• <b>حالة الفلتر:</b> ${this.isFilterEnabled ? '🟢 مفعل (شغال تلقائياً)' : '🔴 معطل'}\n`;
        report += `• <b>نافذة الحظر الأمني:</b> قبل الخبر بـ <code>${this.PRE_EVENT_BUFFER_MIN} دقيقة</code> وحتى بعده بـ <code>${this.POST_EVENT_BUFFER_MIN} دقيقة</code>\n`;
        report += `• <b>وضع السوق الحالي:</b> ${status.isBlackoutActive ? '🚨 <b>محظور التداول (فترة خبر حاسم)</b>' : '✅ <b>آمن للتداول (لا يوجد حظر)</b>'}\n`;

        if (status.isBlackoutActive && status.reason) {
            report += `\n⚠️ <b>سبب الحظر:</b>\n<i>${status.reason}</i>\n`;
        }

        report += `\n📅 <b>أهم الأحداث الاقتصادية المرتقبة:</b>\n`;
        if (upcoming.length === 0) {
            report += `<i>لا توجد أحداث مجدولة حالياً في الأفق القريب.</i>\n`;
        } else {
            upcoming.slice(0, 5).forEach((ev, idx) => {
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

                report += `${idx + 1}. <b>${ev.title}</b>\n`;
                report += `   ▫️ العملة: <code>${ev.currency}</code> | الأهمية: <code>${ev.impact}</code>\n`;
                report += `   ▫️ الموعد: <code>${ev.dateString}</code> ${timeStr}\n\n`;
            });
        }

        report += `💡 <i>الفلتر يحمي حسابك تلقائياً من الإنزلاقات السعرية الحادة وتذبذبات صانع السوق وقت صدور الأخبار الكبرى (FOMC / CPI / NFP).</i>`;
        return report;
    }
}

