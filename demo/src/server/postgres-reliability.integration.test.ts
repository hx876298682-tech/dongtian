import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import test from 'node:test';
import { applyMigrations } from './migrations.ts';
import { PostgresRepository } from './postgres-repository.ts';
import type { AsyncSqlClient, SqlResult, TransactionIsolationLevel } from './postgres-repository.ts';
import { GameService } from './service.ts';
import { ApiError } from './types.ts';
import { PendingSettlementScanner } from './pending-settlement-scanner.ts';
import { hashPayload } from './repository.ts';

const databaseUrl = process.env.DATABASE_URL;
const integrationOptions = { skip: !databaseUrl, concurrency: false } as const;
const base = new Date('2026-08-25T10:00:00.000Z');

const cleanup = async (pool: Pool, playerIds: string[]): Promise<void> => {
  for (const table of ['collection_event', 'audit_event', 'action_idempotency', 'settlement_record', 'dungeon_attempt', 'building_job', 'building_state', 'inventory_resource', 'equipment_instance', 'collection_state', 'progress_state', 'player_state']) {
    await pool.query(`DELETE FROM ${table} WHERE player_id = ANY($1::uuid[])`, [playerIds]);
  }
};

test('PostgreSQL isolation matrix preserves one-winner CAS and settlement idempotency', integrationOptions, async () => {
  const levels: TransactionIsolationLevel[] = ['READ COMMITTED', 'REPEATABLE READ', 'SERIALIZABLE'];
  const pools = levels.flatMap(() => [new Pool({ connectionString: databaseUrl, max: 8 }), new Pool({ connectionString: databaseUrl, max: 8 })]);
  const playerIds: string[] = [];
  try {
    await applyMigrations(pools[0]!);
    for (let index = 0; index < levels.length; index += 1) {
      const level = levels[index]!;
      const firstPool = pools[index * 2]!;
      const secondPool = pools[index * 2 + 1]!;
      const playerId = randomUUID();
      playerIds.push(playerId);
      const first = new PostgresRepository(firstPool, { isolationLevel: level, serializationRetries: 2 });
      const second = new PostgresRepository(secondPool, { isolationLevel: level, serializationRetries: 2 });
      await new GameService(first).createPlayer(playerId, base);
      const attempts = await Promise.allSettled([
        first.transaction(playerId, 0, { eventType: `isolation_${level}_a`, payload: {}, at: base }, (draft) => { draft.collection.collectionMarks += 1; return { winner: 'a' }; }),
        second.transaction(playerId, 0, { eventType: `isolation_${level}_b`, payload: {}, at: base }, (draft) => { draft.collection.collectionMarks += 1; return { winner: 'b' }; }),
      ]);
      assert.equal(attempts.filter((result) => result.status === 'fulfilled').length, 1, level);
      assert.equal(attempts.filter((result) => result.status === 'rejected' && result.reason?.code === 'STALE_REVISION').length, 1, level);
      assert.equal((await first.getPlayer(playerId)).stateRevision, 1, level);
      assert.equal((await first.getPlayer(playerId)).collection.collectionMarks, 1, level);

      const settlementId = randomUUID();
      const response = { settlementId, result: 'committed', level };
      const record = { settlementId, playerId, requestStartedAt: base.toISOString(), requestEndedAt: base.toISOString(), settledSeconds: 0, expectedRevision: 1, committedRevision: 2, configVersion: '1.0.0-frozen', summaryHash: `matrix-${level}`, status: 'committed' as const, responsePayload: response, createdAt: base.toISOString(), committedAt: base.toISOString() };
      const duplicate = await Promise.allSettled(Array.from({ length: 6 }, (_, worker) => (worker % 2 === 0 ? first : second).transaction(playerId, 1, { eventType: `isolation_${level}_settlement_${worker}`, settlementId, payload: {}, at: base }, (draft) => { draft.collection.collectionMarks += 1; return response; }, record)));
      assert.equal(duplicate.filter((result) => result.status === 'fulfilled').length, 6, level);
      assert.equal((await first.getPlayer(playerId)).stateRevision, 2, level);
      assert.equal((await first.getPlayer(playerId)).collection.collectionMarks, 2, level);
      assert.equal(Number((await firstPool.query('SELECT COUNT(*)::int AS count FROM settlement_record WHERE settlement_id = $1', [settlementId])).rows[0]?.count), 1, level);
    }
  } finally {
    if (playerIds.length > 0) await cleanup(pools[0]!, playerIds);
    await Promise.all(pools.map((pool) => pool.end()));
  }
});

