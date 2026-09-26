import dotenv from 'dotenv';
dotenv.config();

import { BingXService } from '../services/BingXService';
import { BtcMarketCompass } from '../core/analysis/BtcMarketCompass';
import { SymbolPickerService } from '../services/SymbolPickerService';
import { EngineConfluenceArbiter } from '../core/analysis/EngineConfluenceArbiter';
import { MATRIX_TFS } from '../core/analysis/TechnicalAnalyzer';
import { OHLCV } from '../core/shared/types';
import logger from '../utils/logger';

async function runTest() {
    logger.info('🚀 Testing New Market Pillars (BTC Compass, Live Scanner, Retest Trigger)...');

    const bingx = new BingXService(process.env.BINGX_API_KEY || '', process.env.BINGX_SECRET_KEY || '');

    // 1. Test BTC Market Compass
    console.log('\n--- 1. Testing BTC Market Compass ---');
    const btcCompass = await BtcMarketCompass.getMarketCompass(bingx, true);
    console.log(`BTC Price: $${btcCompass.currentBtcPrice}`);
    console.log(`Trend 15m: ${btcCompass.trend15m}`);
    console.log(`Above VWAP: ${btcCompass.isAboveVwap}`);
    console.log(`15m Change: ${btcCompass.change15mPct.toFixed(2)}% | 1h Change: ${btcCompass.btcChange1h.toFixed(2)}%`);
    console.log(`Is Blackout: ${btcCompass.isBlackout}`);
    console.log(`Allow Longs: ${btcCompass.allowLongs} | Allow Shorts: ${btcCompass.allowShorts}`);
    console.log(`Summary: ${btcCompass.statusSummary}`);

    // 2. Test Dynamic CCXT Live Scanner
    console.log('\n--- 2. Testing Dynamic CCXT Live Market Scanner ---');
    const picker = new SymbolPickerService(bingx);
    const topPicks = await picker.refreshScan(10, 'ccxt');
    console.log(`Scanned ${topPicks.length} hot coins.`);
    topPicks.slice(0, 5).forEach((p, idx) => {
        console.log(`  [#${idx + 1}] ${p.symbol} (${p.shortName}) | Score: ${p.score} | Trend: ${p.trend} | Label: ${p.label}`);
    });

    // 3. Test Pullback & Retest in Arbiter Dossier
    if (topPicks.length > 0) {
        const testCoin = topPicks[0].shortName;
        console.log(`\n--- 3. Testing Dossier & Pullback Analysis on ${testCoin} ---`);
        const fullSymbol = `${testCoin}/USDT:USDT`;
        const precision = await bingx.getPricePrecision(fullSymbol);
        const mtfOHLCV: Record<string, OHLCV[]> = {};
        for (const tf of MATRIX_TFS) {
            mtfOHLCV[tf] = await bingx.fetchOHLCV(fullSymbol, tf, 50);
        }

        const dossier = EngineConfluenceArbiter.buildDossier(fullSymbol, precision, mtfOHLCV, {
            quickTF: '5m',
            longTF: '15m',
            tradeStyle: 'SCALP_TURBO'
        });

        console.log(`Dossier Score: ${dossier.confluenceMetrics.overallScore}%`);
        console.log(`Direction: ${dossier.confluenceMetrics.recommendedDirection}`);
        console.log(`Pullback & Retest Quality:`, dossier.pullbackRetestQuality);
        console.log(`Anti-Peak Analysis:`, dossier.antiPeakAnalysis);
        console.log(`Structural Front-Run:`, dossier.structuralFrontRun);
    }

    console.log('\n✅ All pillar tests completed successfully!');
    process.exit(0);
}

runTest().catch(err => {
    console.error('❌ Test failed:', err);
    process.exit(1);
});
