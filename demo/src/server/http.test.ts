import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import test from 'node:test';
import { request as httpRequest } from 'node:http';
import { createGameHttpServer, DEFAULT_HTTP_MAX_BODY_BYTES, MAX_HTTP_MAX_BODY_BYTES, readHttpMaxBodyBytes } from './http.ts';
import { MemoryRepository } from './repository.ts';
import { GameService } from './service.ts';
import { MetricsCollector } from './metrics.ts';
import { ConfigReleaseError, StaticConfigReleaseProvider } from './config-release.ts';
import type { ConfigRelease, ConfigReleaseProvider, ConfigReleaseSnapshot } from './config-release.ts';
import { CONTENT_PACKAGE } from '../content/content-schema.ts';
import { FROZEN_PARAMETER_SHA256, FROZEN_PARAMETERS } from '../game/frozen-parameters.ts';

const encodeJwtPart = (value: unknown): string => Buffer.from(JSON.stringify(value)).toString('base64url');
const adminToken = (claims: Record<string, unknown>): string => {
  const header = encodeJwtPart({ alg: 'HS256', typ: 'JWT' });
  const payload = encodeJwtPart(claims);
  const signature = createHmac('sha256', 'http-admin-secret').update(`${header}.${payload}`).digest('base64url');
  return `${header}.${payload}.${signature}`;
};
class HttpAdminReleaseProvider implements ConfigReleaseProvider {
  active: ConfigReleaseSnapshot;
  readonly known = new Set(['1.0.0-frozen', '1.0.1-next']);
  constructor(snapshot: ConfigReleaseSnapshot) { this.active = structuredClone(snapshot); }
  getActiveSnapshot(): ConfigReleaseSnapshot { return structuredClone(this.active); }
  async refresh(): Promise<ConfigReleaseSnapshot> { return this.getActiveSnapshot(); }
  private release(version: string): ConfigRelease { return { version, parameterSha256: FROZEN_PARAMETER_SHA256, contentSha256: CONTENT_PACKAGE.manifest.content_sha256, status: 'active', canaryPercent: 100, createdAt: new Date(0).toISOString(), validatedAt: new Date(0).toISOString(), activatedAt: new Date(0).toISOString(), rolledBackAt: null, transitionReason: 'manual', content: { ...CONTENT_PACKAGE, manifest: { ...CONTENT_PACKAGE.manifest, config_version: version } }, parameters: FROZEN_PARAMETERS }; }
  async startCanary(version: string): Promise<ConfigRelease> { if (!this.known.has(version)) throw new ConfigReleaseError('RELEASE_NOT_FOUND', `release does not exist: ${version}`); return this.release(version); }
  async activate(version: string): Promise<ConfigRelease> { if (!this.known.has(version)) throw new ConfigReleaseError('RELEASE_NOT_FOUND', `release does not exist: ${version}`); this.active = { ...this.active, version, content: { ...this.active.content, manifest: { ...this.active.content.manifest, config_version: version } } }; return this.release(version); }
  async rollback(version: string): Promise<ConfigRelease> { return this.activate(version); }
}

// Existing adapter tests exercise the explicit local-only development fallback.
process.env.DONGTIAN_ALLOW_INSECURE_PLAYER_HEADER = '1';
process.env.DONGTIAN_ALLOW_INSECURE_BEARER_TOKEN = '1';

test('HTTP body limit defaults safely and validates the deployment override', () => {
  assert.equal(readHttpMaxBodyBytes({}), DEFAULT_HTTP_MAX_BODY_BYTES);
  assert.equal(readHttpMaxBodyBytes({ DONGTIAN_HTTP_MAX_BODY_BYTES: '4096' }), 4096);
  assert.throws(() => readHttpMaxBodyBytes({ DONGTIAN_HTTP_MAX_BODY_BYTES: '0' }), /DONGTIAN_HTTP_MAX_BODY_BYTES/);
  assert.throws(() => readHttpMaxBodyBytes({ DONGTIAN_HTTP_MAX_BODY_BYTES: String(MAX_HTTP_MAX_BODY_BYTES + 1) }), /DONGTIAN_HTTP_MAX_BODY_BYTES/);
  assert.throws(() => readHttpMaxBodyBytes({ DONGTIAN_HTTP_MAX_BODY_BYTES: '1.5' }), /DONGTIAN_HTTP_MAX_BODY_BYTES/);
});

test('HTTP action catalog exposes frozen targets and labels proposal targets without mutating player state', async () => {
  const repository = new MemoryRepository();
  const service = new GameService(repository);
  const playerId = 'http-action-catalog';
  await service.createPlayer(playerId, new Date('2026-08-26T00:00:00.000Z'));
  const server = createGameHttpServer(service);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('server did not bind');
  try {
    const response = await fetch(`http://127.0.0.1:${address.port}/v1/action-catalog`, { headers: { 'x-player-id': playerId } });
    assert.equal(response.status, 200);
    const payload = await response.json() as { stateRevision: number; data: { schemaVersion: string; actionModel: string; actions: Array<{ actionId: string; status: string }>; techniques: Array<{ id: string }>; recipes: Array<{ id: string }>; maps: Array<{ id: string; unlocked: boolean }>; gatheringMaps: Array<{ id: string; status: string }> } };
    assert.equal(payload.stateRevision, 0);
    assert.equal(payload.data.schemaVersion, 'action_catalog_v1');
    assert.equal(payload.data.actionModel, 'global_single_slot_v1');
    assert.ok(payload.data.techniques.some((entry) => entry.id === 'technique.mortal.qing_mu_chang_sheng'));
    assert.ok(payload.data.recipes.some((entry) => entry.id === 'alchemy_basic'));
    assert.ok(payload.data.maps.some((entry) => entry.id === 'bai_cao_valley' && entry.unlocked));
    assert.deepEqual(payload.data.gatheringMaps.map((entry) => entry.status), ['proposal_v1', 'proposal_v1']);
    assert.equal((await repository.getPlayer(playerId)).stateRevision, 0);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});

test('HTTP action route starts production sequences and replaces the previous sequence', async () => {
  const repository = new MemoryRepository();
  const service = new GameService(repository);
  const playerId = 'http-single-slot-production';
  const base = new Date('2026-08-26T00:00:00.000Z');
  await service.createPlayer(playerId, base);
  const server = createGameHttpServer(service);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('server did not bind');
  const url = `http://127.0.0.1:${address.port}`;
  const headers = { 'x-player-id': playerId, 'content-type': 'application/json' };
  try {
    const alchemy = await fetch(`${url}/v1/actions/start`, { method: 'POST', headers: { ...headers, 'idempotency-key': 'http-single-slot-alchemy' }, body: JSON.stringify({ actionId: 'alchemy_basic', expectedRevision: 0 }) });
    assert.equal(alchemy.status, 200);
    const alchemyPayload = await alchemy.json() as { stateRevision: number; data: { actionId: string } };
    assert.equal(alchemyPayload.data.actionId, 'alchemy_basic');

    const forge = await fetch(`${url}/v1/actions/start`, { method: 'POST', headers: { ...headers, 'x-expected-revision': String(alchemyPayload.stateRevision), 'idempotency-key': 'http-single-slot-forge' }, body: JSON.stringify({ actionId: 'forge_basic', expectedRevision: alchemyPayload.stateRevision }) });
    assert.equal(forge.status, 200);
    const forgePayload = await forge.json() as { stateRevision: number; data: { actionId: string } };
    assert.equal(forgePayload.data.actionId, 'forge_basic');
    const player = await repository.getPlayer(playerId);
    assert.equal(player.primaryAction.actionId, 'forge_basic');
    assert.equal(player.primaryAction.modelVersion, 'global_single_slot_v1');
    assert.equal(player.cultivationXp, 0);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((closeError) => closeError ? reject(closeError) : resolve()));
  }
});

test('HTTP spirit farm plant route persists a crop without occupying the action slot', async () => {
  const repository = new MemoryRepository();
  const service = new GameService(repository);
  const playerId = 'http-spirit-farm-plant';
  const plantedAt = new Date();
  await service.createPlayer(playerId, plantedAt);
  const server = createGameHttpServer(service);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('server did not bind');
  const url = `http://127.0.0.1:${address.port}`;
  const headers = { 'x-player-id': playerId, 'content-type': 'application/json' };
  try {
    const plant = await fetch(`${url}/v1/buildings/spirit_farm/plant`, { method: 'POST', headers: { ...headers, 'idempotency-key': 'http-plant-1' }, body: JSON.stringify({ plots: 2, expectedRevision: 0 }) });
    assert.equal(plant.status, 200);
    const payload = await plant.json() as { stateRevision: number; data: { buildingId: string; plots: number; plantedAt: string; matureAt: string } };
    assert.equal(payload.stateRevision, 1);
    assert.equal(payload.data.buildingId, 'spirit_farm');
    assert.equal(payload.data.plots, 2);
    assert.ok(new Date(payload.data.matureAt).getTime() > new Date(payload.data.plantedAt).getTime());

    const action = await fetch(`${url}/v1/actions/start`, { method: 'POST', headers: { ...headers, 'x-expected-revision': '1', 'idempotency-key': 'http-farm-training' }, body: JSON.stringify({ actionId: 'training', expectedRevision: 1 }) });
    assert.equal(action.status, 200);
    const player = await repository.getPlayer(playerId);
    assert.equal(player.primaryAction.actionId, 'training');
    assert.equal(player.buildings.spirit_farm.plantedPlots, 2);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((closeError) => closeError ? reject(closeError) : resolve()));
  }
});

