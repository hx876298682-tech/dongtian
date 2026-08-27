import { createHash, randomUUID } from 'node:crypto';
import { diagnoseContentReachability, diagnoseMapEquipmentReleaseReadiness, validateContentPackage } from '../content/content-schema.ts';
import { FROZEN_PARAMETERS } from '../game/frozen-parameters.ts';
import type { ContentPackage } from '../content/content-schema.ts';
import { diagnoseHighTierCombatContract, diagnoseHighTierCombatFormalProvenance } from './high-tier-contract.ts';
import { validateEquipmentExitPolicy } from './equipment-exit.ts';
import { diagnoseRandomEventParameterContract } from './random-event-contract.ts';

export type ConfigReleaseStatus = 'draft' | 'validated' | 'canary' | 'active' | 'rolled_back';
export type ConfigParameterEntry = { value: unknown; [key: string]: unknown };
export type ConfigParameterMap = Record<string, ConfigParameterEntry>;
export type ConfigMigrationPolicy = { mode: 'identity' | 'forward-compatible'; fromVersions: string[] };
export type ConfigReleaseLifecycleOperation = 'canary' | 'activate' | 'rollback';
export type ConfigReleaseOperationMeta = { operatorSubject: string; reason: string };
/** The durable command/result contract shared by memory and PostgreSQL rollout stores. */
export type ConfigReleaseOperationCommand = {
  operation: ConfigReleaseLifecycleOperation;
  version: string;
  canaryPercent?: number;
  meta: ConfigReleaseOperationMeta;
  idempotencyKey: string;
  requestId: string;
  serverTime: string;
};
export type ConfigReleaseOperationRecord = {
  requestId: string;
  configVersion: string;
  stateRevision: 0;
  serverTime: string;
  data: { operation: ConfigReleaseLifecycleOperation; targetVersion: string; activeVersion: string | null };
};
export type ConfigReleaseAudit = { auditId: string; operation: ConfigReleaseLifecycleOperation; targetVersion: string; fromVersion: string | null; toVersion: string | null; operatorSubject: string; reason: string; createdAt: string };
export type ConfigRelease = {
  version: string;
  parameterSha256: string;
  contentSha256: string;
  status: ConfigReleaseStatus;
  canaryPercent: number;
  createdAt: string;
  validatedAt: string | null;
  activatedAt: string | null;
  rolledBackAt: string | null;
  transitionReason: 'manual' | 'rollback' | 'superseded' | null;
  content: ContentPackage;
  parameters: ConfigParameterMap;
  migrationPolicy?: ConfigMigrationPolicy | null;
};

export type ConfigReleaseInput = {
  version: string;
  parameterSha256: string;
  contentSha256: string;
  content: ContentPackage;
  parameters?: ConfigParameterMap;
  migrationPolicy?: ConfigMigrationPolicy | null;
  createdAt?: Date | string;
};

export type ConfigReleaseSnapshot = Pick<ConfigRelease, 'version' | 'parameterSha256' | 'contentSha256' | 'content' | 'parameters' | 'migrationPolicy'>;
export interface ConfigReleaseProvider {
  getActiveSnapshot(): ConfigReleaseSnapshot | null;
  /** Resolve the snapshot that should serve one player. Implementations backed
   * by a shared store must read the current active/canary state here rather
   * than relying on a process-local cache. */
  getSnapshotForPlayer?(playerId: string): Promise<ConfigReleaseSnapshot | null> | ConfigReleaseSnapshot | null;
  /** Read an immutable historical snapshot for replaying an old settlement. */
  getSnapshot?(version: string): Promise<ConfigReleaseSnapshot | null> | ConfigReleaseSnapshot | null;
  refresh?(): Promise<ConfigReleaseSnapshot | null>;
  startCanary?(version: string, canaryPercent: number, meta: ConfigReleaseOperationMeta): Promise<ConfigRelease> | ConfigRelease;
  activate?(version: string, meta: ConfigReleaseOperationMeta): Promise<ConfigRelease> | ConfigRelease;
  rollback?(version: string, meta: ConfigReleaseOperationMeta): Promise<ConfigRelease> | ConfigRelease;
  /** Execute and durably replay one admin rollout command. */
  runOperation?(command: ConfigReleaseOperationCommand): Promise<ConfigReleaseOperationRecord> | ConfigReleaseOperationRecord;
}

