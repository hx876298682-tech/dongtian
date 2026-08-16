import { describe, expect, it } from 'vitest';

import type { InventorySnapshot, LoadoutPreset } from '@dongtian/contracts';

import { buildEquipmentSelectionView, buildEquipmentSlotComparisonRows, summarizeLoadoutPreset } from './equipment-adapter.js';

const inventory: InventorySnapshot = {
  items: [],
  currencies: [],
  equipment_instances: [
    { instance_id: 'weapon-1', item_id: 'item.t1.cuizhi_jian', temper_level: 1, bound: false, created_config_version: '2026.08.16.1' },
    { instance_id: 'weapon-2', item_id: 'item.t1.cuizhi_jian', temper_level: 3, bound: true, created_config_version: '2026.08.16.1' },
    { instance_id: 'armor-1', item_id: 'item.t1.buyi', temper_level: 0, bound: false, created_config_version: '2026.08.16.1' },
    { instance_id: 'accessory-1', item_id: 'item.t1.qingyu_pei', temper_level: 2, bound: false, created_config_version: '2026.08.16.1' },
  ],
  total_count: 4,
};

const currentPreset: LoadoutPreset = {
  character_id: 'character-1',
  preset_id: 'preset-current',
  name: '均衡',
  active: false,
  complete: true,
  state_version: 7,
  weapon_instance_id: 'weapon-1',
  armor_instance_id: 'armor-1',
  accessory_instance_id: 'accessory-1',
  combat_consumables: [],
  strategy_id: 'strategy.safe',
  version: '1',
};

const comparePreset: LoadoutPreset = {
  character_id: 'character-1',
  preset_id: 'preset-compare',
  name: '秘境',
  active: true,
  complete: true,
  state_version: 8,
  weapon_instance_id: 'weapon-2',
  armor_instance_id: 'armor-1',
  accessory_instance_id: null,
  combat_consumables: [],
  strategy_id: 'strategy.risk',
  version: '2',
};

describe('equipment adapter', () => {
  it('summarizes presets and slot diffs without market data', () => {
    expect(summarizeLoadoutPreset({ ...currentPreset, effective_next_cycle: true })).toContain('下周期生效');
    const rows = buildEquipmentSlotComparisonRows(currentPreset, comparePreset, inventory);

    expect(rows).toHaveLength(3);
    expect(rows[0]?.diffSummary).toContain('实例不同');
    expect(rows[0]?.currentInstanceId).toBe('weapon-1');
    expect(rows[0]?.compareInstanceId).toBe('weapon-2');
    expect(rows[2]?.diffSummary).toContain('当前有配置，比较侧为空');
  });

  it('builds a selection view that points to the selected slot and comparison target', () => {
    const view = buildEquipmentSelectionView('weapon-1', inventory, currentPreset, comparePreset);

    expect(view.slotHint).toContain('武器');
    expect(view.compareSummary).toContain('实例不同');
  });
});
