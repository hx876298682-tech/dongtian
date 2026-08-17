import type { PoolClient } from 'pg';

import type { DatabasePool, JsonValue } from './index.js';

export type BreakthroughStatus =
  | 'READY'
  | 'TRIAL_ACTIVE'
  | 'TRIAL_WAITING_CHOICE'
  | 'COMPLETED'
  | 'FAILED_RECOVERABLE'
  | 'ABANDONED';

export type BreakthroughReservedAsset = {
  readonly assetType: 'ITEM' | 'CURRENCY';
  readonly assetId: string;
  readonly quantity: string;
};

export type BreakthroughRunRecord = {
  readonly breakthroughRunId: string;
  readonly characterId: string;
  readonly breakthroughConfigId: string;
  readonly configVersion: string;
  readonly formulaVersion: number;
  readonly status: BreakthroughStatus;
  readonly runVersion: string;
  readonly currentNodeId: string;
  readonly createdAt: Date;
  readonly trialDeadlineAt: Date;
  readonly expiresAt: Date;
  readonly selectedChoiceId: string | null;
  readonly selectedRouteId: string | null;
  readonly selectedRouteRisk: 'SAFE' | 'HIGH_RISK' | null;
  readonly selectedAt: Date | null;
  readonly finalizedAt: Date | null;
  readonly abandonedAt: Date | null;
  readonly releasedAt: Date | null;
  readonly reservationSnapshot: readonly BreakthroughReservedAsset[];
  readonly previewSnapshot: JsonValue;
  readonly result: JsonValue | null;
  readonly updatedAt: Date;
};

export type BreakthroughRunCreateInput = {
  readonly breakthroughRunId: string;
  readonly characterId: string;
  readonly breakthroughConfigId: string;
  readonly configVersion: string;
  readonly formulaVersion: number;
  readonly status: BreakthroughStatus;
  readonly currentNodeId: string;
  readonly createdAt: Date;
  readonly trialDeadlineAt: Date;
  readonly expiresAt: Date;
  readonly selectedChoiceId: string | null;
  readonly selectedRouteId: string | null;
  readonly selectedRouteRisk: 'SAFE' | 'HIGH_RISK' | null;
  readonly selectedAt: Date | null;
  readonly finalizedAt: Date | null;
  readonly abandonedAt: Date | null;
  readonly releasedAt: Date | null;
  readonly reservationSnapshot: readonly BreakthroughReservedAsset[];
  readonly previewSnapshot: JsonValue;
  readonly result: JsonValue | null;
};

export type BreakthroughRunChoiceInput = {
  readonly breakthroughRunId: string;
  readonly characterId: string;
  readonly choiceId: string;
  readonly routeId: string;
  readonly routeRisk: 'SAFE' | 'HIGH_RISK';
  readonly chosenAt: Date;
};

export type BreakthroughRunRecoveryInput = {
  readonly breakthroughRunId: string;
  readonly characterId: string;
  readonly recoveredAt: Date;
};

export type BreakthroughRunFinalizeInput = {
  readonly breakthroughRunId: string;
  readonly characterId: string;
  readonly finalizedAt: Date;
  readonly result: JsonValue;
};

export type BreakthroughRunLifecycleInput = {
  readonly breakthroughRunId: string;
  readonly characterId: string;
  readonly endedAt: Date;
};

export type BreakthroughRecoveryHandler = (
  client: PoolClient,
  characterId: string,
  breakthroughRunId: string,
) => Promise<void>;

