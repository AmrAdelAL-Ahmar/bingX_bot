import logger from '../utils/logger';

export interface ParsedSignal {
    symbol: string;
    direction: 'LONG' | 'SHORT';
    entry: number[]; // Support entry ranges e.g. [50000, 50500]
    targets: number[];
    stopLoss: number;
    risk?: number;      // Optional risk override (e.g. 2 for 2%)
    leverage?: number;  // Optional leverage override (e.g. 10 for 10x)
}

export class SignalParser {
    // Regex patterns
    private static symbolRegex = /#?([A-Z0-9]+)(?:USDT|\/USDT)/i;
    private static directionRegex = /(LONG|SHORT|BUY|SELL)/i;

    static parse(message: string): ParsedSignal | null {
        try {
            const lines = message.split('\n');
            let symbol = '';
            let direction: 'LONG' | 'SHORT' = 'LONG';
            let entry: number[] = [];
            let targets: number[] = [];
            let stopLoss = 0;
            let risk: number | undefined;
            let leverage: number | undefined;

            // Normalize message for key checks
            const text = message.toUpperCase();

            // 1. Extract Symbol
            // Matches: #BTCUSDT, BTC/USDT, BTC USDT, PIPPIN/USDT
            const symbolMatch = text.match(/#?([A-Z0-9]+)(?:USDT|\/USDT|[\s]USDT)/);
            if (symbolMatch) {
                symbol = `${symbolMatch[1]}/USDT:USDT`; // CCXT Format for BingX Swap
            }

            // 2. Extract Direction
            const dirMatch = text.match(/\b(LONG|BUY)\b|\b(SHORT|SELL)\b/);
            if (dirMatch) {
                direction = dirMatch[1] ? 'LONG' : 'SHORT';
            }

            // 3. Extract Entry
            const entryMatch = message.match(/(?:Entry|EP|E\.P)[\s:-]*([\d.]+)(?:\s*-\s*([\d.]+))?/i);
            if (entryMatch) {
                entry.push(parseFloat(entryMatch[1]));
                if (entryMatch[2]) entry.push(parseFloat(entryMatch[2]));
            }

            // 4. Extract Targets (TPs)
            const tpMatches = [...message.matchAll(/(?:TP\d*|Target\s*\d*)[\s:.-]*([\d.]+)/gi)];
            for (const m of tpMatches) {
                const val = parseFloat(m[1]);
                if (!isNaN(val)) targets.push(val);
            }

            // 5. Extract Stop Loss
            const slMatch = message.match(/(?:SL|Stop|Stop Loss)[\s:.-]*([\d.]+)/i);
            if (slMatch) {
                stopLoss = parseFloat(slMatch[1]);
            }

            // 6. Extract Risk (New)
            const riskMatch = message.match(/(?:Risk)[\s:.-]*([\d.]+)/i);
            if (riskMatch) {
                risk = parseFloat(riskMatch[1]);
            }

            // 7. Extract Leverage (New)
            const levMatch = message.match(/(?:Leverage|Lev)[\s:.-]*(\d+)/i);
            if (levMatch) {
                leverage = parseInt(levMatch[1]);
            }

            if (!symbol || entry.length === 0 || targets.length === 0 || stopLoss === 0) {
                logger.warn('Failed to parse all signal components', { symbol, entry, targets, stopLoss });
                return null;
            }

            return {
                symbol,
                direction,
                entry,
                targets,
                stopLoss,
                risk,
                leverage
            };

        } catch (error) {
            logger.error('Error parsing signal:', error);
            return null;
        }
    }
}
