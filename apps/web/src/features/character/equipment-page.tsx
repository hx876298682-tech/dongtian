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
  type TemperingAttemptResponse,
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
import { emitGameFeedback } from '../../lib/game-feedback.js';
import { GameDialog, ImportantActionDialog } from '../../components/game-dialog.js';
import { shouldConfirmImportantActions } from '../../lib/game-settings.js';
import { describeItemId } from '../content/content-adapter.js';
import {
  buildEquipmentSelectionView,
  buildEquipmentSlotComparisonRows,
  formatEquipmentSlotLabel,
  summarizeEquipmentError,
  summarizeLoadoutPreset,
} from './equipment-adapter.js';
import {
  buildEquipmentLootSummary,
  filterEquipmentInstances,
  TEMPERING_LADDER,
  type EquipmentFilterMode,
  type EquipmentSortMode,
  summarizeEquipmentAvailability,
  summarizeTemperingResponse,
} from './tempering-adapter.js';
import {
  createInitialEquipmentEditorState,
  createLoadoutSaveRequest,
  equipmentEditorReducer,
  isLoadoutComplete,
} from './equipment-editor.js';
import {
  createInitialTemperingPageState,
  createTemperingAttemptId,
  temperingPageReducer,
} from './tempering-reducer.js';

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
        <LoadingStateScreen title="正在整理角色装备" description="正在读取背包、装备方案和属性。" />
      </div>
      <div className="equipment-panel">
        <LoadingStateScreen title="装备条目" description="等待库存中的装备。" />
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

