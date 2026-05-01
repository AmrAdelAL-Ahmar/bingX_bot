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
});

export default mongoose.model<IUser>('User', UserSchema);
