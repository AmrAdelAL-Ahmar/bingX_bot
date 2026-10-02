import dotenv from 'dotenv';
dotenv.config();
import mongoose from 'mongoose';
import Trade from '../models/Trade';

async function main() {
    await mongoose.connect(process.env.MONGODB_URI || '');

    // Fetch the last 200 closed paper trades sorted by closeTime or entryTime descending
    const last200 = await Trade.find({ 
        isPaperTrade: true,
        currentStatus: { $regex: /^CLOSED/ }
    })
    .sort({ entryTime: -1 })
    .limit(200)
    .lean();

    if (last200.length === 0) {
        console.log('No closed paper trades found.');
        await mongoose.disconnect();
        return;
    }

    const oldest = last200[last200.length - 1];
    const newest = last200[0];

    const wins = last200.filter(t => (t.realizedPnl || 0) > 0);
    const losses = last200.filter(t => (t.realizedPnl || 0) <= 0);

    // Differentiate Break-Even exits from full SL hits
    const breakEvens = losses.filter(t => Math.abs(t.realizedPnl || 0) < 0.25);
    const fullLosses = losses.filter(t => (t.realizedPnl || 0) <= -0.25);

    const winTotal = wins.reduce((acc, t) => acc + (t.realizedPnl || 0), 0);
    const lossTotal = losses.reduce((acc, t) => acc + (t.realizedPnl || 0), 0);
    const fullLossTotal = fullLosses.reduce((acc, t) => acc + (t.realizedPnl || 0), 0);
    const beFees = breakEvens.reduce((acc, t) => acc + (t.realizedPnl || 0), 0);
    const netPnL = winTotal + lossTotal;
    const winRate = ((wins.length / last200.length) * 100).toFixed(1);
    const profitFactor = Math.abs(lossTotal) > 0 ? (winTotal / Math.abs(lossTotal)).toFixed(2) : 'N/A';

    console.log('======================================================');
    console.log(`📊 REPORT ON LAST ${last200.length} CLOSED PAPER TRADES`);
    console.log('======================================================');
    console.log(`Time Span: From [${oldest.entryTime?.toISOString()}] to [${newest.entryTime?.toISOString()}]`);
    console.log(`Total Trades: ${last200.length}`);
    console.log(`Wins: ${wins.length} (${winRate}%) | Win Total: +$${winTotal.toFixed(2)} USDT`);
    console.log(`Losses: ${losses.length} (${(100 - parseFloat(winRate)).toFixed(1)}%) | Loss Total: -$${Math.abs(lossTotal).toFixed(2)} USDT`);
    console.log(`  - 🛡️ Auto Break-Even Exits: ${breakEvens.length} (${((breakEvens.length/last200.length)*100).toFixed(1)}%) | Fees: -$${Math.abs(beFees).toFixed(2)} USDT`);
    console.log(`  - 🛑 Full Stop-Loss Hits: ${fullLosses.length} (${((fullLosses.length/last200.length)*100).toFixed(1)}%) | Total: -$${Math.abs(fullLossTotal).toFixed(2)} USDT`);
    console.log(`Net Realized PnL: ${netPnL >= 0 ? '+' : ''}$${netPnL.toFixed(2)} USDT`);
    console.log(`Profit Factor: ${profitFactor}`);

    // Direction Breakdown
    const longs = last200.filter(t => t.direction === 'LONG');
    const shorts = last200.filter(t => t.direction === 'SHORT');
    const longWins = longs.filter(t => (t.realizedPnl || 0) > 0).length;
    const shortWins = shorts.filter(t => (t.realizedPnl || 0) > 0).length;
    const longPnL = longs.reduce((acc, t) => acc + (t.realizedPnl || 0), 0);
    const shortPnL = shorts.reduce((acc, t) => acc + (t.realizedPnl || 0), 0);

    console.log('\n--- 1. DIRECTION BREAKDOWN ---');
    console.log(`LONGs : ${longs.length} trades | Wins: ${longWins} (${((longWins/Math.max(longs.length,1))*100).toFixed(1)}%) | PnL: ${longPnL >= 0 ? '+' : ''}$${longPnL.toFixed(2)} USDT`);
    console.log(`SHORTs: ${shorts.length} trades | Wins: ${shortWins} (${((shortWins/Math.max(shorts.length,1))*100).toFixed(1)}%) | PnL: ${shortPnL >= 0 ? '+' : ''}$${shortPnL.toFixed(2)} USDT`);

    // Top Coins Breakdown
    const coinMap: Record<string, { count: number; wins: number; pnl: number }> = {};
    for (const t of last200) {
        const sym = t.symbol.toUpperCase().replace('/USDT:USDT', '').replace('-USDT', '').replace('/USDT', '');
        if (!coinMap[sym]) coinMap[sym] = { count: 0, wins: 0, pnl: 0 };
        coinMap[sym].count++;
        if ((t.realizedPnl || 0) > 0) coinMap[sym].wins++;
        coinMap[sym].pnl += (t.realizedPnl || 0);
    }

    const sortedCoins = Object.entries(coinMap).sort((a, b) => b[1].pnl - a[1].pnl);
    console.log('\n--- 2. COIN PERFORMANCE (Top Winners vs Top Bleeders) ---');
    console.log('Top Winners:');
    sortedCoins.filter(c => c[1].pnl > 0).slice(0, 7).forEach(([sym, data]) => {
        console.log(`  + ${sym.padEnd(8)}: ${data.count} trades | ${data.wins} wins (${((data.wins/data.count)*100).toFixed(0)}%) | PnL: +$${data.pnl.toFixed(2)} USDT`);
    });
    console.log('Top Losers:');
    sortedCoins.filter(c => c[1].pnl < 0).slice(-8).reverse().forEach(([sym, data]) => {
        console.log(`  - ${sym.padEnd(8)}: ${data.count} trades | ${data.wins} wins (${((data.wins/data.count)*100).toFixed(0)}%) | PnL: -$${Math.abs(data.pnl).toFixed(2)} USDT`);
    });

    // Engine Analysis on Last 200
    console.log('\n--- 3. ENGINE PERFORMANCE (On Last 200 Trades) ---');
    const knownEngines = ['V1', 'V2', 'V3', 'V6', 'V7', 'V8', 'V10', 'V11', 'V17', 'V18', 'HARMONIC', 'WHALE_SURGE'];
    for (const eng of knownEngines) {
        const engTrades = last200.filter(t => {
            const text = `${t.aiJustification || ''} ${t.engineId || ''} ${t.logs ? t.logs.join(' ') : ''}`;
            return new RegExp(`\\b${eng}\\b`, 'i').test(text);
        });
        if (engTrades.length > 0) {
            const eWins = engTrades.filter(t => (t.realizedPnl || 0) > 0).length;
            const ePnl = engTrades.reduce((acc, t) => acc + (t.realizedPnl || 0), 0);
            const rate = ((eWins / engTrades.length) * 100).toFixed(1);
            console.log(`  - ${eng.padEnd(11)}: ${engTrades.length} trades | Wins: ${eWins} (${rate}%) | PnL: ${ePnl >= 0 ? '+' : ''}${ePnl.toFixed(2)} USDT`);
        }
    }

    // Trade Style breakdown (if present in logs or justification)
    console.log('\n--- 4. TRADE STYLE PERFORMANCE ---');
    const styles = ['WHALE_SURGE', 'SCALP_TURBO', 'STALKER_SNIPER', 'SWING', 'HYBRID'];
    for (const st of styles) {
        const stTrades = last200.filter(t => {
            const text = `${t.aiJustification || ''} ${t.engineId || ''} ${t.logs ? t.logs.join(' ') : ''}`;
            return new RegExp(`\\b${st}\\b`, 'i').test(text);
        });
        if (stTrades.length > 0) {
            const sWins = stTrades.filter(t => (t.realizedPnl || 0) > 0).length;
            const sPnl = stTrades.reduce((acc, t) => acc + (t.realizedPnl || 0), 0);
            console.log(`  - Style [${st.padEnd(14)}]: ${stTrades.length} trades | Wins: ${sWins} (${((sWins/stTrades.length)*100).toFixed(1)}%) | PnL: ${sPnl >= 0 ? '+' : ''}${sPnl.toFixed(2)} USDT`);
        }
    }

    await mongoose.disconnect();
}

main().catch(console.error);
