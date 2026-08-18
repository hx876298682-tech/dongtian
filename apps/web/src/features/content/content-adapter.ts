import type {
  ActionCatalogEntry,
  ContentItemQuantity,
  ContentRoute,
  InventoryAsset,
  Queue,
  RecipeCatalogEntry,
} from '@dongtian/contracts';

const numberFormat = new Intl.NumberFormat('zh-CN');

const ID_LABELS: Readonly<Record<string, string>> = {
  'skill.alchemy': '炼丹',
  'skill.cultivation': '修炼',
  'skill.herbalism': '采药',
  'skill.mining': '挖矿',
  'skill.smithing': '炼器',
  'skill.forging': '锻造',
  'skill.tempering': '淬炼',
  'skill.weapon_mastery.sword': '练剑',
  'skill.weapon_mastery.blade': '练刀',
  'skill.weapon_mastery.spear': '练枪',
  'skill.weapon_mastery.staff': '练杖',
  'skill.tool': '制器',
  'action.cultivation.qi': '修炼灵气',
  'action.weapon_mastery.sword': '练剑',
  'action.weapon_mastery.blade': '练刀',
  'action.weapon_mastery.spear': '练枪',
  'action.weapon_mastery.staff': '练杖',
  'action.t1.herb_baicao_valley': '采药',
  'action.t1.herb_wuyin_slope': '雾隐坡采药',
  'action.t1.qi_gathering_powder': '炼制聚气散',
  'action.t1.qi_gathering_pill': '炼制聚气丹',
  'action.t1.recovery_pill': '炼制回春丹',
  'action.t1.ore_chitong_kuang': '赤铜矿采矿',
  'action.t1.ore_xuantie_kuang': '玄铁矿采矿',
  'action.t1.ore_xingwen_gang': '星纹钢采矿',
  'action.t1.ore_lingyu_kuang': '灵玉矿采矿',
  'action.t1.mubing_yaochu': '制作木柄药锄',
  'action.t1.qingtong_yaochu': '制作青铜药锄',
  'action.t1.xuantie_yaochu': '制作玄铁药锄',
  'action.t1.lingyu_yaochu': '制作灵玉药锄',
  'action.t1.mubing_kuanggao': '制作木柄矿镐',
  'action.t1.qingtong_kuanggao': '制作青铜矿镐',
  'action.t1.xuantie_kuanggao': '制作玄铁矿镐',
  'action.t1.cuizhi_danlu': '制作粗制丹炉',
  'action.t1.qingtong_danlu': '制作青铜丹炉',
  'action.t1.xuanhuo_danlu': '制作玄火丹炉',
  'action.t1.cuizhi_jian': '制作粗制剑',
  'action.t1.qingtong_jian': '制作青铜剑',
  'action.t1.xuantie_jian': '制作玄铁剑',
  'action.t1.lingyu_jian': '制作灵玉剑',
  'action.t1.xuantie_jia': '制作玄铁甲',
  'action.t1.lingyu_fa_pao': '制作灵玉法袍',
  'action.t1.qingshe_lingsui': '青蛇洞取灵髓',
  'action.t1.herb_lingquan_valley': '灵泉谷采药',
  'action.t1.herb_zhuji_garden': '筑基药园采药',
  'action.t1.mind_pill': '炼制益神丹',
  'action.t1.gathering_pill': '炼制采灵丹',
  'action.t1.body_pill': '炼制炼体丹',
  'action.t1.meridian_pill': '炼制护脉丹',
  'action.t1.foundation_pill': '炼制筑基丹',
  'action.t1.essence_pill': '炼制精元丹',
  'recipe.t1.qi_gathering_pill': '聚气丹配方',
  'recipe.t1.mubing_yaochu': '木柄药锄配方',
  'recipe.t1.qingtong_yaochu': '青铜药锄配方',
  'recipe.t1.xuantie_yaochu': '玄铁药锄配方',
  'recipe.t1.lingyu_yaochu': '灵玉药锄配方',
  'recipe.t1.mubing_kuanggao': '木柄矿镐配方',
  'recipe.t1.qingtong_kuanggao': '青铜矿镐配方',
  'recipe.t1.xuantie_kuanggao': '玄铁矿镐配方',
  'recipe.t1.cuizhi_danlu': '粗制丹炉配方',
  'recipe.t1.qingtong_danlu': '青铜丹炉配方',
  'recipe.t1.xuanhuo_danlu': '玄火丹炉配方',
  'recipe.t1.cuizhi_jian': '粗制剑配方',
  'recipe.t1.qingtong_jian': '青铜剑配方',
  'recipe.t1.xuantie_jian': '玄铁剑配方',
  'recipe.t1.lingyu_jian': '灵玉剑配方',
  'recipe.t1.xuantie_jia': '玄铁甲配方',
  'recipe.t1.lingyu_fa_pao': '灵玉法袍配方',
  'recipe.t1.qi_gathering_powder': '聚气散配方',
  'recipe.t1.recovery_pill': '回春丹配方',
  'recipe.t1.mind_pill': '益神丹配方',
  'recipe.t1.gathering_pill': '采灵丹配方',
  'recipe.t1.body_pill': '炼体丹配方',
  'recipe.t1.meridian_pill': '护脉丹配方',
  'recipe.t1.foundation_pill': '筑基丹配方',
  'recipe.t1.essence_pill': '精元丹配方',
  'item.t1.qingling_herb': '青灵草',
  'item.t1.ninglu_hua': '凝露花',
  'item.t1.qi_gathering_powder': '聚气散',
  'item.t1.ziye_lan': '紫叶兰',
  'item.t1.qingshe_dan': '青蛇丹',
  'item.t1.qi_gathering_pill': '聚气丹',
  'item.t1.recovery_pill': '回春丹',
  'item.t1.chitong_kuang': '赤铜矿',
  'item.t1.xuantie_kuang': '玄铁矿',
  'item.t1.xingwen_gang': '星纹钢',
  'item.t1.lingyu_kuang': '灵玉矿',
  'item.t1.qingzhu': '青竹',
  'item.t1.tiemu': '铁木',
  'item.t1.yaolang_ya': '妖狼牙',
  'item.t1.shijia': '石甲',
  'item.t1.yaodan': '妖丹',
  'item.t1.heifeng_jing': '黑风晶',
  'item.t1.mubing_yaochu': '木柄药锄',
  'item.t1.qingtong_yaochu': '青铜药锄',
  'item.t1.xuantie_yaochu': '玄铁药锄',
  'item.t1.lingyu_yaochu': '灵玉药锄',
  'item.t1.mubing_kuanggao': '木柄矿镐',
  'item.t1.qingtong_kuanggao': '青铜矿镐',
  'item.t1.xuantie_kuanggao': '玄铁矿镐',
  'item.t1.cuizhi_danlu': '粗制丹炉',
  'item.t1.qingtong_danlu': '青铜丹炉',
  'item.t1.xuanhuo_danlu': '玄火丹炉',
  'item.t1.cuizhi_jian': '粗制剑',
  'item.t1.qingtong_jian': '青铜剑',
  'item.t1.xuantie_jian': '玄铁剑',
  'item.t1.lingyu_jian': '灵玉剑',
  'item.t1.qingtong_jia': '青铜甲',
  'item.t1.xuantie_jia': '玄铁甲',
  'item.t1.buyi': '布衣',
  'item.t1.lingyu_fa_pao': '灵玉法袍',
  'item.t1.zhuji_feijian': '筑基飞剑',
  'item.t1.heifeng_jian': '黑风剑',
  'item.t1.zhuji_zhanjia': '筑基战甲',
  'item.t1.qingyu_pei': '青玉佩',
  'item.t1.xuanling_jie': '玄灵戒',
  'item.t1.zhuji_hufu': '筑基护符',
  'item.t2.lingsui': '灵髓',
  'item.t1.dimai_can': '地脉参',
  'item.t1.mind_pill': '益神丹',
  'item.t1.gathering_pill': '采灵丹',
  'item.t1.body_pill': '炼体丹',
  'item.t1.meridian_pill': '护脉丹',
  'item.t1.foundation_pill': '筑基丹',
  'item.t1.essence_pill': '精元丹',
  'item.t1.cave_stone': '洞府石料',
};

