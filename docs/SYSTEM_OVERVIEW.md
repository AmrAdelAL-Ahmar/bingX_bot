# 🌐 SYSTEM_OVERVIEW.md — النظرة الشاملة على نظام التداول الآلي

> **المشروع:** BotTrading BingX  
> **التقنية:** TypeScript + Node.js  
> **المنصة:** BingX Futures

---

## 🏗️ المعمارية الكاملة للنظام

```
┌─────────────────────────────────────────────────────────┐
│                    Telegram Bot Layer                   │
│          (messageHandlers / settingsHandlers)           │
└───────────────────────┬─────────────────────────────────┘
                        │ يستدعي
┌───────────────────────▼─────────────────────────────────┐
│                  AnalysisService.ts                     │
│   (الخدمة المركزية - تنسق كل شيء)                      │
│                                                         │
│  ┌─────────────────────────────────────────────────┐   │
│  │              Engine Registry                    │   │
│  │  V1 | V2 | V3 | V4 | V5 | V6                  │   │
│  └─────────────────────────────────────────────────┘   │
└──────┬────────────────────┬────────────────────────────┘
       │                    │
       ▼                    ▼
┌──────────────┐    ┌──────────────────┐
│ TechnicalA.  │    │  MTFDataBuilder  │
│  (حسابات)   │    │  (بناء بيانات)   │
└──────────────┘    └──────────────────┘
       │
       ▼
┌──────────────────────────────────────┐
│          BingXService                │
│  (جلب البيانات من BingX API)         │
└──────────────────────────────────────┘

┌─────────────────────────────────────────────────────────┐
│                  BacktestService.ts                     │
│       (مستقل - يستخدم المحركات والبيانات)              │
│   Pass1: إشارات → Pass2: تقييم → Pass3: محاكاة مال    │
└─────────────────────────────────────────────────────────┘
```

---

## 📊 تدفق البيانات الكامل (Data Flow)

```
1. المستخدم يطلب تحليل BTC/USDT بـ V3

2. AnalysisService.analyze('BTC', 'V3', {quickTF:'5m', longTF:'1h'})
   │
   ├─ BingXService.getPricePrecision('BTC/USDT:USDT')
   │
   ├─ [متوازي] لكل إطار في ['1m','5m','15m','30m','1h','4h','1d']:
   │   fetchOHLCV(symbol, tf, 200+)
   │
   ├─ TechnicalAnalyzer.calculateVWAP(ohlcv_1d)
   │
   ├─ [لكل إطار] TechnicalAnalyzer.calculateTechnicalData()
   │       → RSI + MACD + ATR + BB + StochRSI + CCI + WilliamsR + MFI
   │       → SMA(7,20,99) + Pivot + R1/S1/R2/S2 + Fib(382,618,Target)
   │       → lastSwingHigh/Low (آخر 15 شمعة)
   │       → detectMarketStructure() (آخر 30 شمعة)
   │
   ├─ V3Engine.analyze()
   │   [طبقة 1] هيكل السوق → LONG/SHORT/NEUTRAL
   │   [طبقة 2] Divergence Shield (آخر 20 شمعة)
   │   [حاجز]  RSI < 25 أو > 75 → إلغاء
   │   [طبقة 3] Macro 1h/4h confirmation (±20 نقطة)
   │   [طبقة 4] VWAP + RSI confluence (±25 نقطة)
   │   [طبقة 5] MACD momentum (±10 نقطة)
   │   [طبقة 6] Matrix alignment (±25 نقطة)
   │   [طبقة 7] Dynamic SL/TP (مستويات تقنية + R/R 1:1.5)
   │   [طبقة 8] القرار النهائي (>72% قوي | >60% متوسط | أقل ضعيف)
   │
   ├─ Sniper V7:
   │   isStochSynced  = StochRSI(5m) < 25 && StochRSI(1h) < 25
   │   isFullBreakout = matrix.percentage >= 95%
   │   isAboveGolden  = price > fib618(5m)
   │
   └─ AnalysisResult الكامل → AnalysisFormatter → تقرير Telegram
```

---

