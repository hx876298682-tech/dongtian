import { describe, expect, it, vi } from 'vitest';

import type { OutboxEvent } from '@dongtian/database';

import { createAnalyticsOutboxHandler, type AnalyticsDedupeStore } from './analytics-consumer.js';

function outboxEvent(overrides: Partial<OutboxEvent> = {}): OutboxEvent {
  return {
    id: 'outbox-event-1',
    eventType: 'dungeon_run_finalized',
    aggregateType: 'DUNGEON_RUN',
    aggregateId: 'run-1',
    transactionId: 'transaction-1',
    payload: {
      event_id: 'analytics-event-1',
      event_type: 'dungeon_run_finalized',
      occurred_at: '2026-08-16T00:00:00.000Z',
      transaction_id: 'transaction-1',
      character_id: 'character-1',
      config_version: '2026.08.16.1',
      formula_version: 1,
      idempotency_key: 'idem-1',
      dedupe_key: 'dedupe-1',
      payload: {
        dungeon_id: 'dungeon.t1.qingshe_cave',
        reward_value: '12.5',
      },
    },
    status: 'PROCESSING',
    attemptCount: 1,
    availableAt: new Date('2026-08-16T00:00:00.000Z'),
    lockedAt: new Date('2026-08-16T00:00:00.000Z'),
    publishedAt: null,
    lastError: null,
    createdAt: new Date('2026-08-16T00:00:00.000Z'),
    ...overrides,
  };
}

describe('analytics outbox consumer', () => {
  it('records a valid analytics event once and suppresses duplicate dedupe keys', async () => {
    const dedupeKeys = new Set<string>();
    const dedupeStore: AnalyticsDedupeStore = {
      hasProcessed: async (dedupeKey) => dedupeKeys.has(dedupeKey),
      markProcessed: async (dedupeKey) => {
        dedupeKeys.add(dedupeKey);
      },
    };
    const sink = { record: vi.fn(async () => undefined) };
    const handler = createAnalyticsOutboxHandler({ sink, dedupeStore });

    await handler(outboxEvent());
    await handler(outboxEvent());

    expect(sink.record).toHaveBeenCalledTimes(1);
    expect(dedupeKeys.has('dedupe-1')).toBe(true);
  });

  it('skips non-analytics outbox events without touching the sink', async () => {
    const sink = { record: vi.fn(async () => undefined) };
    const dedupeStore: AnalyticsDedupeStore = {
      hasProcessed: vi.fn(async () => false),
      markProcessed: vi.fn(async () => undefined),
    };
    const handler = createAnalyticsOutboxHandler({ sink, dedupeStore });

    await handler(outboxEvent({ eventType: 'buff.debug' }));

    expect(sink.record).not.toHaveBeenCalled();
    expect(dedupeStore.hasProcessed).not.toHaveBeenCalled();
  });

  it('rejects payloads that contain sensitive fields', async () => {
    const sink = { record: vi.fn(async () => undefined) };
    const dedupeStore: AnalyticsDedupeStore = {
      hasProcessed: vi.fn(async () => false),
      markProcessed: vi.fn(async () => undefined),
    };
    const handler = createAnalyticsOutboxHandler({ sink, dedupeStore });

    await expect(handler(outboxEvent({
      payload: {
        event_id: 'analytics-event-1',
        event_type: 'dungeon_run_finalized',
        occurred_at: '2026-08-16T00:00:00.000Z',
        transaction_id: 'transaction-1',
        character_id: 'character-1',
        config_version: '2026.08.16.1',
        formula_version: 1,
        idempotency_key: 'idem-1',
        dedupe_key: 'dedupe-1',
        payload: { email: 'player@example.com' },
      },
    }))).rejects.toThrow('ANALYTICS_VALIDATION_FAILED');

    expect(sink.record).not.toHaveBeenCalled();
  });
});
