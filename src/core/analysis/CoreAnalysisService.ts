import { ITradingEngine } from './engines/ITradingEngine';
import { V1Engine } from './engines/V1Engine';
import { V2Engine } from './engines/V2Engine';
import { V3Engine } from './engines/V3Engine';
import { V4Engine } from './engines/V4Engine';
import { V5Engine } from './engines/V5Engine';
import { V6Engine } from './engines/V6Engine';
import { V7Engine } from './engines/V7Engine';
import { V8Engine } from './engines/V8Engine';
import { V9Engine } from './engines/V9Engine';
import { V10Engine } from './engines/V10Engine';
import { V11Engine } from './engines/V11Engine';
import { V12Engine } from './engines/V12Engine';
import { V13Engine } from './engines/V13Engine';
import { V14Engine } from './engines/V14Engine';
import { V15Engine } from './engines/V15Engine';
import { V16Engine } from './engines/V16Engine';
import { V17Engine } from './engines/V17Engine';
import { V18Engine } from './engines/V18Engine';
import { HarmonicMasterEngine } from './engines/HarmonicMasterEngine';
import { TechnicalAnalyzer, MATRIX_TFS } from './TechnicalAnalyzer';
import { OHLCV, AnalysisDetails, AnalysisResult } from '../shared/types';

const ENGINES: Record<string, ITradingEngine> = {
    'V1': new V1Engine(),
    'V2': new V2Engine(),
    'V3': new V3Engine(),
    'V4': new V4Engine(),
    'V5': new V5Engine(),
    'V6': new V6Engine(),
    'V7': new V7Engine(),
    'V8': new V8Engine(),
    'V9': new V9Engine(),
    'V10': new V10Engine(),
    'V11': new V11Engine(),
    'V12': new V12Engine(),
    'V13': new V13Engine(),
    'V14': new V14Engine(),
    'V15': new V15Engine(),
    'V16': new V16Engine(),
    'V17': new V17Engine(),
    'V18': new V18Engine(),
    'HARMONIC': new HarmonicMasterEngine()
};

export type SupportedEngineVersion = 
    | 'V1' | 'V2' | 'V3' | 'V4' | 'V5' | 'V6' | 'V7' | 'V8' 
    | 'V9' | 'V10' | 'V11' | 'V12' | 'V13' | 'V14' | 'V15' | 'V16'
    | 'V17' | 'V18' | 'HARMONIC';

export class CoreAnalysisService {
    static analyze(
        symbol: string,
        pricePrecision: number,
        mtfOHLCV: Record<string, OHLCV[]>,
        version: SupportedEngineVersion = 'V1',
        options: { quickTF: string, longTF: string, limit: number, antiRepainting?: boolean }
    ): AnalysisResult {
        const { quickTF, longTF, limit, antiRepainting } = options;

        const quickOHLCV = mtfOHLCV[quickTF] || mtfOHLCV['5m'];
        if (!quickOHLCV || quickOHLCV.length === 0) {
            throw new Error(`Missing candle data for quick timeframe: ${quickTF}`);
        }
        
        const dailyOHLCV = mtfOHLCV['1d'];
        if (!dailyOHLCV || dailyOHLCV.length === 0) {
            throw new Error('Missing daily candle data for VWAP calculation');
        }

        const currentPrice = quickOHLCV[quickOHLCV.length - 1].close;
        const vwap = TechnicalAnalyzer.calculateVWAP(dailyOHLCV);

        // Technical Data Calculation for each active timeframe
        const allTimeframes: Record<string, AnalysisDetails> = {};
        MATRIX_TFS.forEach(tf => {
            if (mtfOHLCV[tf] && mtfOHLCV[tf].length > 0) {
                allTimeframes[tf] = TechnicalAnalyzer.calculateTechnicalData(mtfOHLCV[tf], tf, vwap, antiRepainting);
            }
        });

        // Resolve active engine
        const engine = ENGINES[version] || ENGINES['V1'];
        const result = engine.analyze(currentPrice, vwap, allTimeframes, mtfOHLCV, { quickTF, longTF });

        const scalpData = allTimeframes[quickTF] || allTimeframes['5m'];
        const swingData = allTimeframes[longTF] || allTimeframes['1h'];

        if (!scalpData || !swingData) {
            throw new Error(`Analysis failed: Missing processed data for TF ${quickTF} or ${longTF}`);
        }

        // Core Sniper Logic
        const isStochSynced = scalpData.indicators.stochRsi < 25 && swingData.indicators.stochRsi < 25;
        const isFullBreakout = result.matrix.percentage >= 95;
        const isAboveGolden = currentPrice > scalpData.levels.fib618;

        return {
            symbol,
            currentPrice,
            pricePrecision,
            isUptrend: scalpData.rsi < 50,
            matrix: result.matrix,
            isAboveVWAP: currentPrice > vwap,
            scalp: { ...result.scalp, ...scalpData },
            swing: { ...result.swing, ...swingData },
            allTimeframes,
            options: { quickTF, longTF, limit },
            sniper: { isStochSynced, isFullBreakout, isAboveGolden }
        };
    }
}