export type BreakthroughRepository = {
  readonly getRun: (breakthroughRunId: string) => Promise<BreakthroughRunRecord | null>;
  readonly getLatestRun: (characterId: string) => Promise<BreakthroughRunRecord | null>;
  readonly getActiveRun: (characterId: string) => Promise<BreakthroughRunRecord | null>;
  readonly lockActiveRun: (
    client: PoolClient,
    characterId: string,
  ) => Promise<BreakthroughRunRecord | null>;
  readonly lockRun: (
    client: PoolClient,
    breakthroughRunId: string,
  ) => Promise<BreakthroughRunRecord | null>;
  readonly listRecoverableRuns: (
    limit: number,
    now: Date,
  ) => Promise<readonly Pick<BreakthroughRunRecord, 'breakthroughRunId' | 'characterId'>[]>;
  readonly createRunOnTransaction: (
    client: PoolClient,
    input: BreakthroughRunCreateInput,
  ) => Promise<BreakthroughRunRecord>;
  readonly markChoiceOnTransaction: (
    client: PoolClient,
    input: BreakthroughRunChoiceInput,
  ) => Promise<BreakthroughRunRecord | null>;
  readonly markRecoveredOnTransaction: (
    client: PoolClient,
    input: BreakthroughRunRecoveryInput,
  ) => Promise<BreakthroughRunRecord | null>;
  readonly markAbandonedOnTransaction: (
    client: PoolClient,
    input: BreakthroughRunLifecycleInput,
  ) => Promise<BreakthroughRunRecord | null>;
  readonly markFinalizedOnTransaction: (
    client: PoolClient,
    input: BreakthroughRunFinalizeInput,
  ) => Promise<BreakthroughRunRecord | null>;
  readonly runRecoveryBatch: (
    limit: number,
    handler: BreakthroughRecoveryHandler,
  ) => Promise<number>;
};

type BreakthroughRunRow = {
  id: string;
  character_id: string;
  breakthrough_config_id: string;
  config_version: string;
  formula_version: number;
  status: BreakthroughStatus;
  run_version: string;
  current_node_id: string;
  created_at: Date;
  trial_deadline_at: Date;
  expires_at: Date;
  selected_choice_id: string | null;
  selected_route_id: string | null;
  selected_route_risk: 'SAFE' | 'HIGH_RISK' | null;
  selected_at: Date | null;
  finalized_at: Date | null;
  abandoned_at: Date | null;
  released_at: Date | null;
  reservation_snapshot: JsonValue;
  preview_snapshot: JsonValue;
  result: JsonValue | null;
  updated_at: Date;
};

function assertNonEmpty(value: string, field: string): void {
  if (value.trim().length === 0) {
    throw new Error(`BREAKTHROUGH_VALIDATION_FAILED:${field}`);
  }
}

function assertReservationSnapshot(value: readonly BreakthroughReservedAsset[]): void {
  for (const reservation of value) {
    if (reservation.assetType !== 'ITEM' && reservation.assetType !== 'CURRENCY') {
      throw new Error('BREAKTHROUGH_VALIDATION_FAILED:reservation_asset_type');
    }
    assertNonEmpty(reservation.assetId, 'reservation_asset_id');
    if (!/^(?:0|[1-9]\d*)(?:\.\d{1,6})?$/.test(reservation.quantity)) {
      throw new Error('BREAKTHROUGH_VALIDATION_FAILED:reservation_quantity');
    }
  }
}

function toRunRecord(row: BreakthroughRunRow): BreakthroughRunRecord {
  return {
    breakthroughRunId: row.id,
    characterId: row.character_id,
    breakthroughConfigId: row.breakthrough_config_id,
    configVersion: row.config_version,
    formulaVersion: row.formula_version,
    status: row.status,
    runVersion: row.run_version,
    currentNodeId: row.current_node_id,
    createdAt: row.created_at,
    trialDeadlineAt: row.trial_deadline_at,
    expiresAt: row.expires_at,
    selectedChoiceId: row.selected_choice_id,
    selectedRouteId: row.selected_route_id,
    selectedRouteRisk: row.selected_route_risk,
    selectedAt: row.selected_at,
    finalizedAt: row.finalized_at,
    abandonedAt: row.abandoned_at,
    releasedAt: row.released_at,
    reservationSnapshot: row.reservation_snapshot as readonly BreakthroughReservedAsset[],
    previewSnapshot: row.preview_snapshot,
    result: row.result,
    updatedAt: row.updated_at,
  };
}

async function readRun(client: Pick<PoolClient, 'query'>, sql: string, params: readonly unknown[]): Promise<BreakthroughRunRecord | null> {
  const result = await client.query<BreakthroughRunRow>(sql, [...params]);
  const row = result.rows[0];
  return row ? toRunRecord(row) : null;
}

