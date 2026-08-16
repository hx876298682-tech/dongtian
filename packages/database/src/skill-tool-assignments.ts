import type { PoolClient } from 'pg';

import type { DatabasePool } from './index.js';

export type SkillToolAssignmentRecord = {
  readonly characterId: string;
  readonly skillId: string;
  readonly equipmentInstanceId: string;
  readonly itemId: string;
  readonly version: bigint;
  readonly updatedAt: Date;
};

export type SkillToolAssignmentWriteInput = {
  readonly skillId: string;
  readonly equipmentInstanceId: string;
};

export type SkillToolAssignmentReplaceInput = {
  readonly characterId: string;
  readonly assignments: readonly SkillToolAssignmentWriteInput[];
};

type AssignmentRow = {
  character_id: string;
  skill_id: string;
  equipment_instance_id: string;
  item_id: string;
  version: string;
  updated_at: Date;
};

async function lockWriteDependencies(client: PoolClient, characterId: string): Promise<void> {
  const character = await client.query<{ id: string }>(
    `SELECT id
       FROM characters
      WHERE id = $1
      FOR UPDATE`,
    [characterId],
  );
  if (!character.rows[0]) {
    throw new Error('SKILL_TOOL_ASSIGNMENT_CHARACTER_NOT_FOUND');
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
    throw new Error('SKILL_TOOL_ASSIGNMENT_SETTLEMENT_STATE_NOT_FOUND');
  }
  if (row.continuation_required) {
    throw new Error('SETTLEMENT_CONTINUATION_IN_PROGRESS');
  }
}

function toRecord(row: AssignmentRow): SkillToolAssignmentRecord {
  return {
    characterId: row.character_id,
    skillId: row.skill_id,
    equipmentInstanceId: row.equipment_instance_id,
    itemId: row.item_id,
    version: BigInt(row.version),
    updatedAt: row.updated_at,
  };
}

function assertNonEmpty(value: string, field: string): void {
  if (value.trim().length === 0) {
    throw new Error(`SKILL_TOOL_ASSIGNMENT_VALIDATION_FAILED:${field}`);
  }
}

export type SkillToolAssignmentRepository = {
  readonly getAssignments: (
    characterId: string,
    accountId: string,
  ) => Promise<readonly SkillToolAssignmentRecord[]>;
  readonly replaceAssignments: (
    client: PoolClient,
    input: SkillToolAssignmentReplaceInput,
  ) => Promise<readonly SkillToolAssignmentRecord[]>;
};

export function createSkillToolAssignmentRepository(pool: DatabasePool): SkillToolAssignmentRepository {
  return {
    async getAssignments(characterId, accountId) {
      assertNonEmpty(characterId, 'characterId');
      assertNonEmpty(accountId, 'accountId');
      const result = await pool.query<AssignmentRow>(
        `SELECT sta.character_id,
                sta.skill_id,
                sta.equipment_instance_id,
                ei.item_id,
                sta.version::text AS version,
                sta.updated_at
           FROM skill_tool_assignments sta
           INNER JOIN characters c ON c.id = sta.character_id
           INNER JOIN equipment_instances ei ON ei.id = sta.equipment_instance_id
          WHERE sta.character_id = $1
            AND c.account_id = $2
          ORDER BY sta.skill_id ASC`,
        [characterId, accountId],
      );
      return result.rows.map(toRecord);
    },

    async replaceAssignments(client, input) {
      assertNonEmpty(input.characterId, 'characterId');
      await lockWriteDependencies(client, input.characterId);

      const skillIds = input.assignments.map((assignment) => assignment.skillId);
      const uniqueSkillIds = new Set(skillIds);
      if (uniqueSkillIds.size !== skillIds.length) {
        throw new Error('SKILL_TOOL_ASSIGNMENT_DUPLICATE_SKILL');
      }

      const instanceIds = input.assignments.map((assignment) => assignment.equipmentInstanceId);
      const uniqueInstanceIds = new Set(instanceIds);
      if (uniqueInstanceIds.size !== instanceIds.length) {
        throw new Error('SKILL_TOOL_ASSIGNMENT_DUPLICATE_INSTANCE');
      }

      const keptSkillIds = skillIds;
      await client.query(
        `DELETE FROM skill_tool_assignments
          WHERE character_id = $1
            AND NOT (skill_id = ANY($2::text[]))`,
        [input.characterId, keptSkillIds],
      );

      for (const assignment of input.assignments) {
        const result = await client.query<AssignmentRow>(
          `INSERT INTO skill_tool_assignments
             (character_id, skill_id, equipment_instance_id)
           VALUES ($1, $2, $3)
           ON CONFLICT (character_id, skill_id) DO UPDATE
             SET equipment_instance_id = EXCLUDED.equipment_instance_id,
                 version = skill_tool_assignments.version + 1,
                 updated_at = CURRENT_TIMESTAMP
           RETURNING character_id, skill_id, equipment_instance_id,
                     (SELECT item_id
                        FROM equipment_instances
                       WHERE id = skill_tool_assignments.equipment_instance_id) AS item_id,
                     version::text AS version,
                     updated_at`,
          [input.characterId, assignment.skillId, assignment.equipmentInstanceId],
        );
        if (!result.rows[0]) {
          throw new Error('SKILL_TOOL_ASSIGNMENT_WRITE_FAILED');
        }
      }

      const result = await client.query<AssignmentRow>(
        `SELECT sta.character_id,
                sta.skill_id,
                sta.equipment_instance_id,
                ei.item_id,
                sta.version::text AS version,
                sta.updated_at
           FROM skill_tool_assignments sta
           INNER JOIN equipment_instances ei ON ei.id = sta.equipment_instance_id
          WHERE sta.character_id = $1
          ORDER BY sta.skill_id ASC`,
        [input.characterId],
      );
      return result.rows.map(toRecord);
    },
  };
}
