import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { ApiError, CONFIG_VERSION } from './types.ts';
import { MemoryRepository } from './repository.ts';
import { hashPayload } from './repository.ts';
import { GameService } from './service.ts';
import { MetricsCollector } from './metrics.ts';
import { CONTENT_PACKAGE, hashContent } from '../content/content-schema.ts';
import { FROZEN_PARAMETER_SHA256, FROZEN_PARAMETERS } from '../game/frozen-parameters.ts';
import { ConfigReleaseError, StaticConfigReleaseProvider } from './config-release.ts';
import type { ConfigParameterMap, ConfigReleaseProvider, ConfigReleaseSnapshot } from './config-release.ts';

const base = new Date('2026-01-01T00:00:00.000Z');
const at = (seconds: number): Date => new Date(base.getTime() + seconds * 1000);
const setup = async (id = 'player-1') => {
  const repository = new MemoryRepository();
  const service = new GameService(repository, () => at(172800));
  await service.createPlayer(id, base);
  return { repository, service, id };
};
const legacyQueueSetup = async (id = 'legacy-queue-player') => {
  const result = await setup(id);
  await result.repository.transaction(id, 0, { eventType: 'legacy_fixture', payload: {}, at: base }, (draft) => { draft.primaryAction.modelVersion = undefined; });
  return result;
};
const startTraining = async (service: GameService, id: string) => service.startAction({ playerId: id, actionId: 'training', expectedRevision: 0, now: base, requestId: 'start-1', configVersion: CONFIG_VERSION });
const releaseSnapshot = (version: string, targetKillTime?: number, migrationPolicy?: ConfigReleaseSnapshot['migrationPolicy']): ConfigReleaseSnapshot => {
  const parameters = structuredClone(FROZEN_PARAMETERS) as ConfigParameterMap;
  if (targetKillTime !== undefined) parameters['map.bai_cao_valley.target_kill_time'] = { value: targetKillTime };
  return { version, parameterSha256: FROZEN_PARAMETER_SHA256, contentSha256: CONTENT_PACKAGE.manifest.content_sha256, content: { ...CONTENT_PACKAGE, manifest: { ...CONTENT_PACKAGE.manifest, config_version: version } }, parameters, migrationPolicy };
};
const ordinaryMapEquipmentSnapshot = (version: string, quality: 'fine' | 'rare' = 'fine'): ConfigReleaseSnapshot => {
  const parameters = structuredClone(FROZEN_PARAMETERS) as ConfigParameterMap;
  const content = structuredClone(CONTENT_PACKAGE);
  const template = content.equipment.find((item) => item.id === 'iron_saber');
  if (!template) throw new Error('fixture template is missing');
  const slots = ['weapon', 'armor_1', 'armor_2', 'armor_3', 'armor_4', 'accessory'] as const;
  const templates = slots.map((slot, index) => ({
    ...structuredClone(template),
    id: index === 0 ? 'iron_saber' : `map-fixture-${slot}`,
    display_name: index === 0 ? template.display_name : `fixture ${slot}`,
    slot,
    quality,
    quality_parameter: `loot.equipment.quality.multiplier.${quality}`,
  }));
  content.equipment = templates;
  const templateIds = templates.map((item) => item.id);
  for (const map of content.maps) {
    map.equipment_drop = { template_ids: templateIds };
    const prefix = `map.${map.id}.equipment_quality_`;
    for (const candidate of ['normal', 'fine', 'rare', 'epic', 'legendary', 'immortal']) parameters[`${prefix}${candidate}_chance`] = { ...parameters[`${prefix}${candidate}_chance`], value: candidate === quality ? 100 : 0 };
  }
  parameters['loot.equipment.drop_slot_weight.weapon'] = { ...parameters['loot.equipment.drop_slot_weight.weapon'], value: 100 };
  parameters['loot.equipment.drop_slot_weight.armor'] = { ...parameters['loot.equipment.drop_slot_weight.armor'], value: 0 };
  parameters['loot.equipment.drop_slot_weight.accessory'] = { ...parameters['loot.equipment.drop_slot_weight.accessory'], value: 0 };
  for (const map of content.maps) parameters[`map.${map.id}.equipment_drop_chance`] = { ...parameters[`map.${map.id}.equipment_drop_chance`], value: 100 };
  content.manifest.config_version = version;
  content.manifest.content_sha256 = hashContent(content.maps, content.equipment, content.recipes);
  return { version, parameterSha256: FROZEN_PARAMETER_SHA256, contentSha256: content.manifest.content_sha256, content, parameters };
};
class MutableConfigProvider implements ConfigReleaseProvider {
  active: ConfigReleaseSnapshot | null;
  refreshCalls = 0;
  constructor(snapshot: ConfigReleaseSnapshot) { this.active = snapshot; }
  getActiveSnapshot(): ConfigReleaseSnapshot | null { return this.active ? structuredClone(this.active) : null; }
  async refresh(): Promise<ConfigReleaseSnapshot | null> { this.refreshCalls += 1; return this.getActiveSnapshot(); }
}

class PlayerRoutingProvider extends MutableConfigProvider {
  canary: ConfigReleaseSnapshot | null = null;
  percent = 0;
  getSnapshotForPlayer(playerId: string): ConfigReleaseSnapshot | null {
    if (!this.canary) return this.getActiveSnapshot();
    const bucket = Number.parseInt(createHash('sha256').update(playerId).digest('hex').slice(0, 8), 16) / 0x100000000 * 100;
    return bucket < this.percent ? structuredClone(this.canary) : this.getActiveSnapshot();
  }
  getSnapshot(version: string): ConfigReleaseSnapshot | null {
    if (this.active?.version === version) return this.getActiveSnapshot();
    return this.canary?.version === version ? structuredClone(this.canary) : null;
  }
}

test('GameService binds each player request to the provider-selected canary snapshot', async () => {
  const provider = new PlayerRoutingProvider(releaseSnapshot('1.0.10-active', 31));
  provider.canary = releaseSnapshot('1.0.11-canary', 17, { mode: 'identity', fromVersions: ['1.0.10-active'] });
  provider.percent = 100;
  const repository = new MemoryRepository();
  const service = new GameService(repository, () => base, undefined, undefined, undefined, provider);
  await service.createPlayer('canary-player', base);
  const routed = await service.forPlayer('canary-player');
  assert.equal(routed.currentConfigVersion(), '1.0.11-canary');
  const response = await routed.combatPreview({ playerId: 'canary-player', activityId: 'bai_cao_valley', now: base, configVersion: '1.0.11-canary' });
  assert.equal(response.configVersion, '1.0.11-canary');
  await assert.rejects(() => service.forPlayer('canary-player', '1.0.10-active'), (error: unknown) => error instanceof ApiError && error.code === 'CONFIG_VERSION_MISMATCH');
  const historical = await service.forConfigVersion('1.0.10-active');
  assert.equal(historical.currentConfigVersion(), '1.0.10-active');
});

test('GameService refreshes active config atomically and preserves historical replay payloads', async () => {
  const provider = new MutableConfigProvider(releaseSnapshot('1.0.1-runtime', 17));
  const repository = new MemoryRepository();
  const service = new GameService(repository, () => base, undefined, undefined, undefined, provider);
  await service.createPlayer('runtime-old-player', base);
  const settled = await service.offlineSettlement({ playerId: 'runtime-old-player', settlementId: 'runtime-history', requestedStartedAt: base.toISOString(), requestedEndedAt: at(60).toISOString(), expectedRevision: 0, now: at(60) });

  provider.active = releaseSnapshot('1.0.2-runtime', 17);
  const refreshes = await Promise.all([service.refreshActiveConfig(), service.reloadConfig()]);
  assert.deepEqual(refreshes, ['1.0.2-runtime', '1.0.2-runtime']);
  assert.equal(provider.refreshCalls, 1);

  await service.createPlayer('runtime-new-player', base);
  const bootstrap = await service.bootstrap('runtime-new-player', { configVersion: '1.0.2-runtime', now: base });
  assert.equal(bootstrap.configVersion, '1.0.2-runtime');
  const preview = await service.combatPreview({ playerId: 'runtime-new-player', activityId: 'bai_cao_valley', configVersion: '1.0.2-runtime', now: base });
  assert.equal(preview.data.targetClearTime, 17);
  await assert.rejects(() => service.bootstrap('runtime-new-player', { configVersion: '1.0.1-runtime', now: base }), (error: unknown) => error instanceof ApiError && error.code === 'CONFIG_VERSION_MISMATCH');
  await assert.rejects(() => service.bootstrap('runtime-old-player', { configVersion: '1.0.2-runtime', now: base }), (error: unknown) => error instanceof ApiError && error.code === 'CONFIG_VERSION_MISMATCH');

  const replay = await service.replaySettlement('runtime-old-player', 'runtime-history', { configVersion: '1.0.2-runtime', now: at(120) });
  assert.equal(replay.data.configVersion, '1.0.1-runtime');
  assert.deepEqual(replay.data.responsePayload, settled);
});

test('GameService rejects an invalid active snapshot without replacing the current runtime config', async () => {
  const provider = new MutableConfigProvider(releaseSnapshot('1.0.3-runtime', 19));
  const service = new GameService(new MemoryRepository(), () => base, undefined, undefined, undefined, provider);
  provider.active = { ...releaseSnapshot('1.0.4-runtime', 23), contentSha256: 'invalid-content-hash' };
  await assert.rejects(() => service.refreshActiveConfig(), (error: unknown) => error instanceof ConfigReleaseError && error.code === 'RELEASE_INVALID');
  assert.equal(service.currentConfigVersion(), '1.0.3-runtime');
});

test('GameService migrates a supported old player atomically and keeps settlement replay on its original version', async () => {
  const provider = new MutableConfigProvider(releaseSnapshot('1.0.5-runtime'));
  const repository = new MemoryRepository();
  const service = new GameService(repository, () => base, undefined, undefined, undefined, provider);
  await service.createPlayer('migration-player', base);
  const settled = await service.offlineSettlement({ playerId: 'migration-player', settlementId: 'migration-history', requestedStartedAt: base.toISOString(), requestedEndedAt: at(60).toISOString(), expectedRevision: 0, now: at(60) });
  provider.active = releaseSnapshot('1.0.6-runtime', undefined, { mode: 'forward-compatible', fromVersions: ['1.0.5-runtime'] });
  await service.refreshActiveConfig();
  const migrated = await service.bootstrap('migration-player', { now: at(120), configVersion: '1.0.6-runtime' });
  assert.equal(migrated.configVersion, '1.0.6-runtime');
  assert.equal(migrated.stateRevision, 2);
  assert.equal(migrated.data.player.configVersion, '1.0.6-runtime');
  const migrationEvent = (await repository.getAuditEvents('migration-player')).at(-1);
  assert.equal(migrationEvent?.eventType, 'player_config_migrated');
  assert.equal(migrationEvent?.beforeRevision, 1);
  assert.equal(migrationEvent?.afterRevision, 2);
  assert.equal(migrationEvent?.configVersion, '1.0.6-runtime');
  assert.equal(migrationEvent?.payloadHash, hashPayload({ fromVersion: '1.0.5-runtime', toVersion: '1.0.6-runtime', policy: 'forward-compatible' }));
  const action = await service.startAction({ playerId: 'migration-player', actionId: 'training', expectedRevision: migrated.stateRevision, now: at(121), configVersion: '1.0.6-runtime' });
  assert.equal(action.data.actionId, 'training');
  const replay = await service.replaySettlement('migration-player', 'migration-history', { configVersion: '1.0.6-runtime', now: at(121) });
  assert.equal(replay.data.configVersion, '1.0.5-runtime');
  assert.deepEqual(replay.data.responsePayload, settled);
});

test('GameService rejects unsupported migration policy source versions and rolls back migration', async () => {
  const provider = new MutableConfigProvider(releaseSnapshot('1.0.7-runtime'));
  const repository = new MemoryRepository();
  const service = new GameService(repository, () => base, undefined, undefined, undefined, provider);
  await service.createPlayer('migration-rejected', base);
  provider.active = releaseSnapshot('1.0.8-runtime', undefined, { mode: 'identity', fromVersions: ['1.0.0-other'] });
  await service.refreshActiveConfig();
  await assert.rejects(() => service.bootstrap('migration-rejected', { configVersion: '1.0.8-runtime', now: at(1) }), (error: unknown) => error instanceof ApiError && error.code === 'CONFIG_VERSION_MISMATCH');
  const player = await repository.getPlayer('migration-rejected');
  assert.equal(player.configVersion, '1.0.7-runtime');
  assert.equal(player.stateRevision, 0);
  assert.equal((await repository.getAuditEvents('migration-rejected')).length, 0);
});

test('dungeon and high-tier preview remain read-only when a player needs config migration', async () => {
  const provider = new MutableConfigProvider(releaseSnapshot('1.0.30-runtime'));
  const repository = new MemoryRepository();
  const service = new GameService(repository, () => base, undefined, undefined, undefined, provider);
  await service.createPlayer('preview-projection-player', base);
  provider.active = releaseSnapshot('1.0.31-runtime', undefined, { mode: 'forward-compatible', fromVersions: ['1.0.30-runtime'] });
  await service.refreshActiveConfig();

  for (const preview of [
    () => service.previewDungeon('preview-projection-player', 'qing_feng', { now: at(1) }),
    () => service.previewHighTier('preview-projection-player', 'nascent_soul', { now: at(1) }),
  ]) {
    await assert.rejects(preview, (error: unknown) => error instanceof ApiError && error.code === 'CONFIG_VERSION_MISMATCH');
  }
  const player = await repository.getPlayer('preview-projection-player');
  assert.equal(player.stateRevision, 0);
  assert.equal(player.configVersion, '1.0.30-runtime');
  assert.equal((await repository.getAuditEvents('preview-projection-player')).length, 0);
});

test('leaderboards rank by realm, cultivation and combat power without mutating players', async () => {
  const repository = new MemoryRepository();
  const service = new GameService(repository, () => base);
  const ids = ['leaderboard-a', 'leaderboard-b', 'leaderboard-c'];
  for (const id of ids) await service.createPlayer(id, base);
  await repository.transaction(ids[0], 0, { eventType: 'test_leaderboard_seed', payload: {}, at: base }, (draft) => { draft.realmId = 'tribulation'; draft.cultivationXp = 10; draft.equipmentCount = 1; });
  await repository.transaction(ids[1], 0, { eventType: 'test_leaderboard_seed', payload: {}, at: base }, (draft) => { draft.realmId = 'foundation_establishment'; draft.cultivationXp = 999999; draft.equipmentCount = 100; });
  await repository.transaction(ids[2], 0, { eventType: 'test_leaderboard_seed', payload: {}, at: base }, (draft) => { draft.realmId = 'core_formation'; draft.cultivationXp = 500000; draft.equipmentCount = 0; });
  const before = await Promise.all(ids.map((id) => repository.getPlayer(id)));

  const realm = await service.leaderboard({ playerId: ids[0], type: 'realm', limit: 3, offset: 0, now: base });
  assert.deepEqual(realm.data.entries.map((entry) => entry.realmId), ['tribulation', 'core_formation', 'foundation_establishment']);
  assert.deepEqual(realm.data.entries.map((entry) => entry.rank), [1, 2, 3]);
  assert.equal(realm.data.total, 3);

  const cultivation = await service.leaderboard({ playerId: ids[0], type: 'cultivation_xp', limit: 2, offset: 1, now: base });
  assert.deepEqual(cultivation.data.entries.map((entry) => entry.cultivationXp), [500000, 10]);
  assert.deepEqual(cultivation.data.entries.map((entry) => entry.rank), [2, 3]);
  assert.equal(cultivation.data.total, 3);

  const combat = await service.leaderboard({ playerId: ids[0], type: 'combat_power', limit: 3, offset: 0, now: base });
  assert.deepEqual(combat.data.entries.map((entry) => entry.realmId), ['tribulation', 'core_formation', 'foundation_establishment']);
  assert.deepEqual(combat.data.entries.map((entry) => entry.combatPower), [8001010, 2500000, 2099999]);
  assert.equal(JSON.stringify(combat).includes('playerId'), false);
  assert.deepEqual(await Promise.all(ids.map((id) => repository.getPlayer(id))), before);
});

test('success path returns a versioned envelope and commits an audit event', async () => {
  const { repository, service, id } = await setup();
  await startTraining(service, id);
  const result = await service.offlineSettlement({ playerId: id, settlementId: 'settlement-success', requestedStartedAt: base.toISOString(), requestedEndedAt: at(3600).toISOString(), expectedRevision: 1, now: at(3600), requestId: 'request-1', configVersion: CONFIG_VERSION });
  assert.equal(result.configVersion, CONFIG_VERSION);
  assert.equal(result.stateRevision, 2);
  assert.equal(result.data.settledSeconds, 3600);
  assert.equal(result.data.cultivationDelta, 4200);
  assert.equal((await repository.getPlayer(id)).cultivationXp, 4200);
  assert.equal((await repository.getSettlement('settlement-success'))?.status, 'committed');
  assert.equal((await repository.getAuditEvents(id)).length, 2);
});

test('GameService consumes verified active release parameters for map previews', async () => {
  const parameters = structuredClone(FROZEN_PARAMETERS) as Record<string, { value: unknown }>;
  parameters['map.bai_cao_valley.target_kill_time'] = { value: 17 };
  const provider = new StaticConfigReleaseProvider({ version: CONFIG_VERSION, parameterSha256: FROZEN_PARAMETER_SHA256, contentSha256: CONTENT_PACKAGE.manifest.content_sha256, content: CONTENT_PACKAGE, parameters });
  const repository = new MemoryRepository();
  const service = new GameService(repository, () => base, CONFIG_VERSION, CONTENT_PACKAGE, undefined, provider);
  await service.createPlayer('release-parameter-player', base);
  const preview = await service.combatPreview({ playerId: 'release-parameter-player', activityId: 'bai_cao_valley', now: base });
  assert.equal(preview.data.targetClearTime, 17);
});

test('settlement replay returns the stored response without recalculation or mutation', async () => {
  const { repository, service, id } = await setup('replay-owner');
  const settled = await service.offlineSettlement({ playerId: id, settlementId: 'replay-settlement', requestedStartedAt: base.toISOString(), requestedEndedAt: at(60).toISOString(), expectedRevision: 0, now: at(60) });
  const before = await repository.getPlayer(id);
  const replay = await service.replaySettlement(id, 'replay-settlement', { now: at(3600), requestId: 'replay-request' });
  assert.equal(replay.data.settlementId, 'replay-settlement');
  assert.equal(replay.data.status, 'committed');
  assert.equal(replay.data.committedRevision, settled.stateRevision);
  assert.deepEqual(replay.data.responsePayload, settled);
  assert.equal(replay.serverTime, at(3600).toISOString());
  assert.deepEqual(await repository.getPlayer(id), before);

  await service.createPlayer('replay-other', base);
  await assert.rejects(() => service.replaySettlement('replay-other', 'replay-settlement', { now: at(3600) }), (error: unknown) => error instanceof ApiError && error.code === 'NOT_FOUND');
  await assert.rejects(() => service.replaySettlement(id, 'missing-replay', { now: at(3600) }), (error: unknown) => error instanceof ApiError && error.code === 'NOT_FOUND');
});

test('stale expected_revision is rejected without mutation', async () => {
  const { repository, service, id } = await setup();
  await startTraining(service, id);
  const before = (await repository.getPlayer(id));
  await assert.rejects(() => service.offlineSettlement({ playerId: id, settlementId: 'settlement-stale', requestedStartedAt: base.toISOString(), requestedEndedAt: at(60).toISOString(), expectedRevision: 0, now: at(60) }), (error: unknown) => error instanceof ApiError && error.code === 'STALE_REVISION');
  assert.deepEqual((await repository.getPlayer(id)), before);
});

