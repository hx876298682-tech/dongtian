import type { PoolClient } from 'pg';

import type { DatabasePool } from './index.js';

export type CaveFacilityRecord = {
  readonly characterId: string;
  readonly facilityConfigId: string;
  readonly level: number;
  readonly createdAt: Date;
  readonly updatedAt: Date;
};

export type CaveBuildTaskRecord = {
  readonly id: string;
  readonly characterId: string;
  readonly facilityConfigId: string;
  readonly fromLevel: number;
  readonly targetLevel: number;
  readonly status: 'RUNNING' | 'COMPLETED';
  readonly startedAt: Date;
  readonly completeAt: Date;
  readonly costTransactionId: string;
  readonly completeTransactionId: string | null;
  readonly configVersion: string;
  readonly createdAt: Date;
  readonly updatedAt: Date;
};

export type CaveStateRecord = {
  readonly characterId: string;
  readonly facilities: readonly CaveFacilityRecord[];
  readonly buildTasks: readonly CaveBuildTaskRecord[];
};

export type CaveBuildTaskCreateInput = {
  readonly characterId: string;
  readonly facilityConfigId: string;
  readonly fromLevel: number;
  readonly targetLevel: number;
  readonly startedAt: Date;
  readonly completeAt: Date;
  readonly costTransactionId: string;
  readonly configVersion: string;
};

export type CaveBuildTaskCompleteInput = {
  readonly characterId: string;
  readonly buildTaskId: string;
  readonly completeTransactionId: string;
};

export type CaveRecoveryHandler = (client: PoolClient, characterId: string) => Promise<void>;

export type CaveRepository = {
  readonly getState: (characterId: string) => Promise<CaveStateRecord | null>;
  readonly lockState: (client: PoolClient, characterId: string) => Promise<CaveStateRecord | null>;
  readonly ensureFacilitiesOnTransaction: (
    client: PoolClient,
    input: {
      readonly characterId: string;
      readonly facilityConfigIds: readonly string[];
    },
  ) => Promise<void>;
  readonly createBuildTaskOnTransaction: (
    client: PoolClient,
    input: CaveBuildTaskCreateInput,
  ) => Promise<CaveBuildTaskRecord>;
  readonly listDueBuildTasksOnTransaction: (
    client: PoolClient,
    input: { readonly characterId: string; readonly now: Date },
  ) => Promise<readonly CaveBuildTaskRecord[]>;
  readonly completeBuildTaskOnTransaction: (
    client: PoolClient,
    input: CaveBuildTaskCompleteInput,
  ) => Promise<CaveBuildTaskRecord | null>;
  readonly runRecoveryBatch: (
    limit: number,
    handler: CaveRecoveryHandler,
  ) => Promise<number>;
};

type CaveFacilityRow = {
  character_id: string;
  facility_config_id: string;
  level: number;
  created_at: Date;
  updated_at: Date;
};

type CaveBuildTaskRow = {
  id: string;
  character_id: string;
  facility_config_id: string;
  from_level: number;
  target_level: number;
  status: 'RUNNING' | 'COMPLETED';
  started_at: Date;
  complete_at: Date;
  cost_transaction_id: string;
  complete_transaction_id: string | null;
  config_version: string;
  created_at: Date;
  updated_at: Date;
};

function fail(code: string): never {
  throw new Error(code);
}

async function lockWritableCharacter(client: PoolClient, characterId: string): Promise<void> {
  const character = await client.query<{ id: string }>(
    `SELECT id
       FROM characters
      WHERE id = $1
      FOR UPDATE`,
    [characterId],
  );
  if (!character.rows[0]) {
    fail('CAVE_CHARACTER_NOT_FOUND');
  }
  const state = await client.query<{ continuation_required: boolean }>(
    `SELECT continuation_required
       FROM settlement_states
      WHERE character_id = $1
      FOR UPDATE`,
    [characterId],
  );
  const row = state.rows[0];
  if (!row) {
    fail('CAVE_SETTLEMENT_STATE_NOT_FOUND');
  }
  if (row.continuation_required) {
    fail('SETTLEMENT_CONTINUATION_IN_PROGRESS');
  }
}

