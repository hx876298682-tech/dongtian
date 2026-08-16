import { Module } from '@nestjs/common';
import { createCaveRepository, type DatabasePool } from '@dongtian/database';

import { AssetModule } from '../asset/asset.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { databasePoolToken } from '../auth/auth.tokens.js';
import { ConfigModule } from '../config/config.module.js';
import { EnvironmentModule } from '../environment.module.js';
import { IdempotencyModule } from '../idempotency/idempotency.module.js';
import { SettlementModule } from '../settlement/settlement.module.js';
import { caveRepositoryToken } from './cave.tokens.js';
import { CaveController } from './cave.controller.js';
import { CaveService } from './cave.service.js';

@Module({
  imports: [AuthModule, AssetModule, ConfigModule, EnvironmentModule, IdempotencyModule, SettlementModule],
  controllers: [CaveController],
  providers: [
    {
      provide: caveRepositoryToken,
      inject: [databasePoolToken],
      useFactory: (pool: DatabasePool) => createCaveRepository(pool),
    },
    CaveService,
  ],
  exports: [CaveService],
})
export class CaveModule {}