## 🔍 مقارنة المحركات

| المعيار | V1 | V3 ⭐ | V5 | V6 |
|---------|-----|------|-----|-----|
| **المنهجية** | احتمالي | Sniper متعدد الطبقات | تنبؤ خطي | Sniper + Firewall |
| **عدد الطبقات** | 3 عوامل | 8 طبقات | 1 خوارزمية | ~4 طبقات |
| **هيكل السوق** | ❌ | ✅ الطبقة 1 | ❌ | ❌ |
| **Divergence** | ❌ | ✅ الطبقة 2 | ❌ | ✅ |
| **RSI Extreme Block** | ❌ | ✅ | ❌ | ❌ |
| **Macro Confirmation** | ❌ | ✅ 1h/4h | ❌ | ❌ |
| **VWAP** | ✅ بسيط | ✅ تفصيلي | ❌ | ✅ بسيط |
| **MACD** | ❌ | ✅ | ❌ | ❌ |
| **Matrix** | ✅ موحدة | ✅ موحدة | ✅ (غير مباشر) | ✅ **منفصلة** |
| **R/R مضمون** | ❌ | ✅ 1:1.5 | ❌ | ❌ |
| **يُلغي إشارات** | ❌ دائماً يُولد | ✅ في حالات كثيرة | ❌ | ✅ في 4 حالات |
| **SL** | ATR×2.5 | مستويات تقنية | ATR×4 | SwingLevel ± ATR×0.5 |
| **TP** | MA7/ATR×2 | R1/fibTarget | predictedPrice | SwingHigh/Low |
| **مناسب لـ** | تحليل عام | تداول دقيق | مراقبة الزخم | تداول منفصل |

---

## 📐 جدول المؤشرات الشامل

| المؤشر | الفترة | الشمعات | الإطارات | يُحسب في |
|--------|--------|---------|----------|----------|
| RSI | 14 | 15+ | **جميع الإطارات** | TechnicalAnalyzer |
| MACD | 12/26/9 | 35+ | **جميع الإطارات** | TechnicalAnalyzer |
| Bollinger Bands | 20 | 20+ | **جميع الإطارات** | TechnicalAnalyzer |
| ATR | 14 | 15+ | **جميع الإطارات** | TechnicalAnalyzer |
| StochRSI | 14/14/3/3 | 45+ | **جميع الإطارات** | TechnicalAnalyzer |
| CCI | 20 | 20+ | **جميع الإطارات** | TechnicalAnalyzer |
| WilliamsR | 14 | 15+ | **جميع الإطارات** | TechnicalAnalyzer |
| MFI | 14 | 15+ | **جميع الإطارات** | TechnicalAnalyzer |
| SMA(7/20/99) | 7/20/99 | 7/20/99+ | **جميع الإطارات** | TechnicalAnalyzer |
| VWAP | كل الشمعات | 200 | **1d فقط** | TechnicalAnalyzer |
| Pivot/R1/S1/R2/S2 | آخر شمعة | 2 | **جميع الإطارات** | TechnicalAnalyzer |
| Fibonacci 382/618 | آخر 50 | 50 | **جميع الإطارات** | TechnicalAnalyzer |
| lastSwingHigh/Low | آخر 15 | 15 | **جميع الإطارات** | TechnicalAnalyzer |
| Market Structure | آخر 30 | 30 | **جميع الإطارات** | TechnicalAnalyzer |
| Divergence | آخر 20 | 20 | quickTF/swingTF أو 5m/15m/1h | TechnicalAnalyzer |
| Correction Fib | آخر 40 | 40 | 5m, 15m, 1h | TechnicalAnalyzer |
| Linear Regression | آخر 20 | 20 | quickTF/swingTF | TechnicalAnalyzer (V5 فقط) |
| Matrix Score | كل الإطارات | 15+ لكل | 7 إطارات | TechnicalAnalyzer |

---

## 🔄 نظام الإشارات والقرارات

