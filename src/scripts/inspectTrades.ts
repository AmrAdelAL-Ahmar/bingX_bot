import mongoose from 'mongoose';
import dotenv from 'dotenv';
import Trade from '../models/Trade';

dotenv.config();

async function inspectTrades() {
    const mongoUri = process.env.MONGODB_URI || 'mongodb://localhost:27017/bingx_bot';
    await mongoose.connect(mongoUri);
    console.log('Connected to MongoDB');

    const trades: any[] = await Trade.find({ isPaperTrade: true }).sort({ createdAt: -1 }).limit(30).lean();
    console.log(`Found ${trades.length} paper trades:`);
    
    trades.forEach((t: any, i: number) => {
        console.log(`--- [Trade #${i+1}] ${t.symbol} ${t.direction} ---`);
        console.log(`Status: ${t.currentStatus} | PnL: ${t.realizedPnl} USDT (${t.pnlPercent}%)`);
        console.log(`Entry: ${t.entryPrice} | Exit: ${t.exitPrice || 'N/A'}`);
        console.log(`SL: ${t.stopLoss} | TP1: ${t.takeProfit1} | TP2: ${t.takeProfit2}`);
        console.log(`Exit Reason: ${t.exitReason || 'N/A'}`);
        console.log(`Created: ${t.createdAt} | Closed: ${t.closedAt || 'N/A'}`);
        console.log(`AI / Strategy: ${t.aiJustification ? t.aiJustification.substring(0, 150) + '...' : 'None'}`);
    });

    const closed = trades.filter((t: any) => t.currentStatus?.startsWith('CLOSED'));
    const wins = closed.filter((t: any) => (t.realizedPnl || 0) > 0);
    const losses = closed.filter((t: any) => (t.realizedPnl || 0) < 0);
    const totalPnl = closed.reduce((acc: number, t: any) => acc + (t.realizedPnl || 0), 0);

    console.log('\n================ SUMMARY ================');
    console.log(`Total Closed: ${closed.length} | Wins: ${wins.length} | Losses: ${losses.length}`);
    console.log(`Total Realized PnL: ${totalPnl.toFixed(2)} USDT`);

    await mongoose.disconnect();
}

inspectTrades().catch(err => {
    console.error(err);
    process.exit(1);
});
