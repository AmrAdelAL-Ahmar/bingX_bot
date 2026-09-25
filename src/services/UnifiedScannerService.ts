import logger from '../utils/logger';
import { BingXService } from './BingXService';
import { CoreAnalysisService } from '../core/analysis/CoreAnalysisService';
import { CoreSniperScanner } from '../core/sniper/CoreSniperScanner';
import { getSniperEngine } from '../core/sniper/SniperRegistry';
import { MATRIX_TFS } from '../core/analysis/TechnicalAnalyzer';
import { OHLCV } from '../core/shared/types';
import { SniperReport } from '../core/sniper/ISniperEngine';
import { AnalysisFormatter } from '../core/analysis/AnalysisFormatter';

const ANALYSIS_TRUST_SCORES: Record<string, number> = {
    'HARMONIC': 90,
    'V16': 98,
    'V15': 97,
    'V18': 90,
    'V17': 80,
    'V11': 95,
    'V10': 93,
    'V12': 90,
    'V13': 90,
    'V14': 88,
    'V9': 87,
    'V8': 85,
    'V7': 85,
    'V6': 85,
    'V3': 82,
    'V5': 80,
    'V2': 75,
    'V4': 70,
    'V1': 90
};

const ANALYSIS_ARABIC_NAMES: Record<string, string> = {
    'V1': 'الخوارزمية V1 (الأساسي)',
    'V2': 'الخوارزمية V2 (الكمي)',
    'V3': 'الخوارزمية V3 (المصفوفة)',
    'V4': 'الخوارزمية V4 (ثنائي الاتجاه)',
    'V5': 'الخوارزمية V5 (تنبؤي AI) 🔮',
    'V6': 'الخوارزمية V6 (Sniper) 🎯',
    'V7': 'الخوارزمية V7 (القناص الهجيني) 🏹',
    'V8': 'الخوارزمية V8 (قناص الموجات والسيولة) 🌊',
    'V9': 'الخوارزمية V9 (قناص SMC الذكي) 🏛️',
    'V10': 'الخوارزمية V10 (المؤسساتي المتقدم) 🏆',
    'V11': 'الخوارزمية V11 (القرار التكيفي) 👑',
    'V12': 'الخوارزمية V12 (تدفق السيولة CVD) 📊',
    'V13': 'الخوارزمية V13 (مصائد وايكوف) 🪤',
    'V14': 'الخوارزمية V14 (رينكو السحابية التكيفية) ☁️',
    'V15': 'الخوارزمية V15 (تشان الهارمونية الكمية) 🌌',
    'V16': 'الخوارزمية V16 (مصفوفة الزمان والمكان الهجينة) 🏹',
    'V17': 'الخوارزمية V17 (نظام السوق الديناميكي) 🌐',
    'V18': 'الخوارزمية V18 (تدفق السيولة وعمق الأوامر) 📊',
    'HARMONIC': 'منظومة الهارمونيك الكاملة (11 نموذجاً) 🎯'
};

const SNIPER_TRUST_SCORES: Record<string, number> = {
    'HARMONIC': 99,
    'V16': 98,
    'V15': 97,
    'V18': 96,
    'V17': 95,
    'V11': 95,
    'V10': 93,
    'V12': 90,
    'V13': 90,
    'V14': 88,
    'V9': 87,
    'V8': 85,
    'V7': 85,
    'V1': 80
};

export class UnifiedScannerService {
    constructor(private bingxService: BingXService) { }

    private getSniperTrust(engineId: string): number {
        const base = engineId.split('-')[0];
        return SNIPER_TRUST_SCORES[base] || 80;
    }

