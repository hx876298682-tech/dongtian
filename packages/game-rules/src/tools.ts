import { applyModifiers, type Modifier } from './modifiers.js';
import { calculateCycleCount, type CycleInputLimit } from './cycles.js';
import { decimal } from './decimal.js';
import { microseconds, type Microseconds } from './time.js';

export type ToolTag = 'herbalism_tool' | 'mining_tool' | 'alchemy_tool';
export type ToolSkillId = 'skill.herbalism' | 'skill.mining' | 'skill.alchemy';
export type ToolActionStat = 'action_speed' | 'action_efficiency';

export type ToolProfile = {
  readonly itemId: string;
  readonly toolTag: ToolTag;
  readonly skillId: ToolSkillId;
};

export type ToolLoadoutInput = ToolProfile & {
  readonly speedModifiers?: readonly Modifier[];
  readonly efficiencyModifiers?: readonly Modifier[];
};

export type ToolLoadout = ToolProfile & {
  readonly speedModifiers: readonly Modifier[];
  readonly efficiencyModifiers: readonly Modifier[];
  readonly speedMultiplier: string;
  readonly efficiencyMultiplier: string;
};

export type ToolCycleProjectionInput = {
  readonly requiredToolTag: ToolTag | null;
  readonly baseDurationUs: Microseconds;
  readonly availableTimeUs: Microseconds;
  readonly currentLoadout: ToolLoadout | null;
  readonly nextLoadout?: ToolLoadout | null;
  readonly inputLimits?: readonly CycleInputLimit[];
  readonly targetCycles?: bigint;
};

export type ToolPhaseProjection = {
  readonly loadout: ToolLoadout | null;
  readonly toolMatched: boolean;
  readonly cycleDurationUs: Microseconds;
  readonly cyclesByTime: bigint;
  readonly cyclesByInput: bigint;
  readonly cyclesByTarget: bigint | null;
  readonly completedCycles: bigint;
  readonly remainderUs: Microseconds;
  readonly cyclesPerHour: string;
  readonly effectiveThroughputPerHour: string;
};

export type ToolCycleProjection = {
  readonly requiredToolTag: ToolTag | null;
  readonly currentToolTag: ToolTag | null;
  readonly currentToolItemId: string | null;
  readonly nextToolTag: ToolTag | null;
  readonly nextToolItemId: string | null;
  readonly speedMultiplier: string;
  readonly efficiencyMultiplier: string;
  readonly currentPhase: ToolPhaseProjection;
  readonly nextPhase: ToolPhaseProjection | null;
  readonly cyclesByTime: bigint;
  readonly cyclesByInput: bigint;
  readonly cyclesByTarget: bigint | null;
  readonly completedCycles: bigint;
  readonly remainderUs: Microseconds;
  readonly cyclesPerHour: string;
  readonly effectiveThroughputPerHour: string;
};

export type ToolComparisonInput = {
  readonly requiredToolTag: ToolTag | null;
  readonly baseDurationUs: Microseconds;
  readonly availableTimeUs?: Microseconds;
  readonly inputLimits?: readonly CycleInputLimit[];
  readonly targetCycles?: bigint;
  readonly currentLoadout: ToolLoadout | null;
  readonly candidateLoadout: ToolLoadout;
};

export type ToolComparison = {
  readonly preferredItemId: string;
  readonly current: ToolCycleProjection;
  readonly candidate: ToolCycleProjection;
  readonly throughputDeltaPerHour: string;
  readonly cyclesDeltaPerHour: string;
};

const ONE_HOUR_US = microseconds(3_600_000_000n);

function resolveToolProfile(itemId: string): ToolProfile {
  if (itemId.endsWith('_yaochu')) {
    return { itemId, toolTag: 'herbalism_tool', skillId: 'skill.herbalism' };
  }
  if (itemId.endsWith('_kuanggao')) {
    return { itemId, toolTag: 'mining_tool', skillId: 'skill.mining' };
  }
  if (itemId.endsWith('_danlu')) {
    return { itemId, toolTag: 'alchemy_tool', skillId: 'skill.alchemy' };
  }
  throw new Error(`TOOL_ITEM_UNSUPPORTED:${itemId}`);
}

