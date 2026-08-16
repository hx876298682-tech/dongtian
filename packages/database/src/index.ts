import { Pool } from 'pg';
export type { PoolClient } from 'pg';

export type DatabasePool = Pool;

export const packageName = '@dongtian/database' as const;

export type DatabaseHealth =
  | { readonly ok: true; readonly latencyMs: number }
  | { readonly ok: false; readonly reason: 'database_unavailable' };

export function createDatabasePool(databaseUrl: string): DatabasePool {
  return new Pool({
    connectionString: databaseUrl,
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 1_000,
  });
}

export async function checkDatabaseHealth(databaseUrl: string): Promise<DatabaseHealth> {
  const startedAt = performance.now();
  const pool = new Pool({
    connectionString: databaseUrl,
    max: 1,
    connectionTimeoutMillis: 1_000,
  });

  try {
    await pool.query('SELECT 1');
    return { ok: true, latencyMs: Math.max(0, Math.round(performance.now() - startedAt)) };
  } catch {
    return { ok: false, reason: 'database_unavailable' };
  } finally {
    await pool.end();
  }
}

export * from './auth.js';
export * from './buffs.js';
export * from './characters.js';
export * from './assets.js';
export * from './equipment.js';
export * from './tempering.js';
export * from './skill-tool-assignments.js';
export * from './dungeon.js';
export * from './idempotency.js';
export * from './outbox.js';
export * from './queue.js';
export * from './settlement.js';
export * from './cave.js';
