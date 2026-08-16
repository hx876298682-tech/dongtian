import type { DungeonPreviewRequest } from '@dongtian/contracts';

export const QINGSHE_DUNGEON_ID = 'dungeon.t1.qingshe_cave';
export const QINGSHE_SAFE_ROUTE_ID = 'route.t1.qingshe_cave.safe_exit';
export const QINGSHE_HIGH_RISK_ROUTE_ID = 'route.t1.qingshe_cave.deep_den';
export const QINGSHE_SAFE_CHOICE_ID = 'choice.t1.qingshe_cave.safe_exit';
export const QINGSHE_HIGH_RISK_CHOICE_ID = 'choice.t1.qingshe_cave.deep_den';
export const DEFAULT_DUNGEON_STRATEGY_ID = 'strategy.safe';

export interface ExpeditionDraft {
  readonly loadoutPresetId: string;
  readonly strategyPresetId: string;
  readonly initialRouteId: string;
}

export type ExpeditionAction =
  | { readonly type: 'hydrate'; readonly draft: Partial<ExpeditionDraft> }
  | { readonly type: 'set-loadout-preset-id'; readonly loadoutPresetId: string }
  | { readonly type: 'set-strategy-preset-id'; readonly strategyPresetId: string }
  | { readonly type: 'set-initial-route-id'; readonly initialRouteId: string };

export function createInitialExpeditionDraft(overrides: Partial<ExpeditionDraft> = {}): ExpeditionDraft {
  return {
    loadoutPresetId: overrides.loadoutPresetId ?? '',
    strategyPresetId: overrides.strategyPresetId ?? DEFAULT_DUNGEON_STRATEGY_ID,
    initialRouteId: overrides.initialRouteId ?? QINGSHE_SAFE_ROUTE_ID,
  };
}

export function expeditionDraftReducer(state: ExpeditionDraft, action: ExpeditionAction): ExpeditionDraft {
  switch (action.type) {
    case 'hydrate':
      return createInitialExpeditionDraft({ ...state, ...action.draft });
    case 'set-loadout-preset-id':
      return { ...state, loadoutPresetId: action.loadoutPresetId };
    case 'set-strategy-preset-id':
      return { ...state, strategyPresetId: action.strategyPresetId };
    case 'set-initial-route-id':
      return { ...state, initialRouteId: action.initialRouteId };
    default:
      return state;
  }
}

export function createDungeonPreviewRequest(characterId: string, draft: ExpeditionDraft): DungeonPreviewRequest {
  return {
    character_id: characterId,
    loadout_preset_id: draft.loadoutPresetId,
    strategy_preset_id: draft.strategyPresetId,
    initial_route_id: draft.initialRouteId,
  };
}

export function isExpeditionDraftReady(draft: ExpeditionDraft): boolean {
  return draft.loadoutPresetId.trim().length > 0 && draft.strategyPresetId.trim().length > 0 && draft.initialRouteId.trim().length > 0;
}
