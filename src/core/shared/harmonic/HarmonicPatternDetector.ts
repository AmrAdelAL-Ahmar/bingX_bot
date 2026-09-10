import { SwingPoint, HarmonicMatch, HarmonicPatternType, HarmonicDirection, HarmonicRatios } from './types';
import { PRZCalculator } from './PRZCalculator';

export class HarmonicPatternDetector {
    private static TOLERANCE = 0.055; // 5.5% Fibonacci tolerance

    /**
     * Checks if a value is within target +/- tolerance
     */
    private static isNear(val: number, target: number, tol = HarmonicPatternDetector.TOLERANCE): boolean {
        return Math.abs(val - target) <= tol;
    }

    /**
     * Checks if a value is within a range [min, max] with tolerance
     */
    private static inRange(val: number, min: number, max: number, tol = HarmonicPatternDetector.TOLERANCE): boolean {
        return val >= (min - tol) && val <= (max + tol);
    }

    /**
     * Scans swing sequence for all 11 valid harmonic patterns
     */
    static detectPatterns(swings: SwingPoint[], currentPrice: number): HarmonicMatch[] {
        if (!swings || swings.length < 4) return [];

        const matches: HarmonicMatch[] = [];

        // Iterate through consecutive 4-swing or 5-swing sets (X, A, B, C)
        for (let i = 0; i <= swings.length - 4; i++) {
            const X = swings[i];
            const A = swings[i + 1];
            const B = swings[i + 2];
            const C = swings[i + 3];

            // Validate alternating swings: Peak-Valley-Peak-Valley or Valley-Peak-Valley-Peak
            if (X.type === A.type || A.type === B.type || B.type === C.type) continue;

            const isBullish = X.type === 'VALLEY' && A.type === 'PEAK' && B.type === 'VALLEY' && C.type === 'PEAK';
            const isBearish = X.type === 'PEAK' && A.type === 'VALLEY' && B.type === 'PEAK' && C.type === 'VALLEY';

            if (!isBullish && !isBearish) continue;

            const direction: HarmonicDirection = isBullish ? 'BULLISH' : 'BEARISH';

            // Calculate legs
            const XA = Math.abs(A.price - X.price);
            const AB = Math.abs(B.price - A.price);
            const BC = Math.abs(C.price - B.price);
            const XC = Math.abs(C.price - X.price);

            if (XA === 0 || AB === 0 || BC === 0) continue;

            const ab_xa = AB / XA;
            const bc_ab = BC / AB;
            const xc_xa = XC / XA;

            // Current hypothetical D is at currentPrice (or last swing if 5 swings exist)
            const CD = Math.abs(currentPrice - C.price);
            const xd_xa = Math.abs(currentPrice - X.price) / XA;
            const cd_bc = CD / BC;
            const cd_xc = XC > 0 ? CD / XC : 0;

            const ratios: HarmonicRatios = {
                AB_XA: ab_xa,
                BC_AB: bc_ab,
                CD_BC: cd_bc,
                XD_XA: xd_xa,
                XC_XA: xc_xa,
                CD_XC: cd_xc
            };

            // Evaluate 11 patterns
            const candidates: { pattern: HarmonicPatternType; score: number }[] = [];

            // 1. Gartley: B = 0.618 XA, D = 0.786 XA
            if (this.isNear(ab_xa, 0.618) && this.inRange(bc_ab, 0.382, 0.886)) {
                const score = 100 - (Math.abs(ab_xa - 0.618) + Math.abs(xd_xa - 0.786)) * 100;
                candidates.push({ pattern: 'GARTLEY', score: Math.max(60, Math.min(98, score)) });
            }

            // 2. Bat: B = 0.382 to 0.500 XA, D = 0.886 XA
            if (this.inRange(ab_xa, 0.382, 0.500) && this.inRange(bc_ab, 0.382, 0.886)) {
                const score = 100 - Math.abs(xd_xa - 0.886) * 100;
                candidates.push({ pattern: 'BAT', score: Math.max(60, Math.min(97, score)) });
            }

            // 3. Alt Bat: B = 0.382 XA, D = 1.130 XA
            if (this.isNear(ab_xa, 0.382) && this.inRange(bc_ab, 0.382, 0.886)) {
                const score = 100 - Math.abs(xd_xa - 1.130) * 100;
                candidates.push({ pattern: 'ALT_BAT', score: Math.max(60, Math.min(95, score)) });
            }

            // 4. Butterfly: B = 0.786 XA, D = 1.272 or 1.618 XA
            if (this.isNear(ab_xa, 0.786) && this.inRange(bc_ab, 0.382, 0.886)) {
                const targetD = Math.abs(xd_xa - 1.272) < Math.abs(xd_xa - 1.618) ? 1.272 : 1.618;
                const score = 100 - (Math.abs(ab_xa - 0.786) + Math.abs(xd_xa - targetD)) * 100;
                candidates.push({ pattern: 'BUTTERFLY', score: Math.max(60, Math.min(96, score)) });
            }

            // 5. Crab: B = 0.382 to 0.618 XA, D = 1.618 XA
            if (this.inRange(ab_xa, 0.382, 0.618) && this.inRange(bc_ab, 0.382, 0.886)) {
                const score = 100 - Math.abs(xd_xa - 1.618) * 100;
                candidates.push({ pattern: 'CRAB', score: Math.max(60, Math.min(95, score)) });
            }

            // 6. Deep Crab: B = 0.886 XA, D = 1.618 XA
            if (this.isNear(ab_xa, 0.886) && this.inRange(bc_ab, 0.382, 0.886)) {
                const score = 100 - (Math.abs(ab_xa - 0.886) + Math.abs(xd_xa - 1.618)) * 100;
                candidates.push({ pattern: 'DEEP_CRAB', score: Math.max(60, Math.min(96, score)) });
            }

            // 7. Shark: B = 1.130 to 1.618 XA, C = 1.618 to 2.240 AB
            if (this.inRange(ab_xa, 1.130, 1.618) && this.inRange(bc_ab, 1.618, 2.240)) {
                const score = 100 - Math.abs(ab_xa - 1.13) * 50;
                candidates.push({ pattern: 'SHARK', score: Math.max(60, Math.min(94, score)) });
            }

            // 8. Cypher: B = 0.382 to 0.618 XA, C = 1.272 to 1.414 XA, D = 0.786 XC
            if (this.inRange(ab_xa, 0.382, 0.618) && this.inRange(xc_xa, 1.272, 1.414)) {
                const score = 100 - Math.abs(cd_xc - 0.786) * 100;
                candidates.push({ pattern: 'CYPHER', score: Math.max(60, Math.min(95, score)) });
            }

            // 9. 5-0: B = 1.130 to 1.618 XA, C = 1.618 to 2.240 AB, D = 0.500 BC
            if (this.inRange(ab_xa, 1.130, 1.618) && this.inRange(cd_bc, 0.45, 0.55)) {
                const score = 100 - Math.abs(cd_bc - 0.50) * 100;
                candidates.push({ pattern: 'FIVE_ZERO', score: Math.max(60, Math.min(93, score)) });
            }

            // 10. Classic AB=CD
            if (this.inRange(bc_ab, 0.618, 0.786) && this.isNear(AB, CD, AB * 0.15)) {
                const score = 100 - Math.abs(AB - CD) / AB * 100;
                candidates.push({ pattern: 'AB_CD', score: Math.max(60, Math.min(95, score)) });
            }

            // 11. Three Drives
            if (this.inRange(bc_ab, 0.618, 0.786) && this.inRange(cd_bc, 1.272, 1.618)) {
                candidates.push({ pattern: 'THREE_DRIVES', score: 88 });
            }

            // Process candidates
            for (const candidate of candidates) {
                const prz = PRZCalculator.calculatePRZ(candidate.pattern, direction, X, A, B, C);
                
                // Determine status based on current price relative to PRZ
                const inPRZ = currentPrice >= prz.min * 0.995 && currentPrice <= prz.max * 1.005;
                const status = inPRZ ? 'IN_PRZ' : 'POTENTIAL';

                // Stop loss & targets
                // Stop Loss: beyond PRZ or beyond X with buffer
                const przSpan = Math.abs(prz.max - prz.min);
                const stopBuffer = Math.max(przSpan * 0.8, prz.median * 0.008);
                const stopLoss = isBullish ? (prz.min - stopBuffer) : (prz.max + stopBuffer);

                // Targets: 38.2% CD, 61.8% CD, Point C
                const cdSpan = Math.abs(C.price - prz.median);
                const tp1 = isBullish ? prz.median + cdSpan * 0.382 : prz.median - cdSpan * 0.382;
                const tp2 = isBullish ? prz.median + cdSpan * 0.618 : prz.median - cdSpan * 0.618;
                const tp3 = C.price;
                const tp4 = isBullish ? prz.median + cdSpan * 1.272 : prz.median - cdSpan * 1.272;

                const risk = Math.abs(prz.median - stopLoss);
                const reward = Math.abs(tp2 - prz.median);
                const rrr = risk > 0 ? Number((reward / risk).toFixed(2)) : 1.5;

                matches.push({
                    pattern: candidate.pattern,
                    direction,
                    points: { X, A, B, C },
                    ratios,
                    prz,
                    currentPrice,
                    score: candidate.score,
                    status,
                    targets: { tp1, tp2, tp3, tp4 },
                    stopLoss,
                    riskRewardRatio: rrr
                });
            }
        }

        // Return sorted by highest score and proximity to PRZ
        return matches.sort((a, b) => {
            if (a.status === 'IN_PRZ' && b.status !== 'IN_PRZ') return -1;
            if (b.status === 'IN_PRZ' && a.status !== 'IN_PRZ') return 1;
            return b.score - a.score;
        });
    }
}
