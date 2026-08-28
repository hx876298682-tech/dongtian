import { createHash, randomUUID } from 'node:crypto';
import { FROZEN_PARAMETERS } from '../game/frozen-parameters.ts';
import { CONTENT_PACKAGE, diagnoseMapEquipmentReleaseReadiness, isContentPending, validateContentPackage } from '../content/content-schema.ts';
import { ApiError, CONFIG_VERSION, MAX_OFFLINE_SECONDS } from './types.ts';
import { SINGLE_SLOT_ACTION_MODEL, SINGLE_SLOT_ACTIONS } from './types.ts';
import type { ActionCatalogData, ActionCatalogEquipmentTemplate, ActionCatalogGatheringMap, ActionCatalogMap, ActionCatalogRecipe, ActionCatalogTechnique, ApiEnvelope, AutoPromotionCycleData, AutoPromotionCycleRequest, AutoPromotionOperation, AutoPromotionPolicy, AutoPromotionPolicyData, AutoPromotionPolicyRequest, BootstrapData, BreakthroughData, BreakthroughRequest, BuildingId, BuildingUpgradeData, BuildingUpgradeRequest, CollectionActionData, CollectionActionRequest, CollectionEventCursor, CollectionEventsData, CollectionEventsRequest, CollectionExchangeData, CollectionExchangeRequest, CollectionPoolId, CombatEvent, CombatPreviewData, CombatPreviewRequest, CombatStats, ConfigReleaseOperationData, ConfigReleaseOperationRequest, DungeonId, DungeonPreviewData, DungeonSettleRequest, DungeonSettlementData, DungeonStartData, DungeonStartRequest, EquipmentActionData, EquipmentActionRequest, EquipmentDropSummary, EquipmentInstance, HighTierDrop, HighTierPreviewData, HighTierRealm, HighTierSettlementData, HighTierSettleRequest, HighTierSkillSummary, HighTierStartData, HighTierStartRequest, LeaderboardData, LeaderboardRequest, LeaderboardType, PlantSpiritFarmData, PlantSpiritFarmRequest, PlantSpiritFarmPlotData, PlantSpiritFarmPlotRequest, PlayerState, ProductionOutputId, QueueBuildingJobData, QueueBuildingJobRequest, RealmId, ReplayData, ResourceId, SettlementData, SettlementRecord, SettlementRequest, ServiceContext, StartActionRequest, StopActionData, StopActionRequest, SwitchActionData, SwitchActionRequest, TreasureDropProgress } from './types.ts';
import type { ContentPackage } from '../content/content-schema.ts';
import { hashPayload, makeInitialPlayer } from './repository.ts';
import type { Repository } from './repository.ts';
import type { MetricsCollector, MetricsEvent, MetricsSink } from './metrics.ts';
import { ConfigReleaseError, validateConfigReleaseSnapshot } from './config-release.ts';
import type { ConfigMigrationPolicy, ConfigParameterMap, ConfigReleaseOperationCommand, ConfigReleaseProvider, ConfigReleaseSnapshot } from './config-release.ts';
import { HighTierCombatContractError, validateHighTierCombatContract } from './high-tier-contract.ts';
import type { HighTierCombatContract } from './high-tier-contract.ts';
import { findHighTierFullCombatClearTime, makeHighTierFullCombatSnapshot, simulateHighTierFullCombat } from './high-tier-full-combat.ts';
import { makeHighTierSignatureCombatEvents, makeHighTierSignatureCombatStartEvents } from './high-tier-signature-combat.ts';
import { LongTermEconomyError, simulateLongTermEconomy, simulateLongTermEconomyConfidence } from './long-term-economy.ts';
import type { LongTermEconomyResult, LongTermHorizonHours, LongTermSupportRoute } from './long-term-economy.ts';
import { LongTermEquipmentConsumptionError, planLongTermEquipmentConsumption } from './long-term-equipment-consumption.ts';
import type { LongTermEquipmentConsumptionResult, LongTermEquipmentDropBatch, LongTermEquipmentQuality } from './long-term-equipment-consumption.ts';
import { decideEquipmentExit, validateEquipmentExitPolicy } from './equipment-exit.ts';
import { writeEquipmentInstanceFromContent } from './equipment-instance-writer.ts';
import { currentRandomEvent, parseRandomEventRuntimeState, settleRandomEventRange } from './random-event-runtime.ts';
import { skillLevelsFromProgress } from './skill-level.ts';

const iso = (date: Date): string => date.toISOString();
type MapRuntime = { seconds: number; stone: number; ore: number; pill: number; chance: number; pity: number; equipmentChance: number };
const buildMaps = (parameters: ConfigParameterMap): Record<string, MapRuntime> => {
  const value = (id: string): number => Number(parameters[id]?.value ?? 0);
  return {
    bai_cao_valley: { seconds: value('map.bai_cao_valley.target_kill_time'), stone: value('map.bai_cao_valley.spirit_stone_per_kill'), ore: value('map.bai_cao_valley.spirit_ore_per_kill'), pill: 0, chance: value('map.bai_cao_valley.ancient_scroll_drop_chance') / 100, pity: value('map.bai_cao_valley.ancient_scroll_pity_kills'), equipmentChance: value('map.bai_cao_valley.equipment_drop_chance') / 100 },
    black_wind_valley: { seconds: value('map.black_wind_valley.target_kill_time'), stone: value('map.black_wind_valley.spirit_stone_per_kill'), ore: value('map.black_wind_valley.spirit_ore_per_kill'), pill: 0, chance: value('map.black_wind_valley.ancient_scroll_drop_chance') / 100, pity: value('map.black_wind_valley.ancient_scroll_pity_kills'), equipmentChance: value('map.black_wind_valley.equipment_drop_chance') / 100 },
    red_flame_cave: { seconds: value('map.red_flame_cave.target_kill_time'), stone: value('map.red_flame_cave.spirit_stone_per_kill'), ore: value('map.red_flame_cave.spirit_ore_per_kill'), pill: 4, chance: value('map.red_flame_cave.ancient_scroll_drop_chance') / 100, pity: value('map.red_flame_cave.ancient_scroll_pity_kills'), equipmentChance: value('map.red_flame_cave.equipment_drop_chance') / 100 },
  };
};
type BreakthroughTransition = { toRealm: RealmId; parameterKey: string; resourceParameters: Partial<Record<ResourceId, string>> };
const breakthroughTransitions: Partial<Record<RealmId, BreakthroughTransition>> = {
  qi_refining: { toRealm: 'foundation_establishment', parameterKey: 'qi_to_foundation', resourceParameters: { spirit_stone: 'spirit_stone_cost', pill: 'pill_cost', ancient_scroll: 'scroll_cost' } },
  foundation_establishment: { toRealm: 'core_formation', parameterKey: 'foundation_to_core', resourceParameters: { spirit_stone: 'spirit_stone_cost', pill: 'pill_cost', ancient_scroll: 'scroll_cost' } },
  core_formation: { toRealm: 'nascent_soul', parameterKey: 'core_to_nascent_soul', resourceParameters: { spirit_stone: 'spirit_stone_cost', pill: 'pill_cost', ancient_scroll: 'ancient_scroll_cost', demon_core: 'demon_core_cost', millennium_herb: 'millennium_herb_cost', meteor_iron: 'meteor_iron_cost' } },
  nascent_soul: { toRealm: 'divine_transformation', parameterKey: 'nascent_soul_to_divine_transformation', resourceParameters: { spirit_stone: 'spirit_stone_cost', pill: 'pill_cost', ancient_scroll: 'ancient_scroll_cost', demon_core: 'demon_core_cost', millennium_herb: 'millennium_herb_cost', meteor_iron: 'meteor_iron_cost' } },
  divine_transformation: { toRealm: 'void_refining', parameterKey: 'divine_transformation_to_void_refining', resourceParameters: { spirit_stone: 'spirit_stone_cost', pill: 'pill_cost', ancient_scroll: 'ancient_scroll_cost', demon_core: 'demon_core_cost', millennium_herb: 'millennium_herb_cost', meteor_iron: 'meteor_iron_cost' } },
  void_refining: { toRealm: 'body_unity', parameterKey: 'void_refining_to_body_unity', resourceParameters: { spirit_stone: 'spirit_stone_cost', pill: 'pill_cost', ancient_scroll: 'ancient_scroll_cost', demon_core: 'demon_core_cost', millennium_herb: 'millennium_herb_cost', meteor_iron: 'meteor_iron_cost' } },
  body_unity: { toRealm: 'great_vehicle', parameterKey: 'body_unity_to_great_vehicle', resourceParameters: { spirit_stone: 'spirit_stone_cost', pill: 'pill_cost', ancient_scroll: 'ancient_scroll_cost', demon_core: 'demon_core_cost', millennium_herb: 'millennium_herb_cost', meteor_iron: 'meteor_iron_cost' } },
  great_vehicle: { toRealm: 'tribulation', parameterKey: 'great_vehicle_to_tribulation', resourceParameters: { spirit_stone: 'spirit_stone_cost', pill: 'pill_cost', ancient_scroll: 'ancient_scroll_cost', demon_core: 'demon_core_cost', millennium_herb: 'millennium_herb_cost', meteor_iron: 'meteor_iron_cost' } },
};
const dungeonIds: DungeonId[] = ['qing_feng', 'yan_prison', 'sky_abyss'];
const highTierRealms: HighTierRealm[] = ['nascent_soul', 'divine_transformation', 'void_refining', 'body_unity', 'great_vehicle', 'tribulation'];
const highTierActionPrefix = 'high_tier_expedition:';
const highTierActionIds = highTierRealms.map((realm) => `${highTierActionPrefix}${realm}`);
const highTierSupplyResources: Array<[ResourceId, string]> = [
  ['spirit_stone', 'spirit_stone_per_hour'],
  ['pill', 'pill_per_hour'],
  ['ancient_scroll', 'ancient_scroll_per_hour'],
  ['demon_core', 'demon_core_per_hour'],
  ['millennium_herb', 'millennium_herb_per_hour'],
  ['meteor_iron', 'meteor_iron_per_hour'],
];
const realmRank: Record<string, number> = { qi_refining: 0, foundation_establishment: 1, core_formation: 2, nascent_soul: 3, divine_transformation: 4, void_refining: 5, body_unity: 6, great_vehicle: 7, tribulation: 8 };
const techniqueQualities = ['mortal', 'yellow', 'xuan', 'earth', 'heaven', 'immortal'];
const treasureIds = ['qing_lian_lamp', 'shan_he_seal', 'heaven_bag', 'zhu_que_feather', 'xuan_gui_shell', 'tai_xu_mirror'];
const collectionExchangeMarksCost = 10;
type TechniquePoolEntry = { id: string; quality: string; weight: number };
const leaderboardTypes: LeaderboardType[] = ['realm', 'cultivation_xp', 'combat_power', 'technique', 'herbalism', 'mining', 'alchemy', 'forge'];
const gatheringActions: Record<string, { skill: 'herbalism' | 'mining'; resource: ResourceId; interval: number; yield: number }> = {
  'herbalism:herb_grove': { skill: 'herbalism', resource: 'spirit_herb', interval: 60, yield: 2 },
  'mining:ore_mine': { skill: 'mining', resource: 'spirit_ore', interval: 60, yield: 1 },
};

const envelope = <T>(data: T, stateRevision: number, context: ServiceContext, now: Date, configVersion: string): ApiEnvelope<T> => ({ requestId: context.requestId ?? randomUUID(), configVersion, stateRevision, serverTime: iso(now), data });
const parseDate = (input: string): Date => { const date = new Date(input); if (!input || Number.isNaN(date.getTime())) throw new ApiError('TIME_RANGE_INVALID', 'invalid timestamp'); return date; };
const deterministicUuid = (seed: string): string => {
  const bytes = createHash('sha256').update(seed).digest('hex').slice(0, 32).split('');
  bytes[12] = '5';
  bytes[16] = ((Number.parseInt(bytes[16]!, 16) & 0x3) | 0x8).toString(16);
  const hex = bytes.join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
};

const collectionCursorPrefix = 'c1.';
const encodeCollectionCursor = (cursor: CollectionEventCursor): string => `${collectionCursorPrefix}${Buffer.from(JSON.stringify({ createdAt: cursor.createdAt.toISOString(), eventId: cursor.eventId }), 'utf8').toString('base64url')}`;
const parseCollectionCursor = (input: string): CollectionEventCursor => {
  if (!input || input.length > 512) throw new ApiError('VALIDATION_FAILED', 'collection event cursor is invalid');
  if (!input.startsWith(collectionCursorPrefix)) {
    const date = new Date(input);
    if (Number.isNaN(date.getTime())) throw new ApiError('VALIDATION_FAILED', 'collection event cursor is invalid');
    return { createdAt: date };
  }
  try {
    const encoded = input.slice(collectionCursorPrefix.length);
    if (!encoded || !/^[A-Za-z0-9_-]+$/.test(encoded)) throw new Error('invalid encoding');
    const value = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as { createdAt?: unknown; eventId?: unknown };
    if (typeof value.createdAt !== 'string' || typeof value.eventId !== 'string' || value.eventId.length === 0 || value.eventId.length > 200) throw new Error('invalid cursor fields');
    const createdAt = new Date(value.createdAt);
    if (Number.isNaN(createdAt.getTime())) throw new Error('invalid cursor timestamp');
    return { createdAt, eventId: value.eventId };
  } catch {
    throw new ApiError('VALIDATION_FAILED', 'collection event cursor is invalid');
  }
};

export class GameService {
  private readonly repository: Repository;
  private readonly clock: () => Date;
  private configVersion: string;
  private parameterSha256: string;
  private migrationPolicy: ConfigMigrationPolicy | null;
  private content: ContentPackage;
  private parameters: ConfigParameterMap;
  private highTierCombatContract: HighTierCombatContract = { mode: 'signature_only_v1', realms: {} };
  private maps: Record<string, MapRuntime>;
  private readonly metrics?: MetricsCollector;
  private readonly metricsSink?: MetricsSink;
  private readonly pendingMetricWrites = new Set<Promise<void>>();
  private readonly releaseProvider?: ConfigReleaseProvider;
  private configRefreshInFlight: Promise<string> | null = null;
  private readonly configOperationResponses = new Map<string, ApiEnvelope<ConfigReleaseOperationData>>();

  constructor(repository: Repository, clock: () => Date = () => new Date(), configVersion?: string, content?: ContentPackage, metrics?: MetricsCollector, releaseProvider?: ConfigReleaseProvider, metricsSink?: MetricsSink, resolvedSnapshot?: ConfigReleaseSnapshot) {
    const snapshot = resolvedSnapshot ?? releaseProvider?.getActiveSnapshot();
    if (snapshot) {
      const active = validateConfigReleaseSnapshot(snapshot);
      if (configVersion !== undefined && active.version !== configVersion) throw new ApiError('CONFIG_VERSION_MISMATCH', 'active release version does not match service config version', { serviceConfigVersion: configVersion, activeReleaseVersion: active.version });
      configVersion = active.version;
      content = active.content;
      this.parameters = active.parameters;
      this.parameterSha256 = active.parameterSha256;
      this.migrationPolicy = active.migrationPolicy ?? null;
    } else {
      this.parameters = FROZEN_PARAMETERS;
      this.parameterSha256 = content?.manifest.parameter_sha256 ?? CONTENT_PACKAGE.manifest.parameter_sha256;
      this.migrationPolicy = null;
    }
    try {
      this.highTierCombatContract = validateHighTierCombatContract(this.parameters);
    } catch (error) {
      if (error instanceof HighTierCombatContractError) throw new ApiError('VALIDATION_FAILED', error.message, { contract: 'high_tier', diagnostics: error.diagnostics });
      throw error;
    }
    this.repository = repository;
    this.clock = clock;
    this.configVersion = configVersion ?? CONFIG_VERSION;
    this.content = content ?? CONTENT_PACKAGE;
    this.maps = buildMaps(this.parameters);
    this.metrics = metrics;
    this.releaseProvider = releaseProvider;
    this.metricsSink = metricsSink;
  }

  /** Resolve an immutable request-scoped service from the shared release store.
   * The returned instance shares the repository and telemetry sinks but owns
   * the selected config snapshot, so concurrent players cannot contaminate
   * one another when a canary is active. */
  async forPlayer(playerId: string, requestedVersion?: string): Promise<GameService> {
    if (!this.releaseProvider) {
      if (requestedVersion && requestedVersion !== this.configVersion) throw new ApiError('CONFIG_VERSION_MISMATCH', 'requested config version is not supported', { requestedConfigVersion: requestedVersion, activeConfigVersion: this.configVersion });
      return this;
    }
    const snapshot = await (this.releaseProvider.getSnapshotForPlayer ? this.releaseProvider.getSnapshotForPlayer(playerId) : this.releaseProvider.getActiveSnapshot());
    if (!snapshot) throw new ApiError('CONFIG_VERSION_MISMATCH', 'requested config release is unavailable', { requestedConfigVersion: requestedVersion, playerId });
    if (requestedVersion && requestedVersion !== snapshot.version) throw new ApiError('CONFIG_VERSION_MISMATCH', 'request config version is not the release assigned to this player', { requestedConfigVersion: requestedVersion, assignedConfigVersion: snapshot.version, playerId });
    return new GameService(this.repository, this.clock, snapshot.version, snapshot.content, this.metrics, undefined, this.metricsSink, snapshot);
  }

  async forConfigVersion(version: string): Promise<GameService> {
    if (!this.releaseProvider?.getSnapshot) throw new ApiError('CONFIG_VERSION_MISMATCH', 'historical config release lookup is not configured');
    const snapshot = await this.releaseProvider.getSnapshot(version);
    if (!snapshot) throw new ApiError('CONFIG_VERSION_MISMATCH', 'historical config release is unavailable', { requestedConfigVersion: version });
    return new GameService(this.repository, this.clock, snapshot.version, snapshot.content, this.metrics, undefined, this.metricsSink, snapshot);
  }

  currentConfigVersion(): string { return this.configVersion; }

  private currentConfigSnapshot(): ConfigReleaseSnapshot {
    return {
      version: this.configVersion,
      parameterSha256: this.parameterSha256,
      contentSha256: this.content.manifest.content_sha256,
      content: structuredClone(this.content),
      parameters: structuredClone(this.parameters),
      migrationPolicy: this.migrationPolicy ? structuredClone(this.migrationPolicy) : null,
    };
  }

  private serviceForAttempt(snapshot?: ConfigReleaseSnapshot): GameService {
    if (!snapshot) throw new ApiError('CONFIG_VERSION_MISMATCH', 'attempt configuration snapshot is unavailable; legacy active attempts cannot be settled', { migrationRequired: true });
    return new GameService(this.repository, this.clock, snapshot.version, snapshot.content, this.metrics, undefined, this.metricsSink, snapshot);
  }

  async refreshActiveConfig(): Promise<string> {
    if (!this.releaseProvider) throw new ApiError('CONFIG_VERSION_MISMATCH', 'config release provider is not configured');
    if (this.configRefreshInFlight) return this.configRefreshInFlight;
    const refresh = async (): Promise<string> => {
      const snapshot = this.releaseProvider?.refresh ? await this.releaseProvider.refresh() : this.releaseProvider?.getActiveSnapshot();
      if (!snapshot) throw new ApiError('CONFIG_VERSION_MISMATCH', 'active config release is unavailable');
      const active = validateConfigReleaseSnapshot(snapshot);
      this.content = active.content;
      this.parameters = active.parameters;
      this.highTierCombatContract = validateHighTierCombatContract(active.parameters);
      this.parameterSha256 = active.parameterSha256;
      this.migrationPolicy = active.migrationPolicy ?? null;
      this.maps = buildMaps(active.parameters);
      this.configVersion = active.version;
      return this.configVersion;
    };
    const inFlight = refresh();
    this.configRefreshInFlight = inFlight;
    try { return await inFlight; } finally { if (this.configRefreshInFlight === inFlight) this.configRefreshInFlight = null; }
  }

  async reloadConfig(): Promise<string> { return this.refreshActiveConfig(); }

  async configReleaseOperation(request: ConfigReleaseOperationRequest): Promise<ApiEnvelope<ConfigReleaseOperationData>> {
    const now = request.now ?? this.clock();
    this.assertContext(request);
    if (!request.version || request.version.trim().length === 0 || !request.operatorSubject || request.operatorSubject.trim().length === 0) throw new ApiError('VALIDATION_FAILED', 'version and operatorSubject are required');
    if (!request.reason || request.reason.trim().length < 3 || request.reason.length > 500) throw new ApiError('VALIDATION_FAILED', 'reason must be between 3 and 500 characters');
    if (request.operation === 'canary' && (request.canaryPercent === undefined || !Number.isFinite(request.canaryPercent) || request.canaryPercent <= 0 || request.canaryPercent > 100)) throw new ApiError('VALIDATION_FAILED', 'canaryPercent must be greater than 0 and at most 100');
    const key = request.idempotencyKey ? `${request.operatorSubject}:${request.operation}:${request.version}:${request.idempotencyKey}` : null;
    const provider = this.releaseProvider;
    if (key && provider?.runOperation) {
      const command: ConfigReleaseOperationCommand = {
        operation: request.operation,
        version: request.version,
        canaryPercent: request.canaryPercent,
        meta: { operatorSubject: request.operatorSubject, reason: request.reason.trim() },
        idempotencyKey: key,
        requestId: request.requestId ?? randomUUID(),
        serverTime: now.toISOString(),
      };
      try {
        const record = await provider.runOperation(command);
        // Refresh local process state after a committed operation. The
        // persisted record remains the response source so a retry after a
        // restart receives the original requestId/time and activeVersion.
        await this.refreshActiveConfig();
        return structuredClone(record) as ApiEnvelope<ConfigReleaseOperationData>;
      } catch (error) {
        if (error instanceof ConfigReleaseError) throw new ApiError('VALIDATION_FAILED', error.message, error.details);
        throw error;
      }
    }
    if (!provider) throw new ApiError('CONFIG_VERSION_MISMATCH', 'config release provider is not configured');
    const meta = { operatorSubject: request.operatorSubject, reason: request.reason.trim() };
    try {
      if (request.operation === 'canary') {
        if (!provider.startCanary) throw new ApiError('CONFIG_VERSION_MISMATCH', 'config release canary operation is not configured');
        await provider.startCanary(request.version, request.canaryPercent as number, meta);
      } else if (request.operation === 'activate') {
        if (!provider.activate) throw new ApiError('CONFIG_VERSION_MISMATCH', 'config release activate operation is not configured');
        await provider.activate(request.version, meta);
      } else {
        if (!provider.rollback) throw new ApiError('CONFIG_VERSION_MISMATCH', 'config release rollback operation is not configured');
        await provider.rollback(request.version, meta);
      }
    } catch (error) {
      if (error instanceof ConfigReleaseError) throw new ApiError('VALIDATION_FAILED', error.message, error.details);
      throw error;
    }
    await this.refreshActiveConfig();
    const activeVersion = this.configVersion;
    const result = envelope({ operation: request.operation, targetVersion: request.version, activeVersion }, 0, request, now, this.configVersion);
    if (key) this.configOperationResponses.set(key, structuredClone(result));
    return result;
  }

  async bootstrap(playerId: string, context: ServiceContext = {}): Promise<ApiEnvelope<BootstrapData>> {
    const now = context.now ?? this.clock();
    validateContentPackage(this.content, context.configVersion ?? this.configVersion, this.parameterSha256);
    const player = await this.ensurePlayerConfig(playerId, context, now);
    const contentActions = this.content.maps.filter((map) => !isContentPending(map)).map((map) => map.id);
    return envelope({ player: { ...player, skillLevels: skillLevelsFromProgress(player.skillProgress) }, availableActions: ['training', ...contentActions, ...SINGLE_SLOT_ACTIONS, 'technique_training', 'herbalism', 'mining'], pendingSettlement: player.primaryAction.startedAt && player.primaryAction.actionId ? { startedAt: player.lastSettledAt, endedAt: iso(now) } : null }, player.stateRevision, context, now, this.configVersion);
  }

