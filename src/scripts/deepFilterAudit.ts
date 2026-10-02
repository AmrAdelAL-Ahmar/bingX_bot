import dotenv from 'dotenv';
dotenv.config();
import mongoose from 'mongoose';
import Trade from '../models/Trade';

async function main() {
    await mongoose.connect(process.env.MONGODB_URI || '');

    const trades = await Trade.find({ 
        isPaperTrade: true,
        currentStatus: { $regex: /^CLOSED/ }
    }).sort({ entryTime: -1 }).lean();

    console.log(`Total closed paper trades: ${trades.length}`);

    // Check how engines are recorded: engineId vs engines mentioned in "(المحركات: ...)"
    const bannedNames = ['V10', 'V9', 'V12', 'V13', 'V16', 'V17', 'V18', 'V4', 'V5', 'V6', 'V2'];
    const bannedSet = new Set(bannedNames.map(s => s.toUpperCase()));

    let countByEngineId = 0;
    let countByParticipating = 0;
    let countByAnywhereInJustification = 0;

    const participatingAllowed: any[] = [];
    const primaryAllowed: any[] = [];

    for (const t of trades) {
        const engId = (t.engineId || '').toUpperCase();
        const isBannedPrimary = bannedSet.has(engId);
        if (!isBannedPrimary) {
            primaryAllowed.push(t);
        } else {
            countByEngineId++;
        }

        // Extract "(المحركات: ...)"
        const match = (t.aiJustification || '').match(/المحركات:\s*([^)]+)/);
        let participatingEngines: string[] = [];
        if (match) {
            participatingEngines = match[1].split(',').map(s => s.trim().toUpperCase());
        } else if (t.engineId) {
            participatingEngines = [t.engineId.toUpperCase()];
        }

        const hasBannedInParticipating = participatingEngines.some(e => bannedSet.has(e));
        if (hasBannedInParticipating) {
            countByParticipating++;
        } else {
            participatingAllowed.push(t);
        }

        const hasBannedAnywhere = bannedNames.some(b => new RegExp(`\\b${b}\\b`, 'i').test(t.aiJustification || ''));
        if (hasBannedAnywhere) {
            countByAnywhereInJustification++;
        }
    }

    console.log('\n--- ENGINE BAN COUNTS ---');
    console.log(`Banned list: ${bannedNames.join(', ')}`);
    console.log(`1. By primary engineId: ${countByEngineId} banned, ${primaryAllowed.length} allowed`);
    console.log(`2. By participating engines in "(المحركات: ...)": ${countByParticipating} banned, ${participatingAllowed.length} allowed`);
    console.log(`3. By any mention anywhere in text: ${countByAnywhereInJustification} banned, ${trades.length - countByAnywhereInJustification} allowed`);

    // Let's inspect the results for primaryAllowed
    function summarize(list: any[], label: string) {
        const wins = list.filter(t => (t.realizedPnl || 0) > 0);
        const losses = list.filter(t => (t.realizedPnl || 0) <= 0);
        const bes = losses.filter(t => Math.abs(t.realizedPnl || 0) < 0.25);
        const fullSL = losses.filter(t => (t.realizedPnl || 0) <= -0.25);
        const winPnl = wins.reduce((acc, t) => acc + (t.realizedPnl || 0), 0);
        const lossPnl = losses.reduce((acc, t) => acc + (t.realizedPnl || 0), 0);
        const net = winPnl + lossPnl;
        console.log(`\n=== Summary for: ${label} (${list.length} trades) ===`);
        console.log(`Wins: ${wins.length} (${((wins.length / Math.max(list.length, 1)) * 100).toFixed(1)}%) | +$${winPnl.toFixed(2)} USDT`);
        console.log(`Losses: ${losses.length} (${((losses.length / Math.max(list.length, 1)) * 100).toFixed(1)}%) | -$${Math.abs(lossPnl).toFixed(2)} USDT`);
        console.log(`  - Auto Break-Even: ${bes.length} trades`);
        console.log(`  - Full Stop-Loss: ${fullSL.length} trades`);
        console.log(`Net PnL: ${net >= 0 ? '+' : ''}$${net.toFixed(2)} USDT`);
        if (Math.abs(lossPnl) > 0) {
            console.log(`Profit Factor: ${(winPnl / Math.abs(lossPnl)).toFixed(2)}`);
        }
    }

    summarize(primaryAllowed, 'PRIMARY ENGINE FILTER (engineId not in banned list)');
    summarize(participatingAllowed, 'PARTICIPATING ENGINES FILTER (no banned engine in list)');

    // Now let's inspect the Stop Loss in the full losses
    console.log('\n--- STOP LOSS INVESTIGATION ---');
    const fullLosses = trades.filter(t => (t.realizedPnl || 0) <= -0.25);
    console.log(`Total Full Losses across all 596 trades: ${fullLosses.length}`);

    // Let's see what the initial SL distance was from entryPrice and logs
    let slDistances: number[] = [];
    let suggestedSLMentions = 0;
    for (const t of fullLosses) {
        // Check logs for initial SL or calculate from entryPrice and exitPrice
        const lossPct = Math.abs((t.exitPrice! - t.entryPrice) / t.entryPrice) * 100;
        slDistances.push(lossPct);

        // Check if aiJustification mentions suggested SL
        if (t.aiJustification?.includes('وقف الخسارة')) {
            suggestedSLMentions++;
        }
    }

    const avgLossPct = slDistances.reduce((a, b) => a + b, 0) / slDistances.length;
    console.log(`Average loss distance on Full SL hits: ${avgLossPct.toFixed(2)}%`);
    console.log(`Full losses with SL mentioned in aiJustification: ${suggestedSLMentions}`);

    // Print 5 examples of full losses with aiJustification SL vs exitPrice
    console.log('\nSample Full Loss details:');
    for (let i = 0; i < Math.min(5, fullLosses.length); i++) {
        const t = fullLosses[i];
        const matchSl = t.aiJustification?.match(/وقف الخسارة عند \$?([0-9.]+)/);
        const suggestedSlVal = matchSl ? matchSl[1] : 'N/A';
        const lossDist = ((Math.abs(t.exitPrice! - t.entryPrice) / t.entryPrice) * 100).toFixed(2);
        console.log(`#${i+1} [${t.symbol} ${t.direction}] Entry: ${t.entryPrice} | Exit: ${t.exitPrice} (${lossDist}%) | AI SL: ${suggestedSlVal} | Final DB SL: ${t.stopLoss}`);
    }

    await mongoose.disconnect();
}

main().catch(console.error);
