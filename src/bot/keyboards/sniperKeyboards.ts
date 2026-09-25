import { SNIPER_ENGINE_LIST } from '../../services/sniper/SniperRegistry';
import { ISniperWatch } from '../../models/SniperWatch';

// ─── قائمة العملات المدعومة ─────────────────────────────────────────────────

export const POPULAR_PAIRS = [
    'BTC', 'ETH', 'SOL', 'BNB', 'XRP', 'DOGE', 'ADA', 'AVAX',
    'DOT', 'LINK', 'MATIC', 'LTC', 'UNI', 'ATOM', 'FIL',
    'APT', 'ARB', 'OP', 'INJ', 'SUI', 'LAB', 'XAUT', 'ZRO', 'B'
];

// ─── لوحة اختيار العملة للاقتناص ─────────────────────────────────────────────

export const getSniperSymbolKeyboard = (callbackPrefix: string = 'snp_sym', backCallback: string = 'snp_back_main') => {
    const rows = [];
    for (let i = 0; i < POPULAR_PAIRS.length; i += 4) {
        rows.push(
            POPULAR_PAIRS.slice(i, i + 4).map(sym => ({
                text: sym,
                callback_data: `${callbackPrefix}_${sym}`
            }))
        );
    }
    rows.push([{ text: '✏️ إدخال رمز يدوياً', callback_data: `${callbackPrefix}_manual` }]);
    rows.push([{ text: '🔙 رجوع', callback_data: backCallback }]);
    return { inline_keyboard: rows };
};

// ─── لوحة اختيار محرك الاقتناص ───────────────────────────────────────────────

export const getSniperEngineKeyboard = (symbol: string) => {
    const rows = SNIPER_ENGINE_LIST.map(e => ([{
        text: e.displayName,
        callback_data: `snp_eng_${e.id}_${symbol}`
    }]));
    rows.push([{ text: '🔙 رجوع', callback_data: 'snp_back_symbol' }]);
    return { inline_keyboard: rows };
};

// ─── لوحة اختيار محرك الاقتناص أولاً ───────────────────────────────────────────

export const getSniperEngineSelectionKeyboard = (actionType: 'instant' | 'add' | 'backtest') => {
    const rows = SNIPER_ENGINE_LIST.map(e => ([{
        text: e.displayName,
        callback_data: `snp_sel_eng_${actionType}_${e.id}`
    }]));
    rows.push([{ text: '🔙 رجوع للقائمة الرئيسية', callback_data: 'snp_open' }]);
    return { inline_keyboard: rows };
};

// ─── لوحة اختيار مدة الاقتناص ────────────────────────────────────────────────

export const getSniperDurationKeyboard = (engineId: string, symbol: string) => {
    return {
        inline_keyboard: [
            [
                { text: '1 ساعة', callback_data: `snp_dur_1_${engineId}_${symbol}` },
                { text: '2 ساعة', callback_data: `snp_dur_2_${engineId}_${symbol}` },
                { text: '4 ساعات', callback_data: `snp_dur_4_${engineId}_${symbol}` },
            ],
            [
                { text: '8 ساعات', callback_data: `snp_dur_8_${engineId}_${symbol}` },
                { text: '12 ساعة', callback_data: `snp_dur_12_${engineId}_${symbol}` },
                { text: '24 ساعة', callback_data: `snp_dur_24_${engineId}_${symbol}` },
            ],
            [{ text: '🔙 رجوع', callback_data: `snp_back_engine_${symbol}` }]
        ]
    };
};

// ─── لوحة الاقتناصات النشطة ──────────────────────────────────────────────────

export const getActiveWatchesKeyboard = (watches: ISniperWatch[]) => {
    if (watches.length === 0) {
        return {
            inline_keyboard: [
                [{ text: '➕ إضافة اقتناص جديد', callback_data: 'snp_add_new' }],
                [{ text: '🔙 رجوع', callback_data: 'snp_back_main' }]
            ]
        };
    }
    const rows = watches.map(w => {
        const expiresIn = Math.max(0, Math.round((w.expiresAt.getTime() - Date.now()) / 60000));
        const statusEmoji = w.status === 'TRIGGERED' ? '🚀' : '⏳';
        return [{
            text: `${statusEmoji} ${w.symbolShort} | ${w.engineId} | ينتهي: ${expiresIn}دق`,
            callback_data: `snp_view_${w._id}`
        }];
    });
    rows.push([{ text: '➕ إضافة اقتناص جديد', callback_data: 'snp_add_new' }]);
    rows.push([{ text: '🔙 رجوع', callback_data: 'snp_back_main' }]);
    return { inline_keyboard: rows };
};

