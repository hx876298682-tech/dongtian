import type { PoolClient } from 'pg';

import type { DatabasePool } from './index.js';

export type QueueJson = string | number | boolean | null | readonly QueueJson[] | { readonly [key: string]: QueueJson };
export type QueueMode = 'COUNT' | 'DURATION' | 'UNTIL_INVENTORY' | 'INFINITE';
export type QueueEntryStatus = 'QUEUED' | 'RUNNING' | 'BLOCKED' | 'DONE' | 'DONE_INCOMPLETE' | 'DONE_CONDITION_MET' | 'CANCELLED';
export type BlockedPolicy = 'SKIP' | 'FALLBACK';

export type QueueEntryRecord = {
  readonly id: string;
  readonly characterId: string;
  readonly clientEntryId: string | null;
  readonly position: number;
  readonly actionConfigId: string;
  readonly mode: QueueMode;
  readonly targetValue: string | null;
  readonly conditionItemId: string | null;
  readonly conditionOperator: string | null;
  readonly onBlocked: BlockedPolicy;
  readonly status: QueueEntryStatus;
  readonly completedCycles: bigint;
  readonly progressTimeUs: bigint;
  readonly snapshot: QueueJson | null;
  readonly snapshotConfigVersion: string | null;
  readonly startedAt: Date | null;
  readonly completedAt: Date | null;
  readonly blockedReason: string | null;
};

export type QueueRecord = {
  readonly characterId: string;
  readonly queueVersion: bigint;
  readonly pendingReplaceAfterCycle: boolean;
  readonly paused: boolean;
  readonly fallbackActionId: string;
  readonly entries: readonly QueueEntryRecord[];
};

export type QueueEntryWrite = {
  readonly clientEntryId: string;
  readonly position: number;
  readonly actionConfigId: string;
  readonly mode: QueueMode;
  readonly targetValue?: string;
  readonly conditionItemId?: string;
  readonly conditionOperator?: string;
  readonly onBlocked: BlockedPolicy;
  readonly configVersion: string;
};

export type QueueReplaceInput = {
  readonly characterId: string;
  readonly expectedQueueVersion: bigint;
  readonly fallbackActionId: string;
  readonly entries: readonly QueueEntryWrite[];
};

export class QueueVersionConflictError extends Error {
  public readonly code = 'QUEUE_VERSION_CONFLICT';
  public readonly status = 409;
  public readonly actualVersion: bigint;

  public constructor(actualVersion: bigint) {
    super('The queue version is stale.');
    this.name = 'QueueVersionConflictError';
    this.actualVersion = actualVersion;
  }
}

export class QueueNotFoundError extends Error {
  public readonly code = 'QUEUE_NOT_FOUND';
  public readonly status = 404;

  public constructor() {
    super('The character queue does not exist.');
    this.name = 'QueueNotFoundError';
  }
}

export class QueueWriteConflictError extends Error {
  public readonly code: 'QUEUE_CHARACTER_NOT_FOUND' | 'QUEUE_SETTLEMENT_STATE_NOT_FOUND' | 'SETTLEMENT_CONTINUATION_IN_PROGRESS';
  public readonly status = 409;

  public constructor(code: 'QUEUE_CHARACTER_NOT_FOUND' | 'QUEUE_SETTLEMENT_STATE_NOT_FOUND' | 'SETTLEMENT_CONTINUATION_IN_PROGRESS') {
    super(code);
    this.name = 'QueueWriteConflictError';
    this.code = code;
  }
}

type QueueRow = {
  character_id: string;
  queue_version: string;
  pending_replace_after_cycle: boolean;
  paused: boolean;
  fallback_action_id: string;
};

type EntryRow = {
  id: string;
  character_id: string;
  position: number;
  action_config_id: string;
  mode: QueueMode;
  target_value: string | null;
  condition_item_id: string | null;
  condition_operator: string | null;
  on_blocked: BlockedPolicy;
  status: QueueEntryStatus;
  completed_cycles: string;
  progress_time_us: string;
  snapshot: QueueJson | null;
  snapshot_config_version: string | null;
  started_at: Date | null;
  completed_at: Date | null;
  blocked_reason: string | null;
};

function clientEntryId(snapshot: QueueJson | null): string | null {
  if (typeof snapshot !== 'object' || snapshot === null || Array.isArray(snapshot)) {
    return null;
  }
  const value = (snapshot as { readonly [key: string]: QueueJson })['client_entry_id'];
  return typeof value === 'string' ? value : null;
}

function normalizeDecimalText(value: string | null): string | null {
  if (value === null || !value.includes('.')) {
    return value;
  }
  const separator = value.indexOf('.');
  const integerPart = value.slice(0, separator);
  const fractionPart = value.slice(separator + 1);
  const trimmedFraction = fractionPart.replace(/0+$/, '');
  return trimmedFraction.length === 0 ? integerPart : `${integerPart}.${trimmedFraction}`;
}

