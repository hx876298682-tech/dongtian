import { describe, expect, it } from 'vitest';

import { microseconds } from './time.js';
import {
  approvedCaveFacilityCatalog,
  createCaveFacilityCatalog,
  projectCaveBuildTask,
  resolveCaveModifierSnapshotBoundary,
  startCaveBuildTask,
} from './cave.js';

describe('cave build rules', () => {
  it('starts a build with a stable cost snapshot from the Numerical Master Sheet', () => {
    const task = startCaveBuildTask({
      buildTaskId: 'build-1',
      facilityId: 'cave.facility.spirit_room',
      currentLevel: 0,
      targetLevel: 1,
      currentRealmGroup: 'QI',
      nowUs: microseconds(0n),
      catalog: approvedCaveFacilityCatalog,
    });

    expect(task).toMatchObject({
      buildTaskId: 'build-1',
      facilityId: 'cave.facility.spirit_room',
      facilityName: '聚灵室',
      fromLevel: 0,
      targetLevel: 1,
      startedAtUs: 0n,
      projectedCompletionAtUs: 7_200_000_000n,
      completedAtUs: null,
      status: 'RUNNING',
    });
    expect(task.costSnapshot).toEqual({
      facilityId: 'cave.facility.spirit_room',
      facilityName: '聚灵室',
      level: 1,
      requiredFacilityLevel: 0,
      requiredRealmGroup: 'QI',
      spiritStoneCost: '200',
      materialCosts: [
        { itemId: 'item.t1.qingzhu', quantity: '30' },
        { itemId: 'item.t2.lingsui', quantity: '0' },
      ],
      buildDurationUs: '7200000000',
      modifier: { stat: 'cultivation_xp', operation: 'MULTIPLY', value: '0.03' },
      scope: 'MVP',
    });
  });

  it('projects zero elapsed, exact completion, and offline completion boundaries lazily', () => {
    const task = startCaveBuildTask({
      buildTaskId: 'build-2',
      facilityId: 'cave.facility.alchemy_room',
      currentLevel: 0,
      targetLevel: 1,
      currentRealmGroup: 'QI',
      nowUs: microseconds(10n),
      catalog: approvedCaveFacilityCatalog,
    });

    expect(projectCaveBuildTask(task, microseconds(10n))).toMatchObject({
      status: 'RUNNING',
      completionReached: false,
      elapsedUs: 0n,
      remainingUs: 7_200_000_000n,
      completedAtUs: null,
    });

    expect(projectCaveBuildTask(task, task.projectedCompletionAtUs)).toMatchObject({
      status: 'COMPLETED',
      completionReached: true,
      elapsedUs: 7_200_000_000n,
      remainingUs: 0n,
      completedAtUs: 7_200_000_010n,
    });

    expect(projectCaveBuildTask(task, microseconds(43_200_000_010n))).toMatchObject({
      status: 'COMPLETED',
      completionReached: true,
      elapsedUs: 43_200_000_000n,
      remainingUs: 0n,
      completedAtUs: 7_200_000_010n,
    });
  });

  it('rejects concurrent builds on the same facility while the active task is still running', () => {
    const runningTask = startCaveBuildTask({
      buildTaskId: 'build-3',
      facilityId: 'cave.facility.forge_room',
      currentLevel: 0,
      targetLevel: 1,
      currentRealmGroup: 'QI',
      nowUs: microseconds(0n),
      catalog: approvedCaveFacilityCatalog,
    });

    expect(() => startCaveBuildTask({
      buildTaskId: 'build-4',
      facilityId: 'cave.facility.forge_room',
      currentLevel: 0,
      targetLevel: 1,
      currentRealmGroup: 'QI',
      nowUs: microseconds(1n),
      catalog: approvedCaveFacilityCatalog,
      activeBuildTasks: [runningTask],
    })).toThrow('CAVE_BUILD_CONFLICT:cave.facility.forge_room');
  });

  it('rejects illegal levels and level gaps in the catalog', () => {
    expect(() => startCaveBuildTask({
      buildTaskId: 'build-5',
      facilityId: 'cave.facility.spirit_room',
      currentLevel: 0,
      targetLevel: 0,
      currentRealmGroup: 'QI',
      nowUs: microseconds(0n),
      catalog: approvedCaveFacilityCatalog,
    })).toThrow('CAVE_TARGET_LEVEL_INVALID');

    expect(() => startCaveBuildTask({
      buildTaskId: 'build-6',
      facilityId: 'cave.facility.spirit_room',
      currentLevel: 0,
      targetLevel: 1,
      currentRealmGroup: 'MORTAL',
      nowUs: microseconds(0n),
      catalog: approvedCaveFacilityCatalog,
    })).toThrow('CAVE_REALM_TOO_LOW:cave.facility.spirit_room:MORTAL:QI');

    expect(() => createCaveFacilityCatalog(
      approvedCaveFacilityCatalog.filter((rule) => !(rule.facilityId === 'cave.facility.spirit_room' && rule.level === 2)),
    )).toThrow('CAVE_LEVEL_GAP:cave.facility.spirit_room:2:3');
  });

  it('makes the facility modifier visible only from the next cycle snapshot onward', () => {
    expect(resolveCaveModifierSnapshotBoundary({
      cycleStartUs: microseconds(0n),
      cycleEndUs: microseconds(7_200_000_000n),
      facilityCompletedAtUs: microseconds(7_200_000_000n),
    })).toEqual({
      currentCycleApplies: false,
      nextCycleApplies: true,
    });
  });
});
