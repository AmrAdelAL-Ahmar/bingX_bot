const ccxt = require('ccxt');

(async () => {
    const exchange = new ccxt.bingx({
        options: { defaultType: 'swap' }
    });
    console.log("Loading BingX markets...");
    await exchange.loadMarkets();
    const keys = Object.keys(exchange.markets);
    console.log(`Total markets loaded: ${keys.length}`);
    console.log("Sample symbols:", keys.slice(0, 15));
    
    const ftmMatches = keys.filter(k => k.includes('FTM'));
    console.log("FTM matches:", ftmMatches);
})();
