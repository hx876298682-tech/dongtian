import type { PoolClient } from 'pg';

import type { DatabasePool, JsonValue } from './index.js';

export type TemperingAttemptStatus = 'PENDING' | 'SUCCESS' | 'FAILURE' | 'REJECTED';

export type TemperingEquipmentInstanceRecord = {
  readonly instanceId: string;
  readonly itemId: string;
  readonly temperLevel: number;
  readonly bound: boolean;
  readonly createdConfigVersion: string;
};

export type TemperingAttemptRecord = {
  readonly attemptId: string;
  readonly characterId: string;
  readonly equipmentInstanceId: string;
  readonly fromLevel: number;
  readonly targetLevel: number;
  readonly successProbability: string;
  readonly randomSeedHex: string;
  readonly configVersion: string;
  readonly formulaVersion: number;
  readonly result: TemperingAttemptStatus;
  readonly success: boolean | null;
  readonly costs: JsonValue;
  readonly assetTransactionId: string | null;
  readonly createdAt: Date;
  readonly completedAt: Date | null;
};

export type EquipmentTemperAuditRecord = {
  readonly auditId: string;
  readonly attemptId: string;
  readonly characterId: string;
  readonly equipmentInstanceId: string;
  readonly fromLevel: number;
  readonly targetLevel: number;
  readonly levelBefore: number;
  readonly levelAfter: number;
  readonly success: boolean;
  readonly result: 'SUCCESS' | 'FAILURE' | 'REJECTED';
  readonly assetTransactionId: string;
  readonly createdAt: Date;
};

export type TemperingAttemptWriteInput = {
  readonly attemptId: string;
  readonly characterId: string;
  readonly equipmentInstanceId: string;
  readonly fromLevel: number;
  readonly targetLevel: number;
  readonly successProbability: string;
  readonly randomSeedHex: string;
  readonly configVersion: string;
  readonly formulaVersion: number;
  readonly costs: JsonValue;
};

export type TemperingAttemptCompleteInput = {
  readonly attemptId: string;
  readonly assetTransactionId: string;
  readonly result: TemperingAttemptStatus;
  readonly success: boolean;
  readonly costs: JsonValue;
  readonly completedAt: Date;
};

export type EquipmentTemperAuditWriteInput = {
  readonly attemptId: string;
  readonly characterId: string;
  readonly equipmentInstanceId: string;
  readonly fromLevel: number;
  readonly targetLevel: number;
  readonly levelBefore: number;
  readonly levelAfter: number;
  readonly success: boolean;
  readonly result: 'SUCCESS' | 'FAILURE' | 'REJECTED';
  readonly assetTransactionId: string;
};

export type TemperingRepository = {
  readonly lockEquipmentInstance: (
    client: PoolClient,
    input: { readonly characterId: string; readonly accountId: string; readonly instanceId: string },
  ) => Promise<TemperingEquipmentInstanceRecord | null>;
  readonly getTemperingAttempt: (
    client: PoolClient,
    attemptId: string,
  ) => Promise<TemperingAttemptRecord | null>;
  readonly createTemperingAttempt: (
    client: PoolClient,
    input: TemperingAttemptWriteInput,
  ) => Promise<TemperingAttemptRecord>;
  readonly completeTemperingAttempt: (
    client: PoolClient,
    input: TemperingAttemptCompleteInput,
  ) => Promise<TemperingAttemptRecord>;
  readonly createEquipmentTemperAudit: (
    client: PoolClient,
    input: EquipmentTemperAuditWriteInput,
  ) => Promise<EquipmentTemperAuditRecord>;
};

function assertNonEmpty(value: string, field: string): void {
  if (value.trim().length === 0) {
    throw new Error(`TEMPERING_VALIDATION_FAILED:${field}`);
  }
}

function toHex(bytes: Buffer): string {
  return bytes.toString('hex');
}

function toAttemptRecord(row: {
  id: string;
  character_id: string;
  equipment_instance_id: string;
  from_level: number;
  target_level: number;
  success_probability: string;
  random_seed: Buffer;
  config_version: string;
  formula_version: number;
  result: TemperingAttemptStatus;
  success: boolean | null;
  costs: JsonValue;
  asset_transaction_id: string | null;
  created_at: Date;
  completed_at: Date | null;
}): TemperingAttemptRecord {
  return {
    attemptId: row.id,
    characterId: row.character_id,
    equipmentInstanceId: row.equipment_instance_id,
    fromLevel: row.from_level,
    targetLevel: row.target_level,
    successProbability: row.success_probability,
    randomSeedHex: toHex(row.random_seed),
    configVersion: row.config_version,
    formulaVersion: row.formula_version,
    result: row.result,
    success: row.success,
    costs: row.costs,
    assetTransactionId: row.asset_transaction_id,
    createdAt: row.created_at,
    completedAt: row.completed_at,
  };
}

