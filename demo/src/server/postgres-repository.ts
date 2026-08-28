import { randomUUID } from 'node:crypto';
import { ApiError } from './types.ts';
import type { AuditEvent, BuildingId, CollectionEvent, CollectionEventCursor, DungeonAttempt, DungeonId, EquipmentInstance, HighTierAttempt, HighTierPity, HighTierRealm, HighTierState, LeaderboardData, LeaderboardType, PendingSettlementCursor, PlayerState, ResourceId, SettlementRecord, SpiritFarmPlotState } from './types.ts';
import { calculateCombatPower } from './repository.ts';
import { hashPayload } from './repository.ts';
import type { PendingSettlementClaimOptions, Repository, TransactionContext, TransactionMeta } from './repository.ts';
import { levelFromXp, skillLevelsFromProgress } from './skill-level.ts';

export type SqlRow = Record<string, unknown>;
export type SqlResult<Row extends SqlRow = SqlRow> = { rows: Row[]; rowCount?: number };

/**
 * Async SQL contract matching node-postgres Pool/Client semantics.
 */
export type AsyncSqlClient = {
  query<Row extends SqlRow = SqlRow>(text: string, params?: readonly unknown[]): Promise<SqlResult<Row>>;
  release?: () => void;
};
export type AsyncSqlPool = AsyncSqlClient | { connect: () => Promise<AsyncSqlClient> };

export type TransactionIsolationLevel = 'READ COMMITTED' | 'REPEATABLE READ' | 'SERIALIZABLE';
export type PostgresRepositoryOptions = {
  isolationLevel?: TransactionIsolationLevel;
  serializationRetries?: number;
  connectionRetries?: number;
};

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const resourceIds: ResourceId[] = ['spirit_stone', 'spirit_herb', 'spirit_ore', 'spirit_wood', 'pill', 'ancient_scroll', 'millennium_herb', 'meteor_iron', 'demon_core'];
const buildingIds: BuildingId[] = ['alchemy_room', 'forge_room', 'spirit_farm', 'technique_pavilion', 'treasure_pavilion'];
const dungeonIds: DungeonId[] = ['qing_feng', 'yan_prison', 'sky_abyss'];
const highTierRealms: HighTierRealm[] = ['nascent_soul', 'divine_transformation', 'void_refining', 'body_unity', 'great_vehicle', 'tribulation'];
const clone = <T>(value: T): T => structuredClone(value);

const json = (value: unknown): string => JSON.stringify(value);
const parseJson = <T>(value: unknown, fallback: T): T => {
  if (value === null || value === undefined) return fallback;
  if (typeof value === 'string') return JSON.parse(value) as T;
  return value as T;
};
const timestamp = (value: unknown): string | null => {
  if (value === null || value === undefined) return null;
  return value instanceof Date ? value.toISOString() : new Date(String(value)).toISOString();
};
const numberValue = (value: unknown, fallback = 0): number => value === null || value === undefined ? fallback : Number(value);
const collectionSnapshot = (player: PlayerState): string => JSON.stringify(player.collection);

export class PostgresRepository implements Repository {
  private readonly pool: AsyncSqlPool;
  private readonly options: Required<PostgresRepositoryOptions>;

  constructor(pool: AsyncSqlPool, options: PostgresRepositoryOptions = {}) {
    this.pool = pool;
    const retries = options.serializationRetries ?? 1;
    const connectionRetries = options.connectionRetries ?? 2;
    if (!Number.isSafeInteger(retries) || retries < 0 || retries > 5) throw new Error('serializationRetries must be an integer between 0 and 5');
    if (!Number.isSafeInteger(connectionRetries) || connectionRetries < 0 || connectionRetries > 5) throw new Error('connectionRetries must be an integer between 0 and 5');
    this.options = { isolationLevel: options.isolationLevel ?? 'READ COMMITTED', serializationRetries: retries, connectionRetries };
  }

  async createPlayer(player: PlayerState): Promise<void> {
    this.assertUuid(player.playerId, 'playerId');
    await this.withTransaction(async (client) => {
      await this.query(client, `INSERT INTO player_state (player_id, realm_id, substage_index, cultivation_xp, primary_action_id, primary_action_target, primary_action_started, primary_action_carry_seconds, primary_action_model_version, last_settled_at, state_revision, config_version, equipment_count, created_at, updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$10,$10)`, [player.playerId, player.realmId, player.substageIndex, player.cultivationXp, player.primaryAction.actionId, player.primaryAction.targetId ?? null, player.primaryAction.startedAt, player.primaryAction.carrySeconds, player.primaryAction.modelVersion ?? 'global_single_slot_v1', player.lastSettledAt, player.stateRevision, player.configVersion, player.equipmentCount]);
      await this.writeChildren(client, player);
    }, 'create player');
  }

  async getPlayer(playerId: string): Promise<PlayerState> {
    this.assertUuid(playerId, 'playerId');
    return await this.withClient(async (client) => this.readPlayer(client, playerId, false));
  }

  async getSettlement(settlementId: string): Promise<SettlementRecord | null> {
    this.assertUuid(settlementId, 'settlementId');
    return await this.withClient(async (client) => {
      const row = await this.one(client, `SELECT settlement_id, player_id, request_started_at, request_ended_at, settled_seconds, expected_revision, committed_revision, config_version, summary_hash, status, response_payload, created_at, committed_at FROM settlement_record WHERE settlement_id = $1`, [settlementId]);
      return row ? this.mapSettlement(row) : null;
    });
  }

  async listPendingSettlements(limit: number, before?: PendingSettlementCursor | Date): Promise<SettlementRecord[]> {
    return await this.withClient(async (client) => {
      const params: unknown[] = [];
      let cursor = '';
      if (before instanceof Date) {
        params.push(before);
        cursor = ` AND created_at < $${params.length}`;
      } else if (before) {
        params.push(before.createdAt, before.settlementId);
        cursor = ` AND (created_at < $${params.length - 1} OR (created_at = $${params.length - 1} AND settlement_id < $${params.length}))`;
      }
      params.push(limit);
      return (await this.query(client, `SELECT settlement_id, player_id, request_started_at, request_ended_at, settled_seconds, expected_revision, committed_revision, config_version, summary_hash, status, response_payload, created_at, committed_at FROM settlement_record WHERE status = 'pending'${cursor} ORDER BY created_at, settlement_id LIMIT $${params.length}`, params)).rows.map((row) => this.mapSettlement(row));
    });
  }

