import { useEffect, useMemo, useReducer, useRef, useState, type ReactElement } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useLocation, useNavigate, useOutletContext } from 'react-router';
import * as Dialog from '@radix-ui/react-dialog';
import { ImportantActionDialog } from '../../components/game-dialog.js';

import {
  ApiClientError,
  type AuthActiveSession,
  type BreakthroughPreviewResponse,
  type Queue,
  type BreakthroughRunResponse,
} from '@dongtian/contracts';
import {
  EmptyStateScreen,
  LoadingStateScreen,
  LocalErrorStateScreen,
  LockedStateScreen,
  MaintenanceStateScreen,
  NormalStateScreen,
} from '@dongtian/ui';

import { apiClient } from '../../lib/api.js';
import { shouldConfirmImportantActions } from '../../lib/game-settings.js';
import {
  breakthroughRunStatusLabel,
  buildBreakthroughPageView,
  formatBreakthroughRequirement,
  formatCountdown,
} from './breakthrough-adapter.js';
import {
  appendBreakthroughQueueEntry,
  createBreakthroughQueueDraft,
  moveBreakthroughQueueEntry,
  removeBreakthroughQueueEntry,
  setBreakthroughQueueEntryMode,
  toBreakthroughQueuePlan,
  updateBreakthroughQueueEntry,
  type BreakthroughQueueDraft,
  type BreakthroughQueueMode,
} from './breakthrough-queue-editor.js';
import {
  breakthroughPageReducer,
  createBreakthroughIdempotencyKey,
  createInitialBreakthroughPageState,
} from './breakthrough-reducer.js';

const QUERY_PREFIX = 'breakthrough';
const RUN_STORAGE_PREFIX = 'dongtian.breakthrough.run.';
const SAFE_CHOICE_ID = 'choice.breakthrough.foundation.safe_exit';
const HIGH_RISK_CHOICE_ID = 'choice.breakthrough.foundation.deep_den';
type BreakthroughOperation = 'start' | 'choice' | 'finalize' | 'abandon' | 'queue';
type BreakthroughOperationError = {
  readonly operation: BreakthroughOperation;
  readonly message: string;
};

function readStoredRunId(characterId: string): string | null {
  if (typeof window === 'undefined') return null;
  return window.localStorage.getItem(`${RUN_STORAGE_PREFIX}${characterId}`);
}

function storeRunId(characterId: string, runId: string | null): void {
  if (typeof window === 'undefined') return;
  if (runId === null) window.localStorage.removeItem(`${RUN_STORAGE_PREFIX}${characterId}`);
  else window.localStorage.setItem(`${RUN_STORAGE_PREFIX}${characterId}`, runId);
}

function formatMutationError(error: unknown): string {
  if (error instanceof ApiClientError) return '暂时无法完成本次试炼，请稍后重试。';
  return error instanceof Error ? '暂时无法完成本次试炼，请稍后重试。' : '暂时无法完成本次试炼，请稍后重试。';
}

function syncRunSearch(
  navigate: ReturnType<typeof useNavigate>,
  pathname: string,
  runId: string | null,
): void {
  const params = new URLSearchParams();
  if (runId !== null) params.set('run_id', runId);
  navigate(
    { pathname, search: params.toString().length > 0 ? `?${params.toString()}` : '' },
    { replace: true },
  );
}

export function BreakthroughLoading(): ReactElement {
  return (
    <section className="breakthrough-layout">
      <div className="breakthrough-panel breakthrough-panel--hero">
        <LoadingStateScreen
          title="正在准备筑基"
          description="正在检查境界、修为、材料和试炼状态。"
        />
      </div>
      <div className="breakthrough-panel">
        <LoadingStateScreen title="筑基门槛" description="正在准备突破所需条件。" />
      </div>
      <div className="breakthrough-panel">
        <LoadingStateScreen title="试炼恢复" description="等待试炼状态。" />
      </div>
    </section>
  );
}