test('same settlement_id returns the first response even with a stale revision', async () => {
  const { service, id } = await setup();
  await startTraining(service, id);
  const first = await service.offlineSettlement({ playerId: id, settlementId: 'settlement-idempotent', requestedStartedAt: base.toISOString(), requestedEndedAt: at(60).toISOString(), expectedRevision: 1, now: at(60), requestId: 'first-request' });
  const repeated = await service.offlineSettlement({ playerId: id, settlementId: 'settlement-idempotent', requestedStartedAt: base.toISOString(), requestedEndedAt: at(60).toISOString(), expectedRevision: 999, now: at(60), requestId: 'second-request' });
  assert.deepEqual(repeated, first);
});

test('offline interval clips to 24 hours and clips overlap from lastSettledAt', async () => {
  const { repository, service, id } = await setup();
  await startTraining(service, id);
  const clipped = await service.offlineSettlement({ playerId: id, settlementId: 'settlement-24h', requestedStartedAt: base.toISOString(), requestedEndedAt: at(48 * 3600).toISOString(), expectedRevision: 1, now: at(48 * 3600) });
  assert.equal(clipped.data.clipped, true);
  assert.equal(clipped.data.settledSeconds, 86400);
  assert.equal(clipped.data.settledStartedAt, base.toISOString());
  assert.equal(clipped.data.settledEndedAt, at(86400).toISOString());
  assert.equal((await repository.getPlayer(id)).lastSettledAt, at(86400).toISOString());
  const secondHalf = await service.offlineSettlement({ playerId: id, settlementId: 'settlement-24h-second-half', requestedStartedAt: base.toISOString(), requestedEndedAt: at(48 * 3600).toISOString(), expectedRevision: 2, now: at(48 * 3600) });
  assert.equal(secondHalf.data.settledSeconds, 86400);
  assert.equal(secondHalf.data.settledStartedAt, at(86400).toISOString());
  assert.equal(secondHalf.data.settledEndedAt, at(48 * 3600).toISOString());
  assert.equal((await repository.getPlayer(id)).lastSettledAt, at(48 * 3600).toISOString());
  const overlap = await service.offlineSettlement({ playerId: id, settlementId: 'settlement-overlap', requestedStartedAt: base.toISOString(), requestedEndedAt: at(48 * 3600).toISOString(), expectedRevision: 3, now: at(48 * 3600) });
  assert.equal(overlap.data.settledSeconds, 0);
  assert.equal(overlap.data.cultivationDelta, 0);
  assert.notEqual(overlap.data.summaryHash, '');
  assert.equal(overlap.data.summaryHash, hashPayload({ ...overlap.data, summaryHash: '' }));
  assert.equal((await repository.getSettlement('settlement-overlap'))?.summaryHash, overlap.data.summaryHash);
  assert.equal((await repository.getPlayer(id)).stateRevision, 3);
});

test('clock rollback is rejected and does not create a settlement', async () => {
  const { repository, service, id } = await setup();
  await startTraining(service, id);
  const before = (await repository.getPlayer(id));
  await assert.rejects(() => service.offlineSettlement({ playerId: id, settlementId: 'settlement-rollback', requestedStartedAt: base.toISOString(), requestedEndedAt: at(-1).toISOString(), expectedRevision: 1, now: at(1) }), (error: unknown) => error instanceof ApiError && error.code === 'TIME_RANGE_INVALID');
  assert.deepEqual((await repository.getPlayer(id)), before);
  assert.equal((await repository.getSettlement('settlement-rollback')), null);
});

test('transaction failure rolls back state but leaves a pending settlement for safe recovery', async () => {
  const { repository, service, id } = await setup();
  await startTraining(service, id);
  const before = (await repository.getPlayer(id));
  repository.injectCommitFailure();
  await assert.rejects(() => service.offlineSettlement({ playerId: id, settlementId: 'settlement-failed-commit', requestedStartedAt: base.toISOString(), requestedEndedAt: at(3600).toISOString(), expectedRevision: 1, now: at(3600) }), (error: unknown) => error instanceof ApiError && error.code === 'INTERNAL_ROLLBACK');
  assert.deepEqual((await repository.getPlayer(id)), before);
  assert.equal((await repository.getSettlement('settlement-failed-commit'))?.status, 'pending');
  const recovered = await service.offlineSettlement({ playerId: id, settlementId: 'settlement-failed-commit', requestedStartedAt: base.toISOString(), requestedEndedAt: at(3600).toISOString(), expectedRevision: 1, now: at(3600) });
  assert.equal(recovered.data.settledSeconds, 3600);
  assert.equal((await repository.getSettlement('settlement-failed-commit'))?.status, 'committed');
});

test('breakthrough atomically consumes frozen costs and changes realm', async () => {
  const { repository, service, id } = await setup();
  await repository.transaction(id, 0, { eventType: 'test_seed', payload: {}, at: base }, (draft) => {
    draft.cultivationXp = 20000;
    draft.resources.spirit_stone.amount = 5000;
    draft.resources.pill.amount = 10;
    draft.resources.ancient_scroll.amount = 1;
  });
  const result = await service.breakthrough({ playerId: id, expectedRevision: 1, now: at(1), requestId: 'breakthrough-1', configVersion: CONFIG_VERSION });
  assert.equal(result.data.toRealm, 'foundation_establishment');
  assert.equal(result.stateRevision, 2);
  const state = (await repository.getPlayer(id));
  assert.equal(state.realmId, 'foundation_establishment');
  assert.equal(state.cultivationXp, 0);
  assert.equal(state.resources.spirit_stone.amount, 0);
  assert.equal(state.resources.pill.amount, 0);
  assert.equal(state.resources.ancient_scroll.amount, 0);
});

test('breakthrough requires the primary action to be stopped, then continues from the stop revision', async () => {
  const { repository, service, id } = await setup('breakthrough-after-stop');
  await repository.transaction(id, 0, { eventType: 'test_seed_breakthrough_after_stop', payload: {}, at: base }, (draft) => {
    draft.cultivationXp = 20000;
    draft.resources.spirit_stone.amount = 5000;
    draft.resources.pill.amount = 10;
    draft.resources.ancient_scroll.amount = 1;
  });
  const started = await service.startAction({ playerId: id, actionId: 'training', expectedRevision: 1, now: base, idempotencyKey: 'breakthrough-training' });
  const beforeRejectedBreakthrough = await repository.getPlayer(id);
  await assert.rejects(
    () => service.breakthrough({ playerId: id, expectedRevision: started.stateRevision, now: at(1), idempotencyKey: 'breakthrough-before-stop' }),
    (error: unknown) => error instanceof ApiError && error.code === 'VALIDATION_FAILED' && (error.details as { actionId?: string } | undefined)?.actionId === 'training',
  );
  assert.deepEqual(await repository.getPlayer(id), beforeRejectedBreakthrough);

  const stopped = await service.stopAction({
    playerId: id,
    settlementId: 'breakthrough-stop-settlement',
    requestedStartedAt: base.toISOString(),
    requestedEndedAt: at(60).toISOString(),
    expectedRevision: started.stateRevision,
    now: at(60),
    idempotencyKey: 'breakthrough-stop',
  });
  assert.equal(stopped.data.actionId, 'training');
  assert.equal(stopped.data.settlement.data.cultivationDelta, 70);
  assert.equal((await repository.getPlayer(id)).primaryAction.actionId, null);

  const result = await service.breakthrough({ playerId: id, expectedRevision: stopped.stateRevision, now: at(61), idempotencyKey: 'breakthrough-after-stop' });
  assert.equal(result.data.fromRealm, 'qi_refining');
  assert.equal(result.data.toRealm, 'foundation_establishment');
  const after = await repository.getPlayer(id);
  assert.equal(after.realmId, 'foundation_establishment');
  assert.equal(after.primaryAction.actionId, null);
  assert.equal(after.cultivationXp, 0);
});

test('breakthrough follows foundation to core frozen transition and is idempotent', async () => {
  const { repository, service, id } = await setup('breakthrough-foundation-core');
  await repository.transaction(id, 0, { eventType: 'test_seed_foundation', payload: {}, at: base }, (draft) => {
    draft.realmId = 'foundation_establishment';
    draft.cultivationXp = 70000;
    draft.resources.spirit_stone.amount = 20000;
    draft.resources.pill.amount = 50;
    draft.resources.ancient_scroll.amount = 5;
  });
  const first = await service.breakthrough({ playerId: id, expectedRevision: 1, now: at(1), idempotencyKey: 'foundation-core' });
  assert.deepEqual(first.data, { fromRealm: 'foundation_establishment', toRealm: 'core_formation', resourceCost: { spirit_stone: 20000, pill: 50, ancient_scroll: 5 }, cultivationCost: 70000 });
  assert.equal(first.stateRevision, 2);
  const repeated = await service.breakthrough({ playerId: id, expectedRevision: 999, now: at(2), idempotencyKey: 'foundation-core' });
  assert.deepEqual(repeated, first);
  const state = await repository.getPlayer(id);
  assert.equal(state.realmId, 'core_formation');
  assert.equal(state.cultivationXp, 0);
  assert.equal(state.resources.spirit_stone.amount, 0);
  assert.equal(state.resources.pill.amount, 0);
  assert.equal(state.resources.ancient_scroll.amount, 0);
});

test('breakthrough follows core to nascent soul and applies target realm capacity multiplier', async () => {
  const { repository, service, id } = await setup('breakthrough-core-nascent');
  await repository.transaction(id, 0, { eventType: 'test_seed_core', payload: {}, at: base }, (draft) => {
    draft.realmId = 'core_formation';
    draft.cultivationXp = 227500;
    draft.resources.spirit_stone.capacity = 100000;
    draft.resources.ancient_scroll.capacity = 400;
    draft.resources.demon_core.capacity = 400;
    draft.resources.millennium_herb.capacity = 400;
    draft.resources.meteor_iron.capacity = 400;
    draft.resources.spirit_stone.amount = 50000;
    draft.resources.pill.amount = 200;
    draft.resources.ancient_scroll.amount = 20;
    draft.resources.demon_core.amount = 50;
    draft.resources.millennium_herb.amount = 100;
    draft.resources.meteor_iron.amount = 100;
  });
  const result = await service.breakthrough({ playerId: id, expectedRevision: 1, now: at(1) });
  assert.equal(result.data.fromRealm, 'core_formation');
  assert.equal(result.data.toRealm, 'nascent_soul');
  assert.deepEqual(result.data.resourceCost, { spirit_stone: 50000, pill: 200, ancient_scroll: 20, demon_core: 50, millennium_herb: 100, meteor_iron: 100 });
  const state = await repository.getPlayer(id);
  assert.equal(state.realmId, 'nascent_soul');
  assert.equal(state.resources.spirit_stone.amount, 0);
  assert.equal(state.resources.demon_core.amount, 0);
  assert.ok(state.resources.spirit_stone.capacity >= 100000);
  assert.ok(state.resources.ancient_scroll.capacity >= 400);
  assert.ok(state.resources.millennium_herb.capacity >= 400);
});

test('breakthrough resource shortage and commit failure preserve the full state', async () => {
  const { repository, service, id } = await setup('breakthrough-atomicity');
  await repository.transaction(id, 0, { eventType: 'test_seed_shortage', payload: {}, at: base }, (draft) => {
    draft.realmId = 'foundation_establishment';
    draft.cultivationXp = 70000;
    draft.resources.spirit_stone.amount = 19999;
    draft.resources.pill.amount = 50;
    draft.resources.ancient_scroll.amount = 5;
  });
  const beforeShortage = await repository.getPlayer(id);
  await assert.rejects(() => service.breakthrough({ playerId: id, expectedRevision: 1, now: at(1) }), (error: unknown) => error instanceof ApiError && error.code === 'RESOURCE_INSUFFICIENT');
  assert.deepEqual(await repository.getPlayer(id), beforeShortage);

  await repository.transaction(id, 1, { eventType: 'test_seed_rollback', payload: {}, at: base }, (draft) => { draft.resources.spirit_stone.amount = 20000; });
  const beforeFailure = await repository.getPlayer(id);
  repository.injectCommitFailure();
  await assert.rejects(() => service.breakthrough({ playerId: id, expectedRevision: 2, now: at(2) }), (error: unknown) => error instanceof ApiError && error.code === 'INTERNAL_ROLLBACK');
  assert.deepEqual(await repository.getPlayer(id), beforeFailure);
});

test('legacy alchemy queue reserves inputs atomically and offline settlement produces pills', async () => {
  const { repository, service, id } = await legacyQueueSetup();
  const queued = await service.queueBuildingJob({ playerId: id, buildingId: 'alchemy_room', recipeId: 'alchemy_basic', quantity: 2, expectedRevision: 1, now: base, idempotencyKey: 'alchemy-1' });
  assert.equal(queued.stateRevision, 2);
  assert.equal(queued.data.reservedInputs.spirit_herb, 4);
  assert.equal((await repository.getPlayer(id)).resources.spirit_herb.reservedAmount, 4);
  const settled = await service.offlineSettlement({ playerId: id, settlementId: 'alchemy-settle-1', requestedStartedAt: base.toISOString(), requestedEndedAt: at(60).toISOString(), expectedRevision: 2, now: at(60) });
  assert.equal(settled.data.productionDelta?.pill, 2);
  assert.equal(settled.data.completedProductionActions, 3);
  assert.equal((await repository.getPlayer(id)).resources.spirit_herb.reservedAmount, 0);
  assert.equal((await repository.getPlayer(id)).resources.pill.amount, 8);
  assert.equal((await repository.getPlayer(id)).buildings.alchemy_room.queuedJobIds.length, 0);
});

test('legacy production keeps carrySeconds and advances queued work across settlements', async () => {
  const { repository, service, id } = await legacyQueueSetup('alchemy-carry');
  await service.queueBuildingJob({ playerId: id, buildingId: 'alchemy_room', recipeId: 'alchemy_basic', quantity: 2, expectedRevision: 1, now: base });
  const first = await service.offlineSettlement({ playerId: id, settlementId: 'alchemy-carry-1', requestedStartedAt: base.toISOString(), requestedEndedAt: at(45).toISOString(), expectedRevision: 2, now: at(45) });
  assert.equal(first.data.productionDelta?.pill, 1);
  assert.equal((await repository.getPlayer(id)).buildings.alchemy_room.carrySeconds, 15);
  assert.equal((await repository.getPlayer(id)).buildings.alchemy_room.queuedJobIds.length, 1);
  const second = await service.offlineSettlement({ playerId: id, settlementId: 'alchemy-carry-2', requestedStartedAt: at(45).toISOString(), requestedEndedAt: at(60).toISOString(), expectedRevision: 3, now: at(60) });
  assert.equal(second.data.productionDelta?.pill, 1);
  assert.equal((await repository.getPlayer(id)).buildings.alchemy_room.carrySeconds, 0);
  assert.equal((await repository.getPlayer(id)).buildings.alchemy_room.queuedJobIds.length, 0);
});

test('spirit farm harvests four plots with carry and level speed multiplier', async () => {
  const { repository, service, id } = await setup('spirit-farm');
  const first = await service.offlineSettlement({ playerId: id, settlementId: 'spirit-farm-carry-1', requestedStartedAt: base.toISOString(), requestedEndedAt: at(3600).toISOString(), expectedRevision: 0, now: at(3600) });
  assert.equal(first.data.productionDelta?.spirit_herb, undefined);
  assert.equal((await repository.getPlayer(id)).buildings.spirit_farm.carrySeconds, 3600);

  const second = await service.offlineSettlement({ playerId: id, settlementId: 'spirit-farm-carry-2', requestedStartedAt: at(3600).toISOString(), requestedEndedAt: at(7200).toISOString(), expectedRevision: 1, now: at(7200) });
  assert.equal(second.data.productionDelta?.spirit_herb, 480);
  assert.equal(second.data.completedProductionActions, 1);
  assert.equal((await repository.getPlayer(id)).resources.spirit_herb.amount, 608);
  assert.equal((await repository.getPlayer(id)).buildings.spirit_farm.carrySeconds, 0);

  await repository.transaction(id, 2, { eventType: 'test_upgrade_spirit_farm', payload: {}, at: base }, (draft) => { draft.buildings.spirit_farm.level = 2; });
  const accelerated = await service.offlineSettlement({ playerId: id, settlementId: 'spirit-farm-level-2', requestedStartedAt: at(7200).toISOString(), requestedEndedAt: at(14400).toISOString(), expectedRevision: 3, now: at(14400) });
  assert.equal(accelerated.data.productionDelta?.spirit_herb, 480);
  assert.ok(Math.abs((await repository.getPlayer(id)).buildings.spirit_farm.carrySeconds - (7200 - 7200 / 1.1)) < 0.000001);
});

test('spirit farm clips at 24 hours and records capacity overflow', async () => {
  const { repository, service, id } = await setup('spirit-farm-overflow');
  await repository.transaction(id, 0, { eventType: 'test_seed_spirit_farm_capacity', payload: {}, at: base }, (draft) => { draft.resources.spirit_herb.amount = 9900; });
  const settled = await service.offlineSettlement({ playerId: id, settlementId: 'spirit-farm-24h', requestedStartedAt: base.toISOString(), requestedEndedAt: at(48 * 3600).toISOString(), expectedRevision: 1, now: at(48 * 3600) });
  assert.equal(settled.data.clipped, true);
  assert.equal(settled.data.settledSeconds, 86400);
  assert.equal(settled.data.productionDelta?.spirit_herb, 100);
  assert.equal(settled.data.overflow.spirit_herb, 5660);
  assert.equal((await repository.getPlayer(id)).resources.spirit_herb.amount, 10000);
  assert.equal((await repository.getPlayer(id)).resources.spirit_herb.overflowAmount, 5660);
});

test('spirit farm settlement rolls back harvest, carry and revision on commit failure', async () => {
  const { repository, service, id } = await setup('spirit-farm-rollback');
  const before = await repository.getPlayer(id);
  repository.injectCommitFailure();
  await assert.rejects(() => service.offlineSettlement({ playerId: id, settlementId: 'spirit-farm-rollback', requestedStartedAt: base.toISOString(), requestedEndedAt: at(7200).toISOString(), expectedRevision: 0, now: at(7200) }), (error: unknown) => error instanceof ApiError && error.code === 'INTERNAL_ROLLBACK');
  assert.deepEqual(await repository.getPlayer(id), before);
  assert.equal((await repository.getSettlement('spirit-farm-rollback'))?.status, 'pending');
  const recovered = await service.offlineSettlement({ playerId: id, settlementId: 'spirit-farm-rollback', requestedStartedAt: base.toISOString(), requestedEndedAt: at(7200).toISOString(), expectedRevision: 0, now: at(7200) });
  assert.equal(recovered.data.productionDelta?.spirit_herb, 480);
  assert.equal((await repository.getSettlement('spirit-farm-rollback'))?.status, 'committed');
});

test('technique research uses the global action slot with fractional carry and level speed', async () => {
  const { repository, service, id } = await setup('technique-pavilion');
  const started = await service.startAction({ playerId: id, actionId: 'technique_research', expectedRevision: 0, now: base });
  const first = await service.offlineSettlement({ playerId: id, settlementId: 'technique-pavilion-1', requestedStartedAt: base.toISOString(), requestedEndedAt: at(45).toISOString(), expectedRevision: started.stateRevision, now: at(45) });
  assert.equal(first.data.productionDelta?.technique_research_xp, undefined);
  assert.equal((await repository.getPlayer(id)).collection.techniqueResearchXp, 0);
  assert.equal((await repository.getPlayer(id)).primaryAction.carrySeconds, 45);

  const second = await service.offlineSettlement({ playerId: id, settlementId: 'technique-pavilion-2', requestedStartedAt: at(45).toISOString(), requestedEndedAt: at(60).toISOString(), expectedRevision: first.stateRevision, now: at(60) });
  assert.equal(second.data.productionDelta?.technique_research_xp, 70);
  assert.equal(second.data.completedProductionActions, 1);
  assert.equal((await repository.getPlayer(id)).collection.techniqueResearchXp, 70);
  assert.equal((await repository.getPlayer(id)).primaryAction.carrySeconds, 0);

  await repository.transaction(id, second.stateRevision, { eventType: 'test_upgrade_technique_pavilion', payload: {}, at: base }, (draft) => { draft.buildings.technique_pavilion.level = 2; });
  const accelerated = await service.offlineSettlement({ playerId: id, settlementId: 'technique-pavilion-3', requestedStartedAt: at(60).toISOString(), requestedEndedAt: at(60 + 55).toISOString(), expectedRevision: second.stateRevision + 1, now: at(60 + 55) });
  assert.equal(accelerated.data.productionDelta?.technique_research_xp, 70);
  assert.ok(Math.abs((await repository.getPlayer(id)).primaryAction.carrySeconds - (55 - 60 / 1.1)) < 0.000001);
});

