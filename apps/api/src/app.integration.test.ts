import 'reflect-metadata';

import { afterEach, describe, expect, it } from 'vitest';

import { parseEnvironment } from '@dongtian/config-schema';

import { createApp } from './app.factory.js';

const originalEnvironment = { ...process.env };

afterEach(() => {
  for (const key of Object.keys(process.env)) {
    if (!(key in originalEnvironment)) {
      delete process.env[key];
    }
  }

  for (const [key, value] of Object.entries(originalEnvironment)) {
    process.env[key] = value;
  }
});

describe('API HTTP boundary', () => {
  it('returns the versioned success envelope for liveness', async () => {
    process.env['NODE_ENV'] = 'test';
    process.env['APP_ENV'] = 'test';
    const environment = parseEnvironment(process.env);
    const app = await createApp();

    try {
      await app.init();
      const response = await app.getHttpAdapter().getInstance().inject({
        method: 'GET',
        url: '/api/v1/health/live',
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({
        data: { status: 'ok' },
        meta: {
          config_version: environment.ACTIVE_CONFIG_VERSION,
        },
      });
      expect(response.json().meta.request_id).toEqual(expect.any(String));
      expect(response.json().meta.server_time).toEqual(expect.any(String));

      const configResponse = await app.getHttpAdapter().getInstance().inject({
        method: 'GET',
        url: '/api/v1/config/manifest',
      });

      expect(configResponse.statusCode).toBe(200);
      expect(configResponse.json()).toMatchObject({
        data: { config_version: environment.ACTIVE_CONFIG_VERSION },
        meta: { config_version: environment.ACTIVE_CONFIG_VERSION },
      });
    } finally {
      await app.close();
    }
  });

  it('returns a structured readiness error when the database is unavailable', async () => {
    process.env['NODE_ENV'] = 'test';
    process.env['APP_ENV'] = 'test';
    process.env['DATABASE_URL'] = 'postgresql://127.0.0.1:65432/unavailable';
    const app = await createApp();

    try {
      await app.init();
      const response = await app.getHttpAdapter().getInstance().inject({
        method: 'GET',
        url: '/api/v1/health/ready',
      });

      expect(response.statusCode).toBe(503);
      expect(response.json()).toMatchObject({
        error: {
          code: 'SERVICE_NOT_READY',
          message_key: 'error.service_not_ready',
          retryable: true,
          details: { dependency: 'database' },
        },
        meta: { request_id: expect.any(String), server_time: expect.any(String) },
      });
    } finally {
      await app.close();
    }
  });
});
