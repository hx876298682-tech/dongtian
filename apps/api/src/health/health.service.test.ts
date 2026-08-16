import { describe, expect, it } from 'vitest';

import { parseEnvironment } from '@dongtian/config-schema';

import { HealthService } from './health.service.js';

describe('HealthService', () => {
  it('reports liveness without contacting the database', () => {
    const environment = parseEnvironment({ NODE_ENV: 'test', APP_ENV: 'test' });
    const service = new HealthService(environment);

    expect(service.live()).toEqual({ status: 'ok' });
  });

  it('distinguishes an unavailable database from liveness', async () => {
    const environment = parseEnvironment({
      NODE_ENV: 'test',
      APP_ENV: 'test',
      DATABASE_URL: 'postgresql://127.0.0.1:65432/unavailable',
    });
    const service = new HealthService(environment);

    await expect(service.ready()).rejects.toMatchObject({
      response: {
        code: 'SERVICE_NOT_READY',
        details: { dependency: 'database' },
      },
      status: 503,
    });
  });
});
