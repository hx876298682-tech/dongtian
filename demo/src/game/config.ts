import type { Equipment, Realm, Resources } from './types.ts';
import { FROZEN_PARAMETERS } from './frozen-parameters.ts';

export type RealmConfig = {
  id: Realm;
  label: string;
  cultivationMax: number;
  power: number;
};

export type MapConfig = {
  id: string;
  parameterId: string;
  name: string;
  subtitle: string;
  danger: string;
  requiredPower: number;
  reward: string;
  durationLabel: string;
  cooldownSeconds: number;
  css: string;
  glyph: string;
  rewardResources: Resources;
  equipmentDropChancePercent: number;
  scrollDropChancePercent: number;
  scrollPityKills: number;
  qualityWeights: Record<Equipment['rarity'], number>;
  rewardEquipment?: Equipment;
};

const qualityWeights = (prefix: 'bai_cao_valley' | 'black_wind_valley' | 'red_flame_cave'): Record<Equipment['rarity'], number> => ({
  普通: Number(FROZEN_PARAMETERS[`map.${prefix}.equipment_quality_normal_chance`].value),
  精良: Number(FROZEN_PARAMETERS[`map.${prefix}.equipment_quality_fine_chance`].value),
  稀有: Number(FROZEN_PARAMETERS[`map.${prefix}.equipment_quality_rare_chance`].value),
  史诗: Number(FROZEN_PARAMETERS[`map.${prefix}.equipment_quality_epic_chance`].value),
  传说: Number(FROZEN_PARAMETERS[`map.${prefix}.equipment_quality_legendary_chance`].value),
  仙器: Number(FROZEN_PARAMETERS[`map.${prefix}.equipment_quality_immortal_chance`].value),
});

export const INVENTORY_CAPS = {
  stones: Number(FROZEN_PARAMETERS['economy.inventory.cap.spirit_stone'].value),
  wood: Number(FROZEN_PARAMETERS['economy.inventory.cap.spirit_wood'].value),
  herbs: Number(FROZEN_PARAMETERS['economy.inventory.cap.spirit_herb'].value),
  ore: Number(FROZEN_PARAMETERS['economy.inventory.cap.spirit_ore'].value),
  pills: Number(FROZEN_PARAMETERS['economy.inventory.cap.pill'].value),
  scrolls: Number(FROZEN_PARAMETERS['economy.inventory.cap.ancient_scroll'].value),
} satisfies Resources;

export const EQUIPMENT_CAP = Number(FROZEN_PARAMETERS['economy.inventory.cap.equipment'].value);

export const REALMS: Record<Realm, RealmConfig> = {
  qi_refining: { id: 'qi_refining', label: '炼气圆满', cultivationMax: Number(FROZEN_PARAMETERS['growth.cultivation.qi_target_xp'].value), power: Number(FROZEN_PARAMETERS['map.bai_cao_valley.enemy_effective_hp'].value) },
  foundation_establishment: { id: 'foundation_establishment', label: '筑基初期', cultivationMax: Number(FROZEN_PARAMETERS['growth.cultivation.foundation_target_xp'].value), power: Number(FROZEN_PARAMETERS['map.red_flame_cave.enemy_effective_hp'].value) },
};

export const TRAINING_CONFIG = {
  id: 'activity.training.black_wind',
  parameterId: 'activity.black_wind.training_income_v1',
  cultivation: Number(FROZEN_PARAMETERS['building.training_room.base_cultivation_xp'].value),
  intervalSeconds: Number(FROZEN_PARAMETERS['building.training_room.base_interval'].value),
  carryActions: Math.floor(Number(FROZEN_PARAMETERS['offline.settlement.max_hours'].value) * 3600 / Number(FROZEN_PARAMETERS['building.training_room.base_interval'].value)),
  floorSeconds: Number(FROZEN_PARAMETERS['offline.settlement.batch_interval'].value),
  resources: { stones: 0, wood: 0, herbs: 0, ore: 0, pills: 0, scrolls: 0 } satisfies Resources,
};