  /**
   * Read-only directory consumed by future clients when presenting action
   * targets. It deliberately exposes proposal runtime gathering/technique
   * semantics as proposal_v1 instead of silently promoting them to frozen
   * content. This method never migrates or settles player state.
   */
  async actionCatalog(playerId: string, context: ServiceContext = {}): Promise<ApiEnvelope<ActionCatalogData>> {
    const now = context.now ?? this.clock();
    validateContentPackage(this.content, context.configVersion ?? this.configVersion, this.parameterSha256);
    const player = await this.readOnlyPlayerConfig(playerId, context);
    const catalogStatus = (status?: string): 'released' | 'proposal_v1' | 'content_pending' => status === 'content_pending' ? 'content_pending' : status === 'content_spec_v1' ? 'proposal_v1' : 'released';
    const growth = {
      attackPerLayer: this.value('growth.technique.attack_per_layer'),
      defencePerLayer: this.value('growth.technique.defence_per_layer'),
      healthPerLayer: this.value('growth.technique.health_per_layer'),
      cultivationRateBonusPerLayer: this.value('growth.technique.cultivation_rate_bonus_per_layer'),
      maxLayer: this.value('growth.technique.max_layer'),
    };
    const techniques: ActionCatalogTechnique[] = this.techniquePool().map((entry) => ({
      id: entry.id,
      quality: entry.quality,
      status: 'released' as const,
      source: 'frozen_parameter_pool' as const,
      supportsFocusCultivation: false,
      element: String(this.rawValue(`growth.technique.pool.${entry.id.split('.')[2]}.element`) ?? ''),
      growth: {
        attackPerLayer: growth.attackPerLayer * this.value(`growth.technique.quality_multiplier.${entry.quality}`),
        defencePerLayer: growth.defencePerLayer * this.value(`growth.technique.quality_multiplier.${entry.quality}`),
        healthPerLayer: growth.healthPerLayer * this.value(`growth.technique.quality_multiplier.${entry.quality}`),
        cultivationRateBonusPerLayer: growth.cultivationRateBonusPerLayer,
        qualityMultiplier: this.value(`growth.technique.quality_multiplier.${entry.quality}`),
        maxLayer: growth.maxLayer,
      },
    }));
    const recipes: ActionCatalogRecipe[] = this.content.recipes.map((recipe) => ({
      id: recipe.id,
      actionId: recipe.building_id === 'forge_room' ? 'forge' : 'alchemy',
      buildingId: recipe.building_id,
      outputResource: recipe.output_resource,
      outputAmount: this.value(recipe.output_parameter),
      intervalSeconds: this.value(recipe.interval_parameter),
      inputCosts: Object.fromEntries(Object.entries(recipe.input_parameters).map(([resource, parameter]) => [resource, this.value(parameter)])) as Partial<Record<ResourceId, number>>,
      status: catalogStatus(recipe.status),
      source: 'content_package',
    }));
    const equipmentTemplates: ActionCatalogEquipmentTemplate[] = this.content.equipment.map((template) => ({
      id: template.id,
      displayName: template.display_name,
      slot: template.slot,
      quality: template.quality,
      sourceMapIds: template.source_map_ids ?? [],
      status: catalogStatus(template.status),
      source: 'content_package',
    }));
    const maps: ActionCatalogMap[] = this.content.maps.map((map) => ({
      id: map.id,
      displayName: map.display_name,
      kind: 'combat',
      actionId: map.id,
      unlockRealmId: map.unlock_realm_id,
      unlocked: (realmRank[player.realmId] ?? -1) >= (realmRank[map.unlock_realm_id] ?? Number.MAX_SAFE_INTEGER),
      targetKillTimeSeconds: this.value(map.target_kill_time_parameter),
      status: catalogStatus(map.status),
      source: 'content_package',
    }));
    const gatheringMaps: ActionCatalogGatheringMap[] = [
      { id: 'herb_grove', displayName: '灵草药圃', actionId: 'herbalism', kind: 'gathering', resourceId: 'spirit_herb', intervalSeconds: gatheringActions['herbalism:herb_grove'].interval, yieldPerCompletion: gatheringActions['herbalism:herb_grove'].yield, status: 'proposal_v1', source: 'runtime_proposal_v1' },
      { id: 'ore_mine', displayName: '灵矿矿脉', actionId: 'mining', kind: 'gathering', resourceId: 'spirit_ore', intervalSeconds: gatheringActions['mining:ore_mine'].interval, yieldPerCompletion: gatheringActions['mining:ore_mine'].yield, status: 'proposal_v1', source: 'runtime_proposal_v1' },
    ];
    const actions: ActionCatalogData['actions'] = [
      { actionId: 'training', kind: 'training', selection: 'none', status: 'released', source: 'frozen_v1' },
      { actionId: 'technique_training', kind: 'technique', selection: 'techniqueId', status: 'proposal_v1', source: 'proposal_v1' },
      { actionId: 'alchemy', kind: 'alchemy', selection: 'recipeId', status: recipes.some((recipe) => recipe.actionId === 'alchemy' && recipe.status === 'released') ? 'released' : 'content_pending', source: 'content_package' },
      { actionId: 'forge', kind: 'forge', selection: 'recipeId+equipmentTemplateId', status: recipes.some((recipe) => recipe.actionId === 'forge' && recipe.status === 'released') && equipmentTemplates.some((template) => template.status === 'released') ? 'released' : 'content_pending', source: 'content_package' },
      { actionId: 'herbalism', kind: 'gathering', selection: 'mapId', status: 'proposal_v1', source: 'proposal_v1' },
      { actionId: 'mining', kind: 'gathering', selection: 'mapId', status: 'proposal_v1', source: 'proposal_v1' },
      ...maps.map((map) => ({ actionId: map.actionId, kind: 'combat' as const, selection: 'none' as const, status: map.status, source: 'content_package' as const })),
    ];
    return envelope({ schemaVersion: 'action_catalog_v1', actionModel: SINGLE_SLOT_ACTION_MODEL, actions, techniques, recipes, equipmentTemplates, maps, gatheringMaps, focusCultivation: { id: 'focus_cultivation', actionId: 'technique_training', status: 'proposal_v1', source: 'runtime_proposal_v1' } }, player.stateRevision, context, now, this.configVersion);
  }

  async createPlayer(playerId: string, at = this.clock()): Promise<ApiEnvelope<BootstrapData>> {
    await this.repository.createPlayer(makeInitialPlayer(playerId, at, this.configVersion));
    return this.bootstrap(playerId, { now: at });
  }

  async leaderboard(request: LeaderboardRequest): Promise<ApiEnvelope<LeaderboardData>> {
    const now = request.now ?? this.clock();
    this.assertContext(request);
    if (!leaderboardTypes.includes(request.type) || !Number.isSafeInteger(request.limit) || request.limit < 1 || request.limit > 100 || !Number.isSafeInteger(request.offset) || request.offset < 0 || request.offset > 100000) throw new ApiError('VALIDATION_FAILED', 'leaderboard type or pagination is invalid');
    const player = await this.ensurePlayerConfig(request.playerId, request, now);
    return envelope(await this.repository.getLeaderboard(request.type, request.limit, request.offset), player.stateRevision, request, now, this.configVersion);
  }

  async collectionEvents(request: CollectionEventsRequest): Promise<ApiEnvelope<CollectionEventsData>> {
    const now = request.now ?? this.clock();
    this.assertContext(request);
    if (!Number.isSafeInteger(request.limit) || request.limit < 1 || request.limit > 100) throw new ApiError('VALIDATION_FAILED', 'collection event limit must be between 1 and 100');
    const before = request.before === undefined ? undefined : parseCollectionCursor(request.before);
    let player: PlayerState;
    try {
      player = await this.ensurePlayerConfig(request.playerId, request, now);
    } catch (error) {
      if (error instanceof ApiError && error.code === 'VALIDATION_FAILED') throw new ApiError('NOT_FOUND', 'player does not exist');
      throw error;
    }
    const events = await this.repository.listCollectionEvents(request.playerId, request.limit, before);
    const last = events.at(-1);
    const nextBefore = events.length === request.limit && last ? encodeCollectionCursor({ createdAt: new Date(last.createdAt), eventId: last.eventId }) : null;
    return envelope({ events, nextBefore }, player.stateRevision, request, now, this.configVersion);
  }

  async currentRevision(playerId: string): Promise<number | null> {
    try { return (await this.repository.getPlayer(playerId)).stateRevision; } catch { return null; }
  }

  metricsPrometheus(): string {
    return this.metrics?.toPrometheus() ?? '# HELP dongtian_metrics_unavailable Metrics collector is not configured.\n# TYPE dongtian_metrics_unavailable gauge\ndongtian_metrics_unavailable 1\n';
  }

  /**
   * Durable scrape path. Keep the historical synchronous method above for
   * embedders and tests; HTTP callers can await this method when a shared
   * PostgreSQL sink is enabled. Any backend failure deliberately falls back to
   * the local collector so observability cannot take down gameplay traffic.
   */
  async metricsPrometheusAsync(at = Date.now()): Promise<string> {
    if (this.metricsSink?.toPrometheus) {
      try {
        return await this.metricsSink.toPrometheus(at);
      } catch {
        // Best-effort telemetry: serve the last local view on backend errors.
      }
    }
    return this.metricsPrometheus();
  }

  /** Wait only for telemetry writes that were already dispatched. */
  async flushMetrics(): Promise<void> {
    await Promise.all([...this.pendingMetricWrites]);
  }

  async replaySettlement(playerId: string, settlementId: string, context: ServiceContext = {}): Promise<ApiEnvelope<ReplayData>> {
    const now = context.now ?? this.clock();
    this.assertContext(context);
    const record = await this.repository.getSettlement(settlementId);
    if (!record || record.playerId !== playerId) throw new ApiError('NOT_FOUND', 'settlement replay does not exist');
    if (record.configVersion !== this.configVersion && this.releaseProvider?.getSnapshot) {
      const historical = await this.forConfigVersion(record.configVersion);
      return historical.replaySettlement(playerId, settlementId, { ...context, configVersion: record.configVersion });
    }
    return envelope({ settlementId: record.settlementId, status: record.status, configVersion: record.configVersion, committedRevision: record.committedRevision, settledSeconds: record.settledSeconds, responsePayload: structuredClone(record.responsePayload) }, record.committedRevision ?? 0, context, now, this.configVersion);
  }

  async randomEventsCurrent(playerId: string, context: ServiceContext = {}): Promise<ApiEnvelope<import('./types.ts').RandomEventCurrentData>> {
    const now = context.now ?? this.clock();
    this.assertContext(context);
    await this.ensurePlayerConfig(playerId, context, now);
    const player = await this.repository.getPlayer(playerId);
    const parsed = parseRandomEventRuntimeState(player.randomEventState);
    if (parsed) {
      return envelope({ mode: 'runtime_v1', window: currentRandomEvent(parsed, now) }, player.stateRevision, context, now, this.configVersion);
    }
    return envelope({ mode: Object.keys(player.randomEventState).length === 0 ? 'uninitialized' : 'opaque_legacy', window: null }, player.stateRevision, context, now, this.configVersion);
  }

  async startAction(request: StartActionRequest): Promise<ApiEnvelope<{ actionId: string }>> {
    const now = request.now ?? this.clock();
    this.assertContext(request);
    await this.ensurePlayerConfig(request.playerId, request, now);
    const highTierRealm = this.highTierExpeditionRealm(request.actionId);
    const singleSlotAction = (SINGLE_SLOT_ACTIONS as readonly string[]).includes(request.actionId);
    const targetId = this.actionTargetId(request);
    const gathering = gatheringActions[request.actionId] ?? (targetId ? gatheringActions[`${request.actionId}:${targetId}`] : undefined);
    const techniqueTraining = request.actionId === 'technique_training';
    if (request.actionId !== 'training' && !['herbalism', 'mining'].includes(request.actionId) && !this.content.maps.some((map) => map.id === request.actionId && !isContentPending(map)) && !highTierRealm && !singleSlotAction && !gathering && !techniqueTraining) throw new ApiError('CONTENT_LOCKED', `action is not available: ${request.actionId}`);
    if (['herbalism', 'mining'].includes(request.actionId) && !gatheringActions[`${request.actionId}:${targetId}`]) throw new ApiError('CONTENT_LOCKED', `gathering map is unavailable: ${targetId}`);
    if (techniqueTraining && !targetId) throw new ApiError('VALIDATION_FAILED', 'technique_training requires techniqueId');
    if (techniqueTraining && targetId !== 'focus_cultivation' && !this.techniquePool().some((entry) => entry.id === targetId)) throw new ApiError('CONTENT_LOCKED', `technique is unavailable: ${targetId}`);
    if (singleSlotAction && ['alchemy', 'forge', 'alchemy_basic', 'forge_basic'].includes(request.actionId)) {
      const recipeId = request.recipeId ?? request.actionId;
      const recipe = this.content.recipes.find((candidate) => candidate.id === recipeId && candidate.building_id === (request.actionId === 'forge' || request.actionId === 'forge_basic' ? 'forge_room' : 'alchemy_room') && !isContentPending(candidate));
      if (!recipe) throw new ApiError('CONTENT_LOCKED', `recipe ${recipeId} is unavailable`, { recipeId, actionId: request.actionId });
      if ((request.actionId === 'forge' || request.actionId === 'forge_basic') && request.equipmentTemplateId !== undefined) this.requireProductionEquipmentTemplate(request.equipmentTemplateId);
    }
    // Scope idempotency to the operation target. A key reused for another
    // action must never replay the first action's response.
    const actionKey = request.idempotencyKey ? `${request.playerId}:action:${request.actionId}:${targetId ?? 'legacy'}:${request.idempotencyKey}` : undefined;
    const legacyActionKey = request.idempotencyKey ? `${request.playerId}:${request.idempotencyKey}` : undefined;
    const previous = await this.previousActionResponse<ApiEnvelope<{ actionId: string }>>(actionKey, legacyActionKey, (value) => (value as { data?: { actionId?: unknown } })?.data?.actionId === request.actionId);
    if (previous) return previous;
    const current = await this.repository.getPlayer(request.playerId);
    if (Object.values(current.dungeonAttempts).some((attempt) => attempt.status === 'active') || Object.values(current.highTierAttempts).some((attempt) => attempt.status === 'active')) throw new ApiError('VALIDATION_FAILED', 'an expedition attempt already owns the global action slot', { requires: 'settle_attempt' });
    // Starting a different sequence is itself a terminal transition for the
    // old sequence. Reuse the durable switch path so its settlement and
    // inventory writes are replayable before the new action is committed.
    if (current.primaryAction.actionId && (current.primaryAction.actionId !== request.actionId || (current.primaryAction.targetId ?? null) !== (targetId ?? null))) {
      const transitionKey = request.idempotencyKey ? `${request.idempotencyKey}:auto-switch` : `${request.requestId ?? 'request'}:${request.actionId}:${now.toISOString()}`;
      const stoppedAndStarted = await this.switchAction({
        playerId: request.playerId,
        actionId: request.actionId,
        recipeId: request.recipeId,
        equipmentTemplateId: request.equipmentTemplateId,
        techniqueId: request.techniqueId,
        mapId: request.mapId,
        settlementId: deterministicUuid(`${request.playerId}:${transitionKey}:${current.primaryAction.actionId}:${now.toISOString()}`),
        requestedStartedAt: current.lastSettledAt,
        requestedEndedAt: iso(now),
        expectedRevision: request.expectedRevision,
        requestId: request.requestId,
        configVersion: request.configVersion,
        now,
        idempotencyKey: transitionKey,
      });
      const switched = envelope(stoppedAndStarted.data.started, stoppedAndStarted.stateRevision, request, now, this.configVersion);
      if (actionKey) await this.repository.recordActionResponse(request.playerId, actionKey, switched);
      return switched;
    }
    if (current.primaryAction.actionId === request.actionId && (current.primaryAction.targetId ?? null) === (targetId ?? null)) {
      if (highTierRealm && (current.highTierState.status === 'fighting' || Object.values(current.highTierAttempts).some((attempt) => attempt.status === 'active'))) throw new ApiError('VALIDATION_FAILED', 'a high-tier Boss attempt is already active');
      const alreadyActive = envelope({ actionId: request.actionId }, current.stateRevision, request, now, this.configVersion);
      if (actionKey) await this.repository.recordActionResponse(request.playerId, actionKey, alreadyActive);
      return alreadyActive;
    }
    const map = request.actionId === 'training' ? undefined : this.content.maps.find((item) => item.id === request.actionId && !isContentPending(item));
    let result: ApiEnvelope<{ actionId: string }>;
    try {
      result = await this.repository.transaction(request.playerId, request.expectedRevision, { eventType: 'action_started', payload: { actionId: request.actionId, targetId: targetId ?? null }, at: now }, (draft) => {
      if (Object.values(draft.dungeonAttempts).some((attempt) => attempt.status === 'active') || Object.values(draft.highTierAttempts).some((attempt) => attempt.status === 'active')) throw new ApiError('VALIDATION_FAILED', 'an expedition attempt already owns the global action slot', { requires: 'settle_attempt' });
      if (map) {
        const requiredRealm = realmRank[map.unlock_realm_id];
        if (requiredRealm === undefined || (realmRank[draft.realmId] ?? -1) < requiredRealm) throw new ApiError('GATE_BLOCKED', `map ${request.actionId} requires realm ${map.unlock_realm_id}`, { requiredRealm: map.unlock_realm_id, currentRealm: draft.realmId });
        const cooldown = draft.failureCooldownUntil ? new Date(draft.failureCooldownUntil) : null;
        if (cooldown && cooldown > now) throw new ApiError('COOLDOWN_ACTIVE', 'map is in failure recovery cooldown', { until: iso(cooldown) });
      }
      if (highTierRealm) {
        if (draft.realmId !== highTierRealm) throw new ApiError('GATE_BLOCKED', `high-tier expedition ${highTierRealm} requires matching player realm`, { requiredRealm: highTierRealm, currentRealm: draft.realmId });
        if (draft.highTierState.status === 'fighting' || Object.values(draft.highTierAttempts).some((attempt) => attempt.status === 'active')) throw new ApiError('VALIDATION_FAILED', 'a high-tier Boss attempt is already active');
        if (this.value('economy.inventory.transition_capacity_unlock') === 1) this.applyRealmCapacityUnlock(draft, highTierRealm);
      }
      if (draft.primaryAction.actionId && draft.primaryAction.actionId !== request.actionId) throw new ApiError('STALE_REVISION', 'primary action changed before sequence start');
      draft.primaryAction = { actionId: request.actionId, targetId: targetId ?? null, startedAt: iso(now), carrySeconds: highTierRealm ? 0 : draft.primaryAction.carrySeconds, modelVersion: SINGLE_SLOT_ACTION_MODEL };
      return envelope({ actionId: request.actionId }, draft.stateRevision + 1, request, now, this.configVersion);
      }, undefined, actionKey);
    } catch (error) {
      if (error instanceof ApiError && error.code === 'GATE_BLOCKED') this.recordMetric({ type: 'map_gate', at: now });
      else if (error instanceof ApiError && error.code === 'COOLDOWN_ACTIVE') this.recordMetric({ type: 'map_cooldown', at: now });
      throw error;
    }
    return result;
  }

  async stopAction(request: StopActionRequest): Promise<ApiEnvelope<StopActionData>> {
    const now = request.now ?? this.clock();
    this.assertContext(request);
    await this.ensurePlayerConfig(request.playerId, request, now);
    const actionKey = request.idempotencyKey ? `${request.playerId}:action:stop:${request.settlementId}:${request.idempotencyKey}` : undefined;
    const previous = actionKey ? await this.repository.getActionResponse(actionKey) : null;
    if (previous) return structuredClone(previous) as ApiEnvelope<StopActionData>;
    const current = await this.repository.getPlayer(request.playerId);
    const actionId = current.primaryAction.actionId;
    if (!actionId) throw new ApiError('VALIDATION_FAILED', 'no primary action is active');
    const { idempotencyKey: _stopIdempotencyKey, ...settlementRequest } = request;
    const settlement = await this.offlineSettlement(settlementRequest);
    const stopped = await this.repository.transaction(request.playerId, settlement.stateRevision, { eventType: 'action_stopped', settlementId: request.settlementId, payload: { actionId, settlementId: request.settlementId }, at: now }, (draft) => {
      // A failed ordinary map settlement owns the terminal transition and
      // clears the action before stopAction's second CAS. Preserve the stop
      // response contract for that expected state, while rejecting any other
      // action mismatch as stale.
      const failedMapAlreadyStopped = settlement.data.failed && draft.primaryAction.actionId === null;
      if (draft.primaryAction.actionId !== actionId && !failedMapAlreadyStopped) throw new ApiError('STALE_REVISION', 'primary action changed before it could be stopped');
      draft.primaryAction = { actionId: null, targetId: null, startedAt: null, carrySeconds: 0, modelVersion: SINGLE_SLOT_ACTION_MODEL };
      return envelope({ actionId, settlement, stoppedAt: iso(now) }, draft.stateRevision + 1, request, now, this.configVersion);
    }, undefined, actionKey);
    return stopped;
  }

  async switchAction(request: SwitchActionRequest): Promise<ApiEnvelope<SwitchActionData>> {
    const now = request.now ?? this.clock();
    this.assertContext(request);
    await this.ensurePlayerConfig(request.playerId, request, now);
    const switchKey = request.idempotencyKey ? `${request.playerId}:action:switch:${request.actionId}:${request.idempotencyKey}` : undefined;
    const previous = switchKey ? await this.repository.getActionResponse(switchKey) : null;
    if (previous) return structuredClone(previous) as ApiEnvelope<SwitchActionData>;
    const stopKey = request.idempotencyKey ? `${request.idempotencyKey}:stop` : undefined;
    const startKey = request.idempotencyKey ? `${request.idempotencyKey}:start` : undefined;
    const stopped = await this.stopAction({ ...request, idempotencyKey: stopKey });
    const started = await this.startAction({ playerId: request.playerId, actionId: request.actionId, recipeId: request.recipeId, equipmentTemplateId: request.equipmentTemplateId, techniqueId: request.techniqueId, mapId: request.mapId, expectedRevision: stopped.stateRevision, requestId: request.requestId, configVersion: request.configVersion, now, idempotencyKey: startKey });
    const response = envelope({ stopped: stopped.data, started: started.data }, started.stateRevision, request, now, this.configVersion);
    if (switchKey) {
      await this.repository.recordActionResponse(request.playerId, switchKey, response);
      const persisted = await this.repository.getActionResponse(switchKey);
      return (persisted ?? response) as ApiEnvelope<SwitchActionData>;
    }
    return response;
  }

  async queueBuildingJob(request: QueueBuildingJobRequest): Promise<ApiEnvelope<QueueBuildingJobData>> {
    const now = request.now ?? this.clock();
    this.assertContext(request);
    await this.ensurePlayerConfig(request.playerId, request, now);
    if (!Number.isInteger(request.quantity) || request.quantity <= 0 || request.quantity > 10000) throw new ApiError('VALIDATION_FAILED', 'quantity must be an integer between 1 and 10000');
    const recipe = this.content.recipes.find((item) => item.id === request.recipeId && item.building_id === request.buildingId && !isContentPending(item));
    if (!recipe) throw new ApiError('CONTENT_LOCKED', `recipe ${request.recipeId} is not available in ${request.buildingId}`);
    const actionKey = request.idempotencyKey ? `${request.playerId}:building:${request.buildingId}:${request.recipeId}:${request.quantity}:${request.idempotencyKey}` : undefined;
    const legacyActionKey = request.idempotencyKey ? `${request.playerId}:building:${request.idempotencyKey}` : undefined;
    const previous = await this.previousActionResponse<ApiEnvelope<QueueBuildingJobData>>(actionKey, legacyActionKey, (value) => {
      const data = (value as { data?: { buildingId?: unknown; recipeId?: unknown; quantity?: unknown } })?.data;
      return data?.buildingId === request.buildingId && data.recipeId === request.recipeId && data.quantity === request.quantity;
    });
    if (previous) return previous;
    // `global_single_slot_v1` has no background alchemy/forge queue. Keep the
    // legacy route readable for old clients, but reject new reservations even
    // while the slot is idle; otherwise an idle settlement could run two
    // legacy queues in parallel and bypass the action model. This check stays
    // after idempotency lookup so historical responses remain replayable.
    const queueOwner = await this.repository.getPlayer(request.playerId);
    if (queueOwner.primaryAction.modelVersion === SINGLE_SLOT_ACTION_MODEL) {
      throw new ApiError('VALIDATION_FAILED', 'legacy building queues are disabled by the global action model', { modelVersion: SINGLE_SLOT_ACTION_MODEL, requires: 'start_action' });
    }
    const inputs = this.recipeInputCosts(recipe);
    return await this.repository.transaction(request.playerId, request.expectedRevision, { eventType: 'building_job_queued', payload: { buildingId: request.buildingId, recipeId: request.recipeId, quantity: request.quantity }, at: now }, (draft) => {
      // Building jobs are a legacy compatibility surface. A live global
      // action owns the only active production slot, so accepting a queued
      // job here would silently reintroduce parallel alchemy/forge work.
      if (draft.primaryAction.actionId) throw new ApiError('VALIDATION_FAILED', 'legacy building jobs cannot be queued while an active sequence is running', { activeActionId: draft.primaryAction.actionId, requires: 'stop_action' });
      const building = draft.buildings[request.buildingId];
      if (!building) throw new ApiError('CONTENT_LOCKED', `building is not available: ${request.buildingId}`);
      for (const [resource, unitCost] of Object.entries(inputs) as [ResourceId, number][]) {
        const available = draft.resources[resource].amount;
        const required = unitCost * request.quantity;
        if (available < required) throw new ApiError('RESOURCE_INSUFFICIENT', `insufficient ${resource}`, { resource, required, available });
      }
      const jobId = randomUUID();
      draft.buildingJobs[jobId] = { jobId, buildingId: request.buildingId, recipeId: request.recipeId, remainingQuantity: request.quantity, queuedAt: iso(now) };
      building.queuedJobIds.push(jobId);
      if (!building.activeJobId) { building.activeJobId = jobId; building.jobStartedAt = iso(now); }
      for (const [resource, unitCost] of Object.entries(inputs) as [ResourceId, number][]) {
        const reserved = unitCost * request.quantity;
        draft.resources[resource].amount -= reserved;
        draft.resources[resource].reservedAmount += reserved;
      }
      return envelope({ jobId, buildingId: request.buildingId, recipeId: request.recipeId, quantity: request.quantity, reservedInputs: Object.fromEntries(Object.entries(inputs).map(([resource, unitCost]) => [resource, unitCost * request.quantity])) }, draft.stateRevision + 1, request, now, this.configVersion);
    }, undefined, actionKey);
  }