test('HTTP spirit farm plot route plants one independent plot', async () => {
  const repository = new MemoryRepository();
  const service = new GameService(repository);
  const playerId = 'http-spirit-farm-plot';
  await service.createPlayer(playerId, new Date('2026-08-26T00:00:00.000Z'));
  const server = createGameHttpServer(service);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('server did not bind');
  try {
    const response = await fetch(`http://127.0.0.1:${address.port}/v1/buildings/spirit_farm/plots/plot_1/plant`, { method: 'POST', headers: { 'x-player-id': playerId, 'content-type': 'application/json', 'idempotency-key': 'http-plot-1' }, body: JSON.stringify({ plantId: 'spirit_lotus', expectedRevision: 0 }) });
    assert.equal(response.status, 200);
    const payload = await response.json() as { data: { buildingId: string; plotId: string; plantId: string; plantedAt: string; matureAt: string } };
    assert.equal(payload.data.buildingId, 'spirit_farm');
    assert.equal(payload.data.plotId, 'plot_1');
    assert.equal(payload.data.plantId, 'spirit_lotus');
    assert.ok(new Date(payload.data.matureAt).getTime() > new Date(payload.data.plantedAt).getTime());
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});

test('HTTP exposes current random event state without mutating an uninitialized player', async () => {
  const repository = new MemoryRepository();
  const service = new GameService(repository);
  const playerId = 'http-random-event-current-player';
  await service.createPlayer(playerId, new Date());
  const server = createGameHttpServer(service);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('server did not bind');
  try {
    const response = await fetch(`http://127.0.0.1:${address.port}/v1/random-events/current`, { headers: { 'x-player-id': playerId } });
    assert.equal(response.status, 200);
    const payload = await response.json() as { data: { mode: string; window: unknown } };
    assert.equal(payload.data.mode, 'uninitialized');
    assert.equal(payload.data.window, null);
    assert.equal((await repository.getPlayer(playerId)).stateRevision, 0);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});

test('HTTP rejects oversized declared and chunked request bodies with 413 before service mutation', async () => {
  const repository = new MemoryRepository();
  const service = new GameService(repository);
  const playerId = 'http-body-limit-player';
  await service.createPlayer(playerId, new Date());
  const server = createGameHttpServer(service, { maxBodyBytes: 32 });
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('server did not bind');
  const url = `http://127.0.0.1:${address.port}/v1/actions/start`;
  const headers = { 'x-player-id': playerId, 'content-type': 'application/json' };
  const declared = await fetch(url, { method: 'POST', headers, body: JSON.stringify({ actionId: 'training', expectedRevision: 0 }) });
  assert.equal(declared.status, 413);
  assert.equal((await declared.json() as { error: { code: string; details: { maxBytes: number } } }).error.code, 'REQUEST_BODY_TOO_LARGE');
  assert.equal((await repository.getPlayer(playerId)).stateRevision, 0);

  const chunked = await new Promise<{ status: number; payload: { error: { code: string; details: { maxBytes: number } } } }>((resolve, reject) => {
    const request = httpRequest(url, { method: 'POST', headers }, (response) => {
      const chunks: Buffer[] = [];
      response.on('data', (chunk: Buffer) => chunks.push(chunk));
      response.on('end', () => resolve({ status: response.statusCode ?? 0, payload: JSON.parse(Buffer.concat(chunks).toString('utf8')) }));
    });
    request.on('error', reject);
    request.write('{"actionId":"training",');
    request.end('"expectedRevision":0}');
  });
  assert.equal(chunked.status, 413);
  assert.equal(chunked.payload.error.code, 'REQUEST_BODY_TOO_LARGE');
  assert.equal(chunked.payload.error.details.maxBytes, 32);
  assert.equal((await repository.getPlayer(playerId)).stateRevision, 0);
  await new Promise<void>((resolve, reject) => server.close((closeError) => closeError ? reject(closeError) : resolve()));
});

test('HTTP adapter requires Bearer authentication unless the explicit development fallback is enabled', async () => {
  const service = new GameService(new MemoryRepository());
  const playerId = 'http-auth-player';
  await service.createPlayer(playerId, new Date());
  const server = createGameHttpServer(service);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('server did not bind');
  const url = `http://127.0.0.1:${address.port}/v1/bootstrap`;
  const previous = process.env.DONGTIAN_ALLOW_INSECURE_PLAYER_HEADER;
  delete process.env.DONGTIAN_ALLOW_INSECURE_PLAYER_HEADER;
  try {
    const missing = await fetch(url, { headers: { 'x-player-id': playerId } });
    assert.equal(missing.status, 400);
    assert.equal((await missing.json() as { error: { code: string } }).error.code, 'AUTH_REQUIRED');

    const malformed = await fetch(url, { headers: { authorization: `Basic ${playerId}` } });
    assert.equal(malformed.status, 400);
    assert.equal((await malformed.json() as { error: { code: string } }).error.code, 'AUTH_REQUIRED');

    const authenticated = await fetch(url, { headers: { authorization: `Bearer ${playerId}` } });
    assert.equal(authenticated.status, 200);
    assert.equal((await authenticated.json() as { data: { player: { playerId: string } } }).data.player.playerId, playerId);
  } finally {
    if (previous === undefined) delete process.env.DONGTIAN_ALLOW_INSECURE_PLAYER_HEADER;
    else process.env.DONGTIAN_ALLOW_INSECURE_PLAYER_HEADER = previous;
    await new Promise<void>((resolve, reject) => server.close((closeError) => closeError ? reject(closeError) : resolve()));
  }
});

test('HTTP player requests use the shared provider canary bucket and bind response configVersion', async () => {
  const active: ConfigReleaseSnapshot = { version: '1.0.20-active', parameterSha256: FROZEN_PARAMETER_SHA256, contentSha256: CONTENT_PACKAGE.manifest.content_sha256, content: { ...CONTENT_PACKAGE, manifest: { ...CONTENT_PACKAGE.manifest, config_version: '1.0.20-active' } }, parameters: FROZEN_PARAMETERS };
  const canary: ConfigReleaseSnapshot = { version: '1.0.21-canary', parameterSha256: FROZEN_PARAMETER_SHA256, contentSha256: CONTENT_PACKAGE.manifest.content_sha256, content: { ...CONTENT_PACKAGE, manifest: { ...CONTENT_PACKAGE.manifest, config_version: '1.0.21-canary' } }, parameters: FROZEN_PARAMETERS, migrationPolicy: { mode: 'identity', fromVersions: ['1.0.20-active'] } };
  const provider: ConfigReleaseProvider = {
    getActiveSnapshot: () => structuredClone(active),
    getSnapshotForPlayer: (_playerId) => structuredClone(canary),
    getSnapshot: (version) => version === active.version ? structuredClone(active) : version === canary.version ? structuredClone(canary) : null,
  };
  const repository = new MemoryRepository();
  const service = new GameService(repository, () => new Date('2026-01-01T00:00:00.000Z'), undefined, undefined, undefined, provider);
  const playerId = 'http-canary-player';
  await service.createPlayer(playerId, new Date('2026-01-01T00:00:00.000Z'));
  const server = createGameHttpServer(service);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('server did not bind');
  try {
    const headers = { 'x-player-id': playerId };
    const first = await fetch(`http://127.0.0.1:${address.port}/v1/bootstrap`, { headers });
    const second = await fetch(`http://127.0.0.1:${address.port}/v1/bootstrap`, { headers });
    assert.equal(first.status, 200);
    assert.equal(second.status, 200);
    const firstPayload = await first.json() as { configVersion: string; data: { player: { configVersion: string } } };
    const secondPayload = await second.json() as { configVersion: string; data: { player: { configVersion: string } } };
    assert.equal(firstPayload.configVersion, '1.0.21-canary');
    assert.equal(firstPayload.data.player.configVersion, '1.0.21-canary');
    assert.equal(secondPayload.configVersion, firstPayload.configVersion);
    const staleHeader = await fetch(`http://127.0.0.1:${address.port}/v1/bootstrap`, { headers: { ...headers, 'x-config-version': '1.0.20-active' } });
    assert.equal(staleHeader.status, 400);
    assert.equal((await staleHeader.json() as { error: { code: string } }).error.code, 'CONFIG_VERSION_MISMATCH');
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});

test('HTTP admin config refresh requires admin role and never returns parameters', async () => {
  const previousSecret = process.env.DONGTIAN_JWT_SECRET;
  process.env.DONGTIAN_JWT_SECRET = 'http-admin-secret';
  const snapshot = { version: '1.0.0-frozen', parameterSha256: FROZEN_PARAMETER_SHA256, contentSha256: CONTENT_PACKAGE.manifest.content_sha256, content: CONTENT_PACKAGE, parameters: FROZEN_PARAMETERS };
  const service = new GameService(new MemoryRepository(), () => new Date('2026-01-01T00:00:00.000Z'), undefined, undefined, undefined, new StaticConfigReleaseProvider(snapshot));
  const server = createGameHttpServer(service);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('server did not bind');
  const url = `http://127.0.0.1:${address.port}/v1/admin/config/refresh`;
  try {
    const ordinary = await fetch(url, { method: 'POST', headers: { authorization: `Bearer ${adminToken({ sub: 'operator-1', roles: ['operator'] })}` } });
    assert.equal(ordinary.status, 403);
    assert.equal((await ordinary.json() as { error: { code: string } }).error.code, 'FORBIDDEN');
    const admin = await fetch(url, { method: 'POST', headers: { authorization: `Bearer ${adminToken({ sub: 'admin-1', role: 'admin' })}` } });
    assert.equal(admin.status, 200);
    const payload = await admin.json() as { configVersion: string; data: { configVersion: string }; parameterSha256?: string };
    assert.equal(payload.configVersion, '1.0.0-frozen');
    assert.equal(payload.data.configVersion, '1.0.0-frozen');
    assert.equal('parameterSha256' in payload, false);
    assert.equal(JSON.stringify(payload).includes('growth.'), false);
  } finally {
    if (previousSecret === undefined) delete process.env.DONGTIAN_JWT_SECRET; else process.env.DONGTIAN_JWT_SECRET = previousSecret;
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});

test('HTTP admin refresh fails safely when release provider is not configured', async () => {
  const previousSecret = process.env.DONGTIAN_JWT_SECRET;
  process.env.DONGTIAN_JWT_SECRET = 'http-admin-secret';
  const service = new GameService(new MemoryRepository());
  const server = createGameHttpServer(service);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('server did not bind');
  try {
    const response = await fetch(`http://127.0.0.1:${address.port}/v1/admin/config/refresh`, { method: 'POST', headers: { authorization: `Bearer ${adminToken({ sub: 'admin-2', roles: ['admin'] })}` } });
    assert.equal(response.status, 400);
    const payload = await response.json() as { error: { code: string }; parameters?: unknown };
    assert.equal(payload.error.code, 'CONFIG_VERSION_MISMATCH');
    assert.equal('parameters' in payload, false);
  } finally {
    if (previousSecret === undefined) delete process.env.DONGTIAN_JWT_SECRET; else process.env.DONGTIAN_JWT_SECRET = previousSecret;
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});

test('HTTP config release lifecycle endpoints enforce admin, reason, version and idempotency boundaries', async () => {
  const previousSecret = process.env.DONGTIAN_JWT_SECRET;
  process.env.DONGTIAN_JWT_SECRET = 'http-admin-secret';
  const snapshot: ConfigReleaseSnapshot = { version: '1.0.0-frozen', parameterSha256: FROZEN_PARAMETER_SHA256, contentSha256: CONTENT_PACKAGE.manifest.content_sha256, content: CONTENT_PACKAGE, parameters: FROZEN_PARAMETERS };
  const service = new GameService(new MemoryRepository(), () => new Date('2026-01-01T00:00:00.000Z'), undefined, undefined, undefined, new HttpAdminReleaseProvider(snapshot));
  const server = createGameHttpServer(service);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('server did not bind');
  const url = `http://127.0.0.1:${address.port}/v1/admin/config`;
  const headers = { authorization: `Bearer ${adminToken({ sub: 'admin-3', roles: ['admin'] })}`, 'content-type': 'application/json', 'idempotency-key': 'release-op-1' };
  try {
    const forbidden = await fetch(`${url}/activate`, { method: 'POST', headers: { authorization: `Bearer ${adminToken({ sub: 'operator-2', roles: ['operator'] })}`, 'content-type': 'application/json' }, body: JSON.stringify({ version: '1.0.1-next', reason: 'promote canary' }) });
    assert.equal(forbidden.status, 403);
    const invalidReason = await fetch(`${url}/activate`, { method: 'POST', headers, body: JSON.stringify({ version: '1.0.1-next', reason: 'x' }) });
    assert.equal(invalidReason.status, 400);
    assert.equal((await invalidReason.json() as { error: { code: string } }).error.code, 'VALIDATION_FAILED');
    const invalidVersion = await fetch(`${url}/activate`, { method: 'POST', headers, body: JSON.stringify({ version: 'missing', reason: 'promote release' }) });
    assert.equal(invalidVersion.status, 400);
    const canary = await fetch(`${url}/canary`, { method: 'POST', headers: { ...headers, 'idempotency-key': 'release-canary-1' }, body: JSON.stringify({ version: '1.0.1-next', canaryPercent: 25, reason: 'start canary' }) });
    assert.equal(canary.status, 200);
    const activated = await fetch(`${url}/activate`, { method: 'POST', headers, body: JSON.stringify({ version: '1.0.1-next', reason: 'promote canary' }) });
    assert.equal(activated.status, 200);
    const repeated = await fetch(`${url}/activate`, { method: 'POST', headers: { ...headers, 'x-request-id': 'different' }, body: JSON.stringify({ version: '1.0.1-next', reason: 'different reason' }) });
    assert.equal(repeated.status, 200);
    const payload = await activated.json() as { data: { targetVersion: string }; parameters?: unknown };
    assert.equal(payload.data.targetVersion, '1.0.1-next');
    assert.equal('parameters' in payload, false);
  } finally {
    if (previousSecret === undefined) delete process.env.DONGTIAN_JWT_SECRET; else process.env.DONGTIAN_JWT_SECRET = previousSecret;
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});

test('HTTP adapter exposes paginated anonymous leaderboards and rejects invalid queries', async () => {
  const repository = new MemoryRepository();
  const service = new GameService(repository);
  const playerId = 'http-leaderboard-player';
  await service.createPlayer(playerId, new Date('2026-01-01T00:00:00.000Z'));
  await service.createPlayer('http-leaderboard-other-a', new Date('2026-01-01T00:00:00.000Z'));
  await service.createPlayer('http-leaderboard-other-b', new Date('2026-01-01T00:00:00.000Z'));
  await repository.transaction(playerId, 0, { eventType: 'test_leaderboard_seed', payload: {}, at: new Date() }, (draft) => { draft.realmId = 'foundation_establishment'; draft.cultivationXp = 10; });
  await repository.transaction('http-leaderboard-other-a', 0, { eventType: 'test_leaderboard_seed', payload: {}, at: new Date() }, (draft) => { draft.realmId = 'core_formation'; draft.cultivationXp = 20; });
  await repository.transaction('http-leaderboard-other-b', 0, { eventType: 'test_leaderboard_seed', payload: {}, at: new Date() }, (draft) => { draft.realmId = 'tribulation'; draft.cultivationXp = 30; });
  const server = createGameHttpServer(service);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('server did not bind');
  const url = `http://127.0.0.1:${address.port}`;
  const headers = { 'x-player-id': playerId };
  try {
    const response = await fetch(`${url}/v1/leaderboards/realm?limit=2&offset=1`, { headers });
    assert.equal(response.status, 200);
    const payload = await response.json() as { stateRevision: number; data: { type: string; limit: number; offset: number; total: number; entries: Array<{ rank: number; realmId: string }> } };
    assert.equal(payload.stateRevision, 1);
    assert.deepEqual(payload.data, { type: 'realm', limit: 2, offset: 1, total: 3, entries: [{ rank: 2, realmId: 'core_formation', cultivationXp: 20, equipmentCount: 1, combatPower: 2001020 }, { rank: 3, realmId: 'foundation_establishment', cultivationXp: 10, equipmentCount: 1, combatPower: 1001010 }] });
    assert.equal(JSON.stringify(payload).includes('playerId'), false);
    assert.equal((await repository.getPlayer(playerId)).stateRevision, 1);

    for (const path of ['/v1/leaderboards/unknown', '/v1/leaderboards/realm?limit=0', '/v1/leaderboards/realm?limit=101', '/v1/leaderboards/realm?offset=-1', '/v1/leaderboards/realm?offset=100001', '/v1/leaderboards/realm?limit=1.5']) {
      const invalid = await fetch(`${url}${path}`, { headers });
      assert.equal(invalid.status, 400, path);
      assert.equal((await invalid.json() as { error: { code: string } }).error.code, 'VALIDATION_FAILED');
    }
  } finally {
    await new Promise<void>((resolve, reject) => server.close((closeError) => closeError ? reject(closeError) : resolve()));
  }
});

test('HTTP write DTOs reject missing, non-finite and invalid enum values before service mutation', async () => {
  const repository = new MemoryRepository();
  const service = new GameService(repository);
  const playerId = 'http-dto-player';
  await service.createPlayer(playerId, new Date('2026-01-01T00:00:00.000Z'));
  const server = createGameHttpServer(service);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('server did not bind');
  const url = `http://127.0.0.1:${address.port}`;
  const headers = { 'x-player-id': playerId, 'content-type': 'application/json' };
  const post = (path: string, value: unknown, extraHeaders: Record<string, string> = {}) => fetch(`${url}${path}`, { method: 'POST', headers: { ...headers, ...extraHeaders }, body: JSON.stringify(value) });
  const assertValidation = async (response: Response) => {
    assert.equal(response.status, 400);
    assert.equal((await response.json() as { error: { code: string } }).error.code, 'VALIDATION_FAILED');
  };
  try {
    await assertValidation(await post('/v1/actions/start', { action_id: 'training', expected_revision: 0 }));
    await assertValidation(await post('/v1/actions/start', { actionId: 'training', expectedRevision: 0 }));
    assert.equal((await repository.getPlayer(playerId)).stateRevision, 0);
    await assertValidation(await post('/v1/actions/start', { expectedRevision: 0 }));
    await assertValidation(await post('/v1/actions/start', { actionId: 'training', expectedRevision: null }));
    await assertValidation(await post('/v1/actions/start', { actionId: 'training', expectedRevision: 0 }, { 'x-expected-revision': 'NaN' }));
    await assertValidation(await post('/v1/actions/start', { actionId: 'training', expectedRevision: 0, seed: 1 }));
    await assertValidation(await post('/v1/actions/start', { actionId: 'training', expectedRevision: 0 }, { 'x-expected-revision': '1' }));
    await assertValidation(await post('/v1/actions/start', { actionId: 'training', expectedRevision: 0 }, { 'idempotency-key': 'x'.repeat(513) }));
    await assertValidation(await post('/v1/buildings/alchemy_room/jobs', { recipeId: 'unknown', quantity: 1, expectedRevision: 0 }));
    await assertValidation(await post('/v1/buildings/alchemy_room/jobs', { recipeId: 'alchemy_basic', quantity: null, expectedRevision: 0 }));
    await assertValidation(await post('/v1/equipment/equipment.iron_saber.initial/actions', { action: 'unknown', expectedRevision: 0 }));
    await assertValidation(await post('/v1/equipment/equipment.iron_saber.initial/actions', { action: 'lock', slotIndex: 0, target: 'true', expectedRevision: 0 }));
    await assertValidation(await post('/v1/dungeons/start', { dungeonId: 'unknown', expectedRevision: 0 }));
    await assertValidation(await post('/v1/dungeons/start', { dungeonId: 'qing_feng', seed: 1, expectedRevision: 0 }));
    await assertValidation(await post('/v1/high-tier/start', { realm: 'nascent_soul', attemptId: 'client-controlled', expectedRevision: 0 }));
    await assertValidation(await post('/v1/dungeons/settle', { expectedRevision: 0 }));
    await assertValidation(await post('/v1/collection/actions', { action: 'unknown', expectedRevision: 0 }));
    await assertValidation(await post('/v1/collection/actions', { action: 'research', quality: 'mortal', expectedRevision: 0 }));
    await assertValidation(await post('/v1/collection/actions', { action: 'research', techniqueId: 'technique.mortal.qing_feng', quality: 'mortal', treasureId: 'qing_lian_lamp', expectedRevision: 0 }));
    await assertValidation(await post('/v1/collection/actions', { action: 'treasure_upgrade', treasureId: 'qing_lian_lamp', techniqueId: 'technique.mortal.qing_feng', expectedRevision: 0 }));
    await assertValidation(await post('/v1/progression/breakthrough', {}));
    await assertValidation(await post('/v1/economy/long-term', { horizonHours: 2160, seed: 1, realm: 'nascent_soul' }));
    await assertValidation(await post('/v1/combat/preview', { activityId: 'qing_feng', expectedRevision: 0, equipmentIds: ['client-choice'] }));
    await assertValidation(await fetch(`${url}/v1/replays/%ZZ`, { headers }));
    await assertValidation(await fetch(`${url}/v1/buildings/%ZZ/jobs`, { method: 'POST', headers, body: JSON.stringify({ recipeId: 'alchemy_basic', quantity: 1, expectedRevision: 0 }) }));
    const preview = await fetch(`${url}/v1/dungeons/qing_feng/preview?request=read-only`, { headers });
    assert.equal(preview.status, 200);
    assert.equal((await preview.json() as { data: { dungeonId: string } }).data.dungeonId, 'qing_feng');
    assert.equal((await repository.getPlayer(playerId)).stateRevision, 0);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((closeError) => closeError ? reject(closeError) : resolve()));
  }
});

test('HTTP adapter exposes bootstrap, start, offline and uniform error envelopes', async () => {
  const service = new GameService(new MemoryRepository());
  const playerId = 'http-player';
  await service.createPlayer(playerId, new Date());
  const server = createGameHttpServer(service);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('server did not bind');
  const url = `http://127.0.0.1:${address.port}`;
  const headers = { 'x-player-id': playerId, 'content-type': 'application/json' };
  try {
    const bootstrap = await fetch(`${url}/v1/bootstrap`, { headers });
    assert.equal(bootstrap.status, 200);
    const boot = await bootstrap.json() as { requestId: string; configVersion: string; stateRevision: number; serverTime: string; data: { player: { lastSettledAt: string; stateRevision: number; primaryAction: { actionId: string | null } } } };
    assert.equal(boot.configVersion, '1.0.0-frozen');
    assert.equal(boot.stateRevision, 0);
    assert.ok(boot.requestId);

    const startedResponse = await fetch(`${url}/v1/actions/start`, { method: 'POST', headers: { ...headers, 'x-expected-revision': '0', 'idempotency-key': 'http-start-1' }, body: JSON.stringify({ actionId: 'training', expectedRevision: 0 }) });
    assert.equal(startedResponse.status, 200);
    const started = await startedResponse.json() as { stateRevision: number; data: { actionId: string } };
    assert.equal(started.stateRevision, 1);
    assert.equal(started.data.actionId, 'training');

    const afterStart = await (await fetch(`${url}/v1/bootstrap`, { headers })).json() as typeof boot;
    const jobResponse = await fetch(`${url}/v1/buildings/alchemy_room/jobs`, { method: 'POST', headers: { ...headers, 'x-expected-revision': '1', 'idempotency-key': 'http-job-1' }, body: JSON.stringify({ recipeId: 'alchemy_basic', quantity: 1, expectedRevision: 1 }) });
    assert.equal(jobResponse.status, 400);
    assert.equal((await jobResponse.json() as { error: { code: string } }).error.code, 'VALIDATION_FAILED');

    const missingOfflineKey = await fetch(`${url}/v1/settlements/offline`, { method: 'POST', headers: { ...headers, 'x-expected-revision': '1' }, body: JSON.stringify({ settlementId: 'http-settlement-missing-key', requestedStartedAt: afterStart.data.player.lastSettledAt, requestedEndedAt: afterStart.serverTime, expectedRevision: 1 }) });
    assert.equal(missingOfflineKey.status, 400);
    assert.equal((await missingOfflineKey.json() as { error: { code: string } }).error.code, 'VALIDATION_FAILED');

    const offlineResponse = await fetch(`${url}/v1/settlements/offline`, { method: 'POST', headers: { ...headers, 'x-expected-revision': '1', 'idempotency-key': 'http-settlement-1' }, body: JSON.stringify({ settlementId: 'http-settlement-1', requestedStartedAt: afterStart.data.player.lastSettledAt, requestedEndedAt: afterStart.serverTime, expectedRevision: 1 }) });
    assert.equal(offlineResponse.status, 200);
    const offline = await offlineResponse.json() as { requestId: string; configVersion: string; stateRevision: number; serverTime: string; data: { settlementId: string } };
    assert.equal(offline.data.settlementId, 'http-settlement-1');
    assert.equal(offline.configVersion, '1.0.0-frozen');

    const stoppedResponse = await fetch(`${url}/v1/actions/stop`, { method: 'POST', headers: { ...headers, 'x-expected-revision': String(offline.stateRevision), 'idempotency-key': 'http-stop-after-offline' }, body: JSON.stringify({ settlementId: 'http-stop-after-offline-settlement', requestedStartedAt: afterStart.serverTime, requestedEndedAt: afterStart.serverTime, expectedRevision: offline.stateRevision }) });
    assert.equal(stoppedResponse.status, 200);
    const stopped = await stoppedResponse.json() as { stateRevision: number };

    const errorResponse = await fetch(`${url}/v1/progression/breakthrough`, { method: 'POST', headers: { ...headers, 'x-expected-revision': String(stopped.stateRevision), 'idempotency-key': 'http-breakthrough-1' }, body: JSON.stringify({ expectedRevision: stopped.stateRevision }) });
    assert.equal(errorResponse.status, 400);
    const error = await errorResponse.json() as { requestId: string; configVersion: string; stateRevision: number; serverTime: string; error: { code: string } };
    assert.equal(error.error.code, 'RESOURCE_INSUFFICIENT');
    assert.equal(error.configVersion, '1.0.0-frozen');
    assert.equal(error.stateRevision, stopped.stateRevision);
    assert.ok(error.requestId);
    assert.ok(error.serverTime);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((closeError) => closeError ? reject(closeError) : resolve()));
  }
});

test('HTTP action DTO accepts all six high-tier expedition action IDs', async () => {
  const repository = new MemoryRepository();
  const service = new GameService(repository);
  const realms = ['nascent_soul', 'divine_transformation', 'void_refining', 'body_unity', 'great_vehicle', 'tribulation'] as const;
  for (const [index, realm] of realms.entries()) {
    const playerId = `http-high-tier-expedition-${index}`;
    await service.createPlayer(playerId, new Date('2026-01-01T00:00:00.000Z'));
    await repository.transaction(playerId, 0, { eventType: 'test_seed_http_high_tier_expedition', payload: {}, at: new Date('2026-01-01T00:00:00.000Z') }, (draft) => { draft.realmId = realm; });
  }
  const server = createGameHttpServer(service);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('server did not bind');
  const url = `http://127.0.0.1:${address.port}`;
  try {
    for (const [index, realm] of realms.entries()) {
      const response = await fetch(`${url}/v1/actions/start`, { method: 'POST', headers: { 'x-player-id': `http-high-tier-expedition-${index}`, 'content-type': 'application/json', 'x-expected-revision': '1', 'idempotency-key': `http-high-tier-expedition-${index}` }, body: JSON.stringify({ actionId: `high_tier_expedition:${realm}`, expectedRevision: 1 }) });
      assert.equal(response.status, 200);
      assert.equal((await response.json() as { data: { actionId: string } }).data.actionId, `high_tier_expedition:${realm}`);
    }
  } finally {
    await new Promise<void>((resolve, reject) => server.close((closeError) => closeError ? reject(closeError) : resolve()));
  }
});

test('HTTP adapter exposes authenticated read-only settlement replay', async () => {
  const repository = new MemoryRepository();
  const service = new GameService(repository);
  const playerId = 'http-replay-player';
  await service.createPlayer(playerId, new Date('2026-01-01T00:00:00.000Z'));
  const settled = await service.offlineSettlement({ playerId, settlementId: 'http-replay-settlement', requestedStartedAt: '2026-01-01T00:00:00.000Z', requestedEndedAt: '2026-01-01T00:01:00.000Z', expectedRevision: 0, now: new Date('2026-01-01T00:01:00.000Z') });
  const server = createGameHttpServer(service);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('server did not bind');
  const url = `http://127.0.0.1:${address.port}`;
  const headers = { 'x-player-id': playerId };
  try {
    const replayResponse = await fetch(`${url}/v1/replays/http-replay-settlement`, { headers });
    assert.equal(replayResponse.status, 200);
    const replay = await replayResponse.json() as { stateRevision: number; data: { settlementId: string; responsePayload: unknown } };
    assert.equal(replay.stateRevision, settled.stateRevision);
    assert.equal(replay.data.settlementId, 'http-replay-settlement');
    assert.deepEqual(replay.data.responsePayload, settled);

    const missingResponse = await fetch(`${url}/v1/replays/missing-replay`, { headers });
    assert.equal(missingResponse.status, 404);
    const missing = await missingResponse.json() as { error: { code: string }; stateRevision: number };
    assert.equal(missing.error.code, 'NOT_FOUND');
    assert.equal(missing.stateRevision, settled.stateRevision);

    const unauthorized = await fetch(`${url}/v1/replays/http-replay-settlement`, { headers: { 'x-player-id': 'http-replay-other' } });
    assert.equal(unauthorized.status, 404);
    assert.equal((await unauthorized.json() as { error: { code: string } }).error.code, 'NOT_FOUND');
  } finally {
    await new Promise<void>((resolve, reject) => server.close((closeError) => closeError ? reject(closeError) : resolve()));
  }
});

test('HTTP adapter exposes all high-tier preview routes and rejects client outcomes', async () => {
  const repository = new MemoryRepository();
  const service = new GameService(repository);
  const playerId = 'http-high-tier-player';
  await service.createPlayer(playerId, new Date('2026-01-01T00:00:00.000Z'));
  const server = createGameHttpServer(service);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('server did not bind');
  const url = `http://127.0.0.1:${address.port}`;
  const headers = { 'x-player-id': playerId, 'content-type': 'application/json' };
  const realms = ['nascent_soul', 'divine_transformation', 'void_refining', 'body_unity', 'great_vehicle', 'tribulation'];
  try {
    for (const realm of realms) {
      const response = await fetch(`${url}/v1/high-tier/${realm}/preview`, { headers });
      assert.equal(response.status, 200);
      const payload = await response.json() as { data: { realm: string; gate: { status: string } } };
      assert.equal(payload.data.realm, realm);
      assert.equal(payload.data.gate.status, 'blocked');
    }
    const start = await fetch(`${url}/v1/high-tier/start`, { method: 'POST', headers, body: JSON.stringify({ realm: 'nascent_soul', expectedRevision: 0, outcome: 'succeeded' }) });
    assert.equal(start.status, 400);
    assert.equal((await start.json() as { error: { code: string } }).error.code, 'VALIDATION_FAILED');
    const settle = await fetch(`${url}/v1/high-tier/settle`, { method: 'POST', headers, body: JSON.stringify({ attemptId: 'attempt-1', expectedRevision: 0, outcome: 'failed' }) });
    assert.equal(settle.status, 400);
    assert.equal((await settle.json() as { error: { code: string } }).error.code, 'VALIDATION_FAILED');
    assert.equal((await repository.getPlayer(playerId)).stateRevision, 0);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((closeError) => closeError ? reject(closeError) : resolve()));
  }
});

test('HTTP adapter exposes equipment reinforce action route', async () => {
  const repository = new MemoryRepository();
  const service = new GameService(repository);
  const playerId = 'http-equipment-player';
  service.createPlayer(playerId, new Date());
  repository.transaction(playerId, 0, { eventType: 'test_seed_http_equipment', payload: {}, at: new Date() }, (draft) => { draft.resources.spirit_wood.amount = 10; draft.resources.millennium_herb.amount = 20; draft.resources.meteor_iron.amount = 30; });
  const server = createGameHttpServer(service);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('server did not bind');
  try {
    const response = await fetch(`http://127.0.0.1:${address.port}/v1/equipment/${encodeURIComponent('equipment.iron_saber.initial')}/actions`, { method: 'POST', headers: { 'x-player-id': playerId, 'x-expected-revision': '1', 'idempotency-key': 'http-reinforce-1', 'content-type': 'application/json' }, body: JSON.stringify({ action: 'reinforce', expectedRevision: 1 }) });
    assert.equal(response.status, 200);
    const payload = await response.json() as { stateRevision: number; data: { action: string; toLevel: number } };
    assert.equal(payload.stateRevision, 2);
    assert.equal(payload.data.action, 'reinforce');
    assert.equal(payload.data.toLevel, 1);
    const promoted = await fetch(`http://127.0.0.1:${address.port}/v1/equipment/${encodeURIComponent('equipment.iron_saber.initial')}/actions`, { method: 'POST', headers: { 'x-player-id': playerId, 'x-expected-revision': '2', 'idempotency-key': 'http-promote-1', 'content-type': 'application/json' }, body: JSON.stringify({ action: 'promote', expectedRevision: 2 }) });
    assert.equal(promoted.status, 200);
    const promotedPayload = await promoted.json() as { stateRevision: number; data: { action: string; fromQuality: string; toQuality: string; toLevel: number } };
    assert.equal(promotedPayload.stateRevision, 3);
    assert.equal(promotedPayload.data.action, 'promote');
    assert.equal(promotedPayload.data.fromQuality, 'fine');
    assert.equal(promotedPayload.data.toQuality, 'rare');
    assert.equal(promotedPayload.data.toLevel, 1);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((closeError) => closeError ? reject(closeError) : resolve()));
  }
});

test('HTTP equipment action forwards lock and target reroll payloads', async () => {
  const repository = new MemoryRepository();
  const service = new GameService(repository);
  const playerId = 'http-advanced-equipment-player';
  await service.createPlayer(playerId, new Date());
  await repository.transaction(playerId, 0, { eventType: 'test_seed_http_advanced', payload: {}, at: new Date() }, (draft) => {
    draft.equipmentInstances['equipment.iron_saber.initial'].quality = 'legendary';
    draft.resources.pill.amount = 10;
  });
  const server = createGameHttpServer(service);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('server did not bind');
  try {
    const url = `http://127.0.0.1:${address.port}/v1/equipment/${encodeURIComponent('equipment.iron_saber.initial')}/actions`;
    const headers = { 'x-player-id': playerId, 'x-expected-revision': '1', 'content-type': 'application/json' };
    const lock = await fetch(url, { method: 'POST', headers: { ...headers, 'idempotency-key': 'http-lock-1' }, body: JSON.stringify({ action: 'lock', slotIndex: 0, expectedRevision: 1 }) });
    assert.equal(lock.status, 200);
    const lockPayload = await lock.json() as { stateRevision: number; data: { action: string; lockedSlots: number[] } };
    assert.equal(lockPayload.data.action, 'lock');
    assert.deepEqual(lockPayload.data.lockedSlots, [0]);
    const reroll = await fetch(url, { method: 'POST', headers: { ...headers, 'x-expected-revision': '2', 'idempotency-key': 'http-reroll-1' }, body: JSON.stringify({ action: 'reroll', target: true, targetAffix: 'speed', expectedRevision: 2 }) });
    assert.equal(reroll.status, 400);
    const rerollPayload = await reroll.json() as { stateRevision: number; error: { code: string } };
    assert.equal(rerollPayload.stateRevision, 2);
    assert.equal(rerollPayload.error.code, 'RESOURCE_INSUFFICIENT');
  } finally {
    await new Promise<void>((resolve, reject) => server.close((closeError) => closeError ? reject(closeError) : resolve()));
  }
});

test('HTTP adapter exposes salvage and rejects selling an equipped instance', async () => {
  const repository = new MemoryRepository();
  const service = new GameService(repository);
  const playerId = 'http-export-player';
  service.createPlayer(playerId, new Date());
  repository.transaction(playerId, 0, { eventType: 'test_seed_http_export', payload: {}, at: new Date() }, (draft) => {
    draft.equipmentInstances['equipment.http.scrap'] = { ...draft.equipmentInstances['equipment.iron_saber.initial'], instanceId: 'equipment.http.scrap', quality: 'normal', isEquipped: false };
    draft.equipmentCount += 1;
  });
  const server = createGameHttpServer(service);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('server did not bind');
  const headers = { 'x-player-id': playerId, 'content-type': 'application/json' };
  try {
    const success = await fetch(`http://127.0.0.1:${address.port}/v1/equipment/${encodeURIComponent('equipment.http.scrap')}/actions`, { method: 'POST', headers: { ...headers, 'x-expected-revision': '1', 'idempotency-key': 'http-salvage-1' }, body: JSON.stringify({ action: 'salvage', expectedRevision: 1 }) });
    assert.equal(success.status, 200);
    const successPayload = await success.json() as { stateRevision: number; data: { action: string; resourceDelta: { spirit_ore: number; spirit_wood: number } } };
    assert.equal(successPayload.stateRevision, 2);
    assert.equal(successPayload.data.action, 'salvage');
    assert.deepEqual(successPayload.data.resourceDelta, { spirit_ore: 1, spirit_wood: 1 });

    const failure = await fetch(`http://127.0.0.1:${address.port}/v1/equipment/${encodeURIComponent('equipment.iron_saber.initial')}/actions`, { method: 'POST', headers: { ...headers, 'x-expected-revision': '2', 'idempotency-key': 'http-sell-1' }, body: JSON.stringify({ action: 'sell', expectedRevision: 2 }) });
    assert.equal(failure.status, 400);
    const failurePayload = await failure.json() as { stateRevision: number; error: { code: string } };
    assert.equal(failurePayload.stateRevision, 2);
    assert.equal(failurePayload.error.code, 'VALIDATION_FAILED');
  } finally {
    await new Promise<void>((resolve, reject) => server.close((closeError) => closeError ? reject(closeError) : resolve()));
  }
});

test('HTTP equipment action exposes equip and unequip with same-slot replacement', async () => {
  const repository = new MemoryRepository();
  const service = new GameService(repository);
  const playerId = 'http-equip-player';
  await service.createPlayer(playerId, new Date());
  await repository.transaction(playerId, 0, { eventType: 'test_seed_http_equip', payload: {}, at: new Date() }, (draft) => {
    draft.equipmentInstances['equipment.http.second'] = { ...draft.equipmentInstances['equipment.iron_saber.initial'], instanceId: 'equipment.http.second', isEquipped: false };
    draft.equipmentCount += 1;
  });
  const server = createGameHttpServer(service);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('server did not bind');
  try {
    const url = `http://127.0.0.1:${address.port}/v1/equipment/${encodeURIComponent('equipment.http.second')}/actions`;
    const headers = { 'x-player-id': playerId, 'content-type': 'application/json', 'x-expected-revision': '1' };
    const equipped = await fetch(url, { method: 'POST', headers: { ...headers, 'idempotency-key': 'http-equip' }, body: JSON.stringify({ action: 'equip', expectedRevision: 1 }) });
    assert.equal(equipped.status, 200);
    const equippedPayload = await equipped.json() as { stateRevision: number; data: { action: string; equipped: boolean; replacedInstanceId: string | null } };
    assert.equal(equippedPayload.data.action, 'equip');
    assert.equal(equippedPayload.data.equipped, true);
    assert.equal(equippedPayload.data.replacedInstanceId, 'equipment.iron_saber.initial');
    const unequipped = await fetch(url, { method: 'POST', headers: { ...headers, 'x-expected-revision': '2', 'idempotency-key': 'http-unequip' }, body: JSON.stringify({ action: 'unequip', expectedRevision: 2 }) });
    assert.equal(unequipped.status, 200);
    const unequippedPayload = await unequipped.json() as { data: { action: string; equipped: boolean } };
    assert.equal(unequippedPayload.data.action, 'unequip');
    assert.equal(unequippedPayload.data.equipped, false);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((closeError) => closeError ? reject(closeError) : resolve()));
  }
});

test('HTTP adapter exposes collection research and treasure upgrade actions', async () => {
  const repository = new MemoryRepository();
  const service = new GameService(repository);
  const playerId = 'http-collection-player';
  await service.createPlayer(playerId, new Date());
  await repository.transaction(playerId, 0, { eventType: 'test_seed_http_collection', payload: {}, at: new Date() }, (draft) => {
    draft.collection.techniqueLayers['technique.mortal.qing_feng'] = 0;
    draft.collection.techniqueResearchXp = 100;
    draft.collection.duplicateBalances.qing_lian_lamp = 1;
  });
  const server = createGameHttpServer(service);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('server did not bind');
  try {
    const url = `http://127.0.0.1:${address.port}/v1/collection/actions`;
    const headers = { 'x-player-id': playerId, 'content-type': 'application/json' };
    const researchResponse = await fetch(url, { method: 'POST', headers: { ...headers, 'x-expected-revision': '1', 'idempotency-key': 'http-research-1' }, body: JSON.stringify({ action: 'research', techniqueId: 'technique.mortal.qing_feng', quality: 'mortal', expectedRevision: 1 }) });
    assert.equal(researchResponse.status, 200);
    const research = await researchResponse.json() as { stateRevision: number; data: { action: string; toLayer: number } };
    assert.equal(research.stateRevision, 2);
    assert.equal(research.data.action, 'research');
    assert.equal(research.data.toLayer, 1);
    const treasureResponse = await fetch(url, { method: 'POST', headers: { ...headers, 'x-expected-revision': '2', 'idempotency-key': 'http-treasure-1' }, body: JSON.stringify({ action: 'treasure_upgrade', treasureId: 'qing_lian_lamp', expectedRevision: 2 }) });
    assert.equal(treasureResponse.status, 200);
    const treasure = await treasureResponse.json() as { stateRevision: number; data: { action: string; toStars: number } };
    assert.equal(treasure.stateRevision, 3);
    assert.equal(treasure.data.action, 'treasure_upgrade');
    assert.equal(treasure.data.toStars, 1);
    const researchWithTreasure = await fetch(url, { method: 'POST', headers: { ...headers, 'x-expected-revision': '3', 'idempotency-key': 'http-collection-fields-1' }, body: JSON.stringify({ action: 'research', techniqueId: 'technique.mortal.qing_feng', quality: 'mortal', treasureId: 'qing_lian_lamp', expectedRevision: 3 }) });
    assert.equal(researchWithTreasure.status, 400);
    assert.equal((await researchWithTreasure.json() as { error: { code: string } }).error.code, 'VALIDATION_FAILED');
    const upgradeWithResearchFields = await fetch(url, { method: 'POST', headers: { ...headers, 'x-expected-revision': '3', 'idempotency-key': 'http-collection-fields-2' }, body: JSON.stringify({ action: 'treasure_upgrade', treasureId: 'qing_lian_lamp', techniqueId: 'technique.mortal.qing_feng', quality: 'mortal', expectedRevision: 3 }) });
    assert.equal(upgradeWithResearchFields.status, 400);
    assert.equal((await upgradeWithResearchFields.json() as { error: { code: string } }).error.code, 'VALIDATION_FAILED');
    const eventsResponse = await fetch(`http://127.0.0.1:${address.port}/v1/collection/events?limit=10`, { headers });
    assert.equal(eventsResponse.status, 200);
    const events = await eventsResponse.json() as { data: { events: Array<{ eventType: string; beforeRevision: number; afterRevision: number }> } };
    assert.deepEqual(new Set(events.data.events.map((event) => event.eventType)), new Set(['collection_treasure_upgrade', 'collection_research', 'test_seed_http_collection']));
    const revisions = new Map(events.data.events.map((event) => [event.eventType, [event.beforeRevision, event.afterRevision]]));
    assert.deepEqual(revisions.get('collection_research'), [1, 2]);
    assert.deepEqual(revisions.get('collection_treasure_upgrade'), [2, 3]);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((closeError) => closeError ? reject(closeError) : resolve()));
  }
});

