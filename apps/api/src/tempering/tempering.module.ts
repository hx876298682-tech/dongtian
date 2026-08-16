import { Module } from '@nestjs/common';
import { createTemperingRepository, type DatabasePool } from '@dongtian/database';

import { AuthModule } from '../auth/auth.module.js';
import { databasePoolToken } from '../auth/auth.tokens.js';
import { ConfigModule } from '../config/config.module.js';
import { SettlementModule } from '../settlement/settlement.module.js';
import { TemperingController } from './tempering.controller.js';
import { TemperingService } from './tempering.service.js';
import { temperingRepositoryToken } from './tempering.tokens.js';

@Module({
  imports: [AuthModule, ConfigModule, SettlementModule],
  controllers: [TemperingController],
  providers: [
    {
      provide: temperingRepositoryToken,
      inject: [databasePoolToken],
      useFactory: (pool: DatabasePool) => createTemperingRepository(pool),
    },
    TemperingService,
  ],
})
export class TemperingModule {}
