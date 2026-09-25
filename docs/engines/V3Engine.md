# 🎯 V3Engine.ts — محرك Sniper متعدد الطبقات

> **الموقع:** `src/services/engines/V3Engine.ts`  
> **الدور:** المحرك الأقوى والأكثر تطوراً. يعتمد على **8 طبقات تحليل متتالية** حيث تتحكم كل طبقة في السماح بتمرير الإشارة أو إلغائها. يدعم وضعين: `SCALP` و `SWING`.

---

## 📋 نظرة عامة

| الخاصية | القيمة |
|---------|--------|
| **عدد الطبقات** | 8 طبقات |
| **الإشارات الممكنة** | LONG / SHORT / NEUTRAL (ملغاة) |
| **التحقق من** | هيكل السوق + Divergence + RSI + Macro + VWAP + MACD + Matrix |
| **SL/TP** | ديناميكي بناءً على مستويات تقنية |
| **ضمان R/R** | 1:1.5 كحد أدنى |
| **نقاط القوة** | فلترة عالية، قرارات ذكية، R/R مضمون |

---

## 🔧 تدفق العمل الرئيسي

```
analyze(cp, vwap, allTimeframes, mtfOHLCV, options)
        │
        ├─ calculateMatrix(allTimeframes)
        │
        ├─ scalpData  = allTimeframes[quickTF] أو '5m'
        ├─ scalpOHLCV = mtfOHLCV[quickTF] أو '5m'
        ├─ swingData  = allTimeframes[longTF] أو '1h'
        ├─ swingOHLCV = mtfOHLCV[longTF] أو '1h'
        │
        ├─ scalpMacro = allTimeframes['1h']         ← تأكيد الماكرو للـ Scalp
        ├─ swingMacro = allTimeframes['4h'] أو '1h' ← تأكيد الماكرو للـ Swing
        │
        ├─ runProbabilityLogic(scalp...)
        └─ runProbabilityLogic(swing...)
```

---

## 🧮 الطبقات الثماني التفصيلية

---

### 🔴 الطبقة 1 — Market Structure Filter (فلتر هيكل السوق)

**الغرض:** تحديد اتجاه الصفقة (LONG / SHORT) بناءً على هيكل السوق.  
**الشمعات المستخدمة:** آخر 30 شمعة (من `AnalysisDetails.structure`).

```typescript
struct = data.structure  // مثال: "صاعد (HH/HL) 📈"

isBullish  = struct.includes('صاعد')
isBearish  = struct.includes('هابط')
isSideways = struct.includes('عرضي')
isBOS      = struct.includes('كسر هيكل')
```

**منطق القرار:**

| الهيكل | الشرط الإضافي | الاتجاه |
|--------|--------------|---------|
| صاعد | — | LONG |
| هابط | — | SHORT |
| عرضي | cp > levels.pivot | LONG |
| عرضي | cp < levels.pivot | SHORT |
| كسر هيكل (BOS) | cp > vwap | LONG |
| كسر هيكل (BOS) | cp < vwap | SHORT |
| غير واضح | — | NEUTRAL → إلغاء فوري |

**النقاط الإضافية:**
```
هيكل صاعد + LONG   → +15 نقطة
هيكل هابط + SHORT  → +15 نقطة
كسر هيكل (BOS)     → +8 نقاط إضافية
```

> ⚠️ إذا كانت النتيجة `NEUTRAL` → **الإلغاء الفوري** بدون فحص باقي الطبقات.

---

### 🛡️ الطبقة 2 — Divergence Shield (درع الانحراف)

**الغرض:** إلغاء الإشارة إذا كان هناك انحراف يعاكس الاتجاه المحدد.  
**الشمعات:** 20+ شمعة من OHLCV الخام (quick/swing TF).

```typescript
const div = TechnicalAnalyzer.detectDivergence(ohlcv, type);
if (div.detected) → cancel()  // إلغاء فوري
```

| type | نوع الانحراف المكشوف | السبب |
|------|---------------------|-------|
| LONG | Bearish Divergence | السعر يصعد + RSI يهبط → ضعف |
| SHORT | Bullish Divergence | السعر يهبط + RSI يصعد → ضعف |

