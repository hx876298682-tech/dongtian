/** 详情页展示助手：只读取冻结参数与实例字段做"翻译"，不做任何结算推算。
    最终属性一律以服务端战斗结算为准（见运行时口径）。 */
import { FROZEN_PARAMETERS } from '../../game/frozen-parameters';

const num = (key: string): number => Number(FROZEN_PARAMETERS[key as keyof typeof FROZEN_PARAMETERS]?.value ?? 0);

/** 功法每层成长（冻结原值，未乘品阶倍率） */
export const TECHNIQUE_GROWTH = {
  attackPerLayer: num('growth.technique.attack_per_layer'),
  defencePerLayer: num('growth.technique.defence_per_layer'),
  healthPerLayer: num('growth.technique.health_per_layer'),
  cultivationBonusPerLayer: num('growth.technique.cultivation_rate_bonus_per_layer'),
  maxLayer: num('growth.technique.max_layer'),
};

export const techniqueQualityMultiplier = (quality: string): number =>
  num(`growth.technique.quality_multiplier.${quality}`) || 1;

/** 装备展示常量 */
export const EQUIPMENT_DISPLAY = {
  reinforcementMaxLevel: num('loot.equipment.enhancement.max_level'),
  reinforcementPerLevel: num('loot.equipment.enhancement.stat_multiplier_per_level'),
  slotBudget: (slot: string): number => {
    const category = slot.startsWith('armor') ? 'armor' : slot;
    return num(`loot.equipment.slot_budget.${category}`);
  },
};

export type AffixSlotView =
  | { kind: 'empty' }
  | { kind: 'speed'; value: number }
  | { kind: 'element'; value: string }
  | { kind: 'special'; value: string; target?: string; grade?: number };

export function parseAffixSlots(affixes: Record<string, unknown> | undefined): AffixSlotView[] {
  const slots = Array.isArray(affixes?.slots) ? (affixes.slots as Array<Record<string, unknown>>) : [];
  const view: AffixSlotView[] = [];
  for (let i = 0; i < 3; i += 1) {
    const slot = slots[i];
    if (!slot || typeof slot !== 'object' || slot.kind === 'empty') view.push({ kind: 'empty' });
    else if (slot.kind === 'speed') view.push({ kind: 'speed', value: Number(slot.value ?? 0) });
    else if (slot.kind === 'element') view.push({ kind: 'element', value: String(slot.value ?? '') });
    else view.push({ kind: 'special', value: String(slot.value ?? ''), target: slot.target ? String(slot.target) : undefined, grade: typeof slot.grade === 'number' ? slot.grade : undefined });
  }
  return view;
}

export const SPECIAL_AFFIX_NAMES: Record<string, string> = {
  armor_break: '破甲',
  body_protection: '护体',
  vitality: '生机',
  rejuvenation: '回春',
};

export const SPECIAL_AFFIX_HINTS: Record<string, string> = {
  armor_break: '按品级提升造成的伤害',
  body_protection: '按品级降低受到的伤害',
  vitality: '按品级提升生命上限',
  rejuvenation: '按品级提升丹药治疗效果',
};

/** 资源用途/来源（内容文案占位口径，数值不在此处） */
export const RESOURCE_USAGE: Record<string, { use: string; source: string }> = {
  spirit_stone: { use: '建筑升级、装备强化与突破的硬通货', source: '斩妖挂机与装备出售' },
  spirit_wood: { use: '洞府经营与打造辅料', source: '斩妖挂机产出' },
  spirit_herb: { use: '炼丹原料（如聚气丹）', source: '灵田种植与采药' },
  spirit_ore: { use: '装备打造与强化材料', source: '斩妖挂机与挖矿' },
  pill: { use: '境界突破的必需材料', source: '炼丹房炼制' },
  ancient_scroll: { use: '高阶突破的稀有材料', source: '挂机保底与秘境' },
};

/** 功法每层成长展示文本：展示冻结参数与品阶倍率两个因子，不在前端做结算乘法。 */
export function techniqueGrowthLines(quality: string): string {
  const mult = techniqueQualityMultiplier(quality);
  const g = TECHNIQUE_GROWTH;
  return `每层 攻+${g.attackPerLayer} 防+${g.defencePerLayer} 血+${g.healthPerLayer} · 修炼速率 +${(g.cultivationBonusPerLayer * 100).toFixed(2)}%/层（品阶 ×${mult}）`;
}