export const MAP_CONFIG: MapConfig[] = [
  {
    id: 'herb', parameterId: 'map.bai_cao_valley.v1', name: '百草谷', subtitle: '灵草丰茂，妖兽温顺', danger: '低危', requiredPower: Number(FROZEN_PARAMETERS['map.bai_cao_valley.enemy_effective_hp'].value),
    reward: '灵草 · 灵石 · 古修残卷', durationLabel: `约 ${FROZEN_PARAMETERS['map.bai_cao_valley.target_kill_time'].value} 秒`, cooldownSeconds: Number(FROZEN_PARAMETERS['combat.recovery.failure_cooldown'].value), css: 'forest', glyph: '草',
    rewardResources: { stones: Number(FROZEN_PARAMETERS['map.bai_cao_valley.spirit_stone_per_kill'].value), wood: Number(FROZEN_PARAMETERS['map.bai_cao_valley.spirit_wood_per_kill'].value), herbs: 0, ore: Number(FROZEN_PARAMETERS['map.bai_cao_valley.spirit_ore_per_kill'].value), pills: 0, scrolls: 0 },
    equipmentDropChancePercent: Number(FROZEN_PARAMETERS['map.bai_cao_valley.equipment_drop_chance'].value), scrollDropChancePercent: Number(FROZEN_PARAMETERS['map.bai_cao_valley.ancient_scroll_drop_chance'].value), scrollPityKills: Number(FROZEN_PARAMETERS['map.bai_cao_valley.ancient_scroll_pity_kills'].value), qualityWeights: qualityWeights('bai_cao_valley'),
    rewardEquipment: { id: 'equipment.vine_ring', name: '青藤环', type: '饰品', rarity: '普通', glyph: '藤', bonus: '灵气 +12 · 采集 +3%', power: 54 },
  },
  {
    id: 'wind', parameterId: 'map.black_wind_valley.v1', name: '黑风谷', subtitle: '风煞盘踞，妖狼成群', danger: '中危', requiredPower: Number(FROZEN_PARAMETERS['map.black_wind_valley.enemy_effective_hp'].value),
    reward: '灵石 · 玄铁矿 · 装备', durationLabel: `约 ${FROZEN_PARAMETERS['map.black_wind_valley.target_kill_time'].value} 秒`, cooldownSeconds: Number(FROZEN_PARAMETERS['combat.recovery.failure_cooldown'].value), css: 'wind', glyph: '风',
    rewardResources: { stones: Number(FROZEN_PARAMETERS['map.black_wind_valley.spirit_stone_per_kill'].value), wood: Number(FROZEN_PARAMETERS['map.black_wind_valley.spirit_wood_per_kill'].value), herbs: 0, ore: Number(FROZEN_PARAMETERS['map.black_wind_valley.spirit_ore_per_kill'].value), pills: 0, scrolls: 0 },
    equipmentDropChancePercent: Number(FROZEN_PARAMETERS['map.black_wind_valley.equipment_drop_chance'].value), scrollDropChancePercent: Number(FROZEN_PARAMETERS['map.black_wind_valley.ancient_scroll_drop_chance'].value), scrollPityKills: Number(FROZEN_PARAMETERS['map.black_wind_valley.ancient_scroll_pity_kills'].value), qualityWeights: qualityWeights('black_wind_valley'),
    rewardEquipment: { id: 'equipment.cloud_blade', name: '流云刃', type: '武器', rarity: '精良', glyph: '刃', bonus: '攻击 +35 · 速度 +4%', power: 104 },
  },
  {
    id: 'flame', parameterId: 'map.red_flame_cave.v1', name: '赤炎洞', subtitle: '地火翻涌，需筑基修为', danger: '高危', requiredPower: Number(FROZEN_PARAMETERS['map.red_flame_cave.enemy_effective_hp'].value),
    reward: '赤炎晶 · 稀有装备 · 残卷', durationLabel: `约 ${FROZEN_PARAMETERS['map.red_flame_cave.target_kill_time'].value} 秒`, cooldownSeconds: Number(FROZEN_PARAMETERS['combat.recovery.failure_cooldown'].value), css: 'flame', glyph: '炎',
    rewardResources: { stones: Number(FROZEN_PARAMETERS['map.red_flame_cave.spirit_stone_per_kill'].value), wood: Number(FROZEN_PARAMETERS['map.red_flame_cave.spirit_wood_per_kill'].value), herbs: 0, ore: Number(FROZEN_PARAMETERS['map.red_flame_cave.spirit_ore_per_kill'].value), pills: 0, scrolls: 0 },
    equipmentDropChancePercent: Number(FROZEN_PARAMETERS['map.red_flame_cave.equipment_drop_chance'].value), scrollDropChancePercent: Number(FROZEN_PARAMETERS['map.red_flame_cave.ancient_scroll_drop_chance'].value), scrollPityKills: Number(FROZEN_PARAMETERS['map.red_flame_cave.ancient_scroll_pity_kills'].value), qualityWeights: qualityWeights('red_flame_cave'),
    rewardEquipment: { id: 'equipment.flame_bracelet', name: '赤炎环', type: '饰品', rarity: '稀有', glyph: '炎', bonus: '攻击 +72 · 火抗 +8%', power: 168 },
  },
];

export const INITIAL_RESOURCES: Resources = { stones: 5620, wood: 32, herbs: 128, ore: 46, pills: 6, scrolls: 0 };
export const INITIAL_EQUIPMENT: Equipment[] = [
  { id: 'equipment.iron_saber', name: '玄铁剑', type: '武器', rarity: '精良', glyph: '剑', bonus: '攻击 +48 · 暴击 +3%', power: 128 },
  { id: 'equipment.cloud_robe', name: '云纹法袍', type: '防具', rarity: '稀有', glyph: '袍', bonus: '生命 +160 · 防御 +26', power: 96 },
  { id: 'equipment.jade_pendant', name: '青玉佩', type: '饰品', rarity: '普通', glyph: '玉', bonus: '修为获取 +5%', power: 42 },
];

export const BREAKTHROUGH_CONFIG = {
  id: 'breakthrough.qi_to_foundation.v1',
  from: 'qi_refining' as Realm,
  to: 'foundation_establishment' as Realm,
  cultivation: Number(FROZEN_PARAMETERS['breakthrough.qi_to_foundation.cultivation_cost'].value),
  resources: { stones: Number(FROZEN_PARAMETERS['breakthrough.qi_to_foundation.spirit_stone_cost'].value), wood: 0, herbs: 0, ore: 0, pills: Number(FROZEN_PARAMETERS['breakthrough.qi_to_foundation.pill_cost'].value), scrolls: Number(FROZEN_PARAMETERS['breakthrough.qi_to_foundation.scroll_cost'].value) } satisfies Resources,
};
