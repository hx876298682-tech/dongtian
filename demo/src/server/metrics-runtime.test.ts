import assert from 'node:assert/strict';
import { createHmac, randomUUID } from 'node:crypto';
import test from 'node:test';
import { Pool } from 'pg';
import { createGameHttpServer } from './http.ts';
import { applyMigrations } from './migrations.ts';
import { MetricsCollector } from './metrics.ts';
import { PostgresMetricsStore } from './metrics-postgres.ts';
import { MemoryRepository } from './repository.ts';
import { GameService } from './service.ts';

const base = new Date('2026-08-25T00:00:00.000Z');
const at = (seconds: number): Date => new Date(base.getTime() + seconds * 1000);
const jwtPart = (value: unknown): string => Buffer.from(JSON.stringify(value)).toString('base64url');
const tokenFor = (claims: Record<string, unknown>, secret: string): string => {
  const header = jwtPart({ alg: 'HS256', typ: 'JWT' });
  const payload = jwtPart(claims);
  return `${header}.${payload}.${createHmac('sha256', secret).update(`${header}.${payload}`).digest('base64url')}`;
};

test('durable metric writes are fire-and-forget and flushable without changing sync collector behavior', async () => {
  const local = new MetricsCollector({ clock: () => base.getTime() });
  const resolveWrites: Array<() => void> = [];
  let writes = 0;
  const sink = {
    record: async () => {
      writes += 1;
      await new Promise<void>((resolve) => { resolveWrites.push(resolve); });
    },
    toPrometheus: async () => 'durable-view\n',
  };
  const service = new GameService(new MemoryRepository(), () => base, undefined, undefined, local, undefined, sink);
  const playerId = 'metrics-runtime-player';
  await service.createPlayer(playerId, base);
  await service.startAction({ playerId, actionId: 'training', expectedRevision: 0, now: base });

  const settlement = await Promise.race([
    service.offlineSettlement({ playerId, settlementId: 'metrics-runtime-settlement', requestedStartedAt: base.toISOString(), requestedEndedAt: at(60).toISOString(), expectedRevision: 1, now: at(60) }),
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error('telemetry write blocked gameplay request')), 250)),
  ]);
  assert.equal(settlement.data.settlementId, 'metrics-runtime-settlement');
  // The settlement emits one durable reservation event and one committed
  // success event; both remain fire-and-forget from the gameplay request.
  assert.equal(writes, 2);
  assert.equal(local.snapshot().settlements.success, 1);
  assert.equal(await service.metricsPrometheusAsync(), 'durable-view\n');

  const flushed = service.flushMetrics();
  for (const resolveWrite of resolveWrites) resolveWrite();
  await flushed;
});

test('metrics scrape falls back to memory when the durable backend is unavailable', async () => {
  const local = new MetricsCollector({ clock: () => base.getTime() });
  local.record({ type: 'settlement_success', durationMs: 10, at: base });
  const service = new GameService(new MemoryRepository(), () => base, undefined, undefined, local, undefined, {
    record: async () => { throw new Error('database unavailable'); },
    toPrometheus: async () => { throw new Error('database unavailable'); },
  });
  const output = await service.metricsPrometheusAsync();
  assert.match(output, /dongtian_settlements_total\{outcome="success"\} 1/);
});

