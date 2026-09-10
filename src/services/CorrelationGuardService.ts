import logger from '../utils/logger';
import { BingXService } from './BingXService';

export interface CorrelationCheckResult {
    allowed: boolean;
    reason?: string;
    currentPortfolioHeat: number;
    candidateRiskPercentage: number;
    correlatedSymbol?: string;
    correlationScore?: number;
}

export class CorrelationGuardService {
    public static MAX_PORTFOLIO_HEAT_PCT = 6.0; // Max 6% capital at risk across all positions
    public static MAX_ALLOWED_CORRELATION = 0.80; // Block pairs with > 0.80 correlation

    /**
     * Calculates Pearson correlation coefficient between two series of price returns
     */
    static calculatePearsonCorrelation(seriesA: number[], seriesB: number[]): number {
        const n = Math.min(seriesA.length, seriesB.length);
        if (n < 5) return 0;

        // Compute percentage returns
        const retA: number[] = [];
        const retB: number[] = [];
        for (let i = 1; i < n; i++) {
            retA.push((seriesA[i] - seriesA[i - 1]) / seriesA[i - 1]);
            retB.push((seriesB[i] - seriesB[i - 1]) / seriesB[i - 1]);
        }

        const len = retA.length;
        const meanA = retA.reduce((a, b) => a + b, 0) / len;
        const meanB = retB.reduce((a, b) => a + b, 0) / len;

        let num = 0;
        let denA = 0;
        let denB = 0;

        for (let i = 0; i < len; i++) {
            const diffA = retA[i] - meanA;
            const diffB = retB[i] - meanB;
            num += diffA * diffB;
            denA += diffA * diffA;
            denB += diffB * diffB;
        }

        const den = Math.sqrt(denA * denB);
        if (den === 0) return 0;

        return Number((num / den).toFixed(3));
    }

    /**
     * Checks if a new trade can be opened without exceeding portfolio heat or correlation limits
     */
    static async validateTrade(
        candidateSymbol: string,
        candidateDirection: 'LONG' | 'SHORT',
        candidateRiskPct: number,
        bingx: BingXService
    ): Promise<CorrelationCheckResult> {
        try {
            const openPositions = await bingx.getPositions();
            if (!openPositions || openPositions.length === 0) {
                return {
                    allowed: true,
                    currentPortfolioHeat: candidateRiskPct,
                    candidateRiskPercentage: candidateRiskPct
                };
            }

            // 1. Calculate current portfolio heat
            // Heat is approximated by total margin / equity * estimated position stop distance
            let currentHeat = 0;
            for (const pos of openPositions) {
                if (parseFloat(pos.contracts) > 0) {
                    currentHeat += 2.0;
                }
            }

            if (currentHeat + candidateRiskPct > this.MAX_PORTFOLIO_HEAT_PCT) {
                const msg = `🚨 تم تجاوز سقف حرارة المحفظة الإجمالي: (${(currentHeat + candidateRiskPct).toFixed(1)}% > ${this.MAX_PORTFOLIO_HEAT_PCT}%). يرجى انتظار إغلاق بعض الصفقات.`;
                logger.warn(`[CorrelationGuard] ${msg}`);
                return {
                    allowed: false,
                    reason: msg,
                    currentPortfolioHeat: currentHeat,
                    candidateRiskPercentage: candidateRiskPct
                };
            }

            // 2. Correlation Guard: Check against existing open positions in same direction
            const sameSidePositions = openPositions.filter((p: any) => {
                if (parseFloat(p.contracts) === 0) return false;
                const side = (p.side || '').toUpperCase();
                return (candidateDirection === 'LONG' && side.includes('LONG')) ||
                       (candidateDirection === 'SHORT' && side.includes('SHORT'));
            });

            if (sameSidePositions.length > 0) {
                // Fetch candidate candles
                const candidateCandles = await bingx.fetchOHLCV(candidateSymbol, '1h', 30);
                const candCloses = candidateCandles.map((c: any) => c.close);

                for (const pos of sameSidePositions) {
                    if (pos.symbol === candidateSymbol) continue; // Same symbol handled elsewhere

                    try {
                        const existingCandles = await bingx.fetchOHLCV(pos.symbol, '1h', 30);
                        const existCloses = existingCandles.map((c: any) => c.close);

                        const corr = this.calculatePearsonCorrelation(candCloses, existCloses);
                        if (corr >= this.MAX_ALLOWED_CORRELATION) {
                            const msg = `⚠️ تم حظر الصفقة بسبب الارتباط المالي المرتفع (${(corr * 100).toFixed(0)}%) مع المركز المفتوح (${pos.symbol} ${candidateDirection}). تجنب مضاعفة المخاطرة على نفس حركة السوق.`;
                            logger.warn(`[CorrelationGuard] ${msg}`);
                            return {
                                allowed: false,
                                reason: msg,
                                currentPortfolioHeat: currentHeat,
                                candidateRiskPercentage: candidateRiskPct,
                                correlatedSymbol: pos.symbol,
                                correlationScore: corr
                            };
                        }
                    } catch (e) {
                        logger.warn(`[CorrelationGuard] Failed correlation check between ${candidateSymbol} and ${pos.symbol}:`, e);
                    }
                }
            }

            return {
                allowed: true,
                currentPortfolioHeat: currentHeat + candidateRiskPct,
                candidateRiskPercentage: candidateRiskPct
            };
        } catch (err) {
            logger.error('[CorrelationGuard] Validation check error, defaulting to permissive:', err);
            return {
                allowed: true,
                currentPortfolioHeat: candidateRiskPct,
                candidateRiskPercentage: candidateRiskPct
            };
        }
    }
}
