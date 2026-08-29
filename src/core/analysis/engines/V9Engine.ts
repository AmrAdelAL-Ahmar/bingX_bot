import { AnalysisDetails, MatrixResult, OHLCV, TradeRecommendation } from '../../shared/types';
import { ITradingEngine, EngineResult } from './ITradingEngine';
import { TechnicalAnalyzer } from '../TechnicalAnalyzer';
import { OptimizedEngineSuite } from './OptimizedEngineSuite';

interface SRLevel {
    price: number;
    strength: number;
    type: 'SUPPORT' | 'RESISTANCE';
}

interface OrderBlock {
    top: number;
    bottom: number;
    direction: 'BULL' | 'BEAR';
    index: number;
}

interface FVG {
    top: number;
    bottom: number;
    direction: 'BULL' | 'BEAR';
}

interface StructureResult {
    bos: boolean;
    choch: boolean;
    direction: 'LONG' | 'SHORT' | 'NONE';
    reason: string;
}

export class V9Engine implements ITradingEngine {
    analyze(
        cp: number,
        vwap: number,
        allTimeframes: Record<string, AnalysisDetails>,
        mtfOHLCV: Record<string, OHLCV[]>,
        options: { quickTF: string; longTF: string; params?: Record<string, any> }
    ): EngineResult {
        const matrix = TechnicalAnalyzer.calculateMatrix(allTimeframes);

        return {
            matrix,
            scalp: this.runV9Pipeline(cp, vwap, allTimeframes, mtfOHLCV, matrix, 'SCALP', options, options.quickTF),
            swing: this.runV9Pipeline(cp, vwap, allTimeframes, mtfOHLCV, matrix, 'SWING', options, options.longTF),
        };
    }

