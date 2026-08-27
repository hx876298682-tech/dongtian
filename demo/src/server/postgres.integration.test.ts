import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { applyMigrations } from './migrations.ts';
import { PostgresRepository } from './postgres-repository.ts';
import type { AsyncSqlClient, SqlResult } from './postgres-repository.ts';
import { MemoryRepository, hashPayload, makeInitialPlayer } from './repository.ts';
import { GameService } from './service.ts';
import { ConfigReleaseRegistry } from './config-release.ts';
import { PostgresConfigReleaseProvider, PostgresConfigReleaseRepository } from './config-release-postgres.ts';
import { CONTENT_PACKAGE } from '../content/content-schema.ts';
import { FROZEN_PARAMETER_SHA256 } from '../game/frozen-parameters.ts';
import { PostgresMetricsStore } from './metrics-postgres.ts';
import { PendingSettlementScanner } from './pending-settlement-scanner.ts';

const databaseUrl = process.env.DATABASE_URL;
const integrationOptions = { skip: !databaseUrl, concurrency: false } as const;

type FaultPlan = { queryToken?: string; commitNumber?: number; commitAfterApply?: boolean };

/**
 * A deterministic network/SQL fault harness.  `commitAfterApply` models the
 * important ambiguous case where PostgreSQL committed but the client lost
 * the response; the retry must discover the durable settlement record.
 */
class FaultInjectingPool {
  private readonly delegate: { connect: () => Promise<AsyncSqlClient> };
  private readonly plan: FaultPlan;
  private queryFailures = 0;
  private commitCount = 0;
  private injected = false;

  constructor(delegate: { connect: () => Promise<AsyncSqlClient> }, plan: FaultPlan) {
    this.delegate = delegate;
    this.plan = plan;
  }

  async connect(): Promise<AsyncSqlClient> {
    const client = await this.delegate.connect();
    return {
      query: async <Row extends Record<string, unknown> = Record<string, unknown>>(text: string, params: readonly unknown[] = []): Promise<SqlResult<Row>> => {
        if (this.plan.queryToken && !this.injected && text.includes(this.plan.queryToken)) {
          this.injected = true;
          this.queryFailures += 1;
          throw new Error(`injected SQL interruption: ${this.plan.queryToken}`);
        }
        if (text === 'COMMIT') {
          this.commitCount += 1;
          if (!this.injected && this.plan.commitNumber === this.commitCount) {
            this.injected = true;
            if (this.plan.commitAfterApply) await client.query<Row>(text, params);
            throw new Error('injected network interruption after COMMIT');
          }
        }
        return client.query<Row>(text, params);
      },
      release: () => client.release?.(),
    };
  }

  get injectedCount(): number { return this.queryFailures + (this.injected && this.plan.commitNumber !== undefined ? 1 : 0); }
}

test('real PostgreSQL integration preserves state, fractional carry and CAS', integrationOptions, async () => {
  const pool = new Pool({ connectionString: databaseUrl });
  const playerId = randomUUID();
  const otherPlayerId = randomUUID();
  const startedAt = new Date('2026-08-25T00:00:00.000Z');
  try {
    await applyMigrations(pool);
    const repository = new PostgresRepository(pool);
    const service = new GameService(repository);
    await service.createPlayer(playerId, startedAt);
    await service.createPlayer(otherPlayerId, startedAt);

    const first = await repository.getPlayer(playerId);
    const other = await repository.getPlayer(otherPlayerId);
    assert.deepEqual(Object.keys(first.equipmentInstances), Object.keys(other.equipmentInstances));
    await repository.transaction(playerId, first.stateRevision, { eventType: 'integration_seed', payload: {}, at: startedAt }, (draft) => {
      draft.buildings.spirit_farm.carrySeconds = 123.5;
    });
    const seeded = await repository.getPlayer(playerId);
    const end = new Date(startedAt.getTime() + 3600 * 1000);
    const settlementId = randomUUID();
    const settlement = await service.offlineSettlement({ playerId, settlementId, requestedStartedAt: startedAt.toISOString(), requestedEndedAt: end.toISOString(), expectedRevision: seeded.stateRevision, now: end });
    assert.equal(settlement.data.settledSeconds, 3600);
    const settled = await repository.getPlayer(playerId);
    assert.equal(settled.buildings.spirit_farm.carrySeconds, 3723.5);

    // A fresh repository instance must recover the committed settlement payload
    // without recalculating it, as a process restart would.
    const restartedRepository = new PostgresRepository(pool);
    const replayed = await restartedRepository.getSettlement(settlementId);
    assert.equal(replayed?.status, 'committed');
    assert.deepEqual(replayed?.responsePayload, settlement);

    const expectedRevision = settled.stateRevision;
    const attempts = await Promise.allSettled(Array.from({ length: 8 }, (_, index) => repository.transaction(playerId, expectedRevision, { eventType: `integration_cas_${index}`, payload: {}, at: end }, (draft) => { draft.collection.collectionMarks += 1; })));
    assert.equal(attempts.filter((result) => result.status === 'fulfilled').length, 1);
    assert.equal(attempts.filter((result) => result.status === 'rejected' && result.reason?.code === 'STALE_REVISION').length, 7);
  } finally {
    await pool.query('DELETE FROM audit_event WHERE player_id = ANY($1::uuid[])', [[playerId, otherPlayerId]]);
    await pool.query('DELETE FROM action_idempotency WHERE player_id = ANY($1::uuid[])', [[playerId, otherPlayerId]]);
    await pool.query('DELETE FROM settlement_record WHERE player_id = ANY($1::uuid[])', [[playerId, otherPlayerId]]);
    await pool.query('DELETE FROM dungeon_attempt WHERE player_id = ANY($1::uuid[])', [[playerId, otherPlayerId]]);
    await pool.query('DELETE FROM building_job WHERE player_id = ANY($1::uuid[])', [[playerId, otherPlayerId]]);
    await pool.query('DELETE FROM building_state WHERE player_id = ANY($1::uuid[])', [[playerId, otherPlayerId]]);
    await pool.query('DELETE FROM inventory_resource WHERE player_id = ANY($1::uuid[])', [[playerId, otherPlayerId]]);
    await pool.query('DELETE FROM equipment_instance WHERE player_id = ANY($1::uuid[])', [[playerId, otherPlayerId]]);
    await pool.query('DELETE FROM collection_state WHERE player_id = ANY($1::uuid[])', [[playerId, otherPlayerId]]);
    await pool.query('DELETE FROM progress_state WHERE player_id = ANY($1::uuid[])', [[playerId, otherPlayerId]]);
    await pool.query('DELETE FROM player_state WHERE player_id = ANY($1::uuid[])', [[playerId, otherPlayerId]]);
    await pool.end();
  }
});

