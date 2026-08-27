import assert from 'node:assert/strict';
import test from 'node:test';
import { CONTENT_PACKAGE, hashContent } from '../content/content-schema.ts';
import { FROZEN_PARAMETER_SHA256, FROZEN_PARAMETERS } from '../game/frozen-parameters.ts';
import { ConfigReleaseError, ConfigReleaseRegistry } from './config-release.ts';
import { HIGH_TIER_COMBAT_MODE_PARAMETER, HIGH_TIER_FULL_MODE, HIGH_TIER_REALMS } from './high-tier-contract.ts';

const contentFor = (version: string) => ({ ...CONTENT_PACKAGE, manifest: { ...CONTENT_PACKAGE.manifest, config_version: version } });
const inputFor = (version: string) => ({ version, parameterSha256: FROZEN_PARAMETER_SHA256, contentSha256: CONTENT_PACKAGE.manifest.content_sha256, content: contentFor(version) });

test('release registry validates, canaries and activates versioned content', () => {
  const registry = new ConfigReleaseRegistry({ clock: () => Date.parse('2026-01-01T00:00:00.000Z') });
  const draft = registry.registerDraft(inputFor('1.0.1-canary'));
  assert.equal(draft.status, 'draft');
  assert.equal(registry.validate(draft.version).status, 'validated');
  assert.equal(registry.startCanary(draft.version, 25).canaryPercent, 25);
  assert.equal(registry.get(draft.version)?.status, 'canary');
  assert.equal(registry.servesPlayer(draft.version, 'player-1'), registry.servesPlayer(draft.version, 'player-1'));
  assert.equal(registry.activate(draft.version).status, 'active');
  assert.equal(registry.current()?.version, draft.version);
  assert.equal(registry.servesPlayer(draft.version, 'any-player'), true);
  assert.ok(registry.getActiveSnapshot()?.parameters['core.time.seconds_per_hour']);
});

test('ordinary-map equipment release gate accepts the complete approved package', () => {
  const registry = new ConfigReleaseRegistry();
  const release = registry.registerDraft(inputFor('1.0.1-map-equipment-not-ready'));
  assert.doesNotThrow(() => registry.validateOrdinaryMapEquipment(release.version));
  assert.equal(registry.get(release.version)?.status, 'draft');
});

test('release lifecycle rejects reachable content_pending objects after content hash is updated', () => {
  const registry = new ConfigReleaseRegistry();
  const content = structuredClone(CONTENT_PACKAGE);
  content.manifest.config_version = '1.0.1-pending-content';
  content.maps[0].status = 'content_pending';
  content.manifest.content_sha256 = hashContent(content.maps, content.equipment, content.recipes);
  assert.throws(() => registry.registerDraft({ version: '1.0.1-pending-content', parameterSha256: FROZEN_PARAMETER_SHA256, contentSha256: content.manifest.content_sha256, content }), (error: unknown) => {
    if (!(error instanceof ConfigReleaseError) || error.code !== 'RELEASE_INVALID') return false;
    const details = error.details as { contract?: string; diagnostics?: Array<{ path: string; code: string }> } | undefined;
    return details?.contract === 'content_reachability' && details.diagnostics?.some((item) => item.path === 'maps.bai_cao_valley.status' && item.code === 'CONTENT_PENDING') === true;
  });
});

test('release registry resolves one stable canary snapshot per player and preserves historical snapshots', () => {
  const registry = new ConfigReleaseRegistry({ clock: () => Date.parse('2026-01-01T00:00:00.000Z') });
  registry.registerDraft(inputFor('1.0.0-active')); registry.validate('1.0.0-active'); registry.activate('1.0.0-active');
  registry.registerDraft(inputFor('1.0.1-canary')); registry.validate('1.0.1-canary'); registry.startCanary('1.0.1-canary', 100);
  const first = registry.getSnapshotForPlayer('player-stable');
  const second = registry.getSnapshotForPlayer('player-stable');
  assert.equal(first?.version, '1.0.1-canary');
  assert.equal(second?.version, first?.version);
  assert.equal(registry.getSnapshot('1.0.0-active')?.version, '1.0.0-active');
  registry.activate('1.0.1-canary');
  assert.equal(registry.getSnapshot('1.0.0-active')?.version, '1.0.0-active');
});

