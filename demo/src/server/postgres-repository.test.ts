import assert from 'node:assert/strict';
import test from 'node:test';
import { ApiError } from './types.ts';
import { PostgresRepository } from './postgres-repository.ts';
import type { AsyncSqlClient, SqlResult } from './postgres-repository.ts';

const playerId = '11111111-1111-4111-8111-111111111111';
const response = { requestId: 'request-1', configVersion: '1.0.0-frozen', stateRevision: 1, serverTime: '2026-01-01T00:00:00.000Z', data: { ok: true } };

class FakeClient implements AsyncSqlClient {
  readonly queries: string[] = [];
  readonly params: unknown[][] = [];
  casRowCount = 1;
  actionPayload: unknown | null = null;
  actionPrefixRow: { action_key: string; response_payload: unknown } | null = null;
  settlementPayload: unknown | null = null;
  settlementRow: Record<string, unknown> | null = null;
  pendingRows: Record<string, unknown>[] = [];
  buildingRows: Record<string, unknown>[] = [];
  progressRow: Record<string, unknown> | null = null;
  collectionRow: Record<string, unknown> | null = null;
  equipmentRows: Record<string, unknown>[] = [];
  leaderboardRows: Record<string, unknown>[] = [];
  leaderboardTotal = 0;
  failOn: string | null = null;

  async query<Row extends Record<string, unknown> = Record<string, unknown>>(text: string, params: readonly unknown[] = []): Promise<SqlResult<Row>> {
    this.queries.push(text);
    this.params.push([...params]);
    if (this.failOn && text.includes(this.failOn)) throw new Error(`forced SQL failure: ${this.failOn}`);
    if (text === 'BEGIN' || text === 'COMMIT' || text === 'ROLLBACK') return { rows: [], rowCount: 0 } as SqlResult<Row>;
    if (text.includes('SELECT action_key, response_payload FROM action_idempotency')) return this.actionPrefixRow === null ? { rows: [] } as SqlResult<Row> : { rows: [this.actionPrefixRow] } as unknown as SqlResult<Row>;
    if (text.includes('SELECT response_payload FROM action_idempotency')) return this.actionPayload === null ? { rows: [] } as SqlResult<Row> : { rows: [{ response_payload: this.actionPayload }] } as unknown as SqlResult<Row>;
    if (text.includes('SELECT response_payload FROM settlement_record')) return this.settlementPayload === null ? { rows: [] } as SqlResult<Row> : { rows: [{ response_payload: this.settlementPayload }] } as unknown as SqlResult<Row>;
    if (text.includes('SELECT player_id, request_started_at, request_ended_at')) return this.settlementRow === null ? { rows: [] } as SqlResult<Row> : { rows: [this.settlementRow] } as unknown as SqlResult<Row>;
    if (text.includes('FROM settlement_record WHERE status = \'pending\'')) return { rows: this.pendingRows } as unknown as SqlResult<Row>;
    if (text.includes('FROM building_state')) return { rows: this.buildingRows } as unknown as SqlResult<Row>;
    if (text.includes('FROM progress_state')) return this.progressRow === null ? { rows: [] } as SqlResult<Row> : { rows: [this.progressRow] } as unknown as SqlResult<Row>;
    if (text.includes('FROM collection_state')) return this.collectionRow === null ? { rows: [] } as SqlResult<Row> : { rows: [this.collectionRow] } as unknown as SqlResult<Row>;
    if (text.includes('FROM equipment_instance')) return { rows: this.equipmentRows } as unknown as SqlResult<Row>;
    if (text.includes('SELECT COUNT(*) AS total_count FROM player_state')) return { rows: [{ total_count: this.leaderboardTotal }] } as unknown as SqlResult<Row>;
    if (text.includes('COUNT(*) OVER()')) return { rows: this.leaderboardRows } as unknown as SqlResult<Row>;
    if (text.includes('FROM player_state')) return { rows: [{ player_id: playerId, realm_id: 'qi_refining', substage_index: 0, cultivation_xp: 0, primary_action_id: null, primary_action_started: null, primary_action_carry_seconds: 0, last_settled_at: '2026-01-01T00:00:00.000Z', state_revision: 0, config_version: '1.0.0-frozen', equipment_count: 0 }] } as unknown as SqlResult<Row>;
    if (text.startsWith('UPDATE player_state')) return { rows: [], rowCount: this.casRowCount } as SqlResult<Row>;
    return { rows: [], rowCount: 0 } as SqlResult<Row>;
  }
}

