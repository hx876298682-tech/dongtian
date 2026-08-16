import Decimal from 'decimal.js';

import { microseconds, type Microseconds } from './time.js';

export type CaveRealmGroup = 'MORTAL' | 'QI' | 'FOUNDATION';
export type CaveScope = 'MVP' | 'MVP_ENDGAME';
export type CaveFacilityStat = 'cultivation_xp' | 'alchemy_xp' | 'refinement_xp';
export type CaveModifierOperation = 'ADD' | 'MULTIPLY';

export type CaveMaterialCost = {
  readonly itemId: string;
  readonly quantity: string;
};

export type CaveFacilityModifier = {
  readonly stat: CaveFacilityStat;
  readonly operation: CaveModifierOperation;
  readonly value: string;
};

export type CaveFacilityRuleInput = {
  readonly facilityId: string;
  readonly facilityName: string;
  readonly level: number;
  readonly requiredRealmGroup: CaveRealmGroup;
  readonly spiritStoneCost: string;
  readonly materialCosts: readonly CaveMaterialCost[];
  readonly buildDurationUs: Microseconds;
  readonly modifier: CaveFacilityModifier;
  readonly scope: CaveScope;
};

export type CaveFacilityRule = CaveFacilityRuleInput & {
  readonly requiredFacilityLevel: number;
};

export type CaveBuildTaskSnapshot = {
  readonly facilityId: string;
  readonly facilityName: string;
  readonly level: number;
  readonly requiredFacilityLevel: number;
  readonly requiredRealmGroup: CaveRealmGroup;
  readonly spiritStoneCost: string;
  readonly materialCosts: readonly CaveMaterialCost[];
  readonly buildDurationUs: string;
  readonly modifier: CaveFacilityModifier;
  readonly scope: CaveScope;
};

export type CaveBuildTask = {
  readonly buildTaskId: string;
  readonly facilityId: string;
  readonly facilityName: string;
  readonly fromLevel: number;
  readonly targetLevel: number;
  readonly startedAtUs: Microseconds;
  readonly projectedCompletionAtUs: Microseconds;
  readonly completedAtUs: Microseconds | null;
  readonly status: 'RUNNING' | 'COMPLETED';
  readonly costSnapshot: CaveBuildTaskSnapshot;
};

export type CaveBuildProjection = CaveBuildTask & {
  readonly elapsedUs: Microseconds;
  readonly remainingUs: Microseconds;
  readonly completionReached: boolean;
};

export type CaveCycleModifierBoundary = {
  readonly currentCycleApplies: boolean;
  readonly nextCycleApplies: boolean;
};

export type CaveBuildStartInput = {
  readonly buildTaskId: string;
  readonly facilityId: string;
  readonly targetLevel: number;
  readonly currentLevel: number;
  readonly currentRealmGroup: CaveRealmGroup;
  readonly nowUs: Microseconds;
  readonly catalog: readonly CaveFacilityRule[];
  readonly activeBuildTasks?: readonly CaveBuildTask[];
};

const decimalContext = Decimal.clone({ precision: 80, rounding: Decimal.ROUND_DOWN });

const realmGroupOrder: Readonly<Record<CaveRealmGroup, number>> = {
  MORTAL: 0,
  QI: 1,
  FOUNDATION: 2,
};

function fail(code: string): never {
  throw new Error(code);
}

function requireTrimmedString(value: string, field: string): string {
  if (value.trim().length === 0) {
    fail(`CAVE_${field}_REQUIRED`);
  }
  return value;
}

function requirePositiveInteger(value: number, field: string): number {
  if (!Number.isInteger(value) || value < 1) {
    fail(`CAVE_${field}_INVALID`);
  }
  return value;
}

function requireNonNegativeIntegerString(value: string, field: string): string {
  const parsed = new decimalContext(value);
  if (!parsed.isFinite() || parsed.isNegative() || !parsed.isInteger()) {
    fail(`CAVE_${field}_INVALID`);
  }
  return parsed.toFixed(0);
}

function requirePositiveBigint(value: Microseconds, field: string): Microseconds {
  if (value <= 0n) {
    fail(`CAVE_${field}_INVALID`);
  }
  return value;
}

function requireNonNegativeDecimalString(value: string, field: string): string {
  const parsed = new decimalContext(value);
  if (!parsed.isFinite() || parsed.isNegative()) {
    fail(`CAVE_${field}_INVALID`);
  }
  return parsed.toFixed();
}

