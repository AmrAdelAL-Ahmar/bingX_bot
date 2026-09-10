import logger from '../utils/logger';

export interface MacroEvent {
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

    private static mockSchedule: MacroEvent[] = [];

    /**
     * Checks if current time falls within an economic blackout window
     */
    static isBlackout(now: Date = new Date()): MacroCheckResult {
        const nowMs = now.getTime();

        for (const event of this.mockSchedule) {
            const diffMin = (event.timestamp - nowMs) / (60 * 1000);

            // If event is coming within 15 min OR occurred less than 30 min ago
            if (diffMin <= this.PRE_EVENT_BUFFER_MIN && diffMin >= -this.POST_EVENT_BUFFER_MIN) {
                const isUpcoming = diffMin >= 0;
                const reason = isUpcoming
                    ? `⚠️ حظر التداول التلقائي: صدور بيان اقتصادي حاسم (${event.title}) خلال ${Math.round(diffMin)} دقيقة! تجنب التقلب العنيف.`
                    : `⚠️ حظر التداول التلقائي: تم صدور بيان اقتصادي حاسم (${event.title}) قبل ${Math.round(Math.abs(diffMin))} دقيقة. فترة التهدئة جارية.`;

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
    static registerEvent(event: MacroEvent): void {
        this.mockSchedule.push(event);
        logger.info(`[MacroCalendar] Registered high impact event: ${event.title} at ${event.dateString}`);
    }

    /**
     * List all scheduled high impact events
     */
    static getUpcomingEvents(): MacroEvent[] {
        const now = Date.now();
        return this.mockSchedule
            .filter(e => e.timestamp >= now - 60 * 60 * 1000)
            .sort((a, b) => a.timestamp - b.timestamp);
    }
}
