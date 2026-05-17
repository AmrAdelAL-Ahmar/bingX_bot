# 📊 BacktestService.ts — محاكاة الاختبار الرجعي الواقعية

> **الموقع:** `src/services/BacktestService.ts`  
> **الدور:** اختبار أداء أي محرك تداول على بيانات تاريخية حقيقية. يعمل بثلاث مراحل متتالية: توليد الإشارات، تقييمها، ثم محاكاة رأس المال الواقعية.

---

## 📋 نظرة عامة

| الخاصية | القيمة |
|---------|--------|
| **المراحل** | 3 مراحل (Passes) |
| **المحركات المدعومة** | V1, V2, V3, V4, V5, V6 |
| **الأوضاع** | SCALP / SWING |
| **تقييم الصفقات** | شمعات 5m (الأدق) |
| **منع Look-Ahead** | ✅ مطبق على كل إطار زمني |

---

## 🔧 الدالة الرئيسية: `runAdvancedBacktest()`

### المدخلات

```typescript
{
    symbol: string,
    version: string,          // V1-V6
    options: {
        quickTF: string,      // الإطار السريع (5m مثلاً)
        longTF: string,       // الإطار البطيء (1h مثلاً)
        days: number,         // عدد أيام الاختبار
        stepMinutes: number,  // خطوة التحليل (كل كم دقيقة؟)
        mode: 'SCALP'|'SWING',
        initialCapital?: number,       // رأس المال الابتدائي (1000 افتراضي)
        marginPerTradePercentage?: number, // % هامش لكل صفقة (3% افتراضي)
        marginMode?: string,           // ISOLATED | CROSS
        leverage?: number,             // الرافعة (10x افتراضي)
        riskSizingEnabled?: boolean,
        maxSlCapEnabled?: boolean,
        maxSlPercentage?: number,      // حد أقصى للخسارة من SL
        fullReportEnabled?: boolean
    }
}
```

---

## 📦 المرحلة الأولية: جلب البيانات التاريخية (Warmup Phase)

```typescript
for (const tf of MATRIX_TFS) {  // ['1m','5m','15m','30m','1h','4h','1d']
    let fetchDays = options.days;
    if (tf === '1d') fetchDays += 200;
    else if (tf === '4h') fetchDays += 35;
    else if (tf === '1h') fetchDays += 10;
    else fetchDays += 3;
    allData[tf] = await this.bingxService.fetchDeepHistoricalData(symbol, tf, fetchDays);
}
```

### جدول الشمعات المجلوبة

| الإطار | أيام إضافية | الشمعات التقريبية | السبب |
|--------|------------|-----------------|-------|
| `1d` | +200 يوم | days+200 شمعة | SMA(99) يحتاج 99 شمعة على الأقل |
| `4h` | +35 يوم | days×6+210 شمعة | 35×6=210 شمعة تضمن Warmup |
| `1h` | +10 أيام | days×24+240 شمعة | 10×24=240 شمعة |
| `5m/15m/30m` | +3 أيام | days×288+864+ شمعة | يكفي 15+ شمعة للـ Warmup |

**لماذا Warmup؟** المؤشرات مثل SMA(99) و MACD(26) تحتاج شمعات "تحميل" قبل أن تُعطي قيماً دقيقة.

---

## ⚙️ المرحلة 1 (Pass 1): توليد الإشارات

### آلية التحرك عبر الزمن

```typescript
const stepMs = options.stepMinutes * 60 * 1000;
const startTime = now - (options.days * 24 * 60 * 60 * 1000);

for (let t = startTime; t <= now; t += stepMs) {
    // محاكاة نقطة زمنية t
}
```

**مثال:** `days=30, stepMinutes=30` → 30×24×2 = **1,440 خطوة تحليل**

---

### 🛡️ فلتر Look-Ahead Bias

```typescript
for (const tf of MATRIX_TFS) {
    const tfMs = MTFDataBuilder.tfToMs(tf);
    const dataUpToT = allData[tf].filter(c => c.timestamp + tfMs <= t);
    mtfSnapshot[tf] = dataUpToT;
}
```

