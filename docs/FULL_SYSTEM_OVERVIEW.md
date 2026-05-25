# 🗺️ FULL SYSTEM OVERVIEW — الدليل الشامل لنظام التداول BingX

> **الإصدار:** 3.0 (محدّث ليشمل الهيكل الجديد ثلاثي الطبقات والخدمات المضافة)  
> **آخر تحديث:** 2026-05-25

---

## 📐 هيكل المشروع الكامل (Full Directory Tree)

```
src/
├── index.ts                          ← نقطة الدخول الرئيسية وتدشين البوت والخدمات
├── server.ts                         ← خادم ويب HTTP بسيط لفحص صحة النظام (Health Check)
├── config/
│   └── db.ts                         ← إعدادات وتأسيس اتصال قاعدة بيانات MongoDB
├── models/
│   ├── User.ts                       ← نموذج إعدادات المتداول الفنية وإدارة المخاطر
│   ├── Trade.ts                      ← نموذج بيانات الصفقة المفتوحة والمغلقة والـ PnL
│   ├── SniperWatch.ts                ← نموذج طلبات مراقبة واقتناص الصفقات الجارية
│   ├── TradeRadar.ts                 ← نموذج إعدادات وتنبيهات حماية صفقات الرادار الفعالة
│   └── MarketScannerModel.ts         ← نموذج تخزين نتائج فرز وتصفية العملات اليومية
├── core/                             ← طبقة المنطق الحسابي والمحركات (Core Engine Room)
│   ├── shared/
│   │   ├── types.ts                  ← الواجهات والأنواع الفنية الموحدة للنظام
│   │   └── MTFDataBuilder.ts         ← بناء وإعادة هيكلة شموع الأطر المتعددة
│   ├── analysis/
│   │   ├── CoreAnalysisService.ts    ← منسق عمليات التحليل والربط بين المحركات
│   │   ├── AnalysisFormatter.ts      ← منسق صياغة التقارير الفنية للـ Telegram
│   │   ├── TechnicalAnalyzer.ts      ← مكتبة المؤشرات وحساب مستويات الدعم والمقاومة
│   │   └── engines/                  ← محركات التحليل الفني لصفقات Scalp و Swing
│   │       ├── ITradingEngine.ts     ← الواجهة المشتركة لمحركات التحليل
│   │       ├── V1Engine.ts           ← محرك VWAP الاحتمالي
│   │       ├── V2Engine.ts           ← محرك MFI الكمّي
│   │       ├── V3Engine.ts           ← محرك Sniper ذو الـ 8 طبقات
│   │       ├── V4Engine.ts           ← محرك النطاقات BB + CCI
│   │       ├── V5Engine.ts           ← محرك التوقع الخطي (Linear Regression)
│   │       ├── V6Engine.ts           ← محرك جدار الحماية (Firewall)
│   │       ├── V7Engine.ts           ← محرك الهيكل والمناطق الذهبية
│   │       ├── V10Engine.ts          ← محرك الهجين الحجمي المطور
│   │       └── V11Engine.ts          ← محرك القرار التكيفي المطور
│   ├── sniper/
│   │   ├── ISniperEngine.ts          ← الواجهة المشتركة لمحركات الاقتناص
│   │   ├── SniperRegistry.ts         ← سجل تفعيل محركات الاقتناص
│   │   ├── CoreSniperScanner.ts      ← الماسح المركزي ومنسق عملية اقتناص السيولة
│   │   └── engines/                  ← محركات الاقتناص المتخصصة (SMC/Wicks/Adaptive)
│   │       ├── V7SniperEngine.ts     ← محرك الاقتناص الهجين (OB/FVG + MSS)
│   │       ├── V8SniperEngine.ts     ← محرك قنص كشط السيولة والموجات
│   │       ├── V9SniperEngine.ts     ← محرك قنص SMC المتكامل
│   │       ├── V10SniperEngine.ts    ← محرك قنص المؤسسات الهجين (Volume POC)
│   │       └── V11SniperEngine.ts    ← محرك قنص القرار التكيفي الذكي
│   ├── radar/
│   │   └── CoreTradeRadar.ts         ← حسابات الوقف المتحرك وكشف اختراقات الذيل الفنية
│   └── backtest/
│       ├── CoreBacktestEngine.ts     ← محاكي صفقات المحركات العادية التاريخية
│       └── CoreSniperBacktester.ts   ← محاكي صفقات محركات الاقتناص التاريخية
├── services/                         ← طبقة الخدمات الوسيطة وجسور الاتصال (Facades & Bridges)
│   ├── BingXService.ts               ← إدارة التيكرات وأوامر البورصة وحساب Precision
│   ├── AnalysisService.ts            ← جسر التوافق لخدمات التحليل
│   ├── BacktestService.ts            ← خدمة اختبار الاستراتيجيات
│   ├── BacktestBridgeService.ts      ← جسر إعداد البيانات التاريخية للمحاكاة
│   ├── TradeManager.ts               ← تنفيذ الصفقات على المنصة وحماية التعرض
│   ├── PositionMonitor.ts            ← مراقبة الصفقات المفتوحة (دورة 30 ثانية للرادار والأرباح)
│   ├── ReportingService.ts           ← التقارير الدورية المجدولة (أسبوعي/شهري)
│   ├── SignalParser.ts               ← تحليل وقراءة نصوص إشارات قنوات التوصيات
│   ├── SniperManager.ts              ← إدارة دورة الاقتناص كل 60 ثانية (Margin Lock)
│   └── SymbolPickerService.ts        ← خدمة فحص وفرز العملات بالدفعات المتوازية
├── bot/                              ← طبقة عرض واجهة مستخدم تليجرام (Telegram UI Layer)
│   ├── middlewares/
│   │   └── userMiddleware.ts         ← التحقق من المستخدم وإدراجه بالـ Context
│   ├── keyboards/
│   │   ├── baseKeyboards.ts          ← لوحات التحكم الأساسية والإعدادات
│   │   ├── analysisKeyboards.ts      ← أزرار التحكم بالتحليل الفني
│   │   ├── sniperKeyboards.ts        ← خيارات وأزرار الاقتناص
│   │   ├── radarKeyboards.ts         ← أزرار التحكم برادارات الصفقات
│   │   └── pickerKeyboards.ts        ← أزرار فحص وتصفية العملات
│   ├── menus/
│   │   ├── mainMenu.ts               ← القائمة الرئيسية التفاعلية الكاملة
│   │   └── settingsMenu.ts           ← قوائم الإعدادات ولوحة الأرقام Numpad
│   ├── handlers/
│   │   ├── messageHandlers.ts        ← استقبال الرسائل والأوامر النصية الأساسية
│   │   ├── analysisHandlers.ts       ← معالجة طلبات التحليل وربطها بالخدمة
│   │   ├── sniperHandlers.ts         ← معالجة إعدادات وتنفيذ صفقات الاقتناص
│   │   ├── pickerHandlers.ts         ← معالجة عمليات مسح السوق وترشيح العملات
│   │   ├── radarHandlers.ts          ← معالجة تفاعلات مراقبة وحماية الصفقات
│   │   ├── tradingHandlers.ts        ← إلغاء وحالة الصفقات النشطة
│   │   ├── portfolioHandlers.ts      ← عرض المحفظة والمراكز الحالية
│   │   ├── reportHandlers.ts         ← طلب وتوليد التقارير المالية للمتداول
│   │   └── settingsHandlers.ts       ← معالجة تعديل قيم الإعدادات عبر لوحة الأرقام
│   └── utils/
│       └── views.ts                  ← قوالب تنسيق التقارير المالية والصفقات المفتوحة
└── utils/
    ├── logger.ts                      ← تسجيل السجلات الفنية والنظامية (Winston)
    └── telegram.ts                    ← إدارة إرسال الرسائل الآمن (تجنب Rate Limit 429)
```

