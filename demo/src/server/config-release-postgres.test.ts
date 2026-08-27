import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { CONTENT_PACKAGE } from '../content/content-schema.ts';
import { FROZEN_PARAMETER_SHA256 } from '../game/frozen-parameters.ts';
import { ConfigReleaseRegistry } from './config-release.ts';
import { PostgresConfigReleaseProvider, PostgresConfigReleaseRepository } from './config-release-postgres.ts';
import { HIGH_TIER_COMBAT_MODE_PARAMETER, HIGH_TIER_FULL_MODE, HIGH_TIER_REALMS } from './high-tier-contract.ts';
import type { AsyncSqlClient, SqlResult } from './postgres-repository.ts';
import type { ConfigRelease, ConfigReleaseOperationCommand, SettlementReplayRecord } from './config-release.ts';

const settlementId = '22222222-2222-4222-8222-222222222222';
const packageFor = (version: string) => ({ ...CONTENT_PACKAGE, manifest: { ...CONTENT_PACKAGE.manifest, config_version: version } });

class FakeReleaseClient implements AsyncSqlClient {
  readonly queries: string[] = [];
  readonly releases = new Map<string, Record<string, unknown>>();
  readonly settlements = new Map<string, Record<string, unknown>>();
  readonly operations = new Map<string, Record<string, unknown>>();
  readonly audits: Record<string, unknown>[] = [];

  async query<Row extends Record<string, unknown> = Record<string, unknown>>(text: string, params: readonly unknown[] = []): Promise<SqlResult<Row>> {
    this.queries.push(text);
    if (text === 'BEGIN' || text === 'COMMIT' || text === 'ROLLBACK') return { rows: [], rowCount: 0 } as SqlResult<Row>;
    if (text.startsWith('SELECT pg_advisory_xact_lock')) return { rows: [], rowCount: 1 } as SqlResult<Row>;
    if (text.startsWith('SELECT response_payload FROM config_release_operation')) {
      const row = this.operations.get(String(params[0]));
      return { rows: row ? [row] : [] } as unknown as SqlResult<Row>;
    }
    if (text.startsWith('INSERT INTO config_release ')) {
      const [version, parameterSha256, contentSha256, status, canaryPercent, createdAt, validatedAt, activatedAt, rolledBackAt, transitionReason, contentPayload, parameterPayload, migrationPolicy] = params;
      this.releases.set(String(version), { version, parameter_sha256: parameterSha256, content_sha256: contentSha256, status, canary_percent: canaryPercent, created_at: createdAt, validated_at: validatedAt, activated_at: activatedAt, rolled_back_at: rolledBackAt, transition_reason: transitionReason, content_payload: JSON.parse(String(contentPayload)), parameter_payload: JSON.parse(String(parameterPayload)), migration_policy: migrationPolicy == null ? null : JSON.parse(String(migrationPolicy)) });
      return { rows: [], rowCount: 1 } as SqlResult<Row>;
    }
    if (text.startsWith('SELECT version, parameter_sha256') && text.includes("status='active'")) {
      const row = [...this.releases.values()].filter((release) => release.status === 'active').sort((left, right) => String(right.activated_at).localeCompare(String(left.activated_at)))[0];
      return { rows: row ? [row] : [] } as unknown as SqlResult<Row>;
    }
    if (text.startsWith('SELECT version, parameter_sha256') && text.includes("status='canary'")) {
      const rows = [...this.releases.values()].filter((release) => release.status === 'canary').sort((left, right) => String(left.created_at).localeCompare(String(right.created_at)));
      return { rows } as unknown as SqlResult<Row>;
    }
    if (text.startsWith('SELECT version, parameter_sha256')) {
      const row = this.releases.get(String(params[0]));
      return { rows: row ? [row] : [] } as unknown as SqlResult<Row>;
    }
    if (text.startsWith('SELECT version FROM config_release WHERE status')) {
      const row = [...this.releases.values()].find((release) => release.status === 'active');
      return { rows: row ? [{ version: row.version }] : [] } as unknown as SqlResult<Row>;
    }
    if (text.startsWith('UPDATE config_release SET status=\'validated\'')) {
      const release = this.releases.get(String(params[1]));
      if (release) { release.status = 'validated'; release.validated_at = params[0]; release.transition_reason = 'manual'; }
      return { rows: [], rowCount: 1 } as SqlResult<Row>;
    }
    if (text.startsWith("UPDATE config_release SET status='canary'")) {
      const release = this.releases.get(String(params[1]));
      if (release) { release.status = 'canary'; release.canary_percent = params[0]; release.transition_reason = 'manual'; }
      return { rows: [], rowCount: 1 } as SqlResult<Row>;
    }
    if (text.startsWith('SELECT version, parameter_sha256') && text.includes('ORDER BY')) return { rows: [...this.releases.values()] } as unknown as SqlResult<Row>;
    if (text.startsWith('UPDATE config_release SET status=\'rolled_back\'')) {
      for (const release of this.releases.values()) if (release.status === 'active' && (params.length < 2 || release.version !== params[1])) { release.status = 'rolled_back'; release.rolled_back_at = params[0]; release.transition_reason = text.includes("transition_reason='rollback'") ? 'rollback' : 'superseded'; }
      return { rows: [], rowCount: 1 } as SqlResult<Row>;
    }
    if (text.startsWith('UPDATE config_release SET status=\'active\'')) {
      const version = String(params[1]); const release = this.releases.get(version); if (release) { release.status = 'active'; release.canary_percent = 100; release.activated_at = params[0]; release.transition_reason = text.includes("transition_reason='rollback'") ? 'rollback' : 'manual'; }
      return { rows: [], rowCount: 1 } as SqlResult<Row>;
    }
    if (text.startsWith('INSERT INTO config_release_settlement ')) {
      const [id, configVersion, seed, responsePayload, committedAt] = params;
      this.settlements.set(String(id), { settlement_id: id, config_version: configVersion, seed, response_payload: JSON.parse(String(responsePayload)), committed_at: committedAt });
      return { rows: [], rowCount: 1 } as SqlResult<Row>;
    }
    if (text.startsWith('INSERT INTO config_release_operation ')) {
      const [operationKey, operation, targetVersion, operatorSubject, reason, requestId, responsePayload, createdAt] = params;
      this.operations.set(String(operationKey), { operation_key: operationKey, operation, target_version: targetVersion, operator_subject: operatorSubject, reason, request_id: requestId, response_payload: JSON.parse(String(responsePayload)), created_at: createdAt });
      return { rows: [], rowCount: 1 } as SqlResult<Row>;
    }
    if (text.startsWith('INSERT INTO config_release_audit ')) {
      const [auditId, operation, targetVersion, fromVersion, toVersion, operatorSubject, reason, createdAt] = params;
      this.audits.push({ audit_id: auditId, operation, target_version: targetVersion, from_version: fromVersion, to_version: toVersion, operator_subject: operatorSubject, reason, created_at: createdAt });
      return { rows: [], rowCount: 1 } as SqlResult<Row>;
    }
    if (text.startsWith('SELECT settlement_id, config_version')) {
      const row = this.settlements.get(String(params[0]));
      return { rows: row ? [row] : [] } as unknown as SqlResult<Row>;
    }
    if (text.includes('ORDER BY created_at')) return { rows: [...this.releases.values()] } as unknown as SqlResult<Row>;
    return { rows: [], rowCount: 0 } as SqlResult<Row>;
  }
}

