import type { FastifyRequest } from 'fastify';
import { describe, expect, it, vi } from 'vitest';

import type { ConfigRegistry } from '@dongtian/config-schema';
import type {
  AssetRepository,
  DatabasePool,
  InventorySnapshot,
  PoolClient,
  SkillToolAssignmentRepository,
} from '@dongtian/database';
import { createToolLoadout, microseconds, projectToolHourlyThroughput } from '@dongtian/game-rules';

import type { AuthService } from '../auth/auth.service.js';
import type { SettlementService } from '../settlement/settlement.service.js';
import { SkillToolAssignmentsService } from './skill-tool-assignments.service.js';

type MutableState = {
  stateVersion: string;
  realmStageId: string;
  assignments: Array<{ skillId: string; equipmentInstanceId: string; itemId: string; version: bigint; updatedAt: Date }>;
};

function buildRegistry(): ConfigRegistry {
  const realms = {
    'realm.mortal.entry': { id: 'realm.mortal.entry', stage_order: 0 },
    'realm.qi.early': { id: 'realm.qi.early', stage_order: 1 },
  } as Record<string, { readonly id: string; readonly stage_order: number }>;

  const items = {
    'item.t1.mubing_yaochu': {
      id: 'item.t1.mubing_yaochu',
      name_key: 'item.mubing_yaochu.name',
      source_note: 'source-1',
      realm_required: 'realm.mortal.entry',
      tags: ['equipment', 'tool', 'herbalism_tool'],
    },
    'item.t1.qingtong_yaochu': {
      id: 'item.t1.qingtong_yaochu',
      name_key: 'item.qingtong_yaochu.name',
      source_note: 'source-2',
      realm_required: 'realm.qi.early',
      tags: ['equipment', 'tool', 'herbalism_tool'],
    },
    'item.t1.mubing_kuanggao': {
      id: 'item.t1.mubing_kuanggao',
      name_key: 'item.mubing_kuanggao.name',
      source_note: 'source-3',
      realm_required: 'realm.qi.early',
      tags: ['equipment', 'tool', 'mining_tool'],
    },
    'item.t1.qingtong_kuanggao': {
      id: 'item.t1.qingtong_kuanggao',
      name_key: 'item.qingtong_kuanggao.name',
      source_note: 'source-4',
      realm_required: 'realm.qi.early',
      tags: ['equipment', 'tool', 'mining_tool'],
    },
    'item.t1.cuizhi_danlu': {
      id: 'item.t1.cuizhi_danlu',
      name_key: 'item.cuizhi_danlu.name',
      source_note: 'source-5',
      realm_required: 'realm.mortal.entry',
      tags: ['equipment', 'tool', 'alchemy_tool'],
    },
    'item.t1.qingtong_danlu': {
      id: 'item.t1.qingtong_danlu',
      name_key: 'item.qingtong_danlu.name',
      source_note: 'source-6',
      realm_required: 'realm.qi.early',
      tags: ['equipment', 'tool', 'alchemy_tool'],
    },
  } as Record<string, {
    readonly id: string;
    readonly name_key: string;
    readonly source_note: string;
    readonly realm_required: string;
    readonly tags: readonly string[];
  }>;

  const equipments = [
    {
      item_id: 'item.t1.mubing_yaochu',
      slot: 'TOOL',
      equip_requirements: { required_realm: 'realm.mortal.entry', required_tags: ['tool'] },
      tool_effects: [{ skill_id: 'skill.herbalism', action_speed_bonus: '0', action_efficiency_bonus: '0' }],
    },
    {
      item_id: 'item.t1.qingtong_yaochu',
      slot: 'TOOL',
      equip_requirements: { required_realm: 'realm.qi.early', required_tags: ['tool'] },
      tool_effects: [{ skill_id: 'skill.herbalism', action_speed_bonus: '0.12', action_efficiency_bonus: '0.05' }],
    },
    {
      item_id: 'item.t1.mubing_kuanggao',
      slot: 'TOOL',
      equip_requirements: { required_realm: 'realm.qi.early', required_tags: ['tool'] },
      tool_effects: [{ skill_id: 'skill.mining', action_speed_bonus: '0', action_efficiency_bonus: '0' }],
    },
    {
      item_id: 'item.t1.qingtong_kuanggao',
      slot: 'TOOL',
      equip_requirements: { required_realm: 'realm.qi.early', required_tags: ['tool'] },
      tool_effects: [{ skill_id: 'skill.mining', action_speed_bonus: '0.12', action_efficiency_bonus: '0.05' }],
    },
    {
      item_id: 'item.t1.cuizhi_danlu',
      slot: 'TOOL',
      equip_requirements: { required_realm: 'realm.mortal.entry', required_tags: ['tool'] },
      tool_effects: [{ skill_id: 'skill.alchemy', action_speed_bonus: '0', action_efficiency_bonus: '0' }],
    },
    {
      item_id: 'item.t1.qingtong_danlu',
      slot: 'TOOL',
      equip_requirements: { required_realm: 'realm.qi.early', required_tags: ['tool'] },
      tool_effects: [{ skill_id: 'skill.alchemy', action_speed_bonus: '0.1', action_efficiency_bonus: '0.06' }],
    },
  ] as const;

  return {
    manifest: { config_version: '2026.08.16.1', formula_version: 1 },
    getRealm(id: string) {
      const realm = realms[id];
      if (!realm) {
        throw new Error(`CONFIG_NOT_FOUND:realm:${id}`);
      }
      return realm as never;
    },
    getItem(id: string) {
      const item = items[id];
      if (!item) {
        throw new Error(`CONFIG_NOT_FOUND:item:${id}`);
      }
      return item as never;
    },
    getEquipment(itemId: string) {
      const equipment = equipments.find((entry) => entry.item_id === itemId);
      if (!equipment) {
        throw new Error(`CONFIG_NOT_FOUND:equipment:${itemId}`);
      }
      return equipment as never;
    },
    get equipments() {
      return equipments as never;
    },
    get actions() {
      return [] as never;
    },
    get recipes() {
      return [] as never;
    },
  } as unknown as ConfigRegistry;
}

