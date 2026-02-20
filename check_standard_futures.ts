
import { BingXService } from './src/services/BingXService';
import ccxt from 'ccxt';
import dotenv from 'dotenv';
dotenv.config();

const main = async () => {
    console.log('Checking Standard Futures (type: future)...');
    // @ts-ignore
    const bingX = new ccxt.bingx({
        apiKey: process.env.BINGX_API_KEY,
        secret: process.env.BINGX_SECRET_KEY,
        options: {
            defaultType: 'future', // Try 'future' instead of 'swap'
        }
    });

    try {
        const markets = await bingX.loadMarkets();
        console.log(`Loaded ${Object.keys(markets).length} markets.`);

        const goldMatches = Object.values(markets).filter((m: any) =>
            m.id.includes('GOLD') || m.symbol.includes('GOLD') ||
            m.id.includes('XAU') || m.symbol.includes('XAU')
        );

        if (goldMatches.length > 0) {
            console.log('\n--- Found Gold Futures ---');
            goldMatches.forEach((m: any) => {
                console.log(`Symbol: ${m.symbol}`);
                console.log(`  ID: ${m.id}`);
                console.log(`  Type: ${m.type}`);
            });
        } else {
            console.log('No Gold markets found in Standard Futures.');
        }
    } catch (error) {
        console.error('Error loading Futures markets:', error);
    }
};

main();