test('HTTP adapter exposes dungeon preview, start and settle routes with one envelope', async () => {
  const service = new GameService(new MemoryRepository());
  const playerId = 'http-dungeon-player';
  service.createPlayer(playerId, new Date());
  const server = createGameHttpServer(service);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('server did not bind');
  const url = `http://127.0.0.1:${address.port}`;
  const headers = { 'x-player-id': playerId, 'content-type': 'application/json' };
  try {
    const previewResponse = await fetch(`${url}/v1/dungeons/qing_feng/preview`, { headers });
    assert.equal(previewResponse.status, 200);
    const preview = await previewResponse.json() as { configVersion: string; stateRevision: number; data: { dungeonId: string; bossMaxHp: number } };
    assert.equal(preview.configVersion, '1.0.0-frozen');
    assert.equal(preview.stateRevision, 0);
    assert.equal(preview.data.dungeonId, 'qing_feng');
    assert.equal(preview.data.bossMaxHp, 4958.4);

    const startResponse = await fetch(`${url}/v1/dungeons/start`, { method: 'POST', headers: { ...headers, 'x-expected-revision': '0', 'idempotency-key': 'http-dungeon-start' }, body: JSON.stringify({ dungeonId: 'qing_feng', expectedRevision: 0 }) });
    assert.equal(startResponse.status, 200);
    const start = await startResponse.json() as { stateRevision: number; data: { attemptId: string; seed: number } };
    assert.equal(start.stateRevision, 1);
    assert.equal(Number.isInteger(start.data.seed) && start.data.seed >= 0 && start.data.seed <= 0xffffffff, true);
    assert.equal(typeof start.data.attemptId === 'string' && start.data.attemptId.length > 0, true);

    const settleResponse = await fetch(`${url}/v1/dungeons/settle`, { method: 'POST', headers: { ...headers, 'x-expected-revision': '1', 'idempotency-key': 'http-dungeon-settle' }, body: JSON.stringify({ attemptId: start.data.attemptId, expectedRevision: 1 }) });
    assert.equal(settleResponse.status, 200);
    const settle = await settleResponse.json() as { stateRevision: number; data: { status: string; pillCost: number } };
    assert.equal(settle.stateRevision, 2);
    assert.equal(settle.data.status, 'failed');
    assert.equal(settle.data.pillCost, 0);

    const startWithOutcome = await fetch(`${url}/v1/dungeons/start`, { method: 'POST', headers: { ...headers, 'x-expected-revision': '2' }, body: JSON.stringify({ dungeonId: 'qing_feng', expectedRevision: 2, outcome: 'succeeded' }) });
    assert.equal(startWithOutcome.status, 400);
    assert.equal((await startWithOutcome.json() as { error: { code: string } }).error.code, 'VALIDATION_FAILED');
    const settleWithOutcome = await fetch(`${url}/v1/dungeons/settle`, { method: 'POST', headers: { ...headers, 'x-expected-revision': '2' }, body: JSON.stringify({ attemptId: start.data.attemptId, expectedRevision: 2, outcome: 'failed' }) });
    assert.equal(settleWithOutcome.status, 400);
    assert.equal((await settleWithOutcome.json() as { error: { code: string } }).error.code, 'VALIDATION_FAILED');
  } finally {
    await new Promise<void>((resolve, reject) => server.close((closeError) => closeError ? reject(closeError) : resolve()));
  }
});

