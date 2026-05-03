import mongoose, { Schema, Document } from 'mongoose';

export interface ITrade extends Document {
    userId: mongoose.Types.ObjectId;
    symbol: string;
    direction: 'LONG' | 'SHORT';
    entryPrice: number;
    stopLoss: number;
    targets: {
        price: number;
        hit: boolean;
    }[];
    currentStatus: 'PENDING' | 'OPEN' | 'TP1_HIT' | 'TP2_HIT' | 'TP3_HIT' | 'CLOSED_PROFIT' | 'CLOSED_LOSS' | 'CANCELLED';
    amount: number; // Position size in USDT
    leverage: number;
    pnl: number;
    isBreakEvenSet?: boolean;
    binanceOrderId?: string;
    bingxOrderId?: string;
    entryTime: Date;
    closeTime?: Date;
    sourceChatId?: string;
    logs: string[];
    // Warning tracking
    slWarningSent?: boolean;
    triggeredTpWarnings?: number[]; // e.g. [70, 90] means those thresholds were already notified
}

const TradeSchema: Schema = new Schema({
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    symbol: { type: String, required: true },
    direction: { type: String, enum: ['LONG', 'SHORT'], required: true },
    entryPrice: { type: Number, required: true },
    stopLoss: { type: Number, required: true },
    targets: [{
        price: { type: Number, required: true },
        hit: { type: Boolean, default: false }
    }],
    currentStatus: {
        type: String,
        enum: ['PENDING', 'OPEN', 'TP1_HIT', 'TP2_HIT', 'TP3_HIT', 'CLOSED_PROFIT', 'CLOSED_LOSS', 'CANCELLED'],
        default: 'PENDING'
    },
    amount: { type: Number, required: true },
    leverage: { type: Number, default: 10 },
    pnl: { type: Number, default: 0 },
    isBreakEvenSet: { type: Boolean, default: false },
    binanceOrderId: { type: String },
    bingxOrderId: { type: String },
    entryTime: { type: Date, default: Date.now },
    closeTime: { type: Date },
    sourceChatId: { type: String },
    logs: [{ type: String }],
    // Warning tracking
    slWarningSent: { type: Boolean, default: false },
    triggeredTpWarnings: { type: [Number], default: [] },
});

export default mongoose.model<ITrade>('Trade', TradeSchema);