---

### 🚫 حاجز RSI التشبع المطلق

**يعمل بين الطبقة 2 و 3 — يُلغي الإشارة فوراً:**

```typescript
if (type === 'SHORT' && data.rsi < 25):
    cancel()  // تشبع بيعي حاد → خطر ارتداد صاعد → لا تبيع!

if (type === 'LONG' && data.rsi > 75):
    cancel()  // تشبع شرائي حاد → خطر تصحيح → لا تشتري!
```

---

### 📡 الطبقة 3 — Macro Timeframe Confirmation

**الغرض:** التحقق من توافق الإطار الأكبر مع الاتجاه المحدد.  
**Scalp Macro:** إطار `1h` | **Swing Macro:** إطار `4h` (أو `1h` كبديل).

```typescript
if (type === 'LONG'):
    macroIsBullish → +20 نقطة  "توافق الفريم الأكبر"
    macroIsBearish → -20 نقطة  "الفريم الأكبر معاكس"

if (type === 'SHORT'):
    macroIsBearish → +20 نقطة
    macroIsBullish → -20 نقطة

// عقوبة RSI الماكرو
LONG  + macroRSI > 75 → -15 نقطة  "RSI ماكرو تشبع شرائي"
SHORT + macroRSI < 25 → -15 نقطة  "RSI ماكرو تشبع بيعي"
```

---

### 💧 الطبقة 4 — VWAP + RSI Confluence

**الغرض:** دمج إشارات VWAP والـ RSI مع الاتجاه.

**حساب مسافة VWAP:**
```typescript
const vwapDist = Math.abs(cp - vwap) / vwap * 100  // نسبة مئوية
```

**للـ LONG:**

| الحالة | النقاط |
|--------|--------|
| فوق VWAP بأقل من 0.3% | +10 (قريب جداً = اختراق قوي) |
| فوق VWAP بأكثر من 0.3% | +15 |
| تحت VWAP | -10 |
| RSI < 30 | +25 (ذعر بيعي) |
| RSI < 45 && cp > S1 | +15 (ارتداد من دعم) |
| RSI > 75 | -25 (تشبع خطير) |
| RSI > 60 | -10 |

**للـ SHORT:**

| الحالة | النقاط |
|--------|--------|
| تحت VWAP بأقل من 0.3% | +10 |
| تحت VWAP بأكثر من 0.3% | +15 |
| فوق VWAP | -10 |
| RSI > 70 | +25 (ذعر شرائي) |
| RSI > 55 && cp < R1 | +15 (ارتداد من مقاومة) |
| RSI < 25 | -25 (تشبع خطير) |
| RSI < 40 | -10 |

---

### 📈 الطبقة 5 — MACD Momentum

**الغرض:** تأكيد الزخم بناءً على MACD.

```typescript
const macdDiff = data.indicators.macd.macd - data.indicators.macd.signal;

// LONG
macdDiff > 0 → +10  "MACD تصاعدي"
macdDiff < 0 → -8   "MACD تنازلي"

// SHORT
macdDiff < 0 → +10  "MACD تنازلي"
macdDiff > 0 → -8   "MACD تصاعدي"
```

---

### 🗺️ الطبقة 6 — Matrix Direction Alignment

**الغرض:** مكافأة/عقوبة بناءً على توافق المصفوفة مع الاتجاه.

```typescript
const matrixBias = (m.percentage - 50); // موجب = صاعد، سالب = هابط

// LONG: المصفوفة الصاعدة تساعد
matBonus = matrixBias × 0.5
score += matBonus

// SHORT: المصفوفة الصاعدة تضر (عكسية)
matBonus = -matrixBias × 0.5
score += matBonus
```

**أمثلة:**
```
Matrix 80% للـ LONG:  matBonus = (80-50)×0.5 = +15 ✅
Matrix 80% للـ SHORT: matBonus = -(80-50)×0.5 = -15 ❌
Matrix 30% للـ SHORT: matBonus = -(30-50)×0.5 = +10 ✅
```