test('building upgrades charge frozen costs atomically and are idempotent', async () => {
  const { repository, service, id } = await setup('pavilion-upgrade');
  const first = await service.upgradeBuilding({ playerId: id, buildingId: 'technique_pavilion', expectedRevision: 0, now: base, idempotencyKey: 'upgrade-1' });
  assert.deepEqual(first.data, { buildingId: 'technique_pavilion', fromLevel: 1, toLevel: 2, resourceCost: { spirit_stone: 1600 } });
  assert.equal((await repository.getPlayer(id)).resources.spirit_stone.amount, 4020);
  const duplicate = await service.upgradeBuilding({ playerId: id, buildingId: 'technique_pavilion', expectedRevision: 999, now: base, idempotencyKey: 'upgrade-1' });
  assert.deepEqual(duplicate, first);
  const second = await service.upgradeBuilding({ playerId: id, buildingId: 'treasure_pavilion', expectedRevision: 1, now: base });
  assert.equal(second.data.resourceCost.spirit_stone, 1800);
  assert.equal((await repository.getPlayer(id)).buildings.treasure_pavilion.level, 2);
});

test('treasure pavilion applies level multiplier to max-star overflow marks', async () => {
  const { repository, service, id } = await setup('treasure-pavilion');
  await repository.transaction(id, 0, { eventType: 'test_seed_treasure_pavilion', payload: {}, at: base }, (draft) => {
    draft.resources.pill.amount = 100;
    draft.buildings.treasure_pavilion.level = 3;
    for (const treasureId of ['qing_lian_lamp', 'shan_he_seal', 'heaven_bag', 'zhu_que_feather', 'xuan_gui_shell', 'tai_xu_mirror']) draft.collection.treasureStars[treasureId] = 10;
    draft.dungeonPity.qing_feng.treasure = 49;
  });
  const start = await service.startDungeon({ playerId: id, dungeonId: 'qing_feng', seed: 42, expectedRevision: 1, now: base });
  await service.settleDungeon({ playerId: id, attemptId: start.data.attemptId, expectedRevision: 2, now: at(600) });
  assert.equal((await repository.getPlayer(id)).collection.collectionMarks, 1.25);
});

test('legacy forge queue and settlement produce equipment, while inventory full rolls back atomically', async () => {
  const { repository, service, id } = await legacyQueueSetup();
  await repository.transaction(id, 1, { eventType: 'test_seed_forge', payload: {}, at: base }, (draft) => {
    draft.resources.spirit_wood.amount = 10;
    draft.resources.spirit_ore.amount = 10;
  });
  const queued = await service.queueBuildingJob({ playerId: id, buildingId: 'forge_room', recipeId: 'forge_basic', quantity: 1, expectedRevision: 2, now: base });
  const settled = await service.offlineSettlement({ playerId: id, settlementId: 'forge-settle-1', requestedStartedAt: base.toISOString(), requestedEndedAt: at(60).toISOString(), expectedRevision: 3, now: at(60) });
  assert.equal(queued.data.recipeId, 'forge_basic');
  assert.equal(settled.data.productionDelta?.equipment, 1);
  assert.equal((await repository.getPlayer(id)).equipmentCount, 2);

  const full = await legacyQueueSetup('full-equipment');
  await full.repository.transaction(full.id, 1, { eventType: 'test_seed_full', payload: {}, at: base }, (draft) => {
    draft.equipmentCount = 200;
    draft.resources.spirit_wood.amount = 10;
    draft.resources.spirit_ore.amount = 10;
  });
  await full.service.queueBuildingJob({ playerId: full.id, buildingId: 'forge_room', recipeId: 'forge_basic', quantity: 1, expectedRevision: 2, now: base });
  const before = (await full.repository.getPlayer(full.id));
  await assert.rejects(() => full.service.offlineSettlement({ playerId: full.id, settlementId: 'forge-full', requestedStartedAt: base.toISOString(), requestedEndedAt: at(60).toISOString(), expectedRevision: 3, now: at(60) }), (error: unknown) => error instanceof ApiError && error.code === 'INVENTORY_FULL');
  assert.deepEqual((await full.repository.getPlayer(full.id)), before);
});

test('legacy building queue idempotency and stale revision do not duplicate reservations', async () => {
  const { repository, service, id } = await legacyQueueSetup();
  const first = await service.queueBuildingJob({ playerId: id, buildingId: 'alchemy_room', recipeId: 'alchemy_basic', quantity: 1, expectedRevision: 1, now: base, idempotencyKey: 'same-job', requestId: 'first' });
  const duplicate = await service.queueBuildingJob({ playerId: id, buildingId: 'alchemy_room', recipeId: 'alchemy_basic', quantity: 1, expectedRevision: 999, now: base, idempotencyKey: 'same-job', requestId: 'second' });
  assert.deepEqual(duplicate, first);
  assert.equal((await repository.getPlayer(id)).resources.spirit_herb.reservedAmount, 2);
  await assert.rejects(() => service.queueBuildingJob({ playerId: id, buildingId: 'alchemy_room', recipeId: 'alchemy_basic', quantity: 1, expectedRevision: 0, now: base }), (error: unknown) => error instanceof ApiError && error.code === 'STALE_REVISION');
});

test('legacy resource shortage rejects a forge queue without partial reservation', async () => {
  const { repository, service, id } = await legacyQueueSetup();
  const before = (await repository.getPlayer(id));
  await assert.rejects(() => service.queueBuildingJob({ playerId: id, buildingId: 'forge_room', recipeId: 'forge_basic', quantity: 1, expectedRevision: 1, now: base }), (error: unknown) => error instanceof ApiError && error.code === 'RESOURCE_INSUFFICIENT');
  assert.deepEqual((await repository.getPlayer(id)), before);
});

test('building queue fails closed when the requested building state is unavailable', async () => {
  const { repository, service, id } = await legacyQueueSetup('missing-building-state');
  await repository.transaction(id, 1, { eventType: 'test_remove_building', payload: {}, at: base }, (draft) => {
    delete (draft.buildings as Partial<typeof draft.buildings>).alchemy_room;
  });
  await assert.rejects(() => service.queueBuildingJob({ playerId: id, buildingId: 'alchemy_room', recipeId: 'alchemy_basic', quantity: 1, expectedRevision: 2, now: base }), (error: unknown) => error instanceof ApiError && error.code === 'CONTENT_LOCKED');
  const after = await repository.getPlayer(id);
  assert.equal(after.stateRevision, 2);
  assert.equal(after.resources.spirit_herb.reservedAmount, 0);
});

test('MemoryRepository preserves optional equipment creation timestamps', async () => {
  const { repository, id } = await setup('memory-equipment-created-at');
  const createdAt = '2025-12-31T23:59:00.000Z';
  await repository.transaction(id, 0, { eventType: 'equipment_timestamp_seed', payload: {}, at: base }, (draft) => {
    draft.equipmentInstances['equipment.iron_saber.initial'].createdAt = createdAt;
  });
  assert.equal((await repository.getPlayer(id)).equipmentInstances['equipment.iron_saber.initial']?.createdAt, createdAt);
});

test('reinforce upgrades an owned instance and deducts frozen material costs atomically', async () => {
  const { repository, service, id } = await setup();
  await repository.transaction(id, 0, { eventType: 'test_seed_reinforce', payload: {}, at: base }, (draft) => { draft.resources.spirit_wood.amount = 10; });
  const result = await service.equipmentAction({ playerId: id, instanceId: 'equipment.iron_saber.initial', action: 'reinforce', expectedRevision: 1, now: base, requestId: 'reinforce-1', idempotencyKey: 'reinforce-1' });
  assert.equal(result.stateRevision, 2);
  assert.equal(result.data.fromLevel, 0);
  assert.equal(result.data.toLevel, 1);
  assert.deepEqual(result.data.resourceCost, { spirit_stone: 20, spirit_ore: 1, spirit_wood: 1 });
  const state = (await repository.getPlayer(id));
  assert.equal(state.equipmentInstances['equipment.iron_saber.initial'].reinforcementLevel, 1);
  assert.equal(state.resources.spirit_stone.amount, 5600);
  assert.equal(state.resources.spirit_ore.amount, 45);
  assert.equal(state.resources.spirit_wood.amount, 9);
  assert.equal((await repository.getAuditEvents(id)).at(-1)?.eventType, 'equipment_reinforced');
});

test('reinforce rejects max level and stale revision without mutation', async () => {
  const { repository, service, id } = await setup();
  await repository.transaction(id, 0, { eventType: 'test_seed_max', payload: {}, at: base }, (draft) => {
    draft.resources.spirit_wood.amount = 10;
    draft.equipmentInstances['equipment.iron_saber.initial'].reinforcementLevel = 10;
  });
  const before = (await repository.getPlayer(id));
  await assert.rejects(() => service.equipmentAction({ playerId: id, instanceId: 'equipment.iron_saber.initial', action: 'reinforce', expectedRevision: 1, now: base }), (error: unknown) => error instanceof ApiError && error.code === 'VALIDATION_FAILED');
  assert.deepEqual((await repository.getPlayer(id)), before);
  await assert.rejects(() => service.equipmentAction({ playerId: id, instanceId: 'equipment.iron_saber.initial', action: 'reinforce', expectedRevision: 0, now: base }), (error: unknown) => error instanceof ApiError && error.code === 'STALE_REVISION');
});

test('reinforce resource shortage and commit failure leave all state unchanged', async () => {
  const { repository, service, id } = await setup();
  const before = (await repository.getPlayer(id));
  await assert.rejects(() => service.equipmentAction({ playerId: id, instanceId: 'equipment.iron_saber.initial', action: 'reinforce', expectedRevision: 0, now: base }), (error: unknown) => error instanceof ApiError && error.code === 'RESOURCE_INSUFFICIENT');
  assert.deepEqual((await repository.getPlayer(id)), before);
  await repository.transaction(id, 0, { eventType: 'test_seed_rollback', payload: {}, at: base }, (draft) => { draft.resources.spirit_wood.amount = 10; });
  const beforeFailure = (await repository.getPlayer(id));
  repository.injectCommitFailure();
  await assert.rejects(() => service.equipmentAction({ playerId: id, instanceId: 'equipment.iron_saber.initial', action: 'reinforce', expectedRevision: 1, now: base }), (error: unknown) => error instanceof ApiError && error.code === 'INTERNAL_ROLLBACK');
  assert.deepEqual((await repository.getPlayer(id)), beforeFailure);
});

test('reinforce idempotency returns the first response without a second upgrade', async () => {
  const { repository, service, id } = await setup();
  await repository.transaction(id, 0, { eventType: 'test_seed_idempotency', payload: {}, at: base }, (draft) => { draft.resources.spirit_wood.amount = 10; });
  const first = await service.equipmentAction({ playerId: id, instanceId: 'equipment.iron_saber.initial', action: 'reinforce', expectedRevision: 1, now: base, requestId: 'first', idempotencyKey: 'same-reinforce' });
  const repeated = await service.equipmentAction({ playerId: id, instanceId: 'equipment.iron_saber.initial', action: 'reinforce', expectedRevision: 999, now: at(1), requestId: 'second', idempotencyKey: 'same-reinforce' });
  assert.deepEqual(repeated, first);
  assert.equal((await repository.getPlayer(id)).equipmentInstances['equipment.iron_saber.initial'].reinforcementLevel, 1);
});

test('equip and unequip enforce same-slot exclusivity, idempotency and rollback', async () => {
  const { repository, service, id } = await setup('equipment-equip');
  await repository.transaction(id, 0, { eventType: 'test_seed_equip', payload: {}, at: base }, (draft) => {
    draft.equipmentInstances['equipment.second_saber'] = { ...draft.equipmentInstances['equipment.iron_saber.initial'], instanceId: 'equipment.second_saber', isEquipped: false };
    draft.equipmentCount += 1;
  });
  const equipped = await service.equipmentAction({ playerId: id, instanceId: 'equipment.second_saber', action: 'equip', expectedRevision: 1, now: base, idempotencyKey: 'equip-second' });
  assert.equal(equipped.data.equipped, true);
  assert.equal(equipped.data.replacedInstanceId, 'equipment.iron_saber.initial');
  assert.equal((await repository.getPlayer(id)).equipmentInstances['equipment.iron_saber.initial'].isEquipped, false);
  const repeated = await service.equipmentAction({ playerId: id, instanceId: 'equipment.second_saber', action: 'equip', expectedRevision: 999, now: at(1), idempotencyKey: 'equip-second' });
  assert.deepEqual(repeated, equipped);
  const unequipped = await service.equipmentAction({ playerId: id, instanceId: 'equipment.second_saber', action: 'unequip', expectedRevision: 2, now: base, idempotencyKey: 'unequip-second' });
  assert.equal(unequipped.data.equipped, false);
  const beforeFailure = await repository.getPlayer(id);
  repository.injectCommitFailure();
  await assert.rejects(() => service.equipmentAction({ playerId: id, instanceId: 'equipment.iron_saber.initial', action: 'equip', expectedRevision: 3, now: base }), (error: unknown) => error instanceof ApiError && error.code === 'INTERNAL_ROLLBACK');
  assert.deepEqual(await repository.getPlayer(id), beforeFailure);
});

test('collection research and treasure upgrade consume server state atomically', async () => {
  const first = await setup('collection-first-research');
  await first.repository.transaction(first.id, 0, { eventType: 'test_seed_first_research', payload: {}, at: base }, (draft) => { draft.resources.ancient_scroll.amount = 1; draft.collection.techniqueResearchXp = 100; });
  const firstResearch = await first.service.collectionAction({ playerId: first.id, action: 'research', techniqueId: 'technique.mortal.qing_feng', quality: 'mortal', expectedRevision: 1, now: base });
  assert.equal(firstResearch.data.toLayer, 1);
  assert.deepEqual(firstResearch.data.resourceCost, { ancient_scroll: 1, spirit_stone: 1000 });
  assert.equal((await first.repository.getPlayer(first.id)).resources.ancient_scroll.amount, 0);

  const { repository, service, id } = await setup('collection-growth');
  await repository.transaction(id, 0, { eventType: 'test_seed_collection', payload: {}, at: base }, (draft) => {
    draft.collection.techniqueLayers['technique.mortal.qing_feng'] = 0;
    draft.collection.techniqueResearchXp = 100;
    draft.collection.duplicateBalances.qing_lian_lamp = 1;
  });
  const researched = await service.collectionAction({ playerId: id, action: 'research', techniqueId: 'technique.mortal.qing_feng', quality: 'mortal', expectedRevision: 1, now: base, idempotencyKey: 'research-1' });
  assert.equal(researched.data.fromLayer, 0);
  assert.equal(researched.data.toLayer, 1);
  assert.equal(researched.data.researchXpSpent, 100);
  assert.deepEqual(researched.data.resourceCost, {});
  const repeated = await service.collectionAction({ playerId: id, action: 'research', techniqueId: 'technique.mortal.qing_feng', quality: 'mortal', expectedRevision: 999, now: at(1), idempotencyKey: 'research-1' });
  assert.deepEqual(repeated, researched);
  const upgraded = await service.collectionAction({ playerId: id, action: 'treasure_upgrade', treasureId: 'qing_lian_lamp', expectedRevision: 2, now: base, idempotencyKey: 'treasure-1' });
  assert.equal(upgraded.data.fromStars, 0);
  assert.equal(upgraded.data.toStars, 1);
  assert.equal(upgraded.data.duplicateCopiesSpent, 1);
  const state = await repository.getPlayer(id);
  assert.equal(state.collection.techniqueLayers['technique.mortal.qing_feng'], 1);
  assert.equal(state.collection.techniqueResearchXp, 0);
  assert.equal(state.collection.treasureStars.qing_lian_lamp, 1);
  assert.equal(state.collection.duplicateBalances.qing_lian_lamp, 0);
  assert.equal((await repository.getAuditEvents(id)).at(-1)?.eventType, 'collection_treasure_upgrade');
  assert.deepEqual((await repository.getAuditEvents(id)).at(-1)?.payload, { action: 'treasure_upgrade', techniqueId: null, quality: null, treasureId: 'qing_lian_lamp' });
});

test('collection event stream records committed diffs, supports paging, and ignores replay/rollback', async () => {
  const { repository, service, id } = await setup('collection-event-stream');
  await repository.transaction(id, 0, { eventType: 'test_seed_collection_event', payload: {}, at: base }, (draft) => {
    draft.resources.ancient_scroll.amount = 1;
    draft.collection.techniqueResearchXp = 100;
    draft.collection.duplicateBalances.qing_lian_lamp = 1;
  });
  const researched = await service.collectionAction({ playerId: id, action: 'research', techniqueId: 'technique.mortal.qing_feng', quality: 'mortal', expectedRevision: 1, now: at(1), idempotencyKey: 'collection-event-research' });
  const repeated = await service.collectionAction({ playerId: id, action: 'research', techniqueId: 'technique.mortal.qing_feng', quality: 'mortal', expectedRevision: 999, now: at(2), idempotencyKey: 'collection-event-research' });
  assert.deepEqual(repeated, researched);
  const upgraded = await service.collectionAction({ playerId: id, action: 'treasure_upgrade', treasureId: 'qing_lian_lamp', expectedRevision: 2, now: at(3) });
  assert.equal(upgraded.data.toStars, 1);
  const events = await repository.listCollectionEvents(id, 10);
  assert.equal(events.length, 3);
  assert.deepEqual(events.map((event) => event.eventType), ['collection_treasure_upgrade', 'collection_research', 'test_seed_collection_event']);
  const researchEvent = events[1];
  assert.ok(researchEvent);
  const researchPayload = researchEvent.payload as { before: unknown; after: { techniqueLayers: Record<string, number> } };
  assert.equal(researchEvent.beforeRevision, 1);
  assert.equal(researchEvent.afterRevision, 2);
  assert.equal(researchPayload.after.techniqueLayers['technique.mortal.qing_feng'], 1);
  assert.equal(researchEvent.payloadHash, hashPayload({ action: { action: 'research', techniqueId: 'technique.mortal.qing_feng', quality: 'mortal', treasureId: null }, before: researchPayload.before, after: researchPayload.after }));
  const firstPage = await service.collectionEvents({ playerId: id, limit: 2, now: at(4) });
  const page = await service.collectionEvents({ playerId: id, limit: 1, before: firstPage.data.nextBefore!, now: at(4) });
  assert.equal(page.data.events.length, 1);
  assert.equal(page.data.events[0]?.eventType, 'test_seed_collection_event');
  const beforeFailure = await repository.getPlayer(id);
  repository.injectCommitFailure();
  await assert.rejects(() => repository.transaction(id, beforeFailure.stateRevision, { eventType: 'collection_failed_commit', payload: {}, at: at(4) }, (draft) => { draft.collection.collectionMarks += 1; }), (error: unknown) => error instanceof ApiError && error.code === 'INTERNAL_ROLLBACK');
  assert.deepEqual(await repository.getPlayer(id), beforeFailure);
  assert.equal((await repository.listCollectionEvents(id, 10)).length, 3);
});

