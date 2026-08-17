import type {
  BreakthroughPreviewResponse,
  BreakthroughRequirementPreview,
  BreakthroughRun,
} from '@dongtian/contracts';

export interface BreakthroughRequirementView extends BreakthroughRequirementPreview {
  readonly label: string;
  readonly statusLabel: string;
  readonly sourceLabel: string;
  readonly sourcePath: string;
}

export type BreakthroughGateKey =
  'CULTIVATION_XP' | 'KEY_RECIPE' | 'DUNGEON_MATERIAL' | 'TRIAL_ASSET';

export interface BreakthroughRequirementGroup {
  readonly key: BreakthroughGateKey;
  readonly label: string;
  readonly requirements: ReadonlyArray<BreakthroughRequirementView>;
}

export interface BreakthroughPageView {
  readonly targetRealmLabel: string;
  readonly targetRealmId: string;
  readonly configVersion: string;
  readonly requirements: ReadonlyArray<BreakthroughRequirementView>;
  readonly requirementGroups: ReadonlyArray<BreakthroughRequirementGroup>;
  readonly allSatisfied: boolean;
  readonly successLabel: string;
  readonly unlockBundleLabel: string;
}

const assetTypeLabels: Readonly<Record<BreakthroughGateKey, string>> = {
  CULTIVATION_XP: '修为门槛',
  KEY_RECIPE: '关键配方门槛',
  DUNGEON_MATERIAL: '秘境材料门槛',
  TRIAL_ASSET: '资产 / 试炼门槛',
};

const assetLabels: Readonly<Record<string, string>> = {
  cultivation_xp: '修为',
  'item.t1.foundation_pill': '筑基丹',
  'item.t2.lingsui': '灵髓',
  'item.t1.meridian_pill': '护脉丹',
  'currency.spirit_stone': '灵石',
};

function formatNumber(value: string): string {
  const number = Number(value);
  return Number.isFinite(number) ? new Intl.NumberFormat('zh-CN').format(number) : value;
}

export function getBreakthroughAssetLabel(assetId: string): string {
  return assetLabels[assetId] ?? assetId;
}

export function getBreakthroughSourcePath(routeId: string): string {
  if (routeId.startsWith('action.')) {
    return `/craft?tab=actions&action_id=${encodeURIComponent(routeId)}`;
  }
  if (routeId.startsWith('recipe.')) {
    return `/craft?tab=recipes&recipe_id=${encodeURIComponent(routeId)}`;
  }
  return `/expedition?initial_route_id=${encodeURIComponent(routeId)}`;
}

export function getBreakthroughSourceLabel(routeId: string): string {
  if (routeId === 'action.cultivation.qi') return '修炼 · 吸收灵气';
  if (routeId === 'recipe.t1.foundation_pill') return '炼丹 · 筑基丹';
  if (routeId === 'recipe.t1.meridian_pill') return '炼丹 · 护脉丹';
  if (routeId === 'route.t1.qingshe_cave.safe_exit') return '青蛇洞 · 灵髓';
  if (routeId === 'route.t1.qingshe_cave.deep_den') return '青蛇洞 · 灵石';
  return '前往来源';
}

export function formatBreakthroughRequirement(requirement: BreakthroughRequirementPreview): string {
  const base = `可用 ${formatNumber(requirement.available)} / 需要 ${formatNumber(requirement.required)}`;
  const reserved =
    Number(requirement.reserved) > 0 ? ` · 已预留 ${formatNumber(requirement.reserved)}` : '';
  const shortfall =
    requirement.status === 'MISSING' ? ` · 缺口 ${formatNumber(requirement.shortfall)}` : '';
  return `${base}${reserved}${shortfall}`;
}

function toRequirementView(
  requirement: BreakthroughRequirementPreview,
): BreakthroughRequirementView {
  return {
    ...requirement,
    label: getBreakthroughAssetLabel(requirement.asset_id),
    statusLabel: requirement.status === 'SATISFIED' ? '已满足' : '待补齐',
    sourceLabel: getBreakthroughSourceLabel(requirement.source_route_id),
    sourcePath: getBreakthroughSourcePath(requirement.source_route_id),
  };
}

export function buildBreakthroughPageView(
  response: BreakthroughPreviewResponse,
): BreakthroughPageView {
  const preview = response.breakthrough;
  const requirements = preview.requirements.map(toRequirementView);
  const gateForRequirement = (requirement: BreakthroughRequirementPreview): BreakthroughGateKey => {
    if (requirement.asset_type === 'CULTIVATION_XP') return 'CULTIVATION_XP';
    if (requirement.asset_id === 'item.t2.lingsui') return 'DUNGEON_MATERIAL';
    if (requirement.asset_type === 'ITEM') return 'KEY_RECIPE';
    return 'TRIAL_ASSET';
  };
  const requirementGroups = (
    ['CULTIVATION_XP', 'KEY_RECIPE', 'DUNGEON_MATERIAL', 'TRIAL_ASSET'] as const
  )
    .map((key) => ({
      key,
      label: assetTypeLabels[key],
      requirements: requirements.filter((requirement) => gateForRequirement(requirement) === key),
    }))
    .filter((group) => group.requirements.length > 0);

  return {
    targetRealmLabel:
      preview.target_realm_id === 'realm.foundation.early'
        ? '筑基 · 初期'
        : preview.target_realm_id,
    targetRealmId: preview.target_realm_id,
    configVersion: preview.config_version,
    requirements,
    requirementGroups,
    allSatisfied: preview.all_satisfied,
    successLabel:
      preview.success_rate === '1' || preview.success_rate === '100%'
        ? '条件满足后，成功率为 100%'
        : `条件满足后，成功率 ${preview.success_rate}`,
    unlockBundleLabel: preview.unlock_bundle_id,
  };
}

export function breakthroughRunStatusLabel(status: BreakthroughRun['status']): string {
  switch (status) {
    case 'READY':
      return '已预留，等待试炼';
    case 'TRIAL_ACTIVE':
      return '试炼进行中';
    case 'TRIAL_WAITING_CHOICE':
      return '等待路线选择';
    case 'COMPLETED':
      return '筑基已完成';
    case 'FAILED_RECOVERABLE':
      return '已恢复，预留已释放';
    case 'ABANDONED':
      return '已放弃，预留已释放';
  }
}

export function formatCountdown(deadline: string, now = new Date()): string {
  const remaining = Math.max(0, new Date(deadline).getTime() - now.getTime());
  const totalSeconds = Math.floor(remaining / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}分${String(seconds).padStart(2, '0')}秒`;
}
