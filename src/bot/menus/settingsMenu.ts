import { InlineKeyboardMarkup } from 'telegraf/types';

/**
 * يولّد واجهة لوحة تحكم إعدادات المتداول بنقرة واحدة (Inline Settings Keyboard)
 * للتحكم في المخاطر، والرافعة، والتنفيذ، والاستراتيجيات المختلفة.
 */
export const getTraderSettingsInlineKeyboard = (user: any): InlineKeyboardMarkup => {
    const orderModeLabel = user.orderMode === 'limit' ? '📌 حدي (Limit)' : '⚡ سوق (Market)';
    const leverageLabel = user.leverageMode === 'fixed' ? `📌 ثابت (x${user.fixedLeverageValue})` : '⚙️ تلقائي (حسب الإشارة)';
    const capProtectionLabel = user.enforceMaxSlLoss ? '🟢 مفعل' : '🔴 معطل';
    const volatilitySlLabel = user.volatilitySlEnabled ? '🟢 مفعل' : '🔴 معطل';
    const hitlarLabel = user.hitlarModeEnabled ? '🟢 مفعل' : '🔴 معطل';
    const tpExecutionModeLabel = user.tpExecutionMode === 'single' ? '🎯 هدف واحد (TP1)' : '🎯 أهداف متعددة';

    return {
        inline_keyboard: [
            [
                { text: `⚡ نسبة المخاطرة: ${user.riskPercentage}%`, callback_data: 'sett_edit_risk' },
                { text: `🔄 طريقة التنفيذ: ${user.orderMode === 'limit' ? 'Limit' : 'Market'}`, callback_data: 'sett_toggle_ordermode' }
            ],
            [
                { text: `⚖️ الرافعة المالية: ${user.leverageMode === 'fixed' ? `x${user.fixedLeverageValue}` : 'تلقائي'}`, callback_data: 'sett_edit_leverage' },
                { text: `📊 وقف التذبذب: ${user.volatilitySlPercentage}% | ${user.volatilitySlEnabled ? '✅' : '❌'}`, callback_data: 'sett_toggle_volatilitysl' }
            ],
            [
                { text: `🛡️ درع رأس المال: ${user.maxSlRiskPercentage}% | ${user.enforceMaxSlLoss ? '✅' : '❌'}`, callback_data: 'sett_toggle_capprotection' },
                { text: `🚀 وضع هترل (HITLAR): ${hitlarLabel}`, callback_data: 'sett_toggle_hitlar' }
            ],
            [
                { text: '⚙️ إعدادات وضع هترل المتقدمة', callback_data: 'sett_hitlar_details' }
            ],
            [
                { text: `🎯 جني الأرباح: ${tpExecutionModeLabel}`, callback_data: 'sett_toggle_tpmode' },
                { text: '🛠️ استراتيجية التقسيم والأهداف', callback_data: 'sett_strategy_details' }
            ],
            [
                { text: '🔔 إعدادات تنبيهات الأهداف والستوب', callback_data: 'sett_alerts_details' }
            ],
            [
                { text: '🔙 العودة للقائمة الرئيسية', callback_data: 'menu_open' }
            ]
        ]
    };
};

/**
 * يولّد نص لوحة تحكم إعدادات المتداول بالتنسيق الفاخر
 */
export const getTraderSettingsText = (user: any): string => {
    return `⚙️ <b>لوحة تحكم الإعدادات الفنية وإدارة المخاطر | Sniper V10/V11</b>\n\n` +
        `من هنا يمكنك ضبط معايير وإعدادات التداول المباشر بشكل فوري. سيقوم البوت بتطبيق هذه القواعد تلقائياً على كل صفقة يتم استقبالها:\n\n` +
        `• <b>⚡ نسبة المخاطرة:</b> دخول الصفقات بـ <b>${user.riskPercentage}%</b> من رأس مالك المتاح.\n` +
        `• <b>🔄 طريقة التنفيذ:</b> تنفيذ الأوامر بنظام <b>${user.orderMode === 'limit' ? 'الأوامر الحدّية (Limit)' : 'أوامر السوق الفورية (Market)'}</b>.\n` +
        `• <b>⚖️ الرافعة المالية:</b> <b>${user.leverageMode === 'fixed' ? `رافعة ثابتة x${user.fixedLeverageValue}` : 'تلقائي (اتباع التوصية)'}</b>.\n` +
        `• <b>📊 وقف التذبذب (ATR):</b> <b>${user.volatilitySlEnabled ? `مفعل بنسبة ${user.volatilitySlPercentage}%` : 'معطل (استخدام ستوب التوصية)'}</b>.\n` +
        `• <b>🛡️ درع رأس المال الصارم:</b> <b>${user.enforceMaxSlLoss ? `مفعل (خسارة الـ SL لا تتجاوز ${user.maxSlRiskPercentage}% من الحساب)` : 'معطل'}</b>.\n` +
        `• <b>🎯 وضع جني الأرباح:</b> <b>${user.tpExecutionMode === 'single' ? 'الاكتفاء بالهدف الأول فقط (TP1)' : 'جني الأرباح على مستويات متعددة'}</b>.\n` +
        `• <b>🚀 وضع هترل (HITLAR):</b> <b>${user.hitlarModeEnabled ? 'مفعل 🟢' : 'معطل 🔴'}</b> (تداول مسبق التثبيت).\n\n` +
        `<i>ℹ️ اضغط على الأزرار التفاعلية أدناه لتعديل أي إعداد فوراً بدون الحاجة لكتابة أوامر.</i>`;
};