test('release registry records operator metadata for lifecycle transitions', () => {
  const registry = new ConfigReleaseRegistry({ clock: () => Date.parse('2026-01-01T00:00:00.000Z') });
  registry.registerDraft(inputFor('1.0.9-active')); registry.validate('1.0.9-active'); registry.activate('1.0.9-active', { operatorSubject: 'admin-1', reason: 'initial release' });
  registry.registerDraft(inputFor('1.0.10-canary')); registry.validate('1.0.10-canary'); registry.startCanary('1.0.10-canary', 25, { operatorSubject: 'admin-1', reason: 'canary rollout' });
  assert.deepEqual(registry.listAudits().map(({ operation, targetVersion, fromVersion, toVersion, operatorSubject, reason }) => ({ operation, targetVersion, fromVersion, toVersion, operatorSubject, reason })), [
    { operation: 'activate', targetVersion: '1.0.9-active', fromVersion: null, toVersion: '1.0.9-active', operatorSubject: 'admin-1', reason: 'initial release' },
    { operation: 'canary', targetVersion: '1.0.10-canary', fromVersion: '1.0.9-active', toVersion: '1.0.9-active', operatorSubject: 'admin-1', reason: 'canary rollout' },
  ]);
});

test('release registry replays rollout operation responses by idempotency key', () => {
  const registry = new ConfigReleaseRegistry({ clock: () => 0 });
  const active = registry.registerDraft(inputFor('1.0.11-operation-active'));
  registry.validate(active.version);
  registry.activate(active.version);
  const next = registry.registerDraft(inputFor('1.0.12-operation-next'));
  registry.validate(next.version);
  const command = { operation: 'activate' as const, version: next.version, idempotencyKey: 'admin:activate:retry-1', meta: { operatorSubject: 'admin', reason: 'promote next release' }, requestId: 'request-first', serverTime: '2026-01-01T00:00:00.000Z' };
  const first = registry.runOperation(command);
  const replay = registry.runOperation({ ...command, requestId: 'request-retry', serverTime: '2026-01-01T00:01:00.000Z', meta: { ...command.meta, reason: 'different reason' } });
  assert.deepEqual(replay, first);
  assert.equal(registry.listAudits().filter((audit) => audit.operation === 'activate').length, 1);
});

test('release registry validates rollout command metadata at the provider boundary', () => {
  const registry = new ConfigReleaseRegistry({ clock: () => 0 });
  assert.throws(() => registry.runOperation({ operation: 'activate', version: '1.0.0', idempotencyKey: 'key', meta: { operatorSubject: 'admin', reason: 'x' }, requestId: 'request', serverTime: '2026-01-01T00:00:00.000Z' }), (error: unknown) => error instanceof ConfigReleaseError && /reason/.test(error.message));
});

test('release input without parameters remains compatible with the frozen parameter snapshot', () => {
  const registry = new ConfigReleaseRegistry();
  const release = registry.registerDraft(inputFor('1.0.4'));
  assert.equal(release.parameters['core.time.seconds_per_hour']?.value, 3600);
});

