import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  ActionConfigSchema,
  EquipmentConfigSchema,
  ItemConfigSchema,
  ManifestSchema,
  RecipeConfigSchema,
  type ActionConfig,
  type EquipmentConfig,
  type RecipeConfig,
} from '../../../packages/config-schema/src/config.js';

const materialCategories = new Set(['HERB', 'ORE', 'WOOD', 'MONSTER', 'MATERIAL']);
const terminalCategories = new Set(['PILL', 'EQUIPMENT']);

export type SourceKind =
  | 'cultivation'
  | 'gathering'
  | 'recipe'
  | 'battle'
  | 'dungeon'
  | 'tutorial_reward'
  | 'goal_reward'
  | 'market'
  | 'npc'
  | 'trade'
  | 'unknown';

export type ValidationFailureCode =
  | 'CONFIG_REACHABILITY_MISSING_SOURCE'
  | 'CONFIG_REACHABILITY_MARKET_ONLY'
  | 'CONFIG_REACHABILITY_CYCLE'
  | 'CONFIG_REACHABILITY_MISSING_USE';

export type DependencyProof = Readonly<{
  item_id: string;
  item_category: string;
  producer?: Readonly<{
    action_id: string;
    recipe_id: string | null;
    source_kind: SourceKind;
    inputs: readonly DependencyProof[];
  }>;
  failure?: Readonly<{
    code: ValidationFailureCode;
    message: string;
    blocked_source_kinds?: readonly SourceKind[];
    consumer_ids?: readonly string[];
    cycle_path?: readonly string[];
  }>;
}>;

export type ValidationFailure = Readonly<{
  code: ValidationFailureCode;
  item_id: string;
  item_category: string;
  stable_ids: readonly string[];
  dependency_path: DependencyProof;
  blocked_source_kinds?: readonly SourceKind[];
  consumer_ids?: readonly string[];
  message: string;
}>;

export type ValidationReport = Readonly<{
  ok: boolean;
  config_version: string;
  failure_count: number;
  failures: readonly ValidationFailure[];
}>;

type ReachabilityItem = Readonly<{
  id: string;
  category: string;
  realm_required: string;
  source_note: string;
}>;

type Producer = Readonly<{
  action: ActionConfig;
  recipeId: string | null;
  sourceKind: SourceKind;
}>;

type ReachabilityContext = Readonly<{
  itemById: ReadonlyMap<string, ReachabilityItem>;
  equipmentItemIds: ReadonlySet<string>;
  producersByItemId: ReadonlyMap<string, readonly Producer[]>;
  consumersByItemId: ReadonlyMap<string, readonly string[]>;
}>;

type ReleaseData = Readonly<{
  manifest: Readonly<{ config_version: string }>;
  items: readonly ReachabilityItem[];
  actions: readonly ActionConfig[];
  recipes: readonly RecipeConfig[];
  equipment: readonly EquipmentConfig[];
}>;

function parseJson<T>(filePath: string, schema: { parse(value: unknown): T }): T {
  return schema.parse(JSON.parse(readFileSync(filePath, 'utf8')) as unknown);
}

function readReleaseData(releaseDir: string): ReleaseData {
  return {
    manifest: parseJson(join(releaseDir, 'manifest.json'), ManifestSchema),
    items: ItemConfigSchema.array().parse(JSON.parse(readFileSync(join(releaseDir, 'items.json'), 'utf8'))) as readonly ReachabilityItem[],
    actions: ActionConfigSchema.array().parse(JSON.parse(readFileSync(join(releaseDir, 'actions.json'), 'utf8'))),
    recipes: RecipeConfigSchema.array().parse(JSON.parse(readFileSync(join(releaseDir, 'recipes.json'), 'utf8'))),
    equipment: EquipmentConfigSchema.array().parse(JSON.parse(readFileSync(join(releaseDir, 'equipment.json'), 'utf8'))),
  };
}

function lowerSet(values: readonly string[]): ReadonlySet<string> {
  return new Set(values.map((value) => value.toLowerCase()));
}

