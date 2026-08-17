import { useEffect, useMemo, useState, type KeyboardEvent, type ReactElement } from 'react';
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
  NormalStateScreen,
} from '@dongtian/ui';

import { apiClient } from '../../lib/api.js';
import {
  describeRoute,
  describeActionId,
  describeActionDescription,
  describeItemId,
  describeRecipeId,
  describeRecipeDescription,
  describeUnlockReason,
  describeSkillId,
  formatActionRate,
  formatCount,
  formatDurationUs,
  formatRecipeRate,
  isActionQueued,
  joinQueuePath,
  routeKey,
  selectBestAction,
  summarizeInventoryAsset,
  summarizeItemQuantity,
} from './content-adapter.js';

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
    <section className="content-layout">
      <div className="content-panel content-panel--hero">
        <LoadingStateScreen title={title} description={description} />
      </div>
      <div className="content-panel">
        <LoadingStateScreen title="权威列表" description="等待内容 API 响应。" />
      </div>
      <div className="content-panel">
        <LoadingStateScreen title="详情" description="等待选中条目。" />
      </div>
    </section>
  );
}

function ContentError({
  title,
  error,
  onRetry,
}: {
  readonly title: string;
  readonly error: string;
  readonly onRetry: () => void;
}): ReactElement {
  return (
    <section className="content-layout">
      <div className="content-panel content-panel--hero">
        <LocalErrorStateScreen
          title={title}
          description="内容页读取失败，已保留页面壳和导航。"
          actions={[{ label: '重试', onClick: onRetry }]}
          footnote={error}
        />
      </div>
      <div className="content-panel">
        <EmptyStateScreen title="列表空白" description="等待权威数据恢复。" />
      </div>
      <div className="content-panel">
        <EmptyStateScreen title="详情空白" description="等待选中条目。" />
      </div>
    </section>
  );
}