    private runV9Pipeline(
        cp: number,
        vwap: number,
        allTimeframes: Record<string, AnalysisDetails>,
        mtfOHLCV: Record<string, OHLCV[]>,
        matrix: MatrixResult,
        mode: 'SCALP' | 'SWING',
        options?: { quickTF: string; longTF: string; params?: Record<string, any> },
        tf?: string
    ): TradeRecommendation {
        const htfKey = mode === 'SWING' ? '4h' : '1h';
        const mtfKey = mode === 'SWING' ? '1h' : '15m';
        const ltfKey = mode === 'SWING' ? '15m' : '5m';

        const htfData = mtfOHLCV[htfKey] || [];
        const mtfData = mtfOHLCV[mtfKey] || [];
        const ltfData = mtfOHLCV[ltfKey] || [];

        if (htfData.length < 50 || mtfData.length < 20 || ltfData.length < 15) {
            return this.cancel(cp, '⚪ بيانات غير كافية لتحليل SMC (V9)', mode, 0, 'Insufficient data');
        }

        // 1. HTF Structure
        const htfStruct = this.detectStructure(htfData);
        if (htfStruct.direction === 'NONE') {
            return this.cancel(cp, '⚪ لا اتجاه واضح في هيكل السوق (V9)', mode, 0, `HTF Structure Neutral: ${htfStruct.reason}`);
        }
        const direction = htfStruct.direction;

        // 2. MTF OB + FVG + S/R Levels
        const orderBlocks = this.detectOrderBlocks(mtfData, direction);
        const fvgs = this.detectFVG(mtfData, direction);
        const srLevels = this.detectSRLevels(htfData, 50);

        let entryZone: { top: number; bottom: number; source: string } | null = null;

        const activeOB = orderBlocks.find(ob => {
            if (direction === 'LONG') return ob.direction === 'BULL' && cp <= ob.top && cp >= ob.bottom;
            return ob.direction === 'BEAR' && cp >= ob.bottom && cp <= ob.top;
        });

        if (activeOB) {
            entryZone = { top: activeOB.top, bottom: activeOB.bottom, source: 'Order Block' };
        }

        const activeFVG = fvgs.find(fvg => {
            if (direction === 'LONG') return fvg.direction === 'BULL' && cp <= fvg.top && cp >= fvg.bottom;
            return fvg.direction === 'BEAR' && cp >= fvg.bottom && cp <= fvg.top;
        });

        if (activeFVG && !entryZone) {
            entryZone = { top: activeFVG.top, bottom: activeFVG.bottom, source: 'Fair Value Gap (FVG)' };
        }

        // 3. LTF Confirmation
        const ltfStruct = this.detectStructure(ltfData);
        const ltfData_ = allTimeframes[ltfKey];
        const rsi = ltfData_?.rsi ?? 50;
        const atr = ltfData_?.atr ?? (cp * 0.005);

        let ltfConfirmed = false;
        if (direction === 'LONG' && ltfStruct.direction === 'LONG') {
            ltfConfirmed = true;
        } else if (direction === 'SHORT' && ltfStruct.direction === 'SHORT') {
            ltfConfirmed = true;
        }

        const rsiOk = direction === 'LONG' ? rsi < 65 && rsi > 30 : rsi > 35 && rsi < 70;

        const recentVols = ltfData.slice(-10).map(c => c.volume);
        const avgVol = recentVols.slice(0, -1).reduce((a, b) => a + b, 0) / 9;
        const volSpike = recentVols[recentVols.length - 1] > avgVol * 1.4;

        const matrixOk = direction === 'LONG' ? matrix.percentage >= 55 : matrix.percentage <= 45;

        // Confidence
        let confidence = 35;
        if (htfStruct.bos) confidence += 15;
        if (htfStruct.choch) confidence += 10;
        if (entryZone) confidence += 20;
        if (ltfConfirmed) confidence += 15;
        if (rsiOk) confidence += 10;
        if (volSpike) confidence += 10;
        if (matrixOk) confidence += 10;
        confidence = Math.min(Math.max(confidence, 10), 95);

        const winRate = Math.min(50 + confidence * 0.48, 96);

        // SL / TP
        let entryPrice = entryZone
            ? (direction === 'LONG' ? entryZone.bottom : entryZone.top)
            : cp;

        const { sl, tp, tp2 } = this.calcSLTPFromSR(
            entryPrice, direction, srLevels, atr, htfData, entryZone
        );

        const slDist = Math.abs(entryPrice - sl);
        const tpDist = Math.abs(tp - entryPrice);
        const rrr = slDist > 0 ? tpDist / slDist : 0;

        // High Precision Filter Check
        const useFilter = options?.params?.highPrecisionFilter !== false;
        if (useFilter && allTimeframes) {
            const frame = OptimizedEngineSuite.buildMarketFrame(direction, cp, matrix, allTimeframes, tf || '5m');
            const passed = OptimizedEngineSuite.runV9(frame);
            if (!passed) {
                return this.cancel(cp, '⚪ ملغاة: لم تتطابق شروط V9 (Golden Wave & Pullback)', mode, confidence, `Failed V9 Filter. 1H_RSI: ${frame.rsi1h?.toFixed(1) ?? 'N/A'}, 4H_RSI: ${frame.rsi4h?.toFixed(1) ?? 'N/A'}, MACD_Hist: ${frame.quickMacdHist ?? 'N/A'}`);
            }
        }

        const ready = entryZone !== null && ltfConfirmed && rsiOk && confidence >= 70 && rrr >= 1.5;

        if (!ready) {
            let reason = 'انتظار شروط SMC: ';
            if (!entryZone) reason += 'لا توجد منطقة اهتمام OB/FVG، ';
            if (!ltfConfirmed) reason += 'لم يتأكد كسر هيكل المسار الصغير CHOCH، ';
            if (!rsiOk) reason += 'مؤشر RSI غير مهيأ، ';
            if (rrr < 1.5) reason += `العائد/الخطر ${rrr.toFixed(1)} < 1.5، `;
            if (confidence < 70) reason += `نسبة الثقة ${confidence}% < 70%`;
            return this.cancel(cp, `🔍 V9 انتظار: ${reason.replace(/,\s*$/, '')}`, mode, confidence, reason);
        }

        const signalReason = [
            `🎯 V9 SMC Sniper [${mode}]`,
            `Structure: ${htfStruct.reason}`,
            `Zone: ${entryZone?.source} (${entryZone?.bottom.toFixed(2)}-${entryZone?.top.toFixed(2)})`,
            `WinRate: ${winRate.toFixed(0)}%`,
            `RRR: ${rrr.toFixed(1)}:1`
        ].join(' | ');

        return {
            status: `${direction === 'LONG' ? '🟢 قناص SMC صاعد' : '🔴 قناص SMC هابط'} V9 (${winRate.toFixed(0)}%)`,
            type: direction,
            entry: cp,
            tp,
            tp2,
            sl,
            timeEstimate: mode === 'SCALP' ? 30 : 240,
            winRate,
            reverseProb: 100 - winRate,
            confidenceScore: confidence,
            signalReason
        };
    }

