import { createHash, randomUUID } from 'node:crypto';
import { ApiError, CONFIG_VERSION } from './types.ts';
import { SINGLE_SLOT_ACTION_MODEL } from './types.ts';
import type { AuditEvent, CollectionEvent, CollectionEventCursor, DungeonId, HighTierRealm, LeaderboardData, LeaderboardType, PendingSettlementCursor, PlayerState, SettlementRecord } from './types.ts';
import { levelFromXp, skillLevelsFromProgress, skillXpTotal } from './skill-level.ts';

export type PendingSettlementClaimOptions = {
  claimToken: string;
  now: Date;
  leaseMs: number;
};

const clone = <T>(value: T): T => structuredClone(value);
const canonicalPayload = (value: unknown): unknown => {
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(canonicalPayload);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value as Record<string, unknown>).sort().map((key) => [key, canonicalPayload((value as Record<string, unknown>)[key])]));
  return value;
};
export const hashPayload = (value: unknown): string => createHash('sha256').update(JSON.stringify(canonicalPayload(value))).digest('hex');

export type TransactionMeta = { eventType: string; settlementId?: string | null; payload: unknown; at: Date };
export type TransactionContext = { findActionResponseByPrefix(prefix: string): Promise<{ key: string; response: unknown } | null> };
const collectionSnapshot = (player: PlayerState): string => JSON.stringify(player.collection);

const realmRank: Record<string, number> = { qi_refining: 0, foundation_establishment: 1, core_formation: 2, nascent_soul: 3, divine_transformation: 4, void_refining: 5, body_unity: 6, great_vehicle: 7, tribulation: 8 };
export const calculateCombatPower = (player: Pick<PlayerState, 'realmId' | 'cultivationXp' | 'equipmentCount'>): number => (realmRank[player.realmId] ?? 0) * 1_000_000 + player.cultivationXp + player.equipmentCount * 1_000;
const skillXp = (player: PlayerState, type: LeaderboardType): number => skillXpTotal(player, type as 'technique' | 'herbalism' | 'mining' | 'alchemy' | 'forge');
const compareLeaderboard = (left: { player: PlayerState; combatPower: number }, right: { player: PlayerState; combatPower: number }, type: LeaderboardType): number => {
  const leftRank = realmRank[left.player.realmId] ?? -1;
  const rightRank = realmRank[right.player.realmId] ?? -1;
  const primary = type === 'realm' ? rightRank - leftRank : type === 'cultivation_xp' ? right.player.cultivationXp - left.player.cultivationXp : type === 'combat_power' ? right.combatPower - left.combatPower : skillXp(right.player, type) - skillXp(left.player, type);
  if (primary !== 0) return primary;
  if (rightRank !== leftRank) return rightRank - leftRank;
  if (right.player.cultivationXp !== left.player.cultivationXp) return right.player.cultivationXp - left.player.cultivationXp;
  if (right.combatPower !== left.combatPower) return right.combatPower - left.combatPower;
  return left.player.playerId.localeCompare(right.player.playerId);
};

export interface Repository {
  createPlayer(player: PlayerState): Promise<void>;
  getPlayer(playerId: string): Promise<PlayerState>;
  getSettlement(settlementId: string): Promise<SettlementRecord | null>;
  listPendingSettlements(limit: number, before?: PendingSettlementCursor | Date): Promise<SettlementRecord[]>;
  /** Atomically claims a batch for one scanner instance when supported. */
  claimPendingSettlements?(limit: number, before: PendingSettlementCursor | Date | undefined, options: PendingSettlementClaimOptions): Promise<SettlementRecord[]>;
  getAuditEvents(playerId: string): Promise<AuditEvent[]>;
  listJournal(playerId: string, limit: number, beforeRevision?: number): Promise<AuditEvent[]>;
  listCollectionEvents(playerId: string, limit: number, before?: CollectionEventCursor | Date): Promise<CollectionEvent[]>;
  getActionResponse(key: string): Promise<unknown | null>;
  findActionResponseByPrefix(prefix: string): Promise<{ key: string; response: unknown } | null>;
  recordActionResponse(playerId: string, key: string, response: unknown): Promise<void>;
  getLeaderboard(type: LeaderboardType, limit: number, offset: number): Promise<LeaderboardData>;
  transaction<T>(playerId: string, expectedRevision: number, meta: TransactionMeta, mutate: (draft: PlayerState) => T, settlement?: SettlementRecord | ((result: T, draft: PlayerState) => SettlementRecord), actionKey?: string, guard?: (draft: PlayerState, context: TransactionContext) => void | Promise<void>): Promise<T>;
  recordSettlement(record: SettlementRecord): Promise<void>;
}

