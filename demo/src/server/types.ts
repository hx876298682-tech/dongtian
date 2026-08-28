export const CONFIG_VERSION = '1.0.0-frozen';
export const MAX_OFFLINE_SECONDS = 24 * 60 * 60;

import type { ConfigReleaseSnapshot } from './config-release.ts';

export type ResourceId = 'spirit_stone' | 'spirit_herb' | 'spirit_ore' | 'spirit_wood' | 'pill' | 'ancient_scroll' | 'millennium_herb' | 'meteor_iron' | 'demon_core';
export type ProductionOutputId = ResourceId | 'equipment' | 'technique_research_xp';
export type ResourceState = { amount: number; capacity: number; reservedAmount: number; overflowAmount: number };
export type ResourceBag = Record<ResourceId, ResourceState>;
export type HighTierRealm = 'nascent_soul' | 'divine_transformation' | 'void_refining' | 'body_unity' | 'great_vehicle' | 'tribulation';
export type RealmId = 'qi_refining' | 'foundation_establishment' | 'core_formation' | HighTierRealm;

export type LeaderboardType = 'realm' | 'cultivation_xp' | 'combat_power' | 'technique' | 'herbalism' | 'mining' | 'alchemy' | 'forge';
export type LeaderboardEntry = { rank: number; realmId: RealmId; cultivationXp: number; equipmentCount: number; combatPower: number; skillXp?: number; skillLevel?: number };
export type LeaderboardData = { type: LeaderboardType; limit: number; offset: number; total: number; entries: LeaderboardEntry[] };

export type PrimaryActionState = {
  actionId: string | null;
  /** Selected production recipe/template target. Legacy rows omit this. */
  targetId?: string | null;
  startedAt: string | null;
  carrySeconds: number;
  /** Versioned action-slot semantics. Legacy rows may omit this field. */
  modelVersion?: 'global_single_slot_v1';
};

/** Proposal-v1 skill progress for the Melvor-style action sequences. */
export type SkillProgress = {
  techniqueXp: Record<string, number>;
  techniqueAttributes: Record<string, number>;
  herbalismXp: number;
  miningXp: number;
  alchemyXp: number;
  forgeXp: number;
};
/** Derived from SkillProgress using skill-level.ts; never an independent source of truth. */
export type SkillLevelSnapshot = {
  technique: Record<string, number>;
  herbalism: number;
  mining: number;
  alchemy: number;
  forge: number;
};

export type DungeonStatus = 'idle' | 'fighting' | 'success' | 'failed' | 'cooldown';
export type DungeonState = {
  dungeonId: string | null;
  status: DungeonStatus;
  phase: number;
  bossHp: number;
  startedAt: string | null;
  carrySeconds: number;
  failureCooldownUntil: string | null;
};

export type BuildingId = 'alchemy_room' | 'forge_room' | 'spirit_farm' | 'technique_pavilion' | 'treasure_pavilion';
export type DungeonId = 'qing_feng' | 'yan_prison' | 'sky_abyss';
export type SpiritFarmPlotState = { plotId: string; plantId: string; plantedAt: string; matureAt: string; stateRevision: number };
export type BuildingState = {
  buildingId: BuildingId;
  level: number;
  activeJobId: string | null;
  jobStartedAt: string | null;
  carrySeconds: number;
  /** Persisted quantity carry reserved by the data contract; runtime v1 does not interpret it. */
  carryQuantity: number;
  queuedJobIds: string[];
  stateRevision: number;
  /** Explicit one-shot spirit-farm planting state. Null means legacy continuous farm mode. */
  plantedPlots?: number | null;
  plantedAt?: string | null;
  matureAt?: string | null;
  /** Independent plot state for the explicit spirit-farm model. */
  spiritFarmPlots?: Record<string, SpiritFarmPlotState>;
};
export type BuildingJob = {
  jobId: string;
  buildingId: BuildingId;
  recipeId: 'alchemy_basic' | 'forge_basic';
  remainingQuantity: number;
  queuedAt: string;
};
export type EquipmentInstance = {
  instanceId: string;
  templateId: string;
  slot: 'weapon' | 'armor_1' | 'armor_2' | 'armor_3' | 'armor_4' | 'accessory';
  quality: string;
  reinforcementLevel: number;
  awakeningLevel: number;
  affixes: Record<string, unknown>;
  lockedSlots: number[];
  isEquipped: boolean;
  createdConfigVersion: string;
  /** Durable creation timestamp; optional for legacy in-memory fixtures. */
  createdAt?: string;
};