    private detectSRLevels(ohlcv: OHLCV[], lookback = 50): SRLevel[] {
        const candles = ohlcv.slice(-lookback);
        const levels: SRLevel[] = [];
        const tolerance = (Math.max(...candles.map(c => c.high)) - Math.min(...candles.map(c => c.low))) * 0.003;

        for (let i = 2; i < candles.length - 2; i++) {
            const c = candles[i];

            if (c.high > candles[i - 1].high && c.high > candles[i - 2].high &&
                c.high > candles[i + 1].high && c.high > candles[i + 2].high) {
                const existing = levels.find(l => l.type === 'RESISTANCE' && Math.abs(l.price - c.high) < tolerance);
                if (existing) existing.strength++;
                else levels.push({ price: c.high, strength: 1, type: 'RESISTANCE' });
            }

            if (c.low < candles[i - 1].low && c.low < candles[i - 2].low &&
                c.low < candles[i + 1].low && c.low < candles[i + 2].low) {
                const existing = levels.find(l => l.type === 'SUPPORT' && Math.abs(l.price - c.low) < tolerance);
                if (existing) existing.strength++;
                else levels.push({ price: c.low, strength: 1, type: 'SUPPORT' });
            }
        }

        return levels.sort((a, b) => b.strength - a.strength);
    }

    private detectOrderBlocks(ohlcv: OHLCV[], direction: 'LONG' | 'SHORT'): OrderBlock[] {
        const obs: OrderBlock[] = [];
        const lookback = Math.min(ohlcv.length - 1, 30);

        for (let i = lookback - 3; i >= 2; i--) {
            const curr = ohlcv[i];
            const next = ohlcv[i + 1];

            if (direction === 'LONG' &&
                curr.close < curr.open &&
                next.close > next.open &&
                next.close > curr.high) {
                obs.push({ top: curr.open, bottom: curr.close, direction: 'BULL', index: i });
            }

            if (direction === 'SHORT' &&
                curr.close > curr.open &&
                next.close < next.open &&
                next.close < curr.low) {
                obs.push({ top: curr.close, bottom: curr.open, direction: 'BEAR', index: i });
            }
        }

        return obs.slice(0, 5);
    }

    private detectFVG(ohlcv: OHLCV[], direction: 'LONG' | 'SHORT'): FVG[] {
        const fvgs: FVG[] = [];
        for (let i = 1; i < ohlcv.length - 1; i++) {
            const prev = ohlcv[i - 1];
            const next = ohlcv[i + 1];

            if (direction === 'LONG' && next.low > prev.high) {
                fvgs.push({ top: next.low, bottom: prev.high, direction: 'BULL' });
            }
            if (direction === 'SHORT' && prev.low > next.high) {
                fvgs.push({ top: prev.low, bottom: next.high, direction: 'BEAR' });
            }
        }
        return fvgs.slice(-8);
    }

