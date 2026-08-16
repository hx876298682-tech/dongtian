import { Module } from '@nestjs/common';
import {
  createIdempotencyExecutor,
  type DatabasePool,
} from '@dongtian/database';

import { AuthModule } from '../auth/auth.module.js';
import { databasePoolToken } from '../auth/auth.tokens.js';
import { IdempotencyService } from './idempotency.service.js';
import { idempotencyExecutorToken } from './idempotency.tokens.js';

@Module({
  imports: [AuthModule],
  providers: [
    {
      provide: idempotencyExecutorToken,
      inject: [databasePoolToken],
      useFactory: (pool: DatabasePool) => createIdempotencyExecutor(pool),
    },
    IdempotencyService,
  ],
  exports: [IdempotencyService],
})
export class IdempotencyModule {}
