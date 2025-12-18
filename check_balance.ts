import ccxt from 'ccxt';
import dotenv from 'dotenv';
dotenv.config();

const check = async () => {
    const exchange = new ccxt.bingx({
        apiKey: process.env.BINGX_API_KEY,
        secret: process.env.BINGX_SECRET_KEY,
        options: { defaultType: 'swap' }, // We are using SWAP (Perpetual Futures)
    });

    try {
        console.log('--- Checking Balances ---');
        console.log('Fetching Swap (Perpetual Futures) Balance...');
        const balance = await exchange.fetchBalance({ type: 'swap' });

        // Log the raw 'info' if needed, but 'total' is usually normalized
        // console.log(JSON.stringify(balance, null, 2));

        const usdt = balance['USDT']?.total || 0;
        console.log(`\n💰 USDT Balance (Perpetual Futures): ${usdt}`);

        if (!usdt || usdt === 0) {
            console.log('⚠️  It looks like your Perpetual Futures wallet is empty.');
            console.log('👉 Please Transfer USDT from "Fund Account" or "Standard Futures" to "Perpetual Futures".');
        } else {
            console.log('✅ Balance detected. You are ready to trade!');
        }

    } catch (e: any) {
        console.error('❌ Error fetching balance:', e.message);
    }
};

check();
