export type Microseconds = bigint & { readonly __microseconds: unique symbol };

function asMicroseconds(value: bigint): Microseconds {
  return value as Microseconds;
}

export function microseconds(value: bigint | string): Microseconds {
  const parsed = typeof value === 'bigint' ? value : BigInt(value);
  if (parsed < 0n) {
    throw new Error('TIME_VALUE_NEGATIVE');
  }
  return asMicroseconds(parsed);
}

export function addMicroseconds(left: Microseconds, right: Microseconds): Microseconds {
  return asMicroseconds(left + right);
}

export function subtractMicroseconds(left: Microseconds, right: Microseconds): Microseconds {
  if (right > left) {
    throw new Error('TIME_RESULT_NEGATIVE');
  }
  return asMicroseconds(left - right);
}

export function splitMicroseconds(
  elapsed: Microseconds,
  cycleDuration: Microseconds,
): { readonly completedCycles: bigint; readonly remainderUs: Microseconds } {
  if (cycleDuration <= 0n) {
    throw new Error('CYCLE_DURATION_INVALID');
  }
  return {
    completedCycles: elapsed / cycleDuration,
    remainderUs: asMicroseconds(elapsed % cycleDuration),
  };
}

export function advanceMicrosecondProgress(
  progress: Microseconds,
  elapsed: Microseconds,
  cycleDuration: Microseconds,
): { readonly completedCycles: bigint; readonly progressUs: Microseconds } {
  const split = splitMicroseconds(addMicroseconds(progress, elapsed), cycleDuration);
  return { completedCycles: split.completedCycles, progressUs: split.remainderUs };
}
