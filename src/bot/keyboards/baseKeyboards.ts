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
                { text: '📊 التحليل الذكي (V1-V16)' },
                { text: '🔬 اختبار الاستراتيجيات' }
            ],
            [
                { text: '🔍 التحليل والقنص الموحد' },
                { text: '⚙️ إعدادات الاختبار الرجعي' }
            ],
            [
                { text: '🎯 نظام الاقتناص الذكي' },
                { text: '📡 مراقبة الصفقات الحية' }
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


// --- BACKTEST WIZARD KEYBOARDS (INLINE) ---
export const getBacktestVersionKeyboard = (symbol: string) => {
    return {
        inline_keyboard: [
            [{ text: 'V1 (الأساسي)', callback_data: `btw_v_V1_${symbol}` }, { text: 'V2 (الكمي)', callback_data: `btw_v_V2_${symbol}` }],
            [{ text: 'V3 (المصفوفة)', callback_data: `btw_v_V3_${symbol}` }, { text: 'V4 (ثنائي الاتجاه)', callback_data: `btw_v_V4_${symbol}` }],
            [{ text: 'V5 (تنبؤي)', callback_data: `btw_v_V5_${symbol}` }, { text: 'V6 (Sniper)', callback_data: `btw_v_V6_${symbol}` }],
            [{ text: 'V7 (القناص الهجيني) 🏹', callback_data: `btw_v_V7_${symbol}` }, { text: 'V8 (قناص الموجات) 🌊', callback_data: `btw_v_V8_${symbol}` }],
            [{ text: 'V9 (قناص SMC) 🏛️', callback_data: `btw_v_V9_${symbol}` }, { text: 'V10 (المؤسساتي المتقدم) 🏆', callback_data: `btw_v_V10_${symbol}` }],
            [{ text: 'V11 (القرار الذكي التكيفي) 👑', callback_data: `btw_v_V11_${symbol}` }, { text: 'V12 (CVD تدفق السيولة) 📊', callback_data: `btw_v_V12_${symbol}` }],
            [{ text: 'V13 (مصائد السيولة وايكوف) 🪤', callback_data: `btw_v_V13_${symbol}` }, { text: 'V14 (رينكو السحابية التكيفية) ☁️', callback_data: `btw_v_V14_${symbol}` }],
            [{ text: 'V15 (تشان الهارمونية الكمية) 🌌', callback_data: `btw_v_V15_${symbol}` }, { text: 'V16 (مصفوفة الزمان والمكان الهجينة) 🏹', callback_data: `btw_v_V16_${symbol}` }],
            [{ text: 'إلغاء ❌', callback_data: 'btw_cancel' }]
        ]
    };
};

export const getBacktestModeKeyboard = (version: string, symbol: string) => {
    return {
        inline_keyboard: [
            [
                { text: 'سكالبينج (Scalp) ⚡️', callback_data: `btw_m_SCALP_${version}_${symbol}` },
                { text: 'سوينج (Swing) 🌊', callback_data: `btw_m_SWING_${version}_${symbol}` }
            ],
            [{ text: 'إلغاء ❌', callback_data: 'btw_cancel' }]
        ]
    };
};

export const getBacktestIntervalKeyboard = (mode: string, version: string, symbol: string) => {
    return {
        inline_keyboard: [
            [
                { text: '1m', callback_data: `btw_i_1m_${mode}_${version}_${symbol}` },
                { text: '2m', callback_data: `btw_i_2m_${mode}_${version}_${symbol}` },
                { text: '3m', callback_data: `btw_i_3m_${mode}_${version}_${symbol}` }
            ],
            [
                { text: '5m', callback_data: `btw_i_5m_${mode}_${version}_${symbol}` },
                { text: '10m', callback_data: `btw_i_10m_${mode}_${version}_${symbol}` },
                { text: '15m', callback_data: `btw_i_15m_${mode}_${version}_${symbol}` }
            ],
            [
                { text: '30m', callback_data: `btw_i_30m_${mode}_${version}_${symbol}` },
                { text: '1h', callback_data: `btw_i_1h_${mode}_${version}_${symbol}` }
            ],
            [{ text: 'إلغاء ❌', callback_data: 'btw_cancel' }]
        ]
    };
};

export const getBacktestDaysKeyboard = (interval: string, mode: string, version: string, symbol: string) => {
    const isSmallTF = ['1m', '2m', '3m', '5m', '10m'].includes(interval);
    
    if (isSmallTF) {
        return {
            inline_keyboard: [
                [
                    { text: 'نصف يوم (12h)', callback_data: `btw_d_0.5_${interval}_${mode}_${version}_${symbol}` },
                    { text: 'يوم واحد', callback_data: `btw_d_1_${interval}_${mode}_${version}_${symbol}` }
                ],
                [{ text: 'يومين (Max)', callback_data: `btw_d_2_${interval}_${mode}_${version}_${symbol}` }],
                [{ text: 'إلغاء ❌', callback_data: 'btw_cancel' }]
            ]
        };
    } else {
        return {
            inline_keyboard: [
                [
                    { text: 'يوم واحد', callback_data: `btw_d_1_${interval}_${mode}_${version}_${symbol}` },
                    { text: '3 أيام', callback_data: `btw_d_3_${interval}_${mode}_${version}_${symbol}` }
                ],
                [
                    { text: '5 أيام', callback_data: `btw_d_5_${interval}_${mode}_${version}_${symbol}` },
                    { text: '7 أيام', callback_data: `btw_d_7_${interval}_${mode}_${version}_${symbol}` }
                ],
                [
                    { text: '14 يوم', callback_data: `btw_d_14_${interval}_${mode}_${version}_${symbol}` },
                    { text: '30 يوم', callback_data: `btw_d_30_${interval}_${mode}_${version}_${symbol}` }
                ],
                [{ text: 'إلغاء ❌', callback_data: 'btw_cancel' }]
            ]
        };
    }
};

export const getBacktestSettingsKeyboard = (user: any) => {
    const bs = user.backtestSettings || {};
    const isRiskFixed = bs.riskSizingEnabled ? '✅ مفعل' : '❌ معطل';
    const isMaxSlCap = bs.maxSlCapEnabled ? '✅ مفعل' : '❌ معطل';
    const isFullReport = bs.fullReportEnabled ? '✅ كامل (جميع الأعمدة)' : '❌ أساسي (23 عمود)';
    
    return {
        inline_keyboard: [
            [{ text: `[ ${bs.interval || '15m'} ] الفاصل الزمني ⏱`, callback_data: 'bts_set_interval' }],
            [{ text: `[ ${bs.initialCapital || 1000}$ ] رأس المال 💰`, callback_data: 'bts_set_capital' }],
            [
                { text: `[ ${bs.marginMode === 'CROSS' ? 'متبادل' : 'معزول'} ] وضع الهامش`, callback_data: 'bts_set_marginmode' },
                { text: `[ ${bs.leverage || 10}x ] الرافعة`, callback_data: 'bts_set_leverage' }
            ],
            [{ text: `حجم الدخول بناءً على مخاطرة الاستوب: ${isRiskFixed}`, callback_data: 'bts_toggle_risksizing' }],
            [{ text: `[ ${bs.riskPercentage || 3}% ] النسبة (${bs.riskSizingEnabled ? 'مخاطرة' : 'دخول'})`, callback_data: 'bts_set_riskpercentage' }],
            [{ text: `تقييد أقصى مسافة للاستوب: ${isMaxSlCap}`, callback_data: 'bts_toggle_maxslcap' }],
            [{ text: `[ ${bs.maxSlPercentage || 5}% ] أقصى مسافة للاستوب`, callback_data: 'bts_set_maxslpercentage' }],
            [{ text: `نوع التقرير (CSV): ${isFullReport}`, callback_data: 'bts_toggle_fullreport' }],
            [{ text: `وقت بدء الاختبار: ${bs.alignToStartOfDay !== false ? '🌅 بداية اليوم (00:00)' : '⏱ وقت الطلب الحالي'}`, callback_data: 'bts_toggle_alignstart' }],
            [{ text: '🔄 استنساخ إعدادات التداول الحي', callback_data: 'bts_sync_live' }],
            [{ text: '✅ إغلاق لوحة الإعدادات', callback_data: 'bts_close' }]
        ]
    };
};

export const getBacktestSettingsIntervals = () => {
    return {
        inline_keyboard: [
            [
                { text: '1m', callback_data: 'bts_val_int_1m' },
                { text: '2m', callback_data: 'bts_val_int_2m' },
                { text: '3m', callback_data: 'bts_val_int_3m' }
            ],
            [
                { text: '5m', callback_data: 'bts_val_int_5m' },
                { text: '10m', callback_data: 'bts_val_int_10m' },
                { text: '15m', callback_data: 'bts_val_int_15m' }
            ],
            [
                { text: '30m', callback_data: 'bts_val_int_30m' },
                { text: '1h', callback_data: 'bts_val_int_1h' }
            ],
            [{ text: 'إلغاء ❌', callback_data: 'bts_cancel' }]
        ]
    };
};


