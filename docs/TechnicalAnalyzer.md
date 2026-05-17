# 📐 TechnicalAnalyzer.ts — محرك الحسابات التقنية

> **الموقع:** `src/services/TechnicalAnalyzer.ts`  
> **الدور:** المكتبة المركزية لجميع الحسابات الرياضية والتقنية في النظام. لا يجلب بيانات من الإنترنت — يستقبل الشمعات (OHLCV) ويُعيد المؤشرات والمستويات.

---

## 📋 الثوابت العامة

```typescript
export const TF_WEIGHTS: Record<string, number> = {
    '1m': 1,  '3m': 2,  '5m': 3,  '15m': 4,
    '30m': 5, '1h': 8,  '4h': 12, '1d': 15
};

export const MATRIX_TFS = ['1m', '5m', '15m', '30m', '1h', '4h', '1d'];
```

- **TF_WEIGHTS:** أوزان الإطارات الزمنية في حساب مصفوفة الاتجاه. الإطار اليومي له وزن 15 مقابل وزن 1 للدقيقة الواحدة.
- **MATRIX_TFS:** الإطارات المستخدمة في حساب المصفوفة الشاملة.

---

## 🔧 الدوال التفصيلية

---

### 1. `prepareCandleData(ohlcv: OHLCV[]): CandleData`

**الغرض:** تحويل مصفوفة الشمعات الخام إلى كائن منظم يسهل استخدامه.

```
المدخل:  مصفوفة OHLCV[] (timestamp, open, high, low, close, volume)
المخرج:  CandleData {
           closes[], highs[], lows[], volumes[],
           last (آخر شمعة), prev (قبل الأخيرة), all[]
         }
```

**الاستخدام:** تُستدعى داخلياً من `calculateTechnicalData` قبل أي حساب.

---

### 2. `calculateIndicators(data: CandleData): IndicatorData`

**الغرض:** حساب جميع المؤشرات التقنية دفعة واحدة.

---

#### 📊 جدول تفصيلي لكل مؤشر

| المؤشر | الفترة | أدنى شمعات | الإطارات | الحساب |
|--------|--------|-----------|----------|--------|
| **RSI** | 14 | 15+ | جميع الإطارات | `RSI.calculate({period:14, values:closes})` |
| **MACD** | Fast=12, Slow=26, Signal=9 | 35+ | جميع الإطارات | `MACD.calculate({fastPeriod:12, slowPeriod:26, signalPeriod:9})` |
| **Bollinger Bands** | 20, stdDev=2 | 20+ | جميع الإطارات | `BollingerBands.calculate({period:20, stdDev:2})` |
| **StochRSI** | RSI=14, Stoch=14, K=3, D=3 | 45+ | جميع الإطارات | `StochasticRSI.calculate({rsiPeriod:14, stochasticPeriod:14, kPeriod:3, dPeriod:3})` |
| **CCI** | 20 | 20+ | جميع الإطارات | `CCI.calculate({period:20, high, low, close})` |
| **WilliamsR** | 14 | 15+ | جميع الإطارات | `WilliamsR.calculate({period:14, high, low, close})` |
| **MFI** | 14 | 15+ | جميع الإطارات | `MFI.calculate({period:14, high, low, close, volume})` |
| **ATR** | 14 | 15+ | جميع الإطارات | `ATR.calculate({period:14, high, low, close})` |

**ملاحظة:** جميع المؤشرات تأخذ `slice(-1)[0]` — أي **آخر قيمة فقط** من مصفوفة النتائج.

---

#### تفاصيل حساب MACD

```
MACD Line    = EMA(12) - EMA(26)
Signal Line  = EMA(9) of MACD Line
Histogram    = MACD Line - Signal Line
```
- يُستخدم `SimpleMAOscillator: false` و `SimpleMASignal: false` → EMA وليس SMA.
- القيمة الإيجابية للـ Histogram = زخم صاعد.

