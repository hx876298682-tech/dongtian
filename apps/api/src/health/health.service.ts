import { Inject, Injectable, ServiceUnavailableException } from '@nestjs/common';

import { checkDatabaseHealth } from '@dongtian/database';
import type { Environment } from '@dongtian/config-schema';

import { environmentToken } from '../environment.js';

@Injectable()
export class HealthService {
  public constructor(@Inject(environmentToken) private readonly environment: Environment) {}

  public live(): { readonly status: 'ok' } {
    return { status: 'ok' };
  }

  public async ready(): Promise<{
    readonly status: 'ready';
    readonly dependencies: { readonly database: 'up' };
  }> {
    const database = await checkDatabaseHealth(this.environment.DATABASE_URL);

    if (!database.ok) {
      throw new ServiceUnavailableException({
        code: 'SERVICE_NOT_READY',
        message_key: 'error.service_not_ready',
        details: { dependency: 'database' },
      });
    }

    return { status: 'ready', dependencies: { database: 'up' } };
  }
}
