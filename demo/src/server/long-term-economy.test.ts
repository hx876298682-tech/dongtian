import assert from 'node:assert/strict';
import test from 'node:test';
import { CONTENT_PACKAGE } from '../content/content-schema.ts';
import { FROZEN_PARAMETERS } from '../game/frozen-parameters.ts';
import { FROZEN_PARAMETER_SHA256 } from '../game/frozen-parameters.ts';
import type { ConfigParameterMap } from './config-release.ts';
import { StaticConfigReleaseProvider } from './config-release.ts';
import { ApiError } from './types.ts';
import { MemoryRepository } from './repository.ts';
import { GameService } from './service.ts';
import { createGameHttpServer } from './http.ts';

const base = new Date('2026-01-01T00:00:00.000Z');
import { LongTermEconomyError, simulateLongTermEconomy, simulateLongTermEconomyConfidence } from './long-term-economy.ts';

test('30-day route is strictly gated when Qing Feng equipment parameters are not frozen', () => {
  assert.throws(() => simulateLongTermEconomy({ horizonHours: 720, realm: 'nascent_soul', seed: 42 }), (error: unknown) => {
    assert.ok(error instanceof LongTermEconomyError);
    assert.ok(error.diagnostics.some((item) => item.path === 'dungeon.qing_feng.equipment_drop_chance' && item.code === 'MISSING_PARAMETER'));
    assert.ok(error.diagnostics.some((item) => item.path === 'dungeon.qing_feng.equipment_quality_normal_chance' && item.code === 'MISSING_PARAMETER'));
    assert.ok(error.diagnostics.some((item) => item.path === 'dungeon.qing_feng.equipment_quality_chance' && item.code === 'INVALID_VALUE'));
    return true;
  });
});

test('30-day route rejects numerically valid Qing Feng proposal parameters', () => {
  const parameters = structuredClone(FROZEN_PARAMETERS) as ConfigParameterMap;
  const entry = (value: number): { value: number; status: string; source: string } => ({ value, status: 'frozen_v1', source: 'test-formal-fixture' });
  parameters['dungeon.qing_feng.equipment_drop_chance'] = entry(1);
  for (const quality of ['normal', 'fine', 'rare', 'epic', 'legendary', 'immortal']) parameters[`dungeon.qing_feng.equipment_quality_${quality}_chance`] = entry(1);
  parameters['dungeon.qing_feng.equipment_quality_rare_chance'] = { ...parameters['dungeon.qing_feng.equipment_quality_rare_chance'], status: 'proposal_v1' };
  assert.throws(() => simulateLongTermEconomy({ horizonHours: 720, realm: 'nascent_soul', seed: 42, parameters }), (error: unknown) => {
    assert.ok(error instanceof LongTermEconomyError);
    assert.ok(error.diagnostics.some((item) => item.path === 'dungeon.qing_feng.equipment_quality_rare_chance' && item.code === 'UNSUPPORTED_POLICY'));
    return true;
  });
});

test('90-day fixed-seed runtime slice rotates to black wind and consumes Boss pills', () => {
  const result = simulateLongTermEconomy({ horizonHours: 2160, realm: 'nascent_soul', seed: 42 });
  assert.equal(result.mode, 'fixed_seed_runtime_slice');
  assert.equal(result.supportRoute, 'black_wind_valley');
  assert.equal(result.highTierHours, 1620);
  assert.equal(result.supportHours, 540);
  assert.equal(result.highTier.encounters, 12);
  assert.equal(result.highTier.pillConsumed, 12 * Number(FROZEN_PARAMETERS['dungeon.high_tier.nascent_soul.boss_pill_budget_per_encounter'].value));
  assert.ok(result.support.clears > 0);
  assert.ok(result.support.equipmentDrops >= 0);
  assert.equal(result.diagnostics.length, 0);
  assert.equal(result.netResources.pill, (Number(FROZEN_PARAMETERS['dungeon.high_tier.nascent_soul.pill_per_hour'].value) * 1620) - result.highTier.pillConsumed);
  assert.ok(Object.values(result.highTier.treasureCopies).some((copies) => copies > 0), 'high-tier pity must produce a treasure copy');
});