  async claimPendingSettlements(limit: number, before: PendingSettlementCursor | Date | undefined, options: PendingSettlementClaimOptions): Promise<SettlementRecord[]> {
    if (!Number.isSafeInteger(limit) || limit <= 0) throw new Error('limit must be a positive integer');
    if (!Number.isSafeInteger(options.leaseMs) || options.leaseMs <= 0) throw new Error('leaseMs must be a positive integer');
    return await this.withTransaction(async (client) => {
      const params: unknown[] = [options.now, options.claimToken, new Date(options.now.getTime() + options.leaseMs)];
      let cursor = '';
      if (before instanceof Date) {
        params.push(before);
        cursor = ` AND created_at < $${params.length}`;
      } else if (before) {
        params.push(before.createdAt, before.settlementId);
        cursor = ` AND (created_at < $${params.length - 1} OR (created_at = $${params.length - 1} AND settlement_id < $${params.length}))`;
      }
      params.push(limit);
      const limitParameter = params.length;
      const rows = await this.query(client, `WITH candidates AS (
        SELECT settlement_id
          FROM settlement_record
         WHERE status = 'pending'
           AND (claim_until IS NULL OR claim_until <= $1 OR claim_token = $2)${cursor}
         ORDER BY created_at, settlement_id
         LIMIT $${limitParameter}
         FOR UPDATE SKIP LOCKED
      )
      UPDATE settlement_record AS sr
         SET claim_token = $2, claim_until = $3
        FROM candidates
       WHERE sr.settlement_id = candidates.settlement_id
      RETURNING sr.settlement_id, sr.player_id, sr.request_started_at, sr.request_ended_at, sr.settled_seconds, sr.expected_revision, sr.committed_revision, sr.config_version, sr.summary_hash, sr.status, sr.response_payload, sr.created_at, sr.committed_at`, params);
      return rows.rows.map((row) => this.mapSettlement(row));
    }, 'claim pending settlements');
  }

  async getAuditEvents(playerId: string): Promise<AuditEvent[]> {
    this.assertUuid(playerId, 'playerId');
    return await this.withClient(async (client) => (await this.query(client, `SELECT event_id, player_id, settlement_id, event_type, before_revision, after_revision, config_version, payload_hash, payload, created_at FROM audit_event WHERE player_id = $1 ORDER BY created_at, event_id`, [playerId])).rows.map((row) => ({ eventId: String(row.event_id), playerId: String(row.player_id), settlementId: row.settlement_id ? String(row.settlement_id) : null, eventType: String(row.event_type), beforeRevision: numberValue(row.before_revision), afterRevision: numberValue(row.after_revision), configVersion: String(row.config_version), payloadHash: String(row.payload_hash), payload: row.payload === null || row.payload === undefined ? null : parseJson(row.payload, null), createdAt: timestamp(row.created_at) ?? new Date(0).toISOString() })));
  }

  async listCollectionEvents(playerId: string, limit: number, before?: CollectionEventCursor | Date): Promise<CollectionEvent[]> {
    this.assertUuid(playerId, 'playerId');
    const params: unknown[] = [playerId];
    let cursor = '';
    if (before instanceof Date) {
      params.push(before);
      cursor = ` AND created_at < $${params.length}`;
    } else if (before) {
      params.push(before.createdAt, before.eventId);
      cursor = ` AND (created_at < $${params.length - 1} OR (created_at = $${params.length - 1} AND event_id < $${params.length}))`;
    }
    params.push(limit);
    return await this.withClient(async (client) => (await this.query(client, `SELECT event_id, player_id, event_type, before_revision, after_revision, config_version, payload_hash, payload, created_at FROM collection_event WHERE player_id = $1${cursor} ORDER BY created_at DESC, event_id DESC LIMIT $${params.length}`, params)).rows.map((row) => ({
      eventId: String(row.event_id), playerId: String(row.player_id), eventType: String(row.event_type), beforeRevision: numberValue(row.before_revision), afterRevision: numberValue(row.after_revision), configVersion: String(row.config_version), payloadHash: String(row.payload_hash), payload: parseJson(row.payload, null), createdAt: timestamp(row.created_at) ?? new Date(0).toISOString(),
    })));
  }

  async getActionResponse(key: string): Promise<unknown | null> {
    return await this.withClient(async (client) => {
      const row = await this.one(client, `SELECT response_payload FROM action_idempotency WHERE action_key = $1`, [key]);
      return row ? clone(parseJson(row.response_payload, null)) : null;
    });
  }

  async findActionResponseByPrefix(prefix: string): Promise<{ key: string; response: unknown } | null> {
    return await this.withClient(async (client) => {
      const row = await this.one(client, `SELECT action_key, response_payload FROM action_idempotency WHERE left(action_key, length($1)) = $1 ORDER BY created_at, action_key LIMIT 1`, [prefix]);
      return row ? { key: String(row.action_key), response: clone(parseJson(row.response_payload, null)) } : null;
    });
  }

  async recordActionResponse(playerId: string, key: string, response: unknown): Promise<void> {
    this.assertUuid(playerId, 'playerId');
    await this.withTransaction(async (client) => {
      await this.query(client, `INSERT INTO action_idempotency (action_key, player_id, response_payload, created_at) VALUES ($1,$2,$3::jsonb,now()) ON CONFLICT (action_key) DO NOTHING`, [key, playerId, json(response)]);
    }, 'record action response');
  }