function normalizeMaterialCosts(materialCosts: readonly CaveMaterialCost[]): readonly CaveMaterialCost[] {
  const seen = new Set<string>();
  return materialCosts.map((material, index) => {
    const itemId = requireTrimmedString(material.itemId, `MATERIAL_ITEM_${index + 1}`);
    const quantity = requireNonNegativeIntegerString(material.quantity, `MATERIAL_QUANTITY_${itemId}`);
    if (seen.has(itemId)) {
      fail(`CAVE_DUPLICATE_MATERIAL:${itemId}`);
    }
    seen.add(itemId);
    return { itemId, quantity };
  });
}

function normalizeModifier(modifier: CaveFacilityModifier): CaveFacilityModifier {
  if (modifier.stat !== 'cultivation_xp' && modifier.stat !== 'alchemy_xp' && modifier.stat !== 'refinement_xp') {
    fail(`CAVE_MODIFIER_STAT_INVALID:${modifier.stat}`);
  }
  if (modifier.operation !== 'ADD' && modifier.operation !== 'MULTIPLY') {
    fail(`CAVE_MODIFIER_OPERATION_INVALID:${modifier.operation}`);
  }
  return {
    stat: modifier.stat,
    operation: modifier.operation,
    value: requireNonNegativeDecimalString(requireTrimmedString(modifier.value, 'MODIFIER_VALUE'), 'MODIFIER_VALUE'),
  };
}

function normalizeRule(rule: CaveFacilityRuleInput): CaveFacilityRule {
  const level = requirePositiveInteger(rule.level, 'LEVEL');
  const requiredRealmGroup = rule.requiredRealmGroup;
  return {
    facilityId: requireTrimmedString(rule.facilityId, 'FACILITY_ID'),
    facilityName: requireTrimmedString(rule.facilityName, 'FACILITY_NAME'),
    level,
    requiredRealmGroup,
    requiredFacilityLevel: level - 1,
    spiritStoneCost: requireNonNegativeIntegerString(requireTrimmedString(rule.spiritStoneCost, 'SPIRIT_STONE_COST'), 'SPIRIT_STONE_COST'),
    materialCosts: normalizeMaterialCosts(rule.materialCosts),
    buildDurationUs: requirePositiveBigint(rule.buildDurationUs, 'BUILD_DURATION_US'),
    modifier: normalizeModifier(rule.modifier),
    scope: rule.scope,
  };
}

function compareRule(left: CaveFacilityRule, right: CaveFacilityRule): number {
  if (left.facilityId === right.facilityId) {
    return left.level - right.level;
  }
  return left.facilityId.localeCompare(right.facilityId);
}

function isSupportedRealmGroup(group: CaveRealmGroup): boolean {
  return group === 'MORTAL' || group === 'QI' || group === 'FOUNDATION';
}

function realmGroupMeetsRequirement(current: CaveRealmGroup, required: CaveRealmGroup): boolean {
  return realmGroupOrder[current] >= realmGroupOrder[required];
}

function cloneMaterialCosts(costs: readonly CaveMaterialCost[]): readonly CaveMaterialCost[] {
  return costs.map((cost) => ({ ...cost }));
}

export function createCaveFacilityCatalog(rules: readonly CaveFacilityRuleInput[]): readonly CaveFacilityRule[] {
  if (rules.length === 0) {
    fail('CAVE_RULES_EMPTY');
  }

  const normalized = rules.map(normalizeRule).sort(compareRule);
  const byFacility = new Map<string, CaveFacilityRule[]>();

  for (const rule of normalized) {
    const facilityRules = byFacility.get(rule.facilityId) ?? [];
    facilityRules.push(rule);
    byFacility.set(rule.facilityId, facilityRules);
  }

  for (const [facilityId, facilityRules] of byFacility.entries()) {
    if (facilityRules.length < 3) {
      fail(`CAVE_FACILITY_LEVEL_COUNT_TOO_LOW:${facilityId}`);
    }

    let expectedLevel = 1;
    let previousRealmRank = -1;
    let previousStat: CaveFacilityStat | null = null;

    for (const rule of facilityRules) {
      if (rule.level !== expectedLevel) {
        fail(`CAVE_LEVEL_GAP:${facilityId}:${expectedLevel}:${rule.level}`);
      }
      if (!isSupportedRealmGroup(rule.requiredRealmGroup)) {
        fail(`CAVE_REALM_GROUP_INVALID:${facilityId}:${rule.requiredRealmGroup}`);
      }
      const realmRank = realmGroupOrder[rule.requiredRealmGroup];
      if (realmRank < previousRealmRank) {
        fail(`CAVE_REALM_GROUP_REGRESSION:${facilityId}:${rule.level}`);
      }
      if (previousStat !== null && previousStat !== rule.modifier.stat) {
        fail(`CAVE_MODIFIER_STAT_MISMATCH:${facilityId}`);
      }
      previousRealmRank = realmRank;
      previousStat = rule.modifier.stat;
      expectedLevel += 1;
    }
  }

  return normalized.map((rule) => ({
    ...rule,
    materialCosts: cloneMaterialCosts(rule.materialCosts),
  }));
}

