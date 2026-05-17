# 🛡️ V6Engine.ts — محرك Sniper مع جدار حماية زمني

> **الموقع:** `src/services/engines/V6Engine.ts`  
> **الدور:** محرك متطور يُضيف **جدار حماية زمني (Timeframe Firewall)** — أي مصفوفة منفصلة لكل من Scalp و Swing. يعتمد على فلاتر Price Action لمنع الدخول في الاتجاه الخاطئ.

---

## 📋 نظرة عامة

| الخاصية | القيمة |
|---------|--------|
| **الابتكار الرئيسي** | مصفوفة منفصلة لـ Scalp ومصفوفة منفصلة لـ Swing |
| **فلاتر الحماية** | 4 حالات (A, B, C, D) تمنع الدخول العكسي |
| **SL/TP** | بناءً على lastSwingHigh/lastSwingLow + ATR |
| **يستخدم** | VWAP + Matrix (منفصلة) + Divergence + Price Action |

---

## 🔧 الابتكار الأول: جدار الحماية الزمني

```typescript
// إطارات الـ Scalp (قصيرة)
const scalpTFs = ['1m', '3m', '5m', '15m', '30m'];
const scalpMatrix = TechnicalAnalyzer.calculateMatrix(allTimeframes, scalpTFs);

// إطارات الـ Swing (طويلة)
const swingTFs = ['1h', '4h', '1d'];
const swingMatrix = TechnicalAnalyzer.calculateMatrix(allTimeframes, swingTFs);
```

**لماذا هذا مهم؟**
- في V1-V3: مصفوفة واحدة لكل الإطارات → الإطار اليومي (وزن 15) يطغى على الدقيقة (وزن 1)
- في V6: Scalp يرى مصفوفته القصيرة فقط، Swing يرى مصفوفته الطويلة فقط

```
scalpMatrix → يُحسب من: 1m, 3m, 5m, 15m, 30m
               أوزانها: 1+2+3+4+5 = 15 (مجموع أقصى)

swingMatrix → يُحسب من: 1h, 4h, 1d
               أوزانها: 8+12+15 = 35 (مجموع أقصى)
```

---

## 🧮 العملية الحسابية: `runSniperLogic`

### الخطوة 1: حساب النقاط الأساسية

```typescript
// VWAP (±25 نقطة)
if (cp > vwap):  score += 25
else:            score -= 25

// Matrix (المصفوفة المنفصلة ±40 نقطة)
const matrixScore = (m.percentage - 50) × 0.8
score += matrixScore

// RSI (±15 نقطة)
if (data.rsi < 35): score += 15
if (data.rsi > 65): score -= 15
```

### الخطوة 2: تحديد الاتجاه الأولي

```typescript
type = score >= 0 ? 'LONG' : 'SHORT'
winRate = min(50 + |score| × 0.6, 96)
```

---

### 🔐 الخطوة 3: Price Action & Radar Firewall (4 حالات)

```typescript
const div = TechnicalAnalyzer.detectDivergence(ohlcv, type);
```

#### الحالة A — حماية SHORT في سوق صاعد قوي
```typescript
if (type === 'SHORT' && m.percentage >= 55 && cp > data.levels.lastSwingLow):
    type = 'NONE'
    reason = "حماية: لم يتم كسر القاع اللحظي"
```
**المنطق:** لا تبيع في سوق صاعد (55%+) ما لم يُكسر أدنى قاع حديث.  
**الشمعات:** lastSwingLow محسوب من آخر 15 شمعة.

#### الحالة B — حماية SHORT بدون تأكيد راداري
```typescript
if (type === 'SHORT' && m.percentage >= 50 && !div.detected):
    type = 'NONE'
    reason = "حماية: رادار التصحيح لا يدعم الهبوط حالياً"
```
**المنطق:** لا تبيع إلا إذا كانت هناك Bearish Divergence تؤكد الضعف.

#### الحالة C — حماية LONG في سوق هابط قوي
```typescript
if (type === 'LONG' && m.percentage <= 45 && cp < data.levels.lastSwingHigh):
    type = 'NONE'
    reason = "حماية: لم يتم اختراق القمة اللحظية"
```
**المنطق:** لا تشتري في سوق هابط (45%−) ما لم يُخترق أعلى قمة حديثة.

#### الحالة D — حماية LONG بدون تأكيد راداري
```typescript
if (type === 'LONG' && m.percentage <= 50 && !div.detected):
    type = 'NONE'
    reason = "حماية: رادار التصحيح لا يدعم الصعود حالياً"
```

#### ماذا يحدث عند type = 'NONE'?
```typescript
return {
    status: `🚫 صفقة ملغاة (${rejectionReason})`,
    type: 'NONE',
    entry: cp, tp: 0, sl: 0,
    timeEstimate: 0, winRate: 0, reverseProb: 0,
    rejectionReason
};
```

---

### الخطوة 4: حساب TP/SL ديناميكي

```typescript
const slDistance = data.atr × 2.5;

// LONG
tp = max(lastSwingHigh, cp + atr×2)
sl = min(cp - slDistance, lastSwingLow - atr×0.5)

// SHORT
tp = min(lastSwingLow, cp - atr×2)
sl = max(cp + slDistance, lastSwingHigh + atr×0.5)
```

**الشمعات:** lastSwingHigh/lastSwingLow محسوبان من آخر **15 شمعة**.

**منطق الـ LONG:**
- TP: الأعلى بين (أعلى قمة حديثة) أو (cp + ATR×2) ← الهدف
- SL: الأدنى بين (cp - ATR×2.5) أو (أدنى قاع - هامش أمان) ← الحماية

---

## 📊 مقارنة V6 مع V3

| الجانب | V3 | V6 |
|--------|----|----|
| **المصفوفة** | موحدة (7 إطارات) | منفصلة (Scalp 5 + Swing 3) |
| **هيكل السوق** | ✅ الطبقة 1 أساسية | ❌ لا يستخدمه |
| **Macro Confirmation** | ✅ الطبقة 3 (+20/-20) | ❌ لا |
| **VWAP Confluence** | ✅ تفصيلية (+25/-10) | ✅ بسيطة (+25/-25) |
| **MACD** | ✅ الطبقة 5 | ❌ لا |
| **Price Action Firewall** | ❌ لا | ✅ 4 حالات |
| **ضمان R/R** | ✅ 1:1.5 | ❌ لا |
| **SL** | مستويات S2/lastSwingLow | lastSwingLow ± ATR×0.5 |
| **عدد الطبقات الفعلية** | 8 | ~4 |

---

## 🎯 متى يتفوق V6 على V3؟

- **في Scalp القصير:** المصفوفة المنفصلة تعطي صورة أوضح للدقائق القصيرة
- **في الأسواق الجانبية:** فلاتر Price Action تمنع الدخول العشوائي
- **عندما يكون الـ Swing مخالفاً للـ Scalp:** V6 يرى كل منهما باستقلالية

---

## ⚠️ محدودية V6

1. **لا طبقة هيكل السوق** — يفتقر لفحص HH/HL
2. **لا ضمان R/R** — قد يكون TP قريباً جداً من Entry
3. **لا Macro Confirmation** — لا يتحقق من الإطار الأكبر بشكل منفصل
4. **فلاتر قد تكون مفرطة** — الحالة B و D تتطلب Divergence دائماً