test('release lifecycle rejects parameter values that violate the frozen payload schema', () => {
  const registry = new ConfigReleaseRegistry();
  const parameters = structuredClone(FROZEN_PARAMETERS) as Record<string, { value: unknown }>;
  parameters['core.time.seconds_per_hour'] = { value: '' };
  assert.throws(() => registry.registerDraft({ ...inputFor('1.0.4-invalid-empty-value'), parameters }), (error: unknown) => {
    if (!(error instanceof ConfigReleaseError) || error.code !== 'RELEASE_INVALID') return false;
    return /finite number/.test(error.message) && (error.details as { path?: string } | undefined)?.path === 'core.time.seconds_per_hour';
  });

  const nonFinite = structuredClone(FROZEN_PARAMETERS) as Record<string, { value: unknown }>;
  nonFinite['map.bai_cao_valley.target_kill_time'] = { value: Number.NaN };
  assert.throws(() => registry.registerDraft({ ...inputFor('1.0.4-invalid-nan'), parameters: nonFinite }), (error: unknown) => {
    if (!(error instanceof ConfigReleaseError) || error.code !== 'RELEASE_INVALID') return false;
    return /finite number/.test(error.message) && (error.details as { path?: string } | undefined)?.path === 'map.bai_cao_valley.target_kill_time';
  });
});

test('release lifecycle rejects random-event rows that drift from runtime semantics', () => {
  const registry = new ConfigReleaseRegistry();
  const parameters = structuredClone(FROZEN_PARAMETERS) as Record<string, { value: unknown }>;
  parameters['schedule.random_event.roll_interval_hours']!.value = 24;
  assert.throws(() => registry.registerDraft({ ...inputFor('1.0.4-invalid-random-event'), parameters }), (error: unknown) => {
    if (!(error instanceof ConfigReleaseError) || error.code !== 'RELEASE_INVALID') return false;
    const details = error.details as { contract?: string; diagnostics?: Array<{ path?: string }> } | undefined;
    return details?.contract === 'random_event' && details.diagnostics?.some((diagnostic) => diagnostic.path === 'schedule.random_event.roll_interval_hours') === true;
  });
});

test('release lifecycle rejects non-formal provenance on ordinary parameters', () => {
  const registry = new ConfigReleaseRegistry();
  const proposal = structuredClone(FROZEN_PARAMETERS) as Record<string, { value: unknown; [key: string]: unknown }>;
  proposal['map.bai_cao_valley.target_kill_time'].status = 'proposal_v1';
  assert.throws(() => registry.registerDraft({ ...inputFor('1.0.4-unpublishable-provenance'), parameters: proposal }), (error: unknown) => {
    if (!(error instanceof ConfigReleaseError) || error.code !== 'RELEASE_INVALID') return false;
    return (error.details as { path?: string } | undefined)?.path === 'map.bai_cao_valley.target_kill_time.status';
  });

  const missingSource = structuredClone(FROZEN_PARAMETERS) as Record<string, { value: unknown; [key: string]: unknown }>;
  missingSource['map.bai_cao_valley.target_kill_time'].source = '';
  assert.throws(() => registry.registerDraft({ ...inputFor('1.0.4-missing-provenance'), parameters: missingSource }), (error: unknown) => {
    if (!(error instanceof ConfigReleaseError) || error.code !== 'RELEASE_INVALID') return false;
    return (error.details as { path?: string } | undefined)?.path === 'map.bai_cao_valley.target_kill_time.source';
  });
});

test('release migration policy accepts supported modes and rejects malformed source lists', () => {
  const registry = new ConfigReleaseRegistry();
  const identity = registry.registerDraft({ ...inputFor('1.0.4-identity'), migrationPolicy: { mode: 'identity', fromVersions: ['1.0.3'] } });
  assert.deepEqual(identity.migrationPolicy, { mode: 'identity', fromVersions: ['1.0.3'] });
  const forward = registry.registerDraft({ ...inputFor('1.0.4-forward'), migrationPolicy: { mode: 'forward-compatible', fromVersions: ['1.0.3', '1.0.2'] } });
  assert.equal(forward.migrationPolicy?.mode, 'forward-compatible');
  assert.throws(() => registry.registerDraft({ ...inputFor('1.0.4-invalid-mode'), migrationPolicy: { mode: 'unsupported' as 'identity', fromVersions: ['1.0.3'] } }), (error: unknown) => error instanceof ConfigReleaseError && error.code === 'RELEASE_INVALID');
  assert.throws(() => registry.registerDraft({ ...inputFor('1.0.4-invalid-list'), migrationPolicy: { mode: 'identity', fromVersions: ['1.0.3', '1.0.3'] } }), (error: unknown) => error instanceof ConfigReleaseError && error.code === 'RELEASE_INVALID');
});

