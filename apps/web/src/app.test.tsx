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
    expect(appSource).toMatch(/<aside[^>]*className=\{`shell-rail/);
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

  it('keeps the complete desktop destination list visible like the reference navigation', () => {
    expect(appSource).toMatch(/aria-label="主导航"/);
    expect(appSource).toMatch(/SHELL_ROUTES\.map/);
    expect(appSource).not.toMatch(/className="shell-nav__more"/);
    expect(appSource).toMatch(/shell-nav__link-icon/);
    expect(appSource).not.toMatch(/shell-nav__link-desc/);
  });

  it('keeps shop and update aliases reachable without inventing new page kinds', () => {
    expect(appSource).toMatch(/path: 'store', element: <ReferencePage kind="store" \/>/);
    expect(appSource).toMatch(/path: 'cowbell-shop', element: <ReferencePage kind="cowbell-shop" \/>/);
    expect(appSource).toMatch(/path: 'changelog', element: <ReferencePage kind="changelog" \/>/);
    expect(appSource).toMatch(/SHELL_ROUTE_ALIASES\.map/);
    expect(appSource).toMatch(/<ReferencePage kind={alias\.kind} \/>/);
  });

  it('lets each page own the central title instead of repeating a shell title band', () => {
    expect(appSource).not.toMatch(/className="shell-main__hero"/);
  });

  it('renders API-backed craft and cultivation skill levels in the left navigation', () => {
    expect(appSource).toMatch(/railProgressionQuery\.data\?\.skills/);
    expect(appSource).toMatch(/describeSkillId\(skill\.skill_id\)/);
    expect(appSource).toMatch(/aria-label="百艺技能等级"/);
    expect(appSource).toMatch(/aria-label="战斗与修炼"/);
    expect(appSource).toMatch(/技能等级/);
    expect(appSource).not.toMatch(/skill\.(herbalism|mining|alchemy|forging|tempering)/);
  });

  it('keeps the Milky Way shell proportions compact while retaining four buff slots', () => {
    const progress = cssBlock('.global-idle-progress');

    expect(stylesSource).toMatch(/\/\* Milky Way style shell pass:[\s\S]*?\.app-shell__topbar\s*\{[\s\S]*?padding:\s*8px 12px/);
    expect(progress).toMatch(/min-width:\s*220px/);
    expect(stylesSource).toMatch(/\.topbar-buff\s*\{[\s\S]*?width:\s*34px[\s\S]*?height:\s*34px/);
    expect(appSource.match(/className="topbar-buff"/g)).toHaveLength(1);
  });

  it('keeps the right rail summary without a pin control', () => {
    expect(appSource).toMatch(/aria-label="角色面板"/);
    expect(appSource).toMatch(/\['inventory', '背包'\]/);
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
    expect(appSource).toMatch(/resourceValue\(progressionQuery, progressionQuery\.data\?\.cultivation\.xp\)/);
    expect(appSource).toMatch(/resourceValue\(inventoryQuery, currencies\[0\]\?\.available_quantity\)/);
    expect(appSource).toMatch(/resourceValue\(opportunityQuery, opportunityQuery\.data\?\.opportunity\.current_opportunities\)/);
    expect(appSource).not.toMatch(/\?\.available_quantity \?\? 0/);
    expect(appSource).not.toMatch(/\?\.current_opportunities \?\? 0/);
    expect(appSource).not.toMatch(/return '初入洞天'/);
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
    expect(appSource).not.toMatch(/aria-pressed=\{logChannel === channel\}/);
    expect(appSource).toMatch(/onKeyDown=\{handleRailTabKeyDown\}/);
    expect(appSource).toMatch(/event\.key === 'Home'/);
    expect(appSource).toMatch(/event\.key === 'End'/);
    expect(appSource).toMatch(/handleRightRailKeyDown/);
    expect(appSource).toMatch(/querySelectorAll<HTMLElement>/);
    expect(appSource).not.toMatch(/未激活/);
    expect(appSource).not.toMatch(/<strong>散修<\/strong>/);
    expect(appSource).toMatch(/聊天功能暂未开放/);
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
    expect(appSource).not.toMatch(/aria-label="当前闭关计划"/);
    expect(appSource).not.toMatch(/rail-card--status/);
    expect(appSource).not.toMatch(/rail-card--draft/);
    expect(appSource).toMatch(/shell-rail-toggle/);
    expect(appSource).toMatch(/shell-rail__backdrop/);
    expect(appSource).not.toMatch(/buildEquipmentRailSummary\(railPresetQuery\.data \?\? null/);
    expect(appSource).not.toMatch(/buildLoadoutRailSummary\(railPresetQuery\.data \?\? null/);
  });

  it('uses an overlay right rail throughout the medium desktop range', () => {
    expect(stylesSource).toMatch(/@media \(max-width: 1439px\) and \(min-width: 921px\)[\s\S]*?\.app-shell__workspace\s*\{[\s\S]*?grid-template-columns:\s*220px minmax\(0, 1fr\)/);
    expect(stylesSource).toMatch(/@media \(max-width: 1439px\) and \(min-width: 921px\)[\s\S]*?\.shell-rail\s*\{[\s\S]*?position:\s*fixed/);
    expect(stylesSource).toMatch(/@media \(max-width: 1439px\) and \(min-width: 921px\)[\s\S]*?\.shell-rail__backdrop--open\s*\{[\s\S]*?pointer-events:\s*auto/);
  });

  it('closes the right rail on Escape and when the route changes', () => {
    expect(appSource).toMatch(/addEventListener\('keydown'/);
    expect(appSource).toMatch(/event\.key === 'Escape'/);
    expect(appSource).toMatch(/setRightRailOpen\(false\)/);
    expect(appSource).toMatch(/previousPathname/);
  });

  it('gives the overlay drawer a labelled dialog and restores focus to its toggle', () => {
    expect(appSource).toMatch(/useRef<HTMLElement>\(null\)/);
    expect(appSource).toMatch(/useRef<HTMLButtonElement>\(null\)/);
    expect(appSource).toMatch(/role=\{isRightRailOverlay \? 'dialog' : 'complementary'\}/);
    expect(appSource).toMatch(/aria-modal=\{isRightRailOverlay && rightRailOpen\}/);
    expect(appSource).toMatch(/aria-labelledby="shell-right-rail-title"/);
    expect(appSource).toMatch(/aria-hidden=\{isRightRailOverlay \? !rightRailOpen : undefined\}/);
    expect(appSource).toMatch(/railRef\.current\?\.focus\(\)/);
    expect(appSource).toMatch(/railToggleRef\.current\?\.focus\(\)/);
    expect(appSource).toMatch(/if \(!overlay\) setRightRailOpen\(true\)/);
  });

  it('keeps activity logs in the shell viewport while the content surface scrolls', () => {
    const shell = cssBlock('.shell-main {');
    const log = cssBlock('.game-log {');

    expect(shell).toMatch(/grid-template-rows:\s*auto minmax\(0, 1fr\) auto/);
    expect(shell).toMatch(/overflow:\s*hidden/);
    expect(log).toMatch(/position:\s*sticky/);
    expect(log).toMatch(/bottom:\s*0/);
    expect(stylesSource).toMatch(/\.shell-main__content\s*\{[\s\S]*?overflow:\s*auto/);
  });
});
