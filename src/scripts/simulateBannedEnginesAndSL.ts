import dotenv from 'dotenv';
dotenv.config();
import mongoose from 'mongoose';
import Trade from '../models/Trade';

async function main() {
    await mongoose.connect(process.env.MONGODB_URI || '');

    // Get the 595 closed paper trades
    const closedTrades = await Trade.find({ 
        isPaperTrade: true,
        currentStatus: { $regex: /^CLOSED/ }
    }).sort({ entryTime: -1 }).lean();

    console.log(`Total closed trades: ${closedTrades.length}`);

    // Banned engines according to user: v10, v9, v12, v13, v16, v17, v18, v4, v5, v6, v2
    const bannedRegex = /\b(V10|V9|V12|V13|V16|V17|V18|V4|V5|V6|V2)\b/i;

    // Check how many trades contain any banned engine
    let bannedCount = 0;
    let allowedTrades: any[] = [];
    let bannedTrades: any[] = [];

    for (const t of closedTrades) {
        // Find which engines are in this trade
        const text = `${t.aiJustification || ''} ${t.engineId || ''} ${t.logs ? t.logs.join(' ') : ''}`;
        
        // Extract the engines mentioned in "المحركات: ..." if present, or match against banned list
        const match = bannedRegex.test(text);
        if (match) {
            bannedCount++;
            bannedTrades.push(t);
        } else {
            allowedTrades.push(t);
        }
    }

    console.log(`\n--- ENGINE FILTER STATS ---`);
    console.log(`Total Closed: ${closedTrades.length}`);
    console.log(`Banned Trades (with v10, v9, v12, v13, v16, v17, v18, v4, v5, v6, v2): ${bannedCount}`);
    console.log(`Remaining Allowed Trades: ${allowedTrades.length}`);

    // Let's analyze the remaining allowed trades
    const allowedWins = allowedTrades.filter(t => (t.realizedPnl || 0) > 0);
    const allowedLosses = allowedTrades.filter(t => (t.realizedPnl || 0) <= 0);
    const allowedBreakEvens = allowedLosses.filter(t => Math.abs(t.realizedPnl || 0) < 0.25);
    const allowedFullLosses = allowedLosses.filter(t => (t.realizedPnl || 0) <= -0.25);

    const winPnl = allowedWins.reduce((acc, t) => acc + (t.realizedPnl || 0), 0);
    const lossPnl = allowedLosses.reduce((acc, t) => acc + (t.realizedPnl || 0), 0);
    const netPnl = winPnl + lossPnl;

    console.log(`\n--- REMAINING ALLOWED TRADES RESULTS ---`);
    console.log(`Wins: ${allowedWins.length} (${((allowedWins.length / allowedTrades.length) * 100).toFixed(1)}%) | +$${winPnl.toFixed(2)} USDT`);
    console.log(`Losses: ${allowedLosses.length} (${((allowedLosses.length / allowedTrades.length) * 100).toFixed(1)}%) | -$${Math.abs(lossPnl).toFixed(2)} USDT`);
    console.log(`  - Break-Even Exits: ${allowedBreakEvens.length}`);
    console.log(`  - Full Stop-Loss: ${allowedFullLosses.length}`);
    console.log(`Net PnL: ${netPnl >= 0 ? '+' : ''}$${netPnl.toFixed(2)} USDT`);

    // Let's also see what engines ARE in the allowed trades
    const engineBreakdown: Record<string, number> = {};
    for (const t of allowedTrades) {
        const text = `${t.aiJustification || ''} ${t.engineId || ''}`;
        const engines = ['V1', 'V3', 'V7', 'V8', 'V11', 'V14', 'V15', 'HARMONIC', 'WHALE_SURGE'];
        for (const e of engines) {
            if (new RegExp(`\\b${e}\\b`, 'i').test(text)) {
                engineBreakdown[e] = (engineBreakdown[e] || 0) + 1;
            }
        }
    }
    console.log(`\nEngines present in allowed trades:`, engineBreakdown);

    // Let's inspect SL distances across trades
    console.log(`\n--- STOP LOSS ANALYSIS ---`);
    const slDists = closedTrades.map(t => Math.abs((t.entryPrice - t.stopLoss) / t.entryPrice) * 100);
    const avgSL = slDists.reduce((a, b) => a + b, 0) / slDists.length;
    console.log(`Average SL distance on all trades: ${avgSL.toFixed(2)}%`);

    const allowedSlDists = allowedTrades.map(t => Math.abs((t.entryPrice - t.stopLoss) / t.entryPrice) * 100);
    const avgAllowedSL = allowedSlDists.length > 0 ? allowedSlDists.reduce((a, b) => a + b, 0) / allowedSlDists.length : 0;
    console.log(`Average SL distance on allowed trades: ${avgAllowedSL.toFixed(2)}%`);

    // Check samples of allowed full losses
    console.log(`\nSample Allowed Full Losses:`);
    allowedFullLosses.slice(0, 5).forEach((t, i) => {
        const dist = (Math.abs((t.entryPrice - t.stopLoss) / t.entryPrice) * 100).toFixed(2);
        console.log(`#${i+1}: ${t.symbol} ${t.direction} | PnL: ${t.realizedPnl} | SL Dist: ${dist}% | Entry: ${t.entryPrice} -> Exit: ${t.exitPrice} | Status: ${t.currentStatus}`);
        console.log(`  Justification: ${t.aiJustification?.substring(0, 120)}...`);
    });

    await mongoose.disconnect();
}

main().catch(console.error);
