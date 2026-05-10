import { BingXService } from '../../services/BingXService';

// --- HELPER: GET MAIN MENU KEYBOARD ---
export const getMainMenuKeyboard = (user: any) => {
    return {
        keyboard: [
            [
                { text: '💰 رصيدي وملخص الأرباح' },
                { text: '💼 صفقاتي المفتوحة' }
            ],
            [
                { text: '📊 التقارير' },
                { text: '⚙️ إعدادات المتداول' }
            ],
            [
                { text: '🔍 الاستعلام عن صفقة محددة' },
                { text: '❌ إلغاء صفقة محددة' }
            ],
            [
                { text: '📊 التحليل الذكي (V1/V2)' }
            ],
            [
                { text: '🛑 إلغاء كل الصفقات المفتوحة' }
            ],
            [
                { text: 'ℹ️ تعليمات الاستخدام (Help)' }
            ],
            [
                { text: '📱 إخفاء القائمة' }
            ]
        ],
        resize_keyboard: true,
        is_persistent: true
    };
};

export const getHiddenMenuKeyboard = () => {
    return {
        keyboard: [
            [
                { text: '📱 إظهار القائمة' }
            ]
        ],
        resize_keyboard: true,
        is_persistent: true
    };
};

// --- TRADER SETTINGS KEYBOARD (REPLY KEYBOARD) ---
export const getTraderSettingsKeyboard = (user: any) => {
    const hitlarStatus = user.hitlarModeEnabled ? '🟢 مفعل' : '🔴 معطل';
    const orderMode = user.orderMode === 'limit' ? '📌 حدي' : '⚡ سوق';

    return {
        keyboard: [
            [
                { text: `⚡ نسبة المخاطرة: ${user.riskPercentage || 3}%` },
                { text: `🔄 نوع تنفيذ الصفقة: ${orderMode}` }
            ],
            [
                { text: `⚖️ إعدادات الرافعة: ${user.leverageMode === 'fixed' ? `x${user.fixedLeverageValue}` : 'تلقائي'}` },
                { text: '📊 إعدادات الاستوب (التذبذب)' }
            ],
            [
                { text: '🛡 حماية رأس المال الصارمة' }
            ],
            [
                { text: `🚀 وضع هترل (HITLAR): ${hitlarStatus}` },
                { text: '⚙️ إعدادات وضع هترل' }
            ],
            [
                { text: '⚙️ إعدادات التنبيهات' },
                { text: '🎯 استراتيجية الأهداف والأخطاء' }
            ],
            [
                { text: 'رجوع للقائمة الرئيسية 🔙' }
            ]
        ],

        resize_keyboard: true,
        is_persistent: true
    };
};

