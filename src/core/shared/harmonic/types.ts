export type HarmonicPatternType = 
    | 'GARTLEY'
    | 'BAT'
    | 'ALT_BAT'
    | 'BUTTERFLY'
    | 'CRAB'
    | 'DEEP_CRAB'
    | 'SHARK'
    | 'CYPHER'
    | 'FIVE_ZERO'
    | 'AB_CD'
    | 'THREE_DRIVES';

export type HarmonicDirection = 'BULLISH' | 'BEARISH';

export interface SwingPoint {
    index: number;
    timestamp: number;
    price: number;
    type: 'PEAK' | 'VALLEY';
}

export interface HarmonicPoints {
    X: SwingPoint;
    A: SwingPoint;
    B: SwingPoint;
    C: SwingPoint;
    D?: SwingPoint; // D is either reached or projected in PRZ
}

export interface HarmonicRatios {
    AB_XA: number;  // Retracement of B relative to XA
    BC_AB: number;  // Retracement/Extension of C relative to AB
    CD_BC: number;  // Extension of D relative to BC
    XD_XA: number;  // Total retracement/extension of D relative to XA
    XC_XA?: number; // Used in Cypher (C relative to XA)
    CD_XC?: number; // Used in Cypher (D relative to XC)
    D_0X?: number;  // Used in Shark
}

export interface FibConfluenceLevel {
    ratioName: string;
    price: number;
    weight: number;
}

export interface PRZZone {
    min: number;
    max: number;
    median: number;
    confluences: FibConfluenceLevel[];
    confluenceSpreadPct: number;
    quality: 'SUPER_HIGH' | 'HIGH' | 'MODERATE';
}

export interface HarmonicMatch {
    pattern: HarmonicPatternType;
    direction: HarmonicDirection;
    points: HarmonicPoints;
    ratios: HarmonicRatios;
    prz: PRZZone;
    currentPrice: number;
    score: number; // 0 to 100 quality score
    status: 'POTENTIAL' | 'IN_PRZ' | 'CONFIRMED' | 'INVALIDATED';
    confirmation?: {
        rsiDivergence: boolean;
        rsiValue: number;
        reversalCandle: string;
        volumeAbsorption: boolean;
        volumeRatio: number;
    };
    targets: {
        tp1: number; // 38.2% CD
        tp2: number; // 61.8% CD
        tp3: number; // 100% (Point C)
        tp4?: number; // 1.272 / 1.618 Extension
    };
    stopLoss: number;
    riskRewardRatio: number;
}