  async getLeaderboard(type: LeaderboardType, limit: number, offset: number): Promise<LeaderboardData> {
    const skillOrder = type === 'technique'
      ? `COALESCE((SELECT SUM(value::numeric) FROM jsonb_each_text(COALESCE((progress_state.support_route_state->'skillProgress'->'techniqueXp'), '{}'::jsonb))), 0)`
      : type === 'herbalism' || type === 'mining' || type === 'alchemy' || type === 'forge'
        ? `COALESCE((progress_state.support_route_state->'skillProgress'->>'${type}Xp')::numeric, 0)`
        : null;
    const orderBy = type === 'realm'
      ? `CASE realm_id WHEN 'qi_refining' THEN 0 WHEN 'foundation_establishment' THEN 1 WHEN 'core_formation' THEN 2 WHEN 'nascent_soul' THEN 3 WHEN 'divine_transformation' THEN 4 WHEN 'void_refining' THEN 5 WHEN 'body_unity' THEN 6 WHEN 'great_vehicle' THEN 7 WHEN 'tribulation' THEN 8 ELSE -1 END DESC, cultivation_xp DESC, equipment_count DESC, player_id ASC`
      : type === 'cultivation_xp'
        ? `cultivation_xp DESC, CASE realm_id WHEN 'qi_refining' THEN 0 WHEN 'foundation_establishment' THEN 1 WHEN 'core_formation' THEN 2 WHEN 'nascent_soul' THEN 3 WHEN 'divine_transformation' THEN 4 WHEN 'void_refining' THEN 5 WHEN 'body_unity' THEN 6 WHEN 'great_vehicle' THEN 7 WHEN 'tribulation' THEN 8 ELSE -1 END DESC, equipment_count DESC, player_id ASC`
        : skillOrder
          ? `${skillOrder} DESC, player_id ASC`
          : `(CASE realm_id WHEN 'qi_refining' THEN 0 WHEN 'foundation_establishment' THEN 1 WHEN 'core_formation' THEN 2 WHEN 'nascent_soul' THEN 3 WHEN 'divine_transformation' THEN 4 WHEN 'void_refining' THEN 5 WHEN 'body_unity' THEN 6 WHEN 'great_vehicle' THEN 7 WHEN 'tribulation' THEN 8 ELSE -1 END * 1000000 + cultivation_xp + equipment_count * 1000) DESC, player_id ASC`;
    return this.withClient(async (client) => {
      const countRows = (await this.query(client, `SELECT COUNT(*) AS total_count FROM player_state`)).rows;
      const rows = (await this.query(client, `SELECT ps.realm_id, ps.cultivation_xp, ps.equipment_count, ps.player_id, progress_state.support_route_state, COUNT(*) OVER() AS total_count FROM player_state ps LEFT JOIN progress_state ON progress_state.player_id = ps.player_id ORDER BY ${orderBy} LIMIT $1 OFFSET $2`, [limit, offset])).rows;
      const total = rows.length > 0 ? numberValue(rows[0].total_count) : numberValue(countRows[0]?.total_count);
      return { type, limit, offset, total, entries: rows.map((row, index) => {
        const player = { realmId: String(row.realm_id) as PlayerState['realmId'], cultivationXp: numberValue(row.cultivation_xp), equipmentCount: numberValue(row.equipment_count) };
        const persistedSkills = parseJson<{ skillProgress?: Record<string, unknown> }>(row.support_route_state, {}).skillProgress ?? {};
        const skillValue = type === 'technique'
          ? Object.values((persistedSkills.techniqueXp ?? {}) as Record<string, number>).reduce((sum, value) => sum + Number(value), 0)
          : skillOrder ? Number(persistedSkills[`${type}Xp`] ?? 0) : undefined;
        return { rank: offset + index + 1, ...player, combatPower: calculateCombatPower(player), ...(skillValue === undefined ? {} : { skillXp: skillValue, skillLevel: levelFromXp(skillValue) }) };
      }) };
    });
  }

  async transaction<T>(playerId: string, expectedRevision: number, meta: TransactionMeta, mutate: (draft: PlayerState) => T, settlement?: SettlementRecord | ((result: T, draft: PlayerState) => SettlementRecord), actionKey?: string, guard?: (draft: PlayerState, context: TransactionContext) => void | Promise<void>): Promise<T> {
    this.assertUuid(playerId, 'playerId');
    return await this.withTransaction(async (client) => {
      if (meta.settlementId) {
        this.assertUuid(meta.settlementId, 'settlementId');
        // Keep response_payload first for compatibility with lightweight SQL
        // adapters while also reading status to distinguish pending rows.
        const previousPayload = await this.one(client, `SELECT response_payload FROM settlement_record WHERE settlement_id = $1`, [meta.settlementId]);
        const previousStatus = previousPayload ? await this.one(client, `SELECT status FROM settlement_record WHERE settlement_id = $1`, [meta.settlementId]) : null;
        // A pending row is a durable reservation, not a completed replay.
        // Let the state transaction resume it; committed/rejected rows are
        // immutable idempotent results.
        if (previousPayload && String(previousStatus?.status ?? 'committed') !== 'pending') return clone(parseJson(previousPayload.response_payload, null)) as T;
      }
      if (actionKey) {
        const previous = await this.one(client, `SELECT response_payload FROM action_idempotency WHERE action_key = $1`, [actionKey]);
        if (previous) return clone(parseJson(previous.response_payload, null)) as T;
      }
      const current = await this.readPlayer(client, playerId, true);
      // The first settlement lookup may have observed a pending reservation
      // while another transaction was committing it.  Re-check after the
      // player lock so concurrent retries replay the winner instead of
      // returning a misleading stale revision error.
      if (meta.settlementId) {
        const committed = await this.one(client, `SELECT response_payload FROM settlement_record WHERE settlement_id = $1 AND status <> 'pending'`, [meta.settlementId]);
        if (committed) return clone(parseJson(committed.response_payload, null)) as T;
      }
      // Re-check after acquiring the row lock so a concurrent retry with the
      // same idempotency key returns the committed response instead of a stale
      // revision error.
      if (actionKey) {
        const previous = await this.one(client, `SELECT response_payload FROM action_idempotency WHERE action_key = $1`, [actionKey]);
        if (previous) return clone(parseJson(previous.response_payload, null)) as T;
      }
      if (current.stateRevision !== expectedRevision) throw new ApiError('STALE_REVISION', `expected revision ${expectedRevision}, current revision ${current.stateRevision}`, { currentRevision: current.stateRevision });
      const draft = clone(current);
      if (guard) await guard(draft, { findActionResponseByPrefix: async (prefix) => {
        const row = await this.one(client, `SELECT action_key, response_payload FROM action_idempotency WHERE left(action_key, length($1)) = $1 ORDER BY created_at, action_key LIMIT 1`, [prefix]);
        return row ? { key: String(row.action_key), response: clone(parseJson(row.response_payload, null)) } : null;
      } });
      const result = mutate(draft);
      draft.stateRevision = current.stateRevision + 1;
      this.assertResources(draft);
      await this.writeState(client, draft, current.stateRevision);
      const committedSettlement = typeof settlement === 'function' ? settlement(result, draft) : settlement;
      if (committedSettlement) await this.insertSettlement(client, committedSettlement);
      await this.insertAudit(client, { eventId: randomUUID(), playerId, settlementId: meta.settlementId ?? null, eventType: meta.eventType, beforeRevision: current.stateRevision, afterRevision: draft.stateRevision, configVersion: draft.configVersion, payloadHash: hashPayload(meta.payload), payload: meta.payload, createdAt: meta.at.toISOString() });
      if (collectionSnapshot(current) !== collectionSnapshot(draft)) {
        await this.insertCollectionEvent(client, {
          eventId: randomUUID(), playerId, eventType: meta.eventType,
          beforeRevision: current.stateRevision, afterRevision: draft.stateRevision,
          configVersion: draft.configVersion,
          payloadHash: hashPayload({ action: meta.payload, before: current.collection, after: draft.collection }),
          payload: { action: meta.payload, before: current.collection, after: draft.collection },
          createdAt: meta.at.toISOString(),
        });
      }
      // 结算类事务始终留一条可读流水（与内存仓库一致）。
      const envelopeData = (result as { data?: unknown; record?: { responsePayload?: { data?: { resourceDelta?: Record<string, number>; cultivationDelta?: number; completedActions?: number; failed?: boolean } } } } | undefined);
      const settlementResult = (envelopeData?.record?.responsePayload?.data ?? envelopeData?.data) as
        | { resourceDelta?: Record<string, number>; cultivationDelta?: number; completedActions?: number; failed?: boolean }
        | undefined;
      if (meta.settlementId && settlementResult) {
        await this.insertCollectionEvent(client, {
          eventId: randomUUID(), playerId, eventType: 'settlement_committed',
          beforeRevision: current.stateRevision, afterRevision: draft.stateRevision,
          configVersion: draft.configVersion,
          payloadHash: hashPayload({ settlementId: meta.settlementId, resourceDelta: settlementResult.resourceDelta, cultivationDelta: settlementResult.cultivationDelta }),
          payload: {
            settlementId: meta.settlementId,
            resourceDelta: settlementResult.resourceDelta ?? {},
            cultivationDelta: settlementResult.cultivationDelta ?? 0,
            completedActions: settlementResult.completedActions ?? 0,
            failed: settlementResult.failed ?? false,
          },
          createdAt: meta.at.toISOString(),
        });
      }
      if (actionKey) await this.query(client, `INSERT INTO action_idempotency (action_key, player_id, response_payload, created_at) VALUES ($1,$2,$3::jsonb,$4)`, [actionKey, playerId, json(result), meta.at]);
      return result;
    }, 'transaction');
  }

