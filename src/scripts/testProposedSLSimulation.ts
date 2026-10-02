import dotenv from 'dotenv';
dotenv.config();
import mongoose from 'mongoose';
import Trade from '../models/Trade';
import { BingXService } from '../services/BingXService';

async function main() {
    await mongoose.connect(process.env.MONGODB_URI || '');
    const bingx = new BingXService();

    // Fetch closed paper trades
    const trades = await Trade.find({
        isPaperTrade: true,
        currentStatus: { $regex: /^CLOSED/ }
    }).sort({ entryTime: -1 }).lean();

    console.log(`Loaded ${trades.length} trades.`);

    const bannedNames = ['V10', 'V9', 'V12', 'V13', 'V16', 'V17', 'V18', 'V4', 'V5', 'V6', 'V2'];
    const bannedSet = new Set(bannedNames.map(s => s.toUpperCase()));

    // Filter 1: Primary engineId not in banned list
    const primaryFiltered = trades.filter(t => !bannedSet.has((t.engineId || '').toUpperCase()));

    // Filter 2: Participating engines not containing ANY banned engine
    const participatingFiltered = trades.filter(t => {
        const match = (t.aiJustification || '').match(/المحركات:\s*([^)]+)/);
        let list: string[] = [];
        if (match) {
            list = match[1].split(',').map(s => s.trim().toUpperCase());
        } else if (t.engineId) {
            list = [t.engineId.toUpperCase()];
        }
        return !list.some(e => bannedSet.has(e));
    });

    console.log(`\n======================================================`);
    console.log(`FILTER SCENARIOS: Banning [${bannedNames.join(', ')}]`);
    console.log(`======================================================`);
    console.log(`Original All Trades: ${trades.length}`);
    console.log(`Scenario A (Primary Trigger Engine Banned): ${primaryFiltered.length} trades`);
    console.log(`Scenario B (Any Participating Engine Banned): ${participatingFiltered.length} trades`);

    // Let's examine Scenario A in detail
    const aWins = primaryFiltered.filter(t => (t.realizedPnl || 0) > 0);
    const aLosses = primaryFiltered.filter(t => (t.realizedPnl || 0) <= 0);
    const aBe = aLosses.filter(t => Math.abs(t.realizedPnl || 0) < 0.25);
    const aFullLoss = aLosses.filter(t => (t.realizedPnl || 0) <= -0.25);
    const aWinPnl = aWins.reduce((acc, t) => acc + (t.realizedPnl || 0), 0);
    const aLossPnl = aLosses.reduce((acc, t) => acc + (t.realizedPnl || 0), 0);

    console.log(`\n--- SCENARIO A: FILTER BY PRIMARY ENGINE (Remaining: ${primaryFiltered.length}) ---`);
    console.log(`Wins: ${aWins.length} (${((aWins.length / primaryFiltered.length) * 100).toFixed(1)}%) | Win Total: +$${aWinPnl.toFixed(2)}`);
    console.log(`Losses: ${aLosses.length} (${((aLosses.length / primaryFiltered.length) * 100).toFixed(1)}%) | Loss Total: -$${Math.abs(aLossPnl).toFixed(2)}`);
    console.log(`  - Rescued by Break-Even: ${aBe.length} trades (Fees: -$${Math.abs(aBe.reduce((acc, t) => acc + (t.realizedPnl || 0), 0)).toFixed(2)})`);
    console.log(`  - Full Stop-Loss Hits: ${aFullLoss.length} trades (Total: -$${Math.abs(aFullLoss.reduce((acc, t) => acc + (t.realizedPnl || 0), 0)).toFixed(2)})`);
    console.log(`Net Realized PnL: ${(aWinPnl + aLossPnl) >= 0 ? '+' : ''}$${(aWinPnl + aLossPnl).toFixed(2)} USDT`);
    console.log(`Profit Factor: ${(aWinPnl / Math.abs(aLossPnl)).toFixed(2)}`);

    // Let's examine Scenario B in detail
    const bWins = participatingFiltered.filter(t => (t.realizedPnl || 0) > 0);
    const bLosses = participatingFiltered.filter(t => (t.realizedPnl || 0) <= 0);
    const bBe = bLosses.filter(t => Math.abs(t.realizedPnl || 0) < 0.25);
    const bFullLoss = bLosses.filter(t => (t.realizedPnl || 0) <= -0.25);
    const bWinPnl = bWins.reduce((acc, t) => acc + (t.realizedPnl || 0), 0);
    const bLossPnl = bLosses.reduce((acc, t) => acc + (t.realizedPnl || 0), 0);

    console.log(`\n--- SCENARIO B: STRICT PARTICIPATING ENGINES FILTER (Remaining: ${participatingFiltered.length}) ---`);
    console.log(`Wins: ${bWins.length} (${((bWins.length / participatingFiltered.length) * 100).toFixed(1)}%) | Win Total: +$${bWinPnl.toFixed(2)}`);
    console.log(`Losses: ${bLosses.length} (${((bLosses.length / participatingFiltered.length) * 100).toFixed(1)}%) | Loss Total: -$${Math.abs(bLossPnl).toFixed(2)}`);
    console.log(`  - Rescued by Break-Even: ${bBe.length} trades`);
    console.log(`  - Full Stop-Loss Hits: ${bFullLoss.length} trades`);
    console.log(`Net Realized PnL: ${(bWinPnl + bLossPnl) >= 0 ? '+' : ''}$${(bWinPnl + bLossPnl).toFixed(2)} USDT`);
    console.log(`Profit Factor: ${(bWinPnl / Math.abs(bLossPnl)).toFixed(2)}`);

    // Let's now evaluate: What if Stop Loss was at the proposed structural/ATR level (1.8% - 2.0%)?
    // Let's test on the full losses of Scenario A and B to see how many were stopped out prematurely by the 0.94% clamp
    // and what the proposed SL from Gemini/Engine actually was!
    console.log(`\n--- PROPOSED STOP LOSS (AI & STRUCTURAL) VS 0.94% CLAMP ---`);
    let aiSlRecoveredPotential = 0;
    let prematureStopOutCount = 0;

    for (const t of aFullLoss) {
        const matchSl = t.aiJustification?.match(/وقف الخسارة عند \$?([0-9.]+)/);
        const actualSlDist = (Math.abs(t.exitPrice! - t.entryPrice) / t.entryPrice) * 100;
        if (actualSlDist <= 1.05) {
            prematureStopOutCount++;
        }
        if (matchSl) {
            const proposedSl = parseFloat(matchSl[1]);
            const proposedSlDist = (Math.abs(proposedSl - t.entryPrice) / t.entryPrice) * 100;
            // If proposed SL was wider than 1.2% (e.g. 1.5% - 2.5%)
            if (proposedSlDist > 1.2) {
                aiSlRecoveredPotential++;
            }
        }
    }

    console.log(`Total Full Losses in Scenario A: ${aFullLoss.length}`);
    console.log(`Trades stopped out by tight clamp (<= 1.05% distance): ${prematureStopOutCount} (${((prematureStopOutCount/aFullLoss.length)*100).toFixed(1)}%)`);
    console.log(`Trades where AI/Structural proposed SL was wider (> 1.2% distance): ${aiSlRecoveredPotential}`);

    // If those premature stop-outs (e.g. 50% or 60% of them) had breathing room to hit TP or BE:
    // Let's calculate the projected results!
    console.log(`\n--- SIMULATION: IMPACT OF PROPOSED STOP LOSS (Adaptive ATR 1.8%) ---`);
    console.log(`If 50% of the tightly stopped-out trades reached BE or TP:`);
    const recoveredTrades = Math.round(prematureStopOutCount * 0.5);
    const simulatedLossCount = aLosses.length - recoveredTrades;
    const simulatedWinCount = aWins.length + Math.round(recoveredTrades * 0.6); // 60% to win, 40% to BE
    const simulatedWinRate = ((simulatedWinCount / primaryFiltered.length) * 100).toFixed(1);
    const avgWinValue = aWinPnl / aWins.length;
    const avgLossValue = aLossPnl / aLosses.length;
    const simulatedWinPnl = simulatedWinCount * avgWinValue;
    const simulatedLossPnl = simulatedLossCount * avgLossValue;
    const simulatedNet = simulatedWinPnl + simulatedLossPnl;

    console.log(`- Simulated Wins: ${simulatedWinCount} (${simulatedWinRate}%)`);
    console.log(`- Simulated Losses: ${simulatedLossCount}`);
    console.log(`- Projected Net PnL: ${simulatedNet >= 0 ? '+' : ''}$${simulatedNet.toFixed(2)} USDT`);

    await mongoose.disconnect();
}

main().catch(console.error);
