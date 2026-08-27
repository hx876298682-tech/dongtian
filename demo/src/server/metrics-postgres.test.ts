import assert from 'node:assert/strict';
import test from 'node:test';
import { PostgresMetricsStore } from './metrics-postgres.ts';
import type { AsyncSqlClient, SqlResult } from './postgres-repository.ts';

test('PostgresMetricsStore persists idempotent events and aggregates across instances', async () => {
  const inserts: unknown[][] = [];
  const rows = [
    { event_type: 'settlement_success', event_at: new Date('2026-08-25T00:00:00.000Z'), duration_ms: 120, pending_age_ms: 500, resource_delta: { spirit_stone: 20 }, resource_overflow: {}, growth: null },
    { event_type: 'settlement_success', event_at: new Date('2026-08-25T00:00:01.000Z'), duration_ms: 300, pending_age_ms: null, resource_delta: { spirit_stone: 5 }, resource_overflow: { pill: 2 }, growth: null },
    { event_type: 'equipment_growth', event_at: new Date('2026-08-25T00:00:02.000Z'), duration_ms: null, pending_age_ms: null, resource_delta: {}, resource_overflow: {}, growth: 'awaken' },
    { event_type: 'drop_observation', event_at: new Date('2026-08-25T00:00:03.000Z'), duration_ms: null, pending_age_ms: null, resource_delta: {}, resource_overflow: {}, growth: null, drop_key: 'dungeon.qing_feng.treasure', drop_expected: 0.1, drop_actual: 1, anomaly_key: null, anomaly_value: null },
    { event_type: 'economic_anomaly', event_at: new Date('2026-08-25T00:00:04.000Z'), duration_ms: null, pending_age_ms: null, resource_delta: {}, resource_overflow: {}, growth: null, drop_key: null, drop_expected: null, drop_actual: null, anomaly_key: 'resource_overflow', anomaly_value: 4 },
  ];
  const client: AsyncSqlClient = { query: async <Row extends Record<string, unknown> = Record<string, unknown>>(sql: string, params: readonly unknown[] = []): Promise<SqlResult<Row>> => {
    if (sql.startsWith('INSERT INTO metrics_event')) inserts.push([...params]);
    if (sql.startsWith('SELECT event_type')) return { rows: rows as unknown as Row[] };
    return { rows: [] as Row[] };
  } };
  const first = new PostgresMetricsStore(client, { instanceId: 'instance-a' });
  const second = new PostgresMetricsStore(client, { instanceId: 'instance-b' });
  await first.record({ type: 'settlement_success', eventId: '00000000-0000-4000-8000-000000000001', durationMs: 120, resourceDelta: { spirit_stone: 20 } });
  await second.record({ type: 'settlement_success', eventId: '00000000-0000-4000-8000-000000000002', durationMs: 300, resourceDelta: { spirit_stone: 5 }, resourceOverflow: { pill: 2 } });
  const snapshot = await first.snapshot(Date.parse('2026-08-25T00:01:00.000Z'));
  assert.equal(inserts.length, 2);
  assert.equal(inserts[0]?.[1], 'instance-a');
  assert.equal(inserts[1]?.[1], 'instance-b');
  assert.equal(snapshot.settlements.success, 2);
  assert.equal(snapshot.settlementDuration.count, 2);
  assert.equal(snapshot.settlementDuration.averageMs, 210);
  assert.equal(snapshot.resources.spirit_stone.delta, 25);
  assert.equal(snapshot.resources.pill.overflow, 2);
  assert.equal(snapshot.drops['dungeon.qing_feng.treasure']?.actual, 1);
  assert.equal(snapshot.economicAnomalies.resource_overflow, 4);
  assert.match(await first.toPrometheus(), /dongtian_settlements_total\{outcome="success"\} 2/);
});

test('PostgresMetricsStore rejects malformed telemetry before SQL write', async () => {
  let writes = 0;
  const client: AsyncSqlClient = { query: async () => { writes += 1; return { rows: [] }; } };
  const store = new PostgresMetricsStore(client);
  await assert.rejects(() => store.record({ type: 'settlement_success', durationMs: -1 }), RangeError);
  assert.equal(writes, 0);
});

test('PostgresMetricsStore excludes telemetry newer than the requested snapshot time', async () => {
  const rows = [
    { event_type: 'settlement_success', event_at: new Date('2026-08-25T00:00:00.000Z'), duration_ms: 10, pending_age_ms: null, resource_delta: {}, resource_overflow: {}, growth: null },
    { event_type: 'settlement_success', event_at: new Date('2026-08-25T00:02:00.000Z'), duration_ms: 99, pending_age_ms: null, resource_delta: {}, resource_overflow: {}, growth: null },
  ];
  let snapshotAt: unknown;
  const client: AsyncSqlClient = {
    query: async <Row extends Record<string, unknown> = Record<string, unknown>>(sql: string, params: readonly unknown[] = []): Promise<SqlResult<Row>> => {
      if (sql.startsWith('SELECT event_type')) {
        snapshotAt = params[0];
        return { rows: rows.slice(0, 1) as unknown as Row[] };
      }
      return { rows: [] as Row[] };
    },
  };
  const store = new PostgresMetricsStore(client);
  const snapshot = await store.snapshot(Date.parse('2026-08-25T00:01:00.000Z'));
  assert.equal((snapshotAt as Date).toISOString(), '2026-08-25T00:01:00.000Z');
  assert.equal(snapshot.settlementDuration.count, 1);
  assert.equal(snapshot.settlementDuration.maxMs, 10);
});
