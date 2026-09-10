import { HarmonicPatternType, HarmonicDirection, SwingPoint, PRZZone, FibConfluenceLevel } from './types';

export class PRZCalculator {
    /**
     * Calculates the PRZ (Potential Reversal Zone) confluence band for a detected harmonic pattern
     */
    static calculatePRZ(
        pattern: HarmonicPatternType,
        direction: HarmonicDirection,
        X: SwingPoint,
        A: SwingPoint,
        B: SwingPoint,
        C: SwingPoint,
        pointZero?: SwingPoint // Optional for Shark 0-X-A-B-C
    ): PRZZone {
        const xa = Math.abs(A.price - X.price);
        const ab = Math.abs(B.price - A.price);
        const bc = Math.abs(C.price - B.price);
        const xc = Math.abs(C.price - X.price);

        const confluences: FibConfluenceLevel[] = [];

        // Determine multiplier direction
        // For BULLISH: D is lower than C (downward move CD into PRZ, then reversal UP)
        // For BEARISH: D is higher than C (upward move CD into PRZ, then reversal DOWN)
        const isBullish = direction === 'BULLISH';

        switch (pattern) {
            case 'GARTLEY': {
                const dXA = isBullish ? X.price + (A.price - X.price) * (1 - 0.786) : X.price - (X.price - A.price) * (1 - 0.786);
                const dBC1 = isBullish ? C.price - bc * 1.272 : C.price + bc * 1.272;
                const dBC2 = isBullish ? C.price - bc * 1.618 : C.price + bc * 1.618;
                const dABCD = isBullish ? C.price - ab : C.price + ab;

                confluences.push({ ratioName: '0.786 XA', price: dXA, weight: 1.0 });
                confluences.push({ ratioName: '1.272 BC', price: dBC1, weight: 0.6 });
                confluences.push({ ratioName: '1.618 BC', price: dBC2, weight: 0.5 });
                confluences.push({ ratioName: 'AB=CD', price: dABCD, weight: 0.8 });
                break;
            }
            case 'BAT': {
                const dXA = isBullish ? X.price + (A.price - X.price) * (1 - 0.886) : X.price - (X.price - A.price) * (1 - 0.886);
                const dBC1 = isBullish ? C.price - bc * 1.618 : C.price + bc * 1.618;
                const dBC2 = isBullish ? C.price - bc * 2.618 : C.price + bc * 2.618;

                confluences.push({ ratioName: '0.886 XA', price: dXA, weight: 1.0 });
                confluences.push({ ratioName: '1.618 BC', price: dBC1, weight: 0.7 });
                confluences.push({ ratioName: '2.618 BC', price: dBC2, weight: 0.5 });
                break;
            }
            case 'ALT_BAT': {
                const dXA = isBullish ? X.price - xa * 0.13 : X.price + xa * 0.13; // 1.13 extension of XA
                const dBC = isBullish ? C.price - bc * 2.0 : C.price + bc * 2.0;

                confluences.push({ ratioName: '1.130 XA', price: dXA, weight: 1.0 });
                confluences.push({ ratioName: '2.000 BC', price: dBC, weight: 0.7 });
                break;
            }
            case 'BUTTERFLY': {
                const dXA1 = isBullish ? X.price - xa * 0.272 : X.price + xa * 0.272; // 1.272 XA
                const dXA2 = isBullish ? X.price - xa * 0.618 : X.price + xa * 0.618; // 1.618 XA
                const dBC = isBullish ? C.price - bc * 1.618 : C.price + bc * 1.618;

                confluences.push({ ratioName: '1.272 XA', price: dXA1, weight: 1.0 });
                confluences.push({ ratioName: '1.618 XA', price: dXA2, weight: 0.8 });
                confluences.push({ ratioName: '1.618 BC', price: dBC, weight: 0.7 });
                break;
            }
            case 'CRAB': {
                const dXA = isBullish ? X.price - xa * 0.618 : X.price + xa * 0.618; // 1.618 XA
                const dBC = isBullish ? C.price - bc * 2.618 : C.price + bc * 2.618;

                confluences.push({ ratioName: '1.618 XA Extreme', price: dXA, weight: 1.0 });
                confluences.push({ ratioName: '2.618 BC', price: dBC, weight: 0.7 });
                break;
            }
            case 'DEEP_CRAB': {
                const dXA = isBullish ? X.price - xa * 0.618 : X.price + xa * 0.618; // 1.618 XA
                const dBC = isBullish ? C.price - bc * 2.24 : C.price + bc * 2.24;

                confluences.push({ ratioName: '1.618 XA Extreme', price: dXA, weight: 1.0 });
                confluences.push({ ratioName: '2.240 BC', price: dBC, weight: 0.8 });
                break;
            }
            case 'SHARK': {
                const baseSpan = pointZero ? Math.abs(X.price - pointZero.price) : xa;
                const d0X = isBullish ? X.price - baseSpan * 0.13 : X.price + baseSpan * 0.13; // 1.130 projection
                const dBC = isBullish ? C.price - bc * 1.618 : C.price + bc * 1.618;

                confluences.push({ ratioName: '1.130 0-X', price: d0X, weight: 1.0 });
                confluences.push({ ratioName: '1.618 BC', price: dBC, weight: 0.8 });
                break;
            }
            case 'CYPHER': {
                const dXC = isBullish ? C.price - xc * 0.786 : C.price + xc * 0.786; // 0.786 XC retracement
                const dBC = isBullish ? C.price - bc * 1.414 : C.price + bc * 1.414;

                confluences.push({ ratioName: '0.786 XC', price: dXC, weight: 1.0 });
                confluences.push({ ratioName: '1.414 BC', price: dBC, weight: 0.7 });
                break;
            }
            case 'FIVE_ZERO': {
                const dBC = isBullish ? C.price - bc * 0.50 : C.price + bc * 0.50; // 50% retracement of BC
                confluences.push({ ratioName: '0.500 BC Eq', price: dBC, weight: 1.0 });
                break;
            }
            case 'AB_CD': {
                const dABCD = isBullish ? C.price - ab : C.price + ab;
                const dBC = isBullish ? C.price - bc * 1.272 : C.price + bc * 1.272;

                confluences.push({ ratioName: 'AB=CD Equal Leg', price: dABCD, weight: 1.0 });
                confluences.push({ ratioName: '1.272 BC', price: dBC, weight: 0.8 });
                break;
            }
            case 'THREE_DRIVES': {
                const dDrive = isBullish ? C.price - bc * 1.272 : C.price + bc * 1.272;
                confluences.push({ ratioName: '1.272 Drive Extension', price: dDrive, weight: 1.0 });
                break;
            }
        }

        const prices = confluences.map(c => c.price);
        const min = Math.min(...prices);
        const max = Math.max(...prices);
        const median = prices.reduce((acc, p) => acc + p, 0) / (prices.length || 1);
        const spreadPct = median > 0 ? ((max - min) / median) * 100 : 0;

        let quality: 'SUPER_HIGH' | 'HIGH' | 'MODERATE' = 'MODERATE';
        if (spreadPct <= 1.5) {
            quality = 'SUPER_HIGH';
        } else if (spreadPct <= 3.0) {
            quality = 'HIGH';
        }

        return {
            min,
            max,
            median,
            confluences,
            confluenceSpreadPct: spreadPct,
            quality
        };
    }
}
