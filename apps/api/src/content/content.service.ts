import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';

import type {
  ActionConfig,
  ConfigRegistry,
  ItemConfig,
  RecipeConfig,
} from '@dongtian/config-schema';
import type {
  AssetRepository,
  CharacterProgressionRecord,
  CharacterRepository,
  InventorySnapshot,
} from '@dongtian/database';

import { AuthService } from '../auth/auth.service.js';
import { assetRepositoryToken } from '../asset/asset.tokens.js';
import { characterRepositoryToken } from '../character/character.tokens.js';
import { configRegistryToken } from '../config/config.tokens.js';
import {
  buildContentRouteIndexes,
  buildQuantityMetadata,
  type ContentRoute,
  type ItemQuantity,
} from './content-metadata.js';
import { computeFeaturePermissions, type FeaturePermission } from './content-visibility.js';

type ContentEntryState = {
  readonly enabled: boolean;
  readonly visible: boolean;
  readonly usable: boolean;
  readonly optimized_ui: boolean;
  readonly reason_key: string | null;
  readonly reason: string;
  readonly blockers: readonly Record<string, unknown>[];
};

type CharacterContext = {
  readonly character: CharacterProgressionRecord;
  readonly skillLevels: ReadonlyMap<string, number>;
  readonly inventoryByItemId: ReadonlyMap<string, { readonly quantity: number; readonly reserved: number; readonly available: number }>;
  readonly sourceRoutesByItemId: ReadonlyMap<string, readonly ContentRoute[]>;
  readonly usageRoutesByItemId: ReadonlyMap<string, readonly ContentRoute[]>;
  readonly featurePermissions: readonly FeaturePermission[];
};

function notFound(): NotFoundException {
  return new NotFoundException({
    code: 'RESOURCE_NOT_FOUND',
    message_key: 'error.resource_not_found',
  });
}

function integerQuantity(value: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error('CONTENT_QUANTITY_OUT_OF_RANGE');
  }
  return parsed;
}

function inventoryIndex(snapshot: InventorySnapshot): ReadonlyMap<string, { readonly quantity: number; readonly reserved: number; readonly available: number }> {
  const index = new Map<string, { readonly quantity: number; readonly reserved: number; readonly available: number }>();
  for (const item of snapshot.items) {
    index.set(item.assetId, {
      quantity: integerQuantity(item.quantity),
      reserved: integerQuantity(item.reservedQuantity),
      available: integerQuantity(item.availableQuantity),
    });
  }
  return index;
}

function describeBlockers(blockers: readonly Record<string, unknown>[]): string {
  if (blockers.length === 0) {
    return '可用';
  }
  const parts = blockers.map((blocker) => {
    const kind = String(blocker['kind'] ?? 'unknown');
    if (kind === 'realm') {
      return `境界不足：需要 ${String(blocker['required_id'] ?? '?')}，当前 ${String(blocker['actual_id'] ?? '?')}`;
    }
    if (kind === 'tutorial') {
      return `教程未完成：需要 ${String(blocker['required_id'] ?? '?')}`;
    }
    if (kind === 'skill') {
      return `技能等级不足：需要 ${String(blocker['required_id'] ?? '?')} ${String(blocker['required_level'] ?? '?')} 级`;
    }
    if (kind === 'facility') {
      return `缺少设施：${String(blocker['required_id'] ?? '?')}`;
    }
    if (kind === 'feature') {
      return `功能未开放：${String(blocker['required_id'] ?? '?')}`;
    }
    return `${kind} 阻塞`;
  });
  return parts.join('；');
}

function featureForSkill(skillId: string | null): string | null {
  if (skillId === null) {
    return 'feature.cultivation';
  }
  const suffix = skillId.slice('skill.'.length);
  return `feature.${suffix}`;
}

