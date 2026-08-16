import { useEffect, useMemo, useReducer, useState, type ReactElement } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocation, useNavigate, useOutletContext } from 'react-router';

import {
  ApiClientError,
  type AuthActiveSession,
  type CharacterProgression,
  type EquipmentInstance,
  type InventorySnapshot,
  type LoadoutPreset,
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
import {
  buildEquipmentSelectionView,
  buildEquipmentSlotComparisonRows,
  formatEquipmentSlotLabel,
  summarizeEquipmentError,
  summarizeLoadoutPreset,
} from './equipment-adapter.js';
import {
  createInitialEquipmentEditorState,
  createLoadoutSaveRequest,
  equipmentEditorReducer,
  isLoadoutComplete,
} from './equipment-editor.js';

const EQUIPMENT_QUERY_PREFIX = 'equipment';

type EquipmentNoticeKind = 'success' | 'error' | 'info';

interface EquipmentNotice {
  readonly kind: EquipmentNoticeKind;
  readonly title: string;
  readonly description: string;
  readonly footnote?: string;
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

  navigate({ pathname, search: params.toString().length > 0 ? `?${params.toString()}` : '' });
}

function createIdempotencyKey(): string {
  return typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `tmp-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function useEquipmentQueries(characterId: string, presetId: string, comparePresetId: string) {
  const progressionQuery = useQuery<CharacterProgression>({
    queryKey: [EQUIPMENT_QUERY_PREFIX, characterId, 'progression'],
    queryFn: () => apiClient.getProgression(characterId),
  });

  const inventoryQuery = useQuery<InventorySnapshot>({
    queryKey: [EQUIPMENT_QUERY_PREFIX, characterId, 'inventory'],
    queryFn: () => apiClient.getInventory(characterId),
  });

  const presetQuery = useQuery<LoadoutPreset>({
    queryKey: [EQUIPMENT_QUERY_PREFIX, characterId, 'preset', presetId],
    queryFn: () => apiClient.getLoadoutPreset(characterId, presetId),
    enabled: presetId.length > 0,
  });

  const comparePresetQuery = useQuery<LoadoutPreset>({
    queryKey: [EQUIPMENT_QUERY_PREFIX, characterId, 'preset-compare', comparePresetId],
    queryFn: () => apiClient.getLoadoutPreset(characterId, comparePresetId),
    enabled: comparePresetId.length > 0,
  });

  return { progressionQuery, inventoryQuery, presetQuery, comparePresetQuery };
}

export function EquipmentLoading(): ReactElement {
  return (
    <section className="equipment-layout">
      <div className="equipment-panel equipment-panel--hero">
        <LoadingStateScreen title="正在读取装备权威快照" description="先拉取修为、背包和预设，再渲染装备与比较面板。" />
      </div>
      <div className="equipment-panel">
        <LoadingStateScreen title="装备实例" description="等待库存中的装备实例。" />
      </div>
      <div className="equipment-panel">
        <LoadingStateScreen title="预设编辑" description="等待当前装备预设。" />
      </div>
      <div className="equipment-panel">
        <LoadingStateScreen title="属性比较" description="等待比较预设或当前预设。" />
      </div>
    </section>
  );
}

export function EquipmentError({ error, onRetry }: { readonly error: string; readonly onRetry: () => void }): ReactElement {
  return (
    <section className="equipment-layout">
      <div className="equipment-panel equipment-panel--hero">
        <LocalErrorStateScreen title="装备页读取失败" description="装备页读取失败，草稿与比较状态保持不变。" actions={[{ label: '重试', onClick: onRetry }]} footnote={error} />
      </div>
      <div className="equipment-panel">
        <EmptyStateScreen title="装备实例" description="读取失败时不展示伪造内容。" />
      </div>
      <div className="equipment-panel">
        <EmptyStateScreen title="预设编辑" description="读取失败时不展示伪造内容。" />
      </div>
      <div className="equipment-panel">
        <EmptyStateScreen title="属性比较" description="读取失败时不展示伪造内容。" />
      </div>
    </section>
  );
}

export function EquipmentMaintenance({ reason, onRetry }: { readonly reason: string; readonly onRetry: () => void }): ReactElement {
  return (
    <section className="equipment-layout">
      <div className="equipment-panel equipment-panel--hero">
        <MaintenanceStateScreen title="装备页维护中" description="装备 API 或依赖当前不可用。" actions={[{ label: '重试', onClick: onRetry }]} footnote={reason} />
      </div>
      <div className="equipment-panel">
        <EmptyStateScreen title="装备实例" description="维护期间不展示伪造内容。" />
      </div>
      <div className="equipment-panel">
        <EmptyStateScreen title="预设编辑" description="维护期间不展示伪造内容。" />
      </div>
      <div className="equipment-panel">
        <EmptyStateScreen title="属性比较" description="维护期间不展示伪造内容。" />
      </div>
    </section>
  );
}

export function EquipmentLocked({ reason, onRetry }: { readonly reason: string; readonly onRetry: () => void }): ReactElement {
  return (
    <section className="equipment-layout">
      <div className="equipment-panel equipment-panel--hero">
        <LockedStateScreen title="装备功能受限" description="当前账号已认证，但装备页没有解锁或没有权限。" actions={[{ label: '重试', onClick: onRetry }]} footnote={reason} />
      </div>
      <div className="equipment-panel">
        <EmptyStateScreen title="装备实例" description="当前无法读取装备实例。" />
      </div>
      <div className="equipment-panel">
        <EmptyStateScreen title="预设编辑" description="当前无法读取预设。" />
      </div>
      <div className="equipment-panel">
        <EmptyStateScreen title="属性比较" description="当前无法读取比较数据。" />
      </div>
    </section>
  );
}

export function EquipmentMissingPreset({ onOpenInventory }: { readonly onOpenInventory: () => void }): ReactElement {
  return (
    <section className="equipment-layout">
      <div className="equipment-panel equipment-panel--hero">
        <EmptyStateScreen
          title="请输入 preset_id"
          description="装备页没有预设列表接口，必须显式指定要读取的 preset_id，才能进行保存、启用和比较。"
          actions={[{ label: '去背包比较', onClick: onOpenInventory }]}
          footnote="可以通过地址栏或输入框设置 preset_id 和 compare_preset_id。"
        />
      </div>
      <div className="equipment-panel">
        <EmptyStateScreen title="装备实例" description="先选择一个 preset_id 后再读取实例与槽位。" />
      </div>
      <div className="equipment-panel">
        <EmptyStateScreen title="预设编辑" description="当前没有可编辑的权威预设。" />
      </div>
      <div className="equipment-panel">
        <EmptyStateScreen title="属性比较" description="先输入比较目标再读取比较数据。" />
      </div>
    </section>
  );
}

function EquipmentPanelHeader({
  title,
  copy,
}: {
  readonly title: string;
  readonly copy: string;
}): ReactElement {
  return (
    <div className="equipment-panel__header">
      <div>
        <p className="page-card__eyebrow">角色 · 装备</p>
        <h3 className="page-card__title">{title}</h3>
      </div>
      <p className="page-card__copy">{copy}</p>
    </div>
  );
}

function EquipmentInstanceCard({
  instance,
  selected,
  assignedSlot,
  onOpen,
  onAssign,
}: {
  readonly instance: EquipmentInstance;
  readonly selected: boolean;
  readonly assignedSlot: string | null;
  readonly onOpen: () => void;
  readonly onAssign: (slot: 'WEAPON' | 'ARMOR' | 'ACCESSORY') => void;
}): ReactElement {
  return (
    <article className={`equipment-instance ${selected ? 'equipment-instance--selected' : ''}`}>
      <button className="equipment-instance__title-button" type="button" onClick={onOpen}>
        <span className="equipment-instance__title-row">
          <strong>{instance.instance_id}</strong>
          <span className="equipment-chip">{instance.bound ? '已绑定' : '未绑定'}</span>
        </span>
        <span className="equipment-instance__subtitle">{instance.item_id}</span>
      </button>
      <p className="equipment-instance__copy">强化 +{instance.temper_level} · 配置 {instance.created_config_version}</p>
      <div className="equipment-instance__meta">
        <span className="equipment-chip">实例比较</span>
        <span className="equipment-chip">{assignedSlot ?? '未上阵'}</span>
      </div>
      <div className="equipment-instance__actions">
        <button className="chip-button" type="button" onClick={() => onAssign('WEAPON')}>
          用作武器
        </button>
        <button className="chip-button" type="button" onClick={() => onAssign('ARMOR')}>
          用作防具
        </button>
        <button className="chip-button" type="button" onClick={() => onAssign('ACCESSORY')}>
          用作饰品
        </button>
      </div>
    </article>
  );
}

function EquipmentSlotCard({
  slot,
  currentPreset,
  comparePreset,
  inventory,
  onClearSlot,
  onInspectInstance,
}: {
  readonly slot: 'WEAPON' | 'ARMOR' | 'ACCESSORY';
  readonly currentPreset: LoadoutPreset | null;
  readonly comparePreset: LoadoutPreset | null;
  readonly inventory: InventorySnapshot;
  readonly onClearSlot: () => void;
  readonly onInspectInstance: (instanceId: string) => void;
}): ReactElement {
  const rows = buildEquipmentSlotComparisonRows(currentPreset, comparePreset, inventory);
  const row = rows.find((item) => item.slot === slot) ?? null;
  if (row === null) {
    return <EmptyStateScreen title="缺少比较行" description="当前槽位无法读取。" />;
  }

  return (
    <article className="equipment-slot">
      <div className="equipment-slot__header">
        <div>
          <strong>{formatEquipmentSlotLabel(slot)}</strong>
          <p>{row.diffSummary}</p>
        </div>
        <button className="chip-button" type="button" onClick={onClearSlot} disabled={row.currentInstanceId === null}>
          清空
        </button>
      </div>
      <div className="equipment-slot__body">
        <div className="equipment-slot__compare">
          <span>当前</span>
          <strong>{row.currentInstanceId ?? '未装备'}</strong>
          <button className="ghost-button ghost-button--compact" type="button" onClick={() => row.currentInstanceId && onInspectInstance(row.currentInstanceId)}>
            查看实例
          </button>
        </div>
        <div className="equipment-slot__compare">
          <span>比较</span>
          <strong>{row.compareInstanceId ?? '未配置'}</strong>
          <button className="ghost-button ghost-button--compact" type="button" onClick={() => row.compareInstanceId && onInspectInstance(row.compareInstanceId)}>
            查看实例
          </button>
        </div>
      </div>
      <p className="equipment-slot__copy">{row.summary}</p>
    </article>
  );
}

function EquipmentNoticeCard({ notice }: { readonly notice: EquipmentNotice | null }): ReactElement {
  if (notice === null) {
    return <EmptyStateScreen title="操作反馈" description="保存、启用和刷新后的结果会显示在这里。" />;
  }

  if (notice.kind === 'error') {
    return <LocalErrorStateScreen title={notice.title} description={notice.description} footnote={notice.footnote} />;
  }

  if (notice.kind === 'success') {
    return <NormalStateScreen title={notice.title} description={notice.description} footnote={notice.footnote} highlight="权威响应已返回" />;
  }

  return <NormalStateScreen title={notice.title} description={notice.description} footnote={notice.footnote} highlight="提示" />;
}

function buildMutationNotice(error: unknown): EquipmentNotice {
  if (error instanceof ApiClientError) {
    return {
      kind: 'error',
      title: `写入失败 · HTTP ${error.status}`,
      description: summarizeEquipmentError(error.status, error.code, error.details),
      footnote: error.message,
    };
  }

  return {
    kind: 'error',
    title: '写入失败',
    description: error instanceof Error ? error.message : '未知错误',
  };
}

function getSelectedInstanceAssignment(
  instanceId: string | null,
  preset: LoadoutPreset | null,
): string | null {
  if (instanceId === null || preset === null) {
    return null;
  }

  if (preset.weapon_instance_id === instanceId) {
    return '武器';
  }
  if (preset.armor_instance_id === instanceId) {
    return '防具';
  }
  if (preset.accessory_instance_id === instanceId) {
    return '饰品';
  }
  return null;
}

export function CharacterEquipmentPage(): ReactElement {
  const session = useOutletContext<AuthActiveSession>();
  const navigate = useNavigate();
  const location = useLocation();
  const queryClient = useQueryClient();
  const params = useMemo(() => parseSearch(location.search), [location.search]);
  const [editorState, dispatch] = useReducer(equipmentEditorReducer, createInitialEquipmentEditorState());
  const [notice, setNotice] = useState<EquipmentNotice | null>(null);
  const [presetInput, setPresetInput] = useState(params.get('preset_id') ?? '');
  const [comparePresetInput, setComparePresetInput] = useState(params.get('compare_preset_id') ?? '');

  const presetId = params.get('preset_id') ?? '';
  const comparePresetId = params.get('compare_preset_id') ?? '';
  const selectedInstanceId = params.get('instance_id');

  useEffect(() => {
    setPresetInput(presetId);
    setComparePresetInput(comparePresetId);
  }, [comparePresetId, presetId]);

  const { progressionQuery, inventoryQuery, presetQuery, comparePresetQuery } = useEquipmentQueries(session.character_id, presetId, comparePresetId);

  useEffect(() => {
    if (presetId.length === 0) {
      dispatch({ type: 'reset' });
    }
  }, [presetId]);

  useEffect(() => {
    if (presetQuery.data !== undefined) {
      dispatch({ type: 'hydrate', preset: presetQuery.data });
    }
  }, [presetQuery.data]);

  const currentPreset = presetQuery.data ?? null;
  const comparePreset = comparePresetQuery.data ?? currentPreset;
  const inventory = inventoryQuery.data ?? null;
  const progression = progressionQuery.data ?? null;
  const selectedInstanceView = useMemo(
    () => (inventory === null ? null : buildEquipmentSelectionView(selectedInstanceId, inventory, currentPreset, comparePreset)),
    [comparePreset, currentPreset, inventory, selectedInstanceId],
  );
  const comparisonRows = useMemo(
    () => (inventory === null ? [] : buildEquipmentSlotComparisonRows(currentPreset, comparePreset, inventory)),
    [comparePreset, currentPreset, inventory],
  );

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (editorState.draft === null) {
        throw new Error('NO_DRAFT');
      }
      return apiClient.saveLoadoutPreset(session.character_id, editorState.draft.presetId, createLoadoutSaveRequest(editorState.draft), createIdempotencyKey());
    },
    onSuccess: (data) => {
      dispatch({ type: 'mark-saved', preset: data });
      setNotice({
        kind: 'success',
        title: '预设已保存',
        description: summarizeLoadoutPreset(data),
        footnote: '仅修改预设，不会立刻改动当前周期中的战斗快照。',
      });
      void queryClient.invalidateQueries({ queryKey: [EQUIPMENT_QUERY_PREFIX, session.character_id] });
    },
    onError: (error: unknown) => {
      if (error instanceof ApiClientError && error.status === 409) {
        dispatch({
          type: 'mark-conflict',
          conflict: {
            expectedStateVersion: editorState.draft?.expectedStateVersion ?? '0',
            actualStateVersion: String((error.details as { readonly actual?: unknown } | undefined)?.actual ?? 'unknown'),
          },
        });
      }
      setNotice(buildMutationNotice(error));
    },
  });

  const equipMutation = useMutation({
    mutationFn: async () => {
      if (editorState.draft === null) {
        throw new Error('NO_DRAFT');
      }
      return apiClient.equipLoadoutPreset(session.character_id, editorState.draft.presetId, createIdempotencyKey());
    },
    onSuccess: (data) => {
      dispatch({ type: 'mark-saved', preset: data });
      setNotice({
        kind: 'success',
        title: '预设已启用',
        description: summarizeLoadoutPreset(data),
        footnote: data.effective_next_cycle ? '下周期生效，当前战斗和资产不被本地修改。' : '已生效。',
      });
      void queryClient.invalidateQueries({ queryKey: [EQUIPMENT_QUERY_PREFIX, session.character_id] });
    },
    onError: (error: unknown) => {
      setNotice(buildMutationNotice(error));
    },
  });

  const refreshAll = () => {
    void Promise.all([
      progressionQuery.refetch(),
      inventoryQuery.refetch(),
      presetId.length > 0 ? presetQuery.refetch() : Promise.resolve(),
      comparePresetId.length > 0 ? comparePresetQuery.refetch() : Promise.resolve(),
    ]);
  };

  const goToInventory = () => {
    syncSearch(navigate, '/inventory', '', { item_id: selectedInstanceId, tab: null, action_id: null, recipe_id: null });
  };

  if (progressionQuery.isPending || inventoryQuery.isPending) {
    return <EquipmentLoading />;
  }

  const firstError = progressionQuery.error ?? inventoryQuery.error;
  if (firstError !== undefined && firstError !== null) {
    if (firstError instanceof ApiClientError && firstError.status === 503) {
      return <EquipmentMaintenance reason={firstError.message} onRetry={refreshAll} />;
    }
    if (firstError instanceof ApiClientError && firstError.status === 403) {
      return <EquipmentLocked reason={firstError.message} onRetry={refreshAll} />;
    }

    return <EquipmentError error={firstError.message} onRetry={refreshAll} />;
  }

  if (progression === null || inventory === null) {
    return <EquipmentLoading />;
  }

  if (presetId.length === 0) {
    return <EquipmentMissingPreset onOpenInventory={goToInventory} />;
  }

  const presetError = presetQuery.error;
  const presetMissing = presetError instanceof ApiClientError && presetError.status === 404;
  const presetLocked = presetError instanceof ApiClientError && presetError.status === 403;
  const presetMaintenance = presetError instanceof ApiClientError && presetError.status === 503;
  const compareMissing = comparePresetQuery.error instanceof ApiClientError && comparePresetQuery.error.status === 404;

  const currentDraft = editorState.draft;
  const isComplete = isLoadoutComplete(currentDraft);
  const selectedAssignment = getSelectedInstanceAssignment(selectedInstanceId, currentPreset);

  return (
    <section className="equipment-layout">
      <div className="equipment-panel equipment-panel--hero">
        <div className="equipment-hero">
          <div>
            <p className="page-card__eyebrow">角色</p>
            <h3 className="page-card__title">装备实例、预设和比较都只依赖权威读写</h3>
            <p className="page-card__copy">
              当前页只负责展示、编辑和提交预设；不会本地修改当前战斗、资产或下周期结果。保存和启用都带幂等键，启用会明确标注下周期生效。
            </p>
          </div>
          <div className="dashboard-metrics">
            <div className="metric-chip">
              <span className="metric-chip__label">角色</span>
              <strong className="metric-chip__value">{progression.character.name}</strong>
            </div>
            <div className="metric-chip">
              <span className="metric-chip__label">状态版本</span>
              <strong className="metric-chip__value">{progression.character.state_version}</strong>
            </div>
            <div className="metric-chip">
              <span className="metric-chip__label">装备实例</span>
              <strong className="metric-chip__value">{inventory.equipment_instances.length}</strong>
            </div>
            <div className="metric-chip">
              <span className="metric-chip__label">预设</span>
              <strong className="metric-chip__value">{summarizeLoadoutPreset(currentPreset)}</strong>
            </div>
          </div>
          <div className="equipment-hero__controls">
            <label className="equipment-form__field">
              <span className="equipment-form__label">preset_id</span>
              <input className="equipment-form__input" value={presetInput} onChange={(event) => setPresetInput(event.target.value)} placeholder="preset-uuid" />
            </label>
            <label className="equipment-form__field">
              <span className="equipment-form__label">compare_preset_id</span>
              <input className="equipment-form__input" value={comparePresetInput} onChange={(event) => setComparePresetInput(event.target.value)} placeholder="compare-uuid" />
            </label>
            <div className="equipment-hero__actions">
              <button
                className="ghost-button"
                type="button"
                onClick={() => syncSearch(navigate, location.pathname, location.search, {
                  preset_id: presetInput.trim().length > 0 ? presetInput.trim() : null,
                  compare_preset_id: comparePresetInput.trim().length > 0 ? comparePresetInput.trim() : null,
                  instance_id: selectedInstanceId,
                })}
              >
                打开预设
              </button>
              <button className="ghost-button" type="button" onClick={refreshAll}>
                刷新权威
              </button>
              <button className="ghost-button" type="button" onClick={goToInventory}>
                去背包比较
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="equipment-panel">
        <EquipmentPanelHeader title="装备实例" copy="列表直接来自 inventory.equipment_instances，只有权威实例，没有本地估算或市价按钮。" />
        <div className="equipment-list">
          {inventory.equipment_instances.length === 0 ? <EmptyStateScreen title="没有装备实例" description="当前角色没有可展示的装备实例。" /> : null}
          {inventory.equipment_instances.map((instance) => {
            const slotHint = selectedInstanceId === instance.instance_id ? selectedAssignment ?? '未上阵' : getSelectedInstanceAssignment(instance.instance_id, currentPreset);
            return (
              <EquipmentInstanceCard
                key={instance.instance_id}
                instance={instance}
                selected={selectedInstanceId === instance.instance_id}
                assignedSlot={slotHint}
                onOpen={() => syncSearch(navigate, location.pathname, location.search, { instance_id: instance.instance_id })}
                onAssign={(slot) => {
                  dispatch({ type: 'set-slot-instance', slot, instanceId: instance.instance_id });
                  setNotice({
                    kind: 'info',
                    title: `已选中 ${formatEquipmentSlotLabel(slot)}`,
                    description: instance.item_id,
                    footnote: '还需要点击保存，才会提交到服务端。',
                  });
                }}
              />
            );
          })}
        </div>
      </div>

      <div className="equipment-panel">
        <EquipmentPanelHeader title="预设编辑" copy="编辑内容只影响草稿，提交时才会走服务端校验与版本检查。" />
        {presetMaintenance ? (
          <MaintenanceStateScreen title="预设维护中" description="当前预设读取失败，服务端或依赖暂不可用。" footnote={presetQuery.error?.message ?? '维护中'} />
        ) : presetLocked ? (
          <LockedStateScreen title="预设被锁定" description={presetQuery.error?.message ?? '没有权限读取当前预设。'} footnote={presetQuery.error?.message ?? undefined} />
        ) : presetMissing ? (
          <EmptyStateScreen title="预设不存在" description="当前 preset_id 没有对应预设，或者不属于当前角色。" actions={[{ label: '刷新', onClick: refreshAll }]} />
        ) : presetQuery.isPending ? (
          <LoadingStateScreen title="读取预设中" description="等待权威 loadout 详情。" />
        ) : currentDraft === null ? (
          <EmptyStateScreen title="暂无可编辑预设" description="先输入 preset_id 后再编辑装备预设。" />
        ) : (
          <div className="equipment-editor">
            <div className="equipment-form">
              <label className="equipment-form__field">
                <span className="equipment-form__label">名称</span>
                <input className="equipment-form__input" value={currentDraft.name} onChange={(event) => dispatch({ type: 'set-name', name: event.target.value })} />
              </label>
              <label className="equipment-form__field">
                <span className="equipment-form__label">策略</span>
                <input className="equipment-form__input" value={currentDraft.strategyId} onChange={(event) => dispatch({ type: 'set-strategy', strategyId: event.target.value })} />
              </label>
              <label className="equipment-form__field">
                <span className="equipment-form__label">状态版本</span>
                <input className="equipment-form__input" value={currentDraft.expectedStateVersion} readOnly />
              </label>
              <label className="equipment-form__field">
                <span className="equipment-form__label">战斗补给</span>
                <input className="equipment-form__input" value={`${currentDraft.combatConsumables.length} 项`} readOnly />
              </label>
            </div>
            <div className="equipment-slot-grid">
              {(['WEAPON', 'ARMOR', 'ACCESSORY'] as const).map((slot) => (
                <EquipmentSlotCard
                  key={slot}
                  slot={slot}
                  currentPreset={currentDraft === null ? null : currentPreset}
                  comparePreset={compareMissing ? currentPreset : comparePreset}
                  inventory={inventory}
                  onClearSlot={() => dispatch({ type: 'set-slot-instance', slot, instanceId: null })}
                  onInspectInstance={(instanceId) => syncSearch(navigate, location.pathname, location.search, { instance_id: instanceId })}
                />
              ))}
            </div>
            <div className="equipment-editor__actions">
              <button className="ghost-button" type="button" onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending || currentDraft === null}>
                保存预设
              </button>
              <button className="ghost-button" type="button" onClick={() => equipMutation.mutate()} disabled={equipMutation.isPending || !isComplete}>
                启用预设
              </button>
              <button className="ghost-button" type="button" onClick={() => currentPreset !== null && dispatch({ type: 'hydrate', preset: currentPreset })} disabled={currentPreset === null}>
                还原权威
              </button>
            </div>
            <p className="equipment-editor__note">
              启用后会返回 `effective_next_cycle=true`，当前周期仍显示“下周期生效”，不本地修改战斗或资产。
            </p>
          </div>
        )}
      </div>

      <div className="equipment-panel">
        <EquipmentPanelHeader title="属性比较" copy="比较的是预设槽位和装备实例元数据，不伪造价格、市场或本地战斗结果。" />
        <div className="equipment-compare">
          {comparisonRows.length === 0 ? <EmptyStateScreen title="暂无比较数据" description="先加载预设和背包。" /> : null}
          {comparisonRows.map((row) => (
            <article key={row.slot} className={`equipment-compare__row ${row.changed ? 'equipment-compare__row--changed' : ''}`}>
              <div className="equipment-compare__header">
                <strong>{row.label}</strong>
                <span className="equipment-chip">{row.changed ? '有差异' : '一致'}</span>
              </div>
              <p className="equipment-compare__copy">{row.summary}</p>
              <p className="equipment-compare__copy">{row.diffSummary}</p>
            </article>
          ))}
          {selectedInstanceView !== null ? (
            <NormalStateScreen
              title={selectedInstanceView.instance?.instance_id ?? '未选中实例'}
              description={selectedInstanceView.summary}
              highlight={selectedInstanceView.slotHint}
              footnote={selectedInstanceView.compareSummary}
            />
          ) : (
            <EmptyStateScreen title="未选中实例" description="点击背包中的装备实例，或在地址栏设置 instance_id。" />
          )}
          <EquipmentNoticeCard notice={notice} />
        </div>
      </div>
    </section>
  );
}
