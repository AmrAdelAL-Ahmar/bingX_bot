import mongoose, { Schema, Document } from 'mongoose';

export interface IUser extends Document {
    telegramId: string;
    username?: string;
    bingxApiKey?: string;
    bingxSecretKey?: string;
    riskPercentage: number; // e.g., 5 for 5%
    enforceMaxSlLoss?: boolean;
    botState?: string;
    isActive: boolean;
    createdAt: Date;
    // Warning settings
    slWarningEnabled: boolean;
    tpWarningEnabled: boolean;
    tpWarningThresholds: number[]; // e.g., [70, 90]
    // Order execution mode: 'market' (default) or 'limit'
    orderMode?: 'market' | 'limit';
    // Strict Capital Protection Risk (Max SL Loss as % of balance)
    maxSlRiskPercentage?: number; 
    // Leverage Settings
    leverageMode: 'default' | 'fixed';
    fixedLeverageValue: number;
    // Volatility Stop Loss Settings
    volatilitySlEnabled: boolean;
    volatilitySlPercentage: number;
    // HITLAR Mode Settings
    hitlarModeEnabled: boolean;
    hitlarSettings: {
        riskPercentage: number;
        leverage: number;
        volatilitySlPercentage: number;
        capitalProtectionEnabled: boolean;
        orderMode: 'limit' | 'market';
    };
    // --- New Trading Strategy Settings ---
    tpExecutionMode: 'single' | 'multiple'; // single = TP1 only, multiple = all targets
    autoBreakEven: boolean; // Move SL to Entry after TP1
    tpSplitMode: 'auto' | 'manual'; // auto = equal split, manual = use tpProfitSplits
    tpProfitSplits: number[]; // e.g., [50, 50] or [100]
    errorMitigationEnabled: boolean; // Toggle for auto-scaling notional and leverage fallback
    // Analysis Settings
    analysisSettings: {
        scalpTF: string;
        swingTF: string;
        candleLimit: number;
        rsiThreshold: number;
        antiRepaintingEnabled?: boolean;
    };
    // Backtest Settings
    backtestSettings: {
        interval: string;
        initialCapital: number;
        marginMode: 'ISOLATED' | 'CROSS';
        leverage: number;
        riskSizingEnabled: boolean;
        riskPercentage: number;
        maxSlCapEnabled: boolean;
        maxSlPercentage: number;
        fullReportEnabled: boolean;
        alignToStartOfDay?: boolean;
    };
    sniperSettings?: {
        autoExecute: boolean;
        notifyOnce: boolean;
    };
    radarSettings?: {
        wickSweepAlert: boolean;
        reversalAlert: boolean;
        trailingEnabled: boolean;
        notifyOnce: boolean;
    };
    pickerSettings?: {
        engine: 'multicriteria' | 'ccxt';
        limit: number;
    };
    paperInitialBalance?: number;
    autonomousSettings?: {
        allowedDirection: 'BOTH' | 'LONG_ONLY' | 'SHORT_ONLY';
        postTpCooldownMinutes: number;
        turboSlPercentage: number;
        breakEvenTriggerPct: number;
        microTpPercentage: number;
        tradeStyle?: 'HYBRID' | 'SCALP' | 'SWING' | 'SCALP_TURBO' | 'WHALE_SURGE';
        positionMarginPct?: number;
        maxConcurrentTrades?: number;
        leverageMode?: 'DYNAMIC' | 'FIXED';
        fixedLeverageValue?: number;
    };
}

