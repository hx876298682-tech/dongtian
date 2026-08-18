import { ApiClientError, type ActionCatalogEntry, type Queue, type QueueMutation, type RecipeCatalogEntry } from '@dongtian/contracts';

import { describeActionId, describeItemId, describeRecipeId } from '../content/content-adapter.js';
import { createQueueEditorDraft, createQueueEditorEntryDraft, createQueuePlanRequest } from '../dashboard/queue-editor.js';

export interface BehaviorRegion {
  readonly id: string;
  readonly label: string;
  readonly description: string;
  readonly stageLabel: string;
  readonly actionIds: ReadonlyArray<string>;
  readonly resourceItemIds: ReadonlyArray<string>;
  readonly regionKind: string;
}

export type HerbalismRegion = BehaviorRegion;

const REGIONS: ReadonlyArray<BehaviorRegion> = [
  { id: 'region.t1.qingyun_foothill', label: '百草谷', description: '青云山脚的基础区域，适合积累第一批修行材料。', stageLabel: '凡人', actionIds: ['action.t1.herb_baicao_valley', 'action.cultivation.qi'], resourceItemIds: ['item.t1.qingling_herb', 'item.t1.qingshe_dan', 'item.t1.qingyu_pei'], regionKind: 'FOOTHILL' },
  { id: 'region.t1.mist_slope', label: '雾隐坡', description: '雾气常年不散，灵材随灵气在坡地生长。', stageLabel: '炼气初期', actionIds: ['action.t1.herb_wuyin_slope', 'action.t1.ore_chitong_kuang'], resourceItemIds: ['item.t1.ninglu_hua', 'item.t1.ziye_lan', 'item.t1.chitong_kuang', 'item.t1.xuantie_kuang'], regionKind: 'SLOPE' },
  { id: 'region.t1.spirit_spring', label: '灵泉谷', description: '灵泉滋养的幽谷，能够采得更高阶的材料。', stageLabel: '炼气中期', actionIds: ['action.t1.herb_lingquan_valley'], resourceItemIds: ['item.t1.ziye_lan', 'item.t1.dimai_can', 'item.t2.lingsui'], regionKind: 'SPRING' },
  { id: 'region.t1.blackstone_pass', label: '黑石关', description: '矿脉交错的险关，蕴藏着坚硬的矿材。', stageLabel: '炼气中期', actionIds: ['action.t1.ore_xuantie_kuang'], resourceItemIds: ['item.t1.xuantie_kuang', 'item.t1.shijia', 'item.t1.yaolang_ya', 'item.t1.yaodan'], regionKind: 'PASS' },
  { id: 'region.t2.starfall_mine', label: '星陨矿', description: '陨铁汇聚的深矿，只有高阶矿材行动。', stageLabel: '炼气后期', actionIds: ['action.t1.ore_xingwen_gang'], resourceItemIds: ['item.t1.xingwen_gang', 'item.t1.lingyu_kuang', 'item.t1.heifeng_jing'], regionKind: 'MINE' },
  { id: 'region.t2.blackwind_valley', label: '黑风谷', description: '黑风谷深处的资源区，采集行动在此并行。', stageLabel: '炼气大圆满 / 筑基', actionIds: ['action.t1.herb_zhuji_garden', 'action.t1.ore_lingyu_kuang'], resourceItemIds: ['item.t1.dimai_can', 'item.t1.lingyu_kuang', 'item.t1.heifeng_jing'], regionKind: 'VALLEY' },
] as const;

const HERBALISM_ACTION_LABELS: Readonly<Record<string, string>> = {
  'action.t1.herb_baicao_valley': '百草谷采药',
  'action.t1.herb_wuyin_slope': '雾隐坡采药',
  'action.t1.herb_lingquan_valley': '灵泉谷采药',
  'action.t1.herb_zhuji_garden': '筑基药园采药',
};

export const HERBALISM_REGIONS: ReadonlyArray<HerbalismRegion> = REGIONS;
export const MINING_REGIONS: ReadonlyArray<BehaviorRegion> = REGIONS;