const makeRelease = (version: string): ConfigRelease => {
  const registry = new ConfigReleaseRegistry({ clock: () => 0 });
  const release = registry.registerDraft({ version, parameterSha256: FROZEN_PARAMETER_SHA256, contentSha256: CONTENT_PACKAGE.manifest.content_sha256, content: packageFor(version), createdAt: '2026-01-01T00:00:00.000Z' });
  return release;
};

test('V1_002 migration defines durable release, active uniqueness and seeded replay tables', async () => {
  const sql = await readFile(new URL('./migrations/V1_002_config_release.sql', import.meta.url), 'utf8');
  assert.match(sql, /create table if not exists config_release/);
  assert.match(sql, /version text primary key/);
  assert.match(sql, /status text not null check \(status in \('draft', 'validated', 'canary', 'active', 'rolled_back'\)\)/);
  assert.match(sql, /config_release_one_active_idx/);
  assert.match(sql, /create table if not exists config_release_settlement/);
  assert.match(sql, /settlement_id uuid primary key/);
  assert.match(sql, /config_version text not null references config_release\(version\)/);
  assert.match(sql, /seed bigint not null check \(seed between 0 and 4294967295\)/);
  assert.match(sql, /response_payload jsonb not null/);
  assert.match(sql, /migration_policy jsonb/);
  assert.match(sql, /create table if not exists config_release_audit/);
  assert.match(sql, /operator_subject text not null/);
  assert.match(sql, /create table if not exists config_release_operation/);
  assert.match(sql, /operation_key text primary key/);
  assert.match(sql, /response_payload jsonb not null/);
});