export type CollectionState = {
  techniqueLayers: Record<string, number>;
  techniqueResearchXp: number;
  treasureStars: Record<string, number>;
  collectionMarks: number;
  duplicateBalances: Record<string, number>;
};
export type CollectionPoolId = 'starter' | HighTierRealm;
export type CollectionMarkBalances = Partial<Record<CollectionPoolId, number>>;
export type AutoPromotionPolicy = {
  enabled: boolean;
  targetInstanceIds: string[];
  resourceReserve: Partial<Record<'spirit_stone' | 'millennium_herb' | 'meteor_iron', number>>;
  maxOperationsPerCycle: number;
  strategyVersion: string;
};
export type AutoPromotionCycleState = { cycleId: string; response: unknown; policyFingerprint: string; committedAt: string };

/** Durable, replayable collection-only event stream entry. */
export type CollectionEvent = {
  eventId: string;
  playerId: string;
  eventType: string;
  beforeRevision: number;
  afterRevision: number;
  configVersion: string;
  payloadHash: string;
  payload: unknown;
  createdAt: string;
};
export type CollectionEventCursor = { createdAt: Date; eventId?: string };
export type PendingSettlementCursor = { createdAt: Date; settlementId: string };

/** Read-only collection snapshot returned by the collection state endpoint. */
export type CollectionStateData = CollectionState;

export type PlayerState = {
  playerId: string;
  realmId: RealmId;
  substageIndex: number;
  cultivationXp: number;
  primaryAction: PrimaryActionState;
  lastSettledAt: string;
  stateRevision: number;
  configVersion: string;
  resources: ResourceBag;
  mapPity: Record<string, number>;
  dungeonState: DungeonState;
  /** Opaque persisted state until random-event rules are formally activated. */
  randomEventState: Record<string, unknown>;
  /** Opaque persisted state until support-route rules are formally activated. */
  supportRouteState: Record<string, unknown>;
  /** Explicit action skill progress; legacy rows default to zero. */
  skillProgress: SkillProgress;
  skillLevels?: SkillLevelSnapshot;
  randomState: { seed: number; draws: number };
  failureCooldownUntil: string | null;
  buildings: Record<BuildingId, BuildingState>;
  buildingJobs: Record<string, BuildingJob>;
  equipmentCount: number;
  equipmentInstances: Record<string, EquipmentInstance>;
  collection: CollectionState;
  /** Per-pool marks introduced by FI-05. Missing on legacy in-memory fixtures. */
  collectionMarkBalances?: CollectionMarkBalances;
  autoPromotionPolicy?: AutoPromotionPolicy;
  autoPromotionCycles?: Record<string, AutoPromotionCycleState>;
  dungeonPity: Record<DungeonId, DungeonPity>;
  dungeonAttempts: Record<string, DungeonAttempt>;
  highTierState: HighTierState;
  highTierPity: Record<HighTierRealm, number>;
  highTierAttempts: Record<string, HighTierAttempt>;
};

export type AuditEvent = {
  eventId: string;
  playerId: string;
  settlementId: string | null;
  eventType: string;
  beforeRevision: number;
  afterRevision: number;
  configVersion: string;
  payloadHash: string;
  payload: unknown | null;
  createdAt: string;
};

