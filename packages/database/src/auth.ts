import type { PoolClient } from 'pg';

import type { DatabasePool } from './index.js';

const DEFAULT_FALLBACK_ACTION_ID = 'action.cultivation.qi';

export type AuthSessionRecord = {
  readonly sessionId: string;
  readonly accountId: string;
  readonly accountType: 'ANONYMOUS' | 'REGISTERED';
  readonly accountStatus: 'ACTIVE' | 'SUSPENDED' | 'DELETED';
  readonly csrfTokenHash: string;
  readonly expiresAt: Date;
};

export type CreatedAnonymousSession = {
  readonly sessionId: string;
  readonly accountId: string;
  readonly characterId: string;
  readonly accountType: 'ANONYMOUS';
  readonly accountStatus: 'ACTIVE';
  readonly expiresAt: Date;
};

export type DefaultCharacterInput = {
  readonly name: string;
  readonly realmStageId: string;
  readonly activeConfigVersion: string;
  readonly skillIds: readonly string[];
};

export type AuthRepository = {
  readonly createAnonymousSession: (input: {
    readonly sessionTokenHash: string;
    readonly csrfTokenHash: string;
    readonly expiresAt: Date;
    readonly defaultCharacter: DefaultCharacterInput;
  }) => Promise<CreatedAnonymousSession>;
  readonly ensureDefaultCharacter: (
    accountId: string,
    input: DefaultCharacterInput,
  ) => Promise<{ readonly characterId: string }>;
  readonly findActiveSession: (
    sessionTokenHash: string,
    now: Date,
  ) => Promise<AuthSessionRecord | null>;
  readonly touchSession: (sessionId: string, now: Date) => Promise<void>;
  readonly rotateCsrfToken: (sessionId: string, csrfTokenHash: string, now: Date) => Promise<boolean>;
  readonly revokeSession: (sessionTokenHash: string, now: Date) => Promise<boolean>;
  readonly characterBelongsToAccount: (characterId: string, accountId: string) => Promise<boolean>;
};

type SessionRow = {
  session_id: string;
  account_id: string;
  account_type: AuthSessionRecord['accountType'];
  account_status: AuthSessionRecord['accountStatus'];
  csrf_token_hash: string;
  expires_at: Date;
};

async function ensureDefaultQueue(client: PoolClient, characterId: string): Promise<void> {
  await client.query(
    `INSERT INTO action_queues (character_id, fallback_action_id)
     VALUES ($1, $2)
     ON CONFLICT (character_id) DO NOTHING`,
    [characterId, DEFAULT_FALLBACK_ACTION_ID],
  );
}