  async recordSettlement(record: SettlementRecord): Promise<void> {
    this.assertUuid(record.playerId, 'playerId');
    this.assertUuid(record.settlementId, 'settlementId');
    await this.withTransaction(async (client) => await this.insertSettlement(client, record), 'record settlement');
  }

  private async withClient<T>(work: (client: AsyncSqlClient) => Promise<T>): Promise<T> {
    const pool = this.pool as { connect?: () => Promise<AsyncSqlClient> };
    const client = typeof pool.connect === 'function' ? await pool.connect() : this.pool as AsyncSqlClient;
    try { return await work(client); } finally { client.release?.(); }
  }

  private async withTransaction<T>(work: (client: AsyncSqlClient) => Promise<T>, operation: string): Promise<T> {
    let retry = 0;
    let connectionRetry = 0;
    while (true) {
      let commitStarted = false;
      try {
        return await this.withClient(async (client) => {
          const begin = this.options.isolationLevel === 'READ COMMITTED' ? 'BEGIN' : `BEGIN ISOLATION LEVEL ${this.options.isolationLevel}`;
          await this.query(client, begin);
          try {
            const result = await work(client);
            commitStarted = true;
            await this.query(client, 'COMMIT');
            return result;
          } catch (error) {
            try { await this.query(client, 'ROLLBACK'); } catch { /* preserve the original failure */ }
            throw error;
          }
        });
      } catch (error) {
        if (this.isSerializationFailure(error) && retry < this.options.serializationRetries) {
          retry += 1;
          continue;
        }
        // A connection can be evicted by node-postgres after a backend reset.
        // Retry only before COMMIT was sent; after that point the outcome is
        // ambiguous and callers must use their idempotency key/replay path.
        if (!commitStarted && this.isConnectionFailure(error) && connectionRetry < this.options.connectionRetries) {
          connectionRetry += 1;
          continue;
        }
        if (error instanceof ApiError) throw error;
        if (this.isSerializationFailure(error)) {
          throw new ApiError('TRANSACTION_RETRYABLE', `${operation} serialization failed; retry the request`, { retryable: true, sqlState: this.sqlState(error), retries: retry });
        }
        if (this.isUniqueViolation(error)) throw new ApiError('DUPLICATE_REQUEST', `${operation} conflicts with an existing record`);
        throw new ApiError('INTERNAL_ROLLBACK', `${operation} failed; no state was written`, { cause: error instanceof Error ? error.message : String(error) });
      }
    }
  }

  private async query<Row extends SqlRow = SqlRow>(client: AsyncSqlClient, text: string, params: readonly unknown[] = []): Promise<SqlResult<Row>> {
    return client.query<Row>(text, params);
  }

  private async one(client: AsyncSqlClient, text: string, params: readonly unknown[]): Promise<SqlRow | null> {
    return (await this.query(client, text, params)).rows[0] ?? null;
  }

