import { BadRequestException, ForbiddenException, UnprocessableEntityException } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { describe, expect, it, vi } from 'vitest';

import type { ConfigRegistry } from '@dongtian/config-schema';
import type {
  AssetRepository,
  CaveBuildTaskRecord,
  CaveRepository,
  CaveStateRecord,
  DatabasePool,
  InventorySnapshot,
  PoolClient,
} from '@dongtian/database';

import type { AuthService } from '../auth/auth.service.js';
import type { SettlementService } from '../settlement/settlement.service.js';
import { CaveService } from './cave.service.js';

const caveFacilities = [
    {
      id: 'cave_facility.juling_room.lv1',
      facility_id: 'cave_facility.juling_room',
      name_key: 'cave_facility.juling_room.lv1.name',
      description_key: 'cave_facility.juling_room.lv1.desc',
      enabled: true,
      deprecated: false,
      realm_required: 'realm.qi.early',
      sort_order: 1,
      tags: ['cave'],
      source_note: 'test',
      level: 1,
      facility_kind: 'JULING_ROOM',
      spirit_stone_cost: '200',
      material_costs: [{ item_id: 'item.t1.qingzhu', quantity: '30' }],
      build_duration_us: '7200000000',
      effect_type: 'cultivation_efficiency',
      effect_value: '0.03',
      scope: 'MVP',
    },
    {
      id: 'cave_facility.juling_room.lv2',
      facility_id: 'cave_facility.juling_room',
      name_key: 'cave_facility.juling_room.lv2.name',
      description_key: 'cave_facility.juling_room.lv2.desc',
      enabled: true,
      deprecated: false,
      realm_required: 'realm.qi.early',
      sort_order: 2,
      tags: ['cave'],
      source_note: 'test',
      level: 2,
      facility_kind: 'JULING_ROOM',
      spirit_stone_cost: '700',
      material_costs: [{ item_id: 'item.t1.qingzhu', quantity: '80' }],
      build_duration_us: '14400000000',
      effect_type: 'cultivation_efficiency',
      effect_value: '0.04',
      scope: 'MVP',
    },
    {
      id: 'cave_facility.juling_room.lv3',
      facility_id: 'cave_facility.juling_room',
      name_key: 'cave_facility.juling_room.lv3.name',
      description_key: 'cave_facility.juling_room.lv3.desc',
      enabled: true,
      deprecated: false,
      realm_required: 'realm.foundation.early',
      sort_order: 3,
      tags: ['cave'],
      source_note: 'test',
      level: 3,
      facility_kind: 'JULING_ROOM',
      spirit_stone_cost: '2200',
      material_costs: [{ item_id: 'item.t1.qingzhu', quantity: '180' }],
      build_duration_us: '21600000000',
      effect_type: 'cultivation_efficiency',
      effect_value: '0.05',
      scope: 'MVP',
    },
  ];

const registry = {
  manifest: { config_version: '2026.08.16.1' } as unknown as ConfigRegistry['manifest'],
  caveFacilities,
  getCaveFacility(id: string) {
    const facility = caveFacilities.find((entry) => entry.facility_id === id);
    if (!facility) {
      throw new Error(`CONFIG_NOT_FOUND:cave_facility:${id}`);
    }
    return facility;
  },
  getRealm(id: string) {
    if (id.includes('foundation')) {
      return { id, realm_group: 'FOUNDATION' } as never;
    }
    if (id.includes('mortal')) {
      return { id, realm_group: 'MORTAL' } as never;
    }
    return { id, realm_group: 'QI' } as never;
  },
} as unknown as Pick<ConfigRegistry, 'manifest' | 'caveFacilities' | 'getCaveFacility' | 'getRealm'>;

function makeInventory(overrides: Partial<InventorySnapshot> = {}): InventorySnapshot {
  return {
    items: [
      { assetType: 'ITEM', assetId: 'item.t1.qingzhu', quantity: '300', reservedQuantity: '0', availableQuantity: '300' },
    ],
    currencies: [
      { assetType: 'CURRENCY', assetId: 'currency.spirit_stone', quantity: '10000', reservedQuantity: '0', availableQuantity: '10000' },
    ],
    equipmentInstances: [],
    ...overrides,
  };
}

