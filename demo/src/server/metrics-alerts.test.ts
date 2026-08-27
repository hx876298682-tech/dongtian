import assert from 'node:assert/strict';
import test from 'node:test';
import { createMetricsAlertDispatcher, MetricsAlertConfigError } from './metrics-alerts.ts';
import { MetricsCollector } from './metrics.ts';

const snapshot = () => {
  const collector = new MetricsCollector({ clock: () => 0 });
  collector.record({ type: 'economic_anomaly', anomalyKey: 'resource_overflow', anomalyValue: 2 });
  return { snapshot: collector.snapshot(), alerts: collector.queryAlerts({ economicAnomaly: 1 }) };
};

test('memory alert adapter emits a stable payload without external I/O', async () => {
  const dispatcher = createMetricsAlertDispatcher({ DONGTIAN_ALERT_BACKEND: 'memory' });
  const { snapshot: state, alerts } = snapshot();
  const delivery = await dispatcher.dispatch(state, alerts);
  assert.deepEqual({ delivered: delivery.delivered, degraded: delivery.degraded, backend: delivery.backend, fallback: delivery.fallback }, { delivered: true, degraded: false, backend: 'memory', fallback: null });
  assert.deepEqual(dispatcher.memory.payloads[0]?.alerts, alerts);
});

test('webhook adapter requires HTTPS configuration and degrades to memory on publisher failure', async () => {
  assert.throws(() => createMetricsAlertDispatcher({ DONGTIAN_ALERT_BACKEND: 'webhook' }), MetricsAlertConfigError);
  assert.throws(() => createMetricsAlertDispatcher({ DONGTIAN_ALERT_BACKEND: 'webhook', DONGTIAN_ALERT_WEBHOOK_URL: 'http://alerts.local', DONGTIAN_ALERT_WEBHOOK_TOKEN: 'token' }), MetricsAlertConfigError);
  assert.throws(() => createMetricsAlertDispatcher({ DONGTIAN_ALERT_BACKEND: 'webhook', DONGTIAN_ALERT_WEBHOOK_URL: 'https://alerts.local/hook', DONGTIAN_ALERT_WEBHOOK_TOKEN: 'token', DONGTIAN_ALERT_WEBHOOK_TIMEOUT_MS: '0' }), MetricsAlertConfigError);
  const dispatcher = createMetricsAlertDispatcher({ DONGTIAN_ALERT_BACKEND: 'webhook', DONGTIAN_ALERT_WEBHOOK_URL: 'https://alerts.local/hook', DONGTIAN_ALERT_WEBHOOK_TOKEN: 'token' }, async () => { throw new Error('network down'); });
  const { snapshot: state, alerts } = snapshot();
  const delivery = await dispatcher.dispatch(state, alerts);
  assert.deepEqual({ delivered: delivery.delivered, degraded: delivery.degraded, fallback: delivery.fallback }, { delivered: false, degraded: true, fallback: 'memory' });
  assert.equal(dispatcher.memory.payloads.length, 1);
});

test('webhook adapter uses the default HTTPS fetch publisher when no adapter is injected', async () => {
  const originalFetch = globalThis.fetch;
  const requests: Array<{ url: string; init: RequestInit }> = [];
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    requests.push({ url: String(url), init: init ?? {} });
    return { ok: true, status: 204 } as Response;
  }) as typeof fetch;
  try {
    const dispatcher = createMetricsAlertDispatcher({ DONGTIAN_ALERT_BACKEND: 'webhook', DONGTIAN_ALERT_WEBHOOK_URL: 'https://alerts.local/hook', DONGTIAN_ALERT_WEBHOOK_TOKEN: 'token', DONGTIAN_ALERT_WEBHOOK_TIMEOUT_MS: '1200' });
    const { snapshot: state, alerts } = snapshot();
    const delivery = await dispatcher.dispatch(state, alerts);
    assert.equal(delivery.delivered, true);
    assert.equal(delivery.degraded, false);
    assert.equal(requests.length, 1);
    const request = requests[0];
    assert.ok(request);
    assert.equal(request.url, 'https://alerts.local/hook');
    assert.equal(request.init.method, 'POST');
    assert.deepEqual(request.init.headers, { 'content-type': 'application/json', authorization: 'Bearer token' });
    assert.deepEqual(JSON.parse(String(request.init.body)), delivery.payload);
    assert.equal((request.init.signal as AbortSignal).aborted, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('default webhook publisher degrades on a non-2xx response', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => ({ ok: false, status: 503 }) as Response) as typeof fetch;
  try {
    const dispatcher = createMetricsAlertDispatcher({ DONGTIAN_ALERT_BACKEND: 'webhook', DONGTIAN_ALERT_WEBHOOK_URL: 'https://alerts.local/hook', DONGTIAN_ALERT_WEBHOOK_TOKEN: 'token' });
    const { snapshot: state, alerts } = snapshot();
    const delivery = await dispatcher.dispatch(state, alerts);
    assert.deepEqual({ delivered: delivery.delivered, degraded: delivery.degraded, fallback: delivery.fallback }, { delivered: false, degraded: true, fallback: 'memory' });
    assert.equal(dispatcher.memory.payloads.length, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('dispatcher bounded stop reports a stuck custom publisher and rejects sends after stop', async () => {
  let release: (() => void) | undefined;
  const dispatcher = createMetricsAlertDispatcher({ DONGTIAN_ALERT_BACKEND: 'webhook', DONGTIAN_ALERT_WEBHOOK_URL: 'https://alerts.local/hook', DONGTIAN_ALERT_WEBHOOK_TOKEN: 'token' }, async () => {
    await new Promise<void>((resolve) => { release = resolve; });
  });
  const { snapshot: state, alerts } = snapshot();
  const pending = dispatcher.dispatch(state, alerts);
  const stopped = await dispatcher.stop(5);
  assert.equal(stopped.drained, false);
  assert.equal(stopped.timedOut, true);
  assert.equal(stopped.pending, 1);

  const skipped = await dispatcher.dispatch(state, alerts);
  assert.equal(skipped.skipped, true);
  assert.equal(skipped.delivered, false);
  assert.equal(dispatcher.memory.payloads.length, 1);

  release?.();
  await pending;
  const drained = await dispatcher.drain(100);
  assert.equal(drained.drained, true);
  assert.equal(drained.pending, 0);
});

test('bounded stop aborts the built-in webhook fetch and settles the in-flight delivery', async () => {
  const originalFetch = globalThis.fetch;
  let aborted = false;
  globalThis.fetch = (async (_url: string | URL | Request, init?: RequestInit) => await new Promise<Response>((_resolve, reject) => {
    const signal = init?.signal;
    if (!signal) return reject(new Error('missing abort signal'));
    if (signal.aborted) { aborted = true; reject(new Error('aborted')); return; }
    signal.addEventListener('abort', () => { aborted = true; reject(new Error('aborted')); }, { once: true });
  })) as typeof fetch;
  try {
    const dispatcher = createMetricsAlertDispatcher({ DONGTIAN_ALERT_BACKEND: 'webhook', DONGTIAN_ALERT_WEBHOOK_URL: 'https://alerts.local/hook', DONGTIAN_ALERT_WEBHOOK_TOKEN: 'token' });
    const { snapshot: state, alerts } = snapshot();
    const pending = dispatcher.dispatch(state, alerts);
    const stopped = await dispatcher.stop(5);
    await pending;
    assert.equal(aborted, true);
    assert.equal(stopped.pending, 0);
    assert.equal(stopped.drained, true);
    assert.equal(dispatcher.memory.payloads.length, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
