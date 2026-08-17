import { describe, expect, it } from 'vitest';

import { SHELL_BRAND_COPY, SHELL_FLOW_STEPS, SHELL_PANELS, SHELL_ROUTES, SHELL_ROUTE_ALIASES } from './navigation.js';
import { useUiDraftStore } from './state/ui-draft-store.js';

describe('web shell scaffolding', () => {
  it('keeps the core navigation and reference-style page entries', () => {
    expect(SHELL_ROUTES.length).toBeGreaterThanOrEqual(17);
    expect(SHELL_ROUTES.map((route) => route.id)).toEqual(expect.arrayContaining([
      'dashboard',
      'cultivation',
      'craft',
      'expedition',
      'character',
      'inventory',
      'settings',
    ]));
    expect(SHELL_ROUTES.map((route) => route.id)).toEqual(expect.arrayContaining(['tasks', 'maze', 'shops', 'achievements', 'leaderboard', 'guild', 'social', 'guide', 'rules', 'news']));
    expect(SHELL_PANELS.map((panel) => panel.id)).toEqual(['current-action', 'settlement-summary', 'goal-tracker']);
  });

  it('exposes the reference shop and update destinations as independent player-facing entries', () => {
    const routesById = new Map(SHELL_ROUTES.map((route) => [route.id, route]));

    expect(routesById.get('shops')).toMatchObject({ path: '/shops', label: '市场' });
    expect(routesById.get('store')).toMatchObject({ path: '/store', label: '商店' });
    expect(routesById.get('cowbell-shop')).toMatchObject({ path: '/cowbell-shop', label: '牛铃商店' });
    expect(routesById.get('news')).toMatchObject({ path: '/news', label: '新闻' });
    expect(routesById.get('changelog')).toMatchObject({ path: '/changelog', label: '更新日志' });
  });

  it('keeps legacy and common reference deep links mapped to existing locked page kinds', () => {
    expect(SHELL_ROUTE_ALIASES).toEqual(expect.arrayContaining([
      { path: '/market', kind: 'shops' },
      { path: '/updates', kind: 'news' },
      { path: '/update-log', kind: 'changelog' },
    ]));
    expect(SHELL_ROUTE_ALIASES.some((alias) => alias.path === '/shops')).toBe(false);
    expect(SHELL_ROUTE_ALIASES.some((alias) => alias.path === '/news')).toBe(false);
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