  async upgradeBuilding(request: BuildingUpgradeRequest): Promise<ApiEnvelope<BuildingUpgradeData>> {
    const now = request.now ?? this.clock();
    this.assertContext(request);
    await this.ensurePlayerConfig(request.playerId, request, now);
    const actionKey = request.idempotencyKey ? `${request.playerId}:building-upgrade:${request.buildingId}:${request.idempotencyKey}` : undefined;
    if (actionKey) { const previous = await this.repository.getActionResponse(actionKey); if (previous) return previous as ApiEnvelope<BuildingUpgradeData>; }
    return await this.repository.transaction(request.playerId, request.expectedRevision, { eventType: 'building_upgraded', payload: { buildingId: request.buildingId }, at: now }, (draft) => {
      const building = draft.buildings[request.buildingId];
      if (!building) throw new ApiError('CONTENT_LOCKED', `building is not available: ${request.buildingId}`);
      const maxLevel = this.value('building.level.max');
      if (building.level >= maxLevel) throw new ApiError('VALIDATION_FAILED', 'building has reached maximum level', { maxLevel });
      const baseCost = this.value(`building.upgrade.spirit_stone_base_cost.${request.buildingId}`);
      const cost = Math.ceil(baseCost * this.value('building.upgrade.cost_growth') ** (building.level - 1));
      if (draft.resources.spirit_stone.amount < cost) throw new ApiError('RESOURCE_INSUFFICIENT', 'insufficient spirit stones for building upgrade', { resource: 'spirit_stone', required: cost, available: draft.resources.spirit_stone.amount });
      const fromLevel = building.level;
      draft.resources.spirit_stone.amount -= cost;
      building.level += 1;
      building.stateRevision += 1;
      return envelope({ buildingId: request.buildingId, fromLevel, toLevel: building.level, resourceCost: { spirit_stone: cost } }, draft.stateRevision + 1, request, now, this.configVersion);
    }, undefined, actionKey);
  }

  async plantSpiritFarm(request: PlantSpiritFarmRequest): Promise<ApiEnvelope<PlantSpiritFarmData>> {
    const now = request.now ?? this.clock();
    this.assertContext(request);
    await this.ensurePlayerConfig(request.playerId, request, now);
    const plotCapacity = this.value('building.spirit_farm.plot_count');
    if (!Number.isSafeInteger(request.plots) || request.plots <= 0 || request.plots > plotCapacity) throw new ApiError('VALIDATION_FAILED', `plots must be an integer between 1 and ${plotCapacity}`);
    const actionKey = request.idempotencyKey ? `${request.playerId}:spirit-farm:plant:${request.plots}:${request.idempotencyKey}` : undefined;
    if (actionKey) {
      const previous = await this.repository.getActionResponse(actionKey);
      if (previous) return structuredClone(previous) as ApiEnvelope<PlantSpiritFarmData>;
    }
    return await this.repository.transaction(request.playerId, request.expectedRevision, { eventType: 'spirit_farm_planted', payload: { plots: request.plots }, at: now }, (draft) => {
      const farm = draft.buildings.spirit_farm;
      if (!farm) throw new ApiError('CONTENT_LOCKED', 'spirit farm is unavailable');
      if ((farm.plantedPlots ?? 0) > 0) throw new ApiError('VALIDATION_FAILED', 'spirit farm already has a planted crop', { plantedPlots: farm.plantedPlots, matureAt: farm.matureAt });
      const growthSeconds = this.value('building.spirit_farm.base_growth_time') / this.value(`building.level.speed_multiplier_${farm.level}`);
      const matureAt = iso(new Date(now.getTime() + growthSeconds * 1000));
      farm.plantedPlots = request.plots;
      farm.plantedAt = iso(now);
      farm.matureAt = matureAt;
      farm.carrySeconds = 0;
      farm.stateRevision += 1;
      return envelope({ buildingId: 'spirit_farm', plots: request.plots, plantedAt: iso(now), matureAt }, draft.stateRevision + 1, request, now, this.configVersion);
    }, undefined, actionKey);
  }

  async plantSpiritFarmPlot(request: PlantSpiritFarmPlotRequest): Promise<ApiEnvelope<PlantSpiritFarmPlotData>> {
    const now = request.now ?? this.clock();
    this.assertContext(request);
    await this.ensurePlayerConfig(request.playerId, request, now);
    const plotCapacity = this.value('building.spirit_farm.plot_count');
    const plotMatch = /^plot_([1-9][0-9]*)$/.exec(request.plotId);
    if (!plotMatch || Number(plotMatch[1]) > plotCapacity) throw new ApiError('VALIDATION_FAILED', `plotId must be plot_1 through plot_${plotCapacity}`);
    if (!/^[A-Za-z0-9._:-]{1,100}$/.test(request.plantId)) throw new ApiError('VALIDATION_FAILED', 'plantId must be a non-empty content identifier');
    const actionKey = request.idempotencyKey ? `${request.playerId}:spirit-farm:plot:${request.plotId}:${request.plantId}:${request.idempotencyKey}` : undefined;
    if (actionKey) {
      const previous = await this.repository.getActionResponse(actionKey);
      if (previous) return structuredClone(previous) as ApiEnvelope<PlantSpiritFarmPlotData>;
    }
    return await this.repository.transaction(request.playerId, request.expectedRevision, { eventType: 'spirit_farm_plot_planted', payload: { plotId: request.plotId, plantId: request.plantId }, at: now }, (draft) => {
      const farm = draft.buildings.spirit_farm;
      if (!farm) throw new ApiError('CONTENT_LOCKED', 'spirit farm is unavailable');
      if (farm.plantedPlots !== undefined && farm.plantedPlots !== null && farm.plantedPlots > 0) throw new ApiError('VALIDATION_FAILED', 'legacy batch planting must be harvested before using plot planting');
      const plots = farm.spiritFarmPlots ??= {};
      if (plots[request.plotId]) throw new ApiError('VALIDATION_FAILED', 'spirit farm plot is already planted', { plotId: request.plotId, matureAt: plots[request.plotId]?.matureAt });
      const growthSeconds = this.value('building.spirit_farm.base_growth_time') / this.value(`building.level.speed_multiplier_${farm.level}`);
      const plantedAt = iso(now);
      const matureAt = iso(new Date(now.getTime() + growthSeconds * 1000));
      plots[request.plotId] = { plotId: request.plotId, plantId: request.plantId, plantedAt, matureAt, stateRevision: farm.stateRevision + 1 };
      farm.stateRevision += 1;
      return envelope({ buildingId: 'spirit_farm', plotId: request.plotId, plantId: request.plantId, plantedAt, matureAt }, draft.stateRevision + 1, request, now, this.configVersion);
    }, undefined, actionKey);
  }

  async equipmentAction(request: EquipmentActionRequest): Promise<ApiEnvelope<EquipmentActionData>> {
    const now = request.now ?? this.clock();
    this.assertContext(request);
    await this.ensurePlayerConfig(request.playerId, request, now);
    const equipmentActionPrefix = request.idempotencyKey ? `${request.playerId}:equipment:${request.instanceId}:${request.action}:` : undefined;
    const inputFingerprint = request.idempotencyKey ? hashPayload({ lockSlots: request.lockSlots ?? null, slotIndex: request.slotIndex ?? null, target: request.target ?? null, targetAffix: request.targetAffix ?? null }) : undefined;
    const actionKey = request.idempotencyKey ? `${equipmentActionPrefix}${inputFingerprint}:${request.idempotencyKey}` : undefined;
    // Replay keys written by the previous release format before fingerprinted
    // keys existed. Those records have no stored input fingerprint, so they
    // retain the legacy replay contract; all newly written records are strict.
    const historicalActionKey = request.idempotencyKey ? `${request.playerId}:equipment:${request.instanceId}:${request.action}:${request.idempotencyKey}` : undefined;
    const legacyActionKey = request.idempotencyKey ? `${request.playerId}:equipment:${request.instanceId}:${request.idempotencyKey}` : undefined;
    const previous = await this.previousActionResponse<ApiEnvelope<EquipmentActionData>>(actionKey, legacyActionKey, (value) => {
      const data = (value as { data?: { instanceId?: unknown; action?: unknown } })?.data;
      return data?.instanceId === request.instanceId && data.action === request.action;
    });
    if (previous) return previous;
    if (historicalActionKey && historicalActionKey !== actionKey) {
      const historical = await this.repository.getActionResponse(historicalActionKey);
      if (historical) return structuredClone(historical) as ApiEnvelope<EquipmentActionData>;
    }
    const result = await this.repository.transaction(request.playerId, request.expectedRevision, { eventType: request.action === 'reinforce' ? 'equipment_reinforced' : `equipment_${request.action}`, payload: { instanceId: request.instanceId, action: request.action, lockSlots: request.lockSlots, slotIndex: request.slotIndex, target: request.target, targetAffix: request.targetAffix }, at: now }, (draft) => {
      const instance = draft.equipmentInstances[request.instanceId];
      if (!instance) throw new ApiError('VALIDATION_FAILED', 'equipment instance does not belong to player');
      if (request.action === 'equip') {
        let replacedInstanceId: string | null = null;
        for (const candidate of Object.values(draft.equipmentInstances)) {
          if (candidate.instanceId !== instance.instanceId && candidate.slot === instance.slot && candidate.isEquipped) {
            candidate.isEquipped = false;
            replacedInstanceId = candidate.instanceId;
          }
        }
        instance.isEquipped = true;
        return envelope({ instanceId: instance.instanceId, action: 'equip', equipped: true, replacedInstanceId }, draft.stateRevision + 1, request, now, this.configVersion);
      }
      if (request.action === 'unequip') {
        if (!instance.isEquipped) throw new ApiError('VALIDATION_FAILED', 'equipment instance is not equipped');
        instance.isEquipped = false;
        return envelope({ instanceId: instance.instanceId, action: 'unequip', equipped: false }, draft.stateRevision + 1, request, now, this.configVersion);
      }
      if (request.action === 'promote') {
        const qualityOrder = ['normal', 'fine', 'rare', 'epic', 'legendary', 'immortal'];
        const qualityIndex = qualityOrder.indexOf(instance.quality);
        if (qualityIndex < 0) throw new ApiError('VALIDATION_FAILED', `unsupported equipment quality ${instance.quality}`);
        if (qualityIndex >= qualityOrder.length - 1) throw new ApiError('VALIDATION_FAILED', 'equipment has reached maximum quality');
        const fromQuality = qualityOrder[qualityIndex];
        const toQuality = qualityOrder[qualityIndex + 1];
        const transition = `${fromQuality}_to_${toQuality}`;
        const costs: Partial<Record<ResourceId, number>> = {
          spirit_stone: this.value(`loot.equipment.promotion.${transition}.spirit_stone_cost`),
          millennium_herb: this.value(`loot.equipment.promotion.${transition}.millennium_herb_cost`),
          meteor_iron: this.value(`loot.equipment.promotion.${transition}.meteor_iron_cost`),
        };
        for (const [resource, amount] of Object.entries(costs) as [ResourceId, number][]) {
          if (draft.resources[resource].amount < amount) throw new ApiError('RESOURCE_INSUFFICIENT', `insufficient ${resource}`, { resource, required: amount, available: draft.resources[resource].amount });
        }
        for (const [resource, amount] of Object.entries(costs) as [ResourceId, number][]) draft.resources[resource].amount -= amount;
        const fromLevel = instance.reinforcementLevel;
        instance.quality = toQuality;
        if (this.value('loot.equipment.promotion.enhancement_preserved') !== 1) instance.reinforcementLevel = 0;
        instance.affixes = { ...instance.affixes, qualityMultiplier: this.value(`loot.equipment.quality.multiplier.${toQuality}`) };
        this.ensureEquipmentAffixSlots(instance);
        return envelope({ instanceId: instance.instanceId, action: 'promote', fromQuality, toQuality, resourceCost: costs, fromLevel, toLevel: instance.reinforcementLevel }, draft.stateRevision + 1, request, now, this.configVersion);
      }
      if (request.action === 'awaken') {
        const maxLevel = this.value('loot.equipment.awakening.max_level');
        if (instance.awakeningLevel >= maxLevel) throw new ApiError('VALIDATION_FAILED', 'equipment has reached maximum awakening level', { maxLevel });
        const fromLevel = instance.awakeningLevel;
        const costs: Partial<Record<ResourceId, number>> = {
          spirit_stone: Math.ceil(this.value('loot.equipment.awakening.spirit_stone_base_cost') * this.value('loot.equipment.awakening.spirit_stone_growth') ** fromLevel),
          demon_core: this.value('loot.equipment.awakening.demon_core_per_level'),
          meteor_iron: this.value('loot.equipment.awakening.meteor_iron_per_level'),
        };
        this.requireEquipmentResources(draft, costs);
        this.payEquipmentResources(draft, costs);
        instance.awakeningLevel += 1;
        const statMultiplier = 1 + instance.awakeningLevel * this.value('loot.equipment.awakening.stat_multiplier_per_level');
        instance.affixes = { ...instance.affixes, awakeningMultiplier: statMultiplier };
        return envelope({ instanceId: instance.instanceId, action: 'awaken', fromLevel, toLevel: instance.awakeningLevel, resourceCost: costs, statMultiplier }, draft.stateRevision + 1, request, now, this.configVersion);
      }
      if (request.action === 'lock') {
        const slots = this.ensureEquipmentAffixSlots(instance);
        const utilityCount = Math.max(0, Math.min(3, Math.floor(this.value(`loot.equipment.affix.utility_slots.${instance.quality}`))));
        const existing = new Set(instance.lockedSlots);
        const requested = request.lockSlots ?? (request.slotIndex === undefined ? undefined : [...existing, request.slotIndex]);
        if (!requested) throw new ApiError('VALIDATION_FAILED', 'lock requires slotIndex or lockSlots');
        if (request.slotIndex !== undefined && request.lockSlots) throw new ApiError('VALIDATION_FAILED', 'slotIndex and lockSlots cannot be combined');
        if (requested.some((slot) => !Number.isInteger(slot) || slot < 0 || slot >= utilityCount || slot >= slots.length) || new Set(requested).size !== requested.length) throw new ApiError('VALIDATION_FAILED', 'lock slot is outside the active affix slots');
        const maxLocked = this.value('loot.equipment.reroll.max_locked_slots');
        if (requested.length > maxLocked || requested.length >= slots.length) throw new ApiError('VALIDATION_FAILED', 'locked slot count exceeds the configured limit');
        const added = requested.filter((slot) => !existing.has(slot));
        if (added.length === 0) throw new ApiError('VALIDATION_FAILED', 'requested slots are already locked');
        const costs: Partial<Record<ResourceId, number>> = { spirit_stone: 0, pill: 0 };
        for (let index = 0; index < added.length; index += 1) {
          costs.spirit_stone! += Math.ceil(this.value('loot.equipment.reroll.lock_base_cost') * this.value('loot.equipment.reroll.lock_cost_growth') ** (existing.size + index));
          costs.pill! += this.value('loot.equipment.reroll.lock_pill_cost');
        }
        this.requireEquipmentResources(draft, costs);
        this.payEquipmentResources(draft, costs);
        instance.lockedSlots = [...requested].sort((left, right) => left - right);
        return envelope({ instanceId: instance.instanceId, action: 'lock', resourceCost: costs, lockedSlots: instance.lockedSlots, affixes: slots }, draft.stateRevision + 1, request, now, this.configVersion);
      }
      if (request.action === 'reroll') {
        const slots = this.ensureEquipmentAffixSlots(instance);
        const activeSlots = Math.max(0, Math.min(3, Math.floor(this.value(`loot.equipment.affix.utility_slots.${instance.quality}`))));
        if (activeSlots === 0) throw new ApiError('CONTENT_LOCKED', `equipment quality ${instance.quality} has no rerollable affix slots`);
        if (instance.lockedSlots.some((slot) => slot < 0 || slot >= activeSlots)) throw new ApiError('VALIDATION_FAILED', 'equipment contains an invalid locked slot');
        const targetMode = request.target === true || request.targetAffix !== undefined;
        const targetQuality = instance.quality === 'legendary' || instance.quality === 'immortal';
        if (targetMode && !targetQuality) throw new ApiError('CONTENT_LOCKED', 'target affix matching is only available for legendary and immortal equipment');
        const required = targetMode ? String(this.rawValue(`loot.equipment.affix.target.${instance.quality}.required`) ?? '').split('|').filter(Boolean) : [];
        if (request.targetAffix && !['speed', 'element', 'special'].includes(request.targetAffix)) throw new ApiError('VALIDATION_FAILED', 'unsupported target affix');
        if (request.targetAffix && !required.includes(request.targetAffix)) throw new ApiError('VALIDATION_FAILED', 'target affix is not required for this quality');
        const maxAttempts = targetMode ? this.value('loot.equipment.affix.target.max_attempts') : 1;
        let rerollCount = Number(instance.affixes.rerollCount ?? 0);
        let stoneCost = 0;
        let targetMatched = false;
        let attempts = 0;
        while (attempts < maxAttempts) {
          const growth = targetMode ? this.value('loot.equipment.affix.target.reroll_spirit_stone_growth') : this.value('loot.equipment.reroll.spirit_stone_growth');
          stoneCost += Math.ceil(this.value('loot.equipment.reroll.spirit_stone_base_cost') * growth ** rerollCount);
          rerollCount += 1;
          attempts += 1;
          for (let index = 0; index < slots.length; index += 1) if (slots[index].kind !== 'empty' && !instance.lockedSlots.includes(index)) slots[index] = this.rollEquipmentAffix(draft, instance.quality, instance.slot);
          const active = slots.filter((slot) => slot.kind !== 'empty');
          const categories = new Set(active.map((slot) => slot.kind));
          const targetSpecial = String(this.rawValue(`loot.equipment.affix.target.special.${instance.slot === 'weapon' ? 'weapon' : instance.slot === 'accessory' ? 'accessory' : 'armor'}`) ?? '');
          const specialMatched = !required.includes('special') || active.some((slot) => slot.kind === 'special' && String(slot.value) === targetSpecial);
          const requestedMatched = !request.targetAffix || (request.targetAffix === 'special' ? active.some((slot) => slot.kind === 'special' && String(slot.value) === targetSpecial) : categories.has(request.targetAffix));
          targetMatched = required.every((kind) => categories.has(kind)) && specialMatched && requestedMatched;
          if (!targetMode || targetMatched) break;
        }
        const costs: Partial<Record<ResourceId, number>> = { spirit_stone: stoneCost };
        if (!targetMode) costs.pill = this.value('loot.equipment.reroll.lock_pill_cost');
        this.requireEquipmentResources(draft, costs);
        this.payEquipmentResources(draft, costs);
        instance.affixes = { ...instance.affixes, slots, rerollCount };
        return envelope({ instanceId: instance.instanceId, action: 'reroll', resourceCost: costs, rerollCount, lockedSlots: [...instance.lockedSlots], affixes: slots, targetMatched }, draft.stateRevision + 1, request, now, this.configVersion);
      }
      if (request.action === 'salvage' || request.action === 'sell') {
        if (instance.isEquipped) throw new ApiError('VALIDATION_FAILED', 'equipped equipment cannot be exported');
        const resourceDelta: Partial<Record<ResourceId, number>> = {};
        const overflow: Partial<Record<ResourceId, number>> = {};
        if (request.action === 'salvage') {
          if (instance.quality !== 'normal' && instance.quality !== 'fine') throw new ApiError('CONTENT_LOCKED', `salvage is not configured for quality ${instance.quality}`);
          this.addResource(draft, 'spirit_ore', this.value(`loot.equipment.salvage.${instance.quality}.spirit_ore`), resourceDelta, overflow);
          this.addResource(draft, 'spirit_wood', this.value(`loot.equipment.salvage.${instance.quality}.spirit_wood`), resourceDelta, overflow);
        } else {
          this.addResource(draft, 'spirit_stone', this.value(`loot.equipment.sell.spirit_stone.${instance.quality}`), resourceDelta, overflow);
        }
        delete draft.equipmentInstances[request.instanceId];
        draft.equipmentCount = Math.max(0, draft.equipmentCount - 1);
        return envelope({ instanceId: request.instanceId, action: request.action, resourceDelta, overflow }, draft.stateRevision + 1, request, now, this.configVersion);
      }
      if (request.action !== 'reinforce') throw new ApiError('VALIDATION_FAILED', `unsupported equipment action ${request.action}`);
      const maxLevel = this.value('loot.equipment.enhancement.max_level');
      if (instance.reinforcementLevel >= maxLevel) throw new ApiError('VALIDATION_FAILED', 'equipment has reached maximum reinforcement level', { maxLevel });
      const fromLevel = instance.reinforcementLevel;
      const stone = Math.ceil(this.value('loot.equipment.enhancement.spirit_stone_base_cost') * this.value('loot.equipment.enhancement.spirit_stone_growth') ** fromLevel);
      const ore = Math.ceil(this.value('loot.equipment.enhancement.spirit_ore_base_cost') * this.value('loot.equipment.enhancement.material_growth') ** fromLevel);
      const wood = Math.ceil(this.value('loot.equipment.enhancement.spirit_wood_base_cost') * this.value('loot.equipment.enhancement.material_growth') ** fromLevel);
      const costs: Partial<Record<ResourceId, number>> = { spirit_stone: stone, spirit_ore: ore, spirit_wood: wood };
      for (const [resource, amount] of Object.entries(costs) as [ResourceId, number][]) if (draft.resources[resource].amount < amount) throw new ApiError('RESOURCE_INSUFFICIENT', `insufficient ${resource}`, { resource, required: amount, available: draft.resources[resource].amount });
      for (const [resource, amount] of Object.entries(costs) as [ResourceId, number][]) draft.resources[resource].amount -= amount;
      instance.reinforcementLevel += 1;
      instance.affixes = { ...instance.affixes, reinforcementMultiplier: 1 + instance.reinforcementLevel * this.value('loot.equipment.enhancement.stat_multiplier_per_level') };
      return envelope({ instanceId: instance.instanceId, action: 'reinforce', fromLevel, toLevel: instance.reinforcementLevel, resourceCost: costs, statMultiplier: Number(instance.affixes.reinforcementMultiplier) }, draft.stateRevision + 1, request, now, this.configVersion);
    }, undefined, actionKey, equipmentActionPrefix ? async (_draft, context) => {
      const conflicting = await context.findActionResponseByPrefix(equipmentActionPrefix);
      if (conflicting && conflicting.key !== actionKey) throw new ApiError('DUPLICATE_REQUEST', 'idempotency key was already used with different equipment action parameters');
    } : undefined) as ApiEnvelope<EquipmentActionData>;
    if (request.action === 'reinforce' || request.action === 'promote' || request.action === 'awaken') this.recordMetric({ type: 'equipment_growth', growth: request.action, resourceDelta: result.data.resourceDelta, resourceOverflow: result.data.overflow, at: now });
    else if (result.data.resourceDelta || result.data.overflow) this.recordMetric({ type: 'resource_update', resourceDelta: result.data.resourceDelta, resourceOverflow: result.data.overflow, at: now });
    return result;
  }

  async collectionAction(request: CollectionActionRequest): Promise<ApiEnvelope<CollectionActionData>> {
    const now = request.now ?? this.clock();
    this.assertContext(request);
    await this.ensurePlayerConfig(request.playerId, request, now);
    if (request.action !== 'research' && request.action !== 'treasure_upgrade') throw new ApiError('VALIDATION_FAILED', `unsupported collection action ${request.action}`);
    const actionTarget = request.action === 'research' ? request.techniqueId : request.treasureId;
    const actionKey = request.idempotencyKey ? `${request.playerId}:collection:${request.action}:${actionTarget ?? ''}:${request.quality ?? ''}:${request.idempotencyKey}` : undefined;
    const legacyActionKey = request.idempotencyKey ? `${request.playerId}:collection:${request.action}:${actionTarget ?? ''}:${request.idempotencyKey}` : undefined;
    const previous = await this.previousActionResponse<ApiEnvelope<CollectionActionData>>(actionKey, legacyActionKey, (value) => {
      const data = (value as { data?: { action?: unknown; techniqueId?: unknown; treasureId?: unknown } })?.data;
      return data?.action === request.action && (request.action === 'research' ? data.techniqueId === request.techniqueId : data.treasureId === request.treasureId);
    });
    if (previous) return previous;
    return await this.repository.transaction(request.playerId, request.expectedRevision, { eventType: `collection_${request.action}`, payload: { action: request.action, techniqueId: request.techniqueId ?? null, quality: request.quality ?? null, treasureId: request.treasureId ?? null }, at: now }, (draft) => {
      if (request.action === 'research') {
        const quality = request.quality;
        const techniqueId = request.techniqueId;
        const poolEntry = techniqueId ? this.techniquePool().find((entry) => entry.id === techniqueId) : undefined;
        const legacyId = quality && techniqueId === `technique.${quality}.qing_feng`;
        if (!techniqueId || !quality || !techniqueQualities.includes(quality) || (!poolEntry && !legacyId) || (poolEntry && poolEntry.quality !== quality)) throw new ApiError('VALIDATION_FAILED', 'research requires a supported quality and stable technique id');
        const previousLayer = draft.collection.techniqueLayers[techniqueId];
        const currentLayer = previousLayer ?? 0;
        const maxLayer = this.value('growth.technique.max_layer');
        if (currentLayer >= maxLayer) throw new ApiError('VALIDATION_FAILED', 'technique has reached maximum layer', { maxLayer });
        const researchXpCost = Math.ceil(this.value('growth.technique.research_base_cost') * this.value('growth.technique.research_growth') ** currentLayer);
        const resourceCost: Partial<Record<ResourceId, number>> = {};
        if (previousLayer === undefined) {
          resourceCost.ancient_scroll = this.value(`growth.technique.unlock.scroll_cost.${quality}`);
          resourceCost.spirit_stone = this.value(`growth.technique.unlock.spirit_stone_cost.${quality}`);
          this.requireCollectionResources(draft, resourceCost);
          this.payEquipmentResources(draft, resourceCost);
          draft.collection.techniqueLayers[techniqueId] = 0;
        }
        if (draft.collection.techniqueResearchXp < researchXpCost) throw new ApiError('RESOURCE_INSUFFICIENT', 'insufficient technique research xp', { resource: 'technique_research_xp', required: researchXpCost, available: draft.collection.techniqueResearchXp });
        draft.collection.techniqueResearchXp -= researchXpCost;
        draft.collection.techniqueLayers[techniqueId] = currentLayer + 1;
        return envelope({ action: 'research', techniqueId, quality, fromLayer: currentLayer, toLayer: currentLayer + 1, researchXpSpent: researchXpCost, resourceCost, collectionState: structuredClone(draft.collection) }, draft.stateRevision + 1, request, now, this.configVersion);
      }

      const treasureId = request.treasureId;
      if (!treasureId || !treasureIds.includes(treasureId)) throw new ApiError('VALIDATION_FAILED', 'treasure_upgrade requires a supported treasure id');
      const fromStars = draft.collection.treasureStars[treasureId] ?? 0;
      const maxStars = this.value('growth.treasure.max_stars');
      if (fromStars >= maxStars) throw new ApiError('VALIDATION_FAILED', 'treasure has reached maximum stars', { maxStars });
      const copiesPerStar = this.value('growth.treasure.duplicate_copies_per_star');
      const availableCopies = draft.collection.duplicateBalances[treasureId] ?? 0;
      if (availableCopies < copiesPerStar) throw new ApiError('RESOURCE_INSUFFICIENT', 'insufficient treasure duplicate copies', { treasureId, required: copiesPerStar, available: availableCopies });
      draft.collection.duplicateBalances[treasureId] = availableCopies - copiesPerStar;
      draft.collection.treasureStars[treasureId] = fromStars + 1;
      return envelope({ action: 'treasure_upgrade', treasureId, fromStars, toStars: fromStars + 1, duplicateCopiesSpent: copiesPerStar, collectionMarksGained: 0, collectionState: structuredClone(draft.collection) }, draft.stateRevision + 1, request, now, this.configVersion);
    }, undefined, actionKey);
  }

