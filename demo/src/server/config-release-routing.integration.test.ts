import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import test from 'node:test';
import { CONTENT_PACKAGE } from '../content/content-schema.ts';
import { FROZEN_PARAMETER_SHA256, FROZEN_PARAMETERS } from '../game/frozen-parameters.ts';
import { createGameHttpServer } from './http.ts';
import { applyMigrations } from './migrations.ts';
import { PostgresConfigReleaseProvider, PostgresConfigReleaseRepository } from './config-release-postgres.ts';
import { ConfigReleaseRegistry } from './config-release.ts';
import { PostgresRepository } from './postgres-repository.ts';
import { GameService } from './service.ts';

const databaseUrl = process.env.DATABASE_URL;
const integrationOptions = { skip: !databaseUrl, concurrency: false } as const;

const bucket = (playerId: string): number => Number.parseInt(createHash('sha256').update(playerId).digest('hex').slice(0, 8), 16) / 0x100000000 * 100;
const packageFor = (version: string) => ({ ...CONTENT_PACKAGE, manifest: { ...CONTENT_PACKAGE.manifest, config_version: version } });

const makeRelease = (version: string, targetKillTime: number, migrationPolicy?: { mode: 'identity'; fromVersions: string[] }) => {
  const parameters = structuredClone(FROZEN_PARAMETERS) as Record<string, { value: unknown }>;
  parameters['map.bai_cao_valley.target_kill_time'] = { value: targetKillTime };
  const registry = new ConfigReleaseRegistry({ clock: () => Date.parse('2026-08-25T12:00:00.000Z') });
  return registry.registerDraft({ version, parameterSha256: FROZEN_PARAMETER_SHA256, contentSha256: CONTENT_PACKAGE.manifest.content_sha256, content: packageFor(version), parameters, migrationPolicy, createdAt: '2026-08-25T12:00:00.000Z' });
};

const listen = async (server: ReturnType<typeof createGameHttpServer>): Promise<string> => {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('server did not bind');
  return `http://127.0.0.1:${address.port}`;
};

const close = async (server: ReturnType<typeof createGameHttpServer>): Promise<void> => {
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
};

const request = async (baseUrl: string, playerId: string, path: string, init: RequestInit = {}): Promise<{ status: number; body: Record<string, unknown>; text: string }> => {
  const response = await fetch(`${baseUrl}${path}`, { ...init, headers: { 'x-player-id': playerId, ...(init.headers ?? {}) } });
  const text = await response.text();
  let body: Record<string, unknown> = {};
  try { body = JSON.parse(text) as Record<string, unknown>; } catch { /* preserve plain text for diagnostics */ }
  return { status: response.status, body, text };
};

const playerData = (body: Record<string, unknown>): { player: { configVersion: string; stateRevision: number; lastSettledAt: string } } => body.data as { player: { configVersion: string; stateRevision: number; lastSettledAt: string } };

