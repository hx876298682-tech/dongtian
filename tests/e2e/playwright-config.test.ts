import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

const source = readFileSync(new URL('../../playwright.config.ts', import.meta.url), 'utf8');

describe('Playwright E2E configuration', () => {
  it('supports an explicit local Chromium executable without changing the default browser', () => {
    expect(source).toContain('PLAYWRIGHT_EXECUTABLE_PATH');
    expect(source).toContain('launchOptions');
  });
});
