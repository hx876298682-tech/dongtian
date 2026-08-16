import { createHash, timingSafeEqual } from 'node:crypto';
import type { PoolClient } from 'pg';

import type { DatabasePool } from './index.js';
import {
  createOutboxRepository,
  type JsonValue,
  type OutboxEventDraft,
} from './outbox.js';

const MIN_RETENTION_MS = 24 * 60 * 60 * 1_000;
const PENDING_HTTP_STATUS = 102;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type IdempotencyExecutionInput<T extends JsonValue> = {
  readonly accountId: string;
  readonly operationType: string;
  readonly idempotencyKey: string;
  readonly request: unknown;
  readonly now?: Date;
  readonly retentionMs?: number;
  readonly execute: (context: {
    readonly client: PoolClient;
    readonly idempotencyRecordId: string;
    readonly requestHash: string;
  }) => Promise<IdempotencyCommit<T>>;
};

export type IdempotencyCommit<T> = {
  readonly statusCode: number;
  readonly response: T;
  readonly transactionId?: string;
  readonly outboxEvents?: readonly OutboxEventDraft[];
};

export type IdempotencyResult<T extends JsonValue> = {
  readonly statusCode: number;
  readonly response: T;
  readonly replayed: boolean;
};

export class IdempotencyKeyReusedError extends Error {
  public readonly code = 'IDEMPOTENCY_KEY_REUSED';
  public readonly status = 409;

  public constructor() {
    super('The idempotency key was already used with a different request.');
    this.name = 'IdempotencyKeyReusedError';
  }
}

export class IdempotencyInProgressError extends Error {
  public readonly code = 'IDEMPOTENCY_IN_PROGRESS';
  public readonly status = 409;

  public constructor() {
    super('The idempotency request is still in progress.');
    this.name = 'IdempotencyInProgressError';
  }
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') {
    return JSON.stringify(value);
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new Error('IDEMPOTENCY_REQUEST_INVALID: non-finite number');
    }
    return JSON.stringify(value);
  }
  if (typeof value === 'undefined') {
    return 'null';
  }
  if (typeof value === 'bigint' || typeof value === 'function' || typeof value === 'symbol') {
    throw new Error('IDEMPOTENCY_REQUEST_INVALID: unsupported value');
  }
  if (Array.isArray(value)) {
    return `[${value.map((entry) => canonicalJson(entry)).join(',')}]`;
  }
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const fields = Object.keys(record)
      .filter((key) => typeof record[key] !== 'undefined')
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`);
    return `{${fields.join(',')}}`;
  }
  throw new Error('IDEMPOTENCY_REQUEST_INVALID: unsupported value');
}

export function normalizeIdempotencyRequest(request: unknown): string {
  return canonicalJson(request);
}

export function hashIdempotencyRequest(request: unknown): string {
  return createHash('sha256').update(normalizeIdempotencyRequest(request), 'utf8').digest('hex');
}

export function validateIdempotencyKey(idempotencyKey: string): void {
  if (!UUID_PATTERN.test(idempotencyKey)) {
    throw new Error('IDEMPOTENCY_KEY_INVALID');
  }
}

function sameHash(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left, 'utf8');
  const rightBuffer = Buffer.from(right, 'utf8');
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function assertCommit(statusCode: number, outboxEvents: readonly OutboxEventDraft[], transactionId: string | undefined): void {
  if (!Number.isInteger(statusCode) || statusCode < 200 || statusCode > 599) {
    throw new Error('IDEMPOTENCY_RESPONSE_INVALID: statusCode');
  }
  if (outboxEvents.length > 0 && !transactionId) {
    throw new Error('IDEMPOTENCY_RESPONSE_INVALID: transactionId required for outbox');
  }
}

type IdempotencyRow = {
  id: string;
  request_hash: string;
  http_status: number;
  response_snapshot: JsonValue;
};

export type IdempotencyExecutor = {
  readonly execute: <T extends JsonValue>(
    input: IdempotencyExecutionInput<T>,
  ) => Promise<IdempotencyResult<T>>;
};

export function createIdempotencyExecutor(pool: DatabasePool): IdempotencyExecutor {
  const outbox = createOutboxRepository(pool);

  async function execute<T extends JsonValue>(
    input: IdempotencyExecutionInput<T>,
  ): Promise<IdempotencyResult<T>> {
    validateIdempotencyKey(input.idempotencyKey);
    if (input.accountId.trim().length === 0 || input.operationType.trim().length === 0) {
      throw new Error('IDEMPOTENCY_REQUEST_INVALID: accountId or operationType');
    }
    const requestHash = hashIdempotencyRequest(input.request);
    const now = input.now ?? new Date();
    const retentionMs = Math.max(input.retentionMs ?? MIN_RETENTION_MS, MIN_RETENTION_MS);
    if (!Number.isFinite(retentionMs)) {
      throw new Error('IDEMPOTENCY_REQUEST_INVALID: retentionMs');
    }
    const expiresAt = new Date(now.getTime() + retentionMs);
    const client = await pool.connect();

    try {
      await client.query('BEGIN');
      const inserted = await client.query<{ id: string }>(
        `INSERT INTO idempotency_records
          (account_id, operation_type, idempotency_key, request_hash,
           http_status, response_snapshot, created_at, expires_at)
         VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8)
         ON CONFLICT (account_id, operation_type, idempotency_key) DO NOTHING
         RETURNING id`,
        [
          input.accountId,
          input.operationType,
          input.idempotencyKey,
          requestHash,
          PENDING_HTTP_STATUS,
          '{}',
          now,
          expiresAt,
        ],
      );

      const insertedRow = inserted.rows[0];
      if (!insertedRow) {
        const existing = await client.query<IdempotencyRow>(
          `SELECT id, request_hash, http_status, response_snapshot
             FROM idempotency_records
            WHERE account_id = $1 AND operation_type = $2 AND idempotency_key = $3
            FOR UPDATE`,
          [input.accountId, input.operationType, input.idempotencyKey],
        );
        const existingRow = existing.rows[0];
        if (!existingRow) {
          throw new Error('IDEMPOTENCY_RECORD_NOT_FOUND');
        }
        if (!sameHash(existingRow.request_hash, requestHash)) {
          throw new IdempotencyKeyReusedError();
        }
        if (existingRow.http_status === PENDING_HTTP_STATUS) {
          throw new IdempotencyInProgressError();
        }
        await client.query('COMMIT');
        return {
          statusCode: existingRow.http_status,
          response: existingRow.response_snapshot as T,
          replayed: true,
        };
      }

      const commit = await input.execute({
        client,
        idempotencyRecordId: insertedRow.id,
        requestHash,
      });
      const events = commit.outboxEvents ?? [];
      assertCommit(commit.statusCode, events, commit.transactionId);
      if (commit.transactionId && events.length > 0) {
        await outbox.insertMany(client, commit.transactionId, events);
      }
      await client.query(
        `UPDATE idempotency_records
            SET http_status = $2, response_snapshot = $3::jsonb
          WHERE id = $1`,
        [insertedRow.id, commit.statusCode, JSON.stringify(commit.response)],
      );
      await client.query('COMMIT');
      return {
        statusCode: commit.statusCode,
        response: commit.response,
        replayed: false,
      };
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  return { execute };
}
