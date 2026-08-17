import { Module, type DynamicModule, type Provider } from '@nestjs/common';
import { setTimeout as sleepWithAbort } from 'node:timers/promises';
import type { Logger } from 'pino';

import { type Environment } from '@dongtian/config-schema';
import { createAssetRepository, createDatabasePool, createOutboxRepository, createSettlementRepository, createCaveRepository, createBreakthroughRepository } from '@dongtian/database';

import { OutboxWorker } from './outbox-worker.js';
import { SettlementContinuationWorker } from './settlement-continuation-worker.js';
import {
  DEFAULT_WORKER_RUNTIME_OPTIONS,
  CAVE_REPOSITORY,
  OUTBOX_EVENT_DEDUPE,
  ASSET_REPOSITORY,
  BREAKTHROUGH_REPOSITORY,
  OUTBOX_REPOSITORY,
  SETTLEMENT_REPOSITORY,
  WORKER_DATABASE_POOL,
  WORKER_LOGGER,
  WORKER_RUNTIME_OPTIONS,
  WORKER_SLEEP,
  type WorkerRuntimeOptions,
  type WorkerSleep,
  CaveRecoveryService,
  CaveRecoveryWorker,
  BreakthroughRecoveryService,
  BreakthroughRecoveryWorker,
  SettlementContinuationService,
  WorkerRuntimeService,
  createOutboxDedupe,
  createOutboxHandler,
} from './worker.runtime.js';

export type WorkerModuleOptions = Readonly<{
  readonly environment: Environment;
  readonly logger: Pick<Logger, 'error' | 'info' | 'warn'>;
  readonly runtimeOptions?: Partial<WorkerRuntimeOptions>;
  readonly sleep?: WorkerSleep;
}>;

function defaultSleep(ms: number, signal: AbortSignal): Promise<void> {
  return sleepWithAbort(ms, undefined, { signal });
}

@Module({})
export class WorkerModule {
  public static register(options: WorkerModuleOptions): DynamicModule {
    const runtimeOptions: WorkerRuntimeOptions = {
      ...DEFAULT_WORKER_RUNTIME_OPTIONS,
      ...options.runtimeOptions,
    };

    const providers: Provider[] = [
      {
        provide: WORKER_DATABASE_POOL,
        useValue: createDatabasePool(options.environment.DATABASE_URL),
      },
      {
        provide: WORKER_LOGGER,
        useValue: options.logger,
      },
      {
        provide: WORKER_RUNTIME_OPTIONS,
        useValue: runtimeOptions,
      },
      {
        provide: WORKER_SLEEP,
        useValue: options.sleep ?? defaultSleep,
      },
      {
        provide: OUTBOX_REPOSITORY,
        useFactory: (pool: ReturnType<typeof createDatabasePool>) => createOutboxRepository(pool),
        inject: [WORKER_DATABASE_POOL],
      },
      {
        provide: ASSET_REPOSITORY,
        useFactory: (pool: ReturnType<typeof createDatabasePool>) => createAssetRepository(pool),
        inject: [WORKER_DATABASE_POOL],
      },
      {
        provide: SETTLEMENT_REPOSITORY,
        useFactory: (pool: ReturnType<typeof createDatabasePool>) => createSettlementRepository(pool),
        inject: [WORKER_DATABASE_POOL],
      },
      {
        provide: CAVE_REPOSITORY,
        useFactory: (pool: ReturnType<typeof createDatabasePool>) => createCaveRepository(pool),
        inject: [WORKER_DATABASE_POOL],
      },
      {
        provide: BREAKTHROUGH_REPOSITORY,
        useFactory: (pool: ReturnType<typeof createDatabasePool>) => createBreakthroughRepository(pool),
        inject: [WORKER_DATABASE_POOL],
      },
      SettlementContinuationService,
      CaveRecoveryService,
      BreakthroughRecoveryService,
      {
        provide: OUTBOX_EVENT_DEDUPE,
        useFactory: (repository: ReturnType<typeof createOutboxRepository>) => createOutboxDedupe(repository),
        inject: [OUTBOX_REPOSITORY],
      },
      {
        provide: OutboxWorker,
        useFactory: (
          repository: ReturnType<typeof createOutboxRepository>,
          dedupe: { readonly hasProcessed: (eventId: string) => Promise<boolean>; readonly markProcessed: (eventId: string) => Promise<void> },
          logger: Pick<Logger, 'error' | 'info' | 'warn'>,
        ) => new OutboxWorker(repository, createOutboxHandler(logger), dedupe),
        inject: [OUTBOX_REPOSITORY, OUTBOX_EVENT_DEDUPE, WORKER_LOGGER],
      },
      {
        provide: SettlementContinuationWorker,
        useFactory: (
          repository: ReturnType<typeof createSettlementRepository>,
          service: SettlementContinuationService,
        ) => new SettlementContinuationWorker(repository, service.continueCharacter),
        inject: [SETTLEMENT_REPOSITORY, SettlementContinuationService],
      },
      {
        provide: CaveRecoveryWorker,
        useFactory: (
          repository: ReturnType<typeof createCaveRepository>,
          service: CaveRecoveryService,
        ) => new CaveRecoveryWorker(repository, service),
        inject: [CAVE_REPOSITORY, CaveRecoveryService],
      },
      {
        provide: BreakthroughRecoveryWorker,
        useFactory: (
          repository: ReturnType<typeof createBreakthroughRepository>,
          service: BreakthroughRecoveryService,
        ) => new BreakthroughRecoveryWorker(repository, service),
        inject: [BREAKTHROUGH_REPOSITORY, BreakthroughRecoveryService],
      },
      WorkerRuntimeService,
    ];

    return {
      module: WorkerModule,
      providers,
    };
  }
}
