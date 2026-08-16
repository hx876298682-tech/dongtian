import { Module } from '@nestjs/common';
import { createDungeonRepository, type DatabasePool } from '@dongtian/database';

import { AuthModule } from '../auth/auth.module.js';
import { databasePoolToken } from '../auth/auth.tokens.js';
import { AssetModule } from '../asset/asset.module.js';
import { ConfigModule } from '../config/config.module.js';
import { SettlementModule } from '../settlement/settlement.module.js';
import { DungeonController } from './dungeon.controller.js';
import { DungeonService } from './dungeon.service.js';
import { dungeonRepositoryToken } from './dungeon.tokens.js';

@Module({
  imports: [AuthModule, AssetModule, ConfigModule, SettlementModule],
  controllers: [DungeonController],
  providers: [
    {
      provide: dungeonRepositoryToken,
      inject: [databasePoolToken],
      useFactory: (pool: DatabasePool) => createDungeonRepository(pool),
    },
    DungeonService,
  ],
  exports: [DungeonService, dungeonRepositoryToken],
})
export class DungeonModule {}
