import { PickerResult } from '../../core/picker/CurrencyPickerEngine';

// ─── دوال مساعدة ────────────────────────────────────────────────────────────

function getLabelEmoji(label: PickerResult['label']): string {
    if (label === 'READY') return '🟢';
    if (label === 'WATCH') return '🟡';
    return '🔴';
}

function formatTime(date: Date): string {
    return date.toLocaleTimeString('ar-SA', { hour: '2-digit', minute: '2-digit', hour12: false });
}

// ─── لوحة القائمة الرئيسية (مع نتائج) ──────────────────────────────────────

/**
 * يبني لوحة inline بأفضل 20 عملة
 * @param results - نتائج الفحص المرتبة
 * @param context - 'analysis' | 'sniper'
 * @param subContext - للتحليل: إصدار الخوارزمية (مثل 'V6') | للاقتناص: 'actionType_engineId'
 * @param lastScanTime - وقت آخر فحص
 */
export const getPickerListKeyboard = (
    results: PickerResult[],
    context: 'analysis' | 'sniper',
    subContext: string,
    lastScanTime: Date | null
) => {
    const rows: { text: string; callback_data: string }[][] = [];

    // عرض العملات في صفوف — كل صف يحتوي 2 عملة
    for (let i = 0; i < results.length; i += 2) {
        const row: { text: string; callback_data: string }[] = [];

        for (let j = i; j < Math.min(i + 2, results.length); j++) {
            const r = results[j];
            const emoji = getLabelEmoji(r.label);
            const btnText = `${r.shortName} ⭐${r.score} ${emoji}`;
            const cbData = `pkr_sel_${context}_${subContext}_${r.shortName}`;

            // Telegram callback_data max 64 chars
            if (cbData.length <= 64) {
                row.push({ text: btnText, callback_data: cbData });
            }
        }

        if (row.length > 0) rows.push(row);
    }

    // صف: تحديث + إدخال يدوي
    const timeText = lastScanTime ? `آخر فحص: ${formatTime(lastScanTime)}` : 'فحص الآن';
    rows.push([
        { text: `🔄 تحديث`, callback_data: `pkr_refresh_${context}_${subContext}` },
        { text: `✏️ إدخال يدوي`, callback_data: `pkr_manual_${context}_${subContext}` }
    ]);

    // صف: رجوع
    const backCb = context === 'analysis' ? 'back_algo_menu' : 'snp_open';
    rows.push([{ text: '🔙 رجوع', callback_data: backCb }]);

    return { inline_keyboard: rows };
};

// ─── لوحة "لم يتم الفحص بعد" ────────────────────────────────────────────────

export const getPickerNoDataKeyboard = (
    context: 'analysis' | 'sniper',
    subContext: string
) => {
    return {
        inline_keyboard: [
            [{ text: '🔍 فحص أفضل العملات الآن', callback_data: `pkr_scan_${context}_${subContext}` }],
            [{ text: '✏️ إدخال رمز يدوياً', callback_data: `pkr_manual_${context}_${subContext}` }],
            [{ text: '🔙 رجوع', callback_data: context === 'analysis' ? 'back_algo_menu' : 'snp_open' }]
        ]
    };
};

// ─── لوحة "جاري الفحص..." ────────────────────────────────────────────────────

export const getPickerScanningKeyboard = () => {
    return {
        inline_keyboard: [
            [{ text: '⏳ جاري فحص السوق... يرجى الانتظار', callback_data: 'pkr_noop' }]
        ]
    };
};

// ─── بناء نص رسالة القائمة ───────────────────────────────────────────────────

export const buildPickerMessageText = (
    results: PickerResult[],
    lastScanTime: Date | null,
    contextTitle: string
): string => {
    if (!results || results.length === 0) {
        return `🔍 *${contextTitle}*\n\n⚠️ لم يتم فحص السوق بعد.\nاضغط على زر الفحص لبدء تحليل العملات.`;
    }

    const timeStr = lastScanTime ? formatTime(lastScanTime) : '—';
    let msg = `📊 *${contextTitle}*\n`;
    msg += `🕐 آخر فحص: ${timeStr}\n`;
    msg += `━━━━━━━━━━━━━━━━━━━━━\n`;

    const top = results.slice(0, 20);
    top.forEach((r, i) => {
        const emoji = getLabelEmoji(r.label);
        const changeSign = r.change24h >= 0 ? '+' : '';
        msg += `${i + 1}. *${r.shortName}* ${emoji} ⭐${r.score} | ${r.trend} | ${changeSign}${r.change24h.toFixed(1)}%\n`;
    });

    msg += `━━━━━━━━━━━━━━━━━━━━━\n`;
    msg += `_اضغط على عملة للبدء، أو استخدم ✏️ للإدخال اليدوي_`;

    return msg;
};
