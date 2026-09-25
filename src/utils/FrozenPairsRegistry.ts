import logger from './logger';

export class FrozenPairsRegistry {
    private static frozen = new Map<string, number>();

    static freeze(symbol: string, durationMs: number) {
        const expiresAt = Date.now() + durationMs;
        const sym = symbol.toUpperCase().split(':')[0]; // normalize BTC/USDT:USDT to BTC/USDT
        this.frozen.set(sym, expiresAt);
        logger.info(`[FrozenPairsRegistry] Symbol ${sym} is frozen until ${new Date(expiresAt).toISOString()}`);
    }

    static isFrozen(symbol: string): boolean {
        const sym = symbol.toUpperCase().split(':')[0];
        const expiresAt = this.frozen.get(sym);
        if (!expiresAt) return false;
        if (Date.now() > expiresAt) {
            this.frozen.delete(sym);
            return false;
        }
        return true;
    }

    static getExpiration(symbol: string): Date | null {
        const sym = symbol.toUpperCase().split(':')[0];
        const expiresAt = this.frozen.get(sym);
        return expiresAt ? new Date(expiresAt) : null;
    }
}
