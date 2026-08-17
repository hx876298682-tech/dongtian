import { startTransition, useEffect, useMemo, useReducer, useRef, type ReactElement } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useLocation, useNavigate, useOutletContext } from 'react-router';

import {
  ApiClientError,
  type AuthActiveSession,
  type CharacterProgression,
  type DungeonOpportunityResponse,
  type DungeonPreviewResponse,
  type DungeonRunResponse,
  type InventorySnapshot,
  type LoadoutPreset,
  type Queue,
} from '@dongtian/contracts';
import { EmptyStateScreen, LoadingStateScreen, LockedStateScreen, LocalErrorStateScreen, MaintenanceStateScreen, NormalStateScreen } from '@dongtian/ui';

import { apiClient } from '../../lib/api.js';
import { readActiveDungeonRunId, writeActiveDungeonRunId } from './dungeon-session.js';
import {
  dungeonRouteHint,
  isDungeonRunTimedOut,
  summarizeDungeonOpportunity,
  summarizeDungeonPreview,
  summarizeDungeonRun,
} from './expedition-adapter.js';
import {
  createDungeonPreviewRequest,
  createInitialExpeditionDraft,
  expeditionDraftReducer,
  isExpeditionDraftReady,
  resolveActiveLoadoutPresetId,
  QINGSHE_DUNGEON_ID,
  QINGSHE_HIGH_RISK_CHOICE_ID,
  QINGSHE_HIGH_RISK_ROUTE_ID,
  QINGSHE_SAFE_CHOICE_ID,
  QINGSHE_SAFE_ROUTE_ID,
} from './expedition-reducer.js';

const EXPEDITION_QUERY_PREFIX = 'expedition';

export const EXPEDITION_PRESET_GUIDANCE = '装备预设需要先在角色页选择；策略 safe 已为新手默认，可直接预览。';

