import { BinanceService } from '../../services/BinanceService';

// --- HELPER: GET MAIN MENU KEYBOARD ---
export const getMainMenuKeyboard = (user: any) => {
    const riskStatus = (user.enforceMaxSlLoss !== null && user.enforceMaxSlLoss !== undefined)
        ? user.enforceMaxSlLoss
        : process.env.ENFORCE_MAX_SL_LOSS === 'true';
    const riskIcon = riskStatus ? '🟢 مفعل' : '🔴 معطل';

    const orderMode = user.orderMode || 'market';
    const orderModeLabel = orderMode === 'limit' ? '📌 حدي (Limit)' : '⚡ سوق (Market)';

    const hitlarStatus = user.hitlarModeEnabled ? '🟢 مفعل' : '🔴 معطل';

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
                { text: `🚀 وضع هترل (HITLAR): ${hitlarStatus}` },
                { text: '⚙️ إعدادات وضع هترل' }
            ],
            [
                { text: '🛡 حماية رأس المال الصارمة' },
                { text: `⚡ نسبة المخاطرة: ${user.riskPercentage || 3}%` }
            ],
            [
                { text: `🔄 نوع تنفيذ الصفقة: ${orderModeLabel}` }
            ],
            [
                { text: `⚖️ إعدادات الرافعة: ${user.leverageMode === 'fixed' ? `x${user.fixedLeverageValue}` : 'تلقائي'}` }
            ],
            [
                { text: '📊 إعدادات الاستوب (التذبذب)' }
            ],
            [
                { text: 'ℹ️ تعليمات الاستخدام (Help)' }
            ]
        ],
        resize_keyboard: true,
        is_persistent: true
    };
};

// --- HITLAR SETTINGS KEYBOARD ---
export const buildHitlarSettingsKeyboard = (user: any) => {
    const settings = user.hitlarSettings || {
        riskPercentage: 3,
        leverage: 20,
        volatilitySlPercentage: 5,
        capitalProtectionEnabled: false,
        orderMode: 'limit'
    };

    const capProtLabel = settings.capitalProtectionEnabled ? '🟢 حماية رأس المال: مفعلة' : '🔴 حماية رأس المال: معطلة';
    const orderModeLabel = settings.orderMode === 'limit' ? '📌 تنفيذ حدي (Limit)' : '⚡ تنفيذ سوق (Market)';

    return {
        inline_keyboard: [
            [
                { text: `💰 نسبة الدخول: ${settings.riskPercentage}%`, callback_data: 'hitlar_edit_risk' }
            ],
            [
                { text: `⚖️ الرافعة: x${settings.leverage}`, callback_data: 'hitlar_edit_lev' }
            ],
            [
                { text: `📊 نسبة الاستوب: ${settings.volatilitySlPercentage}%`, callback_data: 'hitlar_edit_sl' }
            ],
            [
                { text: capProtLabel, callback_data: 'hitlar_toggle_cap' }
            ],
            [
                { text: orderModeLabel, callback_data: 'hitlar_toggle_mode' }
            ],
            [
                { text: '✅ حفظ وإغلاق', callback_data: 'hitlar_save' }
            ]
        ]
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

// --- CAPITAL PROTECTION KEYBOARD ---
export const buildCapitalProtectionKeyboard = (user: any) => {
    const isEnabled = (user.enforceMaxSlLoss !== null && user.enforceMaxSlLoss !== undefined)
        ? user.enforceMaxSlLoss
        : process.env.ENFORCE_MAX_SL_LOSS === 'true';
    
    const currentPercent = user.maxSlRiskPercentage || 6;

    return {
        inline_keyboard: [
            [
                { 
                    text: isEnabled ? '🟢 مفعل' : '🔴 معطل', 
                    callback_data: 'cap_toggle' 
                }
            ],
            [
                { text: currentPercent === 1 ? '✅ 1%' : '1%', callback_data: 'cap_perc_1' },
                { text: currentPercent === 2 ? '✅ 2%' : '2%', callback_data: 'cap_perc_2' },
                { text: currentPercent === 3 ? '✅ 3%' : '3%', callback_data: 'cap_perc_3' }
            ],
            [
                { text: currentPercent === 4 ? '✅ 4%' : '4%', callback_data: 'cap_perc_4' },
                { text: currentPercent === 5 ? '✅ 5%' : '5%', callback_data: 'cap_perc_5' },
                { text: currentPercent === 6 ? '✅ 6%' : '6%', callback_data: 'cap_perc_6' }
            ]
        ]
    };
};

// --- LEVERAGE SETTINGS KEYBOARD ---
export const buildLeverageKeyboard = (user: any) => {
    const mode = user.leverageMode || 'default';
    const val = user.fixedLeverageValue || 10;

    return {
        inline_keyboard: [
            [
                { 
                    text: mode === 'default' ? '⚙️ تلقائي (حسب التوصية) ✔️' : '⚙️ تلقائي (حسب التوصية)', 
                    callback_data: 'lev_mode_default' 
                },
                { 
                    text: mode === 'fixed' ? '📌 ثابت ✔️' : '📌 ثابت', 
                    callback_data: 'lev_mode_fixed' 
                }
            ],
            [
                { text: (mode === 'fixed' && val === 10) ? '✅ x10' : 'x10', callback_data: 'lev_val_10' },
                { text: (mode === 'fixed' && val === 15) ? '✅ x15' : 'x15', callback_data: 'lev_val_15' },
                { text: (mode === 'fixed' && val === 20) ? '✅ x20' : 'x20', callback_data: 'lev_val_20' }
            ],
            [
                { text: (mode === 'fixed' && val === 25) ? '✅ x25' : 'x25', callback_data: 'lev_val_25' },
                { text: (mode === 'fixed' && val === 50) ? '✅ x50' : 'x50', callback_data: 'lev_val_50' },
                { text: (mode === 'fixed' && val === 100) ? '✅ x100' : 'x100', callback_data: 'lev_val_100' }
            ]
        ]
    };
};
// --- VOLATILITY STOP LOSS KEYBOARD ---
export const buildVolatilitySlKeyboard = (user: any) => {
    const isEnabled = user.volatilitySlEnabled || false;
    const currentPercent = user.volatilitySlPercentage || 5;

    return {
        inline_keyboard: [
            [
                { 
                    text: isEnabled ? '🟢 مفعل' : '🔴 معطل', 
                    callback_data: 'vol_toggle' 
                }
            ],
            [
                { text: currentPercent === 1 ? '✅ 1%' : '1%', callback_data: 'vol_perc_1' },
                { text: currentPercent === 2 ? '✅ 2%' : '2%', callback_data: 'vol_perc_2' },
                { text: currentPercent === 3 ? '✅ 3%' : '3%', callback_data: 'vol_perc_3' }
            ],
            [
                { text: currentPercent === 5 ? '✅ 5%' : '5%', callback_data: 'vol_perc_5' },
                { text: currentPercent === 10 ? '✅ 10%' : '10%', callback_data: 'vol_perc_10' },
                { text: currentPercent === 15 ? '✅ 15%' : '15%', callback_data: 'vol_perc_15' }
            ]
        ]
    };
};