test('metrics endpoint can require an admin JWT without affecting the normal auth boundary', { concurrency: false }, async () => {
  const previousSecret = process.env.DONGTIAN_JWT_SECRET;
  const previousGate = process.env.DONGTIAN_METRICS_REQUIRE_ADMIN;
  process.env.DONGTIAN_JWT_SECRET = 'metrics-runtime-test-secret';
  process.env.DONGTIAN_METRICS_REQUIRE_ADMIN = '1';
  const service = new GameService(new MemoryRepository(), () => base, undefined, undefined, new MetricsCollector());
  const server = createGameHttpServer(service);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('server did not bind');
  try {
    const url = `http://127.0.0.1:${address.port}/metrics`;
    const player = await fetch(url, { headers: { authorization: `Bearer ${tokenFor({ sub: 'metrics-player' }, process.env.DONGTIAN_JWT_SECRET)}` } });
    assert.equal(player.status, 403);
    const admin = await fetch(url, { headers: { authorization: `Bearer ${tokenFor({ sub: 'metrics-admin', roles: ['admin'] }, process.env.DONGTIAN_JWT_SECRET)}` } });
    assert.equal(admin.status, 200);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    if (previousSecret === undefined) delete process.env.DONGTIAN_JWT_SECRET; else process.env.DONGTIAN_JWT_SECRET = previousSecret;
    if (previousGate === undefined) delete process.env.DONGTIAN_METRICS_REQUIRE_ADMIN; else process.env.DONGTIAN_METRICS_REQUIRE_ADMIN = previousGate;
  }
});

test('HTTP metrics uses the shared PostgreSQL sink across service instances', { skip: !process.env.DATABASE_URL, concurrency: false }, async () => {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 4 });
  const previousAuth = process.env.DONGTIAN_ALLOW_INSECURE_BEARER_TOKEN;
  process.env.DONGTIAN_ALLOW_INSECURE_BEARER_TOKEN = '1';
  try {
    await applyMigrations(pool);
    const firstInstance = `runtime-http-a-${randomUUID()}`;
    const secondInstance = `runtime-http-b-${randomUUID()}`;
    const firstStore = new PostgresMetricsStore(pool, { instanceId: firstInstance });
    const secondStore = new PostgresMetricsStore(pool, { instanceId: secondInstance });
    const baseline = (await firstStore.snapshot()).settlements.success;
    const first = new GameService(new MemoryRepository(), () => base, undefined, undefined, new MetricsCollector(), undefined, firstStore);
    const second = new GameService(new MemoryRepository(), () => base, undefined, undefined, new MetricsCollector(), undefined, secondStore);
    await first.createPlayer('runtime-http-player-a', base);
    await second.createPlayer('runtime-http-player-b', base);
    await first.startAction({ playerId: 'runtime-http-player-a', actionId: 'training', expectedRevision: 0, now: base });
    await second.startAction({ playerId: 'runtime-http-player-b', actionId: 'training', expectedRevision: 0, now: base });
    await first.offlineSettlement({ playerId: 'runtime-http-player-a', settlementId: 'runtime-http-settlement-a', requestedStartedAt: base.toISOString(), requestedEndedAt: at(60).toISOString(), expectedRevision: 1, now: at(60) });
    await second.offlineSettlement({ playerId: 'runtime-http-player-b', settlementId: 'runtime-http-settlement-b', requestedStartedAt: base.toISOString(), requestedEndedAt: at(60).toISOString(), expectedRevision: 1, now: at(60) });
    await Promise.all([first.flushMetrics(), second.flushMetrics()]);

    const server = createGameHttpServer(second);
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('server did not bind');
    try {
      const response = await fetch(`http://127.0.0.1:${address.port}/metrics`, { headers: { authorization: 'Bearer metrics-scraper' } });
      assert.equal(response.status, 200);
      assert.match(await response.text(), new RegExp(`dongtian_settlements_total\\{outcome="success"\\} ${baseline + 2}(?:\\.0)?(?:\\n|$)`));
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  } finally {
    // Keep this test safe when the broader integration suite uses the same
    // database concurrently; only remove the two unique instance streams.
    await pool.query('DELETE FROM metrics_event WHERE instance_id LIKE $1 OR instance_id LIKE $2', ['runtime-http-a-%', 'runtime-http-b-%']);
    await pool.end();
    if (previousAuth === undefined) delete process.env.DONGTIAN_ALLOW_INSECURE_BEARER_TOKEN;
    else process.env.DONGTIAN_ALLOW_INSECURE_BEARER_TOKEN = previousAuth;
  }
});