function makeInventory(instances: readonly { readonly instanceId: string; readonly itemId: string }[]): InventorySnapshot {
  return {
    items: [],
    currencies: [],
    equipmentInstances: instances.map((instance) => ({
      instanceId: instance.instanceId,
      itemId: instance.itemId,
      temperLevel: 0,
      bound: false,
      createdConfigVersion: '2026.08.16.1',
    })),
  };
}

function makeService(state: MutableState, inventory: InventorySnapshot) {
  const queries: string[] = [];
  const client = {
    async query<T>(sql: string): Promise<{ readonly rows: T[] }> {
      queries.push(sql);
      if (sql.includes('FROM characters c') && sql.includes('FOR UPDATE')) {
        return {
          rows: [{
            state_version: state.stateVersion,
            realm_stage_id: state.realmStageId,
          }] as T[],
        };
      }
      if (sql.includes('FROM characters c') && sql.includes('account_id')) {
        return {
          rows: [{
            state_version: state.stateVersion,
            realm_stage_id: state.realmStageId,
          }] as T[],
        };
      }
      if (sql.includes('INSERT INTO asset_transactions')) {
        return { rows: [{ id: 'audit-1' }] as T[] };
      }
      if (sql.includes('UPDATE characters')) {
        const nextVersion = String(Number(state.stateVersion) + 1);
        state.stateVersion = nextVersion;
        return { rows: [{ state_version: nextVersion }] as T[] };
      }
      return { rows: [] as T[] };
    },
    release: vi.fn(),
  } as unknown as PoolClient;

  const pool = {
    async query<T>(sql: string): Promise<{ readonly rows: T[] }> {
      queries.push(sql);
      if (sql.includes('FROM characters c') && sql.includes('account_id')) {
        return {
          rows: [{
            state_version: state.stateVersion,
            realm_stage_id: state.realmStageId,
          }] as T[],
        };
      }
      return { rows: [] as T[] };
    },
    connect: vi.fn(async () => client),
  } as unknown as DatabasePool;

  const repository: SkillToolAssignmentRepository = {
    async getAssignments() {
      return state.assignments.map((assignment) => ({ ...assignment, characterId: 'character-1' }));
    },
    async replaceAssignments(_, input) {
      state.assignments = input.assignments.map((assignment) => {
        const itemId = assignment.equipmentInstanceId === 'tool-2'
          ? 'item.t1.qingtong_kuanggao'
          : assignment.equipmentInstanceId === 'tool-3'
            ? 'item.t1.qingtong_danlu'
            : 'item.t1.qingtong_yaochu';
        return {
          characterId: 'character-1',
          skillId: assignment.skillId,
          equipmentInstanceId: assignment.equipmentInstanceId,
          itemId,
          version: 1n,
          updatedAt: new Date('2026-08-16T00:00:00.000Z'),
        };
      });
      return state.assignments.map((assignment) => ({ ...assignment, characterId: 'character-1' }));
    },
  };

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
      void input.operationType;
      void input.request;
      return input.execute({
        client,
        settlement: {
          settlement_id: 'settlement-1',
          effective_until: '2026-08-16T00:00:00.000Z',
        },
        settlementState: { continuationRequired: false },
        requestHash: 'hash',
      });
    },
  } as unknown as SettlementService;

  const assetRepository: AssetRepository = {
    async getInventory() {
      return inventory;
    },
    async getInventoryOnTransaction() {
      return inventory;
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
    async requireWriteAccess() {
      return 'account-1';
    },
  } as unknown as AuthService;

  const service = new SkillToolAssignmentsService(
    settlementService,
    assetRepository,
    repository,
    buildRegistry(),
    authService,
    pool,
  );

  return { service, state, queries };
}

