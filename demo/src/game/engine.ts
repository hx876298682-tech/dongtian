import { BREAKTHROUGH_CONFIG, EQUIPMENT_CAP, INITIAL_EQUIPMENT, INITIAL_RESOURCES, INVENTORY_CAPS, MAP_CONFIG, REALMS, TRAINING_CONFIG } from './config.ts';
import type { ActivityStatus, BreakthroughCheck, EngineResult, GameState, Resources, SettlementSummary } from './types.ts';

const zeroResources = (): Resources => ({ stones: 0, wood: 0, herbs: 0, ore: 0, pills: 0, scrolls: 0 });
const MAX_RESOURCE = Number.MAX_SAFE_INTEGER;
const safeAdd = (left: number, right: number) => left >= MAX_RESOURCE - right ? MAX_RESOURCE : Math.max(0, left + right);
const addResources = (left: Resources, right: Resources): Resources => ({
  stones: Math.min(INVENTORY_CAPS.stones, safeAdd(left.stones, right.stones)), wood: Math.min(INVENTORY_CAPS.wood, safeAdd(left.wood, right.wood)),
  herbs: Math.min(INVENTORY_CAPS.herbs, safeAdd(left.herbs, right.herbs)), ore: Math.min(INVENTORY_CAPS.ore, safeAdd(left.ore, right.ore)),
  pills: Math.min(INVENTORY_CAPS.pills, safeAdd(left.pills, right.pills)), scrolls: Math.min(INVENTORY_CAPS.scrolls, safeAdd(left.scrolls, right.scrolls)),
});
const subtractResources = (left: Resources, right: Resources): Resources => ({
  stones: left.stones - right.stones, wood: left.wood - right.wood, herbs: left.herbs - right.herbs,
  ore: left.ore - right.ore, pills: left.pills - right.pills, scrolls: left.scrolls - right.scrolls,
});
const resourceDelta = (before: Resources, after: Resources): Resources => ({
  stones: after.stones - before.stones, wood: after.wood - before.wood, herbs: after.herbs - before.herbs,
  ore: after.ore - before.ore, pills: after.pills - before.pills, scrolls: after.scrolls - before.scrolls,
});
const resourceOverflow = (requested: Resources, applied: Resources): Resources => ({
  stones: Math.max(0, requested.stones - applied.stones), wood: Math.max(0, requested.wood - applied.wood), herbs: Math.max(0, requested.herbs - applied.herbs),
  ore: Math.max(0, requested.ore - applied.ore), pills: Math.max(0, requested.pills - applied.pills), scrolls: Math.max(0, requested.scrolls - applied.scrolls),
});
const summary = (ok: boolean, kind: SettlementSummary['kind'], message: string, status: ActivityStatus, resourceDelta = zeroResources(), equipmentIds: string[] = [], overflowResources = zeroResources()): SettlementSummary => ({ ok, kind, message, activityStatus: status, resourceDelta, overflowResources, equipmentIds });
const resourceText = (resources: Resources) => Object.entries({ 灵石: resources.stones, 灵木: resources.wood, 灵草: resources.herbs, 玄铁矿: resources.ore, 聚气丹: resources.pills, 古修残卷: resources.scrolls }).filter(([, value]) => value !== 0).map(([label, value]) => `${label} ${value > 0 ? '+' : ''}${value}`).join('、') || '无资源变化';
const changed = (state: GameState, patch: Partial<GameState>): GameState => ({ ...state, ...patch, revision: state.revision + 1 });
const rejected = (state: GameState, message: string, kind: SettlementSummary['kind'] = 'rejected'): EngineResult => ({ state, summary: summary(false, kind, message, state.activity.status) });

export function createInitialState(): GameState {
  return {
    revision: 0, cultivation: 9800, realm: 'qi_refining', power: REALMS.qi_refining.power,
    resources: { ...INITIAL_RESOURCES }, activity: { id: TRAINING_CONFIG.id, action: 'training', status: 'idle', claimable: true, cooldownRemaining: 0, carrySeconds: 0 },
    equipment: INITIAL_EQUIPMENT.map((item) => ({ ...item })),
    mapPityKills: {},
  };
}

export function productionActions(elapsedSeconds: number): number {
  if (!Number.isFinite(elapsedSeconds) || elapsedSeconds <= 0) return 0;
  return Math.min(TRAINING_CONFIG.carryActions, Math.floor(Math.floor(elapsedSeconds) / TRAINING_CONFIG.intervalSeconds));
}

