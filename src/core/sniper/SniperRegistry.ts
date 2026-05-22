import { ISniperEngine } from './ISniperEngine';
import { V7SniperEngine } from './engines/V7SniperEngine';
import { V8SniperEngine } from './engines/V8SniperEngine';
import { V9SniperEngine } from './engines/V9SniperEngine';
import { V10SniperEngine } from './engines/V10SniperEngine';
import { V11SniperEngine } from './engines/V11SniperEngine';

// ─── Sniper Engine Registry ────────────────────────────────────────────────────
// أضف محركات جديدة هنا دون تعديل أي ملف آخر

export const SNIPER_ENGINES: Record<string, ISniperEngine> = {
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
