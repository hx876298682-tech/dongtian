import { ApiError } from './types.ts';
import { randomUUID } from 'node:crypto';
import type { SettlementRecord } from './types.ts';
import { hashPayload } from './repository.ts';
import type { Repository } from './repository.ts';
import type { GameService } from './service.ts';

export type PendingSettlementScannerOptions = {
  intervalMs?: number;
  batchSize?: number;
  minAgeMs?: number;
  /** Lease duration used by repositories that support multi-instance claims. */
  leaseMs?: number;
  clock?: () => Date;
  /** Receives background scan failures; direct scanOnce callers still see the rejection. */
  onError?: (error: unknown) => void;
};

export type PendingSettlementScanResult = {
  scanned: number;
  committed: number;
  rejected: number;
  retryable: number;
};

const DEFAULT_INTERVAL_MS = 30_000;
const DEFAULT_BATCH_SIZE = 100;
const DEFAULT_LEASE_MS = 5 * 60_000;

export class PendingSettlementScanner {
  private readonly repository: Repository;
  private readonly service: GameService;
  private readonly intervalMs: number;
  private readonly batchSize: number;
  private readonly minAgeMs: number;
  private readonly leaseMs: number;
  /**
   * Readiness must not stay green forever when the timer is alive but scans
   * are stuck. This is derived from operational polling/lease settings rather
   * than a gameplay parameter: two polling intervals, or one lease, whichever
   * is longer.
   */
  private readonly readinessMaxAgeMs: number;
  private readonly claimToken = randomUUID();
  private readonly clock: () => Date;
  private readonly onError: (error: unknown) => void;
  private timer: ReturnType<typeof setInterval> | null = null;
  private inFlight: Promise<PendingSettlementScanResult> | null = null;
  private lastError: unknown = null;
  private lastRunAt: Date | null = null;
  private lastResult: PendingSettlementScanResult | null = null;

  constructor(repository: Repository, service: GameService, options: PendingSettlementScannerOptions = {}) {
    this.repository = repository;
    this.service = service;
    this.intervalMs = options.intervalMs ?? DEFAULT_INTERVAL_MS;
    this.batchSize = options.batchSize ?? DEFAULT_BATCH_SIZE;
    this.minAgeMs = options.minAgeMs ?? this.intervalMs;
    this.leaseMs = options.leaseMs ?? Math.max(DEFAULT_LEASE_MS, this.intervalMs * 4);
    this.readinessMaxAgeMs = Math.max(this.intervalMs * 2, this.leaseMs);
    this.clock = options.clock ?? (() => new Date());
    this.onError = options.onError ?? (() => undefined);
    if (!Number.isInteger(this.intervalMs) || this.intervalMs <= 0) throw new Error('intervalMs must be a positive integer');
    if (!Number.isInteger(this.batchSize) || this.batchSize <= 0) throw new Error('batchSize must be a positive integer');
    if (!Number.isInteger(this.minAgeMs) || this.minAgeMs < 0) throw new Error('minAgeMs must be a non-negative integer');
    if (!Number.isInteger(this.leaseMs) || this.leaseMs <= 0) throw new Error('leaseMs must be a positive integer');
  }

  start(): void {
    if (this.timer) return;
    // A restart must perform a fresh successful scan before advertising
    // readiness; do not reuse the previous process-loop result.
    this.lastRunAt = null;
    this.lastError = null;
    this.lastResult = null;
    const runInBackground = (): void => { void this.scanOnce().catch((error: unknown) => { this.onError(error); }); };
    this.timer = setInterval(runInBackground, this.intervalMs);
    runInBackground();
  }

  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    if (this.inFlight) await this.inFlight;
  }

  /** True only after the background loop is running and one scan has succeeded. */
  isReady(): boolean {
    if (this.timer === null || this.lastRunAt === null || this.lastError !== null) return false;
    const ageMs = this.clock().getTime() - this.lastRunAt.getTime();
    return Number.isFinite(ageMs) && ageMs <= this.readinessMaxAgeMs;
  }

  /** Coarse status for readiness; never expose the underlying error payload. */
  status(): { running: boolean; healthy: boolean; lastRunAt: string | null; lastError: boolean; leaseMs: number; readinessMaxAgeMs: number; lastResult: PendingSettlementScanResult | null } {
    return {
      running: this.timer !== null,
      healthy: this.isReady(),
      lastRunAt: this.lastRunAt?.toISOString() ?? null,
      lastError: this.lastError !== null,
      leaseMs: this.leaseMs,
      readinessMaxAgeMs: this.readinessMaxAgeMs,
      lastResult: this.lastResult ? { ...this.lastResult } : null,
    };
  }

  scanOnce(): Promise<PendingSettlementScanResult> {
    if (this.inFlight) return this.inFlight;
    const run = this.runScan().then((result) => {
      this.lastRunAt = this.clock();
      this.lastError = null;
      this.lastResult = { ...result };
      return result;
    }, (error: unknown) => {
      this.lastRunAt = this.clock();
      this.lastError = error;
      throw error;
    }).finally(() => {
      if (this.inFlight === run) this.inFlight = null;
    });
    this.inFlight = run;
    return run;
  }

  private async runScan(): Promise<PendingSettlementScanResult> {
    const before = new Date(this.clock().getTime() - this.minAgeMs);
    const pending = this.repository.claimPendingSettlements
      ? await this.repository.claimPendingSettlements(this.batchSize, before, { claimToken: this.claimToken, now: this.clock(), leaseMs: this.leaseMs })
      : await this.repository.listPendingSettlements(this.batchSize, before);
    const result: PendingSettlementScanResult = { scanned: 0, committed: 0, rejected: 0, retryable: 0 };
    for (const record of pending) {
      result.scanned += 1;
      try {
        const routedService = record.configVersion === this.service.currentConfigVersion()
          ? this.service
          : await this.service.forConfigVersion(record.configVersion);
        await routedService.offlineSettlement({
          playerId: record.playerId,
          settlementId: record.settlementId,
          requestedStartedAt: record.requestStartedAt,
          requestedEndedAt: record.requestEndedAt,
          expectedRevision: record.expectedRevision,
          now: this.clock(),
        });
        result.committed += 1;
      } catch (error) {
        if (!(error instanceof ApiError) || error.code === 'INTERNAL_ROLLBACK') {
          result.retryable += 1;
          continue;
        }
        try {
          await this.reject(record, error);
          result.rejected += 1;
        } catch {
          result.retryable += 1;
        }
      }
    }
    return result;
  }

  private async reject(record: SettlementRecord, error: ApiError): Promise<void> {
    const responsePayload = {
      settlementId: record.settlementId,
      status: 'rejected' as const,
      error: { code: error.code, message: error.message, ...(error.details === undefined ? {} : { details: error.details }) },
    };
    await this.repository.recordSettlement({
      ...record,
      settledSeconds: 0,
      committedRevision: null,
      status: 'rejected',
      responsePayload,
      summaryHash: hashPayload(responsePayload),
      committedAt: null,
    });
  }
}
