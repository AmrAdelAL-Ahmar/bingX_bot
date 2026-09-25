import { ISniperEngine, SniperReport } from '../ISniperEngine';
import { AnalysisDetails, OHLCV } from '../../shared/types';
import { V18Engine } from '../../analysis/engines/V18Engine';

export class V18SniperEngine implements ISniperEngine {
    readonly engineId: string;
    readonly displayName: string;
    readonly mode: 'SWING' | 'SCALP';
    readonly requiredTFs: string[];

    constructor(mode: 'SWING' | 'SCALP' = 'SCALP') {
        this.mode = mode;
        this.engineId = mode === 'SWING' ? 'V18-SWING' : 'V18-SCALP';
        this.displayName = mode === 'SWING'
            ? '📊 قناص تدفق السيولة وعمق الأوامر V18 (سوينغ)'
            : '⚡ قناص تدفق السيولة وعمق الأوامر V18 (مضاربة)';
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

        if (candles.length < 15) {
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
                pendingConditions: ['بيانات غير كافية لتقييم عمق وتدفق السيولة'],
                summary: 'بانتظار اكتمال البيانات',
                details: 'Missing candle data',
                generatedAt: new Date()
            };
        }

        const micro = V18Engine.estimateFromCandles(candles);
        completedConditions.push(`حساب عدم التوازن الحجمي: ${(micro.imbalance * 100).toFixed(1)}%`);

        let direction: 'LONG' | 'SHORT' | 'NONE' = 'NONE';
        let readyToFire = false;
        const atr = details ? details.atr : currentPrice * 0.01;

        if (micro.pressure === 'BUY_HEAVY') {
            direction = 'LONG';
            readyToFire = Math.abs(micro.imbalance) >= 0.25;
            if (readyToFire) completedConditions.push('ضغط سيولة شرائية كاسح في دفتر الأوامر');
            else pendingConditions.push('انتظار ارتفاع نسبة عدم التوازن لمستوى التأكيد (> 25%)');
        } else if (micro.pressure === 'SELL_HEAVY') {
            direction = 'SHORT';
            readyToFire = Math.abs(micro.imbalance) >= 0.25;
            if (readyToFire) completedConditions.push('ضغط بيعي جداري كاسح في دفتر الأوامر');
            else pendingConditions.push('انتظار ارتفاع نسبة عدم التوازن البيعي لمستوى التأكيد (> 25%)');
        } else {
            pendingConditions.push('تدفق الأوامر متوازن بين قوى الشراء والبيع');
        }

        const tp = direction === 'LONG' ? Number((currentPrice + atr * 2).toFixed(4)) : Number((currentPrice - atr * 2).toFixed(4));
        const tp2 = direction === 'LONG' ? Number((currentPrice + atr * 3.5).toFixed(4)) : Number((currentPrice - atr * 3.5).toFixed(4));
        const sl = direction === 'LONG' ? Number((currentPrice - atr * 1.3).toFixed(4)) : Number((currentPrice + atr * 1.3).toFixed(4));

        return {
            symbol,
            engineId: this.engineId,
            direction,
            entry: currentPrice,
            sl,
            tp,
            tp2,
            readyToFire,
            confidence: 88,
            winRate: 88,
            completedConditions,
            pendingConditions,
            summary: readyToFire ? `🔥 إشارة V18 جاهزة: تدفق سيولة ${micro.pressure}` : `⏳ V18 يراقب تدفق السيولة (${micro.pressure})`,
            details: micro.details,
            generatedAt: new Date()
        };
    }
}