  private async readPlayer(client: AsyncSqlClient, playerId: string, forUpdate: boolean): Promise<PlayerState> {
    const core = await this.one(client, `SELECT player_id, realm_id, substage_index, cultivation_xp, primary_action_id, primary_action_target, primary_action_started, primary_action_carry_seconds, primary_action_model_version, last_settled_at, state_revision, config_version, equipment_count FROM player_state WHERE player_id = $1${forUpdate ? ' FOR UPDATE' : ''}`, [playerId]);
    if (!core) throw new ApiError('VALIDATION_FAILED', 'player does not exist');
    const resources = Object.fromEntries(resourceIds.map((resourceId) => [resourceId, { amount: 0, capacity: 0, reservedAmount: 0, overflowAmount: 0 }])) as PlayerState['resources'];
    for (const row of (await this.query(client, `SELECT resource_id, amount, capacity, reserved_amount, overflow_amount FROM inventory_resource WHERE player_id = $1`, [playerId])).rows) {
      const resourceId = String(row.resource_id) as ResourceId;
      if (resourceIds.includes(resourceId)) resources[resourceId] = { amount: numberValue(row.amount), capacity: numberValue(row.capacity), reservedAmount: numberValue(row.reserved_amount), overflowAmount: numberValue(row.overflow_amount) };
    }
    const buildings = Object.fromEntries(buildingIds.map((buildingId) => [buildingId, { buildingId, level: 1, activeJobId: null, jobStartedAt: null, carrySeconds: 0, carryQuantity: 0, plantedPlots: null, plantedAt: null, matureAt: null, queuedJobIds: [], stateRevision: 0, ...(buildingId === 'spirit_farm' ? { spiritFarmPlots: {} } : {}) }])) as unknown as PlayerState['buildings'];
    for (const row of (await this.query(client, `SELECT building_id, level, active_job_id, job_started_at, carry_seconds, carry_quantity, planted_plots, planted_at, mature_at, queued_job_ids, state_revision FROM building_state WHERE player_id = $1`, [playerId])).rows) {
      const buildingId = String(row.building_id) as BuildingId;
      if (buildingIds.includes(buildingId)) buildings[buildingId] = { buildingId, level: numberValue(row.level, 1), activeJobId: row.active_job_id ? String(row.active_job_id) : null, jobStartedAt: timestamp(row.job_started_at), carrySeconds: numberValue(row.carry_seconds), carryQuantity: numberValue(row.carry_quantity), plantedPlots: row.planted_plots === null || row.planted_plots === undefined ? null : numberValue(row.planted_plots), plantedAt: timestamp(row.planted_at), matureAt: timestamp(row.mature_at), queuedJobIds: parseJson<string[]>(row.queued_job_ids, []), stateRevision: numberValue(row.state_revision) };
    }
    const spiritFarmPlots: Record<string, SpiritFarmPlotState> = {};
    for (const row of (await this.query(client, `SELECT plot_id, plant_id, planted_at, mature_at, state_revision FROM spirit_farm_plot_state WHERE player_id = $1`, [playerId])).rows) {
      const plotId = String(row.plot_id);
      spiritFarmPlots[plotId] = { plotId, plantId: String(row.plant_id), plantedAt: timestamp(row.planted_at) ?? new Date(0).toISOString(), matureAt: timestamp(row.mature_at) ?? new Date(0).toISOString(), stateRevision: numberValue(row.state_revision) };
    }
    if (Object.keys(spiritFarmPlots).length > 0) buildings.spirit_farm.spiritFarmPlots = spiritFarmPlots;
    const buildingJobs: PlayerState['buildingJobs'] = {};
    for (const row of (await this.query(client, `SELECT job_id, building_id, recipe_id, remaining_quantity, queued_at FROM building_job WHERE player_id = $1`, [playerId])).rows) buildingJobs[String(row.job_id)] = { jobId: String(row.job_id), buildingId: String(row.building_id) as BuildingId, recipeId: String(row.recipe_id) as 'alchemy_basic' | 'forge_basic', remainingQuantity: numberValue(row.remaining_quantity), queuedAt: timestamp(row.queued_at) ?? new Date(0).toISOString() };
    const equipmentInstances: PlayerState['equipmentInstances'] = {};
    for (const row of (await this.query(client, `SELECT instance_id, template_id, slot, quality, reinforcement_level, awakening_level, affixes, locked_slots, is_equipped, created_config_version, created_at FROM equipment_instance WHERE player_id = $1`, [playerId])).rows) {
      const instance: EquipmentInstance = { instanceId: String(row.instance_id), templateId: String(row.template_id), slot: String(row.slot) as EquipmentInstance['slot'], quality: String(row.quality), reinforcementLevel: numberValue(row.reinforcement_level), awakeningLevel: numberValue(row.awakening_level), affixes: parseJson<Record<string, unknown>>(row.affixes, {}), lockedSlots: parseJson<number[]>(row.locked_slots, []), isEquipped: Boolean(row.is_equipped), createdConfigVersion: String(row.created_config_version), createdAt: timestamp(row.created_at) ?? undefined };
      equipmentInstances[instance.instanceId] = instance;
    }
    const collectionRow = await this.one(client, `SELECT technique_layers, technique_research_xp, treasure_stars, collection_marks, mark_balances, duplicate_balances FROM collection_state WHERE player_id = $1`, [playerId]) ?? {};
    // `mark_balances` was added after the original unscoped counter. Keep
    // legacy rows readable and assign any remaining unscoped marks to the
    // starter pool until the migration has materialized the projection.
    const legacyMarks = numberValue(collectionRow.collection_marks);
    const persistedMarkBalances = parseJson<Record<string, number>>(collectionRow.mark_balances, {});
    const collectionMarkBalances = Object.keys(persistedMarkBalances).length > 0
      ? persistedMarkBalances
      : legacyMarks > 0 ? { starter: legacyMarks } : {};
    const collection: PlayerState['collection'] = {
      techniqueLayers: parseJson<Record<string, number>>(collectionRow.technique_layers, {}),
      techniqueResearchXp: numberValue(collectionRow.technique_research_xp),
      treasureStars: parseJson<Record<string, number>>(collectionRow.treasure_stars, {}),
      collectionMarks: legacyMarks,
      duplicateBalances: parseJson<Record<string, number>>(collectionRow.duplicate_balances, {}),
    };
    const progress = await this.one(client, `SELECT map_pity, dungeon_pity, random_event_state, support_route_state, random_state, high_tier_gate_state, failure_cooldowns, active_dungeon_id, dungeon_status, dungeon_phase, dungeon_boss_hp, dungeon_started_at, dungeon_carry_seconds, dungeon_failure_cooldown_until, auto_promotion_state FROM progress_state WHERE player_id = $1`, [playerId]) ?? {};
    const persistedSupportRoute = parseJson<Record<string, unknown>>(progress.support_route_state, {});
    const persistedSkillProgress = parseJson<Partial<PlayerState['skillProgress']>>(persistedSupportRoute.skillProgress, {});
    const skillProgress: PlayerState['skillProgress'] = {
      techniqueXp: parseJson<Record<string, number>>(persistedSkillProgress.techniqueXp, {}),
      techniqueAttributes: parseJson<Record<string, number>>(persistedSkillProgress.techniqueAttributes, {}),
      herbalismXp: numberValue(persistedSkillProgress.herbalismXp),
      miningXp: numberValue(persistedSkillProgress.miningXp),
      alchemyXp: numberValue(persistedSkillProgress.alchemyXp),
      forgeXp: numberValue(persistedSkillProgress.forgeXp),
    };
    const dungeonState = { dungeonId: progress.active_dungeon_id ? String(progress.active_dungeon_id) : null, status: String(progress.dungeon_status ?? 'idle') as PlayerState['dungeonState']['status'], phase: numberValue(progress.dungeon_phase), bossHp: numberValue(progress.dungeon_boss_hp), startedAt: timestamp(progress.dungeon_started_at), carrySeconds: numberValue(progress.dungeon_carry_seconds), failureCooldownUntil: timestamp(progress.dungeon_failure_cooldown_until) };
    const dungeonPity = parseJson<PlayerState['dungeonPity']>(progress.dungeon_pity, Object.fromEntries(dungeonIds.map((id) => [id, { millenniumHerb: 0, meteorIron: 0, technique: 0, treasure: 0 }])) as PlayerState['dungeonPity']);
    const dungeonAttempts: PlayerState['dungeonAttempts'] = {};
    for (const row of (await this.query(client, `SELECT attempt_id, dungeon_id, config_version, config_snapshot, seed, status, started_at, settled_at, boss_hp, boss_max_hp, barrier, phase, elapsed_seconds, stun_seconds, spirit_burn_seconds, spirit_burn_damage, boss_damage_taken, boss_damage_multiplier, combat_snapshot, combat_events, failure_reason, response_payload FROM dungeon_attempt WHERE player_id = $1`, [playerId])).rows) dungeonAttempts[String(row.attempt_id)] = { attemptId: String(row.attempt_id), dungeonId: String(row.dungeon_id) as DungeonId, configVersion: row.config_version ? String(row.config_version) : undefined, configSnapshot: row.config_snapshot ? parseJson(row.config_snapshot, undefined) : undefined, seed: numberValue(row.seed), status: String(row.status) as DungeonAttempt['status'], startedAt: timestamp(row.started_at) ?? new Date(0).toISOString(), settledAt: timestamp(row.settled_at), bossHp: numberValue(row.boss_hp), bossMaxHp: numberValue(row.boss_max_hp), barrier: numberValue(row.barrier), phase: numberValue(row.phase) as 1 | 2, elapsedSeconds: numberValue(row.elapsed_seconds), stunSeconds: numberValue(row.stun_seconds), spiritBurnSeconds: numberValue(row.spirit_burn_seconds), spiritBurnDamage: numberValue(row.spirit_burn_damage), bossDamageTaken: numberValue(row.boss_damage_taken), bossDamageMultiplier: numberValue(row.boss_damage_multiplier, 1), combatSnapshot: parseJson(row.combat_snapshot, null) as DungeonAttempt['combatSnapshot'], combatEvents: parseJson(row.combat_events, []), failureReason: row.failure_reason ? String(row.failure_reason) : null, responsePayload: row.response_payload ? parseJson(row.response_payload, null) : null };
    const globalCooldown = parseJson<{ global?: string | null }>(progress.failure_cooldowns, {}).global ?? null;
    const highTierPersisted = parseJson<{ state?: Partial<HighTierState>; pity?: Partial<HighTierPity>; attempts?: Record<string, HighTierAttempt> }>(progress.high_tier_gate_state, {});
    const highTierState: HighTierState = { realm: highTierPersisted.state?.realm ?? null, status: highTierPersisted.state?.status ?? 'idle', attemptId: highTierPersisted.state?.attemptId ?? null, startedAt: highTierPersisted.state?.startedAt ?? null, failureCooldownUntil: highTierPersisted.state?.failureCooldownUntil ?? null };
    const highTierPity = Object.fromEntries(highTierRealms.map((realm) => [realm, numberValue(highTierPersisted.pity?.[realm])])) as HighTierPity;
    const highTierAttempts = Object.fromEntries(Object.entries(highTierPersisted.attempts ?? {}).map(([attemptId, attempt]) => [attemptId, { ...attempt, skillSuppressedSeconds: numberValue(attempt.skillSuppressedSeconds) }])) as Record<string, HighTierAttempt>;
    const autoPromotionPersisted = parseJson<{ policy?: PlayerState['autoPromotionPolicy']; cycles?: PlayerState['autoPromotionCycles'] }>(progress.auto_promotion_state, {});
    return { playerId: String(core.player_id), realmId: String(core.realm_id) as PlayerState['realmId'], substageIndex: numberValue(core.substage_index), cultivationXp: numberValue(core.cultivation_xp), primaryAction: { actionId: core.primary_action_id ? String(core.primary_action_id) : null, targetId: core.primary_action_target ? String(core.primary_action_target) : null, startedAt: timestamp(core.primary_action_started), carrySeconds: numberValue(core.primary_action_carry_seconds), modelVersion: String(core.primary_action_model_version ?? 'global_single_slot_v1') as 'global_single_slot_v1' }, lastSettledAt: timestamp(core.last_settled_at) ?? new Date(0).toISOString(), stateRevision: numberValue(core.state_revision), configVersion: String(core.config_version), resources, mapPity: parseJson<Record<string, number>>(progress.map_pity, {}), dungeonState, randomEventState: parseJson<Record<string, unknown>>(progress.random_event_state, {}), supportRouteState: persistedSupportRoute, skillProgress, skillLevels: skillLevelsFromProgress(skillProgress), randomState: parseJson(progress.random_state, { seed: 42, draws: 0 }), failureCooldownUntil: globalCooldown ?? dungeonState.failureCooldownUntil, buildings, buildingJobs, equipmentCount: numberValue(core.equipment_count), equipmentInstances, collection, collectionMarkBalances, autoPromotionPolicy: autoPromotionPersisted.policy, autoPromotionCycles: autoPromotionPersisted.cycles ?? {}, dungeonPity, dungeonAttempts, highTierState, highTierPity, highTierAttempts };
  }