test('HTTP adapter exposes read-only combat preview with strict request fields', async () => {
  const repository = new MemoryRepository();
  const service = new GameService(repository);
  const playerId = 'http-combat-preview-player';
  await service.createPlayer(playerId, new Date());
  const server = createGameHttpServer(service);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('server did not bind');
  try {
    const url = `http://127.0.0.1:${address.port}/v1/combat/preview`;
    const headers = { 'x-player-id': playerId, 'content-type': 'application/json' };
    const previewResponse = await fetch(url, { method: 'POST', headers, body: JSON.stringify({ activityId: 'bai_cao_valley', expectedRevision: 0 }) });
    assert.equal(previewResponse.status, 200);
    const preview = await previewResponse.json() as { configVersion: string; stateRevision: number; data: { activityId: string; realm: string; equipmentCount: number; targetClearTime: number; pillBudget: number; gate: { status: string } } };
    assert.equal(preview.configVersion, '1.0.0-frozen');
    assert.equal(preview.stateRevision, 0);
    assert.equal(preview.data.activityId, 'bai_cao_valley');
    assert.equal(preview.data.realm, 'qi_refining');
    assert.equal(preview.data.equipmentCount, 1);
    assert.equal(preview.data.targetClearTime, 30);
    assert.equal(preview.data.pillBudget, 0);
    assert.equal(preview.data.gate.status, 'open');
    const strictResponse = await fetch(url, { method: 'POST', headers, body: JSON.stringify({ activityId: 'bai_cao_valley', expectedRevision: 0, seed: 1, result: {} }) });
    assert.equal(strictResponse.status, 400);
    const strict = await strictResponse.json() as { error: { code: string }; stateRevision: number };
    assert.equal(strict.error.code, 'VALIDATION_FAILED');
    assert.equal(strict.stateRevision, 0);
    const after = await service.bootstrap(playerId);
    assert.equal(after.stateRevision, 0);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((closeError) => closeError ? reject(closeError) : resolve()));
  }
});

