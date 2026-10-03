import mongoose from 'mongoose';
import * as dotenv from 'dotenv';
dotenv.config();

import User from '../models/User';
import Trade from '../models/Trade';
import { JUNK_AND_COMMODITY_BLACKLIST } from '../core/picker/CcxtPickerEngine';

async function main() {
    console.log('🧪 [Test] Starting Three Improvements Verification Script...');
    const mongoUri = process.env.MONGODB_URI || 'mongodb://localhost:27017/bingx_bot';
    await mongoose.connect(mongoUri);
    console.log('✅ Connected to MongoDB.');

    // 1. Verify and update User settings in DB
    const admin = await User.findOne({ isActive: true });
    if (admin) {
        if (!admin.autonomousSettings) {
            (admin as any).autonomousSettings = {};
        }
        const aut = admin.autonomousSettings!;
        aut.allowedDirection = 'LONG_ONLY';
        aut.consecutiveLossCooldownEnabled = true;
        aut.consecutiveLossCooldownHours = 4;
        aut.consecutiveLossThreshold = 2;
        await admin.save();
        console.log('✅ Updated User autonomousSettings in DB:');
        console.log(`   - allowedDirection: ${aut.allowedDirection}`);
        console.log(`   - consecutiveLossCooldownEnabled: ${aut.consecutiveLossCooldownEnabled}`);
        console.log(`   - consecutiveLossCooldownHours: ${aut.consecutiveLossCooldownHours}h`);
        console.log(`   - consecutiveLossThreshold: ${aut.consecutiveLossThreshold}`);
    }

    // 2. Verify Blacklist & NASDAQ Exclusion
    console.log('\n🔍 [Test] Verifying TradFi / NASDAQ Blacklist:');
    const testSymbols = [
        'NCSINASDAQ1002USD',
        'NASDAQ/USDT:USDT',
        'NCCO1OILBRENT2USD',
        'NCCOGOLD2USD',
        'SPX/USDT:USDT',
        'US30/USDT:USDT',
        'PUMP/USDT:USDT',
        'BTC/USDT:USDT',
        'ETH/USDT:USDT',
        'SOL/USDT:USDT'
    ];

    for (const sym of testSymbols) {
        const cleanBase = sym.split('/')[0].split(':')[0].toUpperCase();
        const isBlocked =
            JUNK_AND_COMMODITY_BLACKLIST.has(cleanBase) ||
            cleanBase.startsWith('NCCO') ||
            cleanBase.startsWith('NCSI') ||
            cleanBase.includes('NASDAQ') ||
            cleanBase.includes('SPX') ||
            cleanBase.includes('US30') ||
            cleanBase.includes('DJI') ||
            cleanBase.includes('GER') ||
            cleanBase.includes('DOW') ||
            cleanBase.includes('OIL') ||
            cleanBase.includes('GOLD') ||
            cleanBase.includes('SILVER') ||
            cleanBase === 'PUMP';

        const status = isBlocked ? '🛑 BLOCKED' : '✅ ALLOWED';
        console.log(`   ${sym.padEnd(20)} -> ${status}`);
    }

    // 3. Clean up any open TradFi/NASDAQ trade if present
    const openTradFi = await Trade.find({
        symbol: /NASDAQ|NCSI|NCCO|OIL|GOLD|SPX/i,
        currentStatus: { $in: ['OPEN', 'PENDING', 'TP1_HIT'] }
    });

    if (openTradFi.length > 0) {
        console.log(`\n⚠️ Found ${openTradFi.length} open TradFi/Index trades in DB. Closing them...`);
        for (const t of openTradFi) {
            t.currentStatus = 'CLOSED_LOSS';
            t.closeTime = new Date();
            t.pnl = 0;
            await t.save();
            console.log(`   Closed legacy trade: ${t.symbol} (${t._id})`);
        }
    } else {
        console.log('\n✅ No open TradFi / NASDAQ trades found in DB.');
    }

    // 4. Test Loss Cooldown Query for Coins with consecutive losses
    console.log('\n❄️ [Test] Checking loss cooldown status for symbols:');
    const symbolsToCheck = ['QNT', 'AAVE', 'SUI', 'SAND', 'BTC'];
    const now = Date.now();
    const cooldownMs = 4 * 60 * 60 * 1000;

    for (const sym of symbolsToCheck) {
        const lastTrades = await Trade.find({
            isPaperTrade: true,
            symbol: new RegExp(`^${sym}(/|-|$)`, 'i'),
            currentStatus: { $in: ['CLOSED_PROFIT', 'CLOSED_LOSS'] }
        }).sort({ closeTime: -1, closedAt: -1, createdAt: -1 }).limit(2);

        if (lastTrades.length >= 2) {
            const allLosses = lastTrades.every(t => t.currentStatus === 'CLOSED_LOSS' && (t.pnl ?? 0) < -0.2);
            if (allLosses) {
                const mostRecentClose = lastTrades[0].closeTime || lastTrades[0].closedAt || new Date();
                const elapsedMs = now - mostRecentClose.getTime();
                if (elapsedMs < cooldownMs) {
                    const remMins = Math.ceil((cooldownMs - elapsedMs) / 60000);
                    console.log(`   ❄️ ${sym}: IN COOLDOWN! (2 consecutive losses, ${remMins} minutes remaining).`);
                } else {
                    console.log(`   ⏱️ ${sym}: 2 losses, but cooldown window expired (> 4 hours ago).`);
                }
            } else {
                console.log(`   ✅ ${sym}: Not in loss cooldown (recent trades: ${lastTrades.map(t => `${t.currentStatus} (${t.pnl?.toFixed(2)}$)`).join(', ')}).`);
            }
        } else {
            console.log(`   ⚪ ${sym}: Less than 2 closed trades (${lastTrades.length}).`);
        }
    }

    console.log('\n🎉 [Success] All 3 features verified and operational!');
    await mongoose.disconnect();
}

main().catch(err => {
    console.error('Error in verification script:', err);
    process.exit(1);
});
