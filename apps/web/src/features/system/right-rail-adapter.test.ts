import { describe, expect, it } from 'vitest';

import type { CaveFacility, CaveResponse, CharacterProgression, InventorySnapshot, LoadoutPreset, SkillToolAssignmentsResponse } from '@dongtian/contracts';

import {
  buildCaveRailSummary,
  buildEquipmentRailSummary,
  buildInventoryRailSummary,
  buildLoadoutRailSummary,
  buildSkillsRailSummary,
} from './right-rail-adapter.js';

const inventory: InventorySnapshot = {
  items: [{ asset_type: 'ITEM', asset_id: 'item.t1.qingling_herb', category: 'MATERIAL', quantity: '12', reserved_quantity: '2', available_quantity: '10' }],
  currencies: [{ asset_type: 'CURRENCY', asset_id: 'currency.spirit_stone', quantity: '80', reserved_quantity: '0', available_quantity: '80' }],
  equipment_instances: [
    { instance_id: 'eq-sword', item_id: 'item.t1.iron_sword', temper_level: 2, bound: false, created_config_version: 'config.internal' },
  ],
  total_count: 2,
};

const progression: CharacterProgression = {
  character: { character_id: 'character-1', name: '青岚', state_version: 3, active_config_version: 'config.internal' },
  cultivation: { xp: '42', realm_stage_id: 'realm.mortal.entry', stage_start_xp: '0', stage_required_xp: '100', stage_progress_xp: '42', remaining_xp: '58', progress_ratio: '0.42' },
  skills: [{ skill_id: 'skill.alchemy', level: 3, xp: '18', xp_to_next: '20', remaining_xp: '2', next_level: 4, speed_modifier: '1', efficiency_modifier: '1', stage_node: false, realm_required: 'realm.mortal.entry', character_state_version: 3 }],
  feature_permissions: [],
  calculation_as_of: '2026-08-17T00:00:00Z',
  config_version: 'config.internal',
};

const preset: LoadoutPreset = {
  character_id: 'character-1', preset_id: 'preset-1', name: '青蛇探险', active: true, complete: false,
  effective_next_cycle: false, state_version: 3, weapon_instance_id: 'eq-sword', armor_instance_id: null, accessory_instance_id: null,
  combat_consumables: [{ item_id: 'item.t1.qi_gathering_pill', quantity: '2' }], strategy_id: 'strategy.safe', version: '1',
};

const cave: CaveResponse = {
  character: { character_id: 'character-1', state_version: 3, active_config_version: 'config.internal' },
  cave: { as_of: '2026-08-17T00:00:00Z', config_version: 'config.internal', facilities: [
    { facility_config_id: 'facility.juling', facility_kind: 'JULING_ROOM', name_key: '练功房', description_key: 'desc', level: 2, current_modifier: { stat: 'cultivation_xp', operation: 'MULTIPLY', value: '0.1' }, next_level_rule: null, build_task: null },
  ] },
};

const assignments: SkillToolAssignmentsResponse = {
  character_id: 'character-1', state_version: 3, config_version: 'config.internal', as_of: '2026-08-17T00:00:00Z',
  assignments: [{ skill_id: 'skill.alchemy', current: { equipment_instance_id: 'eq-sword', item_id: 'item.t1.iron_sword', item_name_key: '炼丹炉', source_note: '当前', required_realm: 'realm.mortal.entry', required_tags: [], tool_tag: 'alchemy_tool', effective_throughput_per_hour: '4', speed_multiplier: '1', efficiency_multiplier: '1', cycles_per_hour: '4', source_routes: [], usage_routes: [], comparison: null }, options: [] }],
};