function ContentMaintenance({ title, reason, onRetry }: { readonly title: string; readonly reason: string; readonly onRetry: () => void }): ReactElement {
  return (
    <section className="content-layout">
      <div className="content-panel content-panel--hero">
        <MaintenanceStateScreen
          title={title}
          description="内容 API 或依赖当前不可用。"
          actions={[{ label: '重试', onClick: onRetry }]}
          footnote={reason}
        />
      </div>
      <div className="content-panel">
        <EmptyStateScreen title="列表空白" description="维护期间不展示伪造内容。" />
      </div>
      <div className="content-panel">
        <EmptyStateScreen title="详情空白" description="维护期间不展示伪造内容。" />
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
    <article className={`content-card ${isSelected ? 'content-card--selected' : ''}`}>
      <button className="content-card__title-button" type="button" onClick={onOpen} aria-pressed={isSelected}>
        <span className="content-card__title-row">
          <strong title={entry.action_id}>{describeActionId(entry.action_id)}</strong>
          {isRunning ? <span className="content-card__status">执行中</span> : null}
          {entry.unlocked ? <span className="content-card__status">可用</span> : <span className="content-card__status content-card__status--locked">锁定</span>}
        </span>
        <span className="content-card__subtitle">{describeActionDescription(entry.action_id)}</span>
      </button>
      <p className="content-card__copy">{describeActionDescription(entry.action_id)}</p>
      <div className="content-card__meta">
        <span>耗时 {formatDurationUs(entry.base_duration_us)}</span>
        <span>技能 XP {formatCount(entry.skill_xp)}</span>
        <span>修为 XP {formatCount(entry.cultivation_xp)}</span>
        <span>每小时 {formatActionRate(entry)}</span>
      </div>
      {!entry.unlocked ? <div className="content-card__copy">{describeUnlockReason(entry.unlock_state.reason)}</div> : null}
      <div className="content-card__actions">
        <button className="ghost-button ghost-button--compact" type="button" onClick={onOpen}>
          查看详情
        </button>
        <button className="ghost-button ghost-button--compact" type="button" onClick={onJoinQueue} disabled={!entry.can_add_to_queue}>
          加入队列
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
    <article className={`content-card ${isSelected ? 'content-card--selected' : ''}`}>
      <button className="content-card__title-button" type="button" onClick={onOpen} aria-pressed={isSelected}>
        <span className="content-card__title-row">
          <strong title={entry.recipe_id}>{describeRecipeId(entry.recipe_id)}</strong>
          {isRunning ? <span className="content-card__status">执行中</span> : null}
          {entry.unlocked ? <span className="content-card__status">可用</span> : <span className="content-card__status content-card__status--locked">锁定</span>}
        </span>
        <span className="content-card__subtitle">{describeRecipeDescription(entry.recipe_id)}</span>
      </button>
      <p className="content-card__copy">{describeRecipeDescription(entry.recipe_id)}</p>
      <div className="content-card__meta">
        <span>耗时 {formatDurationUs(entry.base_duration_us)}</span>
        <span>技能 XP {formatCount(entry.skill_xp)}</span>
        <span>结果 {formatCount(entry.result_quantity)}</span>
        <span>每小时 {formatRecipeRate(entry)}</span>
      </div>
      {!entry.unlocked ? <div className="content-card__copy">{describeUnlockReason(entry.unlock_state.reason)}</div> : null}
      <div className="content-card__actions">
        <button className="ghost-button ghost-button--compact" type="button" onClick={onOpen}>
          查看详情
        </button>
        <button className="ghost-button ghost-button--compact" type="button" onClick={onJoinQueue} disabled={!entry.can_add_to_queue}>
          加入队列
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
    <article className={`content-card inventory-item-card ${selected ? 'content-card--selected' : ''}`}>
      <button className="content-card__title-button" type="button" onClick={onOpen} aria-pressed={selected}>
        <span className="inventory-item-card__icon" aria-hidden="true">{item.asset_type === 'CURRENCY' ? '灵' : '物'}</span>
        <span className="content-card__title-row">
          <strong title={item.asset_id}>{describeItemId(item.asset_id)}</strong>
          <span className="content-card__status">{item.asset_type === 'CURRENCY' ? '灵石' : '材料'}</span>
        </span>
        <span className="content-card__subtitle">{item.category ?? '未分类'}</span>
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
      <div className="content-detail__metrics">
        <NormalStateScreen
          title={describeActionId(action.action_id)}
          description={describeUnlockReason(action.unlock_state.reason)}
          highlight={action.can_add_to_queue ? '可加入队列' : '不可加入队列'}
          footnote={`每轮 ${formatDurationUs(action.base_duration_us)} · 修为 ${formatCount(action.cultivation_xp)}`}
        />
      </div>
      <div className="content-detail__section">
        <h4>输入</h4>
        {action.inputs.length === 0 ? <p className="content-detail__copy">无输入材料。</p> : null}
        {action.inputs.map((input) => (
          <article key={input.item_id} className="content-stack">
            <strong title={input.item_id}>{describeItemId(input.item_id)}</strong>
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
            <strong title={output.item_id}>{describeItemId(output.item_id)}</strong>
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
          加入当前草稿
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
          <h3 className="content-detail__title" title={recipe.recipe_id}>{describeRecipeId(recipe.recipe_id)}</h3>
          <p className="content-detail__copy">{describeRecipeDescription(recipe.recipe_id)}</p>
        </div>
        <div className="content-detail__badges">
          <span className="content-card__status">{statusLabel}</span>
          <span className="content-card__status">{recipe.unlocked ? '已解锁' : '锁定中'}</span>
        </div>
      </div>
      <NormalStateScreen
        title={describeRecipeId(recipe.recipe_id)}
        description={describeUnlockReason(recipe.unlock_state.reason)}
        highlight={recipe.can_add_to_queue ? '可加入队列' : '不可加入队列'}
        footnote={`每轮 ${formatDurationUs(recipe.base_duration_us)} · 熟练度 ${formatCount(recipe.skill_xp)} · 产出 ${formatCount(recipe.result_quantity)}`}
      />
      <div className="content-detail__section">
        <h4>材料</h4>
        {recipe.ingredients.map((ingredient) => (
          <article key={ingredient.item_id} className="content-stack">
            <strong title={ingredient.item_id}>{describeItemId(ingredient.item_id)}</strong>
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
          <strong title={recipe.result_item.item_id}>{describeItemId(recipe.result_item.item_id)}</strong>
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
          加入当前草稿
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
          <h3 className="content-detail__title" title={item.asset_id}>{describeItemId(item.asset_id)}</h3>
          <p className="content-detail__copy">{item.category ?? '未分类'}</p>
        </div>
      </div>
      <NormalStateScreen
        title={item.asset_id}
        description={summarizeInventoryAsset(item)}
        highlight={item.asset_type}
        footnote="只展示数量、预留、可用、来源和用途，不包含价格或交易。"
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
  const [activeTab, setActiveTab] = useState<ContentTab>(tabParam === 'recipes' ? 'recipes' : 'actions');

  useEffect(() => {
    if (tabParam === 'recipes' || tabParam === 'actions') {
      setActiveTab(tabParam);
    }
  }, [tabParam]);

  const selectedActionId = params.get('action_id');
  const selectedRecipeId = params.get('recipe_id');

  const selectedAction = useMemo(
    () => actionsQuery.data?.actions.find((entry) => entry.action_id === selectedActionId) ?? actionsQuery.data?.actions[0] ?? null,
    [actionsQuery.data?.actions, selectedActionId],
  );
  const selectedRecipe = useMemo(
    () => recipesQuery.data?.recipes.find((entry) => entry.recipe_id === selectedRecipeId) ?? recipesQuery.data?.recipes[0] ?? null,
    [recipesQuery.data?.recipes, selectedRecipeId],
  );

  const progressionData = progressionQuery.data;
  const actionsData = actionsQuery.data;
  const recipesData = recipesQuery.data;
  const queueData = queueQuery.data;
  const bestBySkill = useMemo(() => selectBestAction(actionsQuery.data?.actions ?? []), [actionsQuery.data?.actions]);

  const handleSelectRoute = (route: ContentRoute) => {
    syncSearch(navigate, location.pathname, location.search, route.route_type === 'ACTION' ? { tab: 'actions', action_id: route.target_id, recipe_id: null } : { tab: 'recipes', recipe_id: route.target_id, action_id: null });
  };
  const handleOpenInventoryItem = (itemId: string) => {
    syncSearch(navigate, '/inventory', '', { item_id: itemId, tab: null, action_id: null, recipe_id: null });
  };
  const handleTabKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') {
      return;
    }

    event.preventDefault();
    const nextTab = nextContentTab(activeTab, event.key === 'ArrowRight' ? 1 : -1);
    setActiveTab(nextTab);
    syncSearch(navigate, location.pathname, location.search, {
      tab: nextTab,
      action_id: nextTab === 'actions' ? selectedAction?.action_id ?? null : null,
      recipe_id: nextTab === 'recipes' ? selectedRecipe?.recipe_id ?? null : null,
    });
  };

  const retryAll = () => {
    void Promise.all([
      progressionQuery.refetch(),
      actionsQuery.refetch(),
      recipesQuery.refetch(),
      queueQuery.refetch(),
    ]);
  };

  if (progressionQuery.isPending || actionsQuery.isPending || recipesQuery.isPending || queueQuery.isPending) {
    return <ContentLoading title="正在读取百艺内容" description="先读取修为、动作、配方和库存，再渲染行动与配方页面。" />;
  }

  const firstError = progressionQuery.error ?? actionsQuery.error ?? recipesQuery.error ?? queueQuery.error;
  if (firstError !== undefined && firstError !== null) {
    if (firstError instanceof ApiClientError && firstError.status === 503) {
      return <ContentMaintenance title="百艺维护中" reason={firstError.message} onRetry={retryAll} />;
    }

    return <ContentError title="百艺读取失败" error={firstError.message} onRetry={retryAll} />;
  }

  if (progressionData === undefined || actionsData === undefined || recipesData === undefined || queueData === undefined) {
    return <ContentLoading title="正在读取百艺内容" description="先读取修为、动作、配方和库存，再渲染行动与配方页面。" />;
  }

  const actionCount = actionsData.actions.length;
  const recipeCount = recipesData.recipes.length;
  const unlockedActionCount = actionsData.actions.filter((entry) => entry.unlocked).length;

  return (
    <section className="content-layout content-screen">
      <div className="content-panel content-panel--hero">
        <div className="content-hero">
          <div>
            <p className="page-card__eyebrow">百艺</p>
            <h3 className="page-card__title">修行技能</h3>
            <p className="page-card__copy">选择一项技能查看详情，加入挂机后会自动持续修行。</p>
          </div>
          <div className="dashboard-metrics">
            <div className="metric-chip">
              <span className="metric-chip__label">修行项目</span>
              <strong className="metric-chip__value" title={formatCount(actionCount)}>
                {formatCount(actionCount)}
              </strong>
            </div>
            <div className="metric-chip">
              <span className="metric-chip__label">已掌握</span>
              <strong className="metric-chip__value" title={formatCount(unlockedActionCount)}>
                {formatCount(unlockedActionCount)}
              </strong>
            </div>
            <div className="metric-chip">
              <span className="metric-chip__label">可用配方</span>
              <strong className="metric-chip__value" title={formatCount(recipeCount)}>
                {formatCount(recipeCount)}
              </strong>
            </div>
            <div className="metric-chip">
              <span className="metric-chip__label">当前境界</span>
              <strong className="metric-chip__value">
                {progressionData.cultivation.realm_stage_id === 'realm.mortal.entry' ? '炼气入门' : progressionData.cultivation.realm_stage_id.replace('realm.', '')}
              </strong>
            </div>
          </div>
          <div className="content-hero__skills">
            {progressionData.skills.map((skill) => (
              <div key={skill.skill_id} className="content-hero__skill">
                <strong title={skill.skill_id}>{describeSkillId(skill.skill_id)}</strong>
                <span>
                  等级 {skill.level} · XP {formatCount(skill.xp)}
                </span>
                <span>
                  最佳行动：{bestBySkill.get(skill.skill_id) === undefined ? '暂无' : describeActionId(bestBySkill.get(skill.skill_id)?.action_id)}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="content-panel">
        <div className="content-tabs" role="tablist" aria-label="百艺分类" onKeyDown={handleTabKeyDown}>
          <button
            id="content-tab-actions"
            className={`chip-button ${activeTab === 'actions' ? 'chip-button--active' : ''}`}
            type="button"
            role="tab"
            aria-selected={activeTab === 'actions'}
            aria-controls="content-panel-actions"
            tabIndex={activeTab === 'actions' ? 0 : -1}
            onClick={() => setActiveTab('actions')}
          >
            技能
          </button>
          <button
            id="content-tab-recipes"
            className={`chip-button ${activeTab === 'recipes' ? 'chip-button--active' : ''}`}
            type="button"
            role="tab"
            aria-selected={activeTab === 'recipes'}
            aria-controls="content-panel-recipes"
            tabIndex={activeTab === 'recipes' ? 0 : -1}
            onClick={() => setActiveTab('recipes')}
          >
            炼丹
          </button>
        </div>
        <div className="content-list">
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

      <div className="content-panel">
        {activeTab === 'actions' ? (
          selectedAction ? (
            selectedAction.unlocked ? (
              <ActionDetail
                action={selectedAction}
                queue={queueData}
                onJoinQueue={() => navigate(joinQueuePath(selectedAction.queue_action_id))}
                onOpenInventoryItem={handleOpenInventoryItem}
                onSelectRoute={handleSelectRoute}
              />
            ) : (
              <LockedStateScreen title={describeActionId(selectedAction.action_id)} description={describeUnlockReason(selectedAction.unlock_state.reason)} />
            )
          ) : (
            <EmptyStateScreen title="未选中行动" description="从左侧选择一个行动查看输入、输出和加入队列入口。" />
          )
        ) : selectedRecipe ? (
          selectedRecipe.unlocked ? (
            <RecipeDetail
              recipe={selectedRecipe}
              queue={queueData}
              onJoinQueue={() => navigate(joinQueuePath(selectedRecipe.queue_action_id))}
              onOpenInventoryItem={handleOpenInventoryItem}
              onSelectRoute={handleSelectRoute}
            />
          ) : (
              <LockedStateScreen title={describeRecipeId(selectedRecipe.recipe_id)} description={describeUnlockReason(selectedRecipe.unlock_state.reason)} />
          )
        ) : (
          <EmptyStateScreen title="未选中配方" description="从左侧选择一个配方查看材料、产物和加入队列入口。" />
        )}
      </div>
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
  const selectedItem = useMemo(() => inventoryData?.items.find((item) => item.asset_id === selectedItemId) ?? inventoryData?.items[0] ?? null, [inventoryData?.items, selectedItemId]);

  const retryInventory = () => {
    void Promise.all([progressionQuery.refetch(), inventoryQuery.refetch()]);
  };

  if (progressionQuery.isPending || inventoryQuery.isPending) {
    return <ContentLoading title="正在读取背包" description="先读取库存与角色概况，再渲染背包、来源和用途。" />;
  }

  const firstError = progressionQuery.error ?? inventoryQuery.error;
  if (firstError !== undefined && firstError !== null) {
    if (firstError instanceof ApiClientError && firstError.status === 503) {
      return <ContentMaintenance title="背包维护中" reason={firstError.message} onRetry={retryInventory} />;
    }

    return <ContentError title="背包读取失败" error={firstError.message} onRetry={retryInventory} />;
  }

  if (progressionData === undefined || inventoryData === undefined) {
    return <ContentLoading title="正在读取背包" description="先读取库存与角色概况，再渲染背包、来源和用途。" />;
  }

  const itemCount = inventoryData.items.length;
  const currencyCount = inventoryData.currencies.length;
  const equipmentCount = inventoryData.equipment_instances.length;

  return (
    <section className="content-layout">
      <div className="content-panel content-panel--hero">
        <div className="content-hero">
          <div>
            <p className="page-card__eyebrow">背包</p>
            <h3 className="page-card__title">洞天储藏</h3>
            <p className="page-card__copy">收集到的灵石、材料、丹药和装备都会存放在这里。</p>
          </div>
          <div className="dashboard-metrics">
            <div className="metric-chip">
              <span className="metric-chip__label">物品</span>
              <strong className="metric-chip__value" title={formatCount(itemCount)}>
                {formatCount(itemCount)}
              </strong>
            </div>
            <div className="metric-chip">
              <span className="metric-chip__label">货币</span>
              <strong className="metric-chip__value" title={formatCount(currencyCount)}>
                {formatCount(currencyCount)}
              </strong>
            </div>
            <div className="metric-chip">
              <span className="metric-chip__label">装备</span>
              <strong className="metric-chip__value" title={formatCount(equipmentCount)}>
                {formatCount(equipmentCount)}
              </strong>
            </div>
            <div className="metric-chip">
              <span className="metric-chip__label">总数</span>
            <strong className="metric-chip__value" title={`总数 ${String(inventoryData.total_count)}`}>
              {String(inventoryData.total_count)}
            </strong>
            </div>
          </div>
        </div>
      </div>

      <div className="content-panel">
        <div className="content-list">
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

      <div className="content-panel">
        {selectedItem ? (
          <InventoryDetail item={selectedItem} onSelectRoute={(route) => syncSearch(navigate, '/craft', '', route.route_type === 'ACTION' ? { tab: 'actions', action_id: route.target_id, recipe_id: null } : { tab: 'recipes', recipe_id: route.target_id, action_id: null })} />
        ) : (
          <EmptyStateScreen title="未选中物品" description="选择一个库存条目查看来源和用途。" />
        )}
      </div>
    </section>
  );
}