export type SettlementRecord = {
  settlementId: string;
  playerId: string;
  requestStartedAt: string;
  requestEndedAt: string;
  settledSeconds: number;
  expectedRevision: number;
  committedRevision: number | null;
  configVersion: string;
  summaryHash: string;
  status: 'pending' | 'committed' | 'rejected';
  responsePayload: unknown;
  createdAt: string;
  committedAt: string | null;
};

export type ApiErrorCode =
  | 'AUTH_REQUIRED' | 'FORBIDDEN' | 'CONFIG_VERSION_MISMATCH' | 'STALE_REVISION' | 'DUPLICATE_REQUEST'
  | 'TIME_RANGE_INVALID' | 'OVERLAP_ALREADY_SETTLED' | 'OFFLINE_RANGE_CLIPPED'
  | 'CONTENT_LOCKED' | 'RESOURCE_INSUFFICIENT' | 'PILL_INSUFFICIENT' | 'GATE_BLOCKED'
  | 'COOLDOWN_ACTIVE' | 'INVENTORY_FULL' | 'NOT_FOUND' | 'VALIDATION_FAILED' | 'INTERNAL_ROLLBACK'
  | 'TRANSACTION_RETRYABLE' | 'REQUEST_BODY_TOO_LARGE' | 'COLLECTION_POOL_COMPLETE'
  | 'COLLECTION_POOL_LOCKED' | 'AUTO_PROMOTION_BLOCKED';

export class ApiError extends Error {
  readonly code: ApiErrorCode;
  readonly details: unknown;

  constructor(code: ApiErrorCode, message: string, details?: unknown) {
    super(message);
    this.code = code;
    this.details = details;
    this.name = 'ApiError';
  }
}

export type ApiEnvelope<T> = {
  requestId: string;
  configVersion: string;
  stateRevision: number;
  serverTime: string;
  data: T;
};

export type ServiceContext = {
  requestId?: string;
  configVersion?: string;
  now?: Date;
};
export type ConfigReleaseOperation = 'canary' | 'activate' | 'rollback';
export type ConfigReleaseOperationRequest = ServiceContext & { operation: ConfigReleaseOperation; version: string; reason: string; canaryPercent?: number; operatorSubject: string; idempotencyKey?: string };
export type ConfigReleaseOperationData = { operation: ConfigReleaseOperation; targetVersion: string; activeVersion: string | null };

export type LeaderboardRequest = ServiceContext & { playerId: string; type: LeaderboardType; limit: number; offset: number };
export type JournalRequest = ServiceContext & { playerId: string; limit: number; beforeRevision?: number };
export type JournalData = { entries: AuditEvent[] };
export type CollectionEventsRequest = ServiceContext & { playerId: string; limit: number; before?: string };
export type CollectionEventsData = { events: CollectionEvent[]; nextBefore: string | null };

export type BootstrapData = {
  player: PlayerState;
  availableActions: string[];
  pendingSettlement: { startedAt: string; endedAt: string } | null;
};

/**
 * Read-only target directory for the global action slot.  `released` means
 * the target comes from the frozen content/parameter package; `proposal_v1`
 * is executable in the current MVP runtime but still requires a formal
 * product content release; `content_pending` is intentionally not startable.
 */