#### تفاصيل حساب StochRSI

```
RSI(14) → أخذ آخر 14 قيمة → Stochastic(14) → تنعيم K(3) و D(3)
النتيجة: قيمة K بين 0-100
```
- `< 20` = منطقة تشبع بيعي (إشارة شراء)
- `> 80` = منطقة تشبع شرائي (إشارة بيع)

---

### 3. `calculateTechnicalData(ohlcv, tf, vwap): AnalysisDetails`

**الغرض:** الدالة الرئيسية التي تُجمّع كل الحسابات وتُعيد تحليلاً كاملاً لإطار زمني واحد.

**المدخلات:**
- `ohlcv[]` — شمعات الإطار الزمني (200+ شمعة)
- `tf` — اسم الإطار مثل `'5m'`, `'1h'`
- `vwap` — قيمة VWAP المحسوبة مسبقاً من `1d`

**تسلسل الحسابات الداخلية:**

```
1. prepareCandleData(ohlcv)
2. SMA(20) → isBullishTrend = close > SMA20
3. RSI(14) → آخر قيمة
4. ATR(14) → آخر قيمة
5. آخر 15 شمعة → lastSwingHigh, lastSwingLow
6. حساب مستويات Pivot, R1, S1, R2, S2
7. SMA(7), SMA(99)
8. آخر 50 شمعة → Fibonacci 0.382, 0.618, Target
9. calculateIndicators() → MACD, BB, StochRSI, CCI, WilliamsR, MFI
10. detectMarketStructure()
```

---

### 4. مستويات الدعم والمقاومة (Pivot Points)

**المدخل:** آخر شمعة مغلقة `prev` (شمعة واحدة تكفي).

```
Pivot = (prev.high + prev.low + prev.close) / 3

R1 = (2 × Pivot) - prev.low        ← أول مقاومة
S1 = (2 × Pivot) - prev.high       ← أول دعم

R2 = Pivot + (prev.high - prev.low) ← ثاني مقاومة
S2 = Pivot - (prev.high - prev.low) ← ثاني دعم
```

**الإطارات:** يُحسب على **جميع الإطارات** (1m, 5m, 15m, 30m, 1h, 4h, 1d).  
**الشمعات:** يكفي `prev` أي آخر 2 شمعة.

---

### 5. مستويات فيبوناتشي (Fibonacci)

**المدخل:** آخر **50 شمعة** من الإطار المحلل.

```typescript
const fibCandles = ohlcv.slice(-50);
const maxH = Math.max(...fibCandles.map(c => c.high));
const minL = Math.min(...fibCandles.map(c => c.low));
const diff = maxH - minL;

fib618   = maxH - (diff × 0.382)   ← المستوى الذهبي (تصحيح 61.8%)
fib382   = maxH - (diff × 0.618)   ← مستوى التصحيح (38.2%)
fibTarget = maxH + (diff × 0.618)  ← هدف الامتداد
```

**الإطارات:** يُحسب على **جميع الإطارات** (1m, 5m, 15m, 30m, 1h, 4h, 1d).  
**الشمعات:** آخر 50 شمعة.

---

### 6. `detectMarketStructure(data: CandleData): string`

**الغرض:** تحديد هيكل السوق (صاعد / هابط / عرضي / كسر هيكل).

**الشمعات:** آخر **30 شمعة**.

```
recent = آخر 30 شمعة
lastH  = أعلى نقطة في آخر شمعة
prevH  = أعلى نقطة في الـ 10 شمعات قبل الأخيرة (slice(-10, -1))
lastL  = أدنى نقطة في آخر شمعة
prevL  = أدنى نقطة في الـ 10 شمعات قبل الأخيرة
```