---

## 🔗 خريطة الاستدعاءات الكاملة وتدفق البيانات (Call Map)

```
Telegram Event (Message / Inline Button Click)
    │
    ▼
userMiddleware.ensureUser() ──> يضمن إدراج المستخدم وإعداداته في DB
    │
    ▼
Bot Handlers (UI Layer)
    │
    ├─► analysisHandlers.ts
    │       └── AnalysisService.analyze() (Facade)
    │               ├── BingXService.fetchOHLCV() × 7 الأطر الزمنية بالتوازي
    │               └── CoreAnalysisService.analyze() (Core)
    │                       ├── TechnicalAnalyzer.calculateTechnicalData()
    │                       └── Engine.analyze() ──> إرجاع النتيجة وتنسيقها للعرض
    │
    ├─► sniperHandlers.ts
    │       ├── SniperWatch.save() ──> تخزين طلب المراقبة
    │       └── [تفاعل يدوي] snp_exec_<id> ──> TradeManager.executeSignal()
    │
    ├─► pickerHandlers.ts
    │       └── SymbolPickerService.refreshScan() (Facade)
    │               ├── CcxtPickerEngine.run() (SMC & Volume & ATR filters)
    │               └── CurrencyPickerEngine.scoreSymbol() (Pipeline Scores)
    │
    ├─► radarHandlers.ts
    │       └── TradeRadar.findOneAndUpdate() ──> تعديل إعدادات حماية الرادار
    │
    ├─► messageHandlers.ts (إشارة نصية)
    │       └── SignalParser.parse() ──> TradeManager.executeSignal()
    │
    ├─► settingsHandlers.ts
    │       └── User.findByIdAndUpdate() ──> تحديث الإعدادات عبر لوحة الأرقام
    │
    ├─► tradingHandlers.ts / portfolioHandlers.ts
    │       └── BingXService (getBalance / getPositions / placeOrder)
    │
    └─► reportHandlers.ts
            └── Trade.find() ──> generateReportStr() ──> إرسال تقرير الأداء للمتداول
```

