# 🚀 index.ts & server.ts — نقطة البداية والخادم

> **الموقع:** `src/index.ts` + `src/server.ts`  
> **الدور:** نقطة دخول التطبيق الكاملة. يُهيئ كل الخدمات ويربطها ببعض، ثم يشغّل البوت.

---

## 📋 تسلسل التهيئة

```typescript
// 1. إنشاء الخدمات الأساسية
const bot = new Telegraf(TELEGRAM_BOT_TOKEN);
const bingXService  = new BingXService(BINGX_API_KEY, BINGX_SECRET_KEY);
const analysisService = new AnalysisService(bingXService);
const tradeManager  = new TradeManager(bingXService);
const reportingService = new ReportingService(bot);

// 2. إنشاء PositionMonitor مع Notifier
const positionMonitor = new PositionMonitor(
    bingXService,
    analysisService,
    async (telegramId, msg) => sendTelegramMessage(bot, telegramId, msg)
);

// 3. تسجيل Middleware
bot.use(ensureUser);  // التحقق من وجود المستخدم في DB

// 4. تسجيل Handlers
registerPortfolioHandlers(bot, bingXService);
registerReportHandlers(bot, bingXService);
registerTradingHandlers(bot, bingXService);
registerSettingsHandlers(bot);
registerMessageHandlers(bot, tradeManager);

// 5. التشغيل
await connectDB();
startHealthServer(port);
positionMonitor.start();
await bot.launch();
reportingService.init();
```

---

## 🔗 خريطة التبعيات

```
index.ts
    │
    ├── BingXService (API Key + Secret)
    │       ↑ يُمرر إلى:
    │       ├── AnalysisService(bingXService)
    │       ├── TradeManager(bingXService)
    │       ├── PositionMonitor(bingXService, ...)
    │       ├── portfolioHandlers(bot, bingXService)
    │       ├── reportHandlers(bot, bingXService)
    │       └── tradingHandlers(bot, bingXService)
    │
    ├── AnalysisService(bingXService)
    │       ↑ يُمرر إلى:
    │       └── PositionMonitor(..., analysisService, ...)
    │
    ├── TradeManager(bingXService)
    │       ↑ يُمرر إلى:
    │       └── messageHandlers(bot, tradeManager)
    │
    └── ReportingService(bot)
            └── init() → Cron jobs أسبوعي/شهري
```

---

## 🔄 Graceful Shutdown

```typescript
process.once('SIGINT', () => {
    positionMonitor.stop();  // إيقاف المراقبة
    bot.stop('SIGINT');       // إيقاف البوت بأمان
});
process.once('SIGTERM', () => {
    positionMonitor.stop();
    bot.stop('SIGTERM');
});
```

---

## 🌐 server.ts — خادم Health Check

```typescript
// HTTP خادم بسيط للتحقق من حياة التطبيق (لـ Render.com)
app.get('/health', (req, res) => res.json({ status: 'ok' }));
app.listen(port);
```

**يُستخدم في:** منصة Render لمنع النوم التلقائي (Sleep).

---

# 🔧 config/db.ts — اتصال MongoDB

```typescript
const connectDB = async () => {
    const conn = await mongoose.connect(
        process.env.MONGODB_URI || 'mongodb://localhost:27017/bingx_bot'
    );
    logger.info(`MongoDB Connected: ${conn.connection.host}`);
};
```

**متغيرات البيئة المطلوبة:**
```
MONGODB_URI=mongodb+srv://...  (إنتاج)
أو غير موجود → localhost      (تطوير)
```

---

# 📝 utils/logger.ts — نظام السجلات

```typescript
const logger = winston.createLogger({
    level: 'info',
    format: combine(timestamp(), json()),
    transports: [
        new File({ filename: 'logs/error.log', level: 'error' }),
        new File({ filename: 'logs/combined.log' })
    ]
});

// في التطوير: إضافة Console
if (NODE_ENV !== 'production') {
    logger.add(new Console({ format: simple() }));
}
```

**الملفات المُنتجة:**
```
logs/
├── error.log     ← أخطاء فقط
└── combined.log  ← كل المستويات (info, warn, error)
```

---

# 📨 utils/telegram.ts — إرسال آمن للرسائل

```typescript
async function sendTelegramMessage(bot, chatId, text, options = {}) {
    const maxRetries = 3;
    while (attempt < maxRetries) {
        try {
            await bot.telegram.sendMessage(chatId, text, {
                parse_mode: 'HTML',
                ...options
            });
            return;
        } catch (error) {
            if (error.code === 429) {  // Too Many Requests
                const retryAfter = error.parameters?.retry_after || 5;
                await sleep((retryAfter + 1) × 1000);
                attempt++;
            } else {
                throw error;  // خطأ غير معروف → رمي الاستثناء
            }
        }
    }
    throw Error('Failed after 3 retries');
}
```

**الخوارزمية:**
1. إرسال الرسالة
2. عند 429 (Rate Limit) → انتظر `retryAfter+1` ثانية
3. أعد المحاولة حتى 3 مرات
4. إذا فشل 3 مرات → رمي استثناء

---

# 📰 ReportingService.ts — خدمة التقارير الدورية

## جدول التشغيل

| التقرير | التوقيت (Cron) | الفترة |
|---------|--------------|--------|
| أسبوعي | `0 0 * * 0` | كل أحد الساعة 00:00 |
| شهري | `0 0 1 * *` | أول كل شهر الساعة 00:00 |

## منطق التقرير

```typescript
const users = await User.find({ isActive: true });
for (const user of users) {
    const trades = await Trade.find({
        userId: user._id,
        entryTime: { $gte: startTime, $lte: now },
        currentStatus: { $in: ['CLOSED_PROFIT', 'CLOSED_LOSS'] }
    });
    
    // حساب الإحصائيات
    const totalPnL = Σ(trade.pnl);
    const wins     = trades.filter(t => t.pnl > 0).length;
    const winRate  = (wins / trades.length) × 100;
    
    // إرسال التقرير
    await sendTelegramMessage(bot, user.telegramId, reportText);
}
```

## محتوى التقرير

```
📊 WEEKLY TRADING REPORT
Period: DD/MM/YYYY - DD/MM/YYYY

Total Trades: 15
Win Rate: 66.67%
Total PnL: 234.567 USDT

Keep it up! 🚀
```

---

# 🛡️ bot/middlewares/userMiddleware.ts — مدقق المستخدم

```typescript
export const ensureUser = async (ctx, next) => {
    const telegramId = ctx.from?.id?.toString();
    if (!telegramId) return next();
    
    // البحث أو إنشاء المستخدم
    let user = await User.findOne({ telegramId });
    if (!user) {
        user = new User({
            telegramId,
            username: ctx.from.username
        });
        await user.save();
    }
    
    ctx.state.user = user;  // تخزين في السياق للاستخدام لاحقاً
    return next();
};
```

**يعمل مع كل رسالة/أمر** قبل أي Handler. يضمن أن `ctx.state.user` دائماً موجود.
