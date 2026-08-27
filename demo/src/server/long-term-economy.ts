import { FROZEN_PARAMETERS } from '../game/frozen-parameters.ts';
import type { ConfigParameterMap } from './config-release.ts';
import type { HighTierRealm, ResourceId } from './types.ts';
import { validateEquipmentExitPolicy } from './equipment-exit.ts';

export {
  LongTermEquipmentConsumptionError,
  planLongTermEquipmentConsumption,
  simulateLongTermEquipmentConsumption,
} from './long-term-equipment-consumption.ts';
export type {
  LongTermEquipmentConsumptionRequest,
  LongTermEquipmentConsumptionResult,
  LongTermEquipmentDiagnostic,
  LongTermEquipmentDropBatch,
  LongTermEquipmentPromotionRequest,
  LongTermEquipmentQuality,
} from './long-term-equipment-consumption.ts';

export type LongTermHorizonHours = 720 | 2160;
export type LongTermSupportRoute = 'qing_feng' | 'black_wind_valley';
export type LongTermEconomyDiagnostic = { path: string; code: 'MISSING_PARAMETER' | 'INVALID_VALUE' | 'UNSUPPORTED_POLICY'; message: string };

export type LongTermEconomyRequest = {
  horizonHours: LongTermHorizonHours;
  realm: HighTierRealm;
  seed: number;
  parameters?: ConfigParameterMap;
};

export type LongTermConfidenceMetric = { mean: number; lower99: number; upper99: number; samples: number };
export type LongTermEconomyConfidenceResult = {
  mode: 'fixed_seed_confidence_slice';
  horizonHours: LongTermHorizonHours;
  realm: HighTierRealm;
  sampleCount: number;
  seedStride: number;
  metrics: Record<string, LongTermConfidenceMetric>;
};

export type LongTermEconomyResult = {
  mode: 'fixed_seed_runtime_slice';
  horizonHours: LongTermHorizonHours;
  realm: HighTierRealm;
  highTierHours: number;
  supportHours: number;
  supportRoute: LongTermSupportRoute;
  highTier: {
    encounterIntervalHours: number;
    encounters: number;
    pillConsumed: number;
    resourceDrops: Partial<Record<ResourceId, number>>;
    equipmentDrops: number;
    equipmentByQuality: Record<string, number>;
    treasureCopies: Record<string, number>;
  };
  support: {
    clears: number;
    pillConsumed: number;
    resourceDrops: Partial<Record<ResourceId, number>>;
    equipmentDrops: number;
    equipmentByQuality: Record<string, number>;
    treasureCopies: Record<string, number>;
    techniqueDrops: number;
  };
  netResources: Partial<Record<ResourceId, number>>;
  diagnostics: LongTermEconomyDiagnostic[];
};

export class LongTermEconomyError extends Error {
  readonly diagnostics: LongTermEconomyDiagnostic[];

  constructor(diagnostics: LongTermEconomyDiagnostic[]) {
    super('long-term economy contract is not runnable');
    this.name = 'LongTermEconomyError';
    this.diagnostics = diagnostics;
  }
}

const HIGH_TIER_RESOURCES: Array<[ResourceId, string]> = [
  ['spirit_stone', 'spirit_stone_per_hour'],
  ['pill', 'pill_per_hour'],
  ['ancient_scroll', 'ancient_scroll_per_hour'],
  ['demon_core', 'demon_core_per_hour'],
  ['millennium_herb', 'millennium_herb_per_hour'],
  ['meteor_iron', 'meteor_iron_per_hour'],
];
const QUALITY_ORDER = ['normal', 'fine', 'rare', 'epic', 'legendary', 'immortal'];
const TREASURES = ['qing_lian_lamp', 'shan_he_seal', 'heaven_bag', 'zhu_que_feather', 'xuan_gui_shell', 'tai_xu_mirror'];
const highTierTreasureIds = (parameters: ConfigParameterMap, prefix: string): string[] => Object.keys(parameters).filter((key) => key.startsWith(`${prefix}.treasure_pool_weight.`)).map((key) => key.slice(`${prefix}.treasure_pool_weight.`.length)).sort();

