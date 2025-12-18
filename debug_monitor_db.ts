import mongoose from 'mongoose';
import dotenv from 'dotenv';
import Trade from './src/models/Trade';
import User from './src/models/User';
import connectDB from './src/config/db';
import { BingXService } from './src/services/BingXService';

dotenv.config();

const main = async () => {
    await connectDB();

    console.log('--- Checking DB State ---');
    const allTrades = await Trade.find().sort({ entryTime: -1 }).limit(5).populate('userId');
    console.log(`Checking last ${allTrades.length} trades in DB:`);

    for (const trade of allTrades) {
        const user = trade.userId as any;
        console.log(`Trade ID: ${trade._id}`);
        console.log(`Symbol: ${trade.symbol}`);
        console.log(`Direction: ${trade.direction}`);
        console.log(`User ID (populated): ${user ? user._id : 'NULL'}`);
        console.log(`Telegram ID: ${user ? user.telegramId : 'NULL'}`);

        // Check BingX Position manually
        const bingX = new BingXService(process.env.BINGX_API_KEY, process.env.BINGX_SECRET_KEY);
        try {
            const positions = await bingX.getPositions(trade.symbol);
            console.log(`BingX Positions for ${trade.symbol}: ${positions.length}`);

            const matchingPos = positions.find((p: any) =>
                (trade.direction === 'LONG' && p.side.toLowerCase() === 'long') ||
                (trade.direction === 'SHORT' && p.side.toLowerCase() === 'short')
            );

            if (matchingPos) {
                console.log('MATCH FOUND. Monitor should keeping it OPEN.');
            } else {
                console.log('NO MATCH. Monitor SHOULD trigger CLOSE notification.');
            }

        } catch (err) {
            console.error('BingX Error:', err);
        }
    }

    process.exit();
};

main();