  async collectionExchange(request: CollectionExchangeRequest): Promise<ApiEnvelope<CollectionExchangeData>> {
    const now = request.now ?? this.clock();
    this.assertContext(request);
    await this.ensurePlayerConfig(request.playerId, request, now);
    const pool = request.poolId;
    const target = request.targetTreasureId;
    const actionPrefix = request.idempotencyKey ? `${request.playerId}:collection-exchange:${request.idempotencyKey}:` : undefined;
    const fingerprint = hashPayload({ poolId: pool, targetTreasureId: target, expectedRevision: request.expectedRevision, configVersion: this.configVersion });
    const actionKey = actionPrefix ? `${actionPrefix}${fingerprint}` : undefined;
    const previous = await this.previousActionResponse<ApiEnvelope<CollectionExchangeData>>(actionKey, undefined);
    if (previous) return previous;
    const result = await this.repository.transaction(request.playerId, request.expectedRevision, {
      eventType: 'collection_exchange',
      payload: { poolId: pool, targetTreasureId: target, marksCost: collectionExchangeMarksCost, fingerprint }, at: now,
    }, (draft) => {
      const poolTargets = this.collectionPoolTreasureIds(pool);
      if (poolTargets.length === 0 || !poolTargets.includes(target)) throw new ApiError('VALIDATION_FAILED', 'target treasure does not belong to the requested collection pool');
      if (!this.collectionPoolUnlocked(draft, pool)) throw new ApiError('COLLECTION_POOL_LOCKED', 'collection pool is not unlocked', { poolId: pool });
      const maxStars = this.value('growth.treasure.max_stars');
      if (poolTargets.every((id) => (draft.collection.treasureStars[id] ?? 0) >= maxStars)) throw new ApiError('COLLECTION_POOL_COMPLETE', 'collection pool has no exchangeable treasure', { poolId: pool });
      const fromStars = draft.collection.treasureStars[target] ?? 0;
      if (fromStars !== 0) throw new ApiError('VALIDATION_FAILED', 'exchange target must have zero stars', { targetTreasureId: target, currentStars: fromStars });
      const balances = draft.collectionMarkBalances ?? {};
      const available = balances[pool] ?? (pool === 'starter' ? draft.collection.collectionMarks : 0);
      if (!Number.isFinite(available) || available < collectionExchangeMarksCost) throw new ApiError('RESOURCE_INSUFFICIENT', 'insufficient collection marks', { poolId: pool, required: collectionExchangeMarksCost, available });
      const remaining = available - collectionExchangeMarksCost;
      draft.collectionMarkBalances = { ...balances, [pool]: remaining };
      // Keep legacy projections coherent for existing clients and gates.
      if (pool === 'starter') draft.collection.collectionMarks = remaining;
      draft.collection.treasureStars[target] = 1;
      const summaryHash = hashPayload({ poolId: pool, targetTreasureId: target, marksSpent: collectionExchangeMarksCost, marksBefore: available, marksAfter: remaining, fromStars, toStars: 1 });
      return envelope({ action: 'exchange', poolId: pool, targetTreasureId: target, marksSpent: collectionExchangeMarksCost, marksRemaining: remaining, fromStars, toStars: 1, collectionState: structuredClone(draft.collection), summaryHash }, draft.stateRevision + 1, request, now, this.configVersion);
    }, undefined, actionKey, actionPrefix ? async (_draft, context) => {
      const conflicting = await context.findActionResponseByPrefix(actionPrefix);
      if (conflicting && conflicting.key !== actionKey) throw new ApiError('DUPLICATE_REQUEST', 'idempotency key was already used with different exchange parameters');
    } : undefined) as ApiEnvelope<CollectionExchangeData>;
    return result;
  }

  private collectionPoolUnlocked(player: PlayerState, pool: CollectionPoolId): boolean {
    if (pool === 'starter') return true;
    return (realmRank[player.realmId] ?? -1) >= (realmRank[pool] ?? Number.MAX_SAFE_INTEGER);
  }

  private collectionPoolTreasureIds(pool: CollectionPoolId): string[] {
    if (pool === 'starter') return [...treasureIds];
    const prefix = `dungeon.high_tier.${pool}.treasure_pool_weight.`;
    return Object.keys(this.parameters).filter((key) => key.startsWith(prefix)).map((key) => key.slice(prefix.length)).sort();
  }

  async previewDungeon(playerId: string, dungeonId: DungeonId, context: ServiceContext = {}): Promise<ApiEnvelope<DungeonPreviewData>> {
    const now = context.now ?? this.clock();
    this.assertContext(context);
    if (!dungeonIds.includes(dungeonId)) { this.recordMetric({ type: 'dungeon_gate', at: now }); throw new ApiError('CONTENT_LOCKED', `dungeon is not available: ${dungeonId}`); }
    // Preview endpoints are projections and must never migrate player state.
    const player = await this.readOnlyPlayerConfig(playerId, context);
    return envelope(this.dungeonPreview(player, dungeonId), player.stateRevision, context, now, this.configVersion);
  }

  async previewHighTier(playerId: string, realm: HighTierRealm, context: ServiceContext = {}): Promise<ApiEnvelope<HighTierPreviewData>> {
    const now = context.now ?? this.clock();
    this.assertContext(context);
    if (!highTierRealms.includes(realm)) throw new ApiError('CONTENT_LOCKED', `high-tier realm is not available: ${realm}`);
    // Preview endpoints are projections and must never migrate player state.
    const player = await this.readOnlyPlayerConfig(playerId, context);
    return envelope(this.highTierPreview(player, realm), player.stateRevision, context, now, this.configVersion);
  }

  async longTermEconomy(request: ServiceContext & { playerId: string; horizonHours: 720 | 2160; seed: number }): Promise<ApiEnvelope<LongTermEconomyResult>> {
    const now = request.now ?? this.clock();
    this.assertContext(request);
    // This is a projection only. Config migration is a stateful operation and
    // must be performed through an action/settlement endpoint first.
    const player = await this.readOnlyPlayerConfig(request.playerId, request);
    if (!highTierRealms.includes(player.realmId as HighTierRealm)) throw new ApiError('GATE_BLOCKED', 'long-term economy slice requires a high-tier realm player');
    try {
      const data = simulateLongTermEconomy({ horizonHours: request.horizonHours, realm: player.realmId as HighTierRealm, seed: request.seed, parameters: this.parameters });
      return envelope(data, player.stateRevision, request, now, this.configVersion);
    } catch (error) {
      if (error instanceof LongTermEconomyError) throw new ApiError('VALIDATION_FAILED', error.message, { diagnostics: error.diagnostics });
      throw error;
    }
  }

  async longTermEquipmentConsumption(request: ServiceContext & { playerId: string; horizonHours: LongTermHorizonHours; seed: number }): Promise<ApiEnvelope<LongTermEquipmentConsumptionData>> {
    const now = request.now ?? this.clock();
    this.assertContext(request);
    // This endpoint is a pure projection. Do not use ensurePlayerConfig here:
    // that helper may commit a player_config_migrated event as a side effect.
    // A stateful endpoint must migrate the player before this projection can
    // be served from the active release snapshot.
    const player = await this.readOnlyPlayerConfig(request.playerId, request);
    if (!highTierRealms.includes(player.realmId as HighTierRealm)) throw new ApiError('GATE_BLOCKED', 'long-term equipment consumption requires a high-tier realm player');
    try {
      // The economy simulation is the sole source of drop counts.  The
      // client cannot select a route, quality, template, or parameter set.
      const economy = simulateLongTermEconomy({ horizonHours: request.horizonHours, realm: player.realmId as HighTierRealm, seed: request.seed, parameters: this.parameters });
      const bindingMapId = economy.supportRoute === 'qing_feng' ? 'qing_feng' : 'black_wind_valley';
      const drops: LongTermEquipmentDropBatch[] = [
        { source: 'high_tier', bindingMapId: '__high_tier__', byQuality: qualityCounts(economy.highTier.equipmentByQuality) },
        { source: 'ordinary_map', bindingMapId, byQuality: qualityCounts(economy.support.equipmentByQuality) },
      ];
      const consumption = planLongTermEquipmentConsumption({
        seed: request.seed,
        configVersion: this.configVersion,
        parameters: this.parameters,
        content: this.content,
        inventoryCount: player.equipmentCount,
        inventoryCapacity: this.value('economy.inventory.cap.equipment'),
        drops,
      });
      return envelope({ mode: 'read_only_long_term_equipment_consumption_v1', horizonHours: request.horizonHours, realm: player.realmId as HighTierRealm, supportRoute: economy.supportRoute, economy, consumption }, player.stateRevision, request, now, this.configVersion);
    } catch (error) {
      if (error instanceof LongTermEconomyError) throw new ApiError('VALIDATION_FAILED', error.message, { diagnostics: error.diagnostics });
      if (error instanceof LongTermEquipmentConsumptionError) throw new ApiError('VALIDATION_FAILED', error.message, { diagnostics: error.diagnostics });
      throw error;
    }
  }

  async longTermEconomyConfidence(request: ServiceContext & { playerId: string; horizonHours: 720 | 2160; seed: number; sampleCount: number }): Promise<ApiEnvelope<ReturnType<typeof simulateLongTermEconomyConfidence>>> {
    const now = request.now ?? this.clock();
    const player = await this.readOnlyPlayerConfig(request.playerId, request);
    if (!highTierRealms.includes(player.realmId as HighTierRealm)) throw new ApiError('GATE_BLOCKED', 'long-term economy slice requires a high-tier realm player');
    try {
      const result = simulateLongTermEconomyConfidence({ horizonHours: request.horizonHours, realm: player.realmId as HighTierRealm, seed: request.seed, sampleCount: request.sampleCount, parameters: this.parameters });
      return envelope(result, player.stateRevision, request, now, this.configVersion);
    } catch (error) {
      if (error instanceof LongTermEconomyError) throw new ApiError('VALIDATION_FAILED', error.message, { diagnostics: error.diagnostics });
      throw error;
    }
  }

  async startHighTier(request: HighTierStartRequest): Promise<ApiEnvelope<HighTierStartData>> {
    const now = request.now ?? this.clock();
    this.assertContext(request);
    await this.ensurePlayerConfig(request.playerId, request, now);
    if (!highTierRealms.includes(request.realm)) throw new ApiError('CONTENT_LOCKED', `high-tier realm is not available: ${request.realm}`);
    if (request.seed !== undefined && (!Number.isInteger(request.seed) || request.seed < 0 || request.seed > 0xffffffff)) throw new ApiError('VALIDATION_FAILED', 'seed must be an unsigned 32-bit integer');
    const actionKey = request.idempotencyKey ? `${request.playerId}:high-tier:start:${request.realm}:${request.idempotencyKey}` : undefined;
    const legacyActionKey = request.idempotencyKey ? `${request.playerId}:high-tier:start:${request.idempotencyKey}` : undefined;
    const previous = await this.previousActionResponse<ApiEnvelope<HighTierStartData>>(actionKey, legacyActionKey, (value) => (value as { data?: { realm?: unknown } })?.data?.realm === request.realm);
    if (previous) return previous;
    return await this.repository.transaction(request.playerId, request.expectedRevision, { eventType: 'high_tier_started', payload: { realm: request.realm, attemptId: request.attemptId ?? null, seed: request.seed ?? null }, at: now }, (draft) => {
      const preview = this.highTierPreview(draft, request.realm);
      const configSnapshot = this.currentConfigSnapshot();
      if (draft.primaryAction.actionId) throw new ApiError('VALIDATION_FAILED', 'an active sequence already owns the global action slot', { actionId: draft.primaryAction.actionId, requires: 'stop_action' });
      if (Object.values(draft.dungeonAttempts).some((attempt) => attempt.status === 'active')) throw new ApiError('VALIDATION_FAILED', 'a dungeon attempt already owns the global action slot', { requires: 'settle_attempt' });
      if (preview.gate.status === 'blocked') throw new ApiError('GATE_BLOCKED', 'high-tier entry gate is not satisfied', { gate: preview.gate });
      const cooldownUntil = draft.highTierState.failureCooldownUntil ? new Date(draft.highTierState.failureCooldownUntil) : null;
      if (cooldownUntil && cooldownUntil > now) throw new ApiError('COOLDOWN_ACTIVE', 'high-tier Boss is in failure recovery cooldown', { until: iso(cooldownUntil) });
      if (draft.highTierState.status === 'fighting' || Object.values(draft.highTierAttempts).some((attempt) => attempt.status === 'active')) throw new ApiError('VALIDATION_FAILED', 'a high-tier Boss attempt is already active');
      const attemptId = request.attemptId ?? randomUUID();
      if (draft.highTierAttempts[attemptId]) throw new ApiError('DUPLICATE_REQUEST', 'high-tier attempt already exists');
      const seed = request.seed ?? draft.randomState.seed;
      draft.highTierState = { realm: request.realm, status: 'fighting', attemptId, startedAt: iso(now), failureCooldownUntil: null };
      const combatSnapshot = structuredClone(preview.stats);
      const skill = structuredClone(preview.skill);
      draft.highTierAttempts[attemptId] = { attemptId, realm: request.realm, configVersion: this.configVersion, configSnapshot, seed, status: 'active', startedAt: iso(now), settledAt: null, targetClearTime: preview.targetClearTime, bossHp: preview.bossHp, bossMaxHp: preview.bossHp, pillBudget: preview.pillBudget, elapsedSeconds: 0, skillSuppressedSeconds: 0, combatSnapshot, skill, fullCombat: structuredClone(preview.fullCombat), combatEvents: preview.fullCombat ? [] : makeHighTierSignatureCombatStartEvents({ attemptId, realm: request.realm, seed, targetClearTime: preview.targetClearTime, bossMaxHp: preview.bossHp, combatSnapshot, skill }), failureReason: null, responsePayload: null };
      return envelope({ attemptId, realm: request.realm, seed, startedAt: iso(now), targetClearTime: preview.targetClearTime, pillBudget: preview.pillBudget, bossHp: preview.bossHp, combatSnapshot: structuredClone(preview.stats), skill: structuredClone(preview.skill), fullCombat: structuredClone(preview.fullCombat) }, draft.stateRevision + 1, request, now, this.configVersion);
    }, undefined, actionKey);
  }

  async settleHighTier(request: HighTierSettleRequest): Promise<ApiEnvelope<HighTierSettlementData>> {
    const now = request.now ?? this.clock();
    this.assertContext(request);
    await this.ensurePlayerConfig(request.playerId, request, now);
    const current = await this.repository.getPlayer(request.playerId);
    const existing = current.highTierAttempts[request.attemptId];
    if (!existing) throw new ApiError('VALIDATION_FAILED', 'high-tier attempt does not exist');
    if (existing.status !== 'active' && existing.responsePayload) return existing.responsePayload as ApiEnvelope<HighTierSettlementData>;
    const result = await this.repository.transaction(request.playerId, request.expectedRevision, { eventType: 'high_tier_settled', payload: { attemptId: request.attemptId }, at: now }, (draft) => {
      const attempt = draft.highTierAttempts[request.attemptId];
      if (!attempt) throw new ApiError('VALIDATION_FAILED', 'high-tier attempt does not exist');
      if (attempt.status !== 'active' && attempt.responsePayload) return attempt.responsePayload as ApiEnvelope<HighTierSettlementData>;
      const attemptService = this.serviceForAttempt(attempt.configSnapshot);
      const elapsedSeconds = Math.max(0, Math.floor((now.getTime() - new Date(attempt.startedAt).getTime()) / 1000));
      const snapshot = attempt.combatSnapshot;
      const skill = attempt.skill ?? attemptService.highTierSkill(attempt.realm);
      const fullCombatResult = attempt.fullCombat ? simulateHighTierFullCombat(attempt.fullCombat, elapsedSeconds) : null;
      const skillSimulation = attemptService.highTierSkillSimulation(elapsedSeconds, skill);
      const survivalSeconds = snapshot ? attemptService.highTierSurvivalSeconds(attempt.realm, snapshot) : Number.POSITIVE_INFINITY;
      const requiredEffectiveAttackSeconds = attemptService.highTierRequiredEffectiveAttackSeconds(attempt.realm, snapshot?.attack ?? attemptService.highTierValue(attempt.realm, 'entry_profile.collected_p10.attack'));
      const timeout = fullCombatResult ? elapsedSeconds >= attempt.targetClearTime && fullCombatResult.status === 'active' : elapsedSeconds > attempt.targetClearTime;
      const defeated = fullCombatResult ? fullCombatResult.status === 'failed' && fullCombatResult.failureReason === 'player_defeated' : elapsedSeconds > survivalSeconds;
      const bossDefeated = fullCombatResult ? fullCombatResult.status === 'succeeded' : skillSimulation.effectiveAttackSeconds >= requiredEffectiveAttackSeconds;
      const failed = timeout || defeated || !bossDefeated;
      attempt.skillSuppressedSeconds = fullCombatResult?.outputSuppressedSeconds ?? skillSimulation.skillSuppressedSeconds;
      if (!timeout && !defeated && !bossDefeated) throw new ApiError('VALIDATION_FAILED', 'high-tier Boss has not reached its clear time');
      const resourceDelta: Partial<Record<ResourceId, number>> = {};
      const overflow: Partial<Record<ResourceId, number>> = {};
      const drops: HighTierDrop = { ancientScroll: 0, demonCore: 0, equipment: null, treasureId: null };
      let pity = draft.highTierPity[attempt.realm] ?? 0;
      if (failed) {
        attempt.status = 'failed';
        attempt.failureReason = timeout ? 'timeout' : 'player_defeated';
        attempt.settledAt = iso(now);
        attempt.elapsedSeconds = elapsedSeconds;
        draft.highTierState = { realm: attempt.realm, status: 'failed', attemptId: attempt.attemptId, startedAt: attempt.startedAt, failureCooldownUntil: iso(new Date(now.getTime() + attemptService.highTierValue(attempt.realm, 'boss_failure_recovery_seconds') * 1000)) };
      } else {
        const pillCost = fullCombatResult?.pillUses ?? attempt.pillBudget;
        if (draft.resources.pill.amount < pillCost) throw new ApiError('PILL_INSUFFICIENT', 'insufficient pills for high-tier Boss', { required: pillCost, available: draft.resources.pill.amount });
        attemptService.addResource(draft, 'pill', -pillCost, resourceDelta, overflow);
        attemptService.addResource(draft, 'ancient_scroll', attemptService.highTierValue(attempt.realm, 'boss_drop.ancient_scroll.amount'), resourceDelta, overflow);
        attemptService.addResource(draft, 'demon_core', attemptService.highTierValue(attempt.realm, 'boss_drop.demon_core.amount'), resourceDelta, overflow);
        drops.ancientScroll = attemptService.highTierValue(attempt.realm, 'boss_drop.ancient_scroll.amount');
        drops.demonCore = attemptService.highTierValue(attempt.realm, 'boss_drop.demon_core.amount');
        if (attemptService.roll(attempt.seed, 10) < attemptService.highTierValue(attempt.realm, 'boss_drop.equipment.chance') / 100) {
          const qualities = String(attemptService.highTierValueRaw(attempt.realm, 'boss_drop.equipment.quality'));
          const slotRoll = attemptService.roll(attempt.seed, 11);
          const slot = slotRoll < 1 / 6 ? 'weapon' : slotRoll < 5 / 6 ? 'armor_1' : 'accessory';
          if (draft.equipmentCount + 1 > attemptService.value('economy.inventory.cap.equipment')) throw new ApiError('INVENTORY_FULL', 'equipment inventory is full');
          const instanceId = `equipment.high_tier.${attempt.realm}.${attempt.attemptId}`;
          draft.equipmentInstances[instanceId] = { instanceId, templateId: `high_tier.${attempt.realm}`, slot, quality: qualities, reinforcementLevel: 0, awakeningLevel: 0, affixes: {}, lockedSlots: [], isEquipped: false, createdConfigVersion: attempt.configVersion ?? attemptService.configVersion };
          draft.equipmentCount += 1;
          drops.equipment = { instanceId, quality: qualities, slot };
        }
        const treasurePool = attemptService.highTierTreasurePool(attempt.realm);
        const treasureWeights = treasurePool.map((treasureId) => attemptService.value(`dungeon.high_tier.${attempt.realm}.treasure_pool_weight.${treasureId}`));
        pity += attemptService.highTierValue('global', 'boss_encounter_interval_hours');
        if (attemptService.roll(attempt.seed, 12) < attemptService.highTierValue(attempt.realm, 'treasure_drop_chance') / 100 || pity >= attemptService.highTierValue(attempt.realm, 'treasure_pity_hours')) { drops.treasureId = attemptService.weighted(treasurePool, treasureWeights, attemptService.roll(attempt.seed, 13)); pity = 0; drops.treasureProgress = attemptService.applyHighTierTreasureDrop(draft, drops.treasureId); }
        draft.highTierPity[attempt.realm] = pity;
        attempt.status = 'succeeded';
        attempt.failureReason = null;
        attempt.settledAt = iso(now);
        attempt.elapsedSeconds = elapsedSeconds;
        draft.highTierState = { realm: attempt.realm, status: 'success', attemptId: attempt.attemptId, startedAt: attempt.startedAt, failureCooldownUntil: null };
      }
      attempt.combatEvents = fullCombatResult?.combatEvents ?? makeHighTierSignatureCombatEvents({ attemptId: attempt.attemptId, realm: attempt.realm, seed: attempt.seed, elapsedSeconds, targetClearTime: attempt.targetClearTime, bossMaxHp: attempt.bossMaxHp, combatSnapshot: attempt.combatSnapshot ?? attemptService.combatStats(draft), skill, status: attempt.status, failureReason: attempt.failureReason });
      const response = envelope({ attemptId: attempt.attemptId, realm: attempt.realm, status: attempt.status, elapsedSeconds, skillSuppressedSeconds: attempt.skillSuppressedSeconds, targetClearTime: attempt.targetClearTime, bossHp: failed ? (fullCombatResult?.bossHp ?? attempt.bossHp) : 0, pillBudget: attempt.pillBudget, pillCost: failed ? 0 : (fullCombatResult?.pillUses ?? attempt.pillBudget), resourceDelta, overflow, drops, pity, failureReason: attempt.failureReason, combatSnapshot: structuredClone(attempt.combatSnapshot ?? attemptService.combatStats(draft)), skill: structuredClone(attempt.skill ?? attemptService.highTierSkill(attempt.realm)), fullCombat: structuredClone(attempt.fullCombat), combatEvents: structuredClone(attempt.combatEvents) }, draft.stateRevision + 1, request, now, attempt.configVersion ?? attemptService.configVersion);
      attempt.responsePayload = response;
      return response;
    });
    if (result.data.status === 'succeeded') {
      this.recordMetric({ type: 'drop_observation', dropKey: `high_tier.${result.data.realm}.equipment`, dropExpected: this.highTierValue(result.data.realm, 'boss_drop.equipment.chance') / 100, dropActual: result.data.drops.equipment ? 1 : 0, at: now });
      this.recordMetric({ type: 'drop_observation', dropKey: `high_tier.${result.data.realm}.treasure`, dropExpected: this.highTierValue(result.data.realm, 'treasure_drop_chance') / 100, dropActual: result.data.drops.treasureId ? 1 : 0, at: now });
    }
    return result;
  }

