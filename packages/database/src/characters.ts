import type { DatabasePool } from './index.js';

export type CharacterSkillProgressionRecord = {
  readonly skillId: string;
  readonly level: number;
  readonly xp: string;
};

export type CharacterProgressionRecord = {
  readonly characterId: string;
  readonly accountId: string;
  readonly name: string;
  readonly stateVersion: string;
  readonly activeConfigVersion: string;
  readonly cultivationXp: string;
  readonly realmStageId: string;
  readonly skills: readonly CharacterSkillProgressionRecord[];
};

type ProgressionRow = {
  character_id: string;
  account_id: string;
  name: string;
  state_version: string;
  active_config_version: string;
  cultivation_xp: string | null;
  progression_realm_stage_id: string | null;
  skill_id: string | null;
  skill_level: number | null;
  skill_xp: string | null;
};

export type CharacterRepository = {
  readonly getProgression: (
    characterId: string,
    accountId: string,
  ) => Promise<CharacterProgressionRecord | null>;
};

export function createCharacterRepository(pool: DatabasePool): CharacterRepository {
  return {
    async getProgression(characterId, accountId) {
      const result = await pool.query<ProgressionRow>(
        `SELECT
           c.id AS character_id,
           c.account_id,
           c.name,
           c.state_version::text AS state_version,
           c.active_config_version,
           cp.cultivation_xp::text AS cultivation_xp,
           cp.realm_stage_id AS progression_realm_stage_id,
           sp.skill_id,
           sp.level AS skill_level,
           sp.xp::text AS skill_xp
         FROM characters c
         LEFT JOIN character_progression cp ON cp.character_id = c.id
         LEFT JOIN skill_progression sp ON sp.character_id = c.id
         WHERE c.id = $1
           AND c.account_id = $2
         ORDER BY sp.skill_id ASC`,
        [characterId, accountId],
      );
      const first = result.rows[0];
      if (!first || first.cultivation_xp === null || first.progression_realm_stage_id === null) {
        return null;
      }

      const skills: CharacterSkillProgressionRecord[] = [];
      for (const row of result.rows) {
        if (row.skill_id !== null && row.skill_level !== null && row.skill_xp !== null) {
          skills.push({ skillId: row.skill_id, level: row.skill_level, xp: row.skill_xp });
        }
      }

      return {
        characterId: first.character_id,
        accountId: first.account_id,
        name: first.name,
        stateVersion: first.state_version,
        activeConfigVersion: first.active_config_version,
        cultivationXp: first.cultivation_xp,
        realmStageId: first.progression_realm_stage_id,
        skills,
      };
    },
  };
}
