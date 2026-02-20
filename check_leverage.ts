
import { BingXService } from './src/services/BingXService';
import dotenv from 'dotenv';
dotenv.config();

const main = async () => {
    const bingX = new BingXService(process.env.BINGX_API_KEY, process.env.BINGX_SECRET_KEY);
    await bingX['exchange'].loadMarkets();
    const market = bingX['exchange'].market('XAUT/USDT:USDT');

    console.log('Market Info for XAUT/USDT:USDT:');
    console.log('Limits:', JSON.stringify(market.limits, null, 2));
    // Specifically check leverage limits if available in 'info' or 'limits'
    console.log('Max Leverage:', market.limits?.leverage?.max || 'Unknown');
};

main();