/**
 * Strict pre-release gate for ordinary-map equipment. The base content
 * validator remains boot-compatible with the current incomplete frozen
 * package; release tooling can call this gate to prove that the feature is
 * actually publishable. Runtime readiness is closed by GameService only for
 * snapshots that pass these content and exit-policy diagnostics.
 */
export const validateOrdinaryMapEquipmentRelease = (snapshot: ConfigReleaseSnapshot): ConfigReleaseSnapshot => {
  const diagnostics = [...diagnoseContentReachability(snapshot.content), ...diagnoseMapEquipmentReleaseReadiness(snapshot.content, snapshot.parameters)];
  diagnostics.push(...validateEquipmentExitPolicy(snapshot.parameters));
  if (diagnostics.length > 0) throw new ConfigReleaseError('RELEASE_INVALID', 'ordinary-map equipment release contract is not ready', { contract: 'ordinary_map_equipment', diagnostics });
  return clone(snapshot);
};

export const validateConfigReleaseSnapshot = (snapshot: ConfigReleaseSnapshot, options: { requireFormalHighTier?: boolean; requireFormalParameterProvenance?: boolean } = {}): ConfigReleaseSnapshot => {
  if (!snapshot.version || snapshot.version !== snapshot.content.manifest.config_version || snapshot.parameterSha256 !== snapshot.content.manifest.parameter_sha256 || snapshot.contentSha256 !== snapshot.content.manifest.content_sha256) {
    throw new ConfigReleaseError('RELEASE_INVALID', 'active release version or hash does not match its manifest');
  }
  if (!snapshot.parameters || Object.keys(snapshot.parameters).length === 0) throw new ConfigReleaseError('RELEASE_INVALID', 'active release parameter payload is empty');
  assertMigrationPolicy(snapshot.migrationPolicy);
  assertParameterPayloadSchema(snapshot.parameters);
  const highTierDiagnostics = diagnoseHighTierCombatContract(snapshot.parameters);
  if (highTierDiagnostics.length > 0) throw new ConfigReleaseError('RELEASE_INVALID', 'high-tier combat contract is invalid', { contract: 'high_tier', diagnostics: highTierDiagnostics });
  const randomEventDiagnostics = diagnoseRandomEventParameterContract(snapshot.parameters);
  if (randomEventDiagnostics.length > 0) throw new ConfigReleaseError('RELEASE_INVALID', 'random-event parameter contract is invalid', { contract: 'random_event', diagnostics: randomEventDiagnostics });
  if (options.requireFormalHighTier) {
    const provenanceDiagnostics = diagnoseHighTierCombatFormalProvenance(snapshot.parameters);
    if (provenanceDiagnostics.length > 0) throw new ConfigReleaseError('RELEASE_INVALID', 'full_v1 high-tier parameters lack formal provenance', { contract: 'high_tier_provenance', diagnostics: provenanceDiagnostics });
  }
  if (options.requireFormalParameterProvenance) assertParameterPayloadProvenance(snapshot.parameters);
  try {
    validateContentPackage(snapshot.content, snapshot.version, snapshot.parameterSha256);
  } catch (error) {
    throw new ConfigReleaseError('RELEASE_INVALID', error instanceof Error ? error.message : 'content package validation failed');
  }
  assertContentReachability(snapshot.content);
  return clone(snapshot);
};

export class StaticConfigReleaseProvider implements ConfigReleaseProvider {
  private readonly snapshot: ConfigReleaseSnapshot;

  constructor(snapshot: ConfigReleaseSnapshot) {
    this.snapshot = clone(snapshot);
  }

  getActiveSnapshot(): ConfigReleaseSnapshot {
    return clone(this.snapshot);
  }

  getSnapshotForPlayer(_playerId: string): ConfigReleaseSnapshot {
    return this.getActiveSnapshot();
  }