  async combatPreview(request: CombatPreviewRequest): Promise<ApiEnvelope<CombatPreviewData>> {
    const now = request.now ?? this.clock();
    this.assertContext(request);
    if (typeof request.activityId !== 'string' || request.activityId.length === 0 || request.activityId.length > 64) throw new ApiError('VALIDATION_FAILED', 'activityId must be a non-empty string of at most 64 characters');
    // Preview is explicitly read-only.  A player on a release that declares
    // a compatible migration policy may be evaluated against the selected
    // snapshot, but migration itself belongs to bootstrap/write paths and
    // must not advance state_revision or append an audit event here.
    const player = await this.previewPlayerConfig(request.playerId, request);
    if (request.expectedRevision !== undefined) {
      if (!Number.isSafeInteger(request.expectedRevision) || request.expectedRevision < 0) throw new ApiError('VALIDATION_FAILED', 'expectedRevision must be a non-negative safe integer');
      if (player.stateRevision !== request.expectedRevision) throw new ApiError('STALE_REVISION', 'expected revision is stale', { currentRevision: player.stateRevision });
    }
    const cooldownActive = [player.failureCooldownUntil, player.dungeonState.failureCooldownUntil].some((until) => until !== null && new Date(until).getTime() > now.getTime());
    const map = this.content.maps.find((item) => item.id === request.activityId && !isContentPending(item));
    const stats = this.combatStats(player);
    if (map) {
      const requiredRealm = map.unlock_realm_id;
      const realmBlocked = (realmRank[player.realmId] ?? -1) < (realmRank[requiredRealm] ?? Number.MAX_SAFE_INTEGER);
      return envelope({ activityId: request.activityId, realm: player.realmId, equipmentCount: player.equipmentCount, targetClearTime: this.mapKillSeconds(request.activityId, player), pillBudget: this.maps[request.activityId].pill, gate: { status: realmBlocked || cooldownActive ? 'blocked' : 'open', requiredRealm, reason: realmBlocked ? 'realm' : cooldownActive ? 'cooldown' : null }, stats }, player.stateRevision, request, now, this.configVersion);
    }
    if (dungeonIds.includes(request.activityId as DungeonId)) {
      const preview = this.dungeonPreview(player, request.activityId as DungeonId);
      return envelope({ activityId: request.activityId, realm: player.realmId, equipmentCount: player.equipmentCount, targetClearTime: preview.targetClearTime, pillBudget: preview.pillCost, gate: { status: cooldownActive ? 'blocked' : 'open', requiredRealm: null, reason: cooldownActive ? 'cooldown' : null }, stats }, player.stateRevision, request, now, this.configVersion);
    }
    throw new ApiError('CONTENT_LOCKED', `activity is not available: ${request.activityId}`);
  }

  private combatStats(player: PlayerState): CombatStats {
    let attack = this.value('combat.player.base_attack');
    let defence = this.value('combat.player.base_defence');
    let health = this.value('combat.player.base_health');
    let speed = this.value('combat.player.base_speed');
    const accuracy = this.value('combat.player.base_accuracy');
    const evasion = this.value('combat.player.base_evasion');
    let speedAffix = 0;
    let armorBreakGrade = 0;
    let bodyProtectionGrade = 0;
    let vitalityGrade = 0;
    let rejuvenationGrade = 0;
    let flatHealth = 0;
    const elements: Record<string, number> = {};
    const addElement = (value: unknown): void => { const element = String(value ?? '').trim(); if (element) elements[element] = (elements[element] ?? 0) + 1; };
    const techniqueLayers = Object.values(player.collection?.techniqueLayers ?? {}).reduce((total, layer) => {
      const numericLayer = Number(layer);
      return total + (Number.isFinite(numericLayer) && numericLayer > 0 ? numericLayer : 0);
    }, 0);
    attack += techniqueLayers * this.value('growth.technique.attack_per_layer');
    defence += techniqueLayers * this.value('growth.technique.defence_per_layer');
    health += techniqueLayers * this.value('growth.technique.health_per_layer');
    for (const instance of Object.values(player.equipmentInstances ?? {})) {
      if (!instance.isEquipped) continue;
      const affixes = instance.affixes ?? {};
      attack += Number(affixes.attack ?? 0);
      defence += Number(affixes.defence ?? 0);
      flatHealth += Number(affixes.health ?? affixes.flatHealth ?? 0);
      speedAffix += Number(affixes.speed ?? 0);
      const slots = Array.isArray(affixes.slots) ? affixes.slots : [];
      for (const slot of slots) {
        if (!slot || typeof slot !== 'object' || Array.isArray(slot)) continue;
        const entry = slot as Record<string, unknown>;
        if (entry.kind === 'speed') speedAffix += Number(entry.value ?? 0);
        else if (entry.kind === 'element') addElement(entry.value);
        else if (entry.kind === 'special') {
          const grade = Number(entry.grade ?? 0);
          if (entry.value === 'armor_break') armorBreakGrade += grade;
          else if (entry.value === 'body_protection') bodyProtectionGrade += grade;
          else if (entry.value === 'vitality') vitalityGrade += grade;
          else if (entry.value === 'rejuvenation') rejuvenationGrade += grade;
        }
      }
    }
    const treasureStars = player.collection?.treasureStars ?? {};
    const treasure = (id: string): number => treasureStars[id] ?? 0;
    attack += treasure('qing_lian_lamp') * this.value('growth.treasure.qing_lian_lamp.attack_per_star');
    attack += treasure('zhu_que_feather') * this.value('growth.treasure.zhu_que_feather.attack_per_star');
    defence += treasure('shan_he_seal') * this.value('growth.treasure.shan_he_seal.defence_per_star');
    health += treasure('xuan_gui_shell') * this.value('growth.treasure.xuan_gui_shell.health_per_star');
    speed += speedAffix + treasure('tai_xu_mirror') * this.value('growth.treasure.tai_xu_mirror.speed_per_star');
    for (const [id, element] of [['qing_lian_lamp', 'wood'], ['shan_he_seal', 'earth'], ['zhu_que_feather', 'fire'], ['xuan_gui_shell', 'water'], ['tai_xu_mirror', 'metal']] as const) if (treasure(id) > 0) addElement(element);
    health = health * (1 + vitalityGrade * this.value('loot.equipment.affix.special.health_bonus_per_grade')) + flatHealth;
    const outgoingSpecial = 1 + armorBreakGrade * this.value('loot.equipment.affix.special.damage_bonus_per_grade');
    const incomingSpecial = Math.max(0, 1 - bodyProtectionGrade * this.value('loot.equipment.affix.special.damage_reduction_per_grade'));
    const pillHealMultiplier = 1 + rejuvenationGrade * this.value('loot.equipment.affix.special.pill_heal_bonus_per_grade');
    const baseAttackInterval = this.value('combat.player.base_attack_interval');
    const attackInterval = Math.max(this.value('combat.speed.min_attack_interval'), baseAttackInterval / (1 + speed / 100));
    const battlePower = Math.round(attack + defence * 0.8 + health * 0.05 + speed * 2);
    return { attack, defence, health, speed, accuracy, evasion, attackInterval, battlePower, element: String(this.rawValue('combat.player.default_element') ?? 'neutral'), elements, outgoingSpecial, incomingSpecial, pillHealMultiplier };
  }

  private hitChance(accuracy: number, evasion: number): number {
    if (accuracy >= evasion) return 1 - evasion / Math.max(1, 2 * accuracy);
    return accuracy / Math.max(1, 2 * evasion);
  }

  private elementMultiplier(playerElement: string, targetElement: string): number {
    if (!playerElement || playerElement === 'neutral' || !targetElement || targetElement === 'neutral') return 1;
    const counters: Record<string, string> = { metal: 'wood', wood: 'earth', earth: 'water', water: 'fire', fire: 'metal' };
    if (counters[playerElement] === targetElement) return this.value('combat.element.counter_damage_multiplier');
    if (counters[targetElement] === playerElement) return this.value('combat.element.counter_resistance_multiplier');
    return 1;
  }

  private primaryElement(stats: CombatStats): string {
    let selected = stats.element;
    let count = 0;
    for (const [element, value] of Object.entries(stats.elements)) if (value > count) { selected = element; count = value; }
    return selected;
  }

  private mapKillSeconds(mapId: string, player: PlayerState): number {
    const stats = this.combatStats(player);
    const enemyDefence = this.value(`map.${mapId}.enemy_defence`);
    const enemyEvasion = this.value(`map.${mapId}.enemy_evasion`);
    const coefficient = this.value('combat.damage.base_coefficient');
    const element = this.elementMultiplier(this.primaryElement(stats), String(this.rawValue(`map.${mapId}.enemy_element`) ?? 'neutral'));
    const dps = stats.attack * coefficient * 100 / (100 + enemyDefence) * this.hitChance(stats.accuracy, enemyEvasion) * element * stats.outgoingSpecial / stats.attackInterval;
    const baseDps = this.value('combat.player.base_attack') * coefficient * 100 / (100 + enemyDefence) * this.hitChance(this.value('combat.player.base_accuracy'), enemyEvasion) / this.value('combat.player.base_attack_interval');
    return Math.max(1, Math.ceil(this.value(`map.${mapId}.target_kill_time`) * baseDps / Math.max(0.0001, dps)));
  }

  async startDungeon(request: DungeonStartRequest): Promise<ApiEnvelope<DungeonStartData>> {
    const now = request.now ?? this.clock();
    this.assertContext(request);
    await this.ensurePlayerConfig(request.playerId, request, now);
    if (!dungeonIds.includes(request.dungeonId)) { this.recordMetric({ type: 'dungeon_gate', at: now }); throw new ApiError('CONTENT_LOCKED', `dungeon is not available: ${request.dungeonId}`); }
    if (request.seed !== undefined && (!Number.isInteger(request.seed) || request.seed < 0 || request.seed > 0xffffffff)) throw new ApiError('VALIDATION_FAILED', 'seed must be an unsigned 32-bit integer');
    const actionKey = request.idempotencyKey ? `${request.playerId}:dungeon:start:${request.dungeonId}:${request.idempotencyKey}` : undefined;
    const legacyActionKey = request.idempotencyKey ? `${request.playerId}:dungeon:start:${request.idempotencyKey}` : undefined;
    const previous = await this.previousActionResponse<ApiEnvelope<DungeonStartData>>(actionKey, legacyActionKey, (value) => (value as { data?: { dungeonId?: unknown } })?.data?.dungeonId === request.dungeonId);
    if (previous) return previous;
    let result: ApiEnvelope<DungeonStartData>;
    try {
      result = await this.repository.transaction(request.playerId, request.expectedRevision, { eventType: 'dungeon_started', payload: { dungeonId: request.dungeonId, attemptId: request.attemptId ?? null, seed: request.seed ?? null }, at: now }, (draft) => {
      const cooldownUntil = [draft.failureCooldownUntil, draft.dungeonState.failureCooldownUntil].filter((value): value is string => Boolean(value)).map((value) => new Date(value)).filter((value) => value > now).sort((left, right) => right.getTime() - left.getTime())[0];
      if (cooldownUntil) throw new ApiError('COOLDOWN_ACTIVE', 'dungeon is in failure recovery cooldown', { until: iso(cooldownUntil) });
      if (draft.primaryAction.actionId) throw new ApiError('VALIDATION_FAILED', 'an active sequence already owns the global action slot', { actionId: draft.primaryAction.actionId, requires: 'stop_action' });
      if (Object.values(draft.highTierAttempts).some((attempt) => attempt.status === 'active')) throw new ApiError('VALIDATION_FAILED', 'a high-tier attempt already owns the global action slot', { requires: 'settle_attempt' });
      if (Object.values(draft.dungeonAttempts).some((attempt) => attempt.status === 'active')) throw new ApiError('VALIDATION_FAILED', 'a dungeon attempt is already active');
      const attemptId = request.attemptId ?? randomUUID();
      if (draft.dungeonAttempts[attemptId]) throw new ApiError('DUPLICATE_REQUEST', 'dungeon attempt already exists');
      const preview = this.dungeonPreview(draft, request.dungeonId);
      const configSnapshot = this.currentConfigSnapshot();
      const seed = request.seed ?? draft.randomState.seed;
      draft.dungeonState = { dungeonId: request.dungeonId, status: 'fighting', phase: 1, bossHp: preview.bossMaxHp, startedAt: iso(now), carrySeconds: 0, failureCooldownUntil: null };
      draft.dungeonAttempts[attemptId] = { attemptId, dungeonId: request.dungeonId, configVersion: this.configVersion, configSnapshot, seed, status: 'active', startedAt: iso(now), settledAt: null, bossHp: preview.bossBaseHp, bossMaxHp: preview.bossMaxHp, barrier: preview.bossBaseHp * preview.barrierPercent / 100, phase: 1, elapsedSeconds: 0, stunSeconds: 0, spiritBurnSeconds: 0, spiritBurnDamage: 0, bossDamageTaken: 0, bossDamageMultiplier: 1, combatSnapshot: structuredClone(preview.stats), combatEvents: [], failureReason: null, responsePayload: null };
      return envelope({ attemptId, seed, dungeonId: request.dungeonId, startedAt: iso(now), bossMaxHp: preview.bossMaxHp, barrier: preview.bossBaseHp * preview.barrierPercent / 100, phase: 1 }, draft.stateRevision + 1, request, now, this.configVersion);
      }, undefined, actionKey);
    } catch (error) {
      if (error instanceof ApiError && error.code === 'COOLDOWN_ACTIVE') this.recordMetric({ type: 'dungeon_cooldown', at: now });
      else if (error instanceof ApiError && error.code === 'CONTENT_LOCKED') this.recordMetric({ type: 'dungeon_gate', at: now });
      throw error;
    }
    return result;
  }

  async settleDungeon(request: DungeonSettleRequest): Promise<ApiEnvelope<DungeonSettlementData>> {
    const now = request.now ?? this.clock();
    this.assertContext(request);
    await this.ensurePlayerConfig(request.playerId, request, now);
    const current = await this.repository.getPlayer(request.playerId);
    const existing = current.dungeonAttempts[request.attemptId];
    if (!existing) throw new ApiError('VALIDATION_FAILED', 'dungeon attempt does not exist');
    if (existing.status !== 'active' && existing.responsePayload) { this.recordMetric({ type: existing.status === 'succeeded' ? 'dungeon_success' : 'dungeon_failure', at: now }); return existing.responsePayload as ApiEnvelope<DungeonSettlementData>; }
    const result = await this.repository.transaction(request.playerId, request.expectedRevision, { eventType: 'dungeon_settled', payload: { attemptId: request.attemptId }, at: now }, (draft) => {
      const attempt = draft.dungeonAttempts[request.attemptId];
      if (!attempt) throw new ApiError('VALIDATION_FAILED', 'dungeon attempt does not exist');
      if (attempt.status !== 'active' && attempt.responsePayload) return attempt.responsePayload as ApiEnvelope<DungeonSettlementData>;
      const attemptService = this.serviceForAttempt(attempt.configSnapshot);
      const simulation = attemptService.simulateDungeon(attempt, now, draft);
      const preview = attemptService.dungeonPreview(draft, attempt.dungeonId);
      const resourceDelta: Partial<Record<ResourceId, number>> = {};
      const overflow: Partial<Record<ResourceId, number>> = {};
      const drops: DungeonSettlementData['drops'] = { millenniumHerb: 0, meteorIron: 0, techniqueQuality: null, techniqueId: null, treasureId: null };
      let pity = { ...draft.dungeonPity[attempt.dungeonId] };
      const failed = simulation.elapsedSeconds > preview.targetClearTime || simulation.bossHp > 0.0001;
      if (failed) {
        attempt.status = 'failed';
        attempt.failureReason = simulation.elapsedSeconds > preview.targetClearTime ? 'timeout' : 'player_defeated';
        draft.failureCooldownUntil = iso(new Date(now.getTime() + attemptService.value('combat.recovery.failure_cooldown') * 1000));
        draft.dungeonState = { dungeonId: attempt.dungeonId, status: 'failed', phase: simulation.phase, bossHp: simulation.bossHp, startedAt: attempt.startedAt, carrySeconds: simulation.elapsedSeconds, failureCooldownUntil: draft.failureCooldownUntil };
      } else {
        const pillCost = preview.pillCost;
        if (draft.resources.pill.amount < pillCost) throw new ApiError('PILL_INSUFFICIENT', 'insufficient pills for dungeon clear', { required: pillCost, available: draft.resources.pill.amount });
        this.addResource(draft, 'pill', -pillCost, resourceDelta, overflow);
        attemptService.addResource(draft, 'demon_core', attemptService.value(`dungeon.${attempt.dungeonId}.demon_core_per_clear`), resourceDelta, overflow);
        pity.millenniumHerb += 1;
        pity.meteorIron += 1;
        pity.technique += 1;
        pity.treasure += 1;
        if (attemptService.roll(attempt.seed, 1) < attemptService.value(`dungeon.${attempt.dungeonId}.millennium_herb_chance`) / 100 || pity.millenniumHerb >= attemptService.value('dungeon.pity.millennium_herb_clears')) { drops.millenniumHerb = 1; pity.millenniumHerb = 0; attemptService.addResource(draft, 'millennium_herb', 1, resourceDelta, overflow); }
        if (attemptService.roll(attempt.seed, 2) < attemptService.value(`dungeon.${attempt.dungeonId}.meteor_iron_chance`) / 100 || pity.meteorIron >= attemptService.value('dungeon.pity.meteor_iron_clears')) { drops.meteorIron = 1; pity.meteorIron = 0; attemptService.addResource(draft, 'meteor_iron', 1, resourceDelta, overflow); }
        if (attemptService.roll(attempt.seed, 3) < attemptService.value(`dungeon.${attempt.dungeonId}.technique_drop_chance`) / 100 || pity.technique >= attemptService.value('dungeon.pity.technique_clears')) { const technique = attemptService.weightedTechnique(attempt.dungeonId, attempt.seed); drops.techniqueQuality = technique.quality; drops.techniqueId = technique.id; pity.technique = 0; }
        if (attemptService.roll(attempt.seed, 4) < attemptService.value(`dungeon.${attempt.dungeonId}.treasure_drop_chance`) / 100 || pity.treasure >= attemptService.value('dungeon.pity.treasure_clears')) { drops.treasureId = attemptService.weightedTreasure(attempt.dungeonId, attempt.seed); pity.treasure = 0; }
        const treasureProgress = attemptService.applyCollectionDrops(draft, drops.techniqueId ? { id: drops.techniqueId, quality: drops.techniqueQuality as string } : null, drops.treasureId);
        if (treasureProgress !== undefined) drops.treasureProgress = treasureProgress;
        draft.dungeonPity[attempt.dungeonId] = pity;
        attempt.status = 'succeeded';
        attempt.failureReason = null;
        draft.failureCooldownUntil = null;
        draft.dungeonState = { dungeonId: null, status: 'success', phase: simulation.phase, bossHp: simulation.bossHp, startedAt: attempt.startedAt, carrySeconds: simulation.elapsedSeconds, failureCooldownUntil: null };
      }
      attempt.settledAt = iso(now);
      attempt.elapsedSeconds = simulation.elapsedSeconds;
      attempt.bossHp = simulation.bossHp;
      attempt.barrier = simulation.barrier;
      attempt.phase = simulation.phase;
      attempt.stunSeconds = simulation.stunSeconds;
      attempt.spiritBurnSeconds = simulation.spiritBurnSeconds;
      attempt.spiritBurnDamage = simulation.spiritBurnDamage;
      attempt.bossDamageTaken = simulation.bossDamageTaken;
      attempt.bossDamageMultiplier = simulation.bossDamageMultiplier;
      attempt.combatEvents = simulation.combatEvents;
      const data: DungeonSettlementData = { attemptId: attempt.attemptId, dungeonId: attempt.dungeonId, status: attempt.status, elapsedSeconds: simulation.elapsedSeconds, targetClearTime: preview.targetClearTime, bossHp: simulation.bossHp, bossMaxHp: attempt.bossMaxHp, barrier: simulation.barrier, phase: simulation.phase, stunSeconds: simulation.stunSeconds, spiritBurnSeconds: simulation.spiritBurnSeconds, spiritBurnDamage: simulation.spiritBurnDamage, bossDamageTaken: simulation.bossDamageTaken, bossDamageMultiplier: simulation.bossDamageMultiplier, entryPillCost: failed ? 0 : preview.entryPillCost, bossAutoPillCost: failed ? 0 : preview.bossAutoPillCost, pillCost: failed ? 0 : preview.pillCost, resourceDelta, overflow, drops, pity, failureReason: attempt.failureReason, combatSnapshot: structuredClone(attempt.combatSnapshot ?? preview.stats), combatEvents: structuredClone(simulation.combatEvents) };
      const response = envelope(data, draft.stateRevision + 1, request, now, attemptService.configVersion);
      attempt.responsePayload = response;
      return response;
    });
    this.recordMetric({ type: result.data.status === 'succeeded' ? 'dungeon_success' : 'dungeon_failure', resourceDelta: result.data.resourceDelta, resourceOverflow: result.data.overflow, at: now });
    if (result.data.status === 'succeeded') {
      this.recordMetric({ type: 'drop_observation', dropKey: `dungeon.${result.data.dungeonId}.millennium_herb`, dropExpected: this.value(`dungeon.${result.data.dungeonId}.millennium_herb_chance`) / 100, dropActual: result.data.drops.millenniumHerb, at: now });
      this.recordMetric({ type: 'drop_observation', dropKey: `dungeon.${result.data.dungeonId}.meteor_iron`, dropExpected: this.value(`dungeon.${result.data.dungeonId}.meteor_iron_chance`) / 100, dropActual: result.data.drops.meteorIron, at: now });
      this.recordMetric({ type: 'drop_observation', dropKey: `dungeon.${result.data.dungeonId}.technique`, dropExpected: this.value(`dungeon.${result.data.dungeonId}.technique_drop_chance`) / 100, dropActual: result.data.drops.techniqueId ? 1 : 0, at: now });
      this.recordMetric({ type: 'drop_observation', dropKey: `dungeon.${result.data.dungeonId}.treasure`, dropExpected: this.value(`dungeon.${result.data.dungeonId}.treasure_drop_chance`) / 100, dropActual: result.data.drops.treasureId ? 1 : 0, at: now });
    }
    return result;
  }

