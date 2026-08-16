import { microseconds, type Microseconds, splitMicroseconds } from './time.js';

export type CycleInputLimit = {
  readonly available: bigint;
  readonly perCycle: bigint;
};

export type CycleCountInput = {
  readonly availableTimeUs: Microseconds;
  readonly cycleDurationUs: Microseconds;
  readonly inputs?: readonly CycleInputLimit[];
  readonly targetCycles?: bigint;
};

export type CycleCount = {
  readonly cyclesByTime: bigint;
  readonly cyclesByInput: bigint;
  readonly cyclesByTarget: bigint | null;
  readonly completedCycles: bigint;
  readonly remainderUs: Microseconds;
};

export function calculateCycleCount(input: CycleCountInput): CycleCount {
  const cyclesByTime = splitMicroseconds(input.availableTimeUs, input.cycleDurationUs).completedCycles;
  const inputLimits = input.inputs ?? [];
  let cyclesByInput: bigint | null = null;
  for (const limit of inputLimits) {
    if (limit.available < 0n || limit.perCycle <= 0n) {
      throw new Error('CYCLE_INPUT_INVALID');
    }
    const count = limit.available / limit.perCycle;
    cyclesByInput = cyclesByInput === null ? count : cyclesByInput < count ? cyclesByInput : count;
  }
  const effectiveInputLimit = cyclesByInput ?? cyclesByTime;
  if (input.targetCycles !== undefined && input.targetCycles < 0n) {
    throw new Error('CYCLE_TARGET_INVALID');
  }
  const cyclesByTarget = input.targetCycles ?? null;
  let completedCycles = cyclesByTime < effectiveInputLimit ? cyclesByTime : effectiveInputLimit;
  if (cyclesByTarget !== null && completedCycles > cyclesByTarget) {
    completedCycles = cyclesByTarget;
  }
  return {
    cyclesByTime,
    cyclesByInput: effectiveInputLimit,
    cyclesByTarget,
    completedCycles,
    remainderUs: microseconds(input.availableTimeUs - completedCycles * input.cycleDurationUs),
  };
}
