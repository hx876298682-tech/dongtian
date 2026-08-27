/** 类型化游戏客户端：与 demo/src/server HTTP 契约一一对应。
    UI 不缓存第二份事实；所有结算/成本/门槛以服务端响应为准。 */
import { uuid } from './format';

export type ResourceId = 'spirit_stone' | 'spirit_herb' | 'spirit_ore' | 'spirit_wood' | 'pill' | 'ancient_scroll' | 'millennium_herb' | 'meteor_iron' | 'demon_core';

type Envelope<T> = { requestId: string; configVersion: string; stateRevision: number; serverTime: string; data: T };

export type RemoteResource = { amount: number; capacity: number; reservedAmount?: number; overflowAmount?: number };

export type FarmPlot = { plotId: string; plantId: string; plantedAt: string; matureAt: string; stateRevision: number };

export type RemotePlayer = {
  playerId: string;
  realmId: string;
  cultivationXp: number;
  primaryAction: { actionId: string | null; targetId?: string | null; startedAt: string | null; carrySeconds: number; modelVersion?: string };
  lastSettledAt: string;
  stateRevision: number;
  resources: Partial<Record<ResourceId, RemoteResource>>;
  mapPity: Record<string, number>;
  skillProgress?: {
    techniqueXp: Record<string, number>;
    techniqueAttributes: Record<string, number>;
    herbalismXp: number;
    miningXp: number;
    alchemyXp: number;
    forgeXp: number;
  };
  skillLevels?: { technique: Record<string, number>; herbalism: number; mining: number; alchemy: number; forge: number };
  equipmentCount: number;
  equipmentInstances: Record<string, EquipmentInstance>;
  failureCooldownUntil: string | null;
  buildings?: { spirit_farm?: { spiritFarmPlots?: Record<string, FarmPlot>; plantedPlots?: number | null; matureAt?: string | null } };
};

export type EquipmentInstance = {
  instanceId: string;
  templateId: string;
  slot: string;
  quality: string;
  reinforcementLevel: number;
  awakeningLevel?: number;
  affixes: Record<string, unknown>;
  isEquipped: boolean;
};

export type CatalogStatus = 'released' | 'proposal_v1' | 'content_pending';

export type Catalog = {
  schemaVersion: string;
  actionModel: string;
  actions: Array<{ actionId: string; kind: string; selection: string; status: CatalogStatus; source: string }>;
  techniques: Array<{ id: string; quality: string; status: CatalogStatus; source: string; supportsFocusCultivation: boolean }>;
  recipes: Array<{
    id: string; actionId: 'alchemy' | 'forge'; buildingId: string; outputResource: string;
    outputAmount: number; intervalSeconds: number; inputCosts: Partial<Record<ResourceId, number>>; status: CatalogStatus; source: string;
  }>;
  equipmentTemplates: Array<{ id: string; displayName: string; slot: string; quality: string; sourceMapIds: string[]; status: CatalogStatus; source: string }>;
  maps: Array<{ id: string; displayName: string; kind: string; actionId: string; unlockRealmId: string; unlocked: boolean; targetKillTimeSeconds: number; status: CatalogStatus; source: string }>;
  gatheringMaps: Array<{ id: string; displayName: string; actionId: 'herbalism' | 'mining'; kind: string; resourceId: ResourceId; intervalSeconds: number; yieldPerCompletion: number; status: CatalogStatus; source: string }>;
  focusCultivation: { id: string; actionId: 'technique_training'; status: CatalogStatus; source: string };
};

export type Bootstrap = { player: RemotePlayer; availableActions: string[]; pendingSettlement: { startedAt: string; endedAt: string } | null };

export type CollectionEventItem = { eventId: string; eventType: string; payload: unknown; createdAt: string };

export type CombatStats = {
  attack: number; defence: number; health: number; speed: number; accuracy: number; evasion: number;
  attackInterval: number; battlePower: number; element: string; elements: Record<string, number>;
  outgoingSpecial: number; incomingSpecial: number; pillHealMultiplier: number;
};

export type CombatPreviewData = {
  activityId: string; realm: string; equipmentCount: number; targetClearTime: number; pillBudget: number;
  gate: { status: 'open' | 'blocked'; requiredRealm: string | null; reason: 'realm' | 'cooldown' | null };
  stats: CombatStats;
};

export type SettlementData = {
  settlementId: string;
  requestedStartedAt: string;
  requestedEndedAt: string;
  settledStartedAt: string;
  settledEndedAt: string;
  settledSeconds: number;
  clipped: boolean;
  resourceDelta: Partial<Record<ResourceId, number>>;
  cultivationDelta: number;
  completedActions: number;
  failed: boolean;
  overflow: Partial<Record<ResourceId, number>>;
  productionDelta?: Partial<Record<string, number>>;
  completedProductionActions?: number;
  combatSnapshot?: CombatStats;
  equipmentDrops?: Array<Record<string, unknown>>;
  skillXpDelta?: { technique?: Record<string, number>; herbalism?: number; mining?: number; alchemy?: number; forge?: number };
};

