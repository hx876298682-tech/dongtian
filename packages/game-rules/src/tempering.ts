import Decimal from 'decimal.js';

import { decimal, type DecimalValue } from './decimal.js';
import { deriveScopedSeed, seedFromHex, Xoshiro128StarStar } from './random.js';

export type TemperingRuleScope = 'MVP' | 'ANCHOR';
export type TemperingFailureResult = 'KEEP_LEVEL';
export type TemperingAttemptStatus = 'APPLIED' | 'REJECTED';
export type TemperingAttemptOutcome = 'SUCCESS' | 'FAILURE' | 'REJECTED';

export type TemperingRuleInput = {
  readonly targetLevel: number;
  readonly successProbability: string;
  readonly attributeIncrease: string;
  readonly temperingStoneCost: string;
  readonly spiritStoneCost: string;
  readonly sameEquipmentCost: string;
  readonly protectionMaterialCost: string;
  readonly failureResult: TemperingFailureResult;
  readonly scope: TemperingRuleScope;
};

export type TemperingRule = TemperingRuleInput & {
  readonly cumulativeAttributeMultiplier: string;
};

export type TemperingAttemptInput = {
  readonly attemptId: string;
  readonly equipmentInstanceId: string;
  readonly fromLevel: number;
  readonly targetLevel: number;
  readonly useProtectionMaterial: boolean;
  readonly serverSeedHex: string;
  readonly configVersion: string;
  readonly formulaVersion: number;
};

export type TemperingRuleSnapshot = {
  readonly targetLevel: number;
  readonly successProbability: string;
  readonly attributeIncrease: string;
  readonly cumulativeAttributeMultiplier: string;
  readonly failureResult: TemperingFailureResult;
  readonly scope: TemperingRuleScope;
};

export type TemperingCostSnapshot = {
  readonly temperingStoneCost: string;
  readonly spiritStoneCost: string;
  readonly sameEquipmentCost: string;
  readonly protectionMaterialCostRequested: string;
  readonly protectionMaterialCostSpent: string;
};

export type TemperingRandomAudit = {
  readonly namespace: string;
  readonly attemptKey: string;
  readonly seedHex: string;
  readonly roll: string;
  readonly successProbability: string;
  readonly formulaVersion: number;
};

export type TemperingAttemptResult = {
  readonly attemptId: string;
  readonly equipmentInstanceId: string;
  readonly fromLevel: number;
  readonly targetLevel: number;
  readonly equipmentLevelBefore: number;
  readonly equipmentLevelAfter: number;
  readonly applied: boolean;
  readonly status: TemperingAttemptStatus;
  readonly outcome: TemperingAttemptOutcome;
  readonly success: boolean;
  readonly successProbability: string;
  readonly attributeIncrease: string;
  readonly attributeMultiplierBefore: string;
  readonly attributeMultiplierAfter: string;
  readonly costSnapshot: TemperingCostSnapshot;
  readonly ruleSnapshot: TemperingRuleSnapshot;
  readonly randomAudit: TemperingRandomAudit | null;
  readonly rejectionReason: string | null;
  readonly auditSummary: string;
};

const PRECISION = 80;
const TemperingDecimal = Decimal.clone({ precision: PRECISION, rounding: Decimal.ROUND_DOWN });
const TEMPERING_NAMESPACE = 'equipment.tempering' as const;
const MAX_MVP_LEVEL = 6;

function decimalValue(input: string | number | bigint): Decimal {
  const value = new TemperingDecimal(input);
  if (!value.isFinite()) {
    throw new Error('TEMPERING_DECIMAL_INVALID');
  }
  return value;
}

function requireTrimmedString(value: string, field: string): string {
  if (value.trim().length === 0) {
    throw new Error(`TEMPERING_${field}_REQUIRED`);
  }
  return value;
}

function requirePositiveInteger(value: number, field: string): number {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`TEMPERING_${field}_INVALID`);
  }
  return value;
}

function requireStrictPositiveInteger(value: number, field: string): number {
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`TEMPERING_${field}_INVALID`);
  }
  return value;
}

function decimalString(value: Decimal | DecimalValue): string {
  return value.toString().replace(/(?:\.0+|(\.\d*?)0+)$/, '$1').replace(/\.$/, '') || '0';
}

function requireNonNegativeDecimalString(value: string, field: string): string {
  const parsed = decimalValue(value);
  if (parsed.isNegative()) {
    throw new Error(`TEMPERING_${field}_NEGATIVE`);
  }
  return decimalString(parsed);
}

function requireProbabilityString(value: string, field: string): string {
  const parsed = decimalValue(value);
  if (parsed.lt(0) || parsed.gt(1)) {
    throw new Error(`TEMPERING_${field}_OUT_OF_RANGE`);
  }
  return decimalString(parsed);
}