// Keep buildTraderSettingsKeyboard for inline usage if needed, but the user requested reply keyboard.
// export const buildTraderSettingsKeyboard = (user: any) => {


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
export const getDynamicSymbolsKeyboard = async (BingXService: BingXService) => {
    const positions = await BingXService.getPositions();
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
// --- STRATEGY SETTINGS KEYBOARD ---
export const buildStrategySettingsKeyboard = (user: any) => {
    const tpMode = user.tpExecutionMode === 'single' ? '🎯 هدف واحد فقط (TP1)' : '🎯 أهداف متعددة';
    const splitMode = user.tpSplitMode === 'manual' ? 'يدوي (مخصص)' : 'تلقائي (متساوي)';
    const beStatus = user.autoBreakEven ? '🟢 مفعل' : '🔴 معطل';
    const errorMitStatus = user.errorMitigationEnabled ? '🟢 مفعل' : '🔴 معطل';
    
    return {
        inline_keyboard: [
            [
                { text: `وضع الأهداف: ${tpMode}`, callback_data: 'strat_toggle_tp_mode' }
            ],
            [
                { text: `تقسيم الأرباح: ${splitMode}`, callback_data: 'strat_toggle_split_mode' }
            ],
            [
                { text: `نقل الاستوب للدخول (BE): ${beStatus}`, callback_data: 'strat_toggle_be' }
            ],
            [
                { text: `معالجة الأخطاء تلقائياً: ${errorMitStatus}`, callback_data: 'strat_toggle_err_mit' }
            ],
            [
                { text: 'ℹ️ تفاصيل معالجة الأخطاء', callback_data: 'strat_info_err_mit' }
            ],
            [
                { text: '📊 تخصيص نسب الأرباح يدوياً', callback_data: 'strat_edit_splits' }
            ],
            [
                { text: '✅ إغلاق', callback_data: 'strat_close' }
            ]
        ]
    };
};

// --- ALGO VERSION SELECTION KEYBOARD ---
export const getAlgoVersionKeyboard = () => {
    return {
        keyboard: [
            [{ text: 'الخوارزمية V1 (الأساسي)' }, { text: 'الخوارزمية V2 (الكمي - Quant)' }],
            [{ text: 'الخوارزمية V3 (المصفوفة)' }, { text: 'الخوارزمية V4 (ثنائي الاتجاه)' }],
            [{ text: 'الخوارزمية V5 (تنبؤي AI) 🔮' }, { text: 'رجوع للقائمة الرئيسية 🔙' }],
            [{ text: '⚙️ إعدادات المحلل الذكي' }, { text: '📖 دليل الخوارزميات' }]
        ],
        resize_keyboard: true,
        is_persistent: true
    };
};

export const getAnalysisSettingsKeyboard = () => {
    return {
        keyboard: [
            [{ text: '⏱️ فريم السكالبينج' }, { text: '🌊 فريم السوينج' }],
            [{ text: '📊 عدد الشمعات (Limit)' }, { text: '📉 مؤشر RSI Threshold' }],
            [{ text: 'رجوع للقائمة الرئيسية 🔙' }]
        ],
        resize_keyboard: true
    };
};

export const getTFSelectionKeyboard = (type: 'scalp' | 'swing') => {
    const prefix = type === 'scalp' ? 'sc_tf_' : 'sw_tf_';
    return {
        inline_keyboard: [
            [
                { text: '1m', callback_data: `${prefix}1m` },
                { text: '3m', callback_data: `${prefix}3m` },
                { text: '5m', callback_data: `${prefix}5m` }
            ],
            [
                { text: '15m', callback_data: `${prefix}15m` },
                { text: '30m', callback_data: `${prefix}30m` },
                { text: '1h', callback_data: `${prefix}1h` }
            ],
            [
                { text: '4h', callback_data: `${prefix}4h` },
                { text: '1d', callback_data: `${prefix}1d` }
            ]
        ]
    };
};

export const getLimitSelectionKeyboard = () => {
    return {
        inline_keyboard: [
            [
                { text: '100 شمعة', callback_data: 'limit_100' },
                { text: '200 شمعة', callback_data: 'limit_200' }
            ],
            [
                { text: '300 شمعة', callback_data: 'limit_300' },
                { text: '500 شمعة', callback_data: 'limit_500' }
            ]
        ]
    };
};

export const getRSISelectionKeyboard = () => {
    return {
        inline_keyboard: [
            [
                { text: '20 (صارم جداً)', callback_data: 'rsi_20' },
                { text: '25', callback_data: 'rsi_25' },
                { text: '30 (قياسي)', callback_data: 'rsi_30' }
            ],
            [
                { text: '35', callback_data: 'rsi_35' },
                { text: '40', callback_data: 'rsi_40' },
                { text: '50 (حساس جداً)', callback_data: 'rsi_50' }
            ]
        ]
    };
};

export const getAlgoGuideSelectionKeyboard = () => {
    return {
        inline_keyboard: [
            [
                { text: 'شرح V1 (الذهبية)', callback_data: 'guide_v1' },
                { text: 'شرح V4 (المصفوفة)', callback_data: 'guide_v4' }
            ],
            [
                { text: 'شرح V5 (التنبؤي)', callback_data: 'guide_v5' }
            ]
        ]
    };
};

// --- ANALYSIS REPORT ACTION KEYBOARD (INLINE) ---
export const getAnalysisActionKeyboard = (symbol: string, type: 'scalp' | 'swing', data: any) => {
    // data contains entry, tp, sl, direction, tp2
    const s = symbol.split('/')[0]; // Use short symbol BTC instead of BTC/USDT:USDT
    const d = data.direction === 'LONG' ? 'L' : 'S';
    const e = data.entry.toFixed(4);
    const t1 = data.tp.toFixed(4);
    const sl = data.sl.toFixed(4);
    const t2 = data.tp2 ? data.tp2.toFixed(4) : '0';

    const callbackData = `ex_${type === 'scalp' ? 'sc' : 'sw'}_${s}_${d}_${e}_${t1}_${sl}_${t2}`;
    const copyData = `cp_${type === 'scalp' ? 'sc' : 'sw'}_${s}_${d}_${e}_${t1}_${sl}_${t2}`;
    const btData = `bt_${type === 'scalp' ? 'sc' : 'sw'}_${s}`; // Backtest current symbol

    return {
        inline_keyboard: [
            [
                { text: `تنفيذ صفقة ${type === 'scalp' ? 'Scalp ⚡' : 'Swing 🌊'}`, callback_data: callbackData }
            ],
            [
                { text: 'نسخ إشارة الصفقة 📋', callback_data: copyData }
            ],
            [
                { text: 'اختبار (Backtest) ⏱️', callback_data: btData },
                { text: 'تفاصيل التحليل 🔍', callback_data: `dt_${type === 'scalp' ? 'sc' : 'sw'}_${s}` }
            ]
        ]
    };
};
