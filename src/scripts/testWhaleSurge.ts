import { BingXService } from '../services/BingXService';
import { WhaleSurgeDetector } from '../core/analysis/WhaleSurgeDetector';
import { EngineConfluenceArbiter } from '../core/analysis/EngineConfluenceArbiter';
import { MATRIX_TFS } from '../core/analysis/TechnicalAnalyzer';
import { OHLCV } from '../core/shared/types';
import logger from '../utils/logger';

async function main() {
    const bingx = new BingXService('', '');
    const symbols = ['BTC/USDT:USDT', 'ETH/USDT:USDT', 'SOL/USDT:USDT'];

    console.log('Testing WhaleSurgeDetector on Live Market Data...\n');

    for (const sym of symbols) {
        try {
            const pricePrecision = await bingx.getPricePrecision(sym);
            const fetchResults = await Promise.all(
                MATRIX_TFS.map(async tf => {
                    const ohlcv = await bingx.fetchOHLCV(sym, tf, 100);
                    return { tf, ohlcv };
                })
            );

            const mtfOHLCV: Record<string, OHLCV[]> = {};
            fetchResults.forEach(r => mtfOHLCV[r.tf] = r.ohlcv);

            const surgeReport = WhaleSurgeDetector.analyze(sym, pricePrecision, mtfOHLCV);
            console.log(`=== [${sym}] Whale Surge Detection Report ===`);
            console.log(`Qualified: ${surgeReport.isQualified ? '🚀 YES' : '⚪ NO'}`);
            console.log(`Direction: ${surgeReport.direction} | Score: ${surgeReport.confidenceScore}%`);
            console.log(`Sweep: [${surgeReport.sweep.type}] ${surgeReport.sweep.reason}`);
            console.log(`Structure: [${surgeReport.structure.type}] ${surgeReport.structure.reason}`);
            console.log(`Volume: Multiplier=${surgeReport.volume.volumeMultiplier}x | Spike=${surgeReport.volume.isSpike}`);
            console.log(`Entry: ${surgeReport.suggestedEntry} | SL: ${surgeReport.suggestedSL}`);
            console.log(`TPs: ${surgeReport.suggestedTPs.join(' | ')}`);
            console.log(`Justification: ${surgeReport.justification}\n`);

            // Also test EngineConfluenceArbiter with WHALE_SURGE style
            const dossier = EngineConfluenceArbiter.buildDossier(sym, pricePrecision, mtfOHLCV, {
                quickTF: '15m',
                longTF: '1h',
                tradeStyle: 'WHALE_SURGE'
            });
            console.log(`Dossier Confluence Score in WHALE_SURGE mode: ${dossier.confluenceMetrics.overallScore}%`);
            console.log(`Dossier Recommended Direction: ${dossier.confluenceMetrics.recommendedDirection}`);
            console.log(`----------------------------------------------------\n`);
        } catch (e: any) {
            console.error(`Error testing ${sym}:`, e.message);
        }
    }
}

main().catch(console.error);
