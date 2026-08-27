import assert from 'node:assert/strict';
import test from 'node:test';
import { GameService } from './service.ts';
import { MemoryRepository } from './repository.ts';
import { parseRandomEventRuntimeState } from './random-event-runtime.ts';
import { createRandomEventRuntimeState } from './random-event-runtime.ts';
import { RANDOM_EVENT_WINDOW_SECONDS } from './random-event-runtime.ts';

const base = new Date('2026-01-01T00:00:00.000Z');
const at = (seconds: number): Date => new Date(base.getTime() + seconds * 1000);

test('offline settlement activates deterministic random event state and replays summaries', async () => {
  const repository = new MemoryRepository();
  const service = new GameService(repository, () => at(3600));
  const playerId = 'random-event-service-player';
  await service.createPlayer(playerId, base);
  await repository.transaction(playerId, 0, { eventType: 'test_seed', payload: {}, at: base }, (draft) => { draft.randomState.seed = 1; draft.randomEventState = createRandomEventRuntimeState(base, 1, service.currentConfigVersion()) as unknown as Record<string, unknown>; return null; });
  const first = await service.offlineSettlement({ playerId, settlementId: 'random-event-settlement', requestedStartedAt: base.toISOString(), requestedEndedAt: at(3600).toISOString(), expectedRevision: 1, now: at(3600) });
  assert.equal(first.data.randomEventEffectiveProductionSeconds, 3600);
  assert.ok(first.data.randomEventSummaries?.length);
  const state = await repository.getPlayer(playerId);
  assert.ok(parseRandomEventRuntimeState(state.randomEventState));
  const replay = await service.offlineSettlement({ playerId, settlementId: 'random-event-settlement', requestedStartedAt: base.toISOString(), requestedEndedAt: at(3600).toISOString(), expectedRevision: 999, now: at(3601) });
  assert.deepEqual(replay, first);
});

test('offline settlement preserves non-empty legacy random event JSONB', async () => {
  const repository = new MemoryRepository();
  const service = new GameService(repository, () => at(3600));
  const playerId = 'random-event-legacy-player';
  await service.createPlayer(playerId, base);
  await repository.transaction(playerId, 0, { eventType: 'test_legacy', payload: {}, at: base }, (draft) => { draft.randomEventState = { activeEvent: 'spirit_tide', remainingSeconds: 123 }; return null; });
  await service.offlineSettlement({ playerId, settlementId: 'random-event-legacy-settlement', requestedStartedAt: base.toISOString(), requestedEndedAt: at(3600).toISOString(), expectedRevision: 1, now: at(3600) });
  const state = await repository.getPlayer(playerId);
  assert.deepEqual(state.randomEventState, { activeEvent: 'spirit_tide', remainingSeconds: 123 });
  const current = await service.randomEventsCurrent(playerId, { now: at(3600) });
  assert.equal(current.data.mode, 'opaque_legacy');
  assert.equal(current.data.window, null);
});

test('current random event route reports uninitialized empty state without mutation', async () => {
  const repository = new MemoryRepository();
  const service = new GameService(repository, () => at(3600));
  const playerId = 'random-event-current-player';
  await service.createPlayer(playerId, base);
  const current = await service.randomEventsCurrent(playerId, { now: at(3600) });
  assert.equal(current.data.mode, 'uninitialized');
  assert.equal(current.data.window, null);
  assert.equal((await repository.getPlayer(playerId)).stateRevision, 0);
});

test('offline settlement persists the random-event draw cursor when crossing a window', async () => {
  const boundaryMs = (Math.floor(base.getTime() / (RANDOM_EVENT_WINDOW_SECONDS * 1000)) + 1) * RANDOM_EVENT_WINDOW_SECONDS * 1000;
  const start = new Date(boundaryMs - 3600 * 1000);
  const end = new Date(boundaryMs + 3600 * 1000);
  const repository = new MemoryRepository();
  const service = new GameService(repository, () => end);
  const playerId = 'random-event-draw-cursor-player';
  await service.createPlayer(playerId, start);
  await repository.transaction(playerId, 0, { eventType: 'test_seed', payload: {}, at: start }, (draft) => {
    const runtime = createRandomEventRuntimeState(start, 7, service.currentConfigVersion());
    draft.randomState.seed = 7;
    draft.randomState.draws = runtime.windows.length;
    draft.randomEventState = runtime as unknown as Record<string, unknown>;
    return null;
  });
  await service.offlineSettlement({ playerId, settlementId: 'random-event-draw-cursor-settlement', requestedStartedAt: start.toISOString(), requestedEndedAt: end.toISOString(), expectedRevision: 1, now: end });
  const state = await repository.getPlayer(playerId);
  const runtime = parseRandomEventRuntimeState(state.randomEventState);
  assert.ok(runtime);
  assert.equal(runtime.windows.length, 2);
  assert.equal(state.randomState.draws, 2);
  assert.deepEqual(runtime.windows.map((window) => window.drawIndex), [0, 1]);
});