async function updateRun(
  client: PoolClient,
  input: BreakthroughRunChoiceInput | BreakthroughRunRecoveryInput | BreakthroughRunLifecycleInput | BreakthroughRunFinalizeInput,
  status: BreakthroughStatus,
  patch: {
    readonly currentNodeId: string;
    readonly selectedChoiceId?: string | null;
    readonly selectedRouteId?: string | null;
    readonly selectedRouteRisk?: 'SAFE' | 'HIGH_RISK' | null;
    readonly selectedAt?: Date | null;
    readonly finalizedAt?: Date | null;
    readonly abandonedAt?: Date | null;
    readonly releasedAt?: Date | null;
    readonly result?: JsonValue | null;
  },
): Promise<BreakthroughRunRecord | null> {
  const result = await client.query<BreakthroughRunRow>(
    `UPDATE breakthrough_runs
        SET status = $2,
            current_node_id = $3,
            run_version = run_version + 1,
            selected_choice_id = COALESCE($4, selected_choice_id),
            selected_route_id = COALESCE($5, selected_route_id),
            selected_route_risk = COALESCE($6, selected_route_risk),
            selected_at = COALESCE($7, selected_at),
            finalized_at = COALESCE($8, finalized_at),
            abandoned_at = COALESCE($9, abandoned_at),
            released_at = COALESCE($10, released_at),
            result = COALESCE($11::jsonb, result),
            updated_at = CURRENT_TIMESTAMP
      WHERE id = $1
        AND character_id = $12
      RETURNING
        id, character_id, breakthrough_config_id, config_version, formula_version, status,
        run_version::text AS run_version, current_node_id, created_at, trial_deadline_at, expires_at,
        selected_choice_id, selected_route_id, selected_route_risk, selected_at, finalized_at,
        abandoned_at, released_at, reservation_snapshot, preview_snapshot, result, updated_at`,
    [
      input.breakthroughRunId,
      status,
      patch.currentNodeId,
      patch.selectedChoiceId ?? null,
      patch.selectedRouteId ?? null,
      patch.selectedRouteRisk ?? null,
      patch.selectedAt ?? null,
      patch.finalizedAt ?? null,
      patch.abandonedAt ?? null,
      patch.releasedAt ?? null,
      patch.result ?? null,
      input.characterId,
    ],
  );
  const row = result.rows[0];
  return row ? toRunRecord(row) : null;
}

