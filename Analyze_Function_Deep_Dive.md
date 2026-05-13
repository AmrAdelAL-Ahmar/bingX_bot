# تشريح دالة التحليل `analyze` (برمجة + تداول)

تعتبر هذه الدالة هي "القلب النابض" للبوت، حيث تجمع بين البيانات الخام من المنصة وبين المعادلات الرياضية المعقدة لإنتاج قرار تداول. سنقوم بشرحها جزءاً بجزء.

---

## 1. رأس الدالة (Inputs & Outputs)
```typescript
async analyze(
    symbolInput: string,
    version: 'V1' | 'V2' | 'V3' | 'V4' | 'V5' = 'V1',
    options: { quickTF?: string, longTF?: string, limit?: number, rsiThreshold?: number } = {}
): Promise<AnalysisResult>
```
*   **برمجياً:** دالة `async` (غير متزامنة) لأنها تنتظر بيانات من الإنترنت. تأخذ اسم العملة، الإصدار المطلوب (V1-V5)، وإعدادات اختيارية مثل الفريمات. تعيد وعداً (`Promise`) بنتيجة من نوع `AnalysisResult`.
*   **تداولياً:** يسمح لك هذا بتحديد العملة التي تريد فحصها، واختيار "المحرك" الذي سيفحصها (V1 هو المحرك الاحتمالي الأساسي).

---

## 2. تهيئة البيانات (Setup)
```typescript
let symbol = symbolInput.toUpperCase();
if (!symbol.includes('/')) symbol = `${symbol}/USDT:USDT`;

const quickTF = options.quickTF || '5m';
const longTF = options.longTF || '1h';
const limit = options.limit || 200;
```
*   **برمجياً:** نقوم بتحويل اسم العملة لأحرف كبيرة وإضافة اللاحقة المطلوبة للمنصة. نحدد الفريمات الافتراضية (5 دقائق للـ Scalp وساعة للـ Trend).
*   **تداولياً:** التداول الناجح يتطلب رؤية "مجهرية" (5m) ورؤية "بانورامية" (1h) في نفس الوقت.

---

## 3. جلب البيانات المتعددة (Multi-TF Fetching)
```typescript
const matrixTFs = ['1m', '5m', '15m', '30m', '1h', '4h', '1d'];
const mtfOHLCV: Record<string, any[]> = {};
for (const tf of matrixTFs) {
    const fetchLimit = (tf === quickTF || tf === longTF) ? Math.max(limit, 200) : 200;
    mtfOHLCV[tf] = await this.bingxService.fetchOHLCV(symbol, tf, fetchLimit);
}
```
*   **برمجياً:** نستخدم حلقة `for` لجلب بيانات الشموع (OHLCV) لسبعة فريمات مختلفة وتخزينها في كائن واحد.
*   **تداولياً:** هذا ما يسمى بـ "توافق الفريمات". إذا كانت العملة صاعدة في الدقيقة، الـ 5 دقائق، والساعة، فإن احتمالية نجاح صفقة الشراء تكون عالية جداً.

---

## 4. استخراج الأسعار الحالية (Current Context)
```typescript
const quickOHLCV = mtfOHLCV[quickTF] || mtfOHLCV['5m'];
const currentPrice = quickOHLCV[quickOHLCV.length - 1].close;
const quickCloses = quickOHLCV.map(c => c.close), ...
```
*   **برمجياً:** نستخرج آخر سعر إغلاق (Current Price) ونقوم بتحويل مصفوفة الشموع إلى مصفوفات بسيطة للأسعار (إغلاق، أعلى، أدنى، حجم) ليسهل حساب المؤشرات عليها.
*   **تداولياً:** نحن نجهز "المواد الخام" التي ستتغذى عليها المؤشرات التقنية.

---

## 5. حساب المؤشرات (The Math Lab)
هنا نستخدم مكتبة `technicalindicators` لحساب المعادلات:
```typescript
const macdArr = MACD.calculate({ ... }); // تقاطع الاتجاه
const rsiArr = RSI.calculate({ period: 14, values: quickCloses }); // قوة الزخم
const atrArr = ATR.calculate({ ... }); // التذبذب والسيولة
const mfiArr = MFI.calculate({ ... }); // سيولة الأموال داخل العملة
```
*   **تداولياً:**
    *   **RSI:** يخبرنا هل السعر "رخيص جداً" (تشبع بيع) أم "غالي جداً" (تشبع شراء).
    *   **ATR:** يخبرنا بمدى "حركة" العملة، ومنه نحسب الستوب لوز (SL). إذا كانت العملة تتذبذب بعنف، نحتاج ستوب لوز بعيد.
    *   **MACD:** يخبرنا متى يتغير الاتجاه من هبوط لصعود.

---

## 6. حساب المستويات (Levels & Fibs)
```typescript
pivot: (quickOHLCV[...].high + quickOHLCV[...].low + quickOHLCV[...].close) / 3,
fib382: longHigh - (longHigh - longLow) * 0.382,
fib618: longHigh - (longHigh - longLow) * 0.618,
```
*   **برمجياً:** معادلات حسابية بسيطة تعتمد على أعلى وأدنى سعر في الفريم الكبير.
*   **تداولياً:** هذه هي "الخريطة". السعر يحترم مستويات فيبوناتشي (خاصة 61.8%) ومستويات البيفوت كدعم ومقاومة.

---

## 7. استدعاء المحركات (Decision Making)
```typescript
switch (version) {
    case 'V2': result = this.analyzeQuantV2(...); break;
    case 'V5': result = this.analyzePredictiveV5(...); break;
    default: result = this.analyzeProbabilityEngine(...);
}
```
*   **برمجياً:** نستخدم `switch` لاختيار الخوارزمية المناسبة. إذا لم يختر المستخدم، نستخدم الـ `default` وهو الإصدار الأول (V1).
*   **تداولياً:** كل إصدار هو "استراتيجية" مختلفة. استراتيجية V1 تعتمد على الاحتمالات، V2 على السيولة (MFI)، و V5 على التنبؤ الإحصائي.

---

## 8. النتيجة النهائية (The Delivery)
```typescript
return { ...result, levels, indicators, structure, options: { quickTF, longTF, limit } };
```
*   **برمجياً:** نقوم بدمج نتيجة المحرك مع البيانات التقنية المكتشفة (Levels, Indicators) وإرسالها ككائن واحد جاهز للعرض.
*   **تداولياً:** هذه هي التوصية النهائية التي تراها في البوت (نوع الصفقة، السعر، الأهداف، الستوب لوز).

---
### نصيحة للمبرمج المتداول:
السر في هذه الدالة ليس في تعقيد الكود، بل في **"جودة البيانات"**. جلب 7 فريمات زمنية هو ما يجعل هذا البوت يتفوق على المتداول العادي الذي ينظر لفريم واحد فقط.
