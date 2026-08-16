import type { CallHandler, ExecutionContext } from '@nestjs/common';
import { firstValueFrom, of } from 'rxjs';
import { describe, expect, it } from 'vitest';

import { parseEnvironment } from '@dongtian/config-schema';

import { SuccessEnvelopeInterceptor } from './envelope.interceptor.js';

describe('SuccessEnvelopeInterceptor', () => {
  it('copies a character state version into response metadata', async () => {
    const environment = parseEnvironment({ NODE_ENV: 'test', APP_ENV: 'test' });
    const interceptor = new SuccessEnvelopeInterceptor(environment);
    const context = {
      switchToHttp: () => ({ getRequest: () => ({ id: 'request-1' }) }),
    } as unknown as ExecutionContext;
    const next = {
      handle: () => of({ character: { state_version: 4 } }),
    } as unknown as CallHandler;

    await expect(firstValueFrom(interceptor.intercept(context, next))).resolves.toMatchObject({
      meta: {
        request_id: 'request-1',
        state_version: 4,
      },
    });
  });
});
