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

    const symbol = 'BTC/USDT:USDT';
    const leverage = 5;

    console.log('--- Debugging setLeverage ---');

    // Test 1: Standard CCXT way (might default to current mode)
    try {
        console.log('Test 1: setLeverage(5, symbol)');
        await exchange.setLeverage(leverage, symbol);
        console.log('✅ Test 1 Passed');
    } catch (e: any) {
        console.log('❌ Test 1 Failed:', e.message);
    }

    // Test 2: Explicit side 'BOTH'
    try {
        console.log("Test 2: setLeverage(5, symbol, { side: 'BOTH' })");
        await exchange.setLeverage(leverage, symbol, { side: 'BOTH' });
        console.log('✅ Test 2 Passed');
    } catch (e: any) {
        console.log('❌ Test 2 Failed:', e.message);
    }

    // Test 3: Explicit positionSide 'BOTH'
    try {
        console.log("Test 3: setLeverage(5, symbol, { positionSide: 'BOTH' })");
        await exchange.setLeverage(leverage, symbol, { positionSide: 'BOTH' });
        console.log('✅ Test 3 Passed');
    } catch (e: any) {
        console.log('❌ Test 3 Failed:', e.message);
    }

    // Test 4: Explicit LONG (Hedge mode check)
    try {
        console.log("Test 4: setLeverage(5, symbol, { side: 'LONG' })");
        await exchange.setLeverage(leverage, symbol, { side: 'LONG' });
        console.log('✅ Test 4 Passed');
    } catch (e: any) {
        console.log('❌ Test 4 Failed:', e.message);
    }

    // Test 5: Standard CCXT documentation parameters (sometimes uses 'buy'/'sell' mapped to LONG/SHORT)
    try {
        // Some CCXT implementations map params
        console.log("Test 5: setLeverage(5, symbol, { marginMode: 'isolated' })");
        await exchange.setLeverage(leverage, symbol, { marginMode: 'isolated' });
        console.log('✅ Test 5 Passed');
    } catch (e: any) {
        console.log('❌ Test 5 Failed:', e.message);
    }
};

debug();
