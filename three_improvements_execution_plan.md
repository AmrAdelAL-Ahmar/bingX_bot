# 📋 خطة تنفيذ التحديثات الثلاثة لمنظومة التداول الذاتي

## 🎯 الأهداف الأساسية
1. **ضبط اتجاه التداول على `LONG_ONLY` (شراء فقط مع الاتجاه العام)**:
   - جعل `LONG_ONLY` هو الخيار الافتراضي في قاعدة البيانات (`User.ts`) وفي المنسق الذاتي (`AutonomousOrchestrator.ts`).
   - توفير أزرار تحكم تفاعلية واضحة في `/aut_settings` لتغيير الاتجاه (`LONG_ONLY` / `BOTH` / `SHORT_ONLY`).
   - **السبب الرياضي:** في الباتش التجريبي الأخير، تسببت 3 صفقات بيع (Short) في 90% من خسائر المحفظة (-$4.05)، بينما صفقات الشراء (76 صفقة) كانت متعادلة ومحمية تماماً (-$0.47).

2. **درع تبريد العملات الخاسرة (Consecutive Loss Symbol Cooldown)**:
   - إضافة خاصية: إذا سجلت عملة معينة صفقتين خاسرتين متتاليتين، يتم حظرها تلقائياً من المسح والتربص والتداول لمدة **4 ساعات**.
   - إضافة الإعداد إلى نموذج المستخدم `User.ts`:
     - `consecutiveLossCooldownEnabled: boolean` (افتراضياً: `true`).
     - `consecutiveLossCooldownHours: number` (افتراضياً: `4`).
     - `consecutiveLossThreshold: number` (افتراضياً: `2`).
   - التحقق اللحظي في المنسق الذاتي: عند فحص أي عملة، يتم الاستعلام عن آخر صفقتين لها، وإذا كانتا خسارة خلال نافذة الـ 4 ساعات، يتم استبعادها فورياً مع تسجيل في السجل: `👉 QNT: مستبعد (تبريد بعد خسارتين متتاليتين ❄️ باقي X دقيقة)`.
   - إضافة زر تحكم في `/aut_settings` لتمكين أو تعطيل هذا الدرع.

3. **الاستبعاد الصارم والكامل لمؤشر NASDAQ والسلع ومؤشرات الأسهم**:
   - تحديث القائمة السوداء `JUNK_AND_COMMODITY_BLACKLIST` في `CcxtPickerEngine.ts` لتشمل:
     - `NASDAQ`, `NCSINASDAQ`, `NCSINASDAQ1002USD`, `SPX`, `US30`, `DJI`, `GER40`, `UK100`, `US500`, `TECH100`, `NDX`.
   - إضافة فحص البادئات والكلمات المفتاحية:
     - استبعاد أي رمز يبدأ بـ `NCCO` أو `NCSI`.
     - استبعاد أي رمز يحتوي على `NASDAQ`, `SPX`, `US30`, `DJI`, `GER`, `DOW`, `OIL`, `GOLD`, `SILVER`.
   - إضافة نفس الفلتر الوقائي في `AutonomousOrchestrator.ts` أثناء فحص المرشحين وعند إضافة أي عملة لطابور التربص `OpportunityStalker`.
   - إغلاق أي صفقات قديمة مفتوحة لمؤشر ناسداك في المحفظة الافتراضية.

---

## 🛠️ خطوات التنفيذ الميدانية

### خطوة 1: تحديث نموذج المستخدم `User.ts`
- إضافة حقول التبريد بعد الخسارة:
  - `consecutiveLossCooldownEnabled`
  - `consecutiveLossCooldownHours`
  - `consecutiveLossThreshold`
- جعل القيمة الافتراضية لـ `allowedDirection` هي `'LONG_ONLY'`.

### خطوة 2: تحديث مرشح العملات `CcxtPickerEngine.ts`
- توسيع `JUNK_AND_COMMODITY_BLACKLIST`.
- إضافة فحص `startsWith('NCSI')` والكلمات المفتاحية لـ NASDAQ والسلع والمؤشرات.

### خطوة 3: تحديث المنسق الذاتي `AutonomousOrchestrator.ts`
- تغيير الاتجاه الافتراضي إلى `LONG_ONLY`.
- تنفيذ دالة `isSymbolInLossCooldown(symbol: string)`.
- دمج فحص التبريد في حلقة `runAutonomousCycle()`.
- دمج فلتر استبعاد ناسداك والسلع في `refreshWatchlist()` و `auditAndExecuteCandidate()`.

### خطوة 4: تحديث واجهة التلغرام `autonomousHandlers.ts`
- إضافة زر تفاعلي في لوحة `/aut_settings` لعرض وتبديل:
  - `🎯 الاتجاه: [LONG ONLY 📈]`
  - `❄️ تبريد الخسائر: [✅ 4 ساعات بعد خسارتين]`
- دعم الكولباكات:
  - `aut_dir_long`, `aut_dir_both`, `aut_dir_short`
  - `aut_toggle_loss_cooldown`

### خطوة 5: الفحص والتحقق البرمجي
- إنشاء سكريبت اختبار للتحقق من:
  - حظر عملة QNT إذا كان لها خسارتان سابقتان.
  - حظر مؤشر `NCSINASDAQ1002USD` كلياً من القائمة.
  - التأكد من أن الاتجاه المسموح هو `LONG_ONLY` فقط.
- تشغيل `npm run build` للتأكد من خلو المشروع من أي أخطاء.
