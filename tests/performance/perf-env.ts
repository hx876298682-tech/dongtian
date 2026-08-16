export type PerfEnvironment = {
  readonly baseUrl: string;
  readonly databaseUrl: string;
  readonly webOrigin: string;
  readonly allowSkip: boolean;
  readonly scenarioFilter: readonly string[] | null;
  readonly lockTimeoutCodes: readonly string[];
  readonly workerRestartCommand: string | null;
  readonly databaseOutageCommand: string | null;
};

export type PerfEnvironmentState =
  | { readonly configured: true; readonly env: PerfEnvironment }
  | {
      readonly configured: false;
      readonly missing: readonly string[];
      readonly allowSkip: boolean;
      readonly env: PerfEnvironment | null;
    };

function readStringEnv(name: string): string | null {
  const value = process.env[name];
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function readBooleanEnv(name: string): boolean {
  const value = readStringEnv(name);
  return value === '1' || value?.toLowerCase() === 'true' || value?.toLowerCase() === 'yes' || false;
}

function readListEnv(name: string): readonly string[] | null {
  const value = readStringEnv(name);
  if (value === null) {
    return null;
  }

  const entries = value
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);

  return entries.length === 0 ? null : entries;
}

export function loadPerfEnvironment(): PerfEnvironmentState {
  const baseUrl = readStringEnv('BASE_URL');
  const databaseUrl = readStringEnv('DATABASE_URL');
  const missing: string[] = [];

  if (baseUrl === null) {
    missing.push('BASE_URL');
  }
  if (databaseUrl === null) {
    missing.push('DATABASE_URL');
  }

  const defaultWebOrigin = baseUrl ?? '';
  const webOrigin = readStringEnv('WEB_ORIGIN') ?? defaultWebOrigin;
  const allowSkip = readBooleanEnv('PERF_ALLOW_SKIP');
  const scenarioFilter = readListEnv('PERF_SCENARIOS');
  const lockTimeoutCodes = readListEnv('PERF_LOCK_TIMEOUT_CODES') ?? ['LOCK_TIMEOUT', 'DEADLOCK_DETECTED', 'QUERY_TIMEOUT'];

  if (missing.length > 0) {
    return {
      configured: false,
      allowSkip,
      missing,
      env: null,
    };
  }

  return {
    configured: true,
    env: {
      allowSkip,
      baseUrl,
      databaseUrl,
      databaseOutageCommand: readStringEnv('PERF_DATABASE_OUTAGE_COMMAND'),
      lockTimeoutCodes,
      scenarioFilter,
      webOrigin,
      workerRestartCommand: readStringEnv('PERF_WORKER_RESTART_COMMAND'),
    },
  };
}
