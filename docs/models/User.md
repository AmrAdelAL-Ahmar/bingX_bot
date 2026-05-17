# 🗄️ User.ts — نموذج بيانات المستخدم

> **الموقع:** `src/models/User.ts`  
> **الدور:** يعرّف هيكل بيانات المستخدم في MongoDB. يحتوي على كل إعدادات التداول الخاصة بكل مستخدم.

---

## 📋 جميع حقول الـ Schema

### 🔑 الحقول الأساسية

| الحقل | النوع | الافتراضي | الوصف |
|-------|-------|----------|-------|
| `telegramId` | String | — (مطلوب) | معرّف المستخدم في Telegram، مفتاح فريد |
| `username` | String | — | اسم المستخدم في Telegram |
| `bingxApiKey` | String | — | مفتاح API لمنصة BingX |
| `bingxSecretKey` | String | — | المفتاح السري لمنصة BingX |
| `isActive` | Boolean | `true` | هل الحساب نشط؟ |
| `createdAt` | Date | `Date.now` | تاريخ إنشاء الحساب |
| `botState` | String | `null` | حالة المحادثة (للـ State Machine) |

---

### ⚠️ إعدادات التحذيرات

| الحقل | النوع | الافتراضي | الوصف |
|-------|-------|----------|-------|
| `slWarningEnabled` | Boolean | `true` | تفعيل تحذير اقتراب SL |
| `tpWarningEnabled` | Boolean | `true` | تفعيل تحذير اقتراب TP |
| `tpWarningThresholds` | Number[] | `[70, 90]` | نسب التقدم التي تُرسل عندها تحذيرات |

**مثال:** `tpWarningThresholds: [70, 90]` → تنبيه عند 70% و 90% من المسافة نحو الهدف.

---

### 💰 إعدادات إدارة رأس المال

| الحقل | النوع | الافتراضي | الوصف |
|-------|-------|----------|-------|
| `riskPercentage` | Number | `3` | نسبة الهامش المستخدم لكل صفقة (3% = 3% من الرصيد) |
| `maxSlRiskPercentage` | Number | `6` | أقصى خسارة مسموح بها من SL (6% من الرصيد) |
| `enforceMaxSlLoss` | Boolean | `null` | تطبيق حد أقصى لخسارة SL؟ |

---

### ⚙️ إعدادات تنفيذ الأوامر

| الحقل | النوع | الافتراضي | الوصف |
|-------|-------|----------|-------|
| `orderMode` | `'market'|'limit'` | `'market'` | وضع تنفيذ الأوامر |
| `leverageMode` | `'default'|'fixed'` | `'default'` | طريقة تحديد الرافعة |
| `fixedLeverageValue` | Number | `10` | قيمة الرافعة الثابتة (إذا fixed) |
| `errorMitigationEnabled` | Boolean | `true` | تفعيل التصحيح التلقائي للأخطاء (SL/TP مفقود) |

---

### 📉 إعدادات وقف الخسارة المتحرك

| الحقل | النوع | الافتراضي | الوصف |
|-------|-------|----------|-------|
| `volatilitySlEnabled` | Boolean | `false` | تفعيل SL النسبي (Volatility-based) |
| `volatilitySlPercentage` | Number | `5` | نسبة SL من سعر الدخول (مثلاً 5% = SL بعد 5% من Entry) |

**المعادلة:**
```
LONG:  SL = entryPrice × (1 - volatilitySlPercentage / 100)
SHORT: SL = entryPrice × (1 + volatilitySlPercentage / 100)
```

---

### 💥 وضع HITLAR

```typescript
hitlarModeEnabled: boolean           // default: false
hitlarSettings: {
    riskPercentage: number,          // default: 3
    leverage: number,                // default: 20
    volatilitySlPercentage: number,  // default: 5
    capitalProtectionEnabled: boolean, // default: false
    orderMode: 'limit' | 'market'   // default: 'limit'
}
```

**الوضع HITLAR** هو وضع تداول عدواني يستخدم:
- رافعة مالية أعلى (20x افتراضياً)
- أوامر محدودة (limit) بدلاً من السوقية
- حماية رأس المال اختيارية

---

### 🎯 إعدادات تنفيذ الأهداف

| الحقل | النوع | الافتراضي | الوصف |
|-------|-------|----------|-------|
| `tpExecutionMode` | `'single'|'multiple'` | `'multiple'` | هدف واحد أم متعدد |
| `autoBreakEven` | Boolean | `true` | نقل SL لنقطة الدخول بعد TP1 |
| `tpSplitMode` | `'auto'|'manual'` | `'auto'` | توزيع تلقائي أم يدوي |
| `tpProfitSplits` | Number[] | `[50, 50]` | نسب البيع عند كل هدف |

**مثال:** `tpProfitSplits: [30, 70]` → بيع 30% عند TP1، 70% عند TP2.

---

### 📊 إعدادات التحليل

```typescript
analysisSettings: {
    scalpTF: string,      // default: '5m'  — الإطار السريع
    swingTF: string,      // default: '1h'  — الإطار البطيء
    candleLimit: number,  // default: 200   — عدد الشمعات
    rsiThreshold: number  // default: 30    — حد RSI للإشارة
}
```

---

### 🧪 إعدادات الـ Backtest

```typescript
backtestSettings: {
    interval: string,            // default: '15m' — خطوة الزمن
    initialCapital: number,      // default: 1000  — رأس المال الابتدائي USDT
    marginMode: 'ISOLATED'|'CROSS', // default: 'ISOLATED'
    leverage: number,            // default: 10x
    riskSizingEnabled: boolean,  // default: false
    riskPercentage: number,      // default: 3%
    maxSlCapEnabled: boolean,    // default: false
    maxSlPercentage: number,     // default: 5%
    fullReportEnabled: boolean   // default: false
}
```

---

## 🔄 كيف يُستخدم في النظام

| الموقع | الاستخدام |
|--------|----------|
| `TradeManager.executeSignal()` | `User.findById(userId)` ← جلب الإعدادات قبل التنفيذ |
| `PositionMonitor.checkPositions()` | `UserModel.findById(trade.userId)` ← جلب إعدادات التحذيرات |
| `settingsHandlers.ts` | قراءة وتحديث كل الإعدادات عبر Telegram |
| `BacktestService` | `user.backtestSettings` ← إعدادات المحاكاة |
| `ReportingService` | `User.find({ isActive: true })` ← قائمة المستخدمين النشطين |
