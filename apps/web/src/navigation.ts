export interface ShellChildRouteItem {
  readonly id: string;
  readonly label: string;
  readonly path: string;
  readonly description: string;
}

export interface ShellRouteItem {
  readonly id: string;
  readonly label: string;
  readonly path: string;
  readonly description: string;
  readonly children?: readonly ShellChildRouteItem[];
}

export interface ShellFlowStep {
  readonly id: string;
  readonly label: string;
  readonly path: string;
  readonly description: string;
}

export interface ShellRouteAlias {
  readonly path: string;
  readonly kind: 'shops' | 'news' | 'changelog';
}

export const SHELL_BRAND_COPY = {
  version: '修行日志',
  workspace: '修行总览',
  draft: '快捷任务',
} as const;

export const SHELL_CRAFT_CHILDREN: readonly ShellChildRouteItem[] = [
  { id: 'herbalism', label: '采集 / 采药', path: '/craft/herbalism', description: '选择区域和草药，开始采药挂机。' },
  { id: 'mining', label: '采集 / 挖矿', path: '/craft/mining', description: '选择区域和矿石，开始挖矿挂机。' },
  { id: 'alchemy', label: '炼丹', path: '/craft/alchemy', description: '按分类选择丹药配方，开始炼丹挂机。' },
  { id: 'forging', label: '炼器', path: '/craft/forging', description: '按分类选择炼器配方，开始炼器挂机。' },
] as const;

export const SHELL_CULTIVATION_CHILDREN: readonly ShellChildRouteItem[] = [
  { id: 'breakthrough', label: '突破', path: '/cultivation/breakthrough', description: '检查境界门槛并发起突破试炼。' },
] as const;

export const SHELL_ROUTES: readonly ShellRouteItem[] = [
  { id: 'dashboard', label: '洞府', path: '/dashboard/cave', description: '修建和升级练功房、炼丹炉、锻造炉。' },
  { id: 'cultivation', label: '修炼', path: '/cultivation', description: '选择修炼方向并安排挂机。', children: SHELL_CULTIVATION_CHILDREN },
  { id: 'craft', label: '百艺', path: '/craft', description: '采药、挖矿、炼丹、炼器和淬炼。', children: SHELL_CRAFT_CHILDREN },
  { id: 'expedition', label: '历练', path: '/expedition', description: '选择地图区域、怪物与秘境路线。' },
  { id: 'character', label: '角色', path: '/character', description: '装备整理、比较、保留和淬炼。' },
  { id: 'inventory', label: '背包', path: '/inventory', description: '材料、丹药、装备和分页筛选。' },
  { id: 'settings', label: '设置', path: '/settings', description: '界面密度、动效和修行日志。' },
  { id: 'guide', label: '指南', path: '/guide', description: '从第一次挂机开始了解洞天。' },
  { id: 'rules', label: '规则', path: '/rules', description: '挂机、资源、突破和秘境规则。' },
  { id: 'shops', label: '市场', path: '/shops', description: '资源兑换与秘境补给。' },
  { id: 'guild', label: '宗门', path: '/guild', description: '宗门与多人协作入口。' },
  { id: 'social', label: '仙友', path: '/social', description: '仙友、私信和组队。' },
  { id: 'leaderboard', label: '修行榜', path: '/leaderboard', description: '查看修行方向的成长记录。' },
];

/**
 * URL aliases used by reference links and bookmarks. They intentionally point
 * at an existing page kind so a locked/deferred system cannot gain fake data
 * just by entering through another URL.
 */
export const SHELL_ROUTE_ALIASES: readonly ShellRouteAlias[] = [
  { path: '/market', kind: 'shops' },
  { path: '/updates', kind: 'news' },
  { path: '/update-log', kind: 'changelog' },
];

/** The smallest playable loop, kept as navigation metadata so it never invents authority. */
export const SHELL_FLOW_STEPS: readonly ShellFlowStep[] = [
  { id: 'dashboard', label: '洞府首页', path: '/dashboard/cave', description: '修建和升级洞府设施。' },
  { id: 'cave', label: '洞府设施', path: '/dashboard/cave', description: '管理练功房、炼丹炉和锻造炉。' },
  { id: 'cultivation', label: '修炼 / 筑基', path: '/cultivation', description: '检查境界门槛并发起筑基。' },
  { id: 'queue', label: '挂机计划', path: '/dashboard/queue', description: '调整任务顺序和材料条件。' },
  { id: 'inventory', label: '背包', path: '/inventory', description: '确认材料、丹药和装备回流。' },
  { id: 'expedition', label: '秘境历练', path: '/expedition', description: '准备并进入青蛇洞秘境。' },
];

export const SHELL_PANELS = [
  { id: 'current-action', title: '正在进行', slot: '01' },
  { id: 'settlement-summary', title: '最近收获', slot: '02' },
  { id: 'goal-tracker', title: '下一境界', slot: '03' },
] as const;

const fallbackRoute = SHELL_ROUTES.find((route) => route.id === 'cultivation') ?? SHELL_ROUTES[0];

if (fallbackRoute === undefined) {
  throw new Error('SHELL_ROUTES must contain at least one entry.');
}

export const DEFAULT_SHELL_ROUTE = fallbackRoute;