export function BreakthroughError({
  onRetry,
}: {
  readonly error: string;
  readonly onRetry: () => void;
}): ReactElement {
  return (
    <section className="breakthrough-layout">
      <div className="breakthrough-panel breakthrough-panel--hero">
        <LocalErrorStateScreen
          title="筑基暂时无法打开"
          description="试炼状态读取失败，请稍后重试。"
          actions={[{ label: '重试', onClick: onRetry }]}
        />
      </div>
    </section>
  );
}

export function BreakthroughMaintenance({
  onRetry,
}: {
  readonly reason: string;
  readonly onRetry: () => void;
}): ReactElement {
  return (
    <section className="breakthrough-layout">
      <div className="breakthrough-panel breakthrough-panel--hero">
        <MaintenanceStateScreen
          title="筑基服务维护中"
          description="配置或试炼依赖暂时不可用。"
          actions={[{ label: '重试', onClick: onRetry }]}
        />
      </div>
    </section>
  );
}

export function BreakthroughLocked({
  onRetry,
}: {
  readonly reason: string;
  readonly onRetry: () => void;
}): ReactElement {
  return (
    <section className="breakthrough-layout">
      <div className="breakthrough-panel breakthrough-panel--hero">
        <LockedStateScreen
          title="筑基功能受限"
          description="当前账号暂时不能读取筑基条件。"
          actions={[{ label: '重试', onClick: onRetry }]}
        />
      </div>
    </section>
  );
}

function RequirementList({
  response,
  onSource,
}: {
  readonly response: BreakthroughPreviewResponse;
  readonly onSource: (path: string) => void;
}): ReactElement {
  const view = buildBreakthroughPageView(response);
  return (
    <div className="breakthrough-requirements">
      {view.requirementGroups.map((group) => (
        <section
          key={group.key}
          className="breakthrough-group"
          aria-labelledby={`breakthrough-group-${group.key}`}
        >
          <h4 id={`breakthrough-group-${group.key}`} className="breakthrough-group__title">
            {group.label}
          </h4>
          {group.requirements.map((requirement) => (
            <article
              key={requirement.asset_id}
              className={`breakthrough-requirement breakthrough-requirement--${requirement.status.toLowerCase()}`}
            >
              <div className="breakthrough-requirement__head">
                <strong>{requirement.label}</strong>
                <span>{requirement.statusLabel}</span>
              </div>
              <p>{formatBreakthroughRequirement(requirement)}</p>
              <button
                className="chip-button"
                type="button"
                onClick={() => onSource(requirement.sourcePath)}
              >
                前往来源 · {requirement.sourceLabel}
              </button>
            </article>
          ))}
        </section>
      ))}
    </div>
  );
}

function ChoiceButton({
  choiceId,
  selected,
  disabled,
  onSelect,
  label,
  note,
}: {
  readonly choiceId: string;
  readonly selected: boolean;
  readonly disabled: boolean;
  readonly onSelect: (choiceId: string) => void;
  readonly label: string;
  readonly note: string;
}): ReactElement {
  return (
    <button
      type="button"
      className={`breakthrough-choice ${selected ? 'breakthrough-choice--selected' : ''}`}
      aria-pressed={selected}
      disabled={disabled}
      onClick={() => onSelect(choiceId)}
    >
      <strong>{label}</strong>
      <span>{note}</span>
    </button>
  );
}

function UnlockResult({
  response,
  onRefresh,
}: {
  readonly response: BreakthroughRunResponse;
  readonly onRefresh: () => void;
}): ReactElement {
  const result = response.run.result;
  if (result === null)
    return (
      <EmptyStateScreen
        title="完成结果等待同步"
        description="试炼已经完成，正在整理结果。"
        actions={[{ label: '刷新', onClick: onRefresh }]}
      />
    );
  return (
    <div className="breakthrough-success">
      <NormalStateScreen
        title="筑基完成"
        description="境界已提升，新的修行内容已经开放。"
        highlight="成功率 100% · 非随机失败"
        footnote="筑基结果已由洞天规则结算。"
        actions={[{ label: '查看新境界', onClick: onRefresh }]}
      />
      <div className="breakthrough-unlock-grid">
        <div>
          <span>新境界</span>
          <strong>{result.unlocked_realm_id}</strong>
        </div>
        <div>
          <span>队列槽</span>
          <strong>{result.queue_slots}</strong>
        </div>
        <div>
          <span>药力槽</span>
          <strong>{result.medicine_slots}</strong>
        </div>
      </div>
      <nav className="breakthrough-success__links" aria-label="筑基后导航">
        <Link className="chip-button" to="/dashboard">
          打开三槽条件队列
        </Link>
        <Link className="chip-button" to="/craft">
          进入二阶百艺
        </Link>
        <Link className="chip-button" to="/expedition">
          进入筑基秘境
        </Link>
      </nav>
    </div>
  );
}