describe('skill tool assignment service', () => {
  it('reads owned tool assignments and projects using the shared tool rule', async () => {
    const { service } = makeService(
      {
        stateVersion: '3',
        realmStageId: 'realm.qi.early',
        assignments: [{
          skillId: 'skill.herbalism',
          equipmentInstanceId: 'tool-1',
          itemId: 'item.t1.qingtong_yaochu',
          version: 1n,
          updatedAt: new Date('2026-08-16T00:00:00.000Z'),
        }],
      },
      makeInventory([
        { instanceId: 'tool-1', itemId: 'item.t1.qingtong_yaochu' },
        { instanceId: 'tool-2', itemId: 'item.t1.qingtong_kuanggao' },
      ]),
    );

    const response = await service.getAssignments({} as unknown as FastifyRequest, 'character-1');

    expect(response).toMatchObject({
      character_id: 'character-1',
      state_version: 3,
    });
    expect(response.assignments.map((entry) => entry.skill_id)).toEqual([
      'skill.alchemy',
      'skill.herbalism',
      'skill.mining',
    ]);

    const herbalism = response.assignments.find((entry) => entry.skill_id === 'skill.herbalism');
    expect(herbalism).toMatchObject({
      current: {
        item_id: 'item.t1.qingtong_yaochu',
        comparison: null,
      },
    });

    const projected = projectToolHourlyThroughput({
      requiredToolTag: 'herbalism_tool',
      baseDurationUs: microseconds(60_000_000n),
      currentLoadout: createToolLoadout({
        itemId: 'item.t1.qingtong_yaochu',
        toolTag: 'herbalism_tool',
        skillId: 'skill.herbalism',
        speedModifiers: [{ stat: 'action_speed', operation: 'ADD', value: '0.12' }],
        efficiencyModifiers: [{ stat: 'action_efficiency', operation: 'ADD', value: '0.05' }],
      }),
    });

    expect(herbalism?.current).toMatchObject({
      cycles_per_hour: projected.cyclesPerHour,
      effective_throughput_per_hour: projected.effectiveThroughputPerHour,
    });
  });

  it('rejects tool assignments that belong to another character', async () => {
    const { service } = makeService(
      {
        stateVersion: '3',
        realmStageId: 'realm.qi.early',
        assignments: [],
      },
      makeInventory([{ instanceId: 'tool-1', itemId: 'item.t1.qingtong_yaochu' }]),
    );

    await expect(service.saveAssignments({ headers: { 'idempotency-key': '0198f7f3-0f7a-7c7d-9bc6-f4148c7d9df8' } } as unknown as FastifyRequest, 'character-1', {
      expected_state_version: 3,
      assignments: [{ skill_id: 'skill.herbalism', equipment_instance_id: 'missing-tool' }],
    })).rejects.toMatchObject({
      response: expect.objectContaining({
        code: 'RESOURCE_NOT_FOUND',
      }),
    });
  });

  it('rejects a tag mismatch when assigning a mining tool to herbalism', async () => {
    const { service } = makeService(
      {
        stateVersion: '3',
        realmStageId: 'realm.qi.early',
        assignments: [],
      },
      makeInventory([{ instanceId: 'tool-2', itemId: 'item.t1.qingtong_kuanggao' }]),
    );

    await expect(service.saveAssignments({ headers: { 'idempotency-key': '0198f7f3-0f7a-7c7d-9bc6-f4148c7d9df8' } } as unknown as FastifyRequest, 'character-1', {
      expected_state_version: 3,
      assignments: [{ skill_id: 'skill.herbalism', equipment_instance_id: 'tool-2' }],
    })).rejects.toMatchObject({
      response: expect.objectContaining({
        code: 'VALIDATION_ERROR',
        details: expect.objectContaining({
          reason: 'skill_tool_assignment_SKILL_MISMATCH',
        }),
      }),
    });
  });

  it('updates the assignment set and rejects a stale repeat request', async () => {
    const { service, state } = makeService(
      {
        stateVersion: '3',
        realmStageId: 'realm.qi.early',
        assignments: [],
      },
      makeInventory([{ instanceId: 'tool-1', itemId: 'item.t1.qingtong_yaochu' }]),
    );

    const first = await service.saveAssignments({ headers: { 'idempotency-key': '0198f7f3-0f7a-7c7d-9bc6-f4148c7d9df8' } } as unknown as FastifyRequest, 'character-1', {
      expected_state_version: 3,
      assignments: [{ skill_id: 'skill.herbalism', equipment_instance_id: 'tool-1' }],
    });

    expect(first).toMatchObject({
      effective_next_cycle: true,
      state_version: 4,
      character_id: 'character-1',
    });
    expect(state.stateVersion).toBe('4');

    await expect(service.saveAssignments({ headers: { 'idempotency-key': '0198f7f3-0f7a-7c7d-9bc6-f4148c7d9df9' } } as unknown as FastifyRequest, 'character-1', {
      expected_state_version: 3,
      assignments: [{ skill_id: 'skill.herbalism', equipment_instance_id: 'tool-1' }],
    })).rejects.toMatchObject({
      response: expect.objectContaining({
        code: 'STATE_VERSION_CONFLICT',
        details: expect.objectContaining({
          reason: 'expected_state_version',
        }),
      }),
    });
  });

  it('returns empty assignments and options when the character has no tools', async () => {
    const { service } = makeService(
      {
        stateVersion: '3',
        realmStageId: 'realm.qi.early',
        assignments: [],
      },
      makeInventory([]),
    );

    const response = await service.getAssignments({} as unknown as FastifyRequest, 'character-1');
    expect(response.assignments.every((entry) => entry.current === null && entry.options.length === 0)).toBe(true);
  });
});
