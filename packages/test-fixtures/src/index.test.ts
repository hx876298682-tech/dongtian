import { describe, expect, it } from 'vitest';

import { packageName } from './index.js';

describe('workspace test fixtures package', () => {
  it('exposes its stable workspace identity', () => {
    expect(packageName).toBe('@dongtian/test-fixtures');
  });
});