export function getCaveFacilityRule(
  catalog: readonly CaveFacilityRule[],
  facilityId: string,
  level: number,
): CaveFacilityRule {
  if (!Number.isInteger(level) || level < 1) {
    fail('CAVE_LEVEL_INVALID');
  }
  const match = catalog.find((rule) => rule.facilityId === facilityId && rule.level === level);
  if (match) {
    return match;
  }
  const facilityRules = catalog.filter((rule) => rule.facilityId === facilityId).sort(compareRule);
  if (facilityRules.length === 0) {
    fail(`CAVE_FACILITY_UNKNOWN:${facilityId}`);
  }
  const knownLevels = facilityRules.map((rule) => rule.level);
  if (knownLevels.some((knownLevel) => knownLevel > level)) {
    fail(`CAVE_LEVEL_GAP:${facilityId}:${level}`);
  }
  fail(`CAVE_LEVEL_UNAVAILABLE:${facilityId}:${level}`);
}

export function startCaveBuildTask(input: CaveBuildStartInput): CaveBuildTask {
  if (!Number.isInteger(input.currentLevel) || input.currentLevel < 0) {
    fail('CAVE_CURRENT_LEVEL_INVALID');
  }
  if (!Number.isInteger(input.targetLevel) || input.targetLevel < 1) {
    fail('CAVE_TARGET_LEVEL_INVALID');
  }
  if (!isSupportedRealmGroup(input.currentRealmGroup)) {
    fail(`CAVE_REALM_GROUP_INVALID:${input.currentRealmGroup}`);
  }
  if (input.nowUs < 0n) {
    fail('CAVE_TIME_INVALID');
  }
  const buildTaskId = requireTrimmedString(input.buildTaskId, 'BUILD_TASK_ID');
  const facilityId = requireTrimmedString(input.facilityId, 'FACILITY_ID');

  const activeConflict = (input.activeBuildTasks ?? []).some((task) => {
    if (task.facilityId !== facilityId) {
      return false;
    }
    const projected = projectCaveBuildTask(task, input.nowUs);
    return projected.status === 'RUNNING';
  });
  if (activeConflict) {
    fail(`CAVE_BUILD_CONFLICT:${facilityId}`);
  }

  if (input.targetLevel !== input.currentLevel + 1) {
    fail(`CAVE_LEVEL_NON_CONTIGUOUS:${facilityId}:${input.currentLevel}->${input.targetLevel}`);
  }

  const rule = getCaveFacilityRule(input.catalog, facilityId, input.targetLevel);
  if (!realmGroupMeetsRequirement(input.currentRealmGroup, rule.requiredRealmGroup)) {
    fail(`CAVE_REALM_TOO_LOW:${facilityId}:${input.currentRealmGroup}:${rule.requiredRealmGroup}`);
  }
  if (rule.requiredFacilityLevel !== input.currentLevel) {
    fail(`CAVE_PREREQUISITE_LEVEL_MISMATCH:${facilityId}:${rule.requiredFacilityLevel}:${input.currentLevel}`);
  }

  const projectedCompletionAtUs = microseconds(input.nowUs + rule.buildDurationUs);
  return {
    buildTaskId,
    facilityId,
    facilityName: rule.facilityName,
    fromLevel: input.currentLevel,
    targetLevel: input.targetLevel,
    startedAtUs: input.nowUs,
    projectedCompletionAtUs,
    completedAtUs: null,
    status: 'RUNNING',
    costSnapshot: {
      facilityId: rule.facilityId,
      facilityName: rule.facilityName,
      level: rule.level,
      requiredFacilityLevel: rule.requiredFacilityLevel,
      requiredRealmGroup: rule.requiredRealmGroup,
      spiritStoneCost: rule.spiritStoneCost,
      materialCosts: cloneMaterialCosts(rule.materialCosts),
      buildDurationUs: rule.buildDurationUs.toString(),
      modifier: { ...rule.modifier },
      scope: rule.scope,
    },
  };
}

