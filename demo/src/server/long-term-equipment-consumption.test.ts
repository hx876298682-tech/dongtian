import assert from 'node:assert/strict';
import test from 'node:test';
import { hashContent, CONTENT_PACKAGE } from '../content/content-schema.ts';
import { FROZEN_PARAMETERS } from '../game/frozen-parameters.ts';
import type { ConfigParameterMap } from './config-release.ts';
import { LongTermEquipmentConsumptionError, planLongTermEquipmentConsumption } from './long-term-equipment-consumption.ts';

const parameters = (): ConfigParameterMap => structuredClone(FROZEN_PARAMETERS) as ConfigParameterMap;

/** Test-only content fixture: it reuses frozen parameter references and adds
 * no gameplay values. Production remains gated until real content is bound. */
const boundContent = () => {
  const content = structuredClone(CONTENT_PACKAGE);
  const base = content.equipment[0];
  const templates = ['normal', 'fine', 'rare', 'epic', 'legendary', 'immortal'].flatMap((quality) => [
    { ...base, id: `test-long-term-${quality}-weapon`, slot: 'weapon' as const, quality, quality_parameter: `loot.equipment.quality.multiplier.${quality}` },
    { ...base, id: `test-long-term-${quality}-armor`, slot: 'armor_1' as const, quality, quality_parameter: `loot.equipment.quality.multiplier.${quality}` },
    { ...base, id: `test-long-term-${quality}-accessory`, slot: 'accessory' as const, quality, quality_parameter: `loot.equipment.quality.multiplier.${quality}` },
  ]);
  content.equipment = [...content.equipment, ...templates];
  const map = content.maps.find((candidate) => candidate.id === 'black_wind_valley');
  if (!map) throw new Error('black wind test map missing');
  map.equipment_drop = { template_ids: templates.map((template) => template.id) };
  content.manifest.content_sha256 = hashContent(content.maps, content.equipment, content.recipes);
  return content;
};

test('long-term equipment consumption is deterministic and preserves frozen exit/resource flow', () => {
  const request = {
    seed: 42,
    content: boundContent(),
    inventoryCount: 1,
    inventoryCapacity: 2,
    drops: [{ source: 'ordinary_map' as const, bindingMapId: 'black_wind_valley', byQuality: { normal: 1, fine: 1, rare: 2 } }],
  };
  const left = planLongTermEquipmentConsumption({ ...request, parameters: parameters() });
  const right = planLongTermEquipmentConsumption({ ...request, parameters: parameters() });
  assert.deepEqual(left, right);
  assert.equal(left.generated.count, 4);
  assert.equal(left.exits.retained, 1);
  assert.equal(left.exits.salvaged, 1);
  assert.equal(left.exits.sold, 2);
  assert.deepEqual(left.exits.byQuality.fine, { retain: 0, salvage: 1, sell: 0 });
  assert.deepEqual(left.exits.byQuality.rare, { retain: 0, salvage: 0, sell: 2 });
  assert.deepEqual(left.resourceLedger, { spirit_ore: 2, spirit_wood: 2, spirit_stone: 130 });
  assert.deepEqual(left.inventory, { before: 1, after: 2, capacity: 2, overflow: 0 });
});

test('current content package stays gated instead of inventing a long-term template', () => {
  assert.throws(() => planLongTermEquipmentConsumption({
    seed: 1,
    inventoryCount: 0,
    inventoryCapacity: 10,
    drops: [{ source: 'high_tier', bindingMapId: 'black_wind_valley', byQuality: { rare: 1 } }],
  }), (error: unknown) => {
    assert.ok(error instanceof LongTermEquipmentConsumptionError);
    assert.ok(error.diagnostics.some((item) => item.code === 'MISSING_CONTENT_BINDING'));
    return true;
  });
});

test('long-term consumption refuses a content_pending bound template', () => {
  const content = boundContent();
  const pending = content.equipment.find((template) => template.id === 'test-long-term-fine-weapon');
  if (!pending) throw new Error('pending test template missing');
  pending.status = 'content_pending';
  content.manifest.content_sha256 = hashContent(content.maps, content.equipment, content.recipes);
  assert.throws(() => planLongTermEquipmentConsumption({
    seed: 1,
    content,
    inventoryCount: 0,
    inventoryCapacity: 1,
    drops: [{ source: 'ordinary_map', bindingMapId: 'black_wind_valley', byQuality: { fine: 1 } }],
  }), (error: unknown) => {
    assert.ok(error instanceof LongTermEquipmentConsumptionError);
    assert.ok(error.diagnostics.some((item) => item.code === 'CONTENT_LOCKED' && item.path === 'maps.black_wind_valley.equipment_drop.template_ids'));
    return true;
  });
});

