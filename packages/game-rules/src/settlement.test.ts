import { describe, expect, it } from 'vitest';

import { microseconds } from './time.js';
import {
  checkpointSegments,
  settleSingleAction,
  type SettlementActionSnapshot,
} from './settlement.js';
import { decimal } from './decimal.js';

const snapshot: SettlementActionSnapshot = {
  actionConfigId: 'action.t1.herb_baicao_valley',
  configVersion: '2026.08.16.1',
  formulaVersion: 1,
  durationUs: microseconds(1_000_000n),
  cultivationXpPerCycle: '1.25',
  skillXpPerCycle: '0.5',
  outputs: [{ itemId: 'item.t1.qingling_herb', quantityPerCycle: 2n }],
};

const cultivationSnapshot: SettlementActionSnapshot = {
  actionConfigId: 'action.cultivation.qi',
  configVersion: '2026.08.16.1',
  formulaVersion: 1,
  durationUs: microseconds(60_000_000n),
  cultivationXpPerCycle: '4.500000',
  skillXpPerCycle: '0.000000',
  outputs: [],
};

describe('single-action settlement', () => {
  it('matches the approved cultivation gold results without item, skill XP, or random outputs', () => {
    const settleCultivation = (durationUs: bigint) => settleSingleAction({
      lastSettledAtUs: microseconds(0n),
      serverNowUs: microseconds(durationUs),
      offlineCapUs: microseconds(36_000_000_000n),
      progressTimeUs: microseconds(0n),
      actionSnapshot: cultivationSnapshot,
    });
    const cases = [
      [59_999_999n, 0n, '0', 59_999_999n],
      [60_000_000n, 1n, '4.5', 0n],
      [3_600_000_000n, 60n, '270', 0n],
      [28_800_000_000n, 480n, '2160', 0n],
      [36_000_000_000n, 600n, '2700', 0n],
    ] as const;

    for (const [durationUs, completedCycles, cultivationXp, progressTimeUs] of cases) {
      const result = settleCultivation(durationUs);
      expect(result).toMatchObject({ completedCycles, cultivationXp, skillXp: '0', progressTimeUs });
      expect(result.segments[0]?.outputs).toEqual({});
      expect(result.segments[0]?.xpChanges).toEqual({ cultivationXp, skillXp: '0' });
      expect(result.segments[0]?.snapshot.outputs).toEqual({});
    }
  });

  it('handles zero, one microsecond, exact cycles, tail time, and the ten-hour cap', () => {
    const base = {
      lastSettledAtUs: microseconds(0n),
      offlineCapUs: microseconds(36_000_000_000n),
      progressTimeUs: microseconds(0n),
      actionSnapshot: snapshot,
    } as const;
    expect(settleSingleAction({ ...base, serverNowUs: microseconds(0n) })).toMatchObject({
      effectiveTimeUs: 0n,
      completedCycles: 0n,
      progressTimeUs: 0n,
    });
    expect(settleSingleAction({ ...base, serverNowUs: microseconds(1n) })).toMatchObject({
      effectiveTimeUs: 1n,
      completedCycles: 0n,
      progressTimeUs: 1n,
    });
    expect(settleSingleAction({ ...base, serverNowUs: microseconds(2_500_001n) })).toMatchObject({
      completedCycles: 2n,
      progressTimeUs: 500_001n,
      cultivationXp: '2.5',
      skillXp: '1',
    });
    expect(settleSingleAction({ ...base, serverNowUs: microseconds(72n * 60n * 60n * 1_000_000n) })).toMatchObject({
      effectiveTimeUs: 36_000_000_000n,
      cappedTimeUs: 223_200_000_000n,
      completedCycles: 36_000n,
      progressTimeUs: 0n,
    });
  });

  it('keeps the active cycle progress in the snapshot boundary and returns a stable segment', () => {
    const result = settleSingleAction({
      lastSettledAtUs: microseconds(10n),
      serverNowUs: microseconds(1_000_010n),
      offlineCapUs: microseconds(36_000_000_000n),
      progressTimeUs: microseconds(999_999n),
      actionSnapshot: snapshot,
    });
    expect(result.segments[0]).toMatchObject({
      segmentIndex: 0,
      fromUs: 10n,
      toUs: 1_000_010n,
      completedCycles: 1n,
      outputs: { 'item.t1.qingling_herb': '2' },
      xpChanges: { cultivationXp: '1.25', skillXp: '0.5' },
    });
    expect(result.segments[0]?.snapshot).toMatchObject({
      action_config_id: 'action.t1.herb_baicao_valley',
      duration_us: '1000000',
      config_version: '2026.08.16.1',
    });
  });

  it('records an idle summary without inventing rewards when no action is active', () => {
    expect(settleSingleAction({
      lastSettledAtUs: microseconds(0n),
      serverNowUs: microseconds(10n),
      offlineCapUs: microseconds(36_000_000_000n),
      progressTimeUs: microseconds(0n),
      actionSnapshot: null,
    })).toMatchObject({ status: 'IDLE_NO_ACTION', segments: [], cultivationXp: '0' });
  });

  it('keeps deferred segments in a checkpoint instead of dropping time at the segment limit', () => {
    const checkpoint = checkpointSegments(['a', 'b', 'c'], 2);
    expect(checkpoint).toEqual({
      committedSegments: ['a', 'b'],
      deferredSegments: ['c'],
      continuationRequired: true,
    });
  });

  it('produces the same cycles, XP, outputs, and remainder in batch and per-cycle execution', () => {
    const batch = settleSingleAction({
      lastSettledAtUs: microseconds(0n),
      serverNowUs: microseconds(10_500_000n),
      offlineCapUs: microseconds(36_000_000_000n),
      progressTimeUs: microseconds(0n),
      actionSnapshot: snapshot,
    });
    let lastSettledAtUs = microseconds(0n);
    let progressTimeUs = microseconds(0n);
    let completedCycles = 0n;
    let cultivationXp = decimal('0');
    let skillXp = decimal('0');
    let outputQuantity = 0n;
    for (let index = 0; index < 10; index += 1) {
      const cycle = settleSingleAction({
        lastSettledAtUs,
        serverNowUs: microseconds(lastSettledAtUs + 1_000_000n),
        offlineCapUs: microseconds(36_000_000_000n),
        progressTimeUs,
        actionSnapshot: snapshot,
      });
      completedCycles += cycle.completedCycles;
      progressTimeUs = cycle.progressTimeUs;
      lastSettledAtUs = cycle.effectiveUntilUs;
      cultivationXp = cultivationXp.add(cycle.cultivationXp);
      skillXp = skillXp.add(cycle.skillXp);
      outputQuantity += BigInt(cycle.segments[0]?.outputs['item.t1.qingling_herb'] ?? '0');
    }
    const tail = settleSingleAction({
      lastSettledAtUs,
      serverNowUs: microseconds(lastSettledAtUs + 500_000n),
      offlineCapUs: microseconds(36_000_000_000n),
      progressTimeUs,
      actionSnapshot: snapshot,
    });
    progressTimeUs = tail.progressTimeUs;
    cultivationXp = cultivationXp.add(tail.cultivationXp);
    skillXp = skillXp.add(tail.skillXp);
    outputQuantity += BigInt(tail.segments[0]?.outputs['item.t1.qingling_herb'] ?? '0');
    expect({ completedCycles, progressTimeUs, cultivationXp: cultivationXp.toString(), skillXp: skillXp.toString(), outputQuantity })
      .toEqual({
        completedCycles: batch.completedCycles,
        progressTimeUs: batch.progressTimeUs,
        cultivationXp: batch.cultivationXp,
        skillXp: batch.skillXp,
        outputQuantity: BigInt(batch.segments[0]?.outputs['item.t1.qingling_herb'] ?? '0'),
      });
  });

  it('keeps mining batch settlement identical to repeated per-cycle settlement', () => {
    const miningSnapshot: SettlementActionSnapshot = {
      actionConfigId: 'action.t1.ore_chitong_kuang',
      configVersion: '2026.08.16.1',
      formulaVersion: 1,
      durationUs: microseconds(120_000_000n),
      cultivationXpPerCycle: '0',
      skillXpPerCycle: '5',
      outputs: [{ itemId: 'item.t1.chitong_kuang', quantityPerCycle: 1n }],
    };
    const batch = settleSingleAction({
      lastSettledAtUs: microseconds(0n),
      serverNowUs: microseconds(1_080_000_000n),
      offlineCapUs: microseconds(36_000_000_000n),
      progressTimeUs: microseconds(0n),
      actionSnapshot: miningSnapshot,
    });
    let lastSettledAtUs = microseconds(0n);
    let progressTimeUs = microseconds(0n);
    let completedCycles = 0n;
    let skillXp = decimal('0');
    let outputQuantity = 0n;
    for (let index = 0; index < 9; index += 1) {
      const cycle = settleSingleAction({
        lastSettledAtUs,
        serverNowUs: microseconds(lastSettledAtUs + 120_000_000n),
        offlineCapUs: microseconds(36_000_000_000n),
        progressTimeUs,
        actionSnapshot: miningSnapshot,
      });
      completedCycles += cycle.completedCycles;
      progressTimeUs = cycle.progressTimeUs;
      lastSettledAtUs = cycle.effectiveUntilUs;
      skillXp = skillXp.add(cycle.skillXp);
      outputQuantity += BigInt(cycle.segments[0]?.outputs['item.t1.chitong_kuang'] ?? '0');
    }
    expect({
      completedCycles,
      progressTimeUs,
      skillXp: skillXp.toString(),
      outputQuantity,
    }).toEqual({
      completedCycles: batch.completedCycles,
      progressTimeUs: batch.progressTimeUs,
      skillXp: batch.skillXp,
      outputQuantity: BigInt(batch.segments[0]?.outputs['item.t1.chitong_kuang'] ?? '0'),
    });
  });
});