    /**
     * Runs multi-engine analysis for a set of symbols
     */
    async runUnifiedAnalysis(
        symbols: string[],
        engines: string[],
        options: { quickTF?: string; longTF?: string; limit?: number; antiRepainting?: boolean } = {}
    ) {
        const results: any[] = [];

        const quickTF = options.quickTF || '5m';
        const longTF = options.longTF || '1h';
        const limit = options.limit || 200;

        for (let symbol of symbols) {
            try {
                if (!symbol.includes('/')) symbol = `${symbol}/USDT:USDT`;

                // Fetch data once for the symbol
                const [pricePrecision, ...fetchResults] = await Promise.all([
                    this.bingxService.getPricePrecision(symbol),
                    ...MATRIX_TFS.map(async tf => {
                        const fetchLimit = (tf === quickTF || tf === longTF) ? Math.max(limit, 200) : 200;
                        const ohlcv = await this.bingxService.fetchOHLCV(symbol, tf, fetchLimit);
                        return { tf, ohlcv };
                    })
                ]);

                const mtfOHLCV: Record<string, OHLCV[]> = {};
                fetchResults.forEach(res => mtfOHLCV[res.tf] = res.ohlcv);

                // Run selected engines in-memory
                const engineResults: any[] = [];
                for (const engineId of engines) {
                    try {
                        const res = CoreAnalysisService.analyze(symbol, pricePrecision, mtfOHLCV, engineId as any, {
                            quickTF,
                            longTF,
                            limit,
                            antiRepainting: options.antiRepainting
                        });

                        // Calculate score
                        let score = 0;
                        const hasActiveSignal = res.scalp.type !== 'NONE' || res.swing.type !== 'NONE';
                        const baseTrust = ANALYSIS_TRUST_SCORES[engineId] || 70;

                        if (hasActiveSignal) {
                            score += 100;
                            score += res.matrix.percentage * 0.5;
                            score += baseTrust * 0.5;
                        } else {
                            score += res.matrix.percentage * 0.2;
                            score += baseTrust * 0.2;
                        }

                        engineResults.push({
                            engineId,
                            score,
                            analysisResult: res,
                            reportText: AnalysisFormatter.formatReport(res, engineId)
                        });
                    } catch (err: any) {
                        logger.error(`Error running analysis engine ${engineId} for ${symbol}:`, err);
                    }
                }

                // Sort engines by score descending
                engineResults.sort((a, b) => b.score - a.score);

                // Build report
                let report = `📊 **تقرير التحليل الموحد لعملة ${symbol.split('/')[0]}** 📊\n`;
                report += `━━━━━━━━━━━━━━\n`;
                report += `💵 السعر الحالي: **$${(mtfOHLCV[quickTF]?.slice(-1)[0]?.close || 0).toFixed(pricePrecision)}**\n`;
                report += `⏱️ فريم السكالب: **${quickTF}** | فريم السوينج: **${longTF}**\n`;
                report += `━━━━━━━━━━━━━━\n`;
                report += `🏆 **ترشيح أفضل محركات التحليل (الترتيب حسب الدقة والوثوقية):**\n\n`;

                engineResults.forEach((er, idx) => {
                    const res = er.analysisResult;
                    const baseTrust = ANALYSIS_TRUST_SCORES[er.engineId] || 70;
                    const scalpEmoji = res.scalp.type === 'LONG' ? '🟢' : res.scalp.type === 'SHORT' ? '🔴' : '⚪';
                    const swingEmoji = res.swing.type === 'LONG' ? '🟢' : res.swing.type === 'SHORT' ? '🔴' : '⚪';

                    let rankEmoji = '🔹';
                    if (idx === 0) rankEmoji = '👑';
                    else if (idx === 1) rankEmoji = '🥈';
                    else if (idx === 2) rankEmoji = '🥉';

                    report += `${rankEmoji} **${ANALYSIS_ARABIC_NAMES[er.engineId] || er.engineId}** (وثوقية: ${baseTrust}%)\n`;
                    report += `   • السكالب: ${scalpEmoji} **${res.scalp.type === 'NONE' ? 'حيادي' : res.scalp.type}** `;
                    if (res.scalp.type !== 'NONE') {
                        report += `(\`Entry: ${res.scalp.entry.toFixed(pricePrecision)}\` | \`TP: ${res.scalp.tp.toFixed(pricePrecision)}\` | \`SL: ${res.scalp.sl.toFixed(pricePrecision)}\`)`;
                    }
                    report += `\n`;

                    report += `   • السوينج: ${swingEmoji} **${res.swing.type === 'NONE' ? 'حيادي' : res.swing.type}** `;
                    if (res.swing.type !== 'NONE') {
                        report += `(\`Entry: ${res.swing.entry.toFixed(pricePrecision)}\` | \`TP: ${res.swing.tp.toFixed(pricePrecision)}\` | \`SL: ${res.swing.sl.toFixed(pricePrecision)}\`)`;
                    }
                    report += `\n`;
                    report += `   • قوة التوافق (Matrix): **${res.matrix.percentage}%**\n`;
                    report += `━━━━━━━━━━━━━━\n`;
                });

                results.push({
                    symbol,
                    pricePrecision,
                    currentPrice: mtfOHLCV[quickTF]?.slice(-1)[0]?.close || 0,
                    reportText: report,
                    engines: engineResults
                });
            } catch (err: any) {
                logger.error(`Unified analysis failed for symbol ${symbol}:`, err);
                results.push({
                    symbol,
                    error: err.message,
                    reportText: `❌ **فشل التحليل لعملة ${symbol.split('/')[0]}:** ${err.message}`
                });
            }
        }

        return results;
    }

