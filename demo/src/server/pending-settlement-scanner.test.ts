import assert from 'node:assert/strict';
import test from 'node:test';
import { GameService } from './service.ts';
import { MemoryRepository } from './repository.ts';
import { PendingSettlementScanner } from './pending-settlement-scanner.ts';
import { ApiError, CONFIG_VERSION } from './types.ts';
import type { PendingSettlementCursor } from './types.ts';

const base = new Date('2026-01-01T00:00:00.000Z');
const at = (seconds: number): Date => new Date(base.getTime() + seconds * 1000);

const createPending = async (repository: MemoryRepository, service: GameService, playerId: string, settlementId: string): Promise<void> => {
  await service.createPlayer(playerId, base);
  await service.startAction({ playerId, actionId: 'training', expectedRevision: 0, now: base, configVersion: CONFIG_VERSION });
  repository.injectCommitFailure();
  await assert.rejects(() => service.offlineSettlement({ playerId, settlementId, requestedStartedAt: base.toISOString(), requestedEndedAt: at(3600).toISOString(), expectedRevision: 1, now: at(3600) }), (error: unknown) => error instanceof ApiError && error.code === 'INTERNAL_ROLLBACK');
}

test('MemoryRepository lists pending settlements deterministically with limit and before cursor', async () => {
  const repository = new MemoryRepository();
  const records = ['b', 'a', 'c'].map((settlementId, index) => ({ settlementId, playerId: `player-${settlementId}`, requestStartedAt: base.toISOString(), requestEndedAt: at(60).toISOString(), settledSeconds: 0, expectedRevision: 0, committedRevision: null, configVersion: CONFIG_VERSION, summaryHash: settlementId, status: 'pending' as const, responsePayload: { settlementId }, createdAt: at(index).toISOString(), committedAt: null }));
  for (const record of records) await repository.recordSettlement(record);
  await repository.recordSettlement({ ...records[0], status: 'committed', responsePayload: { committed: true }, committedRevision: 1 });
  assert.deepEqual((await repository.listPendingSettlements(10)).map((record) => record.settlementId), ['a', 'c']);
  assert.deepEqual((await repository.listPendingSettlements(1)).map((record) => record.settlementId), ['a']);
  assert.deepEqual((await repository.listPendingSettlements(10, at(2))).map((record) => record.settlementId), ['a']);
});

test('MemoryRepository rejects a mismatched update of a pending settlement reservation', async () => {
  const repository = new MemoryRepository();
  await repository.recordSettlement({ settlementId: 'pending-collision', playerId: 'player-a', requestStartedAt: base.toISOString(), requestEndedAt: at(60).toISOString(), settledSeconds: 0, expectedRevision: 0, committedRevision: null, configVersion: CONFIG_VERSION, summaryHash: 'pending', status: 'pending', responsePayload: { pending: true }, createdAt: base.toISOString(), committedAt: null });
  await assert.rejects(() => repository.recordSettlement({ settlementId: 'pending-collision', playerId: 'player-a', requestStartedAt: base.toISOString(), requestEndedAt: at(120).toISOString(), settledSeconds: 0, expectedRevision: 0, committedRevision: null, configVersion: CONFIG_VERSION, summaryHash: 'retry', status: 'pending', responsePayload: { retry: true }, createdAt: at(120).toISOString(), committedAt: null }), (error: unknown) => error instanceof ApiError && error.code === 'DUPLICATE_REQUEST');
  await assert.rejects(() => repository.recordSettlement({ settlementId: 'pending-collision', playerId: 'player-a', requestStartedAt: base.toISOString(), requestEndedAt: at(120).toISOString(), settledSeconds: 120, expectedRevision: 0, committedRevision: 1, configVersion: CONFIG_VERSION, summaryHash: 'committed', status: 'committed', responsePayload: { committed: true }, createdAt: at(120).toISOString(), committedAt: at(120).toISOString() }), (error: unknown) => error instanceof ApiError && error.code === 'DUPLICATE_REQUEST');
  assert.equal((await repository.getSettlement('pending-collision'))?.status, 'pending');
});