test('real PostgreSQL routes canary traffic consistently across independent HTTP instances and preserves historical settlement replay', integrationOptions, async () => {
  const previousInsecureHeader = process.env.DONGTIAN_ALLOW_INSECURE_PLAYER_HEADER;
  process.env.DONGTIAN_ALLOW_INSECURE_PLAYER_HEADER = '1';
  const setupPool = new Pool({ connectionString: databaseUrl, max: 6 });
  const instancePoolA = new Pool({ connectionString: databaseUrl, max: 6 });
  const instancePoolB = new Pool({ connectionString: databaseUrl, max: 6 });
  const activeVersion = `integration-routing-${randomUUID()}-active`;
  const canaryVersion = `integration-routing-${randomUUID()}-canary`;
  let playerCanary = randomUUID();
  let playerActive = randomUUID();
  while (bucket(playerActive) < 50) playerActive = randomUUID();
  while (bucket(playerCanary) >= 50) playerCanary = randomUUID();
  const createdAt = new Date(Date.now() - 60_000);
  const releaseRepository = new PostgresConfigReleaseRepository(setupPool);
  const repositoryA = new PostgresRepository(instancePoolA);
  const repositoryB = new PostgresRepository(instancePoolB);
  let serverA: ReturnType<typeof createGameHttpServer> | undefined;
  let serverB: ReturnType<typeof createGameHttpServer> | undefined;
  try {
    await applyMigrations(setupPool);
    await setupPool.query('TRUNCATE config_release_audit, config_release_settlement, config_release RESTART IDENTITY CASCADE');
    const activeRelease = makeRelease(activeVersion, 31);
    await releaseRepository.createDraft(activeRelease);
    await releaseRepository.validate(activeVersion, new Date(createdAt.getTime() + 1_000));
    await releaseRepository.activate(activeVersion, new Date(createdAt.getTime() + 2_000));
    const canaryRelease = makeRelease(canaryVersion, 17, { mode: 'identity', fromVersions: [activeVersion] });
    await releaseRepository.createDraft(canaryRelease);
    await releaseRepository.validate(canaryVersion, new Date(createdAt.getTime() + 3_000));
    await releaseRepository.startCanary(canaryVersion, 50, new Date(createdAt.getTime() + 4_000));

    const providerA = new PostgresConfigReleaseProvider(new PostgresConfigReleaseRepository(instancePoolA));
    const providerB = new PostgresConfigReleaseProvider(new PostgresConfigReleaseRepository(instancePoolB));
    assert.equal((await providerA.refresh())?.version, activeVersion);
    assert.equal((await providerB.refresh())?.version, activeVersion);
    const serviceA = new GameService(repositoryA, () => new Date(), undefined, undefined, undefined, providerA);
    const serviceB = new GameService(repositoryB, () => new Date(), undefined, undefined, undefined, providerB);
    await serviceA.createPlayer(playerCanary, createdAt);
    await serviceA.createPlayer(playerActive, createdAt);
    serverA = createGameHttpServer(serviceA);
    serverB = createGameHttpServer(serviceB);
    const [urlA, urlB] = await Promise.all([listen(serverA), listen(serverB)]);

    const canaryA = await request(urlA, playerCanary, '/v1/bootstrap');
    const canaryB = await request(urlB, playerCanary, '/v1/bootstrap');
    const activeA = await request(urlA, playerActive, '/v1/bootstrap');
    const activeB = await request(urlB, playerActive, '/v1/bootstrap');
    for (const response of [canaryA, canaryB, activeA, activeB]) assert.equal(response.status, 200, response.text);
    assert.equal(canaryA.body.configVersion, canaryVersion);
    assert.equal(canaryB.body.configVersion, canaryVersion);
    assert.equal(activeA.body.configVersion, activeVersion);
    assert.equal(activeB.body.configVersion, activeVersion);
    assert.equal(playerData(canaryA.body).player.configVersion, canaryVersion);
    assert.equal(playerData(activeA.body).player.configVersion, activeVersion);

    // The same player remains on the same side of the bucket across both
    // independently constructed provider/service/HTTP stacks.
    const canaryRepeat = await request(urlB, playerCanary, '/v1/bootstrap');
    assert.equal(canaryRepeat.body.configVersion, canaryVersion);

    // Commit an old-version settlement before promotion. It must remain
    // replayable after the canary becomes active everywhere.
    const start = await request(urlA, playerActive, '/v1/actions/start', { method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': `routing-start-${randomUUID()}` }, body: JSON.stringify({ actionId: 'training', expectedRevision: playerData(activeA.body).player.stateRevision }) });
    assert.equal(start.status, 200, start.text);
    const settlementId = randomUUID();
    await new Promise((resolve) => setTimeout(resolve, 25));
    const end = new Date().toISOString();
    const settled = await request(urlB, playerActive, '/v1/settlements/offline', { method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': settlementId }, body: JSON.stringify({ settlementId, requestedStartedAt: playerData(activeA.body).player.lastSettledAt, requestedEndedAt: end, expectedRevision: Number(start.body.stateRevision) }) });
    assert.equal(settled.status, 200, settled.text);
    assert.equal(settled.body.configVersion, activeVersion);
    const oldPayload = settled.body;

    await releaseRepository.activate(canaryVersion, new Date(createdAt.getTime() + 5_000));
    const promotedA = await request(urlA, playerActive, '/v1/bootstrap');
    const promotedB = await request(urlB, playerActive, '/v1/bootstrap');
    assert.equal(promotedA.body.configVersion, canaryVersion);
    assert.equal(promotedB.body.configVersion, canaryVersion);
    const replay = await request(urlB, playerActive, `/v1/replays/${settlementId}`);
    assert.equal(replay.status, 200, replay.text);
    assert.equal(replay.body.configVersion, canaryVersion);
    const replayData = replay.body.data as { configVersion: string; responsePayload: unknown };
    assert.equal(replayData.configVersion, activeVersion);
    assert.deepEqual(replayData.responsePayload, oldPayload);
    assert.equal((await new PostgresRepository(instancePoolA).getSettlement(settlementId))?.configVersion, activeVersion);
  } finally {
    if (serverA) await close(serverA);
    if (serverB) await close(serverB);
    await setupPool.query('TRUNCATE config_release_audit, config_release_settlement, config_release RESTART IDENTITY CASCADE');
    for (const playerId of [playerCanary, playerActive]) {
      await setupPool.query('DELETE FROM audit_event WHERE player_id = $1', [playerId]);
      await setupPool.query('DELETE FROM action_idempotency WHERE player_id = $1', [playerId]);
      await setupPool.query('DELETE FROM settlement_record WHERE player_id = $1', [playerId]);
      await setupPool.query('DELETE FROM dungeon_attempt WHERE player_id = $1', [playerId]);
      await setupPool.query('DELETE FROM building_job WHERE player_id = $1', [playerId]);
      await setupPool.query('DELETE FROM building_state WHERE player_id = $1', [playerId]);
      await setupPool.query('DELETE FROM inventory_resource WHERE player_id = $1', [playerId]);
      await setupPool.query('DELETE FROM equipment_instance WHERE player_id = $1', [playerId]);
      await setupPool.query('DELETE FROM collection_state WHERE player_id = $1', [playerId]);
      await setupPool.query('DELETE FROM progress_state WHERE player_id = $1', [playerId]);
      await setupPool.query('DELETE FROM player_state WHERE player_id = $1', [playerId]);
    }
    await Promise.all([setupPool.end(), instancePoolA.end(), instancePoolB.end()]);
    if (previousInsecureHeader === undefined) delete process.env.DONGTIAN_ALLOW_INSECURE_PLAYER_HEADER;
    else process.env.DONGTIAN_ALLOW_INSECURE_PLAYER_HEADER = previousInsecureHeader;
  }
});