function toAuditRecord(row: {
  id: string;
  attempt_id: string;
  character_id: string;
  equipment_instance_id: string;
  from_level: number;
  target_level: number;
  level_before: number;
  level_after: number;
  success: boolean;
  result: 'SUCCESS' | 'FAILURE' | 'REJECTED';
  asset_transaction_id: string;
  created_at: Date;
}): EquipmentTemperAuditRecord {
  return {
    auditId: row.id,
    attemptId: row.attempt_id,
    characterId: row.character_id,
    equipmentInstanceId: row.equipment_instance_id,
    fromLevel: row.from_level,
    targetLevel: row.target_level,
    levelBefore: row.level_before,
    levelAfter: row.level_after,
    success: row.success,
    result: row.result,
    assetTransactionId: row.asset_transaction_id,
    createdAt: row.created_at,
  };
}

export function createTemperingRepository(_pool: DatabasePool): TemperingRepository {
  return {
    async lockEquipmentInstance(client, input) {
      assertNonEmpty(input.characterId, 'characterId');
      assertNonEmpty(input.accountId, 'accountId');
      assertNonEmpty(input.instanceId, 'instanceId');
      const result = await client.query<{
        instance_id: string;
        item_id: string;
        temper_level: number;
        bound: boolean;
        created_config_version: string;
      }>(
        `SELECT e.id AS instance_id, e.item_id, e.temper_level, e.bound, e.created_config_version
           FROM equipment_instances e
           INNER JOIN characters c ON c.id = e.character_id
          WHERE e.id = $1
            AND e.character_id = $2
            AND c.account_id = $3
          FOR UPDATE`,
        [input.instanceId, input.characterId, input.accountId],
      );
      const row = result.rows[0];
      return row ? {
        instanceId: row.instance_id,
        itemId: row.item_id,
        temperLevel: row.temper_level,
        bound: row.bound,
        createdConfigVersion: row.created_config_version,
      } : null;
    },

    async getTemperingAttempt(client, attemptId) {
      assertNonEmpty(attemptId, 'attemptId');
      const result = await client.query<{
        id: string;
        character_id: string;
        equipment_instance_id: string;
        from_level: number;
        target_level: number;
        success_probability: string;
        random_seed: Buffer;
        config_version: string;
        formula_version: number;
        result: TemperingAttemptStatus;
        success: boolean | null;
        costs: JsonValue;
        asset_transaction_id: string | null;
        created_at: Date;
        completed_at: Date | null;
      }>(
        `SELECT id, character_id, equipment_instance_id, from_level, target_level,
                success_probability::text AS success_probability,
                random_seed, config_version, formula_version, result, success,
                costs, asset_transaction_id, created_at, completed_at
           FROM temper_attempts
          WHERE id = $1`,
        [attemptId],
      );
      const row = result.rows[0];
      return row ? toAttemptRecord(row) : null;
    },

    async createTemperingAttempt(client, input) {
      assertNonEmpty(input.attemptId, 'attemptId');
      assertNonEmpty(input.characterId, 'characterId');
      assertNonEmpty(input.equipmentInstanceId, 'equipmentInstanceId');
      assertNonEmpty(input.successProbability, 'successProbability');
      assertNonEmpty(input.randomSeedHex, 'randomSeedHex');
      assertNonEmpty(input.configVersion, 'configVersion');
      const result = await client.query<{
        id: string;
        character_id: string;
        equipment_instance_id: string;
        from_level: number;
        target_level: number;
        success_probability: string;
        random_seed: Buffer;
        config_version: string;
        formula_version: number;
        result: TemperingAttemptStatus;
        success: boolean | null;
        costs: JsonValue;
        asset_transaction_id: string | null;
        created_at: Date;
        completed_at: Date | null;
      }>(
        `INSERT INTO temper_attempts
          (id, character_id, equipment_instance_id, from_level, target_level,
           success_probability, random_seed, config_version, formula_version, result,
           success, costs, created_at)
         VALUES ($1, $2, $3, $4, $5, $6::numeric, decode($7, 'hex'), $8, $9, 'PENDING', NULL, $10::jsonb, CURRENT_TIMESTAMP)
         ON CONFLICT (id) DO NOTHING
         RETURNING id, character_id, equipment_instance_id, from_level, target_level,
                   success_probability::text AS success_probability,
                   random_seed, config_version, formula_version, result, success,
                   costs, asset_transaction_id, created_at, completed_at`,
        [
          input.attemptId,
          input.characterId,
          input.equipmentInstanceId,
          input.fromLevel,
          input.targetLevel,
          input.successProbability,
          input.randomSeedHex,
          input.configVersion,
          input.formulaVersion,
          JSON.stringify(input.costs),
        ],
      );
      const row = result.rows[0];
      if (!row) {
        const existing = await client.query<{
          id: string;
          character_id: string;
          equipment_instance_id: string;
          from_level: number;
          target_level: number;
          success_probability: string;
          random_seed: Buffer;
          config_version: string;
          formula_version: number;
          result: TemperingAttemptStatus;
          success: boolean | null;
          costs: JsonValue;
          asset_transaction_id: string | null;
          created_at: Date;
          completed_at: Date | null;
        }>(
          `SELECT id, character_id, equipment_instance_id, from_level, target_level,
                  success_probability::text AS success_probability,
                  random_seed, config_version, formula_version, result, success,
                  costs, asset_transaction_id, created_at, completed_at
             FROM temper_attempts
            WHERE id = $1
            FOR UPDATE`,
          [input.attemptId],
        );
        const existingRow = existing.rows[0];
        if (!existingRow) {
          throw new Error('TEMPER_ATTEMPT_CREATE_FAILED');
        }
        return toAttemptRecord(existingRow);
      }
      return toAttemptRecord(row);
    },

    async completeTemperingAttempt(client, input) {
      assertNonEmpty(input.attemptId, 'attemptId');
      assertNonEmpty(input.assetTransactionId, 'assetTransactionId');
      const result = await client.query<{
        id: string;
        character_id: string;
        equipment_instance_id: string;
        from_level: number;
        target_level: number;
        success_probability: string;
        random_seed: Buffer;
        config_version: string;
        formula_version: number;
        result: TemperingAttemptStatus;
        success: boolean | null;
        costs: JsonValue;
        asset_transaction_id: string | null;
        created_at: Date;
        completed_at: Date | null;
      }>(
        `UPDATE temper_attempts
            SET asset_transaction_id = $2,
                result = $3,
                success = $4,
                costs = $5::jsonb,
                completed_at = $6
          WHERE id = $1
          RETURNING id, character_id, equipment_instance_id, from_level, target_level,
                    success_probability::text AS success_probability,
                    random_seed, config_version, formula_version, result, success,
                    costs, asset_transaction_id, created_at, completed_at`,
        [
          input.attemptId,
          input.assetTransactionId,
          input.result,
          input.success,
          JSON.stringify(input.costs),
          input.completedAt,
        ],
      );
      const row = result.rows[0];
      if (!row) {
        throw new Error('TEMPER_ATTEMPT_UPDATE_FAILED');
      }
      return toAttemptRecord(row);
    },

    async createEquipmentTemperAudit(client, input) {
      assertNonEmpty(input.attemptId, 'attemptId');
      assertNonEmpty(input.assetTransactionId, 'assetTransactionId');
      const result = await client.query<{
        id: string;
        attempt_id: string;
        character_id: string;
        equipment_instance_id: string;
        from_level: number;
        target_level: number;
        level_before: number;
        level_after: number;
        success: boolean;
        result: 'SUCCESS' | 'FAILURE' | 'REJECTED';
        asset_transaction_id: string;
        created_at: Date;
      }>(
        `INSERT INTO equipment_temper_audits
          (attempt_id, character_id, equipment_instance_id, from_level, target_level,
           level_before, level_after, success, result, asset_transaction_id, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, CURRENT_TIMESTAMP)
         RETURNING id, attempt_id, character_id, equipment_instance_id, from_level,
                   target_level, level_before, level_after, success, result,
                   asset_transaction_id, created_at`,
        [
          input.attemptId,
          input.characterId,
          input.equipmentInstanceId,
          input.fromLevel,
          input.targetLevel,
          input.levelBefore,
          input.levelAfter,
          input.success,
          input.result,
          input.assetTransactionId,
        ],
      );
      const row = result.rows[0];
      if (!row) {
        throw new Error('EQUIPMENT_TEMPER_AUDIT_CREATE_FAILED');
      }
      return toAuditRecord(row);
    },
  };
}
