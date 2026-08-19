import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import {
  BreakthroughError,
  BreakthroughLoading,
  BreakthroughLocked,
  BreakthroughMaintenance,
  shouldShowBreakthroughLoading,
} from './breakthrough-page.js';

describe('breakthrough page states', () => {
  it('ignores the pending state of a disabled run query', () => {
    expect(shouldShowBreakthroughLoading(null, false, true)).toBe(false);
    expect(shouldShowBreakthroughLoading('run-1', false, true)).toBe(true);
    expect(shouldShowBreakthroughLoading(null, true, false)).toBe(true);
  });

  it('renders explicit loading, maintenance, locked and error surfaces', () => {
    const loadingMarkup = renderToStaticMarkup(<BreakthroughLoading />);

    expect(loadingMarkup).toContain('正在准备筑基');
    expect(loadingMarkup).toContain('aria-label="筑基总览"');
    expect(loadingMarkup).toContain('aria-label="突破条件"');
    expect(loadingMarkup).toContain('aria-label="试炼状态"');
    expect(
      renderToStaticMarkup(<BreakthroughMaintenance reason="maint" onRetry={() => undefined} />),
    ).toContain('筑基服务维护中');
    expect(
      renderToStaticMarkup(<BreakthroughLocked reason="locked" onRetry={() => undefined} />),
    ).toContain('筑基功能受限');
    expect(
      renderToStaticMarkup(<BreakthroughError error="boom" onRetry={() => undefined} />),
    ).toContain('筑基暂时无法打开');
    expect(renderToStaticMarkup(<BreakthroughError error="boom" onRetry={() => undefined} />)).toContain('试炼状态读取失败');
  });
});
