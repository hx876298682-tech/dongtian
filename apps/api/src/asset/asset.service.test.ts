import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

import type { FastifyRequest } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';

import { computeReleaseContentHash, loadConfigRegistry, type ConfigRegistry } from '@dongtian/config-schema';
import type { AssetRepository, InventorySnapshot } from '@dongtian/database';
import type { AuthService } from '../auth/auth.service.js';

import { AssetService } from './asset.service.js';

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
  ],
  currencies: [
    {
      assetType: 'CURRENCY',
      assetId: 'currency.spirit_stone',
      quantity: '2500.000000',
      reservedQuantity: '500.000000',
      availableQuantity: '2000.000000',
    },
  ],
  equipmentInstances: [],
};

function makeService(snapshot: InventorySnapshot | null): AssetService {
  const repository: AssetRepository = {
    async getInventory() {
      return snapshot;
    },
    async getInventoryOnTransaction() {
      return snapshot;
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
      return 'account-1';
    },
  } as unknown as AuthService;
  return new AssetService(repository, authService, registry);
}

describe('AssetService', () => {
  it('returns authoritative available quantities and applies configured category filters', async () => {
    const result = await makeService(inventory).getInventory({} as FastifyRequest, 'character-1', { category: 'HERB' });

    expect(result).toMatchObject({
      items: [
        {
          asset_type: 'ITEM',
          asset_id: 'item.t1.qingling_herb',
          category: 'HERB',
          quantity: 5,
          reserved_quantity: 2,
          available_quantity: 3,
        },
      ],
      currencies: [
        {
          asset_type: 'CURRENCY',
          asset_id: 'currency.spirit_stone',
          quantity: '2500.000000',
          reserved_quantity: '500.000000',
          available_quantity: '2000.000000',
        },
      ],
      equipment_instances: [],
      total_count: 2,
    });
  });

  it('hides a character that is not returned for the current account', async () => {
    await expect(makeService(null).getInventory({} as FastifyRequest, 'character-2', {})).rejects.toMatchObject({
      status: 404,
    });
  });
});

