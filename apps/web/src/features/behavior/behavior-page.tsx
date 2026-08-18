import { useCallback, useMemo, useState, type ReactElement } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useOutletContext } from 'react-router';
import { ApiClientError, type ActionCatalogEntry, type AuthActiveSession, type CharacterProgression, type ContentActionsResponse, type ContentRecipesResponse, type Queue, type RecipeCatalogEntry } from '@dongtian/contracts';
import { EmptyStateScreen, LocalErrorStateScreen, LoadingStateScreen } from '@dongtian/ui';

import { apiClient } from '../../lib/api.js';
import { emitGameFeedback } from '../../lib/game-feedback.js';
import { describeRealmId, describeUnlockReason, formatCount, formatDurationUs } from '../content/content-adapter.js';
import {
  describeBehaviorAction,
  describeBehaviorItem,
  findRecipeAction,
  findBehaviorActions,
  filterBehaviorRecipes,
  getHerbalismRegions,
  getMiningRegions,
  groupBehaviorRecipes,
  isBehaviorActionAvailable,
  startBehaviorAction,
  startBehaviorRecipe,
  isBehaviorRecipeAvailable,
  type BehaviorGroup,
  type BehaviorKind,
  type BehaviorQueueClient,
  type BehaviorRegion,
  type StartBehaviorActionOptions,
} from './behavior-adapter.js';

export interface BehaviorPageDefinition {
  readonly kind: BehaviorKind;
  readonly title: string;
  readonly eyebrow: string;
  readonly description: string;
  readonly mode: 'regions' | 'groups';
  readonly actionTag: string;
  readonly regions?: ReadonlyArray<BehaviorRegion>;
  readonly startLabel: string;
  readonly loadingTitle: string;
  readonly loadingDescription: string;
  readonly errorTitle: string;
  readonly emptyTitle: string;
}

export const HERBALISM_PAGE_DEFINITION: BehaviorPageDefinition = {
  kind: 'herbalism', title: '采药', eyebrow: '百艺 · 采集', description: '先选择地图区域，再点击对应草药开始无限挂机；进度会显示在顶部行为栏。', mode: 'regions', actionTag: 'herb', regions: getHerbalismRegions(), startLabel: '开始采集', loadingTitle: '正在读取采药地图', loadingDescription: '正在整理区域和可执行的采药行动。', errorTitle: '采药内容读取失败', emptyTitle: '暂无可执行采药区域',
};

export const MINING_PAGE_DEFINITION: BehaviorPageDefinition = {
  kind: 'mining', title: '挖矿', eyebrow: '百艺 · 采集', description: '先选择地图区域，再点击对应矿石开始无限挂机；进度会显示在顶部行为栏。', mode: 'regions', actionTag: 'ore', regions: getMiningRegions(), startLabel: '开始采矿', loadingTitle: '正在读取采矿地图', loadingDescription: '正在整理区域和可执行的采矿行动。', errorTitle: '采矿内容读取失败', emptyTitle: '暂无可执行采矿区域',
};

export const ALCHEMY_PAGE_DEFINITION: BehaviorPageDefinition = {
  kind: 'alchemy', title: '炼丹', eyebrow: '百艺 · 炼丹', description: '按配方用途查看输入材料与产出，选择配方后开始无限挂机。', mode: 'groups', actionTag: 'alchemy', startLabel: '开始炼丹', loadingTitle: '正在读取炼丹配方', loadingDescription: '正在整理已配置的炼丹行动。', errorTitle: '炼丹内容读取失败', emptyTitle: '暂无可执行炼丹配方',
};

export const FORGING_PAGE_DEFINITION: BehaviorPageDefinition = {
  kind: 'forging', title: '炼器', eyebrow: '百艺 · 炼器', description: '按工具、武器和防具分类查看配方，选择配方后开始无限挂机。', mode: 'groups', actionTag: 'forging', startLabel: '开始炼器', loadingTitle: '正在读取炼器配方', loadingDescription: '正在整理已配置的炼器行动。', errorTitle: '炼器内容读取失败', emptyTitle: '暂无可执行炼器配方',
};