function buildToolModifiers(stat: ToolActionStat, modifiers: readonly Modifier[] | undefined): readonly Modifier[] {
  const source = modifiers ?? [];
  for (const modifier of source) {
    if (modifier.stat !== stat) {
      throw new Error(`TOOL_MODIFIER_STAT_MISMATCH:${stat}:${modifier.stat}`);
    }
  }
  return source;
}

function resolveMultiplier(modifiers: readonly Modifier[], stat: ToolActionStat): string {
  const multiplier = applyModifiers('1', modifiers, { stat });
  if (multiplier.value.lte(0)) {
    throw new Error(`TOOL_${stat.toUpperCase()}_MULTIPLIER_INVALID`);
  }
  return multiplier.toString();
}

function resolveCycleDurationUs(baseDurationUs: Microseconds, speedMultiplier: string): Microseconds {
  const duration = decimal(baseDurationUs).divide(speedMultiplier);
  if (duration.value.lte(0)) {
    throw new Error('TOOL_CYCLE_DURATION_INVALID');
  }
  return microseconds(duration.value.ceil().toFixed(0));
}

function subtractConsumedInputs(
  inputLimits: readonly CycleInputLimit[],
  completedCycles: bigint,
): readonly CycleInputLimit[] {
  return inputLimits.map((limit) => {
    const consumed = completedCycles * limit.perCycle;
    const remaining = limit.available - consumed;
    return {
      available: remaining > 0n ? remaining : 0n,
      perCycle: limit.perCycle,
    };
  });
}

function projectSinglePhase(
  loadout: ToolLoadout | null,
  input: {
    readonly requiredToolTag: ToolTag | null;
    readonly baseDurationUs: Microseconds;
    readonly availableTimeUs: Microseconds;
    readonly inputLimits?: readonly CycleInputLimit[];
    readonly targetCycles?: bigint;
  },
): ToolPhaseProjection {
  const toolMatched = loadout !== null && input.requiredToolTag !== null && loadout.toolTag === input.requiredToolTag;
  if (loadout !== null && input.requiredToolTag !== null && loadout.toolTag !== input.requiredToolTag) {
    throw new Error(`TOOL_TAG_MISMATCH:${input.requiredToolTag}:${loadout.toolTag}`);
  }

  const speedMultiplier = loadout?.speedMultiplier ?? '1';
  const efficiencyMultiplier = loadout?.efficiencyMultiplier ?? '1';
  const cycleDurationUs = resolveCycleDurationUs(input.baseDurationUs, speedMultiplier);
  const cycleCountInput = {
    availableTimeUs: input.availableTimeUs,
    cycleDurationUs,
    ...(input.inputLimits !== undefined ? { inputs: input.inputLimits } : {}),
    ...(input.targetCycles !== undefined ? { targetCycles: input.targetCycles } : {}),
  };
  const cycleCount = calculateCycleCount(cycleCountInput);
  const cyclesPerHour = calculateCycleCount({
    availableTimeUs: ONE_HOUR_US,
    cycleDurationUs,
    ...(input.inputLimits !== undefined ? { inputs: input.inputLimits } : {}),
    ...(input.targetCycles !== undefined ? { targetCycles: input.targetCycles } : {}),
  }).completedCycles;
  const throughputPerHour = decimal(cyclesPerHour).multiply(efficiencyMultiplier).toString();

  return {
    loadout,
    toolMatched,
    cycleDurationUs,
    cyclesByTime: cycleCount.cyclesByTime,
    cyclesByInput: cycleCount.cyclesByInput,
    cyclesByTarget: cycleCount.cyclesByTarget,
    completedCycles: cycleCount.completedCycles,
    remainderUs: cycleCount.remainderUs,
    cyclesPerHour: cyclesPerHour.toString(),
    effectiveThroughputPerHour: throughputPerHour,
  };
}

