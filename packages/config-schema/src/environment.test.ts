import { describe, expect, it } from 'vitest';

import { parseEnvironment } from './index.js';

describe('environment schema', () => {
  it('provides only local defaults outside production', () => {
    const environment = parseEnvironment({ NODE_ENV: 'test', APP_ENV: 'test' });

    expect(environment.API_PORT).toBe(3000);
    expect(environment.APP_ENV).toBe('test');
  });

  it('rejects missing production secrets', () => {
    expect(() => parseEnvironment({ NODE_ENV: 'production', APP_ENV: 'production' })).toThrow();
  });
});