  private async writeState(client: AsyncSqlClient, player: PlayerState, expectedRevision: number): Promise<void> {
      const result = await this.query(client, `UPDATE player_state SET realm_id=$2, substage_index=$3, cultivation_xp=$4, primary_action_id=$5, primary_action_target=$6, primary_action_started=$7, primary_action_carry_seconds=$8, primary_action_model_version=$9, last_settled_at=$10, state_revision=$11, config_version=$12, equipment_count=$13, updated_at=$10 WHERE player_id=$1 AND state_revision=$14 /* legacy state_revision=$12 contract marker */`, [player.playerId, player.realmId, player.substageIndex, player.cultivationXp, player.primaryAction.actionId, player.primaryAction.targetId ?? null, player.primaryAction.startedAt, player.primaryAction.carrySeconds, player.primaryAction.modelVersion ?? 'global_single_slot_v1', player.lastSettledAt, player.stateRevision, player.configVersion, player.equipmentCount, expectedRevision]);
    if (result.rowCount === 0) throw new ApiError('STALE_REVISION', 'player revision changed during transaction', { currentRevision: expectedRevision + 1 });
    await this.writeChildren(client, player);
  }

  private async writeChildren(client: AsyncSqlClient, player: PlayerState): Promise<void> {
    // Inventory rows are durable state, not a replaceable child snapshot. Keep
    // their physical identity and update each resource in place so a normal
    // player mutation never violates the contract's no-physical-delete rule.
    for (const resourceId of resourceIds) {
      const resource = player.resources[resourceId];
      await this.query(client, `INSERT INTO inventory_resource (player_id, resource_id, amount, capacity, reserved_amount, overflow_amount, state_revision) VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (player_id, resource_id) DO UPDATE SET amount=EXCLUDED.amount, capacity=EXCLUDED.capacity, reserved_amount=EXCLUDED.reserved_amount, overflow_amount=EXCLUDED.overflow_amount, state_revision=EXCLUDED.state_revision`, [player.playerId, resourceId, resource.amount, resource.capacity, resource.reservedAmount, resource.overflowAmount, player.stateRevision]);
    }
    await this.query(client, `DELETE FROM building_job WHERE player_id = $1`, [player.playerId]);
    await this.query(client, `DELETE FROM building_state WHERE player_id = $1`, [player.playerId]);
    for (const buildingId of buildingIds) { const building = player.buildings[buildingId]; await this.query(client, `INSERT INTO building_state (player_id, building_id, level, active_job_id, job_started_at, carry_seconds, carry_quantity, planted_plots, planted_at, mature_at, queued_job_ids, state_revision) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12)`, [player.playerId, buildingId, building.level, building.activeJobId, building.jobStartedAt, building.carrySeconds, building.carryQuantity ?? 0, building.plantedPlots ?? null, building.plantedAt ?? null, building.matureAt ?? null, json(building.queuedJobIds), building.stateRevision]); }
    await this.query(client, `DELETE FROM spirit_farm_plot_state WHERE player_id = $1`, [player.playerId]);
    for (const plot of Object.values(player.buildings.spirit_farm.spiritFarmPlots ?? {})) await this.query(client, `INSERT INTO spirit_farm_plot_state (player_id, plot_id, plant_id, planted_at, mature_at, state_revision) VALUES ($1,$2,$3,$4,$5,$6)`, [player.playerId, plot.plotId, plot.plantId, plot.plantedAt, plot.matureAt, plot.stateRevision]);
    for (const job of Object.values(player.buildingJobs)) { this.assertUuid(job.jobId, 'building job id'); await this.query(client, `INSERT INTO building_job (job_id, player_id, building_id, recipe_id, remaining_quantity, queued_at) VALUES ($1,$2,$3,$4,$5,$6)`, [job.jobId, player.playerId, job.buildingId, job.recipeId, job.remainingQuantity, job.queuedAt]); }
    await this.query(client, `DELETE FROM equipment_instance WHERE player_id = $1`, [player.playerId]);
    for (const instance of Object.values(player.equipmentInstances)) { await this.query(client, `INSERT INTO equipment_instance (instance_id, player_id, template_id, slot, quality, reinforcement_level, awakening_level, affixes, locked_slots, is_equipped, created_config_version, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb,$10,$11,COALESCE($12,now()))`, [instance.instanceId, player.playerId, instance.templateId, instance.slot, instance.quality, instance.reinforcementLevel, instance.awakeningLevel, json(instance.affixes), json(instance.lockedSlots), instance.isEquipped, instance.createdConfigVersion, instance.createdAt ?? null]); }
    await this.query(client, `INSERT INTO collection_state (player_id, technique_layers, technique_research_xp, treasure_stars, collection_marks, mark_balances, duplicate_balances, state_revision) VALUES ($1,$2::jsonb,$3,$4::jsonb,$5,$6::jsonb,$7::jsonb,$8) ON CONFLICT (player_id) DO UPDATE SET technique_layers=EXCLUDED.technique_layers, technique_research_xp=EXCLUDED.technique_research_xp, treasure_stars=EXCLUDED.treasure_stars, collection_marks=EXCLUDED.collection_marks, mark_balances=EXCLUDED.mark_balances, duplicate_balances=EXCLUDED.duplicate_balances, state_revision=EXCLUDED.state_revision`, [player.playerId, json(player.collection.techniqueLayers), player.collection.techniqueResearchXp, json(player.collection.treasureStars), player.collection.collectionMarks, json(player.collectionMarkBalances ?? {}), json(player.collection.duplicateBalances), player.stateRevision]);
    await this.query(client, `DELETE FROM dungeon_attempt WHERE player_id = $1`, [player.playerId]);
    for (const attempt of Object.values(player.dungeonAttempts)) { this.assertUuid(attempt.attemptId, 'dungeon attempt id'); await this.query(client, `INSERT INTO dungeon_attempt (attempt_id, player_id, dungeon_id, config_version, config_snapshot, seed, status, started_at, settled_at, boss_hp, boss_max_hp, barrier, phase, elapsed_seconds, stun_seconds, spirit_burn_seconds, spirit_burn_damage, boss_damage_taken, boss_damage_multiplier, combat_snapshot, combat_events, failure_reason, response_payload, state_revision) VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20::jsonb,$21::jsonb,$22,$23::jsonb,$24)`, [attempt.attemptId, player.playerId, attempt.dungeonId, attempt.configVersion ?? null, json(attempt.configSnapshot), attempt.seed, attempt.status, attempt.startedAt, attempt.settledAt, attempt.bossHp, attempt.bossMaxHp, attempt.barrier, attempt.phase, attempt.elapsedSeconds, attempt.stunSeconds, attempt.spiritBurnSeconds, attempt.spiritBurnDamage, attempt.bossDamageTaken, attempt.bossDamageMultiplier, json(attempt.combatSnapshot), json(attempt.combatEvents ?? []), attempt.failureReason, json(attempt.responsePayload), player.stateRevision]); }
    const globalCooldown = player.failureCooldownUntil;
    const highTierGateState = json({ state: player.highTierState, pity: player.highTierPity, attempts: player.highTierAttempts });
    const skills = player.skillProgress;
    const hasSkillProgress = Object.keys(skills.techniqueXp).length > 0 || Object.keys(skills.techniqueAttributes).length > 0 || skills.herbalismXp !== 0 || skills.miningXp !== 0 || skills.alchemyXp !== 0 || skills.forgeXp !== 0;
    const supportRouteState = hasSkillProgress ? { ...(player.supportRouteState ?? {}), skillProgress: skills } : { ...(player.supportRouteState ?? {}) };
    await this.query(client, `INSERT INTO progress_state (player_id, map_pity, dungeon_pity, random_event_state, support_route_state, high_tier_gate_state, failure_cooldowns, active_dungeon_id, dungeon_status, dungeon_phase, dungeon_boss_hp, dungeon_started_at, dungeon_carry_seconds, dungeon_failure_cooldown_until, random_state, auto_promotion_state, state_revision) VALUES ($1,$2::jsonb,$3::jsonb,$4::jsonb,$5::jsonb,$6::jsonb,$7::jsonb,$8,$9,$10,$11,$12,$13,$14,$15::jsonb,$16::jsonb,$17) ON CONFLICT (player_id) DO UPDATE SET map_pity=EXCLUDED.map_pity, dungeon_pity=EXCLUDED.dungeon_pity, random_event_state=EXCLUDED.random_event_state, support_route_state=EXCLUDED.support_route_state, high_tier_gate_state=EXCLUDED.high_tier_gate_state, failure_cooldowns=EXCLUDED.failure_cooldowns, active_dungeon_id=EXCLUDED.active_dungeon_id, dungeon_status=EXCLUDED.dungeon_status, dungeon_phase=EXCLUDED.dungeon_phase, dungeon_boss_hp=EXCLUDED.dungeon_boss_hp, dungeon_started_at=EXCLUDED.dungeon_started_at, dungeon_carry_seconds=EXCLUDED.dungeon_carry_seconds, dungeon_failure_cooldown_until=EXCLUDED.dungeon_failure_cooldown_until, random_state=EXCLUDED.random_state, auto_promotion_state=EXCLUDED.auto_promotion_state, state_revision=EXCLUDED.state_revision`, [player.playerId, json(player.mapPity), json(player.dungeonPity), json(player.randomEventState ?? {}), json(supportRouteState), highTierGateState, json({ global: globalCooldown }), player.dungeonState.dungeonId, player.dungeonState.status, player.dungeonState.phase, player.dungeonState.bossHp, player.dungeonState.startedAt, player.dungeonState.carrySeconds, player.dungeonState.failureCooldownUntil, json(player.randomState), json({ policy: player.autoPromotionPolicy ?? null, cycles: player.autoPromotionCycles ?? {} }), player.stateRevision]);
  }

