import { createHash, randomUUID } from 'node:crypto';
import { ApiError } from './types.ts';
import type { AsyncSqlClient, AsyncSqlPool, SqlResult } from './postgres-repository.ts';
import { ConfigReleaseError, validateConfigReleaseOperationCommand, validateConfigReleaseSnapshot } from './config-release.ts';
import type { ConfigRelease, ConfigReleaseAudit, ConfigReleaseOperationCommand, ConfigReleaseOperationMeta, ConfigReleaseOperationRecord, ConfigReleaseProvider, ConfigReleaseSnapshot, SettlementReplayRecord } from './config-release.ts';
import type { ContentPackage } from '../content/content-schema.ts';

export type ConfigReleaseSqlRow = Record<string, unknown>;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const clone = <T>(value: T): T => structuredClone(value);
const json = (value: unknown): string => JSON.stringify(value);
const parseJson = <T>(value: unknown): T => typeof value === 'string' ? JSON.parse(value) as T : value as T;
const timestamp = (value: unknown): string => value instanceof Date ? value.toISOString() : new Date(String(value)).toISOString();
const numberValue = (value: unknown): number => Number(value ?? 0);
const validCanaryPercent = (value: number): void => {
  if (!Number.isFinite(value) || value <= 0 || value > 100) throw new ConfigReleaseError('RELEASE_INVALID', 'canary percent must be greater than 0 and at most 100');
};

export class PostgresConfigReleaseRepository {
  private readonly pool: AsyncSqlPool;

  constructor(pool: AsyncSqlPool) {
    this.pool = pool;
  }

  async createDraft(release: ConfigRelease): Promise<void> {
    if (release.status !== 'draft') throw new ConfigReleaseError('INVALID_TRANSITION', 'only draft releases can be inserted');
    this.assertRelease(release);
    await this.withTransaction(async (client) => {
      await this.query(client, `INSERT INTO config_release (version, parameter_sha256, content_sha256, status, canary_percent, created_at, validated_at, activated_at, rolled_back_at, transition_reason, content_payload, parameter_payload, migration_policy) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12::jsonb,$13::jsonb)`, [release.version, release.parameterSha256, release.contentSha256, release.status, release.canaryPercent, release.createdAt, release.validatedAt, release.activatedAt, release.rolledBackAt, release.transitionReason, json(release.content), json(release.parameters), json(release.migrationPolicy ?? null)]);
    }, 'create config release');
  }

  async validate(version: string, at: Date): Promise<ConfigRelease> {
    return this.withTransaction(async (client) => {
      const release = await this.requireRelease(client, version);
      if (release.status !== 'draft') throw new ConfigReleaseError('INVALID_TRANSITION', `only draft releases can be validated: ${version}`);
      this.assertRelease(release);
      await this.query(client, `UPDATE config_release SET status='validated', validated_at=$1, transition_reason='manual' WHERE version=$2`, [at, version]);
      return { ...release, status: 'validated', validatedAt: at.toISOString(), transitionReason: 'manual' };
    }, 'validate config release');
  }

  async get(version: string): Promise<ConfigRelease | null> {
    return this.withClient(async (client) => {
      const row = await this.one(client, `SELECT version, parameter_sha256, content_sha256, status, canary_percent, created_at, validated_at, activated_at, rolled_back_at, transition_reason, content_payload, parameter_payload, migration_policy FROM config_release WHERE version = $1`, [version]);
      return row ? this.mapRelease(row) : null;
    });
  }

  async getActiveSnapshot(): Promise<ConfigReleaseSnapshot | null> {
    return this.withClient(async (client) => {
      const row = await this.one(client, `SELECT version, parameter_sha256, content_sha256, status, canary_percent, created_at, validated_at, activated_at, rolled_back_at, transition_reason, content_payload, parameter_payload, migration_policy FROM config_release WHERE status='active' ORDER BY activated_at DESC LIMIT 1`, []);
      if (!row) return null;
      const release = this.mapRelease(row);
      return { version: release.version, parameterSha256: release.parameterSha256, contentSha256: release.contentSha256, content: release.content, parameters: release.parameters, migrationPolicy: release.migrationPolicy };
    });
  }

