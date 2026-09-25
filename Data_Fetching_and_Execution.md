# شرح عملية جلب البيانات وآلية التنفيذ البرمجي (V1)

يوضح هذا المستند التفاصيل التقنية لكيفية تفاعل الكود مع منصة التداول (BingX) وكيفية معالجة البيانات برمجياً للوصول إلى قرار التداول.

---

## 1. جلب البيانات (Data Fetching)

تتم عملية جلب البيانات على مرحلتين: توحيد اسم العملة، ثم جلب شموع الـ OHLCV لعدة إطارات زمنية.

### أ- توحيد اسم العملة (Symbol Normalization)
يقوم الكود أولاً بالتأكد من أن اسم العملة متوافق مع صيغة المنصة:
```typescript
// src/services/AnalysisService.ts
let symbol = symbolInput.toUpperCase();
if (!symbol.includes('/')) symbol = `${symbol}/USDT:USDT`;
```

### ب- جلب البيانات المتعددة (Multi-TF Fetching)
يستخدم النظام حلقة تكرار (Loop) لجلب البيانات لـ 7 فريمات زمنية مختلفة بالتوازي:
```typescript
// src/services/AnalysisService.ts
const matrixTFs = ['1m', '5m', '15m', '30m', '1h', '4h', '1d'];
const mtfOHLCV: Record<string, any[]> = {};

for (const tf of matrixTFs) {
    // جلب البيانات من خدمة BingX
    mtfOHLCV[tf] = await this.bingxService.fetchOHLCV(symbol, tf, 200);
}
```

### ج- الكود المسؤول عن جلب البيانات من المنصة (BingXService)
يستخدم البوت مكتبة `CCXT` للاتصال بـ BingX:
```typescript
// src/services/BingXService.ts
async fetchOHLCV(symbol: string, timeframe: string, limit: number = 100) {
    try {
        await this.exchange.loadMarkets();
        // جلب الشموع: [التوقيت، الافتتاح، الأعلى، الأدنى، الإغلاق، الحجم]
        const ohlcv = await this.exchange.fetchOHLCV(symbol, timeframe, undefined, limit);
        return ohlcv.map((candle: any) => ({
            timestamp: candle[0],
            open: candle[1],
            high: candle[2],
            low: candle[3],
            close: candle[4],
            volume: candle[5]
        }));
    } catch (error) {
        logger.error(`Error fetching OHLCV for ${symbol}: `, error);
        throw error;
    }
}
```

---

## 2. آلية التنفيذ والتحليل (Execution Logic)

بعد جلب البيانات، يبدأ الكود في حساب المؤشرات واتخاذ القرار.

### أ- حساب المؤشرات التقنية
يتم استخدام مكتبة `technicalindicators` لحساب المؤشرات دفعة واحدة:
```typescript
// مثال لحساب RSI و MACD في AnalysisService.ts
const rsiArr = RSI.calculate({ period: 14, values: quickCloses });
const macdArr = MACD.calculate({ 
    values: quickCloses, 
    fastPeriod: 12, 
    slowPeriod: 26, 
    signalPeriod: 9, 
    SimpleMAOscillator: false, 
    SimpleMASignal: false 
});
```

### ب- منطق اتخاذ القرار (Probability Engine)
هذا هو "المخ" الخاص بالإصدار الأول، حيث يقوم بجمع النقاط بناءً على معطيات السوق:

```typescript
// src/services/AnalysisService.ts
private analyzeProbabilityEngine(symbol, cp, vwap, rsi, ind, levels, m, struct, atr) {
    let score = 0;

    // 1. فحص الاتجاه بالنسبة لـ VWAP
    score += vwap ? 25 : -25; 

    // 2. إضافة قوة المصفوفة (الاتجاه في الفريمات المتعددة)
    score += (m.percentage - 50) * 0.8;

    // 3. فحص التشبع (RSI)
    if (rsi < 35) score += 15;      // فرصة شراء من تشبع بيعي
    else if (rsi > 65) score -= 15; // فرصة بيع من تشبع شرائي

    // حساب نسبة النجاح النهائية
    const winRate = Math.min(50 + (Math.abs(score) * 0.6), 96);
    const type = score >= 0 ? 'LONG' : 'SHORT';

    // تحديد الأهداف والوقف
    const slDistance = atr * 2.5; // الوقف يعتمد على تذبذب العملة
    
    return {
        type,
        entry: cp,
        tp: type === 'LONG' ? Math.max(levels.ma7, cp + atr * 2) : Math.min(levels.ma7, cp - atr * 2),
        sl: type === 'LONG' ? cp - slDistance : cp + slDistance,
        winRate
    };
}
```

---

## 3. ملخص خطوات التنفيذ (Workflow)

1.  **Request:** يستلم الكود طلب التحليل لعملة معينة.
2.  **Normalization:** يتم تحويل الاسم وتجهيز الإعدادات (الفريمات، عدد الشموع).
3.  **Parallel Fetch:** يتم جلب بيانات 7 فريمات زمنية في وقت واحد لضمان السرعة.
4.  **Indicator Processing:** يتم تحويل بيانات الشموع الخام إلى قيم تقنية (RSI, ATR, BB...).
5.  **Scoring Engine:** يتم تمرير القيم لمحرك الاحتمالات الذي يجمع النقاط.
6.  **Recommendation:** إذا كان المجموع موجباً يعطي `LONG` وإذا كان سالباً يعطي `SHORT`.
7.  **Output:** يتم تنسيق النتائج في نص (Report) ليظهر للمستخدم أو ليرسل للبوت.

---
*تم إعداد هذا الشرح التقني لتوضيح آلية عمل الكود في الخلفية.*
