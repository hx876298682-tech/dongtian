import assert from 'node:assert/strict';
import test from 'node:test';
import type { CombatStats } from './types.ts';
import { makeHighTierFullCombatSnapshot, simulateHighTierFullCombat, findHighTierFullCombatClearTime } from './high-tier-full-combat.ts';
import type { HighTierRealmCombatContract } from './high-tier-contract.ts';
import { FROZEN_PARAMETERS, FROZEN_PARAMETER_SHA256 } from '../game/frozen-parameters.ts';
import { CONTENT_PACKAGE } from '../content/content-schema.ts';
import { GameService } from './service.ts';
import { MemoryRepository } from './repository.ts';
import { StaticConfigReleaseProvider } from './config-release.ts';
import type { ConfigParameterMap } from './config-release.ts';

const stats: CombatStats = {
  attack: 100,
  defence: 100,
  health: 500,
  speed: 0,
  accuracy: 100,
  evasion: 0,
  attackInterval: 1,
  battlePower: 0,
  element: 'neutral',
  elements: {},
  outgoingSpecial: 1,
  incomingSpecial: 1,
  pillHealMultiplier: 1,
};
const contract = (overrides: Partial<HighTierRealmCombatContract> = {}): HighTierRealmCombatContract => ({
  bossAttack: 20,
  bossDefence: 0,
  bossAccuracy: 100,
  bossAttackIntervalSeconds: 10,
  bossElement: 'neutral',
  skills: [],
  resistances: { controlPercent: 0, damageOverTimePercent: 0, outputSuppressionPercent: 0 },
  autoPill: { thresholdPercent: 30, healPerUse: 100, targetPercent: 80, maxUses: 10 },
  ...overrides,
});

test('full_v1 engine resolves deterministic boss attacks, damage and clear time', () => {
  const snapshot = makeHighTierFullCombatSnapshot('nascent_soul', contract(), stats, 250);
  const result = simulateHighTierFullCombat(snapshot, 10);
  assert.equal(result.status, 'succeeded');
  assert.equal(result.elapsedSeconds, 5);
  assert.equal(result.bossHp, 0);
  assert.equal(result.bossAttacks, 0);
  assert.equal(findHighTierFullCombatClearTime(snapshot), 5);
  assert.deepEqual(result.combatEvents, simulateHighTierFullCombat(snapshot, 10).combatEvents);
  assert.equal(result.combatEvents.at(-1)?.kind, 'combat_end');
  assert.ok(result.combatEvents.some((event) => event.actor === 'player' && event.kind === 'attack'));
});

test('full_v1 combat trace is bounded for long deterministic simulations', () => {
  const snapshot = makeHighTierFullCombatSnapshot('nascent_soul', contract({ bossAttack: 0, bossAttackIntervalSeconds: 0.1 }), stats, 1_000_000_000);
  const result = simulateHighTierFullCombat(snapshot, 10_000_000);
  assert.ok(result.combatEvents.length <= 4097);
  assert.equal(result.combatEvents.at(-1)?.kind, 'combat_end');
  assert.equal(result.combatEvents.some((event) => event.kind === 'trace_truncated'), true);
});

test('full_v1 engine applies control, damage-over-time and output suppression resistance', () => {
  const snapshot = makeHighTierFullCombatSnapshot('divine_transformation', contract({
    skills: [
      { id: 'burn', kind: 'damage_over_time', cooldownSeconds: 4, durationSeconds: 3, magnitude: 10 },
      { id: 'bind', kind: 'control', cooldownSeconds: 5, durationSeconds: 2, magnitude: 1 },
      { id: 'seal', kind: 'output_suppression', cooldownSeconds: 6, durationSeconds: 2, magnitude: 50 },
    ],
    resistances: { controlPercent: 50, damageOverTimePercent: 50, outputSuppressionPercent: 50 },
  }), stats, 1000);
  const result = simulateHighTierFullCombat(snapshot, 8);
  assert.equal(result.status, 'active');
  assert.equal(result.skillCasts, 7);
  assert.equal(result.controlSeconds, 2);
  assert.equal(result.outputSuppressedSeconds, 2);
  assert.equal(result.damageOverTimeDamage, 12.5);
  assert.ok(result.bossHp > 0);
});

test('full_v1 engine consumes only configured automatic pills and reports defeat when exhausted', () => {
  const snapshot = makeHighTierFullCombatSnapshot('void_refining', contract({
    bossAttack: 160,
    bossAttackIntervalSeconds: 1,
    autoPill: { thresholdPercent: 70, healPerUse: 30, targetPercent: 75, maxUses: 2 },
  }), stats, 10000);
  const result = simulateHighTierFullCombat(snapshot, 10);
  assert.equal(result.status, 'failed');
  assert.equal(result.failureReason, 'player_defeated');
  assert.equal(result.pillUses, 2);
  assert.ok(result.playerHealth <= 0);
});

