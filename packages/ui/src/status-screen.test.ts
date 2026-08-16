import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import {
  EmptyStateScreen,
  LockedStateScreen,
  LoadingStateScreen,
  LocalErrorStateScreen,
  MaintenanceStateScreen,
  NormalStateScreen,
  StatusScreen,
} from './status-screen.js';

describe('StatusScreen', () => {
  it('renders the six shell states', () => {
    const screens = [
      renderToStaticMarkup(
        createElement(StatusScreen, {
          kind: 'normal',
          title: '正常',
          description: '内容可用。',
          highlight: '今日状态',
        }),
      ),
      renderToStaticMarkup(createElement(EmptyStateScreen, { title: '空', description: '暂无内容。' })),
      renderToStaticMarkup(createElement(LoadingStateScreen, { title: '加载', description: '同步中。' })),
      renderToStaticMarkup(createElement(LocalErrorStateScreen, { title: '错误', description: '网络异常。' })),
      renderToStaticMarkup(createElement(LockedStateScreen, { title: '锁定', description: '权限不足。' })),
      renderToStaticMarkup(createElement(MaintenanceStateScreen, { title: '维护', description: '服务维护中。' })),
    ];

    for (const markup of screens) {
      expect(markup).toContain('status-screen');
    }
    expect(screens[0]).toContain('今日状态');
    expect(screens[1]).toContain('空');
    expect(screens[2]).toContain('加载中');
    expect(screens[3]).toContain('局部错误');
    expect(screens[4]).toContain('锁定');
    expect(screens[5]).toContain('维护');
  });

  it('allows action buttons', () => {
    const markup = renderToStaticMarkup(
      createElement(NormalStateScreen, {
        title: '正常',
        description: '可操作。',
        actions: [{ label: '重试', onClick: () => undefined }],
      }),
    );

    expect(markup).toContain('重试');
  });
});
