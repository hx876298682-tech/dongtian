import { startTransition, useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactElement, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider, useMutation, useQuery } from '@tanstack/react-query';
import {
  Navigate,
  Link,
  NavLink,
  Outlet,
  RouterProvider,
  createBrowserRouter,
  useLocation,
  useNavigate,
} from 'react-router';

import { EmptyStateScreen, LockedStateScreen, LoadingStateScreen, LocalErrorStateScreen, MaintenanceStateScreen } from '@dongtian/ui';

import { useAuthBootstrap } from './auth/use-auth-bootstrap.js';
import { DashboardPage } from './features/dashboard/dashboard-page.js';
import { CavePage } from './features/cave/cave-page.js';
import { CharacterEquipmentPage } from './features/character/equipment-page.js';
import { CharacterToolAssignmentsPage } from './features/character/tool-assignments-page.js';
import { CraftPage, InventoryPage } from './features/content/content-page.js';
import { HerbalismPage } from './features/behavior/herbalism-page.js';
import { MiningPage } from './features/behavior/mining-page.js';
import { AlchemyPage } from './features/behavior/alchemy-page.js';
import { ForgingPage } from './features/behavior/forging-page.js';
import { CombatPage } from './features/expedition/combat-page.js';
import { BreakthroughPage } from './features/breakthrough/breakthrough-page.js';
import { CultivationPage } from './features/cultivation/cultivation-page.js';
import { SettingsPage } from './features/system/settings-page.js';
import { ReferencePage } from './features/system/reference-pages.js';
import { DEFAULT_SHELL_ROUTE, SHELL_BRAND_COPY, SHELL_ROUTES, SHELL_ROUTE_ALIASES } from './navigation.js';
import { useUiDraftStore } from './state/ui-draft-store.js';
import type { AuthActiveSession, CharacterProgression, InventorySnapshot, LoadoutPreset, Queue, CaveResponse, SkillToolAssignmentsResponse, DungeonOpportunityResponse } from '@dongtian/contracts';
import { apiClient } from './lib/api.js';
import { buildIdleProgressView } from './features/dashboard/dashboard-adapter.js';
import { emitGameFeedback, subscribeGameFeedback, type GameFeedbackDetail } from './lib/game-feedback.js';
import { describeSkillId } from './features/content/content-adapter.js';
import { buildCaveRailSummary, buildEquipmentRailSummary, buildInventoryRailSummary, buildLoadoutRailSummary, buildSkillsRailSummary } from './features/system/right-rail-adapter.js';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 2,
      staleTime: 30_000,
      refetchOnWindowFocus: false,
    },
    mutations: {
      retry: 1,
    },
  },
});