function formatSeedHex(bytes: Uint8Array): string {
  return [...bytes].map((value) => value.toString(16).padStart(2, '0')).join('');
}

function copyRuleInput(rule: TemperingRuleInput): TemperingRuleInput {
  return {
    targetLevel: requirePositiveInteger(rule.targetLevel, 'TARGET_LEVEL'),
    successProbability: requireProbabilityString(requireTrimmedString(rule.successProbability, 'SUCCESS_PROBABILITY'), 'SUCCESS_PROBABILITY'),
    attributeIncrease: requireNonNegativeDecimalString(requireTrimmedString(rule.attributeIncrease, 'ATTRIBUTE_INCREASE'), 'ATTRIBUTE_INCREASE'),
    temperingStoneCost: requireNonNegativeDecimalString(requireTrimmedString(rule.temperingStoneCost, 'TEMPERING_STONE_COST'), 'TEMPERING_STONE_COST'),
    spiritStoneCost: requireNonNegativeDecimalString(requireTrimmedString(rule.spiritStoneCost, 'SPIRIT_STONE_COST'), 'SPIRIT_STONE_COST'),
    sameEquipmentCost: requireNonNegativeDecimalString(requireTrimmedString(rule.sameEquipmentCost, 'SAME_EQUIPMENT_COST'), 'SAME_EQUIPMENT_COST'),
    protectionMaterialCost: requireNonNegativeDecimalString(requireTrimmedString(rule.protectionMaterialCost, 'PROTECTION_MATERIAL_COST'), 'PROTECTION_MATERIAL_COST'),
    failureResult: rule.failureResult,
    scope: rule.scope,
  };
}

export function createTemperingRules(rules: readonly TemperingRuleInput[]): readonly TemperingRule[] {
  if (rules.length === 0) {
    throw new Error('TEMPERING_RULES_EMPTY');
  }

  const ordered = [...rules].map(copyRuleInput).sort((left, right) => left.targetLevel - right.targetLevel);
  const levels = new Set<number>();
  let cumulativeMultiplier = decimal('1');

  return ordered.map((rule, index) => {
    if (levels.has(rule.targetLevel)) {
      throw new Error(`TEMPERING_DUPLICATE_LEVEL:${rule.targetLevel}`);
    }
    levels.add(rule.targetLevel);
    const expectedLevel = index + 1;
    if (rule.targetLevel !== expectedLevel) {
      throw new Error(`TEMPERING_LEVEL_GAP:${rule.targetLevel}`);
    }
    if (rule.failureResult !== 'KEEP_LEVEL') {
      throw new Error(`TEMPERING_FAILURE_RESULT_UNSUPPORTED:${rule.failureResult}`);
    }
    if (rule.scope !== 'MVP' && rule.scope !== 'ANCHOR') {
      throw new Error(`TEMPERING_SCOPE_INVALID:${rule.scope}`);
    }

    cumulativeMultiplier = cumulativeMultiplier.multiply(decimal('1').add(rule.attributeIncrease));
    return {
      ...rule,
      cumulativeAttributeMultiplier: cumulativeMultiplier.toString(),
    };
  });
}