test('full_v1 snapshot freezes contract and player stats for deterministic replay', () => {
  const sourceContract = contract({ bossAttack: 25, skills: [{ id: 'hit', kind: 'damage', cooldownSeconds: 3, durationSeconds: 1, magnitude: 10 }] });
  const snapshot = makeHighTierFullCombatSnapshot('tribulation', sourceContract, stats, 600);
  sourceContract.bossAttack = 9999;
  sourceContract.skills[0]!.magnitude = 9999;
  const first = simulateHighTierFullCombat(snapshot, 20);
  const second = simulateHighTierFullCombat(snapshot, 20);
  assert.deepEqual(first, second);
  assert.equal(snapshot.contract.bossAttack, 25);
  assert.equal(snapshot.contract.skills[0]?.magnitude, 10);
});

test('GameService persists and settles a validated full_v1 snapshot without using dungeon parameters', async () => {
  const parameters = structuredClone(FROZEN_PARAMETERS) as ConfigParameterMap;
  parameters['dungeon.high_tier.combat_mode'] = { value: 'full_v1' };
  for (const realm of ['nascent_soul', 'divine_transformation', 'void_refining', 'body_unity', 'great_vehicle', 'tribulation'] as const) {
    const prefix = `dungeon.high_tier.${realm}`;
    parameters[`${prefix}.boss_attack`] = { value: 0 };
    parameters[`${prefix}.boss_defence`] = { value: 0 };
    parameters[`${prefix}.boss_accuracy`] = { value: 100 };
    parameters[`${prefix}.boss_attack_interval_seconds`] = { value: 1 };
    parameters[`${prefix}.boss_element`] = { value: 'neutral' };
    parameters[`${prefix}.skills`] = { value: [{ id: 'seal', kind: 'output_suppression', cooldownSeconds: 300, durationSeconds: 1, magnitude: 10 }] };
    parameters[`${prefix}.resistances`] = { value: { controlPercent: 0, damageOverTimePercent: 0, outputSuppressionPercent: 0 } };
    parameters[`${prefix}.auto_pill`] = { value: { thresholdPercent: 40, healPerUse: 100, targetPercent: 80, maxUses: 3 } };
  }
  const parameterHash = FROZEN_PARAMETER_SHA256;
  const version = '1.0.0-full-v1-test';
  const content = { ...CONTENT_PACKAGE, manifest: { ...CONTENT_PACKAGE.manifest, config_version: version, parameter_sha256: parameterHash } };
  const provider = new StaticConfigReleaseProvider({ version, parameterSha256: parameterHash, contentSha256: content.manifest.content_sha256, content, parameters });
  const repository = new MemoryRepository();
  const service = new GameService(repository, () => new Date('2026-01-01T00:00:00.000Z'), undefined, undefined, undefined, provider);
  await service.createPlayer('full-v1-service', new Date('2026-01-01T00:00:00.000Z'));
  await repository.transaction('full-v1-service', 0, { eventType: 'seed_full_v1_gate', payload: {}, at: new Date('2026-01-01T00:00:00.000Z') }, (draft) => {
    draft.realmId = 'nascent_soul';
    draft.collection.collectionMarks = 10;
  });
  const preview = await service.previewHighTier('full-v1-service', 'nascent_soul', { now: new Date('2026-01-01T00:00:00.000Z'), configVersion: version });
  assert.equal(preview.data.fullCombat?.mode, 'full_v1');
  assert.equal(preview.data.skill.attackSuppressionPercent, 10);
  const start = await service.startHighTier({ playerId: 'full-v1-service', realm: 'nascent_soul', expectedRevision: 1, now: new Date('2026-01-01T00:00:00.000Z'), configVersion: version, seed: 7 });
  const attempt = (await repository.getPlayer('full-v1-service')).highTierAttempts[start.data.attemptId];
  assert.equal(attempt?.fullCombat?.contract.bossDefence, 0);
  const settled = await service.settleHighTier({ playerId: 'full-v1-service', attemptId: start.data.attemptId, expectedRevision: 2, now: new Date(Date.parse('2026-01-01T00:00:00.000Z') + start.data.targetClearTime * 1000), configVersion: version });
  assert.equal(settled.data.status, 'succeeded');
  assert.equal(settled.data.fullCombat?.mode, 'full_v1');
  assert.equal(settled.data.pillCost, settled.data.fullCombat ? 0 : -1);
  assert.ok(settled.data.combatEvents.length > 0);
  assert.equal(settled.data.combatEvents.at(-1)?.kind, 'combat_end');
  assert.deepEqual(settled.data.combatEvents, (await repository.getPlayer('full-v1-service')).highTierAttempts[start.data.attemptId]?.combatEvents);
});