export type BreakthroughRequirement = {
  label: string;
  kind: 'cultivation' | 'resource';
  resourceId?: string;
  required: number;
};

/** 下一境界的突破条件（读公开冻结参数；当前值由调用方从 bootstrap 填充）。
    仅覆盖冻结表中已登记的两个转阶；更高境界显示"未冻结"。 */
export function breakthroughRequirements(fromRealm: string): BreakthroughRequirement[] | null {
  const pairs: Record<string, string> = {
    qi_refining: 'qi_to_foundation',
    foundation_establishment: 'foundation_to_core',
  };
  const pair = pairs[fromRealm];
  if (!pair) return null;
  const v = (suffix: string): number => num(`breakthrough.${pair}.${suffix}`);
  return [
    { label: '修为', kind: 'cultivation', required: v('cultivation_cost') },
    { label: '灵石', kind: 'resource', resourceId: 'spirit_stone', required: v('spirit_stone_cost') },
    { label: '丹药', kind: 'resource', resourceId: 'pill', required: v('pill_cost') },
    { label: '古修残卷', kind: 'resource', resourceId: 'ancient_scroll', required: v('scroll_cost') },
  ];
}

export type CostLine = { label: string; amount: number; resourceId?: string };

/** 强化到下一级的消耗预览（公式与服务端 service.ts 829-836 行一一对应）。 */
export function reinforcePreview(reinforcementLevel: number): CostLine[] {
  const stone = Math.ceil(num('loot.equipment.enhancement.spirit_stone_base_cost') * num('loot.equipment.enhancement.spirit_stone_growth') ** reinforcementLevel);
  const ore = Math.ceil(num('loot.equipment.enhancement.spirit_ore_base_cost') * num('loot.equipment.enhancement.material_growth') ** reinforcementLevel);
  const wood = Math.ceil(num('loot.equipment.enhancement.spirit_wood_base_cost') * num('loot.equipment.enhancement.material_growth') ** reinforcementLevel);
  return [
    { label: '灵石', amount: stone, resourceId: 'spirit_stone' },
    { label: '灵矿', amount: ore, resourceId: 'spirit_ore' },
    { label: '灵木', amount: wood, resourceId: 'spirit_wood' },
  ];
}

/** 升品到下一品质的消耗预览（对应 service.ts promote 分支）。 */
export function promotePreview(quality: string): CostLine[] | null {
  const order = ['normal', 'fine', 'rare', 'epic', 'legendary', 'immortal'];
  const i = order.indexOf(quality);
  if (i < 0 || i >= order.length - 1) return null;
  const pair = `${order[i]}_to_${order[i + 1]}`;
  return [
    { label: '灵石', amount: num(`loot.equipment.promotion.${pair}.spirit_stone_cost`), resourceId: 'spirit_stone' },
    { label: '千年灵药', amount: num(`loot.equipment.promotion.${pair}.millennium_herb_cost`), resourceId: 'millennium_herb' },
    { label: '天外陨铁', amount: num(`loot.equipment.promotion.${pair}.meteor_iron_cost`), resourceId: 'meteor_iron' },
  ];
}

export const EQUIPMENT_GROWTH_LIMITS = {
  reinforcementMaxLevel: num('loot.equipment.enhancement.max_level'),
  awakeningMaxLevel: num('loot.equipment.awakening.max_level'),
  awakeningPerLevel: {
    stoneBase: num('loot.equipment.awakening.spirit_stone_base_cost'),
    stoneGrowth: num('loot.equipment.awakening.spirit_stone_growth'),
    demonCore: num('loot.equipment.awakening.demon_core_per_level'),
    meteorIron: num('loot.equipment.awakening.meteor_iron_per_level'),
  },
  awakeningStatPerLevel: num('loot.equipment.awakening.stat_multiplier_per_level'),
};

/** 觉醒到下一级的消耗预览（对应 service.ts awaken 分支）。 */
export function awakenPreview(awakeningLevel: number): CostLine[] {
  const c = EQUIPMENT_GROWTH_LIMITS.awakeningPerLevel;
  const stone = Math.ceil(c.stoneBase * c.stoneGrowth ** awakeningLevel);
  return [
    { label: '灵石', amount: stone, resourceId: 'spirit_stone' },
    { label: '妖丹', amount: c.demonCore, resourceId: 'demon_core' },
    { label: '天外陨铁', amount: c.meteorIron, resourceId: 'meteor_iron' },
  ];
}