  async offlineSettlement(request: SettlementRequest): Promise<ApiEnvelope<SettlementData>> {
    const now = request.now ?? this.clock();
    this.assertContext(request);
    await this.ensurePlayerConfig(request.playerId, request, now);
    const previous = await this.repository.getSettlement(request.settlementId);
    if (previous) {
      if (previous.playerId !== request.playerId) throw new ApiError('NOT_FOUND', 'settlement replay does not exist');
      if (previous.configVersion !== this.configVersion && this.releaseProvider?.getSnapshot) {
        const historical = await this.forConfigVersion(previous.configVersion);
        return historical.offlineSettlement({ ...request, configVersion: previous.configVersion });
      }
      if (previous.status === 'committed') { this.recordMetric({ type: 'settlement_duplicate', at: now }); return previous.responsePayload as ApiEnvelope<SettlementData>; }
      if (previous.status === 'rejected') throw new ApiError('DUPLICATE_REQUEST', 'settlement request was rejected and cannot be retried');
      // A pending row is a durable reservation left by a previous attempt.
      // Continue through the normal CAS transaction so the same settlement ID
      // can resume after a process or network interruption.
      if (previous.requestStartedAt !== request.requestedStartedAt || previous.requestEndedAt !== request.requestedEndedAt) throw new ApiError('DUPLICATE_REQUEST', 'pending settlement parameters do not match the retry');
    }
    const requestedStart = parseDate(request.requestedStartedAt);
    const requestedEnd = parseDate(request.requestedEndedAt);
    if (requestedEnd < requestedStart || requestedEnd > now) { this.recordMetric({ type: 'settlement_rejected', at: now }); throw new ApiError('TIME_RANGE_INVALID', 'requested time range is outside server time'); }
    const current = await this.repository.getPlayer(request.playerId);
    if (current.stateRevision !== request.expectedRevision) { this.recordMetric({ type: 'settlement_stale', at: now }); throw new ApiError('STALE_REVISION', 'expected revision is stale', { currentRevision: current.stateRevision }); }
    if (requestedEnd < new Date(current.lastSettledAt)) { this.recordMetric({ type: 'settlement_rejected', at: now }); throw new ApiError('TIME_RANGE_INVALID', 'server time moved backwards'); }
    const settlementFloor = current.primaryAction.startedAt && new Date(current.primaryAction.startedAt) > new Date(current.lastSettledAt)
      ? new Date(current.primaryAction.startedAt)
      : new Date(current.lastSettledAt);
    let start = requestedStart < settlementFloor ? settlementFloor : requestedStart;
    let end = requestedEnd;
    let clipped = start.getTime() !== requestedStart.getTime();
    if ((end.getTime() - start.getTime()) / 1000 > MAX_OFFLINE_SECONDS) { end = new Date(start.getTime() + MAX_OFFLINE_SECONDS * 1000); clipped = true; }
    if (end <= start) {
      const data = this.settlementData(request.settlementId, requestedStart, requestedEnd, start, end, false, {}, 0, 0, false, {});
      data.combatSnapshot = this.combatStats(current);
      data.summaryHash = hashPayload(data);
      const response = envelope(data, current.stateRevision, request, now, this.configVersion);
      await this.repository.recordSettlement(this.record(request, response, data, current.stateRevision, now));
      this.recordMetric({ type: 'settlement_success', durationMs: 0, pendingAgeMs: Math.max(0, now.getTime() - requestedStart.getTime()), at: now });
      return response;
    }
    // Reserve the settlement outside the state transaction.  If the process
    // dies before the state transaction commits, the row survives and the
    // next request can resume it.  A committed row is never overwritten by
    // this reservation because Repository implementations make this insert
    // idempotent.
    if (!previous) {
      await this.repository.recordSettlement(this.pendingRecord(request, requestedStart, requestedEnd, now));
      this.recordMetric({ type: 'settlement_pending', pendingAgeMs: 0, at: now });
    } else if (previous.status === 'pending') {
      this.recordMetric({ type: 'settlement_pending', pendingAgeMs: Math.max(0, now.getTime() - new Date(previous.createdAt).getTime()), at: now });
    }
    const activity = current.primaryAction.actionId;
    let result: { response: ApiEnvelope<SettlementData>; record: ReturnType<GameService['record']> };
    try {
      result = await this.repository.transaction(request.playerId, request.expectedRevision, { eventType: 'offline_settlement', settlementId: request.settlementId, payload: { start: iso(start), end: iso(end) }, at: now }, (draft) => {
      const seconds = Math.floor((end.getTime() - start.getTime()) / 1000);
      let effectiveProductionSeconds = seconds;
      let randomEventSummaries: import('./types.ts').RandomEventSettlementSummary[] | undefined;
      const parsedRuntime = parseRandomEventRuntimeState(draft.randomEventState);
      // Empty state is the only safe activation path. Existing non-empty
      // opaque JSONB is preserved until an explicit migration defines it.
      if (parsedRuntime) {
        const randomResult = settleRandomEventRange(parsedRuntime, start, end, draft.randomState.seed, this.configVersion, draft.randomState.draws);
        draft.randomEventState = randomResult.state as unknown as Record<string, unknown>;
        // Persist the draw cursor alongside the opaque runtime state. New
        // windows must receive a monotonic draw index that survives restart;
        // leaving the legacy cursor unchanged would make later windows reuse
        // stale indices and weaken replay/audit guarantees.
        draft.randomState.draws = randomResult.nextDrawIndex;
        effectiveProductionSeconds = randomResult.effectiveProductionSeconds;
        randomEventSummaries = randomResult.summaries;
      }
      const simulation = this.simulate(draft, seconds);
      const production = this.simulateBuildings(draft, effectiveProductionSeconds, end);
      for (const [resource, delta] of Object.entries(production.resourceDelta) as [ResourceId, number][]) simulation.resourceDelta[resource] = (simulation.resourceDelta[resource] ?? 0) + delta;
      for (const [resource, overflow] of Object.entries(production.overflow) as [ResourceId, number][]) simulation.overflow[resource] = (simulation.overflow[resource] ?? 0) + overflow;
      draft.lastSettledAt = iso(end);
      draft.primaryAction.carrySeconds = simulation.carrySeconds;
      if (simulation.actionEnded) draft.primaryAction = { actionId: null, targetId: null, startedAt: null, carrySeconds: 0, modelVersion: SINGLE_SLOT_ACTION_MODEL };
      if (simulation.failed) {
        draft.failureCooldownUntil = iso(new Date(end.getTime() + this.value('combat.recovery.failure_cooldown') * 1000));
        // Ordinary map failure is terminal for this action. Clear it in the
        // same settlement transaction so a later offline tick cannot keep
        // simulating the failed map while the recovery cooldown is active.
        if (activity && this.maps[activity]) draft.primaryAction = { actionId: null, targetId: null, startedAt: null, carrySeconds: 0, modelVersion: SINGLE_SLOT_ACTION_MODEL };
      }
      const mergedProductionDelta = { ...(simulation.productionDelta ?? {}) } as Partial<Record<ProductionOutputId, number>>;
      for (const [output, amount] of Object.entries(production.productionDelta) as [ProductionOutputId, number][]) mergedProductionDelta[output] = (mergedProductionDelta[output] ?? 0) + amount;
      const data = this.settlementData(request.settlementId, requestedStart, requestedEnd, start, end, clipped, simulation.resourceDelta, simulation.cultivationDelta, simulation.completedActions, simulation.failed, simulation.overflow, mergedProductionDelta, (simulation.completedProductionActions ?? 0) + production.completedActions);
      if (randomEventSummaries) {
        data.randomEventSummaries = randomEventSummaries;
        data.randomEventEffectiveProductionSeconds = effectiveProductionSeconds;
      }
      if (simulation.equipmentDrops?.length) data.equipmentDrops = simulation.equipmentDrops;
      if (simulation.skillXpDelta) data.skillXpDelta = simulation.skillXpDelta;
      data.combatSnapshot = this.combatStats(draft);
      const response = envelope(data, draft.stateRevision + 1, request, now, this.configVersion);
      data.summaryHash = hashPayload(data);
      response.data.summaryHash = data.summaryHash;
      return { response, record: this.record(request, response, data, draft.stateRevision + 1, now) };
      }, (result) => result.record);
    } catch (error) {
      if (error instanceof ApiError && error.code === 'STALE_REVISION') this.recordMetric({ type: 'settlement_stale', at: now });
      else {
        this.recordMetric({ type: 'settlement_rejected', at: now });
        if (error instanceof ApiError && error.code === 'INVENTORY_FULL') this.recordMetric({ type: 'inventory_full', at: now });
      }
      // Domain/CAS rejection is final for this reservation.  Internal SQL or
      // ambiguous COMMIT failures intentionally keep it pending so a retry
      // can discover a committed response or safely resume the transaction.
      if (!(error instanceof ApiError && error.code === 'INTERNAL_ROLLBACK')) {
        try { await this.repository.recordSettlement(this.rejectedRecord(request, requestedStart, requestedEnd, now, error)); } catch { /* preserve the original domain error */ }
      }
      throw error;
    }
    this.recordMetric({ type: 'settlement_success', durationMs: result.response.data.settledSeconds * 1000, pendingAgeMs: Math.max(0, now.getTime() - requestedStart.getTime()), resourceDelta: result.response.data.resourceDelta, resourceOverflow: result.response.data.overflow, at: now });
    const overflowTotal = Object.values(result.response.data.overflow).reduce((sum, value) => sum + value, 0);
    if (overflowTotal > 0) this.recordMetric({ type: 'economic_anomaly', anomalyKey: 'resource_overflow', anomalyValue: overflowTotal, at: now });
    if (activity && this.maps[activity]) {
      this.recordMetric({ type: result.response.data.failed ? 'map_failure' : 'map_success', resourceDelta: result.response.data.resourceDelta, resourceOverflow: result.response.data.overflow, at: now });
      if (!result.response.data.failed) this.recordMetric({ type: 'drop_observation', dropKey: `map.${activity}.equipment`, dropExpected: this.maps[activity].equipmentChance, dropActual: result.response.data.equipmentDrops?.length ?? 0, at: now });
    }
    return result.response;
  }

  async breakthrough(request: BreakthroughRequest): Promise<ApiEnvelope<BreakthroughData>> {
    const now = request.now ?? this.clock();
    this.assertContext(request);
    await this.ensurePlayerConfig(request.playerId, request, now);
    const actionKey = request.idempotencyKey ? `${request.playerId}:breakthrough:${request.idempotencyKey}` : undefined;
    if (actionKey) { const previous = await this.repository.getActionResponse(actionKey); if (previous) return previous as ApiEnvelope<BreakthroughData>; }
    return await this.repository.transaction(request.playerId, request.expectedRevision, { eventType: 'breakthrough', payload: { source: 'breakthrough' }, at: now }, (draft) => {
      // A breakthrough changes the realm and resets cultivation. An active
      // primary action is tied to the pre-breakthrough state, so callers must
      // use stopAction (or switchAction) first and continue with its revision.
      // Keeping this invariant in the same CAS transaction prevents a realm
      // transition from leaving an old action running across boundaries.
      if (draft.primaryAction.actionId) throw new ApiError('VALIDATION_FAILED', 'stop the active primary action before breakthrough', { actionId: draft.primaryAction.actionId, requires: 'stop_action' });
      const fromRealm = draft.realmId;
      const transition = breakthroughTransitions[fromRealm];
      if (!transition) throw new ApiError('CONTENT_LOCKED', `no breakthrough is available from realm ${fromRealm}`);
      const cultivationCost = this.value(`breakthrough.${transition.parameterKey}.cultivation_cost`);
      const resourceCost = Object.fromEntries(Object.entries(transition.resourceParameters).map(([resource, parameter]) => [resource, this.value(`breakthrough.${transition.parameterKey}.${parameter}`)])) as Partial<Record<ResourceId, number>>;

      // Capacity unlock is part of the same transition transaction. It makes the
      // target realm's resource ceiling available before the cost check, while
      // any failed requirement still rolls the draft back unchanged.
      if (this.value('economy.inventory.transition_capacity_unlock') === 1) this.applyRealmCapacityUnlock(draft, transition.toRealm);
      const missing: Record<string, { required: number; available: number }> = {};
      if (draft.cultivationXp < cultivationCost) missing.cultivationXp = { required: cultivationCost, available: draft.cultivationXp };
      for (const [resource, amount] of Object.entries(resourceCost) as [ResourceId, number][]) {
        const available = draft.resources[resource].amount;
        if (available < amount) missing[resource] = { required: amount, available };
      }
      if (Object.keys(missing).length > 0) throw new ApiError('RESOURCE_INSUFFICIENT', 'breakthrough requirements are not met', { fromRealm, toRealm: transition.toRealm, missing });
      draft.realmId = transition.toRealm;
      draft.substageIndex = 0;
      draft.cultivationXp = 0;
      for (const [resource, amount] of Object.entries(resourceCost) as [ResourceId, number][]) draft.resources[resource].amount -= amount;
      return envelope({ fromRealm, toRealm: transition.toRealm, resourceCost, cultivationCost }, draft.stateRevision + 1, request, now, this.configVersion);
    }, undefined, actionKey);
  }

  private dungeonPreview(player: PlayerState, dungeonId: DungeonId): DungeonPreviewData {
    const baseHp = this.value(`dungeon.${dungeonId}.boss_base_hp`);
    const barrierPercent = this.value('combat.boss.initial_barrier_percent');
    const entryPillCost = this.value(`dungeon.${dungeonId}.pill_cost`);
    const bossAutoPillCost = this.value(`dungeon.${dungeonId}.boss_auto_pill_per_clear`);
    return { dungeonId, targetClearTime: this.value(`dungeon.${dungeonId}.target_clear_time`), entryPillCost, bossAutoPillCost, pillCost: entryPillCost + bossAutoPillCost, bossBaseHp: baseHp, bossMaxHp: baseHp * (1 + barrierPercent / 100), barrierPercent, phaseTwoThresholdPercent: this.value(`dungeon.${dungeonId}.boss_phase_two_threshold`), bossAttack: this.value(`dungeon.${dungeonId}.boss_attack`), bossAccuracy: this.value(`dungeon.${dungeonId}.boss_accuracy`), bossElement: String(this.rawValue(`dungeon.${dungeonId}.boss_element`) ?? ''), bossDefence: this.value(`dungeon.${dungeonId}.boss_defence`), spiritBurnDamagePerSecond: this.value(`dungeon.${dungeonId}.boss_skill.spirit_burn_damage_per_second`), spiritBurnDuration: this.value(`dungeon.${dungeonId}.boss_skill.spirit_burn_duration`), spiritBurnEffectiveDuration: Math.floor(this.value(`dungeon.${dungeonId}.boss_skill.spirit_burn_duration`) * (1 - this.value('combat.player.status_resistance_percent') / 100)), spiritBurnInterval: this.value(`dungeon.${dungeonId}.boss_skill.spirit_burn_interval`), currentPity: { ...(player.dungeonPity[dungeonId] ?? { millenniumHerb: 0, meteorIron: 0, technique: 0, treasure: 0 }) }, availablePill: player.resources?.pill?.amount ?? 0, stats: this.combatStats(player) };
  }

  private highTierValue(realm: HighTierRealm | 'global', suffix: string): number {
    return this.value(realm === 'global' ? `dungeon.high_tier.${suffix}` : `dungeon.high_tier.${realm}.${suffix}`);
  }

  private highTierValueRaw(realm: HighTierRealm, suffix: string): unknown {
    return this.rawValue(`dungeon.high_tier.${realm}.${suffix}`);
  }

  private highTierPreview(player: PlayerState, realm: HighTierRealm): HighTierPreviewData {
    const profile = String(this.rawValue('dungeon.high_tier.entry_gate.profile') ?? '');
    const required = { attack: this.highTierValue(realm, 'entry_profile.collected_p10.attack'), defence: this.highTierValue(realm, 'entry_profile.collected_p10.defence'), health: this.highTierValue(realm, 'entry_profile.collected_p10.health') };
    const gateEnabled = this.highTierValue('global', 'entry_gate.enabled') === 1;
    const realmReady = player.realmId === realm;
    const collectionReady = profile === 'collected_p10' ? player.collection.collectionMarks >= 10 : false;
    const gateBlocked = gateEnabled && (!realmReady || !collectionReady);
    const stats = this.combatStats(player);
    const skill = this.highTierSkill(realm);
    const baselineTarget = this.highTierBaselineTarget(realm, required);
    const bossHp = required.health * this.highTierValue(realm, 'boss_hp_multiplier');
    const fullContract = this.highTierCombatContract.realms[realm];
    const fullCombat = fullContract ? makeHighTierFullCombatSnapshot(realm, fullContract, stats, bossHp) : null;
    const targetClearTime = fullCombat
      ? findHighTierFullCombatClearTime(fullCombat)
      : this.highTierClearTime(baselineTarget, required.attack, stats.attack, skill);
    return { realm, currentRealm: player.realmId, targetClearTime, pillBudget: this.highTierValue(realm, 'boss_pill_budget_per_encounter'), bossHp, recoverySeconds: this.highTierValue(realm, 'boss_failure_recovery_seconds'), rewardOnFailure: this.highTierValue(realm, 'boss_reward_on_failure') === 1, pillChargeOnFailure: this.highTierValue(realm, 'boss_pill_charge_on_failure') === 1, stats, skill, fullCombat, gate: { status: gateBlocked ? 'blocked' : 'open', reason: !realmReady ? 'realm' : !collectionReady ? 'collection' : null, profile, requiredRealm: realm, collectionProgress: { marks: player.collection.collectionMarks, requiredMarks: 10 }, required } };
  }

  private highTierBaselineTarget(realm: HighTierRealm, required: { attack: number; health: number }): number {
    return Math.max(1, Math.ceil(required.health * this.highTierValue(realm, 'boss_hp_multiplier') / Math.max(1, required.attack)));
  }

  private highTierSkill(realm: HighTierRealm): HighTierSkillSummary {
    const fullContract = this.highTierCombatContract.realms[realm];
    const outputSuppression = fullContract?.skills.find((skill) => skill.kind === 'output_suppression');
    if (outputSuppression) return { cooldownSeconds: outputSuppression.cooldownSeconds, durationSeconds: outputSuppression.durationSeconds, attackSuppressionPercent: outputSuppression.magnitude };
    return { cooldownSeconds: this.highTierValue(realm, 'signature_skill.cooldown_seconds'), durationSeconds: this.highTierValue(realm, 'signature_skill.duration_seconds'), attackSuppressionPercent: this.highTierValue(realm, 'signature_skill.attack_suppression_percent') };
  }

  private highTierSkillSimulation(seconds: number, skill: HighTierSkillSummary): { skillSuppressedSeconds: number; effectiveAttackSeconds: number } {
    const elapsedSeconds = Math.max(0, Math.floor(seconds));
    const cooldownSeconds = Math.floor(skill.cooldownSeconds);
    const durationSeconds = Math.floor(skill.durationSeconds);
    const suppressionPercent = Math.max(0, Math.min(100, skill.attackSuppressionPercent));
    if (elapsedSeconds === 0 || cooldownSeconds <= 0 || durationSeconds <= 0 || suppressionPercent <= 0) return { skillSuppressedSeconds: 0, effectiveAttackSeconds: elapsedSeconds };
    const activeDuration = Math.min(cooldownSeconds, durationSeconds);
    // The per-second schedule is periodic, so count complete windows instead
    // of iterating over an unbounded client-provided elapsed interval.
    const fullCycles = Math.floor(elapsedSeconds / cooldownSeconds);
    const remainder = elapsedSeconds % cooldownSeconds;
    const skillSuppressedSeconds = fullCycles * activeDuration + Math.min(remainder, activeDuration);
    return { skillSuppressedSeconds, effectiveAttackSeconds: elapsedSeconds - skillSuppressedSeconds * suppressionPercent / 100 };
  }

  private highTierRequiredEffectiveAttackSeconds(realm: HighTierRealm, attack: number): number {
    const requiredAttack = this.highTierValue(realm, 'entry_profile.collected_p10.attack');
    const requiredHealth = this.highTierValue(realm, 'entry_profile.collected_p10.health');
    return this.highTierBaselineTarget(realm, { attack: requiredAttack, health: requiredHealth }) * requiredAttack / Math.max(1, attack);
  }

  private highTierEffectiveAttackSeconds(seconds: number, skill: HighTierSkillSummary): number {
    if (seconds <= 0 || skill.cooldownSeconds <= 0 || skill.durationSeconds <= 0 || skill.attackSuppressionPercent <= 0) return Math.max(0, seconds);
    const fullCycles = Math.floor(seconds / skill.cooldownSeconds);
    const remainder = seconds % skill.cooldownSeconds;
    const suppressedSeconds = fullCycles * Math.min(skill.durationSeconds, skill.cooldownSeconds) + Math.min(remainder, skill.durationSeconds);
    return seconds - suppressedSeconds * skill.attackSuppressionPercent / 100;
  }

  private highTierClearTime(baselineTarget: number, requiredAttack: number, attack: number, skill: HighTierSkillSummary): number {
    const requiredEffectiveSeconds = baselineTarget * requiredAttack / Math.max(1, attack);
    for (let seconds = 1; seconds <= 10_000_000; seconds += 1) if (this.highTierEffectiveAttackSeconds(seconds, skill) >= requiredEffectiveSeconds) return seconds;
    throw new ApiError('INTERNAL_ROLLBACK', 'high-tier skill clear time exceeds supported range');
  }

  private highTierSurvivalSeconds(realm: HighTierRealm, stats: CombatStats): number {
    const requiredDefence = this.highTierValue(realm, 'entry_profile.collected_p10.defence');
    const requiredHealth = this.highTierValue(realm, 'entry_profile.collected_p10.health');
    const requiredAttack = this.highTierValue(realm, 'entry_profile.collected_p10.attack');
    const baselineTarget = this.highTierBaselineTarget(realm, { attack: requiredAttack, health: requiredHealth });
    const baselineIncomingDamagePerSecond = requiredHealth / baselineTarget;
    const defenceMultiplier = (100 + requiredDefence) / Math.max(1, 100 + stats.defence);
    return stats.health / Math.max(0.0001, baselineIncomingDamagePerSecond * defenceMultiplier);
  }

  private highTierTreasurePool(realm: HighTierRealm): string[] {
    const prefix = `dungeon.high_tier.${realm}.treasure_pool_weight.`;
    const pool = Object.keys(this.parameters).filter((key) => key.startsWith(prefix)).map((key) => key.slice(prefix.length));
    if (pool.length === 0) throw new ApiError('INTERNAL_ROLLBACK', `high-tier treasure pool is empty: ${realm}`);
    return pool;
  }

  private applyHighTierTreasureDrop(draft: PlayerState, treasureId: string): TreasureDropProgress {
    return this.applyTreasureDrop(draft, treasureId);
  }

  private simulateDungeon(attempt: PlayerState['dungeonAttempts'][string], now: Date, player: PlayerState): { elapsedSeconds: number; bossHp: number; barrier: number; phase: 1 | 2; stunSeconds: number; spiritBurnSeconds: number; spiritBurnDamage: number; bossDamageTaken: number; bossDamageMultiplier: number; combatEvents: CombatEvent[] } {
    const preview = this.dungeonPreview(player, attempt.dungeonId);
    const stats = attempt.combatSnapshot ?? preview.stats;
    const startedAt = parseDate(attempt.startedAt);
    const elapsedSeconds = Math.max(0, Math.floor((now.getTime() - startedAt.getTime()) / 1000));
    const simulatedSeconds = Math.min(elapsedSeconds, preview.targetClearTime);
    const stunInterval = this.value('combat.boss.stun_interval');
    const stunDuration = this.value('combat.boss.stun_duration');
    const activeAttackSeconds = preview.targetClearTime - Math.floor((preview.targetClearTime - 1) / stunInterval) * stunDuration;
    const baseAttack = this.value('combat.player.base_attack');
    const baseInterval = this.value('combat.player.base_attack_interval');
    const hitRatio = this.hitChance(stats.accuracy, 50) / Math.max(0.0001, this.hitChance(this.value('combat.player.base_accuracy'), 50));
    const damageMultiplier = stats.attack / Math.max(0.0001, baseAttack) * (baseInterval / stats.attackInterval) * hitRatio * stats.outgoingSpecial * this.elementMultiplier(this.primaryElement(stats), preview.bossElement);
    const attackPerSecond = preview.bossMaxHp / activeAttackSeconds * damageMultiplier;
    const burnDuration = preview.spiritBurnEffectiveDuration;
    const burnDamagePerSecond = preview.spiritBurnDamagePerSecond * (1 - this.value('combat.boss.status.damage_over_time_resistance_percent') / 100);
    let bossHp = preview.bossBaseHp;
    let barrier = preview.bossBaseHp * preview.barrierPercent / 100;
    let phase: 1 | 2 = 1;
    let stunSeconds = 0;
    let spiritBurnSeconds = 0;
    let spiritBurnDamage = 0;
    let bossDamageTaken = 0;
    let bossDamageMultiplier = 1;
    const combatEvents: CombatEvent[] = [];
    let eventsTruncated = false;
    const event = (entry: CombatEvent): void => {
      if (combatEvents.length < 4095) combatEvents.push(entry);
      else if (!eventsTruncated) {
        eventsTruncated = true;
        combatEvents.push({ second: entry.second, actor: 'system', kind: 'trace_truncated', state: { maxEvents: 4096 } });
      } else if (entry.kind === 'combat_end') {
        combatEvents[combatEvents.length - 1] = entry;
      }
    };
    for (let second = 1; second <= simulatedSeconds && bossHp > 0; second += 1) {
      const offset = second % stunInterval;
      const stunned = second < preview.targetClearTime && second >= stunInterval && offset < stunDuration;
      if (stunned) { stunSeconds += 1; event({ second, actor: 'boss', kind: 'control', state: { effect: 'stun', active: true } }); }
      const burnInterval = this.value(`dungeon.${attempt.dungeonId}.boss_skill.spirit_burn_interval`);
      const burnOffset = second % burnInterval;
      if (second < preview.targetClearTime && second >= burnInterval && burnOffset < burnDuration) { spiritBurnSeconds += 1; spiritBurnDamage += burnDamagePerSecond; event({ second, actor: 'boss', kind: 'damage_over_time', amount: burnDamagePerSecond, state: { effect: 'spirit_burn' } }); }
      if (!stunned) {
        let damage = attackPerSecond;
        if (barrier > 0) { const absorbed = Math.min(barrier, damage); barrier -= absorbed; damage -= absorbed; }
        bossHp = Math.max(0, bossHp - damage);
        event({ second, actor: 'player', kind: 'attack', amount: damage, state: { target: 'boss', barrierRemaining: barrier } });
      }
      if (bossHp <= preview.bossBaseHp * (1 - preview.phaseTwoThresholdPercent / 100) && phase === 1) { phase = 2; event({ second, actor: 'system', kind: 'phase_change', state: { phase: 2 } }); }
      bossDamageMultiplier = phase === 2 ? this.value('combat.boss.phase_two_damage_multiplier') : 1;
      const bossHitChance = this.hitChance(preview.bossAccuracy, stats.evasion);
      const defenceMitigation = 100 / (100 + stats.defence);
      const elementDamage = this.elementMultiplier(preview.bossElement, this.primaryElement(stats));
      const incomingDamage = preview.bossAttack * preview.bossAccuracy / 100 * bossHitChance * defenceMitigation * stats.incomingSpecial * elementDamage * bossDamageMultiplier;
      bossDamageTaken += incomingDamage;
      event({ second, actor: 'boss', kind: 'attack', amount: incomingDamage, state: { target: 'player', phase, hitChance: bossHitChance } });
    }
    const end = { second: simulatedSeconds, actor: 'system' as const, kind: 'combat_end', state: { status: bossHp <= 0.0001 ? 'succeeded' : 'active', bossHp } };
    if (eventsTruncated) combatEvents.push(end); else event(end);
    return { elapsedSeconds, bossHp, barrier, phase, stunSeconds, spiritBurnSeconds, spiritBurnDamage, bossDamageTaken, bossDamageMultiplier, combatEvents };
  }

  private roll(seed: number, draw: number): number { let state = (seed + draw * 0x9e3779b9) >>> 0; state = (1664525 * state + 1013904223) >>> 0; return state / 4294967296; }

  private techniquePool(): TechniquePoolEntry[] {
    const entries: TechniquePoolEntry[] = [];
    for (const parameterId of Object.keys(this.parameters)) {
      const match = /^growth\.technique\.pool\.([^.]+)\.quality$/.exec(parameterId);
      if (!match) continue;
      const poolId = match[1];
      const quality = String(this.rawValue(parameterId));
      const weight = this.value(`growth.technique.pool.${poolId}.weight`);
      if (!techniqueQualities.includes(quality) || !Number.isFinite(weight) || weight <= 0) throw new ApiError('INTERNAL_ROLLBACK', `invalid technique pool entry: ${poolId}`);
      entries.push({ id: `technique.${quality}.${poolId}`, quality, weight });
    }
    if (entries.length === 0 || new Set(entries.map((entry) => entry.id)).size !== entries.length) throw new ApiError('INTERNAL_ROLLBACK', 'technique pool is empty or contains duplicate ids');
    return entries;
  }

  private weightedTechnique(dungeonId: DungeonId, seed: number): TechniquePoolEntry {
    const weights = techniqueQualities.map((quality) => this.value(`dungeon.${dungeonId}.technique_pool_weight.${quality}`));
    const quality = this.weighted(techniqueQualities, weights, this.roll(seed, 5));
    const pool = this.techniquePool().filter((entry) => entry.quality === quality);
    if (pool.length === 0) throw new ApiError('INTERNAL_ROLLBACK', `technique pool has no entries for quality: ${quality}`);
    return this.weighted(pool, pool.map((entry) => entry.weight), this.roll(seed, 7));
  }

  private weightedTreasure(dungeonId: DungeonId, seed: number): string {
    const weights = treasureIds.map((id) => this.value(`dungeon.${dungeonId}.treasure_pool_weight.${id}`));
    return this.weighted(treasureIds, weights, this.roll(seed, 6));
  }

