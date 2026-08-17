import type { PoolClient } from 'pg';
import { describe, expect, it, vi } from 'vitest';

import type { DatabasePool } from './index.js';
import { createAssetRepository } from './assets.js';

function poolForQueries(
  responses: readonly (readonly Record<string, unknown>[] | undefined)[],
): DatabasePool & { readonly queries: string[] } {
  const queries: string[] = [];
  let responseIndex = 0;
  const client = {
    async query<T>(sql: string): Promise<{ readonly rows: T[] }> {
      queries.push(sql);
      const rows = responses[responseIndex++] ?? [];
      return { rows: rows as T[] };
    },
    release: vi.fn(),
  } as unknown as PoolClient;
  return {
    queries,
    connect: vi.fn(async () => client),
  } as unknown as DatabasePool & { readonly queries: string[] };
}

const context = {
  characterId: 'character-1',
  reasonCode: 'TEST_GRANT',
  referenceType: 'TEST',
  referenceId: 'test-1',
  configVersion: '2026.08.16.1',
};

describe('asset repository', () => {
  it('rejects zero or fractional item mutations before opening a transaction', async () => {
    const pool = poolForQueries([]);
    const repository = createAssetRepository(pool);

    await expect(repository.add({ ...context, assetType: 'ITEM', assetId: 'item.t1.qingling_herb', quantity: '0' }))
      .rejects.toThrow('ASSET_VALIDATION_FAILED');
    await expect(repository.add({ ...context, assetType: 'ITEM', assetId: 'item.t1.qingling_herb', quantity: '1.5' }))
      .rejects.toThrow('ASSET_VALIDATION_FAILED');
    expect(pool.connect).not.toHaveBeenCalled();
  });

  it('rejects asset writes while a settlement continuation holds the character state', async () => {
    const pool = poolForQueries([
      [],
      [{ id: 'character-1' }],
      [{ continuation_required: true }],
    ]);
    await expect(createAssetRepository(pool).add({
      ...context,
      assetType: 'ITEM',
      assetId: 'item.t1.qingling_herb',
      quantity: '1',
    })).rejects.toThrow('SETTLEMENT_CONTINUATION_IN_PROGRESS');
    expect(pool.queries.some((query) => query.includes('INSERT INTO asset_transactions'))).toBe(false);
  });

  it('records an addition and its immutable ledger entry in one transaction', async () => {
    const pool = poolForQueries([
      [],
      [{ id: 'character-1' }],
      [{ continuation_required: false }],
      [{ id: 'transaction-1' }],
      [{ quantity: '5', reserved_quantity: '0', available_quantity: '5' }],
      [{ entry_id: 'ledger-1' }],
      [],
    ]);
    const result = await createAssetRepository(pool).add({
      ...context,
      assetType: 'ITEM',
      assetId: 'item.t1.qingling_herb',
      quantity: '5',
    });

    expect(result).toMatchObject({
      transactionId: 'transaction-1',
      ledgerEntryId: 'ledger-1',
      quantity: '5',
      availableQuantity: '5',
    });
    expect(pool.queries[0]).toContain('BEGIN');
    expect(pool.queries[5]).toContain('INSERT INTO asset_ledger');
    expect(pool.queries.at(-1)).toContain('COMMIT');
  });

  it('adds onto an existing caller transaction without opening a nested one', async () => {
    const queries: string[] = [];
    const client = {
      async query<T>(sql: string): Promise<{ readonly rows: T[] }> {
        queries.push(sql);
        return sql.includes('INSERT INTO asset_transactions')
          ? { rows: [{ id: 'transaction-1' }] as T[] }
          : sql.includes('SELECT id FROM characters')
            ? { rows: [{ id: 'character-1' }] as T[] }
            : sql.includes('SELECT continuation_required')
              ? { rows: [{ continuation_required: false }] as T[] }
            : sql.includes('RETURNING quantity::text, reserved_quantity::text')
            ? { rows: [{ quantity: '8', reserved_quantity: '0', available_quantity: '8' }] as T[] }
            : sql.includes('INSERT INTO asset_ledger')
              ? { rows: [{ entry_id: 'ledger-1' }] as T[] }
              : { rows: [] as T[] };
      },
      release: vi.fn(),
    } as unknown as PoolClient;
    const pool = { query: vi.fn() } as unknown as DatabasePool;

    const result = await createAssetRepository(pool).addOnTransaction(client, {
      characterId: 'character-1',
      reasonCode: 'TEST_GRANT',
      referenceType: 'TEST',
      referenceId: 'test-1',
      configVersion: '2026.08.16.1',
      assetType: 'ITEM',
      assetId: 'item.t1.qingling_herb',
      quantity: '3',
    });

    expect(result).toMatchObject({
      transactionId: 'transaction-1',
      ledgerEntryId: 'ledger-1',
      quantity: '8',
      availableQuantity: '8',
    });
    expect(queries.some((query) => query.includes('BEGIN'))).toBe(false);
    expect(queries.some((query) => query.includes('COMMIT'))).toBe(false);
  });

  it('creates a reservation and consumes it through the same ledger boundary', async () => {
    const reservePool = poolForQueries([
      [],
      [{ id: 'character-1' }],
      [{ continuation_required: false }],
      [{ id: 'reserve-transaction' }],
      [{ quantity: '10', reserved_quantity: '3', available_quantity: '7' }],
      [{
        id: 'reservation-1',
        character_id: 'character-1',
        business_type: 'BREAKTHROUGH',
        business_id: '00000000-0000-0000-0000-000000000001',
        asset_type: 'ITEM',
        asset_id: 'item.t1.qingling_herb',
        quantity: '3.000000',
        status: 'ACTIVE',
        expires_at: null,
      }],
      [{ entry_id: 'reserve-ledger' }],
      [],
    ]);
    const reservation = await createAssetRepository(reservePool).reserve({
      ...context,
      assetType: 'ITEM',
      assetId: 'item.t1.qingling_herb',
      quantity: '3',
      businessType: 'BREAKTHROUGH',
      businessId: '00000000-0000-0000-0000-000000000001',
    });
    expect(reservation.reservation).toMatchObject({
      reservationId: 'reservation-1',
      status: 'ACTIVE',
      quantity: '3.000000',
    });

    const consumePool = poolForQueries([
      [],
      [{ id: 'character-1' }],
      [{ continuation_required: false }],
      [{
        id: 'reservation-1',
        character_id: 'character-1',
        business_type: 'BREAKTHROUGH',
        business_id: '00000000-0000-0000-0000-000000000001',
        asset_type: 'ITEM',
        asset_id: 'item.t1.qingling_herb',
        quantity: '3.000000',
        status: 'ACTIVE',
        expires_at: null,
      }],
      [{ id: 'consume-transaction' }],
      [{ quantity: '7', reserved_quantity: '0', available_quantity: '7' }],
      [],
      [{ entry_id: 'consume-ledger' }],
      [],
    ]);
    const consumed = await createAssetRepository(consumePool).consume({
      ...context,
      reservationId: 'reservation-1',
      reasonCode: 'TEST_CONSUME',
    });
    expect(consumed).toMatchObject({
      transactionId: 'consume-transaction',
      ledgerEntryId: 'consume-ledger',
      quantity: '7',
      reservation: { reservationId: 'reservation-1', status: 'CONSUMED' },
    });
  });

  it('returns a clean audit report when balances and ledger agree', async () => {
    const pool = {
      async query() {
        return { rows: [] };
      },
    } as unknown as DatabasePool;

    await expect(createAssetRepository(pool).audit()).resolves.toEqual({
      ok: true,
      discrepancyCount: 0,
      discrepancies: [],
    });
  });

  it('consumes only the requested portion of an aggregate reservation', async () => {
    const pool = poolForQueries([
      [],
      [{ id: 'character-1' }],
      [{ continuation_required: false }],
      [{
        id: 'reservation-1',
        character_id: 'character-1',
        business_type: 'ACTION_QUEUE_ENTRY',
        business_id: 'entry-1',
        asset_type: 'ITEM',
        asset_id: 'item.t1.qingling_herb',
        quantity: '5',
        status: 'ACTIVE',
        expires_at: null,
      }],
      [{ id: 'consume-transaction' }],
      [{ quantity: '8', reserved_quantity: '3', available_quantity: '5' }],
      [],
      [{ entry_id: 'consume-ledger' }],
      [],
    ]);
    const repository = createAssetRepository(pool);
    const consumed = await repository.consume({
      ...context,
      reservationId: 'reservation-1',
      quantity: '2',
      reasonCode: 'SETTLEMENT_INPUT',
    });

    expect(consumed.reservation).toMatchObject({
      reservationId: 'reservation-1',
      status: 'ACTIVE',
      quantity: '3',
    });
    expect(pool.queries.some((query) => query.includes('quantity = quantity - $2::numeric'))).toBe(true);
  });

  it('reports a ledger mismatch instead of hiding an unexplained balance', async () => {
    let queryCount = 0;
    const pool = {
      async query() {
        queryCount += 1;
        return queryCount === 1
          ? {
              rows: [{
                character_id: 'character-1',
                asset_type: 'ITEM',
                asset_id: 'item.t1.qingling_herb',
                expected: '5',
                actual: '4',
              }],
            }
          : { rows: [] };
      },
    } as unknown as DatabasePool;

    await expect(createAssetRepository(pool).audit()).resolves.toMatchObject({
      ok: false,
      discrepancyCount: 1,
      discrepancies: [
        expect.objectContaining({
          kind: 'LEDGER_BALANCE_MISMATCH',
          expected: '5',
          actual: '4',
        }),
      ],
    });
  });
});