export function createBreakthroughRepository(pool: DatabasePool): BreakthroughRepository {
  return {
    getRun(breakthroughRunId: string): Promise<BreakthroughRunRecord | null> {
      assertNonEmpty(breakthroughRunId, 'breakthroughRunId');
      return readRun(
        pool,
        `SELECT
           id, character_id, breakthrough_config_id, config_version, formula_version, status,
           run_version::text AS run_version, current_node_id, created_at, trial_deadline_at, expires_at,
           selected_choice_id, selected_route_id, selected_route_risk, selected_at, finalized_at,
           abandoned_at, released_at, reservation_snapshot, preview_snapshot, result, updated_at
         FROM breakthrough_runs
         WHERE id = $1`,
        [breakthroughRunId],
      );
    },

    getLatestRun(characterId: string): Promise<BreakthroughRunRecord | null> {
      assertNonEmpty(characterId, 'characterId');
      return readRun(
        pool,
        `SELECT
           id, character_id, breakthrough_config_id, config_version, formula_version, status,
           run_version::text AS run_version, current_node_id, created_at, trial_deadline_at, expires_at,
           selected_choice_id, selected_route_id, selected_route_risk, selected_at, finalized_at,
           abandoned_at, released_at, reservation_snapshot, preview_snapshot, result, updated_at
         FROM breakthrough_runs
         WHERE character_id = $1
         ORDER BY created_at DESC
         LIMIT 1`,
        [characterId],
      );
    },

    getActiveRun(characterId: string): Promise<BreakthroughRunRecord | null> {
      assertNonEmpty(characterId, 'characterId');
      return readRun(
        pool,
        `SELECT
           id, character_id, breakthrough_config_id, config_version, formula_version, status,
           run_version::text AS run_version, current_node_id, created_at, trial_deadline_at, expires_at,
           selected_choice_id, selected_route_id, selected_route_risk, selected_at, finalized_at,
           abandoned_at, released_at, reservation_snapshot, preview_snapshot, result, updated_at
         FROM breakthrough_runs
         WHERE character_id = $1
           AND status IN ('TRIAL_ACTIVE', 'TRIAL_WAITING_CHOICE')
         ORDER BY created_at DESC
         LIMIT 1`,
        [characterId],
      );
    },

    async lockActiveRun(client, characterId) {
      assertNonEmpty(characterId, 'characterId');
      const result = await client.query<BreakthroughRunRow>(
        `SELECT
           id, character_id, breakthrough_config_id, config_version, formula_version, status,
           run_version::text AS run_version, current_node_id, created_at, trial_deadline_at, expires_at,
           selected_choice_id, selected_route_id, selected_route_risk, selected_at, finalized_at,
           abandoned_at, released_at, reservation_snapshot, preview_snapshot, result, updated_at
         FROM breakthrough_runs
         WHERE character_id = $1
           AND status IN ('TRIAL_ACTIVE', 'TRIAL_WAITING_CHOICE')
         ORDER BY created_at DESC
         LIMIT 1
         FOR UPDATE`,
        [characterId],
      );
      const row = result.rows[0];
      return row ? toRunRecord(row) : null;
    },

    async lockRun(client, breakthroughRunId) {
      assertNonEmpty(breakthroughRunId, 'breakthroughRunId');
      const result = await client.query<BreakthroughRunRow>(
        `SELECT
           id, character_id, breakthrough_config_id, config_version, formula_version, status,
           run_version::text AS run_version, current_node_id, created_at, trial_deadline_at, expires_at,
           selected_choice_id, selected_route_id, selected_route_risk, selected_at, finalized_at,
           abandoned_at, released_at, reservation_snapshot, preview_snapshot, result, updated_at
         FROM breakthrough_runs
         WHERE id = $1
         FOR UPDATE`,
        [breakthroughRunId],
      );
      const row = result.rows[0];
      return row ? toRunRecord(row) : null;
    },

    async listRecoverableRuns(limit, now) {
      if (!Number.isInteger(limit) || limit < 1 || limit > 500) {
        throw new Error('BREAKTHROUGH_VALIDATION_FAILED:limit');
      }
      const result = await pool.query<{ id: string; character_id: string }>(
        `SELECT id, character_id
           FROM breakthrough_runs
          WHERE status IN ('TRIAL_ACTIVE', 'TRIAL_WAITING_CHOICE')
            AND expires_at <= $1
          ORDER BY expires_at ASC, id ASC
          LIMIT $2`,
        [now, limit],
      );
      return result.rows.map((row) => ({
        breakthroughRunId: row.id,
        characterId: row.character_id,
      }));
    },

    async createRunOnTransaction(client, input) {
      assertNonEmpty(input.breakthroughRunId, 'breakthroughRunId');
      assertNonEmpty(input.characterId, 'characterId');
      assertNonEmpty(input.breakthroughConfigId, 'breakthroughConfigId');
      assertNonEmpty(input.configVersion, 'configVersion');
      assertReservationSnapshot(input.reservationSnapshot);
      const result = await client.query<BreakthroughRunRow>(
        `INSERT INTO breakthrough_runs (
           id, character_id, breakthrough_config_id, config_version, formula_version, status,
           run_version, current_node_id, created_at, trial_deadline_at, expires_at,
           selected_choice_id, selected_route_id, selected_route_risk, selected_at, finalized_at,
           abandoned_at, released_at, reservation_snapshot, preview_snapshot, result
         )
         VALUES (
           $1, $2, $3, $4, $5, $6, 0, $7, $8, $9, $10,
           $11, $12, $13, $14, $15, $16, $17, $18::jsonb, $19::jsonb, $20::jsonb
         )
         RETURNING
           id, character_id, breakthrough_config_id, config_version, formula_version, status,
           run_version::text AS run_version, current_node_id, created_at, trial_deadline_at, expires_at,
           selected_choice_id, selected_route_id, selected_route_risk, selected_at, finalized_at,
           abandoned_at, released_at, reservation_snapshot, preview_snapshot, result, updated_at`,
        [
          input.breakthroughRunId,
          input.characterId,
          input.breakthroughConfigId,
          input.configVersion,
          input.formulaVersion,
          input.status,
          input.currentNodeId,
          input.createdAt,
          input.trialDeadlineAt,
          input.expiresAt,
          input.selectedChoiceId,
          input.selectedRouteId,
          input.selectedRouteRisk,
          input.selectedAt,
          input.finalizedAt,
          input.abandonedAt,
          input.releasedAt,
          JSON.stringify(input.reservationSnapshot),
          JSON.stringify(input.previewSnapshot),
          input.result === null ? null : JSON.stringify(input.result),
        ],
      );
      const row = result.rows[0];
      if (!row) {
        throw new Error('BREAKTHROUGH_RUN_NOT_CREATED');
      }
      return toRunRecord(row);
    },

    async markChoiceOnTransaction(client, input) {
      assertNonEmpty(input.breakthroughRunId, 'breakthroughRunId');
      assertNonEmpty(input.characterId, 'characterId');
      assertNonEmpty(input.choiceId, 'choiceId');
      assertNonEmpty(input.routeId, 'routeId');
      const result = await client.query<BreakthroughRunRow>(
        `UPDATE breakthrough_runs
            SET status = 'TRIAL_WAITING_CHOICE',
                current_node_id = 'TRIAL_WAITING_CHOICE',
                run_version = run_version + 1,
                selected_choice_id = $2,
                selected_route_id = $3,
                selected_route_risk = $4,
                selected_at = $5,
                updated_at = CURRENT_TIMESTAMP
          WHERE id = $1
            AND character_id = $6
          RETURNING
            id, character_id, breakthrough_config_id, config_version, formula_version, status,
            run_version::text AS run_version, current_node_id, created_at, trial_deadline_at, expires_at,
            selected_choice_id, selected_route_id, selected_route_risk, selected_at, finalized_at,
            abandoned_at, released_at, reservation_snapshot, preview_snapshot, result, updated_at`,
        [
          input.breakthroughRunId,
          input.choiceId,
          input.routeId,
          input.routeRisk,
          input.chosenAt,
          input.characterId,
        ],
      );
      const row = result.rows[0];
      return row ? toRunRecord(row) : null;
    },

    async markRecoveredOnTransaction(client, input) {
      return updateRun(client, input, 'FAILED_RECOVERABLE', {
        currentNodeId: 'READY',
        releasedAt: input.recoveredAt,
      });
    },

    async markAbandonedOnTransaction(client, input) {
      return updateRun(client, input, 'ABANDONED', {
        currentNodeId: 'READY',
        abandonedAt: input.endedAt,
        releasedAt: input.endedAt,
      });
    },

    async markFinalizedOnTransaction(client, input) {
      return updateRun(client, input, 'COMPLETED', {
        currentNodeId: 'COMPLETED',
        finalizedAt: input.finalizedAt,
        result: input.result,
      });
    },

    async runRecoveryBatch(limit, handler) {
      if (!Number.isInteger(limit) || limit < 1 || limit > 500) {
        throw new Error('BREAKTHROUGH_VALIDATION_FAILED:limit');
      }

      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const selected = await client.query<{ id: string; character_id: string }>(
          `SELECT id, character_id
             FROM breakthrough_runs
            WHERE status IN ('TRIAL_ACTIVE', 'TRIAL_WAITING_CHOICE')
              AND expires_at <= CURRENT_TIMESTAMP
            ORDER BY expires_at ASC, id ASC
            LIMIT $1
            FOR UPDATE SKIP LOCKED`,
          [limit],
        );

        for (const row of selected.rows) {
          await handler(client, row.character_id, row.id);
        }

        await client.query('COMMIT');
        return selected.rows.length;
      } catch (error) {
        await client.query('ROLLBACK').catch(() => undefined);
        throw error;
      } finally {
        client.release();
      }
    },
  };
}
