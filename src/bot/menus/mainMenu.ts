import { InlineKeyboardMarkup } from 'telegraf/types';

/**
 * يولّد واجهة لوحة التحكم الرئيسية التفاعلية بالكامل (Inline Control Panel)
 * بتصميم فاخر يعطي طابع التطبيقات الاحترافية المتكاملة.
 */
export const getMainMenuInlineKeyboard = (activeTradesCount: number, activeWatchesCount: number): InlineKeyboardMarkup => {
    return {
        inline_keyboard: [
            [
                { text: '🚀 منظومة التداول الذاتي V2 (Auto)', callback_data: 'menu_autonomous' },
                { text: '🎮 المحفظة الافتراضية (Paper)', callback_data: 'aut_view_paper_stats' }
            ],
            [
                { text: '💰 رصيدي ومحفظتي', callback_data: 'menu_balance' },
                { text: `💼 صفقاتي المفتوحة (${activeTradesCount})`, callback_data: 'menu_positions' }
            ],
            [
                { text: '📡 رادار الصفقات الحية', callback_data: 'menu_radar' },
                { text: `🎯 قناص الحيتان V10/V11 (${activeWatchesCount})`, callback_data: 'menu_sniper' }
            ],
            [
                { text: '⚙️ إعدادات المتداول', callback_data: 'menu_settings' },
                { text: '🧪 اختبار استراتيجيات (Backtest)', callback_data: 'menu_backtest' }
            ],
            [
                { text: '📊 التقارير المالية', callback_data: 'menu_reports' },
                { text: 'ℹ️ دليل الاستخدام والمساعدة', callback_data: 'menu_help' }
            ],
            [
                { text: '🚨 إغلاق جميع الصفقات فوراً', callback_data: 'menu_panic_close' }
            ]
        ]
    };
};

/**
 * يولّد نص الترحيب الفاخر للقائمة الرئيسية بالتنسيق العربي الفخم
 */
export const getMainMenuText = (username: string, balance: number, activeTrades: number, totalPnl: number): string => {
    const pnlEmoji = totalPnl >= 0 ? '🟢' : '🔴';
    const statusEmoji = activeTrades > 0 ? '⚡' : '💤';
    
    return `🏛️ <b>لوحة التحكم الرئيسية | Sniper V10/V11 Bot</b>\n\n` +
        `مرحباً بك يا <b>${username || 'المتداول'}</b> في منصتك الذكية لإدارة التداول الآلي وقنص السيولة على منصة BingX.\n\n` +
        `📊 <b>الحالة اللحظية للحساب:</b>\n` +
        `• رصيد الحساب المتاح: <b>${balance.toFixed(2)} USDT</b>\n` +
        `• حالة البوت الحالية: <b>${statusEmoji} نشط ويعمل بالخلفية</b>\n` +
        `• الصفقات المفتوحة: <b>${activeTrades} صفقات نشطة</b>\n` +
        `• الأرباح العائمة: ${pnlEmoji} <b>${totalPnl.toFixed(2)} USDT</b>\n\n` +
        `🚀 <i>اختر أحد الإجراءات من اللوحة التفاعلية أدناه لبدء التحكم:</i>`;
};