export function BehaviorLoading({ definition }: { readonly definition: BehaviorPageDefinition }): ReactElement {
  return <LoadingStateScreen title={definition.loadingTitle} description={definition.loadingDescription} />;
}

export function BehaviorError({ definition, onRetry }: { readonly definition: BehaviorPageDefinition; readonly onRetry: () => void | Promise<unknown> }): ReactElement {
  return <LocalErrorStateScreen title={definition.errorTitle} description="区域或行动目录暂时无法读取。" actions={[{ label: '重试', onClick: onRetry }]} />;
}

export function BehaviorEmpty({ definition }: { readonly definition: BehaviorPageDefinition }): ReactElement {
  return <EmptyStateScreen title={definition.emptyTitle} description="行动目录中还没有匹配当前百艺页面的内容。" />;
}

export function BehaviorUnavailable({ title = '当前没有可用的行动' }: { readonly title?: string }): ReactElement {
  return <EmptyStateScreen title={title} description="该区域或分类暂未配置可执行的行动，请选择其他内容。" />;
}

export function isActionAvailable(action: ActionCatalogEntry): boolean {
  return isBehaviorActionAvailable(action);
}

function BehaviorActionCard({ action, definition, region, starting, onStart }: { readonly action: ActionCatalogEntry; readonly definition: BehaviorPageDefinition; readonly region?: BehaviorRegion; readonly starting: boolean; readonly onStart: (action: ActionCatalogEntry) => void }): ReactElement {
  const available = isBehaviorActionAvailable(action);
  const modeUnavailable = action.unlocked && !action.allowed_queue_modes.includes('INFINITE') ? '当前行动不支持无限挂机' : null;
  const outputs = region === undefined ? action.outputs : action.outputs.filter((output) => region.resourceItemIds.includes(output.item_id));
  const visibleOutputs = outputs.length > 0 ? outputs : action.outputs;
  const unlockCopy = describeUnlockReason(action.unlock_state.reason, action.unlock_state.blockers);
  return (
    <article
      className={`behavior-resource ${available ? 'behavior-resource--clickable' : 'behavior-resource--locked'} ${starting ? 'behavior-resource--starting' : ''}`}
      role="button"
      tabIndex={available && !starting ? 0 : -1}
      aria-disabled={!available || starting}
      aria-label={`${describeBehaviorAction(action.action_id)}，${starting ? '正在开始' : definition.startLabel}`}
      onClick={() => { if (available && !starting) onStart(action); }}
      onKeyDown={(event) => { if ((event.key === 'Enter' || event.key === ' ') && available && !starting) { event.preventDefault(); onStart(action); } }}
    >
      <div className="behavior-resource__header">
        <div><p className="page-card__eyebrow">{definition.title}行动</p><h4>{describeBehaviorAction(action.action_id)}</h4></div>
        <span className="behavior-resource__status">{available ? '可执行' : action.unlocked ? '暂不可用' : '已锁定'}</span>
      </div>
      {action.inputs.length > 0 ? <div className="behavior-resource__materials"><span>输入</span>{action.inputs.map((input) => <strong key={input.item_id}>{describeBehaviorItem(input.item_id)} × {formatCount(input.quantity)}</strong>)}</div> : null}
      <div className="behavior-resource__outputs"><span>产出</span>{visibleOutputs.length === 0 ? <strong>暂无产出</strong> : visibleOutputs.map((output) => <strong key={output.item_id}>{describeBehaviorItem(output.item_id)} × {formatCount(output.quantity)}</strong>)}</div>
      <div className="behavior-resource__facts"><span>每轮 {formatDurationUs(action.base_duration_us)}</span><span>技能经验 {formatCount(action.skill_xp)}</span></div>
      {!available ? <p className="behavior-resource__lock-copy">{modeUnavailable ?? unlockCopy}</p> : null}
      {available ? <span className="behavior-resource__start" aria-hidden="true">{starting ? '正在开始…' : `点击${definition.startLabel}`}</span> : null}
    </article>
  );
}

