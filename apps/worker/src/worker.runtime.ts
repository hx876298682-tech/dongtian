import { createHash } from 'node:crypto';

import { Inject, Injectable, type BeforeApplicationShutdown, type OnApplicationBootstrap, type OnApplicationShutdown } from '@nestjs/common';
import type { Logger } from 'pino';

import { type Environment } from '@dongtian/config-schema';
import {
  createDatabasePool,
  createOutboxRepository,
  createSettlementRepository,
  type DatabasePool,
  type OutboxEvent,
  type OutboxRepository,
  type SettlementRepository,
  type SettlementStateRecord,
  type PoolClient,
} from '@dongtian/database';
import { microseconds, settleSingleAction, type SettlementActionSnapshot } from '@dongtian/game-rules';

import { OutboxWorker, type OutboxEventDedupe } from './outbox-worker.js';
import { SettlementContinuationWorker } from './settlement-continuation-worker.js';

export const WORKER_DATABASE_POOL = Symbol('WORKER_DATABASE_POOL');
export const WORKER_LOGGER = Symbol('WORKER_LOGGER');
export const WORKER_SLEEP = Symbol('WORKER_SLEEP');
export const WORKER_RUNTIME_OPTIONS = Symbol('WORKER_RUNTIME_OPTIONS');
export const OUTBOX_EVENT_DEDUPE = Symbol('OUTBOX_EVENT_DEDUPE');
export const OUTBOX_REPOSITORY = Symbol('OUTBOX_REPOSITORY');
export const SETTLEMENT_REPOSITORY = Symbol('SETTLEMENT_REPOSITORY');

export type WorkerSleep = (ms: number, signal: AbortSignal) => Promise<void>;

export type WorkerRuntimeOptions = Readonly<{
  readonly busyDelayMs: number;
  readonly idleDelayMs: number;
  readonly maxDelayMs: number;
  readonly outboxBatchLimit: number;
  readonly outboxLeaseMs: number;
  readonly settlementBatchLimit: number;
}>;

export const DEFAULT_WORKER_RUNTIME_OPTIONS: WorkerRuntimeOptions = {
  busyDelayMs: 100,
  idleDelayMs: 500,
  maxDelayMs: 10_000,
  outboxBatchLimit: 100,
  outboxLeaseMs: 60_000,
  settlementBatchLimit: 10,
};

type SleepOptions = Readonly<{
  readonly logger: Pick<Logger, 'error' | 'info' | 'warn'>;
  readonly name: string;
  readonly sleep: WorkerSleep;
  readonly busyDelayMs: number;
  readonly idleDelayMs: number;
  readonly maxDelayMs: number;
}>;

function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    return `${error.name}: ${error.message}`;
  }
  return String(error);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readString(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`SETTLEMENT_SNAPSHOT_INVALID: ${key}`);
  }
  return value;
}

function readNumber(record: Record<string, unknown>, key: string): number {
  const value = record[key];
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`SETTLEMENT_SNAPSHOT_INVALID: ${key}`);
  }
  return value;
}

function readOutputs(value: unknown): SettlementActionSnapshot['outputs'] {
  if (!isRecord(value)) {
    throw new Error('SETTLEMENT_SNAPSHOT_INVALID: outputs');
  }
  return Object.entries(value).map(([itemId, quantityPerCycle]) => {
    if (typeof quantityPerCycle !== 'string') {
      throw new Error('SETTLEMENT_SNAPSHOT_INVALID: output quantity');
    }
    return {
      itemId,
      quantityPerCycle: BigInt(quantityPerCycle),
    };
  });
}

function parseSnapshot(value: SettlementStateRecord['activeCycleSnapshot']): SettlementActionSnapshot {
  if (!isRecord(value)) {
    throw new Error('SETTLEMENT_SNAPSHOT_MISSING');
  }
  return {
    actionConfigId: readString(value, 'action_config_id'),
    configVersion: readString(value, 'config_version'),
    formulaVersion: readNumber(value, 'formula_version'),
    durationUs: microseconds(readString(value, 'duration_us')),
    cultivationXpPerCycle: readString(value, 'cultivation_xp_per_cycle'),
    skillXpPerCycle: readString(value, 'skill_xp_per_cycle'),
    outputs: readOutputs(value['outputs']),
  };
}

function toMicroseconds(date: Date): bigint {
  return BigInt(date.getTime()) * 1_000n;
}

function fromMicroseconds(value: bigint): Date {
  return new Date(Number(value / 1_000n));
}

function createSeed(characterId: string, fromAt: Date): Uint8Array {
  return createHash('sha256')
    .update(characterId, 'utf8')
    .update(fromAt.toISOString(), 'utf8')
    .digest()
    .subarray(0, 16);
}