export type ActionCatalogStatus = 'released' | 'proposal_v1' | 'content_pending';
export type ActionCatalogSelection = 'none' | 'techniqueId' | 'recipeId' | 'recipeId+equipmentTemplateId' | 'mapId';
export type ActionCatalogAction = {
  actionId: string;
  kind: 'training' | 'technique' | 'alchemy' | 'forge' | 'gathering' | 'combat';
  selection: ActionCatalogSelection;
  status: ActionCatalogStatus;
  source: 'frozen_v1' | 'proposal_v1' | 'content_package';
};
export type ActionCatalogTechnique = {
  id: string;
  quality: string;
  status: ActionCatalogStatus;
  source: 'frozen_parameter_pool';
  supportsFocusCultivation: boolean;
  element?: string;
  growth: {
    attackPerLayer: number;
    defencePerLayer: number;
    healthPerLayer: number;
    cultivationRateBonusPerLayer: number;
    qualityMultiplier: number;
    maxLayer: number;
  };
};
export type ActionCatalogRecipe = {
  id: string;
  actionId: 'alchemy' | 'forge';
  buildingId: 'alchemy_room' | 'forge_room';
  outputResource: string;
  outputAmount: number;
  intervalSeconds: number;
  inputCosts: Partial<Record<ResourceId, number>>;
  status: ActionCatalogStatus;
  source: 'content_package';
};
export type ActionCatalogEquipmentTemplate = {
  id: string;
  displayName: string;
  slot: EquipmentInstance['slot'];
  quality: string;
  sourceMapIds: string[];
  status: ActionCatalogStatus;
  source: 'content_package';
};
export type ActionCatalogMap = {
  id: string;
  displayName: string;
  kind: 'combat';
  actionId: string;
  unlockRealmId: string;
  unlocked: boolean;
  targetKillTimeSeconds: number;
  status: ActionCatalogStatus;
  source: 'content_package';
};
export type ActionCatalogGatheringMap = {
  id: string;
  displayName: string;
  actionId: 'herbalism' | 'mining';
  kind: 'gathering';
  resourceId: ResourceId;
  intervalSeconds: number;
  yieldPerCompletion: number;
  status: 'proposal_v1';
  source: 'runtime_proposal_v1';
};
export type ActionCatalogData = {
  schemaVersion: 'action_catalog_v1';
  actionModel: 'global_single_slot_v1';
  actions: ActionCatalogAction[];
  techniques: ActionCatalogTechnique[];
  recipes: ActionCatalogRecipe[];
  equipmentTemplates: ActionCatalogEquipmentTemplate[];
  maps: ActionCatalogMap[];
  gatheringMaps: ActionCatalogGatheringMap[];
  focusCultivation: {
    id: 'focus_cultivation';
    actionId: 'technique_training';
    status: 'proposal_v1';
    source: 'runtime_proposal_v1';
  };
};

export type StartActionRequest = ServiceContext & {
  playerId: string;
  actionId: string;
  /** Required for new selectable production actions; legacy action ids remain compatible. */
  recipeId?: string;
  equipmentTemplateId?: string;
  expectedRevision: number;
  idempotencyKey?: string;
  /** Selection fields for dynamic action families. Canonical action ids are persisted. */
  techniqueId?: string;
  mapId?: string;
};

/** Active sequences share one player-wide slot in global_single_slot_v1. */
export const SINGLE_SLOT_ACTION_MODEL = 'global_single_slot_v1' as const;
export const SINGLE_SLOT_ACTIONS = ['alchemy', 'forge', 'alchemy_basic', 'forge_basic', 'technique_research', 'treasure_research', 'technique_training', 'herbalism', 'mining'] as const;
export type SingleSlotAction = (typeof SINGLE_SLOT_ACTIONS)[number];

/**
 * The canonical end-of-action command. The server first settles the requested
 * interval against the current primary action, then clears primaryAction in a
 * second CAS transaction. Callers must use the returned stateRevision for the
 * next mutation (for example breakthrough or switch).
 */
export type StopActionRequest = SettlementRequest & { idempotencyKey?: string };
export type StopActionData = { actionId: string; settlement: ApiEnvelope<SettlementData>; stoppedAt: string };
/**
 * Composite action transition: stop the current primary action, then start the
 * requested target. The operation is replayable by its idempotency key; the
 * stop result remains durable even if the target start is rejected.
 */
export type SwitchActionRequest = StopActionRequest & { actionId: string; recipeId?: string; equipmentTemplateId?: string; techniqueId?: string; mapId?: string };
export type SwitchActionData = { stopped: StopActionData; started: { actionId: string; targetId?: string | null } };