test('versioned technique pool ids are quality-bound and all six launch treasures can be upgraded', async () => {
  const { repository, service, id } = await setup('collection-pools');
  const techniquePool = [
    ['mortal', 'qing_mu_chang_sheng'], ['mortal', 'bai_shou_guard'],
    ['yellow', 'jin_gang_body'], ['yellow', 'lie_yang_script'],
    ['xuan', 'xuan_shui_manual'], ['xuan', 'hou_tu_earth'],
    ['earth', 'qing_lian_sword'], ['earth', 'tian_yan_blade'],
    ['heaven', 'tai_yi_method'], ['heaven', 'wu_xing_cycle'],
    ['immortal', 'hong_meng_void'], ['immortal', 'yin_yang_book'],
  ] as const;
  assert.equal(new Set(techniquePool.map(([, poolId]) => poolId)).size, 12);
  await assert.rejects(() => service.collectionAction({ playerId: id, action: 'research', techniqueId: 'technique.mortal.qing_mu_chang_sheng', quality: 'yellow', expectedRevision: 0, now: base }), (error: unknown) => error instanceof ApiError && error.code === 'VALIDATION_FAILED');
  await repository.transaction(id, 0, { eventType: 'test_seed_collection_pools', payload: {}, at: base }, (draft) => {
    draft.resources.ancient_scroll.amount = 1;
    draft.resources.spirit_stone.amount = 1000;
    draft.collection.techniqueResearchXp = 100;
    for (const treasureId of ['qing_lian_lamp', 'shan_he_seal', 'heaven_bag', 'zhu_que_feather', 'xuan_gui_shell', 'tai_xu_mirror']) draft.collection.duplicateBalances[treasureId] = 1;
  });
  const researched = await service.collectionAction({ playerId: id, action: 'research', techniqueId: 'technique.mortal.qing_mu_chang_sheng', quality: 'mortal', expectedRevision: 1, now: base });
  assert.equal(researched.data.techniqueId, 'technique.mortal.qing_mu_chang_sheng');
  let expectedRevision = 2;
  for (const treasureId of ['qing_lian_lamp', 'shan_he_seal', 'heaven_bag', 'zhu_que_feather', 'xuan_gui_shell', 'tai_xu_mirror']) {
    const upgraded = await service.collectionAction({ playerId: id, action: 'treasure_upgrade', treasureId, expectedRevision, now: base });
    assert.equal(upgraded.data.toStars, 1);
    expectedRevision += 1;
  }
  const state = await repository.getPlayer(id);
  for (const treasureId of ['qing_lian_lamp', 'shan_he_seal', 'heaven_bag', 'zhu_que_feather', 'xuan_gui_shell', 'tai_xu_mirror']) {
    assert.equal(state.collection.treasureStars[treasureId], 1);
    assert.equal(state.collection.duplicateBalances[treasureId], 0);
  }
});

test('collection actions reject insufficient research/copies, max stars, stale revision and rollback', async () => {
  const { repository, service, id } = await setup('collection-boundaries');
  await assert.rejects(() => service.collectionAction({ playerId: id, action: 'research', techniqueId: 'technique.mortal.qing_feng', quality: 'mortal', expectedRevision: 0, now: base }), (error: unknown) => error instanceof ApiError && error.code === 'RESOURCE_INSUFFICIENT');
  assert.equal((await repository.getPlayer(id)).stateRevision, 0);
  await repository.transaction(id, 0, { eventType: 'test_seed_collection_boundaries', payload: {}, at: base }, (draft) => {
    draft.collection.techniqueLayers['technique.mortal.qing_feng'] = 0;
    draft.collection.techniqueResearchXp = 100;
    draft.collection.treasureStars.qing_lian_lamp = 10;
    draft.collection.duplicateBalances.qing_lian_lamp = 1;
  });
  await assert.rejects(() => service.collectionAction({ playerId: id, action: 'treasure_upgrade', treasureId: 'qing_lian_lamp', expectedRevision: 1, now: base }), (error: unknown) => error instanceof ApiError && error.code === 'VALIDATION_FAILED');
  await assert.rejects(() => service.collectionAction({ playerId: id, action: 'treasure_upgrade', treasureId: 'shan_he_seal', expectedRevision: 1, now: base }), (error: unknown) => error instanceof ApiError && error.code === 'RESOURCE_INSUFFICIENT');
  await assert.rejects(() => service.collectionAction({ playerId: id, action: 'research', techniqueId: 'technique.mortal.qing_feng', quality: 'mortal', expectedRevision: 0, now: base }), (error: unknown) => error instanceof ApiError && error.code === 'STALE_REVISION');
  const before = await repository.getPlayer(id);
  repository.injectCommitFailure();
  await assert.rejects(() => service.collectionAction({ playerId: id, action: 'research', techniqueId: 'technique.mortal.qing_feng', quality: 'mortal', expectedRevision: 1, now: base }), (error: unknown) => error instanceof ApiError && error.code === 'INTERNAL_ROLLBACK');
  assert.deepEqual(await repository.getPlayer(id), before);
});

test('dungeon collection drops convert duplicate techniques and maxed treasures atomically', async () => {
  const { repository, service, id } = await setup('collection-dungeon-drops');
  await repository.transaction(id, 0, { eventType: 'test_seed_collection_drops', payload: {}, at: base }, (draft) => {
    for (const [quality, poolId] of [['mortal', 'qing_mu_chang_sheng'], ['mortal', 'bai_shou_guard'], ['yellow', 'jin_gang_body'], ['yellow', 'lie_yang_script'], ['xuan', 'xuan_shui_manual'], ['xuan', 'hou_tu_earth'], ['earth', 'qing_lian_sword'], ['earth', 'tian_yan_blade'], ['heaven', 'tai_yi_method'], ['heaven', 'wu_xing_cycle'], ['immortal', 'hong_meng_void'], ['immortal', 'yin_yang_book']] as const) draft.collection.techniqueLayers[`technique.${quality}.${poolId}`] = 0;
    for (const treasureId of ['qing_lian_lamp', 'shan_he_seal', 'heaven_bag', 'zhu_que_feather', 'xuan_gui_shell', 'tai_xu_mirror']) draft.collection.treasureStars[treasureId] = 10;
    draft.dungeonPity.qing_feng = { millenniumHerb: 9, meteorIron: 9, technique: 19, treasure: 49 };
    draft.resources.pill.amount = 100;
  });
  const start = await service.startDungeon({ playerId: id, dungeonId: 'qing_feng', seed: 123, expectedRevision: 1, now: base });
  const result = await service.settleDungeon({ playerId: id, attemptId: start.data.attemptId, expectedRevision: 2, now: at(600) });
  assert.equal(result.data.status, 'succeeded');
  const quality = result.data.drops.techniqueQuality;
  const treasureId = result.data.drops.treasureId;
  assert.ok(quality);
  assert.ok(treasureId);
  const state = await repository.getPlayer(id);
  assert.equal(state.collection.techniqueResearchXp, 500 * (quality === 'mortal' ? 1 : quality === 'yellow' ? 2 : quality === 'xuan' ? 4 : quality === 'earth' ? 8 : quality === 'heaven' ? 16 : 32));
  assert.equal(state.collection.collectionMarks, 1);
  assert.equal(state.collection.treasureStars[treasureId], 10);
});

test('dungeon duplicate treasure drops auto-advance the dropped item star', async () => {
  const { repository, service, id } = await setup('collection-auto-treasure-stars');
  await repository.transaction(id, 0, { eventType: 'test_seed_collection_auto_stars', payload: {}, at: base }, (draft) => {
    for (const treasureId of ['qing_lian_lamp', 'shan_he_seal', 'heaven_bag', 'zhu_que_feather', 'xuan_gui_shell', 'tai_xu_mirror']) draft.collection.treasureStars[treasureId] = 3;
    draft.dungeonPity.qing_feng = { millenniumHerb: 9, meteorIron: 9, technique: 19, treasure: 49 };
    draft.resources.pill.amount = 100;
  });
  const start = await service.startDungeon({ playerId: id, dungeonId: 'qing_feng', seed: 123, expectedRevision: 1, now: base });
  const result = await service.settleDungeon({ playerId: id, attemptId: start.data.attemptId, expectedRevision: 2, now: at(600) });
  assert.equal(result.data.status, 'succeeded');
  const treasureId = result.data.drops.treasureId;
  assert.ok(treasureId);
  const state = await repository.getPlayer(id);
  assert.equal(state.collection.treasureStars[treasureId], 4);
  assert.equal(result.data.drops.treasureProgress?.fromStars, 3);
  assert.equal(result.data.drops.treasureProgress?.toStars, 4);
  assert.equal(result.data.drops.treasureProgress?.duplicateCopiesSpent, 1);
});

test('high-tier treasure drops honor the configured weighted pool', async () => {
  const parameters = structuredClone(FROZEN_PARAMETERS) as ConfigParameterMap;
  const prefix = 'dungeon.high_tier.nascent_soul.treasure_pool_weight.';
  const target = `${prefix}nascent_soul_12_sun_crown`;
  for (const key of Object.keys(parameters).filter((key) => key.startsWith(prefix))) parameters[key] = { ...parameters[key], value: key === target ? 1 : 0 };
  parameters['dungeon.high_tier.nascent_soul.treasure_drop_chance'] = { ...parameters['dungeon.high_tier.nascent_soul.treasure_drop_chance'], value: 100 };
  const provider = new MutableConfigProvider({ version: 'weighted-high-tier', parameterSha256: FROZEN_PARAMETER_SHA256, contentSha256: CONTENT_PACKAGE.manifest.content_sha256, content: { ...CONTENT_PACKAGE, manifest: { ...CONTENT_PACKAGE.manifest, config_version: 'weighted-high-tier' } }, parameters });
  const repository = new MemoryRepository();
  const service = new GameService(repository, () => base, undefined, undefined, undefined, provider);
  await service.createPlayer('weighted-high-tier', base);
  await repository.transaction('weighted-high-tier', 0, { eventType: 'test_seed_weighted_high_tier_gate', payload: {}, at: base }, (draft) => {
    draft.realmId = 'nascent_soul';
    draft.collection.collectionMarks = 10;
    draft.resources.pill.amount = 100;
    draft.equipmentInstances['equipment.iron_saber.initial'].affixes = { attack: 245, defence: 192.5, health: 3000 };
  });
  const started = await service.startHighTier({ playerId: 'weighted-high-tier', realm: 'nascent_soul', seed: 19, expectedRevision: 1, now: base });
  const settled = await service.settleHighTier({ playerId: 'weighted-high-tier', attemptId: started.data.attemptId, expectedRevision: 2, now: at(started.data.targetClearTime) });
  assert.equal(settled.data.status, 'succeeded');
  assert.equal(settled.data.drops.treasureId, 'nascent_soul_12_sun_crown');
  assert.equal(settled.data.drops.treasureProgress?.fromStars, 0);
  assert.equal(settled.data.drops.treasureProgress?.toStars, 1);
});

test('map start enforces content realm gates and failure cooldown', async () => {
  const gated = await setup('map-gated');
  const before = await gated.repository.getPlayer(gated.id);
  await assert.rejects(() => gated.service.startAction({ playerId: gated.id, actionId: 'red_flame_cave', expectedRevision: 0, now: base }), (error: unknown) => error instanceof ApiError && error.code === 'GATE_BLOCKED');
  assert.deepEqual(await gated.repository.getPlayer(gated.id), before);

  const cooling = await setup('map-cooling');
  await cooling.repository.transaction(cooling.id, 0, { eventType: 'test_seed_map_cooldown', payload: {}, at: base }, (draft) => { draft.failureCooldownUntil = at(600).toISOString(); });
  const coolingBefore = await cooling.repository.getPlayer(cooling.id);
  await assert.rejects(() => cooling.service.startAction({ playerId: cooling.id, actionId: 'bai_cao_valley', expectedRevision: 1, now: at(60) }), (error: unknown) => error instanceof ApiError && error.code === 'COOLDOWN_ACTIVE');
  assert.deepEqual(await cooling.repository.getPlayer(cooling.id), coolingBefore);
});

test('ordinary map failure clears the action, applies cooldown, and prevents repeat combat', async () => {
  const { repository, service, id } = await setup('map-failure-stops-action');
  await repository.transaction(id, 0, { eventType: 'test_seed_map_failure', payload: {}, at: base }, (draft) => {
    draft.realmId = 'foundation_establishment';
    draft.resources.pill.amount = 0;
  });
  const started = await service.startAction({ playerId: id, actionId: 'red_flame_cave', expectedRevision: 1, now: base });
  const failed = await service.offlineSettlement({
    playerId: id,
    settlementId: 'map-failure-stops-action-settlement',
    requestedStartedAt: base.toISOString(),
    requestedEndedAt: at(240).toISOString(),
    expectedRevision: started.stateRevision,
    now: at(240),
  });
  assert.equal(failed.data.failed, true);
  assert.equal(failed.data.completedActions, 0);
  assert.equal(failed.data.resourceDelta.spirit_stone, 0);
  assert.equal(failed.data.resourceDelta.spirit_ore, 0);
  assert.equal(failed.data.resourceDelta.pill, 0);
  const afterFailure = await repository.getPlayer(id);
  assert.equal(afterFailure.primaryAction.actionId, null);
  assert.equal(afterFailure.primaryAction.carrySeconds, 0);
  assert.equal(afterFailure.failureCooldownUntil, at(300).toISOString());

  const afterCooldownTick = await service.offlineSettlement({
    playerId: id,
    settlementId: 'map-failure-stops-action-follow-up',
    requestedStartedAt: at(240).toISOString(),
    requestedEndedAt: at(480).toISOString(),
    expectedRevision: failed.stateRevision,
    now: at(480),
  });
  assert.equal(afterCooldownTick.data.failed, false);
  assert.equal(afterCooldownTick.data.completedActions, 0);
  assert.equal(afterCooldownTick.data.resourceDelta.spirit_stone ?? 0, 0);
  assert.equal(afterCooldownTick.data.resourceDelta.spirit_ore ?? 0, 0);
  assert.equal(afterCooldownTick.data.resourceDelta.pill ?? 0, 0);
  assert.equal((await repository.getPlayer(id)).primaryAction.actionId, null);
});

test('stopAction accepts an ordinary map failure that already cleared the action', async () => {
  const { repository, service, id } = await setup('stop-map-failure');
  await repository.transaction(id, 0, { eventType: 'test_seed_stop_map_failure', payload: {}, at: base }, (draft) => {
    draft.realmId = 'foundation_establishment';
    draft.resources.pill.amount = 0;
  });
  const started = await service.startAction({ playerId: id, actionId: 'red_flame_cave', expectedRevision: 1, now: base });
  const stopped = await service.stopAction({
    playerId: id,
    settlementId: 'stop-map-failure-settlement',
    requestedStartedAt: base.toISOString(),
    requestedEndedAt: at(240).toISOString(),
    expectedRevision: started.stateRevision,
    now: at(240),
  });
  assert.equal(stopped.data.actionId, 'red_flame_cave');
  assert.equal(stopped.data.settlement.data.failed, true);
  assert.equal(stopped.stateRevision, 4);
  assert.equal((await repository.getPlayer(id)).primaryAction.actionId, null);
});

test('idempotency keys are scoped to the operation target instead of replaying across actions', async () => {
  const { service, id } = await setup('idempotency-operation-scope');
  const first = await service.startAction({ playerId: id, actionId: 'training', expectedRevision: 0, now: base, idempotencyKey: 'shared-key' });
  assert.equal(first.data.actionId, 'training');
  await assert.rejects(
    () => service.startAction({ playerId: id, actionId: 'high_tier_expedition:nascent_soul', expectedRevision: 1, now: at(1), idempotencyKey: 'shared-key' }),
    (error: unknown) => error instanceof ApiError && error.code === 'GATE_BLOCKED',
  );

  const equipment = await setup('idempotency-equipment-scope');
  const equipped = await equipment.service.equipmentAction({ playerId: equipment.id, instanceId: 'equipment.iron_saber.initial', action: 'equip', expectedRevision: 0, now: base, idempotencyKey: 'shared-key' });
  assert.equal(equipped.data.action, 'equip');
  const unequipped = await equipment.service.equipmentAction({ playerId: equipment.id, instanceId: 'equipment.iron_saber.initial', action: 'unequip', expectedRevision: 1, now: at(1), idempotencyKey: 'shared-key' });
  assert.equal(unequipped.data.action, 'unequip');
  assert.equal(unequipped.data.equipped, false);
});

test('stop and switch actions settle the old activity before starting a new one', async () => {
  const { service, repository, id } = await setup('action-switch-flow');
  const started = await service.startAction({ playerId: id, actionId: 'training', expectedRevision: 0, now: base, idempotencyKey: 'training-start' });
  const switched = await service.switchAction({ playerId: id, actionId: 'bai_cao_valley', settlementId: 'action-switch-settlement', requestedStartedAt: base.toISOString(), requestedEndedAt: at(60).toISOString(), expectedRevision: started.stateRevision, now: at(60), idempotencyKey: 'action-switch' });
  assert.equal(switched.data.stopped.actionId, 'training');
  assert.equal(switched.data.started.actionId, 'bai_cao_valley');
  assert.equal(switched.stateRevision, 4);
  const afterSwitch = await repository.getPlayer(id);
  assert.equal(afterSwitch.primaryAction.actionId, 'bai_cao_valley');
  assert.equal(afterSwitch.lastSettledAt, at(60).toISOString());
  const repeated = await service.switchAction({ playerId: id, actionId: 'bai_cao_valley', settlementId: 'action-switch-settlement', requestedStartedAt: base.toISOString(), requestedEndedAt: at(60).toISOString(), expectedRevision: 999, now: at(61), idempotencyKey: 'action-switch' });
  assert.deepEqual(repeated, switched);
  const settled = await service.offlineSettlement({ playerId: id, settlementId: 'action-map-settlement', requestedStartedAt: at(60).toISOString(), requestedEndedAt: at(90).toISOString(), expectedRevision: 4, now: at(90) });
  assert.equal(settled.data.settledSeconds, 30);
});

test('map equipment drops are hard-gated when frozen probabilities lack content bindings', async () => {
  const parameters = structuredClone(FROZEN_PARAMETERS) as ConfigParameterMap;
  parameters['map.bai_cao_valley.equipment_drop_chance'] = { ...parameters['map.bai_cao_valley.equipment_drop_chance'], value: 100 };
  const version = '1.0.0-map-equipment-gate';
  const snapshot = releaseSnapshot(version);
  const content = structuredClone(snapshot.content);
  delete content.maps[0].equipment_drop;
  content.manifest.content_sha256 = hashContent(content.maps, content.equipment, content.recipes);
  const provider = new MutableConfigProvider({ ...snapshot, content, contentSha256: content.manifest.content_sha256 });
  provider.active = { ...provider.active!, version, parameters };
  const repository = new MemoryRepository();
  const service = new GameService(repository, () => at(30), undefined, undefined, undefined, provider);
  await service.createPlayer('map-equipment-gate', base);
  const started = await service.startAction({ playerId: 'map-equipment-gate', actionId: 'bai_cao_valley', expectedRevision: 0, now: base });
  const before = await repository.getPlayer('map-equipment-gate');
  await assert.rejects(() => service.offlineSettlement({ playerId: 'map-equipment-gate', settlementId: 'map-equipment-gate-settlement', requestedStartedAt: base.toISOString(), requestedEndedAt: at(30).toISOString(), expectedRevision: started.stateRevision, now: at(30) }), (error: unknown) => {
    assert.ok(error instanceof ApiError);
    assert.equal(error.code, 'CONTENT_LOCKED');
    const diagnostics = (error.details as { diagnostics?: Array<{ path: string; code: string }> } | undefined)?.diagnostics ?? [];
    assert.ok(diagnostics.some((item) => item.path === 'map.bai_cao_valley.equipment_drop' && item.code === 'MISSING_CONTENT_BINDING'));
    return true;
  });
  assert.deepEqual(await repository.getPlayer('map-equipment-gate'), before);
  const rejected = await repository.getSettlement('map-equipment-gate-settlement');
  assert.equal(rejected?.status, 'rejected');
  const rejectedPayload = rejected?.responsePayload as { error?: { details?: { diagnostics?: Array<{ code: string }> } } };
  assert.ok(rejectedPayload.error?.details?.diagnostics?.some((item) => item.code === 'MISSING_CONTENT_BINDING'));
});

