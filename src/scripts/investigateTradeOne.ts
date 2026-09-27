import dotenv from 'dotenv';
dotenv.config();
import mongoose from 'mongoose';
import Trade from '../models/Trade';
import User from '../models/User';

async function main() {
    await mongoose.connect(process.env.MONGODB_URI || '');
    
    // 1. Check User Settings
    const user = await User.findOne({ isActive: true }).lean();
    console.log('--- USER SETTINGS ---');
    console.log('Trade Style:', user?.autonomousSettings?.tradeStyle);
    console.log('Max Concurrent Trades:', user?.autonomousSettings?.maxConcurrentTrades);
    console.log('Allowed Direction:', user?.autonomousSettings?.allowedDirection);
    console.log('Turbo SL Percentage:', user?.autonomousSettings?.turboSlPercentage);
    console.log('Anti-Peak Enabled:', user?.autonomousSettings?.antiPeakGuardEnabled);
    console.log('Front-Run TP Enabled:', user?.autonomousSettings?.frontRunTpEnabled);
    console.log('Auto Break-Even:', user?.autoBreakEven);
    console.log('Full autonomousSettings:', JSON.stringify(user?.autonomousSettings, null, 2));

    // 2. Check Trade #1 Details
    const lastTrade = await Trade.findOne({ isPaperTrade: true }).sort({ entryTime: -1 }).lean();
    console.log('\n--- LAST TRADE DETAILS ---');
    console.log('Symbol:', lastTrade?.symbol);
    console.log('Direction:', lastTrade?.direction);
    console.log('Entry Price:', lastTrade?.entryPrice);
    console.log('Stop Loss:', lastTrade?.stopLoss);
    console.log('TPs:', lastTrade?.targets);
    console.log('Leverage:', lastTrade?.leverage);
    console.log('Entry Time:', lastTrade?.entryTime);
    console.log('Status:', lastTrade?.currentStatus);
    console.log('AI Justification:', lastTrade?.aiJustification);
    console.log('Logs:', lastTrade?.logs);

    await mongoose.disconnect();
}

main().catch(console.error);