---

## 🔄 دورة حياة الخدمات الجانبية المستمرة (Background Workers)

### 1. مراقب الصفقات النشطة (`PositionMonitor` — كل 30 ثانية)
```
PositionMonitor Loop (30s)
    │
    ├─► BingXService.getPositions() ──> جلب الصفقات الفعلية في حساب البورصة
    │
    ├─► Trade.find({ status: 'OPEN' }) ──> مطابقة الصفقات بالمسجلة في قاعدة البيانات
    │
    ├─► [رادار الحماية] لكل صفقة خاضعة لـ TradeRadar:
    │       ├── BingXService.fetchOHLCV() for 5m/15m
    │       ├── CoreTradeRadar.checkWickSweep() ──► [اختراق SL بالذيل فقط] ──► تنبيه Telegram
    │       ├── CoreTradeRadar.checkEarlyReversal() ──► [انعكاس CHOCH + Div] ──► تنبيه Telegram
    │       └── CoreTradeRadar.calculateTrailingStop() ──► [تحديث الوقف] ──► تعديل SL في البورصة والـ DB
    │
    ├─► [تأمين الدخول] نقل الستوب لنقطة الدخول (Break-Even) عند تحقيق الهدف الأول TP1
    │
    ├─► [تحديث الصفقات المغلقة] رصد اختفاء صفقة من البورصة ──► حساب الربح والخسارة الفعلي ──► تحديث حالة الصفقة لـ CLOSED ──► تنبيه المستخدم
```

### 2. مدير الاقتناص الذكي (`SniperManager` — كل 60 ثانية)
```
SniperManager Loop (60s)
    │
    ├─► SniperWatch.find({ status: 'ACTIVE' }) ──> جلب طلبات المراقبة الفعالة
    │
    ├─► فحص الصلاحية ──► [تجاوز صلاحية expiresAt] ──► تحويل الحالة لـ EXPIRED ──► تنبيه المستخدم
    │
    ├─► BingXService.getPositions() ──► [المراكز الفعالة >= 5] ──► تفعيل Margin Lock وتجميد إطلاق صفقات جديدة
    │
    ├─► جلب البيانات التاريخية بالتوازي للأطر المطلوبة للمحرك النشط
    │
    ├─► CoreSniperScanner.scan() ──► تشغيل محرك الاقتناص (V7 إلى V11)
    │
    └─► استلام SniperReport:
            ├── [readyToFire === true] ──► تنبيه فرصة دخول جاهزة (أزرار تنفيذ / نسخ / رادار)
            └── [عدد الشروط تغير] ──► إرسال تحديث مرحلي للمستخدم (مثال: "تحديث: شروط 3/5 مكتملة")
```