type SqlStateError = Error & { code: string };
const sqlStateError = (code: string): SqlStateError => Object.assign(new Error(`injected SQLSTATE ${code}`), { code });

class SerializationOncePool {
  private injected = false;
  private readonly pool: Pool;
  constructor(pool: Pool) { this.pool = pool; }
  async connect(): Promise<AsyncSqlClient> {
    const client = await this.pool.connect();
    return {
      query: async <Row extends Record<string, unknown> = Record<string, unknown>>(text: string, params: readonly unknown[] = []): Promise<SqlResult<Row>> => {
        if (!this.injected && text.startsWith('UPDATE player_state')) {
          this.injected = true;
          throw sqlStateError('40001');
        }
        const result = await client.query<Row>(text, [...params]);
        return { rows: result.rows, rowCount: result.rowCount ?? undefined };
      },
      release: () => client.release(),
    };
  }
}

test('serialization failure is explicit after rollback and succeeds with configured retry', integrationOptions, async () => {
  const pool = new Pool({ connectionString: databaseUrl, max: 4 });
  const playerId = randomUUID();
  try {
    await applyMigrations(pool);
    await new GameService(new PostgresRepository(pool)).createPlayer(playerId, base);
    const noRetry = new PostgresRepository(new SerializationOncePool(pool), { serializationRetries: 0 });
    await assert.rejects(() => noRetry.transaction(playerId, 0, { eventType: 'serialization_failure', payload: {}, at: base }, (draft) => { draft.collection.collectionMarks += 1; }), (error: unknown) => error instanceof ApiError && error.code === 'TRANSACTION_RETRYABLE' && (error.details as { sqlState?: string }).sqlState === '40001');
    assert.equal((await new PostgresRepository(pool).getPlayer(playerId)).stateRevision, 0);

    const retry = new PostgresRepository(new SerializationOncePool(pool), { serializationRetries: 1 });
    await retry.transaction(playerId, 0, { eventType: 'serialization_retry', payload: {}, at: base }, (draft) => { draft.collection.collectionMarks += 1; });
    const recovered = await new PostgresRepository(pool).getPlayer(playerId);
    assert.equal(recovered.stateRevision, 1);
    assert.equal(recovered.collection.collectionMarks, 1);
  } finally {
    await cleanup(pool, [playerId]);
    await pool.end();
  }
});

test('a node-postgres Pool reconnects after its backend connection is terminated', integrationOptions, async () => {
  const pool = new Pool({ connectionString: databaseUrl, max: 2 });
  const killer = new Pool({ connectionString: databaseUrl, max: 2 });
  pool.on('error', () => { /* a terminated idle client is expected in this test */ });
  const playerId = randomUUID();
  try {
    await applyMigrations(pool);
    const repository = new PostgresRepository(pool);
    await new GameService(repository).createPlayer(playerId, base);
    const client = await pool.connect();
    try {
      const pid = Number((await client.query('SELECT pg_backend_pid() AS pid')).rows[0]?.pid);
      assert.ok(Number.isInteger(pid) && pid > 0);
      const terminated = await killer.query('SELECT pg_terminate_backend($1) AS terminated', [pid]);
      assert.equal(terminated.rows[0]?.terminated, true);
      await assert.rejects(() => client.query('SELECT 1'));
    } finally {
      client.release();
    }
    // node-postgres removes the terminated idle client asynchronously.
    await new Promise((resolve) => setTimeout(resolve, 100));
    await repository.transaction(playerId, 0, { eventType: 'pool_reconnect', payload: {}, at: base }, (draft) => { draft.collection.collectionMarks += 1; });
    const state = await repository.getPlayer(playerId);
    assert.equal(state.stateRevision, 1);
    assert.equal(state.collection.collectionMarks, 1);
  } finally {
    await cleanup(pool, [playerId]);
    await Promise.all([pool.end(), killer.end()]);
  }
});

