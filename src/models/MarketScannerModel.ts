import mongoose, { Schema, Document } from 'mongoose';

export interface IMarketScanner extends Document {
    symbol: string;
    marketType: string;
    volume24h: number;
    structure1D: string;
    structure4H: string;
    atr14_1D: number;
    atrPercentage: number;
    finalScore: number;
    lastUpdated: Date;
}

const MarketScannerSchema: Schema = new Schema({
    symbol: { type: String, required: true, unique: true },
    marketType: { type: String, default: 'CRYPTO' },
    volume24h: { type: Number, default: 0 },
    structure1D: { type: String, default: 'CHOPPY' },
    structure4H: { type: String, default: 'CHOPPY' },
    atr14_1D: { type: Number, default: 0 },
    atrPercentage: { type: Number, default: 0 },
    finalScore: { type: Number, default: 0 },
    lastUpdated: { type: Date, default: Date.now }
});

export default mongoose.model<IMarketScanner>('MarketScanner', MarketScannerSchema);
