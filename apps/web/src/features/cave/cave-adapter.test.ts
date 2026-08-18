import { describe, expect, it } from 'vitest';

import type { CaveResponse, InventorySnapshot } from '@dongtian/contracts';

import { buildCaveBuildRequest, buildCaveFacilityView, buildCavePageView } from './cave-adapter.js';

const inventory: InventorySnapshot = {
  items: [
    { asset_type: 'ITEM', asset_id: 'item.t1.cave_stone', quantity: 1, reserved_quantity: 0, available_quantity: 1 },
  ],
  currencies: [
    { asset_type: 'CURRENCY', asset_id: 'currency.spirit_stone', quantity: 120, reserved_quantity: 0, available_quantity: 120 },
  ],
  equipment_instances: [],
  total_count: 2,
};

const response: CaveResponse = {
  character: {
    character_id: 'character-1',
    state_version: 12,
    active_config_version: '2026.08.16.1',
  },
  cave: {
    as_of: '2026-08-16T00:00:00.000Z',
    config_version: '2026.08.16.1',
    facilities: [
      {
        facility_config_id: 'cave_facility.juling_room',
        facility_kind: 'JULING_ROOM',
        name_key: 'cave.facility.juling_room.name',
        description_key: 'cave.facility.juling_room.description',
        level: 1,
        current_modifier: null,
        next_level_rule: {
          level: 2,
          required_realm_group: 'QI',
          spirit_stone_cost: '200',
          material_costs: [{ itemId: 'item.t1.cave_stone', quantity: '3' }],
          build_duration_us: '3600000000',
          modifier: { stat: 'cultivation_xp', operation: 'MULTIPLY', value: '1.05' },
          scope: 'MVP',
        },
        build_task: null,
      },
      {
        facility_config_id: 'cave_facility.alchemy_room',
        facility_kind: 'ALCHEMY_ROOM',
        name_key: 'cave.facility.alchemy_room.name',
        description_key: 'cave.facility.alchemy_room.description',
        level: 3,
        current_modifier: { stat: 'alchemy_xp', operation: 'MULTIPLY', value: '1.15' },
        next_level_rule: null,
        build_task: null,
      },
      {
        facility_config_id: 'cave_facility.forging_room',
        facility_kind: 'FORGING_ROOM',
        name_key: 'cave.facility.forging_room.name',
        description_key: 'cave.facility.forging_room.description',
        level: 2,
        current_modifier: { stat: 'forging_xp', operation: 'ADD', value: '2' },
        next_level_rule: {
          level: 3,
          required_realm_group: 'QI',
          spirit_stone_cost: '80',
          material_costs: [{ itemId: 'item.t1.cave_stone', quantity: '1' }],
          build_duration_us: '1800000000',
          modifier: { stat: 'forging_xp', operation: 'MULTIPLY', value: '1.1' },
          scope: 'MVP',
        },
        build_task: {
          build_task_id: 'cave-build-1',
          facility_config_id: 'cave_facility.forging_room',
          from_level: 2,
          target_level: 3,
          status: 'COMPLETED',
          projected_completion_at: '2026-08-16T00:15:00.000Z',
          started_at: '2026-08-15T23:45:00.000Z',
          completed_at: '2026-08-16T00:15:00.000Z',
          cost_snapshot: {
            facility_config_id: 'cave_facility.forging_room',
            facility_kind: 'FORGING_ROOM',
            name_key: 'cave.facility.forging_room.name',
            description_key: 'cave.facility.forging_room.description',
            level: 2,
            required_realm_group: 'QI',
            spirit_stone_cost: '80',
            material_costs: [{ itemId: 'item.t1.cave_stone', quantity: '1' }],
            build_duration_us: '1800000000',
            modifier: { stat: 'forging_xp', operation: 'MULTIPLY', value: '1.1' },
            scope: 'MVP',
          },
          completion_reached: true,
          completion_boundary: {
            currentCycleApplies: false,
            nextCycleApplies: true,
          },
        },
      },
    ],
  },
};

describe('cave adapter', () => {
  it('derives facility state, inventory gaps and build requests from the real wire contract', () => {
    const view = buildCavePageView(response, inventory, 'cave_facility.juling_room', 'realm.qi.early', new Date('2026-08-16T00:30:00.000Z'));

    expect(view.title).toBe('洞府设施');
    expect(view.summary).not.toContain('状态版本');
    expect(view.activeFacility?.facilityLabel).toBe('练功房');
    expect(view.facilities[0]?.buildStatus).toBe('RESOURCE_INSUFFICIENT');
    expect(view.facilities[1]?.buildStatus).toBe('LOCKED');
    expect(view.facilities[2]?.buildStatus).toBe('READY');
    expect(view.facilities[2]?.taskStateLabel).toBe('上次完成，可继续升级');
    expect(view.facilities[0]?.missingResources).toHaveLength(2);
    expect(view.facilities[0]?.nextLevelRuleLabel).toContain('灵石 200');
    expect(view.facts[1]?.value).toBe('炼气初期');
    expect(view.facilities[0]?.nextLevelRuleLabel).toContain('洞府石料');
    expect(view.facilities[0]?.nextLevelRuleLabel).not.toContain('item.t1.');
    expect(view.facilities[0]?.currentModifierLabel).not.toContain('MULTIPLY');

    const request = buildCaveBuildRequest(response, response.cave.facilities[0]!);
    expect(request).toEqual({
      facility_id: 'cave_facility.juling_room',
      target_level: 2,
      expected_state_version: 12,
      config_version: '2026.08.16.1',
    });

    const facilityView = buildCaveFacilityView(response.cave.facilities[0]!, inventory, 'realm.qi.early', new Date('2026-08-16T00:30:00.000Z'));
    expect(facilityView.stockSummary).toContain('灵石可用 120');
  });
});
