import logger from '../utils/logger';

export interface ParsedSignal {
    type: 'TRADE' | 'CLOSE';
    symbol: string;
    direction?: 'LONG' | 'SHORT';
    entry?: number[];
    targets?: number[];
    stopLoss?: number;
    risk?: number;
    leverage?: number;
}

export class SignalParser {
    // Regex patterns
    private static symbolRegex = /#?([A-Z0-9]+)(?:USDT|\/USDT)/i;
    private static directionRegex = /(LONG|SHORT|BUY|SELL)/i;

    static parse(message: string): ParsedSignal | null {
        try {
            const text = message.toUpperCase();

            // 1. Check for Exit/Close Signal
            if (text.includes('CLOSE') || text.includes('EXIT') || text.includes('أغلق') || text.includes('خروج')) {
                const symbolMatch = text.match(/#?([A-Z0-9]+)(?:USDT|\/USDT|[\s]USDT)/);
                if (symbolMatch) {
                    return {
                        type: 'CLOSE',
                        symbol: `${symbolMatch[1]}/USDT:USDT`
                    };
                }
            }

            // 2. Initialize variables
            let symbol = '';
            let direction: 'LONG' | 'SHORT' = 'LONG';
            let entry: number[] = [];
            let targets: number[] = [];
            let stopLoss = 0;
            let risk: number | undefined;
            let leverage: number | undefined;

            // 3. Extract Symbol
            // Special handling for GOLD/XAU
            if (text.includes('XAU') || text.includes('GOLD') || text.includes('الذهب')) {
                symbol = 'XAU/USDT:USDT';
            } else {
                // Matches: GHSTUSDT, #BTCUSDT, BTC/USDT, BTC USDT, PIPPIN/USDT
                const symbolMatch = text.match(/#?([A-Z0-9]+)(?:USDT|\/USDT|[\s]USDT)/) ||
                    text.match(/^([A-Z0-9]+)USDT/m) ||
                    text.match(/([A-Z0-9]+)\/USDT/);

                if (symbolMatch) {
                    symbol = `${symbolMatch[1]}/USDT:USDT`;
                }
            }

            // 4. Extract Direction & Leverage
            if (text.includes('SHORT') || text.includes('SELL') || text.includes('🔽')) {
                direction = 'SHORT';
            } else if (text.includes('LONG') || text.includes('BUY') || text.includes('🔼')) {
                direction = 'LONG';
            }

            const levMatch = text.match(/(?:X|LEVERAGE|LEV|X)[\s:]*(\d+)/i);
            if (levMatch) leverage = parseInt(levMatch[1]);

            // 5. Block-based Parsing for complex formats
            // Split by lines and search for keywords
            const lines = message.split('\n').map(l => l.trim()).filter(l => l.length > 0);

            for (let i = 0; i < lines.length; i++) {
                const line = lines[i].toUpperCase();

                // Entry Search
                if (line.includes('ENTRY') || line.includes('ENTER PRICE') ||
                    line.includes('سعر الدخول') || line.includes('الدخول') ||
                    line.includes('EP')) {
                    // Check if value is on this line or next
                    const valMatch = lines[i] + ' ' + (lines[i + 1] || '');
                    const matches = valMatch.match(/([\d.]+)(?:\s*-\s*([\d.]+))?/);
                    if (matches && entry.length === 0) {
                        entry.push(parseFloat(matches[1]));
                        if (matches[2]) entry.push(parseFloat(matches[2]));
                    }
                }

                // Targets Search
                // Trigger only on explicit headers, NOT just emojis
                if (line.includes('TARGET') || line.includes('TP') ||
                    line.includes('الاهداف') || line.includes('الأهداف') ||
                    (line.includes('هدف') && !line.includes('الهدف'))) {

                    // Check next few lines for prices
                    let j = i;
                    if (!line.match(/[\d.]+/)) j++; // If no number on this line, look next

                    while (j < lines.length) {
                        // Check for stop keywords to break loop
                        if (lines[j].toUpperCase().match(/(STOP|SL|استوب|الأستوب|❌|RISK|LEVERAGE)/)) break;

                        // Check for numbers (potentially with emojis like ✅)
                        const priceMatch = lines[j].match(/(?:✅|🪙|\s|^)([\d.]+)/);
                        if (priceMatch) {
                            const val = parseFloat(priceMatch[1]);
                            if (!isNaN(val) && !entry.includes(val) && !targets.includes(val)) {
                                targets.push(val);
                            }
                        } else {
                            // Break on unrelated headers
                            if (lines[j].match(/(ENTRY|DOCK|LEV|STOP)/i)) break;
                        }
                        j++;
                        if (j > i + 8) break;
                    }
                }

                // Stop Loss Search
                if (line.includes('STOP') || line.includes('SL') ||
                    line.includes('الاستوب') || line.includes('الأستوب') ||
                    line.includes('استوب') || // Added missing keyword
                    line.includes('❌')) {
                    const valMatch = lines[i] + ' ' + (lines[i + 1] || '');
                    const match = valMatch.match(/([\d.]+)/);
                    if (match) stopLoss = parseFloat(match[1]);
                }

                // Risk Search
                if (line.includes('RISK')) {
                    const match = line.match(/RISK[\s:.-]*([\d.]+)/);
                    if (match) risk = parseFloat(match[1]);
                }
            }

            // Fallback for simple formats
            if (targets.length === 0) {
                const tpMatches = [...message.matchAll(/(?:TP\d*|TARGET\d*)[\s:.-]*([\d.]+)/gi)];
                targets = tpMatches.map(m => parseFloat(m[1]));
            }
            if (entry.length === 0) {
                const eMatch = message.match(/(?:ENTRY|EP)[\s:.-]*([\d.]+)/i);
                if (eMatch) entry.push(parseFloat(eMatch[1]));
            }

            // Final check
            if (!symbol || entry.length === 0 || targets.length === 0 || stopLoss === 0) {
                // If we have symbol and something else, we might still want to try?
                // But generally fail to avoid bad trades.
                return null;
            }

            return {
                type: 'TRADE',
                symbol,
                direction,
                entry,
                targets,
                stopLoss,
                risk,
                leverage
            };

        } catch (error) {
            console.error('Error parsing signal:', error);
            return null;
        }
    }
}
