import { randomUUID } from 'node:crypto';

import { createAssetRepository, createDatabasePool, type DatabasePool, type PoolClient } from '@dongtian/database';

import { loadE2EEnvironment } from './e2e-env.js';

export interface VerticalSliceFixture {
  readonly accessoryInstanceId: string;
  readonly alchemyToolInstanceId: string;
  readonly armorInstanceId: string;
  readonly comparePresetId: string;
  readonly mainPresetId: string;
  readonly weaponInstanceId: string;
  readonly herbalismToolInstanceId: string;
}

export interface BreakthroughFixture {
  readonly configVersion: string;
  readonly missingAssetId: string | null;
}

async function executeInTransaction<T>(
  pool: DatabasePool,
  callback: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function insertEquipmentInstance(
  client: PoolClient,
  input: {
    readonly characterId: string;
    readonly configVersion: string;
    readonly itemId: string;
    readonly transactionId: string;
  },
): Promise<string> {
  const instanceId = randomUUID();
  await client.query(
    `INSERT INTO equipment_instances
       (id, character_id, item_id, temper_level, bound, created_transaction_id, created_config_version)
     VALUES ($1, $2, $3, 0, FALSE, $4, $5)`,
    [instanceId, input.characterId, input.itemId, input.transactionId, input.configVersion],
  );
  return instanceId;
}

export async function seedVerticalSliceFixture(characterId: string): Promise<VerticalSliceFixture> {
  const environment = loadE2EEnvironment();
  const pool = createDatabasePool(environment.testDatabaseUrl);
  const assetRepository = createAssetRepository(pool);

  try {
    return await executeInTransaction(pool, async (client) => {
      const configVersion = '2026.08.16.1';
      const now = new Date();
      const qiEarlyXp = '100';

      await client.query(
        `UPDATE characters
            SET realm_stage_id = $2,
                updated_at = CURRENT_TIMESTAMP
          WHERE id = $1`,
        [characterId, 'realm.qi.early'],
      );
      await client.query(
        `UPDATE character_progression
            SET cultivation_xp = $2,
                realm_stage_id = $3,
                updated_at = CURRENT_TIMESTAMP
          WHERE character_id = $1`,
        [characterId, qiEarlyXp, 'realm.qi.early'],
      );
      await client.query(
        `UPDATE settlement_states
            SET last_settled_at = $2,
                offline_cap_seconds = 36000,
                active_cycle_index = 0,
                progress_time_us = 0,
                continuation_required = FALSE,
                updated_at = CURRENT_TIMESTAMP
          WHERE character_id = $1`,
        [characterId, new Date(now.getTime() - 8 * 60 * 60 * 1000 - 5 * 60 * 1000)],
      );

      await assetRepository.addOnTransaction(client, {
        characterId,
        assetType: 'ITEM',
        assetId: 'item.t1.qingling_herb',
        quantity: '24',
        reasonCode: 'E2E_FIXTURE_STARTER_PACK',
        referenceType: 'FIXTURE',
        referenceId: 'starter-pack',
        configVersion,
      });
      await assetRepository.addOnTransaction(client, {
        characterId,
        assetType: 'ITEM',
        assetId: 'item.t1.qingzhu',
        quantity: '12',
        reasonCode: 'E2E_FIXTURE_STARTER_PACK',
        referenceType: 'FIXTURE',
        referenceId: 'starter-pack',
        configVersion,
      });

      const equipmentTransactionResult = await client.query<{ readonly id: string }>(
        `INSERT INTO asset_transactions (
           character_id, operation_type, reason_code, reference_type, reference_id, config_version
         )
         VALUES ($1, 'ADD', 'E2E_FIXTURE_EQUIPMENT', 'FIXTURE', 'starter-equipment', $2)
         RETURNING id`,
        [characterId, configVersion],
      );
      const equipmentTransaction = equipmentTransactionResult.rows[0]?.id;
      if (!equipmentTransaction) {
        throw new Error('Expected fixture equipment transaction to be created.');
      }

      const herbalismToolInstanceId = await insertEquipmentInstance(client, {
        characterId,
        configVersion,
        itemId: 'item.t1.mubing_yaochu',
        transactionId: equipmentTransaction,
      });
      const alchemyToolInstanceId = await insertEquipmentInstance(client, {
        characterId,
        configVersion,
        itemId: 'item.t1.cuizhi_danlu',
        transactionId: equipmentTransaction,
      });
      const weaponInstanceId = await insertEquipmentInstance(client, {
        characterId,
        configVersion,
        itemId: 'item.t1.cuizhi_jian',
        transactionId: equipmentTransaction,
      });
      const armorInstanceId = await insertEquipmentInstance(client, {
        characterId,
        configVersion,
        itemId: 'item.t1.buyi',
        transactionId: equipmentTransaction,
      });
      const accessoryInstanceId = await insertEquipmentInstance(client, {
        characterId,
        configVersion,
        itemId: 'item.t1.qingyu_pei',
        transactionId: equipmentTransaction,
      });

      await client.query(
        `INSERT INTO skill_tool_assignments (character_id, skill_id, equipment_instance_id)
         VALUES ($1, 'skill.herbalism', $2)
         ON CONFLICT (character_id, skill_id) DO UPDATE
           SET equipment_instance_id = EXCLUDED.equipment_instance_id,
               updated_at = CURRENT_TIMESTAMP,
               version = skill_tool_assignments.version + 1`,
        [characterId, herbalismToolInstanceId],
      );
      await client.query(
        `INSERT INTO skill_tool_assignments (character_id, skill_id, equipment_instance_id)
         VALUES ($1, 'skill.alchemy', $2)
         ON CONFLICT (character_id, skill_id) DO UPDATE
           SET equipment_instance_id = EXCLUDED.equipment_instance_id,
               updated_at = CURRENT_TIMESTAMP,
               version = skill_tool_assignments.version + 1`,
        [characterId, alchemyToolInstanceId],
      );

      const mainPresetId = randomUUID();
      const comparePresetId = randomUUID();

      await client.query(
        `INSERT INTO loadout_presets (
           id, character_id, name, weapon_instance_id, armor_instance_id, accessory_instance_id,
           combat_consumables, strategy_id, version
         )
         VALUES ($1, $2, $3, $4, $5, $6, '[]'::jsonb, $7, 0)`,
        [mainPresetId, characterId, '青蛇洞主力预设', weaponInstanceId, armorInstanceId, accessoryInstanceId, 'strategy.safe'],
      );
      await client.query(
        `INSERT INTO loadout_presets (
           id, character_id, name, weapon_instance_id, armor_instance_id, accessory_instance_id,
           combat_consumables, strategy_id, version
         )
         VALUES ($1, $2, $3, $4, $5, $6, '[]'::jsonb, $7, 0)`,
        [comparePresetId, characterId, '比较用预设', weaponInstanceId, null, accessoryInstanceId, 'strategy.risk'],
      );
      await client.query(
        `UPDATE characters
            SET active_loadout_preset_id = $2,
                updated_at = CURRENT_TIMESTAMP
          WHERE id = $1`,
        [characterId, mainPresetId],
      );

      return {
        accessoryInstanceId,
        alchemyToolInstanceId,
        armorInstanceId,
        comparePresetId,
        herbalismToolInstanceId,
        mainPresetId,
        weaponInstanceId,
      };
    });
  } finally {
    await pool.end();
  }
}

export async function shiftSettlementClock(characterId: string, hoursAgo: number): Promise<void> {
  const environment = loadE2EEnvironment();
  const pool = createDatabasePool(environment.testDatabaseUrl);
  const client = await pool.connect();

  try {
    await client.query(
      `UPDATE settlement_states
          SET last_settled_at = $2,
              updated_at = CURRENT_TIMESTAMP
        WHERE character_id = $1`,
      [characterId, new Date(Date.now() - hoursAgo * 60 * 60 * 1000)],
    );
  } finally {
    client.release();
    await pool.end();
  }
}

export async function assertLedgerBalanced(): Promise<void> {
  const environment = loadE2EEnvironment();
  const pool = createDatabasePool(environment.testDatabaseUrl);
  const audit = createAssetRepository(pool);

  try {
    const report = await audit.audit();
    if (!report.ok) {
      throw new Error(`Expected zero ledger diff, found ${report.discrepancyCount} discrepancies.`);
    }
  } finally {
    await pool.end();
  }
}

/**
 * Seeds a deterministic endgame character through the normal asset repository so
 * the E2E assertions can still audit every fixture mutation in the ledger.
 */
export async function seedBreakthroughFixture(
  characterId: string,
  options: { readonly accelerated?: boolean } = {},
): Promise<BreakthroughFixture> {
  const environment = loadE2EEnvironment();
  const pool = createDatabasePool(environment.testDatabaseUrl);
  const assetRepository = createAssetRepository(pool);
  const configVersion = '2026.08.16.1';
  const accelerated = options.accelerated === true;

  try {
    return await executeInTransaction(pool, async (client) => {
      const now = new Date();
      await client.query(
        `UPDATE characters
            SET realm_stage_id = 'realm.qi.early',
                state_version = 0,
                active_config_version = $2,
                updated_at = CURRENT_TIMESTAMP
          WHERE id = $1`,
        [characterId, configVersion],
      );
      await client.query(
        `UPDATE character_progression
            SET cultivation_xp = '24100',
                realm_stage_id = 'realm.qi.early',
                updated_at = CURRENT_TIMESTAMP
          WHERE character_id = $1`,
        [characterId],
      );
      await client.query(
        `UPDATE settlement_states
            SET last_settled_at = $2,
                offline_cap_seconds = 36000,
                active_cycle_index = 0,
                progress_time_us = 0,
                continuation_required = FALSE,
                updated_at = CURRENT_TIMESTAMP
          WHERE character_id = $1`,
        [characterId, new Date(now.getTime() - 60_000)],
      );

      const amounts = [
        ['ITEM', 'item.t1.foundation_pill', '1'],
        ['ITEM', 'item.t2.lingsui', accelerated ? '3' : '2'],
        ['ITEM', 'item.t1.meridian_pill', '2'],
        ['ITEM', 'item.t1.qi_gathering_powder', '1'],
        ['CURRENCY', 'currency.spirit_stone', '2500'],
      ] as const;
      for (const [assetType, assetId, quantity] of amounts) {
        await assetRepository.addOnTransaction(client, {
          characterId,
          assetType,
          assetId,
          quantity,
          reasonCode: 'E2E_BREAKTHROUGH_FIXTURE',
          referenceType: 'FIXTURE',
          referenceId: `breakthrough-${characterId}`,
          configVersion,
        });
      }

      return {
        configVersion,
        missingAssetId: accelerated ? null : 'item.t2.lingsui',
      };
    });
  } finally {
    await pool.end();
  }
}

export async function completeBreakthroughRequirement(
  characterId: string,
  assetId: string,
): Promise<void> {
  const environment = loadE2EEnvironment();
  const pool = createDatabasePool(environment.testDatabaseUrl);
  const assetRepository = createAssetRepository(pool);

  try {
    await executeInTransaction(pool, async (client) => {
      await assetRepository.addOnTransaction(client, {
        characterId,
        assetType: 'ITEM',
        assetId,
        quantity: '1',
        reasonCode: 'E2E_BREAKTHROUGH_REQUIREMENT_COMPLETED',
        referenceType: 'FIXTURE',
        referenceId: `breakthrough-complete-${characterId}`,
        configVersion: '2026.08.16.1',
      });
    });
  } finally {
    await pool.end();
  }
}

export async function moveBreakthroughTrialBoundary(
  breakthroughRunId: string,
  boundary: 'trial' | 'expiry',
): Promise<void> {
  const environment = loadE2EEnvironment();
  const pool = createDatabasePool(environment.testDatabaseUrl);
  try {
    const column = boundary === 'trial' ? 'trial_deadline_at' : 'expires_at';
    await pool.query(
      `UPDATE breakthrough_runs
          SET ${column} = CURRENT_TIMESTAMP - INTERVAL '1 second',
              updated_at = CURRENT_TIMESTAMP
        WHERE id = $1`,
      [breakthroughRunId],
    );
  } finally {
    await pool.end();
  }
}

export async function driftCharacterConfigVersion(characterId: string, configVersion: string): Promise<void> {
  const environment = loadE2EEnvironment();
  const pool = createDatabasePool(environment.testDatabaseUrl);
  try {
    await pool.query(
      `UPDATE characters
          SET active_config_version = $2,
              updated_at = CURRENT_TIMESTAMP
        WHERE id = $1`,
      [characterId, configVersion],
    );
  } finally {
    await pool.end();
  }
}

export async function readBreakthroughDatabaseState(
  characterId: string,
  breakthroughRunId: string,
) {
  const environment = loadE2EEnvironment();
  const pool = createDatabasePool(environment.testDatabaseUrl);
  try {
    const [character, run, reservations, finalizeTransactions, medicineSlotThreeBuffs] =
      await Promise.all([
        pool.query<{ readonly realm_stage_id: string }>(
          `SELECT realm_stage_id FROM characters WHERE id = $1`,
          [characterId],
        ),
        pool.query<{
          readonly status: string;
          readonly result: unknown;
          readonly config_version: string;
        }>(`SELECT status, result, config_version FROM breakthrough_runs WHERE id = $1`, [
          breakthroughRunId,
        ]),
        pool.query<{ readonly status: string; readonly quantity: string }>(
          `SELECT status, quantity::text AS quantity
             FROM asset_reservations
            WHERE character_id = $1 AND business_type = 'BREAKTHROUGH_TRIAL' AND business_id = $2
            ORDER BY asset_id`,
          [characterId, breakthroughRunId],
        ),
        pool.query<{ readonly asset_id: string; readonly transaction_count: string }>(
          `SELECT l.asset_id, COUNT(DISTINCT t.id)::text AS transaction_count
             FROM asset_transactions t
             INNER JOIN asset_ledger l ON l.transaction_id = t.id
            WHERE t.character_id = $1
              AND t.operation_type = 'CONSUME'
              AND t.reason_code = 'BREAKTHROUGH_FINALIZE'
              AND t.reference_id = $2
            GROUP BY l.asset_id
            ORDER BY l.asset_id`,
          [characterId, breakthroughRunId],
        ),
        pool.query<{ readonly count: string }>(
          `SELECT COUNT(*)::text AS count
             FROM buff_instances
            WHERE character_id = $1 AND slot_index = 3`,
          [characterId],
        ),
      ]);
    return {
      realmStageId: character.rows[0]?.realm_stage_id ?? null,
      run: run.rows[0] ?? null,
      reservations: reservations.rows,
      finalizeConsumptions: finalizeTransactions.rows.map((row) => ({
        assetId: row.asset_id,
        transactionCount: Number(row.transaction_count),
      })),
      medicineSlotThreeBuffCount: Number(medicineSlotThreeBuffs.rows[0]?.count ?? '0'),
    } as const;
  } finally {
    await pool.end();
  }
}