function createIdempotencyKey(): string {
  return typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : `web-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

const RIGHT_RAIL_TABS = [
  ['inventory', '背包'],
  ['equipment', '装备'],
  ['skills', '技能'],
  ['cave', '洞府'],
  ['loadout', '配装'],
] as const;

type RightRailTab = typeof RIGHT_RAIL_TABS[number][0];

function GlobalIdleProgress({ characterId }: { readonly characterId: string }): ReactElement | null {
  const [nowMs, setNowMs] = useState(() => Date.now());
  const queueQuery = useQuery<Queue>({
    queryKey: ['global-idle-progress', characterId],
    queryFn: () => apiClient.getQueue(characterId),
    staleTime: 10_000,
    refetchInterval: 30_000,
  });
  const pauseMutation = useMutation({
    mutationFn: () => apiClient.pauseQueue(
      characterId,
      { expected_queue_version: queueQuery.data?.queue_version ?? 0 },
      createIdempotencyKey(),
    ),
    onSuccess: async () => {
      emitGameFeedback('已暂停挂机。', 'success');
      await queueQuery.refetch();
      await queryClient.invalidateQueries({ queryKey: ['dashboard', characterId] });
    },
  });
  const resumeMutation = useMutation({
    mutationFn: () => apiClient.resumeQueue(
      characterId,
      { expected_queue_version: queueQuery.data?.queue_version ?? 0 },
      createIdempotencyKey(),
    ),
    onSuccess: async () => {
      emitGameFeedback('已恢复挂机。', 'success');
      await queueQuery.refetch();
      await queryClient.invalidateQueries({ queryKey: ['dashboard', characterId] });
    },
  });

  useEffect(() => {
    const timer = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const view = queueQuery.data === undefined ? null : buildIdleProgressView(queueQuery.data, nowMs);
  if (view === null) return null;

  return (
    <div className="global-idle-progress" aria-label="全局当前行动">
      <div className="global-idle-progress__copy">
        <span>正在挂机</span>
        <strong>{view.actionLabel}</strong>
      </div>
      <div className="global-idle-progress__bar-wrap">
        <div className="global-idle-progress__meta">
          <span>{view.paused ? '已暂停' : view.remaining}</span>
          <span>{Math.round(view.progress * 100)}%</span>
        </div>
        <div className="global-idle-progress__track" role="progressbar" aria-label={`${view.actionLabel}全局进度`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(view.progress * 100)}>
          <span className="global-idle-progress__fill" style={{ width: `${view.progress * 100}%` }} />
        </div>
      </div>
      <span className="global-idle-progress__cycles">已完成 {view.completedCycles} 轮</span>
      <button className="global-idle-progress__stop" type="button" onClick={() => (view.paused ? resumeMutation.mutate() : pauseMutation.mutate())} disabled={pauseMutation.isPending || resumeMutation.isPending}>
        {pauseMutation.isPending || resumeMutation.isPending ? '处理中…' : view.paused ? '恢复挂机' : '暂停挂机'}
      </button>
    </div>
  );
}

function realmLabel(realmStageId: string | undefined): string {
  if (realmStageId === 'realm.mortal.entry') return '炼气入门';
  if (realmStageId === 'realm.mortal.foundation') return '筑基初成';
  if (realmStageId?.startsWith('realm.')) return '修行中';
  return '境界暂不可用';
}

function formatPlayerNumber(value: string | number | undefined): string {
  if (value === undefined || value === null || value === '') return '暂不可用';
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return '暂不可用';
  return new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 2 }).format(numeric);
}

function routeGlyph(routeId: string): string {
  switch (routeId) {
    case 'dashboard': return '⌂';
    case 'cultivation': return '✦';
    case 'craft': return '⚒';
    case 'expedition': return '♢';
    case 'tasks': return '▣';
    case 'maze': return '⌘';
    case 'shops': return '◈';
    case 'store': return '▣';
    case 'cowbell-shop': return '♢';
    case 'character': return '♙';
    case 'inventory': return '▤';
    case 'achievements': return '★';
    case 'leaderboard': return '♜';
    case 'guild': return '♜';
    case 'social': return '♟';
    case 'settings': return '⚙';
    case 'guide': return '?';
    case 'rules': return '≡';
    case 'news': return '✉';
    case 'changelog': return '≡';
    default: return '•';
  }
}

function GlobalInventorySummary({ characterId }: { readonly characterId: string }): ReactElement {
  const inventoryQuery = useQuery<InventorySnapshot>({
    queryKey: ['global-inventory', characterId],
    queryFn: () => apiClient.getInventory(characterId),
    staleTime: 20_000,
    refetchInterval: 45_000,
  });
  if (inventoryQuery.error !== null && inventoryQuery.error !== undefined) {
    return <RailErrorState title="背包暂时无法读取" onRetry={() => queryClient.invalidateQueries({ queryKey: ['global-inventory', characterId] })} />;
  }
  if (inventoryQuery.isPending || inventoryQuery.data === undefined) {
    return <RailLoadingState title="正在读取背包" />;
  }
  const summary = buildInventoryRailSummary(inventoryQuery.data);
  if (summary.count === 0) {
    return <RailEmptyState title="背包暂时为空" description="当前还没有可展示的修行物品。" />;
  }

  return (
    <section className="rail-inventory" aria-label="角色背包摘要">
      <div className="rail-inventory__header"><strong>背包</strong><span>{summary.count} 件</span></div>
      <div className="rail-inventory__grid">
        {summary.items.map((asset) => (
          <div className="rail-inventory__item" key={asset.key}>
            <span>{asset.label}</span>
            <strong>{asset.quantity}</strong>
          </div>
        ))}
      </div>
    </section>
  );
}

function GlobalResourceSummary({ characterId }: { readonly characterId: string }): ReactElement {
  const progressionQuery = useQuery<CharacterProgression>({
    queryKey: ['global-progression', characterId],
    queryFn: () => apiClient.getProgression(characterId),
    staleTime: 20_000,
    refetchInterval: 45_000,
  });
  const inventoryQuery = useQuery<InventorySnapshot>({
    queryKey: ['global-inventory', characterId],
    queryFn: () => apiClient.getInventory(characterId),
    staleTime: 20_000,
    refetchInterval: 45_000,
  });
  const opportunityQuery = useQuery<DungeonOpportunityResponse>({
    queryKey: ['global-dungeon-opportunities', characterId],
    queryFn: () => apiClient.getDungeonOpportunities(characterId),
    staleTime: 20_000,
    refetchInterval: 45_000,
  });
  const currencies = inventoryQuery.data?.currencies.slice(0, 1) ?? [];
  const resourceValue = (state: { readonly isPending: boolean; readonly error: unknown; }, value: string | number | undefined): string => {
    if (state.isPending) return '读取中';
    if (state.error !== null && state.error !== undefined) return '不可用';
    return formatPlayerNumber(value);
  };
  const realmValue = (): string => {
    if (progressionQuery.isPending) return '读取中';
    if (progressionQuery.error !== null && progressionQuery.error !== undefined) return '不可用';
    return realmLabel(progressionQuery.data?.cultivation.realm_stage_id);
  };

  return (
    <div className="topbar-resources" aria-label="角色资源">
      <div className="topbar-resource"><span>境界</span><strong>{realmValue()}</strong></div>
      <div className="topbar-resource"><span>修为</span><strong>{resourceValue(progressionQuery, progressionQuery.data?.cultivation.xp)}</strong></div>
      <div className="topbar-resource"><span>灵石</span><strong>{resourceValue(inventoryQuery, currencies[0]?.available_quantity)}</strong></div>
      <div className="topbar-resource"><span>秘境机会</span><strong>{resourceValue(opportunityQuery, opportunityQuery.data?.opportunity.current_opportunities)}</strong></div>
    </div>
  );
}

function RailLoadingState({ title }: { readonly title: string }): ReactElement {
  return <section className="rail-card rail-card--state" aria-live="polite"><strong className="rail-card__title">{title}</strong><p className="rail-card__copy">正在读取真实数据。</p></section>;
}

function RailErrorState({ title, onRetry }: { readonly title: string; readonly onRetry: () => void | Promise<unknown> }): ReactElement {
  return <section className="rail-card rail-card--state" role="alert"><strong className="rail-card__title">{title}</strong><p className="rail-card__copy">暂时无法读取，稍后可以重试。</p><button className="ghost-button" type="button" onClick={() => { void onRetry(); }}>重试</button></section>;
}

function RailEmptyState({ title, description }: { readonly title: string; readonly description: string }): ReactElement {
  return <section className="rail-card rail-card--state"><strong className="rail-card__title">{title}</strong><p className="rail-card__copy">{description}</p></section>;
}

function AppFrame({
  children,
  onLogout,
  session,
}: {
  readonly children: ReactNode;
  readonly onLogout: () => void;
  readonly session: AuthActiveSession;
}): ReactElement {
  const location = useLocation();
  const leftRailCollapsed = useUiDraftStore((state) => state.leftRailCollapsed);
  const currentActionSummary = useUiDraftStore((state) => state.currentActionSummary);
  const settlementSummary = useUiDraftStore((state) => state.settlementSummary);
  const goalTrackerSummary = useUiDraftStore((state) => state.goalTrackerSummary);
  const setLeftRailCollapsed = useUiDraftStore((state) => state.setLeftRailCollapsed);
  const [logCollapsed, setLogCollapsed] = useState(false);
  const [logChannel, setLogChannel] = useState<'收获' | '战斗' | '活动'>('收获');
  const [rightRailOpen, setRightRailOpen] = useState(() => typeof window === 'undefined' || window.innerWidth >= 1440);
  const [isRightRailOverlay, setIsRightRailOverlay] = useState(() => typeof window === 'undefined' || window.innerWidth < 1440);
  const railRef = useRef<HTMLElement>(null);
  const railToggleRef = useRef<HTMLButtonElement>(null);
  const previousPathname = useRef(location.pathname);
  const [rightRailTab, setRightRailTab] = useState<RightRailTab>('inventory');
  const railTabRefs = useRef<Partial<Record<RightRailTab, HTMLButtonElement | null>>>({});
  const railInventoryQuery = useQuery<InventorySnapshot>({ queryKey: ['global-inventory', session.character_id], queryFn: () => apiClient.getInventory(session.character_id), staleTime: 20_000, refetchInterval: 45_000 });
  const railProgressionQuery = useQuery<CharacterProgression>({ queryKey: ['global-progression', session.character_id], queryFn: () => apiClient.getProgression(session.character_id), staleTime: 20_000, refetchInterval: 45_000 });
  const railAssignmentsQuery = useQuery<SkillToolAssignmentsResponse>({ queryKey: ['global-tool-assignments', session.character_id], queryFn: () => apiClient.getSkillToolAssignments(session.character_id), staleTime: 20_000, refetchInterval: 45_000 });
  const railCaveQuery = useQuery<CaveResponse>({ queryKey: ['global-cave', session.character_id], queryFn: () => apiClient.getCave(session.character_id), staleTime: 20_000, refetchInterval: 45_000 });
  const railOpportunityQuery = useQuery<DungeonOpportunityResponse>({ queryKey: ['global-dungeon-opportunities', session.character_id], queryFn: () => apiClient.getDungeonOpportunities(session.character_id), staleTime: 20_000, refetchInterval: 45_000 });
  const activePresetId = railOpportunityQuery.data?.character.active_loadout_preset_id ?? '';
  const railPresetQuery = useQuery<LoadoutPreset>({ queryKey: ['global-loadout', session.character_id, activePresetId], queryFn: () => apiClient.getLoadoutPreset(session.character_id, activePresetId), enabled: activePresetId.length > 0, staleTime: 20_000, refetchInterval: 45_000 });
  const shellQueueQuery = useQuery<Queue>({
    queryKey: ['global-idle-progress', session.character_id],
    queryFn: () => apiClient.getQueue(session.character_id),
    staleTime: 10_000,
    refetchInterval: 30_000,
  });
  const shellActionView = shellQueueQuery.data === undefined ? null : buildIdleProgressView(shellQueueQuery.data);
  const liveActionSummary = shellActionView === null
    ? currentActionSummary
    : `${shellActionView.paused ? '已暂停' : '正在挂机'} · ${shellActionView.actionLabel}`;

  useEffect(() => {
    const updateRailMode = (): void => {
      const overlay = window.innerWidth < 1440;
      setIsRightRailOverlay(overlay);
      if (!overlay) setRightRailOpen(true);
    };
    window.addEventListener('resize', updateRailMode);
    return () => window.removeEventListener('resize', updateRailMode);
  }, []);

  const closeRightRail = useCallback((): void => {
    setRightRailOpen(false);
    window.requestAnimationFrame(() => railToggleRef.current?.focus());
  }, []);

  const handleRailTabKeyDown = useCallback((event: ReactKeyboardEvent<HTMLButtonElement>): void => {
    if (!['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    const currentIndex = RIGHT_RAIL_TABS.findIndex(([tab]) => tab === rightRailTab);
    if (currentIndex < 0) return;
    const nextIndex = event.key === 'Home'
      ? 0
      : event.key === 'End'
        ? RIGHT_RAIL_TABS.length - 1
        : (currentIndex + (event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 1) + RIGHT_RAIL_TABS.length) % RIGHT_RAIL_TABS.length;
    const nextTab = RIGHT_RAIL_TABS[nextIndex]?.[0];
    if (nextTab === undefined) return;
    event.preventDefault();
    setRightRailTab(nextTab);
    window.requestAnimationFrame(() => railTabRefs.current[nextTab]?.focus());
  }, [rightRailTab]);

  const handleRightRailKeyDown = useCallback((event: ReactKeyboardEvent<HTMLElement>): void => {
    if (!isRightRailOverlay || !rightRailOpen || event.key !== 'Tab') return;
    const rail = railRef.current;
    if (rail === null) return;
    const focusable = Array.from(rail.querySelectorAll<HTMLElement>('button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'));
    if (focusable.length === 0) {
      event.preventDefault();
      rail.focus();
      return;
    }
    const activeElement = document.activeElement;
    const activeIndex = focusable.indexOf(activeElement as HTMLElement);
    if (activeIndex < 0) {
      event.preventDefault();
      (event.shiftKey ? focusable[focusable.length - 1] : focusable[0])?.focus();
      return;
    }
    if (!event.shiftKey && activeIndex === focusable.length - 1) {
      event.preventDefault();
      focusable[0]?.focus();
    } else if (event.shiftKey && activeIndex === 0) {
      event.preventDefault();
      focusable[focusable.length - 1]?.focus();
    }
  }, [isRightRailOverlay, rightRailOpen]);

  useEffect(() => {
    if (!rightRailOpen || !isRightRailOverlay) return undefined;
    const frame = window.requestAnimationFrame(() => railRef.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [isRightRailOverlay, rightRailOpen]);

  useEffect(() => {
    if (!rightRailOpen || !isRightRailOverlay) return undefined;
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') closeRightRail();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [closeRightRail, isRightRailOverlay, rightRailOpen]);

  useEffect(() => {
    if (previousPathname.current === location.pathname) return;
    previousPathname.current = location.pathname;
    if (rightRailOpen) closeRightRail();
  }, [closeRightRail, location.pathname, rightRailOpen]);

  const currentRoute = useMemo(
    () => {
      const directRoute = SHELL_ROUTES.find((route) => location.pathname === route.path || location.pathname.startsWith(`${route.path}/`))
        ?? (location.pathname === '/dashboard/queue' ? SHELL_ROUTES.find((route) => route.id === 'dashboard') : undefined);
      if (directRoute !== undefined) return directRoute;
      const alias = SHELL_ROUTE_ALIASES.find((candidate) => location.pathname === candidate.path || location.pathname.startsWith(`${candidate.path}/`));
      return SHELL_ROUTES.find((route) => route.id === alias?.kind) ?? DEFAULT_SHELL_ROUTE;
    },
    [location.pathname],
  );
  const retryEquipment = async (): Promise<void> => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['global-dungeon-opportunities', session.character_id] }),
      queryClient.invalidateQueries({ queryKey: ['global-inventory', session.character_id] }),
      queryClient.invalidateQueries({ queryKey: ['global-loadout', session.character_id, activePresetId] }),
    ]);
  };
  const retryCave = (): Promise<void> => queryClient.invalidateQueries({ queryKey: ['global-cave', session.character_id] }).then(() => undefined);
  const retryLoadout = async (): Promise<void> => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['global-dungeon-opportunities', session.character_id] }),
      queryClient.invalidateQueries({ queryKey: ['global-loadout', session.character_id, activePresetId] }),
    ]);
  };
  const retrySkills = async (): Promise<void> => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['global-progression', session.character_id] }),
      queryClient.invalidateQueries({ queryKey: ['global-tool-assignments', session.character_id] }),
    ]);
  };

  const railSkillsSummary = railProgressionQuery.data !== undefined && railAssignmentsQuery.data !== undefined
    ? buildSkillsRailSummary(railProgressionQuery.data, railAssignmentsQuery.data)
    : null;
  const navSkills = railProgressionQuery.data?.skills ?? [];
  const navOpportunityCount = railOpportunityQuery.isPending
    ? '读取中'
    : railOpportunityQuery.error !== null && railOpportunityQuery.error !== undefined
      ? '不可用'
      : railOpportunityQuery.data?.opportunity.current_opportunities === undefined
        ? '暂不可用'
        : `${railOpportunityQuery.data.opportunity.current_opportunities} 次`;

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">
        跳到主内容
      </a>
      <header className="app-shell__topbar">
        <div className="brand-block">
          <span className="brand-block__eyebrow">洞天修行</span>
          <div className="brand-block__title-row">
            <h1 className="brand-block__title">洞天</h1>
            <span className="brand-block__version">{SHELL_BRAND_COPY.version}</span>
          </div>
          <p className="brand-block__subtitle">修行工作台</p>
        </div>

        <GlobalIdleProgress characterId={session.character_id} />

        <div className="topbar-buffs" aria-label="修行加成">
          {[
            ['修为', 'XP'],
            ['采集', '采'],
            ['效率', '效'],
            ['战利品', '战'],
          ].map(([label, glyph]) => <span className="topbar-buff" key={label} title={`${label}加成暂不可用`}><strong>{glyph}</strong><small>暂无加成</small></span>)}
        </div>

        <div className="topbar-metrics" aria-label="角色摘要">
          <GlobalResourceSummary characterId={session.character_id} />
          <div className="topbar-profile" aria-label="角色身份">
            <span className="topbar-profile__avatar" aria-hidden="true">修</span>
            <span><strong>角色信息</strong><small>身份信息暂不可用</small></span>
          </div>
          <Link className="topbar-quick-link" to="/inventory" title="背包">背包</Link>
          <Link className="topbar-quick-link" to="/settings" title="设置">设置</Link>
          <button ref={railToggleRef} className="ghost-button shell-rail-toggle" type="button" onClick={() => (rightRailOpen ? closeRightRail() : setRightRailOpen(true))} aria-expanded={rightRailOpen} aria-controls="shell-right-rail">{rightRailOpen ? '收起角色栏' : '查看角色栏'}</button>
          <button className="ghost-button" type="button" onClick={onLogout}>
            离开
          </button>
        </div>
      </header>

      <div className="app-shell__announcer sr-only" aria-live="polite" aria-atomic="true">
        {currentRoute.label} · {liveActionSummary}
      </div>

      <div className="app-shell__workspace">
        <aside className={`shell-nav ${leftRailCollapsed ? 'shell-nav--collapsed' : ''}`}>
          <div className="shell-nav__header">
            <span>导航</span>
            <button className="ghost-button ghost-button--compact" type="button" aria-expanded={!leftRailCollapsed} aria-controls="shell-nav-groups" onClick={() => setLeftRailCollapsed(!leftRailCollapsed)}>
              {leftRailCollapsed ? '展开' : '收起'}
            </button>
          </div>

          <nav className="shell-nav__groups shell-nav__list" id="shell-nav-groups" aria-label="主导航">
            {SHELL_ROUTES.map((route) => (
              <div className="shell-nav__route-group" key={route.id}>
                <NavLink className={({ isActive }) => `shell-nav__link ${isActive ? 'shell-nav__link--active' : ''}`} to={route.path}>
                  <span className="shell-nav__link-icon" aria-hidden="true">{routeGlyph(route.id)}</span>
                  <span className="shell-nav__link-label">{route.label}</span>
                </NavLink>
                {route.children?.map((child) => (
                  <NavLink className={({ isActive }) => `shell-nav__skill-link shell-nav__skill-link--child ${isActive ? 'shell-nav__skill-link--active' : ''}`} key={child.id} to={child.path} end>
                    <span>{child.label}</span>
                    <strong>进入</strong>
                  </NavLink>
                ))}
              </div>
            ))}
          </nav>

          <section className="shell-nav__skill-section" aria-label="百艺技能等级">
            <h2 className="shell-nav__section-title">技能等级</h2>
            {railProgressionQuery.isPending ? <p className="shell-nav__state">正在读取</p> : null}
            {railProgressionQuery.error !== null && railProgressionQuery.error !== undefined ? <p className="shell-nav__state">暂时无法读取</p> : null}
            {!railProgressionQuery.isPending && (railProgressionQuery.error === null || railProgressionQuery.error === undefined) && navSkills.length === 0 ? <p className="shell-nav__state">暂无技能数据</p> : null}
            {navSkills.map((skill) => (
              <Link className="shell-nav__skill-link" key={skill.skill_id} to="/craft">
                <span>{describeSkillId(skill.skill_id)}</span>
                <strong>Lv.{skill.level}</strong>
              </Link>
            ))}
          </section>

          <section className="shell-nav__skill-section" aria-label="战斗与修炼">
            <h2 className="shell-nav__section-title">战斗 / 修炼</h2>
            <NavLink className="shell-nav__skill-link" to="/cultivation">
              <span>修炼</span>
              <strong>{formatPlayerNumber(railProgressionQuery.data?.cultivation.xp)} XP</strong>
            </NavLink>
            <NavLink className="shell-nav__skill-link" to="/expedition">
              <span>历练</span>
              <strong>{navOpportunityCount}</strong>
            </NavLink>
          </section>

          <div className="shell-nav__footer">
            <p>洞天工作台</p>
          </div>
        </aside>

        <main className="shell-main" id="main-content" tabIndex={-1} aria-label={`${currentRoute.label} 主内容`}>
          <div className="shell-main__content">{children}</div>
          <section className={`game-log ${logCollapsed ? 'game-log--collapsed' : ''}`} aria-label="活动日志">
            <div className="game-log__header">
              <div className="game-log__tabs" role="tablist" aria-label="修行记录频道">
                <strong>修行记录</strong>
                {(['收获', '战斗', '活动'] as const).map((channel) => <button key={channel} className={logChannel === channel ? 'game-log__tab game-log__tab--active' : 'game-log__tab'} type="button" role="tab" aria-selected={logChannel === channel} onClick={() => setLogChannel(channel)}>{channel}</button>)}
              </div>
              <button className="ghost-button ghost-button--compact" type="button" onClick={() => setLogCollapsed(!logCollapsed)}>{logCollapsed ? '展开' : '收起'}</button>
            </div>
            {logCollapsed ? null : (
              <>
                <div className="game-log__messages">
                  {logChannel === '收获' ? <><p><time>当前</time><span>{liveActionSummary}</span></p><p><time>最近</time><span>{settlementSummary}</span></p><p><time>目标</time><span>{goalTrackerSummary}</span></p></> : null}
                  {logChannel === '战斗' ? <p><time>暂无</time><span>开始一次秘境历练后，会在这里显示路线和结果。</span></p> : null}
                  {logChannel === '活动' ? <><p><time>状态</time><span>暂无活动记录。</span></p><p><time>记录</time><span>完成行动后会在这里显示。</span></p></> : null}
                </div>
                <div className="game-log__composer" aria-label="聊天功能暂未开放">
                  <input aria-label="聊天输入（暂未开放）" placeholder="聊天系统暂未开放" disabled />
                  <button type="button" disabled>发送</button>
                </div>
              </>
            )}
          </section>
        </main>

        <aside ref={railRef} className={`shell-rail ${rightRailOpen ? 'shell-rail--open' : ''}`} id="shell-right-rail" role={isRightRailOverlay ? 'dialog' : 'complementary'} aria-modal={isRightRailOverlay && rightRailOpen} aria-hidden={isRightRailOverlay ? !rightRailOpen : undefined} aria-labelledby="shell-right-rail-title" tabIndex={isRightRailOverlay ? -1 : undefined} onKeyDown={handleRightRailKeyDown}>
          <div className="shell-rail__header">
            <div>
              <p className="shell-rail__eyebrow">角色信息</p>
              <h3 className="shell-rail__title" id="shell-right-rail-title">角色与背包</h3>
            </div>
          </div>

          <nav className="rail-tabs" role="tablist" aria-label="角色面板">
            {RIGHT_RAIL_TABS.map(([tab, label]) => (
              <button key={tab} ref={(element) => { railTabRefs.current[tab] = element; }} id={`rail-tab-${tab}`} className={rightRailTab === tab ? 'rail-tab rail-tab--active' : 'rail-tab'} type="button" role="tab" aria-selected={rightRailTab === tab} aria-controls={rightRailTab === tab ? `rail-panel-${tab}` : undefined} tabIndex={rightRailTab === tab ? 0 : -1} onKeyDown={handleRailTabKeyDown} onClick={() => setRightRailTab(tab)}>{label}</button>
            ))}
          </nav>

          <div className="rail-tabs__panel" role="tabpanel" id={`rail-panel-${rightRailTab}`} aria-labelledby={`rail-tab-${rightRailTab}`}>
            {rightRailTab === 'inventory' ? <GlobalInventorySummary characterId={session.character_id} /> : null}
            {rightRailTab === 'equipment' ? (
              railOpportunityQuery.isPending || railInventoryQuery.isPending || (activePresetId.length > 0 && railPresetQuery.isPending)
                ? <RailLoadingState title="正在读取角色装备" />
                : (railOpportunityQuery.error !== null && railOpportunityQuery.error !== undefined) || (railInventoryQuery.error !== null && railInventoryQuery.error !== undefined) || (activePresetId.length > 0 && railPresetQuery.error !== null && railPresetQuery.error !== undefined)
                  ? <RailErrorState title="角色装备暂时无法读取" onRetry={retryEquipment} />
                  : activePresetId.length === 0
                    ? <RailEmptyState title="尚未设置装备方案" description="先在角色页设置一套装备方案，右栏才会显示槽位。" />
                    : railPresetQuery.data === undefined || railInventoryQuery.data === undefined
                      ? <RailLoadingState title="正在读取角色装备" />
                      : <section className="rail-card"><strong className="rail-card__title">角色装备</strong><div className="rail-summary-list">{buildEquipmentRailSummary(railPresetQuery.data, railInventoryQuery.data).slots.map((slot) => <p key={slot.label}><span>{slot.label}</span><strong>{slot.value}</strong></p>)}</div><Link className="ghost-button" to="/character">打开装备</Link></section>
            ) : null}
            {rightRailTab === 'skills' ? (
              railProgressionQuery.error !== null && railProgressionQuery.error !== undefined || railAssignmentsQuery.error !== null && railAssignmentsQuery.error !== undefined
                ? <RailErrorState title="修行技能暂时无法读取" onRetry={retrySkills} />
                : railProgressionQuery.isPending || railAssignmentsQuery.isPending || railSkillsSummary === null
                  ? <RailLoadingState title="正在读取修行技能" />
                  : railProgressionQuery.data?.skills.length === 0
                    ? <RailEmptyState title="等级暂不可用" description="当前角色的技能等级数据尚未返回。" />
                    : railSkillsSummary.skills.length === 0
                      ? <RailEmptyState title="暂无修行技能" description="当前角色还没有可展示的修行技能。" />
                    : <section className="rail-card"><strong className="rail-card__title">修行技能</strong><p className="rail-card__copy">{railSkillsSummary.cultivation}</p><div className="rail-summary-list">{railSkillsSummary.skills.map((skill) => <p key={skill.label}><span>{skill.label}</span><strong>{skill.value}</strong></p>)}</div><Link className="ghost-button" to="/craft">打开百艺</Link></section>
            ) : null}
            {rightRailTab === 'cave' ? (
              railCaveQuery.isPending
                ? <RailLoadingState title="正在读取洞府设施" />
                : railCaveQuery.error !== null && railCaveQuery.error !== undefined
                  ? <RailErrorState title="洞府设施暂时无法读取" onRetry={retryCave} />
                  : railCaveQuery.data === undefined
                    ? <RailLoadingState title="正在读取洞府设施" />
                    : railCaveQuery.data.cave.facilities.length === 0
                      ? <RailEmptyState title="暂无洞府设施" description="当前角色还没有可展示的洞府设施。" />
                      : <section className="rail-card"><strong className="rail-card__title">洞天设施</strong><div className="rail-summary-list">{buildCaveRailSummary(railCaveQuery.data).facilities.map((facility) => <p key={facility.label}><span>{facility.label}</span><strong>{facility.value}</strong></p>)}</div><Link className="ghost-button" to="/dashboard/cave">查看设施</Link></section>
            ) : null}
            {rightRailTab === 'loadout' ? (
              railOpportunityQuery.isPending || (activePresetId.length > 0 && railPresetQuery.isPending)
                ? <RailLoadingState title="正在读取出战配装" />
                : railOpportunityQuery.error !== null && railOpportunityQuery.error !== undefined || (activePresetId.length > 0 && railPresetQuery.error !== null && railPresetQuery.error !== undefined)
                  ? <RailErrorState title="出战配装暂时无法读取" onRetry={retryLoadout} />
                  : activePresetId.length === 0 || railPresetQuery.data === undefined
                    ? <RailEmptyState title="尚未设置出战配装" description="在角色页启用一套配装后，秘境才会采用它。" />
                    : <section className="rail-card"><strong className="rail-card__title">{buildLoadoutRailSummary(railPresetQuery.data).name}</strong><p className="rail-card__copy">{buildLoadoutRailSummary(railPresetQuery.data).status}</p><p className="rail-card__note">{buildLoadoutRailSummary(railPresetQuery.data).consumables}</p><Link className="ghost-button" to="/character">管理配装</Link></section>
            ) : null}
          </div>

        </aside>
        <button className={`shell-rail__backdrop ${rightRailOpen ? 'shell-rail__backdrop--open' : ''}`} type="button" aria-label="关闭闭关面板" onClick={closeRightRail} />
      </div>

      <nav className="shell-mobile-nav" aria-label="移动端主导航">
        {SHELL_ROUTES.map((route) => (
          <NavLink
            key={route.id}
            className={({ isActive }) => `shell-mobile-nav__link ${isActive ? 'shell-mobile-nav__link--active' : ''}`}
            to={route.path}
            title={route.description}
          >
            {route.label}
          </NavLink>
        ))}
      </nav>

    </div>
  );
}

function AppRoutes(): ReactElement {
  const auth = useAuthBootstrap();
  const location = useLocation();
  const navigate = useNavigate();

  useEffect(() => {
    if (auth.status === 'authenticated' && (location.pathname === '/' || location.pathname === '')) {
      startTransition(() => {
        navigate('/cultivation', { replace: true });
      });
    }
  }, [auth.status, location.pathname, navigate]);

  if (auth.status === 'loading') {
    return (
      <div className="app-boot">
        <LoadingStateScreen
          title="正在初始化匿名会话"
          description="先获取首页所需的基础状态，再进入洞天主页。"
          footnote="网络不稳时可以重试，维护期间会暂时关闭入口。"
        />
      </div>
    );
  }

  if (auth.status === 'maintenance') {
    return (
      <div className="app-boot">
        <MaintenanceStateScreen
          title="服务维护中"
          description="暂时无法读取会话或配置清单。"
          actions={[{ label: '重试', onClick: auth.retry }]}
          footnote={auth.lastError ?? '配置或依赖不可用。'}
        />
      </div>
    );
  }

  if (auth.status === 'error') {
    return (
      <div className="app-boot">
        <LocalErrorStateScreen
          title="网络错误"
          description="会话读取失败，保留当前进度并允许重试。"
          actions={[
            { label: '重试', onClick: auth.retry },
            { label: '匿名重建', onClick: auth.createAnonymousSession },
          ]}
          footnote={auth.lastError ?? undefined}
        />
      </div>
    );
  }

  if (auth.status === 'signed-out') {
    return (
      <div className="app-boot">
        <EmptyStateScreen
          title="会话已退出"
          description="点击按钮重新创建匿名测试会话并进入受保护首页。"
          actions={[{ label: '重新进入匿名会话', onClick: auth.createAnonymousSession }]}
          footnote="首次进入会自动创建匿名会话；显式退出后不会自动重新登录。"
        />
      </div>
    );
  }

  if (auth.status === 'locked') {
    return (
      <div className="app-boot">
        <LockedStateScreen
          title="账号被锁定"
          description="当前会话已认证，但账号状态不是 ACTIVE。"
          actions={[{ label: '刷新会话', onClick: auth.retry }, { label: '退出', onClick: auth.logout }]}
        />
      </div>
    );
  }

  if (auth.session === null) {
    return (
      <div className="app-boot">
        <LoadingStateScreen title="等待会话" description="匿名会话即将创建。" />
      </div>
    );
  }

  return (
    <AppFrame session={auth.session} onLogout={auth.logout}>
      <Outlet context={auth.session} />
    </AppFrame>
  );
}

const router = createBrowserRouter([
  {
    path: '/',
    element: <AppRoutes />,
    children: [
      { index: true, element: <Navigate to="/cultivation" replace /> },
      { path: 'dashboard', element: <Navigate to="/dashboard/cave" replace /> },
      { path: 'dashboard/queue', element: <DashboardPage /> },
      { path: 'dashboard/cave', element: <CavePage /> },
      { path: 'cultivation', element: <CultivationPage /> },
      { path: 'cultivation/breakthrough', element: <BreakthroughPage /> },
      { path: 'craft', element: <CraftPage /> },
      { path: 'craft/herbalism', element: <HerbalismPage /> },
      { path: 'craft/mining', element: <MiningPage /> },
      { path: 'craft/alchemy', element: <AlchemyPage /> },
      { path: 'craft/forging', element: <ForgingPage /> },
      { path: 'expedition', element: <CombatPage /> },
      { path: 'character', element: <CharacterEquipmentPage /> },
      { path: 'character/tools', element: <CharacterToolAssignmentsPage /> },
      { path: 'inventory', element: <InventoryPage /> },
      { path: 'settings', element: <SettingsPage /> },
      { path: 'tasks', element: <ReferencePage kind="tasks" /> },
      { path: 'maze', element: <Navigate to="/expedition" replace /> },
      { path: 'shops', element: <ReferencePage kind="shops" /> },
      { path: 'store', element: <ReferencePage kind="store" /> },
      { path: 'cowbell-shop', element: <ReferencePage kind="cowbell-shop" /> },
      { path: 'achievements', element: <ReferencePage kind="achievements" /> },
      { path: 'leaderboard', element: <ReferencePage kind="leaderboard" /> },
      { path: 'guild', element: <ReferencePage kind="guild" /> },
      { path: 'social', element: <ReferencePage kind="social" /> },
      { path: 'guide', element: <ReferencePage kind="guide" /> },
      { path: 'rules', element: <ReferencePage kind="rules" /> },
      { path: 'news', element: <ReferencePage kind="news" /> },
      { path: 'changelog', element: <ReferencePage kind="changelog" /> },
      ...SHELL_ROUTE_ALIASES.map((alias) => ({ path: alias.path.slice(1), element: <ReferencePage kind={alias.kind} /> })),
    ],
  },
]);

export const appQueryClient = queryClient;

function GlobalGameFeedback(): ReactElement | null {
  const [feedback, setFeedback] = useState<GameFeedbackDetail | null>(null);

  useEffect(() => subscribeGameFeedback(setFeedback), []);
  useEffect(() => {
    if (feedback === null) return undefined;
    const timer = window.setTimeout(() => setFeedback(null), 3600);
    return () => window.clearTimeout(timer);
  }, [feedback]);

  if (feedback === null) return null;
  return <div className={`game-feedback game-feedback--${feedback.tone ?? 'info'}`} role="status" aria-label="操作反馈">{feedback.message}</div>;
}

export function App(): ReactElement {
  return (
    <QueryClientProvider client={queryClient}>
      <GlobalGameFeedback />
      <RouterProvider router={router} />
    </QueryClientProvider>
  );
}