function isMarketish(action: ActionConfig): boolean {
  const tags = lowerSet(action.tags);
  const note = action.source_note.toLowerCase();

  return (
    tags.has('market')
    || tags.has('npc')
    || tags.has('trade')
    || action.feature_flag === 'feature.market'
    || note.includes('market')
    || note.includes('坊市')
    || note.includes('交易')
    || note.includes('商店')
    || note.includes('npc')
  );
}

function classifySourceKind(action: ActionConfig, recipeIds: ReadonlySet<string>): SourceKind {
  const tags = lowerSet(action.tags);
  const note = action.source_note.toLowerCase();

  if (isMarketish(action)) {
    return 'market';
  }
  if (tags.has('npc')) {
    return 'npc';
  }
  if (tags.has('trade')) {
    return 'trade';
  }
  if (
    recipeIds.has(action.id)
    || tags.has('alchemy')
    || tags.has('forging')
    || tags.has('craft')
    || tags.has('recipe')
    || note.includes('炼器')
  ) {
    return 'recipe';
  }
  if (tags.has('gathering') || note.includes('采集') || note.includes('采药') || note.includes('挖矿')) {
    return 'gathering';
  }
  if (tags.has('battle') || tags.has('combat') || note.includes('战斗') || note.includes('怪物')) {
    return 'battle';
  }
  if (tags.has('dungeon') || note.includes('秘境')) {
    return 'dungeon';
  }
  if (tags.has('cultivation') || action.id === 'action.cultivation.qi') {
    return 'cultivation';
  }
  if (tags.has('tutorial')) {
    return 'tutorial_reward';
  }
  if (tags.has('goal') || tags.has('reward')) {
    return 'goal_reward';
  }

  return 'unknown';
}

function indexConsumers(actions: readonly ActionConfig[], recipes: readonly RecipeConfig[]): ReadonlyMap<string, readonly string[]> {
  const consumers = new Map<string, string[]>();

  for (const action of actions) {
    for (const input of action.inputs) {
      const current = consumers.get(input.item_id) ?? [];
      current.push(action.id);
      consumers.set(input.item_id, current);
    }
  }

  for (const recipe of recipes) {
    for (const ingredient of recipe.ingredients) {
      const current = consumers.get(ingredient.item_id) ?? [];
      current.push(recipe.id);
      consumers.set(ingredient.item_id, current);
    }
  }

  return consumers;
}

function indexProducers(actions: readonly ActionConfig[], recipes: readonly RecipeConfig[]): ReadonlyMap<string, readonly Producer[]> {
  const recipeIds = new Set(recipes.map((recipe) => recipe.action_config_id));
  const recipeByActionId = new Map(recipes.map((recipe) => [recipe.action_config_id, recipe.id] as const));
  const producers = new Map<string, Producer[]>();

  for (const action of actions) {
    if (action.outputs.length === 0) {
      continue;
    }

    const sourceKind = classifySourceKind(action, recipeIds);
    for (const output of action.outputs) {
      const current = producers.get(output.item_id) ?? [];
      current.push({
        action,
        recipeId: recipeByActionId.get(action.id) ?? null,
        sourceKind,
      });
      producers.set(output.item_id, current);
    }
  }

  return producers;
}

function hasImplicitSourceHint(item: ReachabilityItem, equipmentItemIds: ReadonlySet<string>): boolean {
  if (equipmentItemIds.has(item.id)) {
    return true;
  }

  const note = item.source_note.toLowerCase();
  if (item.category === 'MONSTER') {
    return note.includes('怪物') || note.includes('秘境');
  }
  if (item.category === 'HERB') {
    return item.realm_required !== 'realm.mortal.entry' && (note.includes('采集') || note.includes('采药'));
  }
  if (item.category === 'ORE' || item.category === 'WOOD' || item.category === 'MATERIAL') {
    return note.includes('采集') || note.includes('采矿') || note.includes('矿') || note.includes('伐木') || note.includes('木');
  }
  return false;
}

