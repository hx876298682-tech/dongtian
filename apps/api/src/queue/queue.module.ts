import { Module } from '@nestjs/common';
import { createQueueRepository, type DatabasePool } from '@dongtian/database';

import { AuthModule } from '../auth/auth.module.js';
import { databasePoolToken } from '../auth/auth.tokens.js';
import { CharacterModule } from '../character/character.module.js';
import { AssetModule } from '../asset/asset.module.js';
import { ConfigModule } from '../config/config.module.js';
import { SettlementModule } from '../settlement/settlement.module.js';
import { QueueController } from './queue.controller.js';
import { QueueService } from './queue.service.js';
import { queueRepositoryToken } from './queue.tokens.js';

@Module({
  imports: [AuthModule, CharacterModule, AssetModule, ConfigModule, SettlementModule],
  controllers: [QueueController],
  providers: [
    {
      provide: queueRepositoryToken,
      inject: [databasePoolToken],
      useFactory: (pool: DatabasePool) => createQueueRepository(pool),
    },
    QueueService,
  ],
})
export class QueueModule {
}
