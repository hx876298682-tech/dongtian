import { useEffect, useMemo, useReducer, useState, type ReactElement } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocation, useNavigate, useOutletContext } from 'react-router';
import * as Dialog from '@radix-ui/react-dialog';

import {
  ApiClientError,
  type AuthActiveSession,
  type CharacterProgression,
  type CaveResponse,
  type InventorySnapshot,
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
import { shouldConfirmImportantActions } from '../../lib/game-settings.js';
import { buildCaveBuildRequest, buildCavePageView, summarizeCaveFacilitySubtitle, type CaveFacilityView } from './cave-adapter.js';
import { describeItemId } from '../content/content-adapter.js';
import {
  cavePageReducer,
  createCaveIdempotencyKey,
  createInitialCavePageState,
} from './cave-reducer.js';

const CAVE_QUERY_PREFIX = 'cave';

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

  const nextSearch = params.toString();
  const currentSearch = locationSearch.startsWith('?') ? locationSearch.slice(1) : locationSearch;
  if (nextSearch === currentSearch) {
    return;
  }

  navigate({ pathname, search: nextSearch.length > 0 ? `?${nextSearch}` : '' }, { replace: true });
}

function useCaveQueries(characterId: string) {
  const progressionQuery = useQuery<CharacterProgression>({
    queryKey: [CAVE_QUERY_PREFIX, characterId, 'progression'],
    queryFn: () => apiClient.getProgression(characterId),
  });
  const inventoryQuery = useQuery<InventorySnapshot>({
    queryKey: [CAVE_QUERY_PREFIX, characterId, 'inventory'],
    queryFn: () => apiClient.getInventory(characterId),
  });
  const caveQuery = useQuery<CaveResponse>({
    queryKey: [CAVE_QUERY_PREFIX, characterId, 'cave'],
    queryFn: () => apiClient.getCave(characterId),
  });

  return { progressionQuery, inventoryQuery, caveQuery };
}

export function CaveLoading(): ReactElement {
  return (
    <section className="cave-layout">
      <div className="cave-panel cave-panel--hero">
        <LoadingStateScreen title="正在查看洞天设施" description="正在读取练功房、炼丹炉和锻造炉。" />
      </div>
      <div className="cave-panel">
        <LoadingStateScreen title="设施列表" description="等待练功房、炼丹炉和锻造炉数据。" />
      </div>
      <div className="cave-panel">
        <LoadingStateScreen title="设施详情" description="等待选中的设施与下级成本。" />
      </div>
    </section>
  );
}

export function CaveError({ onRetry }: { readonly error: string; readonly onRetry: () => void }): ReactElement {
  return (
    <section className="cave-layout">
      <div className="cave-panel cave-panel--hero">
        <LocalErrorStateScreen title="洞天设施暂时无法打开" description="设施数据读取失败，已保留当前页面选择。" actions={[{ label: '重试', onClick: onRetry }]} />
      </div>
      <div className="cave-panel">
        <EmptyStateScreen title="设施列表" description="读取失败时不展示伪造设施。" />
      </div>
      <div className="cave-panel">
        <EmptyStateScreen title="设施详情" description="读取失败时不展示伪造设施。" />
      </div>
    </section>
  );
}

export function CaveMaintenance({ onRetry }: { readonly reason: string; readonly onRetry: () => void }): ReactElement {
  return (
    <section className="cave-layout">
      <div className="cave-panel cave-panel--hero">
        <MaintenanceStateScreen title="洞府服务维护中" description="洞府暂时无法读取，请稍后重试。" actions={[{ label: '重试', onClick: onRetry }]} />
      </div>
      <div className="cave-panel">
        <EmptyStateScreen title="设施列表" description="维护期间不展示伪造设施。" />
      </div>
      <div className="cave-panel">
        <EmptyStateScreen title="设施详情" description="维护期间不展示伪造设施。" />
      </div>
    </section>
  );
}

