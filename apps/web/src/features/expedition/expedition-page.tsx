import { startTransition, useEffect, useMemo, useReducer, useRef, useState, type ReactElement } from 'react';
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
import { emitGameFeedback } from '../../lib/game-feedback.js';
import { GameDialog, ImportantActionDialog } from '../../components/game-dialog.js';
import { shouldConfirmImportantActions } from '../../lib/game-settings.js';
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
  DEFAULT_DUNGEON_STRATEGY_ID,
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

export const EXPEDITION_PRESET_GUIDANCE = '先在角色页准备一套装备；新手可以直接使用稳妥探险。';

function describeStrategy(strategyId: string): string {
  return strategyId === 'strategy.safe' ? '稳妥探险' : strategyId === 'strategy.risk' ? '大胆探险' : '默认策略';
}

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

export function DungeonRoomDialog({
  open,
  roomId,
  routeId,
  onOpenChange,
}: {
  readonly open: boolean;
  readonly roomId: string;
  readonly routeId: string | null;
  readonly onOpenChange: (open: boolean) => void;
}): ReactElement | null {
  if (!open) return null;
  const roomLabel = roomId.includes('entry') ? '入口石径' : roomId.includes('branch') ? '蛇窟岔路' : roomId.includes('deep') ? '深潭石台' : '当前房间';
  const routeLabelText = routeId === QINGSHE_SAFE_ROUTE_ID ? '稳妥路线' : routeId === QINGSHE_HIGH_RISK_ROUTE_ID ? '高风险路线' : '尚未选择';
  const body = <><div className="game-dialog__facts"><span>房间</span><strong>{roomLabel}</strong></div><div className="game-dialog__facts"><span>路线</span><strong>{routeLabelText}</strong></div></>;
  if (typeof window === 'undefined') return <div role="dialog"><h2>房间详情</h2>{body}</div>;
  return <GameDialog open={open} onOpenChange={onOpenChange} eyebrow="青蛇洞" title="房间详情">{body}</GameDialog>;
}

export function AutomationDialog({
  open,
  strategyId,
  onOpenChange,
}: {
  readonly open: boolean;
  readonly strategyId: string | null;
  readonly onOpenChange: (open: boolean) => void;
}): ReactElement | null {
  if (!open) return null;
  const strategyLabel = strategyId === DEFAULT_DUNGEON_STRATEGY_ID ? '稳妥路线' : strategyId === 'strategy.risk' ? '大胆路线' : '未设置';
  const body = <><p className="game-dialog__copy">当前仅展示已提交策略，未开放的自动化配置不会在前端伪造。</p><div className="game-dialog__facts"><span>策略</span><strong>{strategyLabel}</strong></div></>;
  if (typeof window === 'undefined') return <div role="dialog"><h2>自动化策略</h2>{body}</div>;
  return <GameDialog open={open} onOpenChange={onOpenChange} eyebrow="青蛇洞" title="自动化策略">{body}</GameDialog>;
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
        <LoadingStateScreen title="正在查看青蛇洞" description="正在准备秘境、修为和背包信息。" />
      </div>
      <div className="expedition-panel">
        <LoadingStateScreen title="准备进入秘境" description="正在读取装备和路线。" />
      </div>
      <div className="expedition-panel">
        <LoadingStateScreen title="正在恢复秘境进度" description="正在找回上次的探险状态。" />
      </div>
    </section>
  );
}

