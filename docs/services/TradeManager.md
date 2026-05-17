# ⚙️ TradeManager.ts — مدير تنفيذ الصفقات

> **الموقع:** `src/services/TradeManager.ts`  
> **الدور:** المسؤول الكامل عن تنفيذ الإشارات فعلياً على البورصة. يحسب حجم الصفقة ويحمي رأس المال ويضع الأوامر.

---

## 📋 نظرة عامة

| الخاصية | القيمة |
|---------|--------|
| **يستخدم** | BingXService, User, Trade models |
| **يستقبل** | ParsedSignal من SignalParser |
| **يُخرج** | TradeResult (معلومات الصفقة المنفَّذة) |
| **الحماية** | 6 طبقات حماية لرأس المال |

---

## 🔧 الدالة الرئيسية: `executeSignal(signal, userId, sourceChatId?)`

### تدفق العمل التفصيلي (10 خطوات)

---

### الخطوة 1: التحقق من المستخدم والرصيد

```typescript
const user = await User.findById(userId);
if (!user.isActive) return;

const balance = await bingx.getBalance();
if (!balance || balance <= 0) throw Error('Insufficient Balance');
```

---

### الخطوة 2: تحديد نوع الأمر (Market / Limit)

```
وضع HITLAR: استخدم hitlar.orderMode
غير HITLAR:  استخدم user.orderMode (market افتراضياً)

إذا كان Limit:
    جلب سعر السوق الحالي
    إذا كان سعر الدخول "تجاوزه السوق":
        LONG: entry > market → تحويل لـ Market تلقائياً
        SHORT: entry < market → تحويل لـ Market تلقائياً
    غير ذلك: استخدم Limit بسعر الإشارة
```

**"سعر تجاوزه السوق" يعني:**
- للـ LONG: السعر المطلوب أعلى من السعر الحالي → لو انتظرت Limit ستشتري بسعر أعلى مما أراد المستخدم
- للـ SHORT: السعر المطلوب أقل من السعر الحالي → نفس المشكلة

---

### الخطوة 3: حساب SL/TP

```
إذا لم يوجد SL في الإشارة AND errorMitigationEnabled:
    → حساب تلقائي بـ volatilitySlPercentage

إذا لم تُوجد TP في الإشارة AND errorMitigationEnabled:
    → TP = entry × (1 + volatilitySlPercentage × 2)

إذا لا يزال SL = 0 أو TP = []: رفض الصفقة
```

---

### الخطوة 4: حساب حجم الصفقة

```typescript
// نسبة الهامش
riskPercentage = isHitlar ? hitlar.riskPercentage : (signal.risk || user.riskPercentage || 2)

// الرافعة
leverage = isHitlar ? hitlar.leverage : (user.leverageMode === 'fixed' ? fixedValue : signal.leverage || 10)

// الهامش المطلوب
marginUsed = balance × (riskPercentage / 100)

// حجم الصفقة الكاملة
positionSizeUSDT = marginUsed × leverage

// عدد العقود
rawAmount = positionSizeUSDT / entryPrice
amountContracts = amountToPrecision(rawAmount)
```

---

### 🛡️ الخطوة 5: حماية التعرض الكلي (Global Exposure Limit)

```typescript
// أقصى هامش كلي = 10% من الرصيد
const maxAllowedExposure = balance × 0.10;

// مجموع الهوامش المستخدمة في الصفقات المفتوحة
totalMarginUsed = Σ(pos.initialMargin)

if (totalMarginUsed >= maxAllowedExposure):
    throw Error('Reached 10% global exposure limit')

if (marginUsed > maxAllowedExposure - totalMarginUsed):
    marginUsed = remainingMargin  // تقليص تلقائي
```

---

### 🛡️ الخطوة 6: الحد الأدنى للصفقة (BingX Minimum)

```typescript
MIN_NOTIONAL = 5.1 USDT

if (errorMitigationEnabled && positionSizeUSDT < MIN_NOTIONAL):
    positionSizeUSDT = 5.1  // رفع للحد الأدنى
    amountContracts = 5.1 / entryPrice  // إعادة حساب
```

---

### 🛡️ الخطوة 7: حد أقصى لخسارة SL (Max SL Capital Risk)

