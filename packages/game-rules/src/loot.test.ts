import { describe, expect, it } from 'vitest';

import {
  buildLootDecision,
  buildTemperingSameItemMaterialUse,
  compareLootEquipment,
  groupLootMaterialUses,
} from './loot.js';

const qingtongJianItem = {
  id: 'item.t1.qingtong_jian',
  category: 'EQUIPMENT',
  tags: ['equipment', 'weapon', 'sword'],
  realm_required: 'realm.qi.early',
  enabled: true,
  deprecated: false,
  stackable: false,
  trade_policy: 'NONE',
} as const;

const qingtongJianEquipment = {
  item_id: 'item.t1.qingtong_jian',
  slot: 'WEAPON',
  attack: 24,
  defense: 0,
  hp: 0,
  speed: 0.02,
  power_index: 100,
  equip_requirements: {
    required_realm: 'realm.qi.early',
    required_tags: ['weapon'],
  },
  modifier_ids: [],
  temperable: true,
  max_temper_level: 6,
} as const;

const xuantieJianItem = {
  id: 'item.t1.xuantie_jian',
  category: 'EQUIPMENT',
  tags: ['equipment', 'weapon', 'sword'],
  realm_required: 'realm.qi.mid',
  enabled: true,
  deprecated: false,
  stackable: false,
  trade_policy: 'NONE',
} as const;

const xuantieJianEquipment = {
  item_id: 'item.t1.xuantie_jian',
  slot: 'WEAPON',
  attack: 45,
  defense: 0,
  hp: 0,
  speed: 0.04,
  power_index: 188,
  equip_requirements: {
    required_realm: 'realm.qi.mid',
    required_tags: ['weapon'],
  },
  modifier_ids: [],
  temperable: true,
  max_temper_level: 6,
} as const;

const qingtongYaochuItem = {
  id: 'item.t1.qingtong_yaochu',
  category: 'EQUIPMENT',
  tags: ['equipment', 'tool', 'herbalism_tool'],
  realm_required: 'realm.qi.early',
  enabled: true,
  deprecated: false,
  stackable: false,
  trade_policy: 'NONE',
} as const;

const qingtongYaochuEquipment = {
  item_id: 'item.t1.qingtong_yaochu',
  slot: 'TOOL',
  attack: 0,
  defense: 0,
  hp: 0,
  speed: 0,
  power_index: 0,
  equip_requirements: {
    required_realm: 'realm.qi.early',
    required_tags: ['tool'],
  },
  modifier_ids: [],
  temperable: true,
  max_temper_level: 6,
} as const;

