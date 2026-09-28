import dotenv from 'dotenv';
dotenv.config();
import mongoose from 'mongoose';
import Trade from '../models/Trade';
import { BingXService } from '../services/BingXService';

async function main() {
    await mongoose.connect(process.env.MONGODB_URI || '');
    const bingx = new BingXService(process.env.BINGX_API_KEY || '', process.env.BINGX_SECRET_KEY || '');

    console.log('========================================================================');
    console.log('🔬 100% COMPLETE FORENSIC AUDIT: ANALYZING EVERY SINGLE LOSING TRADE');
    console.log('========================================================================\n');

    // Fetch ALL closed losing trades
    const allLosingTrades = await Trade.find({
        isPaperTrade: true,
        currentStatus: { $in: ['CLOSED_LOSS', 'CLOSED_TIMEOUT', 'CLOSED_SL', 'CLOSED_PROFIT'] },
        realizedPnl: { $lte: 0 }
    }).sort({ entryTime: -1 }).lean();

    console.log(`Total losing/zero-exit trades found in database: ${allLosingTrades.length}\n`);

    let beSavedCount = 0;
    let beChokedCount = 0;
    let beInconclusive = 0;
    let directSlHitCount = 0;

    const auditTable: {
        index: number;
        symbol: string;
        direction: string;
        pnl: number;
        entryPrice: number;
        exitPrice: number;
        origSL: number;
        tp1: number;
        type: 'BE_SAVED' | 'BE_CHOKED' | 'BE_INCONCLUSIVE' | 'DIRECT_SL';
        verdict: string;
        date: string;
    }[] = [];

    let count = 0;
    for (const t of allLosingTrades) {
        count++;
        const symbol = t.symbol;
        const direction = t.direction;
        const entry = t.entryPrice;
        const exit = t.exitPrice ?? entry;
        const origSL = t.stopLoss;
        const pnl = t.realizedPnl || 0;
        const tp1 = t.targets?.[0]?.price || (direction === 'LONG' ? entry * 1.015 : entry * 0.985);
        const entryTime = new Date((t as any).createdAt || t.entryTime).getTime();
        const closeTime = new Date((t as any).closedAt || t.closeTime || (entryTime + 3600000)).getTime();
        const wasAutoBe = t.logs?.some(l => l.includes('Auto Break-Even')) || (pnl <= 0 && pnl >= -0.30 && Math.abs(exit - entry) / entry < 0.005);

        // Case 1: Direct full Stop-Loss hit (never touched Break-Even)
        if (!wasAutoBe && pnl < -0.30) {
            directSlHitCount++;
            auditTable.push({
                index: count,
                symbol,
                direction,
                pnl,
                entryPrice: entry,
                exitPrice: exit,
                origSL,
                tp1,
                type: 'DIRECT_SL',
                verdict: '🛑 ضرب ستوب أصلي كامل مباشرة (لم يصل لنسبة التأمين)',
                date: new Date(entryTime).toLocaleDateString()
            });
            continue;
        }

        // Case 2: Break-Even Exit -> Audit historical post-exit trajectory
        try {
            await new Promise(r => setTimeout(r, 100)); // rate limit safety
            const candles = await bingx.fetchOHLCV(symbol, '15m', 60);

            if (!candles || candles.length === 0) {
                beInconclusive++;
                auditTable.push({
                    index: count,
                    symbol,
                    direction,
                    pnl,
                    entryPrice: entry,
                    exitPrice: exit,
                    origSL,
                    tp1,
                    type: 'BE_INCONCLUSIVE',
                    verdict: '⏳ غير حاسم (بيانات الشموع التاريخية غير متوفرة)',
                    date: new Date(entryTime).toLocaleDateString()
                });
                continue;
            }

            const postExitCandles = candles.filter((c: any) => c.timestamp >= closeTime);
            if (postExitCandles.length === 0) {
                beInconclusive++;
                auditTable.push({
                    index: count,
                    symbol,
                    direction,
                    pnl,
                    entryPrice: entry,
                    exitPrice: exit,
                    origSL,
                    tp1,
                    type: 'BE_INCONCLUSIVE',
                    verdict: '⏳ صفقة حديثة جداً لم تكتمل مسارها الزمني بعد',
                    date: new Date(entryTime).toLocaleDateString()
                });
                continue;
            }

            let hitOriginalSL = false;
            let hitTarget = false;
            let minPrice = Infinity;
            let maxPrice = -Infinity;

            for (const c of postExitCandles) {
                if (c.low < minPrice) minPrice = c.low;
                if (c.high > maxPrice) maxPrice = c.high;

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

            if (hitOriginalSL) {
                beSavedCount++;
                auditTable.push({
                    index: count,
                    symbol,
                    direction,
                    pnl,
                    entryPrice: entry,
                    exitPrice: exit,
                    origSL,
                    tp1,
                    type: 'BE_SAVED',
                    verdict: `🛡️ أنقذها التأمين! (انهار السعر إلى ${minPrice.toFixed(4)} وضرب الستوب الأصلي)`,
                    date: new Date(entryTime).toLocaleDateString()
                });
            } else if (hitTarget) {
                beChokedCount++;
                auditTable.push({
                    index: count,
                    symbol,
                    direction,
                    pnl,
                    entryPrice: entry,
                    exitPrice: exit,
                    origSL,
                    tp1,
                    type: 'BE_CHOKED',
                    verdict: `⚠️ خنقها التأمين! (تعافى السعر ووصل للهدف ${tp1.toFixed(4)} دون ضرب الستوب)`,
                    date: new Date(entryTime).toLocaleDateString()
                });
            } else {
                beInconclusive++;
                auditTable.push({
                    index: count,
                    symbol,
                    direction,
                    pnl,
                    entryPrice: entry,
                    exitPrice: exit,
                    origSL,
                    tp1,
                    type: 'BE_INCONCLUSIVE',
                    verdict: `⏳ حركة عرضية تذبذبية (بين ${minPrice.toFixed(4)} و ${maxPrice.toFixed(4)})`,
                    date: new Date(entryTime).toLocaleDateString()
                });
            }
        } catch (err: any) {
            beInconclusive++;
            auditTable.push({
                index: count,
                symbol,
                direction,
                pnl,
                entryPrice: entry,
                exitPrice: exit,
                origSL,
                tp1,
                type: 'BE_INCONCLUSIVE',
                verdict: `خطأ اتصال: ${err.message}`,
                date: new Date(entryTime).toLocaleDateString()
            });
        }
    }

    // Print the full table
    console.log('=== COMPLETE 1-BY-1 BREAKDOWN OF ALL LOSING TRADES ===');
    auditTable.forEach(row => {
        console.log(`#${row.index.toString().padStart(2, '0')} [${row.symbol.padEnd(22)} ${row.direction.padEnd(5)}] PnL: ${row.pnl.toFixed(2)} USDT | Entry: ${row.entryPrice} -> Exit: ${row.exitPrice}`);
        console.log(`    ${row.verdict}`);
    });

    console.log('\n========================================================================');
    console.log(`🏆 FINAL FORENSIC VERDICT ON ALL ${allLosingTrades.length} LOSING TRADES:`);
    console.log(`1. 🛑 صفقات ضربت الستوب الكامل مباشرة (لم تصل للـ BE): ${directSlHitCount} صفقة (${((directSlHitCount / allLosingTrades.length) * 100).toFixed(1)}%)`);
    console.log(`2. 🛡️ صفقات أنقذها نظام التأمين من خسارة كبيرة محققة: ${beSavedCount} صفقة (${((beSavedCount / allLosingTrades.length) * 100).toFixed(1)}%)`);
    console.log(`3. ⚠️ صفقات خنقها التأمين مبكراً ثم ذهبت للهدف: ${beChokedCount} صفقة (${((beChokedCount / allLosingTrades.length) * 100).toFixed(1)}%)`);
    console.log(`4. ⏳ صفقات غير حاسمة / تذبذب عرضي / حديثة: ${beInconclusive} صفقة (${((beInconclusive / allLosingTrades.length) * 100).toFixed(1)}%)`);
    console.log('========================================================================\n');

    await mongoose.disconnect();
}

main().catch(console.error);