function BehaviorRecipeCard({ recipe, action, definition, starting, onStart }: { readonly recipe: RecipeCatalogEntry; readonly action: ActionCatalogEntry | null; readonly definition: BehaviorPageDefinition; readonly starting: boolean; readonly onStart: (recipe: RecipeCatalogEntry, action: ActionCatalogEntry | null) => void }): ReactElement {
  const available = isBehaviorRecipeAvailable(recipe, action);
  const modeUnavailable = recipe.unlocked && (action === null || !action.allowed_queue_modes.includes('INFINITE')) ? '当前配方不支持无限挂机' : null;
  const unlockCopy = describeUnlockReason(recipe.unlock_state.reason, recipe.unlock_state.blockers);
  return (
    <article
      className={`behavior-resource ${available ? 'behavior-resource--clickable' : 'behavior-resource--locked'} ${starting ? 'behavior-resource--starting' : ''}`}
      role="button"
      tabIndex={available && !starting ? 0 : -1}
      aria-disabled={!available || starting}
      aria-label={`${describeBehaviorItem(recipe.result_item.item_id)}，${starting ? '正在开始' : definition.startLabel}`}
      onClick={() => { if (available && action !== null && !starting) onStart(recipe, action); }}
      onKeyDown={(event) => { if ((event.key === 'Enter' || event.key === ' ') && available && action !== null && !starting) { event.preventDefault(); onStart(recipe, action); } }}
    >
      <div className="behavior-resource__header">
        <div><p className="page-card__eyebrow">{definition.title}配方</p><h4>{describeBehaviorItem(recipe.result_item.item_id)}</h4></div>
        <span className="behavior-resource__status">{available ? '可执行' : recipe.unlocked ? '暂不可用' : '已锁定'}</span>
      </div>
      <div className="behavior-resource__materials"><span>输入</span>{recipe.ingredients.length === 0 ? <strong>无需材料</strong> : recipe.ingredients.map((input) => <strong key={input.item_id}>{describeBehaviorItem(input.item_id)} × {formatCount(input.quantity)}</strong>)}</div>
      <div className="behavior-resource__outputs"><span>产出</span><strong>{describeBehaviorItem(recipe.result_item.item_id)} × {formatCount(recipe.result_item.quantity)}</strong></div>
      <div className="behavior-resource__facts"><span>每轮 {formatDurationUs(recipe.base_duration_us)}</span><span>技能经验 {formatCount(recipe.skill_xp)}</span></div>
      {!available ? <p className="behavior-resource__lock-copy">{modeUnavailable ?? unlockCopy}</p> : null}
      {available ? <span className="behavior-resource__start" aria-hidden="true">{starting ? '正在开始…' : `点击${definition.startLabel}`}</span> : null}
    </article>
  );
}

function RegionButton({ region, actions, definition, selected, onSelect }: { readonly region: BehaviorRegion; readonly actions: ReadonlyArray<ActionCatalogEntry>; readonly definition: BehaviorPageDefinition; readonly selected: boolean; readonly onSelect: () => void }): ReactElement {
  const regionActions = findBehaviorActions(region, actions, definition.actionTag);
  const locked = regionActions.length > 0 && regionActions.every((action) => !isBehaviorActionAvailable(action));
  const unavailable = regionActions.length === 0;
  return <button className={`behavior-region ${selected ? 'behavior-region--selected' : ''} ${locked ? 'behavior-region--locked' : ''}`} type="button" aria-pressed={selected} onClick={onSelect}><span className="behavior-region__header"><strong>{region.label}</strong><small>{unavailable ? '暂无可执行行动' : locked ? '已锁定' : region.stageLabel}</small></span><span className="behavior-region__description">{region.description}</span></button>;
}

