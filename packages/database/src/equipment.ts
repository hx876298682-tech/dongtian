import type { PoolClient } from 'pg';

import type { DatabasePool, JsonValue } from './index.js';

export type EquipmentSlot = 'WEAPON' | 'ARMOR' | 'ACCESSORY';

export type EquipmentInstanceOwnership = {
  readonly instanceId: string;
  readonly itemId: string;
};

export type LoadoutPresetRecord = {
  readonly presetId: string;
  readonly characterId: string;
  readonly name: string;
  readonly weaponInstanceId: string | null;
  readonly armorInstanceId: string | null;
  readonly accessoryInstanceId: string | null;
  readonly combatConsumables: JsonValue;
  readonly strategyId: string;
  readonly version: bigint;
  readonly active: boolean;
  readonly createdAt: Date;
  readonly updatedAt: Date;
};

export type LoadoutPresetWriteInput = {
  readonly characterId: string;
  readonly presetId: string;
  readonly name: string;
  readonly weaponInstanceId: string | null;
  readonly armorInstanceId: string | null;
  readonly accessoryInstanceId: string | null;
  readonly combatConsumables: JsonValue;
  readonly strategyId: string;
};

type LoadoutPresetRow = {
  id: string;
  character_id: string;
  name: string;
  weapon_instance_id: string | null;
  armor_instance_id: string | null;
  accessory_instance_id: string | null;
  combat_consumables: JsonValue;
  strategy_id: string;
  version: string;
  created_at: Date;
  updated_at: Date;
  active: boolean;
};

export type EquipmentRepository = {
  readonly getLoadoutPreset: (
    characterId: string,
    accountId: string,
    presetId: string,
  ) => Promise<LoadoutPresetRecord | null>;
  readonly listLoadoutPresets: (
    characterId: string,
    accountId: string,
  ) => Promise<readonly LoadoutPresetRecord[]>;
  readonly saveLoadoutPreset: (
    client: PoolClient,
    input: LoadoutPresetWriteInput,
  ) => Promise<LoadoutPresetRecord>;
  readonly activateLoadoutPreset: (
    client: PoolClient,
    input: { readonly characterId: string; readonly presetId: string },
  ) => Promise<LoadoutPresetRecord>;
};

function assertNonEmpty(value: string, field: string): void {
  if (value.trim().length === 0) {
    throw new Error(`EQUIPMENT_VALIDATION_FAILED:${field}`);
  }
}

