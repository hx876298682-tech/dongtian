import type { PoolClient } from 'pg';

import type { DatabasePool } from './index.js';

export type SettlementJson = string | number | boolean | null | readonly SettlementJson[] | { readonly [key: string]: SettlementJson };

export type SettlementStateRecord = {
  readonly characterId: string;
  readonly lastSettledAt: Date;
  readonly offlineCapSeconds: number;
  readonly activeQueueEntryId: string | null;
  readonly activeCycleIndex: bigint;
  readonly activeCycleSnapshot: SettlementJson | null;
  readonly progressTimeUs: bigint;
  readonly continuationRequired: boolean;
};

export type SettlementSegmentRecord = {
  readonly segmentIndex: number;
  readonly queueEntryId?: string;
  readonly actionConfigId: string;
  readonly fromAt: Date;
  readonly toAt: Date;
  readonly completedCycles: bigint;
  readonly inputs: SettlementJson;
  readonly outputs: SettlementJson;
  readonly xpChanges: SettlementJson;
  readonly transitionReason?: string;
  readonly snapshot: SettlementJson;
};

export type SettlementProgressionAward = {
  readonly cultivationXpDelta: string;
};

export type SettlementSkillProgressionAward = {
  readonly skillId: string;
  readonly skillXpDelta: string;
};

export type SettlementPersistenceInput = {
  readonly characterId: string;
  readonly fromAt: Date;
  readonly effectiveUntil: Date;
  readonly requestedUntil: Date;
  readonly effectiveSeconds: bigint;
  readonly cappedSeconds: bigint;
  readonly status: string;
  readonly randomSeed: Uint8Array;
  readonly formulaVersion: number;
  readonly configVersion: string;
  readonly summary: SettlementJson;
  readonly errorCode?: string;
  readonly completedAt?: Date;
  readonly segments: readonly SettlementSegmentRecord[];
  readonly progressionAward?: SettlementProgressionAward;
  readonly skillProgressionAwards?: readonly SettlementSkillProgressionAward[];
  readonly nextState: {
    readonly lastSettledAt: Date;
    readonly activeQueueEntryId?: string;
    readonly activeCycleIndex: bigint;
    readonly activeCycleSnapshot: SettlementJson | null;
    readonly progressTimeUs: bigint;
    readonly continuationRequired: boolean;
  };
};

export type SettlementRunRecord = {
  readonly settlementId: string;
  readonly characterId: string;
  readonly fromAt: Date;
  readonly effectiveUntil: Date;
  readonly requestedUntil: Date;
  readonly effectiveSeconds: bigint;
  readonly cappedSeconds: bigint;
  readonly status: string;
  readonly segmentCount: number;
  readonly randomSeed: Uint8Array;
  readonly formulaVersion: number;
  readonly configVersion: string;
  readonly summary: SettlementJson;
  readonly errorCode: string | null;
  readonly createdAt: Date;
  readonly completedAt: Date | null;
};

export type SettlementRunSegmentRecord = Omit<SettlementSegmentRecord, 'transitionReason'> & {
  readonly settlementRunId: string;
  readonly transitionReason?: string;
};

export type SettlementRunLedgerRecord = {
  readonly entryId: string;
  readonly transactionId: string;
  readonly assetType: string;
  readonly assetId: string;
  readonly delta: string;
  readonly balanceAfter: string;
  readonly reasonCode: string;
  readonly referenceType: string;
  readonly referenceId: string;
  readonly configVersion: string;
  readonly createdAt: Date;
};

export type SettlementSummaryRecord = {
  readonly run: SettlementRunRecord;
  readonly segments: readonly SettlementRunSegmentRecord[];
  readonly ledgerEntries: readonly SettlementRunLedgerRecord[];
};

export type SettlementRepository = {
  readonly getState: (characterId: string) => Promise<SettlementStateRecord | null>;
  readonly lockState: (client: PoolClient, characterId: string) => Promise<SettlementStateRecord | null>;
  readonly persist: (client: PoolClient, input: SettlementPersistenceInput) => Promise<string>;
  readonly getLatestSummary: (characterId: string) => Promise<SettlementSummaryRecord | null>;
  readonly getSummaryById: (characterId: string, settlementId: string) => Promise<SettlementSummaryRecord | null>;
  readonly runContinuationBatch: (
    limit: number,
    handler: (client: PoolClient, characterId: string) => Promise<void>,
  ) => Promise<number>;
};

type StateRow = {
  character_id: string;
  last_settled_at: Date;
  offline_cap_seconds: number;
  active_queue_entry_id: string | null;
  active_cycle_index: string;
  active_cycle_snapshot: SettlementJson | null;
  progress_time_us: string;
  continuation_required: boolean;
};