function buildProjectedLoadout(loadoutInput: ToolLoadoutInput): ToolLoadout {
  const profile = resolveToolProfile(loadoutInput.itemId);
  if (profile.toolTag !== loadoutInput.toolTag || profile.skillId !== loadoutInput.skillId) {
    throw new Error(`TOOL_PROFILE_MISMATCH:${loadoutInput.itemId}:${loadoutInput.toolTag}:${loadoutInput.skillId}`);
  }
  const speedModifiers = buildToolModifiers('action_speed', loadoutInput.speedModifiers);
  const efficiencyModifiers = buildToolModifiers('action_efficiency', loadoutInput.efficiencyModifiers);
  return {
    ...profile,
    speedModifiers,
    efficiencyModifiers,
    speedMultiplier: resolveMultiplier(speedModifiers, 'action_speed'),
    efficiencyMultiplier: resolveMultiplier(efficiencyModifiers, 'action_efficiency'),
  };
}

export function createToolLoadout(loadoutInput: ToolLoadoutInput): ToolLoadout {
  return buildProjectedLoadout(loadoutInput);
}

export function resolveToolProfileFromItemId(itemId: string): ToolProfile {
  return resolveToolProfile(itemId);
}

export function projectToolCycleThroughput(input: ToolCycleProjectionInput): ToolCycleProjection {
  const nextLoadout = input.nextLoadout ?? null;
  const currentHourly = projectSinglePhase(input.currentLoadout, {
    requiredToolTag: input.requiredToolTag,
    baseDurationUs: input.baseDurationUs,
    availableTimeUs: ONE_HOUR_US,
    ...(input.inputLimits !== undefined ? { inputLimits: input.inputLimits } : {}),
  });
  const currentCycleDurationUs = currentHourly.cycleDurationUs;
  const currentPhaseTimeUs = nextLoadout === null
    ? input.availableTimeUs
    : (input.availableTimeUs < currentCycleDurationUs ? input.availableTimeUs : currentCycleDurationUs);
  const currentPhaseTargetCycles = nextLoadout === null
    ? input.targetCycles
    : (input.targetCycles === undefined ? 1n : (input.targetCycles < 1n ? input.targetCycles : 1n));
  const currentBoundary = projectSinglePhase(input.currentLoadout, {
    requiredToolTag: input.requiredToolTag,
    baseDurationUs: input.baseDurationUs,
    availableTimeUs: currentPhaseTimeUs,
    ...(input.inputLimits !== undefined ? { inputLimits: input.inputLimits } : {}),
    ...(currentPhaseTargetCycles !== undefined ? { targetCycles: currentPhaseTargetCycles } : {}),
  });
  const targetReached = input.targetCycles !== undefined && currentBoundary.completedCycles >= input.targetCycles;
  const currentPhase: ToolPhaseProjection = {
    ...currentBoundary,
    cyclesPerHour: currentHourly.cyclesPerHour,
    effectiveThroughputPerHour: currentHourly.effectiveThroughputPerHour,
  };

  if (nextLoadout === null || currentPhase.completedCycles === 0n || targetReached) {
    const cyclesPerHour = currentPhase.cyclesPerHour;
    return {
      requiredToolTag: input.requiredToolTag,
      currentToolTag: input.currentLoadout?.toolTag ?? null,
      currentToolItemId: input.currentLoadout?.itemId ?? null,
      nextToolTag: null,
      nextToolItemId: null,
      speedMultiplier: input.currentLoadout?.speedMultiplier ?? '1',
      efficiencyMultiplier: input.currentLoadout?.efficiencyMultiplier ?? '1',
      currentPhase,
      nextPhase: null,
      cyclesByTime: currentPhase.cyclesByTime,
      cyclesByInput: currentPhase.cyclesByInput,
      cyclesByTarget: currentPhase.cyclesByTarget,
      completedCycles: currentPhase.completedCycles,
      remainderUs: currentPhase.remainderUs,
      cyclesPerHour,
      effectiveThroughputPerHour: currentPhase.effectiveThroughputPerHour,
    };
  }

  const nextPhaseBoundary = projectSinglePhase(nextLoadout, {
    requiredToolTag: input.requiredToolTag,
    baseDurationUs: input.baseDurationUs,
    availableTimeUs: microseconds(input.availableTimeUs - currentBoundary.cycleDurationUs),
    ...(input.inputLimits !== undefined
      ? { inputLimits: subtractConsumedInputs(input.inputLimits, currentBoundary.completedCycles) }
      : {}),
    ...(input.targetCycles !== undefined
      ? { targetCycles: input.targetCycles > currentBoundary.completedCycles ? input.targetCycles - currentBoundary.completedCycles : 0n }
      : {}),
  });
  const nextHourly = projectSinglePhase(nextLoadout, {
    requiredToolTag: input.requiredToolTag,
    baseDurationUs: input.baseDurationUs,
    availableTimeUs: ONE_HOUR_US,
    ...(input.inputLimits !== undefined ? { inputLimits: input.inputLimits } : {}),
  });
  const nextPhase: ToolPhaseProjection = {
    ...nextPhaseBoundary,
    cyclesPerHour: nextHourly.cyclesPerHour,
    effectiveThroughputPerHour: nextHourly.effectiveThroughputPerHour,
  };

  return {
    requiredToolTag: input.requiredToolTag,
    currentToolTag: input.currentLoadout?.toolTag ?? null,
    currentToolItemId: input.currentLoadout?.itemId ?? null,
    nextToolTag: nextLoadout.toolTag,
    nextToolItemId: nextLoadout.itemId,
    speedMultiplier: input.currentLoadout?.speedMultiplier ?? '1',
    efficiencyMultiplier: input.currentLoadout?.efficiencyMultiplier ?? '1',
    currentPhase,
    nextPhase,
    cyclesByTime: currentBoundary.cyclesByTime + nextPhaseBoundary.cyclesByTime,
    cyclesByInput: currentBoundary.cyclesByInput + nextPhaseBoundary.cyclesByInput,
    cyclesByTarget: input.targetCycles ?? null,
    completedCycles: currentBoundary.completedCycles + nextPhaseBoundary.completedCycles,
    remainderUs: nextPhaseBoundary.remainderUs,
    cyclesPerHour: decimal(currentPhase.cyclesPerHour).add(nextPhase.cyclesPerHour).toString(),
    effectiveThroughputPerHour: decimal(currentPhase.effectiveThroughputPerHour).add(nextPhase.effectiveThroughputPerHour).toString(),
  };
}

