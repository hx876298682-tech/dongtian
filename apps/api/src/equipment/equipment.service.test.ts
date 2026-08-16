import type { FastifyRequest } from 'fastify';
import { describe, expect, it, vi } from 'vitest';

import type { ConfigRegistry } from '@dongtian/config-schema';
import type {
  AssetRepository,
  DatabasePool,
  EquipmentRepository,
  InventorySnapshot,
  PoolClient,
} from '@dongtian/database';

import type { AuthService } from '../auth/auth.service.js';
import type { SettlementService } from '../settlement/settlement.service.js';
import { EquipmentService } from './equipment.service.js';

const registry = {
  manifest: { config_version: '2026.08.16.1' },
  getRealm(id: string) {
    return {
      id,
      stage_order: id === 'realm.mortal.entry' ? 0 : 1,
      queue_slots: 1,
      medicine_slots: 1,
    } as never;
  },
  getItem(id: string) {
    const items: Record<string, { realm_required: string; tags: string[] }> = {
      'item.t1.cuizhi_jian': { realm_required: 'realm.mortal.entry', tags: ['equipment', 'weapon'] },
      'item.t1.buyi': { realm_required: 'realm.mortal.entry', tags: ['equipment', 'armor'] },
      'item.t1.qingyu_pei': { realm_required: 'realm.mortal.entry', tags: ['equipment', 'accessory'] },
    };
    const item = items[id];
    if (!item) {
      throw new Error('CONFIG_NOT_FOUND:item');
    }
    return { id, ...item } as never;
  },
  getEquipment(itemId: string) {
    const equipment: Record<string, { slot: 'WEAPON' | 'ARMOR' | 'ACCESSORY'; equip_requirements: { required_realm: string | null; required_tags: string[] } }> = {
      'item.t1.cuizhi_jian': { slot: 'WEAPON', equip_requirements: { required_realm: 'realm.mortal.entry', required_tags: ['weapon'] } },
      'item.t1.buyi': { slot: 'ARMOR', equip_requirements: { required_realm: 'realm.mortal.entry', required_tags: ['armor'] } },
      'item.t1.qingyu_pei': { slot: 'ACCESSORY', equip_requirements: { required_realm: 'realm.mortal.entry', required_tags: ['accessory'] } },
    };
    const record = equipment[itemId];
    if (!record) {
      throw new Error('CONFIG_NOT_FOUND:equipment');
    }
    return { item_id: itemId, modifier_ids: [], attack: 0, defense: 0, hp: 0, speed: 0, power_index: 0, temperable: true, max_temper_level: 6, ...record } as never;
  },
} as unknown as ConfigRegistry;

function makeInventory(
  extraInstances: readonly InventorySnapshot['equipmentInstances'][number][] = [],
): InventorySnapshot {
  return {
    items: [],
    currencies: [],
    equipmentInstances: [
      { instanceId: 'weapon-1', itemId: 'item.t1.cuizhi_jian', temperLevel: 0, bound: false, createdConfigVersion: '2026.08.16.1' },
      { instanceId: 'armor-1', itemId: 'item.t1.buyi', temperLevel: 0, bound: false, createdConfigVersion: '2026.08.16.1' },
      { instanceId: 'accessory-1', itemId: 'item.t1.qingyu_pei', temperLevel: 0, bound: false, createdConfigVersion: '2026.08.16.1' },
      ...extraInstances,
    ],
  };
}