  getSnapshot(version: string): ConfigReleaseSnapshot | null {
    return version === this.snapshot.version ? this.getActiveSnapshot() : null;
  }

  async refresh(): Promise<ConfigReleaseSnapshot> {
    return this.getActiveSnapshot();
  }
}

export type SettlementReplayRecord = {
  settlementId: string;
  configVersion: string;
  seed: number;
  responsePayload: unknown;
  committedAt: string;
};

export type ConfigReleaseErrorCode = 'RELEASE_INVALID' | 'RELEASE_NOT_FOUND' | 'RELEASE_DUPLICATE' | 'INVALID_TRANSITION' | 'SETTLEMENT_DUPLICATE' | 'SETTLEMENT_NOT_FOUND';

export class ConfigReleaseError extends Error {
  readonly code: ConfigReleaseErrorCode;
  readonly details: unknown;

  constructor(code: ConfigReleaseErrorCode, message: string, details?: unknown) {
    super(message);
    this.name = 'ConfigReleaseError';
    this.code = code;
    this.details = details;
  }
}

/** Validate rollout commands at the provider boundary as well as HTTP. */
export const validateConfigReleaseOperationCommand = (command: ConfigReleaseOperationCommand): void => {
  if (command.operation !== 'canary' && command.operation !== 'activate' && command.operation !== 'rollback') throw new ConfigReleaseError('RELEASE_INVALID', 'config operation is unsupported');
  if (typeof command.version !== 'string' || command.version.trim().length === 0 || command.version.length > 256) throw new ConfigReleaseError('RELEASE_INVALID', 'config operation version is invalid');
  if (!command.idempotencyKey || command.idempotencyKey.trim().length === 0 || command.idempotencyKey.length > 512) throw new ConfigReleaseError('RELEASE_INVALID', 'config operation idempotency key is invalid');
  if (!command.requestId || command.requestId.trim().length === 0 || command.requestId.length > 256) throw new ConfigReleaseError('RELEASE_INVALID', 'config operation requestId is invalid');
  if (!command.meta || typeof command.meta.operatorSubject !== 'string' || command.meta.operatorSubject.trim().length === 0 || command.meta.operatorSubject.length > 256) throw new ConfigReleaseError('RELEASE_INVALID', 'config operation operatorSubject is invalid');
  if (typeof command.meta.reason !== 'string' || command.meta.reason.trim().length < 3 || command.meta.reason.length > 500) throw new ConfigReleaseError('RELEASE_INVALID', 'config operation reason must be between 3 and 500 characters');
  if (typeof command.serverTime !== 'string') throw new ConfigReleaseError('RELEASE_INVALID', 'config operation timestamp is invalid');
  const at = new Date(command.serverTime);
  if (!Number.isFinite(at.getTime())) throw new ConfigReleaseError('RELEASE_INVALID', 'config operation timestamp is invalid');
};

const clone = <T>(value: T): T => structuredClone(value);
const nowIso = (value: Date | string | undefined, fallback: () => number): string => {
  const date = value instanceof Date ? value : new Date(value ?? fallback());
  if (!Number.isFinite(date.getTime())) throw new ConfigReleaseError('RELEASE_INVALID', 'release timestamp is invalid');
  return date.toISOString();
};
const validPercent = (value: number): void => {
  if (!Number.isFinite(value) || value <= 0 || value > 100) throw new ConfigReleaseError('RELEASE_INVALID', 'canary percent must be greater than 0 and at most 100');
};

export class ConfigReleaseRegistry {
  private readonly releases = new Map<string, ConfigRelease>();
  private readonly settlements = new Map<string, SettlementReplayRecord>();
  private readonly audits: ConfigReleaseAudit[] = [];
  private readonly operationResponses = new Map<string, ConfigReleaseOperationRecord>();
  private activeVersion: string | null = null;
  private readonly clock: () => number;

  constructor(options: { clock?: () => number } = {}) {
    this.clock = options.clock ?? (() => Date.now());
  }

