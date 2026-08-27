import assert from 'node:assert/strict';
import test from 'node:test';
import { createGameHttpServer } from './http.ts';
import { MemoryRepository } from './repository.ts';
import { GameService } from './service.ts';
import type { HealthChecks } from './health.ts';

const withServer = async (service: GameService, healthChecks: HealthChecks, run: (baseUrl: string) => Promise<void>): Promise<void> => {
  const server = createGameHttpServer(service, { healthChecks });
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('server did not bind');
  try { await run(`http://127.0.0.1:${address.port}`); }
  finally { await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())); }
};

test('healthz is unauthenticated and does not disclose configuration or secrets', async () => {
  await withServer(new GameService(new MemoryRepository()), {}, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/healthz`, { headers: { authorization: 'Bearer do-not-echo-this-secret' } });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.deepEqual(await response.json(), { status: 'ok' });
    assert.equal(await (await fetch(`${baseUrl}/v1/bootstrap`)).status, 400);
  });
});

test('readyz reports all dependency states without leaking check errors', async () => {
  const secret = 'postgresql://game:super-secret@db.example/dongtian';
  await withServer(new GameService(new MemoryRepository()), {
    database: async () => true,
    config: async () => true,
    scanner: async () => true,
  }, async (baseUrl) => {
    const ready = await fetch(`${baseUrl}/readyz`);
    const text = await ready.text();
    assert.equal(ready.status, 200);
    assert.equal(ready.headers.get('cache-control'), 'no-store');
    assert.deepEqual(JSON.parse(text), { status: 'ok', checks: { database: 'up', config: 'up', scanner: 'up' } });
    assert.equal(text.includes(secret), false);
  });
});

test('readyz fails closed when a dependency is missing, false, throws, or times out', async () => {
  await withServer(new GameService(new MemoryRepository()), {
    database: async () => { throw new Error('password=super-secret'); },
    config: () => false,
    // scanner omitted intentionally: required dependencies are fail-closed.
  }, async (baseUrl) => {
    const notReady = await fetch(`${baseUrl}/readyz`);
    assert.equal(notReady.status, 503);
    assert.deepEqual(await notReady.json(), { status: 'not_ready', checks: { database: 'down', config: 'down', scanner: 'down' } });
  });
  const server = createGameHttpServer(new GameService(new MemoryRepository()), {
    healthChecks: {
      database: () => new Promise<boolean>(() => undefined),
      config: () => true,
      scanner: () => true,
    },
    healthCheckTimeoutMs: 20,
  });
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('server did not bind');
  try {
    const startedAt = Date.now();
    const notReady = await fetch(`http://127.0.0.1:${address.port}/readyz`);
    assert.equal(notReady.status, 503);
    assert.ok(Date.now() - startedAt < 2_000);
    assert.deepEqual((await notReady.json() as { checks: Record<string, string> }).checks, { database: 'down', config: 'up', scanner: 'up' });
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});
