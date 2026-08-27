import assert from 'node:assert/strict';
import test from 'node:test';
import { MetricsCollector } from './metrics.ts';

test('collector aggregates settlement, activity, resource, inventory and equipment metrics', () => {
  const collector = new MetricsCollector({ clock: () => Date.parse('2026-01-01T00:00:00.000Z') });
  collector.record({ type: 'settlement_success', durationMs: 120, pendingAgeMs: 500, resourceDelta: { spirit_stone: 20, pill: -2 }, resourceOverflow: { ancient_scroll: 1 } });
  collector.record({ type: 'settlement_rejected' });
  collector.record({ type: 'settlement_duplicate' });
  collector.record({ type: 'settlement_stale' });
  collector.record({ type: 'map_success' });
  collector.record({ type: 'map_failure' });
  collector.record({ type: 'map_gate' });
  collector.record({ type: 'map_cooldown' });
  collector.record({ type: 'dungeon_success' });
  collector.record({ type: 'dungeon_failure' });
  collector.record({ type: 'dungeon_gate' });
  collector.record({ type: 'dungeon_cooldown' });
  collector.record({ type: 'inventory_full' });
  collector.record({ type: 'equipment_growth', growth: 'reinforce' });
  collector.record({ type: 'equipment_growth', growth: 'promote' });

  const snapshot = collector.snapshot();
  assert.deepEqual(snapshot.settlements, { success: 1, rejected: 1, duplicate: 1, stale: 1 });
  assert.deepEqual(snapshot.map, { success: 1, failure: 1, gate: 1, cooldown: 1 });
  assert.deepEqual(snapshot.dungeon, { success: 1, failure: 1, gate: 1, cooldown: 1 });
  assert.equal(snapshot.inventoryFull, 1);
  assert.deepEqual(snapshot.equipmentGrowth, { reinforce: 1, promote: 1, awaken: 0 });
  assert.deepEqual(snapshot.settlementDuration, { count: 1, totalMs: 120, maxMs: 120, averageMs: 120 });
  assert.deepEqual(snapshot.pendingAge, { count: 1, totalMs: 500, maxMs: 500, averageMs: 500 });
  assert.equal(snapshot.resources.spirit_stone.delta, 20);
  assert.equal(snapshot.resources.pill.delta, -2);
  assert.equal(snapshot.resources.ancient_scroll.overflow, 1);
});

test('collector keeps bounded duration samples and exposes read-only threshold alerts', () => {
  const collector = new MetricsCollector({ clock: () => 0, maxDurationSamples: 2 });
  collector.record({ type: 'settlement_success', durationMs: 100 });
  collector.record({ type: 'settlement_success', durationMs: 300 });
  collector.record({ type: 'settlement_success', durationMs: 500 });
  collector.record({ type: 'inventory_full' });
  collector.record({ type: 'dungeon_failure' });
  collector.record({ type: 'settlement_duplicate', resourceOverflow: { spirit_stone: 4 } });
  const snapshot = collector.snapshot();
  assert.deepEqual(snapshot.settlementDuration, { count: 2, totalMs: 800, maxMs: 500, averageMs: 400 });
  assert.deepEqual(collector.queryAlerts({ settlementDuplicate: 1, resourceOverflow: 4, inventoryFull: 2, dungeonFailure: 1 }), [
    { code: 'settlementDuplicate', observed: 1, threshold: 1 },
    { code: 'resourceOverflow', observed: 4, threshold: 4 },
    { code: 'dungeonFailure', observed: 1, threshold: 1 },
  ]);
  snapshot.resources.spirit_stone.overflow = 999;
  assert.equal(collector.snapshot().resources.spirit_stone.overflow, 4);
});

test('collector rejects malformed timestamps, durations and growth events', () => {
  const collector = new MetricsCollector({ clock: () => 0 });
  assert.throws(() => collector.record({ type: 'settlement_success', durationMs: -1 }), RangeError);
  assert.throws(() => collector.record({ type: 'settlement_success', at: 'invalid', durationMs: 1 }), RangeError);
  assert.throws(() => collector.record({ type: 'equipment_growth' }), TypeError);
  assert.throws(() => collector.record({ type: 'equipment_growth', growth: 'unknown' as never }), TypeError);
  assert.throws(() => collector.record({ type: 'unknown_event' as never }), TypeError);
  assert.deepEqual(collector.snapshot().settlements, { success: 0, rejected: 0, duplicate: 0, stale: 0 });
  assert.equal(collector.snapshot().settlementDuration.count, 0);
});

test('collector aggregates pending, drop deviation and economic anomaly signals', () => {
  const collector = new MetricsCollector({ clock: () => 0 });
  collector.record({ type: 'settlement_pending', pendingAgeMs: 900 });
  collector.record({ type: 'drop_observation', dropKey: 'dungeon.qing_feng.treasure', dropExpected: 0.1, dropActual: 1 });
  collector.record({ type: 'drop_observation', dropKey: 'dungeon.qing_feng.treasure', dropExpected: 0.1, dropActual: 0 });
  collector.record({ type: 'economic_anomaly', anomalyKey: 'resource_overflow', anomalyValue: 4 });
  const snapshot = collector.snapshot();
  assert.equal(snapshot.pendingSettlements, 1);
  assert.deepEqual(snapshot.drops['dungeon.qing_feng.treasure'], { expected: 0.2, actual: 1, absoluteDeviation: 1 });
  assert.deepEqual(snapshot.economicAnomalies, { resource_overflow: 4 });
  assert.deepEqual(collector.queryAlerts({ pendingSettlements: 1, dropDeviation: 1, economicAnomaly: 4 }), [
    { code: 'pendingSettlements', observed: 1, threshold: 1 },
    { code: 'dropDeviation', observed: 1, threshold: 1 },
    { code: 'economicAnomaly', observed: 4, threshold: 4 },
  ]);
  assert.match(collector.toPrometheus(), /dongtian_pending_settlements_total 1/);
  assert.match(collector.toPrometheus(), /drop_key="dungeon.qing_feng.treasure"/);
});

test('collector escapes untrusted observation keys in Prometheus labels', () => {
  const collector = new MetricsCollector({ clock: () => 0 });
  collector.record({ type: 'drop_observation', dropKey: 'quote"slash\\line\n', dropExpected: 1, dropActual: 0 });
  collector.record({ type: 'economic_anomaly', anomalyKey: 'quote"slash\\line\n', anomalyValue: 1 });
  const output = collector.toPrometheus();
  assert.match(output, /drop_key="quote\\"slash\\\\line\\n"/);
  assert.match(output, /anomaly_key="quote\\"slash\\\\line\\n"/);
});

test('collector rejects malformed drop and anomaly events', () => {
  const collector = new MetricsCollector({ clock: () => 0 });
  assert.throws(() => collector.record({ type: 'drop_observation', dropExpected: 1, dropActual: 0 }), TypeError);
  assert.throws(() => collector.record({ type: 'drop_observation', dropKey: 'x', dropExpected: -1, dropActual: 0 }), RangeError);
  assert.throws(() => collector.record({ type: 'economic_anomaly', anomalyKey: 'x', anomalyValue: -1 }), RangeError);
  assert.deepEqual(collector.snapshot().drops, {});
  assert.deepEqual(collector.snapshot().economicAnomalies, {});
});
