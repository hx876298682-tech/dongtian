import type { ConfigRegistry, ActionConfig, ItemConfig, RecipeConfig } from '@dongtian/config-schema';

export type ContentRoute = {
  readonly route_type: 'ACTION' | 'RECIPE';
  readonly target_id: string;
  readonly name_key: string;
  readonly description_key: string | null;
  readonly source_note: string;
};

export type ItemQuantity = {
  readonly item_id: string;
  readonly quantity: string;
  readonly source_routes: readonly ContentRoute[];
  readonly usage_routes: readonly ContentRoute[];
  readonly available_quantity?: number;
  readonly reserved_quantity?: number;
  readonly quantity_owned?: number;
  readonly missing_quantity?: number;
};

export type ItemStack = {
  readonly asset_type: 'ITEM' | 'CURRENCY';
  readonly asset_id: string;
  readonly category?: string;
  readonly quantity: number | string;
  readonly reserved_quantity: number | string;
  readonly available_quantity: number | string;
  readonly source_routes: readonly ContentRoute[];
  readonly usage_routes: readonly ContentRoute[];
};

type ItemRouteIndex = ReadonlyMap<string, readonly ContentRoute[]>;

function normalizeRoutes(routes: readonly ContentRoute[]): readonly ContentRoute[] {
  const seen = new Set<string>();
  const result: ContentRoute[] = [];

  for (const route of routes) {
    const key = `${route.route_type}:${route.target_id}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(route);
  }

  return result;
}

function routeFromAction(action: ActionConfig): ContentRoute {
  return {
    route_type: 'ACTION',
    target_id: action.id,
    name_key: action.name_key,
    description_key: action.description_key ?? null,
    source_note: action.source_note,
  };
}

function routeFromRecipe(recipe: RecipeConfig): ContentRoute {
  return {
    route_type: 'RECIPE',
    target_id: recipe.id,
    name_key: recipe.name_key,
    description_key: recipe.description_key ?? null,
    source_note: recipe.source_note,
  };
}

function addRoute(
  map: Map<string, ContentRoute[]>,
  itemId: string,
  route: ContentRoute,
): void {
  const current = map.get(itemId);
  if (current) {
    current.push(route);
    return;
  }
  map.set(itemId, [route]);
}

export function buildContentRouteIndexes(registry: ConfigRegistry): {
  readonly sourceRoutesByItemId: ItemRouteIndex;
  readonly usageRoutesByItemId: ItemRouteIndex;
} {
  const sourceRoutesByItemId = new Map<string, ContentRoute[]>();
  const usageRoutesByItemId = new Map<string, ContentRoute[]>();

  for (const action of registry.actions) {
    const actionRoute = routeFromAction(action);
    for (const output of action.outputs) {
      addRoute(sourceRoutesByItemId, output.item_id, actionRoute);
    }
    for (const input of action.inputs) {
      addRoute(usageRoutesByItemId, input.item_id, actionRoute);
    }
  }

  for (const recipe of registry.recipes) {
    const recipeRoute = routeFromRecipe(recipe);
    addRoute(sourceRoutesByItemId, recipe.result_item_id, recipeRoute);
    for (const ingredient of recipe.ingredients) {
      addRoute(usageRoutesByItemId, ingredient.item_id, recipeRoute);
    }
  }

  return {
    sourceRoutesByItemId: new Map(
      [...sourceRoutesByItemId.entries()].map(([itemId, routes]) => [itemId, normalizeRoutes(routes)]),
    ),
    usageRoutesByItemId: new Map(
      [...usageRoutesByItemId.entries()].map(([itemId, routes]) => [itemId, normalizeRoutes(routes)]),
    ),
  };
}

export function buildItemMetadata(
  item: ItemConfig,
  quantity: number | string,
  reservedQuantity: number | string,
  availableQuantity: number | string,
  sourceRoutes: ItemRouteIndex,
  usageRoutes: ItemRouteIndex,
): ItemStack {
  const source = sourceRoutes.get(item.id) ?? [];
  const usage = usageRoutes.get(item.id) ?? [];

  return {
    asset_type: 'ITEM',
    asset_id: item.id,
    category: item.category,
    quantity,
    reserved_quantity: reservedQuantity,
    available_quantity: availableQuantity,
    source_routes: source,
    usage_routes: usage,
  };
}

export function buildQuantityMetadata(
  itemId: string,
  quantity: string,
  sourceRoutes: ItemRouteIndex,
  usageRoutes: ItemRouteIndex,
  availableQuantity?: number,
  reservedQuantity?: number,
  ownedQuantity?: number,
): ItemQuantity {
  return {
    item_id: itemId,
    quantity,
    source_routes: sourceRoutes.get(itemId) ?? [],
    usage_routes: usageRoutes.get(itemId) ?? [],
    ...(availableQuantity === undefined ? {} : { available_quantity: availableQuantity }),
    ...(reservedQuantity === undefined ? {} : { reserved_quantity: reservedQuantity }),
    ...(ownedQuantity === undefined ? {} : { quantity_owned: ownedQuantity }),
    ...(ownedQuantity !== undefined && availableQuantity !== undefined
      ? { missing_quantity: Math.max(0, Number(quantity) - availableQuantity) }
      : {}),
  };
}

