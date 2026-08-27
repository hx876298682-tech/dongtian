import { createGameHttpServer, readHttpMaxBodyBytes } from './http.ts';
import { GameService } from './service.ts';
import { MemoryRepository } from './repository.ts';
import { PostgresRepository } from './postgres-repository.ts';
import { PostgresConfigReleaseProvider, PostgresConfigReleaseRepository } from './config-release-postgres.ts';
import { MetricsCollector } from './metrics.ts';
import type { MetricsThresholds } from './metrics.ts';
import { PostgresMetricsStore } from './metrics-postgres.ts';
import { PendingSettlementScanner } from './pending-settlement-scanner.ts';
import { applyMigrations } from './migrations.ts';
import { Pool } from 'pg';
import type { ContentPackage } from '../content/content-schema.ts';
import { createMetricsAlertDispatcher } from './metrics-alerts.ts';
import { createAuthProvider } from './auth.ts';
import { postgresPoolOptions, readPostgresRuntimeConfig } from './postgres-runtime.ts';
import { closeHttpServerBounded } from './http-shutdown.ts';
import type { Socket } from 'node:net';

const databaseUrl = process.env.DATABASE_URL;
const allowMemory = process.env.DONGTIAN_ALLOW_MEMORY === '1';
if (!databaseUrl && !allowMemory) throw new Error('DATABASE_URL is required; set DONGTIAN_ALLOW_MEMORY=1 only for an explicit local test run');
const jwtSecret = process.env.DONGTIAN_JWT_SECRET;
const allowInsecureAuth = process.env.DONGTIAN_ALLOW_INSECURE_PLAYER_HEADER === '1' || process.env.DONGTIAN_ALLOW_INSECURE_BEARER_TOKEN === '1';
const authProvider = createAuthProvider(process.env);
if (authProvider.backend === 'unconfigured' && !allowInsecureAuth) throw new Error('configure DONGTIAN_JWT_SECRET or DONGTIAN_AUTH_BACKEND=jwks; use an explicit insecure auth flag only for local tests');
if (authProvider.backend === 'hs256' && jwtSecret !== undefined && jwtSecret.length < 32) throw new Error('DONGTIAN_JWT_SECRET must be at least 32 characters');
const postgresConfig = databaseUrl ? readPostgresRuntimeConfig(process.env) : null;
const pool = databaseUrl ? new Pool({ connectionString: databaseUrl, ...postgresPoolOptions(postgresConfig!) }) : null;
pool?.on('error', (error) => process.stderr.write(`PostgreSQL pool client error: ${error instanceof Error ? error.message : String(error)}\n`));
if (pool) await applyMigrations(pool);
const repository = pool ? new PostgresRepository(pool) : new MemoryRepository();
const metrics = new MetricsCollector();
const alertBackend = process.env.DONGTIAN_ALERT_BACKEND ?? 'memory';
const alertDispatcher = createMetricsAlertDispatcher(process.env);
let alertInterval: ReturnType<typeof setInterval> | undefined;
const alertShutdownTimeoutRaw = process.env.DONGTIAN_ALERT_SHUTDOWN_TIMEOUT_MS ?? '5000';
if (!/^\d+$/.test(alertShutdownTimeoutRaw) || !Number.isSafeInteger(Number(alertShutdownTimeoutRaw)) || Number(alertShutdownTimeoutRaw) < 0 || Number(alertShutdownTimeoutRaw) > 120_000) throw new Error('DONGTIAN_ALERT_SHUTDOWN_TIMEOUT_MS must be between 0 and 120000');
const alertShutdownTimeoutMs = Number(alertShutdownTimeoutRaw);
const alertThresholds: MetricsThresholds = Object.fromEntries([
  ['settlementRejected', process.env.DONGTIAN_ALERT_SETTLEMENT_REJECTED_THRESHOLD],
  ['settlementDuplicate', process.env.DONGTIAN_ALERT_SETTLEMENT_DUPLICATE_THRESHOLD],
  ['settlementStale', process.env.DONGTIAN_ALERT_SETTLEMENT_STALE_THRESHOLD],
  ['resourceOverflow', process.env.DONGTIAN_ALERT_RESOURCE_OVERFLOW_THRESHOLD],
  ['inventoryFull', process.env.DONGTIAN_ALERT_INVENTORY_FULL_THRESHOLD],
  ['mapFailure', process.env.DONGTIAN_ALERT_MAP_FAILURE_THRESHOLD],
  ['dungeonFailure', process.env.DONGTIAN_ALERT_DUNGEON_FAILURE_THRESHOLD],
  ['pendingSettlements', process.env.DONGTIAN_ALERT_PENDING_SETTLEMENTS_THRESHOLD],
  ['dropDeviation', process.env.DONGTIAN_ALERT_DROP_DEVIATION_THRESHOLD],
  ['economicAnomaly', process.env.DONGTIAN_ALERT_ECONOMIC_ANOMALY_THRESHOLD],
].flatMap(([key, raw]) => raw === undefined ? [] : [[key, Number(raw)]])) as MetricsThresholds;
if (Object.values(alertThresholds).some((value) => !Number.isSafeInteger(value) || value < 1)) throw new Error('DONGTIAN_ALERT_*_THRESHOLD values must be positive integers');
if (alertBackend === 'webhook') {
  const intervalRaw = process.env.DONGTIAN_ALERT_INTERVAL_MS ?? '30000';
  if (!/^\d+$/.test(intervalRaw) || Number(intervalRaw) < 1000 || Number(intervalRaw) > 86_400_000) throw new Error('DONGTIAN_ALERT_INTERVAL_MS must be between 1000 and 86400000');
  alertInterval = setInterval(() => {
    const snapshot = metrics.snapshot();
    const alerts = metrics.queryAlerts(alertThresholds);
    if (alerts.length > 0) void alertDispatcher.dispatch(snapshot, alerts).catch(() => undefined);
  }, Number(intervalRaw));
  alertInterval.unref();
}
const metricsBackend = process.env.DONGTIAN_METRICS_BACKEND ?? 'memory';
if (metricsBackend !== 'memory' && metricsBackend !== 'postgres') throw new Error('DONGTIAN_METRICS_BACKEND must be memory or postgres');
if (metricsBackend === 'postgres' && !pool) throw new Error('DONGTIAN_METRICS_BACKEND=postgres requires DATABASE_URL');
const metricsSink = metricsBackend === 'postgres' && pool
  ? new PostgresMetricsStore(pool, { instanceId: process.env.DONGTIAN_METRICS_INSTANCE_ID })
  : undefined;
