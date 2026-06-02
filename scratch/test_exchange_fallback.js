const ccxt = require('ccxt');

async function testExchange(exchangeId) {
    console.log(`\n--- Testing Exchange: ${exchangeId} ---`);
    try {
        const exchange = new ccxt[exchangeId]({
            enableRateLimit: true,
            options: { 'defaultType': 'swap' }
        });
        
        console.log(`[${exchangeId}] Loading markets...`);
        await exchange.loadMarkets();
        console.log(`[${exchangeId}] Markets loaded successfully!`);
        
        console.log(`[${exchangeId}] Fetching tickers...`);
        const tickers = await exchange.fetchTickers();
        const symbols = Object.keys(tickers);
        console.log(`[${exchangeId}] Fetched ${symbols.length} tickers.`);
        
        // Filter USDT perpetuals
        const usdtPerps = symbols.filter(symbol => 
            symbol.endsWith('/USDT:USDT') || (symbol.endsWith('USDT') && !symbol.includes('/'))
        );
        console.log(`[${exchangeId}] Found ${usdtPerps.length} USDT perpetual contracts.`);
        if (usdtPerps.length > 0) {
            console.log(`[${exchangeId}] Sample symbols:`, usdtPerps.slice(0, 5));
            const firstSymbol = usdtPerps[0];
            const ticker = tickers[firstSymbol];
            const volume = ticker ? (ticker.quoteVolume ?? ((ticker.baseVolume ?? 0) * (ticker.last ?? 0))) : 0;
            console.log(`[${exchangeId}] Sample ticker volume for ${firstSymbol}: ${volume}`);
            
            console.log(`[${exchangeId}] Fetching daily candles for ${firstSymbol}...`);
            const candles = await exchange.fetchOHLCV(firstSymbol, '1d', undefined, 5);
            console.log(`[${exchangeId}] Fetched ${candles.length} candles successfully.`);
        }
        return true;
    } catch (error) {
        console.error(`❌ [${exchangeId}] Error during test:`, error.message);
        return false;
    }
}

async function run() {
    const exchanges = ['bybit', 'binance', 'okx', 'bingx'];
    for (const exchangeId of exchanges) {
        await testExchange(exchangeId);
    }
}

run();
