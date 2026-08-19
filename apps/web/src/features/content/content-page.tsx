import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactElement } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useLocation, useNavigate, useOutletContext } from 'react-router';

import {
  ApiClientError,
  type ActionCatalogEntry,
  type AuthActiveSession,
  type ContentActionsResponse,
  type ContentRoute,
  type ContentRecipesResponse,
  type InventorySnapshot,
  type Queue,
  type RecipeCatalogEntry,
  type CharacterProgression,
} from '@dongtian/contracts';
import {
  EmptyStateScreen,
  LockedStateScreen,
  LoadingStateScreen,
  LocalErrorStateScreen,
  MaintenanceStateScreen,
} from '@dongtian/ui';

import { GameDialog } from '../../components/game-dialog.js';
import { apiClient } from '../../lib/api.js';
import {
  describeRoute,
  describeActionId,
  describeActionDescription,
  describeItemId,
  describeRecipeId,
  describeRecipeDescription,
  describeUnlockReason,
  describeRealmId,
  formatActionRate,
  formatCount,
  formatDurationUs,
  formatRecipeRate,
  isActionQueued,
  joinQueuePath,
  routeKey,
  summarizeInventoryAsset,
  summarizeItemQuantity,
} from './content-adapter.js';

export function describeInventoryCategory(category: string | null | undefined): string {
  if (category === 'MATERIAL') return '炼丹 / 炼器材料';
  if (category === 'HERB') return '灵草';
  if (category === 'ORE') return '矿材';
  if (category === 'FOOD') return '灵膳';
  if (category === 'TOOL') return '修行工具';
  if (category === 'EQUIPMENT') return '装备';
  if (category === 'CONSUMABLE') return '丹药';
  if (category === 'CURRENCY') return '灵石与货币';
  return '修行物品';
}

const CONTENT_QUERY_PREFIX = 'content';

type ContentTab = 'actions' | 'recipes';

function nextContentTab(current: ContentTab, direction: -1 | 1): ContentTab {
  if (current === 'actions') {
    return direction === 1 ? 'recipes' : 'recipes';
  }

  return direction === 1 ? 'actions' : 'actions';
}

function parseSearch(locationSearch: string): URLSearchParams {
  return new URLSearchParams(locationSearch);
}

export function clearContentDetailSearch(locationSearch: string, detailKey: 'action_id' | 'recipe_id' | 'item_id'): string {
  const params = parseSearch(locationSearch);
  params.delete(detailKey);
  return params.toString().length > 0 ? `?${params.toString()}` : '';
}

