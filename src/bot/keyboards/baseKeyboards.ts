import { BinanceService } from '../../services/BinanceService';

// --- HELPER: GET MAIN MENU KEYBOARD ---
export const getMainMenuKeyboard = (user: any) => {
    const riskStatus = (user.enforceMaxSlLoss !== null && user.enforceMaxSlLoss !== undefined)
        ? user.enforceMaxSlLoss
        : process.env.ENFORCE_MAX_SL_LOSS === 'true';
    const riskIcon = riskStatus ? '🟢 مفعل' : '🔴 معطل';

    return {
        keyboard: [
            [
                { text: '💰 رصيدي وملخص الأرباح' },
                { text: '💼 صفقاتي المفتوحة' }
            ],
            [
                { text: '📊 التقارير' },
                { text: '⚙️ إعدادات التنبيهات' }
            ],
            [
                { text: '🔍 الاستعلام عن صفقة محددة' },
                { text: '❌ إلغاء صفقة محددة' }
            ],
            [
                { text: '🛑 إلغاء كل الصفقات المفتوحة' }
            ],
            [
                { text: `🛡 حماية رأس المال (6% SL): ${riskIcon}` }
            ],
            [
                { text: 'ℹ️ تعليمات الاستخدام (Help)' }
            ]
        ],
        resize_keyboard: true,
        is_persistent: true
    };
};

export const getReportsKeyboard = () => ({
    keyboard: [
        [{ text: '📊 تقرير يومي' }, { text: '📅 تقرير شهري' }],
        [{ text: '📆 تقرير سنوي' }, { text: '📈 تقرير شامل' }],
        [{ text: '🗓 تقرير مخصص (تاريخ)' }],
        [{ text: 'رجوع 🔙' }]
    ],
    resize_keyboard: true,
    is_persistent: true
});

export const ALL_TP_THRESHOLDS = [30, 40, 50, 60, 70, 80, 90, 95];

export const buildAlertSettingsKeyboard = (user: any) => {
    const slOn: boolean = user.slWarningEnabled !== false;
    const tpOn: boolean = user.tpWarningEnabled !== false;
    const thresholds: number[] = user.tpWarningThresholds || [70, 90];

    // Row 1: Toggle SL & TP Warnings
    const row1 = [
        { text: `${slOn ? '✅' : '❌'} تنبيه SL`, callback_data: 'alert_toggle_sl' },
        { text: `${tpOn ? '✅' : '❌'} تنبيه TP`, callback_data: 'alert_toggle_tp' }
    ];

    // TP Threshold rows (2 per row)
    const thresholdRows = [];
    for (let i = 0; i < ALL_TP_THRESHOLDS.length; i += 4) {
        const row = ALL_TP_THRESHOLDS.slice(i, i + 4).map(t => ({
            text: `${thresholds.includes(t) ? '✅' : '⬜'} ${t}%`,
            callback_data: `alert_tp_${t}`
        }));
        thresholdRows.push(row);
    }

    return {
        inline_keyboard: [
            row1,
            ...thresholdRows,
            [{ text: '✅ تحديد الكل', callback_data: 'alert_tp_all' }, { text: '❌ إلغاء الكل', callback_data: 'alert_tp_none' }]
        ]
    };
};

// --- HELPER TO GET ACTIVE SYMBOLS KEYBOARD ---
export const getDynamicSymbolsKeyboard = async (binanceService: BinanceService) => {
    const positions = await binanceService.getPositions();
    let keys: { text: string }[][] = [];
    if (positions && positions.length > 0) {
        for (const pos of positions) {
            if (parseFloat(pos.contracts) > 0) {
                const parts = pos.symbol.split('/');
                const shortSym = parts[0] || pos.symbol; // Usually BTC
                keys.push([{ text: shortSym }]);
            }
        }
    }
    keys.push([{ text: 'رجوع 🔙' }]);
    return keys;
};
