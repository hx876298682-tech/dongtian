import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { NormalStateScreen } from '@dongtian/ui';

import { EquipmentError, EquipmentInstanceDialogContent, EquipmentLocked, EquipmentLoading, EquipmentMaintenance, EquipmentMissingPreset, getTemperingActionIntent } from './equipment-page.js';

describe('equipment page states', () => {
  it('renders the six required surfaces without browser APIs', () => {
    const screens = [
      renderToStaticMarkup(createElement(EquipmentLoading)),
      renderToStaticMarkup(createElement(EquipmentError, { error: 'boom', onRetry: () => undefined })),
      renderToStaticMarkup(createElement(EquipmentMaintenance, { reason: 'maintenance', onRetry: () => undefined })),
      renderToStaticMarkup(createElement(EquipmentLocked, { reason: 'locked', onRetry: () => undefined })),
      renderToStaticMarkup(createElement(EquipmentMissingPreset, { onOpenInventory: () => undefined })),
      renderToStaticMarkup(createElement(NormalStateScreen, { title: '正常', description: '可编辑。', highlight: '状态已更新' })),
    ];

    expect(screens[0]).toContain('正在整理角色装备');
    expect(screens[1]).toContain('装备页暂时无法打开');
    expect(screens[1]).not.toContain('boom');
    expect(screens[2]).toContain('装备页维护中');
    expect(screens[3]).toContain('装备功能受限');
    expect(screens[4]).toContain('请选择装备方案');
    expect(screens[5]).toContain('状态已更新');
  });
});

describe('equipment instance detail', () => {
  it('shows the selected instance and current/compare context in the detail dialog', () => {
    const markup = renderToStaticMarkup(
      createElement(EquipmentInstanceDialogContent, {
        instance: {
          instance_id: 'eq-current',
          item_id: 'item.t1.cuizhi_jian',
          temper_level: 3,
          bound: false,
          created_config_version: '2026.08.16.1',
        },
        currentSummary: '当前预设中是武器',
        compareSummary: '强化差 3 / 5',
        canTemper: true,
        onTemper: () => undefined,
      }),
    );

    expect(markup).toContain('装备详情');
    expect(markup).toContain('粗制剑');
    expect(markup).not.toContain('cuizhi_jian');
    expect(markup).toContain('当前预设中是武器');
    expect(markup).toContain('强化差 3 / 5');
    expect(markup).toContain('进入淬炼');
    expect(markup).not.toContain('实例');
  });
});

describe('tempering confirmation intent', () => {
  it('confirms by default and executes directly only when the setting is disabled', () => {
    expect(getTemperingActionIntent(true)).toBe('confirm');
    expect(getTemperingActionIntent(false)).toBe('execute');
  });
});
