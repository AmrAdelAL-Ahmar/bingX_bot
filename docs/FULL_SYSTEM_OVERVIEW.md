# 🗺️ FULL SYSTEM OVERVIEW — الدليل الشامل لنظام التداول BingX

> **الإصدار:** 2.0 (محدّث ليشمل كل ملفات المشروع)  
> **آخر تحديث:** 2026-05-18

---

## 📐 هيكل المشروع الكامل

```
src/
├── index.ts                          ← نقطة الدخول + Bootstrap
├── server.ts                         ← HTTP Health Check
├── config/
│   └── db.ts                         ← اتصال MongoDB
├── models/
│   ├── User.ts                       ← نموذج إعدادات المستخدم
│   └── Trade.ts                      ← نموذج بيانات الصفقة
├── services/
│   ├── BingXService.ts               ← API البورصة (CCXT)
│   ├── AnalysisService.ts            ← قلب التحليل
│   ├── TechnicalAnalyzer.ts          ← مكتبة المؤشرات
│   ├── MTFDataBuilder.ts             ← بناء الإطارات الزمنية
│   ├── BacktestService.ts            ← محاكاة الاستراتيجيات
│   ├── TradeManager.ts               ← تنفيذ الصفقات
│   ├── PositionMonitor.ts            ← مراقبة الصفقات
│   ├── SignalParser.ts               ← تحليل الإشارات النصية
│   ├── ReportingService.ts           ← التقارير الدورية
│   └── engines/
│       ├── ITradingEngine.ts         ← الواجهة المشتركة
│       ├── V1Engine.ts               ← محرك VWAP الاحتمالي
│       ├── V2Engine.ts               ← محرك MFI الكمّي
│       ├── V3Engine.ts               ← محرك Sniper (8 طبقات)
│       ├── V4Engine.ts               ← محرك BB + CCI
│       ├── V5Engine.ts               ← محرك التنبؤ الخطي
│       └── V6Engine.ts               ← محرك Firewall (Scalp≠Swing)
├── bot/
│   ├── middlewares/
│   │   └── userMiddleware.ts         ← التحقق من المستخدم
│   ├── keyboards/
│   │   └── baseKeyboards.ts          ← لوحات المفاتيح (20+ دالة)
│   └── handlers/
│       ├── messageHandlers.ts         ← التحليل + الإشارات + Backtest
│       ├── tradingHandlers.ts         ← التداول (Status + Cancel)
│       ├── portfolioHandlers.ts       ← المحفظة والأرباح
│       ├── reportHandlers.ts          ← التقارير
│       └── settingsHandlers.ts        ← الإعدادات
└── utils/
    ├── logger.ts                      ← Winston Logging
    └── telegram.ts                    ← إرسال آمن (Retry 3×)
```

---

## 🔗 خريطة الاستدعاءات الكاملة

```
Telegram Message
    │
    ▼
userMiddleware.ensureUser()
    │ (يضمن وجود user في DB)
    ▼
Bot Handlers
    │
    ├─ messageHandlers → [التحليل]
    │       └── AnalysisService.analyze()
    │               ├── BingXService.fetchOHLCV() × 7 إطارات
    │               ├── TechnicalAnalyzer.calculateVWAP()
    │               ├── TechnicalAnalyzer.calculateTechnicalData() × 7
    │               └── Engine.analyze() → V1|V2|V3|V4|V5|V6
    │
    ├─ messageHandlers → [إشارة تداول]
    │       └── SignalParser.parse()
    │               └── TradeManager.executeSignal()
    │                       ├── User.findById() ← إعدادات
    │                       ├── BingXService.getBalance()
    │                       ├── BingXService.getPositions() ← فحص 10%
    │                       ├── BingXService.setLeverage()
    │                       ├── BingXService.placeOrder()
    │                       └── Trade.save() ← حفظ في DB
    │
    ├─ messageHandlers → [Backtest]
    │       └── BacktestService.runAdvancedBacktest()
    │               ├── BingXService.fetchDeepHistoricalData() × 7
    │               ├── [Pass 1] TechnicalAnalyzer + Engine × N
    │               ├── [Pass 2] تحقق من TP/SL على 5m
    │               └── [Pass 3] محاكاة رأس المال
    │
    ├─ tradingHandlers → [إلغاء / استعلام]
    │       └── BingXService.getPositions/placeOrder()
    │
    ├─ portfolioHandlers → [المحفظة]
    │       └── BingXService.getBalance/getPositions()
    │
    ├─ reportHandlers → [التقارير]
    │       └── Trade.find() → generateReportStr()
    │
    └─ settingsHandlers → [الإعدادات]
            └── User.findById() + User.save()

Background Services (Parallel):
    ├─ PositionMonitor [كل 30 ثانية]
    │       ├── BingXService (getPositions, fetchOHLCV)
    │       ├── AnalysisService (detectDivergence, isPivotBroken)
    │       ├── Trade.find() + Trade.save()
    │       └── sendTelegramMessage() → تنبيهات
    │
    └─ ReportingService [Cron Job]
            ├── User.find() + Trade.find()
            └── sendTelegramMessage() → تقارير أسبوعية/شهرية
```

