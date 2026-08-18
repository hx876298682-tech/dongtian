import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { FastifyRequest } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { UnauthorizedException } from '@nestjs/common';

import { computeReleaseContentHash, loadConfigRegistry, type ConfigRegistry } from '@dongtian/config-schema';
import type { AssetRepository, CharacterProgressionRecord, CharacterRepository, InventorySnapshot } from '@dongtian/database';

import type { AuthService } from '../auth/auth.service.js';
import { ContentService } from './content.service.js';

const version = '2026.08.16.1';
const releasePath = fileURLToPath(new URL('../../../../config/releases/2026.08.16.1', import.meta.url));
const temporaryRoots: string[] = [];

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

function copyRelease(): string {
  const root = mkdtempSync(join(tmpdir(), 'dongtian-config-'));
  temporaryRoots.push(root);
  cpSync(releasePath, join(root, version), { recursive: true });

  const manifestPath = join(root, version, 'manifest.json');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as Record<string, unknown>;
  manifest['content_hash'] = computeReleaseContentHash(join(root, version));
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

  return root;
}

const registry: ConfigRegistry = loadConfigRegistry({
  releasesRoot: copyRelease(),
  version,
});

const inventory: InventorySnapshot = {
  items: [
    {
      assetType: 'ITEM',
      assetId: 'item.t1.qingling_herb',
      quantity: '5',
      reservedQuantity: '2',
      availableQuantity: '3',
    },
    {
      assetType: 'ITEM',
      assetId: 'item.t1.qi_gathering_pill',
      quantity: '4',
      reservedQuantity: '1',
      availableQuantity: '3',
    },
  ],
  currencies: [],
  equipmentInstances: [],
};

function makeCharacter(overrides: Partial<CharacterProgressionRecord> = {}): CharacterProgressionRecord {
  return {
    characterId: 'character-1',
    accountId: 'account-1',
    name: '洞天散修',
    stateVersion: '0',
    activeConfigVersion: version,
    cultivationXp: '100',
    realmStageId: 'realm.qi.early',
    skills: [
      { skillId: 'skill.herbalism', level: 1, xp: '20' },
      { skillId: 'skill.alchemy', level: 10, xp: '30' },
    ],
    ...overrides,
  };
}

function makeService(options: {
  readonly character: CharacterProgressionRecord | null;
  readonly inventory?: InventorySnapshot | null;
  readonly auth?: Partial<AuthService>;
}): ContentService {
  const characterRepository: CharacterRepository = {
    async getProgression(characterId, accountId) {
      return options.character?.characterId === characterId && options.character.accountId === accountId
        ? options.character
        : null;
    },
  };
  const assetRepository: AssetRepository = {
    async getInventory() {
      return options.inventory ?? inventory;
    },
    async getInventoryOnTransaction() {
      return options.inventory ?? inventory;
    },
    async add() {
      throw new Error('not used');
    },
    async addOnTransaction() {
      throw new Error('not used');
    },
    async deduct() {
      throw new Error('not used');
    },
    async deductOnTransaction() {
      throw new Error('not used');
    },
    async reserve() {
      throw new Error('not used');
    },
    async reserveOnTransaction() {
      throw new Error('not used');
    },
    async findActiveReservationsByBusiness() {
      return [];
    },
    async release() {
      throw new Error('not used');
    },
    async releaseOnTransaction() {
      throw new Error('not used');
    },
    async consume() {
      throw new Error('not used');
    },
    async consumeOnTransaction() {
      throw new Error('not used');
    },
    async audit() {
      return { ok: true, discrepancyCount: 0, discrepancies: [] };
    },
  };
  const authService = {
    async requireCurrentAccountId() {
      if (options.auth?.requireCurrentAccountId) {
        return options.auth.requireCurrentAccountId({} as never);
      }
      return 'account-1';
    },
    async requireCurrentCharacterId() {
      if (options.auth?.requireCurrentCharacterId) {
        return options.auth.requireCurrentCharacterId({} as never);
      }
      return 'character-1';
    },
  } as unknown as AuthService;
  return new ContentService(authService, characterRepository, assetRepository, registry);
}

