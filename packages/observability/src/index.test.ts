import { Writable } from 'node:stream';

import { describe, expect, it } from 'vitest';

import {
  REDACTION_PATHS,
  createLogger,
  initializeObservability,
  recordHttpRequest,
  startRequestSpan,
} from './index.js';

describe('observability', () => {
  it('is safe when tracing is disabled and records no external I/O', () => {
    const observability = initializeObservability('test-service');
    const requestSpan = startRequestSpan(observability, 'request-1', '/health/live');
    let callbackRan = false;

    requestSpan.run(() => {
      callbackRan = true;
    });
    requestSpan.end(200);
    recordHttpRequest(observability, { method: 'GET', route: '/health/live', statusCode: 200 }, 4);

    expect(observability.tracingEnabled).toBe(false);
    expect(callbackRan).toBe(true);
    expect(REDACTION_PATHS).toContain('req.headers.cookie');
  });

  it('redacts credential-shaped fields from structured logs', () => {
    let output = '';
    const stream = new Writable({
      write(chunk, _encoding, callback) {
        output += chunk.toString();
        callback();
      },
    });
    const logger = createLogger('test-service', { stream });

    logger.info(
      {
        password: 'secret-password',
        session_token: 'secret-session',
        req: { headers: { cookie: 'secret-cookie' } },
        safe_field: 'retained',
      },
      'redaction test',
    );

    expect(output).not.toContain('secret-password');
    expect(output).not.toContain('secret-session');
    expect(output).not.toContain('secret-cookie');
    expect(output).toContain('retained');
  });
});
