/** UI 展示元数据：纯表现层文案与配色映射，不含任何玩法数值。
    数值一律来自服务端 bootstrap/catalog/preview；此处只决定“怎么画”。 */

export type ResourceId = 'spirit_stone' | 'spirit_herb' | 'spirit_ore' | 'spirit_wood' | 'pill' | 'ancient_scroll' | 'millennium_herb' | 'meteor_iron' | 'demon_core';

export const RESOURCE_META: Record<ResourceId, { name: string; short: string }> = {
  spirit_stone: { name: '灵石', short: '石' },
  spirit_wood: { name: '灵木', short: '木' },
  spirit_herb: { name: '灵草', short: '草' },
  spirit_ore: { name: '灵矿', short: '矿' },
  pill: { name: '丹药', short: '丹' },
  ancient_scroll: { name: '古修残卷', short: '卷' },
  millennium_herb: { name: '千年灵药', short: '药' },
  meteor_iron: { name: '天外陨铁', short: '铁' },
  demon_core: { name: '妖丹', short: '妖' },
};

export const RESOURCE_ORDER: ResourceId[] = ['spirit_stone', 'spirit_wood', 'spirit_herb', 'spirit_ore', 'pill', 'ancient_scroll', 'millennium_herb', 'meteor_iron', 'demon_core'];

export type QualityId = 'normal' | 'fine' | 'rare' | 'epic' | 'legendary' | 'immortal';

/** 装备六档（normal…immortal）与功法六阶（mortal/yellow/xuan/earth/heaven/immortal）
    的并集译表；颜色档位按同为“最低→最高”对齐。 */
export const QUALITY_META: Record<string, { label: string; cls: string }> = {
  normal: { label: '普通', cls: 'q-normal' },
  fine: { label: '精良', cls: 'q-fine' },
  rare: { label: '稀有', cls: 'q-rare' },
  epic: { label: '史诗', cls: 'q-epic' },
  legendary: { label: '传说', cls: 'q-legendary' },
  immortal: { label: '仙器', cls: 'q-immortal' },
  // 功法品阶
  mortal: { label: '凡阶', cls: 'q-normal' },
  yellow: { label: '黄阶', cls: 'q-fine' },
  xuan: { label: '玄阶', cls: 'q-rare' },
  earth: { label: '地阶', cls: 'q-epic' },
  heaven: { label: '天阶', cls: 'q-legendary' },
};

export const qualityMeta = (id: string) => QUALITY_META[id as QualityId] ?? { label: id, cls: 'q-normal' };

/** 境界大阶梯与服务端 realmRank 对齐（顺序即 rank）。 */
export const REALM_LADDER: Array<{ id: string; label: string }> = [
  { id: 'qi_refining', label: '炼气' },
  { id: 'foundation_establishment', label: '筑基' },
  { id: 'core_formation', label: '金丹' },
  { id: 'nascent_soul', label: '元婴' },
  { id: 'divine_transformation', label: '化神' },
  { id: 'void_refining', label: '炼虚' },
  { id: 'body_unity', label: '合体' },
  { id: 'great_vehicle', label: '大乘' },
  { id: 'tribulation', label: '渡劫' },
];

export const realmRank = (id: string): number => REALM_LADDER.findIndex((r) => r.id === id);
export const realmLabel = (id: string): string => REALM_LADDER.find((r) => r.id === id)?.label ?? id;

/** 小境界描述：V1 服务端只返回大境界，展示为大境界+修行中。 */
export const ELEMENT_META: Record<string, { label: string; cls: string }> = {
  metal: { label: '金', cls: 'wx-metal' },
  wood: { label: '木', cls: 'wx-wood' },
  water: { label: '水', cls: 'wx-water' },
  fire: { label: '火', cls: 'wx-fire' },
  earth: { label: '土', cls: 'wx-earth' },
};
export const elementMeta = (key: string) => ELEMENT_META[key.toLowerCase()] ?? { label: key.slice(0, 1), cls: 'wx-metal' };

/* —— 地图表现层文案（编辑性内容，非数值）—— */
export const MAP_PRESENTATION: Record<string, { sceneCls: string; glyph: string; danger: string; flavor: string }> = {
  bai_cao_valley: { sceneCls: 'scene-baicao', glyph: '草', danger: '低危', flavor: '灵草丰茂，清泉流淌，偶有温顺妖兽出没。' },
  black_wind_valley: { sceneCls: 'scene-heifeng', glyph: '风', danger: '中危', flavor: '狂风呼啸，妖狼成群，是淬炼身手的去处。' },
  red_flame_cave: { sceneCls: 'scene-chiyan', glyph: '炎', danger: '高危', flavor: '地火翻涌，煞气极盛，非筑基不可轻入。' },
};
export const mapPresentation = (id: string) =>
  MAP_PRESENTATION[id] ?? { sceneCls: 'scene-baicao', glyph: '境', danger: '未知', flavor: '此地名声未传，谨慎探索。' };

