import { describe, expect, it } from 'vitest';

import type { CaveResponse } from '@dongtian/contracts';

import { cavePageReducer, createInitialCavePageState } from './cave-reducer.js';

const response: CaveResponse = {
  character: {
    character_id: 'character-1',
    state_version: 12,
    active_config_version: '2026.08.16.1',
  },
  cave: {
    as_of: '2026-08-16T00:00:00.000Z',
    config_version: '2026.08.16.1',
    facilities: [
      {
        facility_config_id: 'cave_facility.juling_room',
        facility_kind: 'JULING_ROOM',
        name_key: 'cave.facility.juling_room.name',
        description_key: 'cave.facility.juling_room.description',
        level: 1,
        current_modifier: null,
        next_level_rule: null,
        build_task: null,
      },
    ],
  },
};

describe('cave reducer', () => {
  it('preserves selection and idempotency state across hydrate and submit cycles', () => {
    const initial = {
      ...createInitialCavePageState('cave_facility.juling_room'),
      pendingIdempotencyKey: 'key-old',
      lastErrorMessage: 'network',
    };

    const hydrated = cavePageReducer(initial, {
      type: 'hydrate',
      response,
      preferredFacilityId: 'cave_facility.juling_room',
    });

    expect(hydrated.selectedFacilityId).toBe('cave_facility.juling_room');
    expect(hydrated.pendingIdempotencyKey).toBe('key-old');
    expect(hydrated.lastErrorMessage).toBe('network');

    const preparing = cavePageReducer(hydrated, { type: 'prepare-submit', idempotencyKey: 'key-1' });
    expect(preparing.pendingIdempotencyKey).toBe('key-1');
    expect(preparing.confirmationOpen).toBe(false);

    const succeeded = cavePageReducer(preparing, { type: 'mark-success', response });
    expect(succeeded.pendingIdempotencyKey).toBeNull();
    expect(succeeded.lastBuildResponse).toBe(response);
  });
});
