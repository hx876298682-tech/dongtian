import type { PoolClient } from 'pg';
import { describe, expect, it, vi } from 'vitest';

import type { DatabasePool } from './index.js';
import { createQueueRepository } from './queue.js';

describe('queue repository', () => {
  it('reads queue version, fallback, and ordered entries as bigint/string values', async () => {
    const client = {
      async query<T>(sql: string): Promise<{ readonly rows: T[] }> {
        return sql.includes('FROM action_queues')
          ? { rows: [{
              character_id: 'character-1',
              queue_version: '7',
              pending_replace_after_cycle: true,
              paused: false,
              fallback_action_id: 'action.cultivation.qi',
            }] as T[] }
          : { rows: [{
              id: 'entry-1',
              character_id: 'character-1',
              position: 0,
              action_config_id: 'action.t1.herb_baicao_valley',
              mode: 'COUNT',
              target_value: '20.000000',
              condition_item_id: null,
              condition_operator: null,
              on_blocked: 'FALLBACK',
              status: 'QUEUED',
              completed_cycles: '3',
              progress_time_us: '4',
              snapshot: null,
              snapshot_config_version: null,
              started_at: null,
              completed_at: null,
            }] as T[] };
      },
      release: vi.fn(),
    } as unknown as PoolClient;
    const pool = { query: client.query.bind(client) } as unknown as DatabasePool;

    await expect(createQueueRepository(pool).getQueue('character-1')).resolves.toMatchObject({
      queueVersion: 7n,
      pendingReplaceAfterCycle: true,
      entries: [{ completedCycles: 3n, progressTimeUs: 4n, targetValue: '20' }],
    });
  });

  it('preserves completed audit rows and does not duplicate a legacy running entry on replacement', async () => {
    const deletes: string[] = [];
    const inserts: ReadonlyArray<unknown>[] = [];
    let queueVersion = '1';
    const client = {
      async query<T>(sql: string, params?: ReadonlyArray<unknown>): Promise<{ readonly rows: T[] }> {
        if (sql.includes('SELECT id FROM characters')) {
          return { rows: [{ id: 'character-1' }] as T[] };
        }
        if (sql.includes('SELECT continuation_required')) {
          return { rows: [{ continuation_required: false }] as T[] };
        }
        if (sql.startsWith('DELETE FROM action_queue_entries')) {
          deletes.push(sql);
          return { rows: [] as T[] };
        }
        if (sql.startsWith('UPDATE action_queues')) {
          queueVersion = '2';
          return { rows: [] as T[] };
        }
        if (sql.startsWith('INSERT INTO action_queue_entries')) {
          inserts.push(params ?? []);
          return { rows: [] as T[] };
        }
        if (sql.includes('FROM action_queues')) {
          return { rows: [{
            character_id: 'character-1',
            queue_version: queueVersion,
            pending_replace_after_cycle: false,
            paused: false,
            fallback_action_id: 'action.cultivation.qi',
          }] as T[] };
        }
        if (sql.includes('FROM action_queue_entries')) {
          return { rows: [{
            id: 'entry-running',
            character_id: 'character-1',
            position: 0,
            action_config_id: 'action.t1.herb_baicao_valley',
            mode: 'INFINITE',
            target_value: null,
            condition_item_id: null,
            condition_operator: null,
            on_blocked: 'FALLBACK',
            status: 'RUNNING',
            completed_cycles: '1',
            progress_time_us: '0',
            snapshot: null,
            snapshot_config_version: null,
            started_at: new Date(),
            completed_at: null,
            blocked_reason: null,
          }, {
            id: 'entry-done-condition',
            character_id: 'character-1',
            position: 0,
            action_config_id: 'action.t1.herb_baicao_valley',
            mode: 'UNTIL_INVENTORY',
            target_value: '5',
            condition_item_id: 'item.t1.qingling_herb',
            condition_operator: '>=',
            on_blocked: 'FALLBACK',
            status: 'DONE_CONDITION_MET',
            completed_cycles: '0',
            progress_time_us: '0',
            snapshot: null,
            snapshot_config_version: null,
            started_at: null,
            completed_at: new Date(),
            blocked_reason: null,
          }] as T[] };
        }
        return { rows: [] as T[] };
      },
      release: vi.fn(),
    } as unknown as PoolClient;

    await createQueueRepository({ query: client.query.bind(client) } as unknown as DatabasePool).replaceQueue(client, {
      characterId: 'character-1',
      expectedQueueVersion: 1n,
      fallbackActionId: 'action.cultivation.qi',
      entries: [
        {
          clientEntryId: 'entry-running',
          position: 0,
          actionConfigId: 'action.t1.herb_baicao_valley',
          mode: 'INFINITE',
          onBlocked: 'FALLBACK',
          configVersion: '2026.08.16.1',
        },
        {
          clientEntryId: 'new-entry',
          position: 1,
          actionConfigId: 'action.cultivation.qi',
          mode: 'INFINITE',
          onBlocked: 'FALLBACK',
          configVersion: '2026.08.16.1',
        },
      ],
    });

    expect(deletes).toHaveLength(1);
    expect(deletes[0]).toContain("status IN ('QUEUED', 'BLOCKED')");
    expect(inserts).toHaveLength(1);
    expect(inserts[0]?.[8]).toContain('new-entry');
  });

  it('casts queue entry status parameters consistently for PostgreSQL enum comparisons', async () => {
    const queries: string[] = [];
    const client = {
      async query<T>(sql: string): Promise<{ readonly rows: T[] }> {
        queries.push(sql);
        if (sql.includes('SELECT id FROM characters')) return { rows: [{ id: 'character-1' }] as T[] };
        if (sql.includes('SELECT continuation_required')) return { rows: [{ continuation_required: false }] as T[] };
        if (sql.includes('FROM action_queues')) return { rows: [{
          character_id: 'character-1', queue_version: '1', pending_replace_after_cycle: false,
          paused: false, fallback_action_id: 'action.cultivation.qi',
        }] as T[] };
        if (sql.includes('FROM action_queue_entries')) return { rows: [{
          id: 'entry-1', character_id: 'character-1', position: 0,
          action_config_id: 'action.cultivation.qi', mode: 'INFINITE', target_value: null,
          condition_item_id: null, condition_operator: null, on_blocked: 'FALLBACK', status: 'QUEUED',
          completed_cycles: '0', progress_time_us: '0', snapshot: null, snapshot_config_version: null,
          started_at: null, completed_at: null, blocked_reason: null,
        }] as T[] };
        return { rows: [] as T[] };
      },
      release: vi.fn(),
    } as unknown as PoolClient;

    await createQueueRepository({ query: client.query.bind(client) } as unknown as DatabasePool)
      .setEntryStatus(client, {
        characterId: 'character-1', entryId: 'entry-1', status: 'DONE', blockedReason: null,
      });

    const update = queries.find((query) => query.startsWith('UPDATE action_queue_entries'));
    expect(update).toContain('$3::"QueueEntryStatus"');
    expect(update).toContain('CASE WHEN $3::"QueueEntryStatus"');
  });
});