  registerDraft(input: ConfigReleaseInput): ConfigRelease {
    this.assertReleaseHashes(input);
    if (this.releases.has(input.version)) throw new ConfigReleaseError('RELEASE_DUPLICATE', `release already exists: ${input.version}`);
    const release: ConfigRelease = {
      version: input.version,
      parameterSha256: input.parameterSha256,
      contentSha256: input.contentSha256,
      status: 'draft',
      canaryPercent: 0,
      createdAt: nowIso(input.createdAt, this.clock),
      validatedAt: null,
      activatedAt: null,
      rolledBackAt: null,
      transitionReason: null,
      content: clone(input.content),
      parameters: clone(input.parameters ?? FROZEN_PARAMETERS),
      migrationPolicy: clone(input.migrationPolicy ?? null),
    };
    this.releases.set(release.version, release);
    return clone(release);
  }

  validate(version: string): ConfigRelease {
    const release = this.getMutable(version);
    if (release.status !== 'draft') throw new ConfigReleaseError('INVALID_TRANSITION', `only draft releases can be validated: ${version}`);
    this.assertReleaseHashes(release);
    release.status = 'validated';
    release.validatedAt = new Date(this.clock()).toISOString();
    release.transitionReason = 'manual';
    return clone(release);
  }

  validateOrdinaryMapEquipment(version: string): ConfigRelease {
    const release = this.getMutable(version);
    this.assertReleaseHashes(release);
    validateOrdinaryMapEquipmentRelease({ version: release.version, parameterSha256: release.parameterSha256, contentSha256: release.contentSha256, content: release.content, parameters: release.parameters, migrationPolicy: release.migrationPolicy });
    return clone(release);
  }

  startCanary(version: string, canaryPercent: number, meta?: ConfigReleaseOperationMeta): ConfigRelease {
    validPercent(canaryPercent);
    const release = this.getMutable(version);
    if (release.status !== 'validated') throw new ConfigReleaseError('INVALID_TRANSITION', `only validated releases can enter canary: ${version}`);
    this.assertReleaseHashes(release);
    release.status = 'canary';
    release.canaryPercent = canaryPercent;
    release.transitionReason = 'manual';
    if (meta) this.recordAudit('canary', version, this.activeVersion, this.activeVersion, meta);
    return clone(release);
  }

  activate(version: string, meta?: ConfigReleaseOperationMeta): ConfigRelease {
    const release = this.getMutable(version);
    if (release.status !== 'validated' && release.status !== 'canary' && release.status !== 'rolled_back') throw new ConfigReleaseError('INVALID_TRANSITION', `release cannot become active from ${release.status}: ${version}`);
    this.assertReleaseHashes(release);
    const fromVersion = this.activeVersion;
    this.switchActive(release, 'superseded');
    if (meta) this.recordAudit('activate', version, fromVersion, version, meta);
    return clone(release);
  }

  rollback(targetVersion: string, meta?: ConfigReleaseOperationMeta): ConfigRelease {
    if (!this.activeVersion) throw new ConfigReleaseError('INVALID_TRANSITION', 'there is no active release to roll back');
    if (targetVersion === this.activeVersion) throw new ConfigReleaseError('INVALID_TRANSITION', 'target release is already active');
    const target = this.getMutable(targetVersion);
    if (target.status !== 'validated' && target.status !== 'canary' && target.status !== 'rolled_back') throw new ConfigReleaseError('INVALID_TRANSITION', `release cannot be a rollback target from ${target.status}: ${targetVersion}`);
    this.assertReleaseHashes(target);
    const current = this.getMutable(this.activeVersion);
    current.status = 'rolled_back';
    current.rolledBackAt = new Date(this.clock()).toISOString();
    current.transitionReason = 'rollback';
    this.activeVersion = null;
    this.switchActive(target, 'manual');
    target.transitionReason = 'rollback';
    if (meta) this.recordAudit('rollback', targetVersion, current.version, targetVersion, meta);
    return clone(target);
  }

  current(): ConfigRelease | null {
    return this.activeVersion ? this.get(this.activeVersion) : null;
  }

