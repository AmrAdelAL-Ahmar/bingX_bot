import { ITradingEngine, EngineResult } from './ITradingEngine';
import { AnalysisDetails, MatrixResult, OHLCV, TradeRecommendation } from '../../shared/types';

export type MarketRegime = 'TRENDING_BULL' | 'TRENDING_BEAR' | 'RANGING_EXPANDED' | 'COMPRESSION_SQUEEZE';

export interface RegimeAnalysis {
    regime: MarketRegime;
    confidence: number;
    atrRatio: number;
    bbWidth: number;
    recommendedEngines: string[];
    description: string;
}

export class V17Engine implements ITradingEngine {
    /**
     * Determines market volatility regime and generates trading recommendation
     */
    static detectRegime(candles: OHLCV[], details: AnalysisDetails): RegimeAnalysis {
        if (!candles || candles.length < 20 || !details) {
            return {
                regime: 'RANGING_EXPANDED',
                confidence: 50,
                atrRatio: 0.01,
                bbWidth: 0.02,
                recommendedEngines: ['V4', 'V9', 'HARMONIC'],
                description: 'بيانات غير كافية - افتراض تذبذب قياسي'
            };
        }

        const last = candles[candles.length - 1];
        const atr = details.atr || 1;
        const atrRatio = atr / (last.close || 1);

        const bb = details.indicators.bb;
        const bbWidth = bb ? (bb.upper - bb.lower) / bb.middle : 0.02;

        const isUptrend = details.isBullishTrend;
        const rsi = details.rsi;

        // Compression Squeeze: BB width is very tight (e.g. < 1.2% width)
        if (bbWidth < 0.012) {
            return {
                regime: 'COMPRESSION_SQUEEZE',
                confidence: 88,
                atrRatio,
                bbWidth,
                recommendedEngines: ['V14', 'V5'],
                description: 'انكماش سيولة وضغط سعري حاد (Volatility Squeeze) - انفجار وشيك'
            };
        }

        // Strong Trends: RSI directional, structure clear
        if (isUptrend && rsi >= 52 && last.close > bb.middle) {
            return {
                regime: 'TRENDING_BULL',
                confidence: 90,
                atrRatio,
                bbWidth,
                recommendedEngines: ['V1', 'V7', 'V10', 'V16'],
                description: 'اتجاه صاعد نقي وزخم متزايد (Strong Bullish Regime)'
            };
        }

        if (!isUptrend && rsi <= 48 && last.close < bb.middle) {
            return {
                regime: 'TRENDING_BEAR',
                confidence: 90,
                atrRatio,
                bbWidth,
                recommendedEngines: ['V1', 'V8', 'V11', 'V16'],
                description: 'اتجاه هابط نقي وضغط بيعي (Strong Bearish Regime)'
            };
        }

        // Default: Ranging / Expanded volatility
        return {
            regime: 'RANGING_EXPANDED',
            confidence: 85,
            atrRatio,
            bbWidth,
            recommendedEngines: ['V4', 'V9', 'V13', 'HARMONIC'],
            description: 'تذبذب أفقي متسع وتدوير سيولة (Mean-Reversion & Harmonics)'
        };
    }

