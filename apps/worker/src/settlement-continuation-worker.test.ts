import { describe, expect, it, vi } from 'vitest';

import type { SettlementRepository } from '@dongtian/database';

import { SettlementContinuationWorker } from './settlement-continuation-worker.js';

describe('SettlementContinuationWorker', () => {
  it('delegates bounded continuation work to the transaction-held repository claim', async () => {
    const runContinuationBatch = vi.fn(async (
      limit: number,
      handler: (client: never, characterId: string) => Promise<void>,
    ) => {
      await handler(undefined as never, 'character-1');
      return limit;
    });
    const repository = {
      runContinuationBatch,
    } as unknown as SettlementRepository;
    const handler = vi.fn(async () => undefined);

    await expect(new SettlementContinuationWorker(repository, handler).runOnce(3)).resolves.toBe(3);
    expect(runContinuationBatch).toHaveBeenCalledWith(3, handler);
    expect(handler).toHaveBeenCalledWith(undefined, 'character-1');
  });
});
