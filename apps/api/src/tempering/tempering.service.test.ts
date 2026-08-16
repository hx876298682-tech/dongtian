import type { FastifyRequest } from 'fastify';
import { describe, expect, it, vi } from 'vitest';

import type { ConfigRegistry } from '@dongtian/config-schema';
import type {
  PoolClient,
  TemperingAttemptRecord,
  TemperingRepository,
} from '@dongtian/database';

import type { AuthService } from '../auth/auth.service.js';
import type { SettlementService } from '../settlement/settlement.service.js';
import { TemperingService } from './tempering.service.js';

vi.mock('@dongtian/game-rules', () => ({
  resolveTemperingAttempt: vi.fn((input: {
    readonly attemptId: string;
    readonly equipmentInstanceId: string;
    readonly fromLevel: number;
    readonly targetLevel: number;
    readonly useProtectionMaterial: boolean;
    readonly serverSeedHex: string;
    readonly configVersion: string;
    readonly formulaVersion: number;
  }) => ({
    attemptId: input.attemptId,
    equipmentInstanceId: input.equipmentInstanceId,
    fromLevel: input.fromLevel,
    targetLevel: input.targetLevel,
    equipmentLevelBefore: input.fromLevel,
    equipmentLevelAfter: input.targetLevel,
    applied: true,
    status: 'APPLIED',
    outcome: 'SUCCESS',
    success: true,
    successProbability: '1',
    attributeIncrease: '0.1',
    attributeMultiplierBefore: '1',
    attributeMultiplierAfter: '1.1',
    costSnapshot: {
      tempering_stone_cost: '1',
      spirit_stone_cost: '20',
      same_equipment_cost: '0',
      protection_material_cost_requested: input.useProtectionMaterial ? '1' : '0',
      protection_material_cost_spent: input.useProtectionMaterial ? '1' : '0',
    },
    ruleSnapshot: {
      targetLevel: input.targetLevel,
      successProbability: '1',
      attributeIncrease: '0.1',
      cumulativeAttributeMultiplier: '1.1',
      failureResult: 'KEEP_LEVEL',
      scope: 'MVP',
    },
    randomAudit: {
      namespace: 'equipment.tempering',
      attemptKey: input.attemptId,
      seedHex: input.serverSeedHex,
      roll: '0',
      successProbability: '1',
      formulaVersion: input.formulaVersion,
    },
    rejectionReason: null,
    auditSummary: 'tempering_attempt',
  })),
}));

vi.mock('node:crypto', async () => {
  const actual = await vi.importActual<typeof import('node:crypto')>('node:crypto');
  return {
    ...actual,
    randomBytes: vi.fn(() => Buffer.from('0123456789abcdef0123456789abcdef', 'hex')),
  };
});

function temperingAttemptRecord(overrides: Partial<TemperingAttemptRecord> = {}): TemperingAttemptRecord {
  return {
    attemptId: 'attempt-1',
    characterId: 'character-1',
    equipmentInstanceId: 'equipment-1',
    fromLevel: 0,
    targetLevel: 1,
    successProbability: '1',
    randomSeedHex: '0123456789abcdef0123456789abcdef',
    configVersion: '2026.08.16.1',
    formulaVersion: 1,
    result: 'SUCCESS',
    success: true,
    costs: {
      tempering_stone_cost: '1',
      spirit_stone_cost: '20',
      same_equipment_cost: '0',
      protection_material_cost_requested: '0',
      protection_material_cost_spent: '0',
    },
    assetTransactionId: '00000000-0000-7000-8000-000000000001',
    createdAt: new Date('2026-08-16T00:00:00.000Z'),
    completedAt: new Date('2026-08-16T00:00:01.000Z'),
    ...overrides,
  };
}

