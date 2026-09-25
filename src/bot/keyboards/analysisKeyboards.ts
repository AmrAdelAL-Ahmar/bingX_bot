// --- TECHNICAL ANALYSIS KEYBOARDS ---

export const getAlgoVersionKeyboard = () => {
    return {
        keyboard: [
            [{ text: 'الخوارزمية V1 (الأساسي)' }, { text: 'الخوارزمية V2 (الكمي - Quant)' }],
            [{ text: 'الخوارزمية V3 (المصفوفة)' }, { text: 'الخوارزمية V4 (ثنائي الاتجاه)' }],
            [{ text: 'الخوارزمية V5 (تنبؤي AI) 🔮' }, { text: 'الخوارزمية V6 (Sniper) 🎯' }],
            [{ text: 'الخوارزمية V7 (القناص الهجيني) 🏹' }, { text: 'الخوارزمية V8 (قناص الموجات والسيولة) 🌊' }],
            [{ text: 'الخوارزمية V9 (قناص SMC الذكي) 🏛️' }, { text: 'الخوارزمية V10 (المؤسساتي المتقدم) 🏆' }],
            [{ text: 'الخوارزمية V11 (القرار الذكي التكيفي) 👑' }, { text: 'الخوارزمية V12 (تدفق السيولة CVD) 📊' }],
            [{ text: 'الخوارزمية V13 (مصائد السيولة وايكوف) 🪤' }, { text: 'الخوارزمية V14 (رينكو السحابية التكيفية) ☁️' }],
            [{ text: 'الخوارزمية V15 (تشان الهارمونية الكمية) 🌌' }, { text: 'الخوارزمية V16 (مصفوفة الزمان والمكان الهجينة) 🏹' }],
            [{ text: 'الخوارزمية V17 (نظام السوق الديناميكي) 🌐' }, { text: 'الخوارزمية V18 (تدفق السيولة وعمق الأوامر) 📊' }],
            [{ text: 'منظومة الهارمونيك الكاملة (11 نموذجاً) 🎯' }, { text: 'منسق المحركات الشاملة (الإجماع) 🤖' }],
            [{ text: 'دليل الخوارزميات 📖' }, { text: '⚙️ إعدادات المحلل الذكي' }],
            [{ text: 'رجوع للقائمة الرئيسية 🔙' }]
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
            [{ text: '🛡️ حماية الـ Repainting' }],
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

// --- ANALYSIS REPORT ACTION KEYBOARD (INLINE) ---
export const getAnalysisActionKeyboard = (symbol: string, type: 'scalp' | 'swing', data: any, version: string = 'V6') => {
    // data contains entry, tp, sl, direction, tp2
    const s = symbol.split('/')[0]; // Use short symbol BTC instead of BTC/USDT:USDT
    const d = data.direction === 'LONG' ? 'L' : 'S';
    const p = data?.pricePrecision || 6;
    const e = data.entry.toFixed(p);
    const t1 = data.tp.toFixed(p);
    const sl = data.sl.toFixed(p);
    const t2 = data.tp2 ? data.tp2.toFixed(p) : '0';

    const callbackData = `ex_${type === 'scalp' ? 'sc' : 'sw'}_${s}_${d}_${e}_${t1}_${sl}_${t2}`;
    const copyData = `cp_${type === 'scalp' ? 'sc' : 'sw'}_${s}_${d}_${e}_${t1}_${sl}_${t2}`;
    const aiData = `ai_an_${type === 'scalp' ? 'sc' : 'sw'}_${s}_${version}`;
    const btData = `bt_${type === 'scalp' ? 'sc' : 'sw'}_${s}_${version}`;
    const dtData = `dt_${type === 'scalp' ? 'sc' : 'sw'}_${s}_${d}_${version}`; // Details with Direction & Version
    const eduData = `ed_${type === 'scalp' ? 'sc' : 'sw'}_${s}_${version}`; // Educational Guide
    const corData = `cor_ck_${s}_${d}_${version}`; // Correction Check with Direction & Version
    const alertData = `cor_al_${s}`; // Correction Alert Toggle
    return {
        inline_keyboard: [
            [{ text: `تنفيذ صفقة ${type === 'scalp' ? 'Scalp ⚡' : 'Swing 🌊'}`, callback_data: callbackData }],
            [{ text: 'نسخ إشارة الصفقة 📋', callback_data: copyData }],
            [{ text: '🧠 التحليل بالذكاء الاصطناعي', callback_data: aiData }],
            [
                { text: '🔍 التقرير التفصيلي', callback_data: dtData },
                { text: '🎓 دليل المؤشرات', callback_data: eduData }
            ],
            [{ text: '📊 التحليل الشامل (MTF)', callback_data: `all_tf_${s}` }],
            [
                { text: '🎯 معرفة التصحيح', callback_data: corData },
                { text: '🔔 تنبيه التصحيح', callback_data: alertData }
            ],
            [{ text: 'اختبار الاستراتيجية ⏱️', callback_data: btData }]
        ]
    };
};
