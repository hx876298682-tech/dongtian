import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import type { AsyncSqlClient, AsyncSqlPool } from './postgres-repository.ts';

const migrationFiles = ['V1_001_core.sql', 'V1_002_config_release.sql', 'V1_003_observability.sql'] as const;

/** Apply the checked-in schema in order before wiring the authoritative repository. */
export async function applyMigrations(pool: AsyncSqlPool): Promise<void> {
  const client: AsyncSqlClient = 'connect' in pool ? await pool.connect() : pool as AsyncSqlClient;
  try {
    await client.query('BEGIN');
    try {
      // Serialize startup schema work across replicas. The migration files are
      // idempotent, but concurrent ALTER/DO blocks can still observe the same
      // pre-migration shape and race on constraints.
      await client.query("SELECT pg_advisory_xact_lock(hashtext('dongtian.schema.v1'))");
      for (const file of migrationFiles) {
        const sql = await readFile(fileURLToPath(new URL(`./migrations/${file}`, import.meta.url)), 'utf8');
        await client.query(sql);
      }
      await client.query('COMMIT');
    } catch (error) {
      try { await client.query('ROLLBACK'); } catch { /* preserve the migration error */ }
      throw error;
    }
  } finally {
    client.release?.();
  }
}

export { migrationFiles };
