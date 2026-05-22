import { BingXService } from './BingXService';
import { AnalysisService } from './AnalysisService';
import { BacktestBridgeService } from './BacktestBridgeService';
import { BacktestOptions, BacktestSimulationResult } from '../core/backtest/CoreBacktestEngine';

export class BacktestService {
    private bridge: BacktestBridgeService;

    constructor(
        private bingxService: BingXService,
        private analysisService: AnalysisService
    ) {
        this.bridge = new BacktestBridgeService(bingxService);
    }

    async runAdvancedBacktest(
        symbol: string,
        version: string,
        options: BacktestOptions & { stepMinutes: number; days: number; mode: 'SCALP' | 'SWING' }
    ): Promise<BacktestSimulationResult> {
        return this.bridge.runAdvancedBacktest(symbol, version, options);
    }
}