    /**
     * Runs multi-engine sniper scan for a set of symbols
     */
    async runUnifiedSniper(
        symbols: string[],
        engines: string[]
    ) {
        const results: any[] = [];

        for (let symbol of symbols) {
            try {
                if (!symbol.includes('/')) symbol = `${symbol}/USDT:USDT`;

                // Determine union of timeframes
                const allRequiredTFs = new Set<string>(MATRIX_TFS);
                for (const engineId of engines) {
                    const engine = getSniperEngine(engineId);
                    if (engine) {
                        engine.requiredTFs.forEach(tf => allRequiredTFs.add(tf));
                    }
                }

                // Fetch deep historical data for all timeframes
                const allData: Record<string, OHLCV[]> = {};
                for (const tf of allRequiredTFs) {
                    // Optimized lookbacks: 150-250 candles per TF is ideal for indicators without hammering the exchange
                    const daysNeeded = tf === '1d' ? 210 : tf === '4h' ? 40 : tf === '1h' ? 12 : tf === '30m' ? 3 : tf === '15m' ? 2 : tf === '5m' ? 1 : 0.25;
                    allData[tf] = await this.bingxService.fetchDeepHistoricalData(symbol, tf, daysNeeded);
                }

                const pricePrecision = await this.bingxService.getPricePrecision(symbol);
                const currentPrice = allData['5m']?.slice(-1)[0]?.close
                    || allData['15m']?.slice(-1)[0]?.close
                    || 0;

                // Run selected engines in memory
                const engineResults: any[] = [];
                for (const engineId of engines) {
                    try {
                        const report = CoreSniperScanner.scan(symbol, engineId, allData);
                        if (report) {
                            // Calculate score
                            let score = 0;
                            const hasActiveSignal = report.direction !== 'NONE';
                            const baseTrust = this.getSniperTrust(engineId);

                            if (report.readyToFire) {
                                score += 200;
                            }
                            if (hasActiveSignal) {
                                score += 100;
                            }
                            score += report.confidence * 0.5;
                            score += report.winRate * 0.5;
                            score += baseTrust * 0.5;

                            engineResults.push({
                                engineId,
                                score,
                                sniperReport: report,
                                reportText: report.details
                            });
                        }
                    } catch (err: any) {
                        logger.error(`Error running sniper engine ${engineId} for ${symbol}:`, err);
                    }
                }

                // Sort engines by score descending
                engineResults.sort((a, b) => b.score - a.score);

                // Build report
                let report = `🎯 **تقرير القنص الموحد لعملة ${symbol.split('/')[0]}** 🎯\n`;
                report += `━━━━━━━━━━━━━━\n`;
                report += `💵 السعر الحالي: **$${currentPrice.toFixed(pricePrecision)}**\n`;
                report += `━━━━━━━━━━━━━━\n`;
                report += `🏆 **ترشيح أفضل محركات القنص (الترتيب حسب الجاهزية والدقة):**\n\n`;

                // Split into top active/ready engines and idle/neutral engines
                const activeEngines = engineResults.filter(er => er.sniperReport.direction !== 'NONE' || er.sniperReport.readyToFire);
                const idleEngines = engineResults.filter(er => er.sniperReport.direction === 'NONE' && !er.sniperReport.readyToFire);

                // Show top active engines (up to 8 engines max to prevent message overflow)
                const featuredEngines = (activeEngines.length > 0 ? activeEngines : engineResults).slice(0, 8);

                featuredEngines.forEach((er, idx) => {
                    const rep: SniperReport = er.sniperReport;
                    const engine = getSniperEngine(er.engineId);
                    const baseTrust = this.getSniperTrust(er.engineId);
                    const dirEmoji = rep.direction === 'LONG' ? '🟢' : rep.direction === 'SHORT' ? '🔴' : '⚪';

                    let rankEmoji = '🔹';
                    if (idx === 0) rankEmoji = '👑';
                    else if (idx === 1) rankEmoji = '🥈';
                    else if (idx === 2) rankEmoji = '🥉';

                    const fireText = rep.readyToFire ? '🚀 جاهز للدخول فورا!' : '⏳ منتظر اكتمال الشروط';

                    report += `${rankEmoji} **${engine?.displayName || er.engineId}** (وثوقية: ${baseTrust}%)\n`;
                    report += `   • الاتجاه: ${dirEmoji} **${rep.direction === 'NONE' ? 'حيادي' : rep.direction}**\n`;
                    if (rep.direction !== 'NONE') {
                        report += `   • الدخول: \`${rep.entry.toFixed(pricePrecision)}\` | الاستوب: \`${rep.sl.toFixed(pricePrecision)}\` | الهدف: \`${rep.tp.toFixed(pricePrecision)}\`\n`;
                    }
                    report += `   • وضع الزناد: **${fireText}**\n`;
                    report += `   • الشروط المكتملة: **${rep.completedConditions.length}/${rep.completedConditions.length + rep.pendingConditions.length}**\n`;
                    report += `━━━━━━━━━━━━━━\n`;
                });

                // Compact summary for remaining idle/monitoring engines
                const remainingEngines = engineResults.filter(er => !featuredEngines.some(fe => fe.engineId === er.engineId));
                if (remainingEngines.length > 0) {
                    report += `\n💤 **محركات قيد المراقبة والانتظار (${remainingEngines.length} محركاً):**\n`;
                    const idleList = remainingEngines.map(er => {
                        const engine = getSniperEngine(er.engineId);
                        const name = engine?.displayName?.replace(/قناص|المؤسساتي|الشامل/g, '').trim() || er.engineId;
                        return `• ${name}: ⏳ منتظر (${er.sniperReport.completedConditions.length}/${er.sniperReport.completedConditions.length + er.sniperReport.pendingConditions.length})`;
                    }).slice(0, 10).join('\n');
                    report += `${idleList}\n`;
                    if (remainingEngines.length > 10) {
                        report += `• ... وباقي المحركات محايدة بانتظار تشكل السيولة.\n`;
                    }
                    report += `━━━━━━━━━━━━━━\n`;
                }

                results.push({
                    symbol,
                    pricePrecision,
                    currentPrice,
                    reportText: report,
                    engines: engineResults
                });
            } catch (err: any) {
                logger.error(`Unified sniper scan failed for symbol ${symbol}:`, err);
                results.push({
                    symbol,
                    error: err.message,
                    reportText: `❌ **فشل القنص لعملة ${symbol.split('/')[0]}:** ${err.message}`
                });
            }
        }

        return results;
    }
}