---

## 📊 جدول المؤشرات والإطارات

| المؤشر | الدالة | الإطار | عدد الشمعات | يُستخدم في |
|--------|--------|--------|------------|----------|
| **RSI** | `RSI(14)` | كل الإطارات | 28+ | V1-V6, BacktestService |
| **MACD** | `MACD(12,26,9)` | كل الإطارات | 60+ | V1, V3, V5, V6 |
| **Bollinger** | `BB(20,2)` | Quick TF | 60+ | V4 |
| **CCI** | `CCI(20)` | Quick TF | 40+ | V2, V4 |
| **MFI** | `MFI(14)` | Quick TF | 28+ | V2 |
| **StochRSI** | `StochRSI(14,3,3)` | Quick TF | 90+ | V1, V3, V6 |
| **ATR** | `ATR(14)` | كل الإطارات | 28+ | V1-V6 |
| **Williams %R** | `WilliamsR(14)` | Quick TF | 28+ | V3, V6 |
| **VWAP** | منذ بداية 1d | 1d | 200+ | V1, V3, V5, V6 |
| **Pivot Points** | Pivot=(H+L+C)/3 | كل الإطارات | 2+ | V3, V6, PositionMonitor |
| **Fibonacci** | 0.382, 0.618 | كل الإطارات | آخر Swing | V3, V5, V6 |
| **Matrix Score** | نسبة Bullish/Bearish | كل الإطارات (15+) | 7 إطارات | V1-V6 |
| **Linear Regression** | `linreg(20 شمعة)` | Quick TF | 20 | V5 |
| **Market Structure** | Swing High/Low | كل الإطارات | 30 | V3, V6 |
| **Divergence** | RSI vs Price | 5m | 20+ | V3, V6, PositionMonitor |

---

## 🏎️ مقارنة المحركات

| الجانب | V1 | V2 | V3 | V4 | V5 | V6 |
|--------|----|----|----|----|----|----|
| **الفلسفة** | VWAP | MFI | Sniper | Mean Rev. | Predictive | Firewall |
| **طبقات الحماية** | 2 | 2 | 8 | 2 | 3 | 5 |
| **winRate أدنى** | 50% | 60% | 75% | 65% | 68% | 72% |
| **وقت Scalp** | 20 دق | 60 دق | 15 دق | 15 دق | 30 دق | 12 دق |
| **وقت Swing** | 90 دق | 240 دق | 60 دق | 60 دق | 120 دق | 60 دق |
| **SL** | ATR×2.5 | ATR×3 | Dynamic | ATR×2 | ATR×2 | Dynamic |
| **TP** | MA7 أو ATR×2 | ATR×4.5 | Fib | BB Middle | Predicted | Fib |
| **Divergence** | ❌ | ❌ | ✅ | ❌ | ❌ | ✅ |
| **Firewall** | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ |

---

## 🔄 دورة الحياة الكاملة للصفقة

```
[1] إشارة تداول (من مستخدم أو تحليل)
        ↓
[2] SignalParser.parse() → ParsedSignal
        ↓
[3] TradeManager.executeSignal()
    ├── التحقق من الرصيد
    ├── حساب الهامش والرافعة
    ├── حماية التعرض الكلي (10%)
    ├── حماية خسارة SL (maxSlRisk%)
    ├── BingXService.placeOrder() + SL/TP مربوط
    └── Trade.save() { status: 'OPEN'|'PENDING' }
        ↓
[4] PositionMonitor.checkPositions() [كل 30 ثانية]
    ├── Break-Even بعد TP1
    ├── تحذيرات SL (5% خسارة)
    ├── تحذيرات TP (70%, 90%)
    └── Correction Guard (Divergence + Pivot)
        ↓
[5] إغلاق على البورصة (SL/TP/يدوي)
        ↓
[6] PositionMonitor يكتشف الإغلاق
    ├── حساب PnL الفعلي
    ├── Trade.save() { status: 'CLOSED_PROFIT'|'CLOSED_LOSS' }
    └── إرسال إشعار مفصل للمستخدم
        ↓
[7] ReportingService [أسبوعي/شهري]
    └── Trade.find() → تقرير إجمالي
```

