import { startTransition, useEffect, useMemo, type ReactElement, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  Navigate,
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
import { CharacterEquipmentPage } from './features/character/equipment-page.js';
import { CharacterToolAssignmentsPage } from './features/character/tool-assignments-page.js';
import { CraftPage, InventoryPage } from './features/content/content-page.js';
import { ExpeditionPage } from './features/expedition/expedition-page.js';
import { DEFAULT_SHELL_ROUTE, SHELL_PANELS, SHELL_ROUTES } from './navigation.js';
import { useUiDraftStore } from './state/ui-draft-store.js';
import type { AuthActiveSession } from '@dongtian/contracts';

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

function formatDateTime(value: string | undefined): string {
  if (!value) {
    return '待同步';
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat('zh-CN', {
    dateStyle: 'medium',
    timeStyle: 'short',
    hour12: false,
    timeZone: 'Asia/Shanghai',
  }).format(date);
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
          <span className="brand-block__eyebrow">DONGTIAN / Web Shell</span>
          <div className="brand-block__title-row">
            <h1 className="brand-block__title">洞天</h1>
            <span className="brand-block__version">M2 骨架</span>
          </div>
          <p className="brand-block__subtitle">
            匿名测试身份 · 会话到期 {formatDateTime(session.session_expires_at)} · 角色 {session.character_id.slice(0, 8)}
          </p>
        </div>

        <div className="topbar-metrics" aria-label="角色摘要">
          <div className="metric-chip">
            <span className="metric-chip__label">当前页</span>
            <strong className="metric-chip__value" title={currentRoute.label}>
              {currentRoute.label}
            </strong>
          </div>
          <div className="metric-chip">
            <span className="metric-chip__label">连接</span>
            <strong className="metric-chip__value" title="CSRF 已就绪">
              CSRF 已就绪
            </strong>
          </div>
          <div className="metric-chip">
            <span className="metric-chip__label">状态版本</span>
            <strong className="metric-chip__value" title="受保护">
              受保护
            </strong>
          </div>
          <button className="ghost-button" type="button" onClick={onLogout}>
            退出匿名会话
          </button>
        </div>
      </header>

      <div className="app-shell__announcer sr-only" aria-live="polite" aria-atomic="true">
        {currentRoute.label} · {currentActionSummary}
      </div>

      <div className="app-shell__workspace">
        <aside className={`shell-nav ${leftRailCollapsed ? 'shell-nav--collapsed' : ''}`}>
          <div className="shell-nav__header">
            <span>导航</span>
            <button className="ghost-button ghost-button--compact" type="button" onClick={() => setLeftRailCollapsed(!leftRailCollapsed)}>
              {leftRailCollapsed ? '展开' : '收起'}
            </button>
          </div>

          <nav className="shell-nav__list" aria-label="主导航">
            {SHELL_ROUTES.map((route) => (
              <NavLink key={route.id} className={({ isActive }) => `shell-nav__link ${isActive ? 'shell-nav__link--active' : ''}`} to={route.path}>
                <span className="shell-nav__link-label">{route.label}</span>
                <span className="shell-nav__link-desc">{route.description}</span>
              </NavLink>
            ))}
          </nav>

          <div className="shell-nav__footer">
            <p>市场、坊市和跨玩家交易当前不在 MVP。</p>
          </div>
        </aside>

        <main className="shell-main" id="main-content" tabIndex={-1} aria-label={`${currentRoute.label} 主内容`}>
          <div className="shell-main__hero">
            <div>
              <p className="shell-main__eyebrow">桌面三栏骨架</p>
              <h2 className="shell-main__title">{currentRoute.label}</h2>
            </div>
            <p className="shell-main__copy">{currentRoute.description}</p>
          </div>

          <div className="shell-main__content">{children}</div>
        </main>

        <aside className={`shell-rail ${rightRailPinned ? 'shell-rail--pinned' : ''}`}>
          <div className="shell-rail__header">
            <div>
              <p className="shell-rail__eyebrow">常驻右栏</p>
              <h3 className="shell-rail__title">闭关与草稿</h3>
            </div>
            <button className="ghost-button ghost-button--compact" type="button" onClick={() => setRightRailPinned(!rightRailPinned)}>
              {rightRailPinned ? '取消固定' : '固定'}
            </button>
          </div>

          {SHELL_PANELS.map((panel) => (
            <section key={panel.id} className="rail-card">
              <div className="rail-card__header">
                <span className="rail-card__slot">{panel.slot}</span>
                <strong className="rail-card__title">{panel.title}</strong>
              </div>
              <p className="rail-card__copy">
                {panel.id === 'current-action'
                  ? currentActionSummary
                  : panel.id === 'settlement-summary'
                    ? settlementSummary
                    : goalTrackerSummary}
              </p>
            </section>
          ))}

          <section className="rail-card rail-card--draft">
            <div className="rail-card__header">
              <strong className="rail-card__title">UI 草稿</strong>
              <span className="rail-card__slot">{activeRailSection}</span>
            </div>
            <p className="rail-card__copy">{queueDraftTitle}</p>
            <p className="rail-card__note">{queueDraftNote}</p>
            <div className="rail-card__actions">
              {(['current-action', 'settlement-summary', 'goal-tracker', 'slot-placeholder'] as const).map((section) => (
                <button key={section} className="chip-button" type="button" onClick={() => setActiveRailSection(section)}>
                  {section}
                </button>
              ))}
            </div>
          </section>
        </aside>
      </div>

      <footer className="app-shell__footer" role="contentinfo">
        状态 / 错误 / 保存反馈
      </footer>
    </div>
  );
}

function PagePlaceholder({ title, description }: { readonly title: string; readonly description: string }): ReactElement {
  return (
    <section className="page-grid">
      <article className="page-card page-card--hero">
        <p className="page-card__eyebrow">{title}</p>
        <h3 className="page-card__title">{description}</h3>
        <p className="page-card__copy">当前只提供壳和插槽。实际内容会在后续垂直切片填充。</p>
      </article>
      <article className="page-card">
        <LoadingStateScreen title="加载态" description="该区域保留加载骨架与渐进填充。" />
      </article>
      <article className="page-card">
        <EmptyStateScreen title="空态" description="没有真实数据时，保留明确的空状态而不是假内容。" />
      </article>
      <article className="page-card">
        <MaintenanceStateScreen title="维护态" description="配置或依赖不可用时，保留明确退路。" />
      </article>
    </section>
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
      { path: 'cultivation', element: <PagePlaceholder title="修炼页" description="境界、修为、突破与项目追踪" /> },
      { path: 'craft', element: <CraftPage /> },
      { path: 'expedition', element: <ExpeditionPage /> },
      { path: 'character', element: <CharacterEquipmentPage /> },
      { path: 'character/tools', element: <CharacterToolAssignmentsPage /> },
      { path: 'inventory', element: <InventoryPage /> },
    ],
  },
]);

export const appQueryClient = queryClient;

export function App(): ReactElement {
  return (
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  );
}
