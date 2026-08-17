import { useCallback, useEffect, useMemo, useReducer, useRef, useState, type ReactElement } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useLocation, useNavigate, useOutletContext } from 'react-router';
import * as Dialog from '@radix-ui/react-dialog';

import {
  ApiClientError,
  type AuthActiveSession,
  type BreakthroughPreviewResponse,
  type CharacterProgression,
  type DungeonRunResponse,
  type InventorySnapshot,
  type LatestSettlementResponse,
  type Queue,
} from '@dongtian/contracts';
import { EmptyStateScreen, LoadingStateScreen, LocalErrorStateScreen, NormalStateScreen } from '@dongtian/ui';

import { apiClient } from '../../lib/api.js';
import { readActiveDungeonRunId } from '../expedition/dungeon-session.js';
import { summarizeDungeonRun } from '../expedition/expedition-adapter.js';
import { useUiDraftStore } from '../../state/ui-draft-store.js';
import {
  buildDashboardAuthoritySnapshot,
  buildLatestSettlementView,
  describeQueuePreviewEntry,
  describeQueuePreviewWarning,
  describeAction,
} from './dashboard-adapter.js';
import {
  DEFAULT_QUEUE_ACTION_ID,
  buildQueueEditorPreviewLabel,
  createInitialQueueEditorState,
  createOfficialInventoryQueueDraft,
  createQueueEditorDraft,
  createQueueEditorEntryDraft,
  createQueuePlanRequest,
  fingerprintDraft,
  isPreviewFresh,
  queueEditorReducer,
  type QueueEditorDraft,
  type QueueEditorEntryDraft,
  type QueueEditorMode,
  type QueueEditorState,
  type QueueVersionConflict,
} from './queue-editor.js';

const DASHBOARD_QUERY_PREFIX = 'dashboard';

function normalizeDraftTarget(mode: QueueEditorMode, value: string): string {
  if (mode === 'INFINITE') {
    return '';
  }

  if (value.length > 0) {
    return value;
  }

  return mode === 'DURATION' ? '3600' : '1';
}

function summarizeDraft(draft: QueueEditorDraft): string {
  if (draft.entries.length === 0) {
    return '还没有安排高级挂机任务';
  }

  const parts = draft.entries.map((entry) => {
    if (entry.mode === 'INFINITE') {
      return `${describeAction(entry.actionId)} · 一直进行`;
    }

    return `${describeAction(entry.actionId)} · ${entry.mode === 'DURATION' ? `${entry.targetValue} 秒` : `${entry.targetValue} 次`}`;
  });

  return parts.join(' → ');
}

function summarizeQueueMutationConflict(conflict: QueueVersionConflict | null): string {
  if (conflict === null) {
    return '暂无版本冲突';
  }

  return `服务器版本 ${conflict.actualQueueVersion} · 本地期望 ${conflict.expectedQueueVersion}`;
}

