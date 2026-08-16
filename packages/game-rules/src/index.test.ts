import { describe, expect, it } from 'vitest';

import { mapCultivationStage, mapSkillProgress } from './index.js';

const stages = [
  {
    id: 'realm.mortal.entry',
    stage_order: 0,
    cultivation_xp_start: '0',
    cultivation_xp_required: '100',
  },
  {
    id: 'realm.qi.early',
    stage_order: 1,
    cultivation_xp_start: '100',
    cultivation_xp_required: '2000',
  },
];

describe('progression rules', () => {
  it('maps exact cultivation boundaries from configured cumulative starts', () => {
    expect(mapCultivationStage(stages, '99.999999').realmStageId).toBe('realm.mortal.entry');
    expect(mapCultivationStage(stages, '100').realmStageId).toBe('realm.qi.early');
    expect(mapCultivationStage(stages, '100').stageProgressXp).toBe('0');
  });

  it('maps skill XP at zero, exact threshold, and max-level boundaries', () => {
    const curve = {
      levels: [
        {
          level: 1,
          xp_to_next: '20',
          cumulative_xp: '20',
          speed_modifier: '0.004',
          efficiency_modifier: '0.006',
          stage_node: false,
        },
        {
          level: 2,
          xp_to_next: '63',
          cumulative_xp: '83',
          speed_modifier: '0.008',
          efficiency_modifier: '0.012',
          stage_node: false,
        },
        {
          level: 3,
          xp_to_next: '123',
          cumulative_xp: '206',
          speed_modifier: '0.012',
          efficiency_modifier: '0.018',
          stage_node: false,
        },
      ],
    };

    expect(mapSkillProgress(curve, '0')).toMatchObject({ level: 1, remainingXp: '20', nextLevel: 2 });
    expect(mapSkillProgress(curve, '20')).toMatchObject({ level: 2, remainingXp: '63', nextLevel: 3 });
    expect(mapSkillProgress(curve, '206')).toMatchObject({ level: 3, remainingXp: '0', nextLevel: null });
  });
});