const makeRepository = () => {
  const client = new FakeClient();
  return { client, repository: new PostgresRepository(client) };
};

test('PostgresRepository locks player state and commits a full-state CAS transaction', async () => {
  const { client, repository } = makeRepository();
  const result = await repository.transaction(playerId, 0, { eventType: 'test_transaction', payload: { source: 'test' }, at: new Date('2026-01-01T00:00:00.000Z') }, (draft) => { draft.cultivationXp = 7; return response; });
  assert.deepEqual(result, response);
  assert.equal(client.queries[0], 'BEGIN');
  assert.ok(client.queries.some((query) => query.includes('FROM player_state') && query.includes('FOR UPDATE')));
  assert.ok(client.queries.some((query) => query.startsWith('UPDATE player_state') && query.includes('state_revision=$12')));
  for (const table of ['inventory_resource', 'building_state', 'building_job', 'equipment_instance', 'collection_state', 'progress_state', 'dungeon_attempt', 'audit_event']) assert.ok(client.queries.some((query) => query.includes(table)), `missing ${table} write`);
  assert.equal(client.queries.some((query) => query === 'DELETE FROM inventory_resource WHERE player_id = $1'), false);
  assert.ok(client.queries.some((query) => query.includes('INSERT INTO inventory_resource') && query.includes('ON CONFLICT (player_id, resource_id) DO UPDATE')));
  assert.equal(client.queries.filter((query) => query.includes('INSERT INTO building_state')).length, 5);
  assert.equal(client.queries.at(-1), 'COMMIT');
  assert.equal(client.queries.includes('ROLLBACK'), false);
});

test('PostgresRepository maps CAS mismatch and SQL failure to rollback-safe errors', async () => {
  const cas = makeRepository();
  cas.client.casRowCount = 0;
  await assert.rejects(() => cas.repository.transaction(playerId, 0, { eventType: 'cas', payload: {}, at: new Date() }, () => null), (error: unknown) => error instanceof ApiError && error.code === 'STALE_REVISION');
  assert.equal(cas.client.queries.at(-1), 'ROLLBACK');
  assert.equal(cas.client.queries.includes('COMMIT'), false);

  const failed = makeRepository();
  failed.client.failOn = 'INSERT INTO building_state';
  await assert.rejects(() => failed.repository.transaction(playerId, 0, { eventType: 'failure', payload: {}, at: new Date() }, () => null), (error: unknown) => error instanceof ApiError && error.code === 'INTERNAL_ROLLBACK');
  assert.equal(failed.client.queries.at(-1), 'ROLLBACK');
  assert.equal(failed.client.queries.includes('COMMIT'), false);
});

test('PostgresRepository returns stored settlement and action responses before CAS', async () => {
  const settlement = makeRepository();
  settlement.client.settlementPayload = response;
  const settled = await settlement.repository.transaction(playerId, 999, { eventType: 'duplicate', settlementId: '22222222-2222-4222-8222-222222222222', payload: {}, at: new Date() }, () => { throw new Error('mutator must not run'); });
  assert.deepEqual(settled, response);
  assert.equal(settlement.client.queries.some((query) => query.includes('FOR UPDATE')), false);
  assert.equal(settlement.client.queries.at(-1), 'COMMIT');

  const action = makeRepository();
  action.client.actionPayload = response;
  const actionResult = await action.repository.transaction(playerId, 999, { eventType: 'duplicate', payload: {}, at: new Date() }, () => { throw new Error('mutator must not run'); }, undefined, 'player:action:key');
  assert.deepEqual(actionResult, response);
  assert.equal(action.client.queries.some((query) => query.includes('FOR UPDATE')), false);
});