test('real PostgreSQL integration round-trips dungeon attempt config snapshots across repository restart', integrationOptions, async () => {
  const pool = new Pool({ connectionString: databaseUrl });
  const playerId = randomUUID();
  const startedAt = new Date('2026-08-26T00:00:00.000Z');
  try {
    await applyMigrations(pool);
    const repository = new PostgresRepository(pool);
    const service = new GameService(repository);
    await service.createPlayer(playerId, startedAt);
    const started = await service.startDungeon({ playerId, dungeonId: 'qing_feng', seed: 31, expectedRevision: 0, now: startedAt });
    const restarted = new PostgresRepository(pool);
    const restored = await restarted.getPlayer(playerId);
    const attempt = restored.dungeonAttempts[started.data.attemptId];
    assert.equal(attempt.configVersion, started.configVersion);
    assert.equal(attempt.configSnapshot?.version, started.configVersion);
    assert.equal(attempt.configSnapshot?.parameterSha256, FROZEN_PARAMETER_SHA256);
  } finally {
    await pool.query('DELETE FROM audit_event WHERE player_id = $1', [playerId]);
    await pool.query('DELETE FROM action_idempotency WHERE player_id = $1', [playerId]);
    await pool.query('DELETE FROM dungeon_attempt WHERE player_id = $1', [playerId]);
    await pool.query('DELETE FROM building_job WHERE player_id = $1', [playerId]);
    await pool.query('DELETE FROM building_state WHERE player_id = $1', [playerId]);
    await pool.query('DELETE FROM inventory_resource WHERE player_id = $1', [playerId]);
    await pool.query('DELETE FROM equipment_instance WHERE player_id = $1', [playerId]);
    await pool.query('DELETE FROM collection_state WHERE player_id = $1', [playerId]);
    await pool.query('DELETE FROM progress_state WHERE player_id = $1', [playerId]);
    await pool.query('DELETE FROM player_state WHERE player_id = $1', [playerId]);
    await pool.end();
  }
});

test('real PostgreSQL integration bounds concurrent CAS, duplicate settlements and reload replay', integrationOptions, async () => {
  const pool = new Pool({ connectionString: databaseUrl, max: 12 });
  const playerId = randomUUID();
  const startedAt = new Date('2026-08-25T02:00:00.000Z');
  const settlementId = randomUUID();
  const pendingId = randomUUID();
  const response = { requestId: 'integration-settlement', configVersion: '1.0.0-frozen', stateRevision: 1, serverTime: startedAt.toISOString(), data: { ok: true } };
  try {
    await applyMigrations(pool);
    const repository = new PostgresRepository(pool);
    const service = new GameService(repository);
    await service.createPlayer(playerId, startedAt);

    const initial = await repository.getPlayer(playerId);
    const casAttempts = await Promise.allSettled(Array.from({ length: 8 }, (_, index) => repository.transaction(playerId, initial.stateRevision, { eventType: `integration_cas_burst_${index}`, payload: { index }, at: startedAt }, (draft) => { draft.collection.collectionMarks += 1; })));
    assert.equal(casAttempts.filter((result) => result.status === 'fulfilled').length, 1);
    assert.equal(casAttempts.filter((result) => result.status === 'rejected' && result.reason?.code === 'STALE_REVISION').length, 7);
    assert.equal((await repository.getPlayer(playerId)).collection.collectionMarks, 1);

    const afterCas = await repository.getPlayer(playerId);
    const record = { settlementId, playerId, requestStartedAt: startedAt.toISOString(), requestEndedAt: new Date(startedAt.getTime() + 60_000).toISOString(), settledSeconds: 60, expectedRevision: afterCas.stateRevision, committedRevision: afterCas.stateRevision + 1, configVersion: '1.0.0-frozen', summaryHash: 'integration-summary', status: 'committed' as const, responsePayload: response, createdAt: startedAt.toISOString(), committedAt: startedAt.toISOString() };
    const duplicateAttempts = await Promise.allSettled(Array.from({ length: 8 }, (_, index) => repository.transaction(playerId, afterCas.stateRevision, { eventType: `integration_settlement_burst_${index}`, settlementId, payload: { settlementId }, at: startedAt }, (draft) => { draft.collection.collectionMarks += 1; return response; }, record)));
    const duplicateFulfilled = duplicateAttempts.filter((result) => result.status === 'fulfilled').length;
    const duplicateStale = duplicateAttempts.filter((result) => result.status === 'rejected' && result.reason?.code === 'STALE_REVISION').length;
    assert.ok(duplicateFulfilled >= 1);
    assert.equal(duplicateFulfilled + duplicateStale, 8);
    const settlementRows = await pool.query('SELECT COUNT(*)::int AS count FROM settlement_record WHERE settlement_id = $1', [settlementId]);
    assert.equal(Number(settlementRows.rows[0]?.count), 1);

    await repository.recordSettlement({ settlementId: pendingId, playerId, requestStartedAt: startedAt.toISOString(), requestEndedAt: startedAt.toISOString(), settledSeconds: 0, expectedRevision: 0, committedRevision: null, configVersion: '1.0.0-frozen', summaryHash: 'pending-summary', status: 'pending', responsePayload: { pending: true }, createdAt: startedAt.toISOString(), committedAt: null });
    const reloadedRepository = new PostgresRepository(pool);
    const reloadedService = new GameService(reloadedRepository);
    const committedReplay = await reloadedService.replaySettlement(playerId, settlementId, { now: new Date(startedAt.getTime() + 1_000) });
    assert.equal(committedReplay.data.status, 'committed');
    assert.deepEqual(committedReplay.data.responsePayload, response);
    const pendingReplay = await reloadedService.replaySettlement(playerId, pendingId, { now: new Date(startedAt.getTime() + 1_000) });
    assert.equal(pendingReplay.data.status, 'pending');
    assert.deepEqual(pendingReplay.data.responsePayload, { pending: true });
  } finally {
    await pool.query('DELETE FROM audit_event WHERE player_id = $1', [playerId]);
    await pool.query('DELETE FROM action_idempotency WHERE player_id = $1', [playerId]);
    await pool.query('DELETE FROM settlement_record WHERE player_id = $1', [playerId]);
    await pool.query('DELETE FROM dungeon_attempt WHERE player_id = $1', [playerId]);
    await pool.query('DELETE FROM building_job WHERE player_id = $1', [playerId]);
    await pool.query('DELETE FROM building_state WHERE player_id = $1', [playerId]);
    await pool.query('DELETE FROM inventory_resource WHERE player_id = $1', [playerId]);
    await pool.query('DELETE FROM equipment_instance WHERE player_id = $1', [playerId]);
    await pool.query('DELETE FROM collection_state WHERE player_id = $1', [playerId]);
    await pool.query('DELETE FROM progress_state WHERE player_id = $1', [playerId]);
    await pool.query('DELETE FROM player_state WHERE player_id = $1', [playerId]);
    await pool.end();
  }
});