test('HTTP combat preview requires an expected revision and rejects stale snapshots without mutation', async () => {
  const repository = new MemoryRepository();
  const service = new GameService(repository);
  const playerId = 'http-combat-preview-revision-player';
  await service.createPlayer(playerId, new Date());
  const server = createGameHttpServer(service);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('server did not bind');
  const url = `http://127.0.0.1:${address.port}/v1/combat/preview`;
  const headers = { 'x-player-id': playerId, 'content-type': 'application/json' };
  try {
    const missing = await fetch(url, { method: 'POST', headers, body: JSON.stringify({ activityId: 'bai_cao_valley' }) });
    assert.equal(missing.status, 400);
    assert.equal((await missing.json() as { error: { code: string } }).error.code, 'VALIDATION_FAILED');
    const stale = await fetch(url, { method: 'POST', headers, body: JSON.stringify({ activityId: 'bai_cao_valley', expectedRevision: 1 }) });
    assert.equal(stale.status, 409);
    assert.equal((await stale.json() as { error: { code: string } }).error.code, 'STALE_REVISION');
    assert.equal((await service.bootstrap(playerId)).stateRevision, 0);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((closeError) => closeError ? reject(closeError) : resolve()));
  }
});

test('HTTP adapter exposes the documented combat start route for dungeon and high-tier activities', async () => {
  const repository = new MemoryRepository();
  const service = new GameService(repository);
  const playerId = 'http-combat-start-player';
  await service.createPlayer(playerId, new Date());
  const server = createGameHttpServer(service);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('server did not bind');
  const url = `http://127.0.0.1:${address.port}/v1/combat/start`;
  const headers = { 'x-player-id': playerId, 'content-type': 'application/json', 'x-expected-revision': '0', 'idempotency-key': 'http-combat-start' };
  try {
    const dungeonResponse = await fetch(url, { method: 'POST', headers, body: JSON.stringify({ activityId: 'qing_feng', expectedRevision: 0 }) });
    assert.equal(dungeonResponse.status, 200);
    const dungeon = await dungeonResponse.json() as { stateRevision: number; data: { dungeonId: string; seed: number; attemptId: string } };
    assert.equal(dungeon.stateRevision, 1);
    assert.equal(dungeon.data.dungeonId, 'qing_feng');
    assert.equal(Number.isInteger(dungeon.data.seed) && dungeon.data.seed >= 0 && dungeon.data.seed <= 0xffffffff, true);
    assert.equal(typeof dungeon.data.attemptId === 'string' && dungeon.data.attemptId.length > 0, true);

    const dungeonSettle = await fetch(`${url.replace('/combat/start', '/dungeons/settle')}`, { method: 'POST', headers: { ...headers, 'x-expected-revision': '1', 'idempotency-key': 'http-combat-settle' }, body: JSON.stringify({ attemptId: dungeon.data.attemptId, expectedRevision: 1 }) });
    assert.equal(dungeonSettle.status, 200);
    const settled = await dungeonSettle.json() as { stateRevision: number };
    assert.equal(settled.stateRevision, 2);

    await repository.transaction(playerId, 2, { eventType: 'test_high_tier_gate', payload: {}, at: new Date() }, (draft) => {
      draft.realmId = 'nascent_soul';
      draft.collection.collectionMarks = 10;
    });

    const highTierResponse = await fetch(url, { method: 'POST', headers: { ...headers, 'x-expected-revision': '3', 'idempotency-key': 'http-combat-start-high-tier' }, body: JSON.stringify({ activityId: 'nascent_soul', expectedRevision: 3 }) });
    assert.equal(highTierResponse.status, 200);
    const highTier = await highTierResponse.json() as { stateRevision: number; data: { realm: string; seed: number } };
    assert.equal(highTier.stateRevision, 4);
    assert.equal(highTier.data.realm, 'nascent_soul');
    assert.equal(Number.isInteger(highTier.data.seed) && highTier.data.seed >= 0 && highTier.data.seed <= 0xffffffff, true);

    const unsupported = await fetch(url, { method: 'POST', headers: { ...headers, 'x-expected-revision': '4', 'idempotency-key': 'http-combat-start-unsupported' }, body: JSON.stringify({ activityId: 'black_wind_valley', expectedRevision: 4 }) });
    assert.equal(unsupported.status, 400);
    assert.equal((await unsupported.json() as { error: { code: string } }).error.code, 'CONTENT_LOCKED');
  } finally {
    await new Promise<void>((resolve, reject) => server.close((closeError) => closeError ? reject(closeError) : resolve()));
  }
});