const value = (parameters: ConfigParameterMap, id: string): number => Number(parameters[id]?.value ?? 0);
const raw = (parameters: ConfigParameterMap, id: string): unknown => parameters[id]?.value;
const add = (target: Partial<Record<ResourceId, number>>, resource: ResourceId, amount: number): void => { target[resource] = (target[resource] ?? 0) + amount; };
const roll = (state: { value: number }): number => {
  state.value = (1664525 * state.value + 1013904223) >>> 0;
  return state.value / 4294967296;
};
const weighted = (items: string[], weights: number[], random: number): string => {
  const total = weights.reduce((sum, item) => sum + item, 0);
  if (!Number.isFinite(total) || total <= 0) throw new RangeError('weighted pool must have a positive total weight');
  let cursor = random * total;
  for (let index = 0; index < items.length; index += 1) {
    cursor -= weights[index];
    if (cursor < 0) return items[index];
  }
  return items[items.length - 1];
};
const equipmentQuality = (parameters: ConfigParameterMap, prefix: string, random: number): string => {
  const weights = QUALITY_ORDER.map((quality) => value(parameters, `${prefix}.equipment_quality_${quality}_chance`));
  return weighted(QUALITY_ORDER, weights, random);
};
const requireFinitePositive = (parameters: ConfigParameterMap, path: string, diagnostics: LongTermEconomyDiagnostic[], allowZero = false): number => {
  const candidate = parameters[path]?.value;
  if (candidate === undefined) { diagnostics.push({ path, code: 'MISSING_PARAMETER', message: 'long-term economy requires this frozen parameter' }); return 0; }
  const number = Number(candidate);
  if (!Number.isFinite(number) || (allowZero ? number < 0 : number <= 0)) diagnostics.push({ path, code: 'INVALID_VALUE', message: allowZero ? 'value must be finite and non-negative' : 'value must be finite and positive' });
  return number;
};
const requireProbability = (parameters: ConfigParameterMap, path: string, diagnostics: LongTermEconomyDiagnostic[]): number => {
  const candidate = parameters[path]?.value;
  if (candidate === undefined) { diagnostics.push({ path, code: 'MISSING_PARAMETER', message: 'long-term economy requires this frozen parameter' }); return 0; }
  const number = Number(candidate);
  if (!Number.isFinite(number) || number < 0 || number > 100) diagnostics.push({ path, code: 'INVALID_VALUE', message: 'probability must be finite and between 0 and 100' });
  return number;
};
/**
 * A parameter being present and numerically valid is not enough to open a
 * formal route.  Release payloads carry provenance metadata, so a future
 * Qing Feng table must be explicitly frozen and attributable rather than a
 * proposal value copied into the active snapshot.
 */
const requireFrozenProvenance = (parameters: ConfigParameterMap, path: string, diagnostics: LongTermEconomyDiagnostic[]): void => {
  const entry = parameters[path];
  if (!entry) return;
  if (entry.status !== 'frozen_v1') diagnostics.push({ path, code: 'UNSUPPORTED_POLICY', message: 'long-term economy requires a frozen_v1 parameter' });
  if (typeof entry.source !== 'string' || entry.source.trim().length === 0) diagnostics.push({ path, code: 'MISSING_PARAMETER', message: 'long-term economy requires parameter source provenance' });
};
const requirePositiveWeightPool = (parameters: ConfigParameterMap, paths: string[], diagnostics: LongTermEconomyDiagnostic[], label: string): void => {
  const weights = paths.map((path) => requireFinitePositive(parameters, path, diagnostics, true));
  if (weights.reduce((sum, weight) => sum + weight, 0) <= 0) diagnostics.push({ path: label, code: 'INVALID_VALUE', message: 'weight pool must contain at least one positive weight' });
};