export type SettlementRequest = ServiceContext & {
  playerId: string;
  settlementId: string;
  requestedStartedAt: string;
  requestedEndedAt: string;
  expectedRevision: number;
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
  summaryHash: string;
  productionDelta?: Partial<Record<ProductionOutputId, number>>;
  completedProductionActions?: number;
  combatSnapshot?: CombatStats;
  equipmentDrops?: EquipmentDropSummary[];
  randomEventSummaries?: RandomEventSettlementSummary[];
  randomEventEffectiveProductionSeconds?: number;
  skillXpDelta?: {
    technique?: Record<string, number>;
    herbalism?: number;
    mining?: number;
    alchemy?: number;
    forge?: number;
  };
};

export type RandomEventSettlementSummary = {
  windowId: string;
  eventId: 'none' | 'spirit_tide' | 'beast_raid';
  overlapSeconds: number;
  productionMultiplier: number;
  configVersion: string;
  resultHash: string;
};

export type RandomEventCurrentData = {
  mode: 'runtime_v1' | 'opaque_legacy' | 'uninitialized';
  window: {
    windowId: string;
    startAt: string;
    endAt: string;
    eventId: 'none' | 'spirit_tide' | 'beast_raid';
    status: 'rolled' | 'active' | 'ended';
    durationSeconds: number;
    productionMultiplier: number;
    configVersion: string;
    resultHash: string;
  } | null;
};

export type EquipmentDropSummary = {
  instanceId: string;
  templateId: string;
  quality: string;
  slot: EquipmentInstance['slot'];
  exit: 'retain' | 'salvage' | 'sell';
};

export type ReplayData = {
  settlementId: string;
  status: SettlementRecord['status'];
  configVersion: string;
  committedRevision: number | null;
  settledSeconds: number;
  responsePayload: unknown;
};

export type QueueBuildingJobRequest = ServiceContext & {
  playerId: string;
  buildingId: BuildingId;
  recipeId: 'alchemy_basic' | 'forge_basic';
  quantity: number;
  expectedRevision: number;
  idempotencyKey?: string;
};

export type QueueBuildingJobData = { jobId: string; buildingId: BuildingId; recipeId: string; quantity: number; reservedInputs: Partial<Record<ResourceId, number>> };
export type BuildingUpgradeRequest = ServiceContext & { playerId: string; buildingId: BuildingId; expectedRevision: number; idempotencyKey?: string };
export type BuildingUpgradeData = { buildingId: BuildingId; fromLevel: number; toLevel: number; resourceCost: Partial<Record<ResourceId, number>> };
export type PlantSpiritFarmRequest = ServiceContext & { playerId: string; plots: number; expectedRevision: number; idempotencyKey?: string };
export type PlantSpiritFarmData = { buildingId: 'spirit_farm'; plots: number; plantedAt: string; matureAt: string };
export type PlantSpiritFarmPlotRequest = ServiceContext & { playerId: string; plotId: string; plantId: string; expectedRevision: number; idempotencyKey?: string };
export type PlantSpiritFarmPlotData = { buildingId: 'spirit_farm'; plotId: string; plantId: string; plantedAt: string; matureAt: string };

export type EquipmentAction = 'equip' | 'unequip' | 'reinforce' | 'promote' | 'reroll' | 'lock' | 'awaken' | 'salvage' | 'sell';
export type EquipmentActionRequest = ServiceContext & { playerId: string; instanceId: string; action: EquipmentAction; expectedRevision: number; idempotencyKey?: string; lockSlots?: number[]; slotIndex?: number; target?: boolean; targetAffix?: string };
export type EquipmentActionData = { instanceId: string; action: EquipmentAction; equipped?: boolean; replacedInstanceId?: string | null; fromLevel?: number; toLevel?: number; fromQuality?: string; toQuality?: string; resourceCost?: Partial<Record<ResourceId, number>>; statMultiplier?: number; resourceDelta?: Partial<Record<ResourceId, number>>; overflow?: Partial<Record<ResourceId, number>>; lockedSlots?: number[]; rerollCount?: number; affixes?: unknown[]; targetMatched?: boolean };