test('HTTP adapter exposes pavilion upgrade and rejects recipe queue on passive pavilions', async () => {
  const repository = new MemoryRepository();
  const service = new GameService(repository);
  const playerId = 'http-pavilion-player';
  await service.createPlayer(playerId, new Date());
  const server = createGameHttpServer(service);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('server did not bind');
  const url = `http://127.0.0.1:${address.port}`;
  const headers = { 'x-player-id': playerId, 'content-type': 'application/json' };
  try {
    const upgrade = await fetch(`${url}/v1/buildings/technique_pavilion/upgrade`, { method: 'POST', headers: { ...headers, 'x-expected-revision': '0', 'idempotency-key': 'http-pavilion-upgrade' }, body: JSON.stringify({ expectedRevision: 0 }) });
    assert.equal(upgrade.status, 200);
    const upgraded = await upgrade.json() as { stateRevision: number; data: { buildingId: string; toLevel: number; resourceCost: { spirit_stone: number } } };
    assert.equal(upgraded.stateRevision, 1);
    assert.equal(upgraded.data.buildingId, 'technique_pavilion');
    assert.equal(upgraded.data.toLevel, 2);
    assert.equal(upgraded.data.resourceCost.spirit_stone, 1600);

    const queue = await fetch(`${url}/v1/buildings/treasure_pavilion/jobs`, { method: 'POST', headers: { ...headers, 'x-expected-revision': '1', 'idempotency-key': 'http-pavilion-queue' }, body: JSON.stringify({ recipeId: 'alchemy_basic', quantity: 1, expectedRevision: 1 }) });
    assert.equal(queue.status, 400);
    assert.equal((await queue.json() as { error: { code: string } }).error.code, 'CONTENT_LOCKED');
  } finally {
    await new Promise<void>((resolve, reject) => server.close((closeError) => closeError ? reject(closeError) : resolve()));
  }
});

