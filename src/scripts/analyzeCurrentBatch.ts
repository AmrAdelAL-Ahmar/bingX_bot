import dotenv from 'dotenv';
dotenv.config();
import mongoose from 'mongoose';
import Trade from '../models/Trade';

async function main() {
    await mongoose.connect(process.env.MONGODB_URI || '');

    const allTrades = await Trade.find({ isPaperTrade: true }).sort({ entryTime: -1 }).lean();
    const closed = allTrades.filter(t => t.currentStatus?.startsWith('CLOSED'));
    const open = allTrades.filter(t => ['OPEN', 'TP1_HIT', 'TP2_HIT'].includes(t.currentStatus));

    console.log(`Analyzing ${allTrades.length} trades (${closed.length} closed, ${open.length} open)...`);

    // 1. Group by Coin
    const coinStats: Record<string, { count: number; wins: number; losses: number; be: number; fullSl: number; pnl: number }> = {};
    for (const t of closed) {
        const sym = t.symbol.toUpperCase().replace('/USDT:USDT', '').replace('-USDT', '').replace('/USDT', '');
        if (!coinStats[sym]) coinStats[sym] = { count: 0, wins: 0, losses: 0, be: 0, fullSl: 0, pnl: 0 };
        coinStats[sym].count++;
        const pnl = t.realizedPnl || 0;
        coinStats[sym].pnl += pnl;
        if (pnl > 0) {
            coinStats[sym].wins++;
        } else {
            coinStats[sym].losses++;
            if (Math.abs(pnl) < 0.25) coinStats[sym].be++;
            else coinStats[sym].fullSl++;
        }
    }

    console.log('\n--- PERFORMANCE BY COIN ---');
    const sortedCoins = Object.entries(coinStats).sort((a, b) => b[1].pnl - a[1].pnl);
    console.table(sortedCoins.map(([coin, data]) => ({
        Coin: coin,
        Trades: data.count,
        Wins: data.wins,
        WinRate: `${((data.wins / data.count) * 100).toFixed(0)}%`,
        BreakEven: data.be,
        FullSL: data.fullSl,
        PnL: `${data.pnl >= 0 ? '+' : ''}${data.pnl.toFixed(2)} USDT`
    })));

    // 2. Performance by Direction
    const longs = closed.filter(t => t.direction === 'LONG');
    const shorts = closed.filter(t => t.direction === 'SHORT');
    const longWins = longs.filter(t => (t.realizedPnl || 0) > 0);
    const shortWins = shorts.filter(t => (t.realizedPnl || 0) > 0);
    const longPnl = longs.reduce((acc, t) => acc + (t.realizedPnl || 0), 0);
    const shortPnl = shorts.reduce((acc, t) => acc + (t.realizedPnl || 0), 0);

    console.log('\n--- PERFORMANCE BY DIRECTION ---');
    console.log(`LONG : ${longs.length} trades | Wins: ${longWins.length} (${((longWins.length/Math.max(longs.length,1))*100).toFixed(1)}%) | PnL: ${longPnl >= 0 ? '+' : ''}${longPnl.toFixed(2)} USDT`);
    console.log(`SHORT: ${shorts.length} trades | Wins: ${shortWins.length} (${((shortWins.length/Math.max(shorts.length,1))*100).toFixed(1)}%) | PnL: ${shortPnl >= 0 ? '+' : ''}${shortPnl.toFixed(2)} USDT`);

    // 3. Open Trades Unrealized PnL
    console.log('\n--- OPEN TRADES STATUS ---');
    open.forEach((t, i) => {
        console.log(`#${i+1} [${t.symbol} ${t.direction}] Entry: ${t.entryPrice} | SL: ${t.stopLoss} | Lev: ${t.leverage}x | Entry: ${t.entryTime?.toLocaleTimeString()}`);
    });

    await mongoose.disconnect();
}

main().catch(console.error);
