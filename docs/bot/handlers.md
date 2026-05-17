# 🤖 Bot Handlers — طبقة واجهة Telegram

> **الموقع:** `src/bot/handlers/`  
> **الدور:** تحويل أوامر المستخدمين في Telegram إلى استدعاءات للخدمات الداخلية. تعتمد على نظام **State Machine** لإدارة تدفق المحادثات.

---

## 🗺️ نظام State Machine

البوت يستخدم `user.botState` لتتبع المرحلة الحالية للمستخدم:

```
NONE                      ← وضع الانتظار الطبيعي
AWAITING_RISK_PERCENTAGE  ← في انتظار إدخال نسبة المخاطرة
AWAITING_TP_SPLITS        ← في انتظار إدخال نسب تقسيم الأهداف
AWAITING_BT_SYMBOL        ← في انتظار رمز الـ Backtest
AWAITING_ANALYSIS_SYMBOL_V1..V6 ← في انتظار رمز التحليل
AWAITING_CANCEL_ALL_CONFIRM ← في انتظار تأكيد إغلاق الصفقات
AWAITING_CANCEL_SYMBOL    ← في انتظار رمز صفقة للإغلاق
AWAITING_QUERY_SYMBOL     ← في انتظار رمز للاستعلام
AWAITING_REPORT_DATE      ← في انتظار تاريخ التقرير
AWAITING_HITLAR_RISK/LEV/SL ← إعدادات HITLAR
AWAITING_BTS_CAPITAL/LEVERAGE/RISK/MAX_SL ← إعدادات Backtest
```

---

## 📁 messageHandlers.ts — المعالج الرئيسي (1183 سطر)

### الأوامر المسجلة

| الأمر / الرسالة | الوظيفة |
|-----------------|---------|
| `/start` | رسالة ترحيب + القائمة الرئيسية |
| `/menu` | إظهار القائمة الرئيسية |
| `📊 التحليل الذكي (V1/V2)` | لوحة اختيار الخوارزمية |
| `الخوارزمية V1..V6` | بدء تحليل بالنسخة المختارة |
| `🔬 اختبار الاستراتيجيات` | بدء Backtest Wizard |
| `⚙️ إعدادات المحلل الذكي` | إعدادات التحليل (TF, Candles, RSI) |
| إشارة تداول نصية | تحليل تلقائي → تنفيذ |

---

### تدفق التحليل (AWAITING_ANALYSIS_SYMBOL)

```
المستخدم يختار V3 → state = 'AWAITING_ANALYSIS_SYMBOL_V3'
    ↓
المستخدم يكتب 'BTC'
    ↓
analysisService.analyze('BTC', 'V3', {
    quickTF: user.analysisSettings.scalpTF,   // '5m'
    longTF:  user.analysisSettings.swingTF,   // '1h'
    limit:   user.analysisSettings.candleLimit // 200
})
    ↓
analysisService.formatReport(result, 'V3') → نص HTML
    ↓
إرسال التقرير + أزرار Inline لتنفيذ Scalp/Swing
```

---

### تدفق تنفيذ الإشارة النصية

```
المستخدم يرسل نص إشارة تداول
    ↓
SignalParser.parse(message) → ParsedSignal | null
    ↓
إذا signal موجود:
    tradeManager.executeSignal(signal, user._id, chatId)
    ↓
    إرسال تقرير التنفيذ:
        - Entry, TP, SL مع PnL المتوقع
        - نوع الأمر (Market/Limit)
        - الرافعة ومبلغ الهامش
```

---

### Backtest Wizard (سلسلة Callbacks)

```
المستخدم يختار رمز → getBacktestVersionKeyboard()
    ↓
callback: btw_v_V3_BTC → getBacktestModeKeyboard()
    ↓
callback: btw_m_SCALP_V3_BTC → getBacktestIntervalKeyboard()
    ↓
callback: btw_i_15m_SCALP_V3_BTC → getBacktestDaysKeyboard()
    ↓
callback: btw_d_30_15m_SCALP_V3_BTC → تشغيل Backtest
    ↓
backtestService.runAdvancedBacktest({ symbol, version, mode, ... })
    ↓
إرسال التقرير + ملف CSV
```

### دالة generateCSVBuffer

تُنتج ملف CSV يحتوي على **87+ عموداً** لكل صفقة:
- معلومات الصفقة الأساسية (Entry, TP, SL, PnL)
- معلومات رأس المال (Margin, Equity قبل وبعد)
- سياق التحليل الكامل (RSI, MACD, BB, ATR, Pivot, Fib, SwingLevels لـ 7 إطارات)