  private weighted<T>(items: T[], weights: number[], roll: number): T {
    if (items.length === 0 || items.length !== weights.length || !Number.isFinite(roll) || roll < 0 || roll >= 1) throw new ApiError('INTERNAL_ROLLBACK', 'weighted pool shape is invalid');
    if (weights.some((weight) => !Number.isFinite(weight) || weight < 0)) throw new ApiError('INTERNAL_ROLLBACK', 'weighted pool contains invalid weight');
    const total = weights.reduce((sum, weight) => sum + weight, 0);
    if (total <= 0) throw new ApiError('INTERNAL_ROLLBACK', 'weighted pool has no positive weight');
    let cursor = roll * total;
    for (let index = 0; index < items.length; index += 1) { cursor -= weights[index]; if (cursor < 0) return items[index]; }
    return items[items.length - 1];
  }

  private ensureEquipmentAffixSlots(instance: EquipmentInstance): Array<Record<string, unknown>> {
    const utilityCount = Math.max(0, Math.min(3, Math.floor(this.value(`loot.equipment.affix.utility_slots.${instance.quality}`))));
    const existing = Array.isArray(instance.affixes.slots) ? instance.affixes.slots : [];
    const slots = Array.from({ length: 3 }, (_, index) => {
      const slot = existing[index];
      if (index >= utilityCount) return { kind: 'empty' };
      if (slot && typeof slot === 'object' && !Array.isArray(slot) && ['speed', 'element', 'special'].includes(String((slot as Record<string, unknown>).kind))) return slot as Record<string, unknown>;
      return { kind: 'empty' };
    });
    instance.affixes = { ...instance.affixes, slots };
    return slots;
  }

  private rollEquipmentAffix(draft: PlayerState, quality: string, slot: EquipmentInstance['slot']): Record<string, unknown> {
    draft.randomState.draws += 1;
    const roll = this.nextRandom(draft) * 100;
    if (roll < this.value('loot.equipment.affix.roll_weight.speed')) return { kind: 'speed', value: this.value(`loot.equipment.affix.speed_rating.${quality}`) };
    if (roll < this.value('loot.equipment.affix.roll_weight.speed') + this.value('loot.equipment.affix.roll_weight.element')) {
      const elements = ['metal', 'wood', 'water', 'fire', 'earth'];
      return { kind: 'element', value: elements[Math.floor((roll / 100) * elements.length) % elements.length] };
    }
    const targetSlot = slot === 'weapon' ? 'weapon' : slot === 'accessory' ? 'accessory' : 'armor';
    const specials = ['armor_break', 'body_protection', 'vitality', 'rejuvenation'];
    const specialRoll = this.nextRandom(draft) * 100;
    let cursor = 0;
    let special = specials[specials.length - 1];
    for (const candidate of specials) {
      cursor += this.value(`loot.equipment.affix.special_pool.${candidate}.weight`);
      if (specialRoll < cursor) { special = candidate; break; }
    }
    return { kind: 'special', value: special, target: this.rawValue(`loot.equipment.affix.target.special.${targetSlot}`), grade: this.value(`loot.equipment.affix.special_grade.${quality}`) };
  }

  private requireEquipmentResources(draft: PlayerState, costs: Partial<Record<ResourceId, number>>): void {
    for (const [resource, amount] of Object.entries(costs) as [ResourceId, number][]) {
      if ((draft.resources[resource]?.amount ?? 0) < amount) throw new ApiError('RESOURCE_INSUFFICIENT', `insufficient ${resource}`, { resource, required: amount, available: draft.resources[resource]?.amount ?? 0 });
    }
  }

  private requireCollectionResources(draft: PlayerState, costs: Partial<Record<ResourceId, number>>): void {
    for (const [resource, amount] of Object.entries(costs) as [ResourceId, number][]) {
      if (draft.resources[resource].amount < amount) throw new ApiError('RESOURCE_INSUFFICIENT', `insufficient ${resource}`, { resource, required: amount, available: draft.resources[resource].amount });
    }
  }

  private applyCollectionDrops(draft: PlayerState, technique: { id: string; quality: string } | null, treasureId: string | null): TreasureDropProgress | undefined {
    if (technique) {
      const techniqueId = technique.id;
      if (draft.collection.techniqueLayers[techniqueId] === undefined) draft.collection.techniqueLayers[techniqueId] = 0;
      else draft.collection.techniqueResearchXp += this.value(`growth.technique.duplicate_research_xp.${technique.quality}`);
    }
    return treasureId ? this.applyTreasureDrop(draft, treasureId) : undefined;
  }

  private applyTreasureDrop(draft: PlayerState, treasureId: string): TreasureDropProgress {
    const maxStars = this.value('growth.treasure.max_stars');
    const fromStars = draft.collection.treasureStars[treasureId] ?? 0;
    const incomingCopies = (draft.collection.duplicateBalances[treasureId] ?? 0) + 1;
    const starCapacity = Math.max(0, maxStars - fromStars);
    const duplicateCopiesSpent = Math.min(incomingCopies, starCapacity);
    const duplicateCopiesRemaining = incomingCopies - duplicateCopiesSpent;
    const collectionMarksGained = duplicateCopiesRemaining * this.treasureOverflowMarks(draft);
    draft.collection.treasureStars[treasureId] = fromStars + duplicateCopiesSpent;
    if (duplicateCopiesRemaining > 0) draft.collection.collectionMarks += collectionMarksGained;
    if (duplicateCopiesRemaining > 0) draft.collection.duplicateBalances[treasureId] = duplicateCopiesRemaining;
    else delete draft.collection.duplicateBalances[treasureId];
    return { fromStars, toStars: fromStars + duplicateCopiesSpent, duplicateCopiesSpent, duplicateCopiesRemaining, collectionMarksGained };
  }

  private treasureOverflowMarks(draft: PlayerState): number {
    const level = draft.buildings.treasure_pavilion?.level ?? 1;
    return this.value('growth.treasure.overflow_collection_token_per_copy') * this.value(`building.treasure_pavilion.token_multiplier_${level}`);
  }

  private applyRealmCapacityUnlock(draft: PlayerState, realm: RealmId): void {
    const capacityRealm = ({
      qi_refining: 'qi',
      foundation_establishment: 'foundation',
      core_formation: 'core',
      nascent_soul: 'nascent_soul',
      divine_transformation: 'divine_transformation',
      void_refining: 'void_refining',
      body_unity: 'body_unity',
      great_vehicle: 'great_vehicle',
      tribulation: 'tribulation',
    } as const)[realm];
    const multiplier = this.value(`economy.inventory.cap_multiplier.${capacityRealm}`);
    if (multiplier <= 0) throw new ApiError('INTERNAL_ROLLBACK', `capacity multiplier is missing for realm ${realm}`);
    for (const resource of Object.keys(draft.resources) as ResourceId[]) {
      const baseCapacity = this.value(`economy.inventory.cap.${resource}`);
      if (baseCapacity > 0) draft.resources[resource].capacity = Math.max(draft.resources[resource].capacity, baseCapacity * multiplier);
    }
  }

  private payEquipmentResources(draft: PlayerState, costs: Partial<Record<ResourceId, number>>): void {
    for (const [resource, amount] of Object.entries(costs) as [ResourceId, number][]) draft.resources[resource].amount -= amount;
  }

  async setAutoPromotionPolicy(request: AutoPromotionPolicyRequest): Promise<ApiEnvelope<AutoPromotionPolicyData>> {
    const now = request.now ?? this.clock();
    this.assertContext(request);
    await this.ensurePlayerConfig(request.playerId, request, now);
    this.requireAutoPromotionContract();
    if (!Array.isArray(request.targetInstanceIds) || request.targetInstanceIds.length > 100 || new Set(request.targetInstanceIds).size !== request.targetInstanceIds.length || request.targetInstanceIds.some((id) => typeof id !== 'string' || id.length === 0)) throw new ApiError('VALIDATION_FAILED', 'targetInstanceIds must contain unique non-empty instance ids');
    const reserve = { spirit_stone: Math.max(0, Number(request.resourceReserve?.spirit_stone ?? 0)), millennium_herb: Math.max(0, Number(request.resourceReserve?.millennium_herb ?? 0)), meteor_iron: Math.max(0, Number(request.resourceReserve?.meteor_iron ?? 0)) };
    if (Object.values(reserve).some((value) => !Number.isSafeInteger(value))) throw new ApiError('VALIDATION_FAILED', 'resource reserve must contain non-negative integers');
    const policy: AutoPromotionPolicy = { enabled: request.enabled, targetInstanceIds: [...request.targetInstanceIds], resourceReserve: reserve, maxOperationsPerCycle: request.maxOperationsPerCycle ?? 10, strategyVersion: 'explicit-target-v1' };
    if (!Number.isSafeInteger(policy.maxOperationsPerCycle) || policy.maxOperationsPerCycle < 1 || policy.maxOperationsPerCycle > 100) throw new ApiError('VALIDATION_FAILED', 'maxOperationsPerCycle must be between 1 and 100');
    const fingerprint = hashPayload(policy);
    const actionKey = request.idempotencyKey ? `${request.playerId}:auto-promotion:policy:${fingerprint}:${request.idempotencyKey}` : undefined;
    const previous = await this.previousActionResponse<ApiEnvelope<AutoPromotionPolicyData>>(actionKey, undefined);
    if (previous) return previous;
    return await this.repository.transaction(request.playerId, request.expectedRevision, { eventType: 'equipment_auto_promotion_policy', payload: { policy, fingerprint }, at: now }, (draft) => {
      draft.autoPromotionPolicy = structuredClone(policy);
      return envelope({ action: 'set_policy', policy: structuredClone(policy) }, draft.stateRevision + 1, request, now, this.configVersion);
    }, undefined, actionKey) as ApiEnvelope<AutoPromotionPolicyData>;
  }

  async autoPromotionCycle(request: AutoPromotionCycleRequest): Promise<ApiEnvelope<AutoPromotionCycleData>> {
    const now = request.now ?? this.clock();
    this.assertContext(request);
    await this.ensurePlayerConfig(request.playerId, request, now);
    this.requireAutoPromotionContract();
    const cycleId = request.cycleId ?? `${Math.floor(now.getTime() / 1000 / 3600)}`;
    if (!/^\d+$/.test(cycleId)) throw new ApiError('VALIDATION_FAILED', 'cycleId must be a canonical hourly cycle id');
    // cycleId is the durable idempotency boundary. A retry with a different
    // transport key must still replay the first committed cycle response.
    const actionKey = `${request.playerId}:auto-promotion:cycle:${cycleId}`;
    const previous = await this.previousActionResponse<ApiEnvelope<AutoPromotionCycleData>>(actionKey, undefined);
    if (previous) return previous;
    return await this.repository.transaction(request.playerId, request.expectedRevision, { eventType: 'equipment_auto_promotion_cycle', payload: { cycleId }, at: now }, (draft) => {
      const policy = draft.autoPromotionPolicy;
      const beforeRevision = draft.stateRevision;
      if (!policy?.enabled) return envelope({ cycleId, status: 'disabled', operations: [], skipped: [], resourceCost: {}, summaryHash: hashPayload({ cycleId, status: 'disabled' }), beforeRevision, afterRevision: beforeRevision + 1 }, draft.stateRevision + 1, request, now, this.configVersion);
      const previousCycle = draft.autoPromotionCycles?.[cycleId];
      if (previousCycle) return previousCycle.response as ApiEnvelope<AutoPromotionCycleData>;
      const qualityOrder = ['normal', 'fine', 'rare', 'epic', 'legendary', 'immortal'];
      const selected = policy.targetInstanceIds.map((id) => draft.equipmentInstances[id]).filter((instance): instance is EquipmentInstance => Boolean(instance));
      const operations: AutoPromotionOperation[] = [];
      const skipped: Array<{ targetInstanceId: string; reason: string }> = [];
      const reserved = policy.resourceReserve ?? {};
      for (const target of selected) {
        if (operations.length >= policy.maxOperationsPerCycle) { skipped.push({ targetInstanceId: target.instanceId, reason: 'max_operations_per_cycle' }); continue; }
        const qualityIndex = qualityOrder.indexOf(target.quality);
        if (qualityIndex < 0 || qualityIndex >= qualityOrder.length - 1) { skipped.push({ targetInstanceId: target.instanceId, reason: 'maximum_quality' }); continue; }
        const duplicate = Object.values(draft.equipmentInstances).filter((candidate) => candidate.instanceId !== target.instanceId && candidate.templateId === target.templateId && candidate.slot === target.slot && candidate.quality === target.quality && !candidate.isEquipped && candidate.lockedSlots.length === 0).sort((a, b) => (a.createdAt ?? '').localeCompare(b.createdAt ?? '') || a.instanceId.localeCompare(b.instanceId)).slice(0, this.value('loot.equipment.promotion.duplicate_required'));
        if (duplicate.length < this.value('loot.equipment.promotion.duplicate_required')) { skipped.push({ targetInstanceId: target.instanceId, reason: 'duplicate_insufficient' }); continue; }
        const transition = `${target.quality}_to_${qualityOrder[qualityIndex + 1]}`;
        const resourceCost: Partial<Record<ResourceId, number>> = { spirit_stone: this.value(`loot.equipment.promotion.${transition}.spirit_stone_cost`), millennium_herb: this.value(`loot.equipment.promotion.${transition}.millennium_herb_cost`), meteor_iron: this.value(`loot.equipment.promotion.${transition}.meteor_iron_cost`) };
        if ((draft.resources.spirit_stone.amount - Number(resourceCost.spirit_stone ?? 0)) < Number(reserved.spirit_stone ?? 0) || (draft.resources.millennium_herb.amount - Number(resourceCost.millennium_herb ?? 0)) < Number(reserved.millennium_herb ?? 0) || (draft.resources.meteor_iron.amount - Number(resourceCost.meteor_iron ?? 0)) < Number(reserved.meteor_iron ?? 0)) { skipped.push({ targetInstanceId: target.instanceId, reason: 'resource_reserve' }); continue; }
        operations.push({ targetInstanceId: target.instanceId, duplicateInstanceIds: duplicate.map((item) => item.instanceId), fromQuality: target.quality, toQuality: qualityOrder[qualityIndex + 1]!, resourceCost });
      }
      if (skipped.some((item) => item.reason !== 'max_operations_per_cycle')) throw new ApiError('AUTO_PROMOTION_BLOCKED', 'auto-promotion batch contains an invalid target; no operations were committed', { skipped });
      const resourceCost: Partial<Record<ResourceId, number>> = {};
      for (const operation of operations) for (const [resource, amount] of Object.entries(operation.resourceCost) as [ResourceId, number][]) resourceCost[resource] = (resourceCost[resource] ?? 0) + amount;
      if (Object.entries(resourceCost).some(([resource, amount]) => draft.resources[resource as ResourceId].amount - amount < Number(reserved[resource as keyof typeof reserved] ?? 0))) throw new ApiError('AUTO_PROMOTION_BLOCKED', 'auto-promotion batch exceeds resource reserve');
      for (const operation of operations) {
        const target = draft.equipmentInstances[operation.targetInstanceId]!;
        for (const id of operation.duplicateInstanceIds) delete draft.equipmentInstances[id];
        for (const [resource, amount] of Object.entries(operation.resourceCost) as [ResourceId, number][]) draft.resources[resource].amount -= amount;
        target.quality = operation.toQuality;
        target.affixes = { ...target.affixes, qualityMultiplier: this.value(`loot.equipment.quality.multiplier.${operation.toQuality}`) };
      }
      draft.equipmentCount = Object.keys(draft.equipmentInstances).length;
      const afterRevision = draft.stateRevision + 1;
      const response = envelope({ cycleId, status: 'committed', operations, skipped, resourceCost, summaryHash: hashPayload({ cycleId, operations, skipped, resourceCost }), beforeRevision, afterRevision }, afterRevision, request, now, this.configVersion);
      draft.autoPromotionCycles = { ...(draft.autoPromotionCycles ?? {}), [cycleId]: { cycleId, response, policyFingerprint: hashPayload(policy), committedAt: iso(now) } };
      return response;
    }, undefined, actionKey) as ApiEnvelope<AutoPromotionCycleData>;
  }

  private requireAutoPromotionContract(): void {
    const enabled = this.parameters['schedule.equipment.auto_promotion.enabled'];
    if (!enabled || enabled.status !== 'frozen_v1' || enabled.value !== 1) throw new ApiError('CONTENT_LOCKED', 'formal auto-promotion enable parameter is unavailable');
  }

  private value(id: string): number { return Number(this.parameters[id]?.value ?? 0); }
  private actionTargetId(request: StartActionRequest): string | null {
    if (request.actionId === 'technique_training') {
      if (!request.techniqueId) throw new ApiError('VALIDATION_FAILED', 'technique_training requires techniqueId');
      return request.techniqueId;
    }
    if (request.actionId === 'herbalism' || request.actionId === 'mining') {
      if (!request.mapId) throw new ApiError('VALIDATION_FAILED', `${request.actionId} requires mapId`);
      return request.mapId;
    }
    if (request.actionId.includes(':') && gatheringActions[request.actionId]) return request.actionId.split(':').slice(1).join(':');
    return this.productionTargetId(request);
  }
  private productionTargetId(request: StartActionRequest): string | null {
    if (request.actionId === 'alchemy') {
      if (!request.recipeId) throw new ApiError('VALIDATION_FAILED', 'alchemy action requires recipeId');
      return request.recipeId;
    }
    if (request.actionId === 'forge') {
      if (!request.recipeId || !request.equipmentTemplateId) throw new ApiError('VALIDATION_FAILED', 'forge action requires recipeId and equipmentTemplateId');
      this.requireProductionEquipmentTemplate(request.equipmentTemplateId);
      return `${request.recipeId}:${request.equipmentTemplateId}`;
    }
    if (request.actionId === 'alchemy_basic') return request.recipeId ?? 'alchemy_basic';
    if (request.actionId === 'forge_basic') return request.equipmentTemplateId ? `forge_basic:${request.equipmentTemplateId}` : 'forge_basic';
    return null;
  }
  private requireProductionEquipmentTemplate(templateId: string): void {
    const template = this.content.equipment.find((candidate) => candidate.id === templateId && !isContentPending(candidate));
    if (!template) throw new ApiError('CONTENT_LOCKED', `equipment template ${templateId} is unavailable`, { templateId, reason: 'unknown_or_pending_template' });
  }
  private productionRecipe(action: string, targetId?: string | null): ContentPackage['recipes'][number] | null {
    if (action === 'technique_research' || action === 'treasure_research' || action === 'training') return null;
    const [targetRecipe] = (targetId ?? '').split(':');
    const recipeId = action === 'alchemy' || action === 'forge' ? targetRecipe : action === 'alchemy_basic' ? (targetRecipe || 'alchemy_basic') : action === 'forge_basic' ? (targetRecipe || 'forge_basic') : '';
    if (!recipeId) return null;
    const buildingId = action === 'forge' || action === 'forge_basic' ? 'forge_room' : 'alchemy_room';
    const recipe = this.content.recipes.find((candidate) => candidate.id === recipeId && candidate.building_id === buildingId && !isContentPending(candidate));
    if (!recipe) throw new ApiError('CONTENT_LOCKED', `recipe ${recipeId} is unavailable`, { recipeId, actionId: action });
    return recipe;
  }
  private highTierExpeditionRealm(actionId: string): HighTierRealm | null {
    if (!highTierActionIds.includes(actionId)) return null;
    return actionId.slice(highTierActionPrefix.length) as HighTierRealm;
  }
  private rawValue(id: string): unknown { return this.parameters[id]?.value; }
  private recordMetric(event: MetricsEvent): void {
    this.metrics?.record(event);
    if (!this.metricsSink) return;
    // Never await telemetry from a gameplay mutation. Catch both synchronous
    // adapter failures and rejected promises to avoid unhandled rejections.
    try {
      const write = Promise.resolve(this.metricsSink.record(event))
        .catch(() => undefined)
        .finally(() => this.pendingMetricWrites.delete(write));
      this.pendingMetricWrites.add(write);
    } catch {
      // A malformed or unavailable sink must not alter the committed result.
    }
  }
  /** Replay current idempotency keys, with a guarded fallback for rows written
   * before the operation-target namespace was introduced. */
  private async previousActionResponse<T>(actionKey: string | undefined, legacyKey: string | undefined, matches?: (value: unknown) => boolean): Promise<T | undefined> {
    if (!actionKey) return undefined;
    const current = await this.repository.getActionResponse(actionKey);
    if (current !== null) return current as T;
    if (!legacyKey || legacyKey === actionKey) return undefined;
    const legacy = await this.repository.getActionResponse(legacyKey);
    if (legacy !== null && (!matches || matches(legacy))) return legacy as T;
    return undefined;
  }
  private assertContext(context: ServiceContext): void { if (context.configVersion && context.configVersion !== this.configVersion) throw new ApiError('CONFIG_VERSION_MISMATCH', 'client config version is not supported', { requestedConfigVersion: context.configVersion, activeConfigVersion: this.configVersion }); }
  private async ensurePlayerConfig(playerId: string, context: ServiceContext, now: Date): Promise<PlayerState> {
    this.assertContext(context);
    const player = await this.repository.getPlayer(playerId);
    if (player.configVersion === this.configVersion) return player;
    const policy = this.migrationPolicy;
    if (!policy || !policy.fromVersions.includes(player.configVersion)) throw new ApiError('CONFIG_VERSION_MISMATCH', 'player state config version is not supported', { playerConfigVersion: player.configVersion, activeConfigVersion: this.configVersion });
    const fromVersion = player.configVersion;
    const payload = { fromVersion, toVersion: this.configVersion, policy: policy.mode };
    await this.repository.transaction(playerId, player.stateRevision, { eventType: 'player_config_migrated', payload, at: now }, (draft) => {
      if (draft.configVersion !== fromVersion) throw new ApiError('CONFIG_VERSION_MISMATCH', 'player state changed before config migration');
      draft.configVersion = this.configVersion;
    });
    return this.repository.getPlayer(playerId);
  }
  private async readOnlyPlayerConfig(playerId: string, context: ServiceContext): Promise<PlayerState> {
    this.assertContext(context);
    const player = await this.repository.getPlayer(playerId);
    if (player.configVersion === this.configVersion) return player;
    throw new ApiError('CONFIG_VERSION_MISMATCH', 'read-only operation requires player state on the active config release', {
      playerConfigVersion: player.configVersion,
      activeConfigVersion: this.configVersion,
      migrationRequired: true,
    });
  }
  private async previewPlayerConfig(playerId: string, context: ServiceContext): Promise<PlayerState> {
    this.assertContext(context);
    const player = await this.repository.getPlayer(playerId);
    if (player.configVersion === this.configVersion) return player;
    const policy = this.migrationPolicy;
    if (!policy || !policy.fromVersions.includes(player.configVersion)) throw new ApiError('CONFIG_VERSION_MISMATCH', 'read-only operation requires a compatible player config release', {
      playerConfigVersion: player.configVersion,
      activeConfigVersion: this.configVersion,
      migrationRequired: true,
    });
    return player;
  }
  private settlementData(settlementId: string, requestedStart: Date, requestedEnd: Date, start: Date, end: Date, clipped: boolean, resourceDelta: Partial<Record<ResourceId, number>>, cultivationDelta: number, completedActions: number, failed: boolean, overflow: Partial<Record<ResourceId, number>>, productionDelta: Partial<Record<ProductionOutputId, number>> = {}, completedProductionActions = 0): SettlementData { return { settlementId, requestedStartedAt: iso(requestedStart), requestedEndedAt: iso(requestedEnd), settledStartedAt: iso(start), settledEndedAt: iso(end), settledSeconds: Math.max(0, Math.floor((end.getTime() - start.getTime()) / 1000)), clipped, resourceDelta, cultivationDelta, completedActions, failed, overflow, summaryHash: '', productionDelta, completedProductionActions }; }
  /** Validate the versioned content and exit-policy contract before a map
   * equipment writer is allowed to mutate the settlement draft. */
  private requireMapEquipmentDropContract(mapId: string): NonNullable<ContentPackage['maps'][number]['equipment_drop']> {
    const diagnostics = [...diagnoseMapEquipmentReleaseReadiness(this.content, this.parameters), ...validateEquipmentExitPolicy(this.parameters)];
    const map = this.content.maps.find((item) => item.id === mapId);
    const binding = map?.equipment_drop;
    if (!binding || diagnostics.length > 0) throw new ApiError('CONTENT_LOCKED', `map ${mapId} equipment drop content is not ready`, { mapId, diagnostics, configVersion: this.configVersion });
    return binding;
  }

