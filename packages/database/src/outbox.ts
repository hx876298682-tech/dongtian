import type { PoolClient } from 'pg';

import type { DatabasePool } from './index.js';

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | readonly JsonValue[] | { readonly [key: string]: JsonValue };

export type OutboxStatus = 'PENDING' | 'PROCESSING' | 'PUBLISHED' | 'FAILED';

export type OutboxEventDraft = {
  readonly eventType: string;
  readonly aggregateType: string;
  readonly aggregateId: string;
  readonly payload: JsonValue;
  readonly availableAt?: Date;
};

export type OutboxEvent = {
  readonly id: string;
  readonly eventType: string;
  readonly aggregateType: string;
  readonly aggregateId: string;
  readonly transactionId: string;
  readonly payload: JsonValue;
  readonly status: OutboxStatus;
  readonly attemptCount: number;
  readonly availableAt: Date;
  readonly lockedAt: Date | null;
  readonly publishedAt: Date | null;
  readonly lastError: string | null;
  readonly createdAt: Date;
};

type OutboxEventRow = {
  id: string;
  event_type: string;
  aggregate_type: string;
  aggregate_id: string;
  transaction_id: string;
  payload: JsonValue;
  status: OutboxStatus;
  attempt_count: number;
  available_at: Date;
  locked_at: Date | null;
  published_at: Date | null;
  last_error: string | null;
  created_at: Date;
};

export type OutboxRepository = {
  readonly insert: (
    client: PoolClient,
    transactionId: string,
    event: OutboxEventDraft,
  ) => Promise<string>;
  readonly insertMany: (
    client: PoolClient,
    transactionId: string,
    events: readonly OutboxEventDraft[],
  ) => Promise<readonly string[]>;
  readonly claimBatch: (input?: {
    readonly limit?: number;
    readonly now?: Date;
    readonly leaseMs?: number;
  }) => Promise<readonly OutboxEvent[]>;
  readonly hasPublished: (eventId: string) => Promise<boolean>;
  readonly markPublished: (eventId: string, now?: Date) => Promise<boolean>;
  readonly requeue: (eventId: string, error: string, availableAt: Date) => Promise<boolean>;
  readonly markFailed: (eventId: string, error: string, now?: Date) => Promise<boolean>;
};

function assertNonEmpty(value: string, field: string): void {
  if (value.trim().length === 0) {
    throw new Error(`OUTBOX_VALIDATION_FAILED: ${field}`);
  }
}

function toJson(payload: JsonValue): string {
  return JSON.stringify(payload);
}

function toEvent(row: OutboxEventRow): OutboxEvent {
  return {
    id: row.id,
    eventType: row.event_type,
    aggregateType: row.aggregate_type,
    aggregateId: row.aggregate_id,
    transactionId: row.transaction_id,
    payload: row.payload,
    status: row.status,
    attemptCount: row.attempt_count,
    availableAt: row.available_at,
    lockedAt: row.locked_at,
    publishedAt: row.published_at,
    lastError: row.last_error,
    createdAt: row.created_at,
  };
}

function errorText(error: unknown): string {
  if (error instanceof Error) {
    return `${error.name}: ${error.message}`.slice(0, 4_000);
  }
  return String(error).slice(0, 4_000);
}

