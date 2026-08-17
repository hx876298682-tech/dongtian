import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import {
  BreakthroughError,
  BreakthroughLoading,
  BreakthroughLocked,
  BreakthroughMaintenance,
} from './breakthrough-page.js';

describe('breakthrough page states', () => {
  it('renders explicit loading, maintenance, locked and error surfaces', () => {
    expect(renderToStaticMarkup(<BreakthroughLoading />)).toContain('正在准备筑基');
    expect(
      renderToStaticMarkup(<BreakthroughMaintenance reason="maint" onRetry={() => undefined} />),
    ).toContain('筑基服务维护中');
    expect(
      renderToStaticMarkup(<BreakthroughLocked reason="locked" onRetry={() => undefined} />),
    ).toContain('筑基功能受限');
    expect(
      renderToStaticMarkup(<BreakthroughError error="boom" onRetry={() => undefined} />),
    ).toContain('筑基暂时无法打开');
  });
});