export const temperingRules = createTemperingRules([
  {
    targetLevel: 1,
    successProbability: '0.95',
    attributeIncrease: '0.04',
    temperingStoneCost: '1',
    spiritStoneCost: '20',
    sameEquipmentCost: '0',
    protectionMaterialCost: '0',
    failureResult: 'KEEP_LEVEL',
    scope: 'MVP',
  },
  {
    targetLevel: 2,
    successProbability: '0.85',
    attributeIncrease: '0.045',
    temperingStoneCost: '1',
    spiritStoneCost: '34',
    sameEquipmentCost: '0',
    protectionMaterialCost: '0',
    failureResult: 'KEEP_LEVEL',
    scope: 'MVP',
  },
  {
    targetLevel: 3,
    successProbability: '0.72',
    attributeIncrease: '0.05',
    temperingStoneCost: '2',
    spiritStoneCost: '57.8',
    sameEquipmentCost: '0',
    protectionMaterialCost: '0',
    failureResult: 'KEEP_LEVEL',
    scope: 'MVP',
  },
  {
    targetLevel: 4,
    successProbability: '0.58',
    attributeIncrease: '0.055',
    temperingStoneCost: '2',
    spiritStoneCost: '98.26',
    sameEquipmentCost: '0',
    protectionMaterialCost: '0',
    failureResult: 'KEEP_LEVEL',
    scope: 'MVP',
  },
  {
    targetLevel: 5,
    successProbability: '0.45',
    attributeIncrease: '0.06',
    temperingStoneCost: '3',
    spiritStoneCost: '167.04199999999997',
    sameEquipmentCost: '0',
    protectionMaterialCost: '0',
    failureResult: 'KEEP_LEVEL',
    scope: 'MVP',
  },
  {
    targetLevel: 6,
    successProbability: '0.34',
    attributeIncrease: '0.065',
    temperingStoneCost: '3',
    spiritStoneCost: '283.97139999999996',
    sameEquipmentCost: '100',
    protectionMaterialCost: '0',
    failureResult: 'KEEP_LEVEL',
    scope: 'MVP',
  },
  {
    targetLevel: 7,
    successProbability: '0.25',
    attributeIncrease: '0.07',
    temperingStoneCost: '4',
    spiritStoneCost: '482.7513799999999',
    sameEquipmentCost: '200',
    protectionMaterialCost: '0',
    failureResult: 'KEEP_LEVEL',
    scope: 'ANCHOR',
  },
  {
    targetLevel: 8,
    successProbability: '0.18',
    attributeIncrease: '0.07500000000000001',
    temperingStoneCost: '4',
    spiritStoneCost: '820.6773459999998',
    sameEquipmentCost: '300',
    protectionMaterialCost: '30',
    failureResult: 'KEEP_LEVEL',
    scope: 'ANCHOR',
  },
  {
    targetLevel: 9,
    successProbability: '0.12',
    attributeIncrease: '0.08',
    temperingStoneCost: '5',
    spiritStoneCost: '1395.1514881999997',
    sameEquipmentCost: '400',
    protectionMaterialCost: '60',
    failureResult: 'KEEP_LEVEL',
    scope: 'ANCHOR',
  },
  {
    targetLevel: 10,
    successProbability: '0.08',
    attributeIncrease: '0.08499999999999999',
    temperingStoneCost: '5',
    spiritStoneCost: '2371.7575299399996',
    sameEquipmentCost: '500',
    protectionMaterialCost: '90',
    failureResult: 'KEEP_LEVEL',
    scope: 'ANCHOR',
  },
] as const);

function getRuleByTargetLevel(
  targetLevel: number,
  rules: readonly TemperingRule[],
): TemperingRule {
  const rule = rules.find((entry) => entry.targetLevel === targetLevel);
  if (rule === undefined) {
    throw new Error(`TEMPERING_TARGET_LEVEL_UNAVAILABLE:${targetLevel}`);
  }
  return rule;
}

function assertNoClientResultFields(input: TemperingAttemptInput & Record<string, unknown>): void {
  const forbidden = ['success', 'outcome', 'status', 'roll', 'randomAudit', 'resolvedOutcome', 'result'];
  for (const key of forbidden) {
    if (Object.prototype.hasOwnProperty.call(input, key)) {
      throw new Error(`TEMPERING_CLIENT_RESULT_FORBIDDEN:${key}`);
    }
  }
}

function normalizeAttemptKey(input: TemperingAttemptInput): string {
  return `${input.attemptId}:${input.equipmentInstanceId}:${input.fromLevel}->${input.targetLevel}`;
}

function rollAttempt(seedHex: string): DecimalValue {
  const seed = seedFromHex(seedHex);
  const random = new Xoshiro128StarStar(seed);
  return random.nextUnit();
}

function auditSummary(result: TemperingAttemptResult): string {
  const parts = [
    'tempering_attempt',
    `attempt=${result.attemptId}`,
    `equipment=${result.equipmentInstanceId}`,
    `from=${result.fromLevel}`,
    `to=${result.targetLevel}`,
    `status=${result.status}`,
    `outcome=${result.outcome}`,
    `success=${result.success}`,
    `before=${result.equipmentLevelBefore}`,
    `after=${result.equipmentLevelAfter}`,
    `prob=${result.successProbability}`,
  ];
  if (result.randomAudit !== null) {
    parts.push(`seed=${result.randomAudit.seedHex}`, `roll=${result.randomAudit.roll}`);
  } else {
    parts.push(`reason=${result.rejectionReason ?? 'NONE'}`);
  }
  return parts.join('|');
}

