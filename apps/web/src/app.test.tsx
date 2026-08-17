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
    expect(content).toMatch(/overflow:\s*auto/);
  });

  it('provides a dedicated mobile navigation landmark for the one-screen layout', () => {
    expect(appSource).toMatch(/className="shell-mobile-nav"/);
    expect(appSource).toMatch(/aria-label="移动端主导航"/);
    expect(stylesSource).toMatch(/@media \(max-width: 920px\)[\s\S]*\.shell-mobile-nav \{[\s\S]*?display:\s*grid/);
  });
});
