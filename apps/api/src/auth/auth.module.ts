import {
  Inject,
  Injectable,
  Module,
  type OnModuleDestroy,
} from '@nestjs/common';
import {
  createAuthRepository,
  createDatabasePool,
  type DatabasePool,
} from '@dongtian/database';

import { EnvironmentModule } from '../environment.module.js';
import { ConfigModule } from '../config/config.module.js';
import { environmentToken } from '../environment.js';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { authRepositoryToken, databasePoolToken } from './auth.tokens.js';

@Injectable()
class DatabasePoolLifecycle implements OnModuleDestroy {
  public constructor(@Inject(databasePoolToken) private readonly pool: DatabasePool) {}

  public async onModuleDestroy(): Promise<void> {
    await this.pool.end();
  }
}

@Module({
  imports: [EnvironmentModule, ConfigModule],
  controllers: [AuthController],
  providers: [
    {
      provide: databasePoolToken,
      inject: [environmentToken],
      useFactory: (environment: { readonly DATABASE_URL: string }) =>
        createDatabasePool(environment.DATABASE_URL),
    },
    {
      provide: authRepositoryToken,
      inject: [databasePoolToken],
      useFactory: (pool: DatabasePool) => createAuthRepository(pool),
    },
    DatabasePoolLifecycle,
    AuthService,
  ],
  exports: [AuthService, databasePoolToken],
})
export class AuthModule {}