  getActiveSnapshot(): ConfigReleaseSnapshot | null {
    const release = this.current();
    return release ? { version: release.version, parameterSha256: release.parameterSha256, contentSha256: release.contentSha256, content: release.content, parameters: release.parameters, migrationPolicy: release.migrationPolicy } : null;
  }

  getSnapshot(version: string): ConfigReleaseSnapshot | null {
    const release = this.get(version);
    if (!release) return null;
    return { version: release.version, parameterSha256: release.parameterSha256, contentSha256: release.contentSha256, content: release.content, parameters: release.parameters, migrationPolicy: release.migrationPolicy };
  }

  /** Return the canary snapshot for the stable player bucket, otherwise active. */
  getSnapshotForPlayer(playerId: string): ConfigReleaseSnapshot | null {
    const active = this.current();
    const canaries = [...this.releases.values()]
      .filter((release) => release.status === 'canary')
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt) || right.version.localeCompare(left.version));
    const canary = canaries[0];
    if (canary && this.servesPlayer(canary.version, playerId)) return this.getSnapshot(canary.version);
    return active ? this.getSnapshot(active.version) : canary ? this.getSnapshot(canary.version) : null;
  }

  get(version: string): ConfigRelease | null {
    const release = this.releases.get(version);
    return release ? clone(release) : null;
  }

  list(): ConfigRelease[] {
    return [...this.releases.values()].map(clone);
  }

  listAudits(): ConfigReleaseAudit[] { return this.audits.map(clone); }

  runOperation(command: ConfigReleaseOperationCommand): ConfigReleaseOperationRecord {
    validateConfigReleaseOperationCommand(command);
    const previous = this.operationResponses.get(command.idempotencyKey);
    if (previous) return clone(previous);
    if (command.operation === 'canary') this.startCanary(command.version, command.canaryPercent as number, command.meta);
    else if (command.operation === 'activate') this.activate(command.version, command.meta);
    else this.rollback(command.version, command.meta);
    const record: ConfigReleaseOperationRecord = {
      requestId: command.requestId,
      configVersion: this.activeVersion ?? command.version,
      stateRevision: 0,
      serverTime: command.serverTime,
      data: { operation: command.operation, targetVersion: command.version, activeVersion: this.activeVersion },
    };
    this.operationResponses.set(command.idempotencyKey, clone(record));
    return clone(record);
  }

  private recordAudit(operation: ConfigReleaseLifecycleOperation, targetVersion: string, fromVersion: string | null, toVersion: string | null, meta: ConfigReleaseOperationMeta): void {
    this.audits.push({ auditId: randomUUID(), operation, targetVersion, fromVersion, toVersion, operatorSubject: meta.operatorSubject, reason: meta.reason, createdAt: new Date(this.clock()).toISOString() });
  }

  servesPlayer(version: string, playerId: string): boolean {
    const release = this.getMutable(version);
    if (release.status === 'active') return true;
    if (release.status !== 'canary') return false;
    // The bucket is a function of player identity only. A new canary release
    // therefore does not reshuffle users merely because its version changed.
    const digest = createHash('sha256').update(playerId).digest('hex');
    const bucket = Number.parseInt(digest.slice(0, 8), 16) / 0x100000000 * 100;
    return bucket < release.canaryPercent;
  }

  recordSettlement(record: SettlementReplayRecord): SettlementReplayRecord {
    if (!this.isLive(record.configVersion)) throw new ConfigReleaseError('INVALID_TRANSITION', `settlement config is not active or canary: ${record.configVersion}`);
    if (!Number.isInteger(record.seed) || record.seed < 0 || record.seed > 0xffffffff) throw new ConfigReleaseError('RELEASE_INVALID', 'settlement seed must be an unsigned 32-bit integer');
    if (this.settlements.has(record.settlementId)) throw new ConfigReleaseError('SETTLEMENT_DUPLICATE', `settlement already exists: ${record.settlementId}`);
    const committed: SettlementReplayRecord = { ...clone(record), committedAt: nowIso(record.committedAt, this.clock) };
    this.settlements.set(record.settlementId, committed);
    return clone(committed);
  }

  replaySettlement(settlementId: string): SettlementReplayRecord {
    const record = this.settlements.get(settlementId);
    if (!record) throw new ConfigReleaseError('SETTLEMENT_NOT_FOUND', `settlement does not exist: ${settlementId}`);
    return clone(record);
  }

  private isLive(version: string): boolean {
    const release = this.releases.get(version);
    return release?.status === 'active' || release?.status === 'canary';
  }

  private switchActive(release: ConfigRelease, previousReason: 'manual' | 'superseded'): void {
    if (this.activeVersion && this.activeVersion !== release.version) {
      const previous = this.getMutable(this.activeVersion);
      previous.status = 'rolled_back';
      previous.rolledBackAt = new Date(this.clock()).toISOString();
      previous.transitionReason = previousReason;
    }
    release.status = 'active';
    release.canaryPercent = 100;
    release.activatedAt = new Date(this.clock()).toISOString();
    this.activeVersion = release.version;
  }

  private getMutable(version: string): ConfigRelease {
    const release = this.releases.get(version);
    if (!release) throw new ConfigReleaseError('RELEASE_NOT_FOUND', `release does not exist: ${version}`);
    return release;
  }

  private assertReleaseHashes(input: ConfigReleaseInput | ConfigRelease): void {
    if (!input.version || input.contentSha256 !== input.content.manifest.content_sha256 || input.parameterSha256 !== input.content.manifest.parameter_sha256 || input.version !== input.content.manifest.config_version) {
      throw new ConfigReleaseError('RELEASE_INVALID', 'release version or content/parameter hash does not match its manifest');
    }
    const parameters = (input.parameters ?? FROZEN_PARAMETERS) as ConfigParameterMap;
    assertMigrationPolicy(input.migrationPolicy);
    if (Object.keys(parameters).length === 0) throw new ConfigReleaseError('RELEASE_INVALID', 'release parameter payload is empty');
    assertParameterPayloadSchema(parameters);
    const highTierDiagnostics = diagnoseHighTierCombatContract(parameters);
    if (highTierDiagnostics.length > 0) throw new ConfigReleaseError('RELEASE_INVALID', 'high-tier combat contract is invalid', { contract: 'high_tier', diagnostics: highTierDiagnostics });
    const randomEventDiagnostics = diagnoseRandomEventParameterContract(parameters);
    if (randomEventDiagnostics.length > 0) throw new ConfigReleaseError('RELEASE_INVALID', 'random-event parameter contract is invalid', { contract: 'random_event', diagnostics: randomEventDiagnostics });
    const provenanceDiagnostics = diagnoseHighTierCombatFormalProvenance(parameters);
    if (provenanceDiagnostics.length > 0) throw new ConfigReleaseError('RELEASE_INVALID', 'full_v1 high-tier parameters lack formal provenance', { contract: 'high_tier_provenance', diagnostics: provenanceDiagnostics });
    assertParameterPayloadProvenance(parameters);
    try {
      validateContentPackage(input.content, input.version, input.parameterSha256);
    } catch (error) {
      throw new ConfigReleaseError('RELEASE_INVALID', error instanceof Error ? error.message : 'content package validation failed');
    }
    assertContentReachability(input.content);
  }
}