function makeRegistry(): ConfigRegistry {
  return {
    manifest: { config_version: '2026.08.16.1', formula_version: 1 },
    getEquipment(itemId: string) {
      return {
        item_id: itemId,
        slot: 'WEAPON',
        attack: 1,
        defense: 0,
        hp: 0,
        speed: 0,
        power_index: 1,
        equip_requirements: { required_realm: 'realm.mortal.entry', required_tags: ['weapon'] },
        modifier_ids: [],
        temperable: true,
        max_temper_level: 6,
      } as never;
    },
    getTempering(targetLevel: number) {
      return {
        id: `tempering.${targetLevel}`,
        name_key: 'tempering.name',
        description_key: 'tempering.desc',
        enabled: true,
        deprecated: false,
        realm_required: 'realm.mortal.entry',
        feature_flag: null,
        sort_order: targetLevel,
        tags: ['equipment', 'tempering'],
        source_note: '13_淬炼成本',
        target_level: targetLevel,
        success_probability: '1',
        attribute_increase: '0.1',
        tempering_stone_cost: '1',
        spirit_stone_cost: '20',
        same_equipment_cost: '0',
        protection_material_cost: '0',
        tempering_stone_item_id: 'item.t1.xingwen_gang',
        protection_material_item_id: 'item.t1.zhuji_hufu',
        failure_result: 'KEEP_LEVEL',
        scope: targetLevel <= 6 ? 'MVP' : 'ANCHOR',
      } as never;
    },
    getItem(itemId: string) {
      return { id: itemId, realm_required: 'realm.mortal.entry', tags: ['equipment', 'weapon'] } as never;
    },
  } as unknown as ConfigRegistry;
}

function makeClient(responses: Record<string, readonly Record<string, unknown>[]>): PoolClient & { readonly queries: string[] } {
  const queries: string[] = [];
  return {
    queries,
    async query<T>(sql: string): Promise<{ readonly rows: T[] }> {
      queries.push(sql);
      for (const [needle, rows] of Object.entries(responses)) {
        if (sql.includes(needle)) {
          return { rows: rows as T[] };
        }
      }
      return { rows: [] as T[] };
    },
    release: vi.fn(),
  } as unknown as PoolClient & { readonly queries: string[] };
}

function makeService(options: {
  readonly resolveResponses?: Record<string, readonly Record<string, unknown>[]>;
  readonly attempt?: TemperingAttemptRecord | null;
  readonly lockEquipmentInstance?: TemperingRepository['lockEquipmentInstance'];
} = {}) {
  const client = makeClient({
    'SELECT id FROM characters WHERE id = $1 FOR UPDATE': [{ id: 'character-1' }],
    'SELECT continuation_required': [{ continuation_required: false }],
    'SELECT c.state_version::text AS state_version': [{ state_version: '3' }],
    'SELECT quantity::text, reserved_quantity::text': [{ quantity: '100', reserved_quantity: '0', available_quantity: '100' }],
    'FROM equipment_instances e\n         INNER JOIN characters c ON c.id = e.character_id': [{
      instance_id: 'equipment-1',
      item_id: 'item.t1.cuizhi_jian',
      temper_level: 0,
      bound: false,
      created_config_version: '2026.08.16.1',
    }],
    'INSERT INTO asset_transactions': [{ id: '00000000-0000-7000-8000-000000000010' }],
    'UPDATE inventories': [{ quantity: '9', reserved_quantity: '0', available_quantity: '9' }],
    'UPDATE currency_balances': [{ quantity: '80', reserved_quantity: '0', available_quantity: '80' }],
    'INSERT INTO asset_ledger': [{ entry_id: '00000000-0000-7000-8000-000000000011' }],
    'UPDATE equipment_instances': [{
      id: 'equipment-1',
      item_id: 'item.t1.cuizhi_jian',
      temper_level: 1,
      bound: false,
      created_config_version: '2026.08.16.1',
    }],
    'INSERT INTO outbox_events': [],
    ...(options.resolveResponses ?? {}),
  });

  const settlementService = {
    async executeSettledWrite<T>(_request: FastifyRequest, _characterId: string, input: {
      readonly operationType: string;
      readonly request: unknown;
      readonly execute: (context: {
        readonly client: PoolClient;
        readonly settlement: { readonly settlement_id: string };
      }) => Promise<{
        readonly statusCode: number;
        readonly response: T;
      }>;
    }) {
      return input.execute({
        client,
        settlement: { settlement_id: 'settlement-1' },
      });
    },
  } as unknown as SettlementService;

  const temperingRepository = {
    async lockEquipmentInstance(...args: Parameters<TemperingRepository['lockEquipmentInstance']>) {
      if (options.lockEquipmentInstance) {
        return options.lockEquipmentInstance(...args);
      }
      return {
        instanceId: 'equipment-1',
        itemId: 'item.t1.cuizhi_jian',
        temperLevel: 0,
        bound: false,
        createdConfigVersion: '2026.08.16.1',
      };
    },
    async getTemperingAttempt() {
      return options.attempt ?? null;
    },
    async createTemperingAttempt() {
      return temperingAttemptRecord({
        completedAt: null,
        result: 'PENDING',
        success: null,
      });
    },
    async completeTemperingAttempt() {
      return temperingAttemptRecord({
        assetTransactionId: '00000000-0000-7000-8000-000000000010',
      });
    },
    async createEquipmentTemperAudit() {
      return {
        auditId: '00000000-0000-7000-8000-000000000020',
        attemptId: 'attempt-1',
        characterId: 'character-1',
        equipmentInstanceId: 'equipment-1',
        fromLevel: 0,
        targetLevel: 1,
        levelBefore: 0,
        levelAfter: 1,
        success: true,
        result: 'SUCCESS',
        assetTransactionId: '00000000-0000-7000-8000-000000000010',
        createdAt: new Date('2026-08-16T00:00:01.000Z'),
      };
    },
  } as unknown as TemperingRepository;

  const authService = {
    async requireWriteAccess() {
      return 'account-1';
    },
  } as unknown as AuthService;

  return {
    service: new TemperingService(
      settlementService,
      temperingRepository,
      makeRegistry(),
      authService,
    ),
    client,
    queries: client.queries,
    temperingRepository,
  };
}

