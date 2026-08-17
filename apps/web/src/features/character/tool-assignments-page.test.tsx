import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { NormalStateScreen } from '@dongtian/ui';

import {
  ToolAssignmentsEmpty,
  ToolAssignmentsError,
  ToolAssignmentsLocked,
  ToolAssignmentsLoading,
  ToolAssignmentsMaintenance,
} from './tool-assignments-page.js';

describe('tool assignments page states', () => {
  it('renders the six required surfaces without browser APIs', () => {
    const screens = [
      renderToStaticMarkup(createElement(ToolAssignmentsLoading)),
      renderToStaticMarkup(createElement(ToolAssignmentsError, { error: 'boom', onRetry: () => undefined })),
      renderToStaticMarkup(createElement(ToolAssignmentsMaintenance, { reason: 'maintenance', onRetry: () => undefined })),
      renderToStaticMarkup(createElement(ToolAssignmentsLocked, { reason: 'locked', onRetry: () => undefined })),
      renderToStaticMarkup(createElement(ToolAssignmentsEmpty, { onOpenEquipment: () => undefined })),
      renderToStaticMarkup(createElement(NormalStateScreen, { title: '正常', description: '可分配。', highlight: '状态已更新' })),
    ];

    expect(screens[0]).toContain('正在查看百艺工具');
    expect(screens[1]).toContain('工具页暂时无法打开');
    expect(screens[2]).toContain('工具页维护中');
    expect(screens[3]).toContain('工具功能受限');
    expect(screens[4]).toContain('暂无工具分配');
    expect(screens[5]).toContain('状态已更新');
    expect(screens[0]).not.toContain('权威');
  });
});
