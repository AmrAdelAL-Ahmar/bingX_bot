import dotenv from 'dotenv';
dotenv.config();
import mongoose from 'mongoose';
import Trade from '../models/Trade';

async function main() {
    await mongoose.connect(process.env.MONGODB_URI || '');

    const trades = await Trade.find({ 
        isPaperTrade: true,
        currentStatus: { $regex: /^CLOSED/ }
    }).sort({ entryTime: 1 }).lean();

    console.log(`Analyzing ${trades.length} closed trades...`);

    // Let's inspect initial SL distance before BE
    // If a trade closed with realizedPnl <= -0.25, its stopLoss was the actual SL hit!
    const fullLosses = trades.filter(t => (t.realizedPnl || 0) <= -0.25);
    
    const buckets: Record<string, number> = {
        '< 0.8%': 0,
        '0.8% - 1.0%': 0,
        '1.0% - 1.5%': 0,
        '1.5% - 2.0%': 0,
        '2.0% - 3.0%': 0,
        '> 3.0%': 0
    };

    for (const t of fullLosses) {
        const exitDist = (Math.abs(t.exitPrice! - t.entryPrice) / t.entryPrice) * 100;
        if (exitDist < 0.8) buckets['< 0.8%']++;
        else if (exitDist <= 1.0) buckets['0.8% - 1.0%']++;
        else if (exitDist <= 1.5) buckets['1.0% - 1.5%']++;
        else if (exitDist <= 2.0) buckets['1.5% - 2.0%']++;
        else if (exitDist <= 3.0) buckets['2.0% - 3.0%']++;
        else buckets['> 3.0%']++;
    }

    console.log('\n--- FULL LOSS SL DISTANCE BUCKETS ---');
    console.table(buckets);

    // Let's also inspect how the trades were opened over time:
    // Was there a time when turboSlPercentage was 0.94%, and when was it different?
    console.log('\n--- SAMPLE TRADES OVER TIME ---');
    const step = Math.floor(trades.length / 5);
    for (let i = 0; i < trades.length; i += step) {
        const t = trades[i];
        const dist = ((Math.abs(t.stopLoss - t.entryPrice) / t.entryPrice) * 100).toFixed(2);
        console.log(`Trade #${i} [${t.entryTime?.toISOString()}] ${t.symbol} ${t.direction} | Entry: ${t.entryPrice} | SL: ${t.stopLoss} (${dist}%) | Status: ${t.currentStatus} | PnL: ${t.realizedPnl}`);
    }

    await mongoose.disconnect();
}

main().catch(console.error);