test('Postgres transaction runs the action prefix guard after player FOR UPDATE', async () => {
  const { client, repository } = makeRepository();
  client.actionPrefixRow = { action_key: 'old-key', response_payload: response };
  await assert.rejects(() => repository.transaction(playerId, 0, { eventType: 'equipment_guard', payload: {}, at: new Date() }, () => {
    throw new Error('mutator must not run');
  }, undefined, 'new-key', async (_draft, context) => {
    const conflict = await context.findActionResponseByPrefix('equipment-prefix:');
    assert.deepEqual(conflict, { key: 'old-key', response });
    throw new ApiError('DUPLICATE_REQUEST', 'conflict');
  }), (error: unknown) => error instanceof ApiError && error.code === 'DUPLICATE_REQUEST');
  const lockIndex = client.queries.findIndex((query) => query.includes('FROM player_state') && query.includes('FOR UPDATE'));
  const guardIndex = client.queries.findIndex((query) => query.includes('SELECT action_key, response_payload FROM action_idempotency'));
  assert.ok(lockIndex >= 0 && guardIndex > lockIndex);
  assert.equal(client.queries.some((query) => query.startsWith('UPDATE player_state')), false);
  assert.equal(client.queries.at(-1), 'ROLLBACK');
});

test('PostgresRepository rejects a mismatched update of a pending settlement reservation', async () => {
  const { client, repository } = makeRepository();
  client.settlementRow = {
    player_id: playerId,
    request_started_at: '2026-01-01T00:00:00.000Z',
    request_ended_at: '2026-01-01T01:00:00.000Z',
    expected_revision: 0,
    config_version: '1.0.0-frozen',
    status: 'pending',
  };
  await assert.rejects(() => repository.recordSettlement({
    settlementId: '22222222-2222-4222-8222-222222222222',
    playerId,
    requestStartedAt: '2026-01-01T00:00:00.000Z',
    requestEndedAt: '2026-01-02T00:00:00.000Z',
    settledSeconds: 0,
    expectedRevision: 0,
    committedRevision: 1,
    configVersion: '1.0.0-frozen',
    summaryHash: 'summary',
    status: 'committed',
    responsePayload: response,
    createdAt: '2026-01-01T01:00:00.000Z',
    committedAt: '2026-01-01T01:00:00.000Z',
  }), (error: unknown) => error instanceof ApiError && error.code === 'DUPLICATE_REQUEST');
  assert.equal(client.queries.at(-1), 'ROLLBACK');
});

test('PostgresRepository rejects a mismatched pending retry before upsert', async () => {
  const { client, repository } = makeRepository();
  client.settlementRow = {
    player_id: playerId,
    request_started_at: '2026-01-01T00:00:00.000Z',
    request_ended_at: '2026-01-01T01:00:00.000Z',
    expected_revision: 0,
    config_version: '1.0.0-frozen',
    status: 'pending',
  };
  await assert.rejects(() => repository.recordSettlement({
    settlementId: '22222222-2222-4222-8222-222222222222',
    playerId,
    requestStartedAt: '2026-01-01T00:00:00.000Z',
    requestEndedAt: '2026-01-02T00:00:00.000Z',
    settledSeconds: 0,
    expectedRevision: 0,
    committedRevision: null,
    configVersion: '1.0.0-frozen',
    summaryHash: 'retry',
    status: 'pending',
    responsePayload: { pending: true },
    createdAt: '2026-01-01T01:00:00.000Z',
    committedAt: null,
  }), (error: unknown) => error instanceof ApiError && error.code === 'DUPLICATE_REQUEST');
  assert.equal(client.queries.at(-1), 'ROLLBACK');
  assert.equal(client.queries.some((query) => query.includes('ON CONFLICT (settlement_id)')), false);
});

