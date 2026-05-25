# 🌐 SYSTEM_OVERVIEW.md — النظرة الشاملة على نظام التداول الآلي ونموذج التواصل

> **المشروع:** BotTrading BingX  
> **التقنية:** TypeScript + Node.js  
> **المنصة:** BingX Futures (CCXT)  
> **البنية المعمارية:** هندسة ثلاثية الطبقات مفككة الارتباط (Decoupled 3-Tier Architecture)

---

## 🏗️ الهندسة المعمارية للنظام (Architecture Overview)

تم تقسيم المشروع إلى ثلاث طبقات أساسية لضمان سهولة الصيانة، التوسعية، وعزل منطق العمل الفني عن طبقة العرض:

```
┌────────────────────────────────────────────────────────────────────────┐
│                        Telegram Bot UI Layer                           │
│                      (src/bot/handlers/*)                              │
│         (messageHandlers, settingsHandlers, sniperHandlers...)         │
│          ┌──────────────────────────────────────────────────┐          │
│          │    UI Elements: keyboards/* & menus/* & views.ts  │          │
│          └──────────────────────────────────────────────────┘          │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │ يستدعي (التحكم بالعمليات)
┌───────────────────────────────────▼────────────────────────────────────┐
│                    Facade / Bridge Services Layer                      │
│                           (src/services/*)                             │
│                                                                        │
│   ┌────────────────────────────────────────────────────────────────┐   │
│   │   Background Workers: PositionMonitor / SniperManager          │   │
│   ├────────────────────────────────────────────────────────────────┤   │
│   │   External API Bridge: BingXService (CCXT Connection)          │   │
│   ├────────────────────────────────────────────────────────────────┤   │
│   │   Operations Facades: TradeManager / SymbolPickerService       │   │
│   └────────────────────────────────────────────────────────────────┘   │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │ يمرر البيانات ويطلب الحساب
┌───────────────────────────────────▼────────────────────────────────────┐
│                         Core Engine Layer                              │
│                            (src/core/*)                                │
│          (معزول بالكامل عن واجهة تليجرام - حسابات في الذاكرة)          │
│                                                                        │
│   ┌──────────────────────┐  ┌──────────────────────┐  ┌─────────────┐  │
│   │    core/analysis/    │  │     core/sniper/     │  │ core/radar/ │  │
│   │  CoreAnalysisService │  │  CoreSniperScanner   │  │  CoreTrade- │  │
│   │  TechnicalAnalyzer   │  │    SniperRegistry    │  │    Radar    │  │
│   │   Engines (V1-V11)   │  │  Engines (V7-V11)    │  │ (Trailing)  │  │
│   └──────────────────────┘  └──────────────────────┘  └─────────────┘  │
│   ┌──────────────────────┐  ┌──────────────────────┐                   │
│   │     core/picker/     │  │    core/backtest/    │                   │
│   │  CcxtPickerEngine    │  │  CoreBacktestEngine  │                   │
│   │  CurrencyPickerEngine│  │  CoreSniperBacktester│                   │
│   └──────────────────────┘  └──────────────────────┘                   │
└────────────────────────────────────────────────────────────────────────┘
```

---

## 📊 تدفق البيانات والعمليات المشتركة (Data Flows)

### 1. تدفق التحليل الفني الفوري (Instant Analysis Flow)
```
[User Telegram] ──> analysisHandlers.ts ──> AnalysisService.ts
                                                  │
 ┌────────────────────────────────────────────────┴─ (Fetch Parallel Data)
 ▼
BingXService.fetchOHLCV() for 7 Timeframes
 │
 └─> CoreAnalysisService.analyze() (Core Layer)
         │
         ├─> TechnicalAnalyzer.calculateTechnicalData() (Compute Indicators)
         ├─> EnginesV1..V11.analyze() (Evaluate Strategies)
         └─> AnalysisFormatter.formatReport() (Generate Arabic UI) ──> [Telegram Message]
```

### 2. تدفق رصد واقتناص الصفقات (Whale Sniper Flow)
```
[User Telegram] ──> sniperHandlers.ts ──> SniperWatch (DB Save)
                                                  │
┌─────────────────────────────────────────────────┘ (Interval: 60s Cycle)
▼
SniperManager.ts (Worker)
 │
 ├─> BingXService.getPositions() (Check Concurrency & Margin Lock)
 ├─> BingXService.fetchDeepHistoricalData() (Get Candle Padding)
 └─> CoreSniperScanner.scan() (Core Layer)
         │
         ├─> SniperRegistry.getEngine(V7..V11)
         ├─> VEngine.scan() (Compute POI, SMC Structure, Volume Spikes)
         └─> SniperReport (Return stats & readyToFire flag)
                 │
                 ├─> [If readyToFire === true] ──> Telegram Alert (Execute / Copy / Cancel Buttons)
                 └─> User Clicks Execute ──> TradeManager ──> BingX Order Place ──> Save Trade DB
```

