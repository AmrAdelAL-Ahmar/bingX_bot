# 🔮 V5Engine.ts — محرك التنبؤ الخطي (Predictive AI)

> **الموقع:** `src/services/engines/V5Engine.ts`  
> **الدور:** محرك يعتمد على **الانحدار الخطي (Linear Regression)** للتنبؤ بالسعر القادم. بدلاً من فلترة الإشارات، يتنبأ بالسعر المستقبلي ويقرر الاتجاه بناءً على ذلك.

---

## 📋 نظرة عامة

| الخاصية | القيمة |
|---------|--------|
| **المنهجية** | تنبؤ إحصائي (Predictive) وليس فلترة |
| **الشمعات** | آخر 20 شمعة من Quick/Swing TF |
| **لا يستخدم** | هيكل السوق / Divergence / VWAP / Matrix مباشرة |
| **SL** | ATR × 4 (أوسع مدى لاستيعاب التذبذب) |
| **TP** | السعر المتنبأ به |
| **نقاط القوة** | موضوعي، يعكس الزخم الإحصائي |
| **نقاط الضعف** | قد لا يراعي الأحداث المفاجئة |

---

## 🔧 تدفق العمل

```
analyze(cp, vwap, allTimeframes, mtfOHLCV, options)
        │
        ├─ calculateMatrix(allTimeframes) → MatrixResult
        │
        ├─ scalpData  = allTimeframes[quickTF] أو '5m'
        ├─ swingData  = allTimeframes[longTF] أو '1h'
        ├─ scalpOHLCV = mtfOHLCV[quickTF] أو '5m'
        ├─ swingOHLCV = mtfOHLCV[longTF] أو '1h'
        │
        ├─ analyzeScalp(cp, scalpData, scalpOHLCV)
        │       └─ runPredictiveLogic(cp, data, ohlcv)
        │
        └─ analyzeSwing(cp, swingData, swingOHLCV)
                └─ runPredictiveLogic(cp, data, ohlcv)
```

**ملاحظة:** كلا الدالتين تستخدمان نفس `runPredictiveLogic`.

---

## 🧮 العملية الحسابية: `runPredictiveLogic`

### الخطوة 1: التنبؤ بالسعر

```typescript
const pred = TechnicalAnalyzer.predictNextPriceLinear(ohlcv, 20);
```

**الشمعات:** آخر **20 شمعة** من OHLCV الخام.

**المعادلات الرياضية (داخل TechnicalAnalyzer):**

```
n = min(20, عدد الشمعات المتاحة)
x = رقم الشمعة (1, 2, 3, ..., n)
y = سعر الإغلاق لكل شمعة

ΣX   = 1+2+3+...+n = n(n+1)/2
ΣY   = مجموع أسعار الإغلاق
ΣXY  = Σ(x × y)
ΣX²  = Σ(x²)

الميل: m = (n×ΣXY - ΣX×ΣY) / (n×ΣX² - (ΣX)²)
التقاطع: b = (ΣY - m×ΣX) / n
السعر المتنبأ: predictedPrice = m × (n+1) + b
```

**مثال توضيحي:**
```
إذا كانت آخر 5 أسعار: [100, 101, 102, 103, 104]
الخط يمتد بشكل صاعد → m > 0
predictedPrice = قيمة عند x=6 ≈ 105
trendDirection = 'UP'
```

### الخطوة 2: تحديد الاتجاه

```typescript
const type = pred.predictedPrice > cp ? 'LONG' : 'SHORT';
```

| الشرط | الاتجاه |
|-------|---------|
| السعر المتنبأ > السعر الحالي | LONG |
| السعر المتنبأ < السعر الحالي | SHORT |

### الخطوة 3: حساب نسبة الثقة (winRate)

```typescript
const winRate = Math.min(70 + (pred.confidence * 0.1), 96);
```

حيث `pred.confidence = |m| × 1000`:

| ميل الخط | confidence | winRate |
|---------|-----------|---------|
| 0.001 | 1 | 70.1% |
| 0.05 | 50 | 75% |
| 0.2 | 200 | 90% |
| 0.5+ | 500+ | 96% (سقف) |

**القاعدة:** كلما كان الخط الانحداري أكثر انحداراً (ميل أعلى)، زادت الثقة في التنبؤ.

### الخطوة 4: حساب TP و SL

```typescript
tp = pred.predictedPrice  // السعر المتنبأ به مباشرةً

sl = type === 'LONG'
    ? cp - (data.atr × 4)   // واسع لـ Scalp
    : cp + (data.atr × 4)   // واسع لـ Scalp
```

**لماذا ATR × 4؟**  
لأن التنبؤ الخطي قد يأخذ وقتاً للتحقق، وبالتالي يحتاج مساحة أوسع لتجنب وقف الخسارة المبكر.

### الخطوة 5: بناء النتيجة

```typescript
return {
    status: `🔮 V5 PREDICTIVE AI - Expected: $${pred.predictedPrice.toFixed(2)}`,
    type,
    entry: cp,
    tp: pred.predictedPrice,
    sl: cp ± (atr × 4),
    timeEstimate: data.timeframe.includes('m') ? 30 : 120,  // أطول من V1
    winRate,
    reverseProb: 100 - winRate,
    signalReason: `Predicted: $${pred.predictedPrice} vs Current: $${cp} (Confidence: ${pred.confidence}%)`
};
```

---

## 📊 مقارنة V5 مع V1 و V3

| الجانب | V1 (احتمالي) | V3 (Sniper) | V5 (Predictive) |
|--------|-------------|------------|----------------|
| **الأساس** | VWAP+Matrix+RSI | 8 طبقات هيكلية | انحدار خطي |
| **الشمعات المستخدمة** | بيانات محسوبة فقط | 20+ شمعة خام | 20 شمعة إغلاق فقط |
| **الإلغاء** | ❌ لا | ✅ في حالات كثيرة | ❌ لا |
| **أدنى winRate** | 50% | 0% | 70% |
| **SL** | ATR × 2.5 | مستويات تقنية | ATR × 4 |
| **TP** | MA7 أو ATR×2 | R1/fibTarget | predictedPrice |
| **وقت الصفقة** | 20/90 دقيقة | 20/90 دقيقة | 30/120 دقيقة |

---

## ⚠️ محدودية المحرك

1. **لا يأخذ هيكل السوق بعين الاعتبار** — يتنبأ حتى لو السوق هابط بقوة
2. **الانحدار الخطي بسيط** — لا يحاكي الموجات والأنماط المعقدة
3. **SL واسع جداً** — ATR×4 قد يعني خسارة كبيرة عند الاستيقاف
4. **لا توافق MTF** — لا يتحقق من الإطارات الأكبر
