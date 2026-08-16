import type { PoolClient } from 'pg';
import { describe, expect, it, vi } from 'vitest';

import type { DatabasePool } from './index.js';
import {
  createIdempotencyExecutor,
  hashIdempotencyRequest,
  IdempotencyKeyReusedError,
  normalizeIdempotencyRequest,
} from './idempotency.js';

function fakePool(responses: readonly unknown[]): DatabasePool & { readonly queries: string[] } {
  const queries: string[] = [];
  let responseIndex = 0;
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

const input = {
  accountId: '00000000-0000-4000-8000-000000000001',
  operationType: 'TEST_WRITE',
  idempotencyKey: '00000000-0000-4000-8000-000000000002',
  request: { z: 1, nested: { b: true, a: 'same' }, a: [2, 3] },
};

describe('idempotency executor', () => {
  it('normalizes object key order before hashing', () => {
    expect(normalizeIdempotencyRequest({ b: 1, a: { d: false, c: 2 } }))
      .toBe('{"a":{"c":2,"d":false},"b":1}');
    expect(hashIdempotencyRequest({ a: 1, b: 2 }))
      .toBe(hashIdempotencyRequest({ b: 2, a: 1 }));
  });

  it('commits business work, outbox events, and the stable response together', async () => {
    const pool = fakePool([
      [],
      [{ id: 'idempotency-1' }],
      [],
      [{ id: 'event-1' }],
      [],
      [],
    ]);
    const result = await createIdempotencyExecutor(pool).execute({
      ...input,
      execute: async ({ client }) => {
        await client.query('UPDATE business_state');
        return {
          statusCode: 201,
          response: { created: true },
          transactionId: 'transaction-1',
          outboxEvents: [{
            eventType: 'test.created',
            aggregateType: 'test',
            aggregateId: 'aggregate-1',
            payload: { event_id: 'event-1' },
          }],
        };
      },
    });

    expect(result).toEqual({ statusCode: 201, response: { created: true }, replayed: false });
    expect(pool.queries.findIndex((query) => query.includes('UPDATE business_state')))
      .toBeLessThan(pool.queries.findIndex((query) => query.includes('INSERT INTO outbox_events')));
    expect(pool.queries.findIndex((query) => query.includes('INSERT INTO outbox_events')))
      .toBeLessThan(pool.queries.findIndex((query) => query.includes('UPDATE idempotency_records')));
    expect(pool.queries.at(-1)).toBe('COMMIT');
  });

  it('replays the stored response and rejects key reuse with a different hash', async () => {
    const replayPool = fakePool([
      [],
      [],
      [{
        id: 'idempotency-1',
        request_hash: hashIdempotencyRequest(input.request),
        http_status: 200,
        response_snapshot: { stable: 'response' },
      }],
      [],
    ]);
    const replay = await createIdempotencyExecutor(replayPool).execute({
      ...input,
      execute: async () => {
        throw new Error('business callback must not run on replay');
      },
    });
    expect(replay).toEqual({
      statusCode: 200,
      response: { stable: 'response' },
      replayed: true,
    });

    const conflictPool = fakePool([
      [],
      [],
      [{
        id: 'idempotency-1',
        request_hash: hashIdempotencyRequest(input.request),
        http_status: 200,
        response_snapshot: { stable: 'response' },
      }],
      [],
    ]);
    await expect(createIdempotencyExecutor(conflictPool).execute({
      ...input,
      request: { ...input.request, z: 2 },
      execute: async () => ({ statusCode: 200, response: { ignored: true } }),
    })).rejects.toBeInstanceOf(IdempotencyKeyReusedError);
    expect(conflictPool.queries.at(-1)).toBe('ROLLBACK');
  });
});