function makeService(options: {
  readonly inventory?: InventorySnapshot | null;
  readonly preset?: Record<string, unknown> | null;
} = {}) {
  const queries: string[] = [];
  const client = {
    async query<T>(sql: string): Promise<{ readonly rows: T[] }> {
      queries.push(sql);
      if (sql.includes('FROM characters c') && sql.includes('active_loadout_preset_id')) {
        return {
          rows: [{
            state_version: '3',
            realm_stage_id: 'realm.mortal.entry',
            active_loadout_preset_id: 'preset-active',
          }] as T[],
        };
      }
      if (sql.includes('FROM characters c') && sql.includes('FOR UPDATE')) {
        return {
          rows: [{
            state_version: '3',
            realm_stage_id: 'realm.mortal.entry',
            active_loadout_preset_id: 'preset-active',
          }] as T[],
        };
      }
      if (sql.includes('INSERT INTO asset_transactions')) {
        return { rows: [{ id: 'asset-tx-1' }] as T[] };
      }
      if (sql.includes('UPDATE characters')) {
        return { rows: [{ state_version: '4', active: true }] as T[] };
      }
      if (sql.includes('INSERT INTO outbox_events')) {
        return { rows: [] as T[] };
      }
      return { rows: [] as T[] };
    },
    release: vi.fn(),
  } as unknown as PoolClient;

  const settlementService = {
    async executeSettledWrite<T>(_request: FastifyRequest, _characterId: string, input: {
      readonly operationType: string;
      readonly request: unknown;
      readonly execute: (context: {
        readonly client: PoolClient;
        readonly settlement: { readonly settlement_id: string; readonly effective_until: string };
        readonly settlementState: { readonly continuationRequired: boolean };
        readonly requestHash: string;
      }) => Promise<{
        readonly statusCode: number;
        readonly response: T;
        readonly transactionId?: string;
        readonly outboxEvents?: readonly unknown[];
      }>;
    }) {
      return input.execute({
        client,
        settlement: {
          settlement_id: 'settlement-1',
          effective_until: '2026-08-16T00:00:01.000Z',
        },
        settlementState: { continuationRequired: false },
        requestHash: 'hash',
      });
    },
  } as unknown as SettlementService;

  const assetRepository: AssetRepository = {
    async getInventory() {
      return options.inventory ?? null;
    },
    async getInventoryOnTransaction() {
      return options.inventory ?? null;
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

  const equipmentRepository: EquipmentRepository = {
    async getLoadoutPreset() {
      if (!options.preset) {
        return null;
      }
      return options.preset as never;
    },
    async listLoadoutPresets() {
      return [];
    },
    async saveLoadoutPreset() {
      return {
        presetId: 'preset-1',
        characterId: 'character-1',
        name: '默认',
        weaponInstanceId: 'weapon-1',
        armorInstanceId: 'armor-1',
        accessoryInstanceId: 'accessory-1',
        combatConsumables: [],
        strategyId: 'strategy.safe',
        version: 1n,
        active: false,
        createdAt: new Date('2026-08-16T00:00:00.000Z'),
        updatedAt: new Date('2026-08-16T00:00:00.000Z'),
      } as never;
    },
    async activateLoadoutPreset() {
      if (!options.preset) {
        throw new Error('EQUIPMENT_PRESET_NOT_FOUND');
      }
      return options.preset as never;
    },
  };

  const authService = {
    async requireCurrentAccountId() {
      return 'account-1';
    },
    async requireWriteAccess() {
      return 'account-1';
    },
  } as unknown as AuthService;

  const pool = {
    async query<T>() {
      return { rows: [] as T[] };
    },
  } as unknown as DatabasePool;

  const service = new EquipmentService(
    settlementService,
    pool,
    assetRepository,
    equipmentRepository,
    registry,
    authService,
  );

  return { service, queries };
}

describe('EquipmentService', () => {
  it('rejects duplicate instances in the same preset save request', async () => {
    const { service } = makeService({ inventory: makeInventory() });
    await expect(service.savePreset({ headers: { 'idempotency-key': '0198f6d7-3f09-7c11-8e2d-000000000010' } } as unknown as FastifyRequest, 'character-1', 'preset-1', {
      expected_state_version: 3,
      name: '默认',
      weapon_instance_id: 'weapon-1',
      armor_instance_id: 'weapon-1',
      accessory_instance_id: 'accessory-1',
      combat_consumables: [],
      strategy_id: 'strategy.safe',
    })).rejects.toMatchObject({
      status: 400,
    });
  });

  it('rejects slot mismatches before persisting a preset', async () => {
    const { service } = makeService({ inventory: makeInventory() });
    await expect(service.savePreset({ headers: { 'idempotency-key': '0198f6d7-3f09-7c11-8e2d-000000000011' } } as unknown as FastifyRequest, 'character-1', 'preset-1', {
      expected_state_version: 3,
      name: '默认',
      weapon_instance_id: null,
      armor_instance_id: 'weapon-1',
      accessory_instance_id: 'accessory-1',
      combat_consumables: [],
      strategy_id: 'strategy.safe',
    })).rejects.toMatchObject({
      status: 400,
    });
  });

  it('rejects equipment that does not belong to the current character', async () => {
    const { service } = makeService({ inventory: makeInventory() });
    await expect(service.savePreset({ headers: { 'idempotency-key': '0198f6d7-3f09-7c11-8e2d-000000000014' } } as unknown as FastifyRequest, 'character-1', 'preset-1', {
      expected_state_version: 3,
      name: '默认',
      weapon_instance_id: 'weapon-missing',
      armor_instance_id: 'armor-1',
      accessory_instance_id: 'accessory-1',
      combat_consumables: [],
      strategy_id: 'strategy.safe',
    })).rejects.toMatchObject({
      status: 404,
    });
  });

  it('rejects missing equipment when enabling a preset', async () => {
    const incompletePreset = {
      presetId: 'preset-1',
      characterId: 'character-1',
      name: '默认',
      weaponInstanceId: 'weapon-1',
      armorInstanceId: null,
      accessoryInstanceId: 'accessory-1',
      combatConsumables: [],
      strategyId: 'strategy.safe',
      version: 1n,
      active: false,
      createdAt: new Date('2026-08-16T00:00:00.000Z'),
      updatedAt: new Date('2026-08-16T00:00:00.000Z'),
    };
    const { service } = makeService({ inventory: makeInventory(), preset: incompletePreset as never });
    await expect(service.equipPreset({ headers: { 'idempotency-key': '0198f6d7-3f09-7c11-8e2d-000000000012' } } as unknown as FastifyRequest, 'character-1', 'preset-1'))
      .rejects.toMatchObject({ status: 400 });
  });

  it('activates a complete preset for the next cycle and writes the state change', async () => {
    const completePreset = {
      presetId: 'preset-1',
      characterId: 'character-1',
      name: '默认',
      weaponInstanceId: 'weapon-1',
      armorInstanceId: 'armor-1',
      accessoryInstanceId: 'accessory-1',
      combatConsumables: [],
      strategyId: 'strategy.safe',
      version: 1n,
      active: true,
      createdAt: new Date('2026-08-16T00:00:00.000Z'),
      updatedAt: new Date('2026-08-16T00:00:00.000Z'),
    };
    const { service, queries } = makeService({ inventory: makeInventory(), preset: completePreset as never });
    const result = await service.equipPreset({ headers: { 'idempotency-key': '0198f6d7-3f09-7c11-8e2d-000000000013' } } as unknown as FastifyRequest, 'character-1', 'preset-1');

    expect(result).toMatchObject({
      preset_id: 'preset-1',
      active: true,
      effective_next_cycle: true,
      state_version: 4,
    });
    expect(queries.some((query) => query.includes('UPDATE characters'))).toBe(true);
    expect(queries.some((query) => query.includes('INSERT INTO outbox_events'))).toBe(true);
  });

  it('returns 404 when the requested preset is owned by another character or missing', async () => {
    const { service } = makeService({ inventory: makeInventory(), preset: null });
    await expect(service.getPreset({} as FastifyRequest, 'character-1', 'preset-missing')).rejects.toMatchObject({
      status: 404,
    });
  });
});