test('release registry accepts a versioned parameter manifest and payload', () => {
  const registry = new ConfigReleaseRegistry();
  const parameterSha256 = 'a'.repeat(64);
  const parameters = structuredClone(FROZEN_PARAMETERS) as Record<string, { value: unknown }>;
  parameters['map.bai_cao_valley.target_kill_time'] = { value: 17 };
  const content = { ...CONTENT_PACKAGE, manifest: { ...CONTENT_PACKAGE.manifest, config_version: '1.0.5-runtime', parameter_sha256: parameterSha256 } };
  const release = registry.registerDraft({ version: '1.0.5-runtime', parameterSha256, contentSha256: content.manifest.content_sha256, content, parameters });
  assert.equal(release.parameters['map.bai_cao_valley.target_kill_time']?.value, 17);
  assert.equal(registry.validate(release.version).status, 'validated');
});

test('release validation rejects an opt-in full high-tier mode without its combat contract diagnostics', () => {
  const registry = new ConfigReleaseRegistry();
  const parameters = structuredClone(FROZEN_PARAMETERS) as Record<string, { value: unknown }>;
  parameters[HIGH_TIER_COMBAT_MODE_PARAMETER] = { value: HIGH_TIER_FULL_MODE };
  assert.throws(() => registry.registerDraft({ ...inputFor('1.0.5-invalid-high-tier'), parameters }), (error: unknown) => {
    if (!(error instanceof ConfigReleaseError)) return false;
    assert.equal(error.code, 'RELEASE_INVALID');
    const details = error.details as { contract?: string; diagnostics?: Array<{ path: string }> } | undefined;
    return details?.contract === 'high_tier' && (details.diagnostics?.length ?? 0) > 0 && details.diagnostics?.some((item) => item.path.endsWith('.boss_attack')) === true;
  });
});

test('release lifecycle rejects a structurally valid full_v1 contract without formal provenance', () => {
  const registry = new ConfigReleaseRegistry();
  const parameters = structuredClone(FROZEN_PARAMETERS) as Record<string, { value: unknown; [key: string]: unknown }>;
  parameters[HIGH_TIER_COMBAT_MODE_PARAMETER] = { value: HIGH_TIER_FULL_MODE };
  for (const realm of HIGH_TIER_REALMS) {
    const prefix = `dungeon.high_tier.${realm}`;
    parameters[`${prefix}.boss_attack`] = { value: 100 };
    parameters[`${prefix}.boss_defence`] = { value: 100 };
    parameters[`${prefix}.boss_accuracy`] = { value: 100 };
    parameters[`${prefix}.boss_attack_interval_seconds`] = { value: 5 };
    parameters[`${prefix}.boss_element`] = { value: 'neutral' };
    parameters[`${prefix}.skills`] = { value: [{ id: 'signature', kind: 'output_suppression', cooldownSeconds: 300, durationSeconds: 2, magnitude: 15 }] };
    parameters[`${prefix}.resistances`] = { value: { controlPercent: 25, damageOverTimePercent: 30, outputSuppressionPercent: 0 } };
    parameters[`${prefix}.auto_pill`] = { value: { thresholdPercent: 40, healPerUse: 250, targetPercent: 80, maxUses: 20 } };
  }
  assert.throws(() => registry.registerDraft({ ...inputFor('1.0.5-unproven-full-high-tier'), parameters }), (error: unknown) => {
    if (!(error instanceof ConfigReleaseError) || error.code !== 'RELEASE_INVALID') return false;
    const details = error.details as { contract?: string; diagnostics?: Array<{ path: string; code: string }> } | undefined;
    return details?.contract === 'high_tier_provenance'
      && details.diagnostics?.some((item) => item.path === 'dungeon.high_tier.nascent_soul.boss_attack.status' && item.code === 'INVALID_VALUE') === true;
  });
});

