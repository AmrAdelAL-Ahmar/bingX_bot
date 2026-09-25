import dotenv from 'dotenv';
dotenv.config();
import mongoose from 'mongoose';
import Trade from '../models/Trade';

async function analyzeRecentPaperTrades() {
    await mongoose.connect(process.env.MONGODB_URI || '');
    console.log('Connected to MongoDB');

    // Get all paper trades since yesterday or last 50
    const trades = await Trade.find({ isPaperTrade: true })
        .sort({ _id: -1 })
        .limit(50)
        .lean();

    console.log(`\n================ TOTAL PAPER TRADES LOADED: ${trades.length} ================\n`);

    const openTrades = trades.filter(t => ['OPEN', 'TP1_HIT', 'TP2_HIT'].includes(t.currentStatus));
    const closedTrades = trades.filter(t => t.currentStatus?.startsWith('CLOSED'));
    const wins = closedTrades.filter(t => (t.realizedPnl || 0) > 0);
    const losses = closedTrades.filter(t => (t.realizedPnl || 0) <= 0);

    const totalPnL = closedTrades.reduce((acc, t) => acc + (t.realizedPnl || 0), 0);
    const totalWinPnL = wins.reduce((acc, t) => acc + (t.realizedPnl || 0), 0);
    const totalLossPnL = losses.reduce((acc, t) => acc + (t.realizedPnl || 0), 0);
    const winRate = closedTrades.length > 0 ? (wins.length / closedTrades.length) * 100 : 0;

    console.log(`📊 PERFORMANCE OVERVIEW:`);
    console.log(`- Open Trades: ${openTrades.length}`);
    console.log(`- Closed Trades: ${closedTrades.length}`);
    console.log(`- Wins: ${wins.length} (${winRate.toFixed(1)}%) | Win Total: +${totalWinPnL.toFixed(2)} USDT`);
    console.log(`- Losses: ${losses.length} | Loss Total: ${totalLossPnL.toFixed(2)} USDT`);
    console.log(`- Net Realized PnL: ${totalPnL.toFixed(2)} USDT\n`);

    console.log(`\n--- 🔍 CURRENT OPEN TRADES (${openTrades.length}) ---`);
    openTrades.forEach((t, i) => {
        console.log(`#${i+1} [${t.symbol} ${t.direction}] Entry: ${t.entryPrice} | SL: ${t.stopLoss} | TP: ${t.targets?.[0]?.price} | Lev: ${t.leverage}x | Amt: $${t.amount?.toFixed(2)}`);
    });

    console.log(`\n--- ❌ DETAILED BREAKDOWN OF RECENT LOSSES (${losses.length}) ---`);
    losses.slice(0, 15).forEach((t, i) => {
        const slDist = Math.abs((t.entryPrice - t.stopLoss) / t.entryPrice) * 100;
        const exitDist = t.exitPrice ? Math.abs((t.entryPrice - t.exitPrice) / t.entryPrice) * 100 : 0;
        console.log(`Loss #${i+1}: [${t.symbol} ${t.direction}] Entry: ${t.entryPrice} -> Exit: ${t.exitPrice} | Realized PnL: ${t.realizedPnl?.toFixed(2)} USDT | Lev: ${t.leverage}x | Amt: $${t.amount?.toFixed(2)}`);
        console.log(`  SL Distance: ${slDist.toFixed(2)}% | Actual Exit Distance: ${exitDist.toFixed(2)}%`);
        console.log(`  Logs:`, t.logs?.slice(-2));
        console.log(`  AI Justification / Strategy:`, t.aiJustification?.substring(0, 120));
        console.log(`  Created: ${(t as any).createdAt || t.entryTime} | Closed: ${(t as any).closedAt || t.closeTime}`);
        console.log('----------------------------------------------------');
    });

    console.log(`\n--- ✅ DETAILED BREAKDOWN OF RECENT WINS (${wins.length}) ---`);
    wins.slice(0, 10).forEach((t, i) => {
        console.log(`Win #${i+1}: [${t.symbol} ${t.direction}] Entry: ${t.entryPrice} -> Exit: ${t.exitPrice} | Realized PnL: +${t.realizedPnl?.toFixed(2)} USDT | Lev: ${t.leverage}x | Amt: $${t.amount?.toFixed(2)}`);
        console.log(`  Logs:`, t.logs?.slice(-2));
        console.log('----------------------------------------------------');
    });

    await mongoose.disconnect();
}

analyzeRecentPaperTrades().catch(console.error);