test('real PostgreSQL multi-instance lock pressure commits exactly one revision', integrationOptions, async () => {
  const pools = Array.from({ length: 4 }, () => new Pool({ connectionString: databaseUrl, max: 8 }));
  const setupPool = pools[0]!;
  const playerId = randomUUID();
  const startedAt = new Date('2026-08-25T03:30:00.000Z');
  try {
    await applyMigrations(setupPool);
    await new GameService(new PostgresRepository(setupPool)).createPlayer(playerId, startedAt);
    const expectedRevision = 0;
    const attempts = await Promise.allSettled(Array.from({ length: 32 }, (_, index) => {
      const repository = new PostgresRepository(pools[index % pools.length]!);
      return repository.transaction(playerId, expectedRevision, { eventType: `integration_multi_instance_cas_${index}`, payload: { index }, at: startedAt }, (draft) => {
        draft.collection.collectionMarks += 1;
        return { worker: index };
      });
    }));
    const fulfilled = attempts.filter((result) => result.status === 'fulfilled');
    const stale = attempts.filter((result) => result.status === 'rejected' && result.reason?.code === 'STALE_REVISION');
    assert.equal(fulfilled.length, 1);
    assert.equal(stale.length, 31);
    const final = await new PostgresRepository(setupPool).getPlayer(playerId);
    assert.equal(final.stateRevision, 1);
    assert.equal(final.collection.collectionMarks, 1);
    const audit = await setupPool.query('SELECT event_type, payload, payload_hash, COUNT(*) OVER()::int AS count FROM audit_event WHERE player_id = $1', [playerId]);
    assert.equal(Number(audit.rows[0]?.count), 1);
    const auditPayload = audit.rows[0]?.payload as { index?: number };
    assert.equal(typeof auditPayload.index, 'number');
    assert.equal(String(audit.rows[0]?.payload_hash), hashPayload({ index: auditPayload.index }));
  } finally {
    await setupPool.query('DELETE FROM audit_event WHERE player_id = $1', [playerId]);
    await setupPool.query('DELETE FROM action_idempotency WHERE player_id = $1', [playerId]);
    await setupPool.query('DELETE FROM settlement_record WHERE player_id = $1', [playerId]);
    await setupPool.query('DELETE FROM dungeon_attempt WHERE player_id = $1', [playerId]);
    await setupPool.query('DELETE FROM building_job WHERE player_id = $1', [playerId]);
    await setupPool.query('DELETE FROM building_state WHERE player_id = $1', [playerId]);
    await setupPool.query('DELETE FROM inventory_resource WHERE player_id = $1', [playerId]);
    await setupPool.query('DELETE FROM equipment_instance WHERE player_id = $1', [playerId]);
    await setupPool.query('DELETE FROM collection_state WHERE player_id = $1', [playerId]);
    await setupPool.query('DELETE FROM progress_state WHERE player_id = $1', [playerId]);
    await setupPool.query('DELETE FROM player_state WHERE player_id = $1', [playerId]);
    await Promise.all(pools.map((pool) => pool.end()));
  }
});