| الشرط | النتيجة |
|-------|---------|
| `lastH > prevH && lastL > prevL` | `"صاعد (HH/HL) 📈"` — قمم وقيعان متصاعدة |
| `lastH < prevH && lastL < prevL` | `"هابط (LH/LL) 📉"` — قمم وقيعان متنازلة |
| `lastH > prevH && lastL < prevL` | `"كسر هيكل (BOS) ⚡"` — توسع المدى |
| غير ذلك | `"عرضي ↔️"` — حركة جانبية |

---

### 7. `calculateVWAP(ohlcv: OHLCV[]): number`

**الغرض:** حساب المتوسط المرجح بالحجم (Volume Weighted Average Price).

**⚠️ مهم:** يُحسب **حصراً** على شمعات `1d` في كل النظام.

```typescript
const vwapValues = VWAP.calculate({
    high: [...], low: [...], close: [...], volume: [...]
});
return vwapValues[vwapValues.length - 1]; // آخر قيمة
```

**المعادلة الداخلية للمكتبة:**
```
TP (Typical Price) = (high + low + close) / 3
VWAP = Σ(TP × Volume) / Σ(Volume)
```

**الإطار:** `1d` فقط (200 شمعة يومية).

---

### 8. `calculateMatrix(allTimeframes, targetTFs?): MatrixResult`

**الغرض:** حساب نسبة التوافق الصعودي/الهبوطي عبر جميع الإطارات الزمنية.

**الإطارات:** `['1m', '5m', '15m', '30m', '1h', '4h', '1d']` افتراضياً.  
*يمكن تمرير إطارات مخصصة (تُستخدم في V6Engine لفصل Scalp/Swing).*

**خطوات الحساب:**

```
لكل إطار زمني tf في targetTFs:
  weight = TF_WEIGHTS[tf]
  if (data.isBullishTrend):
    totalScore += weight   ← إيجابي
  else:
    totalScore -= weight   ← سلبي
  maxPossibleScore += weight

percentage = (totalScore + maxPossibleScore) / (2 × maxPossibleScore) × 100
```

**مثال:** لو الكل صاعد → `totalScore = 43, maxScore = 43` → `percentage = 100%`  
لو الكل هابط → `totalScore = -43` → `percentage = 0%`

| النسبة | القرار |
|--------|--------|
| ≥ 75% | `"شراء قوي 🟢"` |
| ≥ 55% | `"شراء 🟢"` |
| ≤ 25% | `"بيع قوي 🔴"` |
| ≤ 45% | `"بيع 🔴"` |
| بينها | `"محايد ⚪"` |

---

### 9. `predictNextPriceLinear(pastCandles, period=20): PredictionResult`

**الغرض:** التنبؤ بالسعر القادم باستخدام الانحدار الخطي (Linear Regression).

**الشمعات:** آخر **20 شمعة** من Quick TF.

**المعادلات الرياضية:**

```
n = عدد الشمعات (20 كحد أقصى)
x = رقم الشمعة (1, 2, 3, ..., n)
y = سعر الإغلاق

الميل:    m = (n×ΣXY - ΣX×ΣY) / (n×ΣX² - (ΣX)²)
التقاطع:  b = (ΣY - m×ΣX) / n
التنبؤ:   predictedPrice = m×(n+1) + b
الثقة:    confidence = |m| × 1000
```

**المخرج:**
```typescript
{
    predictedPrice: number,
    trendDirection: 'UP' | 'DOWN',  // m > 0 = UP
    slope: m,
    confidence: |m| × 1000         // كلما زاد الميل زادت الثقة
}
```

---

### 10. `detectDivergence(ohlcv, direction): {detected, description}`

**الغرض:** كشف الانحراف (Divergence) بين السعر والـ RSI.

**الشمعات:** 20+ شمعة (يقارن آخر شمعة مع الشمعة قبل **10 مواضع**).

**النوعان:**

#### Bearish Divergence (للـ LONG):
```
السعر يصعد (p2 > p1) لكن RSI يهبط (r2 < r1)
→ إشارة ضعف صعودي → خطر انعكاس هبوطي
```

