import { ISniperEngine } from './ISniperEngine';
import { V1SniperEngine } from './engines/V1SniperEngine';
import { V7SniperEngine } from './engines/V7SniperEngine';
import { V8SniperEngine } from './engines/V8SniperEngine';
import { V9SniperEngine } from './engines/V9SniperEngine';
import { V10SniperEngine } from './engines/V10SniperEngine';
import { V11SniperEngine } from './engines/V11SniperEngine';
import { V12SniperEngine } from './engines/V12SniperEngine';
import { V13SniperEngine } from './engines/V13SniperEngine';
import { V14SniperEngine } from './engines/V14SniperEngine';
import { V15SniperEngine } from './engines/V15SniperEngine';
import { V16SniperEngine } from './engines/V16SniperEngine';
import { V17SniperEngine } from './engines/V17SniperEngine';
import { V18SniperEngine } from './engines/V18SniperEngine';
import { HarmonicSniperEngine } from './engines/HarmonicSniperEngine';

// ─── Sniper Engine Registry ────────────────────────────────────────────────────
// أضف محركات جديدة هنا دون تعديل أي ملف آخر

export const SNIPER_ENGINES: Record<string, ISniperEngine> = {
    'HARMONIC-SWING': new HarmonicSniperEngine('SWING'),
    'HARMONIC-SCALP': new HarmonicSniperEngine('SCALP'),
    'V18-SWING': new V18SniperEngine('SWING'),
    'V18-SCALP': new V18SniperEngine('SCALP'),
    'V17-SWING': new V17SniperEngine('SWING'),
    'V17-SCALP': new V17SniperEngine('SCALP'),
    'V16-SWING': new V16SniperEngine('SWING'),
    'V16-SCALP': new V16SniperEngine('SCALP'),
    'V15-SWING': new V15SniperEngine('SWING'),
    'V15-SCALP': new V15SniperEngine('SCALP'),
    'V14-SWING': new V14SniperEngine('SWING'),
    'V14-SCALP': new V14SniperEngine('SCALP'),
    'V13-SWING': new V13SniperEngine('SWING'),
    'V13-SCALP': new V13SniperEngine('SCALP'),
    'V12-SWING': new V12SniperEngine('SWING'),
    'V12-SCALP': new V12SniperEngine('SCALP'),
    'V11-SWING': new V11SniperEngine('SWING'),
    'V11-SCALP': new V11SniperEngine('SCALP'),
    'V10-SWING': new V10SniperEngine('SWING'),
    'V10-SCALP': new V10SniperEngine('SCALP'),
    'V9-SWING': new V9SniperEngine('SWING'),
    'V9-SCALP': new V9SniperEngine('SCALP'),
    'V8-SWING': new V8SniperEngine('SWING'),
    'V8-SCALP': new V8SniperEngine('SCALP'),
    'V7-SWING': new V7SniperEngine('SWING'),
    'V7-SCALP': new V7SniperEngine('SCALP'),
    'V1-SWING': new V1SniperEngine('SWING'),
    'V1-SCALP': new V1SniperEngine('SCALP'),
};

/** قائمة المحركات المتاحة للعرض في Telegram */
export const SNIPER_ENGINE_LIST = Object.entries(SNIPER_ENGINES).map(([id, engine]) => ({
    id,
    displayName: engine.displayName,
    mode: engine.mode,
}));

/** الحصول على محرك بـ ID — يعود بـ undefined إذا غير موجود */
export function getSniperEngine(engineId: string): ISniperEngine | undefined {
    return SNIPER_ENGINES[engineId];
}
