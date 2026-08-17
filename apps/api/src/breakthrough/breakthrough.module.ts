import { Module } from '@nestjs/common';

import { createBreakthroughRepository, type DatabasePool } from '@dongtian/database';

import { AssetModule } from '../asset/asset.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { databasePoolToken } from '../auth/auth.tokens.js';
import { ConfigModule } from '../config/config.module.js';
import { SettlementModule } from '../settlement/settlement.module.js';
import { BreakthroughController } from './breakthrough.controller.js';
import { BreakthroughService } from './breakthrough.service.js';
import { breakthroughRepositoryToken } from './breakthrough.tokens.js';

@Module({
  imports: [AssetModule, AuthModule, ConfigModule, SettlementModule],
  controllers: [BreakthroughController],
  providers: [
    {
      provide: breakthroughRepositoryToken,
      inject: [databasePoolToken],
      useFactory: (pool: DatabasePool) => createBreakthroughRepository(pool),
    },
    BreakthroughService,
  ],
  exports: [BreakthroughService],
})
export class BreakthroughModule {}