test('PostgresRepository restores collection growth state', async () => {
  const { client, repository } = makeRepository();
  client.collectionRow = { technique_layers: { 'technique.mortal.qing_feng': 3 }, technique_research_xp: 250, treasure_stars: { qing_lian_lamp: 2 }, collection_marks: 4, mark_balances: { starter: 4, nascent_soul: 12 }, duplicate_balances: { qing_lian_lamp: 1 } };
  const player = await repository.getPlayer(playerId);
  assert.deepEqual(player.collection, { techniqueLayers: { 'technique.mortal.qing_feng': 3 }, techniqueResearchXp: 250, treasureStars: { qing_lian_lamp: 2 }, collectionMarks: 4, duplicateBalances: { qing_lian_lamp: 1 } });
  assert.deepEqual(player.collectionMarkBalances, { starter: 4, nascent_soul: 12 });
});

test('PostgresRepository migrates an unscoped legacy mark counter into starter on read', async () => {
  const { client, repository } = makeRepository();
  client.collectionRow = { technique_layers: {}, technique_research_xp: 0, treasure_stars: {}, collection_marks: 7, duplicate_balances: {} };
  const player = await repository.getPlayer(playerId);
  assert.deepEqual(player.collectionMarkBalances, { starter: 7 });
});

test('PostgresRepository writes per-pool collection mark balances atomically', async () => {
  const { client, repository } = makeRepository();
  client.collectionRow = { technique_layers: {}, technique_research_xp: 0, treasure_stars: {}, collection_marks: 10, mark_balances: { starter: 10, nascent_soul: 20 }, duplicate_balances: {} };
  await repository.transaction(playerId, 0, { eventType: 'collection_exchange_persist', payload: {}, at: new Date('2026-01-01T00:00:00.000Z') }, (draft) => {
    draft.collectionMarkBalances = { starter: 0, nascent_soul: 20 };
    draft.collection.collectionMarks = 0;
    return null;
  });
  const index = client.queries.findIndex((query) => query.includes('INSERT INTO collection_state'));
  assert.ok(index >= 0);
  assert.match(client.queries[index]!, /mark_balances/);
  assert.deepEqual(client.params[index]?.[5], JSON.stringify({ starter: 0, nascent_soul: 20 }));
});

test('PostgresRepository preserves opaque carry quantity and future progress state', async () => {
  const { client, repository } = makeRepository();
  client.buildingRows = [{ building_id: 'alchemy_room', level: 1, active_job_id: null, job_started_at: null, carry_seconds: '12.5', carry_quantity: '2.75', planted_plots: '2', planted_at: '2026-01-01T00:00:00.000Z', mature_at: '2026-01-01T02:00:00.000Z', queued_job_ids: [], state_revision: 0 }];
  client.progressRow = {
    map_pity: {}, dungeon_pity: {}, random_event_state: { activeEvent: 'spirit_tide', remainingSeconds: 123 },
    support_route_state: { routeId: 'qing_feng', cursor: 7 }, random_state: { seed: 99, draws: 4 }, high_tier_gate_state: {},
    failure_cooldowns: {}, active_dungeon_id: null, dungeon_status: 'idle', dungeon_phase: 0, dungeon_boss_hp: 0,
    dungeon_started_at: null, dungeon_carry_seconds: 0, dungeon_failure_cooldown_until: null,
  };
  const player = await repository.getPlayer(playerId);
  assert.equal(player.buildings.alchemy_room.carryQuantity, 2.75);
  assert.equal(player.buildings.alchemy_room.plantedPlots, 2);
  assert.equal(player.buildings.alchemy_room.plantedAt, '2026-01-01T00:00:00.000Z');
  assert.equal(player.buildings.alchemy_room.matureAt, '2026-01-01T02:00:00.000Z');
  assert.deepEqual(player.randomEventState, { activeEvent: 'spirit_tide', remainingSeconds: 123 });
  assert.deepEqual(player.supportRouteState, { routeId: 'qing_feng', cursor: 7 });

  await repository.transaction(playerId, 0, { eventType: 'opaque_state_round_trip', payload: {}, at: new Date('2026-01-01T00:00:00.000Z') }, () => null);
  const buildingInsert = client.queries.findIndex((query) => query.includes('INSERT INTO building_state'));
  assert.ok(buildingInsert >= 0);
  assert.match(client.queries[buildingInsert]!, /carry_quantity/);
  assert.match(client.queries[buildingInsert]!, /planted_plots/);
  assert.equal(client.params[buildingInsert]?.[6], 2.75);
  assert.equal(client.params[buildingInsert]?.[7], 2);
  const progressInsert = client.queries.findIndex((query) => query.includes('INSERT INTO progress_state'));
  assert.ok(progressInsert >= 0);
  assert.match(client.queries[progressInsert]!, /random_event_state/);
  assert.match(client.queries[progressInsert]!, /support_route_state/);
  assert.deepEqual(client.params[progressInsert]?.[3], JSON.stringify(player.randomEventState));
  assert.deepEqual(client.params[progressInsert]?.[4], JSON.stringify(player.supportRouteState));
});