export function projectCaveBuildTask(task: CaveBuildTask, nowUs: Microseconds): CaveBuildProjection {
  if (nowUs < task.startedAtUs) {
    fail('CAVE_TIME_TRAVEL');
  }
  const elapsedUs = microseconds(nowUs - task.startedAtUs);
  const completionReached = nowUs >= task.projectedCompletionAtUs;
  const remainingUs = completionReached ? microseconds(0n) : microseconds(task.projectedCompletionAtUs - nowUs);
  return {
    ...task,
    completedAtUs: completionReached ? task.projectedCompletionAtUs : null,
    status: completionReached ? 'COMPLETED' : 'RUNNING',
    elapsedUs,
    remainingUs,
    completionReached,
  };
}

export function resolveCaveModifierSnapshotBoundary(input: {
  readonly cycleStartUs: Microseconds;
  readonly cycleEndUs: Microseconds;
  readonly facilityCompletedAtUs: Microseconds | null;
}): CaveCycleModifierBoundary {
  if (input.cycleEndUs < input.cycleStartUs) {
    fail('CAVE_CYCLE_BOUNDARY_INVALID');
  }
  if (input.facilityCompletedAtUs === null) {
    return {
      currentCycleApplies: false,
      nextCycleApplies: false,
    };
  }

  return {
    currentCycleApplies: input.facilityCompletedAtUs <= input.cycleStartUs,
    nextCycleApplies: input.facilityCompletedAtUs <= input.cycleEndUs,
  };
}

