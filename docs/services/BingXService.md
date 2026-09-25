# 🌐 BingXService.ts — طبقة التواصل مع البورصة

> **الموقع:** `src/services/BingXService.ts`  
> **الدور:** الطبقة الوحيدة التي تتواصل مع BingX API عبر مكتبة CCXT. كل بيانات السوق والأوامر تمر من هنا.

---

## 📋 نظرة عامة

| الخاصية | القيمة |
|---------|--------|
| **المكتبة** | `ccxt.bingx` |
| **نوع الحساب** | `swap` (Perpetual Futures) |
| **Timeout** | 30,000 ms |
| **Rate Limiting** | مفعّل (`enableRateLimit: true`) |
| **تعديل الوقت** | `adjustForTimeDifference: true` |

---

## 🔧 الدوال التفصيلية

### 1. `constructor(apiKey?, secretKey?)`

```typescript
this.exchange = new ccxt.bingx({
    apiKey, secret: secretKey,
    timeout: 30000,
    options: { defaultType: 'swap', adjustForTimeDifference: true, recvWindow: 60000 },
    enableRateLimit: true
});
this.exchange.loadMarkets();  // تحميل أسواق BingX فور الإنشاء
```

---

### 2. `setLeverage(symbol, leverage, side)` — ضبط الرافعة

```typescript
await exchange.setLeverage(cleanLeverage, symbol, { side: cleanSide });
```

- يتحقق من أن الرافعة عدد صحيح: `Math.floor(leverage)`
- يدعم `'LONG'` و `'SHORT'` بشكل منفصل (Hedge Mode)
- يُلقي استثناء عند الفشل (يعالجه TradeManager)

---

### 3. `setMarginMode(symbol, mode)` — ضبط وضع الهامش

```typescript
await exchange.setMarginMode('CROSS'|'ISOLATED', symbol);
```

- لا يُلقي استثناء عند الفشل — يُسجّل فقط (بعض الأزواج قد لا تدعمه)

---

### 4. `getPricePrecision(symbol): number` — دقة السعر

```typescript
const market = exchange.markets[symbol];
return market?.info?.pricePrecision;
```

- يُعيد عدد المنازل العشرية للسعر
- الافتراضي: 4 منازل عند الخطأ

---

### 5. `getBalance(): number` — الرصيد المتاح

```typescript
const balance = await exchange.fetchBalance({ type: 'swap' });
return balance.free['USDT'];  // الرصيد الحر فقط (لا total)
```

> ⚠️ **مهم:** يستخدم `free` وليس `total` لأن `total` يشمل الهامش المستخدم في صفقات مفتوحة.

---

### 6. `getTotalEquity(): number` — إجمالي رأس المال

```typescript
return balance.total['USDT'] || balance.free['USDT'];
```

يُستخدم في PositionMonitor لحساب نسبة الخسارة من إجمالي رأس المال.

---

### 7. `fetchOHLCV(symbol, timeframe, limit): OHLCV[]` — جلب الشمعات

```typescript
const ohlcv = await exchange.fetchOHLCV(symbol, timeframe, undefined, limit);
return ohlcv.map(candle => ({
    timestamp, open, high, low, close, volume
}));
```

**الاستخدام:**
- `AnalysisService`: يجلب 200+ شمعة لكل إطار
- `PositionMonitor`: يجلب 50 شمعة 5m و 2 شمعة 1h

---

### 8. `fetchDeepHistoricalData(symbol, timeframe, days)` — بيانات تاريخية عميقة

**يُستخدم حصراً في BacktestService.**

```typescript
let since = now - (days × 24 × 60 × 60 × 1000);
while (since < now) {
    const ohlcv = await exchange.fetchOHLCV(symbol, timeframe, since, 500);
    // 500 شمعة في كل طلب
    since = lastCandleTime + 1;
    await sleep(200ms);  // تفادي rate limit
}
// إزالة التكرار وترتيب ترتيباً زمنياً
```

**الخوارزمية:**
1. ابدأ من `since` (قديم)
2. جلب 500 شمعة في كل دورة
3. تحديث `since` لآخر شمعة + 1ms
4. الاستمرار حتى الوصول للحاضر
5. إزالة الشمعات المكررة (Map بـ timestamp)
6. الترتيب الزمني

---

### 9. `placeOrder(symbol, type, side, amount, price?, params)` — تنفيذ أمر

```typescript
const order = await exchange.createOrder(symbol, type, side, amount, price, params);
return order;  // يحتوي على: id, status, average, ...
```

| المعامل | الأنواع |
|---------|---------|
| type | `'market'` \| `'limit'` |
| side | `'buy'` \| `'sell'` |
| params | `{ positionSide, stopLoss: { triggerPrice, type }, takeProfit: ... }` |

---

### 10. `getPositions(symbol?): Position[]` — الصفقات المفتوحة

```typescript
const positions = await exchange.fetchPositions(symbols);
```

- بدون `symbol` → كل الصفقات
- كل صفقة تحتوي: `{ side, contracts, markPrice, unrealizedPnl, initialMargin, ... }`

---

### 11. `setStopLoss(symbol, stopPrice, side)` — ضبط SL

```typescript
await exchange.createOrder(symbol, 'STOP', orderSide, 0, undefined, {
    stopPrice, positionSide: side, type: 'STOP'
});
```

**يُستخدم في PositionMonitor** عند تفعيل Break-Even بعد TP1.

---

### 12. `placeSLTPOrders(symbol, direction, amount, sl, tpPrices[], hedge, splits?)` — وضع SL/TP متعدد

```
SL واحد → createOrder('STOP', closeSide, amount, stopLossPrice)
لكل TP:
    portionSize = amount / عدد_الأهداف (أو حسب splits[i])
    createOrder('TAKE_PROFIT', closeSide, portionSize, tpPrice)
```

**حساب التوزيع:**
```typescript
if (tpProfitSplits && tpProfitSplits.length > i):
    portionSize = amount × (tpProfitSplits[i] / 100)
else:
    portionSize = amount / takeProfitPrices.length
```

---

## 🔄 كيف يُستخدم في النظام

```
BingXService
    ├─ AnalysisService    ← fetchOHLCV + getPricePrecision
    ├─ BacktestService    ← fetchDeepHistoricalData
    ├─ TradeManager       ← getBalance, setLeverage, placeOrder, getPositions, priceToPrecision
    └─ PositionMonitor    ← getPositions, getOrder, getMarketPrice, fetchOHLCV, setStopLoss
```
