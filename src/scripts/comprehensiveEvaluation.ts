import dotenv from 'dotenv';
dotenv.config();
import mongoose from 'mongoose';
import Trade from '../models/Trade';
import { TradingMemoryService } from '../services/TradingMemoryService';

async function main() {
    await mongoose.connect(process.env.MONGODB_URI || '');

    const allPaper = await Trade.find({ isPaperTrade: true }).sort({ entryTime: -1 }).lean();
    const openTrades = allPaper.filter(t => ['OPEN', 'TP1_HIT', 'TP2_HIT'].includes(t.currentStatus));
    const closedTrades = allPaper.filter(t => t.currentStatus?.startsWith('CLOSED'));

    const wins = closedTrades.filter(t => (t.realizedPnl || 0) > 0);
    const losses = closedTrades.filter(t => (t.realizedPnl || 0) <= 0);
    const breakEvens = losses.filter(t => Math.abs(t.realizedPnl || 0) < 0.25);
    const fullLosses = losses.filter(t => (t.realizedPnl || 0) <= -0.25);

    const totalWinPnL = wins.reduce((acc, t) => acc + (t.realizedPnl || 0), 0);
    const totalLossPnL = losses.reduce((acc, t) => acc + (t.realizedPnl || 0), 0);
    const fullLossPnL = fullLosses.reduce((acc, t) => acc + (t.realizedPnl || 0), 0);
    const breakEvenFees = breakEvens.reduce((acc, t) => acc + (t.realizedPnl || 0), 0);
    const netPnL = totalWinPnL + totalLossPnL;
    const winRate = closedTrades.length > 0 ? (wins.length / closedTrades.length) * 100 : 0;
    const profitFactor = Math.abs(totalLossPnL) > 0 ? (totalWinPnL / Math.abs(totalLossPnL)).toFixed(2) : 'N/A';

    console.log('=== OVERALL PAPER TRADING METRICS ===');
    console.log(`Total Trades Recorded: ${allPaper.length}`);
    console.log(`Currently Open Trades: ${openTrades.length}`);
    console.log(`Closed Trades: ${closedTrades.length}`);
    console.log(`Wins: ${wins.length} (${winRate.toFixed(1)}%) | Win Total: +$${totalWinPnL.toFixed(2)}`);
    console.log(`Losses: ${losses.length} | Loss Total: -$${Math.abs(totalLossPnL).toFixed(2)}`);
    console.log(`  - Break-Even Exits (Saved by Protection): ${breakEvens.length} (Fees: -$${Math.abs(breakEvenFees).toFixed(2)})`);
    console.log(`  - Real Full SL Losses: ${fullLosses.length} (Total Loss: -$${Math.abs(fullLossPnL).toFixed(2)})`);
    console.log(`Net Realized PnL: ${netPnL >= 0 ? '+' : ''}$${netPnL.toFixed(2)}`);
    console.log(`Profit Factor: ${profitFactor}`);

    console.log('\n=== CURRENT OPEN TRADES ===');
    openTrades.forEach((t, i) => {
        console.log(`#${i+1} [${t.symbol} ${t.direction}] Entry: ${t.entryPrice} | SL: ${t.stopLoss} | Leverage: ${t.leverage}x | EntryTime: ${t.entryTime}`);
    });

    console.log('\n=== ENGINE PERFORMANCE BREAKDOWN ===');
    const knownEngines = ['V1', 'V2', 'V3', 'V5', 'V6', 'V7', 'V8', 'V10', 'V11', 'V13', 'V16', 'V17', 'V18', 'HARMONIC', 'WHALE_SURGE'];
    for (const eng of knownEngines) {
        const engTrades = closedTrades.filter(t => {
            const text = `${t.aiJustification || ''} ${t.engineId || ''} ${t.logs ? t.logs.join(' ') : ''}`;
            return new RegExp(`\\b${eng}\\b`, 'i').test(text);
        });
        if (engTrades.length > 0) {
            const engWins = engTrades.filter(t => (t.realizedPnl || 0) > 0).length;
            const engLosses = engTrades.length - engWins;
            const engPnl = engTrades.reduce((acc, t) => acc + (t.realizedPnl || 0), 0);
            const rate = ((engWins / engTrades.length) * 100).toFixed(1);
            console.log(`- Engine [${eng.padEnd(11)}]: ${engTrades.length} trades | Wins: ${engWins} (${rate}%) | PnL: ${engPnl >= 0 ? '+' : ''}${engPnl.toFixed(2)} USDT`);
        }
    }

    console.log('\n=== FULL REAL LOSSES BREAKDOWN ===');
    fullLosses.forEach((t, i) => {
        console.log(`Loss #${i+1}: [${t.symbol} ${t.direction}] PnL: ${t.realizedPnl?.toFixed(2)} USDT | Lev: ${t.leverage}x | Entry: ${t.entryPrice} -> Exit: ${t.exitPrice}`);
        console.log(`  SL Distance: ${(Math.abs((t.entryPrice - t.stopLoss) / t.entryPrice) * 100).toFixed(2)}% | Date: ${t.entryTime}`);
        console.log(`  Reason/Justification: ${t.aiJustification?.substring(0, 100)}...`);
    });

    await mongoose.disconnect();
}

main().catch(console.error);
