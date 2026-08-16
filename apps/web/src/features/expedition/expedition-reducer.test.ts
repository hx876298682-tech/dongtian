import { describe, expect, it } from 'vitest';

import {
  createDungeonPreviewRequest,
  createInitialExpeditionDraft,
  expeditionDraftReducer,
  DEFAULT_DUNGEON_STRATEGY_ID,
  QINGSHE_SAFE_ROUTE_ID,
} from './expedition-reducer.js';

describe('expedition reducer', () => {
  it('creates the expected default draft and request payload', () => {
    const draft = createInitialExpeditionDraft();

    expect(draft.strategyPresetId).toBe(DEFAULT_DUNGEON_STRATEGY_ID);
    expect(draft.initialRouteId).toBe(QINGSHE_SAFE_ROUTE_ID);
    expect(createDungeonPreviewRequest('character-1', draft)).toEqual({
      character_id: 'character-1',
      loadout_preset_id: '',
      strategy_preset_id: DEFAULT_DUNGEON_STRATEGY_ID,
      initial_route_id: QINGSHE_SAFE_ROUTE_ID,
    });
  });

  it('hydrates and mutates the expedition draft', () => {
    const hydrated = expeditionDraftReducer(createInitialExpeditionDraft(), {
      type: 'hydrate',
      draft: {
        loadoutPresetId: 'preset-1',
        strategyPresetId: 'strategy.safe',
      },
    });

    expect(hydrated.loadoutPresetId).toBe('preset-1');
    expect(hydrated.strategyPresetId).toBe('strategy.safe');

    const updated = expeditionDraftReducer(hydrated, {
      type: 'set-initial-route-id',
      initialRouteId: 'route.t1.qingshe_cave.deep_den',
    });

    expect(updated.initialRouteId).toBe('route.t1.qingshe_cave.deep_den');
  });
});
