import mongoose, { Schema, Document, Types } from 'mongoose';

// ─── Radar Event Types ─────────────────────────────────────────────────────────

export type RadarEventType =
    | 'WICK_SWEEP'       // ذيل اخترق SL وارتد
    | 'REVERSAL_WARNING' // CHoCH عكسي + Divergence
    | 'TRAILING_UPDATE'  // تحديث Trailing Stop
    | 'CUSTOM';          // أحداث مخصصة مستقبلاً

// ─── Interface ─────────────────────────────────────────────────────────────────

export interface ITradeRadar extends Document {
    tradeId: Types.ObjectId;
    userId: Types.ObjectId;
    telegramId: string;
    symbol: string;
    direction: 'LONG' | 'SHORT';
    entryPrice: number;
    currentSL: number;           // وقف الخسارة الحالي (يُحدَّث مع Trailing)
    isActive: boolean;
    settings: {
        notifyOnce: boolean;       // تنبيه مرة واحدة لكل نوع حدث؟
        trailingEnabled: boolean;  // Trailing Stop تلقائي؟
        wickSweepAlert: boolean;   // تنبيه اختراق الذيل؟
        reversalAlert: boolean;    // تنبيه خطر الانعكاس (CHoCH + Div)؟
    };
    // سجل الأحداث المُرسَلة (لتجنب التكرار عند notifyOnce)
    sentEvents: {
        type: RadarEventType;
        sentAt: Date;
        details: string;
    }[];
    lastCheckedAt?: Date;
    createdAt: Date;
}

// ─── Schema ────────────────────────────────────────────────────────────────────

const TradeRadarSchema: Schema = new Schema({
    tradeId: { type: Schema.Types.ObjectId, ref: 'Trade', required: true, unique: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    telegramId: { type: String, required: true },
    symbol: { type: String, required: true },
    direction: { type: String, enum: ['LONG', 'SHORT'], required: true },
    entryPrice: { type: Number, required: true },
    currentSL: { type: Number, required: true },
    isActive: { type: Boolean, default: true },
    settings: {
        notifyOnce: { type: Boolean, default: true },
        trailingEnabled: { type: Boolean, default: false },
        wickSweepAlert: { type: Boolean, default: true },
        reversalAlert: { type: Boolean, default: true },
    },
    sentEvents: [{
        type: { type: String, enum: ['WICK_SWEEP', 'REVERSAL_WARNING', 'TRAILING_UPDATE', 'CUSTOM'] },
        sentAt: { type: Date },
        details: { type: String }
    }],
    lastCheckedAt: { type: Date },
    createdAt: { type: Date, default: Date.now },
});

TradeRadarSchema.index({ isActive: 1 });
TradeRadarSchema.index({ tradeId: 1 }, { unique: true });

export default mongoose.model<ITradeRadar>('TradeRadar', TradeRadarSchema);