  async getSnapshot(version: string): Promise<ConfigReleaseSnapshot | null> {
    return this.withClient(async (client) => {
      const row = await this.one(client, `SELECT version, parameter_sha256, content_sha256, status, canary_percent, created_at, validated_at, activated_at, rolled_back_at, transition_reason, content_payload, parameter_payload, migration_policy FROM config_release WHERE version = $1`, [version]);
      if (!row) return null;
      const release = this.mapRelease(row);
      return { version: release.version, parameterSha256: release.parameterSha256, contentSha256: release.contentSha256, content: release.content, parameters: release.parameters, migrationPolicy: release.migrationPolicy };
    });
  }

  async getSnapshotForPlayer(playerId: string): Promise<ConfigReleaseSnapshot | null> {
    return this.withClient(async (client) => {
      const activeRow = await this.one(client, `SELECT version, parameter_sha256, content_sha256, status, canary_percent, created_at, validated_at, activated_at, rolled_back_at, transition_reason, content_payload, parameter_payload, migration_policy FROM config_release WHERE status='active' ORDER BY activated_at DESC LIMIT 1`, []);
      const canaryRows = (await this.query(client, `SELECT version, parameter_sha256, content_sha256, status, canary_percent, created_at, validated_at, activated_at, rolled_back_at, transition_reason, content_payload, parameter_payload, migration_policy FROM config_release WHERE status='canary' ORDER BY created_at DESC, version DESC`, [])).rows;
      const canary = canaryRows.find((row) => this.servesPlayer(String(row.version), playerId, numberValue(row.canary_percent)));
      const row = canary ?? activeRow;
      if (!row) return null;
      const release = this.mapRelease(row);
      return { version: release.version, parameterSha256: release.parameterSha256, contentSha256: release.contentSha256, content: release.content, parameters: release.parameters, migrationPolicy: release.migrationPolicy };
    });
  }

  async list(): Promise<ConfigRelease[]> {
      return this.withClient(async (client) => (await this.query(client, `SELECT version, parameter_sha256, content_sha256, status, canary_percent, created_at, validated_at, activated_at, rolled_back_at, transition_reason, content_payload, parameter_payload, migration_policy FROM config_release ORDER BY created_at, version`)).rows.map((row) => this.mapRelease(row)));
  }

  async startCanary(version: string, canaryPercent: number, at: Date, meta?: ConfigReleaseOperationMeta): Promise<ConfigRelease> {
    validCanaryPercent(canaryPercent);
    return this.withTransaction(async (client) => {
      const release = await this.requireRelease(client, version);
      if (release.status !== 'validated') throw new ConfigReleaseError('INVALID_TRANSITION', `only validated releases can enter canary: ${version}`);
      this.assertRelease(release);
      const active = await this.one(client, `SELECT version FROM config_release WHERE status='active'`, []);
      await this.query(client, `UPDATE config_release SET status='canary', canary_percent=$1, transition_reason='manual' WHERE version=$2`, [canaryPercent, version]);
      if (meta) await this.insertAudit(client, { auditId: randomUUID(), operation: 'canary', targetVersion: version, fromVersion: active ? String(active.version) : null, toVersion: active ? String(active.version) : null, operatorSubject: meta.operatorSubject, reason: meta.reason, createdAt: at.toISOString() });
      return { ...release, status: 'canary', canaryPercent, transitionReason: 'manual' };
    }, 'start config canary');
  }