/**
 * يولّد واجهة لوحة مفاتيح الأرقام التفاعلية (Inline Numeric Numpad)
 * لإدخال أرقام دقيقة للرافعة والنسب المئوية بنقرات أصبع.
 * 
 * @param type نوع المتغير الذي يتم إدخاله (e.g., risk, leverage, vol_sl, max_sl, etc.)
 * @param currentValue القيمة المدخلة حتى الآن
 * @param label نص وصفي للمتغير
 */
export const buildNumpadKeyboard = (type: string, currentValue: string, label: string): InlineKeyboardMarkup => {
    const displayVal = currentValue || '0';
    return {
        inline_keyboard: [
            [
                { text: `🏷️ ${label}: ${displayVal}`, callback_data: 'np_noop' }
            ],
            [
                { text: '1', callback_data: `np_${type}_1_${currentValue}` },
                { text: '2', callback_data: `np_${type}_2_${currentValue}` },
                { text: '3', callback_data: `np_${type}_3_${currentValue}` }
            ],
            [
                { text: '4', callback_data: `np_${type}_4_${currentValue}` },
                { text: '5', callback_data: `np_${type}_5_${currentValue}` },
                { text: '6', callback_data: `np_${type}_6_${currentValue}` }
            ],
            [
                { text: '7', callback_data: `np_${type}_7_${currentValue}` },
                { text: '8', callback_data: `np_${type}_8_${currentValue}` },
                { text: '9', callback_data: `np_${type}_9_${currentValue}` }
            ],
            [
                { text: '.', callback_data: `np_${type}_dot_${currentValue}` },
                { text: '0', callback_data: `np_${type}_0_${currentValue}` },
                { text: '⌫ مسح', callback_data: `np_${type}_back_${currentValue}` }
            ],
            [
                { text: '🧹 تفريغ', callback_data: `np_${type}_clear_${currentValue}` },
                { text: '❌ إلغاء', callback_data: `np_${type}_cancel_${currentValue}` }
            ],
            [
                { text: '✅ حفظ وتأكيد القيمة', callback_data: `np_${type}_ok_${currentValue}` }
            ]
        ]
    };
};

/**
 * يولّد واجهة لوحة تحكم استراتيجية الأهداف الفاخرة (Inline Strategy Keyboard)
 */
export const getStrategyInlineKeyboard = (user: any): InlineKeyboardMarkup => {
    const beStatus = user.autoBreakEven ? '🟢 مفعل' : '🔴 معطل';
    const splitMode = user.tpSplitMode === 'manual' ? 'يدوي (مخصص)' : 'تلقائي (متساوي)';
    const errorMitStatus = user.errorMitigationEnabled ? '🟢 مفعل' : '🔴 معطل';

    return {
        inline_keyboard: [
            [
                { text: `نقل الاستوب للدخول (Break-Even): ${beStatus}`, callback_data: 'strat_toggle_be' }
            ],
            [
                { text: `تقسيم كمية الأرباح: ${splitMode}`, callback_data: 'strat_toggle_split_mode' }
            ],
            [
                { text: `معالجة الأخطاء تلقائياً: ${errorMitStatus}`, callback_data: 'strat_toggle_err_mit' }
            ],
            [
                { text: '📊 تخصيص نسب الأرباح يدوياً', callback_data: 'strat_edit_splits' }
            ],
            [
                { text: 'ℹ️ دليل تفاصيل معالجة الأخطاء', callback_data: 'strat_info_err_mit' }
            ],
            [
                { text: '🔙 العودة للإعدادات الرئيسية', callback_data: 'menu_settings' }
            ]
        ]
    };
};

/**
 * يولّد واجهة إعدادات وضع هترل (HITLAR Mode Details Inline Keyboard)
 */
export const getHitlarSettingsInlineKeyboard = (user: any): InlineKeyboardMarkup => {
    const settings = user.hitlarSettings || {
        riskPercentage: 3,
        leverage: 20,
        volatilitySlPercentage: 5,
        capitalProtectionEnabled: false,
        orderMode: 'limit'
    };

    const capProtLabel = settings.capitalProtectionEnabled ? '🟢 مفعل' : '🔴 معطل';
    const orderModeLabel = settings.orderMode === 'limit' ? '📌 حدي (Limit)' : '⚡ سوق (Market)';

    return {
        inline_keyboard: [
            [
                { text: `💰 نسبة الدخول: ${settings.riskPercentage}%`, callback_data: 'hit_edit_risk' }
            ],
            [
                { text: `⚖️ الرافعة: x${settings.leverage}`, callback_data: 'hit_edit_lev' }
            ],
            [
                { text: `📊 نسبة الاستوب: ${settings.volatilitySlPercentage}%`, callback_data: 'hit_edit_sl' }
            ],
            [
                { text: `🛡️ حماية رأس المال: ${capProtLabel}`, callback_data: 'hit_toggle_cap' }
            ],
            [
                { text: `🔄 نوع تنفيذ الصفقة: ${orderModeLabel}`, callback_data: 'hit_toggle_mode' }
            ],
            [
                { text: '🔙 العودة للإعدادات الرئيسية', callback_data: 'menu_settings' }
            ]
        ]
    };
};
