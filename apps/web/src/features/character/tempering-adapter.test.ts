import { describe, expect, it } from 'vitest';

import type { InventorySnapshot } from '@dongtian/contracts';

import {
  TEMPERING_LADDER,
  buildEquipmentLootSummary,
  filterEquipmentInstances,
  summarizeEquipmentAvailability,
} from './tempering-adapter.js';

const inventory: InventorySnapshot = {
  items: [
    {
      asset_type: 'ITEM',
      asset_id: 'item.t1.cuizhi_jian',
      quantity: 3,
      reserved_quantity: 1,
      available_quantity: 2,
    },
  ],
  currencies: [],
  equipment_instances: [
    { instance_id: 'eq-1', item_id: 'item.t1.cuizhi_jian', temper_level: 5, bound: false, created_config_version: '2026.08.16.1' },
    { instance_id: 'eq-2', item_id: 'item.t1.cuizhi_jian', temper_level: 2, bound: true, created_config_version: '2026.08.16.1' },
    { instance_id: 'eq-3', item_id: 'item.t1.buyi', temper_level: 6, bound: false, created_config_version: '2026.08.16.1' },
  ],
  total_count: 3,
};

describe('tempering adapter', () => {
  it('exposes the +1 to +7 ladder with lock metadata', () => {
    expect(TEMPERING_LADDER).toHaveLength(7);
    expect(TEMPERING_LADDER[0]).toMatchObject({ targetLevel: 1, locked: false });
    expect(TEMPERING_LADDER[6]).toMatchObject({ targetLevel: 7, locked: true });
  });

  it('filters and sorts equipment instances without touching authority state', () => {
    const duplicates = filterEquipmentInstances(inventory, { query: 'cuizhi', mode: 'duplicates', sortMode: 'item' });
    expect(duplicates.map((item) => item.instance_id)).toEqual(['eq-1', 'eq-2']);

    const boundOnly = filterEquipmentInstances(inventory, { query: '', mode: 'bound', sortMode: 'recent' });
    expect(boundOnly).toHaveLength(1);
    expect(boundOnly[0]?.instance_id).toBe('eq-2');
  });

  it('summarizes same-class materials and authoritative stock', () => {
    expect(buildEquipmentLootSummary(inventory.equipment_instances[0]!, 2).materialSummary).toContain('同类 1 件');
    expect(summarizeEquipmentAvailability(inventory.equipment_instances[0]!, inventory)).toContain('可用 2');
  });
});
