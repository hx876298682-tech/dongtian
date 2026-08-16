import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { NormalStateScreen } from '@dongtian/ui';

import { EquipmentError, EquipmentLocked, EquipmentLoading, EquipmentMaintenance, EquipmentMissingPreset } from './equipment-page.js';

describe('equipment page states', () => {
  it('renders the six required surfaces without browser APIs', () => {
    const screens = [
      renderToStaticMarkup(createElement(EquipmentLoading)),
      renderToStaticMarkup(createElement(EquipmentError, { error: 'boom', onRetry: () => undefined })),
      renderToStaticMarkup(createElement(EquipmentMaintenance, { reason: 'maintenance', onRetry: () => undefined })),
      renderToStaticMarkup(createElement(EquipmentLocked, { reason: 'locked', onRetry: () => undefined })),
      renderToStaticMarkup(createElement(EquipmentMissingPreset, { onOpenInventory: () => undefined })),
      renderToStaticMarkup(createElement(NormalStateScreen, { title: '正常', description: '可编辑。', highlight: '权威响应' })),
    ];

    expect(screens[0]).toContain('正在读取装备权威快照');
    expect(screens[1]).toContain('装备页读取失败');
    expect(screens[2]).toContain('装备页维护中');
    expect(screens[3]).toContain('装备功能受限');
    expect(screens[4]).toContain('请输入 preset_id');
    expect(screens[5]).toContain('权威响应');
  });
});