type SummaryRow = {
  id: string;
  character_id: string;
  from_at: Date;
  effective_until: Date;
  requested_until: Date;
  effective_seconds: string;
  capped_seconds: string;
  status: string;
  segment_count: number;
  random_seed: Buffer | Uint8Array;
  formula_version: number;
  config_version: string;
  summary: SettlementJson;
  error_code: string | null;
  created_at: Date;
  completed_at: Date | null;
};

type SummarySegmentRow = {
  settlement_run_id: string;
  segment_index: number;
  queue_entry_id: string | null;
  action_config_id: string;
  from_at: Date;
  to_at: Date;
  completed_cycles: string;
  inputs: SettlementJson;
  outputs: SettlementJson;
  xp_changes: SettlementJson;
  transition_reason: string | null;
  snapshot: SettlementJson;
};

type SummaryLedgerRow = {
  entry_id: string;
  transaction_id: string;
  asset_type: string;
  asset_id: string;
  delta: string;
  balance_after: string;
  reason_code: string;
  reference_type: string;
  reference_id: string;
  config_version: string;
  created_at: Date;
};

function toState(row: StateRow): SettlementStateRecord {
  return {
    characterId: row.character_id,
    lastSettledAt: row.last_settled_at,
    offlineCapSeconds: row.offline_cap_seconds,
    activeQueueEntryId: row.active_queue_entry_id,
    activeCycleIndex: BigInt(row.active_cycle_index),
    activeCycleSnapshot: row.active_cycle_snapshot,
    progressTimeUs: BigInt(row.progress_time_us),
    continuationRequired: row.continuation_required,
  };
}

function json(value: SettlementJson): string {
  return JSON.stringify(value);
}

function assertProgressionDelta(value: string): void {
  if (!/^(?:0|[1-9]\d*)(?:\.\d{1,6})?$/.test(value)) {
    throw new Error('SETTLEMENT_PROGRESSION_DELTA_INVALID');
  }
}

function toSummaryRow(row: SummaryRow): SettlementRunRecord {
  return {
    settlementId: row.id,
    characterId: row.character_id,
    fromAt: row.from_at,
    effectiveUntil: row.effective_until,
    requestedUntil: row.requested_until,
    effectiveSeconds: BigInt(row.effective_seconds),
    cappedSeconds: BigInt(row.capped_seconds),
    status: row.status,
    segmentCount: row.segment_count,
    randomSeed: row.random_seed instanceof Uint8Array ? row.random_seed : new Uint8Array(row.random_seed),
    formulaVersion: row.formula_version,
    configVersion: row.config_version,
    summary: row.summary,
    errorCode: row.error_code,
    createdAt: row.created_at,
    completedAt: row.completed_at,
  };
}

function selectLatestSummary(
  client: Pick<PoolClient, 'query'>,
  characterId: string,
): Promise<SettlementSummaryRecord | null> {
  return loadSummary(client, {
    sql: `SELECT id, character_id, from_at, effective_until, requested_until,
                 effective_seconds::text, capped_seconds::text, status, segment_count,
                 random_seed, formula_version, config_version, summary,
                 error_code, created_at, completed_at
            FROM settlement_runs
           WHERE character_id = $1
           ORDER BY created_at DESC, id DESC
           LIMIT 1`,
    params: [characterId],
  });
}

function loadSummary(
  client: Pick<PoolClient, 'query'>,
  input: { readonly sql: string; readonly params: readonly unknown[] },
): Promise<SettlementSummaryRecord | null> {
  return client.query<SummaryRow>(input.sql, [...input.params]).then(async (result) => {
    const row = result.rows[0];
    if (!row) {
      return null;
    }
    const run = toSummaryRow(row);
    const [segments, ledgerEntries] = await Promise.all([
      client.query<SummarySegmentRow>(
        `SELECT settlement_run_id, segment_index, queue_entry_id, action_config_id,
                from_at, to_at, completed_cycles::text, inputs, outputs, xp_changes,
                transition_reason, snapshot
           FROM settlement_segments
          WHERE settlement_run_id = $1
          ORDER BY segment_index ASC`,
        [run.settlementId],
      ),
      client.query<SummaryLedgerRow>(
        `SELECT entry_id, transaction_id, asset_type, asset_id, delta::text, balance_after::text,
                reason_code, reference_type, reference_id, config_version, created_at
           FROM asset_ledger
          WHERE character_id = $1
            AND reference_type = 'SETTLEMENT_RUN'
            AND reference_id = $2
          ORDER BY created_at ASC, entry_id ASC`,
        [run.characterId, run.settlementId],
      ),
    ]);
    return {
      run,
      segments: segments.rows.map((segment) => ({
        settlementRunId: segment.settlement_run_id,
        segmentIndex: segment.segment_index,
        actionConfigId: segment.action_config_id,
        fromAt: segment.from_at,
        toAt: segment.to_at,
        completedCycles: BigInt(segment.completed_cycles),
        inputs: segment.inputs,
        outputs: segment.outputs,
        xpChanges: segment.xp_changes,
        snapshot: segment.snapshot,
        ...(segment.queue_entry_id === null ? {} : { queueEntryId: segment.queue_entry_id }),
        ...(segment.transition_reason === null ? {} : { transitionReason: segment.transition_reason }),
      })),
      ledgerEntries: ledgerEntries.rows.map((ledger) => ({
        entryId: ledger.entry_id,
        transactionId: ledger.transaction_id,
        assetType: ledger.asset_type,
        assetId: ledger.asset_id,
        delta: ledger.delta,
        balanceAfter: ledger.balance_after,
        reasonCode: ledger.reason_code,
        referenceType: ledger.reference_type,
        referenceId: ledger.reference_id,
        configVersion: ledger.config_version,
        createdAt: ledger.created_at,
      })),
    };
  });
}

