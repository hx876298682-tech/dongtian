import { randomUUID } from 'node:crypto';
import type { AsyncSqlClient, AsyncSqlPool, SqlRow } from './postgres-repository.ts';
import { MetricsCollector, metricsSnapshotToPrometheus } from './metrics.ts';
import type { MetricsEvent, MetricsSnapshot } from './metrics.ts';

type MetricsEventRow = SqlRow & {
  event_id: string;
  event_type: string;
  event_at: string | Date;
  duration_ms: number | string | null;
  pending_age_ms: number | string | null;
  resource_delta: unknown;
  resource_overflow: unknown;
  growth: string | null;
  drop_key: string | null;
  drop_expected: number | string | null;
  drop_actual: number | string | null;
  anomaly_key: string | null;
  anomaly_value: number | string | null;
};

/**
 * Durable metrics adapter for multi-instance deployments.
 *
 * GameService currently accepts the synchronous in-process MetricsCollector.
 * This adapter is intentionally explicit and asynchronous: callers can write
 * events after a request, while /metrics can read one PostgreSQL-backed view.
 */
export class PostgresMetricsStore {
  private readonly pool: AsyncSqlPool;
  private readonly instanceId: string;
  private readonly maxDurationSamples: number | undefined;

  constructor(pool: AsyncSqlPool, options: { instanceId?: string; maxDurationSamples?: number } = {}) {
    this.pool = pool;
    this.instanceId = options.instanceId ?? `instance-${randomUUID()}`;
    this.maxDurationSamples = options.maxDurationSamples;
  }

  async record(event: MetricsEvent & { eventId?: string }): Promise<void> {
    // Validate before persisting so malformed telemetry cannot poison the
    // shared stream. The collector is the single source of validation rules.
    new MetricsCollector({ maxDurationSamples: this.maxDurationSamples }).record(event);
    const eventId = event.eventId ?? randomUUID();
    await this.withClient(async (client) => {
      await client.query(
        `INSERT INTO metrics_event (event_id, instance_id, event_type, event_at, duration_ms, pending_age_ms, resource_delta, resource_overflow, growth, drop_key, drop_expected, drop_actual, anomaly_key, anomaly_value)
         VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,$9,$10,$11,$12,$13,$14)
         ON CONFLICT (event_id) DO NOTHING`,
        [eventId, this.instanceId, event.type, this.eventAt(event.at), event.durationMs ?? null, event.pendingAgeMs ?? null, JSON.stringify(event.resourceDelta ?? {}), JSON.stringify(event.resourceOverflow ?? {}), event.growth ?? null, event.dropKey ?? null, event.dropExpected ?? null, event.dropActual ?? null, event.anomalyKey ?? null, event.anomalyValue ?? null],
      );
    });
  }

  async snapshot(at = Date.now()): Promise<MetricsSnapshot> {
    const collector = new MetricsCollector({ clock: () => at, maxDurationSamples: this.maxDurationSamples });
    await this.withClient(async (client) => {
      const result = await client.query<MetricsEventRow>(
        `SELECT event_type, event_at, duration_ms, pending_age_ms, resource_delta, resource_overflow, growth, drop_key, drop_expected, drop_actual, anomaly_key, anomaly_value
           FROM metrics_event WHERE event_at <= $1 ORDER BY event_at, event_id`,
        [new Date(at)],
      );
      for (const row of result.rows) collector.record({
        type: row.event_type as MetricsEvent['type'],
        at: row.event_at,
        durationMs: row.duration_ms === null ? undefined : Number(row.duration_ms),
        pendingAgeMs: row.pending_age_ms === null ? undefined : Number(row.pending_age_ms),
        resourceDelta: this.parseObject(row.resource_delta),
        resourceOverflow: this.parseObject(row.resource_overflow),
        growth: row.growth as MetricsEvent['growth'],
        dropKey: row.drop_key ?? undefined,
        dropExpected: row.drop_expected === null ? undefined : Number(row.drop_expected),
        dropActual: row.drop_actual === null ? undefined : Number(row.drop_actual),
        anomalyKey: row.anomaly_key ?? undefined,
        anomalyValue: row.anomaly_value === null ? undefined : Number(row.anomaly_value),
      });
    });
    return collector.snapshot(at);
  }

  async toPrometheus(at = Date.now()): Promise<string> {
    const snapshot = await this.snapshot(at);
    return metricsSnapshotToPrometheus(snapshot);
  }

  private eventAt(value: MetricsEvent['at']): Date {
    if (value instanceof Date) return value;
    if (typeof value === 'number') return new Date(value);
    if (typeof value === 'string') return new Date(value);
    return new Date();
  }

  private parseObject(value: unknown): Record<string, number> {
    if (value === null || value === undefined) return {};
    const parsed = typeof value === 'string' ? JSON.parse(value) : value;
    return parsed && typeof parsed === 'object' ? parsed as Record<string, number> : {};
  }

  private async withClient<T>(work: (client: AsyncSqlClient) => Promise<T>): Promise<T> {
    const pool = this.pool as { connect?: () => Promise<AsyncSqlClient> };
    const client = typeof pool.connect === 'function' ? await pool.connect() : this.pool as AsyncSqlClient;
    try { return await work(client); } finally { client.release?.(); }
  }
}
