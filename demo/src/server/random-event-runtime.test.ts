import assert from 'node:assert/strict';
import test from 'node:test';
import {
  RANDOM_EVENT_RUNTIME_VERSION,
  RANDOM_EVENT_WINDOW_SECONDS,
  createRandomEventRuntimeState,
  currentRandomEvent,
  ensureRandomEventWindows,
  parseRandomEventRuntimeState,
  randomEventExpectedFactor,
  rollRandomEvent,
  settleRandomEventRange,
} from './random-event-runtime.ts';

const at = (seconds: number): Date => new Date(seconds * 1000);

test('random event roll is mutually exclusive with stable boundaries', () => {
  assert.equal(rollRandomEvent(0).eventId, 'spirit_tide');
  assert.equal(rollRandomEvent(0.199999999).eventId, 'spirit_tide');
  assert.equal(rollRandomEvent(0.2).eventId, 'beast_raid');
  assert.equal(rollRandomEvent(0.299999999).eventId, 'beast_raid');
  assert.equal(rollRandomEvent(0.3).eventId, 'none');
  assert.equal(rollRandomEvent(0.999999999).eventId, 'none');
  assert.throws(() => rollRandomEvent(1));
});

test('random event windows are UTC epoch windows and deterministic across replay', () => {
  const first = ensureRandomEventWindows({ schemaVersion: RANDOM_EVENT_RUNTIME_VERSION, settledThrough: at(0).toISOString(), activeWindowId: null, windows: [] }, at(1), at(RANDOM_EVENT_WINDOW_SECONDS + 1), 42, 'cfg-a', 7);
  const second = ensureRandomEventWindows({ schemaVersion: RANDOM_EVENT_RUNTIME_VERSION, settledThrough: at(0).toISOString(), activeWindowId: null, windows: [] }, at(1), at(RANDOM_EVENT_WINDOW_SECONDS + 1), 42, 'cfg-a', 7);
  assert.deepEqual(first, second);
  assert.equal(first.state.windows.length, 2);
  assert.equal(first.state.windows[0]?.startAt, '1970-01-01T00:00:00.000Z');
  assert.equal(first.state.windows[1]?.startAt, '1970-01-08T00:00:00.000Z');
  assert.equal(first.nextDrawIndex, 9);
  assert.deepEqual(parseRandomEventRuntimeState(first.state), first.state);
  assert.equal(currentRandomEvent(first.state, at(1))?.windowId, '0');
});

test('settlement integrates only event-active overlap seconds and returns replay summaries', () => {
  const base = { schemaVersion: RANDOM_EVENT_RUNTIME_VERSION, settledThrough: at(0).toISOString(), activeWindowId: null, windows: [] };
  const state = ensureRandomEventWindows(base, at(0), at(RANDOM_EVENT_WINDOW_SECONDS), 1, 'cfg-a', 0).state;
  assert.equal(state.windows[0]?.eventId, 'spirit_tide');
  const result = settleRandomEventRange(state, at(0), at(12 * 3600), 1, 'cfg-a', 1);
  assert.equal(result.summaries.length, 1);
  assert.equal(result.summaries[0]?.overlapSeconds, 12 * 3600);
  assert.equal(result.effectiveProductionSeconds, 12 * 3600 + 6 * 3600 * 0.25);
  assert.equal(result.state.settledThrough, at(12 * 3600).toISOString());
  assert.equal(result.state.activeWindowId, result.state.windows[0]?.windowId);
  assert.match(result.summaries[0]?.resultHash ?? '', /^sha256:/);
});

test('random event runtime rejects offline ranges over 24 hours', () => {
  const state = createRandomEventRuntimeState(at(0), 7, 'cfg-a');
  assert.throws(() => settleRandomEventRange(state, at(0), at(24 * 3600 + 1), 7, 'cfg-a', 1), /24 hours/);
});

test('random event expected-factor baselines use canonical complete and truncated horizons', () => {
  assert.equal(randomEventExpectedFactor(168), 1.0013095238095238);
  assert.equal(randomEventExpectedFactor(2160), 1.0012222222222222);
});
