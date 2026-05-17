# 👁️ PositionMonitor.ts — مراقب الصفقات اللحظي

> **الموقع:** `src/services/PositionMonitor.ts`  
> **الدور:** خدمة خلفية تعمل كل 30 ثانية. تتابع كل الصفقات المفتوحة وترسل التحذيرات وتغلق الصفقات في قاعدة البيانات عند إغلاقها على البورصة.

---

## 📋 نظرة عامة

| الخاصية | القيمة |
|---------|--------|
| **فاصل الفحص** | 30,000ms (30 ثانية) |
| **الحالات المراقَبة** | PENDING, OPEN, TP1_HIT, TP2_HIT |
| **يستخدم** | BingXService + AnalysisService + التنبيهات |
| **يُحدّث** | قاعدة بيانات Trade |

---

## 🔧 الدوال التفصيلية

### 1. `start(intervalMs = 30000)`

```typescript
this.isRunning = true;
this.checkPositions();  // تشغيل فوري
this.intervalId = setInterval(() => this.checkPositions(), intervalMs);
```

**يُستدعى من:** `index.ts` عند بدء تشغيل البوت.

---

### 2. `stop()`

```typescript
this.isRunning = false;
clearInterval(this.intervalId);
```

**يُستدعى عند:** `SIGINT` أو `SIGTERM` (إيقاف البوت بأمان).

---

### 3. `checkPositions()` — الدالة الرئيسية

```
1. Trade.find({ status: ['PENDING','OPEN','TP1_HIT','TP2_HIT'] })
2. [PENDING] → فحص أوامر Limit على البورصة
3. [OPEN]    → مجموعة بالرموز → فحص المواضع على BingX
    ├─ [موضع نشط]  → فحص التحذيرات
    │   ├─ Break-Even بعد TP1
    │   ├─ تحذير SL (عند 5% خسارة من رأس المال)
    │   ├─ تحذيرات TP (حسب thresholds)
    │   └─ Correction Guard (Divergence + Pivot)
    └─ [موضع مغلق] → حساب PnL + إغلاق في DB + إرسال إشعار
```

---

## 🔐 القسم الأول: معالجة الصفقات المعلقة (PENDING)

```typescript
for (const trade of pendingTrades) {
    const order = await bingx.getOrder(trade.symbol, trade.bingxOrderId);
    
    if (order.status === 'closed' || order.status === 'filled') {
        trade.currentStatus = 'OPEN';  // تم التنفيذ
        await notifier(telegramId, 'تم تنفيذ الأمر الحدي!');
    } else if (order.status === 'canceled' || order.status === 'expired') {
        trade.currentStatus = 'CANCELLED';  // ملغي
    }
    await trade.save();
}
```

---

## ✅ القسم الثاني: الصفقات المفتوحة

### 2أ. Break-Even بعد TP1

```typescript
if (user.autoBreakEven && !trade.isBreakEvenSet && trade.targets.length > 0) {
    const tp1 = trade.targets[0].price;
    const tp1Hit = (direction === 'LONG') ? currentPrice >= tp1 : currentPrice <= tp1;
    
    if (tp1Hit) {
        await bingx.setStopLoss(symbol, entryPrice, direction);
        trade.isBreakEvenSet = true;
        await notifier(telegramId, 'تم نقل SL لنقطة الدخول 🔒');
    }
}
```

---

### 2ب. تحذير اقتراب SL (عند 5% خسارة)

```typescript
const pnl = matchingPos.unrealizedPnl;
if (totalBalance > 0 && pnl < 0) {
    const lossPercent = |pnl / totalBalance| × 100;
    if (lossPercent >= 5 && !trade.slWarningSent) {
        await notifier(telegramId, 'تحذير: اقتراب من SL!');
        trade.slWarningSent = true;  // منع التكرار
    }
}
```

---

### 2ج. تحذيرات التقدم نحو TP

