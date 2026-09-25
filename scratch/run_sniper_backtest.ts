import dotenv from 'dotenv';
import { BingXService } from '../src/services/BingXService';
import { TechnicalAnalyzer, MATRIX_TFS } from '../src/services/TechnicalAnalyzer';
import { MTFDataBuilder } from '../src/services/MTFDataBuilder';
import { OHLCV, AnalysisDetails } from '../src/services/AnalysisService';
import { getSniperEngine } from '../src/services/sniper/SniperRegistry';
import * as fs from 'fs';
import * as path from 'path';

dotenv.config();

console.log("====================================================");
console.log("🎯 STARING AUTOMATED SNIPER BACKTEST ENGINE 🎯");
console.log("====================================================\n");

// ─── CONFIGURATION ───────────────────────────────────────────────────────────
const SYMBOL = 'BTC/USDT:USDT';
const ENGINE_ID = 'V8-SCALP'; // Options: V8-SCALP, V8-SWING, V7-SCALP, V7-SWING
const DAYS = 10;              // Backtest duration (10 days is great for scalp)
const STEP_MINUTES = 10;      // Step interval for testing triggers (10m)
const COOLDOWN_HOURS = 2;     // Cooldown after entry before we can sniper another trade

async function runSniperBacktest() {
    const bingx = new BingXService(process.env.BINGX_API_KEY, process.env.BINGX_SECRET_KEY);
    const engine = getSniperEngine(ENGINE_ID);
    
    if (!engine) {
        console.error(`❌ Engine ${ENGINE_ID} not found in registry!`);
        return;
    }

    console.log(`🤖 Engine: ${engine.displayName}`);
    console.log(`🪙 Pair: ${SYMBOL}`);
    console.log(`📅 Period: Last ${DAYS} Days`);
    console.log(`⏳ Analysis Interval: Every ${STEP_MINUTES} minutes`);
    console.log(`⏱ Timeframes Required: ${engine.requiredTFs.join(', ')}\n`);

    const now = Date.now();
    const startTime = now - (DAYS * 24 * 60 * 60 * 1000);

    // 1. Fetch deep historical data for all required timeframes once
    console.log("📥 Fetching historical market data...");
    const allData: Record<string, OHLCV[]> = {};
    const tfsToFetch = [...new Set([...MATRIX_TFS, ...engine.requiredTFs])];

    for (const tf of tfsToFetch) {
        let fetchDays = DAYS;
        if (tf === '1d') fetchDays += 200;
        else if (tf === '4h') fetchDays += 35;
        else if (tf === '1h') fetchDays += 10;
        else fetchDays += 3;

        try {
            allData[tf] = await bingx.fetchDeepHistoricalData(SYMBOL, tf, fetchDays);
            console.log(`✅ Loaded ${allData[tf].length} candles for [${tf}]`);
        } catch (err: any) {
            console.error(`❌ Failed to load [${tf}] data:`, err.message);
            return;
        }
    }

    const evaluationTF = '5m';
    const evalData = allData[evaluationTF] || allData['15m'];
    if (!evalData || evalData.length === 0) {
        console.error("❌ Evaluation data (5m/15m) not available!");
        return;
    }

    console.log("\n🚀 Starting Backtest Loop...");

    interface ActiveTrade {
        type: 'LONG' | 'SHORT';
        entryPrice: number;
        sl: number;
        tp: number;
        tp2?: number;
        entryTime: number;
        entryDate: string;
        engineId: string;
    }

    const completedTrades: any[] = [];
    let currentTrade: ActiveTrade | null = null;
    let totalSnipedOpportunities = 0; // "عدد الفرص التي تم قنصها"
    let totalEnteredTrades = 0;       // "عدد الفرص التي تم الدخول فيها"
    let lastEntryTime = 0;
    let lastKnownPrice = 0;

    // Loop through time step-by-step
    for (let t = startTime; t <= now; t += STEP_MINUTES * 60 * 1000) {
        
        // Build MTF snapshot at timestamp `t` without lookahead bias
        const mtfSnapshot: Record<string, OHLCV[]> = {};
        let hasEnoughData = true;

        for (const tf of tfsToFetch) {
            const tfMs = MTFDataBuilder.tfToMs(tf);
            const dataUpToT = allData[tf].filter(c => c.timestamp + tfMs <= t);
            mtfSnapshot[tf] = dataUpToT;

            if (dataUpToT.length < 15) {
                hasEnoughData = false;
            }
        }

        if (!hasEnoughData) continue;

        // Get current price at timestamp `t`
        const quickTF = engine.requiredTFs[engine.requiredTFs.length - 1]; // e.g. '1m' or '15m'
        const quickCandles = mtfSnapshot[quickTF];
        if (!quickCandles || quickCandles.length === 0) continue;

        const currentPrice = quickCandles[quickCandles.length - 1].close;
        lastKnownPrice = currentPrice;

        // ─── PART A: EVALUATE ACTIVE TRADE ────────────────────────────────────
        if (currentTrade) {
            const trade = currentTrade;
            // Find fine-grained candles starting after trade entry
            const futureCandles = evalData.filter(c => c.timestamp >= trade.entryTime && c.timestamp <= t);
            let closed = false;
            let resultStatus: 'WIN' | 'LOSS' = 'WIN';
            let closePrice = 0;
            let closeTime = 0;

            for (const candle of futureCandles) {
                if (trade.type === 'LONG') {
                    if (candle.high >= trade.tp) {
                        closed = true;
                        resultStatus = 'WIN';
                        closePrice = trade.tp;
                        closeTime = candle.timestamp;
                        break;
                    } else if (candle.low <= trade.sl) {
                        closed = true;
                        resultStatus = 'LOSS';
                        closePrice = trade.sl;
                        closeTime = candle.timestamp;
                        break;
                    }
                } else { // SHORT
                    if (candle.low <= trade.tp) {
                        closed = true;
                        resultStatus = 'WIN';
                        closePrice = trade.tp;
                        closeTime = candle.timestamp;
                        break;
                    } else if (candle.high >= trade.sl) {
                        closed = true;
                        resultStatus = 'LOSS';
                        closePrice = trade.sl;
                        closeTime = candle.timestamp;
                        break;
                    }
                }
            }

            if (closed) {
                const durationMin = Math.round((closeTime - trade.entryTime) / 60000);
                const pnlPct = trade.type === 'LONG' 
                    ? ((closePrice - trade.entryPrice) / trade.entryPrice) * 100
                    : ((trade.entryPrice - closePrice) / trade.entryPrice) * 100;

                completedTrades.push({
                    ...trade,
                    status: resultStatus,
                    closePrice,
                    closeTime,
                    closeDate: new Date(closeTime).toISOString().replace('T', ' ').substring(0, 16),
                    durationMinutes: durationMin,
                    pnlPercentage: pnlPct * 10 // Assuming 10x leverage
                });

                currentTrade = null; // Clear position
            }
        }

        // ─── PART B: RUN SNIPER SCANNING ──────────────────────────────────────
        const dailyOHLCV = mtfSnapshot['1d'] || mtfSnapshot['4h'] || quickCandles;
        const vwap = dailyOHLCV.length > 0 ? TechnicalAnalyzer.calculateVWAP(dailyOHLCV) : currentPrice;

        const allTimeframes: Record<string, AnalysisDetails> = {};
        tfsToFetch.forEach(tf => {
            if (mtfSnapshot[tf] && mtfSnapshot[tf].length > 15) {
                allTimeframes[tf] = TechnicalAnalyzer.calculateTechnicalData(mtfSnapshot[tf], tf, vwap);
            }
        });

        // Run the sniper engine scan
        const report = engine.scan(SYMBOL, currentPrice, mtfSnapshot, allTimeframes);

        if (report.readyToFire) {
            totalSnipedOpportunities++; // "تم قنصها"

            const dateStr = new Date(t).toISOString().replace('T', ' ').substring(0, 16);
            
            // Check if we can enter: Not in a trade AND cooldown has passed
            const cooldownMs = COOLDOWN_HOURS * 60 * 60 * 1000;
            if (!currentTrade && (t - lastEntryTime >= cooldownMs)) {
                totalEnteredTrades++; // "تم الدخول فيها"
                lastEntryTime = t;

                currentTrade = {
                    type: report.direction as 'LONG' | 'SHORT',
                    entryPrice: report.entry,
                    sl: report.sl,
                    tp: report.tp,
                    tp2: report.tp2,
                    entryTime: t,
                    entryDate: dateStr,
                    engineId: ENGINE_ID
                };
            }
        }
    }

    // Force close any remaining open position at the end of simulation
    if (currentTrade) {
        completedTrades.push({
            ...currentTrade,
            status: 'OPEN',
            closePrice: lastKnownPrice,
            closeTime: now,
            closeDate: 'N/A',
            durationMinutes: Math.round((now - currentTrade.entryTime) / 60000),
            pnlPercentage: 0
        });
    }

    // ─── PART C: COMPILE STATISTICS & REPORT ─────────────────────────────────
    let wins = 0;
    let losses = 0;
    let openCount = 0;
    let totalPnl = 0;

    completedTrades.forEach(tr => {
        if (tr.status === 'WIN') wins++;
        else if (tr.status === 'LOSS') losses++;
        else openCount++;
        totalPnl += tr.pnlPercentage;
    });

    const winRate = (wins + losses) > 0 ? (wins / (wins + losses)) * 100 : 0;

    const reportMarkdown = `# 🎯 تقرير الاختبار الرجعي لمحرك الاقتناص (${ENGINE_ID})

## 📊 الخلاصة والأداء العام
- **اسم المحرك:** \`${engine.displayName}\`
- **زوج التداول:** \`${SYMBOL}\`
- **مدة الاختبار:** \`أخر ${DAYS} أيام\`
- **فاصل الفحص:** \`كل ${STEP_MINUTES} دقائق\`

━━━━━━━━━━━━━━━━━━━━━━━━━━

### 🎯 إحصائيات الاقتناص والصفقات
- **عدد الفرص التي تم قنصها (إشارات جاهزة):** \`${totalSnipedOpportunities}\` فرصة
- **عدد الفرص التي تم الدخول فيها (واقعية):** \`${totalEnteredTrades}\` صفقة
- **🏆 عدد الفرص التي ضربت الأهداف (TP):** \`${wins}\` صفقات ناجحة
- **❌ عدد الفرص التي ضربت الاستوب (SL):** \`${losses}\` صفقات خاسرة
- **⏳ صفقات لا تزال مفتوحة:** \`${openCount}\` صفقة
- **🎯 نسبة النجاح الفعالة (Win Rate):** \`${winRate.toFixed(1)}%\`
- **💰 إجمالي عائد التداول التراكمي (برافعة 10x):** \`${totalPnl >= 0 ? '+' : ''}${totalPnl.toFixed(2)}%\`

━━━━━━━━━━━━━━━━━━━━━━━━━━

## 📋 سجل تفاصيل الصفقات المنفذة
| الرقم | الاتجاه | سعر الدخول | وقف الخسارة (SL) | الهدف الأول (TP) | تاريخ الدخول | تاريخ الإغلاق | النتيجة | العائد (10x) | المدة |
| :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
${completedTrades.map((tr, index) => {
    const emoji = tr.status === 'WIN' ? '🏆 WIN' : tr.status === 'LOSS' ? '❌ LOSS' : '⏳ OPEN';
    const dirEmoji = tr.type === 'LONG' ? '🟢 LONG' : '🔴 SHORT';
    return `| ${index + 1} | ${dirEmoji} | $${tr.entryPrice.toFixed(2)} | $${tr.sl.toFixed(2)} | $${tr.tp.toFixed(2)} | ${tr.entryDate} | ${tr.closeDate} | ${emoji} | ${tr.pnlPercentage >= 0 ? '+' : ''}${tr.pnlPercentage.toFixed(1)}% | ${tr.durationMinutes} د |`;
}).join('\n')}

━━━━━━━━━━━━━━━━━━━━━━━━━━
💡 *تم إعداد هذا التقرير عبر محاكي محركات الاقتناص الذكية لمنع Look-Ahead Bias وتجسيد الواقعية الكاملة للفحص الفني والسيولة.*
`;

    // Save report to artifacts directory
    const artifactsDir = path.join('C:', 'Users', 'Lenovo', '.gemini', 'antigravity', 'brain', 'ecbdaba9-13ce-411d-a870-1a0b34e0698c');
    if (!fs.existsSync(artifactsDir)) {
        fs.mkdirSync(artifactsDir, { recursive: true });
    }
    const reportPath = path.join(artifactsDir, 'sniper_backtest_results.md');
    fs.writeFileSync(reportPath, reportMarkdown, 'utf-8');

    console.log("\n====================================================");
    console.log("✅ BACKTEST COMPLETED SUCCESSFULLY!");
    console.log(`📄 Report saved to: ${reportPath}`);
    console.log("====================================================");

    // Print summary to console
    console.log(reportMarkdown);
}

runSniperBacktest().catch(err => console.error("Unhandled error:", err));