test('real PostgreSQL FI-05 collection exchange persists isolated mark pools across repository restart', integrationOptions, async () => {
  const pool = new Pool({ connectionString: databaseUrl, max: 4 });
  const playerId = randomUUID();
  const startedAt = new Date('2026-08-26T05:00:00.000Z');
  try {
    await applyMigrations(pool);
    const repository = new PostgresRepository(pool);
    const service = new GameService(repository);
    await service.createPlayer(playerId, startedAt);
    await repository.transaction(playerId, 0, { eventType: 'integration_seed_collection_pools', payload: {}, at: startedAt }, (draft) => {
      draft.collection.collectionMarks = 20;
      draft.collectionMarkBalances = { starter: 20, nascent_soul: 40 };
    });
    const exchanged = await service.collectionExchange({ playerId, poolId: 'starter', targetTreasureId: 'qing_lian_lamp', expectedRevision: 1, idempotencyKey: 'pg-fi05-exchange', now: new Date(startedAt.getTime() + 1_000) });
    assert.equal(exchanged.data.marksRemaining, 10);
    const restarted = new PostgresRepository(pool);
    const restored = await restarted.getPlayer(playerId);
    assert.deepEqual(restored.collectionMarkBalances, { starter: 10, nascent_soul: 40 });
    assert.equal(restored.collection.collectionMarks, 10);
    const row = await pool.query('SELECT mark_balances, collection_marks FROM collection_state WHERE player_id = $1', [playerId]);
    assert.deepEqual(row.rows[0]?.mark_balances, { starter: 10, nascent_soul: 40 });
    assert.equal(Number(row.rows[0]?.collection_marks), 10);
  } finally {
    await pool.query('DELETE FROM audit_event WHERE player_id = $1', [playerId]);
    await pool.query('DELETE FROM action_idempotency WHERE player_id = $1', [playerId]);
    await pool.query('DELETE FROM settlement_record WHERE player_id = $1', [playerId]);
    await pool.query('DELETE FROM collection_event WHERE player_id = $1', [playerId]);
    await pool.query('DELETE FROM dungeon_attempt WHERE player_id = $1', [playerId]);
    await pool.query('DELETE FROM building_job WHERE player_id = $1', [playerId]);
    await pool.query('DELETE FROM building_state WHERE player_id = $1', [playerId]);
    await pool.query('DELETE FROM inventory_resource WHERE player_id = $1', [playerId]);
    await pool.query('DELETE FROM equipment_instance WHERE player_id = $1', [playerId]);
    await pool.query('DELETE FROM collection_state WHERE player_id = $1', [playerId]);
    await pool.query('DELETE FROM progress_state WHERE player_id = $1', [playerId]);
    await pool.query('DELETE FROM player_state WHERE player_id = $1', [playerId]);
    await pool.end();
  }
});

test('real PostgreSQL metrics events aggregate across instances and survive store restart', integrationOptions, async () => {
  const pool = new Pool({ connectionString: databaseUrl, max: 8 });
  try {
    await applyMigrations(pool);
    await pool.query('TRUNCATE metrics_event');
    const first = new PostgresMetricsStore(pool, { instanceId: 'integration-metrics-a' });
    const second = new PostgresMetricsStore(pool, { instanceId: 'integration-metrics-b' });
    const snapshotAt = new Date('2026-08-25T03:00:00.000Z');
    await first.record({ type: 'settlement_success', at: new Date('2026-08-25T02:59:58.000Z'), durationMs: 120, resourceDelta: { spirit_stone: 10 } });
    await second.record({ type: 'settlement_rejected', at: new Date('2026-08-25T02:59:59.000Z'), resourceOverflow: { pill: 2 } });
    const restarted = new PostgresMetricsStore(pool, { instanceId: 'integration-metrics-restarted' });
    const snapshot = await restarted.snapshot(snapshotAt.getTime());
    assert.equal(snapshot.settlements.success, 1);
    assert.equal(snapshot.settlements.rejected, 1);
    assert.equal(snapshot.resources.spirit_stone.delta, 10);
    assert.equal(snapshot.resources.pill.overflow, 2);
    assert.match(await restarted.toPrometheus(), /dongtian_settlements_total\{outcome="rejected"\} 1/);
  } finally {
    await pool.query('TRUNCATE metrics_event');
    await pool.end();
  }
});