describe('right rail adapter', () => {
  it('turns inventory assets into a compact player-facing grid without raw ids', () => {
    const view = buildInventoryRailSummary(inventory);
    expect(view.items).toEqual([{ key: 'ITEM:item.t1.qingling_herb:0', label: '青灵草', quantity: '10' }, { key: 'CURRENCY:currency.spirit_stone:0', label: '灵石', quantity: '80' }]);
    expect(view.items.map((item) => item.label)).not.toContain('item.t1.qingling_herb');
  });

  it('keeps duplicate inventory labels addressable with stable keys', () => {
    const duplicateInventory = { ...inventory, items: [inventory.items[0]!, { ...inventory.items[0]!, quantity: '4', available_quantity: '4' }] };
    const items = buildInventoryRailSummary(duplicateInventory).items;
    expect(items.map((item) => item.key)).toEqual(['ITEM:item.t1.qingling_herb:0', 'ITEM:item.t1.qingling_herb:1', 'CURRENCY:currency.spirit_stone:0']);
  });

  it('keeps unknown ordinary inventory assets labeled as unknown items', () => {
    const unknownInventory = { ...inventory, items: [{ ...inventory.items[0]!, asset_id: 'item.t9.unknown_relic' }] };
    expect(buildInventoryRailSummary(unknownInventory).items[0]).toEqual({ key: 'ITEM:item.t9.unknown_relic:0', label: '未知物品', quantity: '10' });
  });

  it('summarizes equipment slots with readable item names and temper levels', () => {
    const view = buildEquipmentRailSummary(preset, inventory);
    expect(view.slots).toEqual([
      { label: '武器', value: '铁剑 · +2' },
      { label: '防具', value: '未装备' },
      { label: '饰品', value: '未装备' },
    ]);
  });

  it('uses a game-facing fallback for unidentified equipment', () => {
    const unknownInventory = { ...inventory, equipment_instances: [{ ...inventory.equipment_instances[0]!, item_id: 'item.t9.unknown_relic' }] };
    expect(buildEquipmentRailSummary(preset, unknownInventory).slots[0]?.value).toBe('未鉴定装备 · +2');
  });

  it('summarizes skill level and current cultivation progress', () => {
    const view = buildSkillsRailSummary(progression, assignments);
    expect(view.skills).toEqual([{ label: '炼丹', value: 'Lv.3 · XP 18/20' }]);
    expect(view.cultivation).toBe('炼气入门 · 修为 42/100');
  });

  it('uses a player-facing fallback for unknown skills', () => {
    const unknownProgression = { ...progression, skills: [{ ...progression.skills[0]!, skill_id: 'skill.unknown_legacy' }] };
    expect(buildSkillsRailSummary(unknownProgression, assignments).skills[0]?.label).toBe('未知技能');
  });

  it('summarizes cave facility state without config metadata', () => {
    const view = buildCaveRailSummary(cave);
    expect(view.facilities).toEqual([{ label: '练功房', value: 'Lv.2 · 运行中' }]);
    expect(JSON.stringify(view)).not.toContain('config');
  });

  it('maps build task status into explicit player-facing cave states', () => {
    const withBuildStatus = (status: string): CaveResponse => ({
      ...cave,
      cave: {
        ...cave.cave,
        facilities: [{
          ...cave.cave.facilities[0]!,
          build_task: { status } as CaveFacility['build_task'],
        }],
      },
    });

    expect(buildCaveRailSummary(withBuildStatus('RUNNING')).facilities[0]?.value).toBe('Lv.2 · 建设中');
    expect(buildCaveRailSummary(withBuildStatus('COMPLETED')).facilities[0]?.value).toBe('Lv.2 · 已完成');
    expect(buildCaveRailSummary(withBuildStatus('PAUSED')).facilities[0]?.value).toBe('Lv.2 · 状态未知');
  });

  it('maps cave facilities by kind and hides config keys for unknown facilities', () => {
    const variedCave = { ...cave, cave: { ...cave.cave, facilities: [
      ...cave.cave.facilities,
      { ...cave.cave.facilities[0]!, facility_kind: 'ALCHEMY_ROOM', facility_config_id: 'facility.alchemy', name_key: 'facility.alchemy.name' },
      { ...cave.cave.facilities[0]!, facility_kind: 'UNKNOWN_ROOM', facility_config_id: 'facility.secret', name_key: 'facility.secret.name' } as unknown as CaveFacility,
    ] } } as unknown as CaveResponse;
    expect(buildCaveRailSummary(variedCave).facilities.map((facility) => facility.label)).toEqual(['练功房', '炼丹炉', '未识别设施']);
  });

  it('summarizes the active loadout and preserves its navigation label', () => {
    expect(buildLoadoutRailSummary(preset)).toEqual({ name: '青蛇探险', status: '当前生效 · 缺少防具和饰品', consumables: '聚气丹 × 2' });
  });
});