test('map equipment bindings must cover every positive quality weight', async () => {
  const parameters = structuredClone(FROZEN_PARAMETERS) as ConfigParameterMap;
  parameters['map.bai_cao_valley.equipment_drop_chance'] = { ...parameters['map.bai_cao_valley.equipment_drop_chance'], value: 100 };
  parameters['map.bai_cao_valley.equipment_quality_fine_chance'] = { ...parameters['map.bai_cao_valley.equipment_quality_fine_chance'], value: 0 };
  parameters['map.bai_cao_valley.equipment_quality_normal_chance'] = { ...parameters['map.bai_cao_valley.equipment_quality_normal_chance'], value: 0 };
  parameters['map.bai_cao_valley.equipment_quality_rare_chance'] = { ...parameters['map.bai_cao_valley.equipment_quality_rare_chance'], value: 100 };
  parameters['map.bai_cao_valley.equipment_quality_epic_chance'] = { ...parameters['map.bai_cao_valley.equipment_quality_epic_chance'], value: 0 };
  const content = structuredClone(CONTENT_PACKAGE);
  content.maps[0].equipment_drop = { template_ids: [content.equipment[0].id] };
  content.manifest.content_sha256 = hashContent(content.maps, content.equipment, content.recipes);
  const version = '1.0.0-map-equipment-quality-gate';
  content.manifest.config_version = version;
  const provider = new MutableConfigProvider({ version, parameterSha256: FROZEN_PARAMETER_SHA256, contentSha256: content.manifest.content_sha256, content, parameters });
  const repository = new MemoryRepository();
  const service = new GameService(repository, () => at(30), undefined, undefined, undefined, provider);
  await service.createPlayer('map-equipment-quality-gate', base);
  const started = await service.startAction({ playerId: 'map-equipment-quality-gate', actionId: 'bai_cao_valley', expectedRevision: 0, now: base });
  await assert.rejects(() => service.offlineSettlement({ playerId: 'map-equipment-quality-gate', settlementId: 'map-equipment-quality-gate-settlement', requestedStartedAt: base.toISOString(), requestedEndedAt: at(30).toISOString(), expectedRevision: started.stateRevision, now: at(30) }), (error: unknown) => {
    assert.ok(error instanceof ApiError);
    assert.equal(error.code, 'CONTENT_LOCKED');
    const diagnostics = (error.details as { diagnostics?: Array<{ path: string; code: string }> } | undefined)?.diagnostics ?? [];
    assert.ok(diagnostics.some((item) => item.code === 'MISSING_TEMPLATE_FOR_QUALITY' && item.path === 'map.bai_cao_valley.equipment_drop.template_ids'));
    assert.ok(diagnostics.some((item) => item.code === 'MISSING_TEMPLATE_FOR_SLOT_CATEGORY' && item.path === 'map.bai_cao_valley.equipment_drop.template_ids'));
    return true;
  });
});

test('malformed map equipment probability is rejected before service startup', () => {
  const parameters = structuredClone(FROZEN_PARAMETERS) as ConfigParameterMap;
  parameters['map.bai_cao_valley.equipment_drop_chance'] = { ...parameters['map.bai_cao_valley.equipment_drop_chance'], value: Number.NaN };
  const version = '1.0.0-map-equipment-invalid-probability';
  const provider = new MutableConfigProvider({ ...releaseSnapshot(version), version, parameters });
  assert.throws(() => new GameService(new MemoryRepository(), () => at(30), undefined, undefined, undefined, provider), (error: unknown) => {
    assert.ok(error instanceof ConfigReleaseError);
    assert.equal(error.code, 'RELEASE_INVALID');
    assert.equal((error.details as { path?: string } | undefined)?.path, 'map.bai_cao_valley.equipment_drop_chance');
    return true;
  });
});

test('ordinary map equipment uses the versioned binding and deterministic writer atomically', async () => {
  const version = '1.0.0-map-equipment-runtime';
  const provider = new MutableConfigProvider(ordinaryMapEquipmentSnapshot(version));
  const repository = new MemoryRepository();
  const service = new GameService(repository, () => at(30), undefined, undefined, undefined, provider);
  await service.createPlayer('map-equipment-runtime', base);
  const started = await service.startAction({ playerId: 'map-equipment-runtime', actionId: 'bai_cao_valley', expectedRevision: 0, now: base, configVersion: version });
  const first = await service.offlineSettlement({ playerId: 'map-equipment-runtime', settlementId: 'map-equipment-runtime-settlement', requestedStartedAt: base.toISOString(), requestedEndedAt: at(30).toISOString(), expectedRevision: started.stateRevision, now: at(30), configVersion: version });
  assert.equal(first.data.equipmentDrops?.length, 1);
  assert.equal(first.data.equipmentDrops?.[0]?.exit, 'retain');
  assert.equal(first.data.equipmentDrops?.[0]?.quality, 'fine');
  const state = await repository.getPlayer('map-equipment-runtime');
  assert.equal(state.equipmentCount, 2);
  const instanceId = first.data.equipmentDrops?.[0]?.instanceId;
  assert.ok(instanceId && state.equipmentInstances[instanceId]);
  assert.equal(state.equipmentInstances[instanceId].createdConfigVersion, version);
  const replay = await service.offlineSettlement({ playerId: 'map-equipment-runtime', settlementId: 'map-equipment-runtime-settlement', requestedStartedAt: base.toISOString(), requestedEndedAt: at(30).toISOString(), expectedRevision: 999, now: at(31), configVersion: version });
  assert.deepEqual(replay, first);
});

test('ordinary map equipment applies retain_rare salvage at the exact inventory boundary', async () => {
  const version = '1.0.0-map-equipment-salvage';
  const provider = new MutableConfigProvider(ordinaryMapEquipmentSnapshot(version));
  const repository = new MemoryRepository();
  const service = new GameService(repository, () => at(30), undefined, undefined, undefined, provider);
  await service.createPlayer('map-equipment-salvage', base);
  const started = await service.startAction({ playerId: 'map-equipment-salvage', actionId: 'bai_cao_valley', expectedRevision: 0, now: base, configVersion: version });
  await repository.transaction('map-equipment-salvage', started.stateRevision, { eventType: 'test_fill_equipment_capacity', payload: {}, at: base }, (draft) => { draft.equipmentCount = 200; });
  const settled = await service.offlineSettlement({ playerId: 'map-equipment-salvage', settlementId: 'map-equipment-salvage-settlement', requestedStartedAt: base.toISOString(), requestedEndedAt: at(30).toISOString(), expectedRevision: started.stateRevision + 1, now: at(30), configVersion: version });
  assert.equal(settled.data.equipmentDrops?.[0]?.exit, 'salvage');
  assert.deepEqual({ spirit_ore: settled.data.resourceDelta.spirit_ore, spirit_wood: settled.data.resourceDelta.spirit_wood }, { spirit_ore: 3, spirit_wood: 2 });
  assert.equal((await repository.getPlayer('map-equipment-salvage')).equipmentCount, 200);
});

test('ordinary map equipment applies retain_rare sale for rare quality when inventory is full', async () => {
  const version = '1.0.0-map-equipment-sale';
  const provider = new MutableConfigProvider(ordinaryMapEquipmentSnapshot(version, 'rare'));
  const repository = new MemoryRepository();
  const service = new GameService(repository, () => at(30), undefined, undefined, undefined, provider);
  await service.createPlayer('map-equipment-sale', base);
  const started = await service.startAction({ playerId: 'map-equipment-sale', actionId: 'bai_cao_valley', expectedRevision: 0, now: base, configVersion: version });
  await repository.transaction('map-equipment-sale', started.stateRevision, { eventType: 'test_fill_equipment_capacity', payload: {}, at: base }, (draft) => { draft.equipmentCount = 200; });
  const settled = await service.offlineSettlement({ playerId: 'map-equipment-sale', settlementId: 'map-equipment-sale-settlement', requestedStartedAt: base.toISOString(), requestedEndedAt: at(30).toISOString(), expectedRevision: started.stateRevision + 1, now: at(30), configVersion: version });
  assert.equal(settled.data.equipmentDrops?.[0]?.exit, 'sell');
  assert.equal(settled.data.resourceDelta.spirit_stone, 70);
  assert.equal((await repository.getPlayer('map-equipment-sale')).equipmentCount, 200);
});

test('reroll generates deterministic affix slots, charges frozen cost and is idempotent', async () => {
  const first = await setup('reroll-seed-a');
  const second = await setup('reroll-seed-b');
  for (const item of [first, second]) await item.repository.transaction(item.id, 0, { eventType: 'test_seed_reroll', payload: {}, at: base }, (draft) => { draft.equipmentInstances['equipment.iron_saber.initial'].quality = 'rare'; draft.resources.pill.amount = 10; });
  const left = await first.service.equipmentAction({ playerId: first.id, instanceId: 'equipment.iron_saber.initial', action: 'reroll', expectedRevision: 1, now: base, idempotencyKey: 'reroll-1' });
  const right = await second.service.equipmentAction({ playerId: second.id, instanceId: 'equipment.iron_saber.initial', action: 'reroll', expectedRevision: 1, now: base, idempotencyKey: 'reroll-1' });
  assert.deepEqual(left.data.affixes, right.data.affixes);
  assert.equal(left.data.rerollCount, 1);
  assert.deepEqual(left.data.resourceCost, { spirit_stone: 300, pill: 1 });
  const repeated = await first.service.equipmentAction({ playerId: first.id, instanceId: 'equipment.iron_saber.initial', action: 'reroll', expectedRevision: 999, now: at(1), idempotencyKey: 'reroll-1' });
  assert.deepEqual(repeated, left);
});

test('equipment idempotency rejects the same key with different mutation parameters', async () => {
  const { repository, service, id } = await setup('equipment-idempotency-parameters');
  await repository.transaction(id, 0, { eventType: 'test_seed_equipment_idempotency', payload: {}, at: base }, (draft) => {
    draft.equipmentInstances['equipment.iron_saber.initial'].quality = 'legendary';
    draft.resources.pill.amount = 10;
  });
  const first = await service.equipmentAction({ playerId: id, instanceId: 'equipment.iron_saber.initial', action: 'lock', slotIndex: 0, expectedRevision: 1, now: base, idempotencyKey: 'same-equipment-key' });
  assert.deepEqual(first.data.lockedSlots, [0]);
  await assert.rejects(() => service.equipmentAction({ playerId: id, instanceId: 'equipment.iron_saber.initial', action: 'lock', slotIndex: 1, expectedRevision: 2, now: at(1), idempotencyKey: 'same-equipment-key' }), (error: unknown) => error instanceof ApiError && error.code === 'DUPLICATE_REQUEST');
  assert.equal((await repository.getPlayer(id)).stateRevision, 2);
});

test('lock validates active slots, charges incremental costs, and awakening is bounded and atomic', async () => {
  const { repository, service, id } = await setup('advanced-equipment');
  await repository.transaction(id, 0, { eventType: 'test_seed_advanced_equipment', payload: {}, at: base }, (draft) => {
    const item = draft.equipmentInstances['equipment.iron_saber.initial'];
    item.quality = 'legendary';
    draft.resources.pill.amount = 10;
    draft.resources.demon_core.amount = 10;
    draft.resources.meteor_iron.amount = 10;
  });
  await assert.rejects(() => service.equipmentAction({ playerId: id, instanceId: 'equipment.iron_saber.initial', action: 'lock', slotIndex: 2, expectedRevision: 1, now: base }), (error: unknown) => error instanceof ApiError && error.code === 'VALIDATION_FAILED');
  const locked = await service.equipmentAction({ playerId: id, instanceId: 'equipment.iron_saber.initial', action: 'lock', slotIndex: 0, expectedRevision: 1, now: base, idempotencyKey: 'lock-1' });
  assert.deepEqual(locked.data.resourceCost, { spirit_stone: 500, pill: 1 });
  assert.deepEqual(locked.data.lockedSlots, [0]);
  const awakened = await service.equipmentAction({ playerId: id, instanceId: 'equipment.iron_saber.initial', action: 'awaken', expectedRevision: 2, now: base, idempotencyKey: 'awaken-1' });
  assert.deepEqual(awakened.data.resourceCost, { spirit_stone: 1000, demon_core: 5, meteor_iron: 5 });
  assert.equal(awakened.data.toLevel, 1);
  const beforeFailure = await repository.getPlayer(id);
  repository.injectCommitFailure();
  await assert.rejects(() => service.equipmentAction({ playerId: id, instanceId: 'equipment.iron_saber.initial', action: 'awaken', expectedRevision: 3, now: base }), (error: unknown) => error instanceof ApiError && error.code === 'INTERNAL_ROLLBACK');
  assert.deepEqual(await repository.getPlayer(id), beforeFailure);
  await repository.transaction(id, 3, { eventType: 'test_seed_awaken_max', payload: {}, at: base }, (draft) => { draft.equipmentInstances['equipment.iron_saber.initial'].awakeningLevel = 5; });
  await assert.rejects(() => service.equipmentAction({ playerId: id, instanceId: 'equipment.iron_saber.initial', action: 'awaken', expectedRevision: 4, now: base }), (error: unknown) => error instanceof ApiError && error.code === 'VALIDATION_FAILED');
});

test('target reroll shortage leaves random state, affixes and resources unchanged', async () => {
  const { repository, service, id } = await setup('target-reroll-shortage');
  await repository.transaction(id, 0, { eventType: 'test_seed_target_shortage', payload: {}, at: base }, (draft) => {
    draft.equipmentInstances['equipment.iron_saber.initial'].quality = 'legendary';
    draft.resources.spirit_stone.amount = 0;
    draft.resources.pill.amount = 0;
  });
  const before = await repository.getPlayer(id);
  await assert.rejects(() => service.equipmentAction({ playerId: id, instanceId: 'equipment.iron_saber.initial', action: 'reroll', target: true, expectedRevision: 1, now: base }), (error: unknown) => error instanceof ApiError && error.code === 'RESOURCE_INSUFFICIENT');
  assert.deepEqual(await repository.getPlayer(id), before);
});

test('salvage and sell remove unequipped instances and return frozen quality resources', async () => {
  const salvage = await setup('salvage-player');
  await salvage.repository.transaction(salvage.id, 0, { eventType: 'test_seed_salvage', payload: {}, at: base }, (draft) => {
    draft.equipmentInstances['equipment.scrap.normal'] = { ...draft.equipmentInstances['equipment.iron_saber.initial'], instanceId: 'equipment.scrap.normal', templateId: 'iron_saber', quality: 'normal', isEquipped: false };
    draft.equipmentCount += 1;
  });
  const salvaged = await salvage.service.equipmentAction({ playerId: salvage.id, instanceId: 'equipment.scrap.normal', action: 'salvage', expectedRevision: 1, now: base, idempotencyKey: 'salvage-1' });
  assert.deepEqual(salvaged.data.resourceDelta, { spirit_ore: 1, spirit_wood: 1 });
  assert.deepEqual(salvaged.data.overflow, {});
  assert.equal((await salvage.repository.getPlayer(salvage.id)).equipmentCount, 1);
  assert.equal('equipment.scrap.normal' in (await salvage.repository.getPlayer(salvage.id)).equipmentInstances, false);

  const sold = await setup('sell-player');
  await sold.repository.transaction(sold.id, 0, { eventType: 'test_seed_sell', payload: {}, at: base }, (draft) => {
    draft.equipmentInstances['equipment.scrap.fine'] = { ...draft.equipmentInstances['equipment.iron_saber.initial'], instanceId: 'equipment.scrap.fine', templateId: 'iron_saber', quality: 'fine', isEquipped: false };
    draft.equipmentCount += 1;
  });
  const soldResult = await sold.service.equipmentAction({ playerId: sold.id, instanceId: 'equipment.scrap.fine', action: 'sell', expectedRevision: 1, now: base, idempotencyKey: 'sell-1' });
  assert.deepEqual(soldResult.data.resourceDelta, { spirit_stone: 40 });
  assert.equal((await sold.repository.getPlayer(sold.id)).resources.spirit_stone.amount, 5660);
  assert.equal((await sold.repository.getAuditEvents(sold.id)).at(-1)?.eventType, 'equipment_sell');
});

test('equipment export rejects equipped/missing instances and preserves state on overflow', async () => {
  const { repository, service, id } = await setup();
  const before = (await repository.getPlayer(id));
  await assert.rejects(() => service.equipmentAction({ playerId: id, instanceId: 'equipment.iron_saber.initial', action: 'sell', expectedRevision: 0, now: base }), (error: unknown) => error instanceof ApiError && error.code === 'VALIDATION_FAILED');
  assert.deepEqual((await repository.getPlayer(id)), before);
  await assert.rejects(() => service.equipmentAction({ playerId: id, instanceId: 'missing', action: 'salvage', expectedRevision: 0, now: base }), (error: unknown) => error instanceof ApiError && error.code === 'VALIDATION_FAILED');
  assert.deepEqual((await repository.getPlayer(id)), before);

  await repository.transaction(id, 0, { eventType: 'test_seed_export_overflow', payload: {}, at: base }, (draft) => {
    draft.equipmentInstances['equipment.scrap.overflow'] = { ...draft.equipmentInstances['equipment.iron_saber.initial'], instanceId: 'equipment.scrap.overflow', quality: 'fine', isEquipped: false };
    draft.equipmentCount += 1;
    draft.resources.spirit_stone.amount = draft.resources.spirit_stone.capacity;
  });
  const exported = await service.equipmentAction({ playerId: id, instanceId: 'equipment.scrap.overflow', action: 'sell', expectedRevision: 1, now: base });
  assert.deepEqual(exported.data.resourceDelta, { spirit_stone: 0 });
  assert.deepEqual(exported.data.overflow, { spirit_stone: 40 });
  assert.equal((await repository.getPlayer(id)).resources.spirit_stone.overflowAmount, 40);
  assert.equal('equipment.scrap.overflow' in (await repository.getPlayer(id)).equipmentInstances, false);
});

test('equipment export idempotency returns the first response after deletion', async () => {
  const { repository, service, id } = await setup();
  await repository.transaction(id, 0, { eventType: 'test_seed_export_idempotency', payload: {}, at: base }, (draft) => {
    draft.equipmentInstances['equipment.scrap.idempotent'] = { ...draft.equipmentInstances['equipment.iron_saber.initial'], instanceId: 'equipment.scrap.idempotent', quality: 'normal', isEquipped: false };
    draft.equipmentCount += 1;
  });
  const first = await service.equipmentAction({ playerId: id, instanceId: 'equipment.scrap.idempotent', action: 'salvage', expectedRevision: 1, now: base, requestId: 'first', idempotencyKey: 'same-export' });
  const repeated = await service.equipmentAction({ playerId: id, instanceId: 'equipment.scrap.idempotent', action: 'salvage', expectedRevision: 999, now: at(1), requestId: 'second', idempotencyKey: 'same-export' });
  assert.deepEqual(repeated, first);
  assert.equal((await repository.getPlayer(id)).equipmentCount, 1);
});

test('promote raises fine equipment to rare, preserves reinforcement, and consumes frozen costs', async () => {
  const { repository, service, id } = await setup('promote-player');
  await repository.transaction(id, 0, { eventType: 'test_seed_promote', payload: {}, at: base }, (draft) => {
    draft.equipmentInstances['equipment.iron_saber.initial'].reinforcementLevel = 3;
    draft.resources.millennium_herb.amount = 20;
    draft.resources.meteor_iron.amount = 30;
  });
  const result = await service.equipmentAction({ playerId: id, instanceId: 'equipment.iron_saber.initial', action: 'promote', expectedRevision: 1, now: base, idempotencyKey: 'promote-1' });
  assert.equal(result.data.fromQuality, 'fine');
  assert.equal(result.data.toQuality, 'rare');
  assert.deepEqual(result.data.resourceCost, { spirit_stone: 1000, millennium_herb: 10, meteor_iron: 20 });
  assert.equal(result.data.fromLevel, 3);
  assert.equal(result.data.toLevel, 3);
  const state = (await repository.getPlayer(id));
  assert.equal(state.equipmentInstances['equipment.iron_saber.initial'].quality, 'rare');
  assert.equal(state.equipmentInstances['equipment.iron_saber.initial'].reinforcementLevel, 3);
  assert.equal(state.resources.spirit_stone.amount, 4620);
  assert.equal(state.resources.millennium_herb.amount, 10);
  assert.equal(state.resources.meteor_iron.amount, 10);
  assert.equal((await repository.getAuditEvents(id)).at(-1)?.eventType, 'equipment_promote');
});

