import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { EXPEDITION_PRESET_GUIDANCE, ExpeditionError, ExpeditionLocked, ExpeditionLoading, ExpeditionMaintenance } from './expedition-page.js';

describe('expedition page components', () => {
  it('renders loading and failure states without browser APIs', () => {
    const loadingMarkup = renderToStaticMarkup(<ExpeditionLoading />);
    const errorMarkup = renderToStaticMarkup(<ExpeditionError error="boom" onRetry={() => undefined} />);
    const maintenanceMarkup = renderToStaticMarkup(<ExpeditionMaintenance reason="maint" onRetry={() => undefined} />);
    const lockedMarkup = renderToStaticMarkup(<ExpeditionLocked reason="locked" onRetry={() => undefined} />);

    expect(loadingMarkup).toContain('正在读取青蛇洞权威快照');
    expect(errorMarkup).toContain('秘境页读取失败');
    expect(maintenanceMarkup).toContain('秘境服务维护中');
    expect(lockedMarkup).toContain('秘境功能受限');
  });

  it('explains the preset shortcut when the API cannot list presets', () => {
    expect(EXPEDITION_PRESET_GUIDANCE).toContain('角色');
    expect(EXPEDITION_PRESET_GUIDANCE).toContain('策略 safe');
  });
});