const validate = (request: LongTermEconomyRequest, parameters: ConfigParameterMap): LongTermEconomyDiagnostic[] => {
  const diagnostics: LongTermEconomyDiagnostic[] = [];
  if (!Number.isInteger(request.seed) || request.seed < 0 || request.seed > 0xffffffff) diagnostics.push({ path: 'seed', code: 'INVALID_VALUE', message: 'seed must be an unsigned 32-bit integer' });
  const expectedHours = request.horizonHours === 720 ? 'schedule.long_horizon.thirty_day_hours' : 'schedule.long_horizon.ninety_day_hours';
  if (value(parameters, expectedHours) !== request.horizonHours) diagnostics.push({ path: expectedHours, code: 'INVALID_VALUE', message: `horizon must match ${request.horizonHours} frozen hours` });
  for (const path of ['schedule.rotation.support_share', 'dungeon.high_tier.supply_window_ratio', 'dungeon.high_tier.boss_encounter_interval_hours']) requireFinitePositive(parameters, path, diagnostics);
  const supportShare = value(parameters, 'schedule.rotation.support_share');
  const supplyShare = value(parameters, 'dungeon.high_tier.supply_window_ratio');
  if (supportShare + supplyShare !== 1) diagnostics.push({ path: 'schedule.rotation.support_share', code: 'INVALID_VALUE', message: 'support and high-tier windows must partition the horizon' });
  const policy = raw(parameters, 'schedule.equipment.support_policy');
  if (policy !== 'qing_90d_then_black') diagnostics.push({ path: 'schedule.equipment.support_policy', code: 'UNSUPPORTED_POLICY', message: 'runtime slice only supports the frozen qing_90d_then_black policy' });
  diagnostics.push(...validateEquipmentExitPolicy(parameters));
  const prefix = `dungeon.high_tier.${request.realm}`;
  for (const [, suffix] of HIGH_TIER_RESOURCES) requireFinitePositive(parameters, `${prefix}.${suffix}`, diagnostics, true);
  for (const suffix of ['boss_pill_budget_per_encounter', 'boss_drop.ancient_scroll.amount', 'boss_drop.demon_core.amount', 'treasure_pity_hours']) requireFinitePositive(parameters, `${prefix}.${suffix}`, diagnostics, true);
  requireProbability(parameters, `${prefix}.boss_drop.equipment.chance`, diagnostics);
  requireProbability(parameters, `${prefix}.treasure_drop_chance`, diagnostics);
  const highTierTreasures = highTierTreasureIds(parameters, prefix);
  if (highTierTreasures.length === 0) diagnostics.push({ path: `${prefix}.treasure_pool_weight`, code: 'MISSING_PARAMETER', message: 'high-tier treasure pool must contain at least one frozen item' });
  for (const treasure of highTierTreasures) requireFinitePositive(parameters, `${prefix}.treasure_pool_weight.${treasure}`, diagnostics, true);
  requirePositiveWeightPool(parameters, highTierTreasures.map((treasure) => `${prefix}.treasure_pool_weight.${treasure}`), diagnostics, `${prefix}.treasure_pool_weight`);
  requireProbability(parameters, `${prefix}.boss_natural_failure_rate`, diagnostics);
  const route: LongTermSupportRoute = request.horizonHours <= 720 ? 'qing_feng' : 'black_wind_valley';
  if (route === 'qing_feng') {
    // The frozen package has no normal equipment drop contract for Qing Feng.
    // Require the complete contract, rather than treating a missing table as
    // zero drops or borrowing Black Wind's parameters.
    const qingEquipmentPaths = [
      'dungeon.qing_feng.equipment_drop_chance',
      ...QUALITY_ORDER.map((quality) => `dungeon.qing_feng.equipment_quality_${quality}_chance`),
    ];
    for (const path of qingEquipmentPaths) requireFrozenProvenance(parameters, path, diagnostics);
    requireProbability(parameters, 'dungeon.qing_feng.equipment_drop_chance', diagnostics);
    requirePositiveWeightPool(parameters, QUALITY_ORDER.map((quality) => `dungeon.qing_feng.equipment_quality_${quality}_chance`), diagnostics, 'dungeon.qing_feng.equipment_quality_chance');
  } else {
    for (const suffix of ['target_kill_time', 'ancient_scroll_pity_kills', 'spirit_stone_per_kill', 'spirit_ore_per_kill', 'spirit_wood_per_kill']) requireFinitePositive(parameters, `map.black_wind_valley.${suffix}`, diagnostics, true);
    requireProbability(parameters, 'map.black_wind_valley.equipment_drop_chance', diagnostics);
    requireProbability(parameters, 'map.black_wind_valley.ancient_scroll_drop_chance', diagnostics);
    requirePositiveWeightPool(parameters, QUALITY_ORDER.map((quality) => `map.black_wind_valley.equipment_quality_${quality}_chance`), diagnostics, 'map.black_wind_valley.equipment_quality_chance');
  }
  if (route === 'qing_feng') requirePositiveWeightPool(parameters, TREASURES.map((treasure) => `dungeon.qing_feng.treasure_pool_weight.${treasure}`), diagnostics, 'dungeon.qing_feng.treasure_pool_weight');
  return diagnostics;
};

