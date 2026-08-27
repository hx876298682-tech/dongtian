import assert from 'node:assert/strict';
import test from 'node:test';
import { formatPreflightResult, runDeploymentPreflight } from './deployment-preflight.ts';

const base = {
  DATABASE_URL: 'postgresql://game:secret@db.example/dongtian',
  DONGTIAN_DB_POOL_MAX: '16',
  DONGTIAN_DB_CONNECT_TIMEOUT_MS: '5000',
  DONGTIAN_DB_STATEMENT_TIMEOUT_MS: '30000',
  DONGTIAN_DB_QUERY_TIMEOUT_MS: '35000',
  DONGTIAN_DB_IDLE_TIMEOUT_MS: '30000',
  DONGTIAN_DB_SSL_MODE: 'verify-full',
  DONGTIAN_AUTH_BACKEND: 'hs256',
  DONGTIAN_JWT_SECRET: 'x'.repeat(32),
  DONGTIAN_JWT_ISSUER: 'https://issuer.example',
  DONGTIAN_JWT_AUDIENCE: 'dongtian-api',
  DONGTIAN_METRICS_BACKEND: 'postgres',
  DONGTIAN_ALERT_BACKEND: 'webhook',
  DONGTIAN_ALERT_WEBHOOK_URL: 'https://alerts.example/hook',
  DONGTIAN_ALERT_WEBHOOK_TOKEN: 'redacted-test-token',
  DONGTIAN_PENDING_SCANNER_ENABLED: '1',
};

test('deployment preflight passes a complete production contract without external I/O', () => {
  const result = runDeploymentPreflight(base);
  assert.deepEqual(result, { ok: true, issues: [] });
  assert.equal(formatPreflightResult(result), 'deployment preflight: PASS');
});

test('deployment preflight rejects local fallbacks and weak production auth', () => {
  const result = runDeploymentPreflight({ ...base, DONGTIAN_ALLOW_MEMORY: '1', DONGTIAN_ALLOW_STATIC_CONFIG: '1', DONGTIAN_ALLOW_INSECURE_BEARER_TOKEN: '1', DONGTIAN_JWT_SECRET: 'short', DONGTIAN_METRICS_BACKEND: 'memory' });
  assert.equal(result.ok, false);
  assert.match(formatPreflightResult(result), /DONGTIAN_ALLOW_MEMORY: must not be enabled/);
  assert.match(formatPreflightResult(result), /DONGTIAN_JWT_SECRET: must contain at least 32 characters/);
  assert.match(formatPreflightResult(result), /DONGTIAN_METRICS_BACKEND: must be postgres/);
});

test('deployment preflight validates database and alert endpoint shape', () => {
  const result = runDeploymentPreflight({ ...base, DATABASE_URL: 'https://db.example?sslmode=require', DONGTIAN_ALERT_WEBHOOK_URL: 'http://alerts.example/hook' });
  assert.equal(result.ok, false);
  assert.match(formatPreflightResult(result), /DATABASE_URL: must use postgres/);
  assert.match(formatPreflightResult(result), /DATABASE_URL: must not include sslmode/);
  assert.match(formatPreflightResult(result), /alerts: DONGTIAN_ALERT_WEBHOOK_URL must use HTTPS/);
});

test('deployment preflight rejects unconfigured auth and memory alert fallback', () => {
  const result = runDeploymentPreflight({ ...base, DONGTIAN_AUTH_BACKEND: 'unconfigured', DONGTIAN_ALERT_BACKEND: 'memory' });
  assert.equal(result.ok, false);
  assert.match(formatPreflightResult(result), /auth: a production authentication backend must be configured/);
  assert.match(formatPreflightResult(result), /DONGTIAN_ALERT_BACKEND: must be webhook/);
});

test('deployment preflight rejects credentials embedded in the JWKS URL', () => {
  const result = runDeploymentPreflight({
    ...base,
    DONGTIAN_AUTH_BACKEND: 'jwks',
    DONGTIAN_JWKS_URL: 'https://user:secret@issuer.example/.well-known/jwks.json',
    DONGTIAN_JWKS_ISSUER: 'https://issuer.example',
    DONGTIAN_JWKS_AUDIENCE: 'dongtian-api',
  });
  assert.equal(result.ok, false);
  assert.match(formatPreflightResult(result), /auth: DONGTIAN_JWKS_URL must not contain credentials/);
});

test('deployment preflight rejects a disabled pending settlement scanner', () => {
  const result = runDeploymentPreflight({ ...base, DONGTIAN_PENDING_SCANNER_ENABLED: '0' });
  assert.equal(result.ok, false);
  assert.match(formatPreflightResult(result), /DONGTIAN_PENDING_SCANNER_ENABLED: must be 1 for deployment/);
});