test('PostgresRepository preserves equipment creation timestamps across read and full-state write', async () => {
  const { client, repository } = makeRepository();
  const createdAt = '2025-12-31T23:59:00.000Z';
  client.equipmentRows = [{
    instance_id: 'equipment.legacy', template_id: 'iron_saber', slot: 'weapon', quality: 'fine',
    reinforcement_level: 2, awakening_level: 1, affixes: { attack: 10 }, locked_slots: [0], is_equipped: true,
    created_config_version: '1.0.0-frozen', created_at: createdAt,
  }];
  const player = await repository.getPlayer(playerId);
  assert.equal(player.equipmentInstances['equipment.legacy']?.createdAt, createdAt);

  await repository.transaction(playerId, 0, { eventType: 'equipment_timestamp_round_trip', payload: {}, at: new Date(createdAt) }, () => null);
  const insertIndex = client.queries.findIndex((query) => query.includes('INSERT INTO equipment_instance'));
  assert.ok(insertIndex >= 0);
  assert.equal(client.params[insertIndex]?.at(-1), createdAt);
  assert.match(client.queries[insertIndex]!, /COALESCE\(\$12,now\(\)\)/);
});

test('PostgresRepository exposes the independent collection event stream contract', async () => {
  const { client, repository } = makeRepository();
  const events = await repository.listCollectionEvents(playerId, 7, new Date('2026-01-02T00:00:00.000Z'));
  assert.deepEqual(events, []);
  const query = client.queries.find((item) => item.includes('FROM collection_event'));
  assert.ok(query);
  assert.match(query, /ORDER BY created_at DESC, event_id DESC/);
  assert.deepEqual(client.params[client.queries.indexOf(query!)], [playerId, new Date('2026-01-02T00:00:00.000Z'), 7]);
});

test('PostgresRepository returns an anonymous paginated leaderboard using a window total', async () => {
  const { client, repository } = makeRepository();
  client.leaderboardRows = [
    { realm_id: 'core_formation', cultivation_xp: 500000, equipment_count: 0, total_count: '3' },
    { realm_id: 'foundation_establishment', cultivation_xp: 999999, equipment_count: 100, total_count: '3' },
  ];
  client.leaderboardTotal = 3;
  const result = await repository.getLeaderboard('combat_power', 2, 1);
  const query = client.queries.find((item) => item.includes('COUNT(*) OVER()'));
  assert.ok(query);
  assert.match(query, /COUNT\(\*\) OVER\(\)/);
  assert.match(query, /LIMIT \$1 OFFSET \$2/);
  const queryIndex = client.queries.indexOf(query);
  assert.deepEqual(client.params[queryIndex], [2, 1]);
  assert.equal(result.total, 3);
  assert.deepEqual(result.entries, [
    { rank: 2, realmId: 'core_formation', cultivationXp: 500000, equipmentCount: 0, combatPower: 2500000 },
    { rank: 3, realmId: 'foundation_establishment', cultivationXp: 999999, equipmentCount: 100, combatPower: 2099999 },
  ]);
  assert.equal(JSON.stringify(result).includes('playerId'), false);
});