export class MemoryRepository implements Repository {
  private readonly players = new Map<string, PlayerState>();
  private readonly settlements = new Map<string, SettlementRecord>();
  private readonly audit = new Map<string, AuditEvent>();
  private readonly collectionEvents = new Map<string, CollectionEvent>();
  private readonly actionResponses = new Map<string, unknown>();
  private readonly settlementClaims = new Map<string, { claimToken: string; claimUntil: number }>();
  private failNextCommit = false;

  async createPlayer(player: PlayerState): Promise<void> {
    if (this.players.has(player.playerId)) throw new Error(`player already exists: ${player.playerId}`);
    this.players.set(player.playerId, clone({ ...player, skillLevels: skillLevelsFromProgress(player.skillProgress) }));
  }

  async getPlayer(playerId: string): Promise<PlayerState> {
    const player = this.players.get(playerId);
    if (!player) throw new ApiError('VALIDATION_FAILED', 'player does not exist');
    return clone({ ...player, skillLevels: skillLevelsFromProgress(player.skillProgress) });
  }

  async getSettlement(settlementId: string): Promise<SettlementRecord | null> {
    const record = this.settlements.get(settlementId);
    return record ? clone(record) : null;
  }

  async listPendingSettlements(limit: number, before?: PendingSettlementCursor | Date): Promise<SettlementRecord[]> {
    const cursorDate = before instanceof Date ? before : before?.createdAt;
    const cursorSettlementId = before instanceof Date ? undefined : before?.settlementId;
    return [...this.settlements.values()]
      .filter((record) => {
        if (record.status !== 'pending' || !cursorDate) return record.status === 'pending';
        const createdAt = new Date(record.createdAt).getTime();
        const cursorAt = cursorDate.getTime();
        return createdAt < cursorAt || (createdAt === cursorAt && cursorSettlementId !== undefined && record.settlementId < cursorSettlementId);
      })
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt) || left.settlementId.localeCompare(right.settlementId))
      .slice(0, limit)
      .map(clone);
  }

  async claimPendingSettlements(limit: number, before: PendingSettlementCursor | Date | undefined, options: PendingSettlementClaimOptions): Promise<SettlementRecord[]> {
    const now = options.now.getTime();
    // Fetch the cursor window before applying claims so a busy row does not
    // consume the batch and starve later pending settlements.
    const candidates = await this.listPendingSettlements(Number.MAX_SAFE_INTEGER, before);
    const claimed: SettlementRecord[] = [];
    for (const record of candidates) {
      if (claimed.length >= limit) break;
      const existing = this.settlementClaims.get(record.settlementId);
      if (existing && existing.claimUntil > now && existing.claimToken !== options.claimToken) continue;
      this.settlementClaims.set(record.settlementId, { claimToken: options.claimToken, claimUntil: now + options.leaseMs });
      claimed.push(record);
    }
    return claimed;
  }

  async getAuditEvents(playerId: string): Promise<AuditEvent[]> {
    return [...this.audit.values()].filter((event) => event.playerId === playerId).map(clone);
  }
  async listJournal(playerId: string, limit: number, beforeRevision?: number): Promise<AuditEvent[]> {
    return [...this.audit.values()]
      .filter(function (event) {
        if (event.playerId !== playerId) return false;
        if (beforeRevision === undefined) return true;
        return event.afterRevision < beforeRevision;
      })
      .sort(function (left, right) {
        return right.createdAt.localeCompare(left.createdAt) || right.afterRevision - left.afterRevision;
      })
      .slice(0, Math.max(1, Math.min(100, limit)))
      .map(clone);
  }

  async listCollectionEvents(playerId: string, limit: number, before?: CollectionEventCursor | Date): Promise<CollectionEvent[]> {
    const cursorDate = before instanceof Date ? before : before?.createdAt;
    const cursorEventId = before instanceof Date ? undefined : before?.eventId;
    return [...this.collectionEvents.values()]
      .filter((event) => {
        if (event.playerId !== playerId || !cursorDate) return event.playerId === playerId;
        const eventAt = new Date(event.createdAt).getTime();
        const cursorAt = cursorDate.getTime();
        return eventAt < cursorAt || (eventAt === cursorAt && cursorEventId !== undefined && event.eventId < cursorEventId);
      })
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt) || right.eventId.localeCompare(left.eventId))
      .slice(0, limit)
      .map(clone);
  }

  async getActionResponse(key: string): Promise<unknown | null> {
    return this.actionResponses.has(key) ? clone(this.actionResponses.get(key)) : null;
  }

  async findActionResponseByPrefix(prefix: string): Promise<{ key: string; response: unknown } | null> {
    const key = [...this.actionResponses.keys()].filter((candidate) => candidate.startsWith(prefix)).sort()[0];
    return key === undefined ? null : { key, response: clone(this.actionResponses.get(key)) };
  }

  async recordActionResponse(_playerId: string, key: string, response: unknown): Promise<void> {
    if (!this.actionResponses.has(key)) this.actionResponses.set(key, clone(response));
  }

  async getLeaderboard(type: LeaderboardType, limit: number, offset: number): Promise<LeaderboardData> {
    const ranked = [...this.players.values()].map((player) => ({ player, combatPower: calculateCombatPower(player) })).sort((left, right) => compareLeaderboard(left, right, type));
    return { type, limit, offset, total: ranked.length, entries: ranked.slice(offset, offset + limit).map(({ player, combatPower }, index) => ({ rank: offset + index + 1, realmId: player.realmId, cultivationXp: player.cultivationXp, equipmentCount: player.equipmentCount, combatPower, ...(type === 'realm' || type === 'cultivation_xp' || type === 'combat_power' ? {} : { skillXp: skillXp(player, type), skillLevel: levelFromXp(skillXp(player, type)) }) })) };
  }

  injectCommitFailure(): void { this.failNextCommit = true; }

  async transaction<T>(playerId: string, expectedRevision: number, meta: TransactionMeta, mutate: (draft: PlayerState) => T, settlement?: SettlementRecord | ((result: T, draft: PlayerState) => SettlementRecord), actionKey?: string, guard?: (draft: PlayerState, context: TransactionContext) => void | Promise<void>): Promise<T> {
    const current = await this.getPlayer(playerId);
    if (current.stateRevision !== expectedRevision) throw new ApiError('STALE_REVISION', `expected revision ${expectedRevision}, current revision ${current.stateRevision}`, { currentRevision: current.stateRevision });
    const draft = clone(current);
    if (actionKey) {
      const previous = await this.getActionResponse(actionKey);
      if (previous) return clone(previous) as T;
    }
    if (guard) await guard(draft, { findActionResponseByPrefix: (prefix) => this.findActionResponseByPrefix(prefix) });
    const result = mutate(draft);
    draft.stateRevision = current.stateRevision + 1;
    if (draft.resources && Object.values(draft.resources).some((resource) => resource.amount < 0 || resource.reservedAmount < 0 || resource.amount + resource.reservedAmount > resource.capacity)) throw new ApiError('INTERNAL_ROLLBACK', 'resource invariant violated');
    if (this.failNextCommit) {
      this.failNextCommit = false;
      throw new ApiError('INTERNAL_ROLLBACK', 'transaction commit failed; no state was written');
    }
    this.players.set(playerId, clone({ ...draft, skillLevels: skillLevelsFromProgress(draft.skillProgress) }));
    const auditEvent: AuditEvent = {
      eventId: randomUUID(), playerId, settlementId: meta.settlementId ?? null, eventType: meta.eventType,
      beforeRevision: current.stateRevision, afterRevision: draft.stateRevision, configVersion: draft.configVersion,
      payloadHash: hashPayload(meta.payload), payload: clone(meta.payload), createdAt: meta.at.toISOString(),
    };
    this.audit.set(auditEvent.eventId, auditEvent);
    if (collectionSnapshot(current) !== collectionSnapshot(draft)) {
      const collectionEvent: CollectionEvent = {
        eventId: randomUUID(), playerId, eventType: meta.eventType,
        beforeRevision: current.stateRevision, afterRevision: draft.stateRevision,
        configVersion: draft.configVersion,
        payloadHash: hashPayload({ action: meta.payload, before: current.collection, after: draft.collection }),
        payload: { action: clone(meta.payload), before: clone(current.collection), after: clone(draft.collection) },
        createdAt: meta.at.toISOString(),
      };
      this.collectionEvents.set(collectionEvent.eventId, collectionEvent);
    }
    // 结算类事务始终留一条可读流水（挂机/离线收益），供 UI"最近入库"消费；
    // 载荷取结算摘要字段，事件本身仍走同一幂等/审计管线。
    const envelopeData = (result as { data?: unknown; record?: { responsePayload?: { data?: { resourceDelta?: Record<string, number>; cultivationDelta?: number; completedActions?: number; failed?: boolean } } } } | undefined);
    const settlementResult = (envelopeData?.record?.responsePayload?.data ?? envelopeData?.data) as
      | { resourceDelta?: Record<string, number>; cultivationDelta?: number; completedActions?: number; failed?: boolean }
      | undefined;
    if (meta.settlementId && settlementResult) {
      const settlementEvent: CollectionEvent = {
        eventId: randomUUID(), playerId, eventType: 'settlement_committed',
        beforeRevision: current.stateRevision, afterRevision: draft.stateRevision,
        configVersion: draft.configVersion,
        payloadHash: hashPayload({ settlementId: meta.settlementId, resourceDelta: settlementResult.resourceDelta, cultivationDelta: settlementResult.cultivationDelta }),
        payload: {
          settlementId: meta.settlementId,
          resourceDelta: clone(settlementResult.resourceDelta ?? {}),
          cultivationDelta: settlementResult.cultivationDelta ?? 0,
          completedActions: settlementResult.completedActions ?? 0,
          failed: settlementResult.failed ?? false,
        },
        createdAt: meta.at.toISOString(),
      };
      this.collectionEvents.set(settlementEvent.eventId, settlementEvent);
    }
    const committedSettlement = typeof settlement === 'function' ? settlement(result, draft) : settlement;
    if (committedSettlement) this.settlements.set(committedSettlement.settlementId, clone(committedSettlement));
    if (actionKey) this.actionResponses.set(actionKey, clone(result));
    return result;
  }

  async recordSettlement(record: SettlementRecord): Promise<void> {
    const existing = this.settlements.get(record.settlementId);
    // A pending reservation is deliberately upgradeable.  This is the
    // recovery path after a process/network fault between state writes and
    // the client receiving the committed response.  Committed/rejected rows
    // remain immutable so a retry can never overwrite the first result.
    if (existing?.status === 'pending' &&
      (existing.playerId !== record.playerId ||
        existing.requestStartedAt !== record.requestStartedAt ||
        existing.requestEndedAt !== record.requestEndedAt ||
        existing.expectedRevision !== record.expectedRevision ||
        existing.configVersion !== record.configVersion)) {
      throw new ApiError('DUPLICATE_REQUEST', 'pending settlement parameters do not match the existing reservation');
    }
    if (!existing || (existing.status === 'pending' && record.status !== 'pending')) {
      this.settlements.set(record.settlementId, clone(record));
      this.settlementClaims.delete(record.settlementId);
    }
  }
}