export const simulateLongTermEconomy = (request: LongTermEconomyRequest): LongTermEconomyResult => {
  const parameters = request.parameters ?? FROZEN_PARAMETERS;
  const diagnostics = validate(request, parameters);
  if (diagnostics.length > 0) throw new LongTermEconomyError(diagnostics);
  const supportRoute: LongTermSupportRoute = request.horizonHours <= 720 ? 'qing_feng' : 'black_wind_valley';
  const highTierHours = request.horizonHours * value(parameters, 'dungeon.high_tier.supply_window_ratio');
  const supportHours = request.horizonHours * value(parameters, 'schedule.rotation.support_share');
  const highTierPrefix = `dungeon.high_tier.${request.realm}`;
  const random = { value: request.seed >>> 0 };
  const highTierDrops: Partial<Record<ResourceId, number>> = {};
  for (const [resource, suffix] of HIGH_TIER_RESOURCES) add(highTierDrops, resource, value(parameters, `${highTierPrefix}.${suffix}`) * highTierHours);
  const interval = value(parameters, 'dungeon.high_tier.boss_encounter_interval_hours');
  const encounters = Math.floor(request.horizonHours / interval);
  const highTierEquipmentByQuality: Record<string, number> = {};
  const highTierTreasures = highTierTreasureIds(parameters, highTierPrefix);
  const highTierTreasureCopies = Object.fromEntries(highTierTreasures.map((id) => [id, 0]));
  let highTierEquipmentDrops = 0;
  let highTierPillConsumed = 0;
  let highTierPity = 0;
  for (let encounter = 0; encounter < encounters; encounter += 1) {
    const failure = roll(random) < value(parameters, `${highTierPrefix}.boss_natural_failure_rate`) / 100;
    if (failure) continue;
    highTierPillConsumed += value(parameters, `${highTierPrefix}.boss_pill_budget_per_encounter`);
    add(highTierDrops, 'pill', -value(parameters, `${highTierPrefix}.boss_pill_budget_per_encounter`));
    add(highTierDrops, 'ancient_scroll', value(parameters, `${highTierPrefix}.boss_drop.ancient_scroll.amount`));
    add(highTierDrops, 'demon_core', value(parameters, `${highTierPrefix}.boss_drop.demon_core.amount`));
    if (roll(random) < value(parameters, `${highTierPrefix}.boss_drop.equipment.chance`) / 100) {
      const quality = String(raw(parameters, `${highTierPrefix}.boss_drop.equipment.quality`));
      highTierEquipmentByQuality[quality] = (highTierEquipmentByQuality[quality] ?? 0) + 1;
      highTierEquipmentDrops += 1;
    }
    highTierPity += interval;
    if (roll(random) < value(parameters, `${highTierPrefix}.treasure_drop_chance`) / 100 || highTierPity >= value(parameters, `${highTierPrefix}.treasure_pity_hours`)) {
      const poolWeights = highTierTreasures.map((id) => value(parameters, `${highTierPrefix}.treasure_pool_weight.${id}`));
      highTierTreasureCopies[weighted(highTierTreasures, poolWeights, roll(random))] += 1;
      highTierPity = 0;
    }
  }
  const supportDrops: Partial<Record<ResourceId, number>> = {};
  const supportEquipmentByQuality: Record<string, number> = {};
  const supportTreasureCopies = Object.fromEntries(TREASURES.map((id) => [id, 0]));
  let supportEquipmentDrops = 0;
  let supportPillConsumed = 0;
  let techniqueDrops = 0;
  const supportSeconds = supportHours * 3600;
  if (supportRoute === 'black_wind_valley') {
    const prefix = 'map.black_wind_valley';
    const clears = Math.floor(supportSeconds / value(parameters, `${prefix}.target_kill_time`));
    let scrollPity = 0;
    for (let clear = 0; clear < clears; clear += 1) {
      add(supportDrops, 'spirit_stone', value(parameters, `${prefix}.spirit_stone_per_kill`));
      add(supportDrops, 'spirit_ore', value(parameters, `${prefix}.spirit_ore_per_kill`));
      add(supportDrops, 'spirit_wood', value(parameters, `${prefix}.spirit_wood_per_kill`));
      if (roll(random) < value(parameters, `${prefix}.equipment_drop_chance`) / 100) {
        const quality = equipmentQuality(parameters, prefix, roll(random));
        supportEquipmentByQuality[quality] = (supportEquipmentByQuality[quality] ?? 0) + 1;
        supportEquipmentDrops += 1;
      }
      scrollPity += 1;
      if (roll(random) < value(parameters, `${prefix}.ancient_scroll_drop_chance`) / 100 || scrollPity >= value(parameters, `${prefix}.ancient_scroll_pity_kills`)) { add(supportDrops, 'ancient_scroll', 1); scrollPity = 0; }
    }
    const netResources = { ...highTierDrops };
    for (const [resource, amount] of Object.entries(supportDrops) as [ResourceId, number][]) add(netResources, resource, amount);
    return { mode: 'fixed_seed_runtime_slice', horizonHours: request.horizonHours, realm: request.realm, highTierHours, supportHours, supportRoute, highTier: { encounterIntervalHours: interval, encounters, pillConsumed: highTierPillConsumed, resourceDrops: highTierDrops, equipmentDrops: highTierEquipmentDrops, equipmentByQuality: highTierEquipmentByQuality, treasureCopies: highTierTreasureCopies }, support: { clears, pillConsumed: supportPillConsumed, resourceDrops: supportDrops, equipmentDrops: supportEquipmentDrops, equipmentByQuality: supportEquipmentByQuality, treasureCopies: supportTreasureCopies, techniqueDrops }, netResources, diagnostics: [] };
  }
  const dungeonPrefix = 'dungeon.qing_feng';
  const clears = Math.floor(supportSeconds / value(parameters, `${dungeonPrefix}.target_clear_time`));
  let treasurePity = 0;
  for (let clear = 0; clear < clears; clear += 1) {
    supportPillConsumed += value(parameters, `${dungeonPrefix}.pill_cost`);
    add(supportDrops, 'pill', -value(parameters, `${dungeonPrefix}.pill_cost`));
    add(supportDrops, 'demon_core', value(parameters, `${dungeonPrefix}.demon_core_per_clear`));
    if (roll(random) < value(parameters, `${dungeonPrefix}.technique_drop_chance`) / 100) techniqueDrops += 1;
    treasurePity += 1;
    if (roll(random) < value(parameters, `${dungeonPrefix}.treasure_drop_chance`) / 100 || treasurePity >= value(parameters, 'dungeon.pity.treasure_clears')) { supportTreasureCopies[weighted(TREASURES, TREASURES.map((id) => value(parameters, `${dungeonPrefix}.treasure_pool_weight.${id}`)), roll(random))] += 1; treasurePity = 0; }
  }
  const netResources = { ...highTierDrops };
  for (const [resource, amount] of Object.entries(supportDrops) as [ResourceId, number][]) add(netResources, resource, amount);
  return { mode: 'fixed_seed_runtime_slice', horizonHours: request.horizonHours, realm: request.realm, highTierHours, supportHours, supportRoute, highTier: { encounterIntervalHours: interval, encounters, pillConsumed: highTierPillConsumed, resourceDrops: highTierDrops, equipmentDrops: highTierEquipmentDrops, equipmentByQuality: highTierEquipmentByQuality, treasureCopies: highTierTreasureCopies }, support: { clears, pillConsumed: supportPillConsumed, resourceDrops: supportDrops, equipmentDrops: supportEquipmentDrops, equipmentByQuality: supportEquipmentByQuality, treasureCopies: supportTreasureCopies, techniqueDrops }, netResources, diagnostics: [] };
};

