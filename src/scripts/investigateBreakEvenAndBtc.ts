import dotenv from 'dotenv';
dotenv.config();
import mongoose from 'mongoose';
import Trade from '../models/Trade';
import { BingXService } from '../services/BingXService';

async function main() {
    await mongoose.connect(process.env.MONGODB_URI || '');
    const bingx = new BingXService(process.env.BINGX_API_KEY || '', process.env.BINGX_SECRET_KEY || '');

    console.log('========================================================================');
    console.log('🔬 FORENSIC INVESTIGATION: AUTO BREAK-EVEN & BITCOIN COMPASS VERIFICATION');
    console.log('========================================================================\n');

    // 1. Get all paper trades that exited on Break-Even
    const trades = await Trade.find({ isPaperTrade: true }).sort({ entryTime: -1 }).lean();
    const breakEvenTrades = trades.filter(t => {
        const isClosed = t.currentStatus?.startsWith('CLOSED');
        const pnl = t.realizedPnl || 0;
        const wasBe = t.logs?.some(l => l.includes('Auto Break-Even'));
        return isClosed && (wasBe || (pnl <= 0 && pnl >= -0.30));
    });

    console.log(`Found ${breakEvenTrades.length} Break-Even trades to investigate.\n`);

    let savedCount = 0;
    let chokedCount = 0;
    let inconclusiveCount = 0;

    console.log('--- 1. POST-EXIT TRAJECTORY AUDIT (Did price hit original SL or TP?) ---');

    for (const t of breakEvenTrades.slice(0, 15)) {
        const symbol = t.symbol;
        const direction = t.direction;
        const entry = t.entryPrice;
        const origSL = t.stopLoss;
        const tp1 = t.targets?.[0]?.price || (direction === 'LONG' ? entry * 1.015 : entry * 0.985);
        const entryTime = new Date((t as any).createdAt || t.entryTime).getTime();
        const closeTime = new Date((t as any).closedAt || t.closeTime || (entryTime + 3600000)).getTime();

        try {
            // Fetch 15m candles from entry time to 12 hours after
            const candles = await bingx.fetchOHLCV(symbol, '15m', 60);
            if (!candles || candles.length === 0) {
                console.log(`[${symbol}] Could not fetch historical candles.`);
                inconclusiveCount++;
                continue;
            }

            // Find candles after exit time
            const postExitCandles = candles.filter((c: any) => c.timestamp >= closeTime);
            if (postExitCandles.length === 0) {
                console.log(`[${symbol} ${direction}] Exit is too recent to determine post-exit trajectory.`);
                inconclusiveCount++;
                continue;
            }

            let hitOriginalSL = false;
            let hitTarget = false;
            let minPriceAfterExit = Infinity;
            let maxPriceAfterExit = -Infinity;

            for (const c of postExitCandles) {
                if (c.low < minPriceAfterExit) minPriceAfterExit = c.low;
                if (c.high > maxPriceAfterExit) maxPriceAfterExit = c.high;

                if (direction === 'LONG') {
                    if (c.low <= origSL) {
                        hitOriginalSL = true;
                        break;
                    }
                    if (c.high >= tp1) {
                        hitTarget = true;
                        break;
                    }
                } else if (direction === 'SHORT') {
                    if (c.high >= origSL) {
                        hitOriginalSL = true;
                        break;
                    }
                    if (c.low <= tp1) {
                        hitTarget = true;
                        break;
                    }
                }
            }

            console.log(`\n• [${symbol} ${direction}] Entry: ${entry} | Exit: ${t.exitPrice} | Orig SL: ${origSL} | TP1: ${tp1}`);
            console.log(`  Entry Date: ${new Date(entryTime).toLocaleString()}`);
            console.log(`  Post-Exit Min: ${minPriceAfterExit} | Max: ${maxPriceAfterExit}`);

            if (hitOriginalSL) {
                savedCount++;
                console.log(`  👉 RESULT: 🛡️ SAVED BY BREAK-EVEN! (Price collapsed to ${minPriceAfterExit} and hit original SL: ${origSL})`);
            } else if (hitTarget) {
                chokedCount++;
                console.log(`  👉 RESULT: ⚠️ CHOKED BY BREAK-EVEN! (Price recovered and hit TP1: ${tp1} without hitting original SL)`);
            } else {
                inconclusiveCount++;
                console.log(`  👉 RESULT: ⏳ INCONCLUSIVE / SIDEWAYS (Neither original SL nor TP1 reached in window)`);
            }
        } catch (e: any) {
            console.log(`Error checking ${symbol}: ${e.message}`);
            inconclusiveCount++;
        }
    }

    console.log('\n========================================================================');
    console.log(`📊 SUMMARY OF BREAK-EVEN EFFECTIVENESS (Audited sample):`);
    console.log(`- 🛡️ Genuinely SAVED from full Stop-Loss: ${savedCount}`);
    console.log(`- ⚠️ Prematurely CHOKED (would have hit Target): ${chokedCount}`);
    console.log(`- ⏳ Inconclusive / Range-bound: ${inconclusiveCount}`);
    console.log('========================================================================\n');

    // 2. Bitcoin Compass Analysis
    console.log('--- 2. BITCOIN COMPASS IMPACT ANALYSIS ---');
    console.log('Checking trade creation dates vs Bitcoin Compass deployment...\n');

    const tradesBeforeCompass = trades.filter(t => new Date(t.entryTime).getTime() < new Date('2026-09-27T18:00:00Z').getTime());
    const tradesAfterCompass = trades.filter(t => new Date(t.entryTime).getTime() >= new Date('2026-09-27T18:00:00Z').getTime());

    console.log(`Trades created BEFORE Bitcoin Compass deployment: ${tradesBeforeCompass.length}`);
    console.log(`Trades created AFTER Bitcoin Compass deployment: ${tradesAfterCompass.length}`);

    const longsBefore = tradesBeforeCompass.filter(t => t.direction === 'LONG').length;
    const shortsBefore = tradesBeforeCompass.filter(t => t.direction === 'SHORT').length;
    console.log(`  - Direction Before Compass: LONGs: ${longsBefore} (${((longsBefore / (tradesBeforeCompass.length || 1)) * 100).toFixed(0)}%) | SHORTs: ${shortsBefore}`);

    const longsAfter = tradesAfterCompass.filter(t => t.direction === 'LONG').length;
    const shortsAfter = tradesAfterCompass.filter(t => t.direction === 'SHORT').length;
    console.log(`  - Direction After Compass: LONGs: ${longsAfter} | SHORTs: ${shortsAfter}`);

    await mongoose.disconnect();
}

main().catch(console.error);