// ─── لوحة تفاصيل اقتناص محدد ─────────────────────────────────────────────────

export const getWatchDetailKeyboard = (watchId: string) => {
    return {
        inline_keyboard: [
            [{ text: '📊 تقرير لحظي', callback_data: `snp_report_${watchId}` }],
            [{ text: '❌ إلغاء الاقتناص', callback_data: `snp_cancel_${watchId}` }],
            [{ text: '🔙 رجوع للقائمة', callback_data: 'snp_list' }]
        ]
    };
};

// ─── لوحة رسالة الإشعار الرئيسية ─────────────────────────────────────────────

export const getFireNotificationKeyboard = (watchId: string) => {
    return {
        inline_keyboard: [
            [
                { text: '⚡ تنفيذ الصفقة', callback_data: `snp_exec_${watchId}` },
                { text: '👁 تفعيل مراقبة الصفقة', callback_data: `snp_radar_${watchId}` }
            ],
            [{ text: '❌ إلغاء الاقتناص', callback_data: `snp_cancel_${watchId}` }]
        ]
    };
};

// ─── لوحة إعدادات الاقتناص ───────────────────────────────────────────────────

export const getSniperSettingsKeyboard = (autoExecute: boolean, notifyOnce: boolean) => {
    return {
        inline_keyboard: [
            [{
                text: `تنفيذ تلقائي: ${autoExecute ? '✅ مفعل' : '❌ معطل'}`,
                callback_data: 'snp_toggle_auto'
            }],
            [{
                text: `إشعار واحد فقط: ${notifyOnce ? '✅ نعم' : '❌ لا (كل تغيير)'}`,
                callback_data: 'snp_toggle_once'
            }],
            [{ text: '✅ حفظ وإغلاق', callback_data: 'snp_settings_save' }]
        ]
    };
};

// ─── لوحة القائمة الرئيسية للاقتناص ─────────────────────────────────────────

export const getSniperMainKeyboard = (activeCount: number) => {
    return {
        inline_keyboard: [
            [{ text: `📊 تقرير اقتناص لحظي`, callback_data: 'snp_instant' }],
            [{ text: `➕ إضافة اقتناص جديد`, callback_data: 'snp_add_new' }],
            [{ text: `📋 الاقتناصات النشطة (${activeCount})`, callback_data: 'snp_list' }],
            [{ text: `🧪 اختبار رجعي للمحرك (Backtest)`, callback_data: 'snp_backtest' }],
            [{ text: `⚙️ إعدادات الاقتناص`, callback_data: 'snp_settings' }],
            [{ text: '🔙 رجوع للقائمة الرئيسية', callback_data: 'snp_close' }]
        ]
    };
};

export const getSniperBacktestDaysKeyboard = (engineId: string, symbol: string) => {
    return {
        inline_keyboard: [
            [
                { text: 'يوم واحد', callback_data: `snp_bt_d_1_${engineId}_${symbol}` },
                { text: '3 أيام', callback_data: `snp_bt_d_3_${engineId}_${symbol}` }
            ],
            [
                { text: '5 أيام', callback_data: `snp_bt_d_5_${engineId}_${symbol}` },
                { text: '7 أيام', callback_data: `snp_bt_d_7_${engineId}_${symbol}` }
            ],
            [
                { text: '10 أيام', callback_data: `snp_bt_d_10_${engineId}_${symbol}` },
                { text: '15 يوم (Max)', callback_data: `snp_bt_d_15_${engineId}_${symbol}` }
            ],
            [{ text: '🔙 رجوع', callback_data: `snp_sel_eng_backtest_${engineId}` }]
        ]
    };
};