test('deployment preflight validates every alert threshold before main startup', () => {
  const result = runDeploymentPreflight({ ...base, DONGTIAN_ALERT_SETTLEMENT_REJECTED_THRESHOLD: 'not-a-number', DONGTIAN_ALERT_DROP_DEVIATION_THRESHOLD: '0' });
  assert.equal(result.ok, false);
  assert.match(formatPreflightResult(result), /DONGTIAN_ALERT_SETTLEMENT_REJECTED_THRESHOLD: must be an integer between 1 and 9007199254740991/);
  assert.match(formatPreflightResult(result), /DONGTIAN_ALERT_DROP_DEVIATION_THRESHOLD: must be an integer between 1 and 9007199254740991/);
});

test('deployment preflight validates the bounded alert shutdown drain timeout', () => {
  const result = runDeploymentPreflight({ ...base, DONGTIAN_ALERT_SHUTDOWN_TIMEOUT_MS: '120001' });
  assert.equal(result.ok, false);
  assert.match(formatPreflightResult(result), /DONGTIAN_ALERT_SHUTDOWN_TIMEOUT_MS: must be an integer between 0 and 120000/);
});

test('deployment preflight validates the bounded HTTP shutdown timeout', () => {
  const result = runDeploymentPreflight({ ...base, DONGTIAN_HTTP_SHUTDOWN_TIMEOUT_MS: '120001' });
  assert.equal(result.ok, false);
  assert.match(formatPreflightResult(result), /DONGTIAN_HTTP_SHUTDOWN_TIMEOUT_MS: must be an integer between 0 and 120000/);
});

test('deployment preflight validates the pending scanner lease duration', () => {
  const result = runDeploymentPreflight({ ...base, DONGTIAN_PENDING_SCANNER_LEASE_MS: '0' });
  assert.equal(result.ok, false);
  assert.match(formatPreflightResult(result), /DONGTIAN_PENDING_SCANNER_LEASE_MS: must be an integer between 1 and 86400000/);
});

test('deployment preflight validates the HTTP request body limit when supplied', () => {
  const result = runDeploymentPreflight({ ...base, DONGTIAN_HTTP_MAX_BODY_BYTES: '10485761' });
  assert.equal(result.ok, false);
  assert.match(formatPreflightResult(result), /DONGTIAN_HTTP_MAX_BODY_BYTES: must be an integer between 1 and 10485760/);
});

test('deployment preflight requires explicit bounded PostgreSQL runtime settings', () => {
  const env: NodeJS.ProcessEnv = { ...base };
  for (const key of ['DONGTIAN_DB_POOL_MAX', 'DONGTIAN_DB_CONNECT_TIMEOUT_MS', 'DONGTIAN_DB_STATEMENT_TIMEOUT_MS', 'DONGTIAN_DB_QUERY_TIMEOUT_MS', 'DONGTIAN_DB_IDLE_TIMEOUT_MS', 'DONGTIAN_DB_SSL_MODE']) delete env[key];
  const result = runDeploymentPreflight(env);
  assert.equal(result.ok, false);
  assert.match(formatPreflightResult(result), /DONGTIAN_DB_POOL_MAX: must be explicitly configured/);
  assert.match(formatPreflightResult(result), /DONGTIAN_DB_SSL_MODE: must be explicitly configured/);
});

test('deployment preflight rejects unsafe PostgreSQL settings and timeout inversion', () => {
  const result = runDeploymentPreflight({ ...base, DONGTIAN_DB_POOL_MAX: '201', DONGTIAN_DB_CONNECT_TIMEOUT_MS: '0', DONGTIAN_DB_SSL_MODE: 'require', DONGTIAN_DB_STATEMENT_TIMEOUT_MS: '40000', DONGTIAN_DB_QUERY_TIMEOUT_MS: '30000' });
  assert.equal(result.ok, false);
  assert.match(formatPreflightResult(result), /DONGTIAN_DB_POOL_MAX: must be an integer between 1 and 200/);
  assert.match(formatPreflightResult(result), /DONGTIAN_DB_CONNECT_TIMEOUT_MS: must be an integer between 1 and 120000/);
  assert.match(formatPreflightResult(result), /DONGTIAN_DB_SSL_MODE: must be verify-full for deployment/);
  assert.match(formatPreflightResult(result), /DONGTIAN_DB_QUERY_TIMEOUT_MS: must be greater than or equal to/);
});