describe('ContentService', () => {
  it('returns action and recipe catalog entries with unlock state and route metadata', async () => {
    const result = await makeService({ character: makeCharacter() }).getActions({} as FastifyRequest);

    expect(result).toMatchObject({
      character: {
        character_id: 'character-1',
        realm_stage_id: 'realm.qi.early',
      },
      config_version: version,
    });

    const actions = result['actions'] as Array<Record<string, unknown>>;
    expect(actions.find((action) => action['action_id'] === 'action.cultivation.qi')).toEqual(
      expect.objectContaining({
        unlocked: true,
        can_add_to_queue: true,
        queue_action_id: 'action.cultivation.qi',
        unlock_state: expect.objectContaining({ usable: true }),
      }),
    );
    expect(actions.find((action) => action['action_id'] === 'action.t1.herb_baicao_valley')).toEqual(
      expect.objectContaining({
        unlocked: true,
        unlock_state: expect.objectContaining({
          usable: true,
        }),
      }),
    );

    const recipes = (await makeService({ character: makeCharacter() }).getRecipes({} as FastifyRequest))[
      'recipes'
    ] as Array<Record<string, unknown>>;
    expect(recipes.find((recipe) => recipe['recipe_id'] === 'recipe.t1.qi_gathering_pill')).toEqual(
      expect.objectContaining({
        unlocked: true,
        queue_action_id: 'action.t1.qi_gathering_pill',
        ingredients: expect.arrayContaining([
          expect.objectContaining({
            item_id: 'item.t1.qingling_herb',
            available_quantity: 3,
            reserved_quantity: 2,
            quantity_owned: 5,
          }),
        ]),
      }),
    );
  });

  it('derives pre-foundation realm permissions from cultivation XP', async () => {
    const result = await makeService({
      character: makeCharacter({ cultivationXp: '2100', realmStageId: 'realm.mortal.entry' }),
    }).getActions({} as FastifyRequest);
    const actions = result['actions'] as Array<Record<string, unknown>>;

    expect(result).toMatchObject({ character: { realm_stage_id: 'realm.qi.mid' } });
    expect(actions.find((action) => action['action_id'] === 'action.t1.ore_xuantie_kuang')).toEqual(
      expect.objectContaining({ unlocked: true }),
    );
  });

  it('returns inventory metadata with authoritative quantities and routes', async () => {
    const result = await makeService({ character: makeCharacter() }).getInventory({} as FastifyRequest, 'character-1');
    expect(result).toMatchObject({
      items: expect.arrayContaining([
        expect.objectContaining({
          asset_id: 'item.t1.qingling_herb',
          quantity: 5,
          reserved_quantity: 2,
          available_quantity: 3,
          source_routes: expect.arrayContaining([
            expect.objectContaining({ route_type: 'ACTION', target_id: 'action.t1.herb_baicao_valley' }),
          ]),
          usage_routes: expect.arrayContaining([
            expect.objectContaining({ route_type: 'ACTION', target_id: 'action.t1.qi_gathering_pill' }),
          ]),
        }),
      ]),
    });
  });

  it('surfaces a locked reason for an action the character cannot use', async () => {
    const result = await makeService({
      character: makeCharacter({ realmStageId: 'realm.mortal.entry', skills: [{ skillId: 'skill.herbalism', level: 1, xp: '0' }] }),
    }).getActions({} as FastifyRequest);
    const action = (result['actions'] as Array<Record<string, unknown>>).find(
      (entry) => entry['action_id'] === 'action.t1.qi_gathering_pill',
    );

    expect(action).toEqual(
      expect.objectContaining({
        unlocked: false,
        unlock_state: expect.objectContaining({
          reason: expect.stringContaining('技能等级不足'),
        }),
      }),
    );
  });

  it('hides unknown inventory items without crashing and rejects missing ownership', async () => {
    const unknownInventory: InventorySnapshot = {
      items: [
        {
          assetType: 'ITEM',
          assetId: 'item.t1.unknown',
          quantity: '1',
          reservedQuantity: '0',
          availableQuantity: '1',
        },
      ],
      currencies: [],
      equipmentInstances: [],
    };

    const inventoryResult = await makeService({
      character: makeCharacter(),
      inventory: unknownInventory,
    }).getInventory({} as FastifyRequest, 'character-1');

    expect(inventoryResult).toMatchObject({ items: [] });

    await expect(
      makeService({
        character: null,
      }).getActions({} as FastifyRequest),
    ).rejects.toMatchObject({ status: 404 });
  });

  it('rejects unauthorized reads', async () => {
    await expect(
      makeService({
        character: makeCharacter(),
        auth: {
          async requireCurrentAccountId() {
            throw new UnauthorizedException('UNAUTHENTICATED');
          },
        },
      }).getActions({} as FastifyRequest),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });
});
