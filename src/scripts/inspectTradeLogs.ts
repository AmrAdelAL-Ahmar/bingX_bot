import mongoose from 'mongoose';
import dotenv from 'dotenv';
import Trade from '../models/Trade';

dotenv.config();

async function inspectTradeLogs() {
    const mongoUri = process.env.MONGODB_URI || 'mongodb://localhost:27017/bingx_bot';
    await mongoose.connect(mongoUri);

    const openTrades: any[] = await Trade.find({ isPaperTrade: true, currentStatus: { $in: ['OPEN', 'TP1_HIT', 'TP2_HIT'] } }).lean();
    console.log(`\n=== CURRENT OPEN TRADES (${openTrades.length}) ===`);
    openTrades.forEach(t => {
        console.log(`[${t.symbol} ${t.direction}] Entry: ${t.entryPrice}, CurrentSL: ${t.stopLoss}, TP1: ${t.takeProfit1}, Amount: ${t.amount}, Leverage: ${t.leverage}x`);
    });

    const recentLosses: any[] = await Trade.find({ isPaperTrade: true, currentStatus: 'CLOSED_LOSS' }).sort({ _id: -1 }).limit(6).lean();
    console.log(`\n=== RECENT CLOSED LOSSES (${recentLosses.length}) ===`);
    recentLosses.forEach(t => {
        const slDiff = Math.abs((t.stopLoss - t.entryPrice) / t.entryPrice) * 100;
        console.log(`[${t.symbol} ${t.direction}] Entry: ${t.entryPrice} -> Exit: ${t.exitPrice} | SL: ${t.stopLoss} (${slDiff.toFixed(2)}% from entry) | PnL: ${t.realizedPnl} USDT`);
        console.log(`Logs:`, t.logs?.slice(-3));
        console.log(`AI Justification / Origin:`, t.aiJustification?.substring(0, 100));
        console.log('---');
    });

    const recentWins: any[] = await Trade.find({ isPaperTrade: true, currentStatus: 'CLOSED_PROFIT' }).sort({ _id: -1 }).limit(6).lean();
    console.log(`\n=== RECENT CLOSED PROFITS (${recentWins.length}) ===`);
    recentWins.forEach(t => {
        console.log(`[${t.symbol} ${t.direction}] Entry: ${t.entryPrice} -> Exit: ${t.exitPrice} | TP1: ${t.takeProfit1} | PnL: ${t.realizedPnl} USDT`);
        console.log(`Logs:`, t.logs?.slice(-3));
        console.log('---');
    });

    await mongoose.disconnect();
}

inspectTradeLogs().catch(console.error);
