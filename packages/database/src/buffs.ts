import type { PoolClient } from 'pg';

import type { DatabasePool } from './index.js';

export type BuffInstanceRecord = {
  readonly id: string;
  readonly characterId: string;
  readonly buffConfigId: string;
  readonly slotIndex: number;
  readonly stackGroup: string;
  readonly startedAt: Date;
  readonly expiresAt: Date;
  readonly sourceTransactionId: string;
  readonly configVersion: string;
};

type BuffInstanceRow = {
  id: string;
  character_id: string;
  buff_config_id: string;
  slot_index: number;
  stack_group: string;
  started_at: Date;
  expires_at: Date;
  source_transaction_id: string;
  config_version: string;
};

export type BuffInstanceWriteInput = {
  readonly characterId: string;
  readonly buffConfigId: string;
  readonly slotIndex: number;
  readonly stackGroup: string;
  readonly startedAt: Date;
  readonly expiresAt: Date;
  readonly sourceTransactionId: string;
  readonly configVersion: string;
  readonly replaceBuffInstanceId?: string | null;
};

export type BuffRepository = {
  readonly getActiveBuffs: (characterId: string, asOf?: Date) => Promise<readonly BuffInstanceRecord[]>;
  readonly lockActiveBuffs: (
    client: PoolClient,
    characterId: string,
    asOf?: Date,
  ) => Promise<readonly BuffInstanceRecord[]>;
  readonly replaceBuffInstance: (
    client: PoolClient,
    input: BuffInstanceWriteInput,
  ) => Promise<BuffInstanceRecord>;
};

function toRecord(row: BuffInstanceRow): BuffInstanceRecord {
  return {
    id: row.id,
    characterId: row.character_id,
    buffConfigId: row.buff_config_id,
    slotIndex: row.slot_index,
    stackGroup: row.stack_group,
    startedAt: row.started_at,
    expiresAt: row.expires_at,
    sourceTransactionId: row.source_transaction_id,
    configVersion: row.config_version,
  };
}

function assertInput(input: BuffInstanceWriteInput): void {
  if (input.characterId.trim().length === 0) {
    throw new Error('BUFF_INSTANCE_CHARACTER_REQUIRED');
  }
  if (input.buffConfigId.trim().length === 0 || input.stackGroup.trim().length === 0) {
    throw new Error('BUFF_INSTANCE_CONFIG_REQUIRED');
  }
  if (!Number.isInteger(input.slotIndex) || input.slotIndex < 1 || input.slotIndex > 3) {
    throw new Error('BUFF_INSTANCE_SLOT_INVALID');
  }
  if (input.expiresAt < input.startedAt) {
    throw new Error('BUFF_INSTANCE_TIME_INVALID');
  }
  if (input.sourceTransactionId.trim().length === 0 || input.configVersion.trim().length === 0) {
    throw new Error('BUFF_INSTANCE_AUDIT_REQUIRED');
  }
}

async function listActive(client: Pick<PoolClient, 'query'>, characterId: string, asOf: Date): Promise<readonly BuffInstanceRecord[]> {
  const result = await client.query<BuffInstanceRow>(
    `SELECT id, character_id, buff_config_id, slot_index, stack_group,
            started_at, expires_at, source_transaction_id, config_version
       FROM buff_instances
      WHERE character_id = $1
        AND expires_at > $2
      ORDER BY slot_index ASC, started_at ASC, id ASC`,
    [characterId, asOf],
  );
  return result.rows.map(toRecord);
}

async function lockActive(client: PoolClient, characterId: string, asOf: Date): Promise<readonly BuffInstanceRecord[]> {
  const result = await client.query<BuffInstanceRow>(
    `SELECT id, character_id, buff_config_id, slot_index, stack_group,
            started_at, expires_at, source_transaction_id, config_version
       FROM buff_instances
      WHERE character_id = $1
        AND expires_at > $2
      ORDER BY slot_index ASC, started_at ASC, id ASC
      FOR UPDATE`,
    [characterId, asOf],
  );
  return result.rows.map(toRecord);
}

export function createBuffRepository(pool: DatabasePool): BuffRepository {
  return {
    async getActiveBuffs(characterId, asOf = new Date()) {
      return listActive(pool as unknown as Pick<PoolClient, 'query'>, characterId, asOf);
    },

    async lockActiveBuffs(client, characterId, asOf = new Date()) {
      return lockActive(client, characterId, asOf);
    },

    async replaceBuffInstance(client, input) {
      assertInput(input);
      if (input.replaceBuffInstanceId !== undefined && input.replaceBuffInstanceId !== null) {
        const deleted = await client.query<{ id: string }>(
          `DELETE FROM buff_instances
            WHERE id = $1 AND character_id = $2
            RETURNING id`,
          [input.replaceBuffInstanceId, input.characterId],
        );
        if (!deleted.rows[0]) {
          throw new Error('BUFF_INSTANCE_REPLACE_TARGET_NOT_FOUND');
        }
      }

      const result = await client.query<BuffInstanceRow>(
        `INSERT INTO buff_instances
          (character_id, buff_config_id, slot_index, stack_group,
           started_at, expires_at, source_transaction_id, config_version)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         RETURNING id, character_id, buff_config_id, slot_index, stack_group,
                   started_at, expires_at, source_transaction_id, config_version`,
        [
          input.characterId,
          input.buffConfigId,
          input.slotIndex,
          input.stackGroup,
          input.startedAt,
          input.expiresAt,
          input.sourceTransactionId,
          input.configVersion,
        ],
      );
      const row = result.rows[0];
      if (!row) {
        throw new Error('BUFF_INSTANCE_CREATE_FAILED');
      }
      return toRecord(row);
    },
  };
}
