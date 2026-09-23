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
        try {
            const enginesToUpdate = new Set<string>();
            if (trade.engineId) enginesToUpdate.add(trade.engineId);
            enginesToUpdate.add('AUTONOMOUS_V2');

            // Detect any participating engines mentioned in justification
            const textToScan = `${trade.aiJustification || ''} ${trade.logs ? trade.logs.join(' ') : ''}`;
            const knownEngines = ['V1', 'V2', 'V3', 'V5', 'V6', 'V7', 'V8', 'V10', 'V11', 'V13', 'V16', 'V17', 'V18', 'HARMONIC'];
            for (const eng of knownEngines) {
                if (new RegExp(`\\b${eng}\\b`, 'i').test(textToScan)) {
                    enginesToUpdate.add(eng);
                }
            }

            for (const eng of enginesToUpdate) {
                const pastTrades = await Trade.find({
                    $or: [
                        { engineId: eng },
                        ...(eng === 'AUTONOMOUS_V2' ? [{ isPaperTrade: true }] : [{ aiJustification: new RegExp(`\\b${eng}\\b`, 'i') }])
                    ],
                    currentStatus: { $in: ['CLOSED_PROFIT', 'CLOSED_LOSS', 'CLOSED_TP', 'CLOSED_SL'] }
                }).limit(50);

                const wins = pastTrades.filter(t => t.currentStatus === 'CLOSED_PROFIT' || (t.realizedPnl && t.realizedPnl > 0)).length;
                const total = pastTrades.length;
                const winRate = total > 0 ? (wins / total) * 100 : 50;

                let weight = 1.0;
                if (total > 0) {
                    if (winRate >= 70) weight = 1.4;
                    else if (winRate >= 60) weight = 1.2;
                    else if (winRate < 45) weight = 0.75;
                }

                this.engineStatsCache.set(eng, {
                    engineId: eng,
                    totalSignals: total,
                    winningSignals: wins,
                    losingSignals: total - wins,
                    winRate: Number(winRate.toFixed(1)),
                    dynamicWeight: weight
                });
            }
            logger.info(`[TradingMemory] Adaptive stats updated for engines: ${Array.from(enginesToUpdate).join(', ')}`);
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
        const engines = ['AUTONOMOUS_V2', 'V1', 'V2', 'V3', 'V5', 'V6', 'V7', 'V8', 'V10', 'V11', 'V13', 'V16', 'V17', 'V18', 'HARMONIC'];
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
            const engines = ['AUTONOMOUS_V2', 'V1', 'V2', 'V3', 'V5', 'V6', 'V7', 'V8', 'V10', 'V11', 'V13', 'V16', 'V17', 'V18', 'HARMONIC'];
            for (const eng of engines) {
                const pastTrades = await Trade.find({
                    $or: [
                        { engineId: eng },
                        ...(eng === 'AUTONOMOUS_V2' ? [{ isPaperTrade: true }] : [{ aiJustification: new RegExp(`\\b${eng}\\b`, 'i') }])
                    ],
                    currentStatus: { $in: ['CLOSED_PROFIT', 'CLOSED_LOSS', 'CLOSED_TP', 'CLOSED_SL'] }
                }).limit(50);

                if (pastTrades.length > 0) {
                    const wins = pastTrades.filter(t => t.currentStatus === 'CLOSED_PROFIT' || (t.realizedPnl && t.realizedPnl > 0)).length;
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
