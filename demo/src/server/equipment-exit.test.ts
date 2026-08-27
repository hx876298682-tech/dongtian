import assert from 'node:assert/strict';
import test from 'node:test';
import { FROZEN_PARAMETERS } from '../game/frozen-parameters.ts';
import type { ConfigParameterMap } from './config-release.ts';
import { decideEquipmentExit, validateEquipmentExitPolicy } from './equipment-exit.ts';
import { ApiError } from './types.ts';

const frozen = (): ConfigParameterMap => structuredClone(FROZEN_PARAMETERS) as ConfigParameterMap;

test('frozen retain_rare policy has a complete automatic exit contract', () => {
  const parameters = frozen();
  assert.deepEqual(validateEquipmentExitPolicy(parameters), []);
  assert.equal(decideEquipmentExit(parameters, 'normal', false), 'retain');
  assert.equal(decideEquipmentExit(parameters, 'normal', true), 'salvage');
  assert.equal(decideEquipmentExit(parameters, 'fine', true), 'salvage');
  assert.equal(decideEquipmentExit(parameters, 'rare', true), 'sell');
  assert.equal(decideEquipmentExit(parameters, 'immortal', true), 'sell');
});

test('automatic exit rejects policy drift and malformed sale/salvage values before a writer can run', () => {
  const parameters = frozen();
  parameters['schedule.equipment.exit_policy'] = { value: 'sell_all' };
  parameters['loot.equipment.auto_salvage.normal_enabled'] = { value: 2 };
  parameters['loot.equipment.salvage.normal.spirit_ore'] = { value: -1 };
  delete parameters['loot.equipment.sell.spirit_stone.rare'];
  const diagnostics = validateEquipmentExitPolicy(parameters);
  assert.ok(diagnostics.some((item) => item.path === 'schedule.equipment.exit_policy' && item.code === 'UNSUPPORTED_POLICY'));
  assert.ok(diagnostics.some((item) => item.path === 'loot.equipment.auto_salvage.normal_enabled' && item.code === 'INVALID_VALUE'));
  assert.ok(diagnostics.some((item) => item.path === 'loot.equipment.salvage.normal.spirit_ore' && item.code === 'INVALID_VALUE'));
  assert.ok(diagnostics.some((item) => item.path === 'loot.equipment.sell.spirit_stone.rare' && item.code === 'MISSING_PARAMETER'));
  assert.throws(() => decideEquipmentExit(parameters, 'rare', true), (error: unknown) => error instanceof ApiError && error.code === 'VALIDATION_FAILED' && Boolean((error.details as { diagnostics?: unknown[] }).diagnostics?.length));
});

test('automatic exit rejects unknown quality instead of defaulting to a sale path', () => {
  assert.throws(() => decideEquipmentExit(frozen(), 'mythic', true), (error: unknown) => error instanceof ApiError && error.code === 'VALIDATION_FAILED');
});
