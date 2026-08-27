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
