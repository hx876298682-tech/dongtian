import { decimal, DecimalValue } from './decimal.js';
import { sha256Bytes } from './sha256.js';

export type XoshiroState = readonly [number, number, number, number];

function stateFromBytes(bytes: Uint8Array): XoshiroState {
  if (bytes.length < 16) {
    throw new Error('RANDOM_SEED_TOO_SHORT');
  }
  const values: number[] = [];
  for (let index = 0; index < 4; index += 1) {
    const position = index * 4;
    values.push((
      (bytes[position] ?? 0) << 24
      | (bytes[position + 1] ?? 0) << 16
      | (bytes[position + 2] ?? 0) << 8
      | (bytes[position + 3] ?? 0)
    ) >>> 0);
  }
  if (values.every((value) => value === 0)) {
    return [1, 0, 0, 0];
  }
  return [values[0] ?? 0, values[1] ?? 0, values[2] ?? 0, values[3] ?? 0];
}

export function seedFromHex(seed: string): Uint8Array {
  if (!/^[0-9a-f]{32}$/i.test(seed)) {
    throw new Error('RANDOM_SEED_INVALID');
  }
  const bytes = new Uint8Array(16);
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(seed.slice(index * 2, index * 2 + 2), 16);
  }
  return bytes;
}

export function deriveXoshiroState(seed: Uint8Array): XoshiroState {
  return stateFromBytes(sha256Bytes(seed));
}

export function deriveScopedSeed(
  seed: Uint8Array,
  namespace: string,
  index: string,
  version: string,
): Uint8Array {
  const encoder = new TextEncoder();
  const context = encoder.encode(`${namespace}\0${index}\0${version}`);
  const combined = new Uint8Array(seed.length + context.length);
  combined.set(seed);
  combined.set(context, seed.length);
  return sha256Bytes(combined).slice(0, 16);
}

function rotateLeft(value: number, bits: number): number {
  return ((value << bits) | (value >>> (32 - bits))) >>> 0;
}

export class Xoshiro128StarStar {
  private state: [number, number, number, number];

  public constructor(seed: Uint8Array | XoshiroState) {
    this.state = seed instanceof Uint8Array
      ? [...deriveXoshiroState(seed)]
      : [...seed];
    if (this.state.every((value) => value === 0)) {
      throw new Error('RANDOM_STATE_ZERO');
    }
  }

  public nextUint32(): number {
    const [s0, s1, s2, s3] = this.state;
    const result = Math.imul(rotateLeft(Math.imul(s1, 5), 7), 9) >>> 0;
    const t = Math.imul(s1, 1 << 9) >>> 0;
    this.state[2] = (s2 ^ s0) >>> 0;
    this.state[3] = (s3 ^ s1) >>> 0;
    this.state[1] = (s1 ^ this.state[2]) >>> 0;
    this.state[0] = (s0 ^ this.state[3]) >>> 0;
    this.state[2] = (this.state[2] ^ t) >>> 0;
    this.state[3] = rotateLeft(this.state[3], 11);
    return result;
  }

  public nextUnit(): DecimalValue {
    return decimal(BigInt(this.nextUint32()).toString()).divide('4294967296');
  }

  public snapshot(): XoshiroState {
    return [...this.state] as XoshiroState;
  }
}