test('Postgres release repository persists transitions and replay payloads transactionally', async () => {
  const client = new FakeReleaseClient();
  const repository = new PostgresConfigReleaseRepository(client);
  const first = makeRelease('1.0.0-history');
  await repository.createDraft(first);
  assert.equal((await repository.get(first.version))?.status, 'draft');
  await repository.validate(first.version, new Date('2026-01-01T00:00:00.500Z'));
  await repository.activate(first.version, new Date('2026-01-01T00:00:01.000Z'));
  const second = makeRelease('1.0.1-active');
  await repository.createDraft(second);
  await repository.validate(second.version, new Date('2026-01-01T00:00:01.500Z'));
  const active = await repository.activate(second.version, new Date('2026-01-01T00:00:02.000Z'));
  assert.equal(active.status, 'active');
  assert.equal((await repository.get(first.version))?.status, 'rolled_back');
  const rolledBack = await repository.rollback(first.version, new Date('2026-01-01T00:00:03.000Z'));
  assert.equal(rolledBack.version, first.version);
  assert.equal((await repository.get(second.version))?.status, 'rolled_back');
  const replay: SettlementReplayRecord = { settlementId, configVersion: first.version, seed: 42, responsePayload: { drop: 'ancient_scroll' }, committedAt: '2026-01-01T00:00:04.000Z' };
  await repository.recordSettlement(replay);
  assert.deepEqual(await repository.replaySettlement(settlementId), replay);
  assert.ok(client.queries.includes('BEGIN'));
  assert.ok(client.queries.includes('COMMIT'));
  assert.equal(client.queries.includes('ROLLBACK'), false);
});

test('Postgres rollout operation commits idempotency response with transition and replays across repository instances', async () => {
  const client = new FakeReleaseClient();
  const repository = new PostgresConfigReleaseRepository(client);
  const first = makeRelease('1.0.40-operation-active');
  const next = makeRelease('1.0.41-operation-next');
  await repository.createDraft(first);
  await repository.validate(first.version, new Date('2026-01-01T00:00:00.000Z'));
  await repository.activate(first.version, new Date('2026-01-01T00:00:01.000Z'));
  await repository.createDraft(next);
  await repository.validate(next.version, new Date('2026-01-01T00:00:02.000Z'));
  const command: ConfigReleaseOperationCommand = {
    operation: 'activate', version: next.version, idempotencyKey: 'admin:activate:1.0.41-operation-next:retry-1',
    meta: { operatorSubject: 'admin', reason: 'promote next release' }, requestId: 'request-first', serverTime: '2026-01-01T00:00:03.000Z',
  };
  const firstResult = await repository.runOperation(command);
  const replay = await new PostgresConfigReleaseRepository(client).runOperation({ ...command, requestId: 'request-retry', serverTime: '2026-01-01T00:00:04.000Z', meta: { ...command.meta, reason: 'different retry reason' } });
  assert.deepEqual(replay, firstResult);
  assert.equal(client.operations.size, 1);
  assert.equal(client.audits.filter((audit) => audit.operation === 'activate').length, 1);
  assert.equal((await repository.get(first.version))?.status, 'rolled_back');
  assert.equal((await repository.get(next.version))?.status, 'active');
});

test('Postgres provider rejects a persisted full_v1 payload without formal provenance', async () => {
  const client = new FakeReleaseClient();
  const repository = new PostgresConfigReleaseRepository(client);
  const release = makeRelease('1.0.0-unproven-full-high-tier');
  await repository.createDraft(release);
  const row = client.releases.get(release.version);
  assert.ok(row);
  const parameters = structuredClone(release.parameters) as Record<string, { value: unknown; [key: string]: unknown }>;
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
  row.status = 'active';
  row.activated_at = '2026-01-01T00:00:01.000Z';
  row.parameter_payload = parameters;
  const provider = new PostgresConfigReleaseProvider(repository);
  await assert.rejects(() => provider.refresh(), (error: unknown) => {
    if (!(error instanceof Error) || error.name !== 'ConfigReleaseError') return false;
    const details = (error as { details?: { contract?: string; diagnostics?: Array<{ path: string }> } }).details;
    return details?.contract === 'high_tier_provenance' && details.diagnostics?.some((item) => item.path.endsWith('.boss_attack.status')) === true;
  });
});

