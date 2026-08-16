import Decimal from 'decimal.js';

import { decimal, type DecimalInput } from './decimal.js';

export type BreakthroughStatus =
  | 'READY'
  | 'TRIAL_ACTIVE'
  | 'TRIAL_WAITING_CHOICE'
  | 'COMPLETED'
  | 'FAILED_RECOVERABLE'
  | 'ABANDONED';

export type BreakthroughConditionStatus = 'SATISFIED' | 'MISSING';

export type BreakthroughAssetBalance = {
  readonly total: string;
  readonly reserved: string;
};

export type BreakthroughRequirementPreview = {
  readonly assetType: 'CULTIVATION_XP' | 'ITEM' | 'CURRENCY';
  readonly assetId: string;
  readonly current: string;
  readonly total: string;
  readonly reserved: string;
  readonly available: string;
  readonly required: string;
  readonly status: BreakthroughConditionStatus;
  readonly shortfall: string;
  readonly sourceRouteId: string;
  readonly estimatedTimeSeconds: string | null;
};

export type BreakthroughConfig = {
  readonly breakthroughConfigId: string;
  readonly targetRealmId: string;
  readonly configVersion: string;
  readonly formulaVersion: number;
  readonly targetCultivationXp: string;
  readonly assetCoverageMultiplier: string;
  readonly trialDurationUs: string;
  readonly reservationExpiryUs: string;
  readonly unlockBundleId: string;
  readonly successRate: string;
  readonly requirements: readonly BreakthroughRequirementDefinition[];
  readonly choices: readonly BreakthroughRouteChoice[];
};

export type BreakthroughRequirementDefinition = {
  readonly assetType: 'CULTIVATION_XP' | 'ITEM' | 'CURRENCY';
  readonly assetId: string;
  readonly required: string;
  readonly sourceRouteId: string;
};

export type BreakthroughRouteChoice = {
  readonly choiceId: string;
  readonly routeId: string;
  readonly labelKey: string;
  readonly risk: 'SAFE' | 'HIGH_RISK';
};

export type BreakthroughPreviewInput = {
  readonly config: BreakthroughConfig;
  readonly cultivationXp: DecimalInput;
  readonly items: Readonly<Record<string, BreakthroughAssetBalance | undefined>>;
  readonly currencies: Readonly<Record<string, BreakthroughAssetBalance | undefined>>;
  readonly sourceSecondsPerUnitByRouteId?: Readonly<Record<string, string>>;
};

export type BreakthroughPreviewResult = {
  readonly breakthroughConfigId: string;
  readonly targetRealmId: string;
  readonly configVersion: string;
  readonly formulaVersion: number;
  readonly successRate: string;
  readonly allSatisfied: boolean;
  readonly requirements: readonly BreakthroughRequirementPreview[];
  readonly unlockBundleId: string;
};

export type BreakthroughReservedAsset = {
  readonly assetType: 'ITEM' | 'CURRENCY';
  readonly assetId: string;
  readonly quantity: string;
};

export type BreakthroughRunState = {
  readonly breakthroughRunId: string;
  readonly characterId: string;
  readonly breakthroughConfigId: string;
  readonly status: BreakthroughStatus;
  readonly runVersion: bigint;
  readonly currentNodeId: string;
  readonly createdAtUs: string;
  readonly trialDeadlineAtUs: string;
  readonly expiresAtUs: string;
  readonly selectedChoiceId: string | null;
  readonly selectedRouteId: string | null;
  readonly selectedRouteRisk: 'SAFE' | 'HIGH_RISK' | null;
  readonly selectedAtUs: string | null;
  readonly finalizedAtUs: string | null;
  readonly abandonedAtUs: string | null;
  readonly releasedAtUs: string | null;
  readonly reservationSnapshot: readonly BreakthroughReservedAsset[];
  readonly previewSnapshot: BreakthroughPreviewResult;
  readonly result: BreakthroughFinalizeResult | null;
};

export type BreakthroughFinalizeResult = {
  readonly breakthroughRunId: string;
  readonly breakthroughConfigId: string;
  readonly successRate: string;
  readonly unlockedRealmId: string;
  readonly unlockBundleId: string;
  readonly queueSlots: number;
  readonly medicineSlots: number;
  readonly reservedAssets: readonly BreakthroughReservedAsset[];
};