export function EquipmentError({ onRetry }: { readonly error: string; readonly onRetry: () => void }): ReactElement {
  return (
    <section className="equipment-layout">
      <div className="equipment-panel equipment-panel--hero">
        <LocalErrorStateScreen title="装备页暂时无法打开" description="装备状态暂时无法读取，请稍后重试。" actions={[{ label: '重试', onClick: onRetry }]} />
      </div>
      <div className="equipment-panel">
        <EmptyStateScreen title="装备条目" description="读取失败时不展示虚构内容。" />
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

export function EquipmentMaintenance({ onRetry }: { readonly reason: string; readonly onRetry: () => void }): ReactElement {
  return (
    <section className="equipment-layout">
      <div className="equipment-panel equipment-panel--hero">
        <MaintenanceStateScreen title="装备页维护中" description="装备暂时无法读取，请稍后重试。" actions={[{ label: '重试', onClick: onRetry }]} />
      </div>
      <div className="equipment-panel">
        <EmptyStateScreen title="装备条目" description="维护期间不展示虚构内容。" />
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

export function EquipmentLocked({ onRetry }: { readonly reason: string; readonly onRetry: () => void }): ReactElement {
  return (
    <section className="equipment-layout">
      <div className="equipment-panel equipment-panel--hero">
        <LockedStateScreen title="装备功能受限" description="当前暂时无法进入装备页，请稍后重试。" actions={[{ label: '重试', onClick: onRetry }]} />
      </div>
      <div className="equipment-panel">
        <EmptyStateScreen title="装备条目" description="当前无法读取装备。" />
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
          title="请选择装备方案"
          description="输入已保存的装备方案编号，就可以编辑、启用和比较。"
          actions={[{ label: '去背包比较', onClick: onOpenInventory }]}
          footnote="也可以先去背包挑选装备。"
        />
      </div>
      <div className="equipment-panel">
        <EmptyStateScreen title="装备背包" description="选择一个装备方案后查看对应槽位。" />
      </div>
      <div className="equipment-panel">
        <EmptyStateScreen title="装备方案" description="当前没有可编辑的装备方案。" />
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

export function EquipmentInstanceDialogContent({
  instance,
  currentSummary,
  compareSummary,
  canTemper,
  onTemper,
}: {
  readonly instance: EquipmentInstance;
  readonly currentSummary: string;
  readonly compareSummary: string;
  readonly canTemper: boolean;
  readonly onTemper: () => void;
}): ReactElement {
  return (
      <div className="equipment-instance-dialog">
        <h3 className="equipment-instance-dialog__title">装备详情</h3>
        <div className="equipment-instance-dialog__identity">
          <strong>{describeItemId(instance.item_id)}</strong>
          <span className="equipment-chip">{instance.bound ? '已绑定' : '未绑定'}</span>
        </div>
        <p className="equipment-instance-dialog__copy">装备 · 品质：未鉴定</p>
        <p className="equipment-instance-dialog__copy">强化 +{instance.temper_level}</p>
        <div className="equipment-instance-dialog__compare">
          <div>
            <span>当前预设</span>
            <strong>{currentSummary}</strong>
          </div>
          <div>
            <span>比较预设</span>
            <strong>{compareSummary}</strong>
          </div>
        </div>
        {!canTemper ? <p className="equipment-instance-dialog__note">当前装备不可淬炼，入口已禁用。</p> : null}
      <button className="primary-button" type="button" onClick={onTemper} disabled={!canTemper}>进入淬炼</button>
    </div>
  );
}

export function EquipmentInstanceDialog({
  open,
  onOpenChange,
  instance,
  currentSummary,
  compareSummary,
  canTemper,
  onTemper,
}: {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly instance: EquipmentInstance;
  readonly currentSummary: string;
  readonly compareSummary: string;
  readonly canTemper: boolean;
  readonly onTemper: () => void;
}): ReactElement {
  return (
    <GameDialog open={open} onOpenChange={onOpenChange} eyebrow="角色 · 装备" title="装备详情">
      <EquipmentInstanceDialogContent
        instance={instance}
        currentSummary={currentSummary}
        compareSummary={compareSummary}
        canTemper={canTemper}
        onTemper={onTemper}
      />
    </GameDialog>
  );
}

function EquipmentInstanceCard({
  instance,
  selected,
  assignedSlot,
  kept,
  duplicateCount,
  onOpen,
  onKeep,
  onAssign,
}: {
  readonly instance: EquipmentInstance;
  readonly selected: boolean;
  readonly assignedSlot: string | null;
  readonly kept: boolean;
  readonly duplicateCount: number;
  readonly onOpen: () => void;
  readonly onKeep: () => void;
  readonly onAssign: (slot: 'WEAPON' | 'ARMOR' | 'ACCESSORY') => void;
}): ReactElement {
  return (
    <article className={`equipment-instance ${selected ? 'equipment-instance--selected' : ''}`}>
      <button className="equipment-instance__title-button" type="button" onClick={onOpen} aria-pressed={selected}>
        <span className="equipment-instance__title-row">
          <strong>{describeItemId(instance.item_id)}</strong>
          <span className="equipment-chip">{instance.bound ? '已绑定' : '未绑定'}</span>
        </span>
        <span className="equipment-instance__subtitle">装备详情</span>
      </button>
      <p className="equipment-instance__copy">强化 +{instance.temper_level} · 状态已更新</p>
      <div className="equipment-instance__meta">
        <span className="equipment-chip">装备对比</span>
        <span className="equipment-chip">{assignedSlot ?? '未上阵'}</span>
        <span className="equipment-chip">{kept ? '已保留' : '待整理'}</span>
        <span className="equipment-chip">同类 ×{duplicateCount}</span>
        <span className="equipment-chip">{instance.temper_level >= 6 ? '+7 锁定' : '+1~+6 可淬炼'}</span>
      </div>
      <div className="equipment-instance__actions">
        <button className="chip-button" type="button" onClick={onKeep}>
          {kept ? '取消保留' : '保留'}
        </button>
        <button className="chip-button" type="button" onClick={onOpen}>
          查看用途
        </button>
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
            查看装备
          </button>
        </div>
        <div className="equipment-slot__compare">
          <span>比较</span>
          <strong>{row.compareInstanceId ?? '未配置'}</strong>
          <button className="ghost-button ghost-button--compact" type="button" onClick={() => row.compareInstanceId && onInspectInstance(row.compareInstanceId)}>
            查看装备
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
    return <NormalStateScreen title={notice.title} description={notice.description} footnote={notice.footnote} highlight="状态已更新" />;
  }

  return <NormalStateScreen title={notice.title} description={notice.description} footnote={notice.footnote} highlight="提示" />;
}

function buildTemperingNotice(error: unknown): EquipmentNotice {
  if (error instanceof ApiClientError) {
    return {
      kind: 'error',
      title: '淬炼暂未完成',
      description: summarizeEquipmentError(error.status, error.code, error.details),
    };
  }

  return {
    kind: 'error',
    title: '淬炼失败',
    description: '暂时无法完成淬炼，请稍后重试。',
  };
}

export function TemperingOutcomeCard({
  response,
  onRetry,
}: {
  readonly response: TemperingAttemptResponse | null;
  readonly onRetry: () => void;
}): ReactElement {
  if (response === null) {
    return <EmptyStateScreen title="淬炼结果" description="提交后这里会显示本次淬炼的结果。" />;
  }

  const title = response.success ? `+${response.target_level} 淬炼成功` : response.outcome === 'REJECTED' ? `+${response.target_level} 被拒绝` : `+${response.target_level} 淬炼失败`;
  const description = [
    `目标装备 · ${describeItemId(response.equipment.item_id)}`,
    `强化 ${response.level_before} → ${response.level_after}`,
    '淬炼结果已由洞天规则结算',
  ].join(' · ');
  const footnote = response.random_audit === null ? '当前阶段有固定规则。' : '本次结果已记录。';

  return (
    <NormalStateScreen
      title={title}
      description={description}
      footnote={footnote}
      highlight={response.success ? '成功' : response.outcome}
      actions={[{ label: '沿用本次操作重试', onClick: onRetry }]}
    />
  );
}

export function getTemperingActionIntent(confirmImportantActions: boolean): 'confirm' | 'execute' {
  return confirmImportantActions ? 'confirm' : 'execute';
}

export function TemperingLadderTable({
  selectedTargetLevel,
}: {
  readonly selectedTargetLevel: number;
}): ReactElement {
  return (
    <div className="tempering-ladder" role="table" aria-label="淬炼概率与材料">
      {TEMPERING_LADDER.map((row) => (
        <article key={row.targetLevel} className={`tempering-ladder__row ${row.targetLevel === selectedTargetLevel ? 'tempering-ladder__row--selected' : ''}`}>
          <div className="tempering-ladder__header">
            <strong>+{row.targetLevel}</strong>
            <span className={`equipment-chip ${row.locked ? 'equipment-chip--locked' : ''}`}>{row.conditionLabel}</span>
          </div>
          <p className="tempering-ladder__copy">成功率 {row.successProbability} · 灵石 {row.spiritStoneCost} · 淬炼石 {row.temperingStoneCost} · 同类 {row.sameEquipmentCost} · 保护 {row.protectionMaterialCost}</p>
        </article>
      ))}
    </div>
  );
}

function EquipmentFilterBar({
  query,
  filterMode,
  sortMode,
  pageSize,
  onQueryChange,
  onFilterModeChange,
  onSortModeChange,
  onPageSizeChange,
}: {
  readonly query: string;
  readonly filterMode: EquipmentFilterMode;
  readonly sortMode: EquipmentSortMode;
  readonly pageSize: number;
  readonly onQueryChange: (query: string) => void;
  readonly onFilterModeChange: (mode: EquipmentFilterMode) => void;
  readonly onSortModeChange: (mode: EquipmentSortMode) => void;
  readonly onPageSizeChange: (pageSize: number) => void;
}): ReactElement {
  return (
    <div className="equipment-filterbar">
      <label className="equipment-form__field">
        <span className="equipment-form__label">筛选</span>
        <input className="equipment-form__input" value={query} onChange={(event) => onQueryChange(event.target.value)} placeholder="装备名称、强化、绑定" />
      </label>
      <label className="equipment-form__field">
        <span className="equipment-form__label">状态</span>
        <select className="equipment-form__input" value={filterMode} onChange={(event) => onFilterModeChange(event.target.value as EquipmentFilterMode)}>
          <option value="all">全部</option>
          <option value="duplicates">同类重复</option>
          <option value="temperable">可淬炼</option>
          <option value="bound">已绑定</option>
          <option value="unbound">未绑定</option>
        </select>
      </label>
      <label className="equipment-form__field">
        <span className="equipment-form__label">排序</span>
        <select className="equipment-form__input" value={sortMode} onChange={(event) => onSortModeChange(event.target.value as EquipmentSortMode)}>
          <option value="recent">最近</option>
          <option value="item">装备名称</option>
          <option value="temper-level">强化等级</option>
          <option value="duplicates">同类数量</option>
        </select>
      </label>
      <label className="equipment-form__field">
        <span className="equipment-form__label">分页</span>
        <select className="equipment-form__input" value={String(pageSize)} onChange={(event) => onPageSizeChange(Number(event.target.value))}>
          <option value="4">4 / 页</option>
          <option value="8">8 / 页</option>
          <option value="12">12 / 页</option>
        </select>
      </label>
    </div>
  );
}

function buildMutationNotice(error: unknown): EquipmentNotice {
  if (error instanceof ApiClientError) {
    return {
      kind: 'error',
      title: '装备操作暂未完成',
      description: summarizeEquipmentError(error.status, error.code, error.details),
    };
  }

  return {
    kind: 'error',
    title: '写入失败',
    description: '暂时无法保存装备状态，请稍后重试。',
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
  const [temperingState, temperingDispatch] = useReducer(temperingPageReducer, createInitialTemperingPageState());
  const [notice, setNotice] = useState<EquipmentNotice | null>(null);
  const [temperingNotice, setTemperingNotice] = useState<EquipmentNotice | null>(null);
  const [temperingConfirmationOpen, setTemperingConfirmationOpen] = useState(false);
  const [instanceDialogOpen, setInstanceDialogOpen] = useState(false);
  const [presetInput, setPresetInput] = useState(params.get('preset_id') ?? '');
  const [comparePresetInput, setComparePresetInput] = useState(params.get('compare_preset_id') ?? '');

  const presetId = params.get('preset_id') ?? '';
  const comparePresetId = params.get('compare_preset_id') ?? '';
  const selectedInstanceId = params.get('instance_id');
  const presetMissingInput = presetId.length === 0;

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

  useEffect(() => {
    if (selectedInstanceId !== temperingState.draft.selectedInstanceId) {
      temperingDispatch({ type: 'select-instance', instanceId: selectedInstanceId });
    }
  }, [selectedInstanceId, temperingState.draft.selectedInstanceId]);

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
  const filteredEquipment = useMemo(
    () => (inventory === null ? [] : filterEquipmentInstances(inventory, { query: temperingState.query, mode: temperingState.filterMode, sortMode: temperingState.sortMode })),
    [inventory, temperingState.filterMode, temperingState.query, temperingState.sortMode],
  );
  const duplicateCounts = useMemo(() => {
    if (inventory === null) {
      return new Map<string, number>();
    }
    const counts = new Map<string, number>();
    for (const instance of inventory.equipment_instances) {
      counts.set(instance.item_id, (counts.get(instance.item_id) ?? 0) + 1);
    }
    return counts;
  }, [inventory]);
  const equipmentPageCount = Math.max(1, Math.ceil(filteredEquipment.length / temperingState.pageSize));
  const equipmentPageIndex = Math.min(temperingState.pageIndex, equipmentPageCount - 1);
  const pagedEquipment = filteredEquipment.slice(
    equipmentPageIndex * temperingState.pageSize,
    equipmentPageIndex * temperingState.pageSize + temperingState.pageSize,
  );
  const selectedTemperingInstance = useMemo(
    () => (inventory === null ? null : inventory.equipment_instances.find((instance) => instance.instance_id === temperingState.draft.selectedInstanceId) ?? null),
    [inventory, temperingState.draft.selectedInstanceId],
  );
  const selectedTemperingDuplicateCount = selectedTemperingInstance === null ? 0 : (duplicateCounts.get(selectedTemperingInstance.item_id) ?? 0);
  const selectedTemperingSummary = selectedTemperingInstance === null
    ? null
    : buildEquipmentLootSummary(selectedTemperingInstance, selectedTemperingDuplicateCount);
  const selectedTemperingTargetLevel = temperingState.draft.targetLevel;

  useEffect(() => {
    if (selectedTemperingInstance === null) {
      return;
    }
    const nextTargetLevel = Math.min(selectedTemperingInstance.temper_level + 1, 7);
    temperingDispatch({ type: 'set-target-level', targetLevel: nextTargetLevel });
  }, [selectedTemperingInstance?.instance_id, selectedTemperingInstance?.temper_level]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (editorState.draft === null) {
        throw new Error('NO_DRAFT');
      }
      return apiClient.saveLoadoutPreset(session.character_id, editorState.draft.presetId, createLoadoutSaveRequest(editorState.draft), createIdempotencyKey());
    },
    onSuccess: (data) => {
      emitGameFeedback('装备方案已保存。', 'success');
      dispatch({ type: 'mark-saved', preset: data });
      setNotice({
        kind: 'success',
        title: '预设已保存',
        description: summarizeLoadoutPreset(data),
        footnote: '仅修改预设，不会立刻改变当前战斗。',
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
      emitGameFeedback('装备方案已启用。', 'success');
      dispatch({ type: 'mark-saved', preset: data });
      setNotice({
        kind: 'success',
        title: '预设已启用',
        description: summarizeLoadoutPreset(data),
        footnote: data.effective_next_cycle ? '下周期生效，当前战斗和资源不会立刻改变。' : '已生效。',
      });
      void queryClient.invalidateQueries({ queryKey: [EQUIPMENT_QUERY_PREFIX, session.character_id] });
    },
    onError: (error: unknown) => {
      setNotice(buildMutationNotice(error));
    },
  });

  const temperMutation = useMutation({
    mutationFn: async () => {
      if (progression === null || selectedTemperingInstance === null) {
        throw new Error('NO_TEMPERING_TARGET');
      }
      if (selectedTemperingTargetLevel > 6) {
        throw new Error('TEMPERING_LEVEL_LOCKED');
      }

      let attemptId = temperingState.draft.attemptId;
      if (attemptId === null) {
        attemptId = createTemperingAttemptId();
        temperingDispatch({ type: 'prepare-attempt', attemptId });
      }

      return apiClient.temperEquipment(
        session.character_id,
        selectedTemperingInstance.instance_id,
        {
          attempt_id: attemptId,
          expected_state_version: progression.character.state_version,
          target_level: selectedTemperingTargetLevel,
          use_protection_material: temperingState.draft.useProtectionMaterial,
          config_version: progression.config_version,
        },
        attemptId,
      );
    },
    onSuccess: (response) => {
      temperingDispatch({ type: 'mark-response', response });
      setTemperingNotice({
        kind: 'success',
        title: response.success ? `+${response.target_level} 淬炼成功` : `+${response.target_level} 淬炼完成`,
        description: summarizeTemperingResponse(response),
        footnote: '新的装备属性会在角色面板中更新。',
      });
      void queryClient.invalidateQueries({ queryKey: [EQUIPMENT_QUERY_PREFIX, session.character_id] });
    },
    onError: (error: unknown) => {
      setTemperingNotice(buildTemperingNotice(error));
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

  const goToToolAssignments = () => {
    navigate('/character/tools');
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

  const presetError = presetQuery.error;
  const presetMissing = presetError instanceof ApiClientError && presetError.status === 404;
  const presetLocked = presetError instanceof ApiClientError && presetError.status === 403;
  const presetMaintenance = presetError instanceof ApiClientError && presetError.status === 503;
  const compareMissing = comparePresetQuery.error instanceof ApiClientError && comparePresetQuery.error.status === 404;

  const currentDraft = editorState.draft;
  const isComplete = isLoadoutComplete(currentDraft);
  const selectedAssignment = getSelectedInstanceAssignment(selectedInstanceId, currentPreset);

  return (
    <section className="equipment-layout character-screen">
      <div className="equipment-panel equipment-panel--hero">
        <div className="equipment-hero">
          <div>
            <p className="page-card__eyebrow">角色</p>
            <h3 className="page-card__title">角色装备</h3>
            <p className="page-card__copy">整理法器、护具和饰品，选择一套装备方案用于下一轮修行。</p>
          </div>
          <div className="dashboard-metrics">
            <div className="metric-chip">
              <span className="metric-chip__label">角色</span>
              <strong className="metric-chip__value" title={progression.character.name}>
                {progression.character.name}
              </strong>
            </div>
            <div className="metric-chip">
              <span className="metric-chip__label">境界</span>
              <strong className="metric-chip__value">
                {progression.cultivation.realm_stage_id === 'realm.mortal.entry' ? '炼气入门' : '修行中'}
              </strong>
            </div>
            <div className="metric-chip">
              <span className="metric-chip__label">拥有装备</span>
              <strong className="metric-chip__value" title={String(inventory.equipment_instances.length)}>
                {inventory.equipment_instances.length}
              </strong>
            </div>
            <div className="metric-chip">
              <span className="metric-chip__label">预设</span>
              <strong className="metric-chip__value" title={summarizeLoadoutPreset(currentPreset)}>
                {summarizeLoadoutPreset(currentPreset)}
              </strong>
            </div>
          </div>
          <div className="equipment-hero__controls">
            <label className="equipment-form__field">
                <span className="equipment-form__label">装备方案</span>
                <input className="equipment-form__input" value={presetInput} onChange={(event) => setPresetInput(event.target.value)} placeholder="输入方案编号" />
            </label>
            <label className="equipment-form__field">
                <span className="equipment-form__label">对比方案</span>
                <input className="equipment-form__input" value={comparePresetInput} onChange={(event) => setComparePresetInput(event.target.value)} placeholder="输入对比方案" />
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
                刷新状态
              </button>
              <button className="ghost-button" type="button" onClick={goToInventory}>
                去背包比较
              </button>
              <button className="ghost-button" type="button" onClick={goToToolAssignments}>
                工具分配
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="equipment-panel">
        <EquipmentPanelHeader title="装备背包" copy="筛选、比较并选择适合当前修行路线的装备。" />
        <EquipmentFilterBar
          query={temperingState.query}
          filterMode={temperingState.filterMode}
          sortMode={temperingState.sortMode}
          pageSize={temperingState.pageSize}
          onQueryChange={(query) => temperingDispatch({ type: 'set-query', query })}
          onFilterModeChange={(filterMode) => temperingDispatch({ type: 'set-filter-mode', filterMode })}
          onSortModeChange={(sortMode) => temperingDispatch({ type: 'set-sort-mode', sortMode })}
          onPageSizeChange={(pageSize) => temperingDispatch({ type: 'set-page-size', pageSize })}
        />
        <div className="equipment-hero__actions">
          <span className="equipment-chip">总计 {filteredEquipment.length} 件</span>
          <span className="equipment-chip">同类重复 {Array.from(duplicateCounts.values()).filter((count) => count > 1).length} 组</span>
          <span className="equipment-chip">
            第 {Math.min(equipmentPageIndex + 1, equipmentPageCount)} / {equipmentPageCount} 页
          </span>
        </div>
        <div className="equipment-list">
          {filteredEquipment.length === 0 ? <EmptyStateScreen title="没有符合条件的装备" description="调整筛选条件，或清空搜索后再试。" /> : null}
          {pagedEquipment.map((instance) => {
            const slotHint = selectedInstanceId === instance.instance_id ? selectedAssignment ?? '未上阵' : getSelectedInstanceAssignment(instance.instance_id, currentPreset);
            const kept = temperingState.keptInstanceIds.has(instance.instance_id);
            return (
              <EquipmentInstanceCard
                key={instance.instance_id}
                instance={instance}
                selected={selectedInstanceId === instance.instance_id}
                assignedSlot={slotHint}
                kept={kept}
                duplicateCount={duplicateCounts.get(instance.item_id) ?? 0}
                onOpen={() => {
                  syncSearch(navigate, location.pathname, location.search, { instance_id: instance.instance_id });
                  temperingDispatch({ type: 'select-instance', instanceId: instance.instance_id });
                  temperingDispatch({ type: 'set-target-level', targetLevel: Math.min(instance.temper_level + 1, 7) });
                  setInstanceDialogOpen(true);
                }}
                onKeep={() => temperingDispatch({ type: 'toggle-keep', instanceId: instance.instance_id })}
                onAssign={(slot) => {
                  dispatch({ type: 'set-slot-instance', slot, instanceId: instance.instance_id });
                  setNotice({
                    kind: 'info',
                    title: `已选中 ${formatEquipmentSlotLabel(slot)}`,
                    description: describeItemId(instance.item_id),
                    footnote: '还需要点击保存，才会提交本次更改。',
                  });
                }}
              />
            );
          })}
        </div>
        <div className="equipment-editor__actions">
          <button className="ghost-button" type="button" onClick={() => temperingDispatch({ type: 'set-page-index', pageIndex: Math.max(0, equipmentPageIndex - 1) })} disabled={equipmentPageIndex <= 0}>
            上一页
          </button>
          <button className="ghost-button" type="button" onClick={() => temperingDispatch({ type: 'set-page-index', pageIndex: Math.min(equipmentPageCount - 1, equipmentPageIndex + 1) })} disabled={equipmentPageIndex >= equipmentPageCount - 1}>
            下一页
          </button>
        </div>
      </div>

      <div className="equipment-panel">
        <EquipmentPanelHeader title="装备方案" copy="搭配装备槽位，保存后可随时切换使用。" />
        {presetMissingInput ? (
          <EquipmentMissingPreset onOpenInventory={goToInventory} />
        ) : presetMaintenance ? (
          <MaintenanceStateScreen title="预设维护中" description="当前预设暂时无法读取，请稍后重试。" />
        ) : presetLocked ? (
          <LockedStateScreen title="预设被锁定" description="当前暂时无法读取这套预设，请稍后重试。" />
        ) : presetMissing ? (
          <EmptyStateScreen title="没有找到装备方案" description="输入一个已保存的方案编号，或者回到角色页创建方案。" actions={[{ label: '刷新', onClick: refreshAll }]} />
        ) : presetQuery.isPending ? (
          <LoadingStateScreen title="正在读取装备方案" description="正在准备装备槽位。" />
        ) : currentDraft === null ? (
          <EmptyStateScreen title="暂无装备方案" description="先输入装备方案编号，再编辑装备槽位。" />
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
                onInspectInstance={(instanceId) => {
                  syncSearch(navigate, location.pathname, location.search, { instance_id: instanceId });
                  setInstanceDialogOpen(true);
                }}
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
                恢复已保存状态
              </button>
            </div>
            <p className="equipment-editor__note">
              启用后若显示“下周期生效”，当前周期仍按原装备方案运行。
            </p>
          </div>
        )}
      </div>

      <div className="equipment-panel" id="tempering-panel">
        <EquipmentPanelHeader title="淬炼台" copy="选择一件装备进行淬炼，提升它的基础属性。" />
        {selectedTemperingInstance === null ? (
          <EmptyStateScreen title="未选中淬炼目标" description="从左侧装备列表选择一件装备，或用下方下拉框指定要淬炼的装备。" />
        ) : (
          <NormalStateScreen
            title={describeItemId(selectedTemperingInstance.item_id)}
            description={[
              describeItemId(selectedTemperingInstance.item_id),
              `强化 +${selectedTemperingInstance.temper_level}`,
              selectedTemperingSummary?.materialSummary ?? '暂无同类材料',
            ].join(' · ')}
            footnote={summarizeEquipmentAvailability(selectedTemperingInstance, inventory)}
            highlight={selectedTemperingSummary?.stageSummary ?? '淬炼条件'}
          />
        )}
        <div className="equipment-form">
          <label className="equipment-form__field">
            <span className="equipment-form__label">选择装备</span>
            <select
              className="equipment-form__input"
              value={temperingState.draft.selectedInstanceId ?? ''}
              onChange={(event) => {
                const nextInstanceId = event.target.value.length === 0 ? null : event.target.value;
                temperingDispatch({ type: 'select-instance', instanceId: nextInstanceId });
                syncSearch(navigate, location.pathname, location.search, { instance_id: nextInstanceId });
              }}
            >
              <option value="">请选择装备</option>
              {inventory.equipment_instances.map((instance) => (
                <option key={instance.instance_id} value={instance.instance_id}>
                  {describeItemId(instance.item_id)} · 强化 +{instance.temper_level}
                </option>
              ))}
            </select>
          </label>
          <label className="equipment-form__field">
            <span className="equipment-form__label">目标阶段</span>
            <select
              className="equipment-form__input"
              value={String(selectedTemperingTargetLevel)}
              onChange={(event) => temperingDispatch({ type: 'set-target-level', targetLevel: Number(event.target.value) })}
            >
              {TEMPERING_LADDER.map((row) => (
                <option key={row.targetLevel} value={String(row.targetLevel)}>
                  +{row.targetLevel} {row.locked ? '（锁定）' : ''}
                </option>
              ))}
            </select>
          </label>
          <label className="equipment-form__field">
            <span className="equipment-form__label">保护材料</span>
            <select
              className="equipment-form__input"
              value={temperingState.draft.useProtectionMaterial ? 'true' : 'false'}
              onChange={(event) => temperingDispatch({ type: 'set-use-protection', useProtectionMaterial: event.target.value === 'true' })}
            >
              <option value="false">不使用保护材料</option>
              <option value="true">使用保护材料</option>
            </select>
          </label>
        </div>
        <div className="equipment-editor__actions">
          <button
            className="ghost-button"
            type="button"
            onClick={() => {
              if (getTemperingActionIntent(shouldConfirmImportantActions()) === 'confirm') setTemperingConfirmationOpen(true);
              else temperMutation.mutate();
            }}
            disabled={
              temperMutation.isPending ||
              selectedTemperingInstance === null ||
              selectedTemperingTargetLevel > 6 ||
              progression === null ||
              inventory === null
            }
          >
            提交淬炼
          </button>
          <button
            className="ghost-button"
            type="button"
            onClick={() => {
              if (temperingState.draft.attemptId !== null) {
                temperMutation.mutate();
                return;
              }
              setTemperingNotice({
                kind: 'info',
                title: '淬炼尚未提交',
                description: '请先提交一次淬炼，或在同一方案上再次点击提交。',
              });
            }}
            disabled={selectedTemperingInstance === null}
          >
            沿用本次操作重试
          </button>
          <button className="ghost-button" type="button" onClick={() => temperingDispatch({ type: 'clear-attempt' })}>
            重置本次操作
          </button>
        </div>
        <TemperingLadderTable selectedTargetLevel={selectedTemperingTargetLevel} />
        <TemperingOutcomeCard
          response={temperingState.lastResponse}
          onRetry={() => {
            if (getTemperingActionIntent(shouldConfirmImportantActions()) === 'confirm') setTemperingConfirmationOpen(true);
            else temperMutation.mutate();
          }}
        />
        <EquipmentNoticeCard notice={temperingNotice} />
      </div>

      <div className="equipment-panel">
        <EquipmentPanelHeader title="属性比较" copy="比较两套装备的槽位、强化等级和主要属性。" />
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
              title={selectedInstanceView.instance === null ? '未选中装备' : describeItemId(selectedInstanceView.instance.item_id)}
              description={selectedInstanceView.summary}
              highlight={selectedInstanceView.slotHint}
              footnote={selectedInstanceView.compareSummary}
            />
          ) : (
            <EmptyStateScreen title="未选中装备" description="点击背包中的装备，查看当前对比。" />
          )}
          <EquipmentNoticeCard notice={notice} />
        </div>
      </div>

      {selectedInstanceView?.instance ? (
        <EquipmentInstanceDialog
          open={instanceDialogOpen}
          onOpenChange={setInstanceDialogOpen}
          instance={selectedInstanceView.instance}
          currentSummary={selectedInstanceView.slotHint}
          compareSummary={selectedInstanceView.compareSummary}
          canTemper={selectedInstanceView.instance.temper_level < 6}
          onTemper={() => {
            setInstanceDialogOpen(false);
            temperingDispatch({ type: 'select-instance', instanceId: selectedInstanceView.instance?.instance_id ?? null });
            setTemperingNotice({ kind: 'info', title: '已定位淬炼台', description: `${describeItemId(selectedInstanceView.instance?.item_id)} 已作为淬炼目标。` });
            if (typeof document !== 'undefined') {
              document.getElementById('tempering-panel')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }
          }}
        />
      ) : null}
      <ImportantActionDialog
        open={temperingConfirmationOpen}
        onOpenChange={setTemperingConfirmationOpen}
        title="确认淬炼"
        description="淬炼会消耗灵石、淬炼石和同类装备材料，结果由洞天规则结算。"
        confirmLabel="确认淬炼"
        pending={temperMutation.isPending}
        onConfirm={() => {
          setTemperingConfirmationOpen(false);
          temperMutation.mutate();
        }}
      />
    </section>
  );
}