    private detectStructure(ohlcv: OHLCV[]): StructureResult {
        if (ohlcv.length < 20) return { bos: false, choch: false, direction: 'NONE', reason: 'بيانات غير كافية' };

        const recent = ohlcv.slice(-20);
        const highs = recent.map(c => c.high);
        const lows = recent.map(c => c.low);
        const lastH = highs[highs.length - 1];
        const prevH = Math.max(...highs.slice(-10, -1));
        const lastL = lows[lows.length - 1];
        const prevL = Math.min(...lows.slice(-10, -1));

        if (lastH > prevH && lastL > prevL) {
            return { bos: true, choch: false, direction: 'LONG', reason: 'BOS صاعد (HH/HL) — كسر هيكل تصاعدي' };
        }
        if (lastH < prevH && lastL < prevL) {
            return { bos: true, choch: false, direction: 'SHORT', reason: 'BOS هابط (LH/LL) — كسر هيكل تنازلي' };
        }
        if (lastH > prevH && lastL < prevL) {
            return { bos: false, choch: true, direction: 'LONG', reason: 'CHOCH صاعد — تغيير طابع السوق (شراء)' };
        }

        return { bos: false, choch: false, direction: 'NONE', reason: 'هيكل عرضي — لا توجد إشارة' };
    }

    private calcSLTPFromSR(
        entry: number,
        direction: 'LONG' | 'SHORT',
        srLevels: SRLevel[],
        atr: number,
        ohlcv: OHLCV[],
        entryZone: { top: number; bottom: number } | null
    ): { sl: number; tp: number; tp2: number } {
        const buffer = atr * 0.25;

        let sl: number;
        if (direction === 'LONG') {
            const supports = srLevels
                .filter(l => l.type === 'SUPPORT' && l.price < entry)
                .sort((a, b) => b.price - a.price);

            if (supports.length > 0) {
                sl = supports[0].price - buffer;
            } else if (entryZone) {
                sl = entryZone.bottom - buffer;
            } else {
                const recentLow = Math.min(...ohlcv.slice(-10).map(c => c.low));
                sl = recentLow - buffer;
            }
            sl = Math.max(sl, entry * 0.97);
        } else {
            const resistances = srLevels
                .filter(l => l.type === 'RESISTANCE' && l.price > entry)
                .sort((a, b) => a.price - b.price);

            if (resistances.length > 0) {
                sl = resistances[0].price + buffer;
            } else if (entryZone) {
                sl = entryZone.top + buffer;
            } else {
                const recentHigh = Math.max(...ohlcv.slice(-10).map(c => c.high));
                sl = recentHigh + buffer;
            }
            sl = Math.min(sl, entry * 1.03);
        }

        let tp: number;
        let tp2: number;
        if (direction === 'LONG') {
            const resistances = srLevels
                .filter(l => l.type === 'RESISTANCE' && l.price > entry + atr)
                .sort((a, b) => a.price - b.price);

            if (resistances.length >= 2) {
                tp = resistances[0].price - buffer;
                tp2 = resistances[1].price - buffer;
            } else if (resistances.length === 1) {
                tp = resistances[0].price - buffer;
                tp2 = tp + atr * 2;
            } else {
                const slDist = Math.abs(entry - sl);
                tp = entry + slDist * 2.5;
                tp2 = entry + slDist * 4.0;
            }
        } else {
            const supports = srLevels
                .filter(l => l.type === 'SUPPORT' && l.price < entry - atr)
                .sort((a, b) => b.price - a.price);

            if (supports.length >= 2) {
                tp = supports[0].price + buffer;
                tp2 = supports[1].price + buffer;
            } else if (supports.length === 1) {
                tp = supports[0].price + buffer;
                tp2 = tp - atr * 2;
            } else {
                const slDist = Math.abs(entry - sl);
                tp = entry - slDist * 2.5;
                tp2 = entry - slDist * 4.0;
            }
        }

        return { sl, tp, tp2 };
    }

    private cancel(
        cp: number,
        status: string,
        mode: string,
        score: number,
        reason: string
    ): TradeRecommendation {
        return {
            status,
            type: 'NONE',
            entry: cp, tp: cp, sl: cp,
            timeEstimate: mode === 'SCALP' ? 30 : 240,
            winRate: 0,
            reverseProb: 0,
            confidenceScore: score,
            signalReason: reason,
        };
    }
}
