# 🌐 AnalysisService.ts — الخدمة المركزية للتحليل

> **الموقع:** `src/services/AnalysisService.ts`  
> **الدور:** الملف المحوري في النظام. يجمع بين جلب البيانات، تشغيل المحركات، وتوليد التقارير. يحتوي على التايبات الأساسية والـ Formatter وخدمة التحليل الرئيسية.

---

## 📋 هيكل الملف

```
AnalysisService.ts
    │
    ├── Types & Interfaces    ← OHLCV, AnalysisDetails, TradeRecommendation...
    ├── Engine Registry       ← { V1, V2, V3, V4, V5, V6 }
    ├── AnalysisFormatter     ← دوال توليد التقارير
    └── AnalysisService       ← الخدمة الرئيسية
```

---

## 📦 الواجهات والأنواع (Types & Interfaces)

### `OHLCV` — بيانات الشمعة الخام
```typescript
{ timestamp, open, high, low, close, volume }
```

### `CandleData` — بيانات منظمة
```typescript
{ closes[], highs[], lows[], volumes[], last, prev, all[] }
```

### `IndicatorData` — مؤشرات محسوبة
```typescript
{
    macd: { macd, signal, histogram },
    bb:   { upper, lower, middle },
    stochRsi, cci, williamsR, mfi?
}
```

### `TechnicalLevels` — المستويات التقنية
```typescript
{
    pivot, s1, s2, r1, r2,       // Pivot Points
    fib382, fib618, fibTarget,   // Fibonacci
    ma99, ma20, ma7,             // المتوسطات
    lastSwingHigh, lastSwingLow  // أعلى/أدنى حديث
}
```

### `AnalysisDetails` — التحليل الكامل لإطار زمني
```typescript
{
    indicators: IndicatorData,
    sentiments: IndicatorSentiment[],
    rsi, atr,
    levels: TechnicalLevels,
    structure: string,
    timeframe: string,
    isBullishTrend: boolean
}
```

### `TradeRecommendation` — توصية الصفقة
```typescript
{
    status, type ('LONG'|'SHORT'|'NONE'),
    entry, tp, sl,
    timeEstimate, winRate, reverseProb,
    rejectionReason?, signalReason?, confidenceScore?
}
```

### `MatrixResult` — نتيجة المصفوفة
```typescript
{ score, percentage, decision, details }
```

### `AnalysisResult` — النتيجة الشاملة
```typescript
{
    symbol, currentPrice, pricePrecision,
    isUptrend, matrix, isAboveVWAP,
    prediction?: PredictionResult,
    scalp: TradeRecommendation & AnalysisDetails,
    swing: TradeRecommendation & AnalysisDetails,
    allTimeframes: Record<string, AnalysisDetails>,
    options: { quickTF, longTF, limit },
    sniper: { isStochSynced, isFullBreakout, isAboveGolden }
}
```

---

## 🔌 سجل المحركات (Engine Registry)

```typescript
const ENGINES: Record<string, ITradingEngine> = {
    'V1': new V1Engine(),
    'V2': new V2Engine(),
    'V3': new V3Engine(),
    'V4': new V4Engine(),
    'V5': new V5Engine(),
    'V6': new V6Engine()
};
```

**طريقة الاختيار:**
```typescript
const engine = ENGINES[version] || ENGINES['V1'];  // V1 هو الافتراضي
```

---

## 🔧 الدالة الرئيسية: `analyze()`

### المدخلات
```typescript
analyze(
    symbolInput: string,
    version: 'V1'|'V2'|'V3'|'V4'|'V5'|'V6' = 'V1',
    options: { quickTF?, longTF?, limit?, rsiThreshold? }
)
```

### تدفق العمل التفصيلي

```
1. تطبيع الرمز: 'BTC' → 'BTC/USDT:USDT'

2. تحديد الخيارات:
   quickTF = options.quickTF || '5m'
   longTF  = options.longTF  || '1h'
   limit   = options.limit   || 200

3. جلب البيانات بالتوازي (Promise.all):
   ├─ getPricePrecision(symbol)
   └─ لكل إطار في MATRIX_TFS ['1m','5m','15m','30m','1h','4h','1d']:
       fetchLimit = quickTF أو longTF → max(limit,200) | غيرهما → 200
       fetchOHLCV(symbol, tf, fetchLimit)

4. بناء mtfOHLCV:
   { '1m': [...], '5m': [...], '1h': [...], ... }

5. حساب السعر الحالي:
   currentPrice = quickOHLCV[last].close

6. حساب VWAP:
   vwap = TechnicalAnalyzer.calculateVWAP(dailyOHLCV)
   ← من شمعات '1d' فقط (200 شمعة)

7. حساب AnalysisDetails لكل إطار:
   لكل tf في MATRIX_TFS:
     allTimeframes[tf] = TechnicalAnalyzer.calculateTechnicalData(ohlcv, tf, vwap)

8. تشغيل المحرك:
   engine.analyze(currentPrice, vwap, allTimeframes, mtfOHLCV, {quickTF, longTF})
   → { matrix, scalp, swing }

9. Sniper Logic (V7):
   isStochSynced = scalpData.stochRsi < 25 && swingData.stochRsi < 25
   isFullBreakout = matrix.percentage >= 95
   isAboveGolden  = currentPrice > scalpData.levels.fib618

10. إرجاع AnalysisResult الكامل
```

