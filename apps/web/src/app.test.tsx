import { describe, expect, it } from 'vitest';

// The Web package intentionally excludes Node types; Vitest runs this test in Node.
// @ts-expect-error Node runtime API used to inspect the shell source contract.
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
    expect(appSource).toMatch(/<aside className=\{`shell-rail/);
    expect(appSource).toMatch(/className="app-shell__footer"/);
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

  it('exposes player-facing right rail tabs, activity log channels, and feedback landmark', () => {
    expect(appSource).toMatch(/aria-label="角色面板"/);
    expect(appSource).toMatch(/战利品/);
    expect(appSource).toMatch(/修行/);
    expect(appSource).toMatch(/活动/);
    expect(appSource).toMatch(/aria-label="活动日志"/);
    expect(appSource).toMatch(/aria-label="操作反馈"/);
    expect(appSource).toMatch(/logChannel === '活动'/);
  });
});
