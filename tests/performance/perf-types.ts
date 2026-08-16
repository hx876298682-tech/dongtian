export type PerfRunStatus = 'passed' | 'failed' | 'skipped';

export type PerfRequestMethod = 'GET' | 'POST' | 'PUT';

export type PerfSample = {
  readonly scenarioId: string;
  readonly requestId: string;
  readonly label: string;
  readonly method: PerfRequestMethod;
  readonly path: string;
  readonly status: number;
  readonly durationMs: number;
  readonly errorCode: string | null;
  readonly retryable: boolean;
  readonly lockTimeout: boolean;
};

export type PerfPercentiles = {
  readonly p50Ms: number | null;
  readonly p95Ms: number | null;
  readonly p99Ms: number | null;
};

export type PerfSummary = PerfPercentiles & {
  readonly sampleCount: number;
  readonly errorCount: number;
  readonly errorRate: number;
  readonly lockTimeoutCount: number;
  readonly lockTimeoutRate: number;
};

export type PerfScenarioResult = {
  readonly scenarioId: string;
  readonly status: PerfRunStatus;
  readonly reason: string | null;
  readonly samples: readonly PerfSample[];
  readonly summary: PerfSummary;
};

export type PerfAuditReport = {
  readonly ok: boolean;
  readonly discrepancyCount: number;
};

export type PerfRunReport = {
  readonly status: PerfRunStatus;
  readonly reason: string | null;
  readonly scenarioResults: readonly PerfScenarioResult[];
  readonly summary: PerfSummary;
  readonly audit: PerfAuditReport | null;
};