test('long-term confidence slice reports deterministic 99% intervals without mutating a player', () => {
  const result = simulateLongTermEconomyConfidence({ horizonHours: 2160, realm: 'nascent_soul', seed: 42, sampleCount: 12 });
  assert.equal(result.mode, 'fixed_seed_confidence_slice');
  assert.equal(result.sampleCount, 12);
  assert.equal(result.metrics['highTier.equipmentDrops']?.samples, 12);
  assert.ok((result.metrics['netResources.pill']?.lower99 ?? 0) <= (result.metrics['netResources.pill']?.mean ?? 0));
  assert.ok((result.metrics['netResources.pill']?.mean ?? 0) <= (result.metrics['netResources.pill']?.upper99 ?? 0));
  assert.throws(() => simulateLongTermEconomyConfidence({ horizonHours: 2160, realm: 'nascent_soul', seed: 42, sampleCount: 9 }), LongTermEconomyError);
});

test('runtime slice uses only supplied frozen values and rejects a malformed route policy', () => {
  const parameters = structuredClone(FROZEN_PARAMETERS) as ConfigParameterMap;
  parameters['schedule.equipment.support_policy'] = { value: 'invented_policy' };
  assert.throws(() => simulateLongTermEconomy({ horizonHours: 2160, realm: 'nascent_soul', seed: 42, parameters }), (error: unknown) => {
    assert.ok(error instanceof LongTermEconomyError);
    assert.ok(error.diagnostics.some((item) => item.path === 'schedule.equipment.support_policy' && item.code === 'UNSUPPORTED_POLICY'));
    return true;
  });
});

test('long-term contract rejects out-of-range probabilities and zero-weight pools', () => {
  const parameters = structuredClone(FROZEN_PARAMETERS) as ConfigParameterMap;
  parameters['dungeon.high_tier.nascent_soul.boss_drop.equipment.chance'] = { value: 101 };
  parameters['dungeon.high_tier.nascent_soul.treasure_drop_chance'] = { value: -1 };
  parameters['dungeon.high_tier.nascent_soul.boss_natural_failure_rate'] = { value: 101 };
  for (const key of Object.keys(parameters)) {
    if (key.startsWith('dungeon.high_tier.nascent_soul.treasure_pool_weight.')) parameters[key] = { value: 0 };
    if (key.startsWith('map.black_wind_valley.equipment_quality_') && key.endsWith('_chance')) parameters[key] = { value: 0 };
  }
  assert.throws(() => simulateLongTermEconomy({ horizonHours: 2160, realm: 'nascent_soul', seed: 42, parameters }), (error: unknown) => {
    assert.ok(error instanceof LongTermEconomyError);
    assert.ok(error.diagnostics.some((item) => item.path === 'dungeon.high_tier.nascent_soul.boss_drop.equipment.chance' && item.code === 'INVALID_VALUE'));
    assert.ok(error.diagnostics.some((item) => item.path === 'dungeon.high_tier.nascent_soul.boss_natural_failure_rate' && item.code === 'INVALID_VALUE'));
    assert.ok(error.diagnostics.some((item) => item.path === 'dungeon.high_tier.nascent_soul.treasure_pool_weight' && item.code === 'INVALID_VALUE'));
    assert.ok(error.diagnostics.some((item) => item.path === 'map.black_wind_valley.equipment_quality_chance' && item.code === 'INVALID_VALUE'));
    return true;
  });
});

test('GameService exposes the long-term slice as a read-only, player-scoped runtime operation', async () => {
  const repository = new MemoryRepository();
  const service = new GameService(repository, () => base);
  await service.createPlayer('long-term-service-player', base);
  await repository.transaction('long-term-service-player', 0, { eventType: 'test_seed_long_term_player', payload: {}, at: base }, (draft) => { draft.realmId = 'nascent_soul'; draft.collection.collectionMarks = 10; });
  const result = await service.longTermEconomy({ playerId: 'long-term-service-player', horizonHours: 2160, seed: 42, now: base });
  assert.equal(result.data.supportRoute, 'black_wind_valley');
  assert.equal(result.stateRevision, 1);
  assert.equal((await repository.getPlayer('long-term-service-player')).stateRevision, 1);
  await assert.rejects(() => service.longTermEconomy({ playerId: 'long-term-service-player', horizonHours: 720, seed: 42, now: base }), (error: unknown) => error instanceof ApiError && error.code === 'VALIDATION_FAILED');
});

