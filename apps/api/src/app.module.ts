import { Module } from '@nestjs/common';
import { LoggerModule } from 'nestjs-pino';

import { EnvironmentModule } from './environment.module.js';
import { ConfigModule } from './config/config.module.js';
import { AuthModule } from './auth/auth.module.js';
import { CharacterModule } from './character/character.module.js';
import { ContentModule } from './content/content.module.js';
import { AssetModule } from './asset/asset.module.js';
import { BuffModule } from './buff/buff.module.js';
import { EquipmentModule } from './equipment/equipment.module.js';
import { DungeonModule } from './dungeon/dungeon.module.js';
import { IdempotencyModule } from './idempotency/idempotency.module.js';
import { HealthModule } from './health/health.module.js';
import { QueueModule } from './queue/queue.module.js';
import { SettlementModule } from './settlement/settlement.module.js';
import { SuccessEnvelopeInterceptor } from './http/envelope.interceptor.js';

@Module({
  imports: [
    EnvironmentModule,
    AuthModule,
    CharacterModule,
    ContentModule,
    AssetModule,
    BuffModule,
    EquipmentModule,
    DungeonModule,
    IdempotencyModule,
    ConfigModule,
    HealthModule,
    QueueModule,
    SettlementModule,
    LoggerModule.forRoot({
      pinoHttp: {
        redact: ['req.headers.cookie', 'req.headers.authorization'],
      },
    }),
  ],
  providers: [SuccessEnvelopeInterceptor],
})
export class AppModule {}