export function ExpeditionError({ onRetry }: { readonly error: string; readonly onRetry: () => void }): ReactElement {
  return (
    <section className="expedition-layout">
      <div className="expedition-panel expedition-panel--hero">
        <LocalErrorStateScreen title="秘境暂时无法打开" description="探险状态暂时无法读取，请稍后重试。" actions={[{ label: '重试', onClick: onRetry }]} />
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

export function ExpeditionMaintenance({ onRetry }: { readonly reason: string; readonly onRetry: () => void }): ReactElement {
  return (
    <section className="expedition-layout">
      <div className="expedition-panel expedition-panel--hero">
        <MaintenanceStateScreen title="秘境服务维护中" description="秘境暂时无法读取，请稍后重试。" actions={[{ label: '重试', onClick: onRetry }]} />
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

export function ExpeditionLocked({ onRetry }: { readonly reason: string; readonly onRetry: () => void }): ReactElement {
  return (
    <section className="expedition-layout">
      <div className="expedition-panel expedition-panel--hero">
        <LockedStateScreen title="秘境功能受限" description="当前暂时无法进入秘境，请稍后重试。" actions={[{ label: '重试', onClick: onRetry }]} />
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
  previewError,
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
  readonly previewError: string | null;
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
          <span>今日探险次数</span>
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
          <span className="equipment-form__label" id="loadout_preset_id-label">出战装备</span>
          <input
            id="loadout_preset_id"
            aria-labelledby="loadout_preset_id-label"
            className="equipment-form__input"
            type="text"
            value={draftLoadoutPresetId}
            onChange={(event) => onLoadoutPresetIdChange(event.target.value)}
            placeholder="输入装备组合名称"
          />
        </label>
        <label className="equipment-form__field">
          <span className="equipment-form__label" id="strategy_preset_id-label">战斗策略</span>
          <input
            id="strategy_preset_id"
            aria-labelledby="strategy_preset_id-label"
            className="equipment-form__input"
            type="text"
            value={draftStrategyPresetId}
            onChange={(event) => onStrategyPresetIdChange(event.target.value)}
            placeholder="例如：稳妥探险"
          />
        </label>
        <label className="equipment-form__field">
          <span className="equipment-form__label" id="initial_route_id-label">进入路线</span>
          <select id="initial_route_id" aria-labelledby="initial_route_id-label" className="equipment-form__input" value={draftInitialRouteId} onChange={(event) => onInitialRouteIdChange(event.target.value)}>
            <option value={QINGSHE_SAFE_ROUTE_ID}>左侧矿脉 / 安全</option>
            <option value={QINGSHE_HIGH_RISK_ROUTE_ID}>右侧妖巢 / 高风险</option>
          </select>
        </label>
        <div className="equipment-form__field">
          <span className="equipment-form__label">当前预设</span>
          <div className="expedition-inline-note">
            <strong>{loadoutPreset === null ? '未加载' : loadoutPreset.name}</strong>
            <span>{loadoutPreset === null ? EXPEDITION_PRESET_GUIDANCE : `战斗策略：${describeStrategy(loadoutPreset.strategy_id)}`}</span>
          </div>
        </div>
      </div>

      <div className="expedition-actions">
        <Link className="ghost-button" to="/character">选择装备预设</Link>
        <button className="ghost-button" type="button" onClick={onClaimGrant}>
          领取教学赠送
        </button>
          <button className="ghost-button" type="button" onClick={onPreview} disabled={!canPreview || previewPending}>
          {previewPending ? '查看路线中…' : '查看路线'}
        </button>
        <button className="ghost-button" type="button" onClick={onEnter} disabled={!canEnter || enterPending}>
          {enterPending ? '进入中…' : '开始探险'}
        </button>
      </div>

      {previewError !== null ? <p className="form-error" role="alert">预览失败：{previewError}</p> : null}

      {previewView === null ? (
        <EmptyStateScreen title="还没有选择路线" description="选择装备和路线后，可以先查看这次探险的风险与收获。" />
      ) : (
        <div className="expedition-preview">
          <NormalStateScreen title={previewView.summary} description="这里会展示可能遇到的战斗和收获。" highlight="路线预览" />
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
              <div key={`${choice.choiceId}-${index}`} className="expedition-choice-shell">
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
  onOpenRoom,
  onOpenAutomation,
  choosePending,
  finalizePending,
}: {
  readonly runResponse: DungeonRunResponse | null;
  readonly runView: ReturnType<typeof summarizeDungeonRun> | null;
  readonly onRefresh: () => void;
  readonly onChoose: (choiceId: string) => void;
  readonly onFinalize: () => void;
  readonly onOpenRoom: () => void;
  readonly onOpenAutomation: () => void;
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
          <span>探险进行中</span>
          <span>{timedOut ? '时间到，正在整理结果' : formatRelativeCountdown(run.choice_deadline_at)}</span>
        </div>
      </div>

      <NormalStateScreen title={runView.description} description="选择下一步行动，完成这次秘境探险。" highlight="探险中" />

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
              key={`${choice.choiceId}-${choice.routeId}`}
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
        <button className="ghost-button" type="button" onClick={onOpenRoom}>查看房间</button>
        <button className="ghost-button" type="button" onClick={onOpenAutomation}>查看自动化</button>
        <button className="ghost-button" type="button" onClick={onFinalize} disabled={!runView.canFinalize || finalizePending}>
          {finalizePending ? '结算中…' : '结算收获'}
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
  loadoutPresetId,
  runResponse,
  queue,
}: {
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
        <strong>当前修士</strong>
        <span>{queue === null ? '挂机计划尚未加载。' : `${queue.entries.length} 个任务 · ${queue.paused ? '已暂停' : '正在运行'}`}</span>
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
  const [roomDialogOpen, setRoomDialogOpen] = useState(false);
  const [automationDialogOpen, setAutomationDialogOpen] = useState(false);
  const [finalizeConfirmationOpen, setFinalizeConfirmationOpen] = useState(false);
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
      emitGameFeedback('已进入秘境，开始探险。', 'success');
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
      emitGameFeedback('路线选择已提交。', 'success');
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
      emitGameFeedback('秘境探险已结算。', 'success');
      queryClient.setQueryData([EXPEDITION_QUERY_PREFIX, session.character_id, 'run', response.run.run_id], response);
      await queryClient.invalidateQueries({ queryKey: [EXPEDITION_QUERY_PREFIX, session.character_id] });
      await queryClient.invalidateQueries({ queryKey: ['dashboard', session.character_id] });
    },
  });

  const claimGrantMutation = useMutation({
    mutationFn: () => apiClient.claimDungeonTeachingGrant(session.character_id, createIdempotencyKey()),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: [EXPEDITION_QUERY_PREFIX, session.character_id, 'opportunity'] });
      await queryClient.invalidateQueries({ queryKey: [EXPEDITION_QUERY_PREFIX, session.character_id, 'progression'] });
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
      return <ExpeditionMaintenance reason="" onRetry={async () => queryClient.invalidateQueries({ queryKey: [EXPEDITION_QUERY_PREFIX, session.character_id] })} />;
    }
    if (error?.status === 401 || error?.status === 403) {
      return <ExpeditionLocked reason="" onRetry={async () => queryClient.invalidateQueries({ queryKey: [EXPEDITION_QUERY_PREFIX, session.character_id] })} />;
    }
    return <ExpeditionError error="" onRetry={async () => queryClient.invalidateQueries({ queryKey: [EXPEDITION_QUERY_PREFIX, session.character_id] })} />;
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
          description="选择装备和路线，深入青蛇洞寻找修炼资源。"
          highlight={`机会 ${opportunityQuery.data?.opportunity.current_opportunities ?? 0}/${opportunityQuery.data?.opportunity.opportunity_cap ?? 0}`}
          footnote={`今日可探险 ${opportunityQuery.data?.opportunity.current_opportunities ?? 0} 次`}
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
          previewError={previewMutation.error === null ? null : '预览暂时无法完成，请稍后重试。'}
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
          onFinalize={() => {
            if (shouldConfirmImportantActions()) setFinalizeConfirmationOpen(true);
            else finalizeMutation.mutate();
          }}
          choosePending={chooseMutation.isPending}
          finalizePending={finalizeMutation.isPending}
          onOpenRoom={() => setRoomDialogOpen(true)}
          onOpenAutomation={() => setAutomationDialogOpen(true)}
        />
      </div>

      <div className="expedition-panel">
        <ExpeditionReadOnlyLinks loadoutPresetId={draft.loadoutPresetId} runResponse={runResponse} queue={queue} />
      </div>
      <DungeonRoomDialog open={roomDialogOpen} roomId={runResponse?.run.current_node_id ?? '暂无运行'} routeId={runResponse?.run.selected_route_id ?? null} onOpenChange={setRoomDialogOpen} />
      <AutomationDialog open={automationDialogOpen} strategyId={runResponse?.run.strategy_preset_id ?? draft.strategyPresetId} onOpenChange={setAutomationDialogOpen} />
      <ImportantActionDialog
        open={finalizeConfirmationOpen}
        onOpenChange={setFinalizeConfirmationOpen}
        title="确认结算秘境"
        description="结算会把本次探险结果写入角色账本，完成后不能重复结算。"
        confirmLabel="确认结算"
        pending={finalizeMutation.isPending}
        onConfirm={() => {
          setFinalizeConfirmationOpen(false);
          finalizeMutation.mutate();
        }}
      />
    </section>
  );
}
