import logger from '../utils/logger';
import { BingXService } from './BingXService';
import { CoreBacktestEngine, BacktestOptions, BacktestSimulationResult } from '../core/backtest/CoreBacktestEngine';
import { CoreSniperBacktester, SniperBacktestOptions, SniperBacktestSimulationResult } from '../core/backtest/CoreSniperBacktester';
import { MATRIX_TFS } from '../core/analysis/TechnicalAnalyzer';
import { OHLCV } from '../core/shared/types';
import { getSniperEngine } from './sniper/SniperRegistry';

export class BacktestBridgeService {
    constructor(private bingxService: BingXService) { }

    /**
     * Run a multi-timeframe time-step simulation for standard scalp/swing strategies
     */
    async runAdvancedBacktest(
        symbol: string,
        version: string,
        options: BacktestOptions
    ): Promise<BacktestSimulationResult> {
        logger.info(`[BacktestBridge] Running strategy simulation for ${symbol} on engine ${version} over ${options.days} days`);

        // Fetch deep historical data for all required timeframes once
        const allData: Record<string, OHLCV[]> = {};
        for (const tf of MATRIX_TFS) {
            let fetchDays = options.days;
            if (tf === '1d') fetchDays += 200;
            else if (tf === '4h') fetchDays += 35;
            else if (tf === '1h') fetchDays += 10;
            else fetchDays += 3;

            allData[tf] = await this.bingxService.fetchDeepHistoricalData(symbol, tf, fetchDays);
        }

        // Delegate core logic to CoreBacktestEngine
        return CoreBacktestEngine.runSimulation(symbol, version, allData, options);
    }

    /**
     * Run a multi-timeframe time-step simulation for sniper engines
     */
    async runSniperBacktest(
        symbol: string,
        engineId: string,
        options: SniperBacktestOptions
    ): Promise<SniperBacktestSimulationResult> {
        logger.info(`[BacktestBridge] Running sniper simulation for ${symbol} on engine ${engineId} over ${options.days} days`);

        const engine = getSniperEngine(engineId);
        if (!engine) {
            throw new Error(`Sniper engine ${engineId} not found in the registry!`);
        }

        // Fetch deep historical data for all required timeframes once
        const allData: Record<string, OHLCV[]> = {};
        const tfsToFetch = [...new Set([...MATRIX_TFS, ...engine.requiredTFs])];

        for (const tf of tfsToFetch) {
            let fetchDays = options.days;
            if (tf === '1d') fetchDays += 200;
            else if (tf === '4h') fetchDays += 35;
            else if (tf === '1h') fetchDays += 10;
            else fetchDays += 3;

            allData[tf] = await this.bingxService.fetchDeepHistoricalData(symbol, tf, fetchDays);
        }

        // Delegate core logic to CoreSniperBacktester
        return CoreSniperBacktester.runSimulation(symbol, engine, allData, options);
    }
}
