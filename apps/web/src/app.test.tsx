import { describe, expect, it } from 'vitest';

// Vitest runs this source-contract test in Node.
import { readFileSync } from 'node:fs';

import appSource from './app.tsx?raw';
const stylesSource = readFileSync(new URL('./styles.css', import.meta.url), 'utf8');

function cssBlock(selector: string): string {
  const start = stylesSource.indexOf(selector);
  expect(start, `missing CSS block for ${selector}`).toBeGreaterThanOrEqual(0);

  const open = stylesSource.indexOf('{', start);
  expect(open, `missing opening brace for ${selector}`).toBeGreaterThan(start);
  const end = stylesSource.indexOf('\n}', open);
  expect(end, `unterminated CSS block for ${selector}`).toBeGreaterThan(start);
  return stylesSource.slice(start, end);
}

describe('one-screen app shell', () => {
  it('keeps the shell landmarks and fixed three-column workspace semantics', () => {
    expect(appSource).toMatch(/className="app-shell"/);
    expect(appSource).toMatch(/className="app-shell__topbar"/);
    expect(appSource).toMatch(/className="app-shell__workspace"/);
    expect(appSource).toMatch(/<aside className=\{`shell-nav/);
    expect(appSource).toMatch(/<main className="shell-main"[^>]*id="main-content"/);
    expect(appSource).toMatch(/<aside className="shell-rail"/);
    expect(appSource).toMatch(/aria-label="活动日志"/);
    expect(appSource).not.toMatch(/className="app-shell__footer"/);
  });

  it('keeps the desktop viewport fixed while allowing the main surface to scroll internally', () => {
    const html = cssBlock('html');
    const body = cssBlock('body');
    const shell = cssBlock('.app-shell');
    const content = cssBlock('.shell-main__content');

    expect(html).toMatch(/overflow:\s*hidden/);
    expect(body).toMatch(/overflow:\s*hidden/);
    expect(shell).toMatch(/height:\s*100dvh/);
    expect(shell).toMatch(/grid-template-columns:\s*minmax\(0,\s*1fr\)/);
    expect(content).toMatch(/overflow:\s*auto/);
    expect(stylesSource).toMatch(/\.shell-main\s*\{[\s\S]*?min-width:\s*0/);
  });

  it('provides a dedicated mobile navigation landmark for the one-screen layout', () => {
    expect(appSource).toMatch(/className="shell-mobile-nav"/);
    expect(appSource).toMatch(/aria-label="移动端主导航"/);
    expect(stylesSource).toMatch(/@media \(max-width: 920px\)[\s\S]*\.shell-mobile-nav \{[\s\S]*?display:\s*grid/);
    expect(stylesSource).toMatch(/@media \(max-width: 920px\)[\s\S]*?\.app-shell__topbar\s*\{[\s\S]*?flex-wrap:\s*wrap/);
    expect(stylesSource).toMatch(/@media \(max-width: 920px\)[\s\S]*?\.app-shell__topbar\s*\{[\s\S]*?min-width:\s*0/);
    expect(stylesSource).toMatch(/@media \(max-width: 920px\)[\s\S]*?\.global-idle-progress\s*\{[\s\S]*?min-width:\s*0/);
    expect(stylesSource).toMatch(/@media \(max-width: 920px\)[\s\S]*?\.topbar-metrics\s*\{[\s\S]*?min-width:\s*0/);
  });

  it('uses a compact player-facing navigation with grouped destinations', () => {
    expect(appSource).toMatch(/aria-label="主导航：修行"/);
    expect(appSource).toMatch(/aria-label="主导航：冒险"/);
    expect(appSource).toMatch(/aria-label="主导航：角色"/);
    expect(appSource).not.toMatch(/快速入口/);
    expect(appSource).not.toMatch(/交易功能尚未开放/);
    expect(appSource).toMatch(/\['expedition', 'maze', 'shops', 'tasks'\]/);
    expect(appSource).toMatch(/\['character', 'inventory', 'achievements', 'leaderboard'\]/);
    expect(appSource).toMatch(/\['guild', 'social'\]/);
    expect(appSource).toMatch(/\['settings', 'guide', 'rules', 'news'\]/);
    expect(appSource).not.toMatch(/shell-nav__link-desc/);
    expect(appSource).toMatch(/shell-nav__link-label/);
  });

  it('keeps the right rail summary without a pin control', () => {
    expect(appSource).toMatch(/aria-label="角色面板"/);
    expect(appSource).toMatch(/\['inventory', '战利品'\]/);
    expect(appSource).toMatch(/\['loadout', '配装'\]/);
    expect(appSource).not.toMatch(/rightRailPinned/);
    expect(appSource).not.toMatch(/setRightRailPinned/);
    expect(appSource).not.toMatch(/固定|取消固定/);
  });

  it('keeps the top bar focused on player resources instead of engineering metadata', () => {
    expect(appSource).toMatch(/aria-label="全局当前行动"/);
    expect(appSource).toMatch(/aria-label="角色资源"/);
    expect(appSource).toMatch(/灵石/);
    expect(appSource).not.toMatch(/所在区域/);
    expect(appSource).not.toMatch(/会话到期/);
    expect(appSource).not.toMatch(/角色 \{session\.character_id/);
    expect(appSource).toMatch(/炼气入门/);
    expect(appSource).toMatch(/realmLabel\(progressionQuery\.data\?\.cultivation\.realm_stage_id\)/);
    expect(appSource).toMatch(/formatPlayerNumber\(progressionQuery\.data\?\.cultivation\.xp\)/);
  });

  it('lets players resume a paused idle action from the global top bar', () => {
    expect(appSource).toMatch(/apiClient\.resumeQueue\(/);
    expect(appSource).toMatch(/恢复挂机/);
    expect(appSource).toMatch(/暂停挂机/);
  });

  it('exposes player-facing right rail tabs, activity log channels, and feedback landmark', () => {
    expect(appSource).toMatch(/aria-label="角色面板"/);
    expect(appSource).toMatch(/战利品/);
    expect(appSource).toMatch(/修行/);
    expect(appSource).toMatch(/活动/);
    expect(appSource).toMatch(/aria-label="活动日志"/);
    expect(appSource).toMatch(/aria-label="操作反馈"/);
    expect(appSource).toMatch(/logChannel === '活动'/);
    expect(appSource).toMatch(/role="tablist"/);
    expect(appSource).toMatch(/role="tab"/);
    expect(appSource).toMatch(/aria-selected=\{rightRailTab === tab\}/);
    expect(appSource).toMatch(/aria-controls=\{rightRailTab === tab \? `rail-panel-\$\{tab\}` : undefined\}/);
    expect(appSource).not.toMatch(/aria-controls=\{`rail-panel-\$\{tab\}`\}/);
    expect(appSource).toMatch(/aria-pressed=\{logChannel === channel\}/);
  });

  it('keeps shell controls labelled and right rail states player-facing', () => {
    expect(appSource).toMatch(/aria-expanded=\{!leftRailCollapsed\}/);
    expect(appSource).toMatch(/aria-controls="shell-nav-groups"/);
    expect(appSource).toMatch(/railCaveQuery\.isPending/);
    expect(appSource).toMatch(/railCaveQuery\.error/);
    expect(appSource).toMatch(/railPresetQuery\.isPending/);
    expect(appSource).toMatch(/railPresetQuery\.error/);
    expect(appSource).toMatch(/railOpportunityQuery\.isPending/);
    expect(appSource).toMatch(/railOpportunityQuery\.error/);
    expect(appSource).toMatch(/inventoryQuery\.isPending/);
    expect(appSource).toMatch(/inventoryQuery\.error/);
    expect(appSource).toMatch(/正在读取背包/);
    expect(appSource).toMatch(/背包暂时无法读取/);
    expect(appSource).toMatch(/背包暂时为空/);
    expect(appSource).toMatch(/railAssignmentsQuery\.isPending/);
    expect(appSource).toMatch(/railAssignmentsQuery\.error/);
    expect(appSource).toMatch(/修行技能暂时无法读取/);
    expect(appSource).toMatch(/queryKey: \['global-cave'/);
    expect(appSource).toMatch(/queryKey: \['global-loadout'/);
    expect(appSource).toMatch(/重试/);
    expect(appSource).not.toMatch(/summary\?\.count \?\? 0/);
    expect(appSource).toMatch(/尚未设置装备方案/);
    expect(appSource).toMatch(/尚未设置出战配装/);
    expect(appSource).not.toMatch(/buildEquipmentRailSummary\(railPresetQuery\.data \?\? null/);
    expect(appSource).not.toMatch(/buildLoadoutRailSummary\(railPresetQuery\.data \?\? null/);
  });
});