export function CaveLocked({ onRetry }: { readonly reason: string; readonly onRetry: () => void }): ReactElement {
  return (
    <section className="cave-layout">
      <div className="cave-panel cave-panel--hero">
        <LockedStateScreen title="洞府功能受限" description="当前账号暂时无法进入洞府，请稍后重试。" actions={[{ label: '重试', onClick: onRetry }]} />
      </div>
      <div className="cave-panel">
        <EmptyStateScreen title="设施列表" description="当前无法读取洞府设施。" />
      </div>
      <div className="cave-panel">
        <EmptyStateScreen title="设施详情" description="当前无法读取洞府详情。" />
      </div>
    </section>
  );
}

export function CaveEmpty({ onRetry }: { readonly reason: string; readonly onRetry: () => void }): ReactElement {
  return (
    <section className="cave-layout">
      <div className="cave-panel cave-panel--hero">
        <EmptyStateScreen title="洞府暂未发现设施" description="当前洞府还没有可展示的设施。" actions={[{ label: '重试', onClick: onRetry }]} />
      </div>
      <div className="cave-panel">
        <EmptyStateScreen title="设施列表" description="暂未发现可用设施。" />
      </div>
      <div className="cave-panel">
        <EmptyStateScreen title="设施详情" description="选择设施后查看详情。" />
      </div>
    </section>
  );
}

function CaveFacilityCard({
  active,
  subtitle,
  onSelect,
}: {
  readonly active: boolean;
  readonly subtitle: string;
  readonly onSelect: () => void;
}): ReactElement {
  return (
    <button className={`cave-facility ${active ? 'cave-facility--active' : ''}`} type="button" onClick={onSelect} aria-pressed={active}>
      <strong className="cave-facility__title">{subtitle}</strong>
      <span className="cave-facility__copy">点击查看详情与建造确认</span>
    </button>
  );
}

function renderDetailDescription(lines: ReadonlyArray<string>): ReactElement {
  return (
    <div className="cave-detail__lines">
      {lines.map((line) => (
        <p key={line}>{line}</p>
      ))}
    </div>
  );
}