const confidenceMetric = (values: number[]): LongTermConfidenceMetric => {
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const variance = values.length > 1 ? values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (values.length - 1) : 0;
  const halfWidth = 2.576 * Math.sqrt(variance / values.length);
  return { mean, lower99: mean - halfWidth, upper99: mean + halfWidth, samples: values.length };
};

/** Run a bounded deterministic sample set against one immutable parameter
 * snapshot. This is read-only and intentionally separate from the single
 * seed runtime result so callers cannot mistake a confidence estimate for a
 * guaranteed drop amount. */
export const simulateLongTermEconomyConfidence = (request: LongTermEconomyRequest & { sampleCount: number }): LongTermEconomyConfidenceResult => {
  if (!Number.isSafeInteger(request.sampleCount) || request.sampleCount < 10 || request.sampleCount > 500) throw new LongTermEconomyError([{ path: 'sampleCount', code: 'INVALID_VALUE', message: 'sampleCount must be an integer between 10 and 500' }]);
  const seedStride = 0x9e3779b9;
  const samples = Array.from({ length: request.sampleCount }, (_, index) => simulateLongTermEconomy({ ...request, seed: (request.seed + Math.imul(index, seedStride)) >>> 0 }));
  const metrics: Record<string, LongTermConfidenceMetric> = {};
  const series = (name: string, values: number[]): void => { metrics[name] = confidenceMetric(values); };
  series('highTier.equipmentDrops', samples.map((sample) => sample.highTier.equipmentDrops));
  series('support.equipmentDrops', samples.map((sample) => sample.support.equipmentDrops));
  series('highTier.treasureCopies', samples.map((sample) => Object.values(sample.highTier.treasureCopies).reduce((sum, value) => sum + value, 0)));
  series('support.treasureCopies', samples.map((sample) => Object.values(sample.support.treasureCopies).reduce((sum, value) => sum + value, 0)));
  for (const resource of HIGH_TIER_RESOURCES.map(([id]) => id)) series(`netResources.${resource}`, samples.map((sample) => sample.netResources[resource] ?? 0));
  return { mode: 'fixed_seed_confidence_slice', horizonHours: request.horizonHours, realm: request.realm, sampleCount: request.sampleCount, seedStride, metrics };
};