/**
 * The parameter hash identifies the authoritative source file, but a release
 * payload is stored separately in JSONB.  Validate its value shape before it
 * can enter the lifecycle so malformed values cannot be coerced by runtime
 * helpers such as Number('') into a valid-looking zero.
 */
const assertParameterPayloadSchema = (parameters: ConfigParameterMap): void => {
  for (const [id, baseline] of Object.entries(FROZEN_PARAMETERS)) {
    const entry = parameters[id];
    if (!entry || typeof entry !== 'object' || !Object.prototype.hasOwnProperty.call(entry, 'value')) throw new ConfigReleaseError('RELEASE_INVALID', `release parameter is missing: ${id}`, { path: id, code: 'MISSING' });
    const value = entry.value;
    const expectedType = typeof baseline.value;
    if (expectedType === 'number' && (typeof value !== 'number' || !Number.isFinite(value))) throw new ConfigReleaseError('RELEASE_INVALID', `release parameter must be a finite number: ${id}`, { path: id, code: 'INVALID_TYPE' });
    if (expectedType === 'string' && (typeof value !== 'string' || value.length === 0)) throw new ConfigReleaseError('RELEASE_INVALID', `release parameter must be a non-empty string: ${id}`, { path: id, code: 'INVALID_TYPE' });
  }
  for (const [id, entry] of Object.entries(parameters)) {
    if (!entry || typeof entry !== 'object' || !Object.prototype.hasOwnProperty.call(entry, 'value')) throw new ConfigReleaseError('RELEASE_INVALID', `release parameter is malformed: ${id}`, { path: id, code: 'INVALID_TYPE' });
    if (entry.value === null || entry.value === undefined) throw new ConfigReleaseError('RELEASE_INVALID', `release parameter value is null or undefined: ${id}`, { path: id, code: 'INVALID_TYPE' });
    if (typeof entry.value === 'number' && !Number.isFinite(entry.value)) throw new ConfigReleaseError('RELEASE_INVALID', `release parameter must be finite: ${id}`, { path: id, code: 'INVALID_VALUE' });
    if (typeof entry.value === 'string' && entry.value.length === 0) throw new ConfigReleaseError('RELEASE_INVALID', `release parameter must not be empty: ${id}`, { path: id, code: 'INVALID_VALUE' });
  }
};