---

## 🔐 طبقات حماية رأس المال في TradeManager

عند محاولة فتح صفقة جديدة، تقوم طبقة الـ `TradeManager` بفرض 6 مستويات حماية صارمة لحفظ رصيد المستخدم من التصفية أو سوء إدارة المخاطر:

| الطبقة | الشرط البرمجي | الإجراء المتخذ | الغرض الفني |
| :--- | :--- | :--- | :--- |
| **1** | `balance <= 0` | رفض العملية وإرجاع خطأ. | منع الأخطاء البرمجية الناتجة عن تصفير المحفظة. |
| **2** | `amountContracts < minAmount` | رفض العملية مع توضيح السبب. | التأكد من توافق حجم العقد مع لوائح البورصة للعملة المحددة. |
| **3** | `notional < 5.1 USDT` | رفع القيمة التلقائي للحد الأدنى. | تجنب رفض الصفقة من محرك التداول لمنصة BingX (أدنى قيمة 5 USDT). |
| **4** | `totalExposure >= 10%` | رفض الصفقة الجديدة بالكامل. | حماية المحفظة من التورط في صفقات متعددة تزيد عن 10% من رأس المال الإجمالي. |
| **5** | `marginUsed > remainingExposure` | تقليص حجم الهامش المخصص للصفقة تلقائياً. | التكيف الفوري مع سقف التعرض المتبقي دون رفض الصفقة. |
| **6** | `projectedSLLoss > maxSlRisk%` | تقليص تلقائي لحجم الصفقة (Position Size). | (درع رأس المال الصارم) ضمان ألا تتجاوز خسارة الصفقة النسبة المحددة في الإعدادات. |

---

## 📚 الوثائق المرجعية وتفاصيل المكونات

| الملف البرمجي | وثيقة التوضيح المخصصة |
| :--- | :--- |
| **طبقة العرض والواجهات** | [keyboards_and_menus.md](./bot/keyboards_and_menus.md) |
| **المعالج الرئيسي للبوت** | [handlers.md](./bot/handlers.md) |
| **المعالجات الفرعية التخصصية** | [specialized_handlers.md](./bot/specialized_handlers.md) |
| **مدير العمليات والتنفيذ** | [TradeManager.md](./services/TradeManager.md) |
| **مراقب الصفقات النشط** | [PositionMonitor.md](./services/PositionMonitor.md) |
| **مدير الاقتناص والـ Margin Lock** | [SniperManager.md](./services/SniperManager.md) |
| **خدمة فرز وتصفية العملات** | [SymbolPickerService.md](./services/SymbolPickerService.md) |
| **نقطة الدخول والـ Logger والتقارير** | [infrastructure.md](./infrastructure.md) |
| **مكتبة المؤشرات الفنية** | [TechnicalAnalyzer.md](./TechnicalAnalyzer.md) |
| **معالج الشموع المتعددة** | [MTFDataBuilder.md](./MTFDataBuilder.md) |
| **خدمة التحليل المركزي والجسور** | [AnalysisService.md](./AnalysisService.md) |
| **محاكي واختبار الصفقات التاريخية** | [BacktestService.md](./BacktestService.md) |
| **محركات الاقتناص (V7 - V11)** | [SniperSystem.md](./core/sniper/SniperSystem.md) |
| **محركات فرز العملات والـ Pipeline** | [PickerSystem.md](./core/picker/PickerSystem.md) |
| **رادار الصفقات والوقف المتحرك** | [RadarSystem.md](./core/radar/RadarSystem.md) |
| **نماذج قاعدة البيانات للمستخدم والصفقة** | [User.md](./models/User.md) + [Trade.md](./models/Trade.md) |
| **الاتصال المباشر بمنصة BingX** | [BingXService.md](./services/BingXService.md) |