let releaseProvider: PostgresConfigReleaseProvider | undefined;
let configVersion: string | undefined;
let content: ContentPackage | undefined;
if (pool) {
  releaseProvider = new PostgresConfigReleaseProvider(new PostgresConfigReleaseRepository(pool));
  const active = await releaseProvider.refresh();
  if (!active && process.env.DONGTIAN_ALLOW_STATIC_CONFIG !== '1') throw new Error('an active config release is required; set DONGTIAN_ALLOW_STATIC_CONFIG=1 only for local fallback');
  if (active) { configVersion = active.version; content = active.content; }
  else releaseProvider = undefined;
}
const service = new GameService(repository, undefined, configVersion, content, metrics, releaseProvider, metricsSink);
let pendingScanner: PendingSettlementScanner | undefined;
if (process.env.DONGTIAN_PENDING_SCANNER_ENABLED === '1') {
  pendingScanner = new PendingSettlementScanner(repository, service, {
    intervalMs: Number(process.env.DONGTIAN_PENDING_SCANNER_INTERVAL_MS ?? 30_000),
    batchSize: Number(process.env.DONGTIAN_PENDING_SCANNER_BATCH_SIZE ?? 100),
    minAgeMs: Number(process.env.DONGTIAN_PENDING_SCANNER_MIN_AGE_MS ?? process.env.DONGTIAN_PENDING_SCANNER_INTERVAL_MS ?? 30_000),
    leaseMs: process.env.DONGTIAN_PENDING_SCANNER_LEASE_MS === undefined
      ? undefined
      : Number(process.env.DONGTIAN_PENDING_SCANNER_LEASE_MS),
  });
  pendingScanner.start();
}
const playerId = process.env.DONGTIAN_BOOTSTRAP_PLAYER;
if (playerId) await service.createPlayer(playerId);
const port = Number(process.env.PORT ?? 8787);
const healthChecks = {
  database: pool ? async () => { await pool.query('SELECT 1'); } : undefined,
  config: releaseProvider ? () => {
    const active = releaseProvider?.getActiveSnapshot();
    return active !== null && active?.version === service.currentConfigVersion();
  } : undefined,
  scanner: pendingScanner ? () => pendingScanner?.isReady() ?? false : undefined,
};
const httpServer = createGameHttpServer(service, { authProvider, healthChecks, maxBodyBytes: readHttpMaxBodyBytes(process.env) });
const httpSockets = new Set<Socket>();
httpServer.on('connection', (socket) => {
  httpSockets.add(socket);
  socket.once('close', () => httpSockets.delete(socket));
});
const httpShutdownTimeoutRaw = process.env.DONGTIAN_HTTP_SHUTDOWN_TIMEOUT_MS ?? '10000';
if (!/^\d+$/.test(httpShutdownTimeoutRaw) || !Number.isSafeInteger(Number(httpShutdownTimeoutRaw)) || Number(httpShutdownTimeoutRaw) < 0 || Number(httpShutdownTimeoutRaw) > 120_000) throw new Error('DONGTIAN_HTTP_SHUTDOWN_TIMEOUT_MS must be between 0 and 120000');
const httpShutdownTimeoutMs = Number(httpShutdownTimeoutRaw);
let shuttingDown = false;
const shutdown = async (signal: NodeJS.Signals): Promise<void> => {
  if (shuttingDown) return;
  shuttingDown = true;
  process.stdout.write(`洞天 server shutting down (${signal})\n`);
  if (alertInterval) clearInterval(alertInterval);
  try {
    const alertDrain = await alertDispatcher.stop(alertShutdownTimeoutMs);
    if (!alertDrain.drained) process.stderr.write(`洞天 alert shutdown drain timed out with ${alertDrain.pending} pending dispatch(es)\n`);
    await pendingScanner?.stop();
    await service.flushMetrics();
    const httpClose = await closeHttpServerBounded(httpServer, httpShutdownTimeoutMs, httpSockets);
    if (httpClose.forced) process.stderr.write(`洞天 HTTP shutdown timed out after ${httpShutdownTimeoutMs}ms; active connections were force-closed\n`);
    await pool?.end();
  } catch (error) {
    process.stderr.write(`洞天 server shutdown error: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
};
process.once('SIGTERM', () => { void shutdown('SIGTERM'); });
process.once('SIGINT', () => { void shutdown('SIGINT'); });
httpServer.listen(port, () => process.stdout.write(`洞天 server listening on http://localhost:${port}\n`));
