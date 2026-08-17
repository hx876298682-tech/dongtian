import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { EXPEDITION_PRESET_GUIDANCE, ExpeditionError, ExpeditionLocked, ExpeditionLoading, ExpeditionMaintenance, DungeonRoomDialog, AutomationDialog } from './expedition-page.js';

describe('expedition page components', () => {
  it('renders loading and failure states without browser APIs', () => {
    const loadingMarkup = renderToStaticMarkup(<ExpeditionLoading />);
    const errorMarkup = renderToStaticMarkup(<ExpeditionError error="boom" onRetry={() => undefined} />);
    const maintenanceMarkup = renderToStaticMarkup(<ExpeditionMaintenance reason="maint" onRetry={() => undefined} />);
    const lockedMarkup = renderToStaticMarkup(<ExpeditionLocked reason="locked" onRetry={() => undefined} />);

    expect(loadingMarkup).toContain('正在查看青蛇洞');
    expect(errorMarkup).toContain('秘境暂时无法打开');
    expect(maintenanceMarkup).toContain('秘境服务维护中');
    expect(lockedMarkup).toContain('秘境功能受限');
  });

  it('explains the preset shortcut when the API cannot list presets', () => {
    expect(EXPEDITION_PRESET_GUIDANCE).toContain('角色');
    expect(EXPEDITION_PRESET_GUIDANCE).toContain('稳妥探险');
  });

  it('renders room and automation details from the active dungeon run', () => {
    const roomMarkup = renderToStaticMarkup(<DungeonRoomDialog open roomId="node.entry" routeId="route.t1.qingshe_cave.safe_exit" onOpenChange={() => undefined} />);
    const automationMarkup = renderToStaticMarkup(<AutomationDialog open strategyId="strategy.safe" onOpenChange={() => undefined} />);

    expect(roomMarkup).toContain('房间详情');
    expect(roomMarkup).toContain('入口石径');
    expect(automationMarkup).toContain('自动化策略');
    expect(automationMarkup).toContain('稳妥路线');
  });
});
