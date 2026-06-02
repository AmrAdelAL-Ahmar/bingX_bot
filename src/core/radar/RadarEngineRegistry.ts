import { IRadarEngine } from './engines/IRadarEngine';
import { V12RadarEngine } from './engines/V12RadarEngine';
import { V13RadarEngine } from './engines/V13RadarEngine';
import { V14RadarEngine } from './engines/V14RadarEngine';
import { V15RadarEngine } from './engines/V15RadarEngine';
import { V16RadarEngine } from './engines/V16RadarEngine';

const RADAR_ENGINES: Record<string, IRadarEngine> = {
    'V12': new V12RadarEngine(),
    'V13': new V13RadarEngine(),
    'V14': new V14RadarEngine(),
    'V15': new V15RadarEngine(),
    'V16': new V16RadarEngine(),
};

export function getRadarEngine(engineId: string): IRadarEngine | undefined {
    if (!engineId) return undefined;
    const prefix = engineId.split('-')[0].toUpperCase();
    return RADAR_ENGINES[prefix];
}