export type BreakthroughData = { fromRealm: string; toRealm: string; resourceCost: Partial<Record<ResourceId, number>>; cultivationCost: number };

export type ActionOptions = {
  actionId: string;
  recipeId?: string;
  equipmentTemplateId?: string;
  techniqueId?: string;
  mapId?: string;
};

export type CombatEvent = { second: number; actor: 'player' | 'boss' | 'system'; kind: string; amount?: number; state?: Record<string, unknown> };

export type DungeonPreviewData = {
  dungeonId: string;
  targetClearTime: number;
  entryPillCost: number;
  bossAutoPillCost: number;
  pillCost: number;
  bossMaxHp: number;
  barrierPercent: number;
  phaseTwoThresholdPercent: number;
  bossAttack: number;
  bossAccuracy: number;
  bossElement: string;
  bossDefence: number;
  currentPity: { millenniumHerb: number; meteorIron: number; technique: number; treasure: number };
  availablePill: number;
  stats: CombatStats;
  gate?: { status: 'open' | 'blocked'; reason?: string | null };
};

export type DungeonStartData = { attemptId: string; seed: number; dungeonId: string; startedAt: string; bossMaxHp: number; barrier: number; phase: 1 | 2 };

export type DungeonSettlementData = {
  attemptId: string;
  dungeonId: string;
  status: 'succeeded' | 'failed';
  elapsedSeconds: number;
  targetClearTime: number;
  bossHp: number;
  bossMaxHp: number;
  barrier: number;
  phase: 1 | 2;
  combatSnapshot: CombatStats;
  combatEvents: CombatEvent[];
  entryPillCost: number;
  pillCost: number;
  resourceDelta: Partial<Record<ResourceId, number>>;
  drops: { millenniumHerb: number; meteorIron: number; techniqueQuality: string | null; techniqueId?: string | null; treasureId: string | null };
};

export type HighTierPreviewData = {
  realm: string;
  currentRealm: string;
  targetClearTime: number;
  pillBudget: number;
  bossHp: number;
  recoverySeconds: number;
  rewardOnFailure: boolean;
  stats: CombatStats;
  gate: { status: 'open' | 'blocked'; reason: 'realm' | 'collection' | null; profile?: string; requiredRealm?: string; required?: { attack: number; defence: number; health: number } };
};

export type HighTierSettlementData = {
  realm: string;
  status: 'succeeded' | 'failed';
  elapsedSeconds: number;
  bossHp: number;
  combatSnapshot?: CombatStats;
  combatEvents?: CombatEvent[];
  resourceDelta?: Partial<Record<ResourceId, number>>;
  drops?: Record<string, unknown>;
};

export type LeaderboardEntry = { rank: number; playerId: string; realmId: string; cultivationXp: number; equipmentCount: number; combatPower: number; skillXp?: number; skillLevel?: number };

export class ApiError extends Error {
  readonly code: string | undefined;
  readonly status: number;
  constructor(message: string, status: number, code?: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code ?? undefined;
  }
}

const resolveBaseUrl = (): string => {
  const raw = (import.meta.env.VITE_GAME_API_URL as string | undefined)?.trim();
  if (raw) return raw.replace(/\/$/, '');
  // Vite dev server proxies /api → VITE_GAME_PROXY_TARGET（默认 http://127.0.0.1:8787）
  return '/api';
};

export class GameClient {
  readonly baseUrl = resolveBaseUrl();
  private readonly token = ((import.meta.env.VITE_GAME_AUTH_TOKEN as string | undefined) ?? '').trim();
  private readonly playerId = ((import.meta.env.VITE_GAME_PLAYER_ID as string | undefined) ?? '').trim() || 'demo-player';

  /** 服务端时间与本地时钟的偏移（serverTime - Date.now），用于校正倒计时。 */
  serverOffsetMs = 0;

  private async request<T>(path: string, init?: RequestInit): Promise<Envelope<T>> {
    const headers = new Headers(init?.headers);
    headers.set('accept', 'application/json');
    if (init?.body) headers.set('content-type', 'application/json');
    if (this.token) headers.set('authorization', `Bearer ${this.token}`);
    else headers.set('x-player-id', this.playerId);
    const response = await fetch(`${this.baseUrl}${path}`, { ...init, headers });
    const payload = (await response.json().catch(() => null)) as
      | (Envelope<T> & { error?: { message?: string; code?: string } })
      | null;
    if (!payload) throw new ApiError(`服务响应无法解析（${response.status}）`, response.status);
    if (!response.ok || payload.error) {
      throw new ApiError(payload.error?.message ?? `服务请求失败（${response.status}）`, response.status, payload.error?.code);
    }
    const serverTime = Date.parse((payload as Envelope<T>).serverTime);
    if (!Number.isNaN(serverTime)) this.serverOffsetMs = serverTime - Date.now();
    return payload;
  }

