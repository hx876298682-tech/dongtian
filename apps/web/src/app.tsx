import { startTransition, useEffect, useMemo, useState, type ReactElement, type ReactNode } from 'react';
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
import { ExpeditionPage } from './features/expedition/expedition-page.js';
import { BreakthroughPage } from './features/breakthrough/breakthrough-page.js';
import { SettingsPage } from './features/system/settings-page.js';
import { ReferencePage } from './features/system/reference-pages.js';
import { DEFAULT_SHELL_ROUTE, SHELL_BRAND_COPY, SHELL_ROUTES } from './navigation.js';
import { useUiDraftStore } from './state/ui-draft-store.js';
import type { AuthActiveSession, CharacterProgression, InventoryAsset, InventorySnapshot, Queue } from '@dongtian/contracts';
import { apiClient } from './lib/api.js';
import { buildIdleProgressView } from './features/dashboard/dashboard-adapter.js';
import { emitGameFeedback, subscribeGameFeedback, type GameFeedbackDetail } from './lib/game-feedback.js';

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
      <button className="global-idle-progress__stop" type="button" onClick={() => pauseMutation.mutate()} disabled={view.paused || pauseMutation.isPending}>
        {view.paused ? '已暂停' : pauseMutation.isPending ? '停止中' : '停止'}
      </button>
    </div>
  );
}

function inventoryLabel(asset: InventoryAsset): string {
  const parts = asset.asset_id.split('.');
  const raw = parts.at(-1) ?? asset.asset_id;
  return raw.replaceAll('_', ' ');
}

function realmLabel(realmStageId: string | undefined): string {
  if (realmStageId === 'realm.mortal.entry') return '炼气入门';
  if (realmStageId === 'realm.mortal.foundation') return '筑基初成';
  if (realmStageId?.startsWith('realm.')) return '修行中';
  return '初入洞天';
}

function formatPlayerNumber(value: string | number | undefined): string {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return '0';
  return new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 2 }).format(numeric);
}

