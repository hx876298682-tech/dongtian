export interface E2EEnvironment {
  readonly apiHost: string;
  readonly apiOrigin: string;
  readonly apiPort: number;
  readonly csrfSecret: string;
  readonly databaseUrl: string;
  readonly randomSeedEncryptionKey: string;
  readonly sessionSecret: string;
  readonly testDatabaseUrl: string;
  readonly webOrigin: string;
  readonly webPort: number;
}

function readStringEnv(name: string, fallback: string): string {
  const value = process.env[name];
  return typeof value === 'string' && value.length > 0 ? value : fallback;
}

function readNumberEnv(name: string, fallback: number): number {
  const value = process.env[name];
  if (typeof value !== 'string' || value.length === 0) {
    return fallback;
  }

  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`Invalid ${name}: ${value}`);
  }

  return parsed;
}

export function loadE2EEnvironment(): E2EEnvironment {
  const apiHost = readStringEnv('E2E_API_HOST', '127.0.0.1');
  const apiPort = readNumberEnv('E2E_API_PORT', 3000);
  const webPort = readNumberEnv('E2E_WEB_PORT', 5173);
  const webOrigin = readStringEnv('E2E_WEB_ORIGIN', `http://127.0.0.1:${webPort}`);
  const apiOrigin = readStringEnv('E2E_API_ORIGIN', `http://${apiHost}:${apiPort}`);
  const testDatabaseUrl = readStringEnv(
    'TEST_DATABASE_URL',
    'postgresql://dongtian_test:dongtian_test@127.0.0.1:5433/dongtian_test',
  );

  return {
    apiHost,
    apiOrigin,
    apiPort,
    csrfSecret: readStringEnv('CSRF_SECRET', 'replace-with-a-local-development-secret'),
    databaseUrl: readStringEnv('DATABASE_URL', testDatabaseUrl),
    randomSeedEncryptionKey: readStringEnv(
      'RANDOM_SEED_ENCRYPTION_KEY',
      'replace-with-a-local-development-key',
    ),
    sessionSecret: readStringEnv('SESSION_SECRET', 'replace-with-a-local-development-secret'),
    testDatabaseUrl,
    webOrigin,
    webPort,
  };
}