/* —— 秘境（服务端 dungeonIds 对齐）—— */
export const DUNGEONS: Array<{ id: string; name: string; unlockRealmId: string; flavor: string }> = [
  { id: 'qing_feng', name: '清风秘境', unlockRealmId: 'foundation_establishment', flavor: '剑冢遗音，高收益的探索之地。' },
  { id: 'yan_prison', name: '炎狱秘境', unlockRealmId: 'core_formation', flavor: '地火炼狱，凶险与机缘并存。' },
  { id: 'sky_abyss', name: '天渊秘境', unlockRealmId: 'nascent_soul', flavor: '深渊之上，古修遗迹沉眠。' },
];

/* —— 功法展示名（表现层译名表，缺省时回退到 id 美化）—— */
const TECHNIQUE_NAMES: Record<string, string> = {
  qing_mu_chang_sheng: '青木长生诀',
  bai_shou_guard: '百寿守元功',
  jin_gang_body: '金刚锻体诀',
  lie_yang_script: '烈阳真解',
  xuan_shui_manual: '玄水真经',
  hou_tu_earth: '厚土镇元诀',
  qing_lian_sword: '青莲剑诀',
  tian_yan_blade: '天衍刀典',
  tai_yi_method: '太乙玄功',
  wu_xing_cycle: '五行轮转诀',
  hong_meng_void: '鸿蒙虚典',
  yin_yang_book: '阴阳造化书',
};

export const techniqueName = (rawId: string): string => {
  const suffix = rawId.split('.').pop() ?? rawId;
  return TECHNIQUE_NAMES[suffix] ?? suffix.replaceAll('_', '');
};

/** 行动的中文表达（占位类型一致映射） */
export type ActionKind = 'training' | 'technique_training' | 'alchemy' | 'forge' | 'expedition' | 'herbalism' | 'mining';

export const ACTION_VERB: Record<ActionKind, string> = {
  training: '闭关修炼',
  technique_training: '功法修炼',
  alchemy: '开炉炼丹',
  forge: '引火锻器',
  expedition: '仗剑除妖',
  herbalism: '深山采药',
  mining: '灵脉开采',
};

/* —— 灵田作物（plantId 为服务端认可的内容标识；成长时长由建筑等级参数统一决定）—— */
export const FARM_PLANTS: Array<{ id: string; name: string }> = [
  { id: 'plant.purple_cloud_flower', name: '紫云花' },
  { id: 'plant.dew_grass', name: '凝露草' },
];
export const plantName = (id: string) => FARM_PLANTS.find((p) => p.id === id)?.name ?? id;

export const SLOT_LABELS: Array<{ slot: string; label: string }> = [
  { slot: 'weapon', label: '主手兵刃' },
  { slot: 'armor_1', label: '护甲·首' },
  { slot: 'armor_2', label: '护甲·身' },
  { slot: 'armor_3', label: '护甲·肢' },
  { slot: 'armor_4', label: '护甲·足' },
  { slot: 'accessory', label: '饰品' },
];
export const slotLabel = (slot: string) => SLOT_LABELS.find((s) => s.slot === slot)?.label ?? slot;

/** 错误码 → 玩家话术（对齐服务端 ApiError 全集） */
export function errorText(code: string | undefined, fallback?: string): string {
  switch (code) {
    case 'STALE_REVISION': return '洞天状态已在别处更新，已为你重新同步';
    case 'CONTENT_LOCKED': return '此道尚未开启';
    case 'RESOURCE_INSUFFICIENT':
    case 'PILL_INSUFFICIENT': return '造化未足：材料或资源尚有缺口';
    case 'INVENTORY_FULL': return '行囊已满，先处理库存再来';
    case 'COOLDOWN_ACTIVE': return '心神未复，失败冷却尚未结束';
    case 'DUPLICATE_REQUEST': return '该请求已受理';
    case 'TIME_RANGE_INVALID': return '时间区间无效，本次未结算';
    case 'GATE_BLOCKED': return '门槛不足，暂无法进入';
    case 'CONFIG_VERSION_MISMATCH': return '洞天规则已更新，请刷新后再试';
    case 'NOT_FOUND': return '目标不存在或已离开此地';
    default: return fallback ?? '服务响应异常，稍候再试';
  }
}
