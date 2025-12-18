import ccxt from 'ccxt';
import dotenv from 'dotenv';
dotenv.config();

const debugBalance = async () => {
    const exchange = new ccxt.bingx({
        apiKey: process.env.BINGX_API_KEY,
        secret: process.env.BINGX_SECRET_KEY,
        options: { defaultType: 'swap' },
    });

    try {
        console.log('Fetching balance with { type: "swap" }...');
        const balance: any = await exchange.fetchBalance({ type: 'swap' });
        console.log('Full Balance structure:', JSON.stringify(balance, null, 2));
        console.log('USDT Total:', balance.total['USDT']);
        console.log('USDT Free:', balance.free['USDT']);
    } catch (e: any) {
        console.error('Error:', e.message);
    }
};

debugBalance();
