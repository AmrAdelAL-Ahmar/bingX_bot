# 🔗 ANALYSIS_RELATIONSHIPS.md — علاقات التحليل بكامل المشروع

> **الملف:** `docs/ANALYSIS_RELATIONSHIPS.md`  
> **الغرض:** يشرح كيف تتدفق بيانات التحليل من مصدرها حتى المستخدم النهائي، ومَن يستدعي مَن.

---

## 🗺️ خريطة العلاقات الكاملة

```
┌─────────────────────────────────────────────────────────────────┐
│                        index.ts (Bootstrap)                     │
│  ينشئ: BingXService, AnalysisService, TradeManager,            │
│         PositionMonitor, ReportingService                       │
└──┬──────────────────────────────────────────────────────────────┘
   │
   ├─────────────────────────────────────────────────────────────┐
   │               AnalysisService  (قلب التحليل)               │
   │                                                             │
   │  يستدعي:                                                    │
   │  ├─ BingXService.fetchOHLCV()   ← جلب الشمعات              │
   │  ├─ BingXService.getPricePrecision() ← دقة السعر           │
   │  ├─ TechnicalAnalyzer.calculateVWAP()                       │
   │  ├─ TechnicalAnalyzer.calculateTechnicalData() × 7         │
   │  ├─ TechnicalAnalyzer.calculateMatrix()                     │
   │  ├─ TechnicalAnalyzer.detectDivergence()                    │
   │  ├─ TechnicalAnalyzer.calculateCorrectionFibLevels()        │
   │  └─ engine.analyze() → V1|V2|V3|V4|V5|V6                   │
   └─────────────────────────────────────────────────────────────┘
```

---

## 📞 من يستدعي AnalysisService؟

| المستدعي | الدالة المستخدمة | السياق |
|---------|-----------------|--------|
| `messageHandlers.ts` | `analysisService.analyze()` | عند طلب تحليل من المستخدم |
| `PositionMonitor.ts` | `analysis.detectDivergence()` | كل 30 ثانية للصفقات المفتوحة |
| `PositionMonitor.ts` | `analysis.calculateCorrectionFibLevels()` | لحساب نطاق التصحيح |
| `PositionMonitor.ts` | `analysis.isPivotBroken()` | للتحقق من كسر مستوى Pivot |
| `BacktestService.ts` | `engine.analyze()` (مباشرة) | في كل خطوة من الـ Backtest |

---

## 🔍 تدفق التحليل خطوة بخطوة

### 📱 السيناريو 1: المستخدم يطلب تحليل عملة

```
المستخدم → Telegram → messageHandlers.ts
    │
    ├── يستدعي: AnalysisService.analyze('BTC', 'V3', {quickTF:'5m', longTF:'1h'})
    │
    ├── AnalysisService:
    │   ├── BingXService.getPricePrecision('BTC/USDT:USDT')
    │   ├── [متوازي] BingXService.fetchOHLCV() × 7 إطارات
    │   ├── TechnicalAnalyzer.calculateVWAP(ohlcv_1d)
    │   ├── TechnicalAnalyzer.calculateTechnicalData() × 7
    │   └── V3Engine.analyze(cp, vwap, allTimeframes, mtfOHLCV)
    │       ├── [طبقة 1] هيكل السوق
    │       ├── [طبقة 2] Divergence → TechnicalAnalyzer.detectDivergence()
    │       ├── [طبقات 3-8] VWAP, RSI, MACD, Matrix, SL/TP
    │       └── → TradeRecommendation (LONG/SHORT/NEUTRAL)
    │
    ├── AnalysisFormatter.formatReport() → نص التقرير
    │
    └── messageHandlers.ts → إرسال التقرير للمستخدم عبر Telegram
```

### 🔄 السيناريو 2: مراقبة الصفقات (كل 30 ثانية)

```
PositionMonitor.checkPositions() [كل 30 ثانية]
    │
    ├── Trade.find({ status: ['PENDING','OPEN','TP1_HIT','TP2_HIT'] })
    │
    ├── [للصفقات المعلقة] BingXService.getOrder() → تحقق من التنفيذ
    │
    ├── [للصفقات المفتوحة] BingXService.getPositions()
    │
    └── [Correction Guard] إذا correctionAlertEnabled:
        ├── BingXService.fetchOHLCV(symbol, '5m', 50)
        ├── AnalysisService.detectDivergence(ohlcv5m, direction)
        │   └── → TechnicalAnalyzer.detectDivergence()
        ├── AnalysisService.calculateCorrectionFibLevels(ohlcv5m)
        │   └── → TechnicalAnalyzer.calculateCorrectionFibLevels()
        └── BingXService.fetchOHLCV(symbol, '1h', 2)
            └── AnalysisService.isPivotBroken(price, pivot, direction)
```

### 🧪 السيناريو 3: Backtest

```
BacktestService.runAdvancedBacktest()
    │
    ├── BingXService.fetchDeepHistoricalData() × 7 إطارات
    │
    ├── [Pass 1] لكل خطوة زمنية t:
    │   ├── MTFDataBuilder.tfToMs(tf) → فلتر الشمعات المغلقة
    │   ├── TechnicalAnalyzer.calculateVWAP()
    │   ├── TechnicalAnalyzer.calculateTechnicalData() × 7
    │   └── engine.analyze() → V1|V2|V3|V4|V5|V6
    │
    ├── [Pass 2] فحص TP/SL على شمعات 5m
    └── [Pass 3] محاكاة رأس المال
```

