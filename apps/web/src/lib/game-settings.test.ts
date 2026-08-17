import { afterEach, describe, expect, it, vi } from 'vitest';

import { shouldConfirmImportantActions } from './game-settings.js';

describe('game settings', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('reads the important-action confirmation preference with a safe default', () => {
    const values = new Map<string, string>();
    vi.stubGlobal('window', { localStorage: { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value) } });
    expect(shouldConfirmImportantActions()).toBe(true);

    values.set('dongtian.game-settings.v1', JSON.stringify({ confirmImportantActions: false }));
    expect(shouldConfirmImportantActions()).toBe(false);
  });
});