function makeClient(
  state: { stateVersion: string },
  dueTaskState?: { readonly complete?: boolean },
  realmStageId = 'realm.qi.early',
) {
  return {
    async query<T>(sql: string, _args?: readonly unknown[]): Promise<{ readonly rows: T[] }> {
      if (sql.includes('FROM characters c') && sql.includes('INNER JOIN character_progression')) {
        return {
          rows: [{
            character_id: 'character-1',
            state_version: state.stateVersion,
            active_config_version: '2026.08.16.1',
            realm_stage_id: realmStageId,
          }] as T[],
        };
      }
      if (sql.includes('SELECT state_version::text AS state_version FROM characters')) {
        return { rows: [{ state_version: state.stateVersion }] as T[] };
      }
      if (sql.includes('UPDATE characters')) {
        state.stateVersion = String(Number(state.stateVersion) + 1);
        return { rows: [{ state_version: state.stateVersion }] as T[] };
      }
      if (sql.includes('INSERT INTO asset_transactions')) {
        return { rows: [{ id: 'asset-tx-1' }] as T[] };
      }
      if (sql.includes('INSERT INTO outbox_events')) {
        return { rows: [] as T[] };
      }
      if (sql.includes('FROM cave_build_tasks') && sql.includes("status = 'RUNNING'")) {
        if (dueTaskState?.complete) {
          return {
            rows: [{
              id: 'build-1',
              character_id: 'character-1',
              facility_config_id: 'cave_facility.juling_room',
              from_level: 0,
              target_level: 1,
              status: 'RUNNING',
              started_at: new Date('2026-08-16T00:00:00.000Z'),
              complete_at: new Date('2026-08-16T01:00:00.000Z'),
              cost_transaction_id: 'cost-tx-1',
              complete_transaction_id: null,
              config_version: '2026.08.16.1',
              created_at: new Date('2026-08-16T00:00:00.000Z'),
              updated_at: new Date('2026-08-16T00:00:00.000Z'),
            }] as T[],
          };
        }
        return { rows: [] as T[] };
      }
      return { rows: [] as T[] };
    },
  } as unknown as PoolClient;
}

