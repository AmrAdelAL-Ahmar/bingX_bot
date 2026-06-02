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
     * Aggregates 5m candles in memory into larger timeframes
     */
    static aggregateCandles(candles5m: OHLCV[], targetTimeframe: string): OHLCV[] {
        if (targetTimeframe === '5m') return candles5m;

        let intervalMs: number;
        switch (targetTimeframe) {
            case '15m': intervalMs = 15 * 60 * 1000; break;
            case '30m': intervalMs = 30 * 60 * 1000; break;
            case '1h': intervalMs = 60 * 60 * 1000; break;
            case '4h': intervalMs = 4 * 60 * 60 * 1000; break;
            case '1d': intervalMs = 24 * 60 * 60 * 1000; break;
            default: return candles5m; // fallback
        }

        const groups: Map<number, OHLCV[]> = new Map();

        for (const c of candles5m) {
            const alignedTime = Math.floor(c.timestamp / intervalMs) * intervalMs;
            if (!groups.has(alignedTime)) {
                groups.set(alignedTime, []);
            }
            groups.get(alignedTime)!.push(c);
        }

        const aggregated: OHLCV[] = [];
        for (const [timestamp, group] of groups.entries()) {
            group.sort((a, b) => a.timestamp - b.timestamp);
            
            const open = group[0].open;
            const close = group[group.length - 1].close;
            const high = Math.max(...group.map(g => g.high));
            const low = Math.min(...group.map(g => g.low));
            const volume = group.reduce((sum, g) => sum + g.volume, 0);

            aggregated.push({
                timestamp,
                open,
                high,
                low,
                close,
                volume
            });
        }

        return aggregated.sort((a, b) => a.timestamp - b.timestamp);
    }

    /**
     * Prepares OHLCV data for backtesting, fetching 5m and aggregating medium TFs in memory
     */
    private async prepareAllData(symbol: string, days: number, requiredTFs: string[]): Promise<Record<string, OHLCV[]>> {
        const allData: Record<string, OHLCV[]> = {};
        const mediumTFs = ['5m', '15m', '30m', '1h'];
        const hasMediumTF = requiredTFs.some(tf => mediumTFs.includes(tf));

        let candles5m: OHLCV[] | null = null;
        if (hasMediumTF) {
            const baseM5Days = days + 10; // extra padding for indicators
            logger.info(`[BacktestBridge] Fetching base 5m candles for ${symbol} over ${baseM5Days} days`);
            candles5m = await this.bingxService.fetchDeepHistoricalData(symbol, '5m', baseM5Days);
            if (!candles5m) {
                throw new Error(`Failed to fetch baseline 5m historical data for ${symbol}`);
            }
            allData['5m'] = candles5m;
        }

        for (const tf of requiredTFs) {
            if (tf === '5m') continue;

            if (['15m', '30m', '1h'].includes(tf) && candles5m) {
                logger.info(`[BacktestBridge] Aggregating ${tf} from 5m candles in-memory`);
                allData[tf] = BacktestBridgeService.aggregateCandles(candles5m, tf);
            } else {
                let fetchDays = days;
                if (tf === '1d') fetchDays += 200;
                else if (tf === '4h') fetchDays += 35;
                else if (tf === '1h') fetchDays += 10;
                else fetchDays += 3;

                logger.info(`[BacktestBridge] Fetching ${tf} candles directly for ${symbol} over ${fetchDays} days`);
                allData[tf] = await this.bingxService.fetchDeepHistoricalData(symbol, tf, fetchDays);
            }
        }

        return allData;
    }

    /**
     * Run a multi-timeframe time-step simulation for standard scalp/swing strategies
     */
    async runAdvancedBacktest(
        symbol: string,
        version: string,
        options: BacktestOptions
    ): Promise<BacktestSimulationResult> {
        logger.info(`[BacktestBridge] Running strategy simulation for ${symbol} on engine ${version} over ${options.days} days`);

        // Enforce timeframe segregation for SCALP and SWING to avoid identical results
        if (options.mode === 'SCALP') {
            options.quickTF = options.quickTF || '5m';
            options.longTF = options.longTF || '30m';
        } else if (options.mode === 'SWING') {
            options.quickTF = '1h';
            options.longTF = '4h';
        }

        // Fetch/Prepare deep historical data using candle aggregator
        const allData = await this.prepareAllData(symbol, options.days, MATRIX_TFS);

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

        const tfsToFetch = [...new Set([...MATRIX_TFS, ...engine.requiredTFs])];

        // Fetch/Prepare deep historical data using candle aggregator
        const allData = await this.prepareAllData(symbol, options.days, tfsToFetch);

        // Delegate core logic to CoreSniperBacktester
        return CoreSniperBacktester.runSimulation(symbol, engine, allData, options);
    }
}