test('PostgresRepository preserves total when leaderboard page is empty', async () => {
  const { client, repository } = makeRepository();
  client.leaderboardTotal = 4;
  const result = await repository.getLeaderboard('realm', 2, 100);
  assert.equal(result.total, 4);
  assert.deepEqual(result.entries, []);
  assert.deepEqual(client.params.at(-1), [2, 100]);
});

test('PostgresRepository lists pending settlements with a stable cursor and maps all fields', async () => {
  const { client, repository } = makeRepository();
  client.pendingRows = [{
    settlement_id: '22222222-2222-4222-8222-222222222222',
    player_id: playerId,
    request_started_at: '2026-01-01T00:00:00.000Z',
    request_ended_at: '2026-01-01T00:01:00.000Z',
    settled_seconds: '0',
    expected_revision: '3',
    committed_revision: null,
    config_version: '1.0.0-frozen',
    summary_hash: 'pending-hash',
    status: 'pending',
    response_payload: { settlementId: 'pending' },
    created_at: '2026-01-01T00:02:00.000Z',
    committed_at: null,
  }];
  const before = new Date('2026-01-01T00:03:00.000Z');
  const records = await repository.listPendingSettlements(7, before);
  assert.deepEqual(records, [{
    settlementId: '22222222-2222-4222-8222-222222222222',
    playerId,
    requestStartedAt: '2026-01-01T00:00:00.000Z',
    requestEndedAt: '2026-01-01T00:01:00.000Z',
    settledSeconds: 0,
    expectedRevision: 3,
    committedRevision: null,
    configVersion: '1.0.0-frozen',
    summaryHash: 'pending-hash',
    status: 'pending',
    responsePayload: { settlementId: 'pending' },
    createdAt: '2026-01-01T00:02:00.000Z',
    committedAt: null,
  }]);
  const query = client.queries.find((item) => item.includes("status = 'pending'"));
  assert.ok(query);
  assert.match(query, /created_at < \$1/);
  assert.match(query, /ORDER BY created_at, settlement_id/);
  assert.match(query, /LIMIT \$2/);
  const queryIndex = client.queries.indexOf(query);
  assert.deepEqual(client.params[queryIndex], [before, 7]);
});

test('PostgresRepository pages pending settlements with a settlement_id tie-breaker', async () => {
  const { client, repository } = makeRepository();
  client.pendingRows = [];
  const before = new Date('2026-01-01T00:02:00.000Z');
  await repository.listPendingSettlements(1, { createdAt: before, settlementId: '22222222-2222-4222-8222-222222222222' });
  const query = client.queries.find((item) => item.includes("status = 'pending'"));
  assert.ok(query);
  assert.match(query, /created_at < \$1 OR \(created_at = \$1 AND settlement_id < \$2\)/);
  assert.match(query, /ORDER BY created_at, settlement_id/);
  const queryIndex = client.queries.indexOf(query);
  assert.deepEqual(client.params[queryIndex], [before, '22222222-2222-4222-8222-222222222222', 1]);
});

test('PostgresRepository claims pending settlements with a transactional SKIP LOCKED lease', async () => {
  const { client, repository } = makeRepository();
  const claimed = await repository.claimPendingSettlements!(1, undefined, {
    claimToken: 'scanner-a',
    now: new Date('2026-01-01T00:00:00.000Z'),
    leaseMs: 30_000,
  });
  assert.deepEqual(claimed, []);
  const query = client.queries.find((item) => item.includes('FOR UPDATE SKIP LOCKED'));
  assert.ok(query);
  assert.match(query, /claim_until <= \$1/);
  assert.match(query, /claim_token = \$2/);
  assert.match(query, /SET claim_token = \$2, claim_until = \$3/);
  assert.deepEqual(client.params[client.queries.indexOf(query!)], [
    new Date('2026-01-01T00:00:00.000Z'),
    'scanner-a',
    new Date('2026-01-01T00:00:30.000Z'),
    1,
  ]);
});