function GlobalInventorySummary({ characterId }: { readonly characterId: string }): ReactElement {
  const inventoryQuery = useQuery<InventorySnapshot>({
    queryKey: ['global-inventory', characterId],
    queryFn: () => apiClient.getInventory(characterId),
    staleTime: 20_000,
    refetchInterval: 45_000,
  });
  const assets = inventoryQuery.data === undefined ? [] : [...inventoryQuery.data.currencies, ...inventoryQuery.data.items].slice(0, 12);

  return (
    <section className="rail-inventory" aria-label="角色背包摘要">
      <div className="rail-inventory__header"><strong>背包</strong><span>{inventoryQuery.data?.total_count ?? 0} 件</span></div>
      <div className="rail-inventory__grid">
        {assets.map((asset) => (
          <div className="rail-inventory__item" key={`${asset.asset_type}-${asset.asset_id}`} title={asset.asset_id}>
            <span>{inventoryLabel(asset)}</span>
            <strong>{asset.available_quantity}</strong>
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
    queryKey: ['global-resources', characterId],
    queryFn: () => apiClient.getInventory(characterId),
    staleTime: 20_000,
    refetchInterval: 45_000,
  });
  const currencies = inventoryQuery.data?.currencies.slice(0, 1) ?? [];

  return (
    <div className="topbar-resources" aria-label="角色资源">
      <div className="topbar-resource"><span>境界</span><strong>{realmLabel(progressionQuery.data?.cultivation.realm_stage_id)}</strong></div>
      <div className="topbar-resource"><span>修为</span><strong>{formatPlayerNumber(progressionQuery.data?.cultivation.xp)}</strong></div>
      <div className="topbar-resource"><span>灵石</span><strong>{currencies[0]?.available_quantity ?? 0}</strong></div>
    </div>
  );
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
  const rightRailPinned = useUiDraftStore((state) => state.rightRailPinned);
  const activeRailSection = useUiDraftStore((state) => state.activeRailSection);
  const currentActionSummary = useUiDraftStore((state) => state.currentActionSummary);
  const settlementSummary = useUiDraftStore((state) => state.settlementSummary);
  const goalTrackerSummary = useUiDraftStore((state) => state.goalTrackerSummary);
  const queueDraftTitle = useUiDraftStore((state) => state.queueDraftTitle);
  const queueDraftNote = useUiDraftStore((state) => state.queueDraftNote);
  const setLeftRailCollapsed = useUiDraftStore((state) => state.setLeftRailCollapsed);
  const setRightRailPinned = useUiDraftStore((state) => state.setRightRailPinned);
  const setActiveRailSection = useUiDraftStore((state) => state.setActiveRailSection);
  const [logCollapsed, setLogCollapsed] = useState(false);
  const [logChannel, setLogChannel] = useState<'收获' | '战斗' | '活动'>('收获');
  const [rightRailTab, setRightRailTab] = useState<'inventory' | 'equipment' | 'skills' | 'cave' | 'loadout'>('inventory');
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

  const currentRoute = useMemo(
    () => SHELL_ROUTES.find((route) => location.pathname === route.path || location.pathname.startsWith(`${route.path}/`)) ?? DEFAULT_SHELL_ROUTE,
    [location.pathname],
  );

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
          <p className="brand-block__subtitle">散修 · 洞天一隅</p>
        </div>

        <GlobalIdleProgress characterId={session.character_id} />

        <div className="topbar-metrics" aria-label="角色摘要">
          <GlobalResourceSummary characterId={session.character_id} />
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
            <button className="ghost-button ghost-button--compact" type="button" onClick={() => setLeftRailCollapsed(!leftRailCollapsed)}>
              {leftRailCollapsed ? '展开' : '收起'}
            </button>
          </div>

          <div className="shell-nav__groups">
            <section className="shell-nav__group">
              <h2 className="shell-nav__group-title">修行</h2>
              <nav className="shell-nav__list" aria-label="主导航：修行">
                {SHELL_ROUTES.filter((route) => ['dashboard', 'cultivation', 'craft'].includes(route.id)).map((route) => (
                  <NavLink key={route.id} className={({ isActive }) => `shell-nav__link ${isActive ? 'shell-nav__link--active' : ''}`} to={route.path}>
                    <span className="shell-nav__link-label">{route.label}</span>
                    <span className="shell-nav__link-desc">{route.description}</span>
                  </NavLink>
                ))}
              </nav>
            </section>
            <section className="shell-nav__group">
              <h2 className="shell-nav__group-title">冒险</h2>
              <nav className="shell-nav__list" aria-label="主导航：冒险">
                {SHELL_ROUTES.filter((route) => ['expedition', 'maze', 'shops', 'tasks'].includes(route.id)).map((route) => (
                  <NavLink key={route.id} className={({ isActive }) => `shell-nav__link ${isActive ? 'shell-nav__link--active' : ''}`} to={route.path}>
                    <span className="shell-nav__link-label">{route.label}</span>
                    <span className="shell-nav__link-desc">{route.description}</span>
                  </NavLink>
                ))}
              </nav>
            </section>
            <section className="shell-nav__group">
              <h2 className="shell-nav__group-title">角色</h2>
              <nav className="shell-nav__list" aria-label="主导航：角色">
                {SHELL_ROUTES.filter((route) => ['character', 'inventory', 'achievements', 'leaderboard'].includes(route.id)).map((route) => (
                  <NavLink key={route.id} className={({ isActive }) => `shell-nav__link ${isActive ? 'shell-nav__link--active' : ''}`} to={route.path}>
                    <span className="shell-nav__link-label">{route.label}</span>
                    <span className="shell-nav__link-desc">{route.description}</span>
                  </NavLink>
                ))}
              </nav>
            </section>
            <section className="shell-nav__group">
              <h2 className="shell-nav__group-title">社交</h2>
              <nav className="shell-nav__list" aria-label="主导航：社交">
                {SHELL_ROUTES.filter((route) => ['guild', 'social'].includes(route.id)).map((route) => (
                  <NavLink key={route.id} className={({ isActive }) => `shell-nav__link ${isActive ? 'shell-nav__link--active' : ''}`} to={route.path}>
                    <span className="shell-nav__link-label">{route.label}</span>
                    <span className="shell-nav__link-desc">{route.description}</span>
                  </NavLink>
                ))}
              </nav>
            </section>
            <section className="shell-nav__group">
              <h2 className="shell-nav__group-title">其他</h2>
              <nav className="shell-nav__list" aria-label="主导航：其他">
                {SHELL_ROUTES.filter((route) => ['settings', 'guide', 'rules', 'news'].includes(route.id)).map((route) => (
                  <NavLink key={route.id} className={({ isActive }) => `shell-nav__link ${isActive ? 'shell-nav__link--active' : ''}`} to={route.path}>
                    <span className="shell-nav__link-label">{route.label}</span>
                    <span className="shell-nav__link-desc">{route.description}</span>
                  </NavLink>
                ))}
              </nav>
            </section>
          </div>

          <div className="shell-nav__footer">
            <p>洞天在线</p>
          </div>
        </aside>

        <main className="shell-main" id="main-content" tabIndex={-1} aria-label={`${currentRoute.label} 主内容`}>
          <div className="shell-main__hero">
            <div>
              <p className="shell-main__eyebrow">{SHELL_BRAND_COPY.workspace}</p>
              <h2 className="shell-main__title">{currentRoute.label}</h2>
            </div>
            <p className="shell-main__copy">{currentRoute.description}</p>
          </div>

          <div className="shell-main__content">{children}</div>
          <section className={`game-log ${logCollapsed ? 'game-log--collapsed' : ''}`} aria-label="活动日志">
            <div className="game-log__header">
              <div className="game-log__tabs"><strong>修行记录</strong>{(['收获', '战斗', '活动'] as const).map((channel) => <button key={channel} className={logChannel === channel ? 'game-log__tab game-log__tab--active' : 'game-log__tab'} type="button" onClick={() => setLogChannel(channel)}>{channel}</button>)}</div>
              <button className="ghost-button ghost-button--compact" type="button" onClick={() => setLogCollapsed(!logCollapsed)}>{logCollapsed ? '展开' : '收起'}</button>
            </div>
            {logCollapsed ? null : (
              <div className="game-log__messages">
                {logChannel === '收获' ? <><p><time>当前</time><span>{liveActionSummary}</span></p><p><time>最近</time><span>{settlementSummary}</span></p><p><time>目标</time><span>{goalTrackerSummary}</span></p></> : null}
                {logChannel === '战斗' ? <p><time>暂无</time><span>还没有新的秘境战斗记录，开始一次探险后会显示路线和结果。</span></p> : null}
                {logChannel === '活动' ? <><p><time>修行</time><span>洞天安稳运转，挂机会在切页后继续。</span></p><p><time>活动</time><span>新的修行记录会在这里出现。</span></p></> : null}
              </div>
            )}
          </section>
        </main>

        <aside className={`shell-rail ${rightRailPinned ? 'shell-rail--pinned' : ''}`}>
          <div className="shell-rail__header">
            <div>
              <p className="shell-rail__eyebrow">角色信息</p>
              <h3 className="shell-rail__title">角色与背包</h3>
            </div>
            <button className="ghost-button ghost-button--compact" type="button" onClick={() => setRightRailPinned(!rightRailPinned)}>
              {rightRailPinned ? '取消固定' : '固定'}
            </button>
          </div>

          <nav className="rail-tabs" aria-label="角色面板">
            {([
              ['inventory', '战利品'],
              ['equipment', '装备'],
              ['skills', '技能'],
              ['cave', '洞府'],
              ['loadout', '配装'],
            ] as const).map(([tab, label]) => (
              <button key={tab} className={rightRailTab === tab ? 'rail-tab rail-tab--active' : 'rail-tab'} type="button" onClick={() => setRightRailTab(tab)}>{label}</button>
            ))}
          </nav>

          {rightRailTab === 'inventory' ? <GlobalInventorySummary characterId={session.character_id} /> : null}
          {rightRailTab === 'equipment' ? <section className="rail-card"><strong className="rail-card__title">角色装备</strong><p className="rail-card__copy">查看装备槽位、比较属性并进行淬炼。</p><Link className="ghost-button" to="/character">打开装备</Link></section> : null}
          {rightRailTab === 'skills' ? <section className="rail-card"><strong className="rail-card__title">修行技能</strong><p className="rail-card__copy">修炼、采集、炼丹和炼器会持续影响挂机收益。</p><Link className="ghost-button" to="/craft">打开百艺</Link></section> : null}
          {rightRailTab === 'cave' ? <section className="rail-card"><strong className="rail-card__title">洞天设施</strong><p className="rail-card__copy">聚灵室、炼丹房和炼器房提供长期修行加成。</p><Link className="ghost-button" to="/dashboard/cave">查看设施</Link></section> : null}
          {rightRailTab === 'loadout' ? <section className="rail-card"><strong className="rail-card__title">出战配装</strong><p className="rail-card__copy">秘境探险会使用角色页保存的装备方案。</p><Link className="ghost-button" to="/character">管理配装</Link></section> : null}

          <section className="rail-card rail-card--status">
            <div className="rail-card__header"><span className="rail-card__slot">当前</span><strong className="rail-card__title">{liveActionSummary}</strong></div>
            <p className="rail-card__copy">{settlementSummary}</p>
          </section>

          <section className="rail-card rail-card--draft">
            <div className="rail-card__header">
              <strong className="rail-card__title">{SHELL_BRAND_COPY.draft}</strong>
              <span className="rail-card__slot">{{ 'current-action': '正在进行', 'settlement-summary': '最近收获', 'goal-tracker': '下一境界', 'slot-placeholder': '更多信息' }[activeRailSection]}</span>
            </div>
            <p className="rail-card__copy">{queueDraftTitle}</p>
            <p className="rail-card__note">{queueDraftNote}</p>
            <div className="rail-card__actions">
              {(['current-action', 'settlement-summary', 'goal-tracker', 'slot-placeholder'] as const).map((section) => (
                <button key={section} className="chip-button" type="button" onClick={() => setActiveRailSection(section)}>
                  {{ 'current-action': '正在进行', 'settlement-summary': '最近收获', 'goal-tracker': '下一境界', 'slot-placeholder': '更多信息' }[section]}
                </button>
              ))}
            </div>
          </section>
        </aside>
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

      <footer className="app-shell__footer" role="contentinfo">
        洞天活动日志
      </footer>
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
        navigate('/dashboard', { replace: true });
      });
    }
  }, [auth.status, location.pathname, navigate]);

  if (auth.status === 'loading') {
    return (
      <div className="app-boot">
        <LoadingStateScreen
          title="正在初始化匿名会话"
          description="先获取受保护首页所需的最小权威数据，再进入骨架主页。"
          footnote="网络错误可重试，503 会切换到维护态。"
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
          description="会话读取失败，保留本地草稿并允许重试。"
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
      { index: true, element: <Navigate to="/dashboard" replace /> },
      { path: 'dashboard', element: <DashboardPage /> },
      { path: 'dashboard/cave', element: <CavePage /> },
      { path: 'cultivation', element: <BreakthroughPage /> },
      { path: 'craft', element: <CraftPage /> },
      { path: 'expedition', element: <ExpeditionPage /> },
      { path: 'character', element: <CharacterEquipmentPage /> },
      { path: 'character/tools', element: <CharacterToolAssignmentsPage /> },
      { path: 'inventory', element: <InventoryPage /> },
      { path: 'settings', element: <SettingsPage /> },
      { path: 'tasks', element: <ReferencePage kind="tasks" /> },
      { path: 'maze', element: <ReferencePage kind="maze" /> },
      { path: 'shops', element: <ReferencePage kind="shops" /> },
      { path: 'achievements', element: <ReferencePage kind="achievements" /> },
      { path: 'leaderboard', element: <ReferencePage kind="leaderboard" /> },
      { path: 'guild', element: <ReferencePage kind="guild" /> },
      { path: 'social', element: <ReferencePage kind="social" /> },
      { path: 'guide', element: <ReferencePage kind="guide" /> },
      { path: 'rules', element: <ReferencePage kind="rules" /> },
      { path: 'news', element: <ReferencePage kind="news" /> },
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
