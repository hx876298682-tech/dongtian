import assert from 'node:assert/strict';
import test from 'node:test';
import { CONTENT_PACKAGE, diagnoseContentReachability, diagnoseMapEquipmentReleaseReadiness, hashContent, validateContentPackage } from './content-schema.ts';
import { FROZEN_PARAMETERS } from '../game/frozen-parameters.ts';
import { ApiError, CONFIG_VERSION } from '../server/types.ts';
import { MemoryRepository, makeInitialPlayer } from '../server/repository.ts';
import { GameService } from '../server/service.ts';

test('frozen content package validates required IDs, parameter references and hashes', () => {
  const content = validateContentPackage(CONTENT_PACKAGE);
  assert.equal(content.manifest.config_version, CONFIG_VERSION);
  assert.deepEqual(content.maps.map((map) => map.id), ['bai_cao_valley', 'black_wind_valley', 'red_flame_cave']);
  assert.equal(new Set(content.equipment.map((item) => item.id)).size, content.equipment.length);
});

test('map equipment binding validates when supplied and rejects unknown templates', () => {
  const packageWithBinding = structuredClone(CONTENT_PACKAGE);
  packageWithBinding.maps[0].equipment_drop = { template_ids: [packageWithBinding.equipment[0].id] };
  packageWithBinding.manifest.content_sha256 = hashContent(packageWithBinding.maps, packageWithBinding.equipment, packageWithBinding.recipes);
  assert.doesNotThrow(() => validateContentPackage(packageWithBinding));
  const invalid = structuredClone(packageWithBinding);
  invalid.maps[0].equipment_drop = { template_ids: ['missing-template'] };
  invalid.manifest.content_sha256 = hashContent(invalid.maps, invalid.equipment, invalid.recipes);
  assert.throws(() => validateContentPackage(invalid), (error: unknown) => error instanceof ApiError && error.code === 'VALIDATION_FAILED');
});

test('equipment template schema accepts all six launch slots and rejects unknown slots', () => {
  const slots = ['weapon', 'armor_1', 'armor_2', 'armor_3', 'armor_4', 'accessory'] as const;
  const valid = structuredClone(CONTENT_PACKAGE);
  const baseTemplate = structuredClone(valid.equipment[0]);
  valid.equipment = slots.map((slot, index) => ({ ...baseTemplate, id: `slot-contract-${index}`, slot }));
  valid.maps = valid.maps.map((map) => ({ ...map, equipment_drop: { template_ids: valid.equipment.map((item) => item.id) } }));
  valid.manifest.content_sha256 = hashContent(valid.maps, valid.equipment, valid.recipes);
  assert.doesNotThrow(() => validateContentPackage(valid));
  const invalid = structuredClone(valid);
  (invalid.equipment[0] as { slot: string }).slot = 'armor_5';
  invalid.manifest.content_sha256 = hashContent(invalid.maps, invalid.equipment, invalid.recipes);
  assert.throws(() => validateContentPackage(invalid), (error: unknown) => error instanceof ApiError && error.code === 'VALIDATION_FAILED');
});

test('content package keeps high-tier combat out of content payload and delegates it to parameter schema', () => {
  assert.equal(Object.prototype.hasOwnProperty.call(CONTENT_PACKAGE, 'highTierCombat'), false);
  assert.equal(CONTENT_PACKAGE.manifest.status, 'frozen_v1');
});

test('content config version mismatch is rejected', () => {
  const invalid = structuredClone(CONTENT_PACKAGE);
  invalid.manifest.config_version = '2.0.0';
  assert.throws(() => validateContentPackage(invalid), (error: unknown) => error instanceof ApiError && error.code === 'CONFIG_VERSION_MISMATCH');
});

test('content hash mismatch and duplicate IDs are rejected', () => {
  const invalidHash = structuredClone(CONTENT_PACKAGE);
  invalidHash.manifest.content_sha256 = 'bad';
  assert.throws(() => validateContentPackage(invalidHash), (error: unknown) => error instanceof ApiError && error.code === 'VALIDATION_FAILED');
  const duplicate = structuredClone(CONTENT_PACKAGE);
  duplicate.maps.push(structuredClone(duplicate.maps[0]));
  assert.throws(() => validateContentPackage(duplicate), (error: unknown) => error instanceof ApiError && error.code === 'VALIDATION_FAILED');
});

test('manifest must enumerate exactly the content files loaded by the package', () => {
  const invalid = structuredClone(CONTENT_PACKAGE);
  invalid.manifest.content_files = ['maps.json', 'equipment.json', 'untracked.json'];
  assert.throws(() => validateContentPackage(invalid), (error: unknown) => error instanceof ApiError && error.code === 'VALIDATION_FAILED');
});

