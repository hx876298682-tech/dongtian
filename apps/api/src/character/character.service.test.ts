import type { FastifyRequest } from 'fastify';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import {
  loadConfigRegistry,
  type ConfigRegistry,
} from '@dongtian/config-schema';
import type {
  CharacterProgressionRecord,
  CharacterRepository,
} from '@dongtian/database';
import type { AuthService } from '../auth/auth.service.js';

import { CharacterService } from './character.service.js';

const registry: ConfigRegistry = loadConfigRegistry({
  releasesRoot: fileURLToPath(new URL('../../../../config/releases', import.meta.url)),
  version: '2026.08.16.1',
});

const request = {} as FastifyRequest;

function makeCharacter(overrides: Partial<CharacterProgressionRecord> = {}): CharacterProgressionRecord {
  return {
    characterId: 'character-1',
    accountId: 'account-1',
    name: '洞天散修',
    stateVersion: '0',
    activeConfigVersion: '2026.08.16.1',
    cultivationXp: '100',
    realmStageId: 'realm.qi.early',
    skills: [{ skillId: 'skill.herbalism', level: 1, xp: '20' }],
    ...overrides,
  };
}

function makeService(character: CharacterProgressionRecord | null): CharacterService {
  const repository: CharacterRepository = {
    async getProgression(characterId, accountId) {
      return character?.characterId === characterId && character.accountId === accountId ? character : null;
    },
  };
  const authService = {
    async requireCurrentAccountId() {
      return 'account-1';
    },
  } as unknown as AuthService;
  return new CharacterService(repository, authService, registry);
}

describe('CharacterService', () => {
  it('maps server-owned cultivation and skill XP at exact thresholds', async () => {
    const result = await makeService(makeCharacter()).getProgression(request, 'character-1');

    expect(result).toMatchObject({
      character: {
        character_id: 'character-1',
        state_version: 0,
        active_config_version: '2026.08.16.1',
      },
      cultivation: {
        xp: '100',
        realm_stage_id: 'realm.qi.early',
        stage_start_xp: '100',
        stage_progress_xp: '0',
        remaining_xp: '2000',
      },
      config_version: '2026.08.16.1',
    });
    expect(result['skills']).toEqual([
      expect.objectContaining({
        skill_id: 'skill.herbalism',
        level: 2,
        xp: '20',
        next_level: 3,
        remaining_xp: '63',
      }),
    ]);

    const permissions = result['feature_permissions'] as Array<Record<string, unknown>>;
    expect(permissions.find((permission) => permission['feature_id'] === 'feature.herbalism')).toEqual(
      expect.objectContaining({ enabled: true, visible: false, usable: false }),
    );
    expect(permissions.find((permission) => permission['feature_id'] === 'feature.market')).toEqual(
      expect.objectContaining({ enabled: false, visible: false, usable: false }),
    );
    expect(result['calculation_as_of']).toEqual(expect.any(String));
  });

  it('does not return another account character', async () => {
    await expect(makeService(makeCharacter({ accountId: 'account-2' })).getProgression(request, 'character-1'))
      .rejects.toMatchObject({
        status: 404,
      });
  });
});
