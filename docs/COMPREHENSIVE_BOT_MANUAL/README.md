# 📚 الموسوعة الشاملة لهندسة وخوارزميات وتشغيل بوت التداول الكمي الذاتي
## 📖 Master Quantitative Trading Suite Manual (BingX Futures V2.5)

مرحباً بك في الدليل المرجعي الكامل والمفصل لمنظومة التداول الذاتي الكمي لبوت BingX. تم إعداد هذه السلسلة من الوثائق لتشرح كل خوارزمية، معادلة رياضية، مؤشر فني، درع أمان، وأمر تشغيلي داخل النظام بدقة متناهية.

---

## 🗂️ فهرس أجزاء الموسوعة (Documentation Modules)

انقر على أي مستند أدناه للانتقال المباشر للشرح التفصيلي:

### 1. [01. بنية النظام العامة والعلاقات التفاعلية (System Architecture & Relationships)](file:///e:/webProject/BotTrading_BingX/docs/COMPREHENSIVE_BOT_MANUAL/01_SYSTEM_ARCHITECTURE_AND_RELATIONSHIPS.md)
* الهيكل السداسي المفكك للنظام (Hexagonal Architecture).
* خريطة العلاقات بين المنسق (Orchestrator)، حكم التوافق (Arbiter)، محرك التربص (Stalker)، وحراس الأمان.
* مخطط تدفق دورة حياة الصفقة من المسح إلى الإغلاق وتسجيل الأرباح.

### 2. [02. الدليل الرياضي والمنطقي لمحركات التحليل الـ 19 (Engines Mathematical & Algorithmic Manual)](file:///e:/webProject/BotTrading_BingX/docs/COMPREHENSIVE_BOT_MANUAL/02_ALL_ANALYSIS_ENGINES_AND_MATHEMATICS.md)
* جدول أوزان الثقة المؤسسية للمحركات ($W_i$).
* شرح معمق للمحركات الـ 19 من **V1 إلى V18**:
  - المعادلات الجبرية لمؤشرات RSI, ATR, VWAP, MFI, SuperTrend, KAMA, Bollinger, Williams %R, Order Book Imbalance, Heikin-Ashi POC.
* محرك **HARMONIC** الشامل (11 نموذجاً مؤسسياً ونطاقات PRZ لحساب النسبة الذهبية بدقة سنت واحد).
* محرك **WHALE_SURGE** (كشف اختراق السيولة المؤسسية $2.2\times$ وكسر الهيكل BOS/CHOCH).
* خوارزمية حساب النتيجة التوافقية الإجمالية ($ConfluenceScore$).

### 3. [03. منظومة القناصات، التربص اللحظي، ودروع الأمان والذكاء الاصطناعي (Snipers, Stalker & AI Guards)](file:///e:/webProject/BotTrading_BingX/docs/COMPREHENSIVE_BOT_MANUAL/03_SNIPERS_STALKER_AND_AI_GUARDS.md)
* الفرق الجوهري بين محرك التحليل ومحرك القنص اللحظي.
* تفاصيل محركات القنص الـ 14 وسجل الاقتناص `ISniperEngine`.
* محرك التربص الذكي `OpportunityStalker`: كيفية اصطياد الارتدادات وتفادي الشراء القمي (FOMO).
* محلل التدفق الدقيق للشمعات `MicroVolumeAnalyzer` وكاشف انفجار الفوليوم اللحظي (1m Volume Burst $\ge 2\times$).
* دروع الأمان المؤسسية الأربعة:
  - تدقيق الذكاء الاصطناعي الفائق (Gemini Supreme Audit).
  - بوصلة البيتكوين الحية (BTC Market Compass 15m/1h).
  - حارس الارتباط ومصفوفة بيرسون (Correlation Guard & Portfolio Heat Cap 6%).
  - فلتر مفكرة الاقتصاد الكلي (Macro News Filter).

### 4. [04. دورة حياة التداول الذاتي والتنفيذ المالي (Autonomous Trading Lifecycle & Execution)](file:///e:/webProject/BotTrading_BingX/docs/COMPREHENSIVE_BOT_MANUAL/04_AUTONOMOUS_TRADING_LIFECYCLE_AND_EXECUTION.md)
* إدارة رأس المال وحجم المركز (حصر المخاطرة في 1.0% إلى 1.2% من المحفظة).
* جدول الرافعة الديناميكية المتدرجة: BTC/ETH (40x)، العملات الكبرى (25x)، العملات البديلة (18x).
* نظام وقف الخسارة الهيكلي التكيفي المعتمد على القمم والقيعان + مؤشر ATR (1.6% إلى 2.2%).
* درع حماية الدخول التلقائي (Auto Break-Even @ +0.35%) وكيف وفر أكثر من 35$ في الباتش الأخير.
* جني الأرباح المصغر (Micro-TP 50% Scale-Out) واستباق جدران السيولة (Structural Front-Running).
* مقارنة تفصيلية بين التداول الافتراضي (Paper Trading) والتداول الحقيقي (Live CCXT).

### 5. [05. الدليل التشغيلي لواجهة التلغرام وضبط الإعدادات الشامل (Telegram Interface & Settings Manual)](file:///e:/webProject/BotTrading_BingX/docs/COMPREHENSIVE_BOT_MANUAL/05_SETTINGS_BUTTONS_AND_OPERATIONS_MANUAL.md)
* الدليل الكامل للأوامر النصية (`/auto`, `/aut_settings`, `/engines`, `/paper`, `/analyze`, `/status`...).
* شرح تفصيلي لكل زر وخيار في لوحة الإعدادات وتأثيره الحسابي.
* مصفوفة التحكم بالمحركات وحظرها (`/engines`) وأزرار الإعداد السريع (`المحركات الذهبية فقط`).
* جدول الإعدادات الموصى به للوصول لأعلى ربحية وأدنى هبوط للمحفظة (Optimal Profit Settings).
* بروتوكول التصرف في حالات الطوارئ (`/panic` و `/circuit_breaker`).

---
> 💡 **نصيحة للمطور والمتداول:** احتفظ بهذه الموسوعة كمرجع أساسي، وأي تعديل أو إضافة لمحرك جديد مستقبلاً يجب أن يخضع لنفس المعايير الصارمة الموضحة في هذه الوثائق.