### 📊 جدول الشمعات المجلوبة

| الإطار | عدد الشمعات | الغرض |
|--------|------------|-------|
| Quick TF (مثلاً 5m) | `max(200, limit)` | scalp + matrix |
| Long TF (مثلاً 1h) | `max(200, limit)` | swing + matrix |
| 1m, 15m, 30m, 4h | 200 | matrix فقط |
| **1d** | 200 | **VWAP + matrix** |

---

## 🎯 Sniper Logic (V7 Conditions)

```
isStochSynced  → StochRSI(quickTF) < 25 && StochRSI(longTF) < 25
                 المعنى: كلا الإطارين في قاع تشبع بيعي = إشارة ذهبية

isFullBreakout → matrix.percentage >= 95%
                 المعنى: 95%+ من الإطارات صاعدة = انفجار وشيك

isAboveGolden  → currentPrice > fib618(quickTF)
                 المعنى: السعر اخترق مستوى الذهبي (Fibonacci 0.618)
```

---

## 📝 AnalysisFormatter — دوال التقارير

### `formatReport(res, v)` — التقرير الرئيسي
- يعرض: الإشارات الذهبية + Scalp + Swing + Matrix + Prediction
- يتحقق من: `winRate >= 80` → 🔥 | `>= 65` → ✅ | أقل → ⚠️

### `formatSignalText()` — تنسيق إشارة التداول
```
`BTCUSDT`
🔼LONG  X25
▶️ENTER: 65000.00
▶️TARGETS: 66000.00 / 67000.00
▶️STOP: 64000.00
```

### `generateDetailedReport(res, type)` — تقرير تفصيلي
- يعرض: جميع المؤشرات + مستويات R1/S1/R2/S2 + Fibonacci + هيكل السوق

### `generateEducationalGuide(res, type)` — الدليل التعليمي
- يشرح كل مؤشر: RSI, MACD, Matrix, MFI, CCI, StochRSI, VWAP, ATR
- يوضح شروط دخول LONG/SHORT لكل مؤشر

### `generateComprehensiveReport(res)` — التقرير الشامل
```
لكل إطار ['1m','5m','15m','1h','4h','1d']:
    bullishCount += (currentPrice > ma20) ? 1 : 0
    عرض: RSI, MFI, هيكل، دعم/مقاومة

خلاصة التوافق:
    5-6 → "صعود قوي 🔥"
    3-4 → "صعود متذبذب ✅"
    0-1 → "هبوط مستمر 🔴"
```

### `calculateSentiments()` — (خاصة private)
يُنتج قائمة `IndicatorSentiment[]` بحالة كل مؤشر:

| المؤشر | BULLISH | BEARISH | NEUTRAL |
|--------|---------|---------|---------|
| RSI | < 35 | > 65 | 35-65 |
| MACD | histogram > 0 | histogram < 0 | — |
| VWAP | فوق | تحت | — |
| Matrix | ≥ 55% | ≤ 45% | بينهما |
| MFI | < 25 | > 75 | 25-75 |
| StochRSI | < 20 | > 80 | 20-80 |
| CCI | > 100 | < -100 | -100 إلى 100 |

---

## 🔄 `generateCorrectionReport(res, direction)`

**الغرض:** توليد تقرير رادار التصحيح متعدد الإطارات.

```
الإطارات: ['5m', '15m', '1h']
الشمعات:  50 شمعة من كل إطار

لكل إطار:
    fetchOHLCV(symbol, tf, 50)
    detectDivergence(ohlcv, direction)    ← 20+ شمعة
    calculateCorrectionFibLevels(ohlcv)  ← آخر 40 شمعة

منطق التحذير:
    detectedCount >= 2 → خطر انعكاس مؤكد (Confluence)
    detectedCount == 1 → تحذير: بداية ضعف
    detectedCount == 0 + cp < fib500(5m) → تصحيح عميق
    غير ذلك → وضع مستقر
```

---

## 🔗 دوال الـ Proxy (للتوافقية مع الكود القديم)

```typescript
// تُعيد توجيه الاستدعاءات إلى الدوال الصحيحة
formatReport()                → AnalysisFormatter.formatReport()
detectDivergence()            → TechnicalAnalyzer.detectDivergence()
calculateCorrectionFibLevels() → TechnicalAnalyzer.calculateCorrectionFibLevels()
generateDetailedReport()       → AnalysisFormatter.generateDetailedReport()
generateEducationalGuide()     → AnalysisFormatter.generateEducationalGuide()
generateComprehensiveReport()  → AnalysisFormatter.generateComprehensiveReport()
```
