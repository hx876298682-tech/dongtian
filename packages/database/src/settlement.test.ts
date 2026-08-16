import type { PoolClient } from 'pg';
import { describe, expect, it, vi } from 'vitest';

import type { DatabasePool } from './index.js';
import { createSettlementRepository } from './settlement.js';

describe('settlement repository', () => {
  it('persists a run, all segments, and the next state on the caller transaction', async () => {
    const queries: string[] = [];
    const client = {
      async query<T>(sql: string): Promise<{ readonly rows: T[] }> {
        queries.push(sql);
        return { rows: (sql.includes('INSERT INTO settlement_runs') ? [{ id: 'run-1' }] : []) as T[] };
      },
      release: vi.fn(),
    } as unknown as PoolClient;
    const pool = { query: vi.fn() } as unknown as DatabasePool;

    const runId = await createSettlementRepository(pool).persist(client, {
      characterId: 'character-1',
      fromAt: new Date('2026-08-16T00:00:00.000Z'),
      effectiveUntil: new Date('2026-08-16T01:00:00.000Z'),
      requestedUntil: new Date('2026-08-16T01:00:00.000Z'),
      effectiveSeconds: 3_600n,
      cappedSeconds: 0n,
      status: 'COMPLETED',
      randomSeed: new Uint8Array(16),
      formulaVersion: 1,
      configVersion: '2026.08.16.1',
      summary: { completed_cycles: '36' },
      segments: [{
        segmentIndex: 0,
        actionConfigId: 'action.t1.herb_baicao_valley',
        fromAt: new Date('2026-08-16T00:00:00.000Z'),
        toAt: new Date('2026-08-16T01:00:00.000Z'),
        completedCycles: 36n,
        inputs: {},
        outputs: { 'item.t1.qingling_herb': '72' },
        xpChanges: { cultivation_xp: '36' },
        snapshot: { config_version: '2026.08.16.1' },
      }],
      nextState: {
        lastSettledAt: new Date('2026-08-16T01:00:00.000Z'),
        activeCycleIndex: 36n,
        activeCycleSnapshot: { action_config_id: 'action.t1.herb_baicao_valley' },
        progressTimeUs: 0n,
        continuationRequired: false,
      },
    });

    expect(runId).toBe('run-1');
    expect(queries.map((query) => query.split('\n')[0]?.trim())).toEqual([
      'INSERT INTO settlement_runs (',
      'INSERT INTO settlement_segments (',
      'UPDATE settlement_states',
    ]);
  });

  it('claims continuation rows with SKIP LOCKED and keeps the row lock through the handler transaction', async () => {
    const queries: string[] = [];
    let responseIndex = 0;
    const responses = [
      [],
      [{ character_id: 'character-1' }],
      [{
        character_id: 'character-1',
        last_settled_at: new Date('2026-08-16T00:00:00.000Z'),
        offline_cap_seconds: 36_000,
        active_queue_entry_id: null,
        active_cycle_index: '0',
        active_cycle_snapshot: null,
        progress_time_us: '0',
        continuation_required: true,
      }],
      [],
      [],
    ];
    const client = {
      async query<T>(sql: string): Promise<{ readonly rows: T[] }> {
        queries.push(sql);
        return { rows: (responses[responseIndex++] ?? []) as T[] };
      },
      release: vi.fn(),
    } as unknown as PoolClient;
    const pool = { connect: vi.fn(async () => client) } as unknown as DatabasePool;
    const handled: string[] = [];

    await expect(createSettlementRepository(pool).runContinuationBatch(1, async (lockedClient, characterId) => {
      handled.push(characterId);
      await lockedClient.query('CONTINUE_SETTLEMENT');
    })).resolves.toBe(1);
    expect(handled).toEqual(['character-1']);
    expect(queries.find((query) => query.includes('SKIP LOCKED'))).toBeDefined();
    expect(queries.at(-1)).toBe('COMMIT');
  });

  it('writes one progression audit entry for an aggregated cultivation settlement', async () => {
    const queries: string[] = [];
    let responseIndex = 0;
    const responses = [
      [{ id: 'run-2' }],
      [{ id: 'transaction-2' }],
      [{ cultivation_xp: '270.000000' }],
      [],
      [],
    ];
    const client = {
      async query<T>(sql: string): Promise<{ readonly rows: T[] }> {
        queries.push(sql);
        return { rows: (responses[responseIndex++] ?? []) as T[] };
      },
      release: vi.fn(),
    } as unknown as PoolClient;
    const pool = { query: vi.fn() } as unknown as DatabasePool;

    await createSettlementRepository(pool).persist(client, {
      characterId: 'character-1',
      fromAt: new Date('2026-08-16T00:00:00.000Z'),
      effectiveUntil: new Date('2026-08-16T01:00:00.000Z'),
      requestedUntil: new Date('2026-08-16T01:00:00.000Z'),
      effectiveSeconds: 3_600n,
      cappedSeconds: 0n,
      status: 'COMPLETED',
      randomSeed: new Uint8Array(16),
      formulaVersion: 1,
      configVersion: '2026.08.16.1',
      summary: { cultivation_xp: '270' },
      segments: [],
      progressionAward: { cultivationXpDelta: '270' },
      nextState: {
        lastSettledAt: new Date('2026-08-16T01:00:00.000Z'),
        activeCycleIndex: 60n,
        activeCycleSnapshot: null,
        progressTimeUs: 0n,
        continuationRequired: false,
      },
    });

    expect(queries.some((query) => query.includes("'ACTION_CULTIVATION'"))).toBe(true);
    expect(queries.some((query) => query.includes("'PROGRESSION'"))).toBe(true);
    expect(queries.filter((query) => query.includes('INSERT INTO asset_ledger'))).toHaveLength(1);
  });

  it('applies skill progression awards inside the settlement transaction', async () => {
    const queries: string[] = [];
    const params: unknown[][] = [];
    const client = {
      async query<T>(sql: string, _args?: readonly unknown[]): Promise<{ readonly rows: T[] }> {
        queries.push(sql);
        params.push([...(_args ?? [])]);
        return sql.includes('INSERT INTO settlement_runs')
          ? { rows: [{ id: 'run-3' }] as T[] }
          : sql.includes('UPDATE skill_progression')
            ? { rows: [{ xp: '12.500000' }] as T[] }
            : { rows: [] as T[] };
      },
      release: vi.fn(),
    } as unknown as PoolClient;
    const pool = { query: vi.fn() } as unknown as DatabasePool;

    await createSettlementRepository(pool).persist(client, {
      characterId: 'character-1',
      fromAt: new Date('2026-08-16T00:00:00.000Z'),
      effectiveUntil: new Date('2026-08-16T01:00:00.000Z'),
      requestedUntil: new Date('2026-08-16T01:00:00.000Z'),
      effectiveSeconds: 3_600n,
      cappedSeconds: 0n,
      status: 'COMPLETED',
      randomSeed: new Uint8Array(16),
      formulaVersion: 1,
      configVersion: '2026.08.16.1',
      summary: { skill_xp: '12.5' },
      segments: [],
      skillProgressionAwards: [{ skillId: 'skill.herbalism', skillXpDelta: '12.5' }],
      nextState: {
        lastSettledAt: new Date('2026-08-16T01:00:00.000Z'),
        activeCycleIndex: 60n,
        activeCycleSnapshot: null,
        progressTimeUs: 0n,
        continuationRequired: false,
      },
    });

    expect(queries.some((query) => query.includes('UPDATE skill_progression'))).toBe(true);
    expect(params.some((args) => args.includes('skill.herbalism'))).toBe(true);
  });

  it('loads the latest settlement summary with persisted segments and ledger rows', async () => {
    const queries: string[] = [];
    const pool = {
      async query<T>(sql: string, _args?: readonly unknown[]): Promise<{ readonly rows: T[] }> {
        queries.push(sql);
        if (sql.includes('FROM settlement_runs') && sql.includes('ORDER BY created_at DESC')) {
          return {
            rows: [{
              id: 'settlement-1',
              character_id: 'character-1',
              from_at: new Date('2026-08-16T00:00:00.000Z'),
              effective_until: new Date('2026-08-16T02:00:00.000Z'),
              requested_until: new Date('2026-08-16T02:30:00.000Z'),
              effective_seconds: '7200',
              capped_seconds: '1800',
              status: 'COMPLETED',
              segment_count: 1,
              random_seed: Buffer.from([1, 2, 3]),
              formula_version: 1,
              config_version: '2026.08.16.1',
              summary: {
                status: 'COMPLETED',
                requested_until_us: '9000000',
                effective_until_us: '7200000',
                effective_time_us: '7200000',
                capped_time_us: '1800000',
                completed_cycles: '2',
                progress_time_us: '0',
                continuation_required: false,
                active_queue_entry_id: 'entry-1',
                active_cycle_index: '2',
                action_config_id: 'action.t1.herb_baicao_valley',
                cultivation_xp: '2.5',
                skill_xp: '1.0',
                items: [{ item_id: 'item.t1.qingling_herb', quantity: '4' }],
              },
              error_code: null,
              created_at: new Date('2026-08-16T02:00:05.000Z'),
              completed_at: new Date('2026-08-16T02:00:06.000Z'),
            }] as T[],
          };
        }
        if (sql.includes('FROM settlement_segments')) {
          return {
            rows: [{
              settlement_run_id: 'settlement-1',
              segment_index: 0,
              queue_entry_id: 'entry-1',
              action_config_id: 'action.t1.herb_baicao_valley',
              from_at: new Date('2026-08-16T00:00:00.000Z'),
              to_at: new Date('2026-08-16T01:00:00.000Z'),
              completed_cycles: '1',
              inputs: { input: 'persisted' },
              outputs: { 'item.t1.qingling_herb': '2' },
              xp_changes: { cultivation_xp: '1.25', skill_xp: '0.5' },
              transition_reason: 'ACTION_SWITCH',
              snapshot: { action_config_id: 'action.t1.herb_baicao_valley' },
            }] as T[],
          };
        }
        if (sql.includes('FROM asset_ledger')) {
          return {
            rows: [{
              entry_id: 'ledger-1',
              transaction_id: 'transaction-1',
              asset_type: 'ITEM',
              asset_id: 'item.t1.qingling_herb',
              delta: '4',
              balance_after: '4',
              reason_code: 'SETTLEMENT_OUTPUT',
              reference_type: 'SETTLEMENT_RUN',
              reference_id: 'settlement-1',
              config_version: '2026.08.16.1',
              created_at: new Date('2026-08-16T02:00:06.000Z'),
            }] as T[],
          };
        }
        return { rows: [] as T[] };
      },
      release: vi.fn(),
    } as unknown as PoolClient;
    const poolHandle = { query: pool.query.bind(pool) } as unknown as DatabasePool;

    const summary = await createSettlementRepository(poolHandle).getLatestSummary('character-1');

    expect(summary).toMatchObject({
      run: {
        settlementId: 'settlement-1',
        characterId: 'character-1',
      },
      segments: [{
        settlementRunId: 'settlement-1',
        transitionReason: 'ACTION_SWITCH',
      }],
      ledgerEntries: [{
        entryId: 'ledger-1',
        assetType: 'ITEM',
      }],
    });
    expect(queries.filter((query) => query.includes('FROM settlement_runs'))).toHaveLength(1);
    expect(queries.filter((query) => query.includes('FROM settlement_segments'))).toHaveLength(1);
    expect(queries.filter((query) => query.includes('FROM asset_ledger'))).toHaveLength(1);
  });
});