export function resolveTemperingAttempt(
  input: TemperingAttemptInput,
  rules: readonly TemperingRule[] = temperingRules,
): TemperingAttemptResult {
  assertNoClientResultFields(input as TemperingAttemptInput & Record<string, unknown>);
  requireTrimmedString(input.attemptId, 'ATTEMPT_ID');
  requireTrimmedString(input.equipmentInstanceId, 'EQUIPMENT_INSTANCE_ID');
  requireStrictPositiveInteger(input.formulaVersion, 'FORMULA_VERSION');
  if (input.fromLevel < 0 || input.fromLevel > 9 || !Number.isInteger(input.fromLevel)) {
    throw new Error('TEMPERING_FROM_LEVEL_INVALID');
  }
  if (input.targetLevel < 1 || input.targetLevel > 10 || !Number.isInteger(input.targetLevel)) {
    throw new Error('TEMPERING_TARGET_LEVEL_INVALID');
  }
  if (input.targetLevel !== input.fromLevel + 1) {
    throw new Error('TEMPERING_TARGET_LEVEL_MUST_BE_NEXT');
  }
  requireTrimmedString(input.configVersion, 'CONFIG_VERSION');
  seedFromHex(input.serverSeedHex);

  const rule = getRuleByTargetLevel(input.targetLevel, rules);
  const beforeMultiplier = input.fromLevel === 0
    ? decimal('1')
    : decimal(getRuleByTargetLevel(input.fromLevel, rules).cumulativeAttributeMultiplier);
  const costSnapshot: TemperingCostSnapshot = {
    temperingStoneCost: rule.temperingStoneCost,
    spiritStoneCost: rule.spiritStoneCost,
    sameEquipmentCost: rule.sameEquipmentCost,
    protectionMaterialCostRequested: rule.protectionMaterialCost,
    protectionMaterialCostSpent: input.useProtectionMaterial ? rule.protectionMaterialCost : '0',
  };
  const ruleSnapshot: TemperingRuleSnapshot = {
    targetLevel: rule.targetLevel,
    successProbability: rule.successProbability,
    attributeIncrease: rule.attributeIncrease,
    cumulativeAttributeMultiplier: rule.cumulativeAttributeMultiplier,
    failureResult: rule.failureResult,
    scope: rule.scope,
  };

  if (rule.scope === 'ANCHOR' || rule.targetLevel > MAX_MVP_LEVEL) {
    const result: TemperingAttemptResult = {
      attemptId: input.attemptId,
      equipmentInstanceId: input.equipmentInstanceId,
      fromLevel: input.fromLevel,
      targetLevel: input.targetLevel,
      equipmentLevelBefore: input.fromLevel,
      equipmentLevelAfter: input.fromLevel,
      applied: false,
      status: 'REJECTED',
      outcome: 'REJECTED',
      success: false,
      successProbability: rule.successProbability,
      attributeIncrease: rule.attributeIncrease,
      attributeMultiplierBefore: beforeMultiplier.toString(),
      attributeMultiplierAfter: beforeMultiplier.toString(),
      costSnapshot,
      ruleSnapshot,
      randomAudit: null,
      rejectionReason: 'TEMPERING_LEVEL_LOCKED',
      auditSummary: '',
    };
    return {
      ...result,
      auditSummary: auditSummary(result),
    };
  }

  const attemptKey = normalizeAttemptKey(input);
  const scopedSeed = deriveScopedSeed(
    seedFromHex(input.serverSeedHex),
    TEMPERING_NAMESPACE,
    attemptKey,
    `${input.configVersion}:${input.formulaVersion}`,
  );
  const roll = rollAttempt(formatSeedHex(scopedSeed));
  const successProbability = decimal(rule.successProbability);
  const success = successProbability.value.gte(1)
    ? true
    : successProbability.value.lte(0)
      ? false
      : roll.value.lt(successProbability.value);
  const afterMultiplier = success
    ? decimal(rule.cumulativeAttributeMultiplier)
    : beforeMultiplier;
  const randomAudit: TemperingRandomAudit = {
    namespace: TEMPERING_NAMESPACE,
    attemptKey,
    seedHex: formatSeedHex(scopedSeed),
    roll: roll.toString(),
    successProbability: rule.successProbability,
    formulaVersion: input.formulaVersion,
  };
  const result: TemperingAttemptResult = {
    attemptId: input.attemptId,
    equipmentInstanceId: input.equipmentInstanceId,
    fromLevel: input.fromLevel,
    targetLevel: input.targetLevel,
    equipmentLevelBefore: input.fromLevel,
    equipmentLevelAfter: success ? input.targetLevel : input.fromLevel,
    applied: true,
    status: 'APPLIED',
    outcome: success ? 'SUCCESS' : 'FAILURE',
    success,
    successProbability: rule.successProbability,
    attributeIncrease: rule.attributeIncrease,
    attributeMultiplierBefore: beforeMultiplier.toString(),
    attributeMultiplierAfter: afterMultiplier.toString(),
    costSnapshot,
    ruleSnapshot,
    randomAudit,
    rejectionReason: null,
    auditSummary: '',
  };

  return {
    ...result,
    auditSummary: auditSummary(result),
  };
}

export function isTemperingAttemptAllowed(targetLevel: number): boolean {
  return targetLevel >= 1 && targetLevel <= MAX_MVP_LEVEL;
}