test('real PostgreSQL integration persists config release lifecycle, audit metadata and idempotent operations', integrationOptions, async () => {
  const pool = new Pool({ connectionString: databaseUrl });
  const releasePrefix = `integration-release-${randomUUID()}`;
  const firstVersion = `${releasePrefix}-first`;
  const secondVersion = `${releasePrefix}-second`;
  const createdAt = new Date('2026-08-25T04:00:00.000Z');
  const release = (version: string) => {
    const registry = new ConfigReleaseRegistry({ clock: () => createdAt.getTime() });
    return registry.registerDraft({ version, parameterSha256: FROZEN_PARAMETER_SHA256, contentSha256: CONTENT_PACKAGE.manifest.content_sha256, content: { ...CONTENT_PACKAGE, manifest: { ...CONTENT_PACKAGE.manifest, config_version: version } }, createdAt });
  };
  try {
    await applyMigrations(pool);
    // The integration database is dedicated to this harness. Clearing release
    // rows makes the test independent of any prior active seed or run.
    await pool.query('TRUNCATE config_release_audit, config_release_settlement, config_release RESTART IDENTITY CASCADE');
    const repository = new PostgresConfigReleaseRepository(pool);
    await repository.createDraft(release(firstVersion));
    await repository.validate(firstVersion, new Date(createdAt.getTime() + 1_000));
    const provider = new PostgresConfigReleaseProvider(repository);
    await repository.activate(firstVersion, new Date(createdAt.getTime() + 1_500));
    await provider.refresh();
    const service = new GameService(new MemoryRepository(), () => createdAt, undefined, undefined, undefined, provider);

    await repository.createDraft(release(secondVersion));
    await repository.validate(secondVersion, new Date(createdAt.getTime() + 2_000));
    const canary = await service.configReleaseOperation({ operation: 'canary', version: secondVersion, canaryPercent: 25, operatorSubject: 'integration-canary-operator', reason: 'start integration canary', idempotencyKey: 'integration-canary-1', now: new Date(createdAt.getTime() + 3_000) });
    assert.equal(canary.data.activeVersion, firstVersion);
    assert.equal((await repository.get(secondVersion))?.status, 'canary');
    assert.equal((await provider.getActiveSnapshot())?.version, firstVersion);

    const concurrentProvider = new PostgresConfigReleaseProvider(new PostgresConfigReleaseRepository(pool));
    await concurrentProvider.refresh();
    const concurrentService = new GameService(new MemoryRepository(), () => createdAt, undefined, undefined, undefined, concurrentProvider);
    const [activated, concurrentReplay] = await Promise.all([
      service.configReleaseOperation({ operation: 'activate', version: secondVersion, operatorSubject: 'integration-activate-operator', reason: 'promote integration canary', idempotencyKey: 'integration-activate-1', requestId: 'activate-request-a', now: new Date(createdAt.getTime() + 4_000) }),
      concurrentService.configReleaseOperation({ operation: 'activate', version: secondVersion, operatorSubject: 'integration-activate-operator', reason: 'promote integration canary', idempotencyKey: 'integration-activate-1', requestId: 'activate-request-b', now: new Date(createdAt.getTime() + 4_000) }),
    ]);
    assert.deepEqual(concurrentReplay, activated);
    // Rebuild both provider and service to model a process restart. The
    // response must come from config_release_operation, not the old process
    // local GameService response map.
    const restartedProvider = new PostgresConfigReleaseProvider(new PostgresConfigReleaseRepository(pool));
    await restartedProvider.refresh();
    const restartedService = new GameService(new MemoryRepository(), () => createdAt, undefined, undefined, undefined, restartedProvider);
    const repeated = await restartedService.configReleaseOperation({ operation: 'activate', version: secondVersion, operatorSubject: 'integration-activate-operator', reason: 'different reason must not reapply', idempotencyKey: 'integration-activate-1', now: new Date(createdAt.getTime() + 5_000) });
    assert.deepEqual(repeated, activated);
    assert.equal(activated.data.activeVersion, secondVersion);
    assert.equal((await repository.get(firstVersion))?.status, 'rolled_back');
    assert.equal((await repository.get(secondVersion))?.status, 'active');
    assert.equal((await provider.getActiveSnapshot())?.version, secondVersion);

    const rolledBack = await service.configReleaseOperation({ operation: 'rollback', version: firstVersion, operatorSubject: 'integration-rollback-operator', reason: 'restore previous integration release', idempotencyKey: 'integration-rollback-1', now: new Date(createdAt.getTime() + 6_000) });
    assert.equal(rolledBack.data.activeVersion, firstVersion);
    assert.equal((await repository.get(firstVersion))?.status, 'active');
    assert.equal((await repository.get(secondVersion))?.status, 'rolled_back');
    assert.equal((await provider.getActiveSnapshot())?.version, firstVersion);

    const audits = await pool.query<{ operation: string; target_version: string; from_version: string | null; to_version: string | null; operator_subject: string; reason: string }>('SELECT operation, target_version, from_version, to_version, operator_subject, reason FROM config_release_audit WHERE target_version = ANY($1::text[])', [[firstVersion, secondVersion]]);
    assert.equal(audits.rowCount, 3);
    assert.deepEqual(audits.rows.find((row) => row.operation === 'canary'), { operation: 'canary', target_version: secondVersion, from_version: firstVersion, to_version: firstVersion, operator_subject: 'integration-canary-operator', reason: 'start integration canary' });
    assert.deepEqual(audits.rows.find((row) => row.operation === 'activate'), { operation: 'activate', target_version: secondVersion, from_version: firstVersion, to_version: secondVersion, operator_subject: 'integration-activate-operator', reason: 'promote integration canary' });
    assert.deepEqual(audits.rows.find((row) => row.operation === 'rollback'), { operation: 'rollback', target_version: firstVersion, from_version: secondVersion, to_version: firstVersion, operator_subject: 'integration-rollback-operator', reason: 'restore previous integration release' });
  } finally {
    await pool.query('TRUNCATE config_release_audit, config_release_settlement, config_release RESTART IDENTITY CASCADE');
    await pool.end();
  }
});

