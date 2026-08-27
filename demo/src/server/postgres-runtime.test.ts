import assert from 'node:assert/strict';
import test from 'node:test';
import { postgresPoolOptions, postgresRuntimeIssues, readPostgresRuntimeConfig, PostgresRuntimeConfigError } from './postgres-runtime.ts';

const production = {
  DONGTIAN_DB_POOL_MAX: '16',
  DONGTIAN_DB_CONNECT_TIMEOUT_MS: '5000',
  DONGTIAN_DB_STATEMENT_TIMEOUT_MS: '30000',
  DONGTIAN_DB_QUERY_TIMEOUT_MS: '35000',
  DONGTIAN_DB_IDLE_TIMEOUT_MS: '30000',
  DONGTIAN_DB_SSL_MODE: 'verify-full',
  DONGTIAN_DB_SSL_CA: '-----BEGIN CERTIFICATE-----\nci\n-----END CERTIFICATE-----',
};

test('PostgreSQL runtime config maps validated values to node-postgres options', () => {
  const config = readPostgresRuntimeConfig(production, { requireExplicit: true, production: true });
  assert.deepEqual(config, {
    poolMax: 16,
    connectTimeoutMs: 5000,
    statementTimeoutMs: 30000,
    queryTimeoutMs: 35000,
    idleTimeoutMs: 30000,
    sslMode: 'verify-full',
    sslCa: production.DONGTIAN_DB_SSL_CA,
  });
  assert.deepEqual(postgresPoolOptions(config), {
    max: 16,
    connectionTimeoutMillis: 5000,
    statement_timeout: 30000,
    query_timeout: 35000,
    idleTimeoutMillis: 30000,
    ssl: { rejectUnauthorized: true, ca: production.DONGTIAN_DB_SSL_CA },
  });
});

test('production runtime config requires explicit timeouts, pool size and verified TLS', () => {
  const issues = postgresRuntimeIssues({}, { requireExplicit: true, production: true });
  assert.deepEqual(new Set(issues.map((issue) => issue.key)), new Set([
    'DONGTIAN_DB_POOL_MAX',
    'DONGTIAN_DB_CONNECT_TIMEOUT_MS',
    'DONGTIAN_DB_STATEMENT_TIMEOUT_MS',
    'DONGTIAN_DB_QUERY_TIMEOUT_MS',
    'DONGTIAN_DB_IDLE_TIMEOUT_MS',
    'DONGTIAN_DB_SSL_MODE',
  ]));
  assert.throws(() => readPostgresRuntimeConfig({ ...production, DONGTIAN_DB_QUERY_TIMEOUT_MS: '100' }, { requireExplicit: true, production: true }), PostgresRuntimeConfigError);
});

test('runtime config rejects malformed ranges and CA without TLS', () => {
  const issues = postgresRuntimeIssues({ ...production, DONGTIAN_DB_POOL_MAX: '0', DONGTIAN_DB_SSL_MODE: 'disable', DONGTIAN_DB_SSL_CA: 'ca' });
  assert.ok(issues.some((issue) => issue.key === 'DONGTIAN_DB_POOL_MAX'));
  assert.ok(issues.some((issue) => issue.key === 'DONGTIAN_DB_SSL_CA'));
});
