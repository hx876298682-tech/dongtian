import { Module } from '@nestjs/common';
import { createBuffRepository, createSettlementRepository, type DatabasePool } from '@dongtian/database';

import { AssetModule } from '../asset/asset.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { databasePoolToken } from '../auth/auth.tokens.js';
import { ConfigModule } from '../config/config.module.js';
import { EnvironmentModule } from '../environment.module.js';
import { IdempotencyModule } from '../idempotency/idempotency.module.js';
import { SettlementService } from './settlement.service.js';
import { SettlementController } from './settlement.controller.js';
import { buffRepositoryToken } from '../buff/buff.tokens.js';
import { settlementRepositoryToken } from './settlement.tokens.js';

@Module({
  imports: [AuthModule, AssetModule, ConfigModule, EnvironmentModule, IdempotencyModule],
  controllers: [SettlementController],
  providers: [
    {
      provide: settlementRepositoryToken,
      inject: [databasePoolToken],
      useFactory: (pool: DatabasePool) => createSettlementRepository(pool),
    },
    {
      provide: buffRepositoryToken,
      inject: [databasePoolToken],
      useFactory: (pool: DatabasePool) => createBuffRepository(pool),
    },
    SettlementService,
  ],
  exports: [SettlementService, buffRepositoryToken],
})
export class SettlementModule {}