### 3. تدفق فرز واكتشاف العملات (Market Scanner Flow)
```
[User Telegram] ──> pickerHandlers.ts ──> SymbolPickerService.ts
                                                  │
 ┌────────────────────────────────────────────────┴─ (Batch Size = 5)
 ▼
CcxtPickerEngine / CurrencyPickerEngine (Core Layer)
 │
 ├─> ccxt.bingx.loadMarkets() & fetchTickers() (Global volume rank)
 ├─> Filter Quote Volume > 15M & Exclude Choppy Markets (SMC filter)
 ├─> Score Volatility (ATR), Volume Pump, MACD, RSI, Level Proximity
 └─> Rank & Update DB (MarketScanner) ──> Return Top N ──> pickerHandlers Progress Bar
```

### 4. تدفق الرادار والمراقبة النشطة (Trade Radar Flow)
```
PositionMonitor (Worker Cycle: 30s)
 │
 ├─> BingXService.getPositions() & TradeRadar.find({ isActive: true })
 ├─> CoreTradeRadar.checkWickSweep() ──> [If true] ──> Telegram Alert (Liquidity Hunt)
 ├─> CoreTradeRadar.checkEarlyReversal() ──> [If true] ──> Telegram Reversal Alert (CHOCH+RSI Div)
 └─> CoreTradeRadar.calculateTrailingStop() ──> [If new SL] ──> Update SL on BingX & DB ──> Tel Msg
```

---

## 🗄️ خريطة النماذج المخزنة (Database Models)

* **`User`**: إعدادات التداول والمخاطر والرافعة ووضع HITLAR والـ State الحالية للبوت.
* **`Trade`**: بيانات الصفقة الفعلية المفتوحة والمغلقة، الـ PnL، أوقات التنفيذ، والمعرف الفريد.
* **`SniperWatch`**: طلبات مراقبة الاقتناص النشطة، المحرك المستهدف، تاريخ الانتهاء، وآخر تقرير.
* **`TradeRadar`**: إعدادات الحماية النشطة للصفقات (الوقف المتحرك وتنبيهات كشط السيولة).
* **`MarketScanner`**: نتائج فرز العملات اليومي لحساب السيولة والاتجاه والتقلب.

---

## 📚 هيكل ملفات التوثيق المرجعي (Documentation Directory)

تجد تفاصيل أدق لكل مكون في التوثيق الخاص به:

```
docs/
├── SYSTEM_OVERVIEW.md          ← هذا الملف (النظرة المعمارية ونظام التواصل)
├── FULL_SYSTEM_OVERVIEW.md     ← الدليل الشامل لكافة دورات حياة الصفقات والـ Backtest
├── AnalysisService.md          ← خدمة التحليل المركزي وجسر التوافقية
├── TechnicalAnalyzer.md        ← المعادلات الرياضية لحساب المؤشرات الفنية
├── MTFDataBuilder.md           ← معالجة وتوحيد الشموع المتعددة ومنع Look-Ahead
├── BacktestService.md          ← محاكاة الصفقات التاريخية للمحركات العادية ومحركات القنص
├── infrastructure.md           ← نقطة الدخول والاتصال بـ DB والـ Logger والتقارير الدورية
│
├── core/
│   ├── sniper/
│   │   └── SniperSystem.md     ← تفاصيل محركات الاقتناص V7-V11 والماسح والنماذج
│   ├── picker/
│   │   └── PickerSystem.md     ← خوارزميات فرز واكتشاف العملات ومعايير التقييم
│   └── radar/
│       └── RadarSystem.md      ← معادلات تحريك الوقف التلقائي وكشف Wick Sweep والانعكاس
│
├── services/
│   ├── BingXService.md         ← التفاعل المباشر مع API البورصة وحساب Precision
│   ├── TradeManager.md         ← إدارة المخاطر، الرافعة، دروع رأس المال، وتنفيذ الصفقات
│   ├── PositionMonitor.md      ← مراقبة الصفقات كل 30 ثانية وتنبيهات الأرباح
│   ├── SignalParser.md         ← تحليل الإشارات النصية القادمة من قنوات التوصيات
│   ├── SniperManager.md        ← دورة الاقتناص بالخلفية وMargin Lock
│   └── SymbolPickerService.md  ← تسيير عمليات مسح السوق بالدفعات المتوازية
│
└── bot/
    ├── handlers.md             ← الهيكل العام لطبقة Telegram UI وفصل الملفات
    ├── specialized_handlers.md ← معالجة الأوامر المتخصصة (Analysis, Sniper, Picker, Radar)
    └── keyboards_and_menus.md  ← تصميم لوحات التحكم وقوائم الإعدادات ولوحة الأرقام Numpad
```
