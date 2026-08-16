import { decimal, type DecimalInput } from './decimal.js';
import { microseconds, type Microseconds } from './time.js';

export type SettlementActionOutput = {
  readonly itemId: string;
  readonly quantityPerCycle: bigint;
};

export type SettlementActionSnapshot = {
  readonly actionConfigId: string;
  readonly configVersion: string;
  readonly formulaVersion: number;
  readonly durationUs: Microseconds;
  readonly cultivationXpPerCycle: DecimalInput;
  readonly skillXpPerCycle: DecimalInput;
  readonly outputs: readonly SettlementActionOutput[];
};

export type SettlementSegment = {
  readonly segmentIndex: number;
  readonly actionConfigId: string;
  readonly fromUs: Microseconds;
  readonly toUs: Microseconds;
  readonly completedCycles: bigint;
  readonly outputs: Readonly<Record<string, string>>;
  readonly xpChanges: {
    readonly cultivationXp: string;
    readonly skillXp: string;
  };
  readonly snapshot: {
    readonly action_config_id: string;
    readonly config_version: string;
    readonly formula_version: number;
    readonly duration_us: string;
    readonly cultivation_xp_per_cycle: string;
    readonly skill_xp_per_cycle: string;
    readonly outputs: Readonly<Record<string, string>>;
  };
};

export type SingleActionSettlementInput = {
  readonly lastSettledAtUs: Microseconds;
  readonly serverNowUs: Microseconds;
  readonly offlineCapUs: Microseconds;
  readonly progressTimeUs: Microseconds;
  readonly actionSnapshot: SettlementActionSnapshot | null;
};

export type SingleActionSettlementResult = {
  readonly requestedUntilUs: Microseconds;
  readonly effectiveUntilUs: Microseconds;
  readonly effectiveTimeUs: Microseconds;
  readonly cappedTimeUs: Microseconds;
  readonly completedCycles: bigint;
  readonly progressTimeUs: Microseconds;
  readonly cultivationXp: string;
  readonly skillXp: string;
  readonly segments: readonly SettlementSegment[];
  readonly status: 'COMPLETED' | 'IDLE_NO_ACTION';
};

export type SettlementCheckpoint<T> = {
  readonly committedSegments: readonly T[];
  readonly deferredSegments: readonly T[];
  readonly continuationRequired: boolean;
};

export function checkpointSegments<T>(segments: readonly T[], segmentLimit: number): SettlementCheckpoint<T> {
  if (!Number.isInteger(segmentLimit) || segmentLimit < 1) {
    throw new Error('SETTLEMENT_SEGMENT_LIMIT_INVALID');
  }
  return {
    committedSegments: segments.slice(0, segmentLimit),
    deferredSegments: segments.slice(segmentLimit),
    continuationRequired: segments.length > segmentLimit,
  };
}

function validateInput(input: SingleActionSettlementInput): void {
  if (input.serverNowUs < input.lastSettledAtUs) {
    throw new Error('SETTLEMENT_TIME_TRAVEL');
  }
  if (input.offlineCapUs < 0n || input.progressTimeUs < 0n) {
    throw new Error('SETTLEMENT_TIME_INVALID');
  }
}

function snapshotJson(snapshot: SettlementActionSnapshot): SettlementSegment['snapshot'] {
  const outputs: Record<string, string> = {};
  for (const output of snapshot.outputs) {
    if (output.quantityPerCycle < 0n || output.itemId.trim().length === 0) {
      throw new Error('SETTLEMENT_OUTPUT_INVALID');
    }
    outputs[output.itemId] = output.quantityPerCycle.toString();
  }
  return {
    action_config_id: snapshot.actionConfigId,
    config_version: snapshot.configVersion,
    formula_version: snapshot.formulaVersion,
    duration_us: snapshot.durationUs.toString(),
    cultivation_xp_per_cycle: decimal(snapshot.cultivationXpPerCycle).toString(),
    skill_xp_per_cycle: decimal(snapshot.skillXpPerCycle).toString(),
    outputs,
  };
}

export function settleSingleAction(input: SingleActionSettlementInput): SingleActionSettlementResult {
  validateInput(input);
  const requestedUntilUs = input.serverNowUs;
  const capEndUs = input.lastSettledAtUs + input.offlineCapUs;
  const effectiveUntilUs = microseconds(requestedUntilUs < capEndUs ? requestedUntilUs : capEndUs);
  const effectiveTimeUs = microseconds(effectiveUntilUs - input.lastSettledAtUs);
  const cappedTimeUs = microseconds(requestedUntilUs - effectiveUntilUs);

  if (!input.actionSnapshot) {
    return {
      requestedUntilUs,
      effectiveUntilUs,
      effectiveTimeUs,
      cappedTimeUs,
      completedCycles: 0n,
      progressTimeUs: microseconds(0n),
      cultivationXp: '0',
      skillXp: '0',
      segments: [],
      status: 'IDLE_NO_ACTION',
    };
  }

  const snapshot = input.actionSnapshot;
  if (snapshot.durationUs <= 0n || input.progressTimeUs >= snapshot.durationUs) {
    throw new Error('SETTLEMENT_ACTION_DURATION_INVALID');
  }
  const currentProgress = input.progressTimeUs + effectiveTimeUs;
  const completedCycles = currentProgress / snapshot.durationUs;
  const progressTimeUs = microseconds(currentProgress % snapshot.durationUs);
  const cultivationXp = decimal(snapshot.cultivationXpPerCycle).multiply(completedCycles.toString()).toString();
  const skillXp = decimal(snapshot.skillXpPerCycle).multiply(completedCycles.toString()).toString();
  const outputs: Record<string, string> = {};
  for (const output of snapshot.outputs) {
    if (output.quantityPerCycle < 0n || output.itemId.trim().length === 0) {
      throw new Error('SETTLEMENT_OUTPUT_INVALID');
    }
    outputs[output.itemId] = (BigInt(outputs[output.itemId] ?? '0') + output.quantityPerCycle * completedCycles).toString();
  }
  const segment: SettlementSegment = {
    segmentIndex: 0,
    actionConfigId: snapshot.actionConfigId,
    fromUs: input.lastSettledAtUs,
    toUs: effectiveUntilUs,
    completedCycles,
    outputs,
    xpChanges: { cultivationXp, skillXp },
    snapshot: snapshotJson(snapshot),
  };

  return {
    requestedUntilUs,
    effectiveUntilUs,
    effectiveTimeUs,
    cappedTimeUs,
    completedCycles,
    progressTimeUs,
    cultivationXp,
    skillXp,
    segments: [segment],
    status: 'COMPLETED',
  };
}
