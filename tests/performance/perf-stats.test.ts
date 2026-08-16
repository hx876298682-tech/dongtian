import { describe, expect, it } from 'vitest';

import { percentile, summarizeSamples } from './perf-stats.js';

describe('performance statistics', () => {
  it('computes nearest-rank percentiles', () => {
    expect(percentile([], 0.95)).toBeNull();
    expect(percentile([12], 0.95)).toBe(12);
    expect(percentile([10, 20, 30, 40], 0.5)).toBe(20);
    expect(percentile([10, 20, 30, 40], 0.95)).toBe(40);
  });

  it('summarizes errors and lock timeouts', () => {
    const summary = summarizeSamples([
      {
        durationMs: 120,
        errorCode: null,
        label: 'a',
        lockTimeout: false,
        method: 'GET',
        path: '/a',
        requestId: '1',
        retryable: false,
        scenarioId: 'scenario',
        status: 200,
      },
      {
        durationMs: 360,
        errorCode: 'LOCK_TIMEOUT',
        label: 'b',
        lockTimeout: true,
        method: 'PUT',
        path: '/b',
        requestId: '2',
        retryable: true,
        scenarioId: 'scenario',
        status: 409,
      },
    ]);

    expect(summary.sampleCount).toBe(2);
    expect(summary.errorCount).toBe(1);
    expect(summary.errorRate).toBe(0.5);
    expect(summary.lockTimeoutCount).toBe(1);
    expect(summary.lockTimeoutRate).toBe(0.5);
    expect(summary.p50Ms).toBe(120);
    expect(summary.p95Ms).toBe(360);
    expect(summary.p99Ms).toBe(360);
  });
});

