import { randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { Pool } from 'pg';
import { applyMigrations } from './migrations.ts';
import { PostgresRepository } from './postgres-repository.ts';
import { GameService } from './service.ts';

type Sample = { durationMs: number; ok: boolean };
type CapacityReport = {
  generatedAt: string;
  players: number;
  rounds: number;
  settlements: number;
  successfulSettlements: number;
  failedSettlements: number;
  elapsedMs: number;
  throughputPerSecond: number;
  latencyMs: { p50: number; p95: number; p99: number; max: number };
  errors: Array<{ playerId: string; round: number; message: string }>;
};

const integerEnv = (name: string, fallback: number, max: number): number => {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  if (!/^\d+$/.test(raw)) throw new Error(`${name} must be a non-negative integer`);
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 1 || value > max) throw new Error(`${name} must be between 1 and ${max}`);
  return value;
};

const percentile = (values: number[], fraction: number): number => {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1);
  return Number(sorted[index]!.toFixed(3));
};

const cleanup = async (pool: Pool, playerIds: string[]): Promise<void> => {
  if (playerIds.length === 0) return;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const table of ['action_idempotency', 'audit_event', 'collection_event', 'settlement_record', 'dungeon_attempt', 'equipment_instance', 'collection_state', 'building_job', 'building_state', 'inventory_resource', 'progress_state', 'player_state']) {
      await client.query(`DELETE FROM ${table} WHERE player_id = ANY($1::uuid[])`, [playerIds]);
    }
    await client.query('COMMIT');
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch { /* preserve cleanup failure */ }
    throw error;
  } finally {
    client.release();
  }
};

const run = async (): Promise<CapacityReport> => {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error('DATABASE_URL is required for the capacity harness');
  const players = integerEnv('CAPACITY_PLAYERS', 64, 2_000);
  const rounds = integerEnv('CAPACITY_ROUNDS', 24, 2_000);
  const poolMax = integerEnv('CAPACITY_POOL_MAX', 16, 200);
  const pool = new Pool({ connectionString: databaseUrl, max: poolMax });
  const playerIds = Array.from({ length: players }, () => randomUUID());
  const service = new GameService(new PostgresRepository(pool));
  const base = new Date();
  const samples: Sample[] = [];
  const errors: CapacityReport['errors'] = [];
  const startedAt = performance.now();
  try {
    await applyMigrations(pool);
    await Promise.all(playerIds.map((playerId) => service.createPlayer(playerId, base)));
    await Promise.all(playerIds.map((playerId) => service.startAction({ playerId, actionId: 'training', expectedRevision: 0, now: base })));
    for (let round = 1; round <= rounds; round += 1) {
      const endedAt = new Date(base.getTime() + round * 3_600_000);
      await Promise.all(playerIds.map(async (playerId) => {
        const requestStarted = performance.now();
        try {
          await service.offlineSettlement({ playerId, settlementId: randomUUID(), requestedStartedAt: new Date(endedAt.getTime() - 3_600_000).toISOString(), requestedEndedAt: endedAt.toISOString(), expectedRevision: round, now: endedAt });
          samples.push({ durationMs: performance.now() - requestStarted, ok: true });
        } catch (error) {
          samples.push({ durationMs: performance.now() - requestStarted, ok: false });
          errors.push({ playerId, round, message: error instanceof Error ? error.message : String(error) });
        }
      }));
    }
    const elapsedMs = performance.now() - startedAt;
    const successfulSettlements = samples.filter((sample) => sample.ok).length;
    const latencies = samples.map((sample) => sample.durationMs);
    return {
      generatedAt: new Date().toISOString(), players, rounds, settlements: samples.length,
      successfulSettlements, failedSettlements: samples.length - successfulSettlements,
      elapsedMs: Number(elapsedMs.toFixed(3)),
      throughputPerSecond: Number((successfulSettlements / Math.max(0.001, elapsedMs / 1000)).toFixed(3)),
      latencyMs: { p50: percentile(latencies, 0.5), p95: percentile(latencies, 0.95), p99: percentile(latencies, 0.99), max: Number(Math.max(...latencies).toFixed(3)) },
      errors,
    };
  } finally {
    try { await cleanup(pool, playerIds); } finally { await pool.end(); }
  }
};

try {
  const report = await run();
  const serialized = `${JSON.stringify(report, null, 2)}\n`;
  if (process.env.CAPACITY_OUTPUT) await writeFile(process.env.CAPACITY_OUTPUT, serialized, 'utf8');
  process.stdout.write(serialized);
  if (report.failedSettlements > 0) process.exitCode = 1;
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