function QueueTemplate({
  queue,
  onSave,
  pending,
  saved,
}: {
  readonly queue: Queue;
  readonly onSave: (draft: BreakthroughQueueDraft) => void;
  readonly pending: boolean;
  readonly saved: boolean;
}): ReactElement {
  const [draft, setDraft] = useState(() => createBreakthroughQueueDraft(queue));
  useEffect(() => {
    setDraft(createBreakthroughQueueDraft(queue));
  }, [queue.queue_version]);
  const plan = toBreakthroughQueuePlan(draft);
  const addEntry = (): void => {
    const id = `custom-${Date.now()}`;
    setDraft((current) =>
      appendBreakthroughQueueEntry(current, {
        client_entry_id: id,
        action_id: 'action.cultivation.qi',
        mode: 'INFINITE',
        on_blocked: 'FALLBACK',
      }),
    );
  };
  return (
    <div className="breakthrough-queue">
      <div className="breakthrough-panel__header">
        <div>
          <h4 className="breakthrough-group__title">三槽条件队列</h4>
          <p>库存达到目标后结束采集，随后进入无限修炼；每项只使用一个 &lt; 或 &gt;= 条件。</p>
        </div>
        <span>{plan.entries.length}/3 槽</span>
      </div>
      <ol className="breakthrough-queue__list">
        {draft.entries.map((entry, index) => (
          <li key={entry.client_entry_id}>
            <div className="breakthrough-queue__controls">
              <label>
                行动{' '}
                <input
                  value={entry.action_id}
                  onChange={(event) =>
                    setDraft((current) =>
                      updateBreakthroughQueueEntry(current, entry.client_entry_id, {
                        action_id: event.target.value,
                      }),
                    )
                  }
                />
              </label>
              <label>
                模式{' '}
                <select
                  value={entry.mode}
                  onChange={(event) =>
                    setDraft((current) =>
                      setBreakthroughQueueEntryMode(
                        current,
                        entry.client_entry_id,
                        event.target.value as BreakthroughQueueMode,
                      ),
                    )
                  }
                >
                  <option value="UNTIL_INVENTORY">库存条件</option>
                  <option value="INFINITE">无限</option>
                </select>
              </label>
              {entry.mode === 'UNTIL_INVENTORY' ? (
                <>
                  <label>
                    物品{' '}
                    <input
                      value={entry.condition_item_id ?? ''}
                      onChange={(event) =>
                        setDraft((current) =>
                          updateBreakthroughQueueEntry(current, entry.client_entry_id, {
                            condition_item_id: event.target.value,
                          }),
                        )
                      }
                    />
                  </label>
                  <label>
                    操作{' '}
                    <select
                      value={entry.condition_operator ?? '>='}
                      onChange={(event) =>
                        setDraft((current) =>
                          updateBreakthroughQueueEntry(current, entry.client_entry_id, {
                            condition_operator: event.target.value,
                          }),
                        )
                      }
                    >
                      <option value=">=">&gt;=</option>
                      <option value="<">&lt;</option>
                    </select>
                  </label>
                  <label>
                    目标{' '}
                    <input
                      inputMode="decimal"
                      value={entry.target_value ?? ''}
                      onChange={(event) =>
                        setDraft((current) =>
                          updateBreakthroughQueueEntry(current, entry.client_entry_id, {
                            target_value: event.target.value,
                          }),
                        )
                      }
                    />
                  </label>
                </>
              ) : null}
              <div className="breakthrough-queue__row-actions">
                <button
                  className="chip-button"
                  type="button"
                  onClick={() =>
                    setDraft((current) =>
                      moveBreakthroughQueueEntry(current, entry.client_entry_id, -1),
                    )
                  }
                  disabled={index === 0}
                >
                  上移
                </button>
                <button
                  className="chip-button"
                  type="button"
                  onClick={() =>
                    setDraft((current) =>
                      moveBreakthroughQueueEntry(current, entry.client_entry_id, 1),
                    )
                  }
                  disabled={index === draft.entries.length - 1}
                >
                  下移
                </button>
                <button
                  className="chip-button"
                  type="button"
                  onClick={() =>
                    setDraft((current) =>
                      removeBreakthroughQueueEntry(current, entry.client_entry_id),
                    )
                  }
                >
                  删除
                </button>
              </div>
            </div>
          </li>
        ))}
      </ol>
      <label>
        默认回退行动{' '}
        <input
          value={draft.fallback_action_id}
          onChange={(event) =>
            setDraft((current) => ({ ...current, fallback_action_id: event.target.value }))
          }
        />
      </label>
      <div className="breakthrough-queue__actions">
        <button
          className="chip-button"
          type="button"
          onClick={addEntry}
          disabled={draft.entries.length >= 3}
        >
          添加槽位
        </button>
        <button
          className="chip-button"
          type="button"
          onClick={() => setDraft(createBreakthroughQueueDraft(queue.queue_version))}
        >
          恢复官方模板
        </button>
        <button
          className="ghost-button"
          type="button"
          onClick={() => onSave(draft)}
          disabled={pending}
        >
          {pending ? '保存中…' : saved ? '已保存当前方案' : '保存当前队列'}
        </button>
      </div>
    </div>
  );
}