test('real PostgreSQL integration restores high-tier expedition state and settlement replay across repository restart', integrationOptions, async () => {
  const pool = new Pool({ connectionString: databaseUrl });
  const playerId = randomUUID();
  const startedAt = new Date('2026-08-25T06:00:00.000Z');
  const expeditionSettlementId = randomUUID();
  try {
    await applyMigrations(pool);
    const repository = new PostgresRepository(pool);
    const service = new GameService(repository);
    await service.createPlayer(playerId, startedAt);
    await repository.transaction(playerId, 0, { eventType: 'integration_seed_restart_expedition', payload: {}, at: startedAt }, (draft) => {
      draft.realmId = 'nascent_soul';
      draft.collection.collectionMarks = 10;
      draft.resources.pill.amount = 100;
      draft.equipmentInstances['equipment.iron_saber.initial'].affixes = { attack: 245, defence: 192.5, health: 3000 };
      draft.buildings.spirit_farm.carrySeconds = 12.75;
    });

    const start = await service.startAction({ playerId, actionId: 'high_tier_expedition:nascent_soul', expectedRevision: 1, now: startedAt });
    const restartedBeforeSettlement = new PostgresRepository(pool);
    const restoredBeforeSettlement = await restartedBeforeSettlement.getPlayer(playerId);
    assert.equal(restoredBeforeSettlement.primaryAction.actionId, 'high_tier_expedition:nascent_soul');
    assert.equal(restoredBeforeSettlement.primaryAction.carrySeconds, 0);
    assert.equal(restoredBeforeSettlement.buildings.spirit_farm.carrySeconds, 12.75);
    assert.equal(restoredBeforeSettlement.resources.spirit_stone.capacity, 100_000);

    const restartedService = new GameService(restartedBeforeSettlement);
    const end = new Date(startedAt.getTime() + 3600 * 1000);
    const expeditionSettlement = await restartedService.offlineSettlement({ playerId, settlementId: expeditionSettlementId, requestedStartedAt: startedAt.toISOString(), requestedEndedAt: end.toISOString(), expectedRevision: start.stateRevision, now: end });
    const restartedAfterSettlement = new PostgresRepository(pool);
    const restartedSettlementService = new GameService(restartedAfterSettlement);
    const duplicateExpeditionSettlement = await restartedSettlementService.offlineSettlement({ playerId, settlementId: expeditionSettlementId, requestedStartedAt: startedAt.toISOString(), requestedEndedAt: end.toISOString(), expectedRevision: 999, now: new Date(end.getTime() + 1_000) });
    assert.deepEqual(duplicateExpeditionSettlement, expeditionSettlement);
    const settledState = await restartedAfterSettlement.getPlayer(playerId);
    assert.equal(settledState.resources.spirit_stone.amount, 5_620 + (expeditionSettlement.data.resourceDelta.spirit_stone ?? 0));
    assert.equal(settledState.buildings.spirit_farm.carrySeconds, 3_612.75);
    const replayed = await restartedSettlementService.replaySettlement(playerId, expeditionSettlementId, { now: new Date(end.getTime() + 2_000) });
    assert.deepEqual(replayed.data.responsePayload, expeditionSettlement);
    assert.equal(replayed.data.settledSeconds, 3600);
    const stoppedExpedition = await restartedSettlementService.stopAction({ playerId, settlementId: randomUUID(), requestedStartedAt: end.toISOString(), requestedEndedAt: end.toISOString(), expectedRevision: settledState.stateRevision, now: end });
    const bossStart = await restartedSettlementService.startHighTier({ playerId, realm: 'nascent_soul', seed: 123, expectedRevision: stoppedExpedition.stateRevision, now: end });
    const bossReloaded = new PostgresRepository(pool);
    const bossStateBeforeSettle = await bossReloaded.getPlayer(playerId);
    assert.equal(bossStateBeforeSettle.highTierAttempts[bossStart.data.attemptId].skillSuppressedSeconds, 0);
    assert.deepEqual(bossStateBeforeSettle.highTierAttempts[bossStart.data.attemptId].skill, bossStart.data.skill);
    assert.equal(bossStateBeforeSettle.highTierAttempts[bossStart.data.attemptId].configVersion, bossStart.configVersion);
    assert.equal(bossStateBeforeSettle.highTierAttempts[bossStart.data.attemptId].configSnapshot?.version, bossStart.configVersion);
    const bossSettleAt = new Date(end.getTime() + bossStart.data.targetClearTime * 1000);
    const bossSettlement = await new GameService(bossReloaded).settleHighTier({ playerId, attemptId: bossStart.data.attemptId, expectedRevision: bossStart.stateRevision, now: bossSettleAt });
    assert.equal(bossSettlement.data.status, 'succeeded');
    assert.equal(bossSettlement.data.skillSuppressedSeconds, 2);
    const finalRepository = new PostgresRepository(pool);
    const finalState = await finalRepository.getPlayer(playerId);
    assert.equal(finalState.highTierAttempts[bossStart.data.attemptId].skillSuppressedSeconds, 2);
    assert.deepEqual(finalState.highTierAttempts[bossStart.data.attemptId].skill, bossStart.data.skill);
    assert.equal(finalState.highTierAttempts[bossStart.data.attemptId].configSnapshot?.version, bossStart.configVersion);
  } finally {
    await pool.query('DELETE FROM audit_event WHERE player_id = $1', [playerId]);
    await pool.query('DELETE FROM action_idempotency WHERE player_id = $1', [playerId]);
    await pool.query('DELETE FROM settlement_record WHERE player_id = $1', [playerId]);
    await pool.query('DELETE FROM dungeon_attempt WHERE player_id = $1', [playerId]);
    await pool.query('DELETE FROM building_job WHERE player_id = $1', [playerId]);
    await pool.query('DELETE FROM building_state WHERE player_id = $1', [playerId]);
    await pool.query('DELETE FROM inventory_resource WHERE player_id = $1', [playerId]);
    await pool.query('DELETE FROM equipment_instance WHERE player_id = $1', [playerId]);
    await pool.query('DELETE FROM collection_state WHERE player_id = $1', [playerId]);
    await pool.query('DELETE FROM progress_state WHERE player_id = $1', [playerId]);
    await pool.query('DELETE FROM player_state WHERE player_id = $1', [playerId]);
    await pool.end();
  }
});

test('real PostgreSQL fault injection rolls back multi-step writes and resumes pending settlement', integrationOptions, async () => {
  const pool = new Pool({ connectionString: databaseUrl });
  const playerId = randomUUID();
  const startedAt = new Date('2026-08-25T08:00:00.000Z');
  const end = new Date(startedAt.getTime() + 3_600_000);
  const settlementId = randomUUID();
  try {
    await applyMigrations(pool);
    const baseRepository = new PostgresRepository(pool);
    const baseService = new GameService(baseRepository);
    await baseService.createPlayer(playerId, startedAt);
    const started = await baseService.startAction({ playerId, actionId: 'training', expectedRevision: 0, now: startedAt });
    const before = await baseRepository.getPlayer(playerId);

    const faultyPool = new FaultInjectingPool(pool, { queryToken: 'INSERT INTO building_state' });
    const faultyService = new GameService(new PostgresRepository(faultyPool), () => end);
    await assert.rejects(() => faultyService.offlineSettlement({ playerId, settlementId, requestedStartedAt: startedAt.toISOString(), requestedEndedAt: end.toISOString(), expectedRevision: started.stateRevision, now: end }), (error: unknown) => error instanceof Error && (error as { code?: string }).code === 'INTERNAL_ROLLBACK');

    const afterFault = await baseRepository.getPlayer(playerId);
    assert.deepEqual(afterFault, before);
    assert.equal((await baseRepository.getSettlement(settlementId))?.status, 'pending');

    const recovered = await baseService.offlineSettlement({ playerId, settlementId, requestedStartedAt: startedAt.toISOString(), requestedEndedAt: end.toISOString(), expectedRevision: started.stateRevision, now: end });
    assert.equal(recovered.data.cultivationDelta, 4200);
    assert.equal((await baseRepository.getPlayer(playerId)).cultivationXp, 4200);
    assert.equal((await baseRepository.getSettlement(settlementId))?.status, 'committed');
    const replay = await baseService.offlineSettlement({ playerId, settlementId, requestedStartedAt: startedAt.toISOString(), requestedEndedAt: end.toISOString(), expectedRevision: 999, now: new Date(end.getTime() + 1_000) });
    assert.deepEqual(replay, recovered);
    assert.equal((await baseRepository.getPlayer(playerId)).stateRevision, 2);
  } finally {
    await pool.query('DELETE FROM audit_event WHERE player_id = $1', [playerId]);
    await pool.query('DELETE FROM action_idempotency WHERE player_id = $1', [playerId]);
    await pool.query('DELETE FROM settlement_record WHERE player_id = $1', [playerId]);
    await pool.query('DELETE FROM dungeon_attempt WHERE player_id = $1', [playerId]);
    await pool.query('DELETE FROM building_job WHERE player_id = $1', [playerId]);
    await pool.query('DELETE FROM building_state WHERE player_id = $1', [playerId]);
    await pool.query('DELETE FROM inventory_resource WHERE player_id = $1', [playerId]);
    await pool.query('DELETE FROM equipment_instance WHERE player_id = $1', [playerId]);
    await pool.query('DELETE FROM collection_state WHERE player_id = $1', [playerId]);
    await pool.query('DELETE FROM progress_state WHERE player_id = $1', [playerId]);
    await pool.query('DELETE FROM player_state WHERE player_id = $1', [playerId]);
    await pool.end();
  }
});