describe('TemperingService', () => {
  it('creates a successful tempering attempt and writes audit data', async () => {
    const { service, queries, temperingRepository } = makeService();
    const response = await service.temperEquipment(
      { headers: { 'idempotency-key': '0198f6d7-3f09-7c11-8e2d-000000000030' } } as unknown as FastifyRequest,
      'character-1',
      'equipment-1',
      {
        attempt_id: 'attempt-1',
        expected_state_version: 3,
        target_level: 1,
        use_protection_material: false,
        config_version: '2026.08.16.1',
      },
    );

    expect(response).toMatchObject({
      attempt_id: 'attempt-1',
      equipment_instance_id: 'equipment-1',
      target_level: 1,
      outcome: 'SUCCESS',
      success: true,
      state_version: 4,
      asset_transaction_id: '00000000-0000-7000-8000-000000000010',
    });
    expect(queries.some((query) => query.includes('INSERT INTO asset_transactions'))).toBe(true);
    expect(queries.some((query) => query.includes('INSERT INTO outbox_events'))).toBe(true);
    expect(temperingRepository.createTemperingAttempt).toBeDefined();
  });

  it('replays an already completed attempt without creating a new one', async () => {
    const { service } = makeService({
      attempt: temperingAttemptRecord(),
      resolveResponses: {
        'SELECT id AS audit_id, asset_transaction_id': [{
          audit_id: '00000000-0000-7000-8000-000000000020',
          asset_transaction_id: '00000000-0000-7000-8000-000000000010',
        }],
      },
    });
    const response = await service.temperEquipment(
      { headers: { 'idempotency-key': '0198f6d7-3f09-7c11-8e2d-000000000031' } } as unknown as FastifyRequest,
      'character-1',
      'equipment-1',
      {
        attempt_id: 'attempt-1',
        expected_state_version: 3,
        target_level: 1,
        use_protection_material: false,
        config_version: '2026.08.16.1',
      },
    );

    expect(response.outcome).toBe('SUCCESS');
    expect(response.temper_audit_id).toBe('00000000-0000-7000-8000-000000000020');
    expect(response.random_audit?.seed_hex).toBe('0123456789abcdef0123456789abcdef');
  });

  it('rejects missing ownership and missing materials', async () => {
    const missingOwner = makeService({
      lockEquipmentInstance: async () => null,
    });
    await expect(missingOwner.service.temperEquipment(
      { headers: { 'idempotency-key': '0198f6d7-3f09-7c11-8e2d-000000000032' } } as unknown as FastifyRequest,
      'character-1',
      'equipment-1',
      {
        attempt_id: 'attempt-1',
        expected_state_version: 3,
        target_level: 1,
        use_protection_material: false,
        config_version: '2026.08.16.1',
      },
    )).rejects.toMatchObject({ status: 404 });

    const insufficient = makeService({
      resolveResponses: {
        'SELECT quantity::text, reserved_quantity::text': [{ quantity: '0', reserved_quantity: '0', available_quantity: '0' }],
      },
    });
    await expect(insufficient.service.temperEquipment(
      { headers: { 'idempotency-key': '0198f6d7-3f09-7c11-8e2d-000000000033' } } as unknown as FastifyRequest,
      'character-1',
      'equipment-1',
      {
        attempt_id: 'attempt-1',
        expected_state_version: 3,
        target_level: 1,
        use_protection_material: false,
        config_version: '2026.08.16.1',
      },
    )).rejects.toMatchObject({ status: 400 });
  });
});