export function claimTraining(state: GameState, elapsedSeconds = TRAINING_CONFIG.intervalSeconds): EngineResult {
  if (!state.activity.claimable || state.activity.action !== 'training') return rejected(state, '今日这轮挂机收益已经领取，不能重复领取');
  const carrySeconds = Number.isFinite(state.activity.carrySeconds) ? Math.max(0, state.activity.carrySeconds) : 0;
  const availableSeconds = Math.min(TRAINING_CONFIG.carryActions * TRAINING_CONFIG.intervalSeconds, carrySeconds + Math.max(0, Math.floor(elapsedSeconds)));
  const actions = Math.floor(availableSeconds / TRAINING_CONFIG.intervalSeconds);
  if (actions < 1) return rejected(state, `还未达到练功房结算间隔 ${TRAINING_CONFIG.floorSeconds} 秒`);
  const cultivationGain = TRAINING_CONFIG.cultivation * actions;
  const resources = addResources(state.resources, TRAINING_CONFIG.resources);
  const nextCarrySeconds = availableSeconds - actions * TRAINING_CONFIG.intervalSeconds;
  const max = REALMS[state.realm].cultivationMax;
  const next = changed(state, { cultivation: Math.min(max, state.cultivation + cultivationGain), resources, activity: { ...state.activity, claimable: nextCarrySeconds > 0, carrySeconds: nextCarrySeconds } });
  const appliedDelta = resourceDelta(state.resources, resources);
  return { state: next, summary: summary(true, 'claim_training', `收益已入库：修为 +${cultivationGain}、${resourceText(appliedDelta)}`, next.activity.status, appliedDelta, [], resourceOverflow(TRAINING_CONFIG.resources, appliedDelta)) };
}

export function startExpedition(state: GameState, mapId: string, seed = state.revision + 1): EngineResult {
  const map = MAP_CONFIG.find((item) => item.id === mapId);
  if (!map) return rejected(state, '未找到该地图');
  if (state.activity.status === 'fighting') return rejected(state, '当前已有战斗进行中');
  if (state.activity.status === 'cooldown' && state.activity.cooldownRemaining > 0) return rejected(state, `刚完成历练，请等待 ${state.activity.cooldownRemaining} 秒恢复灵力`, 'cooldown');
  if (state.power < map.requiredPower) return rejected(state, `当前战力 ${state.power}，还需 ${map.requiredPower - state.power} 才能进入${map.name}`);
  if (!Number.isInteger(seed) || seed < 0) return rejected(state, '出征 seed 必须是非负整数');
  const activity = { id: `activity.expedition.${map.id}`, action: 'expedition' as const, status: 'fighting' as const, mapId: map.id, claimable: false, cooldownRemaining: 0, carrySeconds: 0, seed };
  const next = changed(state, { activity });
  return { state: next, summary: summary(true, 'expedition_start', `${map.name} 已出征，战斗进行中……`, 'fighting') };
}

export function settleExpedition(state: GameState): EngineResult {
  if (state.activity.status !== 'fighting' || !state.activity.mapId) return rejected(state, '当前没有可结算的战斗');
  const map = MAP_CONFIG.find((item) => item.id === state.activity.mapId);
  if (!map) return rejected(state, '战斗地图不存在');
  const rng = seededRandom(state.activity.seed ?? state.revision);
  const pityBefore = state.mapPityKills[map.id] ?? 0;
  const pityAfter = pityBefore + 1;
  const scrollDropped = rng() * 100 < map.scrollDropChancePercent || pityAfter >= map.scrollPityKills;
  const equipmentDropped = rng() * 100 < map.equipmentDropChancePercent;
  const quality = equipmentDropped ? rollQuality(map.qualityWeights, rng()) : null;
  const dropEquipment = equipmentDropped && map.rewardEquipment && quality ? { ...map.rewardEquipment, id: `${map.rewardEquipment.id}.${state.revision}.${state.activity.seed ?? 0}`, rarity: quality } : null;
  const rewardResources = { ...map.rewardResources, scrolls: scrollDropped ? map.rewardResources.scrolls + 1 : map.rewardResources.scrolls };
  const equipment = dropEquipment && state.equipment.length < EQUIPMENT_CAP ? [...state.equipment, dropEquipment] : state.equipment;
  const activity = { ...state.activity, status: 'cooldown' as const, cooldownRemaining: map.cooldownSeconds, claimable: false };
  const mapPityKills = { ...state.mapPityKills, [map.id]: scrollDropped ? 0 : pityAfter };
  const acceptedEquipment = dropEquipment && state.equipment.length < EQUIPMENT_CAP ? dropEquipment : null;
  const nextResources = addResources(state.resources, rewardResources);
  const next = changed(state, { resources: nextResources, equipment, activity, mapPityKills });
  const rewardText = `${resourceText(rewardResources)}${acceptedEquipment ? `、装备「${acceptedEquipment.name}」(${acceptedEquipment.rarity})` : ''}`;
  const appliedDelta = resourceDelta(state.resources, nextResources);
  return { state: next, summary: summary(true, 'expedition_settle', `历练成功：${rewardText}`, 'cooldown', appliedDelta, acceptedEquipment ? [acceptedEquipment.id] : [], resourceOverflow(rewardResources, appliedDelta)) };
}