  /**
   * Execute a rollout command and persist its response in the same SQL
   * transaction as the state transition. The advisory lock serializes two
   * processes using the same idempotency key before either can transition or
   * append an audit row.
   */
  async runOperation(command: ConfigReleaseOperationCommand): Promise<ConfigReleaseOperationRecord> {
    validateConfigReleaseOperationCommand(command);
    const at = new Date(command.serverTime);
    return this.withTransaction(async (client) => {
      await this.query(client, `SELECT pg_advisory_xact_lock(hashtext($1))`, [command.idempotencyKey]);
      const previous = await this.one(client, `SELECT response_payload FROM config_release_operation WHERE operation_key = $1`, [command.idempotencyKey]);
      if (previous) return clone(parseJson<ConfigReleaseOperationRecord>(previous.response_payload));

      if (command.operation === 'canary') {
        validCanaryPercent(command.canaryPercent as number);
        const release = await this.requireRelease(client, command.version);
        if (release.status !== 'validated') throw new ConfigReleaseError('INVALID_TRANSITION', `only validated releases can enter canary: ${command.version}`);
        this.assertRelease(release);
        const active = await this.one(client, `SELECT version FROM config_release WHERE status='active'`, []);
        await this.query(client, `UPDATE config_release SET status='canary', canary_percent=$1, transition_reason='manual' WHERE version=$2`, [command.canaryPercent, command.version]);
        await this.insertAudit(client, { auditId: randomUUID(), operation: 'canary', targetVersion: command.version, fromVersion: active ? String(active.version) : null, toVersion: active ? String(active.version) : null, operatorSubject: command.meta.operatorSubject, reason: command.meta.reason, createdAt: at.toISOString() });
      } else if (command.operation === 'activate') {
        const target = await this.requireRelease(client, command.version);
        if (target.status !== 'validated' && target.status !== 'canary' && target.status !== 'rolled_back') throw new ConfigReleaseError('INVALID_TRANSITION', `release cannot become active from ${target.status}: ${command.version}`);
        this.assertRelease(target);
        const active = await this.one(client, `SELECT version FROM config_release WHERE status='active'`, []);
        await this.query(client, `UPDATE config_release SET status='rolled_back', rolled_back_at=$1, transition_reason='superseded' WHERE status='active' AND version <> $2`, [at, command.version]);
        await this.query(client, `UPDATE config_release SET status='active', canary_percent=100, activated_at=$1, transition_reason='manual' WHERE version=$2`, [at, command.version]);
        await this.insertAudit(client, { auditId: randomUUID(), operation: 'activate', targetVersion: command.version, fromVersion: active ? String(active.version) : null, toVersion: command.version, operatorSubject: command.meta.operatorSubject, reason: command.meta.reason, createdAt: at.toISOString() });
      } else {
        const target = await this.requireRelease(client, command.version);
        const active = await this.one(client, `SELECT version FROM config_release WHERE status='active'`, []);
        if (!active) throw new ConfigReleaseError('INVALID_TRANSITION', 'there is no active release to roll back');
        if (String(active.version) === command.version) throw new ConfigReleaseError('INVALID_TRANSITION', 'target release is already active');
        if (target.status !== 'validated' && target.status !== 'canary' && target.status !== 'rolled_back') throw new ConfigReleaseError('INVALID_TRANSITION', `release cannot be a rollback target from ${target.status}: ${command.version}`);
        this.assertRelease(target);
        await this.query(client, `UPDATE config_release SET status='rolled_back', rolled_back_at=$1, transition_reason='rollback' WHERE status='active'`, [at]);
        await this.query(client, `UPDATE config_release SET status='active', canary_percent=100, activated_at=$1, transition_reason='rollback' WHERE version=$2`, [at, command.version]);
        await this.insertAudit(client, { auditId: randomUUID(), operation: 'rollback', targetVersion: command.version, fromVersion: String(active.version), toVersion: command.version, operatorSubject: command.meta.operatorSubject, reason: command.meta.reason, createdAt: at.toISOString() });
      }

      const active = await this.one(client, `SELECT version FROM config_release WHERE status='active' ORDER BY activated_at DESC LIMIT 1`, []);
      const record: ConfigReleaseOperationRecord = {
        requestId: command.requestId,
        configVersion: active ? String(active.version) : command.version,
        stateRevision: 0,
        serverTime: command.serverTime,
        data: { operation: command.operation, targetVersion: command.version, activeVersion: active ? String(active.version) : null },
      };
      await this.query(client, `INSERT INTO config_release_operation (operation_key, operation, target_version, operator_subject, reason, request_id, response_payload, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8)`, [command.idempotencyKey, command.operation, command.version, command.meta.operatorSubject, command.meta.reason, command.requestId, json(record), command.serverTime]);
      return clone(record);
    }, 'config release operation');
  }

