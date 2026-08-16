import type { PerfSample, PerfSummary } from './perf-types.js';

export function percentile(values: readonly number[], percentileRank: number): number | null {
  if (values.length === 0) {
    return null;
  }

  const rank = Math.min(values.length - 1, Math.max(0, Math.ceil(values.length * percentileRank) - 1));
  return [...values].sort((left, right) => left - right)[rank] ?? null;
}

function toRate(count: number, total: number): number {
  return total === 0 ? 0 : count / total;
}

export function summarizeSamples(samples: readonly PerfSample[]): PerfSummary {
  const durations = samples.map((sample) => sample.durationMs);
  const errorCount = samples.filter((sample) => sample.status >= 400).length;
  const lockTimeoutCount = samples.filter((sample) => sample.lockTimeout).length;

  return {
    sampleCount: samples.length,
    errorCount,
    errorRate: toRate(errorCount, samples.length),
    lockTimeoutCount,
    lockTimeoutRate: toRate(lockTimeoutCount, samples.length),
    p50Ms: percentile(durations, 0.5),
    p95Ms: percentile(durations, 0.95),
    p99Ms: percentile(durations, 0.99),
  };
}
