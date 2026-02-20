
import { BingXService } from './src/services/BingXService';
import dotenv from 'dotenv';
dotenv.config();

const main = async () => {
    const bingX = new BingXService(process.env.BINGX_API_KEY, process.env.BINGX_SECRET_KEY);
    console.log('Fetching all markets...');
    const markets = await bingX['exchange'].loadMarkets();

    console.log(`Total markets: ${Object.keys(markets).length}`);

    const matches = Object.values(markets).filter((m: any) =>
        m.id.includes('GOLD') ||
        m.symbol.includes('GOLD') ||
        m.id.includes('XAU') ||
        m.symbol.includes('XAU')
    );

    console.log('\n--- Found Candidates ---');
    matches.forEach((m: any) => {
        console.log(`Symbol: ${m.symbol}`);
        console.log(`  ID: ${m.id}`);
        console.log(`  Type: ${m.type}`);
        console.log(`  Swap: ${m.swap}`);
        console.log(`  Future: ${m.future}`);
        console.log('-------------------');
    });
};

main();
