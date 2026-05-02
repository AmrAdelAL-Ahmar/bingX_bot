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
});

export default mongoose.model<IUser>('User', UserSchema);