function toRecord(row: LoadoutPresetRow): LoadoutPresetRecord {
  return {
    presetId: row.id,
    characterId: row.character_id,
    name: row.name,
    weaponInstanceId: row.weapon_instance_id,
    armorInstanceId: row.armor_instance_id,
    accessoryInstanceId: row.accessory_instance_id,
    combatConsumables: row.combat_consumables,
    strategyId: row.strategy_id,
    version: BigInt(row.version),
    active: row.active,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function lockWriteDependencies(client: PoolClient, characterId: string): Promise<void> {
  const character = await client.query<{ id: string }>(
    `SELECT id
       FROM characters
      WHERE id = $1
      FOR UPDATE`,
    [characterId],
  );
  if (!character.rows[0]) {
    throw new Error('EQUIPMENT_CHARACTER_NOT_FOUND');
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
    throw new Error('EQUIPMENT_SETTLEMENT_STATE_NOT_FOUND');
  }
  if (row.continuation_required) {
    throw new Error('SETTLEMENT_CONTINUATION_IN_PROGRESS');
  }
}

async function readPreset(
  client: Pick<PoolClient, 'query'>,
  characterId: string,
  accountId: string,
  presetId: string,
): Promise<LoadoutPresetRecord | null> {
  const result = await client.query<LoadoutPresetRow>(
    `SELECT p.id, p.character_id, p.name, p.weapon_instance_id,
            p.armor_instance_id, p.accessory_instance_id, p.combat_consumables,
            p.strategy_id, p.version::text AS version, p.created_at, p.updated_at,
            COALESCE(c.active_loadout_preset_id = p.id, FALSE) AS active
       FROM loadout_presets p
       INNER JOIN characters c ON c.id = p.character_id
      WHERE p.id = $1
        AND p.character_id = $2
        AND c.account_id = $3`,
    [presetId, characterId, accountId],
  );
  const row = result.rows[0];
  return row ? toRecord(row) : null;
}

function upsertPresetRow(
  client: PoolClient,
  input: LoadoutPresetWriteInput,
  existingCharacterId: string | null,
): Promise<LoadoutPresetRecord> {
  if (existingCharacterId !== null && existingCharacterId !== input.characterId) {
    throw new Error('EQUIPMENT_PRESET_FORBIDDEN');
  }

  if (existingCharacterId === null) {
    return client.query<LoadoutPresetRow>(
      `INSERT INTO loadout_presets
        (id, character_id, name, weapon_instance_id, armor_instance_id,
         accessory_instance_id, combat_consumables, strategy_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8)
       RETURNING id, character_id, name, weapon_instance_id, armor_instance_id,
                 accessory_instance_id, combat_consumables, strategy_id,
                 version::text AS version, created_at, updated_at`,
      [
        input.presetId,
        input.characterId,
        input.name,
        input.weaponInstanceId,
        input.armorInstanceId,
        input.accessoryInstanceId,
        JSON.stringify(input.combatConsumables),
        input.strategyId,
      ],
    ).then((result) => {
      const row = result.rows[0];
      if (!row) {
        throw new Error('EQUIPMENT_PRESET_CREATE_FAILED');
      }
      return client.query<{ active_loadout_preset_id: string | null }>(
        `SELECT active_loadout_preset_id
           FROM characters
          WHERE id = $1`,
        [input.characterId],
      ).then((activeResult) => {
        const active = activeResult.rows[0]?.active_loadout_preset_id === row.id;
        return toRecord({ ...row, active });
      });
    });
  }

  return client.query<LoadoutPresetRow>(
    `UPDATE loadout_presets
        SET name = $2,
            weapon_instance_id = $3,
            armor_instance_id = $4,
            accessory_instance_id = $5,
            combat_consumables = $6::jsonb,
            strategy_id = $7,
            version = version + 1,
            updated_at = CURRENT_TIMESTAMP
      WHERE id = $1
        AND character_id = $8
      RETURNING id, character_id, name, weapon_instance_id, armor_instance_id,
                accessory_instance_id, combat_consumables, strategy_id,
                version::text AS version, created_at, updated_at`,
    [
      input.presetId,
      input.name,
      input.weaponInstanceId,
      input.armorInstanceId,
      input.accessoryInstanceId,
      JSON.stringify(input.combatConsumables),
      input.strategyId,
      input.characterId,
    ],
  ).then((result) => {
    const row = result.rows[0];
    if (!row) {
      throw new Error('EQUIPMENT_PRESET_UPDATE_FAILED');
    }
    return client.query<{ active_loadout_preset_id: string | null }>(
      `SELECT active_loadout_preset_id
         FROM characters
        WHERE id = $1`,
      [input.characterId],
    ).then((activeResult) => {
      const active = activeResult.rows[0]?.active_loadout_preset_id === row.id;
      return toRecord({ ...row, active });
    });
  });
}

export function createEquipmentRepository(pool: DatabasePool): EquipmentRepository {
  return {
    async getLoadoutPreset(characterId, accountId, presetId) {
      assertNonEmpty(characterId, 'characterId');
      assertNonEmpty(accountId, 'accountId');
      assertNonEmpty(presetId, 'presetId');
      return readPreset(pool, characterId, accountId, presetId);
    },

    async listLoadoutPresets(characterId, accountId) {
      assertNonEmpty(characterId, 'characterId');
      assertNonEmpty(accountId, 'accountId');
      const result = await pool.query<LoadoutPresetRow>(
        `SELECT p.id, p.character_id, p.name, p.weapon_instance_id,
                p.armor_instance_id, p.accessory_instance_id, p.combat_consumables,
                p.strategy_id, p.version::text AS version, p.created_at, p.updated_at,
                COALESCE(c.active_loadout_preset_id = p.id, FALSE) AS active
           FROM loadout_presets p
           INNER JOIN characters c ON c.id = p.character_id
          WHERE p.character_id = $1
            AND c.account_id = $2
          ORDER BY p.created_at ASC, p.id ASC`,
        [characterId, accountId],
      );
      return result.rows.map(toRecord);
    },

    async saveLoadoutPreset(client, input) {
      assertNonEmpty(input.characterId, 'characterId');
      assertNonEmpty(input.presetId, 'presetId');
      assertNonEmpty(input.name, 'name');
      assertNonEmpty(input.strategyId, 'strategyId');
      await lockWriteDependencies(client, input.characterId);
      const existing = await client.query<{ character_id: string }>(
        `SELECT character_id
           FROM loadout_presets
          WHERE id = $1
          FOR UPDATE`,
        [input.presetId],
      );
      const row = existing.rows[0];
      return upsertPresetRow(client, input, row?.character_id ?? null);
    },

    async activateLoadoutPreset(client, input) {
      assertNonEmpty(input.characterId, 'characterId');
      assertNonEmpty(input.presetId, 'presetId');
      await lockWriteDependencies(client, input.characterId);
      const preset = await client.query<LoadoutPresetRow>(
        `SELECT p.id, p.character_id, p.name, p.weapon_instance_id,
                p.armor_instance_id, p.accessory_instance_id, p.combat_consumables,
                p.strategy_id, p.version::text AS version, p.created_at, p.updated_at
           FROM loadout_presets p
          WHERE p.id = $1
            AND p.character_id = $2
          FOR UPDATE`,
        [input.presetId, input.characterId],
      );
      const row = preset.rows[0];
      if (!row) {
        throw new Error('EQUIPMENT_PRESET_NOT_FOUND');
      }
      const updated = await client.query<LoadoutPresetRow>(
        `UPDATE characters
            SET active_loadout_preset_id = $2,
                updated_at = CURRENT_TIMESTAMP
          WHERE id = $1
          RETURNING COALESCE(active_loadout_preset_id = $2, FALSE) AS active`,
        [input.characterId, input.presetId],
      );
      const active = updated.rows[0]?.active ?? false;
      return toRecord({ ...row, active });
    },
  };
}
