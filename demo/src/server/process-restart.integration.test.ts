import assert from 'node:assert/strict';
import { createHmac, randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { Pool } from 'pg';
import test from 'node:test';
import { applyMigrations } from './migrations.ts';

const databaseUrl = process.env.DATABASE_URL;
const integrationOptions = { skip: !databaseUrl, concurrency: false } as const;
const jwtSecret = 'process-restart-integration-secret-0123456789';

const jwtPart = (value: unknown): string => Buffer.from(JSON.stringify(value)).toString('base64url');
const tokenFor = (subject: string): string => {
  const header = jwtPart({ alg: 'HS256', typ: 'JWT' });
  const payload = jwtPart({ sub: subject, exp: Math.floor(Date.now() / 1000) + 300 });
  return `${header}.${payload}.${createHmac('sha256', jwtSecret).update(`${header}.${payload}`).digest('base64url')}`;
};

const freePort = async (): Promise<number> => {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('failed to reserve a test port');
  const port = address.port;
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return port;
};

const stopChild = async (child: ChildProcess, signal: NodeJS.Signals = 'SIGKILL'): Promise<void> => {
  if (child.exitCode !== null || child.signalCode !== null) return;
  child.kill(signal);
  await once(child, 'exit');
};

const startChild = async (env: NodeJS.ProcessEnv): Promise<ChildProcess> => {
  const child = spawn(process.execPath, ['--experimental-strip-types', 'src/server/main.ts'], {
    cwd: new URL('../../', import.meta.url),
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout?.on('data', (chunk: Buffer) => { output += chunk.toString(); });
  child.stderr?.on('data', (chunk: Buffer) => { output += chunk.toString(); });
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    if (output.includes('洞天 server listening')) return child;
    if (child.exitCode !== null || child.signalCode !== null) throw new Error(`server exited before readiness: ${output}`);
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  await stopChild(child);
  throw new Error(`server readiness timed out: ${output}`);
};

const request = async (url: string, token: string, init: RequestInit = {}): Promise<{ status: number; body: Record<string, unknown>; text: string }> => {
  const response = await fetch(url, { ...init, headers: { authorization: `Bearer ${token}`, ...(init.headers ?? {}) } });
  const text = await response.text();
  let body: Record<string, unknown> = {};
  try { body = JSON.parse(text) as Record<string, unknown>; } catch { /* metrics is plain text */ }
  return { status: response.status, body, text };
};

const successMetric = (text: string): number => {
  const match = text.match(/dongtian_settlements_total\{outcome="success"\} ([0-9.]+)/);
  if (!match) throw new Error(`success metric is missing: ${text}`);
  return Number(match[1]);
};

test('real server process kill/restart restores PostgreSQL state and durable metrics', integrationOptions, async () => {
  const pool = new Pool({ connectionString: databaseUrl, max: 4 });
  const playerId = randomUUID();
  const instanceId = `process-restart-${randomUUID()}`;
  const token = tokenFor(playerId);
  const port = await freePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  let first: ChildProcess | undefined;
  let second: ChildProcess | undefined;
  try {
    await applyMigrations(pool);
    const childEnv: NodeJS.ProcessEnv = {
      ...process.env,
      DATABASE_URL: databaseUrl,
      DONGTIAN_JWT_SECRET: jwtSecret,
      DONGTIAN_ALLOW_STATIC_CONFIG: '1',
      DONGTIAN_METRICS_BACKEND: 'postgres',
      DONGTIAN_METRICS_INSTANCE_ID: instanceId,
      DONGTIAN_ALLOW_INSECURE_BEARER_TOKEN: undefined,
      DONGTIAN_BOOTSTRAP_PLAYER: playerId,
      PORT: String(port),
    };
    first = await startChild(childEnv);
    const initial = await request(`${baseUrl}/v1/bootstrap`, token);
    assert.equal(initial.status, 200, initial.text);
    const initialData = initial.body.data as { player: { lastSettledAt: string; stateRevision: number } };
    const initialMetricResponse = await request(`${baseUrl}/metrics`, token);
    assert.equal(initialMetricResponse.status, 200);
    const baselineSuccess = successMetric(initialMetricResponse.text);

    const started = await request(`${baseUrl}/v1/actions/start`, token, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'idempotency-key': `process-start-${randomUUID()}` },
      body: JSON.stringify({ actionId: 'training', expectedRevision: initialData.player.stateRevision }),
    });
    assert.equal(started.status, 200);
    const startedStateRevision = Number(started.body.stateRevision);
    await new Promise((resolve) => setTimeout(resolve, 100));
    const endedAt = new Date(Date.parse(String(started.body.serverTime)) + 10).toISOString();
    const settlementId = randomUUID();
    const settled = await request(`${baseUrl}/v1/settlements/offline`, token, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'idempotency-key': settlementId },
      body: JSON.stringify({ settlementId, requestedStartedAt: initialData.player.lastSettledAt, requestedEndedAt: endedAt, expectedRevision: startedStateRevision }),
    });
    assert.equal(settled.status, 200, settled.text);

    let afterMetric = baselineSuccess;
    for (let attempt = 0; attempt < 20 && afterMetric < baselineSuccess + 1; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 50));
      afterMetric = successMetric((await request(`${baseUrl}/metrics`, token)).text);
    }
    assert.equal(afterMetric, baselineSuccess + 1);
    await stopChild(first);
    first = undefined;

    // The second process uses a new pool and a different port so the old
    // process cannot mask a failed restart.
    const restartPort = await freePort();
    second = await startChild({ ...childEnv, DONGTIAN_BOOTSTRAP_PLAYER: undefined, PORT: String(restartPort) });
    const effectiveUrl = `http://127.0.0.1:${restartPort}`;
    const restarted = await request(`${effectiveUrl}/v1/bootstrap`, token);
    assert.equal(restarted.status, 200);
    const restartedData = restarted.body.data as { player: { stateRevision: number; primaryAction: { actionId: string | null } } };
    assert.equal(restartedData.player.stateRevision, startedStateRevision + 1);
    assert.equal(restartedData.player.primaryAction.actionId, 'training');
    const restartedMetric = await request(`${effectiveUrl}/metrics`, token);
    assert.equal(restartedMetric.status, 200);
    assert.equal(successMetric(restartedMetric.text), afterMetric);
  } finally {
    if (first) await stopChild(first);
    if (second) await stopChild(second, 'SIGTERM');
    await pool.query('DELETE FROM metrics_event WHERE instance_id = $1', [instanceId]);
    await pool.query('DELETE FROM audit_event WHERE player_id = $1', [playerId]);
    await pool.query('DELETE FROM action_idempotency WHERE player_id = $1', [playerId]);
    await pool.query('DELETE FROM settlement_record WHERE player_id = $1', [playerId]);
    await pool.query('DELETE FROM dungeon_attempt WHERE player_id = $1', [playerId]);
    await pool.query('DELETE FROM building_job WHERE player_id = $1', [playerId]);
    await pool.query('DELETE FROM building_state WHERE player_id = $1', [playerId]);
    await pool.query('DELETE FROM inventory_resource WHERE player_id = $1', [playerId]);
    await pool.query('DELETE FROM equipment_instance WHERE player_id = $1', [playerId]);
    await pool.query('DELETE FROM collection_state WHERE player_id = $1', [playerId]);
    await pool.query('DELETE FROM progress_state WHERE player_id = $1', [playerId]);
    await pool.query('DELETE FROM player_state WHERE player_id = $1', [playerId]);
    await pool.end();
  }
});