test('hash and version mismatches cannot enter the registry', () => {
  const registry = new ConfigReleaseRegistry();
  assert.throws(() => registry.registerDraft({ ...inputFor('1.0.2'), content: contentFor('1.0.1') }), (error: unknown) => error instanceof ConfigReleaseError && error.code === 'RELEASE_INVALID');
  assert.throws(() => registry.registerDraft({ ...inputFor('1.0.2'), parameterSha256: 'bad-hash', content: { ...contentFor('1.0.2'), manifest: { ...contentFor('1.0.2').manifest, parameter_sha256: 'bad-hash' } } }), (error: unknown) => error instanceof ConfigReleaseError && error.code === 'RELEASE_INVALID');
  assert.throws(() => registry.registerDraft({ ...inputFor('1.0.2'), contentSha256: 'bad-hash' }), (error: unknown) => error instanceof ConfigReleaseError && error.code === 'RELEASE_INVALID');
});

test('rollback changes the active pointer without recomputing committed seeded settlement', () => {
  const registry = new ConfigReleaseRegistry({ clock: () => 0 });
  registry.registerDraft(inputFor('1.0.0-history'));
  registry.validate('1.0.0-history');
  registry.activate('1.0.0-history');
  const committed = registry.recordSettlement({ settlementId: 'settlement-1', configVersion: '1.0.0-history', seed: 42, responsePayload: { drop: 'ancient_scroll', amount: 1 }, committedAt: '2026-01-01T00:00:01.000Z' });
  registry.registerDraft(inputFor('1.0.1-active'));
  registry.validate('1.0.1-active');
  registry.activate('1.0.1-active');
  assert.equal(registry.get('1.0.0-history')?.status, 'rolled_back');
  registry.rollback('1.0.0-history');
  assert.equal(registry.current()?.version, '1.0.0-history');
  assert.equal(registry.get('1.0.1-active')?.status, 'rolled_back');
  assert.deepEqual(registry.replaySettlement('settlement-1'), committed);
  assert.equal(registry.replaySettlement('settlement-1').configVersion, '1.0.0-history');
  assert.equal(registry.replaySettlement('settlement-1').seed, 42);
});

test('settlement records are immutable and only live releases can accept new records', () => {
  const registry = new ConfigReleaseRegistry();
  registry.registerDraft(inputFor('1.0.3')); registry.validate('1.0.3');
  assert.throws(() => registry.recordSettlement({ settlementId: 'not-live', configVersion: '1.0.3', seed: 1, responsePayload: {}, committedAt: '2026-01-01T00:00:00Z' }), (error: unknown) => error instanceof ConfigReleaseError && error.code === 'INVALID_TRANSITION');
  registry.activate('1.0.3');
  const first = registry.recordSettlement({ settlementId: 'same', configVersion: '1.0.3', seed: 1, responsePayload: { value: 1 }, committedAt: '2026-01-01T00:00:00Z' });
  first.responsePayload = { value: 999 };
  assert.deepEqual(registry.replaySettlement('same').responsePayload, { value: 1 });
  assert.throws(() => registry.recordSettlement({ settlementId: 'same', configVersion: '1.0.3', seed: 2, responsePayload: { value: 2 }, committedAt: '2026-01-01T00:00:00Z' }), (error: unknown) => error instanceof ConfigReleaseError && error.code === 'SETTLEMENT_DUPLICATE');
  assert.throws(() => registry.replaySettlement('missing'), (error: unknown) => error instanceof ConfigReleaseError && error.code === 'SETTLEMENT_NOT_FOUND');
});