**الشرح:**
```
c.timestamp    = وقت فتح الشمعة
tfMs           = مدة الشمعة بالميلي ثانية
c.timestamp + tfMs = وقت إغلاق الشمعة

الشرط: c.timestamp + tfMs <= t
→ الشمعة أُغلقت قبل أو عند اللحظة t
→ بالتالي نرى فقط ما كان "مرئياً" في الواقع
```

**مثال:**
```
شمعة 5m بدأت 09:00 → تنتهي 09:05 (timestamp + 300000ms)
إذا t = 09:03 → 09:00+300000 > 09:03 → مستبعدة ✓
إذا t = 09:05 → 09:00+300000 = 09:05 → مشمولة ✓
```

---

### ✅ الحد الأدنى من الشمعات

```typescript
if (dataUpToT.length < 15) {
    hasEnoughData = false;
}
if (!hasEnoughData) continue; // تجاوز هذه اللحظة
```

**15 شمعة** هو الحد الأدنى (الكافي لـ RSI و ATR الأساسيين).

---

### 🔄 تشغيل المحرك في كل خطوة

```typescript
// 1. السعر الحالي
const currentPrice = mtfSnapshot[quickTF][last].close;

// 2. VWAP من 1d (أو 4h أو quickTF كبديل)
const dailyOHLCV = mtfSnapshot['1d'] || mtfSnapshot['4h'] || mtfSnapshot[quickTF];
const vwap = dailyOHLCV.length > 0 ? TechnicalAnalyzer.calculateVWAP(dailyOHLCV) : currentPrice;

// 3. حساب التحليل التقني لكل إطار
for (const tf of MATRIX_TFS) {
    if (mtfSnapshot[tf] && mtfSnapshot[tf].length > 15) {
        allTimeframes[tf] = TechnicalAnalyzer.calculateTechnicalData(mtfSnapshot[tf], tf, vwap);
    }
}

// 4. تشغيل المحرك
const result = engine.analyze(currentPrice, vwap, allTimeframes, mtfSnapshot, {quickTF, longTF});

// 5. اختيار الإشارة (SCALP أو SWING)
signal = mode === 'SCALP' ? result.scalp : result.swing;
```

### ما يُسجَّل مع كل إشارة

```typescript
{
    type, entry, tp, sl,
    signalReason,
    entryTime, entryDate,
    status: 'OPEN',     // سيُقيَّم في Pass 2
    analysisContext: {
        matrixScore,
        // كل إطار زمني:
        quick_rsi, quick_macd, quick_bb_up/low, quick_stochRsi,
        quick_cci, quick_williamsR, quick_atr,
        quick_trend, quick_pivot, quick_r1, quick_s1,
        quick_fib382, quick_fib618, quick_lastSwingHigh, quick_lastSwingLow,
        long_rsi, long_macd, long_trend, long_pivot...
        tf5m_, tf15m_, tf30m_, tf1h_, tf4h_, tf1d_...
        // سياق كامل لجميع الإطارات السبعة
    }
}
```

---

## ✅ المرحلة 2 (Pass 2): تقييم الصفقات

```typescript
const evaluationTF = '5m';  // الأدق المتاح
const evalData = allData['5m'];
```

**لكل صفقة مُولَّدة:**
```typescript
const futureCandles = evalData.filter(c => c.timestamp >= trade.entryTime);

for (const candle of futureCandles) {
    if (trade.type === 'LONG') {
        if (candle.high >= trade.tp)  → WIN (TP تحقق)
        if (candle.low  <= trade.sl)  → LOSS (SL تحقق)
    } else {  // SHORT
        if (candle.low  <= trade.tp)  → WIN
        if (candle.high >= trade.sl)  → LOSS
    }
}
```

**مدة الصفقة:**
```typescript
trade.durationMinutes = durationCandles × 5;  // كل شمعة 5 دقائق
```

**الصفقات التي لم تُغلق** → `status: 'OPEN'`

---

## 💰 المرحلة 3 (Pass 3): محاكاة رأس المال

### بناء الأحداث الزمنية

```typescript
const events = [];
for (const trade of generatedTrades) {
    events.push({ type: 'OPEN',  time: trade.entryTime, trade });
    if (trade.closeTime) events.push({ type: 'CLOSE', time: trade.closeTime, trade });
}
events.sort((a, b) => a.time - b.time);  // ترتيب زمني
```

