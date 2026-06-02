import mongoose, { Schema, Document } from 'mongoose';

export interface IUnifiedSession extends Document {
    telegramId: string;
    type: 'analysis' | 'sniper';
    symbols: string[];
    selectedEngines: string[];
    cachedResults?: {
        symbol: string;
        engineId: string;
        reportText: string;
        signal?: {
            direction: 'LONG' | 'SHORT' | 'NONE';
            entry: number;
            tp: number;
            tp2?: number;
            sl: number;
            precision: number;
        }
    }[];
    createdAt: Date;
}

const UnifiedSessionSchema = new Schema({
    telegramId: { type: String, required: true },
    type: { type: String, enum: ['analysis', 'sniper'], required: true },
    symbols: { type: [String], required: true },
    selectedEngines: { type: [String], required: true },
    cachedResults: [{
        symbol: { type: String },
        engineId: { type: String },
        reportText: { type: String },
        signal: {
            direction: { type: String, enum: ['LONG', 'SHORT', 'NONE'] },
            entry: { type: Number },
            tp: { type: Number },
            tp2: { type: Number },
            sl: { type: Number },
            precision: { type: Number }
        }
    }],
    createdAt: { type: Date, default: Date.now, expires: 86400 } // Auto expire session in 24 hours
});

export default mongoose.model<IUnifiedSession>('UnifiedSession', UnifiedSessionSchema);
