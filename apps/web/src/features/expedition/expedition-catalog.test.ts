import { describe, expect, it } from 'vitest';
import { EXPEDITION_REGIONS, findExpeditionMonster, getMonsterDungeon } from './expedition-catalog.js';

describe('expedition catalog', () => {
  it('covers all release regions and monsters with truthful dungeon support', () => {
    expect(EXPEDITION_REGIONS).toHaveLength(6);
    expect(EXPEDITION_REGIONS.reduce((count, region) => count + region.monsterIds.length, 0)).toBe(11);
    expect(findExpeditionMonster('monster.t1.gray_wolf')?.loot).toContain('妖狼牙');
    expect(getMonsterDungeon('monster.t1.gray_wolf')).toBe('dungeon.t1.xuantie_cavern');
    expect(getMonsterDungeon('monster.t1.lingquan_shouwei')).toBeNull();
  });
});