export function tickCooldown(state: GameState, seconds = 1): GameState {
  if (state.activity.status !== 'cooldown' || state.activity.cooldownRemaining <= 0 || seconds <= 0) return state;
  const remaining = Math.max(0, state.activity.cooldownRemaining - seconds);
  const activity = remaining === 0 ? { id: TRAINING_CONFIG.id, action: 'training' as const, status: 'idle' as const, claimable: false, cooldownRemaining: 0, carrySeconds: 0 } : { ...state.activity, cooldownRemaining: remaining };
  return changed(state, { activity });
}

export function canBreakthrough(state: GameState): BreakthroughCheck {
  const missing: string[] = [];
  if (state.realm !== BREAKTHROUGH_CONFIG.from) missing.push('当前境界不是炼气圆满');
  if (state.cultivation < BREAKTHROUGH_CONFIG.cultivation) missing.push(`修为还差 ${BREAKTHROUGH_CONFIG.cultivation - state.cultivation}`);
  if (state.resources.stones < BREAKTHROUGH_CONFIG.resources.stones) missing.push(`灵石还差 ${BREAKTHROUGH_CONFIG.resources.stones - state.resources.stones}`);
  if (state.resources.herbs < BREAKTHROUGH_CONFIG.resources.herbs) missing.push(`灵草还差 ${BREAKTHROUGH_CONFIG.resources.herbs - state.resources.herbs}`);
  if (state.resources.pills < BREAKTHROUGH_CONFIG.resources.pills) missing.push(`聚气丹还差 ${BREAKTHROUGH_CONFIG.resources.pills - state.resources.pills}`);
  if (state.resources.scrolls < BREAKTHROUGH_CONFIG.resources.scrolls) missing.push(`古修残卷还差 ${BREAKTHROUGH_CONFIG.resources.scrolls - state.resources.scrolls}`);
  return { ok: missing.length === 0, missing };
}

export function breakthrough(state: GameState): EngineResult {
  const check = canBreakthrough(state);
  if (!check.ok) return rejected(state, `突破条件尚未满足：${check.missing.join('、')}`);
  const next = changed(state, { realm: BREAKTHROUGH_CONFIG.to, power: REALMS[BREAKTHROUGH_CONFIG.to].power, cultivation: 0, resources: subtractResources(state.resources, BREAKTHROUGH_CONFIG.resources) });
  return { state: next, summary: summary(true, 'breakthrough', '突破成功：炼气圆满 → 筑基初期，新的灵脉已开启', next.activity.status, { stones: -BREAKTHROUGH_CONFIG.resources.stones, wood: -BREAKTHROUGH_CONFIG.resources.wood, herbs: -BREAKTHROUGH_CONFIG.resources.herbs, ore: 0, pills: -BREAKTHROUGH_CONFIG.resources.pills, scrolls: -BREAKTHROUGH_CONFIG.resources.scrolls }) };
}

function seededRandom(seed: number): () => number {
  let value = seed >>> 0;
  return () => {
    value = (value + 0x6d2b79f5) | 0;
    let t = Math.imul(value ^ (value >>> 15), 1 | value);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function rollQuality(weights: Record<string, number>, roll: number): string {
  let cursor = roll * Object.values(weights).reduce((sum, weight) => sum + weight, 0);
  for (const [quality, weight] of Object.entries(weights)) {
    cursor -= weight;
    if (cursor < 0) return quality;
  }
  return Object.keys(weights).at(-1) ?? '普通';
}
