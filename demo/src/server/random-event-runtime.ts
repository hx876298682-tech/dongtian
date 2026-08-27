import { createHash } from 'node:crypto';

export const RANDOM_EVENT_RUNTIME_VERSION = 'random_event_runtime_v1' as const;
export const RANDOM_EVENT_WINDOW_SECONDS = 168 * 60 * 60;
export const RANDOM_EVENT_MAX_OFFLINE_SECONDS = 24 * 60 * 60;

export type RandomEventId = 'none' | 'spirit_tide' | 'beast_raid';
export type RandomEventDefinition = { eventId: RandomEventId; chance: number; durationSeconds: number; productionMultiplier: number };
export type RandomEventWindow = {
  windowId: string;
  startAt: string;
  endAt: string;
  roll: number;
  eventId: RandomEventId;
  status: 'rolled' | 'active' | 'ended';
  durationSeconds: number;
  productionMultiplier: number;
  configVersion: string;
  drawIndex: number;
  resultHash: string;
};
export type RandomEventRuntimeState = {
  schemaVersion: typeof RANDOM_EVENT_RUNTIME_VERSION;
  settledThrough: string;
  activeWindowId: string | null;
  windows: RandomEventWindow[];
};
export type RandomEventSettlementSummary = {
  windowId: string;
  eventId: RandomEventId;
  overlapSeconds: number;
  productionMultiplier: number;
  configVersion: string;
  resultHash: string;
};

export const RANDOM_EVENT_DEFINITIONS: readonly RandomEventDefinition[] = [
  { eventId: 'spirit_tide', chance: 0.20, durationSeconds: 6 * 3600, productionMultiplier: 1.25 },
  { eventId: 'beast_raid', chance: 0.10, durationSeconds: 4 * 3600, productionMultiplier: 0.80 },
  { eventId: 'none', chance: 0.70, durationSeconds: RANDOM_EVENT_WINDOW_SECONDS, productionMultiplier: 1 },
] as const;

const iso = (seconds: number): string => new Date(seconds * 1000).toISOString();
const windowStartSeconds = (atSeconds: number): number => Math.floor(atSeconds / RANDOM_EVENT_WINDOW_SECONDS) * RANDOM_EVENT_WINDOW_SECONDS;
export const randomEventWindowId = (at: Date | number): string => String(Math.floor((at instanceof Date ? at.getTime() : at * 1000) / (RANDOM_EVENT_WINDOW_SECONDS * 1000)));
const hashToUnit = (seed: number, windowId: string): number => {
  const digest = createHash('sha256').update(`${seed >>> 0}:${windowId}:${RANDOM_EVENT_RUNTIME_VERSION}`).digest();
  return digest.readUInt32BE(0) / 0x1_0000_0000;
};
type SignedRandomEventWindow = Omit<RandomEventWindow, 'resultHash' | 'status'>;
const signedWindow = (window: RandomEventWindow | SignedRandomEventWindow): SignedRandomEventWindow => ({
  windowId: window.windowId,
  startAt: window.startAt,
  endAt: window.endAt,
  roll: window.roll,
  eventId: window.eventId,
  durationSeconds: window.durationSeconds,
  productionMultiplier: window.productionMultiplier,
  configVersion: window.configVersion,
  drawIndex: window.drawIndex,
});
const resultHash = (window: RandomEventWindow | SignedRandomEventWindow): string => `sha256:${createHash('sha256').update(JSON.stringify(signedWindow(window))).digest('hex')}`;

export const rollRandomEvent = (roll: number): RandomEventDefinition => {
  if (!Number.isFinite(roll) || roll < 0 || roll >= 1) throw new Error('random event roll must be in [0,1)');
  const percentile = roll * 100;
  let cursor = 0;
  for (const definition of RANDOM_EVENT_DEFINITIONS) {
    cursor += definition.chance * 100;
    if (percentile < cursor) return definition;
  }
  throw new Error('random event chance table does not sum to one');
};

export const createRandomEventRuntimeState = (settledThrough: Date, seed: number, configVersion: string): RandomEventRuntimeState => {
  if (!Number.isSafeInteger(seed) || seed < 0) throw new Error('random event seed must be a non-negative safe integer');
  const state: RandomEventRuntimeState = { schemaVersion: RANDOM_EVENT_RUNTIME_VERSION, settledThrough: settledThrough.toISOString(), activeWindowId: null, windows: [] };
  return ensureRandomEventWindows(state, settledThrough, settledThrough, seed, configVersion, 0).state;
};

export const parseRandomEventRuntimeState = (value: Record<string, unknown> | null | undefined): RandomEventRuntimeState | null => {
  if (!value || value.schemaVersion !== RANDOM_EVENT_RUNTIME_VERSION || !Array.isArray(value.windows) || typeof value.settledThrough !== 'string') return null;
  const settledThrough = new Date(value.settledThrough);
  if (!Number.isFinite(settledThrough.getTime())) return null;
  const windows: RandomEventWindow[] = [];
  for (const candidate of value.windows) {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return null;
    const item = candidate as Record<string, unknown>;
    if (typeof item.windowId !== 'string' || typeof item.startAt !== 'string' || typeof item.endAt !== 'string' || typeof item.roll !== 'number' || typeof item.eventId !== 'string' || !['none', 'spirit_tide', 'beast_raid'].includes(item.eventId) || !['rolled', 'active', 'ended'].includes(String(item.status)) || typeof item.durationSeconds !== 'number' || typeof item.productionMultiplier !== 'number' || typeof item.configVersion !== 'string' || typeof item.drawIndex !== 'number' || typeof item.resultHash !== 'string') return null;
    const window = structuredClone(item) as unknown as RandomEventWindow;
    if (window.resultHash !== resultHash(window)) return null;
    windows.push(window);
  }
  return { schemaVersion: RANDOM_EVENT_RUNTIME_VERSION, settledThrough: settledThrough.toISOString(), activeWindowId: typeof value.activeWindowId === 'string' ? value.activeWindowId : null, windows };
};