function getFeatureState(
  registry: ConfigRegistry,
  context: CharacterContext,
  featureId: string | null,
): ContentEntryState {
  if (featureId === null) {
    return {
      enabled: true,
      visible: true,
      usable: true,
      optimized_ui: true,
      reason_key: null,
      reason: '可用',
      blockers: [],
    };
  }

  const feature = registry.getFeatureUnlock(featureId);
  const currentStage = registry.getRealm(context.character.realmStageId);
  const visibleStage = registry.getRealm(feature.visible_stage);
  const usableStage = registry.getRealm(feature.usable_stage);
  const masteryStage = registry.getRealm(feature.mastery_stage);
  const tutorialsComplete = feature.required_tutorial_ids.length === 0;
  const skillLevel =
    feature.required_skill_id === null ? null : (context.skillLevels.get(feature.required_skill_id) ?? 0);
  const skillReady =
    feature.required_skill_id === null ||
    (feature.required_skill_level !== null &&
      skillLevel !== null &&
      skillLevel >= feature.required_skill_level);
  const enabled = feature.enabled;
  const visible = enabled && tutorialsComplete && currentStage.stage_order >= visibleStage.stage_order;
  const usable = visible && currentStage.stage_order >= usableStage.stage_order && skillReady;
  const optimized = usable && currentStage.stage_order >= masteryStage.stage_order;

  const blockers: Record<string, unknown>[] = [];
  if (!enabled) {
    blockers.push({ kind: 'feature', required_id: feature.feature_id, reason_key: feature.locked_reason_key });
  }
  if (!tutorialsComplete) {
    blockers.push({
      kind: 'tutorial',
      required_id: feature.required_tutorial_ids.join(','),
      reason_key: feature.locked_reason_key,
    });
  }
  if (currentStage.stage_order < visibleStage.stage_order) {
    blockers.push({
      kind: 'realm',
      required_id: visibleStage.id,
      actual_id: currentStage.id,
      reason_key: feature.locked_reason_key,
    });
  }
  if (currentStage.stage_order < usableStage.stage_order) {
    blockers.push({
      kind: 'realm',
      required_id: usableStage.id,
      actual_id: currentStage.id,
      reason_key: feature.locked_reason_key,
    });
  }
  if (feature.required_skill_id !== null && !skillReady) {
    blockers.push({
      kind: 'skill',
      required_id: feature.required_skill_id,
      required_level: feature.required_skill_level,
      actual_level: skillLevel ?? 0,
      reason_key: feature.locked_reason_key,
    });
  }

  return {
    enabled,
    visible,
    usable,
    optimized_ui: optimized,
    reason_key: usable ? null : feature.locked_reason_key,
    reason: usable ? '可用' : describeBlockers(blockers),
    blockers,
  };
}

function availableInventory(context: CharacterContext, itemId: string): { readonly quantity: number; readonly reserved: number; readonly available: number } {
  return context.inventoryByItemId.get(itemId) ?? { quantity: 0, reserved: 0, available: 0 };
}

function inputQuantity(
  item: ItemConfig,
  quantity: string,
  context: CharacterContext,
): ItemQuantity {
  const inventory = availableInventory(context, item.id);
  return buildQuantityMetadata(
    item.id,
    quantity,
    context.sourceRoutesByItemId,
    context.usageRoutesByItemId,
    inventory.available,
    inventory.reserved,
    inventory.quantity,
  );
}

function outputQuantity(item: ItemConfig, quantity: string, context: CharacterContext): ItemQuantity {
  return buildQuantityMetadata(
    item.id,
    quantity,
    context.sourceRoutesByItemId,
    context.usageRoutesByItemId,
  );
}

function actionState(registry: ConfigRegistry, context: CharacterContext, action: ActionConfig): ContentEntryState {
  const featureId = featureForSkill(action.skill_id);
  const featureState = getFeatureState(registry, context, featureId);
  const currentStage = registry.getRealm(context.character.realmStageId);
  const actionStage = registry.getRealm(action.realm_required);
  const blockers: Record<string, unknown>[] = [...featureState.blockers];

  if (currentStage.stage_order < actionStage.stage_order) {
    blockers.push({
      kind: 'realm',
      required_id: actionStage.id,
      actual_id: currentStage.id,
      reason_key: 'content.locked.realm',
    });
  }

  const usable = featureState.usable && currentStage.stage_order >= actionStage.stage_order;

  return {
    enabled: action.enabled,
    visible: featureState.visible,
    usable,
    optimized_ui: featureState.optimized_ui && usable,
    reason_key: usable ? null : featureState.reason_key ?? 'content.locked.realm',
    reason: usable ? '可用' : describeBlockers(blockers),
    blockers,
  };
}

