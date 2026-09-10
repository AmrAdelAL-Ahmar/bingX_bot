import { ISniperEngine, SniperReport } from '../ISniperEngine';
import { AnalysisDetails, OHLCV } from '../../shared/types';
import { V17Engine } from '../../analysis/engines/V17Engine';

export class V17SniperEngine implements ISniperEngine {
    readonly engineId: string;
    readonly displayName: string;
    readonly mode: 'SWING' | 'SCALP';
    readonly requiredTFs: string[];

    constructor(mode: 'SWING' | 'SCALP' = 'SCALP') {
        this.mode = mode;
        this.engineId = mode === 'SWING' ? 'V17-SWING' : 'V17-SCALP';
        this.displayName = mode === 'SWING'
            ? '🌐 قناص نظام السوق الديناميكي V17 (سوينغ)'
            : '⚡ قناص نظام السوق الديناميكي V17 (مضاربة)';
        this.requiredTFs = mode === 'SWING' ? ['1h', '4h'] : ['5m', '15m'];
    }

    scan(
        symbol: string,
        currentPrice: number,
        mtfOHLCV: Record<string, OHLCV[]>,
        allTimeframes: Record<string, AnalysisDetails>
    ): SniperReport {
        const primaryTF = this.mode === 'SWING' ? '1h' : '5m';
        const candles = mtfOHLCV[primaryTF] || mtfOHLCV['5m'] || [];
        const details = allTimeframes[primaryTF] || allTimeframes['5m'];

        const completedConditions: string[] = [];
        const pendingConditions: string[] = [];

        if (candles.length < 20 || !details) {
            return {
                symbol,
                engineId: this.engineId,
                direction: 'NONE',
                entry: currentPrice,
                sl: currentPrice,
                tp: currentPrice,
                readyToFire: false,
                confidence: 0,
                winRate: 50,
                completedConditions: [],
                pendingConditions: ['بيانات غير كافية لحساب نظام السوق'],
                summary: 'بانتظار اكتمال البيانات',
                details: 'Missing OHLCV/Analysis details',
                generatedAt: new Date()
            };
        }

        const regimeInfo = V17Engine.detectRegime(candles, details);
        completedConditions.push(`نظام السوق المكتشف: ${regimeInfo.regime} (${regimeInfo.confidence}%)`);

        let direction: 'LONG' | 'SHORT' | 'NONE' = 'NONE';
        let readyToFire = false;
        const atr = details.atr || currentPrice * 0.01;

        if (regimeInfo.regime === 'TRENDING_BULL') {
            direction = 'LONG';
            readyToFire = details.rsi >= 50 && details.rsi <= 72;
            if (readyToFire) completedConditions.push('تأكيد الزخم الشرائي الصاعد (RSI مناسب)');
            else pendingConditions.push('انتظار تهدئة مؤشر RSI للدخول الآمن');
        } else if (regimeInfo.regime === 'TRENDING_BEAR') {
            direction = 'SHORT';
            readyToFire = details.rsi <= 50 && details.rsi >= 28;
            if (readyToFire) completedConditions.push('تأكيد الزخم البيعي الهابط (RSI مناسب)');
            else pendingConditions.push('انتظار ارتداد مؤشر RSI للبيع من قمة فرعية');
        } else if (regimeInfo.regime === 'RANGING_EXPANDED') {
            const bb = details.indicators.bb;
            if (bb && currentPrice <= bb.lower * 1.002) {
                direction = 'LONG';
                readyToFire = true;
                completedConditions.push('ملامسة قاع بولنجر في سوق متذبذب');
            } else if (bb && currentPrice >= bb.upper * 0.998) {
                direction = 'SHORT';
                readyToFire = true;
                completedConditions.push('ملامسة سقف بولنجر في سوق متذبذب');
            } else {
                pendingConditions.push('انتظار وصول السعر لحدود القناة السعرية الأفقية');
            }
        } else {
            pendingConditions.push('السوق في حالة ضغط وانكماش سيولة حاد - يفضل الانتظار');
        }

        const tp = direction === 'LONG' ? Number((currentPrice + atr * 2).toFixed(4)) : Number((currentPrice - atr * 2).toFixed(4));
        const tp2 = direction === 'LONG' ? Number((currentPrice + atr * 3.5).toFixed(4)) : Number((currentPrice - atr * 3.5).toFixed(4));
        const sl = direction === 'LONG' ? Number((currentPrice - atr * 1.5).toFixed(4)) : Number((currentPrice + atr * 1.5).toFixed(4));

        return {
            symbol,
            engineId: this.engineId,
            direction,
            entry: currentPrice,
            sl,
            tp,
            tp2,
            readyToFire,
            confidence: regimeInfo.confidence,
            winRate: regimeInfo.confidence,
            completedConditions,
            pendingConditions,
            summary: readyToFire ? `🎯 إشارة V17 جاهزة متوافقة مع نظام ${regimeInfo.regime}` : `⏳ V17 يراقب نظام ${regimeInfo.regime}`,
            details: regimeInfo.description,
            generatedAt: new Date()
        };
    }
}
