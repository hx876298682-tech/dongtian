import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { CombatEmpty, CombatError, CombatLoading } from './combat-page.js';
import combatSource from './combat-page.tsx?raw';
import { getExpeditionMonsters, getExpeditionRegions } from './expedition-catalog.js';

describe('expedition page components', () => {
  it('keeps every visible monster connected to one idle action', () => {
    const monsters = getExpeditionMonsters();
    expect(monsters).toHaveLength(11);
    expect(monsters.every((monster) => monster.actionId.startsWith('action.t1.combat_'))).toBe(true);
    expect(getExpeditionRegions().every((region) => region.monsterIds.length > 0)).toBe(true);
  });

  it('renders clear loading, error and empty states', () => {
    expect(renderToStaticMarkup(<CombatLoading />)).toContain('正在读取历练地图');
    expect(renderToStaticMarkup(<CombatError onRetry={() => undefined} />)).toContain('历练内容读取失败');
    expect(renderToStaticMarkup(<CombatEmpty />)).toContain('暂无可挑战的怪物');
  });

  it('starts combat through the infinite idle queue without dungeon setup screens', () => {
    expect(combatSource).toContain('startBehaviorAction');
    expect(combatSource).toContain('点击怪物开始战斗');
    expect(combatSource).not.toContain('strategyPreset');
    expect(combatSource).not.toContain('previewDungeon');
    expect(combatSource).not.toContain('initialRoute');
  });
});