export const approvedCaveFacilityCatalog = createCaveFacilityCatalog([
  {
    facilityId: 'cave.facility.spirit_room',
    facilityName: '聚灵室',
    level: 1,
    requiredRealmGroup: 'QI',
    spiritStoneCost: '200',
    materialCosts: [
      { itemId: 'item.t1.qingzhu', quantity: '30' },
      { itemId: 'item.t2.lingsui', quantity: '0' },
    ],
    buildDurationUs: microseconds(7_200_000_000n),
    modifier: { stat: 'cultivation_xp', operation: 'MULTIPLY', value: '0.03' },
    scope: 'MVP',
  },
  {
    facilityId: 'cave.facility.spirit_room',
    facilityName: '聚灵室',
    level: 2,
    requiredRealmGroup: 'QI',
    spiritStoneCost: '700',
    materialCosts: [
      { itemId: 'item.t1.qingzhu', quantity: '80' },
      { itemId: 'item.t2.lingsui', quantity: '1' },
    ],
    buildDurationUs: microseconds(14_400_000_000n),
    modifier: { stat: 'cultivation_xp', operation: 'MULTIPLY', value: '0.04' },
    scope: 'MVP',
  },
  {
    facilityId: 'cave.facility.spirit_room',
    facilityName: '聚灵室',
    level: 3,
    requiredRealmGroup: 'FOUNDATION',
    spiritStoneCost: '2200',
    materialCosts: [
      { itemId: 'item.t1.qingzhu', quantity: '180' },
      { itemId: 'item.t2.lingsui', quantity: '3' },
    ],
    buildDurationUs: microseconds(21_600_000_000n),
    modifier: { stat: 'cultivation_xp', operation: 'MULTIPLY', value: '0.05' },
    scope: 'MVP',
  },
  {
    facilityId: 'cave.facility.spirit_room',
    facilityName: '聚灵室',
    level: 4,
    requiredRealmGroup: 'FOUNDATION',
    spiritStoneCost: '6500',
    materialCosts: [
      { itemId: 'item.t1.qingzhu', quantity: '400' },
      { itemId: 'item.t2.lingsui', quantity: '8' },
    ],
    buildDurationUs: microseconds(28_800_000_000n),
    modifier: { stat: 'cultivation_xp', operation: 'MULTIPLY', value: '0.06' },
    scope: 'MVP_ENDGAME',
  },
  {
    facilityId: 'cave.facility.alchemy_room',
    facilityName: '炼丹房',
    level: 1,
    requiredRealmGroup: 'QI',
    spiritStoneCost: '250',
    materialCosts: [
      { itemId: 'item.t1.qingzhu', quantity: '40' },
      { itemId: 'item.t1.chitong_kuang', quantity: '20' },
    ],
    buildDurationUs: microseconds(7_200_000_000n),
    modifier: { stat: 'alchemy_xp', operation: 'MULTIPLY', value: '0.04' },
    scope: 'MVP',
  },
  {
    facilityId: 'cave.facility.alchemy_room',
    facilityName: '炼丹房',
    level: 2,
    requiredRealmGroup: 'QI',
    spiritStoneCost: '800',
    materialCosts: [
      { itemId: 'item.t1.qingzhu', quantity: '100' },
      { itemId: 'item.t1.chitong_kuang', quantity: '60' },
    ],
    buildDurationUs: microseconds(14_400_000_000n),
    modifier: { stat: 'alchemy_xp', operation: 'MULTIPLY', value: '0.05' },
    scope: 'MVP',
  },
  {
    facilityId: 'cave.facility.alchemy_room',
    facilityName: '炼丹房',
    level: 3,
    requiredRealmGroup: 'FOUNDATION',
    spiritStoneCost: '2500',
    materialCosts: [
      { itemId: 'item.t1.qingzhu', quantity: '220' },
      { itemId: 'item.t1.chitong_kuang', quantity: '150' },
    ],
    buildDurationUs: microseconds(21_600_000_000n),
    modifier: { stat: 'alchemy_xp', operation: 'MULTIPLY', value: '0.06' },
    scope: 'MVP',
  },
  {
    facilityId: 'cave.facility.alchemy_room',
    facilityName: '炼丹房',
    level: 4,
    requiredRealmGroup: 'FOUNDATION',
    spiritStoneCost: '7200',
    materialCosts: [
      { itemId: 'item.t1.qingzhu', quantity: '500' },
      { itemId: 'item.t1.chitong_kuang', quantity: '350' },
    ],
    buildDurationUs: microseconds(28_800_000_000n),
    modifier: { stat: 'alchemy_xp', operation: 'MULTIPLY', value: '0.07' },
    scope: 'MVP_ENDGAME',
  },
  {
    facilityId: 'cave.facility.forge_room',
    facilityName: '炼器房',
    level: 1,
    requiredRealmGroup: 'QI',
    spiritStoneCost: '300',
    materialCosts: [
      { itemId: 'item.t1.tiemu', quantity: '20' },
      { itemId: 'item.t1.xuantie_kuang', quantity: '15' },
    ],
    buildDurationUs: microseconds(7_200_000_000n),
    modifier: { stat: 'refinement_xp', operation: 'MULTIPLY', value: '0.04' },
    scope: 'MVP',
  },
  {
    facilityId: 'cave.facility.forge_room',
    facilityName: '炼器房',
    level: 2,
    requiredRealmGroup: 'QI',
    spiritStoneCost: '900',
    materialCosts: [
      { itemId: 'item.t1.tiemu', quantity: '55' },
      { itemId: 'item.t1.xuantie_kuang', quantity: '50' },
    ],
    buildDurationUs: microseconds(14_400_000_000n),
    modifier: { stat: 'refinement_xp', operation: 'MULTIPLY', value: '0.05' },
    scope: 'MVP',
  },
  {
    facilityId: 'cave.facility.forge_room',
    facilityName: '炼器房',
    level: 3,
    requiredRealmGroup: 'FOUNDATION',
    spiritStoneCost: '2800',
    materialCosts: [
      { itemId: 'item.t1.tiemu', quantity: '130' },
      { itemId: 'item.t1.xuantie_kuang', quantity: '140' },
    ],
    buildDurationUs: microseconds(21_600_000_000n),
    modifier: { stat: 'refinement_xp', operation: 'MULTIPLY', value: '0.06' },
    scope: 'MVP',
  },
  {
    facilityId: 'cave.facility.forge_room',
    facilityName: '炼器房',
    level: 4,
    requiredRealmGroup: 'FOUNDATION',
    spiritStoneCost: '7800',
    materialCosts: [
      { itemId: 'item.t1.tiemu', quantity: '300' },
      { itemId: 'item.t1.xuantie_kuang', quantity: '360' },
    ],
    buildDurationUs: microseconds(28_800_000_000n),
    modifier: { stat: 'refinement_xp', operation: 'MULTIPLY', value: '0.07' },
    scope: 'MVP_ENDGAME',
  },
]);