export type CollectionAction = 'research' | 'treasure_upgrade';
export type CollectionActionRequest = ServiceContext & { playerId: string; action: CollectionAction; techniqueId?: string; quality?: string; treasureId?: string; expectedRevision: number; idempotencyKey?: string };
export type CollectionActionData = { action: CollectionAction; techniqueId?: string; treasureId?: string; quality?: string; fromLayer?: number; toLayer?: number; researchXpSpent?: number; resourceCost?: Partial<Record<ResourceId, number>>; fromStars?: number; toStars?: number; duplicateCopiesSpent?: number; collectionMarksGained?: number; collectionState: CollectionState };
export type CollectionExchangeRequest = ServiceContext & { playerId: string; poolId: CollectionPoolId; targetTreasureId: string; expectedRevision: number; idempotencyKey?: string };
export type CollectionExchangeData = { action: 'exchange'; poolId: CollectionPoolId; targetTreasureId: string; marksSpent: number; marksRemaining: number; fromStars: number; toStars: number; collectionState: CollectionState; summaryHash: string };
export type AutoPromotionPolicyRequest = ServiceContext & { playerId: string; enabled: boolean; targetInstanceIds: string[]; resourceReserve?: Partial<Record<'spirit_stone' | 'millennium_herb' | 'meteor_iron', number>>; maxOperationsPerCycle?: number; expectedRevision: number; idempotencyKey?: string };
export type AutoPromotionPolicyData = { action: 'set_policy'; policy: AutoPromotionPolicy };
export type AutoPromotionCycleRequest = ServiceContext & { playerId: string; cycleId?: string; expectedRevision: number; idempotencyKey?: string };
export type AutoPromotionOperation = { targetInstanceId: string; duplicateInstanceIds: string[]; fromQuality: string; toQuality: string; resourceCost: Partial<Record<ResourceId, number>> };
export type AutoPromotionCycleData = { cycleId: string; status: 'committed' | 'disabled' | 'blocked'; operations: AutoPromotionOperation[]; skipped: Array<{ targetInstanceId: string; reason: string }>; resourceCost: Partial<Record<ResourceId, number>>; summaryHash: string; beforeRevision: number; afterRevision: number };

export type DungeonPity = { millenniumHerb: number; meteorIron: number; technique: number; treasure: number };
export type CombatEvent = {
  second: number;
  actor: 'player' | 'boss' | 'system';
  kind: string;
  amount?: number;
  state?: Record<string, unknown>;
};
export type DungeonAttempt = {
  attemptId: string;
  dungeonId: DungeonId;
  configVersion?: string;
  configSnapshot?: ConfigReleaseSnapshot;
  seed: number;
  status: 'active' | 'succeeded' | 'failed';
  startedAt: string;
  settledAt: string | null;
  bossHp: number;
  bossMaxHp: number;
  barrier: number;
  phase: 1 | 2;
  elapsedSeconds: number;
  stunSeconds: number;
  spiritBurnSeconds: number;
  spiritBurnDamage: number;
  bossDamageTaken: number;
  bossDamageMultiplier: number;
  combatSnapshot: CombatStats | null;
  combatEvents: CombatEvent[];
  failureReason: string | null;
  responsePayload: unknown | null;
};
export type HighTierState = {
  realm: HighTierRealm | null;
  status: 'idle' | 'fighting' | 'success' | 'failed';
  attemptId: string | null;
  startedAt: string | null;
  failureCooldownUntil: string | null;
};
export type HighTierPity = Record<HighTierRealm, number>;
export type HighTierSkillSummary = {
  cooldownSeconds: number;
  durationSeconds: number;
  attackSuppressionPercent: number;
};
/**
 * Frozen full_v1 combat input and the player snapshot captured at start.
 * This is deliberately separate from the legacy signature-skill summary so
 * a future release cannot silently reinterpret an old attempt.
 */