function clampDelay(value: number, floor: number, ceiling: number): number {
  return Math.max(floor, Math.min(ceiling, value));
}

function createSleepOptions(
  name: string,
  sleep: WorkerSleep,
  logger: Pick<Logger, 'error' | 'info' | 'warn'>,
  options: WorkerRuntimeOptions,
): SleepOptions {
  return {
    logger,
    name,
    sleep,
    busyDelayMs: options.busyDelayMs,
    idleDelayMs: options.idleDelayMs,
    maxDelayMs: options.maxDelayMs,
  };
}

export class PollingLoop {
  private readonly abortController = new AbortController();
  private running: Promise<void> | null = null;

  public constructor(
    private readonly step: () => Promise<boolean>,
    private readonly options: SleepOptions,
  ) {}

  public start(): Promise<void> {
    if (this.running === null) {
      this.running = this.run();
    }
    return this.running;
  }

  public async stop(): Promise<void> {
    this.abortController.abort();
    if (this.running !== null) {
      await this.running;
    }
  }

  private async run(): Promise<void> {
    let delayMs = this.options.idleDelayMs;

    while (!this.abortController.signal.aborted) {
      try {
        const worked = await this.step();
        delayMs = worked ? this.options.busyDelayMs : clampDelay(delayMs * 2, this.options.idleDelayMs, this.options.maxDelayMs);
      } catch (error) {
        if (this.abortController.signal.aborted) {
          break;
        }
        this.options.logger.error(
          { worker: this.options.name, error: errorMessage(error) },
          'Worker loop failed. Retrying with backoff.',
        );
        delayMs = clampDelay(delayMs * 2, this.options.idleDelayMs, this.options.maxDelayMs);
      }

      if (this.abortController.signal.aborted) {
        break;
      }

      try {
        await this.options.sleep(delayMs, this.abortController.signal);
      } catch (error) {
        if (!this.abortController.signal.aborted) {
          throw error;
        }
      }
    }
  }
}

@Injectable()
export class SettlementContinuationService {
  public constructor(
    @Inject(SETTLEMENT_REPOSITORY) private readonly repository: SettlementRepository,
    @Inject(WORKER_LOGGER) private readonly logger: Pick<Logger, 'error' | 'info' | 'warn'>,
  ) {}

  public readonly continueCharacter = async (client: PoolClient, characterId: string): Promise<void> => {
    const state = await this.repository.lockState(client, characterId);
    if (!state) {
      throw new Error('SETTLEMENT_STATE_NOT_FOUND');
    }

    if (!state.continuationRequired) {
      return;
    }

    const snapshot = parseSnapshot(state.activeCycleSnapshot);
    const now = new Date();
    const lastSettledAtUs = toMicroseconds(state.lastSettledAt);
    const serverNowUs = toMicroseconds(now);
    const offlineCapUs = microseconds(BigInt(state.offlineCapSeconds) * 1_000_000n);
    const result = settleSingleAction({
      lastSettledAtUs: microseconds(lastSettledAtUs),
      serverNowUs: microseconds(serverNowUs),
      offlineCapUs,
      progressTimeUs: microseconds(state.progressTimeUs),
      actionSnapshot: snapshot,
    });

    const completedCyclesText = result.completedCycles.toString();
    const cultivationXpDelta = result.cultivationXp;
    const skillXpDelta = result.skillXp;
    const settlementRunId = await this.repository.persist(client, {
      characterId,
      fromAt: state.lastSettledAt,
      effectiveUntil: fromMicroseconds(result.effectiveUntilUs),
      requestedUntil: now,
      effectiveSeconds: result.effectiveTimeUs / 1_000_000n,
      cappedSeconds: result.cappedTimeUs / 1_000_000n,
      status: result.status,
      randomSeed: createSeed(characterId, state.lastSettledAt),
      formulaVersion: snapshot.formulaVersion,
      configVersion: snapshot.configVersion,
      summary: {
        completed_cycles: completedCyclesText,
        cultivation_xp: cultivationXpDelta,
        skill_xp: skillXpDelta,
      },
      ...(cultivationXpDelta === '0' ? {} : { progressionAward: { cultivationXpDelta } }),
      segments: result.segments.map((segment: (typeof result.segments)[number]) => ({
        segmentIndex: segment.segmentIndex,
        actionConfigId: segment.actionConfigId,
        fromAt: fromMicroseconds(segment.fromUs),
        toAt: fromMicroseconds(segment.toUs),
        completedCycles: segment.completedCycles,
        inputs: {},
        outputs: segment.outputs,
        xpChanges: segment.xpChanges,
        transitionReason: 'WORKER_CONTINUATION',
        snapshot: segment.snapshot,
        ...(state.activeQueueEntryId === null ? {} : { queueEntryId: state.activeQueueEntryId }),
      })),
      nextState: {
        lastSettledAt: fromMicroseconds(result.effectiveUntilUs),
        activeCycleIndex: state.activeCycleIndex + result.completedCycles,
        activeCycleSnapshot: result.progressTimeUs > 0n ? state.activeCycleSnapshot : null,
        progressTimeUs: result.progressTimeUs,
        continuationRequired: false,
        ...(result.progressTimeUs > 0n && state.activeQueueEntryId !== null
          ? { activeQueueEntryId: state.activeQueueEntryId }
          : {}),
      },
    });

    this.logger.info(
      {
        character_id: characterId,
        settlement_run_id: settlementRunId,
        completed_cycles: completedCyclesText,
      },
      'Settlement continuation committed.',
    );
  };
}