test('GameService long-term equipment consumption is read-only, player-bound, and gates missing high-tier content', async () => {
  const repository = new MemoryRepository();
  const service = new GameService(repository, () => base);
  const playerId = 'long-term-equipment-service-player';
  await service.createPlayer(playerId, base);
  await repository.transaction(playerId, 0, { eventType: 'test_seed_long_term_equipment_player', payload: {}, at: base }, (draft) => { draft.realmId = 'nascent_soul'; });
  const before = await repository.getPlayer(playerId);
  const call = () => service.longTermEquipmentConsumption({ playerId, horizonHours: 2160, seed: 42, now: base });
  await assert.rejects(call, (error: unknown) => error instanceof ApiError && error.code === 'VALIDATION_FAILED' && Boolean((error.details as { diagnostics?: Array<{ code: string; path: string }> })?.diagnostics?.some((item) => item.code === 'MISSING_CONTENT_BINDING' && item.path === 'dungeon.high_tier.equipment_drop')));
  await assert.rejects(call, (error: unknown) => error instanceof ApiError && error.code === 'VALIDATION_FAILED');
  assert.deepEqual(await repository.getPlayer(playerId), before);
});

test('long-term equipment consumption does not migrate a stale player as a side effect', async () => {
  const version = '1.0.0-read-only-projection';
  const content = structuredClone(CONTENT_PACKAGE);
  content.manifest.config_version = version;
  const provider = new StaticConfigReleaseProvider({
    version,
    parameterSha256: FROZEN_PARAMETER_SHA256,
    contentSha256: content.manifest.content_sha256,
    content,
    parameters: structuredClone(FROZEN_PARAMETERS) as ConfigParameterMap,
    migrationPolicy: { mode: 'forward-compatible', fromVersions: ['1.0.0-stale'] },
  });
  const repository = new MemoryRepository();
  const service = new GameService(repository, () => base, undefined, undefined, undefined, provider);
  const playerId = 'long-term-equipment-stale-player';
  await service.createPlayer(playerId, base);
  await repository.transaction(playerId, 0, { eventType: 'test_seed_stale_long_term_player', payload: {}, at: base }, (draft) => {
    draft.realmId = 'nascent_soul';
    draft.configVersion = '1.0.0-stale';
  });
  const before = await repository.getPlayer(playerId);
  const auditBefore = await repository.getAuditEvents(playerId);
  await assert.rejects(
    () => service.longTermEquipmentConsumption({ playerId, horizonHours: 2160, seed: 42, now: base }),
    (error: unknown) => error instanceof ApiError
      && error.code === 'CONFIG_VERSION_MISMATCH'
      && (error.details as { migrationRequired?: boolean })?.migrationRequired === true,
  );
  await assert.rejects(
    () => service.longTermEconomy({ playerId, horizonHours: 2160, seed: 42, now: base }),
    (error: unknown) => error instanceof ApiError && error.code === 'CONFIG_VERSION_MISMATCH',
  );
  await assert.rejects(
    () => service.longTermEconomyConfidence({ playerId, horizonHours: 2160, seed: 42, sampleCount: 10, now: base }),
    (error: unknown) => error instanceof ApiError && error.code === 'CONFIG_VERSION_MISMATCH',
  );
  assert.deepEqual(await repository.getPlayer(playerId), before);
  assert.deepEqual(await repository.getAuditEvents(playerId), auditBefore);
});