test('real PostgreSQL pending scanner recovers durable reservations and finalizes stale ones', integrationOptions, async () => {
  const pool = new Pool({ connectionString: databaseUrl, max: 8 });
  const playerId = randomUUID();
  const stalePlayerId = randomUUID();
  const startedAt = new Date('2026-08-25T08:30:00.000Z');
  const end = new Date(startedAt.getTime() + 3_600_000);
  const scanAt = new Date(end.getTime() + 3_600_000);
  const settlementId = randomUUID();
  const staleSettlementId = randomUUID();
  try {
    await applyMigrations(pool);
    const repository = new PostgresRepository(pool);
    const service = new GameService(repository);
    await service.createPlayer(playerId, startedAt);
    await service.createPlayer(stalePlayerId, startedAt);
    const started = await service.startAction({ playerId, actionId: 'training', expectedRevision: 0, now: startedAt });
    const staleStarted = await service.startAction({ playerId: stalePlayerId, actionId: 'training', expectedRevision: 0, now: startedAt });

    const faultyService = new GameService(new PostgresRepository(new FaultInjectingPool(pool, { queryToken: 'INSERT INTO building_state' })), () => end);
    await assert.rejects(() => faultyService.offlineSettlement({ playerId, settlementId, requestedStartedAt: startedAt.toISOString(), requestedEndedAt: end.toISOString(), expectedRevision: started.stateRevision, now: end }), (error: unknown) => error instanceof Error && (error as { code?: string }).code === 'INTERNAL_ROLLBACK');
    const staleFaultyService = new GameService(new PostgresRepository(new FaultInjectingPool(pool, { queryToken: 'INSERT INTO building_state' })), () => end);
    await assert.rejects(() => staleFaultyService.offlineSettlement({ playerId: stalePlayerId, settlementId: staleSettlementId, requestedStartedAt: startedAt.toISOString(), requestedEndedAt: end.toISOString(), expectedRevision: staleStarted.stateRevision, now: end }), (error: unknown) => error instanceof Error && (error as { code?: string }).code === 'INTERNAL_ROLLBACK');
    await repository.transaction(stalePlayerId, staleStarted.stateRevision, { eventType: 'integration_make_pending_stale', payload: {}, at: end }, (draft) => { draft.collection.collectionMarks += 1; });

    const scanner = new PendingSettlementScanner(repository, new GameService(repository, () => scanAt), { batchSize: 10, minAgeMs: 0, clock: () => scanAt });
    assert.deepEqual(await scanner.scanOnce(), { scanned: 2, committed: 1, rejected: 1, retryable: 0 });
    assert.equal((await repository.getSettlement(settlementId))?.status, 'committed');
    assert.equal((await repository.getSettlement(staleSettlementId))?.status, 'rejected');
    assert.equal((await repository.getPlayer(playerId)).cultivationXp, 4200);
    assert.equal((await repository.getPlayer(playerId)).stateRevision, 2);
    assert.equal((await repository.getPlayer(stalePlayerId)).collection.collectionMarks, 1);
    assert.equal((await repository.getPlayer(stalePlayerId)).stateRevision, 2);
  } finally {
    for (const id of [playerId, stalePlayerId]) {
      await pool.query('DELETE FROM audit_event WHERE player_id = $1', [id]);
      await pool.query('DELETE FROM action_idempotency WHERE player_id = $1', [id]);
      await pool.query('DELETE FROM settlement_record WHERE player_id = $1', [id]);
      await pool.query('DELETE FROM dungeon_attempt WHERE player_id = $1', [id]);
      await pool.query('DELETE FROM building_job WHERE player_id = $1', [id]);
      await pool.query('DELETE FROM building_state WHERE player_id = $1', [id]);
      await pool.query('DELETE FROM inventory_resource WHERE player_id = $1', [id]);
      await pool.query('DELETE FROM equipment_instance WHERE player_id = $1', [id]);
      await pool.query('DELETE FROM collection_state WHERE player_id = $1', [id]);
      await pool.query('DELETE FROM progress_state WHERE player_id = $1', [id]);
      await pool.query('DELETE FROM player_state WHERE player_id = $1', [id]);
    }
    await pool.end();
  }
});

