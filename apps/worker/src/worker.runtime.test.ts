import { describe, expect, it, vi } from 'vitest';

import type { DatabasePool } from '@dongtian/database';
import { PollingLoop, WorkerRuntimeService, type WorkerRuntimeOptions, type WorkerSleep } from './worker.runtime.js';

type Deferred<T> = {
  readonly promise: Promise<T>;
  readonly resolve: (value: T | PromiseLike<T>) => void;
  readonly reject: (reason?: unknown) => void;
};

function createDeferred<T>(): Deferred<T> {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((innerResolve, innerReject) => {
    resolve = innerResolve;
    reject = innerReject;
  });
  return { promise, resolve, reject };
}

function waitFor(predicate: () => boolean): Promise<void> {
  return new Promise((resolve, reject) => {
    let attempts = 0;
    const tick = (): void => {
      if (predicate()) {
        resolve();
        return;
      }
      attempts += 1;
      if (attempts > 100) {
        reject(new Error('condition was not reached'));
        return;
      }
      setTimeout(tick, 0);
    };
    tick();
  });
}

describe('PollingLoop', () => {
  it('backs off when idle and stops without starting another cycle', async () => {
    const delays: number[] = [];
    const pending: Array<Deferred<void>> = [];
    const sleep: WorkerSleep = async (_ms, signal) => {
      delays.push(_ms);
      const deferred = createDeferred<void>();
      const abort = (): void => {
        const error = new Error('The operation was aborted.');
        error.name = 'AbortError';
        deferred.reject(error);
      };
      signal.addEventListener('abort', abort, { once: true });
      pending.push(deferred);
      try {
        await deferred.promise;
      } finally {
        signal.removeEventListener('abort', abort);
      }
    };
    const step = vi.fn(async () => false);
    const logger = {
      error: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
    };

    const loop = new PollingLoop(step, {
      logger,
      name: 'test-loop',
      sleep,
      busyDelayMs: 25,
      idleDelayMs: 50,
      maxDelayMs: 200,
    });
    const running = loop.start();

    await waitFor(() => delays.length === 1);
    expect(delays[0]).toBe(100);
    expect(step).toHaveBeenCalledTimes(1);

    const stop = loop.stop();
    pending[0]?.resolve();
    await stop;
    await running;

    expect(step).toHaveBeenCalledTimes(1);
    expect(delays).toHaveLength(1);
  });
});

describe('WorkerRuntimeService', () => {
  it('uses Nest lifecycle hooks to start and stop the runtime', async () => {
    const pool = {
      end: vi.fn(async () => undefined),
    } as never;
    const logger = {
      error: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
    };
    const options: WorkerRuntimeOptions = {
      busyDelayMs: 10,
      idleDelayMs: 20,
      maxDelayMs: 80,
      outboxBatchLimit: 5,
      outboxLeaseMs: 1_000,
      settlementBatchLimit: 2,
    };
    const sleep: WorkerSleep = vi.fn(async () => undefined);
    const outboxWorker = {
      runOnce: vi.fn(async () => ({ claimed: 0, processed: 0, failed: 0, skipped: 0 })),
    };
    const settlementWorker = {
      runOnce: vi.fn(async () => 0),
    };
    const service = new WorkerRuntimeService(
      pool,
      logger,
      options,
      sleep,
      outboxWorker as never,
      settlementWorker as never,
    );
    const startSpy = vi.spyOn(service, 'start').mockResolvedValue(undefined);
    const stopSpy = vi.spyOn(service, 'stop').mockResolvedValue(undefined);

    service.onApplicationBootstrap();
    await service.beforeApplicationShutdown();
    await service.onApplicationShutdown();

    expect(startSpy).toHaveBeenCalledTimes(1);
    expect(stopSpy).toHaveBeenCalledTimes(2);
  });

  it('starts both worker loops and closes the pool on shutdown', async () => {
    const sleeps: Array<Deferred<void>> = [];
    const sleep: WorkerSleep = async (_ms, signal) => {
      const deferred = createDeferred<void>();
      const abort = (): void => {
        const error = new Error('The operation was aborted.');
        error.name = 'AbortError';
        deferred.reject(error);
      };
      signal.addEventListener('abort', abort, { once: true });
      sleeps.push(deferred);
      try {
        await deferred.promise;
      } finally {
        signal.removeEventListener('abort', abort);
      }
    };
    const outboxWorker = {
      runOnce: vi.fn(async () => ({ claimed: 0, processed: 0, failed: 0, skipped: 0 })),
    };
    const settlementWorker = {
      runOnce: vi.fn(async () => 0),
    };
    const pool = {
      end: vi.fn(async () => undefined),
    } as unknown as DatabasePool;
    const logger = {
      error: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
    };
    const options: WorkerRuntimeOptions = {
      busyDelayMs: 10,
      idleDelayMs: 20,
      maxDelayMs: 80,
      outboxBatchLimit: 5,
      outboxLeaseMs: 1_000,
      settlementBatchLimit: 2,
    };
    const service = new WorkerRuntimeService(
      pool,
      logger,
      options,
      sleep,
      outboxWorker as never,
      settlementWorker as never,
    );

    const started = service.start();
    await waitFor(() => outboxWorker.runOnce.mock.calls.length === 1 && settlementWorker.runOnce.mock.calls.length === 1);

    const stopping = service.stop();
    sleeps.forEach((deferred) => deferred.resolve());
    await stopping;
    await started;

    expect(outboxWorker.runOnce).toHaveBeenCalledWith({
      limit: options.outboxBatchLimit,
      leaseMs: options.outboxLeaseMs,
    });
    expect(settlementWorker.runOnce).toHaveBeenCalledWith(options.settlementBatchLimit);
    expect(pool.end).toHaveBeenCalledTimes(1);
  });
});
