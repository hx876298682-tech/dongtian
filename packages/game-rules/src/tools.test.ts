import { describe, expect, it } from 'vitest';

import { microseconds } from './time.js';
import {
  compareToolLoadouts,
  createToolLoadout,
  projectToolCycleThroughput,
  projectToolHourlyThroughput,
  resolveToolProfileFromItemId,
} from './tools.js';

describe('tool rules', () => {
  it('resolves the configured herbalism, mining, and alchemy tool profiles', () => {
    expect(resolveToolProfileFromItemId('item.t1.qingtong_yaochu')).toEqual({
      itemId: 'item.t1.qingtong_yaochu',
      toolTag: 'herbalism_tool',
      skillId: 'skill.herbalism',
    });
    expect(resolveToolProfileFromItemId('item.t1.xuantie_kuanggao')).toEqual({
      itemId: 'item.t1.xuantie_kuanggao',
      toolTag: 'mining_tool',
      skillId: 'skill.mining',
    });
    expect(resolveToolProfileFromItemId('item.t1.cuizhi_danlu')).toEqual({
      itemId: 'item.t1.cuizhi_danlu',
      toolTag: 'alchemy_tool',
      skillId: 'skill.alchemy',
    });
  });

  it('combines speed and efficiency modifiers in the locked modifier order, including negative values', () => {
    const loadout = createToolLoadout({
      itemId: 'item.t1.qingtong_yaochu',
      toolTag: 'herbalism_tool',
      skillId: 'skill.herbalism',
      speedModifiers: [
        { stat: 'action_speed', operation: 'ADD', value: '0.10' },
        { stat: 'action_speed', operation: 'MULTIPLY', value: '0.20', group: 'skill' },
        { stat: 'action_speed', operation: 'MULTIPLY', value: '-0.10' },
      ],
      efficiencyModifiers: [
        { stat: 'action_efficiency', operation: 'ADD', value: '-0.05' },
      ],
    });

    expect(loadout).toMatchObject({
      itemId: 'item.t1.qingtong_yaochu',
      toolTag: 'herbalism_tool',
      skillId: 'skill.herbalism',
      speedMultiplier: '1.188',
      efficiencyMultiplier: '0.95',
    });
  });

  it('keeps the current snapshot for the active cycle and switches to the next assignment at the boundary', () => {
    const oldTool = createToolLoadout({
      itemId: 'item.t1.mubing_yaochu',
      toolTag: 'herbalism_tool',
      skillId: 'skill.herbalism',
    });
    const newTool = createToolLoadout({
      itemId: 'item.t1.qingtong_yaochu',
      toolTag: 'herbalism_tool',
      skillId: 'skill.herbalism',
      speedModifiers: [{ stat: 'action_speed', operation: 'ADD', value: '1.0' }],
      efficiencyModifiers: [{ stat: 'action_efficiency', operation: 'ADD', value: '0.10' }],
    });

    const projection = projectToolCycleThroughput({
      requiredToolTag: 'herbalism_tool',
      baseDurationUs: microseconds(60_000_000n),
      availableTimeUs: microseconds(120_000_000n),
      currentLoadout: oldTool,
      nextLoadout: newTool,
    });

    expect(projection).toMatchObject({
      currentToolTag: 'herbalism_tool',
      nextToolTag: 'herbalism_tool',
      currentPhase: {
        completedCycles: 1n,
        cycleDurationUs: 60_000_000n,
      },
      nextPhase: {
        completedCycles: 2n,
        cycleDurationUs: 30_000_000n,
      },
      completedCycles: 3n,
      cyclesPerHour: '180',
      effectiveThroughputPerHour: '192',
    });
  });

  it('projects valid work without a tool and rejects a mismatched tool tag', () => {
    const projection = projectToolCycleThroughput({
      requiredToolTag: 'alchemy_tool',
      baseDurationUs: microseconds(60_000_000n),
      availableTimeUs: microseconds(3_600_000_000n),
      currentLoadout: null,
    });

    expect(projection).toMatchObject({
      requiredToolTag: 'alchemy_tool',
      currentToolTag: null,
      currentPhase: {
        toolMatched: false,
        completedCycles: 60n,
        cycleDurationUs: 60_000_000n,
      },
      completedCycles: 60n,
      cyclesPerHour: '60',
      effectiveThroughputPerHour: '60',
    });

    const wrongTool = createToolLoadout({
      itemId: 'item.t1.xuantie_kuanggao',
      toolTag: 'mining_tool',
      skillId: 'skill.mining',
    });

    expect(() => projectToolCycleThroughput({
      requiredToolTag: 'herbalism_tool',
      baseDurationUs: microseconds(60_000_000n),
      availableTimeUs: microseconds(60_000_000n),
      currentLoadout: wrongTool,
    })).toThrow('TOOL_TAG_MISMATCH:herbalism_tool:mining_tool');
  });

  it('uses the same projection function for hourly estimates and authoritative batches', () => {
    const loadout = createToolLoadout({
      itemId: 'item.t1.xuantie_kuanggao',
      toolTag: 'mining_tool',
      skillId: 'skill.mining',
      speedModifiers: [{ stat: 'action_speed', operation: 'ADD', value: '0.20' }],
      efficiencyModifiers: [{ stat: 'action_efficiency', operation: 'ADD', value: '0.10' }],
    });
    const input = {
      requiredToolTag: 'mining_tool' as const,
      baseDurationUs: microseconds(60_000_000n),
      currentLoadout: loadout,
    };

    expect(projectToolHourlyThroughput(input)).toEqual(projectToolCycleThroughput({
      ...input,
      availableTimeUs: microseconds(3_600_000_000n),
    }));
    expect(projectToolCycleThroughput({
      ...input,
      availableTimeUs: microseconds(28_800_000_000n),
    })).toMatchObject({
      completedCycles: 576n,
      cyclesPerHour: '72',
      effectiveThroughputPerHour: '79.2',
    });
  });

  it('compares tools by projected throughput and prefers the stronger loadout', () => {
    const current = createToolLoadout({
      itemId: 'item.t1.mubing_danlu',
      toolTag: 'alchemy_tool',
      skillId: 'skill.alchemy',
    });
    const candidate = createToolLoadout({
      itemId: 'item.t1.xuanhuo_danlu',
      toolTag: 'alchemy_tool',
      skillId: 'skill.alchemy',
      speedModifiers: [{ stat: 'action_speed', operation: 'ADD', value: '0.20' }],
      efficiencyModifiers: [{ stat: 'action_efficiency', operation: 'ADD', value: '0.10' }],
    });

    expect(compareToolLoadouts({
      requiredToolTag: 'alchemy_tool',
      baseDurationUs: microseconds(60_000_000n),
      currentLoadout: current,
      candidateLoadout: candidate,
    })).toMatchObject({
      preferredItemId: 'item.t1.xuanhuo_danlu',
      throughputDeltaPerHour: '19.2',
      cyclesDeltaPerHour: '12',
    });
  });
});
