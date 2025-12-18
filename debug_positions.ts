import { BingXService } from './src/services/BingXService';
import dotenv from 'dotenv';
import logger from './src/utils/logger';

dotenv.config();

const bingXService = new BingXService(process.env.BINGX_API_KEY, process.env.BINGX_SECRET_KEY);

const main = async () => {
    try {
        console.log('Fetching positions...');
        const positions = await bingXService.getPositions();
        console.log('Positions found:', positions.length);

        if (positions.length > 0) {
            console.log('--- Raw Position Object Sample ---');
            console.log(JSON.stringify(positions[0], null, 2));
        } else {
            console.log('No open positions to inspect.');
        }
    } catch (error) {
        console.error('Error:', error);
    }
};

main();