export function createSettlementRepository(pool: DatabasePool): SettlementRepository {
  async function selectState(client: PoolClient, characterId: string, lock: boolean): Promise<SettlementStateRecord | null> {
    const result = await client.query<StateRow>(
      `SELECT character_id, last_settled_at, offline_cap_seconds,
              active_queue_entry_id, active_cycle_index::text,
              active_cycle_snapshot, progress_time_us::text,
              continuation_required
         FROM settlement_states
        WHERE character_id = $1
        ${lock ? 'FOR UPDATE' : ''}`,
      [characterId],
    );
    const row = result.rows[0];
    return row ? toState(row) : null;
  }

  async function getState(characterId: string): Promise<SettlementStateRecord | null> {
    return selectState(pool as unknown as PoolClient, characterId, false);
  }

  async function lockState(client: PoolClient, characterId: string): Promise<SettlementStateRecord | null> {
    return selectState(client, characterId, true);
  }

  async function persist(client: PoolClient, input: SettlementPersistenceInput): Promise<string> {
    const runResult = await client.query<{ id: string }>(
      `INSERT INTO settlement_runs (
         character_id, from_at, effective_until, requested_until,
         effective_seconds, capped_seconds, status, segment_count,
         random_seed, formula_version, config_version, summary,
         error_code, completed_at
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb, $13, $14)
       RETURNING id`,
      [
        input.characterId,
        input.fromAt,
        input.effectiveUntil,
        input.requestedUntil,
        input.effectiveSeconds.toString(),
        input.cappedSeconds.toString(),
        input.status,
        input.segments.length,
        Buffer.from(input.randomSeed),
        input.formulaVersion,
        input.configVersion,
        json(input.summary),
        input.errorCode ?? null,
        input.completedAt ?? null,
      ],
    );
    const run = runResult.rows[0];
    if (!run) {
      throw new Error('SETTLEMENT_RUN_CREATE_FAILED');
    }

    for (const segment of input.segments) {
      await client.query(
        `INSERT INTO settlement_segments (
           settlement_run_id, segment_index, queue_entry_id, action_config_id,
           from_at, to_at, completed_cycles, inputs, outputs, xp_changes,
           transition_reason, snapshot
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9::jsonb, $10::jsonb, $11, $12::jsonb)`,
        [
          run.id,
          segment.segmentIndex,
          segment.queueEntryId ?? null,
          segment.actionConfigId,
          segment.fromAt,
          segment.toAt,
          segment.completedCycles.toString(),
          json(segment.inputs),
          json(segment.outputs),
          json(segment.xpChanges),
          segment.transitionReason ?? null,
          json(segment.snapshot),
        ],
      );
    }

    const progressionAward = input.progressionAward;
    if (progressionAward !== undefined) {
      assertProgressionDelta(progressionAward.cultivationXpDelta);
      if (progressionAward.cultivationXpDelta !== '0') {
        const transactionResult = await client.query<{ id: string }>(
          `INSERT INTO asset_transactions (
             character_id, operation_type, reason_code, reference_type,
             reference_id, config_version
           )
           VALUES ($1, 'SETTLEMENT', 'ACTION_CULTIVATION', 'SETTLEMENT_RUN', $2, $3)
           RETURNING id`,
          [input.characterId, run.id, input.configVersion],
        );
        const transaction = transactionResult.rows[0];
        if (!transaction) {
          throw new Error('SETTLEMENT_PROGRESSION_TRANSACTION_FAILED');
        }

        const progressionResult = await client.query<{ cultivation_xp: string }>(
          `UPDATE character_progression
              SET cultivation_xp = cultivation_xp + $2::numeric,
                  updated_at = CURRENT_TIMESTAMP
            WHERE character_id = $1
            RETURNING cultivation_xp::text`,
          [input.characterId, progressionAward.cultivationXpDelta],
        );
        const progression = progressionResult.rows[0];
        if (!progression) {
          throw new Error('SETTLEMENT_PROGRESSION_NOT_FOUND');
        }

        await client.query(
          `INSERT INTO asset_ledger (
             transaction_id, character_id, asset_type, asset_id, delta,
             balance_after, reason_code, reference_type, reference_id, config_version
           )
           VALUES ($1, $2, 'PROGRESSION', 'progression.cultivation', $3::numeric,
                   $4::numeric, 'ACTION_CULTIVATION', 'SETTLEMENT_RUN', $5, $6)`,
          [
            transaction.id,
            input.characterId,
            progressionAward.cultivationXpDelta,
            progression.cultivation_xp,
            run.id,
            input.configVersion,
          ],
        );
      }
    }

    const skillAwards = input.skillProgressionAwards ?? [];
    for (const award of skillAwards) {
      if (award.skillId.trim().length === 0) {
        throw new Error('SETTLEMENT_SKILL_AWARD_INVALID');
      }
      assertProgressionDelta(award.skillXpDelta);
      if (award.skillXpDelta === '0') {
        continue;
      }
      const skillResult = await client.query<{ xp: string }>(
        `UPDATE skill_progression
            SET xp = xp + $3::numeric,
                updated_at = CURRENT_TIMESTAMP
          WHERE character_id = $1 AND skill_id = $2
          RETURNING xp::text AS xp`,
        [input.characterId, award.skillId, award.skillXpDelta],
      );
      if (!skillResult.rows[0]) {
        throw new Error('SETTLEMENT_SKILL_PROGRESSION_NOT_FOUND');
      }
    }

    await client.query(
      `UPDATE settlement_states
          SET last_settled_at = $2,
              active_queue_entry_id = $3,
              active_cycle_index = $4,
              active_cycle_snapshot = $5::jsonb,
              progress_time_us = $6,
              continuation_required = $7,
              updated_at = CURRENT_TIMESTAMP
        WHERE character_id = $1`,
      [
        input.characterId,
        input.nextState.lastSettledAt,
        input.nextState.activeQueueEntryId ?? null,
        input.nextState.activeCycleIndex.toString(),
        input.nextState.activeCycleSnapshot === null ? null : json(input.nextState.activeCycleSnapshot),
        input.nextState.progressTimeUs.toString(),
        input.nextState.continuationRequired,
      ],
    );
    return run.id;
  }

  async function getSummaryById(characterId: string, settlementId: string): Promise<SettlementSummaryRecord | null> {
    return loadSummary(pool as unknown as Pick<PoolClient, 'query'>, {
      sql: `SELECT id, character_id, from_at, effective_until, requested_until,
                   effective_seconds::text, capped_seconds::text, status, segment_count,
                   random_seed, formula_version, config_version, summary,
                   error_code, created_at, completed_at
              FROM settlement_runs
             WHERE character_id = $1 AND id = $2
             LIMIT 1`,
      params: [characterId, settlementId],
    });
  }

  async function getLatestSummary(characterId: string): Promise<SettlementSummaryRecord | null> {
    return selectLatestSummary(pool as unknown as Pick<PoolClient, 'query'>, characterId);
  }

  async function runContinuationBatch(
    limit: number,
    handler: (client: PoolClient, characterId: string) => Promise<void>,
  ): Promise<number> {
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
      throw new Error('SETTLEMENT_CONTINUATION_LIMIT_INVALID');
    }
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const candidates = await client.query<{ character_id: string }>(
        `SELECT c.id AS character_id
           FROM characters c
           INNER JOIN settlement_states s ON s.character_id = c.id
          WHERE s.continuation_required = TRUE
          ORDER BY s.updated_at ASC, c.id ASC
          LIMIT $1
          FOR UPDATE OF c SKIP LOCKED`,
        [limit],
      );
      for (const candidate of candidates.rows) {
        const state = await lockState(client, candidate.character_id);
        if (!state) {
          throw new Error('SETTLEMENT_STATE_NOT_FOUND');
        }
        await handler(client, candidate.character_id);
      }
      await client.query('COMMIT');
      return candidates.rows.length;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  return { getState, lockState, persist, getLatestSummary, getSummaryById, runContinuationBatch };
}