export type BreakthroughStartInput = {
  readonly runId: string;
  readonly characterId: string;
  readonly startedAtUs: bigint;
  readonly preview: BreakthroughPreviewResult;
  readonly config: BreakthroughConfig;
  readonly existingRun?: BreakthroughRunState | null;
};

export type BreakthroughChoiceInput = {
  readonly run: BreakthroughRunState;
  readonly choiceId: string;
  readonly chosenAtUs: bigint;
  readonly expectedRunVersion: bigint;
};

export type BreakthroughRecoveryInput = {
  readonly run: BreakthroughRunState;
  readonly restoredAtUs: bigint;
};

export type BreakthroughFinalizeEligibility = {
  readonly eligible: boolean;
  readonly reason:
    | 'FINALIZE_READY'
    | 'MISSING_CHOICE'
    | 'TOO_EARLY'
    | 'EXPIRED'
    | 'NOT_ACTIVE'
    | 'ALREADY_COMPLETED'
    | 'ABANDONED';
  readonly trialReadyAtUs: string;
  readonly expiresAtUs: string;
};

const CULTIVATION_ROUTE_ID = 'action.cultivation.qi';
const FOUNDATION_PILL_ROUTE_ID = 'recipe.t1.foundation_pill';
const LINGSUI_ROUTE_ID = 'route.t1.qingshe_cave.safe_exit';
const MERIDIAN_PILL_ROUTE_ID = 'recipe.t1.meridian_pill';
const SPIRIT_STONE_ROUTE_ID = 'route.t1.qingshe_cave.deep_den';

const CULTIVATION_XP_PER_SECOND = new Decimal('0.075');

export const foundationBreakthroughConfig: BreakthroughConfig = {
  breakthroughConfigId: 'breakthrough.foundation.early',
  targetRealmId: 'realm.foundation.early',
  configVersion: '2026.08.16.1',
  formulaVersion: 1,
  targetCultivationXp: '24100',
  assetCoverageMultiplier: '1',
  trialDurationUs: '900000000',
  reservationExpiryUs: '86400000000',
  unlockBundleId: 'unlock.foundation.early',
  successRate: '1',
  requirements: [
    {
      assetType: 'CULTIVATION_XP',
      assetId: 'cultivation_xp',
      required: '24100',
      sourceRouteId: CULTIVATION_ROUTE_ID,
    },
    {
      assetType: 'ITEM',
      assetId: 'item.t1.foundation_pill',
      required: '1',
      sourceRouteId: FOUNDATION_PILL_ROUTE_ID,
    },
    {
      assetType: 'ITEM',
      assetId: 'item.t2.lingsui',
      required: '3',
      sourceRouteId: LINGSUI_ROUTE_ID,
    },
    {
      assetType: 'ITEM',
      assetId: 'item.t1.meridian_pill',
      required: '2',
      sourceRouteId: MERIDIAN_PILL_ROUTE_ID,
    },
    {
      assetType: 'CURRENCY',
      assetId: 'currency.spirit_stone',
      required: '2500',
      sourceRouteId: SPIRIT_STONE_ROUTE_ID,
    },
  ],
  choices: [
    {
      choiceId: 'choice.breakthrough.foundation.safe_exit',
      routeId: LINGSUI_ROUTE_ID,
      labelKey: 'breakthrough.choice.safe_exit',
      risk: 'SAFE',
    },
    {
      choiceId: 'choice.breakthrough.foundation.deep_den',
      routeId: SPIRIT_STONE_ROUTE_ID,
      labelKey: 'breakthrough.choice.deep_den',
      risk: 'HIGH_RISK',
    },
  ],
};

function fail(reason: string): never {
  throw new Error(`BREAKTHROUGH_${reason}`);
}

function positiveDecimalOrFail(value: DecimalInput, field: string): Decimal {
  const parsed = decimal(value).value;
  if (parsed.isNaN() || !parsed.isFinite() || parsed.isNegative()) {
    fail(`${field}_INVALID`);
  }
  return parsed;
}

function nonNegativeIntegerOrFail(value: string, field: string): bigint {
  if (!/^(?:0|[1-9]\d*)$/.test(value)) {
    fail(`${field}_INVALID`);
  }
  return BigInt(value);
}

function zeroIfNegative(value: Decimal): Decimal {
  return value.isNegative() ? new Decimal(0) : value;
}

function formatDecimal(value: DecimalInput): string {
  return decimal(value).toString();
}

function getBalance(
  balances: Readonly<Record<string, BreakthroughAssetBalance | undefined>>,
  assetId: string,
): BreakthroughAssetBalance {
  return balances[assetId] ?? { total: '0', reserved: '0' };
}

