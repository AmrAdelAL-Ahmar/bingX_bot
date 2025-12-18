import ccxt from 'ccxt';
import dotenv from 'dotenv';
dotenv.config();

const testKeys = async () => {
    const exchange = new ccxt.bingx({
        apiKey: process.env.BINGX_API_KEY,
        secret: process.env.BINGX_SECRET_KEY,
        options: { defaultType: 'swap' },
        enableRateLimit: true,
    });

    const symbol = 'BTC/USDT:USDT';
    const amount = 0.0002;

    await exchange.loadMarkets();
    const ticker = await exchange.fetchTicker(symbol);
    const price = ticker.last || 0;
    const sl = price * 0.98;
    const tp = price * 1.02;

    const combinations = [
        { name: 'CCXT Unified', params: { stopLossPrice: sl, takeProfitPrice: tp } },
        { name: 'Raw stopLoss/takeProfit', params: { stopLoss: sl, takeProfit: tp } },
        { name: 'Raw slPrice/tpPrice', params: { slPrice: sl, tpPrice: tp } },
        { name: 'Raw triggerPrice', params: { slTriggerPrice: sl, tpTriggerPrice: tp } }
    ];

    for (const combo of combinations) {
        console.log(`\nTesting: ${combo.name}`);
        try {
            const order = await exchange.createOrder(symbol, 'market', 'buy', amount, undefined, {
                positionSide: 'LONG',
                ...combo.params
            });
            console.log(`✅ Success! Order ID: ${order.id}`);
            console.log('Order Info SL/TP:', {
                sl: order.info.stopLoss,
                tp: order.info.takeProfit,
                slTrig: order.info.slTriggerPrice,
                tpTrig: order.info.tpTriggerPrice
            });

            // Clean up: Close the position
            console.log('Closing position...');
            await exchange.createOrder(symbol, 'market', 'sell', amount, undefined, {
                positionSide: 'LONG'
            });
        } catch (e: any) {
            console.log(`❌ Failed: ${e.message}`);
        }
    }
};

testKeys();