  async activate(version: string, at: Date, meta?: ConfigReleaseOperationMeta): Promise<ConfigRelease> {
    return this.withTransaction(async (client) => {
      const target = await this.requireRelease(client, version);
      if (target.status !== 'validated' && target.status !== 'canary' && target.status !== 'rolled_back') throw new ConfigReleaseError('INVALID_TRANSITION', `release cannot become active from ${target.status}: ${version}`);
      this.assertRelease(target);
      const active = await this.one(client, `SELECT version FROM config_release WHERE status='active'`, []);
      await this.query(client, `UPDATE config_release SET status='rolled_back', rolled_back_at=$1, transition_reason='superseded' WHERE status='active' AND version <> $2`, [at, version]);
      await this.query(client, `UPDATE config_release SET status='active', canary_percent=100, activated_at=$1, transition_reason='manual' WHERE version=$2`, [at, version]);
      if (meta) await this.insertAudit(client, { auditId: randomUUID(), operation: 'activate', targetVersion: version, fromVersion: active ? String(active.version) : null, toVersion: version, operatorSubject: meta.operatorSubject, reason: meta.reason, createdAt: at.toISOString() });
      return { ...target, status: 'active', canaryPercent: 100, activatedAt: at.toISOString(), transitionReason: 'manual' };
    }, 'activate config release');
  }

  async rollback(targetVersion: string, at: Date, meta?: ConfigReleaseOperationMeta): Promise<ConfigRelease> {
    return this.withTransaction(async (client) => {
      const target = await this.requireRelease(client, targetVersion);
      const active = await this.one(client, `SELECT version FROM config_release WHERE status='active'`, []);
      if (!active) throw new ConfigReleaseError('INVALID_TRANSITION', 'there is no active release to roll back');
      if (String(active.version) === targetVersion) throw new ConfigReleaseError('INVALID_TRANSITION', 'target release is already active');
      if (target.status !== 'validated' && target.status !== 'canary' && target.status !== 'rolled_back') throw new ConfigReleaseError('INVALID_TRANSITION', `release cannot be a rollback target from ${target.status}: ${targetVersion}`);
      this.assertRelease(target);
      await this.query(client, `UPDATE config_release SET status='rolled_back', rolled_back_at=$1, transition_reason='rollback' WHERE status='active'`, [at]);
      await this.query(client, `UPDATE config_release SET status='active', canary_percent=100, activated_at=$1, transition_reason='rollback' WHERE version=$2`, [at, targetVersion]);
      if (meta) await this.insertAudit(client, { auditId: randomUUID(), operation: 'rollback', targetVersion, fromVersion: String(active.version), toVersion: targetVersion, operatorSubject: meta.operatorSubject, reason: meta.reason, createdAt: at.toISOString() });
      return { ...target, status: 'active', canaryPercent: 100, activatedAt: at.toISOString(), transitionReason: 'rollback' };
    }, 'rollback config release');
  }

  async recordSettlement(record: SettlementReplayRecord): Promise<void> {
    this.assertUuid(record.settlementId, 'settlementId');
    if (!Number.isInteger(record.seed) || record.seed < 0 || record.seed > 0xffffffff) throw new ConfigReleaseError('RELEASE_INVALID', 'settlement seed must be an unsigned 32-bit integer');
    await this.withTransaction(async (client) => {
      await this.query(client, `INSERT INTO config_release_settlement (settlement_id, config_version, seed, response_payload, committed_at) VALUES ($1,$2,$3,$4::jsonb,$5)`, [record.settlementId, record.configVersion, record.seed, json(record.responsePayload), record.committedAt]);
    }, 'record config settlement');
  }