function recipeState(registry: ConfigRegistry, context: CharacterContext, recipe: RecipeConfig): ContentEntryState {
  const featureState = getFeatureState(registry, context, featureForSkill(recipe.craft_skill_id));
  const currentStage = registry.getRealm(context.character.realmStageId);
  const recipeStage = registry.getRealm(recipe.realm_required);
  const skillLevel = context.skillLevels.get(recipe.craft_skill_id) ?? 0;
  const blockers: Record<string, unknown>[] = [...featureState.blockers];

  if (currentStage.stage_order < recipeStage.stage_order) {
    blockers.push({
      kind: 'realm',
      required_id: recipeStage.id,
      actual_id: currentStage.id,
      reason_key: 'content.locked.realm',
    });
  }
  if (skillLevel < recipe.required_level) {
    blockers.push({
      kind: 'skill',
      required_id: recipe.craft_skill_id,
      required_level: recipe.required_level,
      actual_level: skillLevel,
      reason_key: 'content.locked.skill_level',
    });
  }

  const usable =
    featureState.usable &&
    currentStage.stage_order >= recipeStage.stage_order &&
    skillLevel >= recipe.required_level;

  return {
    enabled: recipe.enabled,
    visible: featureState.visible,
    usable,
    optimized_ui: featureState.optimized_ui && usable,
    reason_key: usable ? null : featureState.reason_key ?? 'content.locked.skill_level',
    reason: usable ? '可用' : describeBlockers(blockers),
    blockers,
  };
}

function mapInventoryItem(
  item: ItemConfig,
  stack: { readonly quantity: number; readonly reserved: number; readonly available: number },
  context: CharacterContext,
): Record<string, unknown> {
  return {
    asset_type: 'ITEM',
    asset_id: item.id,
    category: item.category,
    quantity: stack.quantity,
    reserved_quantity: stack.reserved,
    available_quantity: stack.available,
    source_routes: context.sourceRoutesByItemId.get(item.id) ?? [],
    usage_routes: context.usageRoutesByItemId.get(item.id) ?? [],
  };
}

@Injectable()
export class ContentService {
  public constructor(
    @Inject(AuthService) private readonly authService: AuthService,
    @Inject(characterRepositoryToken) private readonly characterRepository: CharacterRepository,
    @Inject(assetRepositoryToken) private readonly assetRepository: AssetRepository,
    @Inject(configRegistryToken) private readonly configRegistry: ConfigRegistry,
  ) {}

  public async getActions(request: FastifyRequest): Promise<Record<string, unknown>> {
    const context = await this.loadContext(request);

    return {
      character: {
        character_id: context.character.characterId,
        name: context.character.name,
        realm_stage_id: context.character.realmStageId,
      },
      actions: this.configRegistry.actions.map((action) => {
        const state = actionState(this.configRegistry, context, action);
        return {
          action_id: action.id,
          name_key: action.name_key,
          description_key: action.description_key ?? null,
          skill_id: action.skill_id,
          enabled: action.enabled,
          unlocked: state.usable,
          unlock_state: state,
          queue_action_id: action.id,
          can_add_to_queue: state.usable && action.allowed_queue_modes.length > 0,
          base_duration_us: action.base_duration_us,
          skill_xp: action.skill_xp,
          cultivation_xp: action.cultivation_xp,
          allowed_queue_modes: action.allowed_queue_modes,
          required_tool_tag: action.required_tool_tag,
          modifier_tags: action.modifier_tags,
          tags: action.tags,
          inputs: action.inputs.map((input) => {
            const item = this.configRegistry.getItem(input.item_id);
            return inputQuantity(item, input.quantity, context);
          }),
          outputs: action.outputs.map((output) => {
            const item = this.configRegistry.getItem(output.item_id);
            return outputQuantity(item, output.quantity, context);
          }),
        };
      }),
      calculation_as_of: new Date().toISOString(),
      config_version: this.configRegistry.manifest.config_version,
    };
  }