function toEntry(row: EntryRow): QueueEntryRecord {
  return {
    id: row.id,
    characterId: row.character_id,
    clientEntryId: clientEntryId(row.snapshot),
    position: row.position,
    actionConfigId: row.action_config_id,
    mode: row.mode,
    targetValue: normalizeDecimalText(row.target_value),
    conditionItemId: row.condition_item_id,
    conditionOperator: row.condition_operator,
    onBlocked: row.on_blocked,
    status: row.status,
    completedCycles: BigInt(row.completed_cycles),
    progressTimeUs: BigInt(row.progress_time_us),
    snapshot: row.snapshot,
    snapshotConfigVersion: row.snapshot_config_version,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    blockedReason: row.blocked_reason,
  };
}

export type QueueRepository = {
  readonly getQueue: (characterId: string) => Promise<QueueRecord | null>;
  readonly lockQueue: (client: PoolClient, characterId: string) => Promise<QueueRecord | null>;
  readonly replaceQueue: (client: PoolClient, input: QueueReplaceInput) => Promise<QueueRecord>;
  readonly setPaused: (
    client: PoolClient,
    input: { readonly characterId: string; readonly expectedQueueVersion: bigint; readonly paused: boolean },
  ) => Promise<QueueRecord>;
  readonly setEntryStatus: (
    client: PoolClient,
    input: {
      readonly characterId: string;
      readonly entryId: string;
      readonly status: QueueEntryStatus;
      readonly blockedReason?: string | null;
      readonly completedCycles?: bigint;
      readonly progressTimeUs?: bigint;
    },
  ) => Promise<QueueRecord>;
  readonly clearPendingReplaceAfterCycle?: (client: PoolClient, characterId: string) => Promise<void>;
};

async function lockWriteDependencies(client: PoolClient, characterId: string): Promise<void> {
  const character = await client.query<{ id: string }>(
    'SELECT id FROM characters WHERE id = $1 FOR UPDATE',
    [characterId],
  );
  if (!character.rows[0]) {
    throw new QueueWriteConflictError('QUEUE_CHARACTER_NOT_FOUND');
  }
  const state = await client.query<{ continuation_required: boolean }>(
    `SELECT continuation_required
       FROM settlement_states
      WHERE character_id = $1
      FOR UPDATE`,
    [characterId],
  );
  const stateRow = state.rows[0];
  if (!stateRow) {
    throw new QueueWriteConflictError('QUEUE_SETTLEMENT_STATE_NOT_FOUND');
  }
  if (stateRow.continuation_required) {
    throw new QueueWriteConflictError('SETTLEMENT_CONTINUATION_IN_PROGRESS');
  }
}