export const ensureRandomEventWindows = (input: RandomEventRuntimeState, startAt: Date, endAt: Date, seed: number, configVersion: string, drawIndex: number): { state: RandomEventRuntimeState; nextDrawIndex: number } => {
  if (endAt < startAt) throw new Error('random event range must be ordered');
  const state = structuredClone(input);
  const first = windowStartSeconds(startAt.getTime() / 1000);
  const last = windowStartSeconds(Math.max(startAt.getTime(), endAt.getTime()) / 1000);
  let nextDrawIndex = drawIndex;
  for (let cursor = first; cursor <= last; cursor += RANDOM_EVENT_WINDOW_SECONDS) {
    const windowId = String(Math.floor(cursor / RANDOM_EVENT_WINDOW_SECONDS));
    if (state.windows.some((window) => window.windowId === windowId)) continue;
    const roll = hashToUnit(seed, windowId);
    const definition = rollRandomEvent(roll);
    const base: RandomEventWindow = { windowId, startAt: iso(cursor), endAt: iso(cursor + RANDOM_EVENT_WINDOW_SECONDS), roll, eventId: definition.eventId, status: 'rolled', durationSeconds: definition.eventId === 'none' ? RANDOM_EVENT_WINDOW_SECONDS : definition.durationSeconds, productionMultiplier: definition.productionMultiplier, configVersion, drawIndex: nextDrawIndex, resultHash: '' };
    state.windows.push({ ...base, resultHash: resultHash(base) });
    nextDrawIndex += 1;
  }
  state.windows.sort((left, right) => Number(left.windowId) - Number(right.windowId));
  return { state, nextDrawIndex };
};

const overlap = (leftStart: number, leftEnd: number, rightStart: number, rightEnd: number): number => Math.max(0, Math.min(leftEnd, rightEnd) - Math.max(leftStart, rightStart));
export const settleRandomEventRange = (input: RandomEventRuntimeState, startAt: Date, endAt: Date, seed: number, configVersion: string, drawIndex: number): { state: RandomEventRuntimeState; effectiveProductionSeconds: number; summaries: RandomEventSettlementSummary[]; nextDrawIndex: number } => {
  if (endAt < startAt) throw new Error('random event range must be ordered');
  if ((endAt.getTime() - startAt.getTime()) / 1000 > RANDOM_EVENT_MAX_OFFLINE_SECONDS) throw new Error('random event settlement exceeds 24 hours');
  const ensured = ensureRandomEventWindows(input, startAt, endAt, seed, configVersion, drawIndex);
  const state = ensured.state;
  const start = startAt.getTime() / 1000;
  const end = endAt.getTime() / 1000;
  let effectiveProductionSeconds = 0;
  const summaries: RandomEventSettlementSummary[] = [];
  for (const window of state.windows) {
    const windowStart = Date.parse(window.startAt) / 1000;
    const windowEnd = Date.parse(window.endAt) / 1000;
    const overlapSeconds = overlap(start, end, windowStart, windowEnd);
    if (overlapSeconds <= 0) continue;
    const activeSeconds = window.eventId === 'none' ? 0 : overlap(start, end, windowStart, windowStart + window.durationSeconds);
    effectiveProductionSeconds += overlapSeconds + activeSeconds * (window.productionMultiplier - 1);
    summaries.push({ windowId: window.windowId, eventId: window.eventId, overlapSeconds, productionMultiplier: window.productionMultiplier, configVersion: window.configVersion, resultHash: window.resultHash });
    window.status = end >= windowEnd ? 'ended' : 'active';
  }
  state.settledThrough = endAt.toISOString();
  state.activeWindowId = state.windows.find((window) => window.status === 'active')?.windowId ?? null;
  return { state, effectiveProductionSeconds, summaries, nextDrawIndex: ensured.nextDrawIndex };
};

export const currentRandomEvent = (input: RandomEventRuntimeState, at: Date): RandomEventWindow | null => {
  const seconds = at.getTime() / 1000;
  return input.windows.find((window) => seconds >= Date.parse(window.startAt) / 1000 && seconds < Date.parse(window.endAt) / 1000) ?? null;
};

export const randomEventExpectedFactor = (horizonHours: number): number => {
  if (!Number.isFinite(horizonHours) || horizonHours <= 0) throw new Error('horizonHours must be positive');
  const completeWindows = Math.floor(horizonHours / 168);
  const weightedDelta = 0.20 * 6 * (1.25 - 1) + 0.10 * 4 * (0.80 - 1);
  return 1 + completeWindows * weightedDelta / horizonHours;
};