test('MemoryRepository uses settlement_id as a tie-breaker for pending cursors', async () => {
  const repository = new MemoryRepository();
  const createdAt = at(1).toISOString();
  for (const settlementId of ['a', 'b', 'c']) await repository.recordSettlement({ settlementId, playerId: `player-${settlementId}`, requestStartedAt: base.toISOString(), requestEndedAt: at(60).toISOString(), settledSeconds: 0, expectedRevision: 0, committedRevision: null, configVersion: CONFIG_VERSION, summaryHash: settlementId, status: 'pending', responsePayload: { settlementId }, createdAt, committedAt: null });
  assert.deepEqual((await repository.listPendingSettlements(10, { createdAt: at(1), settlementId: 'b' })).map((record) => record.settlementId), ['a']);
});

test('PendingSettlementScanner recovers pending settlements and replays committed results idempotently', async () => {
  const repository = new MemoryRepository();
  const service = new GameService(repository, () => at(3600));
  await createPending(repository, service, 'scanner-recovery-player', 'scanner-recovery-settlement');
  const scanner = new PendingSettlementScanner(repository, service, { batchSize: 10, minAgeMs: 0, clock: () => at(7200) });
  assert.deepEqual(await scanner.scanOnce(), { scanned: 1, committed: 1, rejected: 0, retryable: 0 });
  const committed = await repository.getSettlement('scanner-recovery-settlement');
  assert.equal(committed?.status, 'committed');
  const player = await repository.getPlayer('scanner-recovery-player');
  assert.equal(player.stateRevision, 2);
  assert.deepEqual(await scanner.scanOnce(), { scanned: 0, committed: 0, rejected: 0, retryable: 0 });
  assert.equal((await repository.getPlayer('scanner-recovery-player')).stateRevision, 2);
});

test('PendingSettlementScanner claims a pending settlement once across concurrent Memory workers', async () => {
  const repository = new MemoryRepository();
  const service = new GameService(repository, () => at(3600));
  await createPending(repository, service, 'scanner-claim-player', 'scanner-claim-settlement');
  const first = new PendingSettlementScanner(repository, service, { batchSize: 10, minAgeMs: 0, clock: () => at(7200) });
  const second = new PendingSettlementScanner(repository, service, { batchSize: 10, minAgeMs: 0, clock: () => at(7200) });
  const results = await Promise.all([first.scanOnce(), second.scanOnce()]);
  assert.deepEqual(results.map((result) => result.scanned).sort(), [0, 1]);
  assert.equal(results.reduce((sum, result) => sum + result.committed, 0), 1);
  assert.equal((await repository.getPlayer('scanner-claim-player')).stateRevision, 2);
});

test('PendingSettlementScanner isolates retryable failures and finalizes stale pending records', async () => {
  const repository = new MemoryRepository();
  const service = new GameService(repository, () => at(3600));
  await createPending(repository, service, 'scanner-retry-player', 'scanner-retry-settlement');
  await createPending(repository, service, 'scanner-stale-player', 'scanner-stale-settlement');
  await repository.transaction('scanner-stale-player', 1, { eventType: 'test_mutation', payload: {}, at: at(100) }, (draft) => { draft.collection.collectionMarks += 1; });
  repository.injectCommitFailure();
  const scanner = new PendingSettlementScanner(repository, service, { batchSize: 10, minAgeMs: 0, clock: () => at(7200) });
  assert.deepEqual(await scanner.scanOnce(), { scanned: 2, committed: 0, rejected: 1, retryable: 1 });
  assert.equal((await repository.getSettlement('scanner-retry-settlement'))?.status, 'pending');
  assert.equal((await repository.getSettlement('scanner-stale-settlement'))?.status, 'rejected');
  assert.deepEqual(await scanner.scanOnce(), { scanned: 1, committed: 1, rejected: 0, retryable: 0 });
});

test('PendingSettlementScanner start and stop are idempotent and wait for in-flight scans', async () => {
  const repository = new MemoryRepository();
  const service = new GameService(repository, () => at(3600));
  let calls = 0;
  const original = repository.listPendingSettlements.bind(repository);
  repository.listPendingSettlements = async (...args) => { calls += 1; return original(...args); };
  const scanner = new PendingSettlementScanner(repository, service, { intervalMs: 10, minAgeMs: 0, clock: () => at(3600) });
  scanner.start();
  scanner.start();
  await new Promise((resolve) => setTimeout(resolve, 25));
  await scanner.stop();
  await scanner.stop();
  assert.ok(calls >= 1);
});

