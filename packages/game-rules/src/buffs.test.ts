import { describe, expect, it } from 'vitest';

import { applyBuffsToActionSnapshot, buffAppliesToAction, type SettlementBuffEffect } from './buffs.js';
import { microseconds } from './time.js';

describe('buffs', () => {
  const snapshot = {
    actionConfigId: 'action.t1.qi_gathering_pill',
    configVersion: '2026.08.16.1',
    formulaVersion: 1,
    durationUs: microseconds(1_800_000_000n),
    cultivationXpPerCycle: '10',
    skillXpPerCycle: '2',
    outputs: [],
  } as const;

  const cultivationBuff: SettlementBuffEffect = {
    buffConfigId: 'buff.t1.qi_gathering_pill',
    sourceItemId: 'item.t1.qi_gathering_pill',
    stackGroup: 'cultivation',
    stackRule: 'REPLACE',
    applicableTags: ['cultivation'],
    modifiers: [
      {
        stat: 'cultivation_xp',
        operation: 'MULTIPLY',
        value: '1.25',
        tags: ['cultivation'],
      },
    ],
  };

  it('applies matching cultivation buffs and ignores unrelated buffs', () => {
    expect(buffAppliesToAction(cultivationBuff, ['cultivation'])).toBe(true);
    expect(buffAppliesToAction(cultivationBuff, ['combat'])).toBe(false);

    const result = applyBuffsToActionSnapshot({
      snapshot,
      actionTags: ['cultivation'],
      buffs: [
        cultivationBuff,
        {
          ...cultivationBuff,
          buffConfigId: 'buff.t1.recovery_pill',
          sourceItemId: 'item.t1.recovery_pill',
          applicableTags: ['combat'],
        },
      ],
    });

    expect(result.cultivationXpPerCycle).toBe('12.5');
    expect(result.skillXpPerCycle).toBe('2');
  });
});
