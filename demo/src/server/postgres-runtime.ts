export type PostgresSslMode = 'disable' | 'require' | 'verify-full';

export type PostgresRuntimeConfig = {
  poolMax: number;
  connectTimeoutMs: number;
  statementTimeoutMs: number;
  queryTimeoutMs: number;
  idleTimeoutMs: number;
  sslMode: PostgresSslMode;
  sslCa?: string;
};

export type PostgresRuntimeIssue = { key: string; message: string };

export class PostgresRuntimeConfigError extends Error {
  readonly issues: PostgresRuntimeIssue[];

  constructor(issues: PostgresRuntimeIssue[] | PostgresRuntimeIssue) {
    const normalized = Array.isArray(issues) ? issues : [issues];
    super(normalized.map(({ key, message }) => `${key}: ${message}`).join('; '));
    this.name = 'PostgresRuntimeConfigError';
    this.issues = normalized;
  }
}

export type PostgresRuntimeReadOptions = {
  /** Require every runtime value to be explicitly supplied, as deployment does. */
  requireExplicit?: boolean;
  /** Require TLS verification, rather than merely accepting encrypted transport. */
  production?: boolean;
};

const integer = (
  env: NodeJS.ProcessEnv,
  key: string,
  fallback: number,
  min: number,
  max: number,
  issues: PostgresRuntimeIssue[],
  requireExplicit: boolean,
): number => {
  const raw = env[key];
  if (raw === undefined || raw.trim() === '') {
    if (requireExplicit) issues.push({ key, message: 'must be explicitly configured for deployment' });
    return fallback;
  }
  if (!/^\d+$/.test(raw)) {
    issues.push({ key, message: `must be an integer between ${min} and ${max}` });
    return fallback;
  }
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    issues.push({ key, message: `must be an integer between ${min} and ${max}` });
    return fallback;
  }
  return value;
};

const readSslMode = (env: NodeJS.ProcessEnv, issues: PostgresRuntimeIssue[], options: PostgresRuntimeReadOptions): PostgresSslMode => {
  const raw = env.DONGTIAN_DB_SSL_MODE;
  if (raw === undefined || raw.trim() === '') {
    if (options.requireExplicit) issues.push({ key: 'DONGTIAN_DB_SSL_MODE', message: 'must be explicitly configured for deployment' });
    return 'disable';
  }
  const mode = raw.trim().toLowerCase();
  if (mode !== 'disable' && mode !== 'require' && mode !== 'verify-full') {
    issues.push({ key: 'DONGTIAN_DB_SSL_MODE', message: 'must be disable, require, or verify-full' });
    return 'disable';
  }
  if (options.production && mode !== 'verify-full') {
    issues.push({ key: 'DONGTIAN_DB_SSL_MODE', message: 'must be verify-full for deployment' });
  }
  return mode;
};

/**
 * Validate the non-secret PostgreSQL process contract without connecting to the
 * database. The same parser is used by startup and deployment preflight.
 */
export const postgresRuntimeIssues = (env: NodeJS.ProcessEnv = process.env, options: PostgresRuntimeReadOptions = {}): PostgresRuntimeIssue[] => {
  const issues: PostgresRuntimeIssue[] = [];
  const requireExplicit = options.requireExplicit ?? false;
  const poolMax = integer(env, 'DONGTIAN_DB_POOL_MAX', 10, 1, 200, issues, requireExplicit);
  const connectTimeoutMs = integer(env, 'DONGTIAN_DB_CONNECT_TIMEOUT_MS', 5_000, 1, 120_000, issues, requireExplicit);
  const statementTimeoutMs = integer(env, 'DONGTIAN_DB_STATEMENT_TIMEOUT_MS', 30_000, 1, 600_000, issues, requireExplicit);
  const queryTimeoutMs = integer(env, 'DONGTIAN_DB_QUERY_TIMEOUT_MS', 35_000, 1, 600_000, issues, requireExplicit);
  integer(env, 'DONGTIAN_DB_IDLE_TIMEOUT_MS', 30_000, 1_000, 600_000, issues, requireExplicit);
  const sslMode = readSslMode(env, issues, options);
  const sslCa = env.DONGTIAN_DB_SSL_CA?.trim() || undefined;
  if (sslCa && sslMode === 'disable') issues.push({ key: 'DONGTIAN_DB_SSL_CA', message: 'requires DONGTIAN_DB_SSL_MODE=verify-full or require' });
  if (queryTimeoutMs < statementTimeoutMs) issues.push({ key: 'DONGTIAN_DB_QUERY_TIMEOUT_MS', message: 'must be greater than or equal to DONGTIAN_DB_STATEMENT_TIMEOUT_MS' });
  // Keep this check here so invalid values still produce all useful diagnostics.
  void poolMax;
  void connectTimeoutMs;
  return issues;
};

export const readPostgresRuntimeConfig = (env: NodeJS.ProcessEnv = process.env, options: PostgresRuntimeReadOptions = {}): PostgresRuntimeConfig => {
  const issues = postgresRuntimeIssues(env, options);
  if (issues.length > 0) throw new PostgresRuntimeConfigError(issues);
  const poolMax = Number(env.DONGTIAN_DB_POOL_MAX ?? 10);
  const connectTimeoutMs = Number(env.DONGTIAN_DB_CONNECT_TIMEOUT_MS ?? 5_000);
  const statementTimeoutMs = Number(env.DONGTIAN_DB_STATEMENT_TIMEOUT_MS ?? 30_000);
  const queryTimeoutMs = Number(env.DONGTIAN_DB_QUERY_TIMEOUT_MS ?? 35_000);
  const idleTimeoutMs = Number(env.DONGTIAN_DB_IDLE_TIMEOUT_MS ?? 30_000);
  const sslMode = (env.DONGTIAN_DB_SSL_MODE?.trim().toLowerCase() || 'disable') as PostgresSslMode;
  const sslCa = env.DONGTIAN_DB_SSL_CA?.trim() || undefined;
  return { poolMax, connectTimeoutMs, statementTimeoutMs, queryTimeoutMs, idleTimeoutMs, sslMode, ...(sslCa ? { sslCa } : {}) };
};

/** node-postgres Pool options derived from the validated runtime contract. */
export const postgresPoolOptions = (config: PostgresRuntimeConfig): {
  max: number;
  connectionTimeoutMillis: number;
  statement_timeout: number;
  query_timeout: number;
  idleTimeoutMillis: number;
  ssl: false | { rejectUnauthorized: boolean; ca?: string };
} => ({
  max: config.poolMax,
  connectionTimeoutMillis: config.connectTimeoutMs,
  statement_timeout: config.statementTimeoutMs,
  query_timeout: config.queryTimeoutMs,
  idleTimeoutMillis: config.idleTimeoutMs,
  ssl: config.sslMode === 'disable'
    ? false
    : { rejectUnauthorized: config.sslMode === 'verify-full', ...(config.sslCa ? { ca: config.sslCa } : {}) },
});
