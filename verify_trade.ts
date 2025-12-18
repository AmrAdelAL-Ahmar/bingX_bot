import ccxt from 'ccxt';
import dotenv from 'dotenv';
dotenv.config();

const verify = async () => {
    const exchange = new ccxt.bingx({
        apiKey: process.env.BINGX_API_KEY,
        secret: process.env.BINGX_SECRET_KEY,
        options: { defaultType: 'swap' },
        enableRateLimit: true,
    });

    const orderId = '2001460907243417601'; // Latest SHORT trade ID
    const symbol = 'H/USDT:USDT';

    try {
        console.log(`--- Verifying Order: ${orderId} ---`);
        // In CCXT BingX fetchOrder might not show SL/TP if they are separate sub-orders
        // We should also check open positions and pending trigger orders

        const order = await exchange.fetchOrder(orderId, symbol);
        console.log('Order Details:');
        console.log(JSON.stringify(order, null, 2));

        console.log('\n--- Checking Open Positions ---');
        const positions = await exchange.fetchPositions([symbol]);
        console.log(JSON.stringify(positions, null, 2));

        console.log('\n--- Checking Open SL/TP (Trigger) Orders ---');
        const openOrders = await exchange.fetchOpenOrders(symbol);
        openOrders.forEach(o => {
            console.log(`Order ID: ${o.id}, Side: ${o.side}, Type: ${o.type}, SL: ${o.stopLossPrice}, TP: ${o.takeProfitPrice}`);
        });

    } catch (e: any) {
        console.error('❌ Verification failed:', e.message);
    }
};

verify();