const tamperManifestParameterHash = (client: FakeReleaseClient, version: string): void => {
  const row = client.releases.get(version);
  assert.ok(row, `release row should exist: ${version}`);
  const content = row.content_payload as ConfigRelease['content'];
  content.manifest = { ...content.manifest, parameter_sha256: 'f'.repeat(64) };
};

test('Postgres lifecycle gates revalidate persisted snapshots before every rollout write', async () => {
  const client = new FakeReleaseClient();
  const repository = new PostgresConfigReleaseRepository(client);

  const draft = makeRelease('1.0.30-invalid-draft');
  await repository.createDraft(draft);
  tamperManifestParameterHash(client, draft.version);
  await assert.rejects(() => repository.validate(draft.version, new Date('2026-01-01T00:00:01.000Z')), (error: unknown) => error instanceof Error && error.name === 'ConfigReleaseError' && /hash does not match/.test(error.message));
  assert.equal((await repository.get(draft.version))?.status, 'draft');

  const canary = makeRelease('1.0.31-invalid-canary');
  await repository.createDraft(canary);
  await repository.validate(canary.version, new Date('2026-01-01T00:00:02.000Z'));
  tamperManifestParameterHash(client, canary.version);
  await assert.rejects(() => repository.startCanary(canary.version, 25, new Date('2026-01-01T00:00:03.000Z')), (error: unknown) => error instanceof Error && error.name === 'ConfigReleaseError' && /hash does not match/.test(error.message));
  assert.equal((await repository.get(canary.version))?.status, 'validated');

  const active = makeRelease('1.0.32-valid-active');
  await repository.createDraft(active);
  await repository.validate(active.version, new Date('2026-01-01T00:00:04.000Z'));
  await repository.activate(active.version, new Date('2026-01-01T00:00:05.000Z'));
  const invalidTarget = makeRelease('1.0.33-invalid-target');
  await repository.createDraft(invalidTarget);
  await repository.validate(invalidTarget.version, new Date('2026-01-01T00:00:06.000Z'));
  tamperManifestParameterHash(client, invalidTarget.version);
  await assert.rejects(() => repository.activate(invalidTarget.version, new Date('2026-01-01T00:00:07.000Z')), (error: unknown) => error instanceof Error && error.name === 'ConfigReleaseError' && /hash does not match/.test(error.message));
  assert.equal((await repository.get(active.version))?.status, 'active');
  assert.equal((await repository.get(invalidTarget.version))?.status, 'validated');
  await assert.rejects(() => repository.rollback(invalidTarget.version, new Date('2026-01-01T00:00:08.000Z')), (error: unknown) => error instanceof Error && error.name === 'ConfigReleaseError' && /hash does not match/.test(error.message));
  assert.equal((await repository.get(active.version))?.status, 'active');
});

test('Postgres repository enforces the canary percentage boundary without opening a transaction', async () => {
  const client = new FakeReleaseClient();
  const repository = new PostgresConfigReleaseRepository(client);
  const release = makeRelease('1.0.34-invalid-canary-percent');
  await repository.createDraft(release);
  await repository.validate(release.version, new Date('2026-01-01T00:00:00.000Z'));
  const queryCountBeforeInvalidCall = client.queries.length;
  await assert.rejects(() => repository.startCanary(release.version, 0, new Date('2026-01-01T00:00:01.000Z')), (error: unknown) => error instanceof Error && error.name === 'ConfigReleaseError' && /canary percent/.test(error.message));
  assert.equal(client.queries.length, queryCountBeforeInvalidCall);
  assert.equal((await repository.get(release.version))?.status, 'validated');
});

test('Postgres rollout command boundary rejects malformed audit metadata before opening a transaction', async () => {
  const client = new FakeReleaseClient();
  const repository = new PostgresConfigReleaseRepository(client);
  const queryCountBeforeInvalidCall = client.queries.length;
  await assert.rejects(() => repository.runOperation({ operation: 'activate', version: '1.0.0', idempotencyKey: 'key', meta: { operatorSubject: 'admin', reason: 'x' }, requestId: 'request', serverTime: '2026-01-01T00:00:00.000Z' }), (error: unknown) => error instanceof Error && error.name === 'ConfigReleaseError' && /reason/.test(error.message));
  assert.equal(client.queries.length, queryCountBeforeInvalidCall);
  await assert.rejects(() => repository.runOperation({ operation: 'activate', version: '1.0.0', idempotencyKey: ' ', meta: { operatorSubject: 'admin', reason: 'valid reason' }, requestId: 'request', serverTime: '2026-01-01T00:00:00.000Z' }), (error: unknown) => error instanceof Error && error.name === 'ConfigReleaseError' && /idempotency/.test(error.message));
  assert.equal(client.queries.length, queryCountBeforeInvalidCall);
});