test('content_pending is allowed only while unreachable and is diagnosed when a route binds it', () => {
  const pending = structuredClone(CONTENT_PACKAGE);
  pending.equipment[0].status = 'content_pending';
  pending.maps = pending.maps.map((map) => ({ ...map, equipment_drop: { template_ids: map.equipment_drop?.template_ids?.filter((id) => id !== pending.equipment[0].id) ?? [] } }));
  assert.deepEqual(diagnoseContentReachability(pending), []);
  pending.maps[0].equipment_drop = { template_ids: [pending.equipment[0].id] };
  pending.manifest.content_sha256 = hashContent(pending.maps, pending.equipment, pending.recipes);
  assert.throws(() => validateContentPackage(pending), (error: unknown) => error instanceof ApiError && error.code === 'VALIDATION_FAILED');
  const diagnostics = diagnoseContentReachability(pending);
  assert.deepEqual(diagnostics, [{ path: `equipment.${pending.equipment[0].id}.status`, code: 'CONTENT_PENDING', message: 'pending equipment templates cannot be used by a map drop binding' }]);
});

test('content hash is stable when PostgreSQL jsonb reorders object keys', () => {
  const reverseKeys = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(reverseKeys);
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value as Record<string, unknown>).reverse().map(([key, item]) => [key, reverseKeys(item)]));
    return value;
  };
  const roundTripped = reverseKeys(structuredClone(CONTENT_PACKAGE)) as typeof CONTENT_PACKAGE;
  assert.doesNotThrow(() => validateContentPackage(roundTripped));
});

test('formal equipment metadata is accepted only with registered resource and content registries', () => {
  const content = structuredClone(CONTENT_PACKAGE);
  const item = content.equipment[0];
  content.equipment = [item];
  content.maps = content.maps.map((map) => ({ ...map, equipment_drop: { template_ids: [item.id] } }));
  item.name_pool_id = 'name_pool.mvp.weapon.fine';
  item.icon_asset_id = 'asset.placeholder.mvp.weapon.fine';
  item.appearance_tag_ids = ['appearance.mvp'];
  item.stat_template_id = 'stat_template.weapon.v1';
  item.source_map_ids = ['bai_cao_valley'];
  content.manifest.schema_version = '1.1';
  content.manifest.name_pool_ids = [item.name_pool_id];
  content.manifest.appearance_tag_ids = ['appearance.mvp'];
  content.manifest.stat_template_ids = ['stat_template.weapon.v1'];
  content.manifest.asset_manifest = [{ id: item.icon_asset_id, kind: 'equipment_icon', status: 'placeholder_v1', source: 'mvp-placeholder-no-ui-default', sha256: '0'.repeat(64) }];
  content.manifest.content_sha256 = hashContent(content.maps, content.equipment, content.recipes);
  assert.doesNotThrow(() => validateContentPackage(content));
  const invalid = structuredClone(content);
  invalid.manifest.asset_manifest = [];
  assert.throws(() => validateContentPackage(invalid), (error: unknown) => error instanceof ApiError && error.code === 'VALIDATION_FAILED');
});

test('formal equipment metadata rejects pending placeholders and unknown references', () => {
  const content = structuredClone(CONTENT_PACKAGE);
  const item = content.equipment[0];
  content.equipment = [item];
  item.name_pool_id = 'name_pool.mvp.weapon.fine';
  item.icon_asset_id = 'asset.placeholder.mvp.weapon.fine';
  item.appearance_tag_ids = ['appearance.mvp'];
  item.stat_template_id = 'stat_template.weapon.v1';
  item.source_map_ids = ['bai_cao_valley'];
  item.status = 'content_pending';
  content.manifest.schema_version = '1.1';
  content.manifest.name_pool_ids = [item.name_pool_id];
  content.manifest.appearance_tag_ids = ['appearance.mvp'];
  content.manifest.stat_template_ids = ['stat_template.weapon.v1'];
  content.manifest.asset_manifest = [{ id: item.icon_asset_id, kind: 'equipment_icon', status: 'placeholder_v1', source: 'mvp-placeholder-no-ui-default', sha256: '0'.repeat(64) }];
  content.manifest.content_sha256 = hashContent(content.maps, content.equipment, content.recipes);
  assert.throws(() => validateContentPackage(content), (error: unknown) => error instanceof ApiError && error.code === 'VALIDATION_FAILED');
  item.status = undefined;
  item.icon_asset_id = 'asset.missing';
  content.manifest.content_sha256 = hashContent(content.maps, content.equipment, content.recipes);
  assert.throws(() => validateContentPackage(content), (error: unknown) => error instanceof ApiError && error.code === 'VALIDATION_FAILED');
});

