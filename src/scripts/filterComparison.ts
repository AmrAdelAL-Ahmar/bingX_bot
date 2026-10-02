import dotenv from 'dotenv';
dotenv.config();
import mongoose from 'mongoose';
import Trade from '../models/Trade';

async function main() {
    await mongoose.connect(process.env.MONGODB_URI || '');

    const trades = await Trade.find({
        isPaperTrade: true,
        currentStatus: { $regex: /^CLOSED/ }
    }).sort({ entryTime: -1 }).lean();

    const bannedList = ['V10', 'V9', 'V12', 'V13', 'V16', 'V17', 'V18', 'V4', 'V5', 'V6', 'V2'];
    const bannedSet = new Set(bannedList.map(s => s.toUpperCase()));

    console.log('=== DETAILED FILTERING BREAKDOWN ===');

    // 1. Check Primary Engine Breakdown for all 596 trades
    const primaryEngineCounts: Record<string, { total: number; wins: number; pnl: number }> = {};
    for (const t of trades) {
        const eng = (t.engineId || 'UNKNOWN').toUpperCase();
        if (!primaryEngineCounts[eng]) primaryEngineCounts[eng] = { total: 0, wins: 0, pnl: 0 };
        primaryEngineCounts[eng].total++;
        if ((t.realizedPnl || 0) > 0) primaryEngineCounts[eng].wins++;
        primaryEngineCounts[eng].pnl += (t.realizedPnl || 0);
    }
    console.log('\nTrades by Primary Engine (engineId):');
    console.table(primaryEngineCounts);

    // 2. Strict Filter (where none of the banned engines participated)
    const strictAllowed = trades.filter(t => {
        const match = (t.aiJustification || '').match(/المحركات:\s*([^)]+)/);
        let list: string[] = [];
        if (match) {
            list = match[1].split(',').map(s => s.trim().toUpperCase());
        } else if (t.engineId) {
            list = [t.engineId.toUpperCase()];
        }
        return !list.some(e => bannedSet.has(e));
    });

    // 3. Primary Filter (where engineId is not in banned list)
    const primaryAllowed = trades.filter(t => !bannedSet.has((t.engineId || '').toUpperCase()));

    // 4. Primary Filter excluding V8 as well (since V8 was identified as a major bleeder)
    const primaryAllowedNoV8 = trades.filter(t => {
        const eng = (t.engineId || '').toUpperCase();
        return !bannedSet.has(eng) && eng !== 'V8';
    });

    function getStats(arr: any[]) {
        const wins = arr.filter(t => (t.realizedPnl || 0) > 0);
        const losses = arr.filter(t => (t.realizedPnl || 0) <= 0);
        const be = losses.filter(t => Math.abs(t.realizedPnl || 0) < 0.25);
        const fullSL = losses.filter(t => (t.realizedPnl || 0) <= -0.25);
        const winPnl = wins.reduce((acc, t) => acc + (t.realizedPnl || 0), 0);
        const lossPnl = losses.reduce((acc, t) => acc + (t.realizedPnl || 0), 0);
        const winRate = ((wins.length / Math.max(arr.length, 1)) * 100).toFixed(1);
        return {
            total: arr.length,
            wins: wins.length,
            winRate: `${winRate}%`,
            losses: losses.length,
            autoBreakEven: be.length,
            fullStopLoss: fullSL.length,
            winTotal: `+$${winPnl.toFixed(2)}`,
            lossTotal: `-$${Math.abs(lossPnl).toFixed(2)}`,
            netPnL: `${(winPnl + lossPnl) >= 0 ? '+' : ''}${(winPnl + lossPnl).toFixed(2)} USDT`,
            profitFactor: Math.abs(lossPnl) > 0 ? (winPnl / Math.abs(lossPnl)).toFixed(2) : 'N/A'
        };
    }

    console.log('\n--- COMPARISON TABLE ---');
    console.table({
        'All 596 Trades': getStats(trades),
        'Primary Filter (engineId banned)': getStats(primaryAllowed),
        'Primary Filter (also without V8)': getStats(primaryAllowedNoV8),
        'Strict Participating Filter': getStats(strictAllowed)
    });

    await mongoose.disconnect();
}

main().catch(console.error);
