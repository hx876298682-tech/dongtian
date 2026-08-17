import { describe, expect, it } from 'vitest';

import {
  assertE2EDatabaseCompatibility,
  validateE2ETestDatabaseUrl,
} from './e2e-database.js';

describe('e2e database safety', () => {
  it('accepts an isolated localhost test database', () => {
    const target = validateE2ETestDatabaseUrl(
      'postgresql://dongtian_test:dongtian_test@127.0.0.1:5433/dongtian_test',
      'docker',
      [],
    );

    expect(target.databaseName).toBe('dongtian_test');
    expect(target.hostname).toBe('127.0.0.1');
    expect(target.username).toBe('dongtian_test');
  });

  it('rejects a production-like database target', () => {
    expect(() =>
      validateE2ETestDatabaseUrl('postgresql://app@db.example.com:5432/main', 'external', ['main']),
    ).toThrow(/blocked database target/);
  });

  it('rejects a local database that is not explicitly test-scoped', () => {
    expect(() =>
      validateE2ETestDatabaseUrl('postgresql://app@127.0.0.1:5432/dongtian', 'docker', []),
    ).toThrow(/explicit test database/);
  });

  it('requires an explicit allowlist in external mode and keeps secrets out of the error', () => {
    let error: unknown;
    try {
      validateE2ETestDatabaseUrl(
        'postgresql://alice:super-secret@127.0.0.1:5433/alice_test',
        'external',
        [],
      );
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(Error);
    expect(String(error)).toMatch(/E2E_DATABASE_WIPE_ALLOWLIST/);
    expect(String(error)).not.toContain('super-secret');
    expect(String(error)).not.toContain('alice:super-secret@127.0.0.1:5433/alice_test');
  });

  it('requires explicit opt-in before accepting pg16 as ready', async () => {
    expect(() => assertE2EDatabaseCompatibility(160000, false, '127.0.0.1')).toThrow(
      /PostgreSQL 18 is required/,
    );
    expect(assertE2EDatabaseCompatibility(160000, true, '127.0.0.1')).toBe('postgres16-shim');
    expect(() => assertE2EDatabaseCompatibility(160000, true, 'db.example.com')).toThrow(
      /local isolated databases/,
    );
  });
});