```typescript
const totalDist = |tp1 - entry|;
const progressToTp = (direction === 'LONG')
    ? (currentPrice - entry) / totalDist × 100
    : (entry - currentPrice) / totalDist × 100;

// thresholds: [70, 90] بالافتراضي
for (const threshold of thresholds) {
    if (progressToTp >= threshold && !triggered.includes(threshold)) {
        await notifier(telegramId, `وصلت ${threshold}% من المسافة نحو TP1!`);
        triggered.push(threshold);
    }
}
```

---

### 2د. Correction Guard — رادار التصحيح (V7)

**يعمل فقط إذا:** `trade.correctionAlertEnabled === true`

```
البيانات المجلوبة:
├─ ohlcv5m  = fetchOHLCV(symbol, '5m', 50)  ← 50 شمعة
└─ ohlcv1h  = fetchOHLCV(symbol, '1h', 2)   ← آخر شمعتان

الحسابات:
├─ analysis.detectDivergence(ohlcv5m, direction)
│   → إذا كشف Bearish/Bullish Divergence:
│       حساب نطاق فيبوناتشي للتصحيح
│       إرسال تحذير مع نطاق 0.5-0.618
│       trade.correctionWarningSent = true
│
└─ Pivot = (prev1h.high + prev1h.low + prev1h.close) / 3
    analysis.isPivotBroken(currentPrice, pivot, direction)
    → إذا كسر Pivot:
        إرسال تنبيه حرج
        trade.correctionAlertEnabled = false  (يُوقف المراقبة)
```

**منطق isPivotBroken:**
```
LONG:  currentPrice < pivot → كسر مستوى Pivot = خطر
SHORT: currentPrice > pivot → خرق Pivot = خطر
```

---

## ❌ القسم الثالث: الصفقات المغلقة

```
إذا matchingPos غير موجود → الصفقة أُغلقت على البورصة
    │
    ├─ جلب السعر الحالي
    ├─ حساب PnL:
    │   LONG:  pnlPercent = (cp - entry) / entry × 100 × leverage
    │   SHORT: pnlPercent = (entry - cp) / entry × 100 × leverage
    │
    ├─ trade.currentStatus = pnlPercent > 0 ? 'CLOSED_PROFIT' : 'CLOSED_LOSS'
    ├─ trade.closeTime = new Date()
    ├─ trade.pnl = pnlPercent
    └─ إرسال إشعار مفصل للمستخدم:
        - الربح/الخسارة USDT ونسبة من رأس المال
        - سعر الدخول والإغلاق
        - مدة الصفقة (بالدقائق/الساعات)
```

---

## ⏱️ حساب مدة الصفقة

```typescript
const durationMs = closeTime.getTime() - trade.entryTime.getTime();
const durationMinutes = Math.floor(durationMs / 60000);
const durationHours = Math.floor(durationMinutes / 60);
const text = durationHours > 0 
    ? `${durationHours} ساعة و ${durationMinutes % 60} دقيقة`
    : `${durationMinutes} دقيقة`;
```

---

## 🔗 علاقات Correction Guard بالتحليل

```
PositionMonitor.checkPositions()
        │
        └─ Correction Guard يستدعي:
            ├─ BingXService.fetchOHLCV(symbol, '5m', 50) ← 50 شمعة
            │
            ├─ AnalysisService.detectDivergence(ohlcv, direction)
            │   └─ TechnicalAnalyzer.detectDivergence()
            │       ├─ RSI(14) على 20+ شمعة
            │       └─ مقارنة السعر والـ RSI بين ([-1] و [-10])
            │
            ├─ AnalysisService.calculateCorrectionFibLevels(ohlcv, direction)
            │   └─ TechnicalAnalyzer.calculateCorrectionFibLevels()
            │       └─ fib382, fib500, fib618 من آخر 40 شمعة
            │
            ├─ BingXService.fetchOHLCV(symbol, '1h', 2) ← شمعتان فقط!
            │
            └─ AnalysisService.isPivotBroken(cp, pivot, direction)
                └─ Pivot = (prev.high + prev.low + prev.close) / 3
```