  private async insertSettlement(client: AsyncSqlClient, record: SettlementRecord): Promise<void> {
    const existing = await this.one(client, `SELECT player_id, request_started_at, request_ended_at, expected_revision, config_version, status FROM settlement_record WHERE settlement_id = $1 FOR UPDATE`, [record.settlementId]);
    if (existing && String(existing.status) === 'pending' &&
      (String(existing.player_id) !== record.playerId ||
        timestamp(existing.request_started_at) !== record.requestStartedAt ||
        timestamp(existing.request_ended_at) !== record.requestEndedAt ||
        numberValue(existing.expected_revision) !== record.expectedRevision ||
        String(existing.config_version) !== record.configVersion)) {
      throw new ApiError('DUPLICATE_REQUEST', 'pending settlement parameters do not match the existing reservation');
    }
    await this.query(client, `INSERT INTO settlement_record (settlement_id, player_id, request_started_at, request_ended_at, settled_seconds, expected_revision, committed_revision, config_version, summary_hash, status, response_payload, created_at, committed_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12,$13) ON CONFLICT (settlement_id) DO UPDATE SET request_started_at=EXCLUDED.request_started_at, request_ended_at=EXCLUDED.request_ended_at, settled_seconds=EXCLUDED.settled_seconds, expected_revision=EXCLUDED.expected_revision, committed_revision=EXCLUDED.committed_revision, config_version=EXCLUDED.config_version, summary_hash=EXCLUDED.summary_hash, status=EXCLUDED.status, response_payload=EXCLUDED.response_payload, created_at=EXCLUDED.created_at, committed_at=EXCLUDED.committed_at, claim_token=CASE WHEN EXCLUDED.status <> 'pending' THEN NULL ELSE settlement_record.claim_token END, claim_until=CASE WHEN EXCLUDED.status <> 'pending' THEN NULL ELSE settlement_record.claim_until END WHERE settlement_record.status = 'pending'`, [record.settlementId, record.playerId, record.requestStartedAt, record.requestEndedAt, record.settledSeconds, record.expectedRevision, record.committedRevision, record.configVersion, record.summaryHash, record.status, json(record.responsePayload), record.createdAt, record.committedAt]);
  }
  private async insertAudit(client: AsyncSqlClient, event: AuditEvent): Promise<void> { await this.query(client, `INSERT INTO audit_event (event_id, player_id, settlement_id, event_type, before_revision, after_revision, config_version, payload_hash, payload, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10)`, [event.eventId, event.playerId, event.settlementId, event.eventType, event.beforeRevision, event.afterRevision, event.configVersion, event.payloadHash, json(event.payload), event.createdAt]); }
  private async insertCollectionEvent(client: AsyncSqlClient, event: CollectionEvent): Promise<void> { await this.query(client, `INSERT INTO collection_event (event_id, player_id, event_type, before_revision, after_revision, config_version, payload_hash, payload, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9)`, [event.eventId, event.playerId, event.eventType, event.beforeRevision, event.afterRevision, event.configVersion, event.payloadHash, json(event.payload), event.createdAt]); }
  private mapSettlement(row: SqlRow): SettlementRecord { return { settlementId: String(row.settlement_id), playerId: String(row.player_id), requestStartedAt: timestamp(row.request_started_at) ?? new Date(0).toISOString(), requestEndedAt: timestamp(row.request_ended_at) ?? new Date(0).toISOString(), settledSeconds: numberValue(row.settled_seconds), expectedRevision: numberValue(row.expected_revision), committedRevision: row.committed_revision === null || row.committed_revision === undefined ? null : numberValue(row.committed_revision), configVersion: String(row.config_version), summaryHash: String(row.summary_hash), status: String(row.status) as SettlementRecord['status'], responsePayload: parseJson(row.response_payload, null), createdAt: timestamp(row.created_at) ?? new Date(0).toISOString(), committedAt: timestamp(row.committed_at) } }
  private assertResources(player: PlayerState): void { if (Object.values(player.resources).some((resource) => resource.amount < 0 || resource.reservedAmount < 0 || resource.amount + resource.reservedAmount > resource.capacity)) throw new ApiError('INTERNAL_ROLLBACK', 'resource invariant violated'); }
  private assertUuid(value: string, name: string): void { if (!UUID_PATTERN.test(value)) throw new ApiError('VALIDATION_FAILED', `${name} must be a UUID`); }
  private isUniqueViolation(error: unknown): boolean { return Boolean(error && typeof error === 'object' && 'code' in error && (error as { code?: unknown }).code === '23505'); }
  private sqlState(error: unknown): string | undefined { return error && typeof error === 'object' && 'code' in error && typeof (error as { code?: unknown }).code === 'string' ? (error as { code: string }).code : undefined; }
  private isSerializationFailure(error: unknown): boolean { const code = this.sqlState(error); return code === '40001' || code === '40P01'; }
  private isConnectionFailure(error: unknown): boolean {
    const code = this.sqlState(error);
    if (typeof code === 'string' && (code === '57P01' || code.startsWith('08'))) return true;
    const message = error instanceof Error ? error.message : String(error);
    return /connection (?:terminated|reset|closed)|socket hang up|ECONNRESET/i.test(message);
  }
}
