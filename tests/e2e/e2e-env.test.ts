import { afterEach, describe, expect, it, vi } from 'vitest';

import { loadE2EEnvironment } from './e2e-env.js';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('e2e environment', () => {
  it('defaults to docker mode and uses the explicit test database url', () => {
    const environment = loadE2EEnvironment();

    expect(environment.databaseMode).toBe('docker');
    expect(environment.testDatabaseUrl).toBe(
      'postgresql://dongtian_test:dongtian_test@127.0.0.1:5433/dongtian_test',
    );
    expect(environment.allowPg16Uuidv7Shim).toBe(false);
  });

  it('accepts explicit external mode and cleanup allowlists', () => {
    vi.stubEnv('E2E_DATABASE_MODE', 'external');
    vi.stubEnv('E2E_ALLOW_PG16_UUIDV7_SHIM', 'true');
    vi.stubEnv('E2E_DATABASE_WIPE_ALLOWLIST', 'dongtian_test,postgresql://dongtian_test@127.0.0.1:5433/dongtian_test');

    const environment = loadE2EEnvironment();

    expect(environment.databaseMode).toBe('external');
    expect(environment.allowPg16Uuidv7Shim).toBe(true);
    expect(environment.databaseWipeAllowlist).toEqual([
      'dongtian_test',
      'postgresql://dongtian_test@127.0.0.1:5433/dongtian_test',
    ]);
  });
});