  now(): number { return Date.now() + this.serverOffsetMs; }

  private mutate<T>(path: string, body: Record<string, unknown>, expectedRevision: number): Promise<Envelope<T>> {
    return this.request<T>(path, {
      method: 'POST',
      headers: { 'idempotency-key': uuid(), 'x-expected-revision': String(expectedRevision) },
      body: JSON.stringify({ ...body, expectedRevision }),
    });
  }

  bootstrap(): Promise<Envelope<Bootstrap>> { return this.request('/v1/bootstrap'); }
  catalog(): Promise<Envelope<Catalog>> { return this.request('/v1/action-catalog'); }
  collectionEvents(limit = 30, before?: string): Promise<Envelope<{ events: CollectionEventItem[]; nextBefore: string | null }>> {
    const q = new URLSearchParams({ limit: String(limit) });
    if (before) q.set('before', before);
    return this.request(`/v1/collection/events?${q.toString()}`);
  }
  combatPreview(activityId: string, expectedRevision: number): Promise<Envelope<CombatPreviewData>> {
    return this.mutate('/v1/combat/preview', { activityId }, expectedRevision);
  }
  dungeonPreview(dungeonId: string): Promise<Envelope<DungeonPreviewData>> {
    return this.request(`/v1/dungeons/${encodeURIComponent(dungeonId)}/preview`);
  }
  startDungeon(dungeonId: string, expectedRevision: number): Promise<Envelope<DungeonStartData>> {
    return this.mutate('/v1/dungeons/start', { dungeonId }, expectedRevision);
  }
  settleDungeon(attemptId: string, expectedRevision: number): Promise<Envelope<DungeonSettlementData>> {
    return this.mutate('/v1/dungeons/settle', { attemptId }, expectedRevision);
  }
  highTierPreview(realm: string): Promise<Envelope<HighTierPreviewData>> {
    return this.request(`/v1/high-tier/${encodeURIComponent(realm)}/preview`);
  }
  startHighTier(realm: string, expectedRevision: number): Promise<Envelope<{ attemptId: string; realm: string; startedAt: string }>> {
    return this.mutate('/v1/high-tier/start', { realm }, expectedRevision);
  }
  settleHighTier(attemptId: string, expectedRevision: number): Promise<Envelope<HighTierSettlementData>> {
    return this.mutate('/v1/high-tier/settle', { attemptId }, expectedRevision);
  }
  leaderboard(type: string, limit = 20, offset = 0): Promise<Envelope<{ type: string; total: number; entries: LeaderboardEntry[] }>> {
    return this.request(`/v1/leaderboards/${encodeURIComponent(type)}?limit=${limit}&offset=${offset}`);
  }

  startAction(options: ActionOptions, expectedRevision: number): Promise<Envelope<{ actionId: string }>> {
    return this.mutate('/v1/actions/start', options, expectedRevision);
  }
  stopAction(expectedRevision: number, startedAt: string): Promise<Envelope<{ settlement: { data: SettlementData } }>> {
    return this.mutate('/v1/actions/stop', { settlementId: uuid(), requestedStartedAt: startedAt, requestedEndedAt: new Date().toISOString() }, expectedRevision);
  }
  switchAction(options: ActionOptions, expectedRevision: number, startedAt: string): Promise<Envelope<unknown>> {
    return this.mutate('/v1/actions/switch', { ...options, settlementId: uuid(), requestedStartedAt: startedAt, requestedEndedAt: new Date().toISOString() }, expectedRevision);
  }
  offlineSettlement(expectedRevision: number, startedAt: string, endedAt: string): Promise<Envelope<SettlementData>> {
    return this.mutate('/v1/settlements/offline', { settlementId: uuid(), requestedStartedAt: startedAt, requestedEndedAt: endedAt }, expectedRevision);
  }
  plantPlot(plotId: string, plantId: string, expectedRevision: number): Promise<Envelope<unknown>> {
    return this.mutate(`/v1/buildings/spirit_farm/plots/${encodeURIComponent(plotId)}/plant`, { plantId }, expectedRevision);
  }
  breakthrough(expectedRevision: number): Promise<Envelope<BreakthroughData>> {
    return this.mutate('/v1/progression/breakthrough', {}, expectedRevision);
  }
  equipmentAction(
    instanceId: string,
    action: 'equip' | 'unequip' | 'reinforce' | 'promote' | 'reroll' | 'lock' | 'awaken' | 'salvage' | 'sell',
    expectedRevision: number,
  ): Promise<Envelope<unknown>> {
    return this.mutate(`/v1/equipment/${encodeURIComponent(instanceId)}/actions`, { action }, expectedRevision);
  }
}
