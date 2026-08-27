import assert from 'node:assert/strict';
import { createSign, generateKeyPairSync } from 'node:crypto';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { formatProductionAcceptance, runProductionAcceptance, validateCapacitySlo, validateScannerEvidence } from './production-acceptance.ts';

const b64 = (value: string): string => Buffer.from(value).toString('base64url');

const createFixture = async () => {
  const directory = await mkdtemp(join(tmpdir(), 'dongtian-acceptance-'));
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const jwk = publicKey.export({ format: 'jwk' }) as JsonWebKey;
  const key = { ...jwk, kid: 'acceptance-key-1', alg: 'RS256', use: 'sig' };
  const now = Math.floor(Date.now() / 1000);
  const header = b64(JSON.stringify({ alg: 'RS256', typ: 'JWT', kid: key.kid }));
  const claims = b64(JSON.stringify({ sub: 'acceptance-player', iss: 'https://issuer.example', aud: 'dongtian-api', iat: now, exp: now + 600 }));
  const signingInput = `${header}.${claims}`;
  const signer = createSign('RSA-SHA256');
  signer.update(signingInput);
  signer.end();
  const token = `${signingInput}.${signer.sign(privateKey).toString('base64url')}`;
  const scanner = {
    generatedAt: new Date().toISOString(), instanceIds: ['instance-a', 'instance-b'], attemptedSettlements: 10,
    committedSettlements: 9, rejectedSettlements: 1, retryableSettlements: 0, duplicateCommits: 0,
    crossInstanceClaimObserved: true, expiredLeaseRecoveredSettlements: 1,
  };
  const report = {
    generatedAt: new Date().toISOString(), players: 64, rounds: 24, settlements: 1536,
    successfulSettlements: 1536, failedSettlements: 0, throughputPerSecond: 1100,
    latencyMs: { p50: 20, p95: 40, p99: 60, max: 70 }, errors: [],
  };
  const slo = { minimumPlayers: 64, minimumRounds: 24, minimumSettlements: 1536, minimumThroughputPerSecond: 1000, maximumErrorRate: 0, maximumP50Ms: 50, maximumP95Ms: 75, maximumP99Ms: 100 };
  const files = {
    jwt: join(directory, 'jwt'), scanner: join(directory, 'scanner.json'), report: join(directory, 'capacity.json'), slo: join(directory, 'slo.json'),
  };
  await Promise.all([
    writeFile(files.jwt, token), writeFile(files.scanner, JSON.stringify(scanner)), writeFile(files.report, JSON.stringify(report)), writeFile(files.slo, JSON.stringify(slo)),
  ]);
  return { key, token, files, jwks: { keys: [key] } };
};

const envFor = (fixture: Awaited<ReturnType<typeof createFixture>>): NodeJS.ProcessEnv => ({
  DATABASE_URL: 'postgresql://game:secret@db.example/dongtian', DONGTIAN_DB_POOL_MAX: '16', DONGTIAN_DB_CONNECT_TIMEOUT_MS: '5000',
  DONGTIAN_DB_STATEMENT_TIMEOUT_MS: '30000', DONGTIAN_DB_QUERY_TIMEOUT_MS: '35000', DONGTIAN_DB_IDLE_TIMEOUT_MS: '30000', DONGTIAN_DB_SSL_MODE: 'verify-full',
  DONGTIAN_AUTH_BACKEND: 'jwks', DONGTIAN_JWKS_URL: 'https://issuer.example/.well-known/jwks.json', DONGTIAN_JWKS_ISSUER: 'https://issuer.example', DONGTIAN_JWKS_AUDIENCE: 'dongtian-api',
  DONGTIAN_METRICS_BACKEND: 'postgres', DONGTIAN_ALERT_BACKEND: 'webhook', DONGTIAN_ALERT_WEBHOOK_URL: 'https://alerts.example/hook', DONGTIAN_ALERT_WEBHOOK_TOKEN: 'test-token', DONGTIAN_PENDING_SCANNER_ENABLED: '1',
  DONGTIAN_ACCEPTANCE_INSTANCE_URLS: 'https://api-a.example,https://api-b.example', DONGTIAN_ACCEPTANCE_JWKS_URL: 'https://issuer.example/.well-known/jwks.json', DONGTIAN_ACCEPTANCE_JWKS_ISSUER: 'https://issuer.example', DONGTIAN_ACCEPTANCE_JWKS_AUDIENCE: 'dongtian-api', DONGTIAN_ACCEPTANCE_JWT_FILE: fixture.files.jwt,
  DONGTIAN_ACCEPTANCE_WEBHOOK_URL: 'https://alerts.example/hook', DONGTIAN_ACCEPTANCE_SCANNER_EVIDENCE_FILE: fixture.files.scanner, DONGTIAN_ACCEPTANCE_CAPACITY_REPORT_FILE: fixture.files.report, DONGTIAN_ACCEPTANCE_CAPACITY_SLO_FILE: fixture.files.slo,
});

