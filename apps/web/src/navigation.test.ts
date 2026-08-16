import { describe, expect, it } from 'vitest';

import { SHELL_PANELS, SHELL_ROUTES } from './navigation.js';
import { useUiDraftStore } from './state/ui-draft-store.js';

describe('web shell scaffolding', () => {
  it('keeps the required six navigation entries and no market route', () => {
    expect(SHELL_ROUTES).toHaveLength(6);
    expect(SHELL_ROUTES.map((route) => route.id)).toEqual([
      'dashboard',
      'cultivation',
      'craft',
      'expedition',
      'character',
      'inventory',
    ]);
    expect(SHELL_ROUTES.some((route) => route.id === 'market')).toBe(false);
    expect(SHELL_PANELS.map((panel) => panel.id)).toEqual(['current-action', 'settlement-summary', 'goal-tracker']);
  });

  it('keeps zustand state limited to ui drafts', () => {
    const state = useUiDraftStore.getState();

    expect(state.leftRailCollapsed).toBe(false);
    expect(state.rightRailPinned).toBe(true);
    expect(state.activeRailSection).toBe('current-action');
    expect(state.queueDraftTitle).toContain('采药');
    expect(Object.keys(state).some((key) => key.includes('account'))).toBe(false);
    expect(Object.keys(state).some((key) => key.includes('asset'))).toBe(false);
  });
});