---

## 📊 دوال AnalysisService المُصدَّرة وكيف تُستخدم

| الدالة | مَن يستدعيها | الشمعات | الإطار |
|--------|------------|---------|--------|
| `analyze()` | messageHandlers | 200+ | 7 إطارات |
| `detectDivergence()` | PositionMonitor | 50 | 5m |
| `calculateCorrectionFibLevels()` | PositionMonitor | 50 | 5m |
| `isPivotBroken()` | PositionMonitor | 2 | 1h |
| `generateCorrectionReport()` | messageHandlers | 50 | 5m, 15m, 1h |
| `formatReport()` | messageHandlers | — | — |
| `generateDetailedReport()` | messageHandlers | — | — |
| `generateEducationalGuide()` | messageHandlers | — | — |
| `generateComprehensiveReport()` | messageHandlers | — | — |

---

## 🔗 دوال TechnicalAnalyzer وكيف تُستخدم

| الدالة | يستدعيها | عدد الشمعات |
|--------|---------|------------|
| `calculateTechnicalData()` | AnalysisService, BacktestService | 200+ |
| `calculateVWAP()` | AnalysisService, BacktestService | 200 (1d) |
| `calculateMatrix()` | V1-V6 engines | 15+ لكل إطار |
| `detectDivergence()` | V3Engine, V6Engine, AnalysisService | 20+ |
| `calculateCorrectionFibLevels()` | AnalysisService | 40+ |
| `predictNextPriceLinear()` | V5Engine | 20 |
| `detectMarketStructure()` | داخلياً في calculateTechnicalData | 30 |
| `prepareCandleData()` | داخلياً في calculateTechnicalData | كل الشمعات |
| `calculateIndicators()` | داخلياً في calculateTechnicalData | 15-45+ |

---

## 🏗️ علاقات الإرث والتنفيذ (Inheritance / Implementation)

```
ITradingEngine (Interface)
    │
    ├── implements: V1Engine
    ├── implements: V2Engine
    ├── implements: V3Engine
    ├── implements: V4Engine
    ├── implements: V5Engine
    └── implements: V6Engine

كل محرك يُنفذ:
    analyze(cp, vwap, allTimeframes, mtfOHLCV, options): EngineResult
    EngineResult = { matrix: MatrixResult, scalp: TradeRecommendation, swing: TradeRecommendation }
```

---

## 🗃️ علاقات قاعدة البيانات

```
MongoDB
    │
    ├── Collection: users (User.ts)
    │   يُقرأ من: TradeManager, PositionMonitor, settingsHandlers
    │   يُكتب في: settingsHandlers (إعدادات المستخدم)
    │
    └── Collection: trades (Trade.ts)
        يُكتب في: TradeManager.executeSignal() → عند فتح صفقة
        يُقرأ من: PositionMonitor.checkPositions() → كل 30 ثانية
        يُحدَّث في: PositionMonitor → عند إغلاق/تحديث الصفقة
        يُقرأ من: ReportingService → للتقارير الأسبوعية/الشهرية
        يُقرأ من: portfolioHandlers → لعرض المحفظة
```

---

## 📨 علاقة PositionMonitor بالتحليل

```typescript
// في PositionMonitor — يستخدم AnalysisService مباشرة
const divergence = this.analysis.detectDivergence(ohlcv5m, trade.direction);
const fib = this.analysis.calculateCorrectionFibLevels(ohlcv5m, trade.direction);
const isPivot = this.analysis.isPivotBroken(currentPrice, pivot, trade.direction);
```

**البيانات المُجلبة:**
- `BingXService.fetchOHLCV(symbol, '5m', 50)` → 50 شمعة 5 دقائق
- `BingXService.fetchOHLCV(symbol, '1h', 2)` → آخر شمعتان 1h لحساب Pivot

**المنطق:**
1. إذا كان `divergence.detected = true` → إرسال تحذير Correction
2. إذا كان `isPivotBroken = true` → إرسال تنبيه حرج وتعطيل التنبيهات

---

## ⚡ ملخص جدول الاستدعاءات الكاملة

```
messageHandlers
    → AnalysisService.analyze()
        → BingXService (fetchOHLCV × 7, getPricePrecision)
        → TechnicalAnalyzer (calculateVWAP, calculateTechnicalData × 7)
        → engine.analyze() (V1-V6)
            → TechnicalAnalyzer.calculateMatrix()
            → TechnicalAnalyzer.detectDivergence() [V3,V6]
            → TechnicalAnalyzer.predictNextPriceLinear() [V5]
    → AnalysisFormatter (formatReport, generateDetailedReport...)

PositionMonitor [كل 30 ثانية]
    → BingXService (getPositions, getOrder, fetchOHLCV, getMarketPrice)
    → AnalysisService (detectDivergence, calculateCorrectionFibLevels, isPivotBroken)
    → Trade (find, save)
    → User (findById)
    → notifier() [sendTelegramMessage]

BacktestService
    → BingXService.fetchDeepHistoricalData() × 7
    → MTFDataBuilder.tfToMs()
    → TechnicalAnalyzer (calculateVWAP, calculateTechnicalData × 7)
    → engine.analyze() × N خطوات
```