test('PendingSettlementScanner readiness stays down until the first scan succeeds and after stop', async () => {
  const repository = new MemoryRepository();
  const service = new GameService(repository, () => at(3600));
  let release: (() => void) | undefined;
  repository.listPendingSettlements = async () => await new Promise((resolve) => { release = () => resolve([]); });
  const scanner = new PendingSettlementScanner(repository, service, { intervalMs: 10, minAgeMs: 0, clock: () => at(3600) });
  scanner.start();
  assert.equal(scanner.isReady(), false);
  assert.equal(scanner.status().lastError, false);
  release?.();
  await scanner.stop();

  const healthy = new PendingSettlementScanner(repository, service, { intervalMs: 10, minAgeMs: 0, clock: () => at(3600) });
  repository.listPendingSettlements = async () => [];
  healthy.start();
  for (let attempt = 0; attempt < 20 && !healthy.isReady(); attempt += 1) await new Promise((resolve) => setTimeout(resolve, 1));
  assert.equal(healthy.isReady(), true);
  assert.equal(healthy.status().healthy, true);
  await healthy.stop();
  assert.equal(healthy.isReady(), false);
  healthy.start();
  assert.equal(healthy.isReady(), false);
  for (let attempt = 0; attempt < 20 && !healthy.isReady(); attempt += 1) await new Promise((resolve) => setTimeout(resolve, 1));
  assert.equal(healthy.isReady(), true);
  await healthy.stop();
});

test('PendingSettlementScanner status reports bounded lease state and expires stale readiness', async () => {
  const repository = new MemoryRepository();
  const service = new GameService(repository, () => at(3600));
  let nowMs = at(3600).getTime();
  const scanner = new PendingSettlementScanner(repository, service, {
    intervalMs: 1_000,
    leaseMs: 100,
    minAgeMs: 0,
    clock: () => new Date(nowMs),
  });
  repository.listPendingSettlements = async () => [];
  scanner.start();
  for (let attempt = 0; attempt < 20 && !scanner.isReady(); attempt += 1) await new Promise((resolve) => setTimeout(resolve, 1));
  assert.equal(scanner.isReady(), true);
  assert.deepEqual(scanner.status().lastResult, { scanned: 0, committed: 0, rejected: 0, retryable: 0 });
  assert.equal(scanner.status().leaseMs, 100);
  assert.equal(scanner.status().readinessMaxAgeMs, 2_000);
  nowMs += 2_001;
  assert.equal(scanner.isReady(), false);
  assert.equal(scanner.status().healthy, false);
  await scanner.stop();
});

test('PendingSettlementScanner excludes reservations younger than minAgeMs', async () => {
  const repository = new MemoryRepository();
  const service = new GameService(repository, () => at(200));
  let observedBefore: Date | PendingSettlementCursor | undefined;
  const original = repository.listPendingSettlements.bind(repository);
  repository.listPendingSettlements = async (limit, before) => { observedBefore = before; return original(limit, before); };
  const scanner = new PendingSettlementScanner(repository, service, { minAgeMs: 60_000, clock: () => at(200) });
  assert.deepEqual(await scanner.scanOnce(), { scanned: 0, committed: 0, rejected: 0, retryable: 0 });
  assert.ok(observedBefore instanceof Date);
  assert.equal(observedBefore.toISOString(), at(140).toISOString());
});

test('PendingSettlementScanner reports background query failures without unhandled rejection', async () => {
  const repository = new MemoryRepository();
  const service = new GameService(repository, () => at(200));
  const errors: unknown[] = [];
  repository.listPendingSettlements = async () => { throw new Error('database temporarily unavailable'); };
  const scanner = new PendingSettlementScanner(repository, service, { intervalMs: 10, onError: (error) => errors.push(error) });
  scanner.start();
  await new Promise((resolve) => setTimeout(resolve, 20));
  await scanner.stop();
  assert.ok(errors.length >= 1);
  assert.match(String((errors[0] as Error).message), /database temporarily unavailable/);
});
