export interface OHLCV {
    timestamp: number;
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
}

export interface CandleData {
    closes: number[];
    highs: number[];
    lows: number[];
    volumes: number[];
    last: OHLCV;
    prev: OHLCV;
    all: OHLCV[];
}

export interface IndicatorData {
    macd: { macd: number, signal: number, histogram: number };
    bb: { upper: number, lower: number, middle: number };
    stochRsi: number;
    cci: number;
    williamsR: number;
    mfi?: number;
}

export interface TechnicalLevels {
    pivot: number;
    s1: number;
    s2: number;
    r1: number;
    r2: number;
    fib382: number;
    fib618: number;
    fibTarget: number;
    ma99: number;
    ma20: number;
    ma50: number;
    ma200: number;
    ma7: number;
    lastSwingHigh: number;
    lastSwingLow: number;
}

export interface IndicatorSentiment {
    name: string;
    value: string | number;
    status: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
    description: string;
    timeframe?: string;
}

export interface AnalysisDetails {
    indicators: IndicatorData;
    sentiments: IndicatorSentiment[];
    rsi: number;
    atr: number;
    levels: TechnicalLevels;
    structure: string;
    timeframe: string;
    isBullishTrend: boolean;
}

export interface TradeRecommendation {
    status: string;
    type: 'LONG' | 'SHORT' | 'NONE';
    entry: number;
    tp: number;
    tp2?: number;
    sl: number;
    timeEstimate: number;
    winRate: number;
    reverseProb: number;
    rejectionReason?: string;
    signalReason?: string;
    confidenceScore?: number;
}

export interface MatrixResult {
    score: number;
    percentage: number;
    decision: string;
    details: string;
}

export interface PredictionResult {
    predictedPrice: number;
    trendDirection: 'UP' | 'DOWN';
    slope: number;
    confidence: number;
}

export interface AnalysisResult {
    symbol: string;
    currentPrice: number;
    pricePrecision: number;
    isUptrend: boolean;
    matrix: MatrixResult;
    isAboveVWAP: boolean;
    prediction?: PredictionResult;
    scalp: TradeRecommendation & AnalysisDetails;
    swing: TradeRecommendation & AnalysisDetails;
    allTimeframes: Record<string, AnalysisDetails>;
    options: { quickTF: string, longTF: string, limit: number };
    sniper: {
        isStochSynced: boolean;
        isFullBreakout: boolean;
        isAboveGolden: boolean;
    };
}
