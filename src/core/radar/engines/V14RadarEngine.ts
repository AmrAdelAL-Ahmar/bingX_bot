import { OHLCV, AnalysisDetails } from '../../shared/types';
import { IRadarEngine, RadarInvalidationResult } from './IRadarEngine';

export class V14RadarEngine implements IRadarEngine {
    readonly engineId = 'V14-RENKO-AUTOMATED';

    monitor(
        direction: 'LONG' | 'SHORT',
        currentPrice: number,
        ohlcv: OHLCV[],
        allTimeframes: Record<string, AnalysisDetails>,
        mtfOHLCV: Record<string, OHLCV[]>
    ): RadarInvalidationResult {
        if (ohlcv.length < 100) {
            return { invalidate: false, action: 'EXIT', reason: 'بيانات غير كافية لـ V14' };
        }

        // 1. Calculate Brick Size using daily ATR (or fallback)
        const dailyData = allTimeframes['1d'] || allTimeframes['4h'];
        const dailyAtr = dailyData?.atr || currentPrice * 0.005;
        const multiplier = 1.0; // standard multiplier
        const brickSize = dailyAtr * multiplier || 0.0001;

        // 2. Generate Renko Bricks
        const bricks = this.calculateRenkoBricks(ohlcv, brickSize);
        if (bricks.length < 3) {
            return { invalidate: false, action: 'EXIT', reason: 'طوب الرينكو غير كافٍ للمراقبة' };
        }

        // 3. Calculate Ichimoku Kumo Cloud Span B
        const ichimoku = this.calculateIchimoku(ohlcv, ohlcv.length - 1);

        const last3 = bricks.slice(-3);
        const allRed = last3.every(b => b.type === 'RED');
        const allGreen = last3.every(b => b.type === 'GREEN');

        if (direction === 'LONG') {
            // Invalidation: 3 red bricks and price below Senkou Span B
            if (allRed && currentPrice < ichimoku.senkouB) {
                return {
                    invalidate: true,
                    action: 'EXIT',
                    reason: `تكون 3 طوبات حمراء متتالية مع تداول السعر ($${currentPrice.toFixed(4)}) أسفل خط السحابة السفلي Senkou B ($${ichimoku.senkouB.toFixed(4)})`
                };
            }
        } else {
            // Invalidation: 3 green bricks and price above Senkou Span B
            if (allGreen && currentPrice > ichimoku.senkouB) {
                return {
                    invalidate: true,
                    action: 'EXIT',
                    reason: `تكون 3 طوبات خضراء متتالية مع تداول السعر ($${currentPrice.toFixed(4)}) أعلى خط السحابة السفلي Senkou B ($${ichimoku.senkouB.toFixed(4)})`
                };
            }
        }

        return { invalidate: false, action: 'EXIT', reason: 'اتجاه الرينكو متوافق مع الصفقة' };
    }

    private calculateRenkoBricks(ohlcv: OHLCV[], brickSize: number): { type: 'GREEN' | 'RED'; price: number }[] {
        const bricks: { type: 'GREEN' | 'RED'; price: number }[] = [];
        if (ohlcv.length === 0) return bricks;

        let lastBrickPrice = ohlcv[0].close;

        for (let i = 1; i < ohlcv.length; i++) {
            const price = ohlcv[i].close;
            const diff = price - lastBrickPrice;
            const numBricks = Math.floor(Math.abs(diff) / brickSize);

            if (numBricks >= 1) {
                const type = diff > 0 ? 'GREEN' : 'RED';
                for (let j = 0; j < numBricks; j++) {
                    lastBrickPrice += (diff > 0 ? brickSize : -brickSize);
                    bricks.push({ type, price: lastBrickPrice });
                }
            }
        }
        return bricks;
    }

    private calculateIchimoku(ohlcv: OHLCV[], index: number): { senkouB: number } {
        const getHighLow = (start: number, end: number) => {
            let max = -Infinity;
            let min = Infinity;
            for (let i = start; i <= end; i++) {
                if (ohlcv[i].high > max) max = ohlcv[i].high;
                if (ohlcv[i].low < min) min = ohlcv[i].low;
            }
            return { max, min };
        };

        const calcIndex = index - 26;
        if (calcIndex < 52) {
            return { senkouB: ohlcv[index].close };
        }

        // Senkou Span B = 52-period high/low plotted 26 periods ahead (calculated at index - 26)
        const s52 = getHighLow(calcIndex - 51, calcIndex);
        const senkouB = (s52.max + s52.min) / 2;

        return { senkouB };
    }
}