function syncSearch(navigate: ReturnType<typeof useNavigate>, pathname: string, locationSearch: string, next: Record<string, string | null | undefined>): void {
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

function useCraftQueries(characterId: string) {
  const progressionQuery = useQuery<CharacterProgression>({
    queryKey: [CONTENT_QUERY_PREFIX, characterId, 'progression'],
    queryFn: () => apiClient.getProgression(characterId),
  });
  const actionsQuery = useQuery<ContentActionsResponse>({
    queryKey: [CONTENT_QUERY_PREFIX, characterId, 'actions'],
    queryFn: () => apiClient.getActions(),
  });
  const recipesQuery = useQuery<ContentRecipesResponse>({
    queryKey: [CONTENT_QUERY_PREFIX, characterId, 'recipes'],
    queryFn: () => apiClient.getRecipes(),
  });
  const queueQuery = useQuery<Queue>({
    queryKey: [CONTENT_QUERY_PREFIX, characterId, 'queue'],
    queryFn: () => apiClient.getQueue(characterId),
  });

  return { progressionQuery, actionsQuery, recipesQuery, queueQuery };
}

function useInventoryQueries(characterId: string) {
  const progressionQuery = useQuery<CharacterProgression>({
    queryKey: [CONTENT_QUERY_PREFIX, characterId, 'progression'],
    queryFn: () => apiClient.getProgression(characterId),
  });
  const inventoryQuery = useQuery<InventorySnapshot>({
    queryKey: [CONTENT_QUERY_PREFIX, characterId, 'inventory'],
    queryFn: () => apiClient.getInventory(characterId),
  });

  return { progressionQuery, inventoryQuery };
}

function ContentLoading({ title, description }: { readonly title: string; readonly description: string }): ReactElement {
  return (
    <section className="content-workbench content-workbench--state">
      <header className="content-workbench__header">
        <div>
          <p className="page-card__eyebrow">洞天内容</p>
          <h3 className="page-card__title">{title}</h3>
        </div>
      </header>
      <div className="content-panel content-workbench__panel">
        <LoadingStateScreen title={title} description={description} />
      </div>
    </section>
  );
}

function ContentError({
  title,
  onRetry,
}: {
  readonly title: string;
  readonly onRetry: () => void;
}): ReactElement {
  return (
    <section className="content-workbench content-workbench--state">
      <header className="content-workbench__header">
        <div>
          <p className="page-card__eyebrow">洞天内容</p>
          <h3 className="page-card__title">{title}</h3>
        </div>
      </header>
      <div className="content-panel content-workbench__panel">
        <LocalErrorStateScreen
          title={title}
          description="暂时无法读取这些内容，请稍后重试。"
          actions={[{ label: '重试', onClick: onRetry }]}
        />
      </div>
    </section>
  );
}

function ContentMaintenance({ title, onRetry }: { readonly title: string; readonly onRetry: () => void }): ReactElement {
  return (
    <section className="content-workbench content-workbench--state">
      <header className="content-workbench__header">
        <div>
          <p className="page-card__eyebrow">洞天内容</p>
          <h3 className="page-card__title">{title}</h3>
        </div>
      </header>
      <div className="content-panel content-workbench__panel">
        <MaintenanceStateScreen
          title={title}
          description="内容暂时无法读取，请稍后重试。"
          actions={[{ label: '重试', onClick: onRetry }]}
        />
      </div>
    </section>
  );
}

function renderRouteButtons(
  routes: ReadonlyArray<ContentRoute>,
  onSelectRoute: (route: ContentRoute) => void,
): ReactElement | null {
  if (routes.length === 0) {
    return null;
  }

  return (
    <div className="content-route-list">
      {routes.map((route) => (
        <button key={routeKey(route)} className="chip-button" type="button" onClick={() => onSelectRoute(route)}>
          {describeRoute(route)}
        </button>
      ))}
    </div>
  );
}

function ActionCard({
  entry,
  isSelected,
  isRunning,
  onOpen,
  onJoinQueue,
}: {
  readonly entry: ActionCatalogEntry;
  readonly isSelected: boolean;
  readonly isRunning: boolean;
  readonly onOpen: () => void;
  readonly onJoinQueue: () => void;
}): ReactElement {
  return (
    <article className={`content-card content-card--compact ${isSelected ? 'content-card--selected' : ''}`}>
      <button className="content-card__title-button" type="button" onClick={onOpen} aria-pressed={isSelected}>
        <span className="content-card__title-row">
          <strong title={describeActionId(entry.action_id)}>{describeActionId(entry.action_id)}</strong>
          {isRunning ? <span className="content-card__status">执行中</span> : null}
          {entry.unlocked ? <span className="content-card__status">可用</span> : <span className="content-card__status content-card__status--locked">锁定</span>}
        </span>
        <span className="content-card__subtitle">{describeActionDescription(entry.action_id)}</span>
      </button>
      <div className="content-card__meta">
        <span>耗时 {formatDurationUs(entry.base_duration_us)}</span>
        <span>技能经验 {formatCount(entry.skill_xp)}</span>
        <span>修为经验 {formatCount(entry.cultivation_xp)}</span>
        <span>每小时 {formatActionRate(entry)}</span>
      </div>
      {!entry.unlocked ? <p className="content-card__unlock">{describeUnlockReason(entry.unlock_state.reason, entry.unlock_state.blockers)}</p> : null}
      <div className="content-card__actions">
        <button className="ghost-button ghost-button--compact" type="button" onClick={onOpen}>
          查看详情
        </button>
        <button className="ghost-button ghost-button--compact" type="button" onClick={onJoinQueue} disabled={!entry.can_add_to_queue}>
          开始修行
        </button>
      </div>
    </article>
  );
}

function RecipeCard({
  entry,
  isSelected,
  isRunning,
  onOpen,
  onJoinQueue,
}: {
  readonly entry: RecipeCatalogEntry;
  readonly isSelected: boolean;
  readonly isRunning: boolean;
  readonly onOpen: () => void;
  readonly onJoinQueue: () => void;
}): ReactElement {
  return (
    <article className={`content-card content-card--compact ${isSelected ? 'content-card--selected' : ''}`}>
      <button className="content-card__title-button" type="button" onClick={onOpen} aria-pressed={isSelected}>
        <span className="content-card__title-row">
          <strong title={describeRecipeId(entry.recipe_id)}>{describeRecipeId(entry.recipe_id)}</strong>
          {isRunning ? <span className="content-card__status">执行中</span> : null}
          {entry.unlocked ? <span className="content-card__status">可用</span> : <span className="content-card__status content-card__status--locked">锁定</span>}
        </span>
        <span className="content-card__subtitle">{describeRecipeDescription(entry.recipe_id)}</span>
      </button>
      <div className="content-card__meta">
        <span>耗时 {formatDurationUs(entry.base_duration_us)}</span>
        <span>技能经验 {formatCount(entry.skill_xp)}</span>
        <span>结果 {formatCount(entry.result_quantity)}</span>
        <span>每小时 {formatRecipeRate(entry)}</span>
      </div>
      {!entry.unlocked ? <p className="content-card__unlock">{describeUnlockReason(entry.unlock_state.reason, entry.unlock_state.blockers)}</p> : null}
      <div className="content-card__actions">
        <button className="ghost-button ghost-button--compact" type="button" onClick={onOpen}>
          查看详情
        </button>
        <button className="ghost-button ghost-button--compact" type="button" onClick={onJoinQueue} disabled={!entry.can_add_to_queue}>
          开始炼制
        </button>
      </div>
    </article>
  );
}

function ItemCard({
  item,
  selected,
  onOpen,
}: {
  readonly item: InventorySnapshot['items'][number];
  readonly selected: boolean;
  readonly onOpen: () => void;
}): ReactElement {
  return (
    <article className={`content-card content-card--compact inventory-item-card ${selected ? 'content-card--selected' : ''}`}>
      <button className="content-card__title-button" type="button" onClick={onOpen} aria-pressed={selected}>
        <span className="inventory-item-card__icon" aria-hidden="true">{item.asset_type === 'CURRENCY' ? '灵' : '物'}</span>
        <span className="content-card__title-row">
          <strong title={describeItemId(item.asset_id)}>{describeItemId(item.asset_id)}</strong>
          <span className="content-card__status">{item.asset_type === 'CURRENCY' ? '灵石' : describeInventoryCategory(item.category)}</span>
        </span>
        <span className="content-card__subtitle">{describeInventoryCategory(item.category)}</span>
      </button>
      <p className="content-card__copy">{summarizeInventoryAsset(item)}</p>
      <div className="content-card__actions">
        <button className="ghost-button ghost-button--compact" type="button" onClick={onOpen}>
          查看来源用途
        </button>
      </div>
    </article>
  );
}

function DetailSummary({ facts, note }: { readonly facts: ReadonlyArray<readonly [string, string]>; readonly note: string }): ReactElement {
  return (
    <div className="content-detail__summary">
      <div className="content-detail__facts">
        {facts.map(([label, value]) => (
          <div key={label} className="content-detail__fact">
            <span>{label}</span>
            <strong>{value}</strong>
          </div>
        ))}
      </div>
      <p className="content-detail__copy">{note}</p>
    </div>
  );
}

function ActionDetail({
  action,
  queue,
  onJoinQueue,
  onOpenInventoryItem,
  onSelectRoute,
}: {
  readonly action: ActionCatalogEntry;
  readonly queue: Queue;
  readonly onJoinQueue: () => void;
  readonly onOpenInventoryItem: (itemId: string) => void;
  readonly onSelectRoute: (route: ContentRoute) => void;
}): ReactElement {
  const statusLabel = isActionQueued(action.action_id, queue) ? '当前正在执行或排队' : '未排队';

  return (
    <section className="content-detail">
      <div className="content-detail__header">
        <div>
          <p className="page-card__eyebrow">行动详情</p>
          <h3 className="content-detail__title">{describeActionId(action.action_id)}</h3>
          <p className="content-detail__copy">{describeActionDescription(action.action_id)}</p>
        </div>
        <div className="content-detail__badges">
          <span className="content-card__status">{statusLabel}</span>
          <span className="content-card__status">{action.unlocked ? '已解锁' : '锁定中'}</span>
        </div>
      </div>
      <DetailSummary
        facts={[
          ['状态', action.can_add_to_queue ? '可加入队列' : '不可加入队列'],
          ['每轮', formatDurationUs(action.base_duration_us)],
          ['技能经验', formatCount(action.skill_xp)],
          ['修为经验', formatCount(action.cultivation_xp)],
        ]}
        note={describeUnlockReason(action.unlock_state.reason, action.unlock_state.blockers)}
      />
      <div className="content-detail__section">
        <h4>输入</h4>
        {action.inputs.length === 0 ? <p className="content-detail__copy">无输入材料。</p> : null}
        {action.inputs.map((input) => (
          <article key={input.item_id} className="content-stack">
            <strong title={describeItemId(input.item_id)}>{describeItemId(input.item_id)}</strong>
            <p>{summarizeItemQuantity(input)}</p>
            {renderRouteButtons(input.source_routes, onSelectRoute)}
            {renderRouteButtons(input.usage_routes, onSelectRoute)}
            <div className="content-card__actions">
              <button className="chip-button" type="button" onClick={() => onOpenInventoryItem(input.item_id)}>
                查看来源
              </button>
            </div>
          </article>
        ))}
      </div>
      <div className="content-detail__section">
        <h4>输出</h4>
        {action.outputs.length === 0 ? <p className="content-detail__copy">无输出。</p> : null}
        {action.outputs.map((output) => (
          <article key={output.item_id} className="content-stack">
            <strong title={describeItemId(output.item_id)}>{describeItemId(output.item_id)}</strong>
            <p>{summarizeItemQuantity(output)}</p>
            {renderRouteButtons(output.source_routes, onSelectRoute)}
            {renderRouteButtons(output.usage_routes, onSelectRoute)}
            <div className="content-card__actions">
              <button className="chip-button" type="button" onClick={() => onOpenInventoryItem(output.item_id)}>
                查看用途
              </button>
            </div>
          </article>
        ))}
      </div>
      <div className="content-detail__actions">
        <button className="ghost-button" type="button" onClick={onJoinQueue} disabled={!action.can_add_to_queue}>
           开始修行
        </button>
      </div>
    </section>
  );
}

function RecipeDetail({
  recipe,
  queue,
  onJoinQueue,
  onOpenInventoryItem,
  onSelectRoute,
}: {
  readonly recipe: RecipeCatalogEntry;
  readonly queue: Queue;
  readonly onJoinQueue: () => void;
  readonly onOpenInventoryItem: (itemId: string) => void;
  readonly onSelectRoute: (route: ContentRoute) => void;
}): ReactElement {
  const statusLabel = isActionQueued(recipe.queue_action_id, queue) ? '当前正在执行或排队' : '未排队';

  return (
    <section className="content-detail">
      <div className="content-detail__header">
        <div>
          <p className="page-card__eyebrow">配方详情</p>
         <h3 className="content-detail__title" title={describeRecipeId(recipe.recipe_id)}>{describeRecipeId(recipe.recipe_id)}</h3>
          <p className="content-detail__copy">{describeRecipeDescription(recipe.recipe_id)}</p>
        </div>
        <div className="content-detail__badges">
          <span className="content-card__status">{statusLabel}</span>
          <span className="content-card__status">{recipe.unlocked ? '已解锁' : '锁定中'}</span>
        </div>
      </div>
      <DetailSummary
        facts={[
          ['状态', recipe.can_add_to_queue ? '可加入队列' : '不可加入队列'],
          ['每轮', formatDurationUs(recipe.base_duration_us)],
          ['熟练度', formatCount(recipe.skill_xp)],
          ['产出', formatCount(recipe.result_quantity)],
        ]}
        note={describeUnlockReason(recipe.unlock_state.reason, recipe.unlock_state.blockers)}
      />
      <div className="content-detail__section">
        <h4>材料</h4>
        {recipe.ingredients.map((ingredient) => (
          <article key={ingredient.item_id} className="content-stack">
            <strong title={describeItemId(ingredient.item_id)}>{describeItemId(ingredient.item_id)}</strong>
            <p>{summarizeItemQuantity(ingredient)}</p>
            {renderRouteButtons(ingredient.source_routes, onSelectRoute)}
            {renderRouteButtons(ingredient.usage_routes, onSelectRoute)}
            <div className="content-card__actions">
              <button className="chip-button" type="button" onClick={() => onOpenInventoryItem(ingredient.item_id)}>
                查看来源
              </button>
              <button className="chip-button" type="button" onClick={() => onOpenInventoryItem(ingredient.item_id)}>
                查看用途
              </button>
            </div>
          </article>
        ))}
      </div>
      <div className="content-detail__section">
        <h4>产物</h4>
        <article className="content-stack">
          <strong title={describeItemId(recipe.result_item.item_id)}>{describeItemId(recipe.result_item.item_id)}</strong>
          <p>{summarizeItemQuantity(recipe.result_item)}</p>
          {renderRouteButtons(recipe.result_item.source_routes, onSelectRoute)}
          {renderRouteButtons(recipe.result_item.usage_routes, onSelectRoute)}
          <div className="content-card__actions">
            <button className="chip-button" type="button" onClick={() => onOpenInventoryItem(recipe.result_item.item_id)}>
              查看来源
            </button>
          </div>
        </article>
      </div>
      <div className="content-detail__actions">
        <button className="ghost-button" type="button" onClick={onJoinQueue} disabled={!recipe.can_add_to_queue}>
          开始炼制
        </button>
      </div>
    </section>
  );
}

function InventoryDetail({
  item,
  onSelectRoute,
}: {
  readonly item: InventorySnapshot['items'][number];
  readonly onSelectRoute: (route: ContentRoute) => void;
}): ReactElement {
  const primarySourceRoute = item.source_routes?.[0];
  const sourceRoutes = item.source_routes ?? [];
  const usageRoutes = item.usage_routes ?? [];
  return (
    <section className="content-detail">
      <div className="content-detail__header">
        <div>
          <p className="page-card__eyebrow">背包详情</p>
          <h3 className="content-detail__title" title={describeItemId(item.asset_id)}>{describeItemId(item.asset_id)}</h3>
          <p className="content-detail__copy">{describeInventoryCategory(item.category)}</p>
        </div>
      </div>
      <DetailSummary
        facts={[
          ['类型', item.asset_type === 'CURRENCY' ? '货币' : '修行物品'],
          ['数量', formatCount(item.quantity)],
          ['可用', formatCount(item.available_quantity)],
          ['预留', formatCount(item.reserved_quantity)],
        ]}
        note={summarizeInventoryAsset(item)}
      />
      <div className="content-detail__section">
        <h4>来源</h4>
        {sourceRoutes.length ? (
          renderRouteButtons(sourceRoutes, onSelectRoute)
        ) : (
          <p className="content-detail__copy">当前没有可展示的来源路线。</p>
        )}
      </div>
      <div className="content-detail__section">
        <h4>用途</h4>
        {usageRoutes.length ? (
          renderRouteButtons(usageRoutes, onSelectRoute)
        ) : (
          <p className="content-detail__copy">当前没有可展示的用途路线。</p>
        )}
      </div>
      <div className="content-detail__actions">
        {primarySourceRoute ? (
          <button className="chip-button" type="button" onClick={() => onSelectRoute(primarySourceRoute)}>
            跳到来源
          </button>
        ) : null}
      </div>
    </section>
  );
}

export function CraftPage(): ReactElement {
  const session = useOutletContext<AuthActiveSession>();
  const navigate = useNavigate();
  const location = useLocation();
  const { progressionQuery, actionsQuery, recipesQuery, queueQuery } = useCraftQueries(session.character_id);
  const params = useMemo(() => parseSearch(location.search), [location.search]);
  const tabParam = params.get('tab');
  const selectedActionId = params.get('action_id');
  const selectedRecipeId = params.get('recipe_id');
  const initialTab: ContentTab = tabParam === 'recipes' || selectedRecipeId !== null ? 'recipes' : 'actions';
  const [activeTab, setActiveTab] = useState<ContentTab>(initialTab);
  const contentTabRefs = useRef<Partial<Record<ContentTab, HTMLButtonElement | null>>>({});

  useEffect(() => {
    if (tabParam === 'recipes' || selectedRecipeId !== null) {
      setActiveTab('recipes');
    } else if (tabParam === 'actions' || selectedActionId !== null) {
      setActiveTab('actions');
    }
  }, [selectedActionId, selectedRecipeId, tabParam]);

  const selectedAction = useMemo(
    () => (selectedActionId === null ? null : actionsQuery.data?.actions.find((entry) => entry.action_id === selectedActionId) ?? null),
    [actionsQuery.data?.actions, selectedActionId],
  );
  const selectedRecipe = useMemo(
    () => (selectedRecipeId === null ? null : recipesQuery.data?.recipes.find((entry) => entry.recipe_id === selectedRecipeId) ?? null),
    [recipesQuery.data?.recipes, selectedRecipeId],
  );
  const detailTab: ContentTab = selectedAction !== null ? 'actions' : selectedRecipe !== null ? 'recipes' : activeTab;

  const progressionData = progressionQuery.data;
  const actionsData = actionsQuery.data;
  const recipesData = recipesQuery.data;
  const queueData = queueQuery.data;

  const handleSelectRoute = (route: ContentRoute) => {
    syncSearch(navigate, location.pathname, location.search, route.route_type === 'ACTION' ? { tab: 'actions', action_id: route.target_id, recipe_id: null } : { tab: 'recipes', recipe_id: route.target_id, action_id: null });
  };
  const handleOpenInventoryItem = (itemId: string) => {
    syncSearch(navigate, '/inventory', '', { item_id: itemId, tab: null, action_id: null, recipe_id: null });
  };
  const handleTabChange = (nextTab: ContentTab) => {
    setActiveTab(nextTab);
    syncSearch(navigate, location.pathname, location.search, {
      tab: nextTab,
      action_id: null,
      recipe_id: null,
    });
  };
  const handleTabKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight' && event.key !== 'Home' && event.key !== 'End') return;
    event.preventDefault();
    const nextTab = event.key === 'Home' ? 'actions' : event.key === 'End' ? 'recipes' : nextContentTab(activeTab, event.key === 'ArrowRight' ? 1 : -1);
    handleTabChange(nextTab);
    window.requestAnimationFrame(() => contentTabRefs.current[nextTab]?.focus());
  };

  const retryAll = () => {
    void Promise.all([
      progressionQuery.refetch(),
      actionsQuery.refetch(),
      recipesQuery.refetch(),
      queueQuery.refetch(),
    ]);
  };

  const closeDetails = () => {
    const withoutAction = clearContentDetailSearch(location.search, 'action_id');
    navigate({ pathname: location.pathname, search: clearContentDetailSearch(withoutAction, 'recipe_id') });
  };

  if (progressionQuery.isPending || actionsQuery.isPending || recipesQuery.isPending || queueQuery.isPending) {
    return <ContentLoading title="正在读取百艺内容" description="正在整理修行技能与炼丹内容，请稍候。" />;
  }

  const firstError = progressionQuery.error ?? actionsQuery.error ?? recipesQuery.error ?? queueQuery.error;
  if (firstError !== undefined && firstError !== null) {
    if (firstError instanceof ApiClientError && firstError.status === 503) {
      return <ContentMaintenance title="百艺维护中" onRetry={retryAll} />;
    }

    return <ContentError title="百艺读取失败" onRetry={retryAll} />;
  }

  if (progressionData === undefined || actionsData === undefined || recipesData === undefined || queueData === undefined) {
    return <ContentLoading title="正在读取百艺内容" description="正在整理修行技能与炼丹内容，请稍候。" />;
  }

  return (
    <section className="content-layout content-screen content-screen--single content-workbench content-workbench--craft" aria-label="百艺总览">
      <header className="content-workbench__header" aria-label="百艺标题">
        <div>
          <p className="page-card__eyebrow">百艺</p>
          <h3 className="page-card__title">修行技能</h3>
          <p className="page-card__copy">选择技能或配方，查看真实材料与队列状态。</p>
        </div>
        <p className="content-workbench__summary">
          {formatCount(actionsData.actions.length)} 项技能 · {formatCount(actionsData.actions.filter((entry) => entry.unlocked).length)} 项已掌握 · {formatCount(recipesData.recipes.length)} 个配方 · {describeRealmId(progressionData.cultivation.realm_stage_id)}
        </p>
      </header>

      <div className="content-panel content-workbench__panel" aria-label="百艺内容">
        <div className="content-tabs" role="tablist" aria-label="百艺分类" onKeyDown={handleTabKeyDown}>
          <button
            id="content-tab-actions"
            ref={(element) => { contentTabRefs.current.actions = element; }}
            className={`chip-button ${activeTab === 'actions' ? 'chip-button--active' : ''}`}
            type="button"
            role="tab"
            aria-selected={activeTab === 'actions'}
            aria-controls="content-panel-actions"
            tabIndex={activeTab === 'actions' ? 0 : -1}
            onClick={() => handleTabChange('actions')}
          >
            技能
          </button>
          <button
            id="content-tab-recipes"
            ref={(element) => { contentTabRefs.current.recipes = element; }}
            className={`chip-button ${activeTab === 'recipes' ? 'chip-button--active' : ''}`}
            type="button"
            role="tab"
            aria-selected={activeTab === 'recipes'}
            aria-controls="content-panel-recipes"
            tabIndex={activeTab === 'recipes' ? 0 : -1}
            onClick={() => handleTabChange('recipes')}
          >
            炼丹
          </button>
        </div>
        <div className="content-list content-list--compact">
          {(activeTab === 'actions' ? actionsData.actions : recipesData.recipes).length === 0 ? (
            <EmptyStateScreen title="暂无可见内容" description="当前分类没有内容，或角色未解锁。" />
          ) : null}
          <div id="content-panel-actions" role="tabpanel" aria-labelledby="content-tab-actions" hidden={activeTab !== 'actions'}>
            {activeTab === 'actions'
              ? actionsData.actions.map((entry) => (
                  <ActionCard
                    key={entry.action_id}
                    entry={entry}
                    isSelected={selectedAction?.action_id === entry.action_id}
                    isRunning={isActionQueued(entry.action_id, queueData)}
                    onOpen={() => syncSearch(navigate, location.pathname, location.search, { tab: 'actions', action_id: entry.action_id, recipe_id: null })}
                    onJoinQueue={() => navigate(joinQueuePath(entry.queue_action_id))}
                  />
                ))
              : null}
          </div>
          <div id="content-panel-recipes" role="tabpanel" aria-labelledby="content-tab-recipes" hidden={activeTab !== 'recipes'}>
            {activeTab === 'recipes'
              ? recipesData.recipes.map((entry) => (
                  <RecipeCard
                    key={entry.recipe_id}
                    entry={entry}
                    isSelected={selectedRecipe?.recipe_id === entry.recipe_id}
                    isRunning={isActionQueued(entry.queue_action_id, queueData)}
                    onOpen={() => syncSearch(navigate, location.pathname, location.search, { tab: 'recipes', recipe_id: entry.recipe_id, action_id: null })}
                    onJoinQueue={() => navigate(joinQueuePath(entry.queue_action_id))}
                  />
                ))
              : null}
          </div>
        </div>
      </div>

      <GameDialog
        open={selectedAction !== null || selectedRecipe !== null || (actionsData !== undefined && selectedActionId !== null && selectedAction === null) || (recipesData !== undefined && selectedRecipeId !== null && selectedRecipe === null)}
        onOpenChange={(open) => {
          if (!open) closeDetails();
        }}
        eyebrow={detailTab === 'actions' ? '行动详情' : '配方详情'}
        title={selectedActionId !== null && selectedAction === null ? '未找到行动' : selectedRecipeId !== null && selectedRecipe === null ? '未找到配方' : detailTab === 'actions' ? describeActionId(selectedAction?.action_id) : describeRecipeId(selectedRecipe?.recipe_id)}
      >
        {selectedActionId !== null && selectedAction === null ? <p className="game-dialog__copy">未找到对应的行动，请从百艺列表重新选择。</p> : selectedRecipeId !== null && selectedRecipe === null ? <p className="game-dialog__copy">未找到对应的配方，请从百艺列表重新选择。</p> : detailTab === 'actions' && selectedAction ? (
          selectedAction.unlocked ? (
            <ActionDetail
              action={selectedAction}
              queue={queueData}
              onJoinQueue={() => navigate(joinQueuePath(selectedAction.queue_action_id))}
              onOpenInventoryItem={handleOpenInventoryItem}
              onSelectRoute={handleSelectRoute}
            />
          ) : (
            <LockedStateScreen title={describeActionId(selectedAction.action_id)} description={describeUnlockReason(selectedAction.unlock_state.reason, selectedAction.unlock_state.blockers)} />
          )
        ) : detailTab === 'recipes' && selectedRecipe ? (
          selectedRecipe.unlocked ? (
            <RecipeDetail
              recipe={selectedRecipe}
              queue={queueData}
              onJoinQueue={() => navigate(joinQueuePath(selectedRecipe.queue_action_id))}
              onOpenInventoryItem={handleOpenInventoryItem}
              onSelectRoute={handleSelectRoute}
            />
          ) : (
            <LockedStateScreen title={describeRecipeId(selectedRecipe.recipe_id)} description={describeUnlockReason(selectedRecipe.unlock_state.reason, selectedRecipe.unlock_state.blockers)} />
          )
        ) : null}
      </GameDialog>
    </section>
  );
}

