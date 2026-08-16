export interface ShellRouteItem {
  readonly id: string;
  readonly label: string;
  readonly path: string;
  readonly description: string;
}

export const SHELL_ROUTES: readonly ShellRouteItem[] = [
  { id: 'dashboard', label: '洞府', path: '/dashboard', description: '当前行动、回流摘要和目标追踪。' },
  { id: 'cultivation', label: '修炼', path: '/cultivation', description: '境界、修为和突破项目。' },
  { id: 'craft', label: '百艺', path: '/craft', description: '采药、挖矿、炼丹、炼器和淬炼。' },
  { id: 'expedition', label: '历练', path: '/expedition', description: '青蛇洞机会、准备、运行与恢复。' },
  { id: 'character', label: '角色', path: '/character', description: '装备、预设、丹药槽与解释。' },
  { id: 'inventory', label: '背包', path: '/inventory', description: '材料、丹药、装备和临时收纳。' },
];

export const SHELL_PANELS = [
  { id: 'current-action', title: '当前闭关', slot: '01' },
  { id: 'settlement-summary', title: '最近回流摘要', slot: '02' },
  { id: 'goal-tracker', title: '目标追踪', slot: '03' },
] as const;

const fallbackRoute = SHELL_ROUTES[0];

if (fallbackRoute === undefined) {
  throw new Error('SHELL_ROUTES must contain at least one entry.');
}

export const DEFAULT_SHELL_ROUTE = fallbackRoute;