export function createAuthRepository(pool: DatabasePool): AuthRepository {
  return {
    async createAnonymousSession(input) {
      const client = await pool.connect();

      try {
        await client.query('BEGIN');
        const accountResult = await client.query<{ id: string }>(
          `INSERT INTO accounts (type, status)
           VALUES ('ANONYMOUS', 'ACTIVE')
           RETURNING id`,
        );
        const account = accountResult.rows[0];
        if (!account) {
          throw new Error('Anonymous account was not created.');
        }

        const characterResult = await client.query<{ id: string }>(
          `INSERT INTO characters (account_id, name, realm_stage_id, active_config_version)
           VALUES ($1, $2, $3, $4)
           RETURNING id`,
          [
            account.id,
            input.defaultCharacter.name,
            input.defaultCharacter.realmStageId,
            input.defaultCharacter.activeConfigVersion,
          ],
        );
        const character = characterResult.rows[0];
        if (!character) {
          throw new Error('Default character was not created.');
        }

        await client.query(
          `INSERT INTO character_progression (character_id, cultivation_xp, realm_stage_id)
           VALUES ($1, '0', $2)`,
          [character.id, input.defaultCharacter.realmStageId],
        );
        await client.query(
          `INSERT INTO skill_progression (character_id, skill_id, level, xp)
           SELECT $1, skill_id, 1, '0'
           FROM unnest($2::text[]) AS skill_id`,
          [character.id, input.defaultCharacter.skillIds],
        );
        await client.query(
          `INSERT INTO settlement_states (character_id, last_settled_at)
           VALUES ($1, CURRENT_TIMESTAMP)`,
          [character.id],
        );
        await ensureDefaultQueue(client, character.id);

        const sessionResult = await client.query<{
          id: string;
          expires_at: Date;
        }>(
          `INSERT INTO sessions (
             account_id,
             session_token_hash,
             csrf_token_hash,
             expires_at
           )
           VALUES ($1, $2, $3, $4)
           RETURNING id, expires_at`,
          [account.id, input.sessionTokenHash, input.csrfTokenHash, input.expiresAt],
        );
        const session = sessionResult.rows[0];
        if (!session) {
          throw new Error('Anonymous session was not created.');
        }

        await client.query('COMMIT');
        return {
          sessionId: session.id,
          accountId: account.id,
          characterId: character.id,
          accountType: 'ANONYMOUS' as const,
          accountStatus: 'ACTIVE' as const,
          expiresAt: session.expires_at,
        };
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    },

    async ensureDefaultCharacter(accountId, input) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const existingResult = await client.query<{ id: string }>(
          `SELECT id FROM characters WHERE account_id = $1 LIMIT 1`,
          [accountId],
        );
        const existing = existingResult.rows[0];
        if (existing) {
          await client.query(
            `INSERT INTO settlement_states (character_id, last_settled_at)
             VALUES ($1, CURRENT_TIMESTAMP)
             ON CONFLICT (character_id) DO NOTHING`,
            [existing.id],
          );
          await ensureDefaultQueue(client, existing.id);
          await client.query('COMMIT');
          return { characterId: existing.id };
        }

        const characterResult = await client.query<{ id: string }>(
          `INSERT INTO characters (account_id, name, realm_stage_id, active_config_version)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (account_id) DO NOTHING
           RETURNING id`,
          [accountId, input.name, input.realmStageId, input.activeConfigVersion],
        );
        const character = characterResult.rows[0];
        if (!character) {
          const concurrentResult = await client.query<{ id: string }>(
            `SELECT id FROM characters WHERE account_id = $1 LIMIT 1`,
            [accountId],
          );
          const concurrent = concurrentResult.rows[0];
          if (!concurrent) {
            throw new Error('Default character was not created.');
          }
          await client.query(
            `INSERT INTO settlement_states (character_id, last_settled_at)
             VALUES ($1, CURRENT_TIMESTAMP)
             ON CONFLICT (character_id) DO NOTHING`,
            [concurrent.id],
          );
          await ensureDefaultQueue(client, concurrent.id);
          await client.query('COMMIT');
          return { characterId: concurrent.id };
        }

        await client.query(
          `INSERT INTO character_progression (character_id, cultivation_xp, realm_stage_id)
           VALUES ($1, '0', $2)`,
          [character.id, input.realmStageId],
        );
        await client.query(
          `INSERT INTO skill_progression (character_id, skill_id, level, xp)
           SELECT $1, skill_id, 1, '0'
           FROM unnest($2::text[]) AS skill_id`,
          [character.id, input.skillIds],
        );
        await client.query(
          `INSERT INTO settlement_states (character_id, last_settled_at)
           VALUES ($1, CURRENT_TIMESTAMP)`,
          [character.id],
        );
        await ensureDefaultQueue(client, character.id);
        await client.query('COMMIT');
        return { characterId: character.id };
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    },

    async findActiveSession(sessionTokenHash, now) {
      const result = await pool.query<SessionRow>(
        `SELECT
           s.id AS session_id,
           s.account_id,
           a.type AS account_type,
           a.status AS account_status,
           s.csrf_token_hash,
           s.expires_at
         FROM sessions s
         INNER JOIN accounts a ON a.id = s.account_id
         WHERE s.session_token_hash = $1
           AND s.revoked_at IS NULL
           AND s.expires_at > $2
           AND a.status = 'ACTIVE'
         LIMIT 1`,
        [sessionTokenHash, now],
      );
      const row = result.rows[0];
      return row
        ? {
            sessionId: row.session_id,
            accountId: row.account_id,
            accountType: row.account_type,
            accountStatus: row.account_status,
            csrfTokenHash: row.csrf_token_hash,
            expiresAt: row.expires_at,
          }
        : null;
    },

    async touchSession(sessionId, now) {
      await pool.query(
        `UPDATE sessions
         SET last_seen_at = $2, updated_at = $2
         WHERE id = $1
           AND revoked_at IS NULL`,
        [sessionId, now],
      );
    },

    async rotateCsrfToken(sessionId, csrfTokenHash, now) {
      const result = await pool.query(
        `UPDATE sessions
         SET csrf_token_hash = $2, last_seen_at = $3, updated_at = $3
         WHERE id = $1
           AND revoked_at IS NULL
           AND expires_at > $3`,
        [sessionId, csrfTokenHash, now],
      );
      return result.rowCount === 1;
    },

    async revokeSession(sessionTokenHash, now) {
      const result = await pool.query(
        `UPDATE sessions
         SET revoked_at = $2, last_seen_at = $2, updated_at = $2
         WHERE session_token_hash = $1
           AND revoked_at IS NULL`,
        [sessionTokenHash, now],
      );
      return result.rowCount === 1;
    },

    async characterBelongsToAccount(characterId, accountId) {
      const result = await pool.query(
        `SELECT 1
         FROM characters
         WHERE id = $1
           AND account_id = $2
         LIMIT 1`,
        [characterId, accountId],
      );
      return result.rowCount === 1;
    },
  };
}