test('content schema accepts a versioned parameter manifest when the expected hash is supplied', () => {
  const parameterSha256 = 'a'.repeat(64);
  const versioned = structuredClone(CONTENT_PACKAGE);
  versioned.manifest.config_version = '1.0.1-runtime';
  versioned.manifest.parameter_sha256 = parameterSha256;
  assert.doesNotThrow(() => validateContentPackage(versioned, '1.0.1-runtime', parameterSha256));
  assert.throws(() => validateContentPackage(versioned, '1.0.1-runtime'), (error: unknown) => error instanceof ApiError && error.code === 'CONFIG_VERSION_MISMATCH');
});

test('ordinary-map equipment release readiness accepts the complete approved content package', () => {
  const diagnostics = diagnoseMapEquipmentReleaseReadiness(CONTENT_PACKAGE, FROZEN_PARAMETERS);
  assert.equal(diagnostics.filter((item) => item.code === 'MISSING_CONTENT_BINDING').length, 0);
  assert.equal(diagnostics.some((item) => item.code === 'RUNTIME_NOT_IMPLEMENTED'), false, 'content readiness does not hide the separate runtime gate');
});

test('ordinary-map equipment readiness reports no missing launch slots for the approved package', () => {
  const content = structuredClone(CONTENT_PACKAGE);
  const parameters = structuredClone(FROZEN_PARAMETERS);
  content.maps[0].equipment_drop = { template_ids: content.equipment.slice(0, 6).map((item) => item.id) };
  const diagnostics = diagnoseMapEquipmentReleaseReadiness(content, parameters);
  const missingSlots = diagnostics.filter((item) => item.code === 'MISSING_TEMPLATE_FOR_SLOT');
  assert.deepEqual(missingSlots, []);
});

test('bootstrap validates the content package before returning a snapshot', async () => {
  const repository = new MemoryRepository();
  repository.createPlayer(makeInitialPlayer('content-player', new Date('2026-01-01T00:00:00.000Z')));
  const invalid = structuredClone(CONTENT_PACKAGE);
  invalid.manifest.parameter_sha256 = 'bad';
  const service = new GameService(repository, () => new Date('2026-01-01T00:00:01.000Z'), CONFIG_VERSION, invalid);
  await assert.rejects(() => service.bootstrap('content-player'), (error: unknown) => error instanceof ApiError && error.code === 'CONFIG_VERSION_MISMATCH');
});

test('runtime does not expose or start a content_pending map', async () => {
  const repository = new MemoryRepository();
  const player = makeInitialPlayer('pending-map-player', new Date('2026-01-01T00:00:00.000Z'));
  repository.createPlayer(player);
  const content = structuredClone(CONTENT_PACKAGE);
  content.maps[0].status = 'content_pending';
  content.manifest.content_sha256 = hashContent(content.maps, content.equipment, content.recipes);
  const service = new GameService(repository, () => new Date('2026-01-01T00:00:01.000Z'), CONFIG_VERSION, content);
  const bootstrap = await service.bootstrap(player.playerId);
  assert.deepEqual(bootstrap.data.availableActions, ['training', 'black_wind_valley', 'red_flame_cave']);
  await assert.rejects(() => service.startAction({ playerId: player.playerId, actionId: 'bai_cao_valley', expectedRevision: player.stateRevision, now: new Date('2026-01-01T00:00:01.000Z') }), (error: unknown) => error instanceof ApiError && error.code === 'CONTENT_LOCKED');
  const legacyPlayer = makeInitialPlayer('pending-map-settlement-player', new Date('2026-01-01T00:00:00.000Z'));
  legacyPlayer.primaryAction = { actionId: 'bai_cao_valley', startedAt: '2026-01-01T00:00:00.000Z', carrySeconds: 0 };
  repository.createPlayer(legacyPlayer);
  await assert.rejects(() => service.offlineSettlement({ playerId: legacyPlayer.playerId, settlementId: 'pending-map-settlement', requestedStartedAt: '2026-01-01T00:00:00.000Z', requestedEndedAt: '2026-01-01T00:00:01.000Z', expectedRevision: legacyPlayer.stateRevision, now: new Date('2026-01-01T00:00:01.000Z') }), (error: unknown) => error instanceof ApiError && error.code === 'CONTENT_LOCKED');
});
