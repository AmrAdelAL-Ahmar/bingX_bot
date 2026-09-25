import logger from '../utils/logger';
import { GeminiService } from './GeminiService';
import { ITrade } from '../models/Trade';

export class PostTradeAdvisor {
    /**
     * Conducts automated AI post-mortem diagnosis on closed trade and returns telegram message
     */
    static async generateReport(trade: ITrade, exitPrice: number, exitReason: string): Promise<string> {
        const isLong = trade.direction === 'LONG';
        const pnlPct = trade.leverage > 0
            ? (isLong ? (exitPrice - trade.entryPrice) / trade.entryPrice : (trade.entryPrice - exitPrice) / trade.entryPrice) * 100 * trade.leverage
            : 0;

        const outcome: 'PROFIT' | 'LOSS' | 'BREAKEVEN' = pnlPct > 0.5 ? 'PROFIT' : pnlPct < -0.5 ? 'LOSS' : 'BREAKEVEN';

        logger.info(`[PostTradeAdvisor] Generating AI Post-Mortem for ${trade.symbol} (${outcome}, ${pnlPct.toFixed(2)}%)...`);

        const analysisText = await GeminiService.analyzeTradePostMortem({
            symbol: trade.symbol,
            direction: trade.direction,
            entryPrice: trade.entryPrice,
            exitPrice,
            pnlPercent: pnlPct,
            outcome,
            engineId: trade.engineId,
            exitReason
        });

        const icon = outcome === 'PROFIT' ? '🎉' : outcome === 'LOSS' ? '💔' : '⚖️';
        const formattedMsg = `
${icon} <b>تقرير المستشار الآلي لما بعد الصفقة (AI Post-Mortem)</b>
━━━━━━━━━━━━━━━━━━
📊 <b>الرمز:</b> ${trade.symbol} (${trade.direction})
📈 <b>سعر الدخول:</b> ${trade.entryPrice}
🏁 <b>سعر الخروج:</b> ${exitPrice}
💰 <b>النتيجة التقديرية:</b> ${pnlPct >= 0 ? '+' : ''}${pnlPct.toFixed(2)}%
🎯 <b>المحرك:</b> ${trade.engineId || 'Auto/Manual'}
📝 <b>سبب الإغلاق:</b> ${exitReason}
━━━━━━━━━━━━━━━━━━
🧠 <b>التحليل التشخيصي والتوصيات:</b>
${analysisText}
`;
        return formattedMsg;
    }
}