function buildCyclePath(stack: readonly string[], repeatedItemId: string): readonly string[] {
  const firstIndex = stack.indexOf(repeatedItemId);
  return firstIndex >= 0 ? [...stack.slice(firstIndex), repeatedItemId] : [...stack, repeatedItemId];
}

function buildProof(
  context: ReachabilityContext,
  itemId: string,
  activeStack: readonly string[],
  memo: Map<string, DependencyProof>,
): DependencyProof {
  const cached = memo.get(itemId);
  if (cached !== undefined) {
    return cached;
  }

  const item = context.itemById.get(itemId);
  if (item === undefined) {
    throw new Error(`CONFIG_REACHABILITY_ITEM_MISSING:${itemId}`);
  }

  const pathNode: DependencyProof = { item_id: item.id, item_category: item.category };
  const producers = context.producersByItemId.get(itemId) ?? [];

  if (activeStack.includes(itemId)) {
    const cyclePath = buildCyclePath(activeStack, itemId);
    return {
      ...pathNode,
      failure: {
        code: 'CONFIG_REACHABILITY_CYCLE',
        message: `Item dependency cycle detected for ${item.id}.`,
        cycle_path: cyclePath,
      },
    };
  }

  if (producers.length === 0) {
    if (hasImplicitSourceHint(item, context.equipmentItemIds)) {
      memo.set(itemId, pathNode);
      return pathNode;
    }
    return {
      ...pathNode,
      failure: {
        code: 'CONFIG_REACHABILITY_MISSING_SOURCE',
        message: `No non-market source can reach ${item.id}.`,
      },
    };
  }

  const nextStack = [...activeStack, itemId];
  const blockedKinds = new Set<SourceKind>();
  const candidateFailures: DependencyProof[] = [];

  for (const producer of producers) {
    if (producer.sourceKind === 'market' || producer.sourceKind === 'npc' || producer.sourceKind === 'trade') {
      blockedKinds.add(producer.sourceKind);
      continue;
    }
    if (producer.sourceKind === 'unknown') {
      blockedKinds.add('unknown');
      continue;
    }

    const inputProofs: DependencyProof[] = [];
    let failed = false;

    for (const input of producer.action.inputs) {
      const proof = buildProof(context, input.item_id, nextStack, memo);
      inputProofs.push(proof);
      if (proof.failure !== undefined) {
        failed = true;
        break;
      }
    }

    const producerNode: DependencyProof = {
      ...pathNode,
      producer: {
        action_id: producer.action.id,
        recipe_id: producer.recipeId,
        source_kind: producer.sourceKind,
        inputs: inputProofs,
      },
    };

    if (!failed) {
      memo.set(itemId, producerNode);
      return producerNode;
    }

    candidateFailures.push(producerNode);
  }

  if (blockedKinds.size > 0 && candidateFailures.length === 0) {
    return {
      ...pathNode,
      failure: {
        code: 'CONFIG_REACHABILITY_MARKET_ONLY',
        message: `Only blocked sources can reach ${item.id}.`,
        blocked_source_kinds: [...blockedKinds],
      },
    };
  }

  const cycleFailure = candidateFailures.find((candidate) =>
    candidate.producer?.inputs.some((input) => input.failure?.code === 'CONFIG_REACHABILITY_CYCLE'),
  );
  if (cycleFailure !== undefined) {
    return {
      ...cycleFailure,
      failure: {
        code: 'CONFIG_REACHABILITY_CYCLE',
        message: `A cycle prevents a non-market path to ${item.id}.`,
        cycle_path:
          cycleFailure.producer?.inputs.find((input) => input.failure?.code === 'CONFIG_REACHABILITY_CYCLE')?.failure?.cycle_path
          ?? [item.id],
      },
    };
  }

  if (candidateFailures.length > 0) {
    const first = candidateFailures[0];
    if (first === undefined) {
      return {
        ...pathNode,
        failure: {
          code: 'CONFIG_REACHABILITY_MISSING_SOURCE',
          message: `No non-market source can reach ${item.id}.`,
        },
      };
    }
    return {
      ...first,
      failure: {
        code: first.failure?.code ?? 'CONFIG_REACHABILITY_MISSING_SOURCE',
        message: first.failure?.message ?? `No non-market source can reach ${item.id}.`,
      },
    };
  }

  return {
    ...pathNode,
    failure: {
      code: 'CONFIG_REACHABILITY_MISSING_SOURCE',
      message: `No non-market source can reach ${item.id}.`,
    },
  };
}