const TUTORIAL_LABELS: Readonly<Record<string, string>> = {
  'TUT-001': '采药入门教学',
  'TUT-002': '炼丹入门教学',
  'TUT-003': '聚气散炼制教学',
  'TUT-004': '无限修炼教学',
};

const REALM_LABELS: Readonly<Record<string, string>> = {
  'realm.mortal.entry': '炼气入门',
  'realm.qi.early': '炼气初期',
  'realm.qi.mid': '炼气中期',
  'realm.qi.late': '炼气后期',
  'realm.qi.great': '炼气大圆满',
  'realm.foundation.early': '筑基初期',
};

const FEATURE_LABELS: Readonly<Record<string, string>> = {
  'feature.herbalism': '采药',
  'feature.alchemy': '炼丹',
  'feature.mining': '挖矿',
  'feature.forging': '炼器',
  'feature.tempering': '淬炼',
  'feature.action_queue': '行动队列',
};

export function describeSkillId(id: string | null | undefined): string {
  return id === null || id === undefined || id.length === 0 ? '未知技能' : ID_LABELS[id] ?? '未知技能';
}

export function describeActionId(id: string | null | undefined): string {
  return id === null || id === undefined || id.length === 0 ? '未知行动' : ID_LABELS[id] ?? '未知行动';
}