test('real PostgreSQL pending scanner claims prevent duplicate work across instances and recover expired leases', integrationOptions, async () => {
  const pool = new Pool({ connectionString: databaseUrl, max: 8 });
  const playerId = randomUUID();
  const settlementId = randomUUID();
  const startedAt = new Date('2026-08-26T08:30:00.000Z');
  try {
    await applyMigrations(pool);
    const repositoryA = new PostgresRepository(pool);
    const repositoryB = new PostgresRepository(pool);
    await repositoryA.createPlayer(makeInitialPlayer(playerId, startedAt));
    await repositoryA.recordSettlement({
      settlementId,
      playerId,
      requestStartedAt: startedAt.toISOString(),
      requestEndedAt: new Date(startedAt.getTime() + 3_600_000).toISOString(),
      settledSeconds: 0,
      expectedRevision: 0,
      committedRevision: null,
      configVersion: '1.0.0-frozen',
      summaryHash: 'claim-test',
      status: 'pending',
      responsePayload: { settlementId, status: 'pending' },
      createdAt: startedAt.toISOString(),
      committedAt: null,
    });
    const claimAt = new Date(startedAt.getTime() + 10_000);
    const first = await repositoryA.claimPendingSettlements!(1, undefined, { claimToken: 'instance-a', now: claimAt, leaseMs: 60_000 });
    assert.equal(first.length, 1);
    assert.equal(first[0]?.settlementId, settlementId);
    assert.deepEqual(await repositoryB.claimPendingSettlements!(1, undefined, { claimToken: 'instance-b', now: new Date(claimAt.getTime() + 30_000), leaseMs: 60_000 }), []);
    const afterExpiry = await repositoryB.claimPendingSettlements!(1, undefined, { claimToken: 'instance-b', now: new Date(claimAt.getTime() + 60_001), leaseMs: 60_000 });
    assert.equal(afterExpiry.length, 1);
    assert.equal(afterExpiry[0]?.settlementId, settlementId);
  } finally {
    await pool.query('DELETE FROM audit_event WHERE player_id = $1', [playerId]);
    await pool.query('DELETE FROM action_idempotency WHERE player_id = $1', [playerId]);
    await pool.query('DELETE FROM settlement_record WHERE player_id = $1', [playerId]);
    await pool.query('DELETE FROM dungeon_attempt WHERE player_id = $1', [playerId]);
    await pool.query('DELETE FROM building_job WHERE player_id = $1', [playerId]);
    await pool.query('DELETE FROM building_state WHERE player_id = $1', [playerId]);
    await pool.query('DELETE FROM inventory_resource WHERE player_id = $1', [playerId]);
    await pool.query('DELETE FROM equipment_instance WHERE player_id = $1', [playerId]);
    await pool.query('DELETE FROM collection_state WHERE player_id = $1', [playerId]);
    await pool.query('DELETE FROM progress_state WHERE player_id = $1', [playerId]);
    await pool.query('DELETE FROM player_state WHERE player_id = $1', [playerId]);
    await pool.end();
  }
});

test('real PostgreSQL ambiguous COMMIT is recovered by settlement idempotency', integrationOptions, async () => {
  const pool = new Pool({ connectionString: databaseUrl });
  const playerId = randomUUID();
  const startedAt = new Date('2026-08-25T09:00:00.000Z');
  const end = new Date(startedAt.getTime() + 3_600_000);
  const settlementId = randomUUID();
  try {
    await applyMigrations(pool);
    const repository = new PostgresRepository(pool);
    const service = new GameService(repository);
    await service.createPlayer(playerId, startedAt);
    const started = await service.startAction({ playerId, actionId: 'training', expectedRevision: 0, now: startedAt });

    // Commit #1 writes the pending reservation; commit #2 commits the full
    // state and then simulates a lost network response.
    const faultyPool = new FaultInjectingPool(pool, { commitNumber: 2, commitAfterApply: true });
    const faultyService = new GameService(new PostgresRepository(faultyPool), () => end);
    await assert.rejects(() => faultyService.offlineSettlement({ playerId, settlementId, requestedStartedAt: startedAt.toISOString(), requestedEndedAt: end.toISOString(), expectedRevision: started.stateRevision, now: end }), (error: unknown) => error instanceof Error && (error as { code?: string }).code === 'INTERNAL_ROLLBACK');

    const committed = await repository.getSettlement(settlementId);
    assert.equal(committed?.status, 'committed');
    const retry = await service.offlineSettlement({ playerId, settlementId, requestedStartedAt: startedAt.toISOString(), requestedEndedAt: end.toISOString(), expectedRevision: 999, now: new Date(end.getTime() + 1_000) });
    assert.deepEqual(retry, committed?.responsePayload);
    assert.equal((await repository.getPlayer(playerId)).cultivationXp, 4200);
    assert.equal((await repository.getPlayer(playerId)).stateRevision, 2);
  } finally {
    await pool.query('DELETE FROM audit_event WHERE player_id = $1', [playerId]);
    await pool.query('DELETE FROM action_idempotency WHERE player_id = $1', [playerId]);
    await pool.query('DELETE FROM settlement_record WHERE player_id = $1', [playerId]);
    await pool.query('DELETE FROM dungeon_attempt WHERE player_id = $1', [playerId]);
    await pool.query('DELETE FROM building_job WHERE player_id = $1', [playerId]);
    await pool.query('DELETE FROM building_state WHERE player_id = $1', [playerId]);
    await pool.query('DELETE FROM inventory_resource WHERE player_id = $1', [playerId]);
    await pool.query('DELETE FROM equipment_instance WHERE player_id = $1', [playerId]);
    await pool.query('DELETE FROM collection_state WHERE player_id = $1', [playerId]);
    await pool.query('DELETE FROM progress_state WHERE player_id = $1', [playerId]);
    await pool.query('DELETE FROM player_state WHERE player_id = $1', [playerId]);
    await pool.end();
  }
});