/**
 * A release payload is an authoritative input artifact, not a runtime
 * fixture.  Keep the historical `confirmed` status accepted for the eight
 * baseline constants, but reject proposal/test provenance at the lifecycle
 * boundary for every parameter, not only the optional full_v1 contract.
 */
const assertParameterPayloadProvenance = (parameters: ConfigParameterMap): void => {
  for (const [id, entry] of Object.entries(parameters)) {
    const hasStatus = Object.prototype.hasOwnProperty.call(entry, 'status');
    const hasSource = Object.prototype.hasOwnProperty.call(entry, 'source');
    // Historical payloads may override a known frozen value while omitting
    // metadata; its parameter hash still anchors provenance to the frozen
    // source. New/explicitly annotated entries must carry formal metadata.
    if (!hasStatus && !hasSource && Object.prototype.hasOwnProperty.call(FROZEN_PARAMETERS, id)) continue;
    const status = entry.status;
    if (status !== 'confirmed' && status !== 'frozen_v1') {
      throw new ConfigReleaseError('RELEASE_INVALID', `release parameter status is not publishable: ${id}`, { path: `${id}.status`, code: 'INVALID_VALUE' });
    }
    const source = typeof entry.source === 'string' ? entry.source.trim() : '';
    if (source.length === 0) {
      throw new ConfigReleaseError('RELEASE_INVALID', `release parameter source is missing: ${id}`, { path: `${id}.source`, code: 'MISSING' });
    }
    if (/proposal|synthetic|fixture|test/i.test(source)) {
      throw new ConfigReleaseError('RELEASE_INVALID', `release parameter source is not formal: ${id}`, { path: `${id}.source`, code: 'INVALID_VALUE' });
    }
  }
};

const assertContentReachability = (content: ContentPackage): void => {
  const diagnostics = diagnoseContentReachability(content);
  if (diagnostics.length > 0) throw new ConfigReleaseError('RELEASE_INVALID', 'content package has reachable content_pending objects', { contract: 'content_reachability', diagnostics });
};

const assertMigrationPolicy = (policy: ConfigMigrationPolicy | null | undefined): void => {
  if (policy == null) return;
  if (policy.mode !== 'identity' && policy.mode !== 'forward-compatible') throw new ConfigReleaseError('RELEASE_INVALID', 'migration policy mode is unsupported');
  if (!Array.isArray(policy.fromVersions) || policy.fromVersions.length === 0 || policy.fromVersions.some((version) => typeof version !== 'string' || version.length === 0) || new Set(policy.fromVersions).size !== policy.fromVersions.length) throw new ConfigReleaseError('RELEASE_INVALID', 'migration policy fromVersions must contain unique non-empty versions');
};