function availableBalance(total: Decimal, reserved: Decimal): Decimal {
  if (reserved.gt(total)) {
    fail('RESERVED_EXCEEDS_TOTAL');
  }
  return total.minus(reserved);
}

function requirementStatus(
  input: BreakthroughPreviewInput,
  definition: BreakthroughRequirementDefinition,
): BreakthroughRequirementPreview {
  if (definition.assetType === 'CULTIVATION_XP') {
    const current = positiveDecimalOrFail(input.cultivationXp, 'CULTIVATION_XP');
    const required = positiveDecimalOrFail(definition.required, 'REQUIRED');
    const shortfall = zeroIfNegative(required.minus(current));
    const status = current.gte(required) ? 'SATISFIED' : 'MISSING';
    const estimatedTimeSeconds = status === 'SATISFIED'
      ? '0'
      : formatEstimatedCultivationTimeSeconds(shortfall);
    return {
      assetType: definition.assetType,
      assetId: definition.assetId,
      current: formatDecimal(current),
      total: formatDecimal(current),
      reserved: '0',
      available: formatDecimal(current),
      required: formatDecimal(required),
      status,
      shortfall: formatDecimal(shortfall),
      sourceRouteId: definition.sourceRouteId,
      estimatedTimeSeconds,
    };
  }

  const balances = definition.assetType === 'ITEM' ? input.items : input.currencies;
  const balance = getBalance(balances, definition.assetId);
  const total = positiveDecimalOrFail(balance.total, `${definition.assetId}.TOTAL`);
  const reserved = positiveDecimalOrFail(balance.reserved, `${definition.assetId}.RESERVED`);
  const available = availableBalance(total, reserved);
  const required = positiveDecimalOrFail(definition.required, 'REQUIRED');
  const shortfall = zeroIfNegative(required.minus(available));
  const status = available.gte(required) ? 'SATISFIED' : 'MISSING';
  const routeEtaSeconds = input.sourceSecondsPerUnitByRouteId?.[definition.sourceRouteId];
  const estimatedTimeSeconds = status === 'SATISFIED'
    ? '0'
    : routeEtaSeconds === undefined
      ? null
      : formatDecimal(shortfall.times(positiveDecimalOrFail(routeEtaSeconds, 'SOURCE_SECONDS_PER_UNIT')));

  return {
    assetType: definition.assetType,
    assetId: definition.assetId,
    current: formatDecimal(available),
    total: formatDecimal(total),
    reserved: formatDecimal(reserved),
    available: formatDecimal(available),
    required: formatDecimal(required),
    status,
    shortfall: formatDecimal(shortfall),
    sourceRouteId: definition.sourceRouteId,
    estimatedTimeSeconds,
  };
}

function formatEstimatedCultivationTimeSeconds(shortfall: Decimal): string {
  if (shortfall.isZero()) {
    return '0';
  }
  const estimated = new Decimal(shortfall.toString()).dividedBy(CULTIVATION_XP_PER_SECOND).ceil();
  return formatDecimal(estimated);
}

export function previewBreakthrough(input: BreakthroughPreviewInput): BreakthroughPreviewResult {
  const requirements = input.config.requirements.map((definition) => requirementStatus(input, definition));
  const allSatisfied = requirements.every((requirement) => requirement.status === 'SATISFIED');
  return {
    breakthroughConfigId: input.config.breakthroughConfigId,
    targetRealmId: input.config.targetRealmId,
    configVersion: input.config.configVersion,
    formulaVersion: input.config.formulaVersion,
    successRate: allSatisfied ? input.config.successRate : '0',
    allSatisfied,
    requirements,
    unlockBundleId: input.config.unlockBundleId,
  };
}

function buildReservationSnapshot(config: BreakthroughConfig): readonly BreakthroughReservedAsset[] {
  return config.requirements
    .filter((requirement): requirement is BreakthroughRequirementDefinition & {
      readonly assetType: 'ITEM' | 'CURRENCY';
    } => requirement.assetType !== 'CULTIVATION_XP')
    .map((requirement) => ({
      assetType: requirement.assetType,
      assetId: requirement.assetId,
      quantity: requirement.required,
    }));
}

function isTerminal(status: BreakthroughStatus): boolean {
  return status === 'COMPLETED' || status === 'FAILED_RECOVERABLE' || status === 'ABANDONED';
}