test('HTTP adapter exposes authenticated Prometheus metrics', async () => {
  const service = new GameService(new MemoryRepository(), undefined, undefined, undefined, new MetricsCollector());
  const playerId = 'http-metrics-player';
  await service.createPlayer(playerId, new Date());
  const server = createGameHttpServer(service);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('server did not bind');
  try {
    const response = await fetch(`http://127.0.0.1:${address.port}/metrics`, { headers: { authorization: `Bearer ${playerId}` } });
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type') ?? '', /text\/plain/);
    const body = await response.text();
    assert.match(body, /# TYPE dongtian_settlements_total counter/);
    assert.match(body, /dongtian_settlements_total\{outcome="success"\} 0/);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((closeError) => closeError ? reject(closeError) : resolve()));
  }
});

test('HTTP action stop and switch routes settle and replace the primary action', async () => {
  const repository = new MemoryRepository();
  const service = new GameService(repository);
  const playerId = 'http-action-switch-player';
  const base = new Date('2026-01-01T00:00:00.000Z');
  await service.createPlayer(playerId, base);
  const server = createGameHttpServer(service);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('server did not bind');
  const url = `http://127.0.0.1:${address.port}`;
  const headers = { 'x-player-id': playerId, 'content-type': 'application/json' };
  try {
    const start = await fetch(`${url}/v1/actions/start`, { method: 'POST', headers: { ...headers, 'idempotency-key': 'http-switch-start' }, body: JSON.stringify({ actionId: 'training', expectedRevision: 0 }) });
    assert.equal(start.status, 200);
    const started = await start.json() as { stateRevision: number; data: { actionId: string } };
    const switched = await fetch(`${url}/v1/actions/switch`, { method: 'POST', headers: { ...headers, 'idempotency-key': 'http-switch' }, body: JSON.stringify({ actionId: 'bai_cao_valley', settlementId: 'http-switch-settlement', requestedStartedAt: base.toISOString(), requestedEndedAt: new Date(base.getTime() + 60_000).toISOString(), expectedRevision: started.stateRevision }) });
    assert.equal(switched.status, 200);
    const payload = await switched.json() as { stateRevision: number; data: { stopped: { actionId: string }; started: { actionId: string } } };
    assert.equal(payload.data.stopped.actionId, 'training');
    assert.equal(payload.data.started.actionId, 'bai_cao_valley');
    const replay = await fetch(`${url}/v1/actions/switch`, { method: 'POST', headers: { ...headers, 'idempotency-key': 'http-switch' }, body: JSON.stringify({ actionId: 'bai_cao_valley', settlementId: 'http-switch-settlement', requestedStartedAt: base.toISOString(), requestedEndedAt: new Date(base.getTime() + 60_000).toISOString(), expectedRevision: 999 }) });
    assert.deepEqual(await replay.json(), payload);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((closeError) => closeError ? reject(closeError) : resolve()));
  }
});