  public async getRecipes(request: FastifyRequest): Promise<Record<string, unknown>> {
    const context = await this.loadContext(request);

    return {
      character: {
        character_id: context.character.characterId,
        name: context.character.name,
        realm_stage_id: context.character.realmStageId,
      },
      recipes: this.configRegistry.recipes.map((recipe) => {
        const state = recipeState(this.configRegistry, context, recipe);
        return {
          recipe_id: recipe.id,
          action_id: recipe.action_config_id,
          name_key: recipe.name_key,
          description_key: recipe.description_key ?? null,
          craft_skill_id: recipe.craft_skill_id,
          result_item_id: recipe.result_item_id,
          result_quantity: recipe.result_quantity,
          required_level: recipe.required_level,
          required_facility_id: recipe.required_facility_id ?? null,
          enabled: recipe.enabled,
          unlocked: state.usable,
          unlock_state: state,
          queue_action_id: recipe.action_config_id,
          can_add_to_queue: state.usable,
          base_duration_us: recipe.base_duration_us,
          skill_xp: recipe.skill_xp,
          tags: recipe.tags,
          ingredients: recipe.ingredients.map((ingredient) => {
            const item = this.configRegistry.getItem(ingredient.item_id);
            return inputQuantity(item, ingredient.quantity, context);
          }),
          result_item: buildQuantityMetadata(
            recipe.result_item_id,
            recipe.result_quantity,
            context.sourceRoutesByItemId,
            context.usageRoutesByItemId,
          ),
        };
      }),
      calculation_as_of: new Date().toISOString(),
      config_version: this.configRegistry.manifest.config_version,
    };
  }

  public async getInventory(
    request: FastifyRequest,
    characterId: string,
  ): Promise<Record<string, unknown>> {
    const accountId = await this.authService.requireCurrentAccountId(request);
    const inventory = await this.assetRepository.getInventory(characterId, accountId);
    if (!inventory) {
      throw notFound();
    }

    const context = await this.loadContext(request, characterId, accountId, inventory);
    const items = inventory.items.flatMap((item) => {
      let configItem: ItemConfig | undefined;
      try {
        configItem = this.configRegistry.getItem(item.assetId);
      } catch {
        configItem = undefined;
      }

      if (!configItem) {
        return [];
      }

      return [mapInventoryItem(configItem, {
        quantity: integerQuantity(item.quantity),
        reserved: integerQuantity(item.reservedQuantity),
        available: integerQuantity(item.availableQuantity),
      }, context)];
    });

    return {
      items,
      currencies: inventory.currencies.map((currency) => ({
        asset_type: currency.assetType,
        asset_id: currency.assetId,
        quantity: currency.quantity,
        reserved_quantity: currency.reservedQuantity,
        available_quantity: currency.availableQuantity,
      })),
      equipment_instances: inventory.equipmentInstances.map((equipment) => ({
        instance_id: equipment.instanceId,
        item_id: equipment.itemId,
        temper_level: equipment.temperLevel,
        bound: equipment.bound,
        created_config_version: equipment.createdConfigVersion,
      })),
      total_count: items.length + inventory.currencies.length,
    };
  }

  private async loadContext(
    request: FastifyRequest,
    characterId?: string,
    accountId?: string,
    inventory?: InventorySnapshot,
  ): Promise<CharacterContext> {
    const resolvedAccountId = accountId ?? (await this.authService.requireCurrentAccountId(request));
    const resolvedCharacterId = characterId ?? (await this.authService.requireCurrentCharacterId(request));
    const character = await this.characterRepository.getProgression(resolvedCharacterId, resolvedAccountId);
    if (!character) {
      throw notFound();
    }
    const resolvedInventory = inventory ?? (await this.assetRepository.getInventory(resolvedCharacterId, resolvedAccountId));
    if (!resolvedInventory) {
      throw notFound();
    }
    const routeIndexes = buildContentRouteIndexes(this.configRegistry);
    const featurePermissions = computeFeaturePermissions(
      this.configRegistry,
      character.realmStageId,
      character.skills,
    );
    return {
      character,
      skillLevels: new Map(character.skills.map((skill) => [skill.skillId, skill.level])),
      inventoryByItemId: inventoryIndex(resolvedInventory),
      sourceRoutesByItemId: routeIndexes.sourceRoutesByItemId,
      usageRoutesByItemId: routeIndexes.usageRoutesByItemId,
      featurePermissions,
    };
  }
}