export function describeItemId(id: string | null | undefined): string {
  return id === null || id === undefined || id.length === 0 ? '未鉴定物品' : ID_LABELS[id] ?? '未鉴定物品';
}

export function describeRecipeId(id: string | null | undefined): string {
  return id === null || id === undefined || id.length === 0 ? '未知配方' : ID_LABELS[id] ?? '未知配方';
}

export function describeRealmId(id: string | null | undefined): string {
  return id === null || id === undefined || id.length === 0 ? '未知境界' : REALM_LABELS[id] ?? '未知境界';
}

export function describeActionDescription(id: string | null | undefined): string {
  switch (id) {
    case 'action.cultivation.qi':
      return '吸收洞天灵气，稳定积累修为。';
    case 'action.t1.herb_baicao_valley':
      return '采集青灵草，为炼丹准备材料。';
    case 'action.t1.qi_gathering_powder':
      return '炼制聚气散，提升炼丹熟练度。';
    case 'action.t1.qi_gathering_pill':
      return '炼制聚气丹，材料不足时会自动停下。';
    default:
      return '完成这项修行后会积累对应修行进度。';
  }
}

export function describeRecipeDescription(id: string | null | undefined): string {
  switch (id) {
    case 'recipe.t1.qi_gathering_pill':
      return '以青灵草炼制聚气丹，适合前期积累丹药。';
    case 'recipe.t1.foundation_pill':
      return '炼制筑基丹，为突破下一个境界做准备。';
    case 'recipe.t1.meridian_pill':
      return '炼制护脉丹，降低突破时的风险。';
    default:
      return '准备材料后即可加入挂机计划。';
  }
}

function translateTechnicalText(text: string): string {
  return text
    .replaceAll('feature.locked.tutorial', '完成入门教学后解锁')
    .replaceAll('feature.locked.realm_or_tutorial', '达到要求境界并完成入门教学后解锁')
    .replaceAll('feature.locked.realm', '达到要求境界后解锁')
    .replaceAll('feature.locked.breakthrough_conditions', '满足突破条件后解锁')
    .replace(/TUT-\d+/g, (id) => TUTORIAL_LABELS[id] ?? '入门教学')
    .replace(/realm\.[a-z.]+/g, (id) => REALM_LABELS[id] ?? '更高境界')
    .replace(/skill\.[a-z_]+/g, (id) => describeSkillId(id))
    .replace(/feature\.[a-z_]+/g, (id) => FEATURE_LABELS[id] ?? '相关功能');
}

