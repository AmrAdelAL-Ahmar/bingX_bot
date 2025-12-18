import { SignalParser } from './src/services/SignalParser';

const ghstMsg = `GHSTUSDT
LONG 
X50
الدخول من السعر الحالي 
0.193
هدف اول
0.1977
هدف ثاتي
0.210
استوب 
0.184`;

console.log('--- Debugging GHST Parsing ---');
const text = ghstMsg.toUpperCase();
const symbolMatch = text.match(/#?([A-Z0-9]+)(?:USDT|\/USDT|[\s]USDT)/) ||
    text.match(/^([A-Z0-9]+)USDT/m) ||
    text.match(/([A-Z0-9]+)\/USDT/);

console.log('Symbol Match:', symbolMatch);

const lines = ghstMsg.split('\n').map(l => l.trim()).filter(l => l.length > 0);
console.log('Lines:', lines);

lines.forEach((line, i) => {
    console.log(`Line ${i}: ${line}`);
    if (line.includes('ENTRY') || line.includes('ENTER PRICE') ||
        line.includes('سعر الدخول') || line.includes('الدخول') ||
        line.includes('EP')) {
        console.log('  -> Entry detected');
        const valMatch = lines[i] + ' ' + (lines[i + 1] || '');
        const matches = valMatch.match(/([\d.]+)(?:\s*-\s*([\d.]+))?/);
        console.log('     ValMatch:', valMatch);
        console.log('     Matches:', matches);
    }

    if (line.includes('TARGET') || line.includes('TP') ||
        line.includes('الاهداف') || line.includes('الأهداف') ||
        line.includes('هدف') || line.includes('✅')) {
        console.log('  -> Target detected');
        // Check logic
        let j = i;
        if (!line.match(/[\d.]+/)) j++;
        console.log(`     Starting search at j=${j}`);
    }
});