function CaveDetailPanel({
  view,
  onBuild,
  onRefresh,
  canRetry,
  onRetry,
}: {
  readonly view: CaveFacilityView | null;
  readonly onBuild: () => void;
  readonly onRefresh: () => void;
  readonly canRetry: boolean;
  readonly onRetry: () => void;
}): ReactElement {
  if (view === null) {
    return <EmptyStateScreen title="未选择设施" description="从左侧选择练功房、炼丹炉或锻造炉。" />;
  }

  const detailLines = [
    `设施等级 ${view.levelLabel}`,
    `当前 ${view.levelLabel} · ${view.currentModifierLabel}`,
    ...(view.taskStateLabel === null ? [] : [`任务 ${view.taskStateLabel}`]),
    `下级 ${view.nextLevelRuleLevel === null ? '已无下级' : `Lv${view.nextLevelRuleLevel}`} · ${view.nextBuildDuration}`,
    `库存 ${view.stockSummary}`,
  ];

  if (view.buildStatus === 'LOCKED') {
    return (
      <LockedStateScreen
        title={`${view.facilityLabel} · ${view.buildStatusLabel}`}
        description={view.lockedReason ?? '当前设施不可建造。'}
        footnote={`${view.nameKey} · ${view.descriptionKey}`}
        actions={[{ label: '刷新洞府', onClick: onRefresh }]}
      />
    );
  }

  if (view.buildStatus === 'BUILDING') {
    return (
      <NormalStateScreen
        title={`${view.facilityLabel} · 进行中`}
        description={renderDetailDescription([
          ...detailLines,
          `完成倒计时 ${view.countdown}`,
          view.buildTaskWindow ?? '无任务窗口',
        ])}
        highlight={`预计 ${view.countdown}`}
        footnote={view.buildTaskCostSummary ?? undefined}
        actions={[{ label: '刷新状态', onClick: onRefresh }]}
      />
    );
  }

  if (view.buildStatus === 'COMPLETED') {
    return (
      <NormalStateScreen
        title={`${view.facilityLabel} · 已完成`}
        description={renderDetailDescription([
          ...detailLines,
          view.taskStateLabel ?? '无任务',
          `任务 ${view.buildTaskWindow ?? '无'}`,
          `状态 ${view.buildTaskStatus ?? 'COMPLETED'}`,
        ])}
        highlight="完成后已等待刷新"
        footnote={view.buildTaskCostSummary ?? undefined}
        actions={[
          { label: '刷新洞府', onClick: onRefresh },
          ...(canRetry ? [{ label: '沿用本次操作重试', onClick: onRetry }] : []),
        ]}
      />
    );
  }

  if (view.buildStatus === 'RESOURCE_INSUFFICIENT') {
    return (
      <NormalStateScreen
        title={`${view.facilityLabel} · 资源不足`}
        description={renderDetailDescription([
          ...detailLines,
          ...view.missingResources.map((gap) => `${gap.itemId === 'currency.spirit_stone' ? '灵石' : describeItemId(gap.itemId)} 缺 ${gap.missing} · 持有 ${gap.owned} / ${gap.required}`),
        ])}
        highlight="先补齐缺口"
        footnote={view.nextLevelRuleLabel}
        actions={[{ label: '刷新库存', onClick: onRefresh }]}
      />
    );
  }

  return (
    <div className="cave-detail">
      <NormalStateScreen
        title={`${view.facilityLabel} · ${view.buildStatusLabel}`}
        description={renderDetailDescription([
          ...detailLines,
          `下级规则 ${view.nextLevelRuleLabel}`,
        ])}
        highlight={`完成耗时 ${view.nextBuildDuration}`}
        footnote={view.buildTaskCostSummary ?? view.nextLevelRuleLabel}
        actions={[{ label: '刷新洞府', onClick: onRefresh }]}
      />
      {view.missingResources.length > 0 ? (
        <div className="cave-gap-list" aria-label="库存缺口">
          {view.missingResources.map((gap) => (
            <article key={gap.itemId} className="cave-gap">
                    <strong>{gap.itemId === 'currency.spirit_stone' ? '灵石' : describeItemId(gap.itemId)}</strong>
              <p>
                需要 {gap.required}，持有 {gap.owned}，缺口 {gap.missing}
              </p>
            </article>
          ))}
        </div>
      ) : null}
      <div className="cave-detail__actions">
        <button className="ghost-button" type="button" onClick={onBuild} disabled={!view.canBuild}>
          开建确认
        </button>
        {canRetry ? (
          <button className="ghost-button" type="button" onClick={onRetry}>
            沿用本次操作重试
          </button>
        ) : null}
      </div>
    </div>
  );
}

function buildMutationErrorMessage(error: unknown): string {
  return error instanceof ApiClientError || error instanceof Error
    ? '暂时无法完成开建，请稍后重试。'
    : '暂时无法完成开建，请稍后重试。';
}