function createIdempotencyKey(): string {
  return typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `tmp-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function parseSearch(locationSearch: string): URLSearchParams {
  return new URLSearchParams(locationSearch);
}

function syncSearch(
  navigate: ReturnType<typeof useNavigate>,
  pathname: string,
  locationSearch: string,
  next: Record<string, string | null | undefined>,
): void {
  const params = parseSearch(locationSearch);
  for (const [key, value] of Object.entries(next)) {
    if (value === null || value === undefined || value.length === 0) {
      params.delete(key);
    } else {
      params.set(key, value);
    }
  }

  const nextSearch = params.toString().length > 0 ? `?${params.toString()}` : '';
  if (nextSearch === locationSearch) {
    return;
  }
  navigate({ pathname, search: nextSearch }, { replace: true });
}

function formatDateTime(value: string | null | undefined): string {
  if (typeof value !== 'string' || value.length === 0) {
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

function formatRelativeCountdown(targetAt: string | null | undefined, now = new Date()): string {
  if (typeof targetAt !== 'string' || targetAt.length === 0) {
    return '无';
  }

  const target = new Date(targetAt);
  if (Number.isNaN(target.getTime())) {
    return targetAt;
  }

  const diffMs = target.getTime() - now.getTime();
  if (diffMs <= 0) {
    return '已到期';
  }

  const totalSeconds = Math.floor(diffMs / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
}

function routeLabel(routeId: string): string {
  switch (routeId) {
    case QINGSHE_SAFE_ROUTE_ID:
      return '左侧矿脉';
    case QINGSHE_HIGH_RISK_ROUTE_ID:
      return '右侧妖巢';
    default:
      return routeId;
  }
}

function choiceLabel(choiceId: string): string {
  switch (choiceId) {
    case QINGSHE_SAFE_CHOICE_ID:
      return '安全撤离';
    case QINGSHE_HIGH_RISK_CHOICE_ID:
      return '高风险深入';
    default:
      return choiceId;
  }
}

function useExpeditionQueries(session: AuthActiveSession, loadoutPresetId: string, runId: string | null) {
  const progressionQuery = useQuery<CharacterProgression>({
    queryKey: [EXPEDITION_QUERY_PREFIX, session.character_id, 'progression'],
    queryFn: () => apiClient.getProgression(session.character_id),
  });
  const opportunityQuery = useQuery<DungeonOpportunityResponse>({
    queryKey: [EXPEDITION_QUERY_PREFIX, session.character_id, 'opportunity'],
    queryFn: () => apiClient.getDungeonOpportunities(session.character_id),
    retry: false,
  });
  const inventoryQuery = useQuery<InventorySnapshot>({
    queryKey: [EXPEDITION_QUERY_PREFIX, session.character_id, 'inventory'],
    queryFn: () => apiClient.getInventory(session.character_id),
  });
  const queueQuery = useQuery<Queue>({
    queryKey: [EXPEDITION_QUERY_PREFIX, session.character_id, 'queue'],
    queryFn: () => apiClient.getQueue(session.character_id),
  });
  const loadoutQuery = useQuery<LoadoutPreset>({
    queryKey: [EXPEDITION_QUERY_PREFIX, session.character_id, 'loadout', loadoutPresetId],
    queryFn: () => apiClient.getLoadoutPreset(session.character_id, loadoutPresetId),
    enabled: loadoutPresetId.trim().length > 0,
  });
  const runQuery = useQuery<DungeonRunResponse>({
    queryKey: [EXPEDITION_QUERY_PREFIX, session.character_id, 'run', runId ?? 'none'],
    queryFn: () => {
      if (runId === null) {
        throw new Error('NO_ACTIVE_DUNGEON_RUN');
      }
      return apiClient.getDungeonRunById(runId);
    },
    enabled: runId !== null,
    retry: (failureCount, error) => {
      if (error instanceof ApiClientError && error.status === 404) {
        return false;
      }
      return failureCount < 2;
    },
  });

  return { progressionQuery, opportunityQuery, inventoryQuery, queueQuery, loadoutQuery, runQuery };
}

export function ExpeditionLoading(): ReactElement {
  return (
    <section className="expedition-layout">
      <div className="expedition-panel expedition-panel--hero">
        <LoadingStateScreen title="正在读取青蛇洞权威快照" description="先拉取机会、修为、库存和运行状态，再渲染准备页与运行页。" />
      </div>
      <div className="expedition-panel">
        <LoadingStateScreen title="准备页" description="等待预设、机会和预览数据。" />
      </div>
      <div className="expedition-panel">
        <LoadingStateScreen title="运行页" description="等待 run_id 恢复或新建入场。" />
      </div>
    </section>
  );
}

export function ExpeditionError({ error, onRetry }: { readonly error: string; readonly onRetry: () => void }): ReactElement {
  return (
    <section className="expedition-layout">
      <div className="expedition-panel expedition-panel--hero">
        <LocalErrorStateScreen title="秘境页读取失败" description="权威快照读取失败，已保留本地草稿。" actions={[{ label: '重试', onClick: onRetry }]} footnote={error} />
      </div>
      <div className="expedition-panel">
        <EmptyStateScreen title="准备页" description="读取失败时不展示伪造的秘境数据。" />
      </div>
      <div className="expedition-panel">
        <EmptyStateScreen title="运行页" description="读取失败时不展示伪造的秘境数据。" />
      </div>
    </section>
  );
}

export function ExpeditionMaintenance({ reason, onRetry }: { readonly reason: string; readonly onRetry: () => void }): ReactElement {
  return (
    <section className="expedition-layout">
      <div className="expedition-panel expedition-panel--hero">
        <MaintenanceStateScreen title="秘境服务维护中" description="秘境 API 或依赖当前不可用。" actions={[{ label: '重试', onClick: onRetry }]} footnote={reason} />
      </div>
      <div className="expedition-panel">
        <EmptyStateScreen title="准备页" description="维护期间不展示伪造数据。" />
      </div>
      <div className="expedition-panel">
        <EmptyStateScreen title="运行页" description="维护期间不展示伪造数据。" />
      </div>
    </section>
  );
}

export function ExpeditionLocked({ reason, onRetry }: { readonly reason: string; readonly onRetry: () => void }): ReactElement {
  return (
    <section className="expedition-layout">
      <div className="expedition-panel expedition-panel--hero">
        <LockedStateScreen title="秘境功能受限" description="当前账号已认证，但秘境页没有解锁或没有权限。" actions={[{ label: '重试', onClick: onRetry }]} footnote={reason} />
      </div>
      <div className="expedition-panel">
        <EmptyStateScreen title="准备页" description="当前无法读取秘境机会。" />
      </div>
      <div className="expedition-panel">
        <EmptyStateScreen title="运行页" description="当前无法读取秘境运行。" />
      </div>
    </section>
  );
}

function DungeonChoiceButton({
  choiceId,
  routeId,
  riskLabel,
  label,
  active,
  disabled,
  onSelect,
}: {
  readonly choiceId: string;
  readonly routeId: string;
  readonly riskLabel: string;
  readonly label: string;
  readonly active: boolean;
  readonly disabled: boolean;
  readonly onSelect: () => void;
}): ReactElement {
  return (
    <button className={`expedition-choice ${active ? 'expedition-choice--active' : ''}`} type="button" onClick={onSelect} disabled={disabled} aria-pressed={active}>
      <span className="expedition-choice__row">
        <strong>{label}</strong>
        <span className="equipment-chip">{riskLabel}</span>
      </span>
      <span className="expedition-choice__copy">{routeLabel(routeId)}</span>
      <span className="expedition-choice__note">{dungeonRouteHint(choiceId)}</span>
    </button>
  );
}

function ExpeditionPrepareCard({
  opportunityView,
  loadoutPreset,
  previewView,
  draftLoadoutPresetId,
  draftStrategyPresetId,
  draftInitialRouteId,
  onLoadoutPresetIdChange,
  onStrategyPresetIdChange,
  onInitialRouteIdChange,
  onClaimGrant,
  onPreview,
  onEnter,
  previewPending,
  enterPending,
  canPreview,
  canEnter,
}: {
  readonly opportunityView: ReturnType<typeof summarizeDungeonOpportunity>;
  readonly loadoutPreset: LoadoutPreset | null;
  readonly previewView: ReturnType<typeof summarizeDungeonPreview> | null;
  readonly draftLoadoutPresetId: string;
  readonly draftStrategyPresetId: string;
  readonly draftInitialRouteId: string;
  readonly onLoadoutPresetIdChange: (value: string) => void;
  readonly onStrategyPresetIdChange: (value: string) => void;
  readonly onInitialRouteIdChange: (value: string) => void;
  readonly onClaimGrant: () => void;
  readonly onPreview: () => void;
  readonly onEnter: () => void;
  readonly previewPending: boolean;
  readonly enterPending: boolean;
  readonly canPreview: boolean;
  readonly canEnter: boolean;
}): ReactElement {
  return (
    <div className="expedition-prepare">
      <div className="dashboard-panel__header">
        <div>
          <p className="page-card__eyebrow">青蛇洞 · 准备页</p>
          <h4 className="dashboard-panel__title">{opportunityView.title}</h4>
        </div>
        <div className="dashboard-panel__meta">
          <span>{opportunityView.grantLine}</span>
          <span>机会只读展示，提交仍走服务端校验</span>
        </div>
      </div>

      <div className="expedition-facts">
        {opportunityView.facts.map((fact) => (
          <div key={fact.label} className="expedition-fact">
            <span>{fact.label}</span>
            <strong title={fact.value}>{fact.value}</strong>
          </div>
        ))}
      </div>

      <div className="expedition-form">
        <label className="equipment-form__field">
          <span className="equipment-form__label">装备预设 ID</span>
          <input
            className="equipment-form__input"
            type="text"
            value={draftLoadoutPresetId}
            onChange={(event) => onLoadoutPresetIdChange(event.target.value)}
            placeholder="从角色页复制已保存的预设 ID"
          />
        </label>
        <label className="equipment-form__field">
          <span className="equipment-form__label">策略预设 ID</span>
          <input
            className="equipment-form__input"
            type="text"
            value={draftStrategyPresetId}
            onChange={(event) => onStrategyPresetIdChange(event.target.value)}
            placeholder="默认 strategy.safe"
          />
        </label>
        <label className="equipment-form__field">
          <span className="equipment-form__label">initial_route_id</span>
          <select className="equipment-form__input" value={draftInitialRouteId} onChange={(event) => onInitialRouteIdChange(event.target.value)}>
            <option value={QINGSHE_SAFE_ROUTE_ID}>左侧矿脉 / 安全</option>
            <option value={QINGSHE_HIGH_RISK_ROUTE_ID}>右侧妖巢 / 高风险</option>
          </select>
        </label>
        <div className="equipment-form__field">
          <span className="equipment-form__label">当前预设</span>
          <div className="expedition-inline-note">
            <strong>{loadoutPreset === null ? '未加载' : loadoutPreset.name}</strong>
            <span>{loadoutPreset === null ? EXPEDITION_PRESET_GUIDANCE : `策略 ${loadoutPreset.strategy_id} · 版本 ${loadoutPreset.version}`}</span>
          </div>
        </div>
      </div>

      <div className="expedition-actions">
        <Link className="ghost-button" to="/character">选择装备预设</Link>
        <button className="ghost-button" type="button" onClick={onClaimGrant}>
          领取教学赠送
        </button>
        <button className="ghost-button" type="button" onClick={onPreview} disabled={!canPreview || previewPending}>
          {previewPending ? '预览中…' : '预览'}
        </button>
        <button className="ghost-button" type="button" onClick={onEnter} disabled={!canEnter || enterPending}>
          {enterPending ? '入场中…' : '消耗 1 次机会进入'}
        </button>
      </div>

      {previewView === null ? (
        <EmptyStateScreen title="尚未生成预览" description="先填写预设并点击预览，服务端会返回推荐战力、成功率和路线。" />
      ) : (
        <div className="expedition-preview">
          <NormalStateScreen title={previewView.summary} description="预览只读，不决定掉落或胜负。" highlight="服务端预览" />
          <div className="expedition-facts">
            {previewView.facts.map((fact) => (
              <div key={fact.label} className="expedition-fact">
                <span>{fact.label}</span>
                <strong title={fact.value}>{fact.value}</strong>
              </div>
            ))}
          </div>
          <div className="expedition-mini-grid">
            <section className="expedition-mini-card">
              <h5>进入物</h5>
              {previewView.entryItems.length === 0 ? <p>无额外入场物。</p> : null}
              <ul>
                {previewView.entryItems.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </section>
            <section className="expedition-mini-card">
              <h5>核心掉落</h5>
              <ul>
                {previewView.coreRewards.map((reward) => (
                  <li key={reward}>{reward}</li>
                ))}
              </ul>
            </section>
          </div>
          <div className="expedition-choice-list">
            {previewView.choices.map((choice, index) => (
              <div key={choice.choiceId} className="expedition-choice-shell">
                <DungeonChoiceButton
                  choiceId={choice.choiceId}
                  routeId={choice.routeId}
                  riskLabel={choice.riskLabel}
                  label={choice.label}
                  active={index === 0}
                  disabled={false}
                  onSelect={() => undefined}
                />
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function ExpeditionRuntimeCard({
  runResponse,
  runView,
  onRefresh,
  onChoose,
  onFinalize,
  choosePending,
  finalizePending,
}: {
  readonly runResponse: DungeonRunResponse | null;
  readonly runView: ReturnType<typeof summarizeDungeonRun> | null;
  readonly onRefresh: () => void;
  readonly onChoose: (choiceId: string) => void;
  readonly onFinalize: () => void;
  readonly choosePending: boolean;
  readonly finalizePending: boolean;
}): ReactElement {
  if (runResponse === null || runView === null) {
    return <EmptyStateScreen title="尚未进入秘境" description="进入后这里会显示节点、路线、超时、战斗摘要和结果。" actions={[{ label: '刷新当前运行', onClick: onRefresh }]} />;
  }

  const run = runResponse.run;
  const previewChoices = [
    { choiceId: QINGSHE_SAFE_CHOICE_ID, routeId: QINGSHE_SAFE_ROUTE_ID, riskLabel: '安全', label: choiceLabel(QINGSHE_SAFE_CHOICE_ID) },
    { choiceId: QINGSHE_HIGH_RISK_CHOICE_ID, routeId: QINGSHE_HIGH_RISK_ROUTE_ID, riskLabel: '高风险', label: choiceLabel(QINGSHE_HIGH_RISK_CHOICE_ID) },
  ];
  const canChoose = runView.canChoose && !choosePending;
  const timedOut = isDungeonRunTimedOut(run, new Date());

  return (
    <div className="expedition-runtime">
      <div className="dashboard-panel__header">
        <div>
          <p className="page-card__eyebrow">青蛇洞 · 运行页</p>
          <h4 className="dashboard-panel__title">{runView.headline}</h4>
        </div>
        <div className="dashboard-panel__meta">
          <span>{run.run_id}</span>
          <span>{timedOut ? '已超时，等待服务端恢复' : formatRelativeCountdown(run.choice_deadline_at)}</span>
        </div>
      </div>

      <NormalStateScreen title={runView.description} description="客户端只负责展示、刷新和提交选择。" highlight={run.phase} />

      <div className="expedition-facts">
        {runView.facts.map((fact) => (
          <div key={fact.label} className="expedition-fact">
            <span>{fact.label}</span>
            <strong title={fact.value}>{fact.value}</strong>
          </div>
        ))}
      </div>

      <div className="expedition-mini-grid">
        <section className="expedition-mini-card">
          <h5>战斗摘要</h5>
          {runView.combatLines.length === 0 ? <p>战斗尚未开始或摘要尚未恢复。</p> : null}
          <ul>
            {runView.combatLines.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </section>
        <section className="expedition-mini-card">
          <h5>奖励 / 结算</h5>
          {runView.rewardLines.length === 0 ? <p>等待奖励候选或 finalization。</p> : null}
          <ul>
            {runView.rewardLines.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </section>
      </div>

      {run.phase === 'ENTERED' ? (
        <div className="expedition-choice-list">
          {previewChoices.map((choice) => (
            <DungeonChoiceButton
              key={choice.choiceId}
              choiceId={choice.choiceId}
              routeId={choice.routeId}
              riskLabel={choice.riskLabel}
              label={choice.label}
              active={run.selected_choice_id === choice.choiceId}
              disabled={!canChoose}
              onSelect={() => onChoose(choice.choiceId)}
            />
          ))}
        </div>
      ) : null}

      <div className="expedition-actions">
        <button className="ghost-button" type="button" onClick={onRefresh}>
          刷新当前运行
        </button>
        <button className="ghost-button" type="button" onClick={onFinalize} disabled={!runView.canFinalize || finalizePending}>
          {finalizePending ? '结算中…' : 'finalize 结果'}
        </button>
      </div>

      {run.phase === 'FINALIZED' ? (
        <NormalStateScreen
          title="奖励已入账"
          description="奖励写入账本后立即生效，按钮仅用于复查结果，不是领取动作。"
          highlight={`结果 ${run.outcome}`}
        />
      ) : null}
    </div>
  );
}

function ExpeditionReadOnlyLinks({
  session,
  loadoutPresetId,
  runResponse,
  queue,
}: {
  readonly session: AuthActiveSession;
  readonly loadoutPresetId: string;
  readonly runResponse: DungeonRunResponse | null;
  readonly queue: Queue | null;
}): ReactElement {
  const comparePresetId = runResponse?.run.loadout_preset_id ?? loadoutPresetId;
  return (
    <div className="expedition-links">
      <NormalStateScreen
        title="补充入口"
        description="装备比较、背包和闭关重排入口保留在同一页，方便回流后继续处理战利品。"
        highlight="只读跳转"
      />
      <div className="expedition-link-row">
        <Link className="ghost-button" to={`/character?preset_id=${encodeURIComponent(loadoutPresetId)}&compare_preset_id=${encodeURIComponent(comparePresetId)}`}>
          装备比较
        </Link>
        <Link className="ghost-button" to="/inventory?category=equipment">
          背包
        </Link>
        <Link className="ghost-button" to="/dashboard">
          重新安排闭关
        </Link>
        <Link className="ghost-button" to={`/character?preset_id=${encodeURIComponent(loadoutPresetId)}`}>
          预设管理
        </Link>
      </div>
      <div className="expedition-inline-note">
        <strong>角色 {session.character_id.slice(0, 8)}</strong>
        <span>{queue === null ? '队列尚未加载。' : `队列版本 ${queue.queue_version} · ${queue.entries.length} 段 · ${queue.paused ? '已暂停' : '运行中'}`}</span>
      </div>
    </div>
  );
}

export function ExpeditionPage(): ReactElement {
  const session = useOutletContext<AuthActiveSession>();
  const location = useLocation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const params = useMemo(() => new URLSearchParams(location.search), [location.search]);
  const storedRunId = readActiveDungeonRunId();
  const runIdFromSearch = params.get('run_id');
  const activeRunId = runIdFromSearch ?? storedRunId;
  const initialDraft = useMemo(() => {
    const draft: {
      loadoutPresetId?: string;
      strategyPresetId?: string;
      initialRouteId?: string;
    } = {};
    const loadoutPresetId = params.get('loadout_preset_id');
    const strategyPresetId = params.get('strategy_preset_id');
    const initialRouteId = params.get('initial_route_id');

    if (loadoutPresetId !== null) {
      draft.loadoutPresetId = loadoutPresetId;
    }

    if (strategyPresetId !== null) {
      draft.strategyPresetId = strategyPresetId;
    }

    if (initialRouteId !== null) {
      draft.initialRouteId = initialRouteId;
    }

    return draft;
  }, [params]);
  const [draft, dispatch] = useReducer(
    expeditionDraftReducer,
    undefined,
    () => createInitialExpeditionDraft(initialDraft),
  );
  const activePresetHydratedRef = useRef(false);

  useEffect(() => {
    if (runIdFromSearch !== null) {
      writeActiveDungeonRunId(runIdFromSearch);
      return;
    }

    if (storedRunId !== null) {
      syncSearch(navigate, location.pathname, location.search, { run_id: storedRunId });
    }
  }, [location.pathname, location.search, navigate, runIdFromSearch, storedRunId]);

  useEffect(() => {
    syncSearch(navigate, location.pathname, location.search, {
      loadout_preset_id: draft.loadoutPresetId,
      strategy_preset_id: draft.strategyPresetId,
      initial_route_id: draft.initialRouteId,
      run_id: runIdFromSearch ?? storedRunId,
    });
  }, [draft.initialRouteId, draft.loadoutPresetId, draft.strategyPresetId, location.pathname, location.search, navigate, runIdFromSearch, storedRunId]);

  const { progressionQuery, opportunityQuery, inventoryQuery, queueQuery, loadoutQuery, runQuery } = useExpeditionQueries(
    session,
    draft.loadoutPresetId,
    activeRunId,
  );

  useEffect(() => {
    if (activePresetHydratedRef.current || opportunityQuery.data === undefined) {
      return;
    }

    activePresetHydratedRef.current = true;
    const activePresetId = resolveActiveLoadoutPresetId(draft, opportunityQuery.data.character.active_loadout_preset_id);
    if (activePresetId !== null) {
      dispatch({ type: 'set-loadout-preset-id', loadoutPresetId: activePresetId });
    }
  }, [draft, opportunityQuery.data]);

  const previewMutation = useMutation({
    mutationFn: () => apiClient.previewDungeon(QINGSHE_DUNGEON_ID, createDungeonPreviewRequest(session.character_id, draft)),
  });

  useEffect(() => {
    previewMutation.reset();
  }, [draft.initialRouteId, draft.loadoutPresetId, draft.strategyPresetId, previewMutation]);

  const enterMutation = useMutation({
    mutationFn: async () => {
      const opportunity = opportunityQuery.data;
      if (opportunity === null || opportunity === undefined) {
        throw new Error('OPPORTUNITY_NOT_READY');
      }
      const progression = progressionQuery.data;
      if (progression === null || progression === undefined) {
        throw new Error('PROGRESSION_NOT_READY');
      }
      return apiClient.enterDungeonRun(
        session.character_id,
        {
          dungeon_id: QINGSHE_DUNGEON_ID,
          loadout_preset_id: draft.loadoutPresetId,
          strategy_preset_id: draft.strategyPresetId,
          initial_route_id: draft.initialRouteId,
          expected_state_version: progression.character.state_version,
          config_version: opportunity.config_version,
        },
        createIdempotencyKey(),
      );
    },
    onSuccess: async (response) => {
      writeActiveDungeonRunId(response.run.run_id);
      startTransition(() => {
        navigate(
          {
            pathname: location.pathname,
            search: `?${new URLSearchParams({
              run_id: response.run.run_id,
              loadout_preset_id: draft.loadoutPresetId,
              strategy_preset_id: draft.strategyPresetId,
              initial_route_id: draft.initialRouteId,
            }).toString()}`,
          },
          { replace: true },
        );
      });
      queryClient.setQueryData([EXPEDITION_QUERY_PREFIX, session.character_id, 'run', response.run.run_id], response);
      await queryClient.invalidateQueries({ queryKey: [EXPEDITION_QUERY_PREFIX, session.character_id] });
      await queryClient.invalidateQueries({ queryKey: ['dashboard', session.character_id] });
    },
  });

  const chooseMutation = useMutation({
    mutationFn: (choiceId: string) => {
      if (runQuery.data === undefined || runQuery.data === null) {
        throw new Error('RUN_NOT_READY');
      }
      return apiClient.chooseDungeonRun(runQuery.data.run.run_id, { choice_id: choiceId, expected_run_version: runQuery.data.run.revision }, createIdempotencyKey());
    },
    onSuccess: async (response) => {
      queryClient.setQueryData([EXPEDITION_QUERY_PREFIX, session.character_id, 'run', response.run.run_id], response);
      await queryClient.invalidateQueries({ queryKey: [EXPEDITION_QUERY_PREFIX, session.character_id] });
      await queryClient.invalidateQueries({ queryKey: ['dashboard', session.character_id] });
    },
  });

  const finalizeMutation = useMutation({
    mutationFn: () => {
      if (runQuery.data === undefined || runQuery.data === null) {
        throw new Error('RUN_NOT_READY');
      }
      return apiClient.finalizeDungeonRun(runQuery.data.run.run_id, createIdempotencyKey());
    },
    onSuccess: async (response) => {
      queryClient.setQueryData([EXPEDITION_QUERY_PREFIX, session.character_id, 'run', response.run.run_id], response);
      await queryClient.invalidateQueries({ queryKey: [EXPEDITION_QUERY_PREFIX, session.character_id] });
      await queryClient.invalidateQueries({ queryKey: ['dashboard', session.character_id] });
    },
  });

  const claimGrantMutation = useMutation({
    mutationFn: () => apiClient.claimDungeonTeachingGrant(session.character_id, createIdempotencyKey()),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: [EXPEDITION_QUERY_PREFIX, session.character_id, 'opportunity'] });
    },
  });

  const firstError = progressionQuery.error ?? opportunityQuery.error ?? inventoryQuery.error ?? queueQuery.error ?? loadoutQuery.error ?? runQuery.error;
  const runPending = activeRunId !== null && runQuery.isPending;
  if (progressionQuery.isPending || opportunityQuery.isPending || inventoryQuery.isPending || queueQuery.isPending || runPending) {
    return <ExpeditionLoading />;
  }

  if (firstError !== undefined && firstError !== null) {
    const error = firstError instanceof ApiClientError ? firstError : null;
    if (error?.status === 503) {
      return <ExpeditionMaintenance reason={error.message} onRetry={async () => queryClient.invalidateQueries({ queryKey: [EXPEDITION_QUERY_PREFIX, session.character_id] })} />;
    }
    if (error?.status === 401 || error?.status === 403) {
      return <ExpeditionLocked reason={error.message} onRetry={async () => queryClient.invalidateQueries({ queryKey: [EXPEDITION_QUERY_PREFIX, session.character_id] })} />;
    }
    return <ExpeditionError error={firstError.message} onRetry={async () => queryClient.invalidateQueries({ queryKey: [EXPEDITION_QUERY_PREFIX, session.character_id] })} />;
  }

  const opportunityView = summarizeDungeonOpportunity(opportunityQuery.data as DungeonOpportunityResponse, '青蛇洞');
  const previewView = previewMutation.data === undefined ? null : summarizeDungeonPreview(previewMutation.data as DungeonPreviewResponse);
  const runResponse = runQuery.data ?? null;
  const runView = runResponse === null ? null : summarizeDungeonRun(runResponse);
  const queue = queueQuery.data ?? null;
  const loadoutPreset = loadoutQuery.data ?? null;
  const canPreview = isExpeditionDraftReady(draft);
  const canEnter = canPreview && progressionQuery.data !== undefined && opportunityQuery.data !== undefined;
  const currentPreview = previewView ?? null;

  return (
    <section className="expedition-layout">
      <div className="expedition-panel expedition-panel--hero">
        <NormalStateScreen
          title="青蛇洞秘境"
          description="准备、入场、断线恢复、超时与结算都由服务端权威推进。"
          highlight={`机会 ${opportunityQuery.data?.opportunity.current_opportunities ?? 0}/${opportunityQuery.data?.opportunity.opportunity_cap ?? 0}`}
          footnote={`当前 run_id ${activeRunId ?? '无'} · 校验时间 ${formatDateTime(opportunityQuery.data?.calculation_as_of)}`}
        />
      </div>

      <div className="expedition-panel">
        <ExpeditionPrepareCard
          opportunityView={opportunityView}
          loadoutPreset={loadoutPreset}
          previewView={currentPreview}
          draftLoadoutPresetId={draft.loadoutPresetId}
          draftStrategyPresetId={draft.strategyPresetId}
          draftInitialRouteId={draft.initialRouteId}
          onLoadoutPresetIdChange={(value) => dispatch({ type: 'set-loadout-preset-id', loadoutPresetId: value })}
          onStrategyPresetIdChange={(value) => dispatch({ type: 'set-strategy-preset-id', strategyPresetId: value })}
          onInitialRouteIdChange={(value) => dispatch({ type: 'set-initial-route-id', initialRouteId: value })}
          onClaimGrant={() => claimGrantMutation.mutate()}
          onPreview={() => previewMutation.mutate()}
          onEnter={() => enterMutation.mutate()}
          previewPending={previewMutation.isPending}
          enterPending={enterMutation.isPending}
          canPreview={canPreview}
          canEnter={canEnter}
        />
      </div>

      <div className="expedition-panel">
        <ExpeditionRuntimeCard
          runResponse={runResponse}
          runView={runView}
          onRefresh={async () => queryClient.invalidateQueries({ queryKey: [EXPEDITION_QUERY_PREFIX, session.character_id] })}
          onChoose={(choiceId) => chooseMutation.mutate(choiceId)}
          onFinalize={() => finalizeMutation.mutate()}
          choosePending={chooseMutation.isPending}
          finalizePending={finalizeMutation.isPending}
        />
      </div>

      <div className="expedition-panel">
        <ExpeditionReadOnlyLinks session={session} loadoutPresetId={draft.loadoutPresetId} runResponse={runResponse} queue={queue} />
      </div>
    </section>
  );
}