test('HTTP natural progression chain requires stop before breakthrough', async () => {
  const repository = new MemoryRepository();
  const service = new GameService(repository);
  const playerId = 'http-breakthrough-chain-player';
  const base = new Date('2026-01-01T00:00:00.000Z');
  await service.createPlayer(playerId, base);
  await repository.transaction(playerId, 0, { eventType: 'test_seed_breakthrough_chain', payload: {}, at: base }, (draft) => {
    draft.cultivationXp = 20000;
    draft.resources.spirit_stone.amount = 5000;
    draft.resources.pill.amount = 10;
    draft.resources.ancient_scroll.amount = 1;
  });
  const server = createGameHttpServer(service);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('server did not bind');
  const url = `http://127.0.0.1:${address.port}`;
  const headers = { 'x-player-id': playerId, 'content-type': 'application/json' };
  try {
    const start = await fetch(`${url}/v1/actions/start`, { method: 'POST', headers: { ...headers, 'idempotency-key': 'http-breakthrough-chain-start' }, body: JSON.stringify({ actionId: 'training', expectedRevision: 1 }) });
    assert.equal(start.status, 200);
    const started = await start.json() as { stateRevision: number };

    const rejected = await fetch(`${url}/v1/progression/breakthrough`, { method: 'POST', headers: { ...headers, 'idempotency-key': 'http-breakthrough-chain-rejected' }, body: JSON.stringify({ expectedRevision: started.stateRevision }) });
    assert.equal(rejected.status, 400);
    assert.equal((await rejected.json() as { error: { code: string } }).error.code, 'VALIDATION_FAILED');

    const stopped = await fetch(`${url}/v1/actions/stop`, { method: 'POST', headers: { ...headers, 'idempotency-key': 'http-breakthrough-chain-stop' }, body: JSON.stringify({ settlementId: 'http-breakthrough-chain-settlement', requestedStartedAt: base.toISOString(), requestedEndedAt: new Date(base.getTime() + 60_000).toISOString(), expectedRevision: started.stateRevision }) });
    assert.equal(stopped.status, 200);
    const stoppedPayload = await stopped.json() as { stateRevision: number; data: { actionId: string } };
    assert.equal(stoppedPayload.data.actionId, 'training');

    const breakthrough = await fetch(`${url}/v1/progression/breakthrough`, { method: 'POST', headers: { ...headers, 'idempotency-key': 'http-breakthrough-chain-success' }, body: JSON.stringify({ expectedRevision: stoppedPayload.stateRevision }) });
    assert.equal(breakthrough.status, 200);
    const breakthroughPayload = await breakthrough.json() as { data: { fromRealm: string; toRealm: string } };
    assert.deepEqual(breakthroughPayload.data, { fromRealm: 'qi_refining', toRealm: 'foundation_establishment', resourceCost: { spirit_stone: 5000, pill: 10, ancient_scroll: 1 }, cultivationCost: 20000 });
    assert.equal((await repository.getPlayer(playerId)).primaryAction.actionId, null);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((closeError) => closeError ? reject(closeError) : resolve()));
  }
});