test('promote rejects maximum quality and insufficient materials without partial mutation', async () => {
  const maximum = await setup('promote-max-player');
  await maximum.repository.transaction(maximum.id, 0, { eventType: 'test_seed_promote_max', payload: {}, at: base }, (draft) => { draft.equipmentInstances['equipment.iron_saber.initial'].quality = 'immortal'; });
  const maxBefore = (await maximum.repository.getPlayer(maximum.id));
  await assert.rejects(() => maximum.service.equipmentAction({ playerId: maximum.id, instanceId: 'equipment.iron_saber.initial', action: 'promote', expectedRevision: 1, now: base }), (error: unknown) => error instanceof ApiError && error.code === 'VALIDATION_FAILED');
  assert.deepEqual((await maximum.repository.getPlayer(maximum.id)), maxBefore);

  const insufficient = await setup('promote-insufficient-player');
  const insufficientBefore = (await insufficient.repository.getPlayer(insufficient.id));
  await assert.rejects(() => insufficient.service.equipmentAction({ playerId: insufficient.id, instanceId: 'equipment.iron_saber.initial', action: 'promote', expectedRevision: 0, now: base }), (error: unknown) => error instanceof ApiError && error.code === 'RESOURCE_INSUFFICIENT');
  assert.deepEqual((await insufficient.repository.getPlayer(insufficient.id)), insufficientBefore);
});

test('promote idempotency returns the first response and stale revision is rejected', async () => {
  const { repository, service, id } = await setup('promote-idempotent-player');
  await repository.transaction(id, 0, { eventType: 'test_seed_promote_idempotent', payload: {}, at: base }, (draft) => {
    draft.resources.millennium_herb.amount = 20;
    draft.resources.meteor_iron.amount = 30;
  });
  const first = await service.equipmentAction({ playerId: id, instanceId: 'equipment.iron_saber.initial', action: 'promote', expectedRevision: 1, now: base, requestId: 'first', idempotencyKey: 'same-promote' });
  const repeated = await service.equipmentAction({ playerId: id, instanceId: 'equipment.iron_saber.initial', action: 'promote', expectedRevision: 999, now: at(1), requestId: 'second', idempotencyKey: 'same-promote' });
  assert.deepEqual(repeated, first);
  await assert.rejects(() => service.equipmentAction({ playerId: id, instanceId: 'equipment.iron_saber.initial', action: 'promote', expectedRevision: 1, now: at(1) }), (error: unknown) => error instanceof ApiError && error.code === 'STALE_REVISION');
});

test('dungeon preview reads all three frozen boss profiles', async () => {
  const { service, id } = await setup('dungeon-preview');
  const qing = await service.previewDungeon(id, 'qing_feng', { now: base });
  const yan = await service.previewDungeon(id, 'yan_prison', { now: base });
  const sky = await service.previewDungeon(id, 'sky_abyss', { now: base });
  assert.deepEqual([qing.data.targetClearTime, yan.data.targetClearTime, sky.data.targetClearTime], [600, 1200, 2400]);
  assert.deepEqual([qing.data.bossBaseHp, yan.data.bossBaseHp, sky.data.bossBaseHp], [4132, 8242, 16463]);
  assert.equal(qing.data.bossMaxHp, 4958.4);
  assert.equal(qing.data.spiritBurnEffectiveDuration, 16);
});

test('combat preview is read-only, reports map/dungeon gates, and rejects unknown activities', async () => {
  const { repository, service, id } = await setup('combat-preview');
  const before = await repository.getPlayer(id);
  const map = await service.combatPreview({ playerId: id, activityId: 'bai_cao_valley', now: base });
  assert.deepEqual({ ...map.data, stats: undefined }, { activityId: 'bai_cao_valley', realm: 'qi_refining', equipmentCount: 1, targetClearTime: 30, pillBudget: 0, gate: { status: 'open', requiredRealm: 'qi_refining', reason: null }, stats: undefined });
  assert.equal(map.data.stats.battlePower, 250);
  const dungeon = await service.combatPreview({ playerId: id, activityId: 'qing_feng', now: base });
  assert.equal(dungeon.data.targetClearTime, 600);
  assert.equal(dungeon.data.pillBudget, 4);
  assert.equal(dungeon.data.gate.status, 'open');
  const gated = await service.combatPreview({ playerId: id, activityId: 'red_flame_cave', now: base });
  assert.deepEqual(gated.data.gate, { status: 'blocked', requiredRealm: 'foundation_establishment', reason: 'realm' });
  await assert.rejects(() => service.combatPreview({ playerId: id, activityId: 'unknown_activity', now: base }), (error: unknown) => error instanceof ApiError && error.code === 'CONTENT_LOCKED');
  assert.deepEqual(await repository.getPlayer(id), before);
});

test('combat preview exposes V1 combat stats from equipped affixes and treasure stars without mutation', async () => {
  const { repository, service, id } = await setup('combat-stats');
  await repository.transaction(id, 0, { eventType: 'test_seed_combat_stats', payload: {}, at: base }, (draft) => {
    const instance = draft.equipmentInstances['equipment.iron_saber.initial'];
    instance.affixes.slots = [
      { kind: 'speed', value: 10 },
      { kind: 'element', value: 'fire' },
      { kind: 'special', value: 'armor_break', grade: 3 },
      { kind: 'special', value: 'body_protection', grade: 2 },
      { kind: 'special', value: 'vitality', grade: 2 },
      { kind: 'special', value: 'rejuvenation', grade: 1 },
    ];
    draft.collection.treasureStars.qing_lian_lamp = 2;
    draft.collection.treasureStars.shan_he_seal = 1;
    draft.collection.treasureStars.zhu_que_feather = 3;
    draft.collection.treasureStars.xuan_gui_shell = 2;
    draft.collection.treasureStars.tai_xu_mirror = 4;
  });
  const before = await repository.getPlayer(id);
  const preview = await service.combatPreview({ playerId: id, activityId: 'bai_cao_valley', now: base });
  assert.deepEqual({ ...preview.data.stats, attackInterval: undefined }, {
    attack: 155,
    defence: 110,
    health: 1188,
    speed: 14,
    accuracy: 100,
    evasion: 100,
    attackInterval: undefined,
    battlePower: 330,
    element: 'neutral',
    elements: { fire: 2, wood: 1, earth: 1, water: 1, metal: 1 },
    outgoingSpecial: 1.06,
    incomingSpecial: 0.96,
    pillHealMultiplier: 1.05,
  });
  assert.ok(Math.abs(preview.data.stats.attackInterval - 4 / 1.14) < 1e-12);
  assert.deepEqual(await repository.getPlayer(id), before);
});

test('technique research layers add frozen combat modifiers and freeze dungeon/high-tier snapshots', async () => {
  const { repository, service, id } = await setup('technique-combat-modifiers');
  const empty = await service.combatPreview({ playerId: id, activityId: 'bai_cao_valley', now: base });
  assert.deepEqual({ attack: empty.data.stats.attack, defence: empty.data.stats.defence, health: empty.data.stats.health }, { attack: 120, defence: 100, health: 1000 });

  await repository.transaction(id, 0, { eventType: 'test_seed_technique_layers', payload: {}, at: base }, (draft) => {
    draft.collection.techniqueLayers['technique.mortal.qing_feng'] = 1;
  });
  const oneLayer = await service.combatPreview({ playerId: id, activityId: 'bai_cao_valley', now: base });
  assert.deepEqual({ attack: oneLayer.data.stats.attack, defence: oneLayer.data.stats.defence, health: oneLayer.data.stats.health }, { attack: 120.5, defence: 100.25, health: 1005 });

  await repository.transaction(id, 1, { eventType: 'test_add_technique_layers', payload: {}, at: base }, (draft) => {
    draft.collection.techniqueLayers['technique.mortal.bai_shou_guard'] = 3;
  });
  const multiLayer = await service.combatPreview({ playerId: id, activityId: 'bai_cao_valley', now: base });
  assert.deepEqual({ attack: multiLayer.data.stats.attack, defence: multiLayer.data.stats.defence, health: multiLayer.data.stats.health }, { attack: 122, defence: 101, health: 1020 });

  const dungeonStart = await service.startDungeon({ playerId: id, dungeonId: 'qing_feng', seed: 17, expectedRevision: 2, now: base });
  const dungeonAttempt = (await repository.getPlayer(id)).dungeonAttempts[dungeonStart.data.attemptId];
  assert.equal(dungeonAttempt.combatSnapshot?.attack, 122);
  await repository.transaction(id, 3, { eventType: 'test_research_after_dungeon_start', payload: {}, at: base }, (draft) => {
    draft.collection.techniqueLayers['technique.mortal.qing_feng'] = 100;
    draft.collection.techniqueLayers['technique.mortal.bai_shou_guard'] = 100;
  });
  const dungeonResult = await service.settleDungeon({ playerId: id, attemptId: dungeonStart.data.attemptId, expectedRevision: 4, now: at(600) });
  assert.equal(dungeonResult.data.combatSnapshot.attack, 122);
  assert.equal((await repository.getPlayer(id)).dungeonAttempts[dungeonStart.data.attemptId].combatSnapshot?.attack, 122);

  const highTier = await setup('technique-high-tier-snapshot');
  await highTier.repository.transaction(highTier.id, 0, { eventType: 'test_seed_high_tier_technique', payload: {}, at: base }, (draft) => {
    draft.realmId = 'nascent_soul';
    draft.collection.collectionMarks = 10;
    draft.collection.techniqueLayers['technique.mortal.qing_feng'] = 2;
    draft.resources.pill.amount = 100;
  });
  const highTierStart = await highTier.service.startHighTier({ playerId: highTier.id, realm: 'nascent_soul', seed: 19, expectedRevision: 1, now: base });
  assert.equal(highTierStart.data.combatSnapshot.attack, 121);
  const highTierAttempt = (await highTier.repository.getPlayer(highTier.id)).highTierAttempts[highTierStart.data.attemptId];
  assert.equal(highTierAttempt.combatSnapshot?.attack, 121);
  await highTier.repository.transaction(highTier.id, 2, { eventType: 'test_research_after_high_tier_start', payload: {}, at: base }, (draft) => { draft.collection.techniqueLayers['technique.mortal.qing_feng'] = 100; });
  const highTierResult = await highTier.service.settleHighTier({ playerId: highTier.id, attemptId: highTierStart.data.attemptId, expectedRevision: 3, now: at(highTierStart.data.targetClearTime) });
  assert.equal(highTierResult.data.combatSnapshot.attack, 121);
});

test('legacy active attempts without a config snapshot are rejected instead of reinterpreted', async () => {
  const dungeon = await setup('legacy-dungeon-attempt');
  const dungeonStart = await dungeon.service.startDungeon({ playerId: dungeon.id, dungeonId: 'qing_feng', seed: 7, expectedRevision: 0, now: base });
  await dungeon.repository.transaction(dungeon.id, 1, { eventType: 'test_remove_attempt_snapshot', payload: {}, at: base }, (draft) => {
    draft.dungeonAttempts[dungeonStart.data.attemptId].configVersion = undefined;
    draft.dungeonAttempts[dungeonStart.data.attemptId].configSnapshot = undefined;
  });
  await assert.rejects(() => dungeon.service.settleDungeon({ playerId: dungeon.id, attemptId: dungeonStart.data.attemptId, expectedRevision: 2, now: at(600) }), (error: unknown) => error instanceof ApiError && error.code === 'CONFIG_VERSION_MISMATCH');

  const highTier = await setup('legacy-high-tier-attempt');
  await highTier.repository.transaction(highTier.id, 0, { eventType: 'test_seed_high_tier_gate', payload: {}, at: base }, (draft) => {
    draft.realmId = 'nascent_soul';
    draft.collection.collectionMarks = 10;
    draft.resources.pill.amount = 100;
  });
  const highTierStart = await highTier.service.startHighTier({ playerId: highTier.id, realm: 'nascent_soul', seed: 7, expectedRevision: 1, now: base });
  await highTier.repository.transaction(highTier.id, 2, { eventType: 'test_remove_attempt_snapshot', payload: {}, at: base }, (draft) => {
    draft.highTierAttempts[highTierStart.data.attemptId].configVersion = undefined;
    draft.highTierAttempts[highTierStart.data.attemptId].configSnapshot = undefined;
  });
  await assert.rejects(() => highTier.service.settleHighTier({ playerId: highTier.id, attemptId: highTierStart.data.attemptId, expectedRevision: 3, now: at(highTierStart.data.targetClearTime) }), (error: unknown) => error instanceof ApiError && error.code === 'CONFIG_VERSION_MISMATCH');
});

test('combat preview reports cooldown without mutating state', async () => {
  const { repository, service, id } = await setup('combat-preview-cooldown');
  await repository.transaction(id, 0, { eventType: 'test_seed_preview_cooldown', payload: {}, at: base }, (draft) => { draft.failureCooldownUntil = at(60).toISOString(); });
  const before = await repository.getPlayer(id);
  const preview = await service.combatPreview({ playerId: id, activityId: 'bai_cao_valley', now: at(1) });
  assert.deepEqual(preview.data.gate, { status: 'blocked', requiredRealm: 'qi_refining', reason: 'cooldown' });
  assert.equal(preview.stateRevision, 1);
  assert.deepEqual(await repository.getPlayer(id), before);
});

test('combat preview honors expected revision and compatible config migration without writing state', async () => {
  const provider = new MutableConfigProvider(releaseSnapshot('1.0.20-runtime'));
  const repository = new MemoryRepository();
  const service = new GameService(repository, () => base, undefined, undefined, undefined, provider);
  await service.createPlayer('preview-migration-player', base);
  provider.active = releaseSnapshot('1.0.21-runtime', undefined, { mode: 'identity', fromVersions: ['1.0.20-runtime'] });
  await service.refreshActiveConfig();
  const preview = await service.combatPreview({ playerId: 'preview-migration-player', activityId: 'bai_cao_valley', expectedRevision: 0, now: at(1) });
  assert.equal(preview.stateRevision, 0);
  assert.equal((await repository.getPlayer('preview-migration-player')).configVersion, '1.0.20-runtime');
  assert.equal((await repository.getAuditEvents('preview-migration-player')).length, 0);
  await assert.rejects(() => service.combatPreview({ playerId: 'preview-migration-player', activityId: 'bai_cao_valley', expectedRevision: 1, now: at(1) }), (error: unknown) => error instanceof ApiError && error.code === 'STALE_REVISION');
});

test('map and dungeon settlement use the player combat snapshot for progress and damage', async () => {
  const baseline = await setup('combat-settlement-baseline');
  const boosted = await setup('combat-settlement-boosted');
  await baseline.service.startAction({ playerId: baseline.id, actionId: 'bai_cao_valley', expectedRevision: 0, now: base });
  await boosted.service.startAction({ playerId: boosted.id, actionId: 'bai_cao_valley', expectedRevision: 0, now: base });
  await boosted.repository.transaction(boosted.id, 1, { eventType: 'test_boost_combat_settlement', payload: {}, at: base }, (draft) => {
    const item = draft.equipmentInstances['equipment.iron_saber.initial'];
    item.affixes.attack = 100;
    item.affixes.defence = 1000;
    item.affixes.slots = [{ kind: 'speed', value: 100 }, { kind: 'element', value: 'fire' }, { kind: 'special', value: 'armor_break', grade: 4 }];
  });
  const baselineSettlement = await baseline.service.offlineSettlement({ playerId: baseline.id, settlementId: 'combat-map-baseline', requestedStartedAt: base.toISOString(), requestedEndedAt: at(30).toISOString(), expectedRevision: 1, now: at(30) });
  const boostedSettlement = await boosted.service.offlineSettlement({ playerId: boosted.id, settlementId: 'combat-map-boosted', requestedStartedAt: base.toISOString(), requestedEndedAt: at(30).toISOString(), expectedRevision: 2, now: at(30) });
  assert.equal(baselineSettlement.data.completedActions, 1);
  assert.ok(boostedSettlement.data.completedActions > baselineSettlement.data.completedActions);
  assert.equal(boostedSettlement.data.combatSnapshot?.speed, 100);
  assert.deepEqual((await baseline.repository.getPlayer(baseline.id)).stateRevision, 2);
  assert.deepEqual((await boosted.repository.getPlayer(boosted.id)).stateRevision, 3);

  const dungeonBaseline = await setup('combat-dungeon-baseline');
  const dungeonBoosted = await setup('combat-dungeon-boosted');
  await dungeonBaseline.service.startDungeon({ playerId: dungeonBaseline.id, dungeonId: 'qing_feng', seed: 21, expectedRevision: 0, now: base });
  await dungeonBoosted.repository.transaction(dungeonBoosted.id, 0, { eventType: 'test_boost_dungeon_combat', payload: {}, at: base }, (draft) => { draft.equipmentInstances['equipment.iron_saber.initial'].affixes.attack = 100; });
  const boostedStart = await dungeonBoosted.service.startDungeon({ playerId: dungeonBoosted.id, dungeonId: 'qing_feng', seed: 21, expectedRevision: 1, now: base });
  await dungeonBoosted.repository.transaction(dungeonBoosted.id, 2, { eventType: 'test_change_after_dungeon_start', payload: {}, at: base }, (draft) => { draft.equipmentInstances['equipment.iron_saber.initial'].affixes.attack = 999; draft.equipmentInstances['equipment.iron_saber.initial'].affixes.defence = 1000; });
  const baselineStart = await dungeonBaseline.repository.getPlayer(dungeonBaseline.id);
  const baselineAttemptId = Object.keys(baselineStart.dungeonAttempts)[0];
  const baselineResult = await dungeonBaseline.service.settleDungeon({ playerId: dungeonBaseline.id, attemptId: baselineAttemptId, expectedRevision: 1, now: at(600) });
  const boostedResult = await dungeonBoosted.service.settleDungeon({ playerId: dungeonBoosted.id, attemptId: boostedStart.data.attemptId, expectedRevision: 3, now: at(600) });
  assert.equal(baselineResult.data.status, 'succeeded');
  assert.equal(boostedResult.data.status, 'succeeded');
  assert.equal(baselineResult.data.combatSnapshot.attack, 120);
  assert.equal(boostedResult.data.combatSnapshot.attack, 220);
  assert.notEqual(boostedResult.data.bossDamageTaken, baselineResult.data.bossDamageTaken);
});

test('dungeon start is fixed-seed, CAS guarded and idempotent', async () => {
  const { service, id } = await setup('dungeon-start');
  const first = await service.startDungeon({ playerId: id, dungeonId: 'qing_feng', seed: 123, expectedRevision: 0, now: base, idempotencyKey: 'same-start' });
  const repeated = await service.startDungeon({ playerId: id, dungeonId: 'qing_feng', seed: 999, expectedRevision: 999, now: at(1), idempotencyKey: 'same-start' });
  assert.deepEqual(repeated, first);
  assert.equal(first.data.seed, 123);
  await assert.rejects(() => service.startDungeon({ playerId: id, dungeonId: 'yan_prison', expectedRevision: 0, now: base }), (error: unknown) => error instanceof ApiError && error.code === 'STALE_REVISION');
});

test('independent dungeon runs with the same seed replay the same reward pool result', async () => {
  const left = await setup('dungeon-replay-left');
  const right = await setup('dungeon-replay-right');
  const leftStart = await left.service.startDungeon({ playerId: left.id, dungeonId: 'qing_feng', seed: 987654, expectedRevision: 0, now: base });
  const rightStart = await right.service.startDungeon({ playerId: right.id, dungeonId: 'qing_feng', seed: 987654, expectedRevision: 0, now: base });
  const leftResult = await left.service.settleDungeon({ playerId: left.id, attemptId: leftStart.data.attemptId, expectedRevision: 1, now: at(600) });
  const rightResult = await right.service.settleDungeon({ playerId: right.id, attemptId: rightStart.data.attemptId, expectedRevision: 1, now: at(600) });
  assert.deepEqual(leftResult.data.drops, rightResult.data.drops);
  assert.deepEqual(leftResult.data.pity, rightResult.data.pity);
  assert.equal(leftResult.data.status, 'succeeded');
  assert.equal(rightResult.data.status, 'succeeded');
});

