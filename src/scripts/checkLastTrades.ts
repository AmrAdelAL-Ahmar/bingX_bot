import dotenv from 'dotenv';
dotenv.config();
import mongoose from 'mongoose';
import Trade from '../models/Trade';

async function main() {
    await mongoose.connect(process.env.MONGODB_URI || '');
    const trades = await Trade.find({ isPaperTrade: true }).sort({ entryTime: -1 }).limit(10).lean();
    console.log(`\nLast 10 Paper Trades (Chronological order):`);
    trades.forEach((t, i) => {
        const pnl = t.realizedPnl !== undefined ? `${t.realizedPnl.toFixed(2)} USDT` : 'OPEN';
        console.log(`#${i+1} [${t.symbol} ${t.direction}] Status: ${t.currentStatus} | PnL: ${pnl} | Entry: ${t.entryPrice} -> Exit: ${t.exitPrice || 'N/A'}`);
        console.log(`    Time: ${t.entryTime}`);
        if (t.logs && t.logs.length > 0) {
            console.log(`    Last Log: ${t.logs[t.logs.length - 1]}`);
        }
    });
    await mongoose.disconnect();
}

main().catch(console.error);
