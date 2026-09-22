import Trade, { ITrade } from '../models/Trade';
import logger from '../utils/logger';

export interface EnginePerformanceRecord {
    engineId: string;
    totalSignals: number;
    winningSignals: number;
    losingSignals: number;
    winRate: number;
    dynamicWeight: number; // dynamically scaled weight
}

export class TradingMemoryService {
    private static engineStatsCache: Map<string, EnginePerformanceRecord> = new Map();

    /**
     * Updates adaptive memory after a trade closes
     */
    static async recordTradeResult(trade: ITrade): Promise<void> {
        if (!trade.engineId) return;

        try {
            const isProfit = trade.currentStatus === 'CLOSED_PROFIT' || (trade.pnl && trade.pnl > 0);
            logger.info(`[TradingMemory] Recording trade result for ${trade.symbol} (${trade.engineId}): ${isProfit ? 'PROFIT ✅' : 'LOSS 🛑'}`);

            // Update rolling stats from DB for this engine
            const pastTrades = await Trade.find({
                engineId: trade.engineId,
                currentStatus: { $in: ['CLOSED_PROFIT', 'CLOSED_LOSS'] }
            }).limit(50);

            const wins = pastTrades.filter(t => t.currentStatus === 'CLOSED_PROFIT' || (t.pnl && t.pnl > 0)).length;
            const total = pastTrades.length;
            const winRate = total > 0 ? (wins / total) * 100 : 50;

            // Dynamic weight: base 1.0, scaled up to 1.4 for > 65% winrate, or down to 0.7 for < 45% winrate
            let weight = 1.0;
            if (winRate >= 70) weight = 1.4;
            else if (winRate >= 60) weight = 1.2;
            else if (winRate < 45) weight = 0.75;

            this.engineStatsCache.set(trade.engineId, {
                engineId: trade.engineId,
                totalSignals: total,
                winningSignals: wins,
                losingSignals: total - wins,
                winRate: Number(winRate.toFixed(1)),
                dynamicWeight: weight
            });
        } catch (e: any) {
            logger.error(`[TradingMemory] Error recording trade result: ${e.message}`);
        }
    }

    /**
     * Gets the dynamically adjusted weight for an engine
     */
    static getDynamicWeight(engineId: string, fallbackWeight: number = 1.0): number {
        const cached = this.engineStatsCache.get(engineId);
        return cached ? cached.dynamicWeight : fallbackWeight;
    }

    /**
     * Gets performance records for all active engines
     */
    static getAllEngineStats(): EnginePerformanceRecord[] {
        const engines = ['V1', 'V3', 'V5', 'V10', 'V11', 'V13', 'V17', 'V18', 'HARMONIC'];
        return engines.map(eng => {
            const cached = this.engineStatsCache.get(eng);
            if (cached) return cached;
            return {
                engineId: eng,
                totalSignals: 0,
                winningSignals: 0,
                losingSignals: 0,
                winRate: 50,
                dynamicWeight: 1.0
            };
        });
    }

    /**
     * Initializes adaptive memory stats from past closed trades in database
     */
    static async initFromDb(): Promise<void> {
        try {
            const engines = ['V1', 'V3', 'V5', 'V10', 'V11', 'V13', 'V17', 'V18', 'HARMONIC', 'AUTONOMOUS_V2'];
            for (const eng of engines) {
                const pastTrades = await Trade.find({
                    engineId: eng,
                    currentStatus: { $in: ['CLOSED_PROFIT', 'CLOSED_LOSS'] }
                }).limit(50);

                if (pastTrades.length > 0) {
                    const wins = pastTrades.filter(t => t.currentStatus === 'CLOSED_PROFIT' || (t.pnl && t.pnl > 0)).length;
                    const total = pastTrades.length;
                    const winRate = Number(((wins / total) * 100).toFixed(1));
                    let weight = 1.0;
                    if (winRate >= 70) weight = 1.4;
                    else if (winRate >= 60) weight = 1.2;
                    else if (winRate < 45) weight = 0.75;

                    this.engineStatsCache.set(eng, {
                        engineId: eng,
                        totalSignals: total,
                        winningSignals: wins,
                        losingSignals: total - wins,
                        winRate,
                        dynamicWeight: weight
                    });
                }
            }
            logger.info(`[TradingMemory] Adaptive engine weights initialized from DB (${this.engineStatsCache.size} active records).`);
        } catch (e: any) {
            logger.warn(`[TradingMemory] Init warning: ${e.message}`);
        }
    }
}
