import { AnalysisDetails, OHLCV } from '../AnalysisService';
import { TechnicalAnalyzer, MATRIX_TFS } from '../TechnicalAnalyzer';
import { ISniperEngine, SniperReport } from './ISniperEngine';
import { ATR, RSI, EMA } from 'technicalindicators';

// ─── Interfaces ──────────────────────────────────────────────────────────────

interface SRLevel {
    price: number;
    strength: number; // عدد مرات الاختبار
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
    bos: boolean;       // Break of Structure
    choch: boolean;     // Change of Character
    direction: 'LONG' | 'SHORT' | 'NONE';
    reason: string;
}

// ─── V9 SMC Sniper Engine ─────────────────────────────────────────────────────

export class V9SniperEngine implements ISniperEngine {
    readonly engineId: string;
    readonly displayName: string;
    readonly mode: 'SWING' | 'SCALP';
    readonly requiredTFs: string[];

    constructor(mode: 'SWING' | 'SCALP' = 'SWING') {
        this.mode = mode;
        this.engineId = mode === 'SWING' ? 'V9-SWING' : 'V9-SCALP';
        this.displayName = mode === 'SWING'
            ? '🏛️ V9 قناص SMC الذكي (SWING)'
            : '⚡ V9 قناص SMC الذكي (SCALP)';
        this.requiredTFs = mode === 'SWING'
            ? ['1d', '4h', '1h', '15m']
            : ['4h', '1h', '15m', '5m'];
    }