#### Bullish Divergence (للـ SHORT):
```
السعر يهبط (p2 < p1) لكن RSI يصعد (r2 > r1)
→ إشارة ضعف هبوطي → خطر انعكاس صعودي
```

```typescript
p2 = closes[closes.length - 1]      // آخر سعر
p1 = closes[closes.length - 10]     // السعر قبل 10 شمعات
r2 = rsiValues[rsiValues.length - 1]
r1 = rsiValues[rsiValues.length - 10]
```

**الإطارات المستخدمة فيه:** يتلقى OHLCV من أي إطار ويُحسب RSI(14) داخلياً.  
في التطبيق: يُستدعى من V3Engine/V6Engine بإطار quick/swing، ومن `generateCorrectionReport` بـ 5m, 15m, 1h.

---

### 11. `calculateCorrectionFibLevels(ohlcv, direction): object`

**الغرض:** حساب مستويات فيبوناتشي للتصحيح (دعم أو مقاومة حسب الاتجاه).

**الشمعات:** آخر **40 شمعة** من الإطار الممرر.  
**الإطارات:** يُستدعى من `generateCorrectionReport` بـ `5m`, `15m`, `1h`.

```
maxHigh = max(highs[-40:])
minLow  = min(lows[-40:])
diff    = maxHigh - minLow
```

**للـ LONG (تصحيح صعودي → مستويات دعم):**
```
fib382 = maxHigh - (diff × 0.382)
fib500 = maxHigh - (diff × 0.500)
fib618 = maxHigh - (diff × 0.618)   ← أقوى دعم
```

**للـ SHORT (تصحيح هبوطي → مستويات مقاومة):**
```
fib382 = minLow + (diff × 0.382)
fib500 = minLow + (diff × 0.500)
fib618 = minLow + (diff × 0.618)    ← أقوى مقاومة
```

---

## 🗺️ خريطة الاستخدام

```
TechnicalAnalyzer
        │
        ├─ calculateTechnicalData()  ← تستدعيها: AnalysisService, BacktestService
        │       └─ prepareCandleData + calculateIndicators + Pivot + Fib + Structure
        │
        ├─ calculateVWAP()           ← تستدعيها: AnalysisService (من 1d), BacktestService
        │
        ├─ calculateMatrix()         ← تستدعيها: جميع المحركات (V1-V6)
        │
        ├─ detectDivergence()        ← تستدعيها: V3Engine, V6Engine, AnalysisService
        │
        ├─ calculateCorrectionFibLevels() ← تستدعيها: AnalysisService.generateCorrectionReport
        │
        └─ predictNextPriceLinear() ← تستدعيها: V5Engine فقط
```

---

## ⚡ ملخص عدد الشمعات لكل عملية

| العملية | الشمعات المستخدمة |
|---------|------------------|
| RSI | آخر 15+ شمعة (الفترة 14) |
| MACD | آخر 35+ شمعة (Slow=26 + Signal=9) |
| Bollinger Bands | آخر 20 شمعة |
| StochRSI | آخر 45+ شمعة |
| CCI / WilliamsR / MFI / ATR | آخر 15-20 شمعة |
| SMA-7 / SMA-20 / SMA-99 | 7 / 20 / 99 شمعة |
| Pivot & Levels | آخر شمعتان فقط |
| Fibonacci | آخر 50 شمعة |
| lastSwingHigh/Low | آخر 15 شمعة |
| هيكل السوق | آخر 30 شمعة (مقارنة 10 و 30) |
| VWAP | كل شمعات 1d (200 شمعة) |
| Divergence | آخر 20 شمعة (مقارنة بين -1 و -10) |
| Correction Fib | آخر 40 شمعة |
| Linear Regression | آخر 20 شمعة |
| Matrix Score | كل الإطارات الـ 7 (15+ شمعة لكل منها) |
