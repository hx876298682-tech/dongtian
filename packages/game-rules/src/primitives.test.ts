import { describe, expect, it } from 'vitest';

import { applyModifiers } from './modifiers.js';
import { deriveXoshiroState, seedFromHex, Xoshiro128StarStar } from './random.js';
import { sha256Bytes } from './sha256.js';
import { calculateCycleCount } from './cycles.js';
import { advanceMicrosecondProgress, microseconds, splitMicroseconds } from './time.js';
import { decimal, roundDecimal } from './decimal.js';

function hex(bytes: Uint8Array): string {
  return [...bytes].map((value) => value.toString(16).padStart(2, '0')).join('');
}

describe('game-rules numeric primitives', () => {
  it('keeps Decimal arithmetic and configured rounding out of JavaScript number math', () => {
    expect(decimal('0.1').add('0.2').toString()).toBe('0.3');
    expect(roundDecimal('1.9999999', 6, 'DOWN').toString()).toBe('1.999999');
    expect(roundDecimal('1.25', 1, 'HALF_EVEN').toString()).toBe('1.2');
  });

  it('splits exact microsecond cycles without float drift', () => {
    expect(splitMicroseconds(microseconds(2_000_001n), microseconds(1_000_000n))).toEqual({
      completedCycles: 2n,
      remainderUs: 1n,
    });
    expect(advanceMicrosecondProgress(microseconds(999_999n), microseconds(1n), microseconds(1_000_000n)))
      .toEqual({ completedCycles: 1n, progressUs: 0n });
    expect(calculateCycleCount({
      availableTimeUs: microseconds(3_500_000n),
      cycleDurationUs: microseconds(1_000_000n),
      inputs: [{ available: 2n, perCycle: 1n }],
      targetCycles: 5n,
    })).toMatchObject({ cyclesByTime: 3n, cyclesByInput: 2n, completedCycles: 2n });
    expect(calculateCycleCount({
      availableTimeUs: microseconds(100_000_000n),
      cycleDurationUs: microseconds(1_000_000n),
      inputs: [{ available: 20n, perCycle: 1n }],
    })).toMatchObject({ cyclesByTime: 100n, cyclesByInput: 20n, completedCycles: 20n });
  });

  it('applies matched modifiers in the locked order and delegates soft caps', () => {
    const result = applyModifiers('100', [
      { stat: 'speed', operation: 'ADD', value: '10' },
      { stat: 'speed', operation: 'MULTIPLY', value: '0.1', group: 'skill' },
      { stat: 'speed', operation: 'MULTIPLY', value: '0.2' },
      { stat: 'speed', operation: 'ADD', value: '999', tags: ['unmatched'] },
    ], {
      stat: 'speed',
      activeTags: ['skill'],
      softCap: (value) => value.min('125'),
      rounding: { scale: 2, mode: 'DOWN' },
    });
    expect(result.toString()).toBe('125');
  });

  it('matches the fixed SHA-256 and xoshiro128** algorithms byte-for-byte', () => {
    expect(hex(sha256Bytes(new TextEncoder().encode('abc'))))
      .toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    const seed = seedFromHex('000102030405060708090a0b0c0d0e0f');
    expect(deriveXoshiroState(seed)).toEqual([0xbe45cb26, 0x05bf36be, 0xbde68484, 0x1a28f0fd]);
    const random = new Xoshiro128StarStar([1, 2, 3, 4]);
    expect([random.nextUint32(), random.nextUint32(), random.nextUint32()])
      .toEqual([11520, 0, 5927040]);
    expect(new Xoshiro128StarStar([1, 2, 3, 4]).nextUnit().toString())
      .toBe('0.000002682209014892578125');
  });
});