    scan(
        symbol: string,
        cp: number,
        mtfOHLCV: Record<string, OHLCV[]>,
        allTimeframes: Record<string, AnalysisDetails>
    ): SniperReport {
        const now = new Date();
        const completed: string[] = [];
        const pending: string[] = [];

        // ── TF Selection ─────────────────────────────────────────────────────
        const htfKey  = this.mode === 'SWING' ? '4h' : '1h';
        const mtfKey  = this.mode === 'SWING' ? '1h' : '15m';
        const ltfKey  = this.mode === 'SWING' ? '15m' : '5m';

        const htfData  = mtfOHLCV[htfKey]  || [];
        const mtfData  = mtfOHLCV[mtfKey]  || [];
        const ltfData  = mtfOHLCV[ltfKey]  || [];

        if (htfData.length < 50 || mtfData.length < 20 || ltfData.length < 15) {
            return this.noSignal(symbol, cp, 'بيانات غير كافية', now);
        }

        // ── LAYER 1: HTF Market Structure (BOS / CHOCH) ──────────────────────
        const htfStruct = this.detectStructure(htfData);
        if (htfStruct.direction === 'NONE') {
            pending.push('🔸 الهيكل العلوي: لا يوجد كسر هيكل واضح بعد (BOS/CHOCH)');
            return this.noSignal(symbol, cp, 'لا توجد اتجاه واضح في الهيكل', now);
        }
        const direction = htfStruct.direction;
        completed.push(`✅ الهيكل العلوي (${htfKey}): ${htfStruct.reason}`);

        // ── LAYER 2: MTF Order Block + FVG Detection ─────────────────────────
        const orderBlocks = this.detectOrderBlocks(mtfData, direction);
        const fvgs = this.detectFVG(mtfData, direction);
        const srLevels = this.detectSRLevels(htfData, 50);

        let entryZone: { top: number; bottom: number; source: string } | null = null;

        // Check if price is in an Order Block
        const activeOB = orderBlocks.find(ob => {
            if (direction === 'LONG') return ob.direction === 'BULL' && cp <= ob.top && cp >= ob.bottom;
            return ob.direction === 'BEAR' && cp >= ob.bottom && cp <= ob.top;
        });

        if (activeOB) {
            entryZone = { top: activeOB.top, bottom: activeOB.bottom, source: 'Order Block' };
            completed.push(`✅ Order Block نشط: ${activeOB.bottom.toFixed(4)} — ${activeOB.top.toFixed(4)}`);
        }

        // Check if price is in a Fair Value Gap
        const activeFVG = fvgs.find(fvg => {
            if (direction === 'LONG') return fvg.direction === 'BULL' && cp <= fvg.top && cp >= fvg.bottom;
            return fvg.direction === 'BEAR' && cp >= fvg.bottom && cp <= fvg.top;
        });

        if (activeFVG && !entryZone) {
            entryZone = { top: activeFVG.top, bottom: activeFVG.bottom, source: 'Fair Value Gap (FVG)' };
            completed.push(`✅ FVG نشط: ${activeFVG.bottom.toFixed(4)} — ${activeFVG.top.toFixed(4)}`);
        }

        if (!entryZone) {
            pending.push(`🔸 لا يوجد Order Block أو FVG نشط — انتظار تراجع السعر`);
        }

        // ── LAYER 3: LTF Confirmation (CHOCH + RSI + Volume) ─────────────────
        const ltfStruct = this.detectStructure(ltfData);
        const ltfData_ = allTimeframes[ltfKey];
        const rsi = ltfData_?.rsi ?? 50;
        const atr = ltfData_?.atr ?? (cp * 0.005);

        let ltfConfirmed = false;
        if (direction === 'LONG' && ltfStruct.direction === 'LONG') {
            ltfConfirmed = true;
            completed.push(`✅ الزناد (${ltfKey}): CHOCH صاعد — انعكاس تأكد`);
        } else if (direction === 'SHORT' && ltfStruct.direction === 'SHORT') {
            ltfConfirmed = true;
            completed.push(`✅ الزناد (${ltfKey}): CHOCH هابط — انعكاس تأكد`);
        } else {
            pending.push(`🔸 الزناد (${ltfKey}): انتظار CHOCH تأكيدي في اتجاه الصفقة`);
        }

        // RSI confluence
        const rsiOk = direction === 'LONG' ? rsi < 65 && rsi > 30 : rsi > 35 && rsi < 70;
        if (rsiOk) {
            completed.push(`✅ RSI (${ltfKey}): ${rsi.toFixed(1)} — مناسب لدخول ${direction}`);
        } else {
            pending.push(`🔸 RSI (${ltfKey}): ${rsi.toFixed(1)} — قد يكون في منطقة تشبع`);
        }

        // Volume spike
        const recentVols = ltfData.slice(-10).map(c => c.volume);
        const avgVol = recentVols.slice(0, -1).reduce((a, b) => a + b, 0) / 9;
        const volSpike = recentVols[recentVols.length - 1] > avgVol * 1.4;
        if (volSpike) completed.push(`✅ Volume: ارتفاع حجم التداول — تأكيد المؤسسات`);
        else pending.push(`🔸 Volume: انتظار حجم تداول مرتفع لتأكيد الدخول`);

        // ── LAYER 4: MTF Matrix ───────────────────────────────────────────────
        const matrix = TechnicalAnalyzer.calculateMatrix(allTimeframes);
        const matrixOk = direction === 'LONG' ? matrix.percentage >= 55 : matrix.percentage <= 45;
        if (matrixOk) {
            completed.push(`✅ Matrix MTF: ${matrix.percentage.toFixed(0)}% — توافق متعدد الفريمات`);
        } else {
            pending.push(`🔸 Matrix MTF: ${matrix.percentage.toFixed(0)}% — ضعف التوافق`);
        }

        // ── CONFIDENCE ───────────────────────────────────────────────────────
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
        const readyToFire = entryZone !== null && ltfConfirmed && rsiOk && confidence >= 70;

        // ── SL / TP from real S/R levels ──────────────────────────────────────
        const entryPrice = entryZone
            ? (direction === 'LONG' ? entryZone.bottom : entryZone.top)
            : cp;

        const { sl, tp, tp2 } = this.calcSLTPFromSR(
            entryPrice, direction, srLevels, atr, htfData, entryZone
        );

        // ── RRR check — must be >= 1.5:1 ──────────────────────────────────────
        const slDist = Math.abs(entryPrice - sl);
        const tpDist = Math.abs(tp - entryPrice);
        const rrr = slDist > 0 ? tpDist / slDist : 0;

        if (rrr < 1.5) {
            pending.push(`🔸 نسبة العائد/الخطر: ${rrr.toFixed(2)}:1 — ضعيفة جداً، انتظار مستوى أفضل`);
        } else {
            completed.push(`✅ RRR: ${rrr.toFixed(2)}:1 — ممتاز`);
        }

        const finalReady = readyToFire && rrr >= 1.5;

        // ── Summary & Details ─────────────────────────────────────────────────
        const summary = finalReady
            ? `🏛️ إشارة SMC جاهزة (${completed.length}/${completed.length + pending.length} شروط)`
            : `🔍 استعداد SMC (${completed.length}/${completed.length + pending.length} شروط)`;

        const details = this.buildDetails(
            symbol, direction, entryPrice, sl, tp, tp2,
            confidence, winRate, entryZone, completed, pending, finalReady, rrr
        );

        return {
            symbol,
            engineId: this.engineId,
            direction,
            entry: entryPrice,
            sl,
            tp,
            tp2,
            readyToFire: finalReady,
            confidence,
            winRate,
            completedConditions: completed,
            pendingConditions: pending,
            summary,
            details,
            generatedAt: now
        };
    }