**لماذا الترتيب الزمني؟** لأن الصفقات قد تكون متزامنة (open قبل close لصفقة أخرى).

---

### عند OPEN:

```typescript
// 1. حساب الهامش المطلوب
let requestedMargin = totalCapital × (riskPercentage / 100);

// 2. تطبيق Max SL Cap (إن فُعّل)
if (maxSlCapEnabled && slDistancePercentage > 0) {
    const potentialLoss = requestedMargin × leverage × (slDistancePercentage / 100);
    const maxAllowed    = totalCapital × (maxSlPercentage / 100);
    if (potentialLoss > maxAllowed):
        requestedMargin = maxAllowed / (leverage × slDistancePercentage / 100);
        // يُقلص الهامش حتى تصبح الخسارة المحتملة = maxAllowed
}

// 3. التحقق من الحد الأدنى
if (activeCapital < 5): skip()  // أقل من 5 USDT → تجاهل الصفقة

// 4. خصم الهامش من السيولة
actualMargin = min(requestedMargin, activeCapital);
activeCapital -= actualMargin;
```

---

### عند CLOSE:

```typescript
// حساب PnL
if (trade.type === 'LONG'):
    pnlMultiplier = (closePrice - entry) / entry × leverage
else:
    pnlMultiplier = (entry - closePrice) / entry × leverage

pnlUSDT = margin × pnlMultiplier

// ISOLATED Mode: لا تتجاوز الخسارة الهامش المستخدم
if (marginMode === 'ISOLATED' && pnlUSDT < -margin):
    pnlUSDT = -margin  // أقصى خسارة = الهامش فقط

// تحديث رأس المال
activeCapital += (margin + pnlUSDT)
totalCapital  += pnlUSDT

// تتبع Max Drawdown
if (totalCapital > peakCapital): peakCapital = totalCapital
drawdown = (peakCapital - totalCapital) / peakCapital × 100
if (drawdown > maxDrawdown): maxDrawdown = drawdown
```

---

## 📊 الإحصائيات النهائية

```typescript
const totalClosed = total - open;
const totalWins   = longWins + shortWins;
const winRate     = (totalWins / totalClosed) × 100;
const roi         = (finalCapital - initialCapital) / initialCapital × 100;
const netProfit   = finalCapital - initialCapital;

// متوسط الربح/الخسارة لكل صفقة
avgWinPercent  = Σ(pnlPercent للصفقات الرابحة) / عددها
avgLossPercent = Σ(pnlPercent للصفقات الخاسرة) / عددها
```

---

## 🗺️ خريطة تدفق البيانات الكاملة

```
Input: symbol, version, options
    │
    ├─ [جلب] fetchDeepHistoricalData × 7 إطارات (Warmup)
    │
    ├─ [Pass 1] لكل خطوة زمنية t:
    │   ├─ بناء mtfSnapshot (شمعات مغلقة فقط)
    │   ├─ حساب VWAP من 1d
    │   ├─ TechnicalAnalyzer.calculateTechnicalData × 7 إطارات
    │   ├─ engine.analyze() → signal
    │   └─ تسجيل الإشارة إن != NONE
    │
    ├─ [Pass 2] لكل صفقة:
    │   └─ فحص TP/SL على شمعات 5m المستقبلية
    │
    ├─ [Pass 3] لكل حدث (OPEN/CLOSE):
    │   ├─ OPEN: حساب الهامش + Max SL Cap + خصم من السيولة
    │   └─ CLOSE: حساب PnL + تحديث رأس المال + Drawdown
    │
    └─ Output: reportText + trades[]
```

---

## ⚡ ملخص الأرقام

| المعلمة | القيمة الافتراضية |
|---------|-----------------|
| رأس المال الابتدائي | 1000 USDT |
| هامش لكل صفقة | 3% |
| الرافعة | 10x |
| وضع الهامش | ISOLATED |
| Max SL Cap | معطل (غير مفعّل) |
| حد أدنى للرصيد للتداول | 5 USDT |
| إطار التقييم | 5m دائماً |