test('dungeon success settles barrier, phase two, burn, rewards and all pity counters atomically', async () => {
  const { repository, service, id } = await setup('dungeon-success');
  await repository.transaction(id, 0, { eventType: 'test_seed_dungeon_pity', payload: {}, at: base }, (draft) => {
    draft.dungeonPity.qing_feng = { millenniumHerb: 9, meteorIron: 9, technique: 19, treasure: 49 };
  });
  const start = await service.startDungeon({ playerId: id, dungeonId: 'qing_feng', seed: 123, expectedRevision: 1, now: base });
  const result = await service.settleDungeon({ playerId: id, attemptId: start.data.attemptId, expectedRevision: 2, now: at(600) });
  assert.equal(result.data.status, 'succeeded');
  assert.equal(result.data.stunSeconds, 27);
  assert.equal(result.data.spiritBurnSeconds, 64);
  assert.ok(Math.abs(result.data.spiritBurnDamage - 44.8) < 1e-9);
  assert.equal(result.data.phase, 2);
  assert.equal(result.data.bossDamageMultiplier, 1.2);
  assert.ok(result.data.combatEvents.length > 0);
  assert.equal(result.data.combatEvents.at(-1)?.kind, 'combat_end');
  assert.ok(result.data.combatEvents.some((event) => event.actor === 'player' && event.kind === 'attack'));
  assert.equal(result.data.drops.millenniumHerb, 1);
  assert.equal(result.data.drops.meteorIron, 1);
  assert.equal(result.data.drops.techniqueQuality !== null, true);
  assert.equal(result.data.drops.treasureId !== null, true);
  assert.deepEqual((await repository.getPlayer(id)).dungeonPity.qing_feng, { millenniumHerb: 0, meteorIron: 0, technique: 0, treasure: 0 });
  assert.equal((await repository.getPlayer(id)).resources.pill.amount, 2);
  assert.equal((await repository.getPlayer(id)).resources.demon_core.amount, 1);
  assert.equal((await repository.getPlayer(id)).dungeonState.status, 'success');
  assert.equal((await repository.getPlayer(id)).dungeonState.phase, 2);
  const collection = (await repository.getPlayer(id)).collection;
  assert.equal(Object.keys(collection.techniqueLayers).length, 1);
  assert.equal(Object.values(collection.treasureStars).reduce((sum, stars) => sum + stars, 0), 1);
  assert.equal((await repository.getAuditEvents(id)).at(-1)?.eventType, 'dungeon_settled');
  const repeated = await service.settleDungeon({ playerId: id, attemptId: start.data.attemptId, expectedRevision: 999, now: at(601) });
  assert.deepEqual(repeated, result);
});

test('dungeon failure grants no rewards or pity, increments revision and applies cooldown', async () => {
  const { repository, service, id } = await setup('dungeon-failure');
  await repository.transaction(id, 0, { eventType: 'test_seed_dungeon_failure', payload: {}, at: base }, (draft) => { draft.dungeonPity.qing_feng = { millenniumHerb: 4, meteorIron: 3, technique: 2, treasure: 1 }; });
  const start = await service.startDungeon({ playerId: id, dungeonId: 'qing_feng', seed: 55, expectedRevision: 1, now: base });
  const result = await service.settleDungeon({ playerId: id, attemptId: start.data.attemptId, expectedRevision: 2, now: at(601) });
  assert.equal(result.data.status, 'failed');
  assert.equal(result.data.pillCost, 0);
  assert.deepEqual(result.data.resourceDelta, {});
  assert.deepEqual((await repository.getPlayer(id)).dungeonPity.qing_feng, { millenniumHerb: 4, meteorIron: 3, technique: 2, treasure: 1 });
  assert.equal((await repository.getPlayer(id)).resources.pill.amount, 6);
  assert.equal((await repository.getPlayer(id)).dungeonState.status, 'failed');
  assert.equal((await repository.getPlayer(id)).dungeonState.failureCooldownUntil, (await repository.getPlayer(id)).failureCooldownUntil);
  await assert.rejects(() => service.startDungeon({ playerId: id, dungeonId: 'qing_feng', expectedRevision: 3, now: at(602) }), (error: unknown) => error instanceof ApiError && error.code === 'COOLDOWN_ACTIVE');
});

test('dungeon success with insufficient total pills rolls back without partial charge or rewards', async () => {
  const { repository, service, id } = await setup('dungeon-pill-shortage');
  await repository.transaction(id, 0, { eventType: 'test_seed_dungeon_pill_shortage', payload: {}, at: base }, (draft) => {
    draft.resources.pill.amount = 3;
    draft.dungeonPity.qing_feng = { millenniumHerb: 4, meteorIron: 3, technique: 2, treasure: 1 };
  });
  const start = await service.startDungeon({ playerId: id, dungeonId: 'qing_feng', seed: 55, expectedRevision: 1, now: base });
  const before = await repository.getPlayer(id);
  await assert.rejects(() => service.settleDungeon({ playerId: id, attemptId: start.data.attemptId, expectedRevision: 2, now: at(600) }), (error: unknown) => error instanceof ApiError && error.code === 'PILL_INSUFFICIENT');
  assert.deepEqual(await repository.getPlayer(id), before);
});

test('dungeon settle commit failure rolls back attempt, resources, pity and revision', async () => {
  const { repository, service, id } = await setup('dungeon-rollback');
  const start = await service.startDungeon({ playerId: id, dungeonId: 'qing_feng', seed: 1, expectedRevision: 0, now: base });
  const before = (await repository.getPlayer(id));
  repository.injectCommitFailure();
  await assert.rejects(() => service.settleDungeon({ playerId: id, attemptId: start.data.attemptId, expectedRevision: 1, now: at(600) }), (error: unknown) => error instanceof ApiError && error.code === 'INTERNAL_ROLLBACK');
  assert.deepEqual((await repository.getPlayer(id)), before);
});

test('high-tier start enforces the collected_p10 gate and records a fixed-seed attempt', async () => {
  const { repository, service, id } = await setup('high-tier-start');
  await assert.rejects(() => service.startHighTier({ playerId: id, realm: 'nascent_soul', seed: 123, expectedRevision: 0, now: base }), (error: unknown) => error instanceof ApiError && error.code === 'GATE_BLOCKED');
  assert.equal((await repository.getPlayer(id)).stateRevision, 0);
  await repository.transaction(id, 0, { eventType: 'test_seed_high_tier_gate', payload: {}, at: base }, (draft) => {
    draft.realmId = 'nascent_soul';
    draft.collection.collectionMarks = 10;
  });
  const first = await service.startHighTier({ playerId: id, realm: 'nascent_soul', seed: 123, expectedRevision: 1, now: base, idempotencyKey: 'same-high-tier-start' });
  const repeated = await service.startHighTier({ playerId: id, realm: 'nascent_soul', seed: 999, expectedRevision: 999, now: at(1), idempotencyKey: 'same-high-tier-start' });
  assert.deepEqual(repeated, first);
  assert.equal(first.data.seed, 123);
  assert.deepEqual(first.data.skill, { cooldownSeconds: 300, durationSeconds: 2, attackSuppressionPercent: 15 });
  assert.equal((await repository.getPlayer(id)).stateRevision, 2);
  assert.equal((await repository.getPlayer(id)).highTierAttempts[first.data.attemptId].status, 'active');
});

test('high-tier success deducts frozen pill budget, pays isolated drops, advances pity and is replayable', async () => {
  const { repository, service, id } = await setup('high-tier-success');
  await repository.transaction(id, 0, { eventType: 'test_seed_high_tier_success', payload: {}, at: base }, (draft) => {
    draft.realmId = 'nascent_soul';
    draft.collection.collectionMarks = 10;
    draft.resources.pill.amount = 100;
    draft.equipmentInstances['equipment.iron_saber.initial'].affixes = { attack: 245, defence: 192.5, health: 3000 };
  });
  const start = await service.startHighTier({ playerId: id, realm: 'nascent_soul', seed: 123, expectedRevision: 1, now: base });
  const result = await service.settleHighTier({ playerId: id, attemptId: start.data.attemptId, expectedRevision: 2, now: at(start.data.targetClearTime) });
  assert.equal(result.data.status, 'succeeded');
  assert.equal(result.data.pillCost, 47);
  assert.deepEqual(result.data.resourceDelta, { pill: -47, ancient_scroll: 1, demon_core: 2 });
  assert.equal(result.data.drops.ancientScroll, 1);
  assert.equal(result.data.drops.demonCore, 2);
  assert.deepEqual(result.data.skill, start.data.skill);
  assert.equal(result.data.skillSuppressedSeconds, 2);
  const after = await repository.getPlayer(id);
  assert.equal(after.resources.pill.amount, 53);
  assert.equal(after.resources.ancient_scroll.amount, 1);
  assert.equal(after.resources.demon_core.amount, 2);
  // The frozen encounter interval (168h) exceeds the 50h pity threshold,
  // so the first successful encounter deterministically resets this pity.
  assert.equal(after.highTierPity.nascent_soul, 0);
  assert.equal(after.highTierState.status, 'success');
  assert.equal(after.highTierAttempts[start.data.attemptId].skillSuppressedSeconds, result.data.skillSuppressedSeconds);
  assert.equal((await repository.getAuditEvents(id)).at(-1)?.eventType, 'high_tier_settled');
  const replay = await service.settleHighTier({ playerId: id, attemptId: start.data.attemptId, expectedRevision: 999, now: at(start.data.targetClearTime + 1) });
  assert.deepEqual(replay, result);
  assert.equal((await repository.getPlayer(id)).stateRevision, 3);
});

test('high-tier signature skill suppression can cause a deterministic timeout', async () => {
  const parameters = structuredClone(FROZEN_PARAMETERS) as ConfigParameterMap;
  parameters['dungeon.high_tier.nascent_soul.signature_skill.duration_seconds'] = { value: 100 };
  parameters['dungeon.high_tier.nascent_soul.signature_skill.attack_suppression_percent'] = { value: 100 };
  const snapshot = releaseSnapshot('1.0.0-high-tier-suppression');
  snapshot.parameters = parameters;
  const repository = new MemoryRepository();
  const service = new GameService(repository, () => base, undefined, undefined, undefined, new MutableConfigProvider(snapshot));
  const id = 'high-tier-suppression-timeout';
  await service.createPlayer(id, base);
  await repository.transaction(id, 0, { eventType: 'test_seed_high_tier_suppression', payload: {}, at: base }, (draft) => {
    draft.realmId = 'nascent_soul';
    draft.collection.collectionMarks = 10;
    draft.resources.pill.amount = 100;
  });
  const start = await service.startHighTier({ playerId: id, realm: 'nascent_soul', seed: 123, expectedRevision: 1, now: base });
  assert.equal(start.data.skill.durationSeconds, 100);
  assert.equal(start.data.skill.attackSuppressionPercent, 100);
  assert.ok(start.data.targetClearTime > 100);
  const result = await service.settleHighTier({ playerId: id, attemptId: start.data.attemptId, expectedRevision: 2, now: at(start.data.targetClearTime + 1) });
  assert.equal(result.data.status, 'failed');
  assert.equal(result.data.failureReason, 'timeout');
  assert.equal(result.data.skillSuppressedSeconds, 100);
  assert.equal((await repository.getPlayer(id)).highTierAttempts[start.data.attemptId].skillSuppressedSeconds, 100);
});

test('high-tier settlement keeps the start skill snapshot after runtime skill changes', async () => {
  const initial = releaseSnapshot('1.0.0-high-tier-skill-freeze');
  const provider = new MutableConfigProvider(initial);
  const repository = new MemoryRepository();
  const service = new GameService(repository, () => base, undefined, undefined, undefined, provider);
  const id = 'high-tier-skill-snapshot-freeze';
  await service.createPlayer(id, base);
  await repository.transaction(id, 0, { eventType: 'test_seed_high_tier_skill_freeze', payload: {}, at: base }, (draft) => {
    draft.realmId = 'nascent_soul';
    draft.collection.collectionMarks = 10;
    draft.resources.pill.amount = 100;
    draft.equipmentInstances['equipment.iron_saber.initial'].affixes = { attack: 245, defence: 192.5, health: 3000 };
  });
  const start = await service.startHighTier({ playerId: id, realm: 'nascent_soul', seed: 123, expectedRevision: 1, now: base });
  const changedParameters = structuredClone(FROZEN_PARAMETERS) as ConfigParameterMap;
  changedParameters['dungeon.high_tier.nascent_soul.signature_skill.duration_seconds'] = { value: 100 };
  changedParameters['dungeon.high_tier.nascent_soul.signature_skill.attack_suppression_percent'] = { value: 100 };
  provider.active = { ...releaseSnapshot(initial.version), parameters: changedParameters };
  await service.refreshActiveConfig();
  const result = await service.settleHighTier({ playerId: id, attemptId: start.data.attemptId, expectedRevision: 2, now: at(start.data.targetClearTime) });
  assert.equal(result.data.status, 'succeeded');
  assert.deepEqual(result.data.skill, start.data.skill);
  assert.equal(result.data.skillSuppressedSeconds, 2);
  const attempt = (await repository.getPlayer(id)).highTierAttempts[start.data.attemptId];
  assert.deepEqual(attempt.skill, start.data.skill);
  assert.equal(attempt.skillSuppressedSeconds, result.data.skillSuppressedSeconds);
});

test('all six high-tier realms expose frozen signature skills and skill windows affect clear time', async () => {
  const realms = ['nascent_soul', 'divine_transformation', 'void_refining', 'body_unity', 'great_vehicle', 'tribulation'] as const;
  for (const [index, realm] of realms.entries()) {
    const repository = new MemoryRepository();
    const service = new GameService(repository, () => base);
    const playerId = `high-tier-skill-mapping-${index}`;
    await service.createPlayer(playerId, base);
    await repository.transaction(playerId, 0, { eventType: 'test_seed_high_tier_skill_mapping', payload: {}, at: base }, (draft) => { draft.realmId = realm; draft.collection.collectionMarks = 10; });
    const preview = await service.previewHighTier(playerId, realm, { now: base });
    assert.deepEqual(preview.data.skill, {
      cooldownSeconds: Number(FROZEN_PARAMETERS[`dungeon.high_tier.${realm}.signature_skill.cooldown_seconds`].value),
      durationSeconds: Number(FROZEN_PARAMETERS[`dungeon.high_tier.${realm}.signature_skill.duration_seconds`].value),
      attackSuppressionPercent: Number(FROZEN_PARAMETERS[`dungeon.high_tier.${realm}.signature_skill.attack_suppression_percent`].value),
    });
  }

  const baselineParameters = structuredClone(FROZEN_PARAMETERS) as ConfigParameterMap;
  const suppressedParameters = structuredClone(FROZEN_PARAMETERS) as ConfigParameterMap;
  suppressedParameters['dungeon.high_tier.nascent_soul.signature_skill.attack_suppression_percent'] = { value: 100 };
  suppressedParameters['dungeon.high_tier.nascent_soul.signature_skill.duration_seconds'] = { value: 100 };
  const makeService = (playerId: string, parameters: ConfigParameterMap) => {
    const snapshot = releaseSnapshot(`1.0.0-skill-${playerId}`, undefined);
    snapshot.parameters = parameters;
    const repository = new MemoryRepository();
    const service = new GameService(repository, () => base, undefined, undefined, undefined, new MutableConfigProvider(snapshot));
    return { repository, service, playerId };
  };
  const baseline = makeService('baseline', baselineParameters);
  const suppressed = makeService('suppressed', suppressedParameters);
  await baseline.service.createPlayer(baseline.playerId, base);
  await suppressed.service.createPlayer(suppressed.playerId, base);
  await baseline.repository.transaction(baseline.playerId, 0, { eventType: 'test_seed_high_tier_skill_effect', payload: {}, at: base }, (draft) => { draft.realmId = 'nascent_soul'; draft.collection.collectionMarks = 10; });
  await suppressed.repository.transaction(suppressed.playerId, 0, { eventType: 'test_seed_high_tier_skill_effect', payload: {}, at: base }, (draft) => { draft.realmId = 'nascent_soul'; draft.collection.collectionMarks = 10; });
  const baselinePreview = await baseline.service.previewHighTier(baseline.playerId, 'nascent_soul', { now: base });
  const suppressedPreview = await suppressed.service.previewHighTier(suppressed.playerId, 'nascent_soul', { now: base });
  assert.ok(baselinePreview.data.targetClearTime < suppressedPreview.data.targetClearTime);
});

test('high-tier expedition long-horizon harness clips at 24h and preserves frozen nascent soul rates', async () => {
  const realm = 'nascent_soul' as const;
  const resources = ['spirit_stone', 'pill', 'ancient_scroll', 'demon_core', 'millennium_herb', 'meteor_iron'] as const;
  const secondsPerDay = 24 * 60 * 60;
  const run = async (days: 30 | 90) => {
    const { repository, service, id } = await setup(`high-tier-long-horizon-${days}`);
    await repository.transaction(id, 0, { eventType: 'test_seed_high_tier_long_horizon', payload: { realm, days }, at: base }, (draft) => {
      draft.realmId = realm;
      for (const resource of resources) {
        draft.resources[resource].amount = 0;
        draft.resources[resource].capacity = 1_000_000_000;
      }
    });
    const action = await service.startAction({ playerId: id, actionId: `high_tier_expedition:${realm}`, expectedRevision: 1, now: base });
    let result = await service.offlineSettlement({ playerId: id, settlementId: `${id}-day-1`, requestedStartedAt: base.toISOString(), requestedEndedAt: at(days * secondsPerDay).toISOString(), expectedRevision: action.stateRevision, now: at(days * secondsPerDay) });
    assert.equal(result.data.clipped, true);
    assert.equal(result.data.settledSeconds, secondsPerDay);
    const totals = Object.fromEntries(resources.map((resource) => [resource, result.data.resourceDelta[resource] ?? 0])) as Record<(typeof resources)[number], number>;
    for (let day = 2; day <= days; day += 1) {
      result = await service.offlineSettlement({ playerId: id, settlementId: `${id}-day-${day}`, requestedStartedAt: at((day - 1) * secondsPerDay).toISOString(), requestedEndedAt: at(day * secondsPerDay).toISOString(), expectedRevision: result.stateRevision, now: at(day * secondsPerDay) });
      assert.equal(result.data.clipped, false);
      assert.equal(result.data.settledSeconds, secondsPerDay);
      for (const resource of resources) totals[resource] += result.data.resourceDelta[resource] ?? 0;
    }
    const summary = { days, settledSeconds: days * secondsPerDay, totals };
    assert.equal(result.data.settledSeconds + (days - 1) * secondsPerDay, summary.settledSeconds);
    for (const resource of resources) {
      const expected = Number(FROZEN_PARAMETERS[`dungeon.high_tier.${realm}.${resource}_per_hour`].value) * days * 24;
      assert.ok(Math.abs(summary.totals[resource] - expected) < 1e-8, `${days}d ${resource} hourly supply drifted`);
    }
    return summary;
  };
  const summaries = [await run(30), await run(90)];
  assert.deepEqual(summaries.map((summary) => summary.settledSeconds), [30 * secondsPerDay, 90 * secondsPerDay]);
});

