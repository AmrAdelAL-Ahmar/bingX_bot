import dotenv from 'dotenv';
dotenv.config();
import mongoose from 'mongoose';
import Trade from '../models/Trade';

async function updateActiveTargets() {
    await mongoose.connect(process.env.MONGODB_URI || '');
    console.log('Connected to MongoDB');

    const trades = await Trade.find({ isPaperTrade: true, currentStatus: { $in: ['OPEN', 'TP1_HIT'] } });
    console.log(`Found ${trades.length} active trades to adjust targets:`);

    for (const t of trades) {
        const entry = t.entryPrice;
        const oldTarget = t.targets[0]?.price;
        // Set close rapid scalp target: exactly +0.55% for LONG or -0.55% for SHORT
        const newTarget = t.direction === 'LONG'
            ? Number((entry * 1.0055).toFixed(4))
            : Number((entry * 0.9945).toFixed(4));

        t.targets = [{ price: newTarget, hit: false }] as any;
        await t.save();
        console.log(`✅ [${t.symbol}] Entry: ${entry} | Old Target: ${oldTarget} -> New Ultra-Close Target: ${newTarget} (+0.55%)`);
    }

    await mongoose.disconnect();
}

updateActiveTargets().catch(console.error);
