import ccxt from 'ccxt';
import dotenv from 'dotenv';
dotenv.config();

const debug = async () => {
    const exchange = new ccxt.bingx({
        apiKey: process.env.BINGX_API_KEY,
        secret: process.env.BINGX_SECRET_KEY,
        options: { defaultType: 'swap' },
        enableRateLimit: true,
    });

    try {
        await exchange.loadMarkets();
        const symbol = 'PIPPIN/USDT:USDT';
        const market = exchange.market(symbol);
        console.log(`--- Market Info for ${symbol} ---`);
        console.log(JSON.stringify(market.limits, null, 2));
    } catch (e: any) {
        console.log('❌ Failed to fetch market info:', e.message);
    }
};

debug();