describe('loot rules', () => {
  it('equips a strictly stronger same-slot weapon from the current preset', () => {
    const comparison = compareLootEquipment({
      candidateItem: xuantieJianItem,
      candidateEquipment: xuantieJianEquipment,
      currentItem: qingtongJianItem,
      currentEquipment: qingtongJianEquipment,
      currentPreset: {
        preset_id: 'preset.t1.current',
        active: true,
        weapon_instance_id: 'weapon-001',
        armor_instance_id: null,
        accessory_instance_id: null,
      },
      currentInstance: {
        instance_id: 'weapon-001',
        item_id: 'item.t1.qingtong_jian',
      },
      candidateInstance: {
        instance_id: 'weapon-002',
        item_id: 'item.t1.xuantie_jian',
      },
    });

    expect(comparison).toMatchObject({
      slot: 'WEAPON',
      slotCompatibility: 'MATCH',
      verdict: 'BETTER',
      action: 'EQUIP',
      comparisonTargetItemId: 'item.t1.qingtong_jian',
      candidateItemId: 'item.t1.xuantie_jian',
      currentPresetId: 'preset.t1.current',
    });
    expect(comparison.powerIndexDelta).toBeGreaterThan(0);
    expect(comparison.reasons).toContain('STRICTLY_BETTER');
  });

  it('keeps a duplicate instance and only exposes the future tempering material use while locked', () => {
    const decision = buildLootDecision({
      item: qingtongJianItem,
      equipment: qingtongJianEquipment,
      currentItem: qingtongJianItem,
      currentEquipment: qingtongJianEquipment,
      currentPreset: {
        preset_id: 'preset.t1.current',
        active: true,
        weapon_instance_id: 'weapon-001',
        armor_instance_id: null,
        accessory_instance_id: null,
      },
      candidateInstance: {
        instance_id: 'weapon-002',
        item_id: 'item.t1.qingtong_jian',
      },
      currentInstance: {
        instance_id: 'weapon-001',
        item_id: 'item.t1.qingtong_jian',
      },
      duplicateInstanceCount: 2,
      temperingAvailability: {
        enabled: false,
        requiredStageId: 'realm.qi.late',
        lockedReasonKey: 'feature.locked.realm',
      },
    });

    expect(decision.action).toBe('KEEP');
    expect(decision.futureTemperingUse).toEqual(
      expect.objectContaining({
        useId: 'tempering_same_item_material',
        itemId: 'item.t1.qingtong_jian',
        status: 'LOCKED',
        requiredFeatureId: 'feature.tempering',
        requiredStageId: 'realm.qi.late',
        lockedReasonKey: 'feature.locked.realm',
      }),
    );
    expect(decision.reasons).toEqual(expect.arrayContaining(['DUPLICATE_MATERIAL_CANDIDATE', 'FUTURE_TEMPERING_MATERIAL']));
  });

  it('treats a tool as view-only for the combat preset and ignores market fields', () => {
    const decision = buildLootDecision({
      item: {
        ...qingtongYaochuItem,
        npc_floor_price: '999',
        market_reference_price: '1999',
      },
      equipment: {
        ...qingtongYaochuEquipment,
        npc_floor_price: '888',
        market_reference_price: '1888',
      },
      currentItem: qingtongJianItem,
      currentEquipment: qingtongJianEquipment,
      currentPreset: {
        preset_id: 'preset.t1.current',
        active: true,
        weapon_instance_id: 'weapon-001',
        armor_instance_id: null,
        accessory_instance_id: null,
      },
      currentInstance: {
        instance_id: 'weapon-001',
        item_id: 'item.t1.qingtong_jian',
      },
      candidateInstance: {
        instance_id: 'tool-001',
        item_id: 'item.t1.qingtong_yaochu',
      },
    });

    expect(decision.action).toBe('VIEW');
    expect(decision.equipmentComparison).toMatchObject({
      slot: 'TOOL',
      slotCompatibility: 'NOT_APPLICABLE',
    });
    expect(decision.ignoredMarketFields).toEqual(expect.arrayContaining(['npc_floor_price', 'market_reference_price']));
    expect(decision.reasons).toContain('MARKET_FIELDS_IGNORED');
  });

  it('keeps comparing when attributes are missing and reports the missing fields', () => {
    const decision = buildLootDecision({
      item: {
        id: 'item.t9.synthetic_jian',
        category: 'EQUIPMENT',
        tags: ['equipment', 'weapon', 'sword'],
        realm_required: 'realm.mortal.entry',
        enabled: true,
        deprecated: false,
        stackable: false,
        trade_policy: 'NONE',
      },
      equipment: {
        item_id: 'item.t9.synthetic_jian',
        slot: 'WEAPON',
        attack: 12,
        defense: 0,
      },
      currentPreset: {
        preset_id: 'preset.t1.empty',
        active: false,
        weapon_instance_id: null,
        armor_instance_id: null,
        accessory_instance_id: null,
      },
      candidateInstance: {
        instance_id: 'synthetic-001',
        item_id: 'item.t9.synthetic_jian',
      },
    });

    expect(decision.action).toBe('EQUIP');
    expect(decision.equipmentComparison).toMatchObject({
      verdict: 'NOT_COMPARABLE',
      slotCompatibility: 'MATCH',
    });
    expect(decision.equipmentComparison?.candidate.missingAttributes).toEqual(
      expect.arrayContaining(['hp', 'speed', 'power_index']),
    );
  });

  it('groups material uses from production, cave, breakthrough and tempering while dropping market sources', () => {
    const summary = groupLootMaterialUses({
      itemId: 'item.t1.qingzhu',
      uses: [
        {
          itemId: 'item.t1.qingzhu',
          sourceKind: 'production',
          sourceId: 'recipe.t1.cuizhi_jian',
          quantity: '4',
        },
        {
          itemId: 'item.t1.qingzhu',
          sourceKind: 'cave',
          sourceId: 'facility.t1.cave.dan_room',
          quantity: 2,
          lockedReasonKey: 'feature.locked.realm',
          stageId: 'realm.qi.early',
        },
        {
          itemId: 'item.t1.qingzhu',
          sourceKind: 'breakthrough',
          sourceId: 'breakthrough.foundation.early',
        },
        {
          itemId: 'item.t1.qingzhu',
          sourceKind: 'tempering',
          sourceId: 'equipment.tempering.same_item_material',
          quantity: 1n,
        },
        {
          itemId: 'item.t1.qingzhu',
          sourceKind: 'market',
          sourceId: 'market.future.anchor',
        },
      ],
    });

    expect(summary.itemId).toBe('item.t1.qingzhu');
    expect(summary.uses).toHaveLength(4);
    expect(summary.sourceIds).toEqual(
      expect.arrayContaining([
        'recipe.t1.cuizhi_jian',
        'facility.t1.cave.dan_room',
        'breakthrough.foundation.early',
        'equipment.tempering.same_item_material',
      ]),
    );
    expect(summary.uses.map((entry) => entry.sourceKind)).toEqual([
      'breakthrough',
      'cave',
      'production',
      'tempering',
    ]);
  });

  it('builds a stable future tempering use record', () => {
    expect(buildTemperingSameItemMaterialUse({
      itemId: 'item.t1.xuantie_jian',
      sourceInstanceId: 'weapon-009',
      temperingAvailability: {
        enabled: false,
        requiredStageId: 'realm.qi.late',
      },
    })).toMatchObject({
      useId: 'tempering_same_item_material',
      itemId: 'item.t1.xuantie_jian',
      sourceInstanceId: 'weapon-009',
      status: 'LOCKED',
      requiredFeatureId: 'feature.tempering',
      requiredStageId: 'realm.qi.late',
      lockedReasonKey: 'feature.locked.realm',
    });
  });
});

