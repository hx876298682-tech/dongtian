import { describe, expect, it } from 'vitest';

import {
  buildBreakthroughPageView,
  formatBreakthroughRequirement,
  getBreakthroughSourceLabel,
  getBreakthroughSourcePath,
} from './breakthrough-adapter.js';

const preview = {
  breakthrough_config_id: 'breakthrough.foundation.early',
  target_realm_id: 'realm.foundation.early',
  config_version: '2026.08.16.1',
  formula_version: 1,
  success_rate: '1',
  all_satisfied: false,
  unlock_bundle_id: 'unlock.foundation.early',
  requirements: [
    {
      asset_type: 'CULTIVATION_XP' as const,
      asset_id: 'cultivation_xp',
      current: '22000',
      total: '22000',
      reserved: '0',
      available: '22000',
      required: '24100',
      status: 'MISSING' as const,
      shortfall: '2100',
      source_route_id: 'action.cultivation.qi',
      estimated_time_seconds: '28000',
    },
    {
      asset_type: 'ITEM' as const,
      asset_id: 'item.t1.foundation_pill',
      current: '1',
      total: '1',
      reserved: '0',
      available: '1',
      required: '1',
      status: 'SATISFIED' as const,
      shortfall: '0',
      source_route_id: 'recipe.t1.foundation_pill',
      estimated_time_seconds: null,
    },
  ],
};

describe('breakthrough adapter', () => {
  it('keeps authoritative totals and groups the four gate types without gambling language', () => {
    const view = buildBreakthroughPageView({
      character: {
        character_id: 'character-1',
        state_version: 7,
        active_config_version: '2026.08.16.1',
      },
      breakthrough: preview,
      config_version: '2026.08.16.1',
    });

    expect(view.requirements[0]).toMatchObject({
      available: '22000',
      reserved: '0',
      shortfall: '2100',
      status: 'MISSING',
    });
    expect(view.requirementGroups.map((group) => group.key)).toEqual([
      'CULTIVATION_XP',
      'KEY_RECIPE',
    ]);
    expect(view.requirementGroups.map((group) => group.label)).toEqual([
      '修为门槛',
      '关键配方门槛',
    ]);
    expect(view.successLabel).toBe('条件满足后，成功率为 100%');
    expect(view.successLabel).not.toContain('概率');
  });

  it('maps source route ids to app destinations', () => {
    expect(getBreakthroughSourcePath('action.cultivation.qi')).toBe(
      '/craft?tab=actions&action_id=action.cultivation.qi',
    );
    expect(getBreakthroughSourcePath('recipe.t1.foundation_pill')).toBe(
      '/craft?tab=recipes&recipe_id=recipe.t1.foundation_pill',
    );
    expect(getBreakthroughSourcePath('route.t1.qingshe_cave.safe_exit')).toBe(
      '/expedition?initial_route_id=route.t1.qingshe_cave.safe_exit',
    );
    expect(getBreakthroughSourceLabel('route.t1.qingshe_cave.safe_exit')).toBe('青蛇洞 · 灵髓');
  });

  it('formats reserved material as unavailable rather than double-counting it', () => {
    const requirement = preview.requirements[0]!;
    expect(formatBreakthroughRequirement(requirement)).toContain('可用 22,000 / 需要 24,100');
    expect(
      formatBreakthroughRequirement({ ...requirement, reserved: '1000', available: '21000' }),
    ).toContain('已预留 1,000');
  });
});