| الوضع | عدد الأعمدة |
|-------|------------|
| Basic | 24 عموداً |
| Full Report | 87+ عموداً |

---

## 📁 tradingHandlers.ts — مدير الصفقات

| الزر | الوظيفة |
|------|---------|
| `🛑 إلغاء كل الصفقات المفتوحة` | عرض PnL الحالي + طلب تأكيد → `tradeManager.closeAllPositions()` |
| `🔍 الاستعلام عن صفقة محددة` | عرض قائمة رموز نشطة → تفاصيل صفقة |
| `❌ إلغاء صفقة محددة` | اختيار رمز → `tradeManager.closeSpecificPosition()` |
| `/status BTC` | تفاصيل صفقة BTC من BingX مباشرة |

---

## 📁 portfolioHandlers.ts — عرض المحفظة

| الزر | البيانات المعروضة |
|------|-----------------|
| `💰 رصيدي وملخص الأرباح` | الرصيد الحر + إجمالي PnL العائم |
| `💼 صفقاتي المفتوحة` | كل صفقة: سعر دخول/حالي، PnL، Margin، TP القادم، SL |
| `/balance` | الرصيد فقط (أمر نصي بسيط) |

**معادلة ROE:**
```typescript
if (pos.percentage)       → استخدام مباشر
else if (margin > 0)      → roe = (pnl / margin) × 100
else                      → pos.info.profitRate × 100
```

---

## 📁 reportHandlers.ts — التقارير

| الزر | الفترة الزمنية |
|------|--------------|
| `📊 تقرير يومي` | من بداية اليوم (00:00) |
| `📅 تقرير شهري` | من أول الشهر |
| `📆 تقرير سنوي` | من أول السنة |
| `📈 تقرير شامل` | كل الوقت (All-Time) |
| `🗓 تقرير مخصص` | تاريخ يكتبه المستخدم (YYYY-MM-DD) |

**قاعدة البيانات:**
```typescript
Trade.find({
    userId: user._id,
    currentStatus: { $in: ['CLOSED_PROFIT', 'CLOSED_LOSS', 'CLOSED_MANUAL'] },
    closeTime: { $gte: startDate }
})
```

**دالة `generateReportStr`** (من `views.ts`):
```typescript
const netPnl = Σ(margin × (pnl / 100));
const winRate = (wins / total) × 100;
```

---

## 📁 baseKeyboards.ts — لوحات المفاتيح

يحتوي على **20+ دالة** لتوليد لوحات مفاتيح Telegram المختلفة:

| الدالة | الوصف |
|--------|-------|
| `getMainMenuKeyboard(user)` | القائمة الرئيسية (تتغير حسب حالة HITLAR) |
| `getAlgoVersionKeyboard()` | اختيار V1-V6 |
| `getAnalysisActionKeyboard()` | أزرار تنفيذ/نسخ إشارة بعد التحليل |
| `getBacktestVersionKeyboard(symbol)` | اختيار الإصدار للـ Backtest |
| `getBacktestModeKeyboard(v, s)` | SCALP / SWING |
| `getBacktestIntervalKeyboard(m, v, s)` | خطوة الزمن (5m, 15m, 30m, 1h) |
| `getBacktestDaysKeyboard(i, m, v, s)` | عدد أيام الاختبار |
| `getBacktestSettingsKeyboard(user)` | إعدادات Backtest |
| `getDynamicSymbolsKeyboard(bingx)` | جلب الرموز النشطة من BingX |
| `getTFSelectionKeyboard(type)` | اختيار الإطار الزمني |
| `getLimitSelectionKeyboard()` | اختيار عدد الشمعات |
| `getRSISelectionKeyboard()` | اختيار قيمة RSI |
| `getReportsKeyboard()` | قائمة التقارير |

---

## 🔄 `getDynamicSymbolsKeyboard` — الأذكى

```typescript
const positions = await bingxService.getPositions();
const activeSymbols = positions
    .filter(p => parseFloat(p.contracts) > 0)
    .map(p => p.symbol.split('/')[0]);  // BTC, ETH, ...

// تحويل لأزرار Keyboard
return activeSymbols.map(s => [{ text: s }]);
```

تجلب الرموز مباشرة من BingX (لا تعتمد على DB) لضمان أن الأزرار دائماً محدّثة.
