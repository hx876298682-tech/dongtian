import type { PoolClient, SettlementRepository } from '@dongtian/database';

export type SettlementContinuationHandler = (client: PoolClient, characterId: string) => Promise<void>;

export class SettlementContinuationWorker {
  public constructor(
    private readonly repository: SettlementRepository,
    private readonly handler: SettlementContinuationHandler,
  ) {}

  public runOnce(limit = 10): Promise<number> {
    return this.repository.runContinuationBatch(limit, this.handler);
  }
}