const UserSchema: Schema = new Schema({
    telegramId: { type: String, required: true, unique: true },
    username: { type: String },
    bingxApiKey: { type: String },
    bingxSecretKey: { type: String },
    riskPercentage: { type: Number, default: 3 }, // Default 3% risk
    enforceMaxSlLoss: { type: Boolean, default: null },
    botState: { type: String, default: null },
    isActive: { type: Boolean, default: true },
    paperInitialBalance: { type: Number, default: 1000 },
    createdAt: { type: Date, default: Date.now },
    // Warning settings
    slWarningEnabled: { type: Boolean, default: true },
    tpWarningEnabled: { type: Boolean, default: true },
    tpWarningThresholds: { type: [Number], default: [70, 90] },
    // Order execution mode
    orderMode: { type: String, enum: ['market', 'limit'], default: 'market' },
    // Strict Capital Protection Risk
    maxSlRiskPercentage: { type: Number, default: 6 },
    // Leverage Settings
    leverageMode: { type: String, enum: ['default', 'fixed'], default: 'default' },
    fixedLeverageValue: { type: Number, default: 10 },
    // Volatility Stop Loss Settings
    volatilitySlEnabled: { type: Boolean, default: false },
    volatilitySlPercentage: { type: Number, default: 5 },
    // HITLAR Mode Settings
    hitlarModeEnabled: { type: Boolean, default: false },
    hitlarSettings: {
        riskPercentage: { type: Number, default: 3 },
        leverage: { type: Number, default: 20 },
        volatilitySlPercentage: { type: Number, default: 5 },
        capitalProtectionEnabled: { type: Boolean, default: false },
        orderMode: { type: String, enum: ['limit', 'market'], default: 'limit' },
    },
    // --- New Trading Strategy Settings ---
    tpExecutionMode: { type: String, enum: ['single', 'multiple'], default: 'multiple' },
    autoBreakEven: { type: Boolean, default: true },
    tpSplitMode: { type: String, enum: ['auto', 'manual'], default: 'auto' },
    tpProfitSplits: { type: [Number], default: [50, 50] },
    errorMitigationEnabled: { type: Boolean, default: true },
    // Sniper settings
    sniperSettings: {
        autoExecute: { type: Boolean, default: false },
        notifyOnce: { type: Boolean, default: false }
    },
    // Default Radar settings
    radarSettings: {
        wickSweepAlert: { type: Boolean, default: true },
        reversalAlert: { type: Boolean, default: true },
        trailingEnabled: { type: Boolean, default: false },
        notifyOnce: { type: Boolean, default: true }
    },
    analysisSettings: {
        scalpTF: { type: String, default: '5m' },
        swingTF: { type: String, default: '1h' },
        candleLimit: { type: Number, default: 200 },
        rsiThreshold: { type: Number, default: 30 },
        antiRepaintingEnabled: { type: Boolean, default: true }
    },
    backtestSettings: {
        interval: { type: String, default: '15m' },
        initialCapital: { type: Number, default: 1000 },
        marginMode: { type: String, enum: ['ISOLATED', 'CROSS'], default: 'ISOLATED' },
        leverage: { type: Number, default: 10 },
        riskSizingEnabled: { type: Boolean, default: false },
        riskPercentage: { type: Number, default: 3 },
        maxSlCapEnabled: { type: Boolean, default: false },
        maxSlPercentage: { type: Number, default: 5 },
        fullReportEnabled: { type: Boolean, default: false },
        alignToStartOfDay: { type: Boolean, default: true }
    },
    pickerSettings: {
        engine: { type: String, enum: ['multicriteria', 'ccxt'], default: 'multicriteria' },
        limit: { type: Number, default: 20 }
    },
    autonomousSettings: {
        allowedDirection: { type: String, enum: ['BOTH', 'LONG_ONLY', 'SHORT_ONLY'], default: 'BOTH' },
        postTpCooldownMinutes: { type: Number, default: 30 },
        turboSlPercentage: { type: Number, default: 0.9 },
        breakEvenTriggerPct: { type: Number, default: 0.35 },
        microTpPercentage: { type: Number, default: 0.55 },
        tradeStyle: { type: String, enum: ['HYBRID', 'SCALP', 'SWING', 'SCALP_TURBO', 'WHALE_SURGE'], default: 'HYBRID' },
        positionMarginPct: { type: Number, default: 3 },
        maxConcurrentTrades: { type: Number, default: 3 },
        leverageMode: { type: String, enum: ['DYNAMIC', 'FIXED'], default: 'DYNAMIC' },
        fixedLeverageValue: { type: Number, default: 20 }
    }
});

export default mongoose.model<IUser>('User', UserSchema);