```
الإشارة ممكنة → TradeRecommendation
    │
    ├── type: 'LONG' | 'SHORT' | 'NONE'
    │
    ├── entry: السعر الحالي
    │
    ├── tp: الهدف (يختلف حسب المحرك)
    │   V1: max(MA7, cp + ATR×2)
    │   V3: max(R1, fibTarget, cp + ATR×2) أو min(S1, fib382)
    │   V5: predictedPrice
    │   V6: max/min(SwingLevel, cp ± ATR×2)
    │
    ├── sl: وقف الخسارة
    │   V1: cp ± ATR×2.5
    │   V3: ديناميكي (SwingLevel + safetyBuffer)، ضمان 0.6% من السعر
    │   V5: cp ± ATR×4
    │   V6: min/max(cp ± ATR×2.5, SwingLevel ± ATR×0.5)
    │
    ├── winRate: نسبة النجاح المتوقعة
    │   V1/V6: 50 + |score|×0.6  (حد أقصى 96%)
    │   V3:    50 + score×0.75   (حد 0-95%)
    │   V5:    70 + confidence×0.1 (حد 96%)
    │
    └── confidenceScore: النقاط الخام
```

---

## 🧪 BacktestService — ملخص المراحل

```
المرحلة الأولية (Warmup):
  جلب بيانات تاريخية لـ 7 إطارات مع padding إضافي

Pass 1 - توليد الإشارات:
  خطوة كل N دقيقة، فلتر Look-Ahead Bias، تشغيل المحرك

Pass 2 - تقييم الصفقات:
  فحص TP/SL على شمعات 5m المستقبلية

Pass 3 - محاكاة رأس المال:
  أحداث OPEN/CLOSE مرتبة زمنياً
  حساب: Margin, MaxSLCap, PnL, ROI, Drawdown
```

---

## 📚 المصطلحات المستخدمة في الكود

| المصطلح | المعنى |
|---------|-------|
| `HH/HL` | Higher High / Higher Low — قمم وقيعان متصاعدة = سوق صاعد |
| `LH/LL` | Lower High / Lower Low — قمم وقيعان متنازلة = سوق هابط |
| `BOS` | Break of Structure — كسر هيكل = تغيير اتجاه محتمل |
| `VWAP` | Volume Weighted Average Price — المتوسط المؤسساتي |
| `MTF` | Multi-TimeFrame — تحليل متعدد الإطارات |
| `Divergence` | انحراف السعر عن RSI — إشارة ضعف الزخم |
| `Scalp` | صفقة قصيرة المدى (دقائق-ساعات) |
| `Swing` | صفقة متوسطة المدى (ساعات-أيام) |
| `Macro` | الإطار الأكبر (1h للـ Scalp، 4h للـ Swing) |
| `Firewall` | جدار حماية يعزل إطارات Scalp عن Swing في V6 |
| `Warmup` | شمعات تحميل إضافية تضمن دقة المؤشرات في Backtest |
| `Look-Ahead Bias` | خطأ استخدام بيانات المستقبل في قرارات الماضي |
| `Isolated Margin` | وضع الهامش المعزول — أقصى خسارة = الهامش فقط |
| `ROI` | Return on Investment — عائد الاستثمار |
| `Drawdown` | أقصى تراجع في رأس المال من ذروته |
| `R/R` | Risk/Reward Ratio — نسبة المخاطرة للعائد |

---

## 📁 هيكل ملفات التوثيق

```
docs/
    ├── TechnicalAnalyzer.md    ← المؤشرات والمعادلات الحسابية
    ├── MTFDataBuilder.md       ← بناء البيانات ومنع Look-Ahead
    ├── AnalysisService.md      ← الخدمة المركزية والتايبات
    ├── BacktestService.md      ← المراحل الثلاث لمحاكاة رأس المال
    ├── SYSTEM_OVERVIEW.md      ← هذا الملف (النظرة الشاملة)
    └── engines/
            ├── V1Engine.md     ← المحرك الاحتمالي البسيط
            ├── V3Engine.md     ← محرك Sniper الـ 8 طبقات ⭐
            ├── V5Engine.md     ← محرك التنبؤ الخطي
            └── V6Engine.md     ← محرك Sniper مع Firewall
```
