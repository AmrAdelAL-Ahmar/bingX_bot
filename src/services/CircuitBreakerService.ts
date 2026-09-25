import logger from '../utils/logger';
import Trade from '../models/Trade';
import { BingXService } from './BingXService';

export interface CircuitBreakerStatus {
    isTripped: boolean;
    tripReason?: string;
    trippedAt?: Date;
    cooldownUntil?: Date;
    dailyDrawdownPct: number;
    thresholdPct: number;
    realizedLoss24h: number;
    unrealizedPnL: number;
}

export class CircuitBreakerService {
    private static memoryTripState: Map<string, { trippedAt: Date; cooldownUntil: Date; reason: string }> = new Map();
    public static DEFAULT_MAX_DAILY_DRAWDOWN_PCT = 4.0; // 4% max daily loss
    public static COOLDOWN_HOURS = 12; // 12 hours safety cooldown

    /**
     * Checks if trading is allowed for the user or if the circuit breaker is active
     */
    static async checkStatus(
        telegramId: string,
        bingx?: BingXService,
        thresholdPct: number = CircuitBreakerService.DEFAULT_MAX_DAILY_DRAWDOWN_PCT
    ): Promise<CircuitBreakerStatus> {
        const now = new Date();
        const mem = this.memoryTripState.get(telegramId);

        // 1. Check if already tripped and still within cooldown
        if (mem) {
            if (now < mem.cooldownUntil) {
                return {
                    isTripped: true,
                    tripReason: mem.reason,
                    trippedAt: mem.trippedAt,
                    cooldownUntil: mem.cooldownUntil,
                    dailyDrawdownPct: thresholdPct,
                    thresholdPct,
                    realizedLoss24h: 0,
                    unrealizedPnL: 0
                };
            } else {
                // Cooldown expired
                this.memoryTripState.delete(telegramId);
                logger.info(`[CircuitBreaker] Cooldown period expired for user ${telegramId}. Trading restored.`);
            }
        }

        // 2. Calculate 24h realized losses from DB
        const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
        let realizedLoss24h = 0;
        try {
            const recentClosedTrades = await Trade.find({
                telegramId,
                status: 'CLOSED',
                closedAt: { $gte: twentyFourHoursAgo }
            });

            for (const t of recentClosedTrades) {
                if (t.realizedPnl && t.realizedPnl < 0) {
                    realizedLoss24h += Math.abs(t.realizedPnl);
                }
            }
        } catch (e) {
            logger.warn(`[CircuitBreaker] Could not fetch recent trades for ${telegramId}:`, e);
        }

        // 3. Calculate unrealized floating PnL & Balance if BingX service available
        let unrealizedPnL = 0;
        let totalBalance = 1000; // default conservative assumption
        if (bingx) {
            try {
                const totalEquity = await bingx.getTotalEquity();
                if (totalEquity && totalEquity > 0) {
                    totalBalance = totalEquity;
                }
                const positions = await bingx.getPositions();
                for (const pos of positions) {
                    const pnl = pos.unrealizedPnl !== undefined ? pos.unrealizedPnl :
                        (pos.info && pos.info.unrealizedProfit ? parseFloat(pos.info.unrealizedProfit) : 0);
                    unrealizedPnL += pnl;
                }
            } catch (e: any) {
                logger.warn(`[CircuitBreaker] Notice: Could not sync live BingX equity for ${telegramId}: ${e.message}`);
            }
        }

        const totalNetLoss = realizedLoss24h + (unrealizedPnL < 0 ? Math.abs(unrealizedPnL) : 0);
        const drawdownPct = totalBalance > 0 ? (totalNetLoss / totalBalance) * 100 : 0;

        if (drawdownPct >= thresholdPct) {
            const trippedAt = new Date();
            const cooldownUntil = new Date(trippedAt.getTime() + this.COOLDOWN_HOURS * 60 * 60 * 1000);
            const reason = `🚨 تجاوز الحد الأقصى للتراجع اليومي (${drawdownPct.toFixed(2)}% >= ${thresholdPct}%) - خسائر 24 ساعة: $${totalNetLoss.toFixed(2)}`;

            this.memoryTripState.set(telegramId, { trippedAt, cooldownUntil, reason });
            logger.error(`[CircuitBreaker] TRIP TRIGGERED for ${telegramId}! ${reason}`);

            return {
                isTripped: true,
                tripReason: reason,
                trippedAt,
                cooldownUntil,
                dailyDrawdownPct: Number(drawdownPct.toFixed(2)),
                thresholdPct,
                realizedLoss24h,
                unrealizedPnL
            };
        }

        return {
            isTripped: false,
            dailyDrawdownPct: Number(drawdownPct.toFixed(2)),
            thresholdPct,
            realizedLoss24h,
            unrealizedPnL
        };
    }

    /**
     * Manually reset the circuit breaker (e.g. by Admin or user confirmation)
     */
    static manualReset(telegramId: string): void {
        this.memoryTripState.delete(telegramId);
        logger.info(`[CircuitBreaker] Manual reset executed for user ${telegramId}`);
    }
}