function useBehaviorQueries(characterId: string, needsRecipes: boolean) {
  const progressionQuery = useQuery<CharacterProgression>({ queryKey: ['behavior', characterId, 'progression'], queryFn: () => apiClient.getProgression(characterId) });
  const actionsQuery = useQuery<ContentActionsResponse>({ queryKey: ['behavior', characterId, 'actions'], queryFn: () => apiClient.getActions() });
  const recipesQuery = useQuery<ContentRecipesResponse>({ queryKey: ['behavior', characterId, 'recipes'], queryFn: () => apiClient.getRecipes(), enabled: needsRecipes });
  const queueQuery = useQuery<Queue>({ queryKey: ['behavior', characterId, 'queue'], queryFn: () => apiClient.getQueue(characterId) });
  return { progressionQuery, actionsQuery, recipesQuery, queueQuery };
}

export function BehaviorPage({ definition }: { readonly definition: BehaviorPageDefinition }): ReactElement {
  const session = useOutletContext<AuthActiveSession>();
  const queryClient = useQueryClient();
  const { progressionQuery, actionsQuery, recipesQuery, queueQuery } = useBehaviorQueries(session.character_id, definition.mode === 'groups');
  const [selectedId, setSelectedId] = useState<string | null>(definition.mode === 'regions' ? (definition.kind === 'mining' ? 'region.t1.mist_slope' : definition.regions?.[0]?.id ?? null) : null);
  const [startingActionId, setStartingActionId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const actions = actionsQuery.data?.actions ?? [];
  const recipes = recipesQuery.data?.recipes ?? [];
  const regions = definition.regions ?? [];
  const groups = useMemo<ReadonlyArray<BehaviorGroup>>(() => definition.mode === 'groups' ? groupBehaviorRecipes(recipes, definition.kind as 'alchemy' | 'forging') : [], [definition.kind, definition.mode, recipes]);
  const selectedRegion = regions.find((region) => region.id === selectedId) ?? regions[0] ?? null;
  const selectedGroup = groups.find((group) => group.id === selectedId) ?? groups[0] ?? null;
  const selectedActions = definition.mode === 'regions' && selectedRegion !== null ? findBehaviorActions(selectedRegion, actions, definition.actionTag) : [];
  const selectedRecipes = selectedGroup?.recipes ?? [];
  const firstError = progressionQuery.error ?? actionsQuery.error ?? (definition.mode === 'groups' ? recipesQuery.error : null) ?? queueQuery.error;

  const startAction = useCallback(async (action: ActionCatalogEntry): Promise<void> => {
    if (queueQuery.data === undefined || startingActionId !== null) return;
    setStartingActionId(action.action_id);
    setFeedback(null);
    try {
      const startOptions: StartBehaviorActionOptions = { characterId: session.character_id, queue: queueQuery.data, client: apiClient as BehaviorQueueClient, behaviorKind: definition.kind, invalidate: (queryKey) => queryClient.invalidateQueries({ queryKey }), emitFeedback: (message) => { setFeedback(message); emitGameFeedback(message, 'success'); } };
      await startBehaviorAction(action, startOptions);
    } catch (error) {
      const message = error instanceof ApiClientError && error.status === 409 ? '挂机计划刚刚发生变化，请稍后再试。' : `${definition.title}行为暂时无法开始，请稍后重试。`;
      setFeedback(message);
      emitGameFeedback(message, 'warning');
    } finally {
      setStartingActionId(null);
    }
  }, [definition.kind, definition.title, queryClient, queueQuery.data, session.character_id, startingActionId]);

  const startRecipe = useCallback(async (recipe: RecipeCatalogEntry, action: ActionCatalogEntry | null): Promise<void> => {
    if (queueQuery.data === undefined || startingActionId !== null || action === null) return;
    setStartingActionId(recipe.recipe_id);
    setFeedback(null);
    try {
      await startBehaviorRecipe(recipe, action, { characterId: session.character_id, queue: queueQuery.data, client: apiClient as BehaviorQueueClient, behaviorKind: definition.kind, invalidate: (queryKey) => queryClient.invalidateQueries({ queryKey }), emitFeedback: (message) => { setFeedback(message); emitGameFeedback(message, 'success'); } });
    } catch (error) {
      const message = error instanceof ApiClientError && error.status === 409 ? '挂机计划刚刚发生变化，请稍后再试。' : `${definition.title}配方暂时无法开始，请稍后重试。`;
      setFeedback(message);
      emitGameFeedback(message, 'warning');
    } finally {
      setStartingActionId(null);
    }
  }, [definition.kind, definition.title, queryClient, queueQuery.data, session.character_id, startingActionId]);

  if (progressionQuery.isPending || actionsQuery.isPending || (definition.mode === 'groups' && recipesQuery.isPending) || queueQuery.isPending) return <BehaviorLoading definition={definition} />;
  if (firstError !== null && firstError !== undefined) return <BehaviorError definition={definition} onRetry={() => queryClient.invalidateQueries({ queryKey: ['behavior', session.character_id] })} />;
  if (actionsQuery.data === undefined || queueQuery.data === undefined || (definition.mode === 'groups' && recipesQuery.data === undefined)) return <BehaviorLoading definition={definition} />;
  if (definition.mode === 'groups' && filterBehaviorRecipes(recipes, definition.kind as 'alchemy' | 'forging').length === 0) return <BehaviorEmpty definition={definition} />;

  return <section className="behavior-layout" aria-label={`${definition.title}行为`}>
    <header className="behavior-panel behavior-panel--hero"><div><p className="page-card__eyebrow">{definition.eyebrow}</p><h3 className="page-card__title">{definition.title}</h3><p className="page-card__copy">{definition.description}</p></div><span className="behavior-panel__realm">当前境界 · {describeRealmId(progressionQuery.data?.cultivation.realm_stage_id)}</span></header>
    {definition.mode === 'regions' ? <div className="behavior-panel behavior-panel--regions"><div className="behavior-panel__heading"><h4>地图区域</h4><span>{regions.length} 个区域</span></div><div className="behavior-region-list">{regions.map((region) => <RegionButton key={region.id} region={region} actions={actions} definition={definition} selected={region.id === selectedRegion?.id} onSelect={() => setSelectedId(region.id)} />)}</div></div> : <div className="behavior-panel behavior-panel--regions"><div className="behavior-panel__heading"><h4>配方分类</h4><span>{groups.length} 个分类</span></div><div className="behavior-region-list">{groups.map((group) => <button className={`behavior-region ${group.id === selectedGroup?.id ? 'behavior-region--selected' : ''}`} type="button" aria-pressed={group.id === selectedGroup?.id} key={group.id} onClick={() => setSelectedId(group.id)}><span className="behavior-region__header"><strong>{group.label}</strong><small>{group.recipes.length} 个配方</small></span><span className="behavior-region__description">{group.description}</span></button>)}</div></div>}
    <div className="behavior-panel behavior-panel--resources">{definition.mode === 'regions' ? selectedRegion === null ? <BehaviorUnavailable title={`当前没有可用的${definition.title}行动`} /> : <><div className="behavior-panel__heading"><div><h4>{selectedRegion.label}</h4><p>{selectedRegion.description}</p></div><span>{selectedRegion.stageLabel}</span></div>{selectedActions.length === 0 ? <BehaviorUnavailable title={`当前没有可用的${definition.title}行动`} /> : <div className="behavior-resource-list">{selectedActions.map((action) => <BehaviorActionCard key={action.action_id} action={action} region={selectedRegion} definition={definition} starting={startingActionId === action.action_id} onStart={(nextAction) => { void startAction(nextAction); }} />)}</div>}</> : selectedGroup === null ? <BehaviorUnavailable title={`当前没有可用的${definition.title}配方`} /> : <><div className="behavior-panel__heading"><div><h4>{selectedGroup.label}</h4><p>{selectedGroup.description}</p></div><span>{selectedRecipes.length} 个配方</span></div><div className="behavior-resource-list">{selectedRecipes.map((recipe) => <BehaviorRecipeCard key={recipe.recipe_id} recipe={recipe} action={findRecipeAction(recipe, actions)} definition={definition} starting={startingActionId === recipe.recipe_id} onStart={(nextRecipe, nextAction) => { void startRecipe(nextRecipe, nextAction); }} />)}</div></>}{feedback !== null ? <p className="behavior-feedback" role="status">{feedback}</p> : null}</div>
  </section>;
}
