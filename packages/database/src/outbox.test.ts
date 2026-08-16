import type { PoolClient } from 'pg';
import { describe, expect, it, vi } from 'vitest';

import type { DatabasePool } from './index.js';
import { createOutboxRepository } from './outbox.js';

function poolForClaim(): DatabasePool & { readonly queries: string[] } {
  const queries: string[] = [];
  let responseIndex = 0;
  const responses = [
    [],
    [{
      id: 'event-1',
      event_type: 'test.created',
      aggregate_type: 'test',
      aggregate_id: 'aggregate-1',
      transaction_id: 'transaction-1',
      payload: { event_id: 'event-1' },
      status: 'PENDING',
      attempt_count: 0,
      available_at: new Date('2026-08-16T00:00:00.000Z'),
      locked_at: null,
      published_at: null,
      last_error: null,
      created_at: new Date('2026-08-16T00:00:00.000Z'),
    }],
    [{
      id: 'event-1',
      event_type: 'test.created',
      aggregate_type: 'test',
      aggregate_id: 'aggregate-1',
      transaction_id: 'transaction-1',
      payload: { event_id: 'event-1' },
      status: 'PROCESSING',
      attempt_count: 1,
      available_at: new Date('2026-08-16T00:00:00.000Z'),
      locked_at: new Date('2026-08-16T00:00:00.000Z'),
      published_at: null,
      last_error: null,
      created_at: new Date('2026-08-16T00:00:00.000Z'),
    }],
    [],
  ];
  const client = {
    async query<T>(sql: string): Promise<{ readonly rows: T[] }> {
      queries.push(sql);
      return { rows: (responses[responseIndex++] ?? []) as T[] };
    },
    release: vi.fn(),
  } as unknown as PoolClient;
  return {
    queries,
    connect: vi.fn(async () => client),
  } as unknown as DatabasePool & { readonly queries: string[] };
}

describe('outbox repository', () => {
  it('claims pending and expired processing events with a lease-safe SQL transaction', async () => {
    const pool = poolForClaim();
    const now = new Date('2026-08-16T00:05:00.000Z');
    const claimed = await createOutboxRepository(pool).claimBatch({ now, leaseMs: 60_000 });

    expect(claimed).toHaveLength(1);
    expect(claimed[0]).toMatchObject({ id: 'event-1', status: 'PROCESSING', attemptCount: 1 });
    expect(pool.queries.find((query) => query.includes('FOR UPDATE SKIP LOCKED'))).toBeDefined();
    expect(pool.queries.find((query) => query.includes("status = 'PROCESSING'"))).toBeDefined();
    expect(pool.queries.at(-1)).toBe('COMMIT');
  });

  it('detects already published events from the authoritative outbox table', async () => {
    const queries: string[] = [];
    const pool = {
      async query<T>(sql: string): Promise<{ readonly rows: T[] }> {
        queries.push(sql);
        return { rows: (sql.includes("status = 'PUBLISHED'") ? [{ id: 'event-1' }] : []) as T[] };
      },
    } as unknown as DatabasePool;

    await expect(createOutboxRepository(pool).hasPublished('event-1')).resolves.toBe(true);
    expect(queries.find((query) => query.includes("status = 'PUBLISHED'"))).toBeDefined();
  });
});