export function createOutboxRepository(pool: DatabasePool): OutboxRepository {
  async function insert(
    client: PoolClient,
    transactionId: string,
    event: OutboxEventDraft,
  ): Promise<string> {
    assertNonEmpty(transactionId, 'transactionId');
    assertNonEmpty(event.eventType, 'eventType');
    assertNonEmpty(event.aggregateType, 'aggregateType');
    assertNonEmpty(event.aggregateId, 'aggregateId');

    const result = await client.query<{ id: string }>(
      `INSERT INTO outbox_events
        (event_type, aggregate_type, aggregate_id, transaction_id, payload, available_at)
       VALUES ($1, $2, $3, $4, $5::jsonb, COALESCE($6, CURRENT_TIMESTAMP))
       RETURNING id`,
      [
        event.eventType,
        event.aggregateType,
        event.aggregateId,
        transactionId,
        toJson(event.payload),
        event.availableAt ?? null,
      ],
    );
    const row = result.rows[0];
    if (!row) {
      throw new Error('OUTBOX_INSERT_FAILED');
    }
    return row.id;
  }

  async function insertMany(
    client: PoolClient,
    transactionId: string,
    events: readonly OutboxEventDraft[],
  ): Promise<readonly string[]> {
    const ids: string[] = [];
    for (const event of events) {
      ids.push(await insert(client, transactionId, event));
    }
    return ids;
  }

  async function claimBatch(input: {
    readonly limit?: number;
    readonly now?: Date;
    readonly leaseMs?: number;
  } = {}): Promise<readonly OutboxEvent[]> {
    const limit = input.limit ?? 50;
    const now = input.now ?? new Date();
    const leaseMs = input.leaseMs ?? 60_000;
    if (!Number.isInteger(limit) || limit < 1 || limit > 500) {
      throw new Error('OUTBOX_VALIDATION_FAILED: limit');
    }
    if (!Number.isInteger(leaseMs) || leaseMs < 1_000) {
      throw new Error('OUTBOX_VALIDATION_FAILED: leaseMs');
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const staleBefore = new Date(now.getTime() - leaseMs);
      const selected = await client.query<OutboxEventRow>(
        `SELECT id, event_type, aggregate_type, aggregate_id, transaction_id,
                payload, status, attempt_count, available_at, locked_at,
                published_at, last_error, created_at
           FROM outbox_events
          WHERE (status = 'PENDING' AND available_at <= $1)
             OR (status = 'PROCESSING' AND locked_at IS NOT NULL AND locked_at <= $2)
          ORDER BY available_at ASC, id ASC
          LIMIT $3
          FOR UPDATE SKIP LOCKED`,
        [now, staleBefore, limit],
      );

      const claimed: OutboxEvent[] = [];
      for (const row of selected.rows) {
        const updated = await client.query<OutboxEventRow>(
          `UPDATE outbox_events
              SET status = 'PROCESSING', locked_at = $1,
                  attempt_count = attempt_count + 1,
                  updated_at = CURRENT_TIMESTAMP
            WHERE id = $2
            RETURNING id, event_type, aggregate_type, aggregate_id, transaction_id,
                      payload, status, attempt_count, available_at, locked_at,
                      published_at, last_error, created_at`,
          [now, row.id],
        );
        const claimedRow = updated.rows[0];
        if (claimedRow) {
          claimed.push(toEvent(claimedRow));
        }
      }
      await client.query('COMMIT');
      return claimed;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async function hasPublished(eventId: string): Promise<boolean> {
    assertNonEmpty(eventId, 'eventId');
    const result = await pool.query<{ id: string }>(
      `SELECT id
         FROM outbox_events
        WHERE id = $1 AND status = 'PUBLISHED'
        LIMIT 1`,
      [eventId],
    );
    return result.rows.length === 1;
  }

  async function markPublished(eventId: string, now = new Date()): Promise<boolean> {
    assertNonEmpty(eventId, 'eventId');
    const result = await pool.query<{ id: string }>(
      `UPDATE outbox_events
          SET status = 'PUBLISHED', published_at = $2, locked_at = NULL,
              last_error = NULL, updated_at = CURRENT_TIMESTAMP
        WHERE id = $1 AND status = 'PROCESSING'
        RETURNING id`,
      [eventId, now],
    );
    return result.rows.length === 1;
  }

  async function requeue(eventId: string, error: string, availableAt: Date): Promise<boolean> {
    assertNonEmpty(eventId, 'eventId');
    const result = await pool.query<{ id: string }>(
      `UPDATE outbox_events
          SET status = 'PENDING', available_at = $2, locked_at = NULL,
              last_error = $3, updated_at = CURRENT_TIMESTAMP
        WHERE id = $1 AND status = 'PROCESSING'
        RETURNING id`,
      [eventId, availableAt, errorText(error)],
    );
    return result.rows.length === 1;
  }

  async function markFailed(eventId: string, error: string, now = new Date()): Promise<boolean> {
    assertNonEmpty(eventId, 'eventId');
    const result = await pool.query<{ id: string }>(
      `UPDATE outbox_events
          SET status = 'FAILED', locked_at = NULL, last_error = $2,
              updated_at = $3
        WHERE id = $1 AND status = 'PROCESSING'
        RETURNING id`,
      [eventId, errorText(error), now],
    );
    return result.rows.length === 1;
  }

  return { insert, insertMany, claimBatch, hasPublished, markPublished, requeue, markFailed };
}
