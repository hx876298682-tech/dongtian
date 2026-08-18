import { describe, expect, it, vi } from 'vitest';
import { ApiClientError, type ActionCatalogEntry } from '@dongtian/contracts';

import {
  HERBALISM_REGIONS,
  describeHerbalismAction,
  describeHerbalismItem,
  filterBehaviorActions,
  findRecipeAction,
  findHerbalismAction,
  groupBehaviorRecipes,
  getHerbalismRegions,
  isBehaviorActionAvailable,
  isBehaviorRecipeAvailable,
  startBehaviorAction,
} from './behavior-adapter.js';

describe('herbalism behavior adapter', () => {
  it('keeps the six configured regions in release order', () => {
    expect(getHerbalismRegions()).toBe(HERBALISM_REGIONS);
    expect(HERBALISM_REGIONS.map((region) => region.id)).toEqual([
      'region.t1.qingyun_foothill',
      'region.t1.mist_slope',
      'region.t1.spirit_spring',
      'region.t1.blackstone_pass',
      'region.t2.starfall_mine',
      'region.t2.blackwind_valley',
    ]);
  });

  it('finds an action only when it is configured for the selected region', () => {
    const region = HERBALISM_REGIONS[1];
    if (region === undefined) throw new Error('expected mist slope region');
    const action = {
      action_id: 'action.t1.herb_wuyin_slope',
      queue_action_id: 'action.t1.herb_wuyin_slope',
      tags: ['gathering', 'herb'],
    } as unknown as ActionCatalogEntry;

    expect(findHerbalismAction(region, [action])?.action_id).toBe('action.t1.herb_wuyin_slope');
    const firstRegion = HERBALISM_REGIONS[0];
    if (firstRegion === undefined) throw new Error('expected first region');
    expect(findHerbalismAction(firstRegion, [action])).toBeNull();
  });

  it('maps known player item labels and keeps unknown ids player-safe', () => {
    expect(describeHerbalismItem('item.t1.qingling_herb')).toBe('青灵草');
    expect(describeHerbalismItem('item.t1.unknown_herb')).toBe('未鉴定物品');
    expect(describeHerbalismAction('action.t1.herb_zhuji_garden')).toBe('筑基药园采药');
  });

  it('filters mining actions to ore-tagged actions and groups production actions by their tags', () => {
    const make = (action_id: string, tags: string[], skill_id: string): ActionCatalogEntry => ({ action_id, queue_action_id: action_id, tags, skill_id, enabled: true, unlocked: true } as unknown as ActionCatalogEntry);
    const actions = [
      make('ore', ['gathering', 'ore'], 'skill.mining'),
      make('pill', ['alchemy', 'combat'], 'skill.alchemy'),
      make('breakthrough', ['alchemy', 'breakthrough'], 'skill.alchemy'),
      make('sword', ['forging', 'weapon'], 'skill.forging'),
      make('armor', ['forging', 'armor'], 'skill.forging'),
    ];
    expect(filterBehaviorActions(actions, 'mining').map((action) => action.action_id)).toEqual(['ore']);
    const makeRecipe = (recipe_id: string, tags: string[], craft_skill_id: string): import('@dongtian/contracts').RecipeCatalogEntry => ({ recipe_id, action_id: recipe_id, queue_action_id: recipe_id, tags, craft_skill_id } as unknown as import('@dongtian/contracts').RecipeCatalogEntry);
    const recipes = [makeRecipe('pill', ['alchemy', 'combat'], 'skill.alchemy'), makeRecipe('breakthrough', ['alchemy', 'breakthrough'], 'skill.alchemy'), makeRecipe('sword', ['forging', 'weapon'], 'skill.forging'), makeRecipe('armor', ['forging', 'armor'], 'skill.forging')];
    expect(groupBehaviorRecipes(recipes, 'alchemy').map((group) => group.id)).toEqual(['breakthrough', 'combat']);
    expect(groupBehaviorRecipes(recipes, 'forging').map((group) => group.id)).toEqual(['weapon', 'armor']);
  });

  it('requires enabled, unlocked, queueable actions with INFINITE support', () => {
    const action = { enabled: true, unlocked: true, can_add_to_queue: true, allowed_queue_modes: ['INFINITE'] } as unknown as ActionCatalogEntry;
    expect(isBehaviorActionAvailable(action)).toBe(true);
    expect(isBehaviorActionAvailable({ ...action, unlocked: false })).toBe(false);
    expect(isBehaviorActionAvailable({ ...action, allowed_queue_modes: ['COUNT'] })).toBe(false);
  });

  it('maps a recipe to queue metadata without replacing recipe-owned materials or unlock state', () => {
    const recipe = { recipe_id: 'recipe-1', action_id: 'action-1', queue_action_id: 'queue-1', enabled: true, unlocked: true, can_add_to_queue: true } as unknown as import('@dongtian/contracts').RecipeCatalogEntry;
    const action = { action_id: 'other-id', queue_action_id: 'queue-1', allowed_queue_modes: ['INFINITE'] } as unknown as ActionCatalogEntry;
    expect(findRecipeAction(recipe, [action])).toBe(action);
    expect(isBehaviorRecipeAvailable(recipe, action)).toBe(true);
    expect(isBehaviorRecipeAvailable({ ...recipe, unlocked: false }, action)).toBe(false);
    expect(isBehaviorRecipeAvailable(recipe, { ...action, allowed_queue_modes: ['COUNT'] })).toBe(false);
  });

  it('retries a stale queue version and resumes a paused queue through the shared helper', async () => {
    const queue = { queue_version: '1', paused: true } as unknown as import('@dongtian/contracts').Queue;
    const client = {
      getQueue: vi.fn().mockResolvedValue({ ...queue, queue_version: '2' }),
      saveQueue: vi.fn().mockRejectedValueOnce(new ApiClientError('conflict', { status: 409, retryable: false })).mockResolvedValue({ queue: { ...queue, queue_version: '2', paused: true } }),
      resumeQueue: vi.fn().mockResolvedValue({ queue: { ...queue, queue_version: '3', paused: false } }),
    };
    const action = { action_id: 'action.t1.ore_chitong_kuang', queue_action_id: 'action.t1.ore_chitong_kuang', enabled: true, unlocked: true, can_add_to_queue: true, allowed_queue_modes: ['INFINITE'] } as unknown as ActionCatalogEntry;
    await startBehaviorAction(action, { characterId: 'c1', queue, client, invalidate: vi.fn(), createIdempotencyKey: () => 'key', behaviorKind: 'mining' });
    expect(client.getQueue).toHaveBeenCalledWith('c1');
    expect(client.resumeQueue).toHaveBeenCalled();
  });

  it('requests an immediate switch when a player starts a single behavior', async () => {
    const queue = { queue_version: '1', paused: false } as unknown as import('@dongtian/contracts').Queue;
    const client = {
      getQueue: vi.fn(),
      saveQueue: vi.fn().mockResolvedValue({ queue: { ...queue, queue_version: '2' } }),
      resumeQueue: vi.fn(),
    };
    const action = { action_id: 'action.t1.combat_qingshe', queue_action_id: 'action.t1.combat_qingshe', enabled: true, unlocked: true, can_add_to_queue: true, allowed_queue_modes: ['INFINITE'] } as unknown as ActionCatalogEntry;

    await startBehaviorAction(action, { characterId: 'c1', queue, client, invalidate: vi.fn(), createIdempotencyKey: () => 'key', behaviorKind: 'combat' });

    expect(client.saveQueue).toHaveBeenCalledWith(
      'c1',
      expect.objectContaining({ replace_current: true }),
      'key',
    );
  });
});
