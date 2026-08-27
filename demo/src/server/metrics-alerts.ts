import type { MetricsAlert, MetricsSnapshot } from './metrics.ts';

export type MetricsAlertBackend = 'memory' | 'webhook';
export type MetricsAlertPayload = { generatedAt: string; alerts: MetricsAlert[]; snapshot: MetricsSnapshot };
export type MetricsAlertDelivery = { delivered: boolean; degraded: boolean; backend: MetricsAlertBackend; payload: MetricsAlertPayload; fallback: 'memory' | null; skipped?: boolean };
export type MetricsAlertPublisher = (payload: MetricsAlertPayload, config: { endpoint: string; token: string }) => Promise<void>;
export type MetricsAlertDrain = { drained: boolean; timedOut: boolean; pending: number; waitedMs: number };

export class MetricsAlertConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MetricsAlertConfigError';
  }
}

export class MemoryMetricsAlertSink {
  readonly payloads: MetricsAlertPayload[] = [];

  async publish(payload: MetricsAlertPayload): Promise<void> {
    this.payloads.push(structuredClone(payload));
  }
}

const readBackend = (env: NodeJS.ProcessEnv): MetricsAlertBackend => {
  const backend = env.DONGTIAN_ALERT_BACKEND ?? 'memory';
  if (backend !== 'memory' && backend !== 'webhook') throw new MetricsAlertConfigError('DONGTIAN_ALERT_BACKEND must be memory or webhook');
  return backend;
};

const readWebhookConfig = (env: NodeJS.ProcessEnv): { endpoint: string; token: string; timeoutMs: number } => {
  const endpoint = env.DONGTIAN_ALERT_WEBHOOK_URL;
  const token = env.DONGTIAN_ALERT_WEBHOOK_TOKEN;
  if (!endpoint || !token) throw new MetricsAlertConfigError('webhook alert backend requires DONGTIAN_ALERT_WEBHOOK_URL and DONGTIAN_ALERT_WEBHOOK_TOKEN');
  let parsed: URL;
  try { parsed = new URL(endpoint); } catch { throw new MetricsAlertConfigError('DONGTIAN_ALERT_WEBHOOK_URL must be a valid HTTPS URL'); }
  if (parsed.protocol !== 'https:') throw new MetricsAlertConfigError('DONGTIAN_ALERT_WEBHOOK_URL must use HTTPS');
  const timeoutRaw = env.DONGTIAN_ALERT_WEBHOOK_TIMEOUT_MS ?? '5000';
  if (!/^\d+$/.test(timeoutRaw)) throw new MetricsAlertConfigError('DONGTIAN_ALERT_WEBHOOK_TIMEOUT_MS must be a positive integer');
  const timeoutMs = Number(timeoutRaw);
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > 120_000) throw new MetricsAlertConfigError('DONGTIAN_ALERT_WEBHOOK_TIMEOUT_MS must be between 1 and 120000');
  return { endpoint, token, timeoutMs };
};

const defaultWebhookPublisher = async (payload: MetricsAlertPayload, config: { endpoint: string; token: string; timeoutMs: number }, shutdownSignal?: AbortSignal): Promise<void> => {
  const timeoutSignal = AbortSignal.timeout(config.timeoutMs);
  const response = await fetch(config.endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${config.token}` },
    body: JSON.stringify(payload),
    signal: shutdownSignal ? AbortSignal.any([shutdownSignal, timeoutSignal]) : timeoutSignal,
  });
  if (!response.ok) throw new Error(`alert webhook returned HTTP ${response.status}`);
};

export const metricsAlertPayload = (snapshot: MetricsSnapshot, alerts: MetricsAlert[]): MetricsAlertPayload => ({ generatedAt: snapshot.generatedAt, alerts: alerts.map((alert) => ({ ...alert })), snapshot: structuredClone(snapshot) });

export const createMetricsAlertDispatcher = (env: NodeJS.ProcessEnv = process.env, publisher?: MetricsAlertPublisher) => {
  const backend = readBackend(env);
  const memory = new MemoryMetricsAlertSink();
  const webhook = backend === 'webhook' ? readWebhookConfig(env) : null;
  const inFlight = new Set<Promise<MetricsAlertDelivery>>();
  const abortControllers = new Set<AbortController>();
  let stopping = false;
  const drain = async (timeoutMs = 5000): Promise<MetricsAlertDrain> => {
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 0 || timeoutMs > 120_000) throw new RangeError('alert drain timeout must be between 0 and 120000');
    const startedAt = Date.now();
    const pending = [...inFlight];
    if (pending.length === 0) return { drained: true, timedOut: false, pending: 0, waitedMs: 0 };
    let timer: ReturnType<typeof setTimeout> | undefined;
    let timedOut = false;
    await Promise.race([
      Promise.allSettled(pending).then(() => undefined),
      new Promise<void>((resolve) => { timer = setTimeout(() => { timedOut = true; resolve(); }, timeoutMs); }),
    ]);
    if (timer) clearTimeout(timer);
    const remaining = inFlight.size;
    return { drained: remaining === 0, timedOut: timedOut && remaining > 0, pending: remaining, waitedMs: Date.now() - startedAt };
  };
  return {
    backend,
    async dispatch(snapshot: MetricsSnapshot, alerts: MetricsAlert[]): Promise<MetricsAlertDelivery> {
      const payload = metricsAlertPayload(snapshot, alerts);
      if (stopping) {
        await memory.publish(payload);
        return { delivered: false, degraded: true, backend, payload, fallback: 'memory', skipped: true };
      }
      const run = (async (): Promise<MetricsAlertDelivery> => {
        if (backend === 'memory') {
          await memory.publish(payload);
          return { delivered: true, degraded: false, backend, payload, fallback: null };
        }
        if (!webhook) throw new MetricsAlertConfigError('webhook alert configuration is unavailable');
        try {
          if (publisher) await publisher(payload, { endpoint: webhook.endpoint, token: webhook.token });
          else {
            const controller = new AbortController();
            abortControllers.add(controller);
            try { await defaultWebhookPublisher(payload, webhook, controller.signal); }
            finally { abortControllers.delete(controller); }
          }
          return { delivered: true, degraded: false, backend, payload, fallback: null };
        } catch {
          await memory.publish(payload);
          return { delivered: false, degraded: true, backend, payload, fallback: 'memory' };
        }
      })();
      inFlight.add(run);
      void run.then(() => { inFlight.delete(run); }, () => { inFlight.delete(run); });
      return await run;
    },
    /** Stop accepting webhook sends and wait a bounded time for existing sends. */
    async stop(timeoutMs = 5000): Promise<MetricsAlertDrain> {
      stopping = true;
      const result = await drain(timeoutMs);
      if (!result.drained) {
        for (const controller of abortControllers) controller.abort();
        // Aborting the built-in fetch path should settle on the next turn;
        // custom publishers remain observable as pending without blocking shutdown.
        return await drain(0);
      }
      return result;
    },
    drain,
    memory,
  };
};