test('HTTP adapter exposes the read-only long-term runtime slice and surfaces the 30-day gate', async () => {
  const previous = process.env.DONGTIAN_ALLOW_INSECURE_PLAYER_HEADER;
  process.env.DONGTIAN_ALLOW_INSECURE_PLAYER_HEADER = '1';
  const repository = new MemoryRepository();
  const service = new GameService(repository, () => base);
  const playerId = 'long-term-http-player';
  await service.createPlayer(playerId, base);
  await repository.transaction(playerId, 0, { eventType: 'test_seed_long_term_http', payload: {}, at: base }, (draft) => { draft.realmId = 'nascent_soul'; draft.collection.collectionMarks = 10; });
  const server = createGameHttpServer(service);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('server did not bind');
  const url = `http://127.0.0.1:${address.port}/v1/economy/long-term`;
  try {
    const success = await fetch(url, { method: 'POST', headers: { 'x-player-id': playerId }, body: JSON.stringify({ horizonHours: 2160, seed: 42 }) });
    assert.equal(success.status, 200);
    assert.equal((await success.json() as { data: { supportRoute: string } }).data.supportRoute, 'black_wind_valley');
    const gated = await fetch(url, { method: 'POST', headers: { 'x-player-id': playerId }, body: JSON.stringify({ horizonHours: 720, seed: 42 }) });
    assert.equal(gated.status, 400);
    assert.equal((await gated.json() as { error: { code: string; details: { diagnostics: Array<{ path: string }> } } }).error.details.diagnostics[0]?.path, 'dungeon.qing_feng.equipment_drop_chance');
    const confidence = await fetch(url.replace('/long-term', '/long-term/confidence'), { method: 'POST', headers: { 'x-player-id': playerId }, body: JSON.stringify({ horizonHours: 2160, seed: 42, sampleCount: 10 }) });
    assert.equal(confidence.status, 200);
    assert.equal((await confidence.json() as { data: { mode: string; sampleCount: number } }).data.mode, 'fixed_seed_confidence_slice');
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    if (previous === undefined) delete process.env.DONGTIAN_ALLOW_INSECURE_PLAYER_HEADER; else process.env.DONGTIAN_ALLOW_INSECURE_PLAYER_HEADER = previous;
  }
});

test('HTTP long-term equipment consumption enforces auth and a horizon/seed-only DTO', async () => {
  const previous = process.env.DONGTIAN_ALLOW_INSECURE_PLAYER_HEADER;
  process.env.DONGTIAN_ALLOW_INSECURE_PLAYER_HEADER = '1';
  const repository = new MemoryRepository();
  const service = new GameService(repository, () => base);
  const playerId = 'long-term-equipment-http-player';
  await service.createPlayer(playerId, base);
  await repository.transaction(playerId, 0, { eventType: 'test_seed_long_term_equipment_http', payload: {}, at: base }, (draft) => { draft.realmId = 'nascent_soul'; });
  const server = createGameHttpServer(service);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('server did not bind');
  const url = `http://127.0.0.1:${address.port}/v1/economy/long-term/equipment-consumption`;
  try {
    const missingAuth = await fetch(url, { method: 'POST', body: JSON.stringify({ horizonHours: 2160, seed: 42 }) });
    assert.equal(missingAuth.status, 400);
    assert.equal((await missingAuth.json() as { error: { code: string } }).error.code, 'AUTH_REQUIRED');
    const invalidDto = await fetch(url, { method: 'POST', headers: { 'x-player-id': playerId }, body: JSON.stringify({ horizonHours: 2160, seed: 42, realm: 'nascent_soul' }) });
    assert.equal(invalidDto.status, 400);
    const invalidPayload = await invalidDto.json() as { requestId: string; configVersion: string; stateRevision: number; serverTime: string; error: { code: string } };
    assert.equal(invalidPayload.error.code, 'VALIDATION_FAILED');
    assert.ok(invalidPayload.requestId && invalidPayload.configVersion && invalidPayload.serverTime);
    assert.equal(invalidPayload.stateRevision, 1);
    const gated = await fetch(url, { method: 'POST', headers: { 'x-player-id': playerId }, body: JSON.stringify({ horizonHours: 2160, seed: 42 }) });
    assert.equal(gated.status, 400);
    const gatedPayload = await gated.json() as { error: { code: string; details: { diagnostics: Array<{ code: string }> } } };
    assert.equal(gatedPayload.error.code, 'VALIDATION_FAILED');
    assert.ok(gatedPayload.error.details.diagnostics.some((item) => item.code === 'MISSING_CONTENT_BINDING'));
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    if (previous === undefined) delete process.env.DONGTIAN_ALLOW_INSECURE_PLAYER_HEADER; else process.env.DONGTIAN_ALLOW_INSECURE_PLAYER_HEADER = previous;
  }
});