export type HighTierFullCombatSnapshot = {
  mode: 'full_v1';
  realm: HighTierRealm;
  contract: {
    bossAttack: number;
    bossDefence: number;
    bossAccuracy: number;
    bossAttackIntervalSeconds: number;
    bossElement: 'neutral' | 'metal' | 'wood' | 'water' | 'fire' | 'earth';
    skills: Array<{
      id: string;
      kind: 'damage' | 'damage_over_time' | 'control' | 'output_suppression';
      cooldownSeconds: number;
      durationSeconds: number;
      magnitude: number;
    }>;
    resistances: { controlPercent: number; damageOverTimePercent: number; outputSuppressionPercent: number };
    autoPill: { thresholdPercent: number; healPerUse: number; targetPercent: number; maxUses: number };
  };
  bossMaxHp: number;
  combatSnapshot: CombatStats;
};
export type HighTierFullCombatResult = {
  status: 'active' | 'succeeded' | 'failed';
  failureReason: 'timeout' | 'player_defeated' | null;
  elapsedSeconds: number;
  bossHp: number;
  playerHealth: number;
  pillUses: number;
  skillCasts: number;
  controlSeconds: number;
  damageOverTimeDamage: number;
  outputSuppressedSeconds: number;
  bossAttacks: number;
  bossDamageTaken: number;
  combatEvents: CombatEvent[];
};
export type HighTierAttempt = {
  attemptId: string;
  realm: HighTierRealm;
  configVersion?: string;
  configSnapshot?: ConfigReleaseSnapshot;
  seed: number;
  status: 'active' | 'succeeded' | 'failed';
  startedAt: string;
  settledAt: string | null;
  targetClearTime: number;
  bossHp: number;
  bossMaxHp: number;
  pillBudget: number;
  elapsedSeconds: number;
  skillSuppressedSeconds: number;
  combatSnapshot: CombatStats | null;
  skill: HighTierSkillSummary | null;
  fullCombat: HighTierFullCombatSnapshot | null;
  combatEvents: CombatEvent[];
  failureReason: string | null;
  responsePayload: unknown | null;
};
export type DungeonPreviewData = {
  dungeonId: DungeonId;
  targetClearTime: number;
  entryPillCost: number;
  bossAutoPillCost: number;
  pillCost: number;
  bossBaseHp: number;
  bossMaxHp: number;
  barrierPercent: number;
  phaseTwoThresholdPercent: number;
  bossAttack: number;
  bossAccuracy: number;
  bossElement: string;
  bossDefence: number;
  spiritBurnDamagePerSecond: number;
  spiritBurnDuration: number;
  spiritBurnEffectiveDuration: number;
  spiritBurnInterval: number;
  currentPity: DungeonPity;
  availablePill: number;
  stats: CombatStats;
};
export type DungeonStartRequest = ServiceContext & { playerId: string; dungeonId: DungeonId; attemptId?: string; seed?: number; expectedRevision: number; idempotencyKey?: string };
export type DungeonStartData = { attemptId: string; seed: number; dungeonId: DungeonId; startedAt: string; bossMaxHp: number; barrier: number; phase: 1 | 2 };
export type DungeonSettleRequest = ServiceContext & { playerId: string; attemptId: string; expectedRevision: number };
export type TreasureDropProgress = { fromStars: number; toStars: number; duplicateCopiesSpent: number; duplicateCopiesRemaining: number; collectionMarksGained: number };
export type DungeonSettlementData = {
  attemptId: string;
  dungeonId: DungeonId;
  status: 'succeeded' | 'failed';
  elapsedSeconds: number;
  targetClearTime: number;
  bossHp: number;
  bossMaxHp: number;
  barrier: number;
  phase: 1 | 2;
  stunSeconds: number;
  spiritBurnSeconds: number;
  spiritBurnDamage: number;
  bossDamageTaken: number;
  bossDamageMultiplier: number;
  combatSnapshot: CombatStats;
  combatEvents: CombatEvent[];
  entryPillCost: number;
  bossAutoPillCost: number;
  pillCost: number;
  resourceDelta: Partial<Record<ResourceId, number>>;
  overflow: Partial<Record<ResourceId, number>>;
  drops: { millenniumHerb: number; meteorIron: number; techniqueQuality: string | null; techniqueId?: string | null; treasureId: string | null; treasureProgress?: TreasureDropProgress };
  pity: DungeonPity;
  failureReason: string | null;
};

