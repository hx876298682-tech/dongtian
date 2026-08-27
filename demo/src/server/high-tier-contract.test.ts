import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { FROZEN_PARAMETERS } from '../game/frozen-parameters.ts';
import {
  HIGH_TIER_COMBAT_MODE_PARAMETER,
  HIGH_TIER_FULL_MODE,
  HIGH_TIER_SIGNATURE_ONLY_MODE,
  HIGH_TIER_REALMS,
  HighTierCombatContractError,
  diagnoseHighTierCombatContract,
  diagnoseHighTierCombatFormalProvenance,
  validateHighTierCombatContract,
} from './high-tier-contract.ts';
import type { ConfigParameterMap } from './config-release.ts';

const frozenParameterTable = await readFile(new URL('../../../docs/洞天数值参数表.csv', import.meta.url), 'utf8');

const parameters = (): ConfigParameterMap => structuredClone(FROZEN_PARAMETERS) as ConfigParameterMap;

const installFullContract = (map: ConfigParameterMap): void => {
  map[HIGH_TIER_COMBAT_MODE_PARAMETER] = { value: HIGH_TIER_FULL_MODE, status: 'frozen_v1', source: 'validated high-tier combat design' };
  for (const realm of HIGH_TIER_REALMS) {
    const prefix = `dungeon.high_tier.${realm}`;
    map[`${prefix}.boss_attack`] = { value: 100 };
    map[`${prefix}.boss_defence`] = { value: 100 };
    map[`${prefix}.boss_accuracy`] = { value: 100 };
    map[`${prefix}.boss_attack_interval_seconds`] = { value: 5 };
    map[`${prefix}.boss_element`] = { value: 'neutral' };
    map[`${prefix}.skills`] = { value: [{ id: 'signature', kind: 'output_suppression', cooldownSeconds: 300, durationSeconds: 2, magnitude: 15 }] };
    map[`${prefix}.resistances`] = { value: { controlPercent: 25, damageOverTimePercent: 30, outputSuppressionPercent: 0 } };
    map[`${prefix}.auto_pill`] = { value: { thresholdPercent: 40, healPerUse: 250, targetPercent: 80, maxUses: 20 } };
  }
};

test('frozen V1 remains compatible as signature-only high-tier combat', () => {
  const contract = validateHighTierCombatContract(parameters());
  assert.equal(contract.mode, 'signature_only_v1');
  assert.deepEqual(contract.realms, {});
  assert.deepEqual(diagnoseHighTierCombatContract(parameters()), []);
});

test('authoritative frozen parameter table does not silently activate synthetic full_v1 fields', () => {
  const lines = frozenParameterTable.split(/\r?\n/).filter(Boolean);
  const rows = new Map(lines.slice(1).map((line) => {
    const [id, domain, name, value, unit, valueType, status] = line.split(',', 7);
    return [id, { domain, name, value, unit, valueType, status }] as const;
  }));
  const mode = rows.get(HIGH_TIER_COMBAT_MODE_PARAMETER);
  assert.equal(mode?.value, HIGH_TIER_SIGNATURE_ONLY_MODE);
  assert.equal(mode?.status, 'frozen_v1');
  for (const realm of HIGH_TIER_REALMS) {
    for (const field of ['boss_attack', 'boss_defence', 'boss_accuracy', 'boss_attack_interval_seconds', 'boss_element', 'skills', 'resistances', 'auto_pill']) {
      const id = `dungeon.high_tier.${realm}.${field}`;
      assert.equal(rows.has(id), false, `${id} must not be treated as an authoritative frozen value`);
      assert.equal(Object.prototype.hasOwnProperty.call(FROZEN_PARAMETERS, id), false, `${id} must not be present in FROZEN_PARAMETERS`);
    }
  }
});

test('full high-tier mode requires an explicit six-realm contract', () => {
  const map = parameters();
  map[HIGH_TIER_COMBAT_MODE_PARAMETER] = { value: HIGH_TIER_FULL_MODE };
  const diagnostics = diagnoseHighTierCombatContract(map);
  assert.equal(diagnostics.length, HIGH_TIER_REALMS.length * 8);
  assert.ok(diagnostics.some((item) => item.path === 'dungeon.high_tier.nascent_soul.boss_attack' && item.code === 'MISSING'));
  assert.throws(() => validateHighTierCombatContract(map), (error: unknown) => error instanceof HighTierCombatContractError && error.diagnostics.length === diagnostics.length);
});

test('partial full-combat fields cannot silently fall back to signature-only mode', () => {
  const map = parameters();
  map['dungeon.high_tier.nascent_soul.boss_defence'] = { value: 100 };
  const diagnostics = diagnoseHighTierCombatContract(map);
  assert.ok(diagnostics.some((item) => item.path === HIGH_TIER_COMBAT_MODE_PARAMETER && item.code === 'INVALID_VALUE'));
});