test('production acceptance is fail-closed when required environment inputs are absent', async () => {
  const result = await runProductionAcceptance({});
  assert.equal(result.ok, false);
  assert.equal(result.checks[0]?.status, 'fail');
  assert.match(formatProductionAcceptance(result), /acceptance-inputs/);
  assert.ok(result.checks.every((item, index) => index === 0 || item.status === 'not_run'));
});

test('production acceptance verifies JWKS, JWT claims, probes, scanner evidence and capacity SLO', async () => {
  const fixture = await createFixture();
  const env = envFor(fixture);
  const fetchFn = async (input: string | URL, init?: RequestInit): Promise<Response> => {
    const url = String(input);
    if (url === env.DONGTIAN_ACCEPTANCE_JWKS_URL) return new Response(JSON.stringify(fixture.jwks), { status: 200, headers: { 'content-type': 'application/json' } });
    if (url.endsWith('/healthz')) return new Response(JSON.stringify({ status: 'ok' }), { status: 200 });
    if (url.endsWith('/readyz')) return new Response(JSON.stringify({ status: 'ok', checks: { database: 'up', config: 'up', scanner: 'up' } }), { status: 200 });
    if (url.includes('/v1/leaderboards/combat_power?limit=1&offset=0') && init?.headers && new Headers(init.headers).get('authorization') === `Bearer ${fixture.token}`) return new Response(JSON.stringify({ data: { entries: [], total: 0 } }), { status: 200 });
    if (url === env.DONGTIAN_ACCEPTANCE_WEBHOOK_URL && init?.method === 'HEAD') return new Response(null, { status: 204 });
    throw new Error(`unexpected fetch ${url}`);
  };
  const result = await runProductionAcceptance(env, fetchFn, Date.now());
  assert.equal(result.ok, true, formatProductionAcceptance(result));
  assert.ok(result.checks.every((item) => item.status === 'pass'));
});

test('production acceptance rejects a webhook probe that is reachable but unauthorized', async () => {
  const fixture = await createFixture();
  const env = envFor(fixture);
  const fetchFn = async (input: string | URL, init?: RequestInit): Promise<Response> => {
    const url = String(input);
    if (url === env.DONGTIAN_ACCEPTANCE_JWKS_URL) return new Response(JSON.stringify(fixture.jwks), { status: 200 });
    if (url.endsWith('/healthz')) return new Response(JSON.stringify({ status: 'ok' }), { status: 200 });
    if (url.endsWith('/readyz')) return new Response(JSON.stringify({ status: 'ok', checks: { database: 'up', config: 'up', scanner: 'up' } }), { status: 200 });
    if (url.includes('/v1/leaderboards/combat_power?limit=1&offset=0')) return new Response(JSON.stringify({ data: { entries: [], total: 0 } }), { status: 200 });
    if (url === env.DONGTIAN_ACCEPTANCE_WEBHOOK_URL && init?.method === 'HEAD') return new Response(null, { status: 401 });
    throw new Error(`unexpected fetch ${url}`);
  };
  const result = await runProductionAcceptance(env, fetchFn, Date.now());
  assert.equal(result.ok, false);
  assert.equal(result.checks.find((item) => item.name === 'webhook-reachability')?.status, 'fail');
  assert.match(formatProductionAcceptance(result), /webhook endpoint returned HTTP 401/);
});