export type HighTierPreviewData = {
  realm: HighTierRealm;
  currentRealm: RealmId;
  targetClearTime: number;
  pillBudget: number;
  bossHp: number;
  recoverySeconds: number;
  rewardOnFailure: boolean;
  pillChargeOnFailure: boolean;
  stats: CombatStats;
  skill: HighTierSkillSummary;
  fullCombat: HighTierFullCombatSnapshot | null;
  gate: {
    status: 'open' | 'blocked';
    reason: 'realm' | 'collection' | null;
    profile: string;
    requiredRealm: HighTierRealm;
    collectionProgress: { marks: number; requiredMarks: number };
    required: { attack: number; defence: number; health: number };
  };
};
export type HighTierStartRequest = ServiceContext & { playerId: string; realm: HighTierRealm; attemptId?: string; seed?: number; expectedRevision: number; idempotencyKey?: string };
export type HighTierStartData = { attemptId: string; realm: HighTierRealm; seed: number; startedAt: string; targetClearTime: number; pillBudget: number; bossHp: number; combatSnapshot: CombatStats; skill: HighTierSkillSummary; fullCombat: HighTierFullCombatSnapshot | null };
export type HighTierSettleRequest = ServiceContext & { playerId: string; attemptId: string; expectedRevision: number };
export type HighTierDrop = { ancientScroll: number; demonCore: number; equipment: { instanceId: string; quality: string; slot: EquipmentInstance['slot'] } | null; treasureId: string | null; treasureProgress?: TreasureDropProgress };
export type HighTierSettlementData = { attemptId: string; realm: HighTierRealm; status: 'succeeded' | 'failed'; elapsedSeconds: number; skillSuppressedSeconds: number; targetClearTime: number; bossHp: number; pillBudget: number; pillCost: number; resourceDelta: Partial<Record<ResourceId, number>>; overflow: Partial<Record<ResourceId, number>>; drops: HighTierDrop; pity: number; failureReason: string | null; combatSnapshot: CombatStats; skill: HighTierSkillSummary; fullCombat: HighTierFullCombatSnapshot | null; combatEvents: CombatEvent[] };


/**
 * Combat preview is read-only, but still binds to the caller's state
 * snapshot.  expectedRevision is optional at the service boundary so older
 * internal callers can continue to request a preview; the HTTP contract
 * requires it and validates it before dispatch.
 */
export type CombatPreviewRequest = ServiceContext & { playerId: string; activityId: string; expectedRevision?: number };
export type CombatPreviewGate = { status: 'open' | 'blocked'; requiredRealm: string | null; reason: 'realm' | 'cooldown' | null };
export type CombatStats = { attack: number; defence: number; health: number; speed: number; accuracy: number; evasion: number; attackInterval: number; battlePower: number; element: string; elements: Record<string, number>; outgoingSpecial: number; incomingSpecial: number; pillHealMultiplier: number };
export type CombatPreviewData = { activityId: string; realm: RealmId; equipmentCount: number; targetClearTime: number; pillBudget: number; gate: CombatPreviewGate; stats: CombatStats };

export type BreakthroughRequest = ServiceContext & {
  playerId: string;
  expectedRevision: number;
  idempotencyKey?: string;
};

export type BreakthroughData = {
  fromRealm: RealmId;
  toRealm: RealmId;
  resourceCost: Partial<Record<ResourceId, number>>;
  cultivationCost: number;
};