export function createQueueRepository(pool: DatabasePool): QueueRepository {
  async function readQueue(
    client: Pick<PoolClient, 'query'>,
    characterId: string,
    lock: boolean,
  ): Promise<QueueRecord | null> {
    const queueResult = await client.query<QueueRow>(
      `SELECT character_id, queue_version::text, pending_replace_after_cycle,
              paused, fallback_action_id
         FROM action_queues
        WHERE character_id = $1
        ${lock ? 'FOR UPDATE' : ''}`,
      [characterId],
    );
    const queue = queueResult.rows[0];
    if (!queue) {
      return null;
    }
    const entries = await client.query<EntryRow>(
      `SELECT id, character_id, position, action_config_id, mode,
              target_value::text, condition_item_id, condition_operator,
              on_blocked, status, completed_cycles::text, progress_time_us::text,
              snapshot, snapshot_config_version, started_at, completed_at, blocked_reason
         FROM action_queue_entries
        WHERE character_id = $1
        ORDER BY position ASC, id ASC
        ${lock ? 'FOR UPDATE' : ''}`,
      [characterId],
    );
    return {
      characterId: queue.character_id,
      queueVersion: BigInt(queue.queue_version),
      pendingReplaceAfterCycle: queue.pending_replace_after_cycle,
      paused: queue.paused,
      fallbackActionId: queue.fallback_action_id,
      entries: entries.rows.map(toEntry),
    };
  }

  async function lockQueue(client: PoolClient, characterId: string): Promise<QueueRecord | null> {
    await lockWriteDependencies(client, characterId);
    return readQueue(client, characterId, true);
  }

  async function replaceQueue(client: PoolClient, input: QueueReplaceInput): Promise<QueueRecord> {
    const current = await lockQueue(client, input.characterId);
    if (current === null) {
      if (input.expectedQueueVersion !== 0n) {
        throw new QueueVersionConflictError(0n);
      }
      await client.query(
        `INSERT INTO action_queues
          (character_id, queue_version, pending_replace_after_cycle, paused, fallback_action_id)
         VALUES ($1, 1, FALSE, FALSE, $2)`,
        [input.characterId, input.fallbackActionId],
      );
      await insertEntries(client, input, 0);
      return (await lockQueue(client, input.characterId)) ?? failQueueRead();
    }

    if (current.queueVersion !== input.expectedQueueVersion) {
      throw new QueueVersionConflictError(current.queueVersion);
    }
    const active = current.entries.find((entry) => entry.status === 'RUNNING');
    await client.query(
      `DELETE FROM action_queue_entries
        WHERE character_id = $1
          AND status IN ('QUEUED', 'BLOCKED')`,
      [input.characterId],
    );
    await client.query(
      `UPDATE action_queues
          SET queue_version = queue_version + 1,
              pending_replace_after_cycle = $2,
              fallback_action_id = $3,
              updated_at = CURRENT_TIMESTAMP
        WHERE character_id = $1`,
      [input.characterId, active !== undefined, input.fallbackActionId],
    );
    const entries = active === undefined
      ? input.entries
      : input.entries.filter(
          (entry) => entry.clientEntryId !== active.clientEntryId && entry.clientEntryId !== active.id,
        );
    await insertEntries(
      client,
      { ...input, entries },
      active === undefined ? 0 : active.position + 1,
    );
    return (await lockQueue(client, input.characterId)) ?? failQueueRead();
  }

  async function setPaused(
    client: PoolClient,
    input: { readonly characterId: string; readonly expectedQueueVersion: bigint; readonly paused: boolean },
  ): Promise<QueueRecord> {
    const current = await lockQueue(client, input.characterId);
    if (current === null) {
      throw new QueueNotFoundError();
    }
    if (current.queueVersion !== input.expectedQueueVersion) {
      throw new QueueVersionConflictError(current.queueVersion);
    }
    await client.query(
      `UPDATE action_queues
          SET queue_version = queue_version + 1,
              paused = $2,
              updated_at = CURRENT_TIMESTAMP
        WHERE character_id = $1`,
      [input.characterId, input.paused],
    );
    return (await lockQueue(client, input.characterId)) ?? failQueueRead();
  }

  async function clearPendingReplaceAfterCycle(client: PoolClient, characterId: string): Promise<void> {
    await client.query(
      `UPDATE action_queues
          SET pending_replace_after_cycle = FALSE,
              updated_at = CURRENT_TIMESTAMP
        WHERE character_id = $1`,
      [characterId],
    );
  }

  async function setEntryStatus(
    client: PoolClient,
    input: {
      readonly characterId: string;
      readonly entryId: string;
      readonly status: QueueEntryStatus;
      readonly blockedReason?: string | null;
      readonly completedCycles?: bigint;
      readonly progressTimeUs?: bigint;
    },
  ): Promise<QueueRecord> {
    const current = await lockQueue(client, input.characterId);
    if (current === null) {
      throw new QueueNotFoundError();
    }
    if (!current.entries.some((entry) => entry.id === input.entryId)) {
      throw new QueueNotFoundError();
    }
    await client.query(
      `UPDATE action_queue_entries
          SET status = $3::"QueueEntryStatus",
              blocked_reason = $4,
              completed_cycles = COALESCE($5, completed_cycles),
              progress_time_us = COALESCE($6, progress_time_us),
              completed_at = CASE WHEN $3::"QueueEntryStatus" IN ('DONE', 'DONE_INCOMPLETE', 'DONE_CONDITION_MET', 'CANCELLED')
                                  THEN CURRENT_TIMESTAMP ELSE completed_at END,
              updated_at = CURRENT_TIMESTAMP
        WHERE character_id = $1 AND id = $2`,
      [input.characterId, input.entryId, input.status, input.blockedReason ?? null, input.completedCycles?.toString() ?? null, input.progressTimeUs?.toString() ?? null],
    );
    return (await readQueue(client, input.characterId, true)) ?? failQueueRead();
  }

  return {
    getQueue: (characterId) => readQueue(pool, characterId, false),
    lockQueue,
    replaceQueue,
    setPaused,
    setEntryStatus,
    clearPendingReplaceAfterCycle,
  };
}

async function insertEntries(client: PoolClient, input: QueueReplaceInput, positionOffset: number): Promise<void> {
  for (const entry of input.entries) {
    const snapshot: QueueJson = { client_entry_id: entry.clientEntryId };
    await client.query(
      `INSERT INTO action_queue_entries
        (character_id, position, action_config_id, mode, target_value,
         condition_item_id, condition_operator, on_blocked, status,
         snapshot, snapshot_config_version, blocked_reason)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'QUEUED', $9::jsonb, $10, NULL)`,
      [
        input.characterId,
        entry.position + positionOffset,
        entry.actionConfigId,
        entry.mode,
        entry.targetValue ?? null,
        entry.conditionItemId ?? null,
        entry.conditionOperator ?? null,
        entry.onBlocked,
        JSON.stringify(snapshot),
        entry.configVersion,
      ],
    );
  }
}

function failQueueRead(): never {
  throw new Error('QUEUE_READ_AFTER_WRITE_FAILED');
}