test('production acceptance rejects an instance that does not accept the verified JWT', async () => {
  const fixture = await createFixture();
  const env = envFor(fixture);
  const fetchFn = async (input: string | URL, init?: RequestInit): Promise<Response> => {
    const url = String(input);
    if (url === env.DONGTIAN_ACCEPTANCE_JWKS_URL) return new Response(JSON.stringify(fixture.jwks), { status: 200 });
    if (url.endsWith('/healthz')) return new Response(JSON.stringify({ status: 'ok' }), { status: 200 });
    if (url.endsWith('/readyz')) return new Response(JSON.stringify({ status: 'ok', checks: { database: 'up', config: 'up', scanner: 'up' } }), { status: 200 });
    if (url.includes('/v1/leaderboards/combat_power?limit=1&offset=0')) return new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401 });
    if (url === env.DONGTIAN_ACCEPTANCE_WEBHOOK_URL && init?.method === 'HEAD') return new Response(null, { status: 204 });
    throw new Error(`unexpected fetch ${url}`);
  };
  const result = await runProductionAcceptance(env, fetchFn, Date.now());
  assert.equal(result.ok, false);
  assert.equal(result.checks.find((item) => item.name === 'instance-health-readiness')?.status, 'fail');
  assert.match(formatProductionAcceptance(result), /authenticated probe returned HTTP 401/);
});

test('scanner evidence rejects duplicate commits, missing cross-instance claim and stale evidence', () => {
  const base = { generatedAt: new Date().toISOString(), instanceIds: ['a', 'b'], attemptedSettlements: 1, committedSettlements: 1, rejectedSettlements: 0, retryableSettlements: 0, duplicateCommits: 0, crossInstanceClaimObserved: true, expiredLeaseRecoveredSettlements: 1 };
  assert.throws(() => validateScannerEvidence({ ...base, duplicateCommits: 1 }, 60_000), /duplicate commits/);
  assert.throws(() => validateScannerEvidence({ ...base, crossInstanceClaimObserved: false }, 60_000), /cross-instance claim/);
  assert.throws(() => validateScannerEvidence({ ...base, generatedAt: new Date(Date.now() - 120_000).toISOString() }, 60_000), /older than/);
});

test('capacity SLO validation rejects malformed counts, stale reports and threshold violations', () => {
  const report = { generatedAt: new Date().toISOString(), players: 2, rounds: 2, settlements: 4, successfulSettlements: 3, failedSettlements: 1, throughputPerSecond: 10, latencyMs: { p50: 10, p95: 20, p99: 30, max: 40 }, errors: [{ playerId: 'p1', round: 1, message: 'failed' }] };
  const slo = { minimumPlayers: 2, minimumRounds: 2, minimumSettlements: 4, minimumThroughputPerSecond: 20, maximumErrorRate: 0, maximumP50Ms: 10, maximumP95Ms: 20, maximumP99Ms: 30 };
  assert.throws(() => validateCapacitySlo(report, slo, 60_000), /throughput/);
  assert.throws(() => validateCapacitySlo({ ...report, generatedAt: new Date(Date.now() - 120_000).toISOString() }, { ...slo, minimumThroughputPerSecond: 1, maximumErrorRate: 1 }, 60_000), /older than/);
  assert.throws(() => validateCapacitySlo({ ...report, failedSettlements: 2 }, { ...slo, minimumThroughputPerSecond: 1, maximumErrorRate: 1 }, 60_000), /counts must equal/);
  assert.throws(() => validateCapacitySlo({ ...report, errors: [{ playerId: '', round: 1, message: 'failed' }] }, { ...slo, minimumThroughputPerSecond: 1, maximumErrorRate: 1 }, 60_000), /error 0 playerId/);
  assert.throws(() => validateCapacitySlo({ ...report, errors: [{ playerId: 'p1', round: 0, message: 'failed' }] }, { ...slo, minimumThroughputPerSecond: 1, maximumErrorRate: 1 }, 60_000), /error 0 round/);
});
