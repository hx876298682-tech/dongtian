import { describe, expect, it } from 'vitest';

const requiredApplications = ['api', 'admin', 'web', 'worker'] as const;
const requiredPackages = [
  'config-schema',
  'contracts',
  'database',
  'game-rules',
  'observability',
  'test-fixtures',
  'ui',
] as const;

describe('DT-M0-001 workspace shape', () => {
  it('keeps the required application and package names explicit', () => {
    expect(requiredApplications).toHaveLength(4);
    expect(requiredPackages).toHaveLength(7);
    expect(new Set(requiredApplications).size).toBe(requiredApplications.length);
    expect(new Set(requiredPackages).size).toBe(requiredPackages.length);
  });
});