export function projectToolHourlyThroughput(input: Omit<ToolCycleProjectionInput, 'availableTimeUs'>): ToolCycleProjection {
  return projectToolCycleThroughput({
    ...input,
    availableTimeUs: ONE_HOUR_US,
  });
}

export function compareToolLoadouts(input: ToolComparisonInput): ToolComparison {
  const availableTimeUs = input.availableTimeUs ?? ONE_HOUR_US;
  const current = projectToolCycleThroughput({
    requiredToolTag: input.requiredToolTag,
    baseDurationUs: input.baseDurationUs,
    availableTimeUs,
    currentLoadout: input.currentLoadout,
    ...(input.inputLimits !== undefined ? { inputLimits: input.inputLimits } : {}),
    ...(input.targetCycles !== undefined ? { targetCycles: input.targetCycles } : {}),
  });
  const candidate = projectToolCycleThroughput({
    requiredToolTag: input.requiredToolTag,
    baseDurationUs: input.baseDurationUs,
    availableTimeUs,
    currentLoadout: input.candidateLoadout,
    ...(input.inputLimits !== undefined ? { inputLimits: input.inputLimits } : {}),
    ...(input.targetCycles !== undefined ? { targetCycles: input.targetCycles } : {}),
  });

  const currentThroughput = decimal(current.effectiveThroughputPerHour);
  const candidateThroughput = decimal(candidate.effectiveThroughputPerHour);
  const preferredItemId = candidateThroughput.value.gt(currentThroughput.value) || input.currentLoadout === null
    ? input.candidateLoadout.itemId
    : input.currentLoadout.itemId;

  return {
    preferredItemId,
    current,
    candidate,
    throughputDeltaPerHour: candidateThroughput.subtract(currentThroughput).toString(),
    cyclesDeltaPerHour: decimal(candidate.cyclesPerHour).subtract(current.cyclesPerHour).toString(),
  };
}