test('full high-tier mode validates boss fields, skill array, resistances and auto-pill policy', () => {
  const map = parameters();
  installFullContract(map);
  const contract = validateHighTierCombatContract(map);
  assert.equal(contract.mode, 'full_v1');
  assert.equal(contract.realms.tribulation?.skills[0]?.kind, 'output_suppression');
  assert.equal(contract.realms.nascent_soul?.autoPill.targetPercent, 80);
});

test('formal full_v1 provenance is required only for release activation, not engine fixtures', () => {
  const map = parameters();
  installFullContract(map);
  const missingProvenance = diagnoseHighTierCombatFormalProvenance(map);
  assert.equal(missingProvenance.length, HIGH_TIER_REALMS.length * 8 * 2);
  assert.ok(missingProvenance.some((item) => item.path === 'dungeon.high_tier.nascent_soul.boss_attack.status'));
  assert.ok(missingProvenance.some((item) => item.path === 'dungeon.high_tier.tribulation.auto_pill.source'));
  for (const realm of HIGH_TIER_REALMS) {
    for (const field of ['boss_attack', 'boss_defence', 'boss_accuracy', 'boss_attack_interval_seconds', 'boss_element', 'skills', 'resistances', 'auto_pill']) {
      map[`dungeon.high_tier.${realm}.${field}`]!.status = 'frozen_v1';
      map[`dungeon.high_tier.${realm}.${field}`]!.source = 'validated high-tier combat design';
    }
  }
  map['dungeon.high_tier.nascent_soul.boss_attack']!.source = 'synthetic test fixture';
  assert.ok(diagnoseHighTierCombatFormalProvenance(map).some((item) => item.path === 'dungeon.high_tier.nascent_soul.boss_attack.source' && item.code === 'INVALID_VALUE'));
  map['dungeon.high_tier.nascent_soul.boss_attack']!.source = 'validated high-tier combat design';
  assert.deepEqual(diagnoseHighTierCombatFormalProvenance(map), []);
});

test('full_v1 mode selector itself requires formal provenance', () => {
  const map = parameters();
  installFullContract(map);
  for (const realm of HIGH_TIER_REALMS) {
    for (const field of ['boss_attack', 'boss_defence', 'boss_accuracy', 'boss_attack_interval_seconds', 'boss_element', 'skills', 'resistances', 'auto_pill']) {
      map[`dungeon.high_tier.${realm}.${field}`]!.status = 'frozen_v1';
      map[`dungeon.high_tier.${realm}.${field}`]!.source = 'validated high-tier combat design';
    }
  }
  map[HIGH_TIER_COMBAT_MODE_PARAMETER] = { value: HIGH_TIER_FULL_MODE };
  const diagnostics = diagnoseHighTierCombatFormalProvenance(map);
  assert.deepEqual(diagnostics, [
    { path: `${HIGH_TIER_COMBAT_MODE_PARAMETER}.status`, code: 'INVALID_VALUE', message: 'full_v1 release parameters must have status=frozen_v1' },
    { path: `${HIGH_TIER_COMBAT_MODE_PARAMETER}.source`, code: 'MISSING', message: 'full_v1 release parameters require a non-empty source' },
  ]);
});

test('full high-tier diagnostics reject malformed ranges and duplicate skills', () => {
  const map = parameters();
  installFullContract(map);
  const prefix = 'dungeon.high_tier.nascent_soul';
  map[`${prefix}.boss_accuracy`] = { value: Number.NaN };
  map[`${prefix}.resistances`] = { value: 'not-an-object' };
  map[`${prefix}.skills`] = { value: [
    { id: 'same', kind: 'damage', cooldownSeconds: 5, durationSeconds: 6, magnitude: -1 },
    { id: 'same', kind: 'damage', cooldownSeconds: 5, durationSeconds: 1, magnitude: 1 },
  ] };
  map[`${prefix}.auto_pill`] = { value: { thresholdPercent: 80, healPerUse: 1, targetPercent: 40, maxUses: 1.5 } };
  const diagnostics = diagnoseHighTierCombatContract(map);
  assert.ok(diagnostics.some((item) => item.path === `${prefix}.boss_accuracy` && item.code === 'INVALID_TYPE'));
  assert.ok(diagnostics.some((item) => item.path === `${prefix}.resistances` && item.code === 'INVALID_TYPE'));
  assert.ok(diagnostics.some((item) => item.path === `${prefix}.skills[0].durationSeconds` && item.code === 'INVALID_VALUE'));
  assert.ok(diagnostics.some((item) => item.path === `${prefix}.skills[0].magnitude` && item.code === 'INVALID_VALUE'));
  assert.ok(diagnostics.some((item) => item.path === `${prefix}.skills[1].id` && item.code === 'DUPLICATE'));
  assert.ok(diagnostics.some((item) => item.path === `${prefix}.auto_pill.targetPercent` && item.code === 'INVALID_VALUE'));
  assert.ok(diagnostics.some((item) => item.path === `${prefix}.auto_pill.maxUses` && item.code === 'INVALID_VALUE'));
});