```typescript
const maxSlRisk = (user.maxSlRiskPercentage || 6) / 100;
const maxAllowedSLLoss = balance × maxSlRisk;

const lossPerCoin = |entryPrice - stopLossPrice|;
const projectedLoss = amountContracts × lossPerCoin;

if (projectedLoss > maxAllowedSLLoss):
    maxSafeContracts = maxAllowedSLLoss / lossPerCoin;
    amountContracts = maxSafeContracts;  // تقليص الحجم
    positionSizeUSDT = amountContracts × entryPrice;
    marginUsed = positionSizeUSDT / leverage;
```

**مثال:**
```
balance = 1000 USDT, maxSlRiskPercentage = 6%
maxAllowedSLLoss = 60 USDT

entry = 100, SL = 95 → lossPerCoin = 5
if amountContracts = 20 → projectedLoss = 100 USDT (يتجاوز 60)
maxSafeContracts = 60 / 5 = 12 عقد ← تقليص تلقائي
```

---

### الخطوة 8: تنفيذ الأمر

```typescript
// ضبط وضع الهامش والرافعة
await bingx.setMarginMode(symbol, marginMode);
await bingx.setLeverage(symbol, leverage, direction);

// الأمر الرئيسي مع SL/TP مربوط مباشرة
order = await bingx.placeOrder(symbol, type, side, amount, price, {
    positionSide: direction,  // للـ Hedge Mode
    stopLoss: { triggerPrice: SL, type: 'STOP_MARKET' },
    takeProfit: { triggerPrice: TP1, type: 'TAKE_PROFIT_MARKET' }
});
```

**عند الفشل — 2 محاولات إعادة:**
1. `Insufficient margin` → إعادة بـ 50% من الحجم
2. `PositionSide error` → إعادة بعكس افتراض Hedge Mode

---

### الخطوة 9: حفظ في قاعدة البيانات

```typescript
const trade = new Trade({
    userId, symbol, direction,
    entryPrice: order.average || entryPrice,
    stopLoss, targets: finalTpPrices,
    amount: positionSizeUSDT, leverage,
    bingxOrderId: order.id,
    currentStatus: isLimitOrder && order.status==='open' ? 'PENDING' : 'OPEN'
});
await trade.save();
```

---

### الخطوة 10: حساب TradeResult للتقرير

```typescript
// PnL المتوقع لكل هدف
pnlPercent = (targetPrice - entryPrice) / entryPrice × 100 × leverage

// PnL المتوقع لـ SL
slPnl = (slPrice - entryPrice) / entryPrice × 100 × leverage

return {
    tradeId, symbol, direction, entryPrice,
    amount: amountContracts, margin: marginUsed,
    marginPercentage: (marginUsed/balance) × 100,
    leverage, riskPercentage,
    targets: [{ price, pnlPercent }],
    stopLoss: { price, pnlPercent },
    orderType: 'market'|'limit',
    isPending: isLimitOrder && !filled
};
```

---

## 🔄 `closeAllPositions(userId)` — إغلاق كل الصفقات

```typescript
const positions = await bingx.getPositions();
for (const pos of positions) {
    if (pos.contracts == 0) continue;
    side = pos.side === 'long' ? 'sell' : 'buy';
    await bingx.placeOrder(pos.symbol, 'market', side, pos.contracts);
}
return closedCount;
```

---

## 🎯 `closeSpecificPosition(userId, symbol)` — إغلاق صفقة محددة

```typescript
const positions = await bingx.getPositions(symbol);
const activePos = positions.filter(p => p.contracts > 0);
for (const pos of activePos) {
    await bingx.placeOrder(pos.symbol, 'market', closeSide, pos.contracts);
}
```

---

## 📊 ملخص طبقات الحماية

| الطبقة | الشرط | الإجراء |
|--------|-------|---------|
| 1 | balance <= 0 | رفض + رسالة خطأ |
| 2 | amountContracts < minAmount | رفض + توضيح السبب |
| 3 | positionSizeUSDT < 5.1 | رفع للحد الأدنى |
| 4 | totalMarginUsed >= 10% | رفض الصفقة |
| 5 | marginUsed > remainingExposure | تقليص الهامش |
| 6 | projectedSLLoss > maxSlRisk% | تقليص عدد العقود |
