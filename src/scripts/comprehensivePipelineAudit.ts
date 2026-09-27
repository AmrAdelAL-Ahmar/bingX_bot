import dotenv from 'dotenv';
dotenv.config();

import mongoose from 'mongoose';
import { BingXService } from '../services/BingXService';
import { AutonomousOrchestrator } from '../services/AutonomousOrchestrator';
import { TradeManager } from '../services/TradeManager';
import { BtcMarketCompass } from '../core/analysis/BtcMarketCompass';
import { EngineConfluenceArbiter } from '../core/analysis/EngineConfluenceArbiter';
import { GeminiService } from '../services/GeminiService';
import { MATRIX_TFS } from '../core/analysis/TechnicalAnalyzer';
import { OHLCV } from '../core/shared/types';
import User from '../models/User';
import Trade from '../models/Trade';
import logger from '../utils/logger';

async function main() {
    console.log('================================================================');
    console.log('🔬 STARTING COMPREHENSIVE PIPELINE & AI AUDIT VERIFICATION');
    console.log('================================================================\n');

    await mongoose.connect(process.env.MONGODB_URI || '');
    console.log('✅ Connected to MongoDB successfully.');

    const bingx = new BingXService(process.env.BINGX_API_KEY || '', process.env.BINGX_SECRET_KEY || '');
    const tradeManager = new TradeManager(bingx);
    const mockNotifier = async (id: string, msg: string) => { console.log(`[Telegram Mock] ${msg.substring(0, 80)}...`); };

    const orchestrator = new AutonomousOrchestrator(bingx, tradeManager, mockNotifier);
    await orchestrator.syncSettingsFromUser();

    console.log('\n--- 1. ACTIVE ORCHESTRATOR CONFIGURATION ---');
    console.log(`- Trade Style: [${orchestrator.tradeStyle}]`);
    console.log(`- Max Concurrent Trades: [${orchestrator.maxConcurrentTrades}]`);
    console.log(`- Allowed Direction: [${orchestrator.allowedDirection}]`);
    console.log(`- Anti-Peak Guard Enabled: [${orchestrator.antiPeakGuardEnabled ? '✅ YES' : '❌ NO'}]`);
    console.log(`- Front-Run TP Enabled: [${orchestrator.frontRunTpEnabled ? '✅ YES' : '❌ NO'}]`);
    console.log(`- Auto Break-Even Enabled: [${orchestrator.autoBreakEvenEnabled ? '✅ YES' : '❌ NO'}]`);
    console.log(`- Turbo SL %: [${orchestrator.turboSlPercentage}%]`);

    // 2. Test BTC Compass
    console.log('\n--- 2. BITCOIN MACRO COMPASS CHECK ---');
    const compass = await BtcMarketCompass.getMarketCompass(bingx, true);
    console.log(`- Current BTC Price: $${compass.currentBtcPrice}`);
    console.log(`- 15m Trend: ${compass.trend15m} | Above VWAP: ${compass.isAboveVwap ? '✅' : '❌'}`);
    console.log(`- 15m Change: ${compass.change15mPct.toFixed(2)}% | 1h Change: ${compass.btcChange1h.toFixed(2)}%`);
    console.log(`- Flash Dump Blackout Active: ${compass.isBlackout ? '🚨 YES (HALTED)' : '✅ NO (SAFE)'}`);
    console.log(`- Directional Permissions: Longs: ${compass.allowLongs ? '✅' : '❌'} | Shorts: ${compass.allowShorts ? '✅' : '❌'}`);
    console.log(`- Status Summary: ${compass.statusSummary}`);

    // 3. Test Dynamic CCXT Live Market Scanner
    console.log('\n--- 3. DYNAMIC CCXT LIVE MARKET SCANNER ---');
    await orchestrator.refreshWatchlist();
    console.log(`- Active Watchlist Coins (${orchestrator.activeWatchlist.length}): [${orchestrator.activeWatchlist.join(', ')}]`);

    // 4. Test Confluence Arbiter & Retest Quality on Top Candidate
    const candidateSymbol = orchestrator.activeWatchlist[0] || 'SOL';
    console.log(`\n--- 4. DOSSIER & RETEST ENGINE ON [${candidateSymbol}] ---`);
    const fullSymbol = `${candidateSymbol}/USDT:USDT`;
    const precision = await bingx.getPricePrecision(fullSymbol);
    const mtfOHLCV: Record<string, OHLCV[]> = {};
    for (const tf of MATRIX_TFS) {
        mtfOHLCV[tf] = await bingx.fetchOHLCV(fullSymbol, tf, 50);
    }

    const dossier = EngineConfluenceArbiter.buildDossier(fullSymbol, precision, mtfOHLCV, {
        quickTF: '5m',
        longTF: '15m',
        tradeStyle: orchestrator.tradeStyle
    });

    console.log(`- Confluence Overall Score: ${dossier.confluenceMetrics.overallScore}%`);
    console.log(`- Recommended Direction: ${dossier.confluenceMetrics.recommendedDirection}`);
    console.log(`- Suggested Entry: $${dossier.confluenceMetrics.suggestedEntry}`);
    console.log(`- Suggested SL: $${dossier.confluenceMetrics.suggestedSL}`);
    console.log(`- Suggested TPs: ${JSON.stringify(dossier.confluenceMetrics.suggestedTPs)}`);
    console.log(`- Retest & Pullback Quality:`, dossier.pullbackRetestQuality);
    console.log(`- Anti-Peak Analysis:`, dossier.antiPeakAnalysis);
    console.log(`- Structural Front-Run:`, dossier.structuralFrontRun);

    // 5. Test Gemini AI Supreme Audit
    console.log('\n--- 5. TESTING GEMINI AI SUPREME AUDIT (LIVE CALL) ---');
    const aiStartTime = Date.now();
    try {
        const audit = await GeminiService.auditQuantitativeDossier(dossier);
        const elapsed = ((Date.now() - aiStartTime) / 1000).toFixed(2);
        console.log(`✅ Gemini AI Audit Response Received in ${elapsed}s:`);
        console.log(`- Approved: ${audit.approved ? '🟢 APPROVED' : '🔴 VETOED'}`);
        if (!audit.approved) {
            console.log(`- Veto Reason: ${audit.vetoReason}`);
        }
        console.log(`- Final Direction: ${audit.finalDirection}`);
        console.log(`- AI Confidence: ${audit.confidence}%`);
        console.log(`- Recommended Entry: $${audit.recommendedEntry}`);
        console.log(`- Recommended SL: $${audit.recommendedSL}`);
        if (audit.recommendedSL && audit.recommendedEntry) {
            const slPct = Math.abs((audit.recommendedEntry - audit.recommendedSL) / audit.recommendedEntry) * 100;
            console.log(`- SL Distance %: ${slPct.toFixed(2)}%`);
        }
        console.log(`- Micro-TP (50% target): $${audit.microTP}`);
        console.log(`- Recommended TPs: ${JSON.stringify(audit.recommendedTPs)}`);
        console.log(`- AI Justification Report:\n  ${audit.auditJustification}`);
    } catch (aiErr: any) {
        console.error(`❌ Gemini AI Audit Error: ${aiErr.message}`);
    }

    // 6. Check Active Positions & Capacity
    console.log('\n--- 6. PORTFOLIO CAPACITY & OPEN TRADES CHECK ---');
    const activeTrades = await Trade.find({
        isPaperTrade: true,
        currentStatus: { $in: ['OPEN', 'TP1_HIT', 'TP2_HIT'] }
    });
    console.log(`- Current Open Trades: ${activeTrades.length} / ${orchestrator.maxConcurrentTrades}`);
    const availableSlots = Math.max(0, orchestrator.maxConcurrentTrades - activeTrades.length);
    console.log(`- Available Trading Slots: ${availableSlots}`);
    const cyclePacingLimit = (orchestrator.maxConcurrentTrades >= 5 && availableSlots >= 2) ? 2 : 1;
    console.log(`- Maximum Executable per Cycle: ${Math.min(availableSlots, cyclePacingLimit)} trade(s)`);

    console.log('\n================================================================');
    console.log('🎉 PIPELINE & AI VERIFICATION COMPLETE');
    console.log('================================================================');

    await mongoose.disconnect();
    process.exit(0);
}

main().catch(err => {
    console.error('Fatal test error:', err);
    process.exit(1);
});
