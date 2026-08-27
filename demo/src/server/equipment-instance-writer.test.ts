import assert from 'node:assert/strict';
import test from 'node:test';
import { CONTENT_PACKAGE } from '../content/content-schema.ts';
import { FROZEN_PARAMETERS } from '../game/frozen-parameters.ts';
import type { ConfigParameterMap } from './config-release.ts';
import { writeEquipmentInstance, writeEquipmentInstanceFromContent } from './equipment-instance-writer.ts';

const parameters = (): ConfigParameterMap => structuredClone(FROZEN_PARAMETERS) as ConfigParameterMap;
const template = () => structuredClone(CONTENT_PACKAGE.equipment.find((item) => item.id === 'iron_saber') ?? CONTENT_PACKAGE.equipment[0]);

test('equipment writer creates a deterministic canonical instance from a validated template', () => {
  const left = writeEquipmentInstance({ instanceId: 'map-drop-1', configVersion: '1.0.0-test', seed: 42, template: template() }, parameters());
  const right = writeEquipmentInstance({ instanceId: 'map-drop-1', configVersion: '1.0.0-test', seed: 42, template: template() }, parameters());
  assert.deepEqual(left, right);
  assert.deepEqual(left, {
    instanceId: 'map-drop-1',
    templateId: 'iron_saber',
    slot: 'weapon',
    quality: 'fine',
    reinforcementLevel: 0,
    awakeningLevel: 0,
    affixes: { attack: 87, defence: 25, health: 130, baseBudget: 125, qualityMultiplier: 1.25, slots: [{ kind: 'empty' }, { kind: 'empty' }, { kind: 'empty' }] },
    lockedSlots: [],
    isEquipped: false,
    createdConfigVersion: '1.0.0-test',
  });
});

test('equipment writer generates bounded deterministic utility affixes for a supported quality', () => {
  const rare = { ...template(), id: 'rare-saber', quality: 'rare' as const, quality_parameter: 'loot.equipment.quality.multiplier.rare' };
  const instance = writeEquipmentInstance({ instanceId: 'map-drop-rare', configVersion: '1.0.0-test', seed: 7, template: rare }, parameters());
  const slots = instance.affixes.slots as Array<Record<string, unknown>>;
  assert.equal(slots.length, 3);
  assert.equal(slots.filter((slot) => slot.kind !== 'empty').length, 1);
  assert.ok(['speed', 'element', 'special'].includes(String(slots[0].kind)));
  assert.equal(instance.affixes.baseBudget, 160);
  assert.equal(instance.affixes.qualityMultiplier, 1.6);
});

test('equipment writer rejects empty, malformed, missing, and unsupported templates without inventing defaults', () => {
  const frozen = parameters();
  assert.throws(() => writeEquipmentInstance({ instanceId: 'empty', configVersion: '1.0.0-test', seed: 1, template: undefined }, frozen), (error: unknown) => error instanceof Error && 'code' in error && error.code === 'CONTENT_LOCKED');
  assert.throws(() => writeEquipmentInstance({ instanceId: 'missing', configVersion: '1.0.0-test', seed: 1, template: null }, frozen), (error: unknown) => error instanceof Error && 'code' in error && error.code === 'CONTENT_LOCKED');
  const unsupported = { ...template(), slot: 'armor_5' as never };
  assert.throws(() => writeEquipmentInstance({ instanceId: 'unsupported', configVersion: '1.0.0-test', seed: 1, template: unsupported }, frozen), (error: unknown) => error instanceof Error && 'code' in error && error.code === 'CONTENT_LOCKED');
  const missingParameter = template();
  delete frozen[missingParameter.quality_parameter];
  assert.throws(() => writeEquipmentInstance({ instanceId: 'missing-parameter', configVersion: '1.0.0-test', seed: 1, template: missingParameter }, frozen), (error: unknown) => error instanceof Error && 'code' in error && error.code === 'CONTENT_LOCKED');
});

test('equipment writer rejects invalid seed and config identity before generation', () => {
  const frozen = parameters();
  assert.throws(() => writeEquipmentInstance({ instanceId: '', configVersion: '1.0.0-test', seed: 1, template: template() }, frozen), (error: unknown) => error instanceof Error && 'code' in error && error.code === 'VALIDATION_FAILED');
  assert.throws(() => writeEquipmentInstance({ instanceId: 'bad-seed', configVersion: '1.0.0-test', seed: -1, template: template() }, frozen), (error: unknown) => error instanceof Error && 'code' in error && error.code === 'VALIDATION_FAILED');
  assert.throws(() => writeEquipmentInstance({ instanceId: 'bad-version', configVersion: '', seed: 1, template: template() }, frozen), (error: unknown) => error instanceof Error && 'code' in error && error.code === 'VALIDATION_FAILED');
});

test('content-backed writer resolves only templates from a validated content hash', () => {
  const content = structuredClone(CONTENT_PACKAGE);
  const input = { instanceId: 'content-backed', configVersion: content.manifest.config_version, seed: 5, content, templateId: 'iron_saber' };
  const instance = writeEquipmentInstanceFromContent(input, parameters());
  assert.equal(instance.templateId, 'iron_saber');
  assert.equal(instance.createdConfigVersion, content.manifest.config_version);
  assert.throws(() => writeEquipmentInstanceFromContent({ ...input, templateId: 'missing-template' }, parameters()), (error: unknown) => error instanceof Error && 'code' in error && error.code === 'CONTENT_LOCKED');
  const invalid = structuredClone(content);
  invalid.manifest.content_sha256 = '0'.repeat(64);
  assert.throws(() => writeEquipmentInstanceFromContent({ ...input, content: invalid }, parameters()), (error: unknown) => error instanceof Error && 'code' in error && error.code === 'VALIDATION_FAILED');
});