function assertActiveRun(run: BreakthroughRunState): void {
  if (isTerminal(run.status)) {
    fail('RUN_NOT_ACTIVE');
  }
}

function nextVersion(runVersion: bigint): bigint {
  return runVersion + 1n;
}

export function startBreakthroughTrial(input: BreakthroughStartInput): {
  readonly run: BreakthroughRunState;
  readonly idempotent: boolean;
} {
  if (input.preview.breakthroughConfigId !== input.config.breakthroughConfigId) {
    fail('PREVIEW_CONFIG_MISMATCH');
  }
  if (input.preview.targetRealmId !== input.config.targetRealmId) {
    fail('PREVIEW_REALM_MISMATCH');
  }
  if (input.preview.configVersion !== input.config.configVersion || input.preview.formulaVersion !== input.config.formulaVersion) {
    fail('PREVIEW_VERSION_MISMATCH');
  }
  if (!input.preview.allSatisfied) {
    fail('REQUIREMENTS_NOT_MET');
  }

  const existingRun = input.existingRun;
  if (existingRun !== undefined && existingRun !== null) {
    if (existingRun.breakthroughConfigId !== input.config.breakthroughConfigId) {
      fail('EXISTING_RUN_CONFIG_MISMATCH');
    }
    if (existingRun.characterId !== input.characterId) {
      fail('EXISTING_RUN_CHARACTER_MISMATCH');
    }
    if (!isTerminal(existingRun.status)) {
      return { run: existingRun, idempotent: true };
    }
  }

  const startedAtUs = BigInt(input.startedAtUs);
  const trialDurationUs = nonNegativeIntegerOrFail(input.config.trialDurationUs, 'TRIAL_DURATION');
  const expiresAfterUs = nonNegativeIntegerOrFail(input.config.reservationExpiryUs, 'RESERVATION_EXPIRY');
  const reservationSnapshot = buildReservationSnapshot(input.config);
  const run: BreakthroughRunState = {
    breakthroughRunId: input.runId,
    characterId: input.characterId,
    breakthroughConfigId: input.config.breakthroughConfigId,
    status: 'TRIAL_ACTIVE',
    runVersion: 0n,
    currentNodeId: 'TRIAL_ACTIVE',
    createdAtUs: startedAtUs.toString(),
    trialDeadlineAtUs: (startedAtUs + trialDurationUs).toString(),
    expiresAtUs: (startedAtUs + expiresAfterUs).toString(),
    selectedChoiceId: null,
    selectedRouteId: null,
    selectedRouteRisk: null,
    selectedAtUs: null,
    finalizedAtUs: null,
    abandonedAtUs: null,
    releasedAtUs: null,
    reservationSnapshot,
    previewSnapshot: input.preview,
    result: null,
  };
  return { run, idempotent: false };
}

export function selectBreakthroughRoute(input: BreakthroughChoiceInput): {
  readonly run: BreakthroughRunState;
  readonly idempotent: boolean;
} {
  assertActiveRun(input.run);
  if (input.run.selectedChoiceId !== null) {
    if (input.run.selectedChoiceId === input.choiceId) {
      return { run: input.run, idempotent: true };
    }
    fail('CHOICE_ALREADY_SELECTED');
  }
  const selectedChoice = foundationBreakthroughConfig.choices.find((item) => item.choiceId === input.choiceId);
  if (selectedChoice === undefined) {
    fail('CHOICE_UNKNOWN');
  }
  if (input.expectedRunVersion !== input.run.runVersion) {
    fail('RUN_VERSION_CONFLICT');
  }
  const run: BreakthroughRunState = {
    ...input.run,
    status: 'TRIAL_WAITING_CHOICE',
    runVersion: nextVersion(input.run.runVersion),
    selectedChoiceId: selectedChoice.choiceId,
    selectedRouteId: selectedChoice.routeId,
    selectedRouteRisk: selectedChoice.risk,
    selectedAtUs: BigInt(input.chosenAtUs).toString(),
    currentNodeId: 'TRIAL_WAITING_CHOICE',
  };
  return { run, idempotent: false };
}