function createIdempotencyKey(): string {
  return typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `tmp-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function createAddEntryAction(clientEntryId: string, afterClientEntryId?: string) {
  return afterClientEntryId === undefined
    ? { type: 'add-entry' as const, clientEntryId }
    : { type: 'add-entry' as const, clientEntryId, afterClientEntryId };
}

function useDashboardQueries(characterId: string) {
  const activeDungeonRunId = readActiveDungeonRunId();
  const progressionQuery = useQuery<CharacterProgression>({
    queryKey: [DASHBOARD_QUERY_PREFIX, characterId, 'progression'],
    queryFn: () => apiClient.getProgression(characterId),
  });

  const inventoryQuery = useQuery<InventorySnapshot>({
    queryKey: [DASHBOARD_QUERY_PREFIX, characterId, 'inventory'],
    queryFn: () => apiClient.getInventory(characterId),
  });

  const queueQuery = useQuery<Queue>({
    queryKey: [DASHBOARD_QUERY_PREFIX, characterId, 'queue'],
    queryFn: () => apiClient.getQueue(characterId),
  });

  const settlementQuery = useQuery<LatestSettlementResponse>({
    queryKey: [DASHBOARD_QUERY_PREFIX, characterId, 'settlement-latest'],
    queryFn: () => apiClient.getLatestSettlement(characterId),
  });

  const breakthroughQuery = useQuery<BreakthroughPreviewResponse>({
    queryKey: [DASHBOARD_QUERY_PREFIX, characterId, 'breakthrough-next'],
    queryFn: () => apiClient.getNextBreakthrough(characterId),
    retry: false,
  });

  const dungeonRunQuery = useQuery<DungeonRunResponse>({
    queryKey: [DASHBOARD_QUERY_PREFIX, characterId, 'dungeon-run', activeDungeonRunId ?? 'none'],
    queryFn: () => {
      if (activeDungeonRunId === null) {
        throw new Error('NO_ACTIVE_DUNGEON_RUN');
      }
      return apiClient.getDungeonRunById(activeDungeonRunId);
    },
    enabled: activeDungeonRunId !== null,
    retry: false,
  });

  return { progressionQuery, inventoryQuery, queueQuery, settlementQuery, breakthroughQuery, dungeonRunQuery };
}

export function DashboardLoading(): ReactElement {
  return (
    <section className="dashboard-layout">
      <div className="dashboard-panel dashboard-panel--hero">
        <LoadingStateScreen title="正在读取权威快照" description="先拉取修为、库存与闭关队列，再渲染首页与编辑器。" />
      </div>
      <div className="dashboard-panel">
        <LoadingStateScreen title="最新回流摘要" description="等待后端持久化结算记录。" />
      </div>
      <div className="dashboard-panel">
        <LoadingStateScreen title="闭关队列编辑器" description="等待可编辑的权威队列。" />
      </div>
    </section>
  );
}

export function DashboardError({ error, onRetry }: { readonly error: string; readonly onRetry: () => void }): ReactElement {
  return (
    <section className="dashboard-layout">
      <div className="dashboard-panel dashboard-panel--hero">
        <LocalErrorStateScreen
          title="首页读取失败"
          description="权威快照读取失败，草稿保持不变。"
          actions={[{ label: '重试', onClick: onRetry }]}
          footnote={error}
        />
      </div>
      <div className="dashboard-panel">
        <EmptyStateScreen title="最新回流摘要" description="等待权威快照恢复后再显示。" />
      </div>
      <div className="dashboard-panel">
        <EmptyStateScreen title="闭关队列编辑器" description="当前无法载入队列。" />
      </div>
    </section>
  );
}

function QueueEditorRow({
  entry,
  disabled,
  onMoveDown,
  onMoveUp,
  onRemove,
  onUpdate,
}: {
  readonly entry: QueueEditorEntryDraft;
  readonly disabled: boolean;
  readonly onMoveDown: () => void;
  readonly onMoveUp: () => void;
  readonly onRemove: () => void;
  readonly onUpdate: (patch: Partial<Pick<QueueEditorEntryDraft, 'actionId' | 'mode' | 'targetValue' | 'conditionItemId' | 'conditionOperator' | 'onBlocked'>>) => void;
}): ReactElement {
  return (
    <li className="queue-editor__row" tabIndex={0}>
      <div className="queue-editor__row-main">
        <label className="queue-editor__field">
          <span className="queue-editor__label">挂机任务</span>
          <input
            className="queue-editor__input"
            type="text"
            value={entry.actionId}
            disabled={disabled}
            onChange={(event) => onUpdate({ actionId: event.target.value })}
          />
        </label>
        <label className="queue-editor__field">
          <span className="queue-editor__label">执行方式</span>
          <select
            className="queue-editor__input"
            value={entry.mode}
            disabled={disabled}
            onChange={(event) => {
              const nextMode = event.target.value as QueueEditorMode;
              onUpdate({
                mode: nextMode,
                targetValue: normalizeDraftTarget(nextMode, entry.targetValue),
              });
            }}
          >
            <option value="COUNT">做几次</option>
            <option value="DURATION">持续时间</option>
            <option value="UNTIL_INVENTORY">攒够材料</option>
            <option value="INFINITE">一直进行</option>
          </select>
        </label>
        <label className="queue-editor__field">
          <span className="queue-editor__label">目标</span>
          <input
            className="queue-editor__input"
            type="text"
            value={entry.mode === 'INFINITE' ? '' : entry.targetValue}
            placeholder={entry.mode === 'DURATION' ? '秒' : entry.mode === 'UNTIL_INVENTORY' ? '库存数量' : '次数'}
            disabled={disabled || entry.mode === 'INFINITE'}
            onChange={(event) => onUpdate({ targetValue: event.target.value })}
          />
        </label>
        {entry.mode === 'UNTIL_INVENTORY' ? (
          <>
            <label className="queue-editor__field">
                <span className="queue-editor__label">材料</span>
              <input
                className="queue-editor__input"
                type="text"
                value={entry.conditionItemId}
                disabled={disabled}
                placeholder="例如：青灵草"
                onChange={(event) => onUpdate({ conditionItemId: event.target.value })}
              />
            </label>
            <label className="queue-editor__field">
                <span className="queue-editor__label">材料条件</span>
              <select
                className="queue-editor__input"
                value={entry.conditionOperator}
                disabled={disabled}
                onChange={(event) => onUpdate({ conditionOperator: event.target.value as '<' | '>=' })}
              >
                <option value=">=">库存达到目标时跳过</option>
                <option value="&lt;">库存低于目标时执行</option>
              </select>
            </label>
          </>
        ) : null}
        <label className="queue-editor__field">
            <span className="queue-editor__label">材料不足时</span>
          <select
            className="queue-editor__input"
            value={entry.onBlocked}
            disabled={disabled}
            onChange={(event) => onUpdate({ onBlocked: event.target.value as 'SKIP' | 'FALLBACK' })}
          >
            <option value="FALLBACK">转去修炼</option>
            <option value="SKIP">跳过任务</option>
          </select>
        </label>
      </div>
      <div className="queue-editor__row-actions">
        <button className="chip-button" type="button" onClick={onMoveUp} disabled={disabled} aria-label="上移该行动" title="上移">
          上移
        </button>
        <button className="chip-button" type="button" onClick={onMoveDown} disabled={disabled} aria-label="下移该行动" title="下移">
          下移
        </button>
        <button className="chip-button queue-editor__chip--danger" type="button" onClick={onRemove} disabled={disabled} aria-label="删除该行动" title="删除">
          删除
        </button>
      </div>
    </li>
  );
}

function QueuePreviewDetails({ preview }: { readonly preview: NonNullable<QueueEditorState['preview']> }): ReactElement {
  return (
    <>
      <ul className="dashboard-preview__list">
        {preview.entries.map((entry, index) => (
          <li key={`${index}-${String(entry['action_id'] ?? index)}`} className="dashboard-preview__item">
            {describeQueuePreviewEntry(entry)}
          </li>
        ))}
      </ul>
      <div className="dashboard-preview__warnings">
        {preview.warnings.length === 0 ? (
          <span className="dashboard-preview__muted">无阻塞警告。</span>
        ) : (
          preview.warnings.map((warning, index) => (
            <p key={`${index}-${String(warning['message_key'] ?? warning['message'] ?? index)}`} className="dashboard-preview__warning">
              {describeQueuePreviewWarning(warning)}
            </p>
          ))
        )}
      </div>
    </>
  );
}

export function QueuePreviewCard({ preview }: { readonly preview: QueueEditorState['preview'] }): ReactElement {
  if (preview === null) {
    return <EmptyStateScreen title="预览未生成" description="先点击预览，服务端会校验版本、材料和保底行动。" />;
  }

  return (
    <div className="dashboard-preview">
      <div className="dashboard-preview__summary">
        <strong>预览结果</strong>
        <span title={buildQueueEditorPreviewLabel(preview)}>{buildQueueEditorPreviewLabel(preview)}</span>
      </div>
      <QueuePreviewDetails preview={preview} />
    </div>
  );
}

function QueuePreviewDialog({
  preview,
  open,
  onOpenChange,
}: {
  readonly preview: QueueEditorState['preview'];
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
}): ReactElement | null {
  if (preview === null) {
    return null;
  }

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Trigger asChild>
        <button className="ghost-button ghost-button--compact" type="button">
          查看完整预览
        </button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay" />
        <Dialog.Content className="dialog-panel">
          <div className="dialog-panel__header">
            <div>
              <Dialog.Title className="dialog-panel__title">完整闭关预览</Dialog.Title>
              <Dialog.Description className="dialog-panel__description">
                这里展示与卡片一致的服务端预览。关闭弹层后，焦点会返回到触发按钮。
              </Dialog.Description>
            </div>
            <Dialog.Close asChild>
              <button className="ghost-button ghost-button--compact" type="button">
                关闭
              </button>
            </Dialog.Close>
          </div>
          <QueuePreviewDetails preview={preview} />
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export function SettlementSummaryCard({
  view,
  onRefresh,
}: {
  readonly view: ReturnType<typeof buildLatestSettlementView>;
  readonly onRefresh: () => void;
}): ReactElement {
  if (view.kind === 'empty') {
    return (
      <EmptyStateScreen
        title={view.title}
        description={view.description}
        footnote={view.footnote}
        actions={[{ label: '刷新摘要', onClick: onRefresh }]}
      />
    );
  }

  return (
    <div className="settlement-summary">
      <NormalStateScreen title={view.title} description={view.description} highlight="只读持久化摘要" footnote={view.footnote} />

      <div className="settlement-summary__facts">
        {view.facts.map((fact) => (
          <div key={fact.label} className="settlement-summary__fact">
            <span>{fact.label}</span>
            <strong title={fact.value}>{fact.value}</strong>
          </div>
        ))}
      </div>

      <div className="settlement-summary__sections">
        <section className="settlement-summary__section">
          <h5>时间线</h5>
          <ul>
            {view.timeline.map((item, index) => (
              <li key={`${index}-${item.title}-${item.detail}`}>
                <strong>{item.title}</strong>
                <span>{item.detail}</span>
              </li>
            ))}
          </ul>
        </section>

        <section className="settlement-summary__section">
          <h5>XP 与物品</h5>
          <ul>
            {view.rewards.map((item, index) => (
              <li key={`${index}-${item.title}-${item.detail}`}>
                <strong>{item.title}</strong>
                <span>{item.detail}</span>
              </li>
            ))}
          </ul>
        </section>

        <section className="settlement-summary__section">
          <h5>消耗</h5>
          {view.consumptions.length === 0 ? <p>无可见消耗账本。</p> : null}
          <ul>
            {view.consumptions.map((item, index) => (
              <li key={`${index}-${item.title}-${item.detail}`}>
                <strong>{item.title}</strong>
                <span>{item.detail}</span>
              </li>
            ))}
          </ul>
        </section>

        <section className="settlement-summary__section">
          <h5>异常</h5>
          {view.anomalies.length === 0 ? <p>没有额外异常。</p> : null}
          <ul>
            {view.anomalies.map((item, index) => (
              <li key={`${index}-${item.title}-${item.detail}`}>
                <strong>{item.title}</strong>
                <span>{item.detail}</span>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  );
}

export function DashboardPage(): ReactElement {
  const session = useOutletContext<AuthActiveSession>();
  const location = useLocation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const seededActionIdRef = useRef<string | null>(null);
  const [isPreviewDialogOpen, setPreviewDialogOpen] = useState(false);
  const [quickStartState, setQuickStartState] = useState<'idle' | 'starting' | 'running' | 'error'>('idle');
  const [quickStartError, setQuickStartError] = useState<string | null>(null);
  const [clockMs, setClockMs] = useState(() => Date.now());
  const setShellSummaries = useUiDraftStore((state) => state.setShellSummaries);
  const setQueueDraftTitle = useUiDraftStore((state) => state.setQueueDraftTitle);
  const setQueueDraftNote = useUiDraftStore((state) => state.setQueueDraftNote);

  const { progressionQuery, inventoryQuery, queueQuery, settlementQuery, breakthroughQuery, dungeonRunQuery } = useDashboardQueries(session.character_id);
  const [editorState, dispatch] = useReducer(queueEditorReducer, undefined, () => createInitialQueueEditorState());

  useEffect(() => {
    const timer = window.setInterval(() => setClockMs(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const startQuickTask = useCallback(
    async (actionId: string) => {
      if (queueQuery.data === undefined || quickStartState === 'starting') {
        return;
      }

      setQuickStartState('starting');
      setQuickStartError(null);
      const draft = createQueueEditorDraft(queueQuery.data.queue_version, [
        createQueueEditorEntryDraft(`quick-${actionId}-${Date.now()}`, { actionId, mode: 'INFINITE', targetValue: '' }),
      ]);

      try {
        const mutation = await apiClient.saveQueue(session.character_id, createQueuePlanRequest(draft), createIdempotencyKey());
        dispatch({ type: 'mark-saved', queue: mutation.queue });
        if (mutation.queue.paused) {
          const resumed = await apiClient.resumeQueue(
            session.character_id,
            { expected_queue_version: mutation.queue.queue_version },
            createIdempotencyKey(),
          );
          dispatch({ type: 'mark-saved', queue: resumed.queue });
        }
        await queryClient.invalidateQueries({ queryKey: [DASHBOARD_QUERY_PREFIX, session.character_id] });
        await queryClient.invalidateQueries({ queryKey: ['global-idle-progress', session.character_id] });
        setQuickStartState('running');
      } catch (error) {
        setQuickStartState('error');
        setQuickStartError(error instanceof Error ? error.message : '任务暂时无法开始');
      }
    },
    [queueQuery.data, quickStartState, queryClient, session.character_id],
  );

  useEffect(() => {
    if (queueQuery.data === undefined) {
      return;
    }

    if (!editorState.isDirty || editorState.draft.expectedQueueVersion !== String(queueQuery.data.queue_version)) {
      dispatch({ type: 'hydrate', queue: queueQuery.data });
    }
  }, [editorState.draft.expectedQueueVersion, editorState.isDirty, queueQuery.data]);

  useEffect(() => {
    if (queueQuery.data === undefined) {
      return;
    }

    const actionId = new URLSearchParams(location.search).get('action_id');
    if (actionId === null) {
      seededActionIdRef.current = null;
      return;
    }

    if (seededActionIdRef.current === actionId) {
      return;
    }

    seededActionIdRef.current = actionId;
    void startQuickTask(actionId);
    navigate({ pathname: location.pathname, search: '' }, { replace: true });
  }, [location.pathname, location.search, navigate, queueQuery.data, startQuickTask]);

  const authoritySnapshot = useMemo(() => {
    if (progressionQuery.data === undefined || inventoryQuery.data === undefined || queueQuery.data === undefined) {
      return null;
    }

    return buildDashboardAuthoritySnapshot(
      progressionQuery.data,
      queueQuery.data,
      inventoryQuery.data,
      settlementQuery.data,
      breakthroughQuery.data,
      clockMs,
    );
  }, [breakthroughQuery.data, clockMs, inventoryQuery.data, progressionQuery.data, queueQuery.data, settlementQuery.data]);

  const settlementView = useMemo(() => buildLatestSettlementView(settlementQuery.data), [settlementQuery.data]);

  useEffect(() => {
    if (authoritySnapshot === null) {
      return;
    }

    setShellSummaries({
      currentActionSummary: authoritySnapshot.currentActionDetail,
      settlementSummary: settlementView.summaryLine,
      goalTrackerSummary: authoritySnapshot.goalTrackerDetail,
    });
  }, [authoritySnapshot, settlementView.summaryLine, setShellSummaries]);

  useEffect(() => {
    setQueueDraftTitle(summarizeDraft(editorState.draft));
    setQueueDraftNote(
      editorState.preview === null
        ? '先预览再保存；保存、暂停、恢复都需要幂等键。'
        : `${editorState.preview.warnings.length} 条预览警告 · ${isPreviewFresh(editorState) ? '预览新鲜' : '预览已过期'}`,
    );
  }, [editorState.draft, editorState.preview, setQueueDraftNote, setQueueDraftTitle]);

  const previewMutation = useMutation({
    mutationFn: (draft: QueueEditorDraft) => apiClient.previewQueue(session.character_id, createQueuePlanRequest(draft)),
    onSuccess: (preview, draft) => {
      dispatch({ type: 'apply-preview', preview, fingerprint: fingerprintDraft(draft) });
    },
  });

  const saveMutation = useMutation({
    mutationFn: (draft: QueueEditorDraft) =>
      apiClient.saveQueue(session.character_id, createQueuePlanRequest(draft), createIdempotencyKey()),
    onSuccess: async (mutation) => {
      dispatch({ type: 'mark-saved', queue: mutation.queue });
      await queryClient.invalidateQueries({ queryKey: [DASHBOARD_QUERY_PREFIX, session.character_id] });
    },
    onError: async (error: unknown, draft) => {
      if (error instanceof ApiClientError && error.code === 'QUEUE_VERSION_CONFLICT') {
        const details = error.details as { expected?: number | string; actual?: number | string } | undefined;
        dispatch({
          type: 'mark-conflict',
          conflict: {
            expectedQueueVersion: String(details?.expected ?? draft.expectedQueueVersion),
            actualQueueVersion: String(details?.actual ?? queueQuery.data?.queue_version ?? 'unknown'),
          },
        });
        await queryClient.invalidateQueries({ queryKey: [DASHBOARD_QUERY_PREFIX, session.character_id, 'queue'] });
      }
    },
  });

  const pauseMutation = useMutation({
    mutationFn: () =>
      apiClient.pauseQueue(
        session.character_id,
        { expected_queue_version: queueQuery.data?.queue_version ?? editorState.draft.expectedQueueVersion },
        createIdempotencyKey(),
      ),
    onSuccess: async (mutation) => {
      dispatch({ type: 'mark-saved', queue: mutation.queue });
      await queryClient.invalidateQueries({ queryKey: [DASHBOARD_QUERY_PREFIX, session.character_id] });
    },
  });

  const resumeMutation = useMutation({
    mutationFn: () =>
      apiClient.resumeQueue(
        session.character_id,
        { expected_queue_version: queueQuery.data?.queue_version ?? editorState.draft.expectedQueueVersion },
        createIdempotencyKey(),
      ),
    onSuccess: async (mutation) => {
      dispatch({ type: 'mark-saved', queue: mutation.queue });
      await queryClient.invalidateQueries({ queryKey: [DASHBOARD_QUERY_PREFIX, session.character_id] });
    },
  });

  if (progressionQuery.isPending || inventoryQuery.isPending || queueQuery.isPending || settlementQuery.isPending) {
    return <DashboardLoading />;
  }

  const firstError = progressionQuery.error ?? inventoryQuery.error ?? queueQuery.error ?? settlementQuery.error ?? dungeonRunQuery.error;
  if (firstError !== undefined && firstError !== null) {
    return <DashboardError error={firstError.message} onRetry={async () => queryClient.invalidateQueries({ queryKey: [DASHBOARD_QUERY_PREFIX, session.character_id] })} />;
  }

  const queue = queueQuery.data;
  if (authoritySnapshot === null || queue === undefined) {
    return <DashboardLoading />;
  }
  const previewFresh = isPreviewFresh(editorState);
  const canSave = editorState.isDirty && previewFresh && !saveMutation.isPending && !pauseMutation.isPending && !resumeMutation.isPending;
  const hasEntries = editorState.draft.entries.length > 0;
  const queueConflict = editorState.conflict;
  const dungeonRun = dungeonRunQuery.data?.run ?? null;
  const queueEditingLocked = dungeonRun !== null && dungeonRun.phase !== 'FINALIZED';
  const dungeonRunSummary = dungeonRunQuery.data === undefined || dungeonRunQuery.data === null ? null : summarizeDungeonRun(dungeonRunQuery.data);

  return (
    <section className="dashboard-layout">
      <div className="dashboard-panel dashboard-panel--hero">
        <div className="dashboard-hero">
          <div className="dashboard-hero__header">
            <p className="dashboard-hero__eyebrow">洞天 · 今日修行</p>
            <h3 className="dashboard-hero__title">选一件事，马上开始挂机</h3>
            <p className="dashboard-hero__copy">不用安排复杂计划。点下面的任务，角色会自动修行；回来时领取收益就好。</p>
          </div>

          <div className="quick-task-grid" aria-label="开始挂机">
            {[
              { id: 'action.cultivation.qi', title: '灵气修炼', detail: '稳定获得修为，适合长时间挂机', reward: '修为' },
              { id: 'action.t1.herb_baicao_valley', title: '采集青灵草', detail: '收集炼丹材料，自动切换到修炼', reward: '青灵草' },
              { id: 'action.t1.qi_gathering_pill', title: '炼制聚气丹', detail: '有材料就炼丹，材料不足会继续修炼', reward: '聚气丹' },
            ].map((task) => (
              <button
                key={task.id}
                className="quick-task-card"
                type="button"
                onClick={() => void startQuickTask(task.id)}
                disabled={quickStartState === 'starting' || queueEditingLocked}
              >
                <span className="quick-task-card__tag">{task.reward}</span>
                <strong>{task.title}</strong>
                <span>{task.detail}</span>
                <em>{quickStartState === 'starting' ? '正在安排…' : `开始${task.title}`}</em>
              </button>
            ))}
          </div>

          {quickStartState === 'running' ? <p className="quick-task-feedback">已开始挂机：{authoritySnapshot.currentActionLabel}。离开一会儿再回来领取收益。</p> : null}
          {quickStartState === 'error' ? <p className="quick-task-feedback quick-task-feedback--error">{quickStartError ?? '任务暂时无法开始，请稍后再试。'}</p> : null}

          <div className="dashboard-hero__actions"><Link className="ghost-button" to="/dashboard/cave">查看洞天</Link></div>
        </div>
      </div>

          {queueEditingLocked && dungeonRunSummary !== null ? (
        <div className="dashboard-panel dashboard-panel--hero">
          <NormalStateScreen
            title="秘境运行中，闭关队列只读显示"
            description={`当前 run ${dungeonRun?.run_id ?? '未知'} 正在进行，编辑、保存、暂停和恢复都会保持禁用。`}
            highlight={dungeonRunSummary.headline}
            footnote={dungeonRunSummary.description}
          />
        </div>
      ) : null}

      <div className="dashboard-panel">
        <SettlementSummaryCard view={settlementView} onRefresh={async () => queryClient.invalidateQueries({ queryKey: [DASHBOARD_QUERY_PREFIX, session.character_id, 'settlement-latest'] })} />
      </div>

      <div className="dashboard-panel" id="queue">
        <div className="dashboard-panel__header">
          <div>
            <p className="page-card__eyebrow">高级设置</p>
            <h4 className="dashboard-panel__title">挂机计划</h4>
          </div>
          <div className="dashboard-panel__meta">
            <span>{hasEntries ? '可调整任务顺序和条件' : '暂无高级计划'}</span>
          </div>
        </div>

        <div className="dashboard-editor__toolbar">
          <button className="ghost-button" type="button" onClick={() => dispatch(createAddEntryAction(`tmp-${createIdempotencyKey()}`))} disabled={queueEditingLocked}>
            新增行动
          </button>
          <button
            className="ghost-button"
            type="button"
            onClick={() => dispatch(createAddEntryAction(`tmp-${createIdempotencyKey()}`, editorState.draft.entries.at(-1)?.clientEntryId))}
            disabled={queueEditingLocked}
          >
            追加到末尾
          </button>
          <button
            className="ghost-button"
            type="button"
            onClick={() => dispatch({ type: 'set-fallback-action', actionId: editorState.draft.entries.at(0)?.actionId ?? DEFAULT_QUEUE_ACTION_ID })}
            disabled={queueEditingLocked}
          >
            设为保底
          </button>
        </div>

        <div className="dashboard-template-row" aria-label="快速模板">
              <button
                className="chip-button"
                type="button"
                onClick={() => dispatch({ type: 'apply-template', draft: createOfficialInventoryQueueDraft(editorState.draft.expectedQueueVersion) })}
                disabled={queueEditingLocked}
              >
                采集→炼制→修炼
              </button>
              <button
                className="chip-button"
                type="button"
                onClick={() =>
                  dispatch(createAddEntryAction(`tmp-${createIdempotencyKey()}`, editorState.draft.entries.at(-1)?.clientEntryId))
                }
                disabled={queueEditingLocked}
              >
                + 空白模板
              </button>
              <button
                className="chip-button"
                type="button"
                onClick={() =>
                  dispatch(createAddEntryAction(`tmp-${createIdempotencyKey()}`, editorState.draft.entries.at(-1)?.clientEntryId))
                }
                disabled={queueEditingLocked}
              >
                + 追加模板
              </button>
        </div>

        <ol className="queue-editor__list">
          {editorState.draft.entries.length === 0 ? (
            <li className="queue-editor__empty">
              {queueEditingLocked ? (
                <EmptyStateScreen title="当前没有可编辑条目" description="秘境运行中，闭关队列保持只读。" />
              ) : (
                <EmptyStateScreen
                  title="当前没有可编辑条目"
                  description="使用“新增行动”或官方模板填入闭关计划。"
                  actions={[{ label: '新增行动', onClick: () => dispatch({ type: 'add-entry', clientEntryId: `tmp-${createIdempotencyKey()}` }) }]}
                />
              )}
            </li>
          ) : (
            editorState.draft.entries.map((entry) => (
              <QueueEditorRow
                key={entry.clientEntryId}
                entry={entry}
                disabled={queueEditingLocked}
                onMoveUp={() => dispatch({ type: 'move-entry', clientEntryId: entry.clientEntryId, direction: -1 })}
                onMoveDown={() => dispatch({ type: 'move-entry', clientEntryId: entry.clientEntryId, direction: 1 })}
                onRemove={() => dispatch({ type: 'remove-entry', clientEntryId: entry.clientEntryId })}
                onUpdate={(patch) => dispatch({ type: 'update-entry', clientEntryId: entry.clientEntryId, patch })}
              />
            ))
          )}
        </ol>

        <div className="dashboard-editor__footer">
          <div className="dashboard-editor__status">
              <span>{editorState.isDirty ? '计划已修改' : '计划已保存'}</span>
            <span>{previewFresh ? '可以保存' : '需要重新预览'}</span>
          </div>
          <div className="dashboard-editor__actions">
            <button className="ghost-button" type="button" onClick={() => previewMutation.mutate(editorState.draft)} disabled={queueEditingLocked || previewMutation.isPending || hasEntries === false}>
              {previewMutation.isPending ? '预览中…' : '预览'}
            </button>
            <button className="ghost-button" type="button" onClick={() => saveMutation.mutate(editorState.draft)} disabled={queueEditingLocked || !canSave}>
              {saveMutation.isPending ? '保存中…' : '保存计划'}
            </button>
            <button className="ghost-button" type="button" onClick={() => pauseMutation.mutate()} disabled={queueEditingLocked || pauseMutation.isPending || queueQuery.data?.paused === true}>
              {pauseMutation.isPending ? '暂停中…' : '暂停'}
            </button>
            <button className="ghost-button" type="button" onClick={() => resumeMutation.mutate()} disabled={queueEditingLocked || resumeMutation.isPending || queueQuery.data?.paused === false}>
              {resumeMutation.isPending ? '恢复中…' : '恢复'}
            </button>
          </div>
        </div>

        {queueConflict !== null ? (
          <LocalErrorStateScreen
            title="队列版本冲突"
            description="服务器计划已经前进，但本地草稿保留不变。先比对再决定是否合并。"
            footnote={summarizeQueueMutationConflict(queueConflict)}
            actions={[{ label: '重新拉取权威队列', onClick: async () => queryClient.invalidateQueries({ queryKey: [DASHBOARD_QUERY_PREFIX, session.character_id, 'queue'] }) }]}
          />
        ) : null}
      </div>

      <div className="dashboard-panel">
        <div className="dashboard-panel__header">
          <div>
            <p className="page-card__eyebrow">预览 / 反馈</p>
            <h4 className="dashboard-panel__title">离线摘要适配器与闭关预览</h4>
          </div>
          <div className="dashboard-panel__meta">
            <span>{editorState.preview === null ? '未预览' : `预览 ${editorState.preview.entries.length} 段`}</span>
            <span>{editorState.draft.entries.length} 个草稿条目</span>
          </div>
        </div>

        <div className="dashboard-preview-shell">
          <QueuePreviewCard preview={editorState.preview} />
          <QueuePreviewDialog preview={editorState.preview} open={isPreviewDialogOpen} onOpenChange={setPreviewDialogOpen} />
        </div>

        <div className="dashboard-preview-shell">
            <NormalStateScreen
              title="权威信息摘要"
              description={
                <div className="dashboard-facts">
                  <p>境界：{authoritySnapshot.realmLabel}</p>
                  <p>当前行动：{authoritySnapshot.currentActionDetail}</p>
                  <p title={authoritySnapshot.goalTrackerDetail}>目标：{authoritySnapshot.goalTrackerDetail}</p>
                  <p>草稿：{summarizeDraft(editorState.draft)}</p>
                </div>
              }
            highlight="严格基于服务端"
            footnote="保存、暂停、恢复都会走 CSRF + Idempotency-Key。"
          />
        </div>
      </div>
    </section>
  );
}