    analyze(
        cp: number,
        vwap: number,
        allTimeframes: Record<string, AnalysisDetails>,
        mtfOHLCV: Record<string, OHLCV[]>,
        options: { quickTF: string; longTF: string; params?: Record<string, any> }
    ): EngineResult {
        const quickTF = options.quickTF || '5m';
        const longTF = options.longTF || '1h';

        const quickData = allTimeframes[quickTF] || allTimeframes['5m'];
        const longData = allTimeframes[longTF] || allTimeframes['1h'];
        const quickCandles = mtfOHLCV[quickTF] || mtfOHLCV['5m'] || [];

        const regimeInfo = V17Engine.detectRegime(quickCandles, quickData);

        let matrixScore = 50;
        let decision = `نظام السوق: ${regimeInfo.regime}`;
        let scalpType: 'LONG' | 'SHORT' | 'NONE' = 'NONE';
        let swingType: 'LONG' | 'SHORT' | 'NONE' = 'NONE';

        if (regimeInfo.regime === 'TRENDING_BULL') {
            matrixScore = 88;
            scalpType = 'LONG';
            swingType = 'LONG';
            decision = '🟢 شراء متوافق مع نظام الاتجاه الصاعد (Regime Bullish)';
        } else if (regimeInfo.regime === 'TRENDING_BEAR') {
            matrixScore = 15;
            scalpType = 'SHORT';
            swingType = 'SHORT';
            decision = '🔴 بيع متوافق مع نظام الاتجاه الهابط (Regime Bearish)';
        } else if (regimeInfo.regime === 'RANGING_EXPANDED') {
            // Mean reversion trigger from BB edges
            const bb = quickData?.indicators?.bb;
            if (bb) {
                if (cp <= bb.lower * 1.002) {
                    scalpType = 'LONG';
                    matrixScore = 75;
                    decision = '🟢 ارتداد من قاع القناة الأفقية (Mean-Reversion Long)';
                } else if (cp >= bb.upper * 0.998) {
                    scalpType = 'SHORT';
                    matrixScore = 25;
                    decision = '🔴 ارتداد من سقف القناة الأفقية (Mean-Reversion Short)';
                }
            }
        }

        const matrix: MatrixResult = {
            score: matrixScore,
            percentage: matrixScore,
            decision,
            details: `V17 Market Regime: ${regimeInfo.description} | المحركات الموصى بها: ${regimeInfo.recommendedEngines.join(', ')}`
        };

        const atr = quickData?.atr || cp * 0.01;
        const scalpRec: TradeRecommendation = scalpType !== 'NONE' ? {
            status: `V17_${regimeInfo.regime}`,
            type: scalpType,
            entry: cp,
            tp: scalpType === 'LONG' ? Number((cp + atr * 2).toFixed(4)) : Number((cp - atr * 2).toFixed(4)),
            tp2: scalpType === 'LONG' ? Number((cp + atr * 3.5).toFixed(4)) : Number((cp - atr * 3.5).toFixed(4)),
            sl: scalpType === 'LONG' ? Number((cp - atr * 1.5).toFixed(4)) : Number((cp + atr * 1.5).toFixed(4)),
            timeEstimate: 15,
            winRate: regimeInfo.confidence,
            reverseProb: 100 - regimeInfo.confidence,
            signalReason: `V17 Regime: ${regimeInfo.regime}`
        } : {
            status: 'REGIME_WAIT',
            type: 'NONE',
            entry: cp,
            tp: cp,
            sl: cp,
            timeEstimate: 0,
            winRate: 50,
            reverseProb: 50,
            rejectionReason: 'السعر في منتصف النطاق بانتظار إشارة كسر أو ارتداد واضحة'
        };

        const swingAtr = longData?.atr || atr * 2;
        const swingRec: TradeRecommendation = swingType !== 'NONE' ? {
            status: `V17_SWING_${regimeInfo.regime}`,
            type: swingType,
            entry: cp,
            tp: swingType === 'LONG' ? Number((cp + swingAtr * 2.5).toFixed(4)) : Number((cp - swingAtr * 2.5).toFixed(4)),
            tp2: swingType === 'LONG' ? Number((cp + swingAtr * 4.5).toFixed(4)) : Number((cp - swingAtr * 4.5).toFixed(4)),
            sl: swingType === 'LONG' ? Number((cp - swingAtr * 1.8).toFixed(4)) : Number((cp + swingAtr * 1.8).toFixed(4)),
            timeEstimate: 60,
            winRate: regimeInfo.confidence,
            reverseProb: 100 - regimeInfo.confidence,
            signalReason: `V17 Macro Regime: ${regimeInfo.regime}`
        } : {
            status: 'REGIME_WAIT',
            type: 'NONE',
            entry: cp,
            tp: cp,
            sl: cp,
            timeEstimate: 0,
            winRate: 50,
            reverseProb: 50,
            rejectionReason: 'بانتظار تأكيد توافق الاتجاه على الفريم الكبير'
        };

        return { matrix, scalp: scalpRec, swing: swingRec };
    }
}
