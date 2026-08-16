import { useEffect, useMemo, useReducer, useRef, type ReactElement } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocation, useNavigate, useOutletContext } from 'react-router';

import {
  ApiClientError,
  type AuthActiveSession,
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
} from './dashboard-adapter.js';
import {
  DEFAULT_QUEUE_ACTION_ID,
  buildQueueEditorPreviewLabel,
  createInitialQueueEditorState,
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

function toDisplayValue(value: number | string | null | undefined): string {
  if (value === null || value === undefined || value === '') {
    return '无';
  }

  return String(value);
}

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
    return `保底 ${draft.fallbackActionId} · 暂无可编辑条目`;
  }

  const parts = draft.entries.map((entry) => {
    if (entry.mode === 'INFINITE') {
      return `${entry.actionId} · 无限`;
    }

    return `${entry.actionId} · ${entry.mode === 'DURATION' ? `${entry.targetValue}s` : `${entry.targetValue} 次`}`;
  });

  return `${parts.join(' → ')} · 保底 ${draft.fallbackActionId}`;
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

  return { progressionQuery, inventoryQuery, queueQuery, settlementQuery, dungeonRunQuery };
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
  readonly onUpdate: (patch: Partial<Pick<QueueEditorEntryDraft, 'actionId' | 'mode' | 'targetValue' | 'onBlocked'>>) => void;
}): ReactElement {
  return (
    <li className="queue-editor__row">
      <div className="queue-editor__row-main">
        <label className="queue-editor__field">
          <span className="queue-editor__label">行动 ID</span>
          <input
            className="queue-editor__input"
            type="text"
            value={entry.actionId}
            disabled={disabled}
            onChange={(event) => onUpdate({ actionId: event.target.value })}
          />
        </label>
        <label className="queue-editor__field">
          <span className="queue-editor__label">模式</span>
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
            <option value="COUNT">COUNT</option>
            <option value="DURATION">DURATION</option>
            <option value="INFINITE">INFINITE</option>
          </select>
        </label>
        <label className="queue-editor__field">
          <span className="queue-editor__label">目标值</span>
          <input
            className="queue-editor__input"
            type="text"
            value={entry.mode === 'INFINITE' ? '' : entry.targetValue}
            placeholder={entry.mode === 'DURATION' ? '秒' : '次数'}
            disabled={disabled || entry.mode === 'INFINITE'}
            onChange={(event) => onUpdate({ targetValue: event.target.value })}
          />
        </label>
        <label className="queue-editor__field">
          <span className="queue-editor__label">阻塞策略</span>
          <select
            className="queue-editor__input"
            value={entry.onBlocked}
            disabled={disabled}
            onChange={(event) => onUpdate({ onBlocked: event.target.value as 'SKIP' | 'FALLBACK' })}
          >
            <option value="FALLBACK">FALLBACK</option>
            <option value="SKIP">SKIP</option>
          </select>
        </label>
      </div>
      <div className="queue-editor__row-actions">
        <button className="chip-button" type="button" onClick={onMoveUp} disabled={disabled}>
          上移
        </button>
        <button className="chip-button" type="button" onClick={onMoveDown} disabled={disabled}>
          下移
        </button>
        <button className="chip-button queue-editor__chip--danger" type="button" onClick={onRemove} disabled={disabled}>
          删除
        </button>
      </div>
    </li>
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
        <span>{buildQueueEditorPreviewLabel(preview)}</span>
      </div>
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
    </div>
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
            <strong>{fact.value}</strong>
          </div>
        ))}
      </div>

      <div className="settlement-summary__sections">
        <section className="settlement-summary__section">
          <h5>时间线</h5>
          <ul>
            {view.timeline.map((item) => (
              <li key={`${item.title}-${item.detail}`}>
                <strong>{item.title}</strong>
                <span>{item.detail}</span>
              </li>
            ))}
          </ul>
        </section>

        <section className="settlement-summary__section">
          <h5>XP 与物品</h5>
          <ul>
            {view.rewards.map((item) => (
              <li key={`${item.title}-${item.detail}`}>
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
            {view.consumptions.map((item) => (
              <li key={`${item.title}-${item.detail}`}>
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
            {view.anomalies.map((item) => (
              <li key={`${item.title}-${item.detail}`}>
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
  const setShellSummaries = useUiDraftStore((state) => state.setShellSummaries);
  const setQueueDraftTitle = useUiDraftStore((state) => state.setQueueDraftTitle);
  const setQueueDraftNote = useUiDraftStore((state) => state.setQueueDraftNote);

  const { progressionQuery, inventoryQuery, queueQuery, settlementQuery, dungeonRunQuery } = useDashboardQueries(session.character_id);
  const [editorState, dispatch] = useReducer(queueEditorReducer, undefined, () => createInitialQueueEditorState());

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
    dispatch({ type: 'add-entry', clientEntryId: `tmp-${createIdempotencyKey()}`, actionId });
    navigate({ pathname: location.pathname, search: '' }, { replace: true });
  }, [location.pathname, location.search, navigate, queueQuery.data]);

  const authoritySnapshot = useMemo(() => {
    if (progressionQuery.data === undefined || inventoryQuery.data === undefined || queueQuery.data === undefined) {
      return null;
    }

    return buildDashboardAuthoritySnapshot(progressionQuery.data, queueQuery.data, inventoryQuery.data);
  }, [inventoryQuery.data, progressionQuery.data, queueQuery.data]);

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

  if (authoritySnapshot === null) {
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
            <p className="dashboard-hero__eyebrow">洞府首页</p>
            <h3 className="dashboard-hero__title">受保护首页已接通权威快照</h3>
            <p className="dashboard-hero__copy">
              当前只读取服务端的修为、库存和闭关队列，不在前端推进时间、不本地发奖，也不伪造离线结算。
            </p>
          </div>

          <div className="dashboard-metrics" aria-label="权威摘要">
            <div className="metric-chip">
              <span className="metric-chip__label">境界</span>
              <strong className="metric-chip__value">{authoritySnapshot.realmLabel}</strong>
            </div>
            <div className="metric-chip">
              <span className="metric-chip__label">修为进度</span>
              <strong className="metric-chip__value">{authoritySnapshot.cultivationLabel}</strong>
            </div>
            <div className="metric-chip">
              <span className="metric-chip__label">当前行动</span>
              <strong className="metric-chip__value">{authoritySnapshot.currentActionLabel}</strong>
            </div>
            <div className="metric-chip">
              <span className="metric-chip__label">队列</span>
              <strong className="metric-chip__value">{authoritySnapshot.queueLabel}</strong>
            </div>
            <div className="metric-chip">
              <span className="metric-chip__label">库存</span>
              <strong className="metric-chip__value">{authoritySnapshot.inventoryLabel}</strong>
            </div>
          </div>
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

      <div className="dashboard-panel">
        <div className="dashboard-panel__header">
          <div>
            <p className="page-card__eyebrow">闭关队列编辑器</p>
            <h4 className="dashboard-panel__title">保存前先预览，冲突不覆盖草稿</h4>
          </div>
          <div className="dashboard-panel__meta">
            <span>队列版本 {toDisplayValue(editorState.draft.expectedQueueVersion)}</span>
            <span>{summarizeQueueMutationConflict(queueConflict)}</span>
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
            <span>草稿 {editorState.isDirty ? '已修改' : '与服务器一致'}</span>
            <span>{previewFresh ? '预览新鲜' : '预览过期或未生成'}</span>
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
        </div>

        <div className="dashboard-preview-shell">
          <NormalStateScreen
            title="权威信息摘要"
            description={
              <div className="dashboard-facts">
                <p>境界：{authoritySnapshot.realmLabel}</p>
                <p>当前行动：{authoritySnapshot.currentActionDetail}</p>
                <p>目标：{authoritySnapshot.goalTrackerDetail}</p>
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
