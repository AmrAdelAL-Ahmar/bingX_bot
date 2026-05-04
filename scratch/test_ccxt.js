require('dotenv').config();
const ccxt = require('ccxt');

async function test() {
    const exchange = new ccxt.bingx({
        apiKey: process.env.BINGX_API_KEY,
        secret: process.env.BINGX_SECRET_KEY,
    });
    await exchange.loadMarkets();

    const oldRequest = exchange.request;
    exchange.request = async (path, api, method, params, headers, body, config) => {
        console.log("URL:", path);
        console.log("Body:", body);
        console.log("Params:", params);
        return { code: 0, data: {} };
    };

    try {
        await exchange.createOrder('SIREN/USDT:USDT', 'market', 'buy', 14.4, undefined, {
            positionSide: 'LONG',
            stopLoss: {
                triggerPrice: 0.766,
                type: 'STOP_MARKET'
            },
            takeProfit: {
                triggerPrice: 0.818,
                type: 'TAKE_PROFIT_MARKET'
            }
        });
    } catch (e) {
        console.error(e);
    }
}
test();
