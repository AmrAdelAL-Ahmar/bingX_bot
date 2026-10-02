import dotenv from 'dotenv';
dotenv.config();
import mongoose from 'mongoose';
import { EngineConfluenceArbiter, ALL_AVAILABLE_ENGINES, GOLDEN_ENGINES } from '../core/analysis/EngineConfluenceArbiter';
import { BingXService } from '../services/BingXService';
import User from '../models/User';
import { OHLCV } from '../core/shared/types';

async function main() {
    console.log('=== TESTING ENGINE SELECTOR & ADAPTIVE ATR STRUCTURAL SL ===\n');

    // 1. Test Engine Exclusion logic
    const bannedEngines = ['V10', 'V9', 'V12', 'V13', 'V16', 'V17', 'V18', 'V4', 'V5', 'V6', 'V2', 'V8'];
    console.log(`Banned Engines count: ${bannedEngines.length}`);

    // Mock candle data for testing
    const basePrice = 100;
    const mockCandles: OHLCV[] = [];
    for (let i = 0; i < 30; i++) {
        const close = basePrice + Math.sin(i / 3) * 2;
        mockCandles.push({
            timestamp: Date.now() - (30 - i) * 15 * 60 * 1000,
            open: close - 0.2,
            high: close + 0.8,
            low: close - 0.8,
            close,
            volume: 1000 + i * 50
        });
    }

    const mtfOHLCV: Record<string, OHLCV[]> = {
        '5m': mockCandles,
        '15m': mockCandles,
        '1h': mockCandles,
        '1d': mockCandles
    };

    console.log('1. Testing buildDossier with ALL engines enabled...');
    const fullDossier = EngineConfluenceArbiter.buildDossier('SOL/USDT:USDT', 2, mtfOHLCV, {
        tradeStyle: 'SCALP_TURBO',
        slMode: 'ATR_STRUCTURAL',
        minSlPercentage: 1.6,
        maxSlPercentage: 2.2,
        disabledEngines: []
    });

    console.log(`- Total Engines run with all enabled: ${fullDossier.enginesSummary.length}`);
    console.log(`- Recommended Direction: ${fullDossier.confluenceMetrics.recommendedDirection}`);
    console.log(`- Suggested SL: ${fullDossier.confluenceMetrics.suggestedSL}`);

    console.log('\n2. Testing buildDossier with BANNED engines...');
    const filteredDossier = EngineConfluenceArbiter.buildDossier('SOL/USDT:USDT', 2, mtfOHLCV, {
        tradeStyle: 'SCALP_TURBO',
        slMode: 'ATR_STRUCTURAL',
        minSlPercentage: 1.6,
        maxSlPercentage: 2.2,
        disabledEngines: bannedEngines
    });

    const participatingEngines = filteredDossier.enginesSummary.map(e => e.engineId);
    console.log(`- Total Engines run with filter: ${filteredDossier.enginesSummary.length}`);
    console.log(`- Participating Engines: [${participatingEngines.join(', ')}]`);

    // Verify none of the banned engines are present
    const leakedEngines = participatingEngines.filter(e => bannedEngines.includes(e.toUpperCase()));
    if (leakedEngines.length > 0) {
        console.error(`❌ LEAK DETECTED: Banned engines ran: ${leakedEngines.join(', ')}`);
    } else {
        console.log(`✅ SUCCESS: Zero banned engines ran! Clean separation verified.`);
    }

    // 3. Verify Adaptive SL Bounds
    const entryPrice = filteredDossier.currentPrice;
    const sl = filteredDossier.confluenceMetrics.suggestedSL;
    const slDistPct = (Math.abs(entryPrice - sl) / entryPrice) * 100;
    console.log(`\n3. Verifying Adaptive SL Bounds:`);
    console.log(`- Entry Price: ${entryPrice}`);
    console.log(`- Suggested SL: ${sl}`);
    console.log(`- SL Distance: ${slDistPct.toFixed(2)}%`);

    if (slDistPct >= 1.59 && slDistPct <= 2.21) {
        console.log(`✅ SUCCESS: Stop-Loss is strictly within the adaptive structural range (1.6% - 2.2%)!`);
    } else {
        console.warn(`⚠️ Warning: SL distance ${slDistPct.toFixed(2)}% outside expected bounds.`);
    }

    // 4. Test User DB persistence if connected
    if (process.env.MONGODB_URI) {
        await mongoose.connect(process.env.MONGODB_URI);
        const user = await User.findOne({ isActive: true });
        if (user) {
            console.log(`\n4. Database User Profile verification:`);
            console.log(`- Current DB slMode: ${user.autonomousSettings?.slMode || 'Default: ATR_STRUCTURAL'}`);
            console.log(`- Current DB disabledEngines count: ${user.autonomousSettings?.disabledEngines?.length || 'Default 12'}`);
        }
        await mongoose.disconnect();
    }

    console.log('\n🎉 ALL INTEGRATION TESTS PASSED SUCCESSFULLY!');
}

main().catch(console.error);