export function InventoryPage(): ReactElement {
  const session = useOutletContext<AuthActiveSession>();
  const navigate = useNavigate();
  const location = useLocation();
  const { progressionQuery, inventoryQuery } = useInventoryQueries(session.character_id);
  const params = useMemo(() => parseSearch(location.search), [location.search]);
  const selectedItemId = params.get('item_id');

  const progressionData = progressionQuery.data;
  const inventoryData = inventoryQuery.data;
  const selectedItem = useMemo(() => (selectedItemId === null ? null : inventoryData?.items.find((item) => item.asset_id === selectedItemId) ?? null), [inventoryData?.items, selectedItemId]);

  const retryInventory = () => {
    void Promise.all([progressionQuery.refetch(), inventoryQuery.refetch()]);
  };

  const closeDetails = () => {
    navigate({ pathname: location.pathname, search: clearContentDetailSearch(location.search, 'item_id') });
  };

  if (progressionQuery.isPending || inventoryQuery.isPending) {
    return <ContentLoading title="正在读取背包" description="正在整理储藏、来源和用途，请稍候。" />;
  }

  const firstError = progressionQuery.error ?? inventoryQuery.error;
  if (firstError !== undefined && firstError !== null) {
    if (firstError instanceof ApiClientError && firstError.status === 503) {
      return <ContentMaintenance title="背包维护中" onRetry={retryInventory} />;
    }

    return <ContentError title="背包读取失败" onRetry={retryInventory} />;
  }

  if (progressionData === undefined || inventoryData === undefined) {
    return <ContentLoading title="正在读取背包" description="正在整理储藏、来源和用途，请稍候。" />;
  }

  return (
    <section className="content-layout inventory-screen content-screen--single content-workbench content-workbench--inventory" aria-label="背包总览">
      <header className="content-workbench__header">
        <div>
          <p className="page-card__eyebrow">背包</p>
          <h3 className="page-card__title">洞天储藏</h3>
          <p className="page-card__copy">查看灵石、材料、丹药和装备的真实数量与用途。</p>
        </div>
        <p className="content-workbench__summary">
          {formatCount(inventoryData.items.length)} 件物品 · {formatCount(inventoryData.currencies.length)} 类货币 · {formatCount(inventoryData.equipment_instances.length)} 件装备 · 总计 {formatCount(inventoryData.total_count)}
        </p>
      </header>

      <div className="content-panel content-workbench__panel" aria-label="背包物品">
        <div className="content-list content-list--compact">
          {inventoryData.items.length === 0 ? <EmptyStateScreen title="背包为空" description="当前没有可展示的库存物品。" /> : null}
          {inventoryData.items.map((item) => (
            <ItemCard
              key={item.asset_id}
              item={item}
              selected={selectedItem?.asset_id === item.asset_id}
              onOpen={() => syncSearch(navigate, location.pathname, location.search, { item_id: item.asset_id })}
            />
          ))}
        </div>
      </div>

      <GameDialog
        open={selectedItem !== null || (inventoryData !== undefined && selectedItemId !== null && selectedItem === null)}
        onOpenChange={(open) => {
          if (!open) closeDetails();
        }}
        eyebrow="背包详情"
        title={selectedItemId !== null && selectedItem === null ? '未找到物品' : describeItemId(selectedItem?.asset_id)}
      >
        {selectedItemId !== null && selectedItem === null ? <p className="game-dialog__copy">未找到对应的修行物品，请从背包列表重新选择。</p> : selectedItem ? (
          <InventoryDetail
            item={selectedItem}
            onSelectRoute={(route) => syncSearch(navigate, '/craft', '', route.route_type === 'ACTION' ? { tab: 'actions', action_id: route.target_id, recipe_id: null } : { tab: 'recipes', recipe_id: route.target_id, action_id: null })}
          />
        ) : null}
      </GameDialog>
    </section>
  );
}
