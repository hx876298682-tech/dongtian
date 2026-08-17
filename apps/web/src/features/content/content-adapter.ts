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
  'action.cultivation.qi': '修炼灵气',
  'action.t1.herb_baicao_valley': '采药',
  'action.t1.qi_gathering_powder': '炼制聚气散',
  'action.t1.qi_gathering_pill': '炼制聚气丹',
  'recipe.t1.qi_gathering_pill': '聚气丹配方',
  'item.t1.qingling_herb': '青灵草',
  'item.t1.qi_gathering_pill': '聚气丹',
  'item.t1.cave_stone': '洞府石料',
};

export function describeSkillId(id: string | null | undefined): string {
  return id === null || id === undefined || id.length === 0 ? '未知技能' : ID_LABELS[id] ?? id;
}

export function describeActionId(id: string | null | undefined): string {
  return id === null || id === undefined || id.length === 0 ? '未知行动' : ID_LABELS[id] ?? id;
}

export function describeItemId(id: string | null | undefined): string {
  return id === null || id === undefined || id.length === 0 ? '未知物品' : ID_LABELS[id] ?? id;
}

export function describeRecipeId(id: string | null | undefined): string {
  return id === null || id === undefined || id.length === 0 ? '未知配方' : ID_LABELS[id] ?? id;
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
      return '完成这项修行后获得对应的技能经验与产出。';
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

export function describeUnlockReason(reason: string | null | undefined): string {
  if (reason === 'feature.locked.tutorial' || reason === 'TUT-001') return '完成新手引导后解锁';
  if (reason === null || reason === undefined || reason.length === 0) return '暂未解锁';
  return reason;
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
  return `/dashboard?action_id=${encodeURIComponent(actionId)}`;
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