---

### 🎯 الطبقة 7 — Dynamic SL/TP (أهم طبقة)

**الغرض:** حساب SL/TP بناءً على مستويات تقنية حقيقية.

```typescript
const safetyBuffer = Math.max(data.atr × 0.5, cp × 0.002);
// مخزن أمان: على الأقل 0.2% من السعر أو 0.5×ATR
```

**للـ LONG:**
```
SL:
  candidateSL1 = lastSwingLow - safetyBuffer
  candidateSL2 = levels.s2
  sl = max(candidateSL1, candidateSL2)   ← الأبعد عن السعر = الأقرب لصفر
  sl = min(sl, cp × 0.994)               ← ضمان ≥ 0.6% تحت السعر

TP:
  candidateTP1 = levels.r1
  candidateTP2 = levels.fibTarget
  tp = max(r1, fibTarget, cp + atr×2)   ← الأبعد والأعلى
```

**للـ SHORT:**
```
SL:
  candidateSL1 = lastSwingHigh + safetyBuffer
  candidateSL2 = levels.r2
  sl = min(candidateSL1, candidateSL2)   ← الأقرب للسعر من الأعلى
  sl = max(sl, cp × 1.006)               ← ضمان ≥ 0.6% فوق السعر

TP:
  المرشحون = [s1, fib382].filter(v > 0 && v < cp)
  tp = min(...candidates) أو cp - atr×2  ← احتياطي
```

**ضمان R/R 1:1.5:**
```typescript
const riskDist   = |cp - sl|
const rewardDist = |tp - cp|

if (rewardDist < riskDist × 1.5):
    minRisk = max(riskDist, cp × 0.005)
    tp = LONG ? cp + minRisk×1.5 : cp - minRisk×1.5
    reason.push('تعديل TP لضمان R/R 1:1.5')
```

---

### 🏆 الطبقة 8 — Final Decision (القرار النهائي)

**الغرض:** تحديد قوة الإشارة بناءً على Score الإجمالي.

```typescript
winRate = max(0, min(50 + score × 0.75, 95))
```

| winRate | الإشارة | الحالة |
|---------|---------|--------|
| ≥ 72% | `🟢 شراء قوي` / `🔴 بيع قوي` | إشارة قوية |
| ≥ 60% | `🟡 شراء` / `🟠 بيع` | إشارة متوسطة |
| < 60% | `⚪ إشارة ضعيفة` | cancel() — لكن يعرض SL/TP كمرجع |

---

## ❌ دالة Cancel

```typescript
private cancel(cp, statusText, type, score, mode, reason, sl=0, tp=0): TradeRecommendation {
    return {
        status: statusText,
        type,
        entry: cp,
        tp: tp || cp,  // إذا لم يُحسب → السعر الحالي
        sl: sl || cp,
        timeEstimate: mode === 'SCALP' ? 20 : 90,
        winRate: 0,
        reverseProb: 0,
        confidenceScore: score,
        signalReason: reason || 'لم تتحقق شروط الدخول'
    };
}
```

**حالات الإلغاء:**
1. هيكل السوق غير واضح (NEUTRAL)
2. Divergence مكتشف
3. RSI < 25 مع SHORT أو RSI > 75 مع LONG
4. Score منخفض جداً (winRate < 60%)

---

## ⏱️ وقت الصفقة المتوقع

```typescript
timeEstimate = mode === 'SCALP' ? 20 : 90  // دقيقة
```

---

## 📊 ملخص النقاط القصوى

| الطبقة | أقصى إيجابي | أقصى سلبي |
|--------|------------|----------|
| هيكل السوق | +23 (+15 هيكل +8 BOS) | 0 |
| الطبقة 3 (Macro) | +20 | -35 |
| الطبقة 4 (VWAP+RSI) | +40 | -35 |
| الطبقة 5 (MACD) | +10 | -8 |
| الطبقة 6 (Matrix) | ~+25 | ~-25 |
| **الإجمالي** | ~**+118** | ~**-103** |