export const makeInitialPlayer = (playerId: string, now: Date, configVersion = CONFIG_VERSION): PlayerState => ({
  playerId,
  realmId: 'qi_refining',
  substageIndex: 0,
  cultivationXp: 0,
  primaryAction: { actionId: null, startedAt: null, carrySeconds: 0, modelVersion: SINGLE_SLOT_ACTION_MODEL },
  lastSettledAt: now.toISOString(),
  stateRevision: 0,
  configVersion,
  resources: {
    spirit_stone: { amount: 5620, capacity: 25000, reservedAmount: 0, overflowAmount: 0 },
    spirit_herb: { amount: 128, capacity: 10000, reservedAmount: 0, overflowAmount: 0 },
    spirit_ore: { amount: 46, capacity: 10000, reservedAmount: 0, overflowAmount: 0 },
    spirit_wood: { amount: 0, capacity: 10000, reservedAmount: 0, overflowAmount: 0 },
    pill: { amount: 6, capacity: 2000, reservedAmount: 0, overflowAmount: 0 },
    ancient_scroll: { amount: 0, capacity: 100, reservedAmount: 0, overflowAmount: 0 },
    millennium_herb: { amount: 0, capacity: 100, reservedAmount: 0, overflowAmount: 0 },
    herb_zi_yun_hua: { amount: 0, capacity: 5000, reservedAmount: 0, overflowAmount: 0 },
    herb_ning_lu_cao: { amount: 0, capacity: 5000, reservedAmount: 0, overflowAmount: 0 },
    herb_jin_huan_she_xin: { amount: 0, capacity: 5000, reservedAmount: 0, overflowAmount: 0 },
    herb_chi_yan_zhi: { amount: 0, capacity: 5000, reservedAmount: 0, overflowAmount: 0 },
    pill_zi_yun: { amount: 0, capacity: 500, reservedAmount: 0, overflowAmount: 0 },
    pill_ning_lu: { amount: 0, capacity: 500, reservedAmount: 0, overflowAmount: 0 },
    pill_huang_long: { amount: 0, capacity: 500, reservedAmount: 0, overflowAmount: 0 },
    pill_chi_yan: { amount: 0, capacity: 500, reservedAmount: 0, overflowAmount: 0 },
    meteor_iron: { amount: 0, capacity: 100, reservedAmount: 0, overflowAmount: 0 },
    demon_core: { amount: 0, capacity: 100, reservedAmount: 0, overflowAmount: 0 },
  },
  mapPity: {}, dungeonState: { dungeonId: null, status: 'idle', phase: 0, bossHp: 0, startedAt: null, carrySeconds: 0, failureCooldownUntil: null }, randomEventState: {}, supportRouteState: {}, skillProgress: { techniqueXp: {}, techniqueAttributes: {}, herbalismXp: 0, miningXp: 0, alchemyXp: 0, forgeXp: 0 }, randomState: { seed: 42, draws: 0 }, failureCooldownUntil: null,
  buildings: {
    alchemy_room: { buildingId: 'alchemy_room', level: 1, activeJobId: null, jobStartedAt: null, carrySeconds: 0, carryQuantity: 0, plantedPlots: null, plantedAt: null, matureAt: null, queuedJobIds: [], stateRevision: 0 },
    forge_room: { buildingId: 'forge_room', level: 1, activeJobId: null, jobStartedAt: null, carrySeconds: 0, carryQuantity: 0, plantedPlots: null, plantedAt: null, matureAt: null, queuedJobIds: [], stateRevision: 0 },
    spirit_farm: { buildingId: 'spirit_farm', level: 1, activeJobId: null, jobStartedAt: null, carrySeconds: 0, carryQuantity: 0, plantedPlots: null, plantedAt: null, matureAt: null, queuedJobIds: [], stateRevision: 0, spiritFarmPlots: {} },
    technique_pavilion: { buildingId: 'technique_pavilion', level: 1, activeJobId: null, jobStartedAt: null, carrySeconds: 0, carryQuantity: 0, plantedPlots: null, plantedAt: null, matureAt: null, queuedJobIds: [], stateRevision: 0 },
    treasure_pavilion: { buildingId: 'treasure_pavilion', level: 1, activeJobId: null, jobStartedAt: null, carrySeconds: 0, carryQuantity: 0, plantedPlots: null, plantedAt: null, matureAt: null, queuedJobIds: [], stateRevision: 0 },
  },
  buildingJobs: {},
  equipmentCount: 1,
  equipmentInstances: {
    'equipment.iron_saber.initial': { instanceId: 'equipment.iron_saber.initial', templateId: 'iron_saber', slot: 'weapon', quality: 'fine', reinforcementLevel: 0, awakeningLevel: 0, affixes: {}, lockedSlots: [], isEquipped: true, createdConfigVersion: configVersion },
  },
  collection: { techniqueLayers: {}, techniqueResearchXp: 0, treasureStars: {}, collectionMarks: 0, duplicateBalances: {} }, collectionMarkBalances: { starter: 0 }, autoPromotionCycles: {},
  dungeonPity: Object.fromEntries((['qing_feng', 'yan_prison', 'sky_abyss'] as DungeonId[]).map((dungeonId) => [dungeonId, { millenniumHerb: 0, meteorIron: 0, technique: 0, treasure: 0 }])) as PlayerState['dungeonPity'],
  dungeonAttempts: {},
  highTierState: { realm: null, status: 'idle', attemptId: null, startedAt: null, failureCooldownUntil: null },
  highTierPity: Object.fromEntries((['nascent_soul', 'divine_transformation', 'void_refining', 'body_unity', 'great_vehicle', 'tribulation'] as HighTierRealm[]).map((realm) => [realm, 0])) as PlayerState['highTierPity'],
  highTierAttempts: {},
});