test('malformed exit configuration is rejected before a read-only ledger is produced', () => {
  const malformed = parameters();
  malformed['schedule.equipment.exit_policy'] = { value: 'sell_all' };
  assert.throws(() => planLongTermEquipmentConsumption({ seed: 1, inventoryCount: 0, inventoryCapacity: 1, drops: [], parameters: malformed }), (error: unknown) => {
    assert.ok(error instanceof LongTermEquipmentConsumptionError);
    assert.ok(error.diagnostics.some((item) => item.path === 'schedule.equipment.exit_policy' && item.code === 'UNSUPPORTED_POLICY'));
    return true;
  });
});

test('automatic promotion remains blocked when its formal policy parameter is absent', () => {
  assert.throws(() => planLongTermEquipmentConsumption({
    seed: 1,
    inventoryCount: 0,
    inventoryCapacity: 1,
    drops: [],
    autoPromotion: { enabled: true, requests: [{ fromQuality: 'fine', count: 1 }], availableResources: { spirit_stone: 10_000, millennium_herb: 100, meteor_iron: 100 } },
  }), (error: unknown) => {
    assert.ok(error instanceof LongTermEquipmentConsumptionError);
    assert.ok(error.diagnostics.some((item) => item.path === 'schedule.equipment.auto_promotion.enabled' && item.code === 'MISSING_PARAMETER'));
    return true;
  });
});

test('automatic promotion rejects a numerically valid proposal enable flag', () => {
  const proposal = parameters();
  proposal['schedule.equipment.auto_promotion.enabled'] = { value: 1, status: 'proposal_v1', source: 'proposal' };
  assert.throws(() => planLongTermEquipmentConsumption({
    seed: 1,
    inventoryCount: 0,
    inventoryCapacity: 1,
    drops: [],
    parameters: proposal,
    autoPromotion: { enabled: true, requests: [{ fromQuality: 'fine', count: 1 }], availableResources: { spirit_stone: 10_000, millennium_herb: 100, meteor_iron: 100 } },
  }), (error: unknown) => {
    assert.ok(error instanceof LongTermEquipmentConsumptionError);
    assert.ok(error.diagnostics.some((item) => item.path === 'schedule.equipment.auto_promotion.enabled' && item.code === 'UNSUPPORTED_POLICY'));
    return true;
  });
});

test('automatic promotion rejects malformed runtime request shapes before planning', () => {
  const malformed = { enabled: 1, requests: {}, availableResources: { unknown_resource: 1, spirit_stone: -1 } };
  assert.throws(() => planLongTermEquipmentConsumption({
    seed: 1,
    inventoryCount: 0,
    inventoryCapacity: 1,
    drops: [],
    autoPromotion: malformed as unknown as { enabled: boolean },
  }), (error: unknown) => {
    assert.ok(error instanceof LongTermEquipmentConsumptionError);
    assert.ok(error.diagnostics.some((item) => item.path === 'autoPromotion.enabled' && item.code === 'INVALID_VALUE'));
    assert.ok(error.diagnostics.some((item) => item.path === 'autoPromotion.availableResources.unknown_resource' && item.code === 'INVALID_VALUE'));
    assert.ok(error.diagnostics.some((item) => item.path === 'autoPromotion.availableResources.spirit_stone' && item.code === 'INVALID_VALUE'));
    return true;
  });
});

test('automatic promotion rejects a cost multiplication outside safe integer range', () => {
  const malformed = parameters();
  malformed['schedule.equipment.auto_promotion.enabled'] = { value: 1, status: 'frozen_v1', source: 'test' };
  malformed['loot.equipment.promotion.fine_to_rare.spirit_stone_cost'] = { value: Number.MAX_SAFE_INTEGER, status: 'frozen_v1', source: 'test' };
  assert.throws(() => planLongTermEquipmentConsumption({
    seed: 1,
    inventoryCount: 0,
    inventoryCapacity: 1,
    drops: [],
    parameters: malformed,
    autoPromotion: { enabled: true, requests: [{ fromQuality: 'fine', count: 2 }] },
  }), (error: unknown) => {
    assert.ok(error instanceof LongTermEquipmentConsumptionError);
    assert.ok(error.diagnostics.some((item) => item.path === 'loot.equipment.promotion.fine_to_rare.spirit_stone_cost' && item.code === 'INVALID_VALUE'));
    return true;
  });
});
