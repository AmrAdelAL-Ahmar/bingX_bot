import dotenv from 'dotenv';
dotenv.config();
import mongoose from 'mongoose';
import User from '../models/User';

async function main() {
    await mongoose.connect(process.env.MONGODB_URI || '');
    console.log('Connected to MongoDB');

    const updateRes = await User.updateOne(
        { isActive: true },
        {
            $set: {
                'autonomousSettings.antiPeakGuardEnabled': true,
                'autonomousSettings.frontRunTpEnabled': true,
                'autonomousSettings.maxConcurrentTrades': 10,
                'autonomousSettings.autoBreakEvenEnabled': true,
                'autonomousSettings.turboSlPercentage': 0.9,
                'autonomousSettings.allowedDirection': 'BOTH',
                'autoBreakEven': true
            }
        }
    );

    console.log('Update result:', updateRes);

    const user = await User.findOne({ isActive: true }).lean();
    console.log('\nUpdated User autonomousSettings:');
    console.log(JSON.stringify(user?.autonomousSettings, null, 2));

    await mongoose.disconnect();
}

main().catch(console.error);