test('PostgreSQL pending scanner drains a long batch stream without duplicate commits', integrationOptions, async () => {
  const pool = new Pool({ connectionString: databaseUrl, max: 16 });
  const repository = new PostgresRepository(pool);
  const service = new GameService(repository);
  const playerIds: string[] = [];
  const pendingIds: string[] = [];
  const count = 48;
  const batchSize = 7;
  const endedAt = new Date(base.getTime() + 3_600_000);
  const scanAt = new Date(base.getTime() + 7_200_000);
  try {
    await applyMigrations(pool);
    for (let index = 0; index < count; index += 1) {
      const playerId = randomUUID();
      const settlementId = randomUUID();
      playerIds.push(playerId);
      pendingIds.push(settlementId);
      await service.createPlayer(playerId, base);
      const started = await service.startAction({ playerId, actionId: 'training', expectedRevision: 0, now: base });
      await repository.recordSettlement({
        settlementId,
        playerId,
        requestStartedAt: base.toISOString(),
        requestEndedAt: endedAt.toISOString(),
        settledSeconds: 3_600,
        expectedRevision: started.stateRevision,
        committedRevision: null,
        configVersion: '1.0.0-frozen',
        summaryHash: `long-pressure-${index}`,
        status: 'pending',
        responsePayload: { settlementId, status: 'pending' },
        createdAt: base.toISOString(),
        committedAt: null,
      });
    }

    // Advance one player after its reservation to force a final rejected row;
    // the other 47 rows must recover through the normal settlement path.
    await repository.transaction(playerIds[0]!, 1, { eventType: 'long_pressure_make_stale', payload: {}, at: new Date(base.getTime() + 1000) }, (draft) => { draft.collection.collectionMarks += 1; });

    const scanner = new PendingSettlementScanner(repository, new GameService(repository, () => scanAt), { batchSize, minAgeMs: 0, clock: () => scanAt });
    let scanned = 0;
    let committed = 0;
    let rejected = 0;
    let passes = 0;
    while (passes < 20) {
      const result = await scanner.scanOnce();
      passes += 1;
      scanned += result.scanned;
      committed += result.committed;
      rejected += result.rejected;
      assert.equal(result.retryable, 0, `unexpected retryable rows on pass ${passes}`);
      if (result.scanned === 0) break;
    }
    assert.ok(passes <= 9, `scanner needed too many batches: ${passes}`);
    assert.equal(scanned, count);
    assert.equal(committed, count - 1);
    assert.equal(rejected, 1);
    assert.deepEqual(await scanner.scanOnce(), { scanned: 0, committed: 0, rejected: 0, retryable: 0 });
    assert.equal((await repository.listPendingSettlements(100, scanAt)).length, 0);

    const finalStates = await Promise.all(playerIds.map((playerId) => repository.getPlayer(playerId)));
    assert.equal(finalStates[0]!.stateRevision, 2);
    assert.equal(finalStates[0]!.collection.collectionMarks, 1);
    for (const state of finalStates.slice(1)) {
      assert.equal(state.stateRevision, 2);
      assert.equal(state.cultivationXp, 4_200);
    }
    const settlementRows = await pool.query('SELECT status, COUNT(*)::int AS count FROM settlement_record WHERE settlement_id = ANY($1::uuid[]) GROUP BY status ORDER BY status', [pendingIds]);
    assert.deepEqual(settlementRows.rows.map((row) => ({ status: String(row.status), count: Number(row.count) })), [{ status: 'committed', count: count - 1 }, { status: 'rejected', count: 1 }]);
  } finally {
    if (playerIds.length > 0) await cleanup(pool, playerIds);
    await pool.end();
  }
});

test('PostgreSQL dungeon combat events round-trip and replay unchanged', integrationOptions, async () => {
  const pool = new Pool({ connectionString: databaseUrl, max: 4 });
  const playerId = randomUUID();
  try {
    await applyMigrations(pool);
    const repository = new PostgresRepository(pool);
    const service = new GameService(repository);
    await service.createPlayer(playerId, base);
    const started = await service.startDungeon({ playerId, dungeonId: 'qing_feng', seed: 123, expectedRevision: 0, now: base });
    const settled = await service.settleDungeon({ playerId, attemptId: started.data.attemptId, expectedRevision: 1, now: new Date(base.getTime() + 600_000) });
    assert.ok(settled.data.combatEvents.length > 0);
    assert.equal(settled.data.combatEvents.at(-1)?.kind, 'combat_end');
    const restarted = new PostgresRepository(pool);
    const restored = await restarted.getPlayer(playerId);
    assert.deepEqual(restored.dungeonAttempts[started.data.attemptId]?.combatEvents, settled.data.combatEvents);
    const replay = await new GameService(restarted).settleDungeon({ playerId, attemptId: started.data.attemptId, expectedRevision: 999, now: new Date(base.getTime() + 601_000) });
    assert.deepEqual(replay, settled);
  } finally {
    await cleanup(pool, [playerId]);
    await pool.end();
  }
});

