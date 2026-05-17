# 📝 Trade.ts — نموذج بيانات الصفقة

> **الموقع:** `src/models/Trade.ts`  
> **الدور:** يعرّف هيكل بيانات كل صفقة تداول في MongoDB. يتتبع حالة الصفقة من الفتح حتى الإغلاق.

---

## 📋 جميع حقول الـ Schema

### 🔑 الحقول الأساسية

| الحقل | النوع | الوصف |
|-------|-------|-------|
| `userId` | ObjectId | رابط بجدول المستخدمين (`ref: 'User'`) |
| `symbol` | String | رمز العملة مثل `'BTC/USDT:USDT'` |
| `direction` | `'LONG'|'SHORT'` | اتجاه الصفقة |
| `entryPrice` | Number | سعر الدخول الفعلي (من البورصة) |
| `stopLoss` | Number | سعر وقف الخسارة |
| `leverage` | Number | الرافعة المالية (default: 10) |
| `amount` | Number | حجم الصفقة بـ USDT (القيمة الكاملة) |
| `pnl` | Number | الربح/الخسارة المئوي (default: 0) |

### 🎯 الأهداف

```typescript
targets: [{
    price: Number,  // سعر الهدف
    hit: Boolean    // هل تحقق؟ (default: false)
}]
```

**مثال:** `targets: [{ price: 65000, hit: false }, { price: 67000, hit: false }]`

### 📊 حالات الصفقة

```
'PENDING'        → أمر محدود (Limit) لم ينفَّذ بعد
'OPEN'           → صفقة مفتوحة ونشطة
'TP1_HIT'        → ضُرب الهدف الأول
'TP2_HIT'        → ضُرب الهدف الثاني
'TP3_HIT'        → ضُرب الهدف الثالث
'CLOSED_PROFIT'  → أُغلقت برباح (ضرب TP)
'CLOSED_LOSS'    → أُغلقت بخسارة (ضرب SL)
'CANCELLED'      → ملغية (مثلاً أمر حدي مُلغى)
```

### 🔗 حقول التتبع

| الحقل | النوع | الوصف |
|-------|-------|-------|
| `bingxOrderId` | String | معرّف الأمر في منصة BingX |
| `binanceOrderId` | String | معرّف الأمر في منصة Binance |
| `entryTime` | Date | وقت فتح الصفقة (default: now) |
| `closeTime` | Date | وقت إغلاق الصفقة |
| `sourceChatId` | String | مجموعة/قناة مصدر الإشارة |
| `isBreakEvenSet` | Boolean | هل نُقل SL لنقطة الدخول؟ |
| `logs` | String[] | سجل أحداث الصفقة |

### ⚠️ حقول التحذيرات

| الحقل | النوع | الوصف |
|-------|-------|-------|
| `slWarningSent` | Boolean | هل أُرسل تحذير SL؟ (لمنع التكرار) |
| `triggeredTpWarnings` | Number[] | النسب التي أُرسلت عندها تحذيرات TP |
| `correctionAlertEnabled` | Boolean | هل تنبيه التصحيح مفعّل؟ |
| `correctionWarningSent` | Boolean | هل أُرسل تحذير التصحيح؟ |

---

## 💰 معادلة PnL

```
PnL% = لكل LONG:
    ((currentPrice - entryPrice) / entryPrice) × 100 × leverage

PnL% = لكل SHORT:
    ((entryPrice - currentPrice) / entryPrice) × 100 × leverage

مبلغ الربح/الخسارة = margin × (PnL% / 100)
حيث: margin = amount / leverage
```

---

## 🔄 دورة حياة الصفقة

```
TradeManager.executeSignal()
    └── new Trade({ status: 'PENDING'|'OPEN' })
        └── trade.save()
              │
              ▼
    PositionMonitor.checkPositions() [كل 30 ثانية]
        ├── PENDING → يتحقق من البورصة → OPEN
        ├── OPEN → يتحقق من الموقف:
        │    ├── لا يزال مفتوح → تحقق من تحذيرات TP/SL
        │    └── أُغلق → CLOSED_PROFIT / CLOSED_LOSS
        └── trade.save() → حفظ التغييرات
```

---

## 🔗 كيف يُستخدم في النظام

| الموقع | الاستخدام |
|--------|----------|
| `TradeManager` | إنشاء وحفظ الصفقات الجديدة |
| `PositionMonitor` | قراءة وتحديث حالة الصفقات |
| `ReportingService` | إحصاء الصفقات للتقارير |
| `portfolioHandlers` | عرض الصفقات المفتوحة للمستخدم |
