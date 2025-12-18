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

    const symbol = 'BTC/USDT:USDT'; // Use a standard pair for testing
    const side = 'buy';
    const amount = 0.0002; // Small amount of BTC
    const price = undefined;

    console.log('--- Debugging Order Creation ---');

    // Test 1: Simple Market Order (No SL/TP)
    try {
        console.log('Test 1: Market Order (No SL/TP)');
        const order = await exchange.createOrder(symbol, 'market', side, amount, price, {
            positionSide: 'LONG'
        });
        console.log('✅ Test 1 Passed:', order.id);
    } catch (e: any) {
        console.log('❌ Test 1 Failed:', e.message);
    }

    // Test 2: Market Order with SL/TP in one call
    try {
        console.log('\nTest 2: Market Order with SL/TP');
        // Get current price
        const ticker = await exchange.fetchTicker(symbol);
        const currentPrice = ticker.last || 0;

        if (currentPrice === 0) throw new Error('Could not fetch price');

        const sl = currentPrice * 0.95;
        const tp = currentPrice * 1.05;

        console.log(`Current Price: ${currentPrice}, SL: ${sl}, TP: ${tp}`);

        const order = await exchange.createOrder(symbol, 'market', side, amount, undefined, {
            positionSide: 'LONG',
            stopLoss: sl.toString(),
            takeProfit: tp.toString()
        });
        console.log('✅ Test 2 Passed:', order.id);
    } catch (e: any) {
        console.log('❌ Test 2 Failed:', e.message);
    }
};

debug();