export function BreakthroughPage(): ReactElement {
  const session = useOutletContext<AuthActiveSession>();
  const location = useLocation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const searchRunId = useMemo(
    () => new URLSearchParams(location.search).get('run_id'),
    [location.search],
  );
  const [storedRunId, setStoredRunId] = useState<string | null>(() =>
    readStoredRunId(session.character_id),
  );
  const activeRunId = searchRunId ?? storedRunId;
  const [now, setNow] = useState(() => new Date());
  const [state, dispatch] = useReducer(
    breakthroughPageReducer,
    createInitialBreakthroughPageState(activeRunId),
  );
  const [operationError, setOperationError] = useState<BreakthroughOperationError | null>(null);
  const [lastChoiceId, setLastChoiceId] = useState<string | null>(null);
  const [lastQueueDraft, setLastQueueDraft] = useState<BreakthroughQueueDraft | null>(null);
  const [importantOperation, setImportantOperation] = useState<'finalize' | 'abandon' | null>(null);
  const operationKeys = useRef(new Map<string, string>());
  const getOperationKey = (operation: string, runId: string): string => {
    const key = `${runId}:${operation}`;
    const existing = operationKeys.current.get(key);
    if (existing !== undefined) return existing;
    const created = createBreakthroughIdempotencyKey();
    operationKeys.current.set(key, created);
    return created;
  };

  useEffect(() => {
    if (searchRunId === null && storedRunId !== null)
      syncRunSearch(navigate, location.pathname, storedRunId);
  }, [location.pathname, navigate, searchRunId, storedRunId]);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const nextQuery = useQuery<BreakthroughPreviewResponse>({
    queryKey: [QUERY_PREFIX, session.character_id, 'next'],
    queryFn: () => apiClient.getNextBreakthrough(session.character_id),
    enabled: activeRunId === null,
  });
  const runQuery = useQuery<BreakthroughRunResponse>({
    queryKey: [QUERY_PREFIX, session.character_id, 'run', activeRunId],
    queryFn: () => apiClient.getBreakthroughRun(activeRunId as string),
    enabled: activeRunId !== null,
  });
  const queueQuery = useQuery({
    queryKey: [QUERY_PREFIX, session.character_id, 'queue'],
    queryFn: () => apiClient.getQueue(session.character_id),
    enabled: runQuery.data?.run.status === 'COMPLETED',
  });

  useEffect(() => {
    const run = runQuery.data?.run;
    if (run !== undefined) dispatch({ type: 'hydrate-run', run });
  }, [runQuery.data?.run]);
  useEffect(() => {
    if (runQuery.error instanceof ApiClientError && runQuery.error.status === 404) {
      dispatch({ type: 'clear-pending-start' });
      storeRunId(session.character_id, null);
      setStoredRunId(null);
      syncRunSearch(navigate, location.pathname, null);
    }
  }, [location.pathname, navigate, runQuery.error, session.character_id]);
  useEffect(() => {
    if (
      searchRunId === null &&
      storedRunId === null &&
      nextQuery.data?.active_run !== undefined &&
      nextQuery.data.active_run !== null
    ) {
      const runId = nextQuery.data.active_run.breakthrough_run_id;
      storeRunId(session.character_id, runId);
      setStoredRunId(runId);
      syncRunSearch(navigate, location.pathname, runId);
    }
  }, [
    location.pathname,
    navigate,
    nextQuery.data?.active_run,
    searchRunId,
    session.character_id,
    storedRunId,
  ]);

  const refreshAll = async (): Promise<void> => {
    await queryClient.invalidateQueries({ queryKey: [QUERY_PREFIX, session.character_id] });
  };

  const startMutation = useMutation({
    mutationFn: () => {
      if (nextQuery.data === undefined) throw new Error('BREAKTHROUGH_PREVIEW_NOT_READY');
      const idempotencyKey = state.pendingIdempotencyKey ?? createBreakthroughIdempotencyKey();
      dispatch({ type: 'prepare-start', idempotencyKey });
      return apiClient.startBreakthrough(
        session.character_id,
        {
          expected_state_version: nextQuery.data.character.state_version,
          config_version: nextQuery.data.config_version,
        },
        idempotencyKey,
      );
    },
    onSuccess: async (response) => {
      dispatch({ type: 'clear-pending-start' });
      setOperationError(null);
      const runId = response.run.breakthrough_run_id;
      storeRunId(session.character_id, runId);
      setStoredRunId(runId);
      syncRunSearch(navigate, location.pathname, runId);
      queryClient.setQueryData([QUERY_PREFIX, session.character_id, 'run', runId], response);
      await refreshAll();
    },
    onError: (error) => {
      const message = formatMutationError(error);
      dispatch({ type: 'start-failed', message });
      setOperationError({ operation: 'start', message });
    },
  });
  const runResponse = runQuery.data;
  const chooseMutation = useMutation({
    mutationFn: (choiceId: string) => {
      if (runResponse === undefined) throw new Error('BREAKTHROUGH_RUN_NOT_READY');
      return apiClient.chooseBreakthroughRoute(
        runResponse.run.breakthrough_run_id,
        { choice_id: choiceId, expected_run_version: runResponse.run.run_version },
        getOperationKey('choice', runResponse.run.breakthrough_run_id),
      );
    },
    onSuccess: async (response) => {
      setOperationError(null);
      queryClient.setQueryData(
        [QUERY_PREFIX, session.character_id, 'run', response.run.breakthrough_run_id],
        response,
      );
      await refreshAll();
    },
    onError: (error) =>
      setOperationError({ operation: 'choice', message: formatMutationError(error) }),
  });
  const finalizeMutation = useMutation({
    mutationFn: () => {
      if (runResponse === undefined) throw new Error('BREAKTHROUGH_RUN_NOT_READY');
      return apiClient.finalizeBreakthroughRun(
        runResponse.run.breakthrough_run_id,
        getOperationKey('finalize', runResponse.run.breakthrough_run_id),
      );
    },
    onSuccess: async (response) => {
      setOperationError(null);
      queryClient.setQueryData(
        [QUERY_PREFIX, session.character_id, 'run', response.run.breakthrough_run_id],
        response,
      );
      await queryClient.invalidateQueries({ queryKey: ['dashboard', session.character_id] });
      await queryClient.invalidateQueries({ queryKey: [QUERY_PREFIX, session.character_id] });
    },
    onError: (error) =>
      setOperationError({ operation: 'finalize', message: formatMutationError(error) }),
  });
  const abandonMutation = useMutation({
    mutationFn: () =>
      runResponse === undefined
        ? Promise.reject(new Error('BREAKTHROUGH_RUN_NOT_READY'))
        : apiClient.abandonBreakthroughRun(
            runResponse.run.breakthrough_run_id,
            getOperationKey('abandon', runResponse.run.breakthrough_run_id),
          ),
    onSuccess: async (response) => {
      setOperationError(null);
      dispatch({ type: 'clear-pending-start' });
      storeRunId(session.character_id, null);
      setStoredRunId(null);
      syncRunSearch(navigate, location.pathname, null);
      queryClient.setQueryData(
        [QUERY_PREFIX, session.character_id, 'run', response.run.breakthrough_run_id],
        response,
      );
      await refreshAll();
    },
    onError: (error) =>
      setOperationError({ operation: 'abandon', message: formatMutationError(error) }),
  });
  const saveQueueMutation = useMutation({
    mutationFn: (draft: BreakthroughQueueDraft) =>
      queueQuery.data === undefined
        ? Promise.reject(new Error('QUEUE_NOT_READY'))
        : apiClient.saveQueue(
            session.character_id,
            toBreakthroughQueuePlan(draft),
            getOperationKey(`queue-${queueQuery.data.queue_version}`, activeRunId ?? 'completed'),
          ),
    onSuccess: async () => {
      setOperationError(null);
      await queryClient.invalidateQueries({
        queryKey: [QUERY_PREFIX, session.character_id, 'queue'],
      });
      await queryClient.invalidateQueries({ queryKey: ['dashboard', session.character_id] });
    },
    onError: (error) =>
      setOperationError({ operation: 'queue', message: formatMutationError(error) }),
  });

  const firstError = nextQuery.error ?? runQuery.error;
  if (nextQuery.isPending || runQuery.isPending) return <BreakthroughLoading />;
  if (firstError !== null && firstError !== undefined) {
    const error = firstError instanceof ApiClientError;
    if (error && firstError.status === 503)
      return <BreakthroughMaintenance reason={firstError.message} onRetry={refreshAll} />;
    if (error && (firstError.status === 401 || firstError.status === 403))
      return <BreakthroughLocked reason={firstError.message} onRetry={refreshAll} />;
    return <BreakthroughError error={firstError.message} onRetry={refreshAll} />;
  }

  if (runResponse === undefined && nextQuery.data === undefined) return <BreakthroughLoading />;
  const previewResponse =
    runResponse === undefined
      ? nextQuery.data
      : {
          character: runResponse.character,
          breakthrough: runResponse.run.preview_snapshot,
          config_version: runResponse.config_version,
        };
  if (previewResponse === undefined) return <BreakthroughLoading />;
  const view = buildBreakthroughPageView(previewResponse);
  const run = runResponse?.run;
  const canFinalize =
    run?.status === 'TRIAL_WAITING_CHOICE' &&
    run.selected_choice_id !== null &&
    new Date(run.trial_deadline_at).getTime() <= now.getTime();
  const isChoiceStep = run?.status === 'TRIAL_ACTIVE' || run?.status === 'TRIAL_WAITING_CHOICE';
  const clearReleasedRun = (): void => {
    dispatch({ type: 'clear-pending-start' });
    storeRunId(session.character_id, null);
    setStoredRunId(null);
    syncRunSearch(navigate, location.pathname, null);
    void queryClient.invalidateQueries({ queryKey: [QUERY_PREFIX, session.character_id] });
  };
  const retryOperation = (): void => {
    if (operationError === null) return;
    if (operationError.operation === 'start') startMutation.mutate();
    else if (operationError.operation === 'choice' && lastChoiceId !== null)
      chooseMutation.mutate(lastChoiceId);
    else if (operationError.operation === 'finalize') finalizeMutation.mutate();
    else if (operationError.operation === 'abandon') abandonMutation.mutate();
    else if (operationError.operation === 'queue' && lastQueueDraft !== null)
      saveQueueMutation.mutate(lastQueueDraft);
  };

  return (
    <section className="breakthrough-layout">
      <div className="breakthrough-panel breakthrough-panel--hero">
        <NormalStateScreen
          title={`筑基 · ${view.targetRealmLabel}`}
          description="先核对四类门槛，再确认预留；试炼状态会自动恢复。"
          highlight={run === undefined ? view.successLabel : breakthroughRunStatusLabel(run.status)}
          footnote="门槛与结果均以洞天规则为准。"
          actions={run === undefined ? [{ label: '刷新条件', onClick: refreshAll }] : []}
        />
      </div>
      <div className="breakthrough-panel">
        <div className="breakthrough-panel__header">
          <div>
            <p className="page-card__eyebrow">目标与门槛</p>
            <h3 className="breakthrough-panel__title">筑基条件</h3>
          </div>
          <span>{view.allSatisfied ? '已满足' : '仍有缺口'}</span>
        </div>
        <RequirementList response={previewResponse} onSource={(path) => navigate(path)} />
        {run === undefined ? (
          <Dialog.Root
            open={state.confirmationOpen}
            onOpenChange={(open) =>
              dispatch({ type: open ? 'open-confirmation' : 'close-confirmation' })
            }
          >
            <button className="ghost-button" type="button" disabled={!view.allSatisfied} onClick={() => {
              if (shouldConfirmImportantActions()) dispatch({ type: 'open-confirmation' });
              else startMutation.mutate();
            }}>
              确认消耗并开始 15 分钟试炼
            </button>
            <Dialog.Portal>
              <Dialog.Overlay className="cave-dialog__overlay" />
              <Dialog.Content className="cave-dialog__content">
                <Dialog.Title className="cave-dialog__title">确认预留筑基材料</Dialog.Title>
                <Dialog.Description className="cave-dialog__description">
                  开始后洞天会预留全部材料，预留资产不会再次计入可用库存；24
                  小时内可恢复或放弃。
                </Dialog.Description>
                <ul className="breakthrough-commit-list">
                  {view.requirements.map((requirement) => (
                    <li key={requirement.asset_id}>
                      <strong>{requirement.label}</strong>
                      <span>
                        {requirement.asset_type === 'CULTIVATION_XP'
                          ? `达成 ${requirement.required}`
                          : `预留 ${requirement.required}`}
                      </span>
                    </li>
                  ))}
                </ul>
                <div className="cave-dialog__actions">
                  <button
                    className="ghost-button"
                    type="button"
                    disabled={startMutation.isPending}
                    onClick={() => startMutation.mutate()}
                  >
                    {startMutation.isPending ? '提交中…' : '确认开始'}
                  </button>
                  <Dialog.Close asChild>
                    <button className="ghost-button" type="button">
                      取消
                    </button>
                  </Dialog.Close>
                </div>
              </Dialog.Content>
            </Dialog.Portal>
          </Dialog.Root>
        ) : null}
      </div>
      <div className="breakthrough-panel">
        <div className="breakthrough-panel__header">
          <div>
            <p className="page-card__eyebrow">试炼节点与恢复</p>
            <h3 className="breakthrough-panel__title">
              {run === undefined ? '尚未开始' : breakthroughRunStatusLabel(run.status)}
            </h3>
          </div>
          {run ? <span>节点 {run.current_node_id}</span> : null}
        </div>
        {run === undefined ? (
          <EmptyStateScreen
            title="预留前不创建试炼"
            description="条件满足后才会创建唯一 active run。"
          />
        ) : run.status === 'COMPLETED' ? (
          <UnlockResult response={runResponse as BreakthroughRunResponse} onRefresh={refreshAll} />
        ) : (
          <div className="breakthrough-runtime">
            <p>
              预留快照：
              {run.reservation_snapshot
                .map((asset) => `${asset.asset_id} × ${asset.quantity}`)
                .join(' · ') || '无'}
            </p>
            <p>
              试炼截止：{run.trial_deadline_at} · 倒计时{' '}
              {formatCountdown(run.trial_deadline_at, now)}
            </p>
            {isChoiceStep ? (
              <div className="breakthrough-choice-list">
                <ChoiceButton
                  choiceId={SAFE_CHOICE_ID}
                  label="安全撤离"
                  note="稳妥路线，不增加高风险标记"
                  selected={run.selected_choice_id === SAFE_CHOICE_ID}
                  disabled={chooseMutation.isPending || run.selected_choice_id !== null}
                  onSelect={(choiceId) => {
                    setLastChoiceId(choiceId);
                    chooseMutation.mutate(choiceId);
                  }}
                />
                <ChoiceButton
                  choiceId={HIGH_RISK_CHOICE_ID}
                  label="深入险地"
                  note="高风险路线，仍需等待试炼节点完成"
                  selected={run.selected_choice_id === HIGH_RISK_CHOICE_ID}
                  disabled={chooseMutation.isPending || run.selected_choice_id !== null}
                  onSelect={(choiceId) => {
                    setLastChoiceId(choiceId);
                    chooseMutation.mutate(choiceId);
                  }}
                />
              </div>
            ) : null}
            <button
              className="ghost-button"
              type="button"
              disabled={!canFinalize || finalizeMutation.isPending}
              onClick={() => {
                if (shouldConfirmImportantActions()) setImportantOperation('finalize');
                else finalizeMutation.mutate();
              }}
            >
              {finalizeMutation.isPending
                ? '完成中…'
                : canFinalize
                  ? '完成筑基'
                  : '等待试炼节点完成'}
            </button>
            {run.status !== 'FAILED_RECOVERABLE' && run.status !== 'ABANDONED' ? (
              <button
                className="chip-button"
                type="button"
                disabled={abandonMutation.isPending}
                onClick={() => {
                  if (shouldConfirmImportantActions()) setImportantOperation('abandon');
                  else abandonMutation.mutate();
                }}
              >
                放弃并释放预留
              </button>
            ) : null}
            {run.status === 'FAILED_RECOVERABLE' || run.status === 'ABANDONED' ? (
              <button className="ghost-button" type="button" onClick={clearReleasedRun}>
                返回筑基条件
              </button>
            ) : null}
          </div>
        )}
      </div>
      {run?.status === 'COMPLETED' && queueQuery.data !== undefined ? (
        <div className="breakthrough-panel">
          <QueueTemplate
            queue={queueQuery.data}
            onSave={(draft) => {
              setLastQueueDraft(draft);
              saveQueueMutation.mutate(draft);
            }}
            pending={saveQueueMutation.isPending}
            saved={saveQueueMutation.isSuccess}
          />
        </div>
      ) : null}
      {operationError !== null ? (
        <div className="breakthrough-panel">
          <LocalErrorStateScreen
            title="筑基操作未完成"
            description="本次操作暂未完成，可以沿用本次操作重试。"
            actions={[{ label: '沿用本次操作重试', onClick: retryOperation }]}
          />
        </div>
      ) : null}
      <ImportantActionDialog
        open={importantOperation !== null}
        onOpenChange={(open) => {
          if (!open) setImportantOperation(null);
        }}
        title={importantOperation === 'abandon' ? '确认放弃筑基试炼' : '确认完成筑基'}
        description={importantOperation === 'abandon' ? '放弃会释放本次预留材料，试炼进度不会保留。' : '完成会提交筑基结果并推进角色境界，操作不可撤回。'}
        confirmLabel={importantOperation === 'abandon' ? '确认放弃' : '确认完成'}
        pending={finalizeMutation.isPending || abandonMutation.isPending}
        onConfirm={() => {
          const operation = importantOperation;
          setImportantOperation(null);
          if (operation === 'abandon') abandonMutation.mutate();
          else if (operation === 'finalize') finalizeMutation.mutate();
        }}
      />
    </section>
  );
}