function blockerDescription(blocker: Record<string, unknown>): string {
  const kind = String(blocker['kind'] ?? '');
  if (kind === 'tutorial') {
    const tutorialIds = String(blocker['required_id'] ?? '').split(',').filter(Boolean);
    return `完成${tutorialIds.map((id) => TUTORIAL_LABELS[id] ?? '入门教学').join('、')}后解锁`;
  }
  if (kind === 'realm') {
    const required = describeRealmId(String(blocker['required_id'] ?? ''));
    const actual = describeRealmId(String(blocker['actual_id'] ?? ''));
    return `达到${required}后解锁（当前${actual}）`;
  }
  if (kind === 'skill') {
    return `${describeSkillId(String(blocker['required_id'] ?? ''))}达到 ${String(blocker['required_level'] ?? '?')} 级后解锁`;
  }
  if (kind === 'facility') return `建造${translateTechnicalText(String(blocker['required_id'] ?? '相关设施'))}后解锁`;
  if (kind === 'feature') return `${translateTechnicalText(String(blocker['required_id'] ?? '相关功能'))}尚未开放`;
  return '暂未解锁';
}

export function describeUnlockReason(reason: string | null | undefined, blockers: ReadonlyArray<Record<string, unknown>> = []): string {
  const reasonFragments = reason === null || reason === undefined || reason.length === 0
    ? []
    : (() => {
        const tutorialLabel = TUTORIAL_LABELS[reason];
        if (tutorialLabel !== undefined) return [`完成${tutorialLabel}后解锁`];
        const realmLabel = REALM_LABELS[reason];
        if (realmLabel !== undefined) return [`达到${realmLabel}后解锁`];
        return reason.split(/[；;]/).map((fragment) => translateTechnicalText(fragment.trim())).filter(Boolean);
      })();
  const blockerFragments = blockers.map(blockerDescription);
  const fragments = blockers.length > 0
    ? [
        ...reasonFragments.filter((fragment) => !blockerFragments.some((blocker) => {
          const condition = blocker.replace(/后解锁$/, '').replace(/（当前.*）$/, '').replace(/^(完成|达到)/, '');
          return condition.length > 0 && fragment.includes(condition);
        })),
        ...blockerFragments,
      ]
    : reasonFragments;
  const uniqueFragments = [...new Set(fragments)].filter((fragment) => !/TUT-|realm\./.test(fragment));
  if (uniqueFragments.length === 0) return '暂未解锁';
  if (reason === 'feature.locked.tutorial' && blockers.length === 0) return '完成入门教学后解锁';
  return uniqueFragments.join('；');
}

function toFiniteNumber(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined || value === '') {
    return null;
  }

  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function formatCount(value: string | number | null | undefined): string {
  const parsed = toFiniteNumber(value);
  return parsed === null ? '无' : numberFormat.format(parsed);
}

export function formatDurationUs(value: string | number | null | undefined): string {
  const parsed = toFiniteNumber(value);
  if (parsed === null) {
    return '未知';
  }

  const seconds = parsed / 1_000_000;
  if (seconds < 60) {
    return `${seconds.toFixed(seconds < 10 ? 1 : 0)} 秒`;
  }

  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = Math.round(seconds % 60);
  if (minutes < 60) {
    return remainingSeconds === 0 ? `${minutes} 分钟` : `${minutes} 分 ${remainingSeconds} 秒`;
  }

  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return remainingMinutes === 0 ? `${hours} 小时` : `${hours} 小时 ${remainingMinutes} 分钟`;
}