function makeService(options: {
  readonly cave?: CaveStateRecord | null;
  readonly inventory?: InventorySnapshot | null;
  readonly dueTasks?: readonly CaveBuildTaskRecord[];
  readonly stateVersion?: string;
  readonly realmStageId?: string;
  readonly currentRealmGroup?: 'QI' | 'MORTAL' | 'FOUNDATION';
} = {}) {
  const state = { stateVersion: options.stateVersion ?? '3' };
  let caveState: CaveStateRecord | null = options.cave ?? {
    characterId: 'character-1',
    facilities: [{
      characterId: 'character-1',
      facilityConfigId: 'cave_facility.juling_room',
      level: 0,
      createdAt: new Date('2026-08-16T00:00:00.000Z'),
      updatedAt: new Date('2026-08-16T00:00:00.000Z'),
    }],
    buildTasks: [...(options.dueTasks ?? [])],
  };
  const client = makeClient(
    state,
    { complete: options.dueTasks?.some((task) => task.completeAt <= new Date('2026-08-16T01:00:00.000Z')) ?? false },
    options.realmStageId,
  );
  const transactionCallbacks: Array<{ readonly operationType: string; readonly request: unknown }> = [];
  const settlementCache = new Map<string, { readonly statusCode: number; readonly response: unknown }>();
  const settlementService = {
    async executeSettledWrite<T>(_request: FastifyRequest, _characterId: string, input: {
      readonly operationType: string;
      readonly request: unknown;
      readonly execute: (context: {
        readonly client: PoolClient;
        readonly settlement: { readonly settlement_id: string };
        readonly settlementState: { readonly continuationRequired: boolean };
        readonly requestHash: string;
      }) => Promise<{ readonly statusCode: number; readonly response: T }>;
    }) {
      const requestHash = `${_request.headers['idempotency-key'] ?? ''}:${JSON.stringify(input.request)}`;
      const cached = settlementCache.get(requestHash) as { readonly statusCode: number; readonly response: T } | undefined;
      if (cached) {
        return cached;
      }
      transactionCallbacks.push({ operationType: input.operationType, request: input.request });
      const result = await input.execute({
        client,
        settlement: { settlement_id: 'settlement-1' },
        settlementState: { continuationRequired: false },
        requestHash,
      });
      settlementCache.set(requestHash, result);
      return result;
    },
  } as unknown as SettlementService;
  const caveRepository: CaveRepository = {
    async getState() {
      return caveState;
    },
    async lockState() {
      return caveState;
    },
    async ensureFacilitiesOnTransaction() {
      return undefined;
    },
    async createBuildTaskOnTransaction() {
      const startedAt = new Date();
      const task: CaveBuildTaskRecord = {
        id: 'build-task-1',
        characterId: 'character-1',
        facilityConfigId: 'cave_facility.juling_room',
        fromLevel: 0,
        targetLevel: 1,
        status: 'RUNNING',
        startedAt,
        completeAt: new Date(startedAt.getTime() + 2 * 60 * 60 * 1000),
        costTransactionId: 'asset-tx-1',
        completeTransactionId: null,
        configVersion: '2026.08.16.1',
        createdAt: startedAt,
        updatedAt: startedAt,
      };
      caveState = caveState === null ? {
        characterId: 'character-1',
        facilities: [],
        buildTasks: [task],
      } : {
        ...caveState,
        buildTasks: [...caveState.buildTasks, task],
      };
      return task;
    },
    async listDueBuildTasksOnTransaction() {
      return [...(options.dueTasks ?? [])];
    },
    async completeBuildTaskOnTransaction(_client, input) {
      const task = options.dueTasks?.find((entry) => entry.id === input.buildTaskId) ?? null;
      return task ?? null;
    },
    async runRecoveryBatch() {
      return 1;
    },
  };
  const assetRepository: AssetRepository = {
    async getInventory() {
      return options.inventory ?? makeInventory();
    },
    async getInventoryOnTransaction() {
      return options.inventory ?? makeInventory();
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
      return {
        assetType: 'ITEM',
        assetId: 'item.t1.qingzhu',
        quantity: '1',
        reservedQuantity: '0',
        availableQuantity: '1',
        transactionId: 'asset-tx-1',
        ledgerEntryId: 'ledger-1',
      } as never;
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
    async requireWriteAccess() {
      return 'account-1';
    },
    async assertCharacterOwnership() {
      return undefined;
    },
  } as unknown as AuthService;
  const pool = {
    async query<T>(sql: string): Promise<{ readonly rows: T[] }> {
      if (sql.includes('FROM characters c') && sql.includes('INNER JOIN character_progression')) {
        return {
          rows: [{
            character_id: 'character-1',
            state_version: state.stateVersion,
            active_config_version: '2026.08.16.1',
            realm_stage_id: options.realmStageId ?? 'realm.qi.early',
          }] as T[],
        };
      }
      return { rows: [] as T[] };
    },
  } as unknown as DatabasePool;

  const service = new CaveService(
    caveRepository,
    assetRepository,
    settlementService,
    authService,
    pool,
    registry as unknown as ConfigRegistry,
  );

  return { service, settlementService, transactionCallbacks, state };
}

type CaveBuildResponse = Awaited<ReturnType<CaveService['build']>>;

function makeRequest(idempotencyKeyValue = 'key-1'): FastifyRequest {
  return {
    headers: { 'idempotency-key': idempotencyKeyValue },
    cookies: {},
  } as unknown as FastifyRequest;
}

describe('cave service', () => {
  it('starts a build and returns the projected running task', async () => {
    const { service } = makeService({
      inventory: makeInventory(),
      cave: {
        characterId: 'character-1',
        facilities: [{
          characterId: 'character-1',
          facilityConfigId: 'cave_facility.juling_room',
          level: 0,
          createdAt: new Date('2026-08-16T00:00:00.000Z'),
          updatedAt: new Date('2026-08-16T00:00:00.000Z'),
        }],
        buildTasks: [],
      },
    });

    const response = await service.build(makeRequest(), 'character-1', {
      facility_id: 'cave_facility.juling_room',
      target_level: 1,
      expected_state_version: 3,
      config_version: '2026.08.16.1',
    });

    expect(response.cave.facilities[0]?.build_task?.status).toBe('RUNNING');
    expect(response.cave.facilities[0]?.level).toBe(0);
    expect(response.cave.facilities).toHaveLength(1);
    expect(response.character.state_version).toBe(4);
  });

  it('rejects insufficient build cost and realm prerequisites', async () => {
    const insufficient = makeService({
      inventory: {
        ...makeInventory(),
        items: [{ assetType: 'ITEM', assetId: 'item.t1.qingzhu', quantity: '10', reservedQuantity: '0', availableQuantity: '10' }],
      },
    });

    await expect(insufficient.service.build(makeRequest(), 'character-1', {
      facility_id: 'cave_facility.juling_room',
      target_level: 1,
      expected_state_version: 3,
      config_version: '2026.08.16.1',
    })).rejects.toBeInstanceOf(UnprocessableEntityException);

    const locked = makeService({ inventory: makeInventory(), realmStageId: 'realm.mortal.entry' });
    await expect(locked.service.build(makeRequest(), 'character-1', {
      facility_id: 'cave_facility.juling_room',
      target_level: 1,
      expected_state_version: 3,
      config_version: '2026.08.16.1',
    })).rejects.toBeInstanceOf(ForbiddenException);

    await expect(locked.service.build(makeRequest(), 'character-1', {
      facility_id: 'cave_facility.juling_room',
      target_level: 2,
      expected_state_version: 3,
      config_version: '2026.08.16.1',
    })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('projects same-time completion to the next cycle boundary on read', async () => {
    const buildTask: CaveBuildTaskRecord = {
      id: 'build-1',
      characterId: 'character-1',
      facilityConfigId: 'cave_facility.juling_room',
      fromLevel: 0,
      targetLevel: 1,
      status: 'RUNNING',
      startedAt: new Date('2026-08-16T00:00:00.000Z'),
      completeAt: new Date('2026-08-16T01:00:00.000Z'),
      costTransactionId: 'asset-tx-1',
      completeTransactionId: null,
      configVersion: '2026.08.16.1',
      createdAt: new Date('2026-08-16T00:00:00.000Z'),
      updatedAt: new Date('2026-08-16T00:00:00.000Z'),
    };
    const { service } = makeService({
      cave: {
        characterId: 'character-1',
        facilities: [{
          characterId: 'character-1',
          facilityConfigId: 'cave_facility.juling_room',
          level: 0,
          createdAt: new Date('2026-08-16T00:00:00.000Z'),
          updatedAt: new Date('2026-08-16T00:00:00.000Z'),
        }],
        buildTasks: [buildTask],
      },
      dueTasks: [buildTask],
    });

    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-16T01:00:00.000Z'));
    try {
      const response = await service.getCave(makeRequest(), 'character-1');
      const facility = response.cave.facilities[0];
      expect(facility?.level).toBe(1);
      expect(facility?.build_task?.status).toBe('COMPLETED');
      expect(facility?.build_task?.completion_boundary).toEqual({
        currentCycleApplies: false,
        nextCycleApplies: true,
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it('reuses the first response for repeated requests with the same idempotency key', async () => {
    const responses: CaveBuildResponse[] = [];
    const { service, transactionCallbacks } = makeService({
      inventory: makeInventory(),
    });
    const request = {
      facility_id: 'cave_facility.juling_room',
      target_level: 1,
      expected_state_version: 3,
      config_version: '2026.08.16.1',
    };
    const first = await service.build(makeRequest('repeat-key'), 'character-1', request);
    responses.push(first);
    const second = await service.build(makeRequest('repeat-key'), 'character-1', request);
    responses.push(second);
    expect(second.character.state_version).toBe(first.character.state_version);
    expect(transactionCallbacks).toHaveLength(1);
  });
});
