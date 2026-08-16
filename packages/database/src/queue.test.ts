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
              target_value: '20',
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
      entries: [{ completedCycles: 3n, progressTimeUs: 4n }],
    });
  });
});