export function formatRatePerHour(amount: string | number | null | undefined, durationUs: string | number | null | undefined): string {
  const amountValue = toFiniteNumber(amount);
  const durationValue = toFiniteNumber(durationUs);
  if (amountValue === null || durationValue === null || durationValue <= 0) {
    return '未知';
  }

  const perHour = (amountValue * 3_600_000_000) / durationValue;
  if (!Number.isFinite(perHour)) {
    return '未知';
  }

  return `${perHour.toFixed(perHour < 10 ? 2 : 1)}/小时`;
}

export function summarizeItemQuantity(quantity: ContentItemQuantity): string {
  const fragments = [`需求 ${formatCount(quantity.quantity)}`];
  if (quantity.available_quantity !== undefined) {
    fragments.push(`可用 ${formatCount(quantity.available_quantity)}`);
  }
  if (quantity.reserved_quantity !== undefined) {
    fragments.push(`预留 ${formatCount(quantity.reserved_quantity)}`);
  }
  if (quantity.quantity_owned !== undefined) {
    fragments.push(`持有 ${formatCount(quantity.quantity_owned)}`);
  }
  if (quantity.missing_quantity !== undefined && quantity.missing_quantity > 0) {
    fragments.push(`缺口 ${formatCount(quantity.missing_quantity)}`);
  }
  return fragments.join(' · ');
}

export function describeRoute(route: ContentRoute): string {
  return `${route.route_type === 'ACTION' ? '行动' : '配方'} · ${route.route_type === 'ACTION' ? describeActionId(route.target_id) : describeRecipeId(route.target_id)}`;
}

export function routeKey(route: ContentRoute): string {
  return `${route.route_type}:${route.target_id}`;
}

export function isActionRunning(actionId: string, queue: Queue): boolean {
  if (queue.current?.action_id === actionId) {
    return true;
  }

  return queue.entries.some((entry) => entry.action_id === actionId && entry.status === 'RUNNING');
}

export function isActionQueued(actionId: string, queue: Queue): boolean {
  if (isActionRunning(actionId, queue)) {
    return true;
  }

  return queue.entries.some((entry) => entry.action_id === actionId && entry.status === 'QUEUED');
}

export function formatActionRate(entry: ActionCatalogEntry): string {
  return `${formatRatePerHour(entry.skill_xp, entry.base_duration_us)} XP`;
}

export function formatRecipeRate(entry: RecipeCatalogEntry): string {
  return `${formatRatePerHour(entry.skill_xp, entry.base_duration_us)} XP`;
}

export function joinRoutePath(route: ContentRoute): string {
  return route.route_type === 'ACTION'
    ? `/craft?tab=actions&action_id=${encodeURIComponent(route.target_id)}`
    : `/craft?tab=recipes&recipe_id=${encodeURIComponent(route.target_id)}`;
}

export function joinQueuePath(actionId: string): string {
  return `/dashboard/queue?action_id=${encodeURIComponent(actionId)}`;
}

export function selectBestAction(actions: ReadonlyArray<ActionCatalogEntry>): ReadonlyMap<string, ActionCatalogEntry> {
  const bySkill = new Map<string, ActionCatalogEntry>();

  for (const action of actions) {
    const skillId = action.skill_id ?? 'skill.cultivation';
    if (!action.unlocked) {
      continue;
    }

    const current = bySkill.get(skillId);
    if (current === undefined) {
      bySkill.set(skillId, action);
      continue;
    }

    const currentScore = toFiniteNumber(current.skill_xp) ?? 0;
    const nextScore = toFiniteNumber(action.skill_xp) ?? 0;
    if (nextScore > currentScore) {
      bySkill.set(skillId, action);
    }
  }

  return bySkill;
}

export function summarizeInventoryAsset(asset: InventoryAsset): string {
  return `数量 ${formatCount(asset.quantity)} · 预留 ${formatCount(asset.reserved_quantity)} · 可用 ${formatCount(asset.available_quantity)}`;
}
