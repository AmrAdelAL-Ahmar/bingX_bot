import { SignalParser } from './src/services/SignalParser';

const signals = [
    // Case 1: Complex format with Arabic and Emojis
    `XVS/USDT
🔽SHORT X25 TO X50
▶️ENTER PRICE(سعر الدخول):
4.5
▶️TARGET  PRICE(الاهداف):
4.4
4.3
▶️STOP LOSE(الاستوب):
4.606`,

    // Case 2: Multi-line target and different emojis
    `POWER/USDT
🔼LONG X25 TO X40
▶️ENTER PRICE(سعر الدخول):
0.32
▶️TARGET  PRICE(الاهداف):
0.34
▶️STOP LOSE(الاستوب)
0.31`,

    // Case 3: PIPPIN format
    `PIPPIN/USDT
🔼LONG X25 TO X50
▶️ENTER PRICE(سعر الدخول):
0.396
▶️TARGET  PRICE(الاهداف):
0.444
0.500
▶️STOP LOSE(الاستوب)
0.367`,

    // Case 4: Exit Signal
    `أغلق صفقة PIPPIN/USDT الآن`,

    // Case 5: Standard format
    `H/USDT LONG
Entry:0.096
TP1: 0.098
SL: 0.095
Risk: 2%
Leverage: 10x`,

    // Case 6: Gold (XAU) with Emojis
    `صفقة على الذهب لمن يريد 

🪙SELL XAUT

ENTER PRICE

✅ 4337

TARGET:

✅ 3300

❌ STOPLOSS 
4350`,

    // Case 7: GHST with Arabic labels
    `GHSTUSDT
LONG 
X50
الدخول من السعر الحالي 
0.193
هدف اول
0.1977
هدف ثاتي
0.210
استوب 
0.184`
];

signals.forEach((msg, i) => {
    console.log(`\n--- Test Case ${i + 1} ---`);
    const result = SignalParser.parse(msg);
    console.log(JSON.stringify(result, null, 2));
});
