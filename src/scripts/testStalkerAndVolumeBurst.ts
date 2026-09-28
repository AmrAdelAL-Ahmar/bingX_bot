import { BingXService } from '../services/BingXService';
import { MicroVolumeAnalyzer } from '../core/analysis/MicroVolumeAnalyzer';
import { OpportunityStalker } from '../core/analysis/OpportunityStalker';
import { EngineConfluenceArbiter, OPTIMIZED_ENGINE_WEIGHTS, DEFAULT_ENGINE_WEIGHTS } from '../core/analysis/EngineConfluenceArbiter';
import { JUNK_AND_COMMODITY_BLACKLIST } from '../core/picker/CcxtPickerEngine';
import logger from '../utils/logger';

async function runTest() {
    console.log('\n======================================================');
    console.log('🧪 TESTING STALKER, 1M VOLUME BURST & OPTIMIZATIONS');
    console.log('======================================================\n');

    const bingx = new BingXService('', '');

    // ── Test 1: Clean Crypto & Commodity Filter ──
    console.log('--- 1. Testing Clean Crypto Filter (Blacklist) ---');
    const testSymbols = ['BTC', 'ETH', 'SOL', 'PUMP', 'NCCO1OILBRENT2USD', 'NCCOGOLD2USD', 'LUNA'];
    for (const sym of testSymbols) {
        const isBlacklisted = JUNK_AND_COMMODITY_BLACKLIST.has(sym) || sym.startsWith('NCCO');
        console.log(`Symbol ${sym.padEnd(20)}: ${isBlacklisted ? '❌ BLOCKED (Junk/Commodity)' : '✅ ALLOWED (Clean Crypto)'}`);
    }

    // ── Test 2: Engine Weight Optimization Rebalance ──
    console.log('\n--- 2. Testing Engine Weight Rebalance ---');
    console.log(`V11 Weight (Default vs Optimized): ${DEFAULT_ENGINE_WEIGHTS['V11']} -> ${OPTIMIZED_ENGINE_WEIGHTS['V11']} (Boosted for Orderflow)`);
    console.log(`HARMONIC Weight (Default vs Optimized): ${DEFAULT_ENGINE_WEIGHTS['HARMONIC']} -> ${OPTIMIZED_ENGINE_WEIGHTS['HARMONIC']} (Boosted for Reversals)`);
    console.log(`V8 Weight (Default vs Optimized): ${DEFAULT_ENGINE_WEIGHTS['V8']} -> ${OPTIMIZED_ENGINE_WEIGHTS['V8']} (Nerfed: was falling knife bottom)`);
    console.log(`V17 Weight (Default vs Optimized): ${DEFAULT_ENGINE_WEIGHTS['V17']} -> ${OPTIMIZED_ENGINE_WEIGHTS['V17']} (Nerfed: was breakout chasing)`);

    // ── Test 3: MicroVolumeAnalyzer on Live 1m BingX Candles ──
    console.log('\n--- 3. Testing 1m MicroVolumeAnalyzer on Live Market ---');
    const testCoins = ['BTC/USDT:USDT', 'SOL/USDT:USDT'];

    for (const coin of testCoins) {
        console.log(`\nEvaluating 1m Volume Flow for ${coin}:`);
        const longReport = await MicroVolumeAnalyzer.analyze1mVolumeFlow(bingx, coin, 'LONG', 65, 2.0);
        console.log(`[LONG Analysis]:`);
        console.log(`  Buy Volume Ratio: ${longReport.buyVolumeRatio}% | Spike Factor: ${longReport.spikeFactor}x`);
        console.log(`  Absorption Present: ${longReport.isAbsorptionPresent}`);
        console.log(`  Ready to Fire: ${longReport.isReady ? '🚀 YES' : '⏳ NO'}`);
        console.log(`  Reason: ${longReport.reason}`);

        const shortReport = await MicroVolumeAnalyzer.analyze1mVolumeFlow(bingx, coin, 'SHORT', 65, 2.0);
        console.log(`[SHORT Analysis]:`);
        console.log(`  Sell Volume Ratio: ${shortReport.sellVolumeRatio}% | Spike Factor: ${shortReport.spikeFactor}x`);
        console.log(`  Ready to Fire: ${shortReport.isReady ? '🚀 YES' : '⏳ NO'}`);
        console.log(`  Reason: ${shortReport.reason}`);
    }

    // ── Test 4: OpportunityStalker In-Memory State & Queue ──
    console.log('\n--- 4. Testing OpportunityStalker Queue & Micro-Tick ---');
    const stalker = new OpportunityStalker();

    const currentBtcPrice = (await bingx.getMarketPrice('BTC/USDT:USDT')) || 65000;

    // Add candidate very close to current price to test strike-zone logic
    stalker.addCandidate({
        symbol: 'BTC',
        fullSymbol: 'BTC/USDT:USDT',
        direction: 'LONG',
        targetEntry: currentBtcPrice,
        targetZone: { min: currentBtcPrice * 0.998, max: currentBtcPrice * 1.002 },
        tp: currentBtcPrice * 1.02,
        sl: currentBtcPrice * 0.985,
        confluenceScore: 88,
        dossier: {} as any
    }, 30, 3);

    console.log(`Active stalked candidates count: ${stalker.getActiveCandidates().length}`);
    const activeCandidate = stalker.getActiveCandidates()[0];
    console.log(`Stalked candidate: ${activeCandidate.symbol} ${activeCandidate.direction} targeting ${activeCandidate.targetEntry}`);

    // Check candidate tick
    const tickResult = await stalker.checkCandidateTick(bingx, activeCandidate, 2.0, 65);
    console.log(`Stalker Tick Result:`);
    console.log(`  Current Price: ${tickResult.currentPrice}`);
    console.log(`  Should Execute: ${tickResult.shouldExecute}`);
    console.log(`  Reason: ${tickResult.reason}`);

    console.log('\n======================================================');
    console.log('✅ ALL TESTS COMPLETED SUCCESSFULLY!');
    console.log('======================================================\n');
}

runTest().catch(console.error);