function toFacility(row: CaveFacilityRow): CaveFacilityRecord {
  return {
    characterId: row.character_id,
    facilityConfigId: row.facility_config_id,
    level: row.level,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toTask(row: CaveBuildTaskRow): CaveBuildTaskRecord {
  return {
    id: row.id,
    characterId: row.character_id,
    facilityConfigId: row.facility_config_id,
    fromLevel: row.from_level,
    targetLevel: row.target_level,
    status: row.status,
    startedAt: row.started_at,
    completeAt: row.complete_at,
    costTransactionId: row.cost_transaction_id,
    completeTransactionId: row.complete_transaction_id,
    configVersion: row.config_version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function readState(
  client: Pick<PoolClient, 'query'>,
  characterId: string,
  lock: boolean,
): Promise<CaveStateRecord | null> {
  const facilities = await client.query<CaveFacilityRow>(
    `SELECT character_id, facility_config_id, level, created_at, updated_at
       FROM cave_facilities
      WHERE character_id = $1
      ORDER BY facility_config_id ASC
      ${lock ? 'FOR UPDATE' : ''}`,
    [characterId],
  );
  const tasks = await client.query<CaveBuildTaskRow>(
    `SELECT id, character_id, facility_config_id, from_level, target_level, status,
            started_at, complete_at, cost_transaction_id, complete_transaction_id,
            config_version, created_at, updated_at
       FROM cave_build_tasks
      WHERE character_id = $1
      ORDER BY status ASC, complete_at ASC, id ASC
      ${lock ? 'FOR UPDATE' : ''}`,
    [characterId],
  );

  const rows = facilities.rows;
  if (rows.length === 0 && tasks.rows.length === 0) {
    return null;
  }

  return {
    characterId,
    facilities: rows.map(toFacility),
    buildTasks: tasks.rows.map(toTask),
  };
}

export function createCaveRepository(pool: DatabasePool): CaveRepository {
  return {
    getState(characterId: string): Promise<CaveStateRecord | null> {
      return readState(pool, characterId, false);
    },

    async lockState(client: PoolClient, characterId: string): Promise<CaveStateRecord | null> {
      await lockWritableCharacter(client, characterId);
      return readState(client, characterId, true);
    },

    async ensureFacilitiesOnTransaction(
      client: PoolClient,
      input: { readonly characterId: string; readonly facilityConfigIds: readonly string[] },
    ): Promise<void> {
      if (input.facilityConfigIds.length === 0) {
        return;
      }
      await lockWritableCharacter(client, input.characterId);
      await client.query(
        `INSERT INTO cave_facilities (character_id, facility_config_id, level)
         SELECT $1, facility_config_id, 0
           FROM unnest($2::text[]) AS facility_config_id
         ON CONFLICT (character_id, facility_config_id) DO NOTHING`,
        [input.characterId, input.facilityConfigIds],
      );
    },

    async createBuildTaskOnTransaction(
      client: PoolClient,
      input: CaveBuildTaskCreateInput,
    ): Promise<CaveBuildTaskRecord> {
      await lockWritableCharacter(client, input.characterId);
      const result = await client.query<CaveBuildTaskRow>(
        `INSERT INTO cave_build_tasks (
           character_id, facility_config_id, from_level, target_level, status,
           started_at, complete_at, cost_transaction_id, config_version
         )
         VALUES ($1, $2, $3, $4, 'RUNNING', $5, $6, $7, $8)
         RETURNING id, character_id, facility_config_id, from_level, target_level,
                   status, started_at, complete_at, cost_transaction_id,
                   complete_transaction_id, config_version, created_at, updated_at`,
        [
          input.characterId,
          input.facilityConfigId,
          input.fromLevel,
          input.targetLevel,
          input.startedAt,
          input.completeAt,
          input.costTransactionId,
          input.configVersion,
        ],
      );
      const row = result.rows[0];
      if (!row) {
        fail('CAVE_BUILD_TASK_NOT_CREATED');
      }
      return toTask(row);
    },

    async listDueBuildTasksOnTransaction(
      client: PoolClient,
      input: { readonly characterId: string; readonly now: Date },
    ): Promise<readonly CaveBuildTaskRecord[]> {
      await lockWritableCharacter(client, input.characterId);
      const result = await client.query<CaveBuildTaskRow>(
        `SELECT id, character_id, facility_config_id, from_level, target_level, status,
                started_at, complete_at, cost_transaction_id, complete_transaction_id,
                config_version, created_at, updated_at
           FROM cave_build_tasks
          WHERE character_id = $1
            AND status = 'RUNNING'
            AND complete_at <= $2
          ORDER BY complete_at ASC, id ASC
          FOR UPDATE`,
        [input.characterId, input.now],
      );
      return result.rows.map(toTask);
    },

    async completeBuildTaskOnTransaction(
      client: PoolClient,
      input: CaveBuildTaskCompleteInput,
    ): Promise<CaveBuildTaskRecord | null> {
      const taskResult = await client.query<CaveBuildTaskRow>(
        `UPDATE cave_build_tasks
            SET status = 'COMPLETED',
                complete_transaction_id = $3,
                updated_at = CURRENT_TIMESTAMP
          WHERE id = $1
            AND character_id = $2
            AND status = 'RUNNING'
          RETURNING id, character_id, facility_config_id, from_level, target_level,
                    status, started_at, complete_at, cost_transaction_id,
                    complete_transaction_id, config_version, created_at, updated_at`,
        [input.buildTaskId, input.characterId, input.completeTransactionId],
      );
      const task = taskResult.rows[0];
      if (!task) {
        return null;
      }
      await client.query(
        `UPDATE cave_facilities
            SET level = $3,
                updated_at = CURRENT_TIMESTAMP
          WHERE character_id = $1
            AND facility_config_id = $2`,
        [input.characterId, task.facility_config_id, task.target_level],
      );
      return toTask(task);
    },

    async runRecoveryBatch(
      limit: number,
      handler: CaveRecoveryHandler,
    ): Promise<number> {
      if (!Number.isInteger(limit) || limit < 1 || limit > 500) {
        fail('CAVE_RECOVERY_LIMIT_INVALID');
      }

      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const result = await client.query<{ character_id: string }>(
          `SELECT character_id
             FROM cave_build_tasks
            WHERE status = 'RUNNING'
              AND complete_at <= CURRENT_TIMESTAMP
            ORDER BY complete_at ASC, id ASC
            LIMIT $1
            FOR UPDATE SKIP LOCKED`,
          [limit],
        );
        const characterIds = [...new Set(result.rows.map((row) => row.character_id))];
        for (const characterId of characterIds) {
          await handler(client, characterId);
        }
        await client.query('COMMIT');
        return characterIds.length;
      } catch (error) {
        await client.query('ROLLBACK').catch(() => undefined);
        throw error;
      } finally {
        client.release();
      }
    },
  };
}