  async replaySettlement(settlementId: string): Promise<SettlementReplayRecord | null> {
    this.assertUuid(settlementId, 'settlementId');
    return this.withClient(async (client) => {
      const row = await this.one(client, `SELECT settlement_id, config_version, seed, response_payload, committed_at FROM config_release_settlement WHERE settlement_id = $1`, [settlementId]);
      if (!row) return null;
      return { settlementId: String(row.settlement_id), configVersion: String(row.config_version), seed: numberValue(row.seed), responsePayload: clone(parseJson(row.response_payload)), committedAt: timestamp(row.committed_at) };
    });
  }

  private async requireRelease(client: AsyncSqlClient, version: string): Promise<ConfigRelease> {
    const row = await this.one(client, `SELECT version, parameter_sha256, content_sha256, status, canary_percent, created_at, validated_at, activated_at, rolled_back_at, transition_reason, content_payload, parameter_payload, migration_policy FROM config_release WHERE version = $1 FOR UPDATE`, [version]);
    if (!row) throw new ConfigReleaseError('RELEASE_NOT_FOUND', `release does not exist: ${version}`);
    return this.mapRelease(row);
  }

  private mapRelease(row: ConfigReleaseSqlRow): ConfigRelease {
    const parameterPayload = parseJson<ConfigRelease['parameters'] | null>(row.parameter_payload ?? null);
    if (!parameterPayload || typeof parameterPayload !== 'object' || Array.isArray(parameterPayload) || Object.keys(parameterPayload).length === 0) {
      throw new ConfigReleaseError('RELEASE_INVALID', 'persisted config release parameter payload is empty', { version: String(row.version), field: 'parameter_payload' });
    }
    const parameters = parameterPayload;
    return { version: String(row.version), parameterSha256: String(row.parameter_sha256), contentSha256: String(row.content_sha256), status: String(row.status) as ConfigRelease['status'], canaryPercent: numberValue(row.canary_percent), createdAt: timestamp(row.created_at), validatedAt: row.validated_at == null ? null : timestamp(row.validated_at), activatedAt: row.activated_at == null ? null : timestamp(row.activated_at), rolledBackAt: row.rolled_back_at == null ? null : timestamp(row.rolled_back_at), transitionReason: row.transition_reason == null ? null : String(row.transition_reason) as ConfigRelease['transitionReason'], content: clone(parseJson<ContentPackage>(row.content_payload)), parameters: clone(parameters), migrationPolicy: row.migration_policy == null ? null : clone(parseJson<ConfigRelease['migrationPolicy']>(row.migration_policy)) };
  }

  private async withClient<T>(work: (client: AsyncSqlClient) => Promise<T>): Promise<T> {
    const pool = this.pool as { connect?: () => Promise<AsyncSqlClient> };
    const client = typeof pool.connect === 'function' ? await pool.connect() : this.pool as AsyncSqlClient;
    try { return await work(client); } finally { client.release?.(); }
  }

  private async withTransaction<T>(work: (client: AsyncSqlClient) => Promise<T>, operation: string): Promise<T> {
    return this.withClient(async (client) => {
      await this.query(client, 'BEGIN');
      try { const result = await work(client); await this.query(client, 'COMMIT'); return result; }
      catch (error) { try { await this.query(client, 'ROLLBACK'); } catch { /* preserve original error */ } if (error instanceof ConfigReleaseError) throw error; if (error instanceof ApiError) throw error; throw new ApiError('INTERNAL_ROLLBACK', `${operation} failed; no state was written`, { cause: error instanceof Error ? error.message : String(error) }); }
    });
  }

