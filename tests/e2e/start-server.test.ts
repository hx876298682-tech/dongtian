import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

const source = readFileSync(new URL('./start-server.ts', import.meta.url), 'utf8');

describe('E2E server bootstrap', () => {
  it('passes Vite host and port options through pnpm without a literal separator argument', () => {
    expect(source).toContain("['--filter', '@dongtian/web', 'dev', '--host'");
    expect(source).not.toContain("['--filter', '@dongtian/web', 'dev', '--', '--host'");
  });
});
