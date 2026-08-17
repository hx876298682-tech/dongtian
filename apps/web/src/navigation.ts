export interface ShellRouteItem {
  readonly id: string;
  readonly label: string;
  readonly path: string;
  readonly description: string;
}

export interface ShellFlowStep {
  readonly id: string;
  readonly label: string;
  readonly path: string;
  readonly description: string;
}

export const SHELL_BRAND_COPY = {
  version: '修行日志',
  workspace: '修行总览',
  draft: '快捷任务',
} as const;

export const SHELL_ROUTES: readonly ShellRouteItem[] = [
  { id: 'dashboard', label: '洞府', path: '/dashboard', description: '当前行动、回流摘要和目标追踪。' },
  { id: 'cultivation', label: '修炼', path: '/cultivation', description: '境界、修为和突破项目。' },
  { id: 'craft', label: '百艺', path: '/craft', description: '采药、挖矿、炼丹、炼器和淬炼。' },
  { id: 'expedition', label: '历练', path: '/expedition', description: '青蛇洞机会、准备、运行与恢复。' },
  { id: 'character', label: '角色', path: '/character', description: '装备整理、比较、保留和淬炼。' },
  { id: 'inventory', label: '背包', path: '/inventory', description: '材料、丹药、装备和分页筛选。' },
  { id: 'settings', label: '设置', path: '/settings', description: '界面密度、动效和修行日志。' },
];

/** The smallest playable loop, kept as navigation metadata so it never invents authority. */
export const SHELL_FLOW_STEPS: readonly ShellFlowStep[] = [
  { id: 'dashboard', label: '洞府首页', path: '/dashboard', description: '查看修为、库存和当前行动。' },
  { id: 'cave', label: '洞府设施', path: '/dashboard/cave', description: '管理聚灵室、炼丹房和炼器房。' },
  { id: 'cultivation', label: '修炼 / 筑基', path: '/cultivation', description: '检查境界门槛并发起筑基。' },
  { id: 'queue', label: '挂机计划', path: '/dashboard#queue', description: '调整任务顺序和材料条件。' },
  { id: 'inventory', label: '背包', path: '/inventory', description: '确认材料、丹药和装备回流。' },
  { id: 'expedition', label: '秘境历练', path: '/expedition', description: '准备并进入青蛇洞秘境。' },
];

export const SHELL_PANELS = [
  { id: 'current-action', title: '正在进行', slot: '01' },
  { id: 'settlement-summary', title: '最近收获', slot: '02' },
  { id: 'goal-tracker', title: '下一境界', slot: '03' },
] as const;

const fallbackRoute = SHELL_ROUTES[0];

if (fallbackRoute === undefined) {
  throw new Error('SHELL_ROUTES must contain at least one entry.');
}

export const DEFAULT_SHELL_ROUTE = fallbackRoute;
