import mongoose from 'mongoose';
import dotenv from 'dotenv';
import Trade from './src/models/Trade';
import User from './src/models/User';
import connectDB from './src/config/db';

dotenv.config();

const main = async () => {
    await connectDB();

    console.log('--- DB Check ---');
    const total = await Trade.countDocuments();
    const openCount = await Trade.countDocuments({ currentStatus: 'OPEN' });
    const pendingCount = await Trade.countDocuments({ currentStatus: 'PENDING' });
    const closedCount = await Trade.countDocuments({ currentStatus: { $in: ['CLOSED_PROFIT', 'CLOSED_LOSS'] } });

    console.log(`Total Trades: ${total}`);
    console.log(`OPEN Trades: ${openCount}`);
    console.log(`PENDING Trades: ${pendingCount}`);
    console.log(`CLOSED Trades: ${closedCount}`);

    const lastTrades = await Trade.find().sort({ entryTime: -1 }).limit(3).populate('userId');
    lastTrades.forEach(t => {
        const u = t.userId as any;
        console.log(`- ${t.symbol} | ${t.direction} | Status: ${t.currentStatus} | PnL: ${t.pnl}%`);
        console.log(`  User: ${u ? u.telegramId : 'MISSING'} | Logs: ${t.logs.join(' | ')}`);
    });

    process.exit();
};

main();