  private writeMapEquipmentDrop(draft: PlayerState, mapId: string, resourceDelta: Partial<Record<ResourceId, number>>, overflow: Partial<Record<ResourceId, number>>): EquipmentDropSummary {
    const binding = this.requireMapEquipmentDropContract(mapId);
    const qualities = ['normal', 'fine', 'rare', 'epic', 'legendary', 'immortal'] as const;
    const quality = this.weighted([...qualities], qualities.map((candidate) => this.value(`map.${mapId}.equipment_quality_${candidate}_chance`)), this.nextRandom(draft));
    const categories = ['weapon', 'armor', 'accessory'] as const;
    const category = this.weighted([...categories], categories.map((candidate) => this.value(`loot.equipment.drop_slot_weight.${candidate}`)), this.nextRandom(draft));
    const candidates = binding.template_ids.filter((templateId) => {
      const template = this.content.equipment.find((item) => item.id === templateId);
      if (!template || template.quality !== quality) return false;
      const templateCategory = template.slot === 'weapon' ? 'weapon' : template.slot === 'accessory' ? 'accessory' : 'armor';
      return templateCategory === category;
    });
    if (candidates.length === 0) throw new ApiError('CONTENT_LOCKED', `map ${mapId} equipment binding has no template for the selected quality and slot category`, { mapId, quality, category });
    const templateId = candidates[Math.floor(this.nextRandom(draft) * candidates.length)];
    const instanceId = `equipment.map.${mapId}.${draft.randomState.draws}`;
    const instance = writeEquipmentInstanceFromContent({ instanceId, configVersion: this.configVersion, seed: draft.randomState.seed, content: this.content, templateId, parameterSha256: this.parameterSha256 }, this.parameters);
    const capacity = this.value('economy.inventory.cap.equipment');
    if (!Number.isSafeInteger(capacity) || capacity < 0) throw new ApiError('CONTENT_LOCKED', 'equipment inventory capacity is not a valid frozen value', { path: 'economy.inventory.cap.equipment', value: capacity });
    const inventoryFull = draft.equipmentCount >= capacity;
    const exit = decideEquipmentExit(this.parameters, instance.quality, inventoryFull);
    if (exit === 'retain') {
      draft.equipmentInstances[instance.instanceId] = instance;
      draft.equipmentCount += 1;
    } else if (exit === 'salvage') {
      this.addResource(draft, 'spirit_ore', this.value(`loot.equipment.salvage.${instance.quality}.spirit_ore`), resourceDelta, overflow);
      this.addResource(draft, 'spirit_wood', this.value(`loot.equipment.salvage.${instance.quality}.spirit_wood`), resourceDelta, overflow);
    } else {
      this.addResource(draft, 'spirit_stone', this.value(`loot.equipment.sell.spirit_stone.${instance.quality}`), resourceDelta, overflow);
    }
    return { instanceId: instance.instanceId, templateId: instance.templateId, quality: instance.quality, slot: instance.slot, exit };
  }
  private pendingRecord(request: SettlementRequest, requestedStart: Date, requestedEnd: Date, now: Date): SettlementRecord {
    const responsePayload = { settlementId: request.settlementId, status: 'pending' as const };
    return { settlementId: request.settlementId, playerId: request.playerId, requestStartedAt: iso(requestedStart), requestEndedAt: iso(requestedEnd), settledSeconds: 0, expectedRevision: request.expectedRevision, committedRevision: null, configVersion: this.configVersion, summaryHash: hashPayload(responsePayload), status: 'pending', responsePayload, createdAt: iso(now), committedAt: null };
  }
  private rejectedRecord(request: SettlementRequest, requestedStart: Date, requestedEnd: Date, now: Date, error: unknown): SettlementRecord {
    const code = error instanceof ApiError ? error.code : 'INTERNAL_ROLLBACK';
    const message = error instanceof Error ? error.message : String(error);
    const details = error instanceof ApiError ? error.details : undefined;
    const responsePayload = { settlementId: request.settlementId, status: 'rejected' as const, error: { code, message, ...(details === undefined ? {} : { details }) } };
    return { settlementId: request.settlementId, playerId: request.playerId, requestStartedAt: iso(requestedStart), requestEndedAt: iso(requestedEnd), settledSeconds: 0, expectedRevision: request.expectedRevision, committedRevision: null, configVersion: this.configVersion, summaryHash: hashPayload(responsePayload), status: 'rejected', responsePayload, createdAt: iso(now), committedAt: null };
  }
  private record(request: SettlementRequest, response: ApiEnvelope<SettlementData>, data: SettlementData, revision: number, now: Date) { return { settlementId: request.settlementId, playerId: request.playerId, requestStartedAt: data.requestedStartedAt, requestEndedAt: data.requestedEndedAt, settledSeconds: data.settledSeconds, expectedRevision: request.expectedRevision, committedRevision: revision, configVersion: this.configVersion, summaryHash: data.summaryHash, status: 'committed' as const, responsePayload: response, createdAt: iso(now), committedAt: iso(now) }; }
  private simulateSingleSlotProduction(draft: PlayerState, action: string, seconds: number): { carrySeconds: number; completedActions: number; blocked: boolean; resourceDelta: Partial<Record<ResourceId, number>>; overflow: Partial<Record<ResourceId, number>>; productionDelta: Partial<Record<ProductionOutputId, number>>; cultivationDelta?: number; skillXpDelta?: SettlementData['skillXpDelta'] } | null {
    const targetId = draft.primaryAction.targetId ?? null;
    const techniqueTraining = action === 'technique_training';
    const gathering = gatheringActions[action] ?? (targetId ? gatheringActions[`${action}:${targetId}`] : undefined);
    if (techniqueTraining || gathering) {
      const interval = techniqueTraining
        ? this.value('building.training_room.base_interval') / this.value(`building.level.speed_multiplier_${draft.buildings.technique_pavilion.level}`)
        : gathering!.interval;
      const total = draft.primaryAction.carrySeconds + Math.max(0, seconds);
      const completedActions = Math.floor(total / interval);
      const resourceDelta: Partial<Record<ResourceId, number>> = {};
      const overflow: Partial<Record<ResourceId, number>> = {};
      const cultivationDelta = techniqueTraining ? completedActions * this.value('building.training_room.base_cultivation_xp') * (targetId === 'focus_cultivation' ? 2 : 1) : 0;
      const skillXpDelta: SettlementData['skillXpDelta'] = {};
      if (techniqueTraining) {
        // 技能 XP 保持每 60 秒 +1 的既有速率（DT-NUM-20260827-01 将行动节拍改为 6s 后，按累计时长折算，避免技能升级 ×10）
        const TECHNIQUE_XP_TICK_SECONDS = 60;
        const xpActionsTotal = Math.floor(total / TECHNIQUE_XP_TICK_SECONDS);
        const xpActionsBefore = Math.floor((total - Math.max(0, seconds)) / TECHNIQUE_XP_TICK_SECONDS);
        const xpActions = Math.max(0, xpActionsTotal - xpActionsBefore);
        draft.skillProgress.techniqueXp[targetId!] = (draft.skillProgress.techniqueXp[targetId!] ?? 0) + xpActions;
        draft.skillProgress.techniqueAttributes[targetId!] = (draft.skillProgress.techniqueAttributes[targetId!] ?? 0) + xpActions;
        skillXpDelta.technique = { [targetId!]: xpActions };
        draft.cultivationXp += cultivationDelta;
      } else {
        const amount = completedActions * gathering!.yield;
        this.addResource(draft, gathering!.resource, amount, resourceDelta, overflow);
        draft.skillProgress[`${gathering!.skill}Xp`] += completedActions;
        skillXpDelta[gathering!.skill] = completedActions;
      }
      return { carrySeconds: total - completedActions * interval, completedActions, blocked: false, resourceDelta, overflow, productionDelta: {}, cultivationDelta, skillXpDelta };
    }
    const recipe = this.productionRecipe(action, draft.primaryAction.targetId);
    const research = action === 'technique_research' || action === 'treasure_research';
    if (!recipe && !research) return null;
    const buildingId: BuildingId = recipe?.building_id ?? (action === 'treasure_research' ? 'treasure_pavilion' : 'technique_pavilion');
    const building = draft.buildings[buildingId];
    if (!building) throw new ApiError('CONTENT_LOCKED', `building is not available: ${buildingId}`);
    const baseInterval = recipe ? this.value(recipe.interval_parameter) : this.value('building.technique_pavilion.base_interval');
    const interval = baseInterval / this.value(`building.level.speed_multiplier_${building.level}`);
    const total = draft.primaryAction.carrySeconds + Math.max(0, seconds);
    const attempted = Math.floor(total / interval);
    const resourceDelta: Partial<Record<ResourceId, number>> = {};
    const overflow: Partial<Record<ResourceId, number>> = {};
    const productionDelta: Partial<Record<ProductionOutputId, number>> = {};
    const skillXpDelta: SettlementData['skillXpDelta'] = {};
    let completedActions = 0;
    let blocked = false;
    for (let index = 0; index < attempted; index += 1) {
      if (recipe) {
        const inputs = this.recipeInputCosts(recipe);
        const insufficient = Object.entries(inputs).some(([resource, unitCost]) => draft.resources[resource as ResourceId].amount < unitCost);
        if (insufficient) { blocked = true; break; }
        for (const [resource, unitCost] of Object.entries(inputs) as [ResourceId, number][]) this.addResource(draft, resource, -unitCost, resourceDelta, overflow);
        if (recipe.output_resource === 'pill') {
          const produced = this.addResource(draft, 'pill', this.value(recipe.output_parameter), resourceDelta, overflow);
          productionDelta.pill = (productionDelta.pill ?? 0) + produced;
        } else if (recipe.output_resource === 'equipment') {
          const outputAmount = this.value(recipe.output_parameter);
          const capacity = this.value('economy.inventory.cap.equipment');
          if (draft.equipmentCount + outputAmount > capacity) throw new ApiError('INVENTORY_FULL', 'equipment inventory is full', { capacity, current: draft.equipmentCount });
          const templateId = this.productionEquipmentTemplateId(draft.primaryAction.targetId);
          if (!templateId) {
            // Legacy forge_basic rows predate selectable equipment targets.
            draft.equipmentCount += outputAmount;
          } else {
            for (let item = 0; item < outputAmount; item += 1) {
              const instanceId = `equipment.forge.${draft.randomState.draws}`;
              const instance = writeEquipmentInstanceFromContent({ instanceId, configVersion: this.configVersion, seed: this.nextRandom(draft) * 0xffffffff >>> 0, content: this.content, templateId, parameterSha256: this.parameterSha256 }, this.parameters);
              draft.equipmentInstances[instance.instanceId] = instance;
              draft.equipmentCount += 1;
            }
          }
          productionDelta.equipment = (productionDelta.equipment ?? 0) + outputAmount;
        } else throw new ApiError('VALIDATION_FAILED', `unsupported production output ${recipe.output_resource}`);
        if (recipe.building_id === 'alchemy_room') { draft.skillProgress.alchemyXp += 1; skillXpDelta.alchemy = (skillXpDelta.alchemy ?? 0) + 1; }
        if (recipe.building_id === 'forge_room') { draft.skillProgress.forgeXp += 1; skillXpDelta.forge = (skillXpDelta.forge ?? 0) + 1; }
      } else if (action === 'technique_research') {
        const xp = this.value('building.technique_pavilion.research_xp_per_action');
        draft.collection.techniqueResearchXp += xp;
        productionDelta.technique_research_xp = (productionDelta.technique_research_xp ?? 0) + xp;
      } else {
        // Treasure research has no frozen V1 recipe. Keep the V1 vertical slice
        // conservative: one starter-pool mark per completed interval.
        draft.collection.collectionMarks += 1;
        draft.collectionMarkBalances ??= {};
        draft.collectionMarkBalances.starter = (draft.collectionMarkBalances.starter ?? 0) + 1;
        productionDelta.technique_research_xp = (productionDelta.technique_research_xp ?? 0) + 1;
      }
      completedActions += 1;
    }
    building.stateRevision += completedActions > 0 ? 1 : 0;
    return { carrySeconds: total - completedActions * interval, completedActions, blocked, resourceDelta, overflow, productionDelta, skillXpDelta };
  }
  private productionEquipmentTemplateId(targetId?: string | null): string | null {
    if (!targetId) return null;
    const parts = targetId.split(':');
    return parts.length === 2 ? parts[1] ?? null : null;
  }
  private simulate(draft: PlayerState, seconds: number): { carrySeconds: number; cultivationDelta: number; completedActions: number; failed: boolean; actionEnded?: boolean; resourceDelta: Partial<Record<ResourceId, number>>; overflow: Partial<Record<ResourceId, number>>; equipmentDrops?: EquipmentDropSummary[]; productionDelta?: Partial<Record<ProductionOutputId, number>>; completedProductionActions?: number; skillXpDelta?: SettlementData['skillXpDelta'] } {
    const action = draft.primaryAction.actionId;
    if (!action) return { carrySeconds: draft.primaryAction.carrySeconds, cultivationDelta: 0, completedActions: 0, failed: false, resourceDelta: {}, overflow: {} };
    const sequenceProduction = this.simulateSingleSlotProduction(draft, action, seconds);
    if (sequenceProduction) {
      return { carrySeconds: sequenceProduction.carrySeconds, cultivationDelta: sequenceProduction.cultivationDelta ?? 0, completedActions: sequenceProduction.completedActions, failed: false, actionEnded: sequenceProduction.blocked, resourceDelta: sequenceProduction.resourceDelta, overflow: sequenceProduction.overflow, productionDelta: sequenceProduction.productionDelta, completedProductionActions: sequenceProduction.completedActions, skillXpDelta: sequenceProduction.skillXpDelta };
    }
    const highTierRealm = this.highTierExpeditionRealm(action);
    if (highTierRealm) {
      const resourceDelta: Partial<Record<ResourceId, number>> = {};
      const overflow: Partial<Record<ResourceId, number>> = {};
      for (const [resource, suffix] of highTierSupplyResources) this.addResource(draft, resource, this.highTierValue(highTierRealm, suffix) * seconds / 3600, resourceDelta, overflow);
      return { carrySeconds: 0, cultivationDelta: 0, completedActions: 0, failed: false, resourceDelta, overflow };
    }
    const map = this.maps[action];
    const contentMap = this.content.maps.find((candidate) => candidate.id === action);
    if (map && (!contentMap || isContentPending(contentMap))) throw new ApiError('CONTENT_LOCKED', `map ${action} content is not available for settlement`);
    const interval = map ? this.mapKillSeconds(action, draft) : this.value('building.training_room.base_interval');
    const total = draft.primaryAction.carrySeconds + seconds;
    const attempted = Math.floor(total / interval);
    let completedActions = attempted;
    let failed = false;
    if (map?.pill) { completedActions = Math.min(attempted, Math.floor(draft.resources.pill.amount / map.pill)); failed = completedActions < attempted; }
    if (map) {
      const stats = this.combatStats(draft);
      const damagePerFight = this.value(`map.${action}.enemy_damage_per_second`) * interval * 100 / (100 + stats.defence) * stats.incomingSpecial;
      const survivable = Math.max(0, Math.floor(stats.health / Math.max(0.0001, damagePerFight)));
      if (completedActions > survivable) { completedActions = survivable; failed = true; }
    }
    const carrySeconds = total - completedActions * interval;
    const resourceDelta: Partial<Record<ResourceId, number>> = {};
    const overflow: Partial<Record<ResourceId, number>> = {};
    const equipmentDrops: EquipmentDropSummary[] = [];
    let cultivationDelta = 0;
    if (!map) cultivationDelta = Math.min(completedActions * this.value('building.training_room.base_cultivation_xp'), Math.max(0, this.value('growth.cultivation.qi_target_xp') - draft.cultivationXp));
    else {
      // A malformed probability must never be coerced to "no drop" by
      // `NaN > 0`/range checks.  Reject before mutating any map reward state.
      if (!Number.isFinite(map.equipmentChance) || map.equipmentChance < 0 || map.equipmentChance > 1) this.requireMapEquipmentDropContract(action);
      this.addResource(draft, 'spirit_stone', completedActions * map.stone, resourceDelta, overflow);
      this.addResource(draft, 'spirit_ore', completedActions * map.ore, resourceDelta, overflow);
      if (map.pill) this.addResource(draft, 'pill', -completedActions * map.pill, resourceDelta, overflow);
      let pity = draft.mapPity[action] ?? 0;
      for (let index = 0; index < completedActions; index += 1) {
        pity += 1;
        draft.randomState.draws += 1;
        const scrollRoll = this.nextRandom(draft);
        if (scrollRoll < map.chance || pity >= map.pity) { this.addResource(draft, 'ancient_scroll', 1, resourceDelta, overflow); pity = 0; }
        // Consume a separate deterministic draw for the equipment table. If
        // it hits while the binding is absent, throw before the transaction
        // can commit any resource, pity, or production changes.
        if (map.equipmentChance > 0) {
          draft.randomState.draws += 1;
          if (this.nextRandom(draft) < map.equipmentChance) equipmentDrops.push(this.writeMapEquipmentDrop(draft, action, resourceDelta, overflow));
        }
      }
      draft.mapPity[action] = pity;
    }
    draft.cultivationXp += cultivationDelta;
    return { carrySeconds, cultivationDelta, completedActions, failed, resourceDelta, overflow, equipmentDrops };
  }
  private recipeInputCosts(recipe: ContentPackage['recipes'][number]): Partial<Record<ResourceId, number>> {
    return Object.fromEntries(Object.entries(recipe.input_parameters).map(([resource, parameter]) => [resource, this.value(parameter)])) as Partial<Record<ResourceId, number>>;
  }
  private simulateBuildings(draft: PlayerState, seconds: number, settledAt: Date): { productionDelta: Partial<Record<ProductionOutputId, number>>; resourceDelta: Partial<Record<ResourceId, number>>; overflow: Partial<Record<ResourceId, number>>; completedActions: number } {
    const productionDelta: Partial<Record<ProductionOutputId, number>> = {};
    const resourceDelta: Partial<Record<ResourceId, number>> = {};
    const overflow: Partial<Record<ResourceId, number>> = {};
    let completedActions = 0;
    for (const buildingId of ['alchemy_room', 'forge_room'] as BuildingId[]) {
      // V1.1 sequences own alchemy/forge time. Legacy queued jobs remain
      // readable for migration/replay, but are paused whenever any global
      // sequence is active so they cannot create a second production slot.
      if (draft.primaryAction.modelVersion === SINGLE_SLOT_ACTION_MODEL || draft.primaryAction.actionId) continue;
      const building = draft.buildings[buildingId];
      if (building.queuedJobIds.length === 0) continue;
      let completedForBuilding = 0;
      let availableSeconds = building.carrySeconds + seconds;
      while (building.queuedJobIds.length > 0) {
        const jobId = building.queuedJobIds[0];
        const job = draft.buildingJobs[jobId];
        if (!job) throw new ApiError('INTERNAL_ROLLBACK', `building job ${jobId} is missing`);
        const recipe = this.content.recipes.find((item) => item.id === job.recipeId && !isContentPending(item));
        if (!recipe) throw new ApiError('CONTENT_LOCKED', `recipe ${job.recipeId} is unavailable`);
        const interval = this.value(recipe.interval_parameter) / this.value(`building.level.speed_multiplier_${building.level}`);
        const possible = Math.floor(availableSeconds / interval);
        const completed = Math.min(job.remainingQuantity, possible);
        if (completed <= 0) break;
        availableSeconds -= completed * interval;
        const inputs = this.recipeInputCosts(recipe);
        for (const [resource, unitCost] of Object.entries(inputs) as [ResourceId, number][]) {
          const consumed = unitCost * completed;
          draft.resources[resource].reservedAmount -= consumed;
          resourceDelta[resource] = (resourceDelta[resource] ?? 0) - consumed;
        }
        const output = recipe.output_resource;
        const outputAmount = this.value(recipe.output_parameter) * completed;
        if (output === 'pill') {
          const delta = this.addResource(draft, 'pill', outputAmount, resourceDelta, overflow);
          productionDelta.pill = (productionDelta.pill ?? 0) + delta;
        } else if (output === 'equipment') {
          const capacity = this.value('economy.inventory.cap.equipment');
          if (draft.equipmentCount + outputAmount > capacity) throw new ApiError('INVENTORY_FULL', 'equipment inventory is full', { capacity, current: draft.equipmentCount });
          draft.equipmentCount += outputAmount;
          productionDelta.equipment = (productionDelta.equipment ?? 0) + outputAmount;
        } else throw new ApiError('VALIDATION_FAILED', `unsupported production output ${output}`);
        job.remainingQuantity -= completed;
        completedActions += completed;
        completedForBuilding += completed;
        if (job.remainingQuantity === 0) { delete draft.buildingJobs[jobId]; building.queuedJobIds.shift(); } else break;
      }
      building.carrySeconds = availableSeconds;
      const previousActiveJob = building.activeJobId;
      building.activeJobId = building.queuedJobIds[0] ?? null;
      building.jobStartedAt = building.activeJobId ? (building.activeJobId === previousActiveJob ? building.jobStartedAt : iso(settledAt)) : null;
      if (completedForBuilding > 0) building.stateRevision += 1;
    }
    const farm = draft.buildings.spirit_farm;
    const plotStates = farm.spiritFarmPlots;
    if (plotStates && Object.keys(plotStates).length > 0) {
      for (const [plotId, plot] of Object.entries(plotStates)) {
        const matureAt = new Date(plot.matureAt);
        if (plot.plotId !== plotId || !plot.plantId || Number.isNaN(matureAt.getTime()) || matureAt <= new Date(plot.plantedAt)) throw new ApiError('INTERNAL_ROLLBACK', 'explicit spirit farm plot state is invalid', { plotId });
        if (matureAt <= settledAt) {
          const generatedHerbs = this.value('building.spirit_farm.herb_yield_per_plot');
          const actualHerbs = this.addResource(draft, 'spirit_herb', generatedHerbs, resourceDelta, overflow);
          productionDelta.spirit_herb = (productionDelta.spirit_herb ?? 0) + actualHerbs;
          completedActions += 1;
          delete plotStates[plotId];
          farm.stateRevision += 1;
        }
      }
    } else if (farm.plantedPlots !== undefined && farm.plantedPlots !== null) {
      const matureAt = farm.matureAt ? new Date(farm.matureAt) : null;
      if (!matureAt || Number.isNaN(matureAt.getTime()) || !Number.isSafeInteger(farm.plantedPlots) || farm.plantedPlots < 0) throw new ApiError('INTERNAL_ROLLBACK', 'explicit spirit farm state is invalid');
      if (farm.plantedPlots > 0 && matureAt <= settledAt) {
        const generatedHerbs = farm.plantedPlots * this.value('building.spirit_farm.herb_yield_per_plot');
        const actualHerbs = this.addResource(draft, 'spirit_herb', generatedHerbs, resourceDelta, overflow);
        productionDelta.spirit_herb = (productionDelta.spirit_herb ?? 0) + actualHerbs;
        completedActions += 1;
        farm.plantedPlots = 0;
        farm.plantedAt = null;
        farm.matureAt = null;
        farm.carrySeconds = 0;
        farm.stateRevision += 1;
      }
    } else {
      const farmTotalSeconds = farm.carrySeconds + seconds;
      const farmInterval = this.value('building.spirit_farm.base_growth_time') / this.value(`building.level.speed_multiplier_${farm.level}`);
      const farmHarvests = Math.floor(farmTotalSeconds / farmInterval);
      farm.carrySeconds = farmTotalSeconds - farmHarvests * farmInterval;
      if (farmHarvests > 0) {
        const generatedHerbs = farmHarvests * this.value('building.spirit_farm.plot_count') * this.value('building.spirit_farm.herb_yield_per_plot');
        const actualHerbs = this.addResource(draft, 'spirit_herb', generatedHerbs, resourceDelta, overflow);
        productionDelta.spirit_herb = (productionDelta.spirit_herb ?? 0) + actualHerbs;
        completedActions += farmHarvests;
      }
      if (farm.carrySeconds !== farmTotalSeconds || seconds > 0) farm.stateRevision += 1;
    }
    const technique = draft.buildings.technique_pavilion;
    // Research is an active sequence in the global model. Never let the old
    // passive pavilion tick grant XP while another action (or no action) is
    // active. The active research sequence is simulated by `simulate` above.
    if (draft.primaryAction.modelVersion === SINGLE_SLOT_ACTION_MODEL || draft.primaryAction.actionId) return { productionDelta, resourceDelta, overflow, completedActions };
    const techniqueTotalSeconds = technique.carrySeconds + seconds;
    const techniqueInterval = this.value('building.technique_pavilion.base_interval') / this.value(`building.level.speed_multiplier_${technique.level}`);
    const techniqueActions = Math.floor(techniqueTotalSeconds / techniqueInterval);
    technique.carrySeconds = techniqueTotalSeconds - techniqueActions * techniqueInterval;
    if (techniqueActions > 0) {
      const researchXp = techniqueActions * this.value('building.technique_pavilion.research_xp_per_action');
      draft.collection.techniqueResearchXp += researchXp;
      productionDelta.technique_research_xp = (productionDelta.technique_research_xp ?? 0) + researchXp;
      completedActions += techniqueActions;
    }
    if (technique.carrySeconds !== techniqueTotalSeconds || seconds > 0) technique.stateRevision += 1;
    return { productionDelta, resourceDelta, overflow, completedActions };
  }
  private addResource(draft: PlayerState, resource: ResourceId, delta: number, resourceDelta: Partial<Record<ResourceId, number>>, overflow: Partial<Record<ResourceId, number>>): number { const item = draft.resources[resource]; const before = item.amount; const after = Math.max(0, Math.min(item.capacity - item.reservedAmount, before + delta)); item.amount = after; const actual = after - before; resourceDelta[resource] = (resourceDelta[resource] ?? 0) + actual; if (delta > actual) { item.overflowAmount += delta - actual; overflow[resource] = (overflow[resource] ?? 0) + delta - actual; } return actual; }
  private nextRandom(draft: PlayerState): number { draft.randomState.seed = (1664525 * draft.randomState.seed + 1013904223) >>> 0; return draft.randomState.seed / 4294967296; }
}

export type LongTermEquipmentConsumptionData = {
  mode: 'read_only_long_term_equipment_consumption_v1';
  horizonHours: LongTermHorizonHours;
  realm: HighTierRealm;
  supportRoute: LongTermSupportRoute;
  economy: LongTermEconomyResult;
  consumption: LongTermEquipmentConsumptionResult;
};

const qualityCounts = (counts: Record<string, number>): Partial<Record<LongTermEquipmentQuality, number>> => {
  const qualities: readonly LongTermEquipmentQuality[] = ['normal', 'fine', 'rare', 'epic', 'legendary', 'immortal'];
  return Object.fromEntries(qualities.map((quality) => [quality, counts[quality] ?? 0])) as Partial<Record<LongTermEquipmentQuality, number>>;
};
