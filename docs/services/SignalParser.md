# 🔍 SignalParser.ts — محلل الإشارات

> **الموقع:** `src/services/SignalParser.ts`  
> **الدور:** تحويل رسائل نصية (من Telegram أو أي مصدر) إلى كائن `ParsedSignal` منظم يفهمه `TradeManager`.

---

## 📋 نظرة عامة

| الخاصية | القيمة |
|---------|--------|
| **المدخل** | نص حر (رسالة Telegram) |
| **المخرج** | `ParsedSignal` أو `null` |
| **يدعم** | LONG/SHORT, Entry/TP/SL متعددة, Leverage, MarginMode |
| **يدعم العربية** | ✅ كلمات مثل: الدخول، الأهداف، استوب |

---

## 📦 هيكل `ParsedSignal`

```typescript
{
    type: 'TRADE' | 'CLOSE',
    symbol: string,          // مثل 'BTC/USDT:USDT'
    direction?: 'LONG' | 'SHORT',
    entry?: number[],        // قائمة أسعار الدخول
    targets?: number[],      // أهداف متعددة
    stopLoss?: number,
    risk?: number,           // نسبة المخاطرة من الرسالة
    leverage?: number,
    marginMode?: 'CROSS' | 'ISOLATED'
}
```

---

## 🔧 خوارزمية `parse(message)`

### الخطوة 1: فحص إشارة الإغلاق

```typescript
if (text.includes('CLOSE' | 'EXIT' | 'أغلق' | 'خروج')) {
    const symbolMatch = text.match(/#?([A-Z0-9]+)(?:USDT|\/USDT)/);
    return { type: 'CLOSE', symbol: `${match}/USDT:USDT` };
}
```

---

### الخطوة 2: استخراج الرمز

```typescript
// Pattern 1: BTCUSDT أو BTC/USDT
text.match(/#?([A-Z0-9]+)(?:USDT|\/USDT|[\s]USDT)/)

// Pattern 2: SYMBOL: BTC
text.match(/symbol[\s:=]\s*([A-Z0-9]+)/i)
```

**تحويل خاص:**
| المدخل | المخرج |
|--------|--------|
| `GOLD`, `XAU`, `XAUT` | `'XAUT/USDT:USDT'` |
| `BTC` | `'BTC/USDT:USDT'` |
| أي رمز آخر | `'SYMBOL/USDT:USDT'` |

---

### الخطوة 3: استخراج الاتجاه

```typescript
if (text.includes('SHORT' | 'SELL' | '🔽')) → 'SHORT'
if (text.includes('LONG' | 'BUY' | '🔼'))  → 'LONG'
```

---

### الخطوة 4: استخراج وضع الهامش

```typescript
if (text.includes('ISOLATED' | 'معزول')) → 'ISOLATED'
if (text.includes('CROSS' | 'متبادل'))   → 'CROSS'
```

الافتراضي: `'CROSS'`

---

### الخطوة 5: استخراج الرافعة

```typescript
// Pattern 1: X10 أو x25
text.match(/x(\d+)/i)

// Pattern 2: 10X أو 25x
text.match(/(\d+)x/i)

// XAUT: تحديد أقصى 50x
if (symbol.includes('XAUT') && leverage > 50) leverage = 50;
```

---

### الخطوة 6: التحليل سطراً بسطر

```typescript
const lines = message.split('\n').map(l => l.trim());
for (let i = 0; i < lines.length; i++) {
    const line = lines[i].toUpperCase();
    
    // Entry
    if (line.includes('ENTRY' | 'ENTER PRICE' | 'سعر الدخول' | 'EP')) {
        // البحث في السطر الحالي والتالي
        const matches = (lines[i] + ' ' + lines[i+1]).match(/[\d.]+/);
        entry.push(parseFloat(matches[1]));
    }
    
    // Targets
    if (line.includes('TARGET' | 'TP' | 'الاهداف' | 'هدف')) {
        // البحث في الأسطر التالية حتى أول Stop keyword
        while (j < lines.length) {
            if (line.match(/(STOP|SL|استوب|❌|RISK)/)) break;
            const priceMatch = lines[j].match(/(?:✅|🪙|^)([\d.]+)/);
            if (priceMatch) targets.push(parseFloat(priceMatch[1]));
            if (j > i + 8) break;  // أقصى 8 أسطر
        }
    }
    
    // StopLoss
    if (line.includes('STOP' | 'SL' | 'الاستوب' | '❌')) {
        const match = (lines[i] + ' ' + lines[i+1]).match(/[\d.]+/);
        stopLoss = parseFloat(match[1]);
    }
}
```

---

### الخطوة 7: Fallback للتنسيقات البسيطة

```typescript
// إذا لم تُوجد أهداف من التحليل السطري
if (targets.length === 0) {
    const tpMatches = [...message.matchAll(/(?:TP\d*|TARGET\d*)[\s:.-]*([\d.]+)/gi)];
    targets = tpMatches.map(m => parseFloat(m[1]));
}

// إذا لم يوجد entry
if (entry.length === 0) {
    const eMatch = message.match(/(?:ENTRY|EP)[\s:.-]*([\d.]+)/i);
    if (eMatch) entry.push(parseFloat(eMatch[1]));
}
```

---

## 📋 أمثلة على تنسيقات مدعومة

### تنسيق إنجليزي بسيط:
```
BTCUSDT LONG X20
ENTRY: 65000
TP1: 66000
TP2: 67000
SL: 64000
```

### تنسيق عربي:
```
#BTC/USDT 🔼LONG
سعر الدخول: 65000
الأهداف:
✅ 66000
✅ 67000
❌ استوب: 64000
```

### تنسيق مختلط:
```
$BTCUSDT 🔼 LONG X15
EP 65000
TARGET 66000 / 67000
SL 64000 - ISOLATED
```

---

## ⚠️ محدودية المحلل

1. **لا يتحقق من منطقية الأسعار** — SL فوق Entry للـ LONG لن يُكتشف
2. **أقصى 8 أسطر للأهداف** — قد يفوّت أهدافاً أكثر من 8 أسطر
3. **إذا لم يُوجد symbol → يُعيد null** (رفض الإشارة)
4. **لا يتحقق من الرافعة** إلا لـ XAUT (50x حد)