  private async query<Row extends ConfigReleaseSqlRow = ConfigReleaseSqlRow>(client: AsyncSqlClient, text: string, params: readonly unknown[] = []): Promise<SqlResult<Row>> { return client.query<Row>(text, params); }
  private async one(client: AsyncSqlClient, text: string, params: readonly unknown[]): Promise<ConfigReleaseSqlRow | null> { return (await this.query(client, text, params)).rows[0] ?? null; }
  private async insertAudit(client: AsyncSqlClient, audit: ConfigReleaseAudit): Promise<void> { await this.query(client, `INSERT INTO config_release_audit (audit_id, operation, target_version, from_version, to_version, operator_subject, reason, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`, [audit.auditId, audit.operation, audit.targetVersion, audit.fromVersion, audit.toVersion, audit.operatorSubject, audit.reason, audit.createdAt]); }
  private servesPlayer(_version: string, playerId: string, canaryPercent?: number): boolean {
    // Keep the bucket key identical to ConfigReleaseRegistry so a player is
    // routed consistently across memory, PostgreSQL, and service instances.
    const digest = createHash('sha256').update(playerId).digest('hex');
    const bucket = Number.parseInt(digest.slice(0, 8), 16) / 0x100000000 * 100;
    return bucket < (canaryPercent ?? 0);
  }
  private assertUuid(value: string, label: string): void { if (!UUID_PATTERN.test(value)) throw new ConfigReleaseError('RELEASE_INVALID', `${label} must be a UUID`); }
  private assertRelease(release: ConfigRelease): void {
    validateConfigReleaseSnapshot({ version: release.version, parameterSha256: release.parameterSha256, contentSha256: release.contentSha256, content: release.content, parameters: release.parameters, migrationPolicy: release.migrationPolicy }, { requireFormalHighTier: true, requireFormalParameterProvenance: true });
  }
}

export class PostgresConfigReleaseProvider implements ConfigReleaseProvider {
  private snapshot: ConfigReleaseSnapshot | null = null;
  private readonly repository: PostgresConfigReleaseRepository;

  constructor(repository: PostgresConfigReleaseRepository) {
    this.repository = repository;
  }

  async startCanary(version: string, canaryPercent: number, meta: ConfigReleaseOperationMeta): Promise<ConfigRelease> { return this.repository.startCanary(version, canaryPercent, new Date(), meta); }
  async activate(version: string, meta: ConfigReleaseOperationMeta): Promise<ConfigRelease> { const result = await this.repository.activate(version, new Date(), meta); await this.refresh(); return result; }
  async rollback(version: string, meta: ConfigReleaseOperationMeta): Promise<ConfigRelease> { const result = await this.repository.rollback(version, new Date(), meta); await this.refresh(); return result; }
  async runOperation(command: ConfigReleaseOperationCommand): Promise<ConfigReleaseOperationRecord> {
    const result = await this.repository.runOperation(command);
    await this.refresh();
    return result;
  }

  async refresh(): Promise<ConfigReleaseSnapshot | null> {
    const snapshot = await this.repository.getActiveSnapshot();
    this.snapshot = snapshot ? validateConfigReleaseSnapshot(snapshot, { requireFormalHighTier: true, requireFormalParameterProvenance: true }) : null;
    return this.snapshot ? clone(this.snapshot) : null;
  }

  getActiveSnapshot(): ConfigReleaseSnapshot | null {
    return this.snapshot ? clone(this.snapshot) : null;
  }

  async getSnapshot(version: string): Promise<ConfigReleaseSnapshot | null> {
    const snapshot = await this.repository.getSnapshot(version);
    return snapshot ? validateConfigReleaseSnapshot(snapshot, { requireFormalHighTier: true, requireFormalParameterProvenance: true }) : null;
  }

  async getSnapshotForPlayer(playerId: string): Promise<ConfigReleaseSnapshot | null> {
    const snapshot = await this.repository.getSnapshotForPlayer(playerId);
    return snapshot ? validateConfigReleaseSnapshot(snapshot, { requireFormalHighTier: true, requireFormalParameterProvenance: true }) : null;
  }
}
