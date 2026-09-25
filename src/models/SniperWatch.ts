import mongoose, { Schema, Document, Types } from 'mongoose';
import { SniperReport } from '../services/sniper/ISniperEngine';

// ─── Interface ─────────────────────────────────────────────────────────────────

export interface ISniperWatch extends Document {
    userId: Types.ObjectId;
    telegramId: string;              // للإشعار المباشر
    symbol: string;                  // 'BTC/USDT:USDT'
    symbolShort: string;             // 'BTC'
    engineId: string;                // 'V7-SWING' | 'V7-SCALP'
    status: 'ACTIVE' | 'TRIGGERED' | 'EXPIRED' | 'CANCELLED';
    autoExecute: boolean;            // تنفيذ تلقائي عند الزناد؟
    notifyOnce: boolean;             // إشعار مرة واحدة فقط؟
    expiresAt: Date;                 // وقت انتهاء الاقتناص
    lastReport?: SniperReport;       // آخر تقرير تم توليده
    lastNotifiedAt?: Date;           // آخر إشعار أُرسل
    notificationCount: number;       // عدد الإشعارات المُرسَلة
    createdAt: Date;
}

// ─── Schema ────────────────────────────────────────────────────────────────────

const SniperWatchSchema: Schema = new Schema({
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    telegramId: { type: String, required: true },
    symbol: { type: String, required: true },
    symbolShort: { type: String, required: true },
    engineId: { type: String, required: true },
    status: {
        type: String,
        enum: ['ACTIVE', 'TRIGGERED', 'EXPIRED', 'CANCELLED'],
        default: 'ACTIVE'
    },
    autoExecute: { type: Boolean, default: false },
    notifyOnce: { type: Boolean, default: false },
    expiresAt: { type: Date, required: true },
    lastReport: { type: Schema.Types.Mixed, default: null },
    lastNotifiedAt: { type: Date, default: null },
    notificationCount: { type: Number, default: 0 },
    createdAt: { type: Date, default: Date.now },
});

// Index لاستعلام سريع على الحالة النشطة
SniperWatchSchema.index({ status: 1, expiresAt: 1 });
SniperWatchSchema.index({ userId: 1, status: 1 });

export default mongoose.model<ISniperWatch>('SniperWatch', SniperWatchSchema);