export function getHerbalismRegions(): ReadonlyArray<HerbalismRegion> { return HERBALISM_REGIONS; }
export function getMiningRegions(): ReadonlyArray<BehaviorRegion> { return MINING_REGIONS; }
export function describeHerbalismItem(itemId: string | null | undefined): string { return describeItemId(itemId); }
export function describeHerbalismAction(actionId: string | null | undefined): string { return actionId === null || actionId === undefined ? '未知行动' : HERBALISM_ACTION_LABELS[actionId] ?? describeActionId(actionId); }

export function findBehaviorActions(region: BehaviorRegion, actions: ReadonlyArray<ActionCatalogEntry>, actionTag: string): ReadonlyArray<ActionCatalogEntry> {
  return region.actionIds.map((id) => actions.find((action) => action.action_id === id && action.tags.includes(actionTag))).filter((action): action is ActionCatalogEntry => action !== undefined);
}
export function findHerbalismActions(region: HerbalismRegion, actions: ReadonlyArray<ActionCatalogEntry>): ReadonlyArray<ActionCatalogEntry> { return findBehaviorActions(region, actions, 'herb'); }
export function findHerbalismAction(region: HerbalismRegion, actions: ReadonlyArray<ActionCatalogEntry>): ActionCatalogEntry | null { return findHerbalismActions(region, actions)[0] ?? null; }

export type BehaviorKind = 'herbalism' | 'mining' | 'alchemy' | 'forging' | 'cultivation';
export interface BehaviorGroup { readonly id: string; readonly label: string; readonly description: string; readonly recipes: ReadonlyArray<RecipeCatalogEntry>; }

const GROUP_LABELS: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  alchemy: { cultivation: '基础丹药', combat: '战斗 / 恢复丹药', breakthrough: '突破丹药' },
  forging: { tool: '工具', weapon: '武器', armor: '防具' },
};

export function filterBehaviorActions(actions: ReadonlyArray<ActionCatalogEntry>, kind: BehaviorKind): ReadonlyArray<ActionCatalogEntry> {
  const tag = kind === 'herbalism' ? 'herb' : kind === 'mining' ? 'ore' : kind;
  return actions.filter((action) => action.tags.includes(tag) || action.skill_id === `skill.${kind}`);
}

export function filterBehaviorRecipes(recipes: ReadonlyArray<RecipeCatalogEntry>, kind: 'alchemy' | 'forging'): ReadonlyArray<RecipeCatalogEntry> {
  const skillId = `skill.${kind}`;
  return recipes.filter((recipe) => recipe.craft_skill_id === skillId || recipe.tags.includes(kind));
}

export function groupBehaviorRecipes(recipes: ReadonlyArray<RecipeCatalogEntry>, kind: 'alchemy' | 'forging'): ReadonlyArray<BehaviorGroup> {
  const grouped = new Map<string, RecipeCatalogEntry[]>();
  for (const recipe of filterBehaviorRecipes(recipes, kind)) {
    const category = kind === 'alchemy'
      ? (recipe.tags.includes('breakthrough') ? 'breakthrough' : recipe.tags.includes('combat') ? 'combat' : 'cultivation')
      : (recipe.tags.includes('weapon') ? 'weapon' : recipe.tags.includes('armor') ? 'armor' : 'tool');
    const entries = grouped.get(category) ?? [];
    entries.push(recipe);
    grouped.set(category, entries);
  }
  const order = kind === 'alchemy' ? ['cultivation', 'breakthrough', 'combat'] : ['tool', 'weapon', 'armor'];
  return order.filter((id) => grouped.has(id)).map((id) => ({ id, label: GROUP_LABELS[kind]?.[id] ?? id, description: kind === 'alchemy' ? '按配方所需的修行用途分类。' : '按炼器产出的装备类型分类。', recipes: grouped.get(id) ?? [] }));
}

export function findRecipeAction(recipe: RecipeCatalogEntry, actions: ReadonlyArray<ActionCatalogEntry>): ActionCatalogEntry | null {
  return actions.find((action) => action.action_id === recipe.action_id || action.queue_action_id === recipe.queue_action_id) ?? null;
}

