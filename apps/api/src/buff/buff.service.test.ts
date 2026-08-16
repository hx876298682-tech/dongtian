import { fileURLToPath } from 'node:url';

import type { FastifyRequest } from 'fastify';
import { describe, expect, it } from 'vitest';

import { loadConfigRegistry, type ConfigRegistry } from '@dongtian/config-schema';
import type { AssetRepository, BuffRepository, PoolClient } from '@dongtian/database';

import type { SettlementService } from '../settlement/settlement.service.js';
import { BuffService } from './buff.service.js';

const registry: ConfigRegistry = loadConfigRegistry({
  releasesRoot: fileURLToPath(new URL('../../../../config/releases', import.meta.url)),
  version: '2026.08.16.1',
});

function makeService() {
  const queries: string[] = [];
  const client = {
    async query<T>(sql: string): Promise<{ readonly rows: T[] }> {
      queries.push(sql);
      if (sql.includes('FROM characters c')) {
        return { rows: [{ state_version: '3', realm_stage_id: 'realm.mortal.entry' }] as T[] };
      }
      if (sql.includes('DELETE FROM buff_instances')) {
        return { rows: [] as T[] };
      }
      if (sql.includes('INSERT INTO buff_instances')) {
        return {
          rows: [{
            id: 'buff-instance-1',
            character_id: 'character-1',
            buff_config_id: 'buff.t1.qi_gathering_pill',
            slot_index: 1,
            stack_group: 'cultivation',
            started_at: new Date('2026-08-16T00:00:01.000Z'),
            expires_at: new Date('2026-08-16T00:30:01.000Z'),
          }] as T[],
        };
      }
      if (sql.includes('UPDATE characters')) {
        return { rows: [{ state_version: '4' }] as T[] };
      }
      return { rows: [] as T[] };
    },
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
      expect(input.operationType).toBe('BUFF_USE');
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
      return null;
    },
    async getInventoryOnTransaction() {
      return null;
    },
    async add() {
      throw new Error('not used');
    },
    async addOnTransaction() {
      throw new Error('not used');
    },
    async deductOnTransaction() {
      return {
        assetType: 'ITEM',
        assetId: 'item.t1.qi_gathering_pill',
        quantity: '1',
        reservedQuantity: '0',
        availableQuantity: '0',
        transactionId: 'asset-tx-1',
        ledgerEntryId: 'asset-ledger-1',
      };
    },
    async deduct() {
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

  const buffRepository: BuffRepository = {
    async getActiveBuffs() {
      return [];
    },
    async lockActiveBuffs() {
      return [];
    },
    async replaceBuffInstance() {
      throw new Error('not used');
    },
  };

  const service = new BuffService(settlementService, assetRepository, buffRepository, registry);
  return { service, queries };
}

describe('BuffService', () => {
  it('uses a pill, consumes one item, and returns the authoritative buff record', async () => {
    const { service, queries } = makeService();
    const result = await service.use({
      headers: { 'idempotency-key': '0198f6d7-3f09-7c11-8e2d-000000000001' },
    } as unknown as FastifyRequest, 'character-1', {
      item_id: 'item.t1.qi_gathering_pill',
      quantity: 1,
      target_slot_index: 1,
      expected_state_version: 3,
    });

    expect(result).toMatchObject({
      character_id: 'character-1',
      item_id: 'item.t1.qi_gathering_pill',
      quantity: '1',
      target_slot_index: 1,
      effective_next_cycle: true,
      state_version: 4,
      buff_instance: {
        buff_instance_id: 'buff-instance-1',
        buff_config_id: 'buff.t1.qi_gathering_pill',
        source_item_id: 'item.t1.qi_gathering_pill',
        slot_index: 1,
        stack_group: 'cultivation',
      },
      replaced_buff_instance_id: null,
    });
    expect(queries[0]).toContain('FROM characters c');
    expect(queries[1]).toContain('INSERT INTO buff_instances');
    expect(queries[2]).toContain('UPDATE characters');
  });
});
