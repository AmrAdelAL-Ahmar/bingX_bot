# ⚡ V1Engine.ts — المحرك الاحتمالي الأساسي

> **الموقع:** `src/services/engines/V1Engine.ts`  
> **الدور:** أبسط محرك في النظام. يعتمد على نقاط احتمالية (Score) تُبنى من 3 عوامل رئيسية: VWAP + Matrix + RSI.

---

## 📋 نظرة عامة

| الخاصية | القيمة |
|---------|--------|
| **عدد العوامل** | 3 عوامل |
| **لا يستخدم** | هيكل السوق / Divergence / OHLCV خام |
| **مناسب لـ** | التحليل السريع والعام |
| **نقاط القوة** | بسيط، سريع، لا يُلغي الإشارات |
| **نقاط الضعف** | لا يفلتر الدخول العكسي، لا طبقات حماية |

---

## 🔧 تدفق العمل

```
analyze(cp, vwap, allTimeframes, mtfOHLCV, options)
        │
        ├─ calculateMatrix(allTimeframes) → MatrixResult
        │
        ├─ scalpData = allTimeframes[quickTF] أو '5m'
        ├─ swingData = allTimeframes[longTF] أو '1h'
        │
        ├─ analyzeScalp(cp, scalpData, matrix, vwap)
        │       └─ runProbabilityLogic(cp, data, cp > vwap, m)
        │
        └─ analyzeSwing(cp, swingData, matrix, vwap)
                └─ runProbabilityLogic(cp, data, cp > vwap, m)
```

**ملاحظة:** كلا الدالتين (`analyzeScalp` و `analyzeSwing`) تستدعيان نفس الدالة `runProbabilityLogic` بدون أي فرق منطقي بينهما.

---

## 🧮 العملية الحسابية: `runProbabilityLogic`

### المدخلات
- `cp` — السعر الحالي
- `data` — `AnalysisDetails` للإطار المحلل (RSI, ATR, levels)
- `isAboveVWAP` — هل السعر فوق VWAP؟
- `m` — MatrixResult (نسبة التوافق)

---

### الخطوة 1: عامل VWAP (±25 نقطة)

```typescript
if (cp > vwap):  score += 25  // "Price > VWAP (+25)"
else:            score -= 25  // "Price < VWAP (-25)"
```

| الحالة | النقاط | التفسير |
|--------|--------|---------|
| فوق VWAP | +25 | تأييد مؤسساتي للصعود |
| تحت VWAP | -25 | ضغط مؤسساتي للهبوط |

---

### الخطوة 2: عامل Matrix (متغير ±40 نقطة)

```typescript
const matrixScore = (m.percentage - 50) * 0.8;
score += matrixScore;
```

| نسبة Matrix | matrixScore | المعنى |
|-------------|-------------|--------|
| 100% | +40 | كل الإطارات صاعدة |
| 75% | +20 | أغلبية صاعدة |
| 50% | 0 | محايد |
| 25% | -20 | أغلبية هابطة |
| 0% | -40 | كل الإطارات هابطة |

---

### الخطوة 3: عامل RSI (±15 نقطة)

```typescript
if (data.rsi < 35):   score += 15   // "RSI < 35 (+15)"
else if (data.rsi > 65): score -= 15 // "RSI > 65 (-15)"
else:                               // "RSI Neutral (0)"
```

| الحالة | النقاط | التفسير |
|--------|--------|---------|
| RSI < 35 | +15 | تشبع بيعي → ارتداد صاعد محتمل |
| RSI > 65 | -15 | تشبع شرائي → تصحيح محتمل |
| 35-65 | 0 | منطقة محايدة |

---

### الخطوة 4: حساب النتيجة النهائية

```typescript
// النوع: يُحدَّد بإشارة Score
const type = score >= 0 ? 'LONG' : 'SHORT';

// نسبة النجاح: تزداد كلما زاد Score بعيداً عن الصفر
const winRate = Math.min(50 + (Math.abs(score) * 0.6), 96);

// SL: بناءً على ATR × 2.5
const slDistance = data.atr * 2.5;

// TP: الأبعد بين MA7 والـ ATR×2
// LONG:  max(ma7, cp + atr×2)
// SHORT: min(ma7, cp - atr×2)
```

**أقصى winRate ممكن:** 96% (سقف مقيد).

**مثال حسابي:**
```
cp = 100, vwap = 98 → isAboveVWAP = true  → score += 25
matrix = 70%         → matrixScore = (70-50)×0.8 = +16  → score += 16
RSI = 42             → محايد                             → score += 0

score = 41
type = LONG
winRate = min(50 + 41×0.6, 96) = min(74.6, 96) = 74.6%

slDistance = atr × 2.5
SL = cp - slDistance = 100 - (atr×2.5)
TP = max(ma7, 100 + atr×2)
```

---

### الخطوة 5: بناء TradeRecommendation

```typescript
return {
    status: '🟢 احتمالية صعود (74.6%)',
    type: 'LONG',
    entry: cp,          // السعر الحالي
    tp: max(ma7, cp + atr×2),
    sl: cp - atr×2.5,
    timeEstimate: data.timeframe.includes('m') ? 20 : 90,  // دقيقة
    winRate: 74.6,
    reverseProb: 25.4,
    confidenceScore: 41,
    signalReason: "Score: 41 | Factors: [Price > VWAP (+25), Matrix 70% (+16), RSI Neutral (0)]"
};
```

---

## 📊 نطاقات النقاط الممكنة

| أدنى حالة | أعلى حالة |
|-----------|-----------|
| VWAP: -25 | VWAP: +25 |
| Matrix 0%: -40 | Matrix 100%: +40 |
| RSI: -15 | RSI: +15 |
| **الإجمالي: -80** | **الإجمالي: +80** |

- عند score = 80: winRate = min(50 + 80×0.6, 96) = 96%
- عند score = -80: type=SHORT, winRate = min(50 + 80×0.6, 96) = 96%
- عند score = 0: type=LONG, winRate = 50%

---

## 🔄 الفرق عن المحركات الأخرى

| الجانب | V1 | V3 | V6 |
|--------|----|----|-----|
| طبقات الحماية | ❌ لا | ✅ 8 طبقات | ✅ 4 طبقات |
| هيكل السوق | ❌ لا | ✅ نعم | ❌ لا |
| Divergence | ❌ لا | ✅ نعم | ✅ نعم |
| SL/TP ديناميكي | ❌ ATR فقط | ✅ مستويات تقنية | ✅ Swing levels |
| يُلغي الإشارات | ❌ لا | ✅ في حالات كثيرة | ✅ في 4 حالات |