test('high-tier timeout failure does not deduct pills, rewards or pity and applies a 60-second cooldown', async () => {
  const { repository, service, id } = await setup('high-tier-failure');
  await repository.transaction(id, 0, { eventType: 'test_seed_high_tier_failure', payload: {}, at: base }, (draft) => {
    draft.realmId = 'nascent_soul';
    draft.collection.collectionMarks = 10;
    draft.resources.pill.amount = 100;
    draft.highTierPity.nascent_soul = 12;
  });
  const start = await service.startHighTier({ playerId: id, realm: 'nascent_soul', seed: 123, expectedRevision: 1, now: base });
  const result = await service.settleHighTier({ playerId: id, attemptId: start.data.attemptId, expectedRevision: 2, now: at(start.data.targetClearTime + 1) });
  assert.equal(result.data.status, 'failed');
  assert.equal(result.data.pillCost, 0);
  assert.equal(result.data.skillSuppressedSeconds, 2);
  assert.deepEqual(result.data.resourceDelta, {});
  assert.deepEqual(result.data.drops, { ancientScroll: 0, demonCore: 0, equipment: null, treasureId: null });
  const after = await repository.getPlayer(id);
  assert.equal(after.resources.pill.amount, 100);
  assert.equal(after.resources.ancient_scroll.amount, 0);
  assert.equal(after.resources.demon_core.amount, 0);
  assert.equal(after.highTierPity.nascent_soul, 12);
  assert.equal(after.stateRevision, 3);
  assert.equal(after.highTierState.failureCooldownUntil, at(start.data.targetClearTime + 61).toISOString());
  await assert.rejects(() => service.startHighTier({ playerId: id, realm: 'nascent_soul', expectedRevision: 3, now: at(start.data.targetClearTime + 2) }), (error: unknown) => error instanceof ApiError && error.code === 'COOLDOWN_ACTIVE');
  const replay = await service.settleHighTier({ playerId: id, attemptId: start.data.attemptId, expectedRevision: 999, now: at(999) });
  assert.deepEqual(replay, result);
});

test('high-tier combat snapshot scales clear time, enforces survival, and ignores post-start research', async () => {
  const weak = await setup('high-tier-weak-combat');
  const strong = await setup('high-tier-strong-combat');
  const seedEntry = async (fixture: Awaited<ReturnType<typeof setup>>, affixes: Record<string, number>) => {
    await fixture.repository.transaction(fixture.id, 0, { eventType: 'test_seed_high_tier_combat_profile', payload: {}, at: base }, (draft) => {
      draft.realmId = 'nascent_soul';
      draft.collection.collectionMarks = 10;
      draft.resources.pill.amount = 100;
      draft.equipmentInstances['equipment.iron_saber.initial'].affixes = affixes;
    });
  };
  await seedEntry(weak, {});
  await seedEntry(strong, { attack: 610, defence: 192.5, health: 1850 });

  const weakPreview = await weak.service.previewHighTier(weak.id, 'nascent_soul', { now: base });
  const strongPreview = await strong.service.previewHighTier(strong.id, 'nascent_soul', { now: base });
  assert.equal(weakPreview.data.gate.status, 'open');
  assert.equal(strongPreview.data.gate.status, 'open');
  assert.ok(weakPreview.data.targetClearTime > 11);
  assert.ok(strongPreview.data.targetClearTime < 11);

  const weakStart = await weak.service.startHighTier({ playerId: weak.id, realm: 'nascent_soul', seed: 31, expectedRevision: 1, now: base });
  const weakResult = await weak.service.settleHighTier({ playerId: weak.id, attemptId: weakStart.data.attemptId, expectedRevision: 2, now: at(11) });
  assert.equal(weakResult.data.status, 'failed');
  assert.equal(weakResult.data.failureReason, 'player_defeated');

  const strongStart = await strong.service.startHighTier({ playerId: strong.id, realm: 'nascent_soul', seed: 31, expectedRevision: 1, now: base });
  const strongAttempt = (await strong.repository.getPlayer(strong.id)).highTierAttempts[strongStart.data.attemptId];
  assert.ok(strongStart.data.targetClearTime < 11);
  await strong.repository.transaction(strong.id, 2, { eventType: 'test_research_after_high_tier_start', payload: {}, at: base }, (draft) => {
    draft.collection.techniqueLayers['technique.mortal.qing_feng'] = 100;
    draft.equipmentInstances['equipment.iron_saber.initial'].affixes = {};
  });
  const strongResult = await strong.service.settleHighTier({ playerId: strong.id, attemptId: strongStart.data.attemptId, expectedRevision: 3, now: at(strongStart.data.targetClearTime) });
  assert.equal(strongResult.data.status, 'succeeded');
  assert.equal(strongResult.data.failureReason, null);
  assert.deepEqual(strongResult.data.skill, strongStart.data.skill);
  assert.deepEqual(strongAttempt.skill, strongStart.data.skill);
  assert.equal(strongResult.data.combatSnapshot.attack, strongAttempt.combatSnapshot?.attack);
  assert.equal((await strong.repository.getPlayer(strong.id)).highTierAttempts[strongStart.data.attemptId].combatSnapshot?.attack, strongAttempt.combatSnapshot?.attack);
});

test('high-tier settle commit failure rolls back pill, rewards, attempt and revision', async () => {
  const { repository, service, id } = await setup('high-tier-rollback');
  await repository.transaction(id, 0, { eventType: 'test_seed_high_tier_rollback', payload: {}, at: base }, (draft) => {
    draft.realmId = 'nascent_soul';
    draft.collection.collectionMarks = 10;
    draft.resources.pill.amount = 100;
    draft.equipmentInstances['equipment.iron_saber.initial'].affixes = { attack: 245, defence: 192.5, health: 1850 };
  });
  const start = await service.startHighTier({ playerId: id, realm: 'nascent_soul', seed: 123, expectedRevision: 1, now: base });
  const before = await repository.getPlayer(id);
  assert.equal(before.highTierAttempts[start.data.attemptId].skillSuppressedSeconds, 0);
  repository.injectCommitFailure();
  await assert.rejects(() => service.settleHighTier({ playerId: id, attemptId: start.data.attemptId, expectedRevision: 2, now: at(start.data.targetClearTime) }), (error: unknown) => error instanceof ApiError && error.code === 'INTERNAL_ROLLBACK');
  assert.deepEqual(await repository.getPlayer(id), before);
});

test('high-tier expedition supplies all six resources at the configured hourly rates', async () => {
  const realms = ['nascent_soul', 'divine_transformation', 'void_refining', 'body_unity', 'great_vehicle', 'tribulation'] as const;
  const resources = ['spirit_stone', 'pill', 'ancient_scroll', 'demon_core', 'millennium_herb', 'meteor_iron'] as const;
  for (const realm of realms) {
    const { repository, service, id } = await setup(`high-tier-expedition-${realm}`);
    await repository.transaction(id, 0, { eventType: 'test_seed_high_tier_expedition', payload: {}, at: base }, (draft) => {
      draft.realmId = realm;
      for (const resource of resources) { draft.resources[resource].amount = 0; draft.resources[resource].capacity = 1_000_000; }
    });
    const action = await service.startAction({ playerId: id, actionId: `high_tier_expedition:${realm}`, expectedRevision: 1, now: base });
    const result = await service.offlineSettlement({ playerId: id, settlementId: `high-tier-expedition-settlement-${realm}`, requestedStartedAt: base.toISOString(), requestedEndedAt: at(3600).toISOString(), expectedRevision: action.stateRevision, now: at(3600) });
    for (const resource of resources) assert.ok(Math.abs((result.data.resourceDelta[resource] ?? 0) - Number(FROZEN_PARAMETERS[`dungeon.high_tier.${realm}.${resource}_per_hour`].value)) < 1e-12);
    assert.equal(result.data.settledSeconds, 3600);
  }
});

test('high-tier expedition unlocks the current realm inventory capacity before supply starts', async () => {
  const { repository, service, id } = await setup('high-tier-expedition-capacity-unlock');
  await repository.transaction(id, 0, { eventType: 'test_seed_high_tier_expedition_capacity', payload: {}, at: base }, (draft) => { draft.realmId = 'nascent_soul'; });
  const before = await repository.getPlayer(id);
  assert.equal(before.resources.spirit_stone.capacity, 25_000);
  const action = await service.startAction({ playerId: id, actionId: 'high_tier_expedition:nascent_soul', expectedRevision: 1, now: base });
  const started = await repository.getPlayer(id);
  assert.equal(started.resources.spirit_stone.capacity, 100_000);
  assert.equal(started.resources.ancient_scroll.capacity, 400);
  const result = await service.offlineSettlement({ playerId: id, settlementId: 'high-tier-expedition-capacity-settlement', requestedStartedAt: base.toISOString(), requestedEndedAt: at(3600).toISOString(), expectedRevision: action.stateRevision, now: at(3600) });
  assert.equal(result.data.overflow.spirit_stone, undefined);
  assert.equal((await repository.getPlayer(id)).resources.spirit_stone.amount, 5_620 + Number(FROZEN_PARAMETERS['dungeon.high_tier.nascent_soul.spirit_stone_per_hour'].value));
});

test('high-tier expedition preserves fractional resource output across settlements', async () => {
  const { repository, service, id } = await setup('high-tier-expedition-fractional');
  await repository.transaction(id, 0, { eventType: 'test_seed_high_tier_expedition_fractional', payload: {}, at: base }, (draft) => {
    draft.realmId = 'nascent_soul';
    for (const resource of ['spirit_stone', 'pill', 'ancient_scroll', 'demon_core', 'millennium_herb', 'meteor_iron'] as const) { draft.resources[resource].amount = 0; draft.resources[resource].capacity = 1_000_000; }
  });
  const action = await service.startAction({ playerId: id, actionId: 'high_tier_expedition:nascent_soul', expectedRevision: 1, now: base });
  const first = await service.offlineSettlement({ playerId: id, settlementId: 'high-tier-expedition-fractional-1', requestedStartedAt: base.toISOString(), requestedEndedAt: at(1800).toISOString(), expectedRevision: action.stateRevision, now: at(1800) });
  const second = await service.offlineSettlement({ playerId: id, settlementId: 'high-tier-expedition-fractional-2', requestedStartedAt: base.toISOString(), requestedEndedAt: at(3600).toISOString(), expectedRevision: first.stateRevision, now: at(3600) });
  const state = await repository.getPlayer(id);
  assert.equal(first.data.resourceDelta.pill, Number(FROZEN_PARAMETERS['dungeon.high_tier.nascent_soul.pill_per_hour'].value) / 2);
  assert.equal(second.data.resourceDelta.pill, Number(FROZEN_PARAMETERS['dungeon.high_tier.nascent_soul.pill_per_hour'].value) / 2);
  assert.equal(state.resources.pill.amount, Number(FROZEN_PARAMETERS['dungeon.high_tier.nascent_soul.pill_per_hour'].value));
});

test('high-tier expedition applies capacity overflow and is blocked by realm or active Boss attempt', async () => {
  const { repository, service, id } = await setup('high-tier-expedition-gates');
  await assert.rejects(() => service.startAction({ playerId: id, actionId: 'high_tier_expedition:nascent_soul', expectedRevision: 0, now: base }), (error: unknown) => error instanceof ApiError && error.code === 'GATE_BLOCKED');
  await repository.transaction(id, 0, { eventType: 'test_seed_high_tier_expedition_gate', payload: {}, at: base }, (draft) => {
    draft.realmId = 'nascent_soul';
    draft.collection.collectionMarks = 10;
    draft.resources.spirit_stone.amount = 0;
    draft.resources.spirit_stone.capacity = 10;
    for (const resource of ['pill', 'ancient_scroll', 'demon_core', 'millennium_herb', 'meteor_iron'] as const) { draft.resources[resource].amount = 0; draft.resources[resource].capacity = 1_000_000; }
  });
  const action = await service.startAction({ playerId: id, actionId: 'high_tier_expedition:nascent_soul', expectedRevision: 1, now: base });
  await repository.transaction(id, action.stateRevision, { eventType: 'test_force_small_capacity', payload: {}, at: base }, (draft) => { draft.resources.spirit_stone.capacity = 10; });
  const settled = await service.offlineSettlement({ playerId: id, settlementId: 'high-tier-expedition-overflow', requestedStartedAt: base.toISOString(), requestedEndedAt: at(3600).toISOString(), expectedRevision: action.stateRevision + 1, now: at(3600) });
  assert.equal(settled.data.resourceDelta.spirit_stone, 10);
  assert.equal(settled.data.overflow.spirit_stone, Number(FROZEN_PARAMETERS['dungeon.high_tier.nascent_soul.spirit_stone_per_hour'].value) - 10);

  const stopped = await service.stopAction({ playerId: id, settlementId: 'high-tier-expedition-gates-stop', requestedStartedAt: at(3600).toISOString(), requestedEndedAt: at(3600).toISOString(), expectedRevision: settled.stateRevision, now: at(3600) });
  const boss = await service.startHighTier({ playerId: id, realm: 'nascent_soul', expectedRevision: stopped.stateRevision, now: at(3600) });
  await assert.rejects(() => service.startAction({ playerId: id, actionId: 'high_tier_expedition:nascent_soul', expectedRevision: boss.stateRevision, now: at(3601) }), (error: unknown) => error instanceof ApiError && error.code === 'VALIDATION_FAILED');
});

test('high-tier expedition settlement is idempotent and rolls back on commit failure', async () => {
  const { repository, service, id } = await setup('high-tier-expedition-rollback');
  await repository.transaction(id, 0, { eventType: 'test_seed_high_tier_expedition_rollback', payload: {}, at: base }, (draft) => {
    draft.realmId = 'nascent_soul';
    for (const resource of ['spirit_stone', 'pill', 'ancient_scroll', 'demon_core', 'millennium_herb', 'meteor_iron'] as const) { draft.resources[resource].amount = 0; draft.resources[resource].capacity = 1_000_000; }
  });
  const action = await service.startAction({ playerId: id, actionId: 'high_tier_expedition:nascent_soul', expectedRevision: 1, now: base });
  const before = await repository.getPlayer(id);
  repository.injectCommitFailure();
  await assert.rejects(() => service.offlineSettlement({ playerId: id, settlementId: 'high-tier-expedition-rollback', requestedStartedAt: base.toISOString(), requestedEndedAt: at(3600).toISOString(), expectedRevision: action.stateRevision, now: at(3600) }), (error: unknown) => error instanceof ApiError && error.code === 'INTERNAL_ROLLBACK');
  assert.deepEqual(await repository.getPlayer(id), before);
  const result = await service.offlineSettlement({ playerId: id, settlementId: 'high-tier-expedition-retry', requestedStartedAt: base.toISOString(), requestedEndedAt: at(3600).toISOString(), expectedRevision: action.stateRevision, now: at(3600) });
  const repeated = await service.offlineSettlement({ playerId: id, settlementId: 'high-tier-expedition-retry', requestedStartedAt: base.toISOString(), requestedEndedAt: at(3600).toISOString(), expectedRevision: 999, now: at(3601) });
  assert.deepEqual(repeated, result);
});

test('all three dungeon Boss profiles settle through barrier, phase, stun, spirit burn and pill rules', async () => {
  const cases = [
    { dungeonId: 'qing_feng' as const, target: 600, entryPillCost: 2, bossAutoPillCost: 2, pillCost: 4, stuns: 27, burns: 64 },
    { dungeonId: 'yan_prison' as const, target: 1200, entryPillCost: 5, bossAutoPillCost: 18, pillCost: 23, stuns: 57, burns: 144 },
    { dungeonId: 'sky_abyss' as const, target: 2400, entryPillCost: 10, bossAutoPillCost: 84, pillCost: 94, stuns: 117, burns: 304 },
  ];
  for (const item of cases) {
    const { repository, service, id } = await setup(`dungeon-profile-${item.dungeonId}`);
    await repository.transaction(id, 0, { eventType: 'test_seed_dungeon_profile', payload: {}, at: base }, (draft) => { draft.resources.pill.amount = 100; });
    const start = await service.startDungeon({ playerId: id, dungeonId: item.dungeonId, seed: 42, expectedRevision: 1, now: base });
    assert.equal(start.data.barrier > 0, true);
    const result = await service.settleDungeon({ playerId: id, attemptId: start.data.attemptId, expectedRevision: 2, now: at(item.target) });
    assert.equal(result.data.status, 'succeeded');
    assert.equal(result.data.barrier, 0);
    assert.equal(result.data.phase, 2);
    assert.equal(result.data.stunSeconds, item.stuns);
    assert.equal(result.data.spiritBurnSeconds, item.burns);
    assert.equal(result.data.bossDamageMultiplier, 1.2);
    assert.equal(result.data.entryPillCost, item.entryPillCost);
    assert.equal(result.data.bossAutoPillCost, item.bossAutoPillCost);
    assert.equal(result.data.pillCost, item.pillCost);
  }
});

test('GameService emits metrics at committed and rejected boundaries', async () => {
  const metrics = new MetricsCollector({ clock: () => base.getTime() });
  const repository = new MemoryRepository();
  const service = new GameService(repository, () => base, CONFIG_VERSION, undefined, metrics);
  const id = 'metrics-service-player';
  await service.createPlayer(id, base);
  await service.startAction({ playerId: id, actionId: 'training', expectedRevision: 0, now: base });
  const settled = await service.offlineSettlement({ playerId: id, settlementId: 'metrics-settlement-1', requestedStartedAt: base.toISOString(), requestedEndedAt: at(60).toISOString(), expectedRevision: 1, now: at(60) });
  assert.equal(settled.stateRevision, 2);
  await service.offlineSettlement({ playerId: id, settlementId: 'metrics-settlement-1', requestedStartedAt: base.toISOString(), requestedEndedAt: at(60).toISOString(), expectedRevision: 999, now: at(61) });
  await assert.rejects(() => service.offlineSettlement({ playerId: id, settlementId: 'metrics-settlement-stale', requestedStartedAt: base.toISOString(), requestedEndedAt: at(60).toISOString(), expectedRevision: 1, now: at(61) }), (error: unknown) => error instanceof ApiError && error.code === 'STALE_REVISION');
  const mapPlayer = 'metrics-map-player';
  await service.createPlayer(mapPlayer, base);
  await service.startAction({ playerId: mapPlayer, actionId: 'bai_cao_valley', expectedRevision: 0, now: at(60) });
  await service.offlineSettlement({ playerId: mapPlayer, settlementId: 'metrics-map-1', requestedStartedAt: at(60).toISOString(), requestedEndedAt: at(90).toISOString(), expectedRevision: 1, now: at(90) });
  await repository.transaction(id, 2, { eventType: 'metrics-seed-equipment', payload: {}, at: base }, (draft) => { draft.resources.spirit_wood.amount = 10; });
  await service.equipmentAction({ playerId: id, instanceId: 'equipment.iron_saber.initial', action: 'reinforce', expectedRevision: 3, now: base });

  const failurePlayer = 'metrics-dungeon-failure';
  await service.createPlayer(failurePlayer, base);
  const dungeonStart = await service.startDungeon({ playerId: failurePlayer, dungeonId: 'qing_feng', seed: 11, expectedRevision: 0, now: base });
  await service.settleDungeon({ playerId: failurePlayer, attemptId: dungeonStart.data.attemptId, expectedRevision: 1, now: at(601) });
  await assert.rejects(() => service.startDungeon({ playerId: failurePlayer, dungeonId: 'qing_feng', expectedRevision: 2, now: at(602) }), (error: unknown) => error instanceof ApiError && error.code === 'COOLDOWN_ACTIVE');

  const successPlayer = 'metrics-dungeon-success';
  await service.createPlayer(successPlayer, base);
  await repository.transaction(successPlayer, 0, { eventType: 'metrics-seed-dungeon', payload: {}, at: base }, (draft) => { draft.resources.pill.amount = 100; draft.resources.millennium_herb.amount = draft.resources.millennium_herb.capacity; draft.dungeonPity.qing_feng.millenniumHerb = 9; });
  const successStart = await service.startDungeon({ playerId: successPlayer, dungeonId: 'qing_feng', seed: 12, expectedRevision: 1, now: base });
  await service.settleDungeon({ playerId: successPlayer, attemptId: successStart.data.attemptId, expectedRevision: 2, now: at(600) });

  const snapshot = metrics.snapshot();
  assert.equal(snapshot.settlements.success, 2);
  assert.equal(snapshot.settlements.duplicate, 1);
  assert.equal(snapshot.settlements.stale, 1);
  assert.equal(snapshot.map.success, 1);
  assert.equal(snapshot.dungeon.success, 1);
  assert.equal(snapshot.dungeon.failure, 1);
  assert.equal(snapshot.dungeon.cooldown, 1);
  assert.equal(snapshot.equipmentGrowth.reinforce, 1);
  assert.equal(snapshot.resources.millennium_herb.overflow, 1);
});
