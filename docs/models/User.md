# 🗄️ User.ts — نموذج بيانات المستخدم وإعداداته الفنية

> **الموقع:** `src/models/User.ts`  
> **الدور:** تحديد هيكل بيانات مستخدم البوت في MongoDB لتخزين تفضيلات التداول وإدارة المخاطر وإعدادات تشغيل خدمات الخلفية والمحركات الفردية.

---

## 📋 جميع حقول الـ Schema

### 🔑 الحقول الأساسية وجلسة البوت

| الحقل | النوع | الافتراضي | الوصف |
| :--- | :--- | :--- | :--- |
| **`telegramId`** | String | — (مطلوب) | معرف المستخدم في Telegram، وهو حقل فريد كـ Index. |
| **`username`** | String | — | اسم المستخدم في Telegram. |
| **`bingxApiKey`** | String | — | مفتاح API لمنصة BingX. |
| **`bingxSecretKey`** | String | — | المفتاح السري لمنصة BingX. |
| **`isActive`** | Boolean | `true` | حالة الحساب (نشط / معطل). |
| **`createdAt`** | Date | `Date.now` | تاريخ تسجيل الحساب. |
| **`botState`** | String | `null` | حالة البوت الحالية لإدارة آلة الحالات (State Machine). |

---

### 💰 إعدادات إدارة رأس المال والرافعة

| الحقل | النوع | الافتراضي | الوصف |
| :--- | :--- | :--- | :--- |
| **`riskPercentage`** | Number | `3` | نسبة المخاطرة المخصصة لكل صفقة (مثلاً 3% من الرصيد). |
| **`maxSlRiskPercentage`** | Number | `6` | درع حماية رأس المال (الحد الأقصى المسموح بخسارته عند الـ SL). |
| **`enforceMaxSlLoss`** | Boolean | `null` | تشغيل/إيقاف تفعيل درع رأس المال الصارم. |
| **`leverageMode`** | String | `'default'` | تحديد الرافعة (`default` لاتباع إشارات التحليل أو `fixed` لتثبيتها). |
| **`fixedLeverageValue`** | Number | `10` | قيمة الرافعة المالية الثابتة (في حال تفعيل Fixed). |

---

### ⚙️ إعدادات التنفيذ والاستراتيجيات

| الحقل | النوع | الافتراضي | الوصف |
| :--- | :--- | :--- | :--- |
| **`orderMode`** | String | `'market'` | طريقة فتح الأمر (`market` لأمر السوق الفوري أو `limit` للأمر الحدي). |
| **`tpExecutionMode`** | String | `'multiple'` | طريقة جني الأرباح (`single` للهدف الأول فقط أو `multiple` للأهداف كاملة). |
| **`autoBreakEven`** | Boolean | `true` | نقل وقف الخسارة إلى سعر الدخول تلقائياً فور ضرب الهدف الأول TP1. |
| **`tpSplitMode`** | String | `'auto'` | تقسيم الأرباح (`auto` بالتساوي بين الأهداف أو `manual` للمخصص). |
| **`tpProfitSplits`** | Number[] | `[50, 50]` | نسب تقسيم كميات العقود على الأهداف في الوضع اليدوي. |
| **`errorMitigationEnabled`** | Boolean | `true` | تفعيل المعالجة التلقائية لأخطاء البورصة (مثل تعديل الهامش والرافعة). |

---

### 📉 إعدادات وقف الخسارة المتغير (Volatility SL)

| الحقل | النوع | الافتراضي | الوصف |
| :--- | :--- | :--- | :--- |
| **`volatilitySlEnabled`** | Boolean | `false` | تفعيل وقف الخسارة النسبي القائم على النسبة المئوية. |
| **`volatilitySlPercentage`** | Number | `5` | نسبة وقف الخسارة من سعر الدخول (مثلاً 5%). |

---

### 🐋 إعدادات القناص والاصطياد (`sniperSettings`)

إعدادات افتراضية مخصصة لعمليات الاقتناص:
```typescript
sniperSettings: {
    autoExecute: boolean; // default: false (تفعيل الصفقات تلقائياً فور اكتمال زناد القناص)
    notifyOnce: boolean;  // default: false (إرسال إشعار واحد فقط عند تحقق الشروط)
}
```

---

### 👁️ إعدادات رادار الحماية ومراقبة المراكز (`radarSettings`)

إعدادات الحماية الحية للمراكز النشطة:
```typescript
radarSettings: {
    wickSweepAlert: boolean;  // default: true  (تنبيه كشط سيولة الوقف بالذيل)
    reversalAlert: boolean;   // default: true  (تنبيه خطر الانعكاس الفني المبكر)
    trailingEnabled: boolean; // default: false (تفعيل تحريك وقف الخسارة لتأمين الأرباح)
    notifyOnce: boolean;      // default: true  (تنبيه لمرة واحدة فقط لكل نوع حدث)
}
```

---

### 🔍 إعدادات فرز وتصفية السوق (`pickerSettings`)

تفضيلات خدمة مسح الأسواق وتحديد العملات:
```typescript
pickerSettings: {
    engine: 'multicriteria' | 'ccxt'; // default: 'multicriteria' (نوع محرك الفرز المعتمد)
    limit: number;                    // default: 20 (الحد الأقصى للعملات في قائمة الترشيحات)
}
```

---

### 💥 إعدادات وضع هترل العدواني (`hitlarSettings`)

إعدادات تداول سريعة ومثبتة مسبقاً بدلاً من إعدادات المستخدم العادية:
```typescript
hitlarModeEnabled: boolean; // default: false (تشغيل/إيقاف الوضع بالكامل)
hitlarSettings: {
    riskPercentage: number;          // default: 3%
    leverage: number;                // default: 20x
    volatilitySlPercentage: number;  // default: 5%
    capitalProtectionEnabled: boolean; // default: false
    orderMode: 'limit' | 'market';   // default: 'limit'
}
```

---

### 📊 إعدادات التحليل والـ Backtest

* **`analysisSettings`**: إعدادات أطر التحليل الافتراضية (`scalpTF: '5m'`, `swingTF: '1h'`) وحد شمعات التحليل (`candleLimit: 200`).
* **`backtestSettings`**: إعدادات اختبار الاستراتيجيات بالدورة التاريخية (رأس المال الابتدائي، والرافعة، والـ Margin Mode، وتفعيل Risk Sizing).