export function CavePage(): ReactElement {
  const session = useOutletContext<AuthActiveSession>();
  const location = useLocation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const preferredFacilityId = useMemo(() => new URLSearchParams(location.search).get('facility_id') ?? null, [location.search]);
  const [now, setNow] = useState(() => new Date());
  const [state, dispatch] = useReducer(cavePageReducer, createInitialCavePageState(preferredFacilityId));
  const { progressionQuery, inventoryQuery, caveQuery } = useCaveQueries(session.character_id);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (caveQuery.data !== undefined) {
      dispatch({ type: 'hydrate', response: caveQuery.data, preferredFacilityId });
    }
  }, [caveQuery.data, preferredFacilityId]);

  useEffect(() => {
    syncSearch(navigate, location.pathname, location.search, { facility_id: state.selectedFacilityId });
  }, [location.pathname, location.search, navigate, state.selectedFacilityId]);

  const buildMutation = useMutation({
    mutationFn: async ({ facilityId, idempotencyKey }: { readonly facilityId: string; readonly idempotencyKey: string }) => {
      const cave = caveQuery.data;
      if (cave === undefined) {
        throw new Error('CAVE_DATA_NOT_READY');
      }

      const facility = cave.cave.facilities.find((entry) => entry.facility_config_id === facilityId);
      if (facility === undefined) {
        throw new Error('CAVE_FACILITY_NOT_FOUND');
      }

      return apiClient.buildCaveFacility(session.character_id, buildCaveBuildRequest(cave, facility), idempotencyKey);
    },
    onSuccess: async (response) => {
      emitGameFeedback('洞天设施已升级。', 'success');
      dispatch({ type: 'mark-success', response });
      await queryClient.invalidateQueries({ queryKey: [CAVE_QUERY_PREFIX, session.character_id] });
    },
    onError: (error) => {
      dispatch({ type: 'mark-error', message: buildMutationErrorMessage(error) });
    },
  });

  const firstError = progressionQuery.error ?? inventoryQuery.error ?? caveQuery.error;
  if (progressionQuery.isPending || inventoryQuery.isPending || caveQuery.isPending) {
    return <CaveLoading />;
  }

  if (firstError !== undefined && firstError !== null) {
    if (firstError instanceof ApiClientError && firstError.status === 503) {
      return <CaveMaintenance reason="" onRetry={async () => queryClient.invalidateQueries({ queryKey: [CAVE_QUERY_PREFIX, session.character_id] })} />;
    }
    if (firstError instanceof ApiClientError && firstError.status === 403) {
      return <CaveLocked reason="" onRetry={async () => queryClient.invalidateQueries({ queryKey: [CAVE_QUERY_PREFIX, session.character_id] })} />;
    }
    if (firstError instanceof ApiClientError && firstError.status === 404) {
      return <CaveEmpty reason="" onRetry={async () => queryClient.invalidateQueries({ queryKey: [CAVE_QUERY_PREFIX, session.character_id] })} />;
    }
    return <CaveError error="" onRetry={async () => queryClient.invalidateQueries({ queryKey: [CAVE_QUERY_PREFIX, session.character_id] })} />;
  }

  if (caveQuery.data === undefined) {
    return <CaveLoading />;
  }

  const caveView = buildCavePageView(
    caveQuery.data,
    inventoryQuery.data ?? { items: [], currencies: [], equipment_instances: [], total_count: 0 },
    state.selectedFacilityId,
    progressionQuery.data?.cultivation.realm_stage_id ?? null,
    now,
  );
  if (caveView.facilities.length === 0) {
    return <CaveEmpty reason="" onRetry={async () => queryClient.invalidateQueries({ queryKey: [CAVE_QUERY_PREFIX, session.character_id] })} />;
  }

  const activeFacility = caveView.activeFacility;
  const activeRawFacility = caveQuery.data.cave.facilities.find((facility) => facility.facility_config_id === activeFacility?.facilityConfigId) ?? null;
  const canRetry = state.pendingIdempotencyKey !== null && activeRawFacility !== null && activeFacility !== null && activeFacility.canBuild;

  const handleOpenConfirmation = (): void => {
    if (activeFacility?.canBuild !== true) {
      return;
    }
    if (shouldConfirmImportantActions()) dispatch({ type: 'open-confirmation' });
    else handleSubmitBuild();
  };

  const handleSubmitBuild = (): void => {
    if (activeRawFacility === null) {
      return;
    }
    const idempotencyKey = state.pendingIdempotencyKey ?? createCaveIdempotencyKey();
    dispatch({ type: 'prepare-submit', idempotencyKey });
    buildMutation.mutate({ facilityId: activeRawFacility.facility_config_id, idempotencyKey });
  };

  const handleRetryBuild = (): void => {
    if (state.pendingIdempotencyKey === null || activeRawFacility === null) {
      return;
    }
    buildMutation.mutate({ facilityId: activeRawFacility.facility_config_id, idempotencyKey: state.pendingIdempotencyKey });
  };

  return (
    <section className="cave-layout">
      <div className="cave-panel cave-panel--hero">
        <div className="cave-hero">
          <div className="cave-hero__header">
            <p className="cave-hero__eyebrow">洞府首页 / 设施管理</p>
            <h3 className="cave-hero__title">{caveView.title}</h3>
            <p className="cave-hero__copy">{caveView.summary}</p>
          </div>

          <div className="cave-metrics" aria-label="洞府摘要">
            {caveView.facts.map((fact) => (
              <div key={fact.label} className="metric-chip">
                <span className="metric-chip__label">{fact.label}</span>
                <strong className="metric-chip__value">{fact.value}</strong>
              </div>
            ))}
            <div className="metric-chip">
              <span className="metric-chip__label">当前设施</span>
              <strong className="metric-chip__value">{caveView.activeFacility === null ? '无' : caveView.activeFacility.facilityLabel}</strong>
            </div>
          </div>
        </div>
      </div>

      <div className="cave-panel">
        <div className="cave-panel__header">
          <div>
            <p className="page-card__eyebrow">三项设施</p>
            <h4 className="cave-panel__title">点击卡片切换练功房、炼丹炉与锻造炉</h4>
          </div>
          <div className="cave-panel__meta">
            <span>{caveView.activeFacilityState}</span>
            <span>洞府状态已更新</span>
          </div>
        </div>
        <div className="cave-facility-list">
          {caveView.facilities.map((facility) => (
            <CaveFacilityCard
              key={facility.facilityConfigId}
              active={facility.facilityConfigId === caveView.activeFacility?.facilityConfigId}
              subtitle={`${facility.facilityLabel} · ${summarizeCaveFacilitySubtitle(facility)}`}
              onSelect={() => dispatch({ type: 'select-facility', facilityId: facility.facilityConfigId })}
            />
          ))}
        </div>
      </div>

      <div className="cave-panel">
        <div className="cave-panel__header">
          <div>
            <p className="page-card__eyebrow">设施详情</p>
            <h4 className="cave-panel__title">当前等级、下级加成、成本和完成时间</h4>
          </div>
          <div className="cave-panel__meta">
            <span>库存 {inventoryQuery.data?.total_count ?? 0} 件</span>
            <span>修为 {progressionQuery.data?.cultivation.xp ?? '未知'}</span>
          </div>
        </div>

        <CaveDetailPanel
          view={activeFacility}
          onBuild={handleOpenConfirmation}
          onRefresh={async () => queryClient.invalidateQueries({ queryKey: [CAVE_QUERY_PREFIX, session.character_id] })}
          canRetry={canRetry}
          onRetry={handleRetryBuild}
        />

        {state.lastErrorMessage !== null ? (
          <LocalErrorStateScreen title="开建失败" description="本次提交未完成，可以沿用本次操作重试。" actions={[{ label: '沿用本次操作重试', onClick: handleRetryBuild }]} />
        ) : null}
      </div>

      <Dialog.Root open={state.confirmationOpen && activeFacility?.canBuild === true} onOpenChange={(open) => dispatch({ type: open ? 'open-confirmation' : 'close-confirmation' })}>
        <Dialog.Portal>
          <Dialog.Overlay className="cave-dialog__overlay" />
          <Dialog.Content className="cave-dialog__content">
            <Dialog.Title className="cave-dialog__title">确认开建</Dialog.Title>
            <Dialog.Description className="cave-dialog__description">
              {activeFacility === null
                ? '未选择可开建设施。'
                : `${activeFacility.facilityLabel} · ${activeFacility.levelLabel} · 下级 ${activeFacility.nextLevelRuleLabel}`}
            </Dialog.Description>
            <div className="cave-dialog__facts">
              <p>建造后会立即获得对应的洞天加成</p>
            </div>
            <div className="cave-dialog__actions">
              <button className="ghost-button" type="button" onClick={handleSubmitBuild} disabled={buildMutation.isPending || activeFacility === null}>
                {buildMutation.isPending ? '提交中…' : '确认开建'}
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
    </section>
  );
}