test('PostgreSQL collection events round-trip with immutable payload hashes and cursor paging', integrationOptions, async () => {
  const pool = new Pool({ connectionString: databaseUrl, max: 4 });
  const playerId = randomUUID();
  try {
    await applyMigrations(pool);
    const repository = new PostgresRepository(pool);
    await new GameService(repository).createPlayer(playerId, base);
    await repository.transaction(playerId, 0, { eventType: 'collection_pg_seed', payload: { source: 'integration' }, at: base }, (draft) => { draft.collection.collectionMarks = 1; });
    await repository.transaction(playerId, 1, { eventType: 'collection_pg_second', payload: { source: 'integration-2' }, at: new Date(base.getTime() + 1000) }, (draft) => { draft.collection.collectionMarks = 2; });
    const restartedPool = new Pool({ connectionString: databaseUrl, max: 2 });
    const restarted = new PostgresRepository(restartedPool);
    try {
      const first = await restarted.listCollectionEvents(playerId, 1);
      assert.equal(first.length, 1);
      assert.equal(first[0]?.eventType, 'collection_pg_second');
      assert.equal(first[0]?.payloadHash, hashPayload(first[0]?.payload));
      const second = await restarted.listCollectionEvents(playerId, 1, { createdAt: new Date(first[0]!.createdAt), eventId: first[0]!.eventId });
      assert.equal(second.length, 1);
      assert.equal(second[0]?.eventType, 'collection_pg_seed');
      const rows = await pool.query('SELECT COUNT(*)::int AS count FROM collection_event WHERE player_id = $1', [playerId]);
      assert.equal(Number(rows.rows[0]?.count), 2);
    } finally {
      await restartedPool.end();
    }
  } finally {
    await cleanup(pool, [playerId]);
    await pool.end();
  }
});

test('PostgreSQL bounded long-horizon pressure preserves multi-player revisions and settlement idempotency', integrationOptions, async () => {
  const pool = new Pool({ connectionString: databaseUrl, max: 16 });
  const repository = new PostgresRepository(pool);
  const service = new GameService(repository);
  // This is a repeatable capacity floor for the MVP persistence contract,
  // rather than a claim about production-scale throughput. Keep it large
  // enough to exercise pool contention and multi-player CAS over a long run.
  const playerCount = 64;
  const rounds = 24;
  const playerIds = Array.from({ length: playerCount }, () => randomUUID());
  const hourMs = 3_600_000;
  const responses = new Map<string, { playerId: string; expectedRevision: number; response: Awaited<ReturnType<GameService['offlineSettlement']>> }>();
  const pressureStartedAt = performance.now();
  try {
    await applyMigrations(pool);
    await Promise.all(playerIds.map((playerId) => service.createPlayer(playerId, base)));
    await Promise.all(playerIds.map((playerId) => service.startAction({ playerId, actionId: 'training', expectedRevision: 0, now: base })));

    for (let round = 1; round <= rounds; round += 1) {
      const endedAt = new Date(base.getTime() + round * hourMs);
      await Promise.all(playerIds.map(async (playerId) => {
        const expectedRevision = round;
        const settlementId = randomUUID();
        const result = await service.offlineSettlement({ playerId, settlementId, requestedStartedAt: new Date(endedAt.getTime() - hourMs).toISOString(), requestedEndedAt: endedAt.toISOString(), expectedRevision, now: endedAt });
        responses.set(settlementId, { playerId, expectedRevision, response: result });
      }));
    }

    const sample = [...responses.entries()][Math.floor(responses.size / 2)];
    assert.ok(sample);
    const [sampleSettlementId, sampleMeta] = sample;
    const replay = await service.offlineSettlement({ playerId: sampleMeta.playerId, settlementId: sampleSettlementId, requestedStartedAt: base.toISOString(), requestedEndedAt: new Date(base.getTime() + hourMs).toISOString(), expectedRevision: 999_999, now: new Date(base.getTime() + rounds * hourMs) });
    assert.deepEqual(replay, sampleMeta.response, 'replaying a committed settlement must not depend on the current revision or request interval');

    const states = await Promise.all(playerIds.map((playerId) => repository.getPlayer(playerId)));
    for (const state of states) {
      assert.equal(state.stateRevision, rounds + 1);
      assert.ok(state.cultivationXp >= 0);
    }
    const settlementRows = await pool.query('SELECT status, COUNT(*)::int AS count FROM settlement_record WHERE player_id = ANY($1::uuid[]) GROUP BY status ORDER BY status', [playerIds]);
    assert.deepEqual(settlementRows.rows.map((row) => ({ status: String(row.status), count: Number(row.count) })), [{ status: 'committed', count: playerIds.length * rounds }]);
    assert.ok(performance.now() - pressureStartedAt < 15_000, 'MVP capacity floor exceeded 15 seconds');
  } finally {
    await cleanup(pool, playerIds);
    await pool.end();
  }
});