test('Postgres release repository round-trips parameter payload and provider caches active snapshot', async () => {
  const client = new FakeReleaseClient();
  const repository = new PostgresConfigReleaseRepository(client);
  const release = makeRelease('1.0.5-parameters');
  release.migrationPolicy = { mode: 'identity', fromVersions: ['1.0.4'] };
  release.parameters['map.bai_cao_valley.target_kill_time'] = { value: 17, unit: 'seconds' };
  await repository.createDraft(release);
  await repository.validate(release.version, new Date('2026-01-01T00:00:00.000Z'));
  await repository.activate(release.version, new Date('2026-01-01T00:00:01.000Z'));
  assert.equal((await repository.get(release.version))?.parameters['map.bai_cao_valley.target_kill_time']?.value, 17);
  assert.deepEqual((await repository.get(release.version))?.migrationPolicy, release.migrationPolicy);
  const provider = new PostgresConfigReleaseProvider(repository);
  const snapshot = await provider.refresh();
  assert.equal(snapshot?.version, release.version);
  assert.deepEqual(snapshot?.migrationPolicy, release.migrationPolicy);
  assert.equal(provider.getActiveSnapshot()?.parameters['map.bai_cao_valley.target_kill_time']?.value, 17);
  const cached = provider.getActiveSnapshot();
  if (!cached) throw new Error('expected cached snapshot');
  cached.parameters['map.bai_cao_valley.target_kill_time'] = { value: 99 };
  assert.equal(provider.getActiveSnapshot()?.parameters['map.bai_cao_valley.target_kill_time']?.value, 17);
});

test('Postgres release repository rejects an empty persisted parameter payload', async () => {
  const client = new FakeReleaseClient();
  const repository = new PostgresConfigReleaseRepository(client);
  const release = makeRelease('1.0.5-empty-parameters');
  await repository.createDraft(release);
  const row = client.releases.get(release.version);
  assert.ok(row);
  row.parameter_payload = {};
  await assert.rejects(() => repository.get(release.version), (error: unknown) => error instanceof Error && error.name === 'ConfigReleaseError' && /parameter payload is empty/.test(error.message));
});

test('Postgres release provider resolves a stable canary bucket and historical snapshot from shared rows', async () => {
  const client = new FakeReleaseClient();
  const repository = new PostgresConfigReleaseRepository(client);
  const active = makeRelease('1.0.20-active');
  await repository.createDraft(active); await repository.validate(active.version, new Date('2026-01-01T00:00:00.000Z')); await repository.activate(active.version, new Date('2026-01-01T00:00:01.000Z'));
  const canary = makeRelease('1.0.21-canary');
  await repository.createDraft(canary); await repository.validate(canary.version, new Date('2026-01-01T00:00:02.000Z')); await repository.startCanary(canary.version, 100, new Date('2026-01-01T00:00:03.000Z'));
  const provider = new PostgresConfigReleaseProvider(repository);
  assert.equal((await provider.getSnapshotForPlayer('pg-canary-player'))?.version, canary.version);
  assert.equal((await provider.getSnapshot('1.0.20-active'))?.version, active.version);
});

test('Postgres release lifecycle writes operator audit metadata in the same transaction', async () => {
  const client = new FakeReleaseClient();
  const repository = new PostgresConfigReleaseRepository(client);
  const first = makeRelease('1.0.6-history');
  await repository.createDraft(first);
  await repository.validate(first.version, new Date('2026-01-01T00:00:00.000Z'));
  await repository.activate(first.version, new Date('2026-01-01T00:00:01.000Z'));
  const next = makeRelease('1.0.7-next');
  await repository.createDraft(next);
  await repository.validate(next.version, new Date('2026-01-01T00:00:02.000Z'));
  await repository.activate(next.version, new Date('2026-01-01T00:00:03.000Z'), { operatorSubject: 'admin-1', reason: 'promote release' });
  assert.ok(client.queries.some((query) => query.includes('INSERT INTO config_release_audit')));
});

test('Postgres release repository enforces UUID settlement IDs and preserves rollback on SQL failure', async () => {
  const client = new FakeReleaseClient();
  const repository = new PostgresConfigReleaseRepository(client);
  await assert.rejects(() => repository.recordSettlement({ settlementId: 'readable-id', configVersion: '1.0.0', seed: 1, responsePayload: {}, committedAt: '2026-01-01T00:00:00Z' }), /must be a UUID/);
});
