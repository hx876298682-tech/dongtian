import { describe, expect, it } from 'vitest';

import { SHELL_BRAND_COPY, SHELL_FLOW_STEPS, SHELL_PANELS, SHELL_ROUTES } from './navigation.js';
import { useUiDraftStore } from './state/ui-draft-store.js';

describe('web shell scaffolding', () => {
  it('keeps the core navigation plus local settings and no market route', () => {
    expect(SHELL_ROUTES).toHaveLength(7);
    expect(SHELL_ROUTES.map((route) => route.id)).toEqual([
      'dashboard',
      'cultivation',
      'craft',
      'expedition',
      'character',
      'inventory',
      'settings',
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

  it('defines an ordered single-player flow across the core cultivation surfaces', () => {
    expect(SHELL_FLOW_STEPS.map((step) => step.id)).toEqual([
      'dashboard',
      'cave',
      'cultivation',
      'queue',
      'inventory',
      'expedition',
    ]);
    expect(SHELL_FLOW_STEPS.map((step) => step.path)).toEqual([
      '/dashboard',
      '/dashboard/cave',
      '/cultivation',
      '/dashboard#queue',
      '/inventory',
      '/expedition',
    ]);
  });

  it('uses player-facing shell copy instead of implementation placeholders', () => {
    expect(Object.values(SHELL_BRAND_COPY).join(' ')).not.toMatch(/M2|骨架|UI 草稿|桌面三栏/);
  });
});
