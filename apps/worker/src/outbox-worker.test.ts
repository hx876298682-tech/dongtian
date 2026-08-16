import { describe, expect, it, vi } from 'vitest';

import type { OutboxEvent, OutboxRepository } from '@dongtian/database';

import { OutboxWorker, type OutboxEventDedupe } from './outbox-worker.js';

function event(id: string): OutboxEvent {
  return {
    id,
    eventType: 'test.created',
    aggregateType: 'test',
    aggregateId: 'aggregate-1',
    transactionId: 'transaction-1',
    payload: { event_id: id },
    status: 'PROCESSING',
    attemptCount: 1,
    availableAt: new Date('2026-08-16T00:00:00.000Z'),
    lockedAt: new Date('2026-08-16T00:00:00.000Z'),
    publishedAt: null,
    lastError: null,
    createdAt: new Date('2026-08-16T00:00:00.000Z'),
  };
}

function repository(events: readonly OutboxEvent[]): OutboxRepository {
  return {
    insert: vi.fn(),
    insertMany: vi.fn(),
    claimBatch: vi.fn(async () => events),
    hasPublished: vi.fn(async () => false),
    markPublished: vi.fn(async () => true),
    requeue: vi.fn(async () => true),
    markFailed: vi.fn(async () => true),
  };
}

describe('OutboxWorker', () => {
  it('does not publish the same event again after a worker restart', async () => {
    const processed = new Set<string>();
    const dedupe: OutboxEventDedupe = {
      hasProcessed: async (eventId) => processed.has(eventId),
      markProcessed: async (eventId) => {
        processed.add(eventId);
      },
    };
    const publish = vi.fn(async () => undefined);
    const firstRepository = repository([event('event-1')]);
    const secondRepository = repository([event('event-1')]);

    await expect(new OutboxWorker(firstRepository, publish, dedupe).runOnce()).resolves.toMatchObject({
      claimed: 1,
      processed: 1,
      skipped: 0,
    });
    await expect(new OutboxWorker(secondRepository, publish, dedupe).runOnce()).resolves.toMatchObject({
      claimed: 1,
      processed: 0,
      skipped: 1,
    });
    expect(publish).toHaveBeenCalledTimes(1);
  });

  it('requeues a failed event and processes it on a later run', async () => {
    const processed = new Set<string>();
    const dedupe: OutboxEventDedupe = {
      hasProcessed: async (eventId) => processed.has(eventId),
      markProcessed: async (eventId) => {
        processed.add(eventId);
      },
    };
    const publish = vi.fn()
      .mockRejectedValueOnce(new Error('temporary sink failure'))
      .mockResolvedValueOnce(undefined);
    const firstRepository = repository([event('event-2')]);
    const secondRepository = repository([{
      ...event('event-2'),
      attemptCount: 2,
      lockedAt: new Date('2026-08-16T00:00:01.000Z'),
      availableAt: new Date('2026-08-16T00:00:01.000Z'),
    }]);

    await expect(new OutboxWorker(firstRepository, publish, dedupe).runOnce({ now: new Date('2026-08-16T00:00:00.000Z') })).resolves.toMatchObject({
      claimed: 1,
      processed: 0,
      failed: 1,
      skipped: 0,
    });
    await expect(new OutboxWorker(secondRepository, publish, dedupe).runOnce({ now: new Date('2026-08-16T00:00:02.000Z') })).resolves.toMatchObject({
      claimed: 1,
      processed: 1,
      failed: 0,
      skipped: 0,
    });
    expect(publish).toHaveBeenCalledTimes(2);
  });
});
