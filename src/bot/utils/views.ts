// --- HELPER: GENERATE COMPREHENSIVE REPORT ---
export const generateReportStr = (trades: any[], title: string, currentBalance: number) => {
    if (trades.length === 0) return `لا يوجد صفقات مغلقة لـ ${title} 📭`;

    let totalWins = 0;
    let totalLosses = 0;
    let netPnlUsdt = 0;
    let tradesDetails = '';

    trades.forEach((t, index) => {
        const margin = t.amount / (t.leverage || 10);
        const pnlPercent = t.pnl || 0;
        const pnlUsdt = margin * (pnlPercent / 100);

        netPnlUsdt += pnlUsdt;
        if (pnlUsdt > 0) totalWins++;
        else totalLosses++;

        // Derive approximate exit price based on realized PnL%
        const priceDiff = Math.abs((pnlPercent / 100 / (t.leverage || 10)) * t.entryPrice);
        const exitPrice = pnlPercent >= 0
            ? (t.direction === 'LONG' ? t.entryPrice + priceDiff : t.entryPrice - priceDiff)
            : (t.direction === 'LONG' ? t.entryPrice - priceDiff : t.entryPrice + priceDiff);

        tradesDetails += `\n${index + 1}. <b>${t.symbol}</b> (${t.direction})\n` +
            `الدخول: ${t.entryPrice.toFixed(4)} ➡️ الإغلاق: ${exitPrice.toFixed(4)}\n` +
            `المبلغ (Margin): ${margin.toFixed(2)} USDT\n` +
            `النتيجة: ${pnlUsdt >= 0 ? '🟢' : '🔴'} ${pnlUsdt.toFixed(2)} USDT (${pnlPercent.toFixed(2)}%)\n`;
    });

    const winRate = ((totalWins / trades.length) * 100).toFixed(2);
    // Approximate starting balance (assuming no deposits/withdrawals since then)
    const balanceStart = currentBalance - netPnlUsdt;
    const growthPercent = balanceStart > 0 ? (netPnlUsdt / balanceStart) * 100 : 0;

    let msg = `📊 <b>${title}</b>\n\n` +
        `✅ إجمالي الصفقات: ${trades.length}\n` +
        `🏆 ربح: ${totalWins} | 💀 خسارة: ${totalLosses}\n` +
        `📈 معدل النجاح: ${winRate}%\n\n`;

    msg += `<b>💵 تفاصيل الأرباح والمحفظة:</b>\n` +
        `💰 إجمالي مبلغ الربح/الخسارة: ${netPnlUsdt >= 0 ? '🟢' : '🔴'} <b>${netPnlUsdt.toFixed(2)} USDT</b>\n` +
        (balanceStart > 0 ? `💵 رأس المال قبل: ~${balanceStart.toFixed(2)} USDT\n` : '') +
        `🏦 إجمالي المحفظة الحالي: ${currentBalance.toFixed(2)} USDT\n` +
        `🚀 نسبة ${netPnlUsdt >= 0 ? 'الارتفاع' : 'الهبوط'}: ${netPnlUsdt >= 0 ? '🟢' : '🔴'} ${growthPercent.toFixed(2)}%\n\n`;

    msg += `<b>📋 تفاصيل الصفقات:</b>` + tradesDetails;
    return msg;
};
