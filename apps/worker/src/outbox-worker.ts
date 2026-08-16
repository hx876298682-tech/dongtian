import type { OutboxEvent, OutboxRepository } from '@dongtian/database';

export type OutboxEventDedupe = {
  /** The implementation must persist this decision with the consumer result. */
  readonly hasProcessed: (eventId: string) => Promise<boolean>;
  readonly markProcessed: (eventId: string) => Promise<void>;
};

export type OutboxEventHandler = (event: OutboxEvent) => Promise<void>;

export type OutboxWorkerRunResult = {
  readonly claimed: number;
  readonly processed: number;
  readonly failed: number;
  readonly skipped: number;
};

function errorMessage(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
}

export class OutboxWorker {
  public constructor(
    private readonly repository: OutboxRepository,
    private readonly handler: OutboxEventHandler,
    private readonly dedupe: OutboxEventDedupe,
    private readonly maxAttempts = 8,
  ) {}

  public async runOnce(input: {
    readonly limit?: number;
    readonly now?: Date;
    readonly leaseMs?: number;
  } = {}): Promise<OutboxWorkerRunResult> {
    const events = await this.repository.claimBatch(input);
    let processed = 0;
    let failed = 0;
    let skipped = 0;

    for (const event of events) {
      try {
        if (await this.dedupe.hasProcessed(event.id)) {
          await this.repository.markPublished(event.id, input.now);
          skipped += 1;
          continue;
        }
        await this.handler(event);
        await this.dedupe.markProcessed(event.id);
        await this.repository.markPublished(event.id, input.now);
        processed += 1;
      } catch (error) {
        failed += 1;
        const message = errorMessage(error);
        if (event.attemptCount >= this.maxAttempts) {
          await this.repository.markFailed(event.id, message, input.now);
        } else {
          const now = input.now ?? new Date();
          const delayMs = Math.min(60 * 60 * 1_000, 1_000 * 2 ** Math.min(event.attemptCount, 10));
          await this.repository.requeue(event.id, message, new Date(now.getTime() + delayMs));
        }
      }
    }

    return { claimed: events.length, processed, failed, skipped };
  }
}