export function evaluateBreakthroughFinalizeEligibility(input: BreakthroughRecoveryInput): BreakthroughFinalizeEligibility {
  const run = input.run;
  if (run.status === 'COMPLETED') {
    return {
      eligible: false,
      reason: 'ALREADY_COMPLETED',
      trialReadyAtUs: run.trialDeadlineAtUs,
      expiresAtUs: run.expiresAtUs,
    };
  }
  if (run.status === 'ABANDONED') {
    return {
      eligible: false,
      reason: 'ABANDONED',
      trialReadyAtUs: run.trialDeadlineAtUs,
      expiresAtUs: run.expiresAtUs,
    };
  }
  if (run.status === 'FAILED_RECOVERABLE') {
    return {
      eligible: false,
      reason: 'EXPIRED',
      trialReadyAtUs: run.trialDeadlineAtUs,
      expiresAtUs: run.expiresAtUs,
    };
  }
  const restoredAtUs = BigInt(input.restoredAtUs);
  if (restoredAtUs >= BigInt(run.expiresAtUs)) {
    return {
      eligible: false,
      reason: 'EXPIRED',
      trialReadyAtUs: run.trialDeadlineAtUs,
      expiresAtUs: run.expiresAtUs,
    };
  }
  if (run.selectedChoiceId === null) {
    return {
      eligible: false,
      reason: 'MISSING_CHOICE',
      trialReadyAtUs: run.trialDeadlineAtUs,
      expiresAtUs: run.expiresAtUs,
    };
  }
  if (restoredAtUs < BigInt(run.trialDeadlineAtUs)) {
    return {
      eligible: false,
      reason: 'TOO_EARLY',
      trialReadyAtUs: run.trialDeadlineAtUs,
      expiresAtUs: run.expiresAtUs,
    };
  }
  return {
    eligible: true,
    reason: 'FINALIZE_READY',
    trialReadyAtUs: run.trialDeadlineAtUs,
    expiresAtUs: run.expiresAtUs,
  };
}

function finalizeResult(run: BreakthroughRunState): BreakthroughFinalizeResult {
  return {
    breakthroughRunId: run.breakthroughRunId,
    breakthroughConfigId: run.breakthroughConfigId,
    successRate: run.previewSnapshot.successRate,
    unlockedRealmId: run.previewSnapshot.targetRealmId,
    unlockBundleId: run.previewSnapshot.unlockBundleId,
    queueSlots: 3,
    medicineSlots: 3,
    reservedAssets: run.reservationSnapshot,
  };
}

export function restoreBreakthroughRun(input: BreakthroughRecoveryInput): {
  readonly run: BreakthroughRunState;
  readonly eligibility: BreakthroughFinalizeEligibility;
} {
  const eligibility = evaluateBreakthroughFinalizeEligibility(input);
  if (eligibility.reason === 'EXPIRED' && input.run.status !== 'COMPLETED' && input.run.status !== 'ABANDONED') {
    return {
      run: {
        ...input.run,
        status: 'FAILED_RECOVERABLE',
        currentNodeId: 'READY',
        runVersion: nextVersion(input.run.runVersion),
        releasedAtUs: BigInt(input.restoredAtUs).toString(),
      },
      eligibility,
    };
  }
  return { run: input.run, eligibility };
}

export function abandonBreakthroughRun(input: BreakthroughRecoveryInput): {
  readonly run: BreakthroughRunState;
  readonly idempotent: boolean;
} {
  if (input.run.status === 'ABANDONED') {
    return { run: input.run, idempotent: true };
  }
  assertActiveRun(input.run);
  return {
    run: {
      ...input.run,
      status: 'ABANDONED',
      currentNodeId: 'READY',
      runVersion: nextVersion(input.run.runVersion),
      abandonedAtUs: BigInt(input.restoredAtUs).toString(),
      releasedAtUs: BigInt(input.restoredAtUs).toString(),
    },
    idempotent: false,
  };
}

export function finalizeBreakthroughRun(input: BreakthroughRecoveryInput): {
  readonly run: BreakthroughRunState;
  readonly idempotent: boolean;
} {
  const eligibility = evaluateBreakthroughFinalizeEligibility(input);
  if (!eligibility.eligible) {
    if (input.run.status === 'COMPLETED') {
      return { run: input.run, idempotent: true };
    }
    fail(eligibility.reason);
  }
  if (input.run.result !== null && input.run.status === 'COMPLETED') {
    return { run: input.run, idempotent: true };
  }
  const finalizedAtUs = BigInt(input.restoredAtUs).toString();
  return {
    run: {
      ...input.run,
      status: 'COMPLETED',
      currentNodeId: 'COMPLETED',
      runVersion: nextVersion(input.run.runVersion),
      finalizedAtUs,
      result: finalizeResult(input.run),
    },
    idempotent: false,
  };
}
