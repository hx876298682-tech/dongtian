import { createAuthProvider, AuthConfigurationError } from './auth.ts';
import { createMetricsAlertDispatcher, MetricsAlertConfigError } from './metrics-alerts.ts';
import { postgresRuntimeIssues } from './postgres-runtime.ts';
import { MAX_HTTP_MAX_BODY_BYTES } from './http.ts';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export type PreflightIssue = { key: string; message: string };
export type PreflightResult = { ok: boolean; issues: PreflightIssue[] };

const required = (env: NodeJS.ProcessEnv, key: string, issues: PreflightIssue[]): string | undefined => {
  const value = env[key]?.trim();
  if (!value) issues.push({ key, message: 'is required' });
  return value || undefined;
};

const positiveInteger = (env: NodeJS.ProcessEnv, key: string, issues: PreflightIssue[], max: number, min = 1): void => {
  const raw = env[key];
  if (raw === undefined) return;
  if (!/^\d+$/.test(raw) || !Number.isSafeInteger(Number(raw)) || Number(raw) < min || Number(raw) > max) {
    issues.push({ key, message: `must be an integer between ${min} and ${max}` });
  }
};

const ALERT_THRESHOLD_KEYS = [
  'DONGTIAN_ALERT_SETTLEMENT_REJECTED_THRESHOLD',
  'DONGTIAN_ALERT_SETTLEMENT_DUPLICATE_THRESHOLD',
  'DONGTIAN_ALERT_SETTLEMENT_STALE_THRESHOLD',
  'DONGTIAN_ALERT_RESOURCE_OVERFLOW_THRESHOLD',
  'DONGTIAN_ALERT_INVENTORY_FULL_THRESHOLD',
  'DONGTIAN_ALERT_MAP_FAILURE_THRESHOLD',
  'DONGTIAN_ALERT_DUNGEON_FAILURE_THRESHOLD',
  'DONGTIAN_ALERT_PENDING_SETTLEMENTS_THRESHOLD',
  'DONGTIAN_ALERT_DROP_DEVIATION_THRESHOLD',
  'DONGTIAN_ALERT_ECONOMIC_ANOMALY_THRESHOLD',
] as const;

export const runDeploymentPreflight = (env: NodeJS.ProcessEnv = process.env): PreflightResult => {
  const issues: PreflightIssue[] = [];
  const databaseUrl = required(env, 'DATABASE_URL', issues);
  if (databaseUrl) {
    try {
      const url = new URL(databaseUrl);
      if (url.protocol !== 'postgres:' && url.protocol !== 'postgresql:') issues.push({ key: 'DATABASE_URL', message: 'must use postgres:// or postgresql://' });
      if (url.searchParams.has('sslmode')) issues.push({ key: 'DATABASE_URL', message: 'must not include sslmode; configure DONGTIAN_DB_SSL_MODE explicitly' });
    } catch { issues.push({ key: 'DATABASE_URL', message: 'must be a valid PostgreSQL URL' }); }
    for (const issue of postgresRuntimeIssues(env, { requireExplicit: true, production: true })) issues.push(issue);
  }
  for (const key of ['DONGTIAN_ALLOW_MEMORY', 'DONGTIAN_ALLOW_STATIC_CONFIG', 'DONGTIAN_ALLOW_INSECURE_PLAYER_HEADER', 'DONGTIAN_ALLOW_INSECURE_BEARER_TOKEN']) {
    if (env[key] === '1') issues.push({ key, message: 'must not be enabled for deployment' });
  }

  const backend = env.DONGTIAN_AUTH_BACKEND ?? (env.DONGTIAN_JWKS_URL ? 'jwks' : env.DONGTIAN_JWT_SECRET ? 'hs256' : 'unconfigured');
  if (backend === 'unconfigured') issues.push({ key: 'auth', message: 'a production authentication backend must be configured' });
  if (backend === 'hs256') {
    const secret = required(env, 'DONGTIAN_JWT_SECRET', issues);
    if (secret && secret.length < 32) issues.push({ key: 'DONGTIAN_JWT_SECRET', message: 'must contain at least 32 characters' });
    required(env, 'DONGTIAN_JWT_ISSUER', issues);
    required(env, 'DONGTIAN_JWT_AUDIENCE', issues);
  }
  try { createAuthProvider(env); } catch (error) {
    if (error instanceof AuthConfigurationError) issues.push({ key: 'auth', message: error.message });
  }

  if ((env.DONGTIAN_METRICS_BACKEND ?? 'memory') !== 'postgres') issues.push({ key: 'DONGTIAN_METRICS_BACKEND', message: 'must be postgres for deployment' });
  if ((env.DONGTIAN_ALERT_BACKEND ?? 'memory') !== 'webhook') issues.push({ key: 'DONGTIAN_ALERT_BACKEND', message: 'must be webhook for deployment' });
  if (env.DONGTIAN_PENDING_SCANNER_ENABLED !== '1') issues.push({ key: 'DONGTIAN_PENDING_SCANNER_ENABLED', message: 'must be 1 for deployment' });
  try { createMetricsAlertDispatcher(env); } catch (error) {
    if (error instanceof MetricsAlertConfigError) issues.push({ key: 'alerts', message: error.message });
  }
  positiveInteger(env, 'DONGTIAN_ALERT_INTERVAL_MS', issues, 86_400_000, 1000);
  positiveInteger(env, 'DONGTIAN_ALERT_SHUTDOWN_TIMEOUT_MS', issues, 120_000, 0);
  positiveInteger(env, 'DONGTIAN_HTTP_SHUTDOWN_TIMEOUT_MS', issues, 120_000, 0);
  for (const key of ALERT_THRESHOLD_KEYS) positiveInteger(env, key, issues, Number.MAX_SAFE_INTEGER);
  positiveInteger(env, 'DONGTIAN_PENDING_SCANNER_INTERVAL_MS', issues, 86_400_000);
  positiveInteger(env, 'DONGTIAN_PENDING_SCANNER_BATCH_SIZE', issues, 10_000);
  positiveInteger(env, 'DONGTIAN_PENDING_SCANNER_MIN_AGE_MS', issues, 86_400_000);
  positiveInteger(env, 'DONGTIAN_PENDING_SCANNER_LEASE_MS', issues, 86_400_000);
  positiveInteger(env, 'DONGTIAN_HTTP_MAX_BODY_BYTES', issues, MAX_HTTP_MAX_BODY_BYTES);
  positiveInteger(env, 'PORT', issues, 65_535);
  return { ok: issues.length === 0, issues };
};

export const formatPreflightResult = (result: PreflightResult): string => result.ok
  ? 'deployment preflight: PASS'
  : ['deployment preflight: FAIL', ...result.issues.map(({ key, message }) => `- ${key}: ${message}`)].join('\n');

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const result = runDeploymentPreflight();
  process.stdout.write(`${formatPreflightResult(result)}\n`);
  if (!result.ok) process.exitCode = 1;
}
