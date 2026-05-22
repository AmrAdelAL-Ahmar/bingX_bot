import { OHLCV, AnalysisDetails } from '../shared/types';
import { TechnicalAnalyzer, MATRIX_TFS } from '../analysis/TechnicalAnalyzer';
import { getSniperEngine } from './SniperRegistry';
import { SniperReport } from './ISniperEngine';

/**
 * CoreSniperScanner
 * Pure in-memory coordinator for running sniper engines.
 * Computes VWAP, multi-timeframe indicator metrics, and executes the selected sniper engine.
 */
export class CoreSniperScanner {
    /**
     * Executes the sniper scan using deep historical data in-memory.
     * 
     * @param symbol Currency pair symbol
     * @param engineId Engine ID to run
     * @param allData Map of OHLCV arrays by timeframe
     */
    static scan(
        symbol: string,
        engineId: string,
        allData: Record<string, OHLCV[]>
    ): SniperReport | null {
        const engine = getSniperEngine(engineId);
        if (!engine) return null;

        // Determine current price
        const currentPrice = allData['5m']?.slice(-1)[0]?.close
            || allData['15m']?.slice(-1)[0]?.close 
            || 0;

        // Compute VWAP from daily or hourly data
        const vwap = TechnicalAnalyzer.calculateVWAP(allData['1d'] || allData['1h'] || []);

        // Compute technical metrics for all required timeframes
        const allTimeframes: Record<string, AnalysisDetails> = {};
        const tfsToFetch = [...new Set([...MATRIX_TFS, ...engine.requiredTFs])];
        
        tfsToFetch.forEach(tf => {
            if (allData[tf] && allData[tf].length > 15) {
                allTimeframes[tf] = TechnicalAnalyzer.calculateTechnicalData(allData[tf], tf, vwap);
            }
        });

        return engine.scan(symbol, currentPrice, allData, allTimeframes);
    }
}
