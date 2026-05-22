import { BingXService } from '../BingXService';
import { BacktestBridgeService } from '../BacktestBridgeService';
import { SniperBacktestOptions, SniperBacktestSimulationResult } from '../../core/backtest/CoreSniperBacktester';

export class SniperBacktestService {
    private bridge: BacktestBridgeService;

    constructor(bingxService: BingXService) {
        this.bridge = new BacktestBridgeService(bingxService);
    }

    async runSniperBacktest(
        symbol: string,
        engineId: string,
        options: SniperBacktestOptions
    ): Promise<SniperBacktestSimulationResult> {
        return this.bridge.runSniperBacktest(symbol, engineId, options);
    }
}
