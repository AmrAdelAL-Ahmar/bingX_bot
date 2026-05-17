# 📊 V2Engine.ts — محرك MFI الكمّي

> **الموقع:** `src/services/engines/V2Engine.ts`  
> **الدور:** محرك بسيط يعتمد على **Money Flow Index (MFI)** كعامل رئيسي مع مساندة Matrix للحالات المحايدة.

---

## 📋 نظرة عامة

| الخاصية | القيمة |
|---------|--------|
| **المؤشر الرئيسي** | MFI (Money Flow Index) |
| **المدى** | 0 - 100 |
| **أدنى winRate** | 60% |
| **SL** | ATR × 3 (أوسع من V1) |
| **TP** | SL × 1.5 (نسبة R:R ثابتة 1:1.5) |
| **وقت الصفقة** | 60/240 دقيقة |

---

## 🧮 خوارزمية `runQuantLogic`

### الخطوة 1: تحديد الاتجاه بناءً على MFI

```typescript
const mfi = data.indicators.mfi || 50;

const type = mfi < 30 ? 'LONG'
           : mfi > 70 ? 'SHORT'
           : (m.percentage >= 50 ? 'LONG' : 'SHORT');  // Matrix يقرر إذا MFI محايد
```

| MFI | التفسير | القرار |
|-----|---------|--------|
| < 30 | تشبع بيعي (قليل من المال يدخل) | LONG |
| 30-70 | محايد → Matrix يقرر | يعتمد على Matrix% |
| > 70 | تشبع شرائي (كثير من المال دخل) | SHORT |

---

### الخطوة 2: حساب winRate

```typescript
winRate = min(60 + |mfi - 50| × 0.8, 92)
```

| MFI | |mfi - 50| | winRate |
|-----|---------|---------|
| 20 (أو 80) | 30 | 60 + 24 = 84% |
| 10 (أو 90) | 40 | 60 + 32 = 92% |
| 50 (محايد) | 0 | 60% |

---

### الخطوة 3: حساب TP/SL

```typescript
const slDistance = data.atr × 3;  // أوسع من V1 (2.5)

tp = LONG  ? cp + (slDistance × 1.5) : cp - (slDistance × 1.5)
sl = LONG  ? cp - slDistance          : cp + slDistance
```

**R:R ثابت: 1:1.5** (دائماً TP = 1.5 × SL distance)

---

## 🔍 ما يميز V2 عن V1؟

| الجانب | V1 | V2 |
|--------|----|----|
| **العامل الرئيسي** | VWAP (مؤسساتي) | MFI (تدفق الأموال) |
| **SL** | ATR × 2.5 | ATR × 3 |
| **TP** | max(MA7, ATR×2) | ATR × 4.5 (1.5 × SL) |
| **R:R** | غير ثابت | ثابت 1:1.5 |
| **winRate أدنى** | 50% | 60% |
| **وقت الصفقة** | 20/90 دقيقة | 60/240 دقيقة |

**V2 مثالي للتحليل الكمّي** المبني على تدفق الأموال الفعلي، ليس فقط السعر.

---

# ⚡ V4Engine.ts — محرك Bollinger + CCI

> **الموقع:** `src/services/engines/V4Engine.ts`  
> **الدور:** محرك يعتمد على **Bollinger Bands** و **CCI** لتحديد مناطق الشراء/البيع القصوى، مع هدف ثابت عند **Middle Band**.

---

## 📋 نظرة عامة

| الخاصية | القيمة |
|---------|--------|
| **المؤشران** | Bollinger Bands + CCI |
| **الهدف** | BB Middle (SMA-20 دائماً) |
| **SL** | ATR × 2 |
| **وقت الصفقة** | 15/60 دقيقة (أسرع محرك) |

---

## 🧮 خوارزمية `runScalpLogic`

### الخطوة 1: تحديد الاتجاه

```typescript
const isLong  = cp <= data.indicators.bb.lower || data.indicators.cci < -100;
const isShort = cp >= data.indicators.bb.upper || data.indicators.cci > 100;

type = isLong ? 'LONG' : 'SHORT';
```

| الشرط | المعنى | القرار |
|-------|--------|--------|
| `price <= BB.lower` | السعر خرج من النطاق السفلي | LONG (ارتداد متوقع) |
| `CCI < -100` | بيع مفرط | LONG |
| `price >= BB.upper` | السعر خرج من النطاق العلوي | SHORT (تصحيح متوقع) |
| `CCI > 100` | شراء مفرط | SHORT |

**⚠️ ملاحظة:** إذا لم يُحقق أياً من الشروط → `isLong = false, isShort = false` → افتراضياً SHORT (باعتبار عدم وجود إشارة شراء).

---

### الخطوة 2: حساب winRate

```typescript
winRate = min(65 + |data.indicators.cci| / 10, 94)
```

| CCI | winRate |
|-----|---------|
| ±100 | 75% |
| ±200 | 85% |
| ±290 | 94% (سقف) |

**المنطق:** كلما كان CCI أبعد عن الصفر (أشد تطرفاً)، زاد احتمال الارتداد.

---

### الخطوة 3: TP/SL

```typescript
tp = data.indicators.bb.middle  // SMA-20 = هدف ثابت
sl = type === 'LONG' ? cp - (atr × 2) : cp + (atr × 2)
```

**لماذا BB Middle؟**  
لأن مبدأ Bollinger هو أن السعر يميل للعودة للمتوسط (Mean Reversion). خروج السعر من النطاق → يتوقع العودة للمنتصف.

---

## 🔍 مقارنة V4 مع V2 و V1

| الجانب | V1 | V2 | V4 |
|--------|----|----|-----|
| **المنهجية** | احتمالي | كمّي (MFI) | Mean Reversion |
| **TP** | MA7/ATR×2 | ATR×4.5 | BB Middle (ثابت!) |
| **SL** | ATR×2.5 | ATR×3 | ATR×2 (أضيق) |
| **وقت الصفقة** | 20/90 دق | 60/240 دق | **15/60 دق (الأسرع)** |
| **winRate أدنى** | 50% | 60% | **65%** |

---

# 🔌 ITradingEngine.ts — الواجهة المشتركة

> **الموقع:** `src/services/engines/ITradingEngine.ts`  
> **الدور:** عقد (Contract) يلزم كل محرك بتنفيذ نفس التوقيع (Signature) لضمان التبادلية.

---

## 📦 الواجهات

```typescript
export interface EngineResult {
    matrix: MatrixResult;    // نتيجة مصفوفة الإطارات
    scalp: TradeRecommendation;  // توصية Scalp
    swing: TradeRecommendation;  // توصية Swing
}

export interface ITradingEngine {
    analyze(
        cp: number,                                    // السعر الحالي
        vwap: number,                                  // VWAP من 1d
        allTimeframes: Record<string, AnalysisDetails>, // 7 إطارات محسوبة
        mtfOHLCV: Record<string, OHLCV[]>,             // شمعات خام
        options: { quickTF: string, longTF: string }   // إعدادات المستخدم
    ): EngineResult;
}
```

**لماذا هذا مهم؟**  
`AnalysisService` يستخدم `engine.analyze()` بدون معرفة أي محرك بالضبط:
```typescript
const engine = ENGINES[version] || ENGINES['V1'];
const result = engine.analyze(cp, vwap, allTimeframes, mtfOHLCV, options);
// يعمل مع V1-V6 بنفس الطريقة
```
