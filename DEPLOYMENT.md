# 🚀 دليل رفع البوت على المنصات السحابية

## 📋 المحتويات
1. [الخيارات المتاحة](#الخيارات-المتاحة)
2. [الإعداد الأولي](#الإعداد-الأولي)
3. [Railway (موصى به)](#railway-موصى-به)
4. [Render](#render)
5. [VPS (DigitalOcean/AWS)](#vps)
6. [الأسئلة الشائعة](#الأسئلة-الشائعة)

---

## 🎯 الخيارات المتاحة

| المنصة | السعر | السهولة | الموصى به |
|--------|-------|---------|-----------|
| **Railway** | $5/شهر | ⭐⭐⭐⭐⭐ | ✅ نعم |
| **Render** | مجاني/مدفوع | ⭐⭐⭐⭐ | ✅ نعم |
| **VPS** | $5-10/شهر | ⭐⭐⭐ | للمحترفين |

---

## 🔧 الإعداد الأولي

### 1. إنشاء قاعدة بيانات MongoDB على السحابة

#### الخطوة 1: التسجيل في MongoDB Atlas
1. اذهب إلى [MongoDB Atlas](https://www.mongodb.com/cloud/atlas/register)
2. سجل حساب جديد (مجاني)
3. اختر **Free Tier** (M0)

#### الخطوة 2: إنشاء Cluster
1. اضغط **Build a Database**
2. اختر **Free Shared Cluster**
3. اختر المنطقة الأقرب لك (مثل: Frankfurt)
4. اضغط **Create Cluster**

#### الخطوة 3: إنشاء مستخدم
1. اذهب إلى **Database Access**
2. اضغط **Add New Database User**
3. اختر اسم مستخدم وكلمة مرور قوية
4. احفظهم في مكان آمن!

#### الخطوة 4: السماح بالاتصال
1. اذهب إلى **Network Access**
2. اضغط **Add IP Address**
3. اختر **Allow Access from Anywhere** (0.0.0.0/0)
4. اضغط **Confirm**

#### الخطوة 5: الحصول على رابط الاتصال
1. اذهب إلى **Database** → **Connect**
2. اختر **Connect your application**
3. انسخ الرابط (يبدأ بـ `mongodb+srv://...`)
4. استبدل `<password>` بكلمة المرور الحقيقية

**مثال:**
```
mongodb+srv://username:your_password@cluster0.xxxxx.mongodb.net/trading_bot?retryWrites=true&w=majority
```

---

### 2. تحضير ملف `.env`

أنشئ ملف `.env.production` في مجلد المشروع:

```env
# BingX API
BINGX_API_KEY=your_bingx_api_key
BINGX_SECRET_KEY=your_bingx_secret_key

# Telegram
TELEGRAM_BOT_TOKEN=your_telegram_bot_token

# MongoDB (من الخطوة السابقة)
MONGO_URI=mongodb+srv://username:password@cluster0.xxxxx.mongodb.net/trading_bot?retryWrites=true&w=majority

# Settings
RISK_PERCENTAGE=5
```

---

## 🚂 Railway (موصى به)

### لماذا Railway؟
- ✅ سهل جداً
- ✅ دعم Node.js مباشر
- ✅ $5/شهر فقط
- ✅ يعمل 24/7

### خطوات الرفع

#### 1. إنشاء حساب
1. اذهب إلى [Railway.app](https://railway.app)
2. سجل دخول بحساب GitHub

#### 2. رفع المشروع على GitHub
```bash
# في مجلد المشروع
git init
git add .
git commit -m "Initial commit"

# أنشئ repository جديد على GitHub ثم:
git remote add origin https://github.com/your-username/BotTrading_BingX.git
git push -u origin main
```

#### 3. إنشاء مشروع جديد في Railway
1. اضغط **New Project**
2. اختر **Deploy from GitHub repo**
3. اختر repository الخاص بك
4. Railway سيبدأ البناء تلقائياً

#### 4. إضافة المتغيرات البيئية
1. اذهب إلى **Variables**
2. أضف كل متغير من ملف `.env`:
   - `BINGX_API_KEY`
   - `BINGX_SECRET_KEY`
   - `TELEGRAM_BOT_TOKEN`
   - `MONGO_URI`
   - `RISK_PERCENTAGE`

#### 5. التحقق من التشغيل
1. اذهب إلى **Deployments**
2. تحقق من Logs
3. يجب أن ترى: `MongoDB Connected` و `Telegram Bot Started`

✅ **تم! البوت الآن يعمل 24/7**

---

## 🎨 Render

### لماذا Render؟
- ✅ خطة مجانية متاحة
- ✅ سهل الاستخدام
- ⚠️ الخطة المجانية تتوقف بعد 15 دقيقة من عدم النشاط

### خطوات الرفع

#### 1. إنشاء حساب
1. اذهب إلى [Render.com](https://render.com)
2. سجل دخول بحساب GitHub

#### 2. رفع على GitHub (إذا لم تفعل)
```bash
git init
git add .
git commit -m "Initial commit"
git remote add origin https://github.com/your-username/BotTrading_BingX.git
git push -u origin main
```

#### 3. إنشاء Web Service
1. اضغط **New +** → **Web Service**
2. اختر repository الخاص بك
3. املأ البيانات:
   - **Name:** `trading-bot`
   - **Environment:** `Node`
   - **Build Command:** `npm install && npm run build`
   - **Start Command:** `npm start`

#### 4. إضافة المتغيرات البيئية
في قسم **Environment Variables**، أضف:
```
BINGX_API_KEY=your_key
BINGX_SECRET_KEY=your_secret
TELEGRAM_BOT_TOKEN=your_token
MONGO_URI=your_mongodb_uri
RISK_PERCENTAGE=5
PORT=10000
```

> **ملاحظة:** Render يوفر متغير `PORT` تلقائياً، لكن يمكنك تحديده يدوياً إذا أردت.

#### 5. اختيار الخطة
- **Free:** مجاني (يتوقف بعد 15 دقيقة)
- **Starter:** $7/شهر (يعمل 24/7)

#### 6. Deploy
اضغط **Create Web Service**

✅ **تم! البوت يعمل الآن**

---

## 💻 VPS (للمحترفين)

### الخيارات المتاحة
- **DigitalOcean:** $6/شهر
- **AWS Lightsail:** $5/شهر
- **Vultr:** $5/شهر

### خطوات الرفع (DigitalOcean)

#### 1. إنشاء Droplet
1. سجل في [DigitalOcean](https://www.digitalocean.com)
2. اضغط **Create** → **Droplets**
3. اختر:
   - **Image:** Ubuntu 22.04 LTS
   - **Plan:** Basic ($6/mo)
   - **Region:** الأقرب لك

#### 2. الاتصال بالسيرفر
```bash
ssh root@your_server_ip
```

#### 3. تثبيت Node.js
```bash
# تحديث النظام
apt update && apt upgrade -y

# تثبيت Node.js
curl -fsSL https://deb.nodesource.com/setup_18.x | bash -
apt install -y nodejs

# تثبيت PM2
npm install -g pm2
```

#### 4. رفع المشروع
```bash
# على جهازك المحلي
scp -r e:\webProject\BotTrading_BingX root@your_server_ip:/root/

# على السيرفر
cd /root/BotTrading_BingX
npm install
npm run build
```

#### 5. إنشاء ملف `.env`
```bash
nano .env
```
الصق محتوى `.env.production` واحفظ (Ctrl+X, Y, Enter)

#### 6. تشغيل البوت بـ PM2
```bash
pm2 start dist/index.js --name trading-bot
pm2 save
pm2 startup
```

#### 7. مراقبة البوت
```bash
# عرض الحالة
pm2 status

# عرض السجلات
pm2 logs trading-bot

# إعادة التشغيل
pm2 restart trading-bot
```

✅ **تم! البوت يعمل 24/7 على VPS الخاص بك**

---

## 📝 ملف `package.json` المحدث

تأكد من وجود هذه السكريبتات:

```json
{
  "scripts": {
    "dev": "nodemon --exec ts-node src/index.ts",
    "build": "tsc",
    "start": "node dist/index.js",
    "pm2": "pm2 start dist/index.js --name trading-bot"
  }
}
```

---

## ❓ الأسئلة الشائعة

### س1: أيهما أفضل للمبتدئين؟
**ج:** Railway - الأسهل والأسرع في الإعداد.

### س2: هل يمكن استخدام خطة مجانية؟
**ج:** Render يوفر خطة مجانية لكنها تتوقف بعد 15 دقيقة من عدم النشاط (غير مناسب للبوت).

### س3: كيف أتحقق من أن البوت يعمل؟
**ج:** أرسل `/balance` للبوت في تليجرام.

### س4: ماذا لو توقف البوت؟
**ج:** 
- **Railway/Render:** تحقق من Logs في لوحة التحكم
- **VPS:** استخدم `pm2 logs trading-bot`

### س5: كيف أحدث البوت؟
**ج:**
- **Railway/Render:** ارفع التحديثات على GitHub وسيتم النشر تلقائياً
- **VPS:** 
  ```bash
  cd /root/BotTrading_BingX
  git pull
  npm run build
  pm2 restart trading-bot
  ```

### س6: هل البيانات آمنة؟
**ج:** نعم، طالما:
- ✅ استخدمت MongoDB Atlas (مشفر)
- ✅ لم تشارك ملف `.env`
- ✅ استخدمت HTTPS للاتصالات

---

## 🔐 نصائح الأمان

1. **لا ترفع ملف `.env` على GitHub**
   - أضف `.env` إلى `.gitignore`

2. **استخدم متغيرات بيئية**
   - لا تكتب المفاتيح مباشرة في الكود

3. **فعّل 2FA**
   - على حساب GitHub
   - على حساب المنصة السحابية

4. **راقب الاستخدام**
   - تحقق من فواتير المنصة شهرياً

---

## 📊 مقارنة التكاليف

| المنصة | التكلفة الشهرية | المميزات |
|--------|-----------------|----------|
| Railway | $5 | سهل، موثوق، دعم ممتاز |
| Render | $7 (أو مجاني محدود) | سهل، خطة مجانية |
| DigitalOcean | $6 | تحكم كامل، مرن |

---

## 🎉 الخلاصة

**للمبتدئين:** استخدم Railway
**للمحترفين:** استخدم VPS

في كلتا الحالتين، البوت سيعمل 24/7 بشكل موثوق!

**حظاً موفقاً! 🚀**