function collectFailuresFromProof(
  proof: DependencyProof,
  results: ValidationFailure[],
  consumers: ReadonlyMap<string, readonly string[]>,
): void {
  if (proof.failure !== undefined) {
    const failure: ValidationFailure = {
      code: proof.failure.code,
      item_id: proof.item_id,
      item_category: proof.item_category,
      stable_ids: proof.failure.cycle_path ?? [proof.item_id],
      dependency_path: proof,
      message: proof.failure.message,
      ...(proof.failure.blocked_source_kinds !== undefined ? { blocked_source_kinds: proof.failure.blocked_source_kinds } : {}),
      ...(proof.failure.consumer_ids !== undefined ? { consumer_ids: proof.failure.consumer_ids } : {}),
    };
    results.push(failure);
  }

  if (
    proof.producer !== undefined
    && materialCategories.has(proof.item_category)
    && !terminalCategories.has(proof.item_category)
  ) {
    const consumerIds = consumers.get(proof.item_id) ?? [];
    if (consumerIds.length === 0) {
      results.push({
        code: 'CONFIG_REACHABILITY_MISSING_USE',
        item_id: proof.item_id,
        item_category: proof.item_category,
        stable_ids: [proof.item_id],
        dependency_path: proof,
        message: `Material ${proof.item_id} has no enabled consumer.`,
        ...(consumerIds.length > 0 ? { consumer_ids: consumerIds } : {}),
      });
    }
  }

  for (const child of proof.producer?.inputs ?? []) {
    collectFailuresFromProof(child, results, consumers);
  }
}

function dedupeFailures(failures: readonly ValidationFailure[]): readonly ValidationFailure[] {
  const seen = new Set<string>();
  const deduped: ValidationFailure[] = [];

  for (const failure of failures) {
    const key = `${failure.code}:${failure.item_id}:${failure.message}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    deduped.push(failure);
  }

  return deduped;
}

export type ValidateConfigReachabilityOptions = Readonly<{
  releasesRoot: string;
  version: string;
}>;

export function validateReleaseDirectory(options: ValidateConfigReachabilityOptions): ValidationReport {
  const releaseDir = join(options.releasesRoot, options.version);
  const release = readReleaseData(releaseDir);
  const itemById = new Map(release.items.map((item) => [item.id, item] as const));
  const equipmentItemIds = new Set(release.equipment.map((entry) => entry.item_id));
  const producersByItemId = indexProducers(release.actions, release.recipes);
  const consumersByItemId = indexConsumers(release.actions, release.recipes);
  const context: ReachabilityContext = {
    itemById,
    equipmentItemIds,
    producersByItemId,
    consumersByItemId,
  };
  const memo = new Map<string, DependencyProof>();
  const failures: ValidationFailure[] = [];

  for (const item of release.items) {
    if (!materialCategories.has(item.category) && !terminalCategories.has(item.category)) {
      continue;
    }
    const proof = buildProof(context, item.id, [], memo);
    collectFailuresFromProof(proof, failures, consumersByItemId);
  }

  const deduped = dedupeFailures(failures);
  return {
    ok: deduped.length === 0,
    config_version: release.manifest.config_version,
    failure_count: deduped.length,
    failures: deduped,
  };
}

export function validateConfigReachability(): ValidationReport {
  throw new Error('CONFIG_VALIDATE_REQUIRES_RELEASE_DIRECTORY');
}