@Injectable()
export class WorkerRuntimeService implements OnApplicationBootstrap, BeforeApplicationShutdown, OnApplicationShutdown {
  private loops: readonly PollingLoop[] | null = null;
  private runningPromise: Promise<void> | null = null;
  private poolClosed = false;

  public constructor(
    @Inject(WORKER_DATABASE_POOL) private readonly databasePool: DatabasePool,
    @Inject(WORKER_LOGGER) private readonly logger: Pick<Logger, 'error' | 'info' | 'warn'>,
    @Inject(WORKER_RUNTIME_OPTIONS) private readonly options: WorkerRuntimeOptions,
    @Inject(WORKER_SLEEP) private readonly sleep: WorkerSleep,
    private readonly outboxWorker: OutboxWorker,
    private readonly settlementWorker: SettlementContinuationWorker,
  ) {}

  public onApplicationBootstrap(): void {
    void this.start();
  }

  public async beforeApplicationShutdown(): Promise<void> {
    await this.stop();
  }

  public async onApplicationShutdown(): Promise<void> {
    await this.stop();
  }

  public start(): Promise<void> {
    if (this.runningPromise !== null) {
      return this.runningPromise;
    }

    const makeLoop = (name: string, step: () => Promise<boolean>): PollingLoop =>
      new PollingLoop(step, createSleepOptions(name, this.sleep, this.logger, this.options));

    const outboxLoop = makeLoop('outbox', async () => {
      const result = await this.outboxWorker.runOnce({
        limit: this.options.outboxBatchLimit,
        leaseMs: this.options.outboxLeaseMs,
      });
      return result.claimed > 0;
    });
    const settlementLoop = makeLoop('settlement', async () => {
      const claimed = await this.settlementWorker.runOnce(this.options.settlementBatchLimit);
      return claimed > 0;
    });
    this.loops = [outboxLoop, settlementLoop];

    this.runningPromise = Promise.all([outboxLoop.start(), settlementLoop.start()])
      .then(() => undefined)
      .catch((error: unknown) => {
        this.logger.error({ error: errorMessage(error) }, 'Worker runtime loop failed.');
      });

    return this.runningPromise;
  }

  public async stop(): Promise<void> {
    const loops = this.loops;
    this.loops = null;
    await Promise.all(loops?.map(async (loop) => loop.stop()) ?? []);
    if (this.runningPromise !== null) {
      await this.runningPromise;
    }
    if (!this.poolClosed) {
      this.poolClosed = true;
      await this.databasePool.end();
      this.logger.info({ service: '@dongtian/worker' }, 'Worker database pool closed.');
    }
  }
}

export function createWorkerDatabasePool(environment: Environment): DatabasePool {
  return createDatabasePool(environment.DATABASE_URL);
}

export function createWorkerRepositories(pool: DatabasePool): Readonly<{
  readonly outboxRepository: OutboxRepository;
  readonly settlementRepository: SettlementRepository;
}> {
  return {
    outboxRepository: createOutboxRepository(pool),
    settlementRepository: createSettlementRepository(pool),
  };
}

export function createOutboxDedupe(repository: OutboxRepository): OutboxEventDedupe {
  return {
    hasProcessed: async (eventId: string) => repository.hasPublished(eventId),
    markProcessed: async (eventId: string) => {
      await repository.markPublished(eventId);
    },
  };
}

export function createOutboxHandler(logger: Pick<Logger, 'info' | 'warn' | 'error'>): (event: OutboxEvent) => Promise<void> {
  return async (event: OutboxEvent) => {
    logger.info(
      {
        event_id: event.id,
        event_type: event.eventType,
        aggregate_type: event.aggregateType,
        aggregate_id: event.aggregateId,
      },
      'Outbox event delivered to worker sink.',
    );
  };
}