export function isBehaviorRecipeAvailable(recipe: RecipeCatalogEntry, action: ActionCatalogEntry | null): boolean {
  return recipe.enabled && recipe.unlocked && recipe.can_add_to_queue && action !== null && action.allowed_queue_modes.includes('INFINITE');
}

export function isBehaviorActionAvailable(action: ActionCatalogEntry): boolean {
  return action.enabled && action.unlocked && action.can_add_to_queue && action.allowed_queue_modes.includes('INFINITE');
}

export interface BehaviorQueueClient {
  readonly getQueue: (characterId: string) => Promise<Queue>;
  readonly saveQueue: (characterId: string, request: ReturnType<typeof createQueuePlanRequest>, idempotencyKey: string) => Promise<QueueMutation>;
  readonly resumeQueue: (characterId: string, request: { readonly expected_queue_version: number | string }, idempotencyKey: string) => Promise<QueueMutation>;
}
export interface StartBehaviorActionOptions {
  readonly characterId: string;
  readonly queue: Queue;
  readonly client: BehaviorQueueClient;
  readonly invalidate: (queryKey: readonly unknown[]) => Promise<unknown> | unknown;
  readonly emitFeedback?: (message: string) => void;
  readonly createIdempotencyKey?: () => string;
  readonly behaviorKind?: BehaviorKind;
  readonly actionLabel?: (actionId: string) => string;
}

function createIdempotencyKey(kind: BehaviorKind): string {
  return typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : `${kind}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export async function startBehaviorAction(action: ActionCatalogEntry, options: StartBehaviorActionOptions): Promise<QueueMutation> {
  if (!isBehaviorActionAvailable(action)) throw new Error('BEHAVIOR_ACTION_UNAVAILABLE');
  const kind = options.behaviorKind ?? 'herbalism';
  const makeKey = options.createIdempotencyKey ?? (() => createIdempotencyKey(kind));
  const createDraft = (queueVersion: number | string) => createQueueEditorDraft(queueVersion, [createQueueEditorEntryDraft(`${kind}-${action.action_id}-${Date.now()}`, { actionId: action.queue_action_id, mode: 'INFINITE', targetValue: '' })]);
  let mutation: QueueMutation;
  try {
    mutation = await options.client.saveQueue(options.characterId, createQueuePlanRequest(createDraft(options.queue.queue_version)), makeKey());
  } catch (error) {
    if (!(error instanceof ApiClientError) || error.status !== 409) throw error;
    const latestQueue = await options.client.getQueue(options.characterId);
    mutation = await options.client.saveQueue(options.characterId, createQueuePlanRequest(createDraft(latestQueue.queue_version)), makeKey());
  }
  if (mutation.queue.paused) mutation = await options.client.resumeQueue(options.characterId, { expected_queue_version: mutation.queue.queue_version }, makeKey());
  await Promise.all([
    options.invalidate(['behavior', options.characterId, 'queue']),
    options.invalidate(['behavior', options.characterId, 'actions']),
    options.invalidate(['behavior', options.characterId, 'recipes']),
    options.invalidate(['behavior', options.characterId, 'progression']),
    options.invalidate(['dashboard', options.characterId]),
    options.invalidate(['global-idle-progress', options.characterId]),
  ]);
  options.emitFeedback?.(`已开始挂机：${options.actionLabel?.(action.action_id) ?? describeActionId(action.action_id)}`);
  return mutation;
}

export async function startBehaviorRecipe(recipe: RecipeCatalogEntry, action: ActionCatalogEntry | null, options: StartBehaviorActionOptions): Promise<QueueMutation> {
  if (!isBehaviorRecipeAvailable(recipe, action)) throw new Error('BEHAVIOR_RECIPE_UNAVAILABLE');
  return startBehaviorAction(action as ActionCatalogEntry, { ...options, actionLabel: () => describeRecipeId(recipe.recipe_id) });
}

export function describeBehaviorAction(actionId: string | null | undefined): string { return describeActionId(actionId); }
export function describeBehaviorItem(itemId: string | null | undefined): string { return describeItemId(itemId); }
