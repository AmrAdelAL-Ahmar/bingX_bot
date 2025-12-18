import { SignalParser } from './src/services/SignalParser';

const testMsg = `H/USDT SHORT
Entry:0.094
TP1: 0.089
SL:0.1
Risk: 3%
Leverage: 25x`;

const result = SignalParser.parse(testMsg);
console.log('Parsed Result:', JSON.stringify(result, null, 2));
