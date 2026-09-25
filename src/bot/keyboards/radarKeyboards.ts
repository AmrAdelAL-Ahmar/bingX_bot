import { ITradeRadar } from '../../models/TradeRadar';
import { ITrade } from '../../models/Trade';

// ─── لوحة القائمة الرئيسية للرادار ───────────────────────────────────────────

export const getRadarMainKeyboard = (activeTrades: ITrade[], activeRadars: string[]) => {
    if (activeTrades.length === 0) {
        return {
            inline_keyboard: [
                [{ text: '📭 لا توجد صفقات مفتوحة حالياً', callback_data: 'radar_noop' }],
                [{ text: '⚙️ إعدادات المراقبة الافتراضية', callback_data: 'radar_default_settings' }],
                [{ text: '🔙 إغلاق', callback_data: 'radar_close' }]
            ]
        };
    }

    const tradeRows = activeTrades.map(trade => {
        const isMonitored = activeRadars.includes(trade._id.toString());
        const statusEmoji = isMonitored ? '📡' : '⭕';
        const sym = trade.symbol.split('/')[0];
        const dirEmoji = trade.direction === 'LONG' ? '🟢' : '🔴';
        return [{
            text: `${statusEmoji} ${dirEmoji} ${sym} ${isMonitored ? '(مراقب)' : '(غير مراقب)'}`,
            callback_data: `radar_trade_${trade._id}`
        }];
    });

    return {
        inline_keyboard: [
            ...tradeRows,
            [{ text: '⚙️ إعدادات المراقبة الافتراضية', callback_data: 'radar_default_settings' }],
            [{ text: '🔙 إغلاق', callback_data: 'radar_close' }]
        ]
    };
};

// ─── لوحة تفاصيل صفقة محددة ──────────────────────────────────────────────────

export const getTradeRadarDetailKeyboard = (tradeId: string, isMonitored: boolean) => {
    if (isMonitored) {
        return {
            inline_keyboard: [
                [{ text: '⚙️ إعدادات مراقبة هذه الصفقة', callback_data: `radar_settings_${tradeId}` }],
                [{ text: '🛑 إيقاف مراقبة هذه الصفقة', callback_data: `radar_disable_${tradeId}` }],
                [{ text: '🔙 رجوع', callback_data: 'radar_main' }]
            ]
        };
    }
    return {
        inline_keyboard: [
            [{ text: '📡 تفعيل مراقبة هذه الصفقة', callback_data: `radar_enable_${tradeId}` }],
            [{ text: '🔙 رجوع', callback_data: 'radar_main' }]
        ]
    };
};

// ─── لوحة إعدادات مراقبة صفقة محددة ─────────────────────────────────────────

export const getRadarSettingsKeyboard = (tradeId: string, settings: ITradeRadar['settings']) => {
    return {
        inline_keyboard: [
            [{
                text: `كشف ذيل الاختراق (Wick Sweep): ${settings.wickSweepAlert ? '✅' : '❌'}`,
                callback_data: `radar_tog_wick_${tradeId}`
            }],
            [{
                text: `تنبيه الانعكاس (CHoCH): ${settings.reversalAlert ? '✅' : '❌'}`,
                callback_data: `radar_tog_reversal_${tradeId}`
            }],
            [{
                text: `Trailing Stop تلقائي: ${settings.trailingEnabled ? '✅' : '❌'}`,
                callback_data: `radar_tog_trailing_${tradeId}`
            }],
            [{
                text: `تنبيه واحد لكل حدث: ${settings.notifyOnce ? '✅' : '❌'}`,
                callback_data: `radar_tog_once_${tradeId}`
            }],
            [
                { text: '✅ حفظ وإغلاق', callback_data: `radar_save_${tradeId}` },
                { text: '🔙 رجوع', callback_data: `radar_trade_${tradeId}` }
            ]
        ]
    };
};

// ─── لوحة إشعار Wick Sweep ────────────────────────────────────────────────────

export const getWickSweepNotifKeyboard = (tradeId: string) => {
    return {
        inline_keyboard: [
            [{ text: '📊 تقرير سريع للصفقة', callback_data: `radar_quick_${tradeId}` }],
            [{ text: '⚙️ إعدادات المراقبة', callback_data: `radar_settings_${tradeId}` }]
        ]
    };
};

// ─── لوحة إشعار خطر الانعكاس ─────────────────────────────────────────────────

export const getReversalNotifKeyboard = (tradeId: string) => {
    return {
        inline_keyboard: [
            [
                { text: '🔒 نقل SL لـ Break-Even', callback_data: `radar_be_${tradeId}` },
                { text: '📊 تقرير سريع', callback_data: `radar_quick_${tradeId}` }
            ]
        ]
    };
};

// ─── لوحة إعدادات المراقبة الافتراضية ──────────────────────────────────────────
export const getRadarDefaultSettingsKeyboard = (settings: {
    wickSweepAlert: boolean;
    reversalAlert: boolean;
    trailingEnabled: boolean;
    notifyOnce: boolean;
}) => {
    return {
        inline_keyboard: [
            [{
                text: `كشف ذيل الاختراق (Wick Sweep): ${settings.wickSweepAlert ? '✅' : '❌'}`,
                callback_data: 'radar_def_tog_wick'
            }],
            [{
                text: `تنبيه الانعكاس (CHoCH): ${settings.reversalAlert ? '✅' : '❌'}`,
                callback_data: 'radar_def_tog_reversal'
            }],
            [{
                text: `Trailing Stop تلقائي: ${settings.trailingEnabled ? '✅' : '❌'}`,
                callback_data: 'radar_def_tog_trailing'
            }],
            [{
                text: `تنبيه واحد لكل حدث: ${settings.notifyOnce ? '✅' : '❌'}`,
                callback_data: 'radar_def_tog_once'
            }],
            [
                { text: '✅ حفظ وإغلاق', callback_data: 'radar_def_save' }
            ]
        ]
    };
};