---

## 🧪 دورة الحياة الكاملة للـ Backtest

```
[1] اختيار رمز + إصدار + وضع + فترة
        ↓
[2] BingXService.fetchDeepHistoricalData() × 7 إطارات
    (500 شمعة في كل طلب، مع 200ms بين الطلبات)
        ↓
[3] Pass 1: توليد الإشارات
    لكل خطوة زمنية t بفاصل [interval]:
    ├── فلتر الشمعات المغلقة (MTFDataBuilder.tfToMs)
    ├── TechnicalAnalyzer.calculateVWAP()
    ├── TechnicalAnalyzer.calculateTechnicalData() × 7
    └── Engine.analyze() → Scalp أو Swing
        ↓
[4] Pass 2: تقييم الإشارات على 5m
    لكل إشارة:
    ├── البحث في شمعات 5m لمعرفة ما يضرب أولاً (TP أم SL)
    └── تسجيل WIN/LOSS + سعر الإغلاق + المدة
        ↓
[5] Pass 3: محاكاة رأس المال
    ├── بدء بـ initialCapital
    ├── لكل صفقة: حساب marginUsed + PnL USDT
    ├── فحص الإفلاس (margin > availableCapital)
    ├── حساب MaxDrawdown
    └── نهاية رأس المال
        ↓
[6] إرسال تقرير نصي + ملف CSV
```

---

## 🔐 طبقات حماية رأس المال في TradeManager

| الطبقة | الشرط | الإجراء |
|--------|-------|---------|
| 1 | `balance <= 0` | رفض + خطأ |
| 2 | `amountContracts < minAmount` | رفض + شرح |
| 3 | `notional < 5.1 USDT` | رفع للحد الأدنى |
| 4 | `totalExposure >= 10%` | رفض الصفقة |
| 5 | `marginUsed > remainingExposure` | تقليص الهامش |
| 6 | `projectedSLLoss > maxSlRisk%` | تقليص الحجم |

---

## 📚 الوثائق المرجعية

| الملف | الوثيقة |
|-------|---------|
| `AnalysisService.ts` | [AnalysisService.md](./AnalysisService.md) |
| `TechnicalAnalyzer.ts` | [TechnicalAnalyzer.md](./TechnicalAnalyzer.md) |
| `MTFDataBuilder.ts` | [MTFDataBuilder.md](./MTFDataBuilder.md) |
| `BacktestService.ts` | [BacktestService.md](./BacktestService.md) |
| `BingXService.ts` | [services/BingXService.md](./services/BingXService.md) |
| `TradeManager.ts` | [services/TradeManager.md](./services/TradeManager.md) |
| `PositionMonitor.ts` | [services/PositionMonitor.md](./services/PositionMonitor.md) |
| `SignalParser.ts` | [services/SignalParser.md](./services/SignalParser.md) |
| `User.ts` + `Trade.ts` | [models/User.md](./models/User.md) |
| `V1Engine.ts` | [engines/V1Engine.md](./engines/V1Engine.md) |
| `V3Engine.ts` | [engines/V3Engine.md](./engines/V3Engine.md) |
| `V5Engine.ts` | [engines/V5Engine.md](./engines/V5Engine.md) |
| `V6Engine.ts` | [engines/V6Engine.md](./engines/V6Engine.md) |
| `V2 + V4 + ITradingEngine` | [engines/V2_V4_Interface.md](./engines/V2_V4_Interface.md) |
| `index + utils + config` | [infrastructure.md](./infrastructure.md) |
| `Bot Handlers` | [bot/handlers.md](./bot/handlers.md) |
| **علاقات التحليل** | [ANALYSIS_RELATIONSHIPS.md](./ANALYSIS_RELATIONSHIPS.md) |