    // ─── S/R Detection ────────────────────────────────────────────────────────

    private detectSRLevels(ohlcv: OHLCV[], lookback = 50): SRLevel[] {
        const candles = ohlcv.slice(-lookback);
        const levels: SRLevel[] = [];
        const tolerance = (Math.max(...candles.map(c => c.high)) - Math.min(...candles.map(c => c.low))) * 0.003;

        // Find swing highs and lows (fractals)
        for (let i = 2; i < candles.length - 2; i++) {
            const c = candles[i];

            // Swing high fractal
            if (c.high > candles[i-1].high && c.high > candles[i-2].high &&
                c.high > candles[i+1].high && c.high > candles[i+2].high) {
                const existing = levels.find(l => l.type === 'RESISTANCE' && Math.abs(l.price - c.high) < tolerance);
                if (existing) existing.strength++;
                else levels.push({ price: c.high, strength: 1, type: 'RESISTANCE' });
            }

            // Swing low fractal
            if (c.low < candles[i-1].low && c.low < candles[i-2].low &&
                c.low < candles[i+1].low && c.low < candles[i+2].low) {
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

            // Bullish OB: last bearish candle before a strong bullish move
            if (direction === 'LONG' &&
                curr.close < curr.open && // bearish candle
                next.close > next.open &&  // followed by bullish
                next.close > curr.high) {  // strong push up
                obs.push({ top: curr.open, bottom: curr.close, direction: 'BULL', index: i });
            }

            // Bearish OB: last bullish candle before a strong bearish move
            if (direction === 'SHORT' &&
                curr.close > curr.open && // bullish candle
                next.close < next.open &&  // followed by bearish
                next.close < curr.low) {   // strong push down
                obs.push({ top: curr.close, bottom: curr.open, direction: 'BEAR', index: i });
            }
        }

        return obs.slice(0, 5); // أهم 5 OB فقط
    }

    private detectFVG(ohlcv: OHLCV[], direction: 'LONG' | 'SHORT'): FVG[] {
        const fvgs: FVG[] = [];
        for (let i = 1; i < ohlcv.length - 1; i++) {
            const prev = ohlcv[i - 1];
            const next = ohlcv[i + 1];

            // Bullish FVG: gap between prev.high and next.low (unfilled)
            if (direction === 'LONG' && next.low > prev.high) {
                fvgs.push({ top: next.low, bottom: prev.high, direction: 'BULL' });
            }
            // Bearish FVG: gap between next.high and prev.low
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

        // BOS Bullish: break above previous swing high
        if (lastH > prevH && lastL > prevL) {
            return { bos: true, choch: false, direction: 'LONG', reason: 'BOS صاعد (HH/HL) — كسر هيكل تصاعدي' };
        }
        // BOS Bearish
        if (lastH < prevH && lastL < prevL) {
            return { bos: true, choch: false, direction: 'SHORT', reason: 'BOS هابط (LH/LL) — كسر هيكل تنازلي' };
        }
        // CHOCH: was bearish trend, now making HH
        if (lastH > prevH && lastL < prevL) {
            return { bos: false, choch: true, direction: 'LONG', reason: 'CHOCH صاعد — تغيير طابع السوق (شراء)' };
        }

        return { bos: false, choch: false, direction: 'NONE', reason: 'هيكل عرضي — لا توجد إشارة' };
    }

    // ─── SL/TP from Real S/R ─────────────────────────────────────────────────

    private calcSLTPFromSR(
        entry: number,
        direction: 'LONG' | 'SHORT',
        srLevels: SRLevel[],
        atr: number,
        ohlcv: OHLCV[],
        entryZone: { top: number; bottom: number } | null
    ): { sl: number; tp: number; tp2: number } {
        const buffer = atr * 0.25;

        // ── SL: just beyond the nearest S/R on the opposite side ──────────────
        let sl: number;
        if (direction === 'LONG') {
            // Find nearest support below entry
            const supports = srLevels
                .filter(l => l.type === 'SUPPORT' && l.price < entry)
                .sort((a, b) => b.price - a.price); // nearest first

            if (supports.length > 0) {
                sl = supports[0].price - buffer;
            } else if (entryZone) {
                sl = entryZone.bottom - buffer;
            } else {
                const recentLow = Math.min(...ohlcv.slice(-10).map(c => c.low));
                sl = recentLow - buffer;
            }
            // Cap: max 3% from entry
            sl = Math.max(sl, entry * 0.97);
        } else {
            // Find nearest resistance above entry
            const resistances = srLevels
                .filter(l => l.type === 'RESISTANCE' && l.price > entry)
                .sort((a, b) => a.price - b.price); // nearest first

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

        // ── TP1: next significant S/R in trade direction ──────────────────────
        let tp: number;
        let tp2: number;
        if (direction === 'LONG') {
            const resistances = srLevels
                .filter(l => l.type === 'RESISTANCE' && l.price > entry + atr)
                .sort((a, b) => a.price - b.price);

            if (resistances.length >= 2) {
                tp  = resistances[0].price - buffer;
                tp2 = resistances[1].price - buffer;
            } else if (resistances.length === 1) {
                tp  = resistances[0].price - buffer;
                tp2 = tp + atr * 2;
            } else {
                const slDist = Math.abs(entry - sl);
                tp  = entry + slDist * 2.5;
                tp2 = entry + slDist * 4.0;
            }
        } else {
            const supports = srLevels
                .filter(l => l.type === 'SUPPORT' && l.price < entry - atr)
                .sort((a, b) => b.price - a.price);

            if (supports.length >= 2) {
                tp  = supports[0].price + buffer;
                tp2 = supports[1].price + buffer;
            } else if (supports.length === 1) {
                tp  = supports[0].price + buffer;
                tp2 = tp - atr * 2;
            } else {
                const slDist = Math.abs(entry - sl);
                tp  = entry - slDist * 2.5;
                tp2 = entry - slDist * 4.0;
            }
        }

        return { sl, tp, tp2 };
    }

    // ─── No-Signal helper ─────────────────────────────────────────────────────

    private noSignal(symbol: string, cp: number, reason: string, now: Date): SniperReport {
        const details = `🏛️ *${this.displayName}*\n\n🔍 لا توجد إشارة حالياً\nالسبب: ${reason}`;
        return {
            symbol, engineId: this.engineId, direction: 'NONE',
            entry: cp, sl: cp, tp: cp, readyToFire: false,
            confidence: 0, winRate: 0,
            completedConditions: [],
            pendingConditions: [reason],
            summary: `🔍 ${reason}`,
            details, generatedAt: now
        };
    }

    // ─── Report Builder ───────────────────────────────────────────────────────

    private buildDetails(
        symbol: string, direction: 'LONG' | 'SHORT' | 'NONE',
        entry: number, sl: number, tp: number, tp2: number | undefined,
        confidence: number, winRate: number,
        zone: { top: number; bottom: number; source: string } | null,
        completed: string[], pending: string[],
        readyToFire: boolean, rrr: number
    ): string {
        const sym = symbol.split('/')[0];
        const dirEmoji = direction === 'LONG' ? '🟢 LONG' : '🔴 SHORT';
        const title = `🏛️ محرك الاقتناص ⚡ V9 قناص SMC الذكي (${this.mode})`;

        let text = `${title}\n💎 ${sym}/USDT | ${dirEmoji}\n━━━━━━━━━━━━━━\n📊 *التقرير التفصيلي:*\n` +
            `• الدخول: \`$${entry.toFixed(4)}\`\n` +
            `• وقف الخسارة: \`$${sl.toFixed(4)}\` (${(((sl - entry) / entry) * 100).toFixed(2)}%)\n` +
            `• الهدف الأول: \`$${tp.toFixed(4)}\` (${(((tp - entry) / entry) * 100).toFixed(2)}%)\n`;

        if (tp2) text += `• الهدف الثاني: \`$${tp2.toFixed(4)}\` (${(((tp2 - entry) / entry) * 100).toFixed(2)}%)\n`;

        text += `• نسبة العائد/الخطر: \`${rrr.toFixed(2)}:1\`\n` +
            `• الثقة: \`${confidence.toFixed(1)}%\` | معدل النجاح: \`${winRate.toFixed(1)}%\`\n`;

        if (zone) text += `• المنطقة (${zone.source}): \`$${zone.bottom.toFixed(4)}\` — \`$${zone.top.toFixed(4)}\`\n`;

        text += `━━━━━━━━━━━━━━\n✅ *الشروط المكتملة (${completed.length}):*\n` +
            completed.map(c => `✅ ${c.replace('✅ ', '')}`).join('\n') + '\n\n';

        if (pending.length > 0) {
            text += `🔸 *الشروط المنتظرة (${pending.length}):*\n` +
                pending.map(p => `🔸 ${p.replace('🔸 ', '')}`).join('\n') + '\n';
        }

        text += `━━━━━━━━━━━━━━\n` + (readyToFire
            ? `🚀 *إشارة SMC ممتازة — الدخول مؤكد!*`
            : `⏳ *في وضع الانتظار — سيتم إشعارك عند اكتمال الشروط*`);

        return text;
    }
}
