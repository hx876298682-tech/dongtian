import assert from 'node:assert/strict';
import test from 'node:test';
import type { CombatStats } from './types.ts';
import { makeHighTierSignatureCombatEvents } from './high-tier-signature-combat.ts';
import { MemoryRepository } from './repository.ts';
import { GameService } from './service.ts';
import { ApiError } from './types.ts';

const base = new Date('2026-01-01T00:00:00.000Z');
const at = (seconds: number): Date => new Date(base.getTime() + seconds * 1000);
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

test('signature-only trace is deterministic, input-bound, and bounded for long horizons', () => {
  const input = {
    attemptId: 'attempt-1',
    realm: 'nascent_soul' as const,
    seed: 123,
    elapsedSeconds: 10_000_000,
    targetClearTime: 100,
    bossMaxHp: 10_000,
    combatSnapshot: stats,
    skill: { cooldownSeconds: 300, durationSeconds: 8, attackSuppressionPercent: 40 },
    status: 'failed' as const,
    failureReason: 'timeout',
  };
  const first = makeHighTierSignatureCombatEvents(input);
  assert.deepEqual(first, makeHighTierSignatureCombatEvents(input));
  assert.ok(first.length <= 7);
  assert.equal(first.at(-1)?.kind, 'combat_end');
  assert.equal(first[0]?.kind, 'combat_start');
  assert.equal(first.some((event) => event.kind === 'skill_suppression_window'), true);
  assert.equal(first.some((event) => event.kind === 'skill_suppression_summary'), true);
  assert.equal(first.some((event) => event.kind === 'damage_phase'), true);
  assert.equal(first.some((event) => event.kind === 'combat_failure'), true);
  const changedSeed = makeHighTierSignatureCombatEvents({ ...input, seed: 124 });
  assert.notDeepEqual(first, changedSeed);
  const changedSnapshot = makeHighTierSignatureCombatEvents({ ...input, combatSnapshot: { ...stats, attack: 101 } });
  assert.notDeepEqual(first, changedSnapshot);
});

const setup = async (id: string) => {
  const repository = new MemoryRepository();
  const service = new GameService(repository, () => base);
  await service.createPlayer(id, base);
  await repository.transaction(id, 0, { eventType: 'signature_test_seed', payload: {}, at: base }, (draft) => {
    draft.realmId = 'nascent_soul';
    draft.collection.collectionMarks = 10;
    draft.resources.pill.amount = 100;
  });
  return { repository, service };
};

test('signature-only service persists start/settle trace, early settle is atomic, and replay is stable', async () => {
  const { repository, service } = await setup('signature-service');
  const started = await service.startHighTier({ playerId: 'signature-service', realm: 'nascent_soul', seed: 17, expectedRevision: 1, now: base });
  const afterStart = await repository.getPlayer('signature-service');
  assert.equal(afterStart.highTierAttempts[started.data.attemptId]?.combatEvents[0]?.kind, 'combat_start');
  await assert.rejects(
    () => service.settleHighTier({ playerId: 'signature-service', attemptId: started.data.attemptId, expectedRevision: 2, now: at(1) }),
    (error: unknown) => error instanceof ApiError && error.code === 'VALIDATION_FAILED',
  );
  const afterEarly = await repository.getPlayer('signature-service');
  assert.equal(afterEarly.stateRevision, 2);
  assert.equal(afterEarly.highTierAttempts[started.data.attemptId]?.status, 'active');
  assert.equal(afterEarly.highTierAttempts[started.data.attemptId]?.combatEvents.length, 1);

  const settled = await service.settleHighTier({ playerId: 'signature-service', attemptId: started.data.attemptId, expectedRevision: 2, now: at(started.data.targetClearTime + 1) });
  assert.equal(settled.data.status, 'failed');
  assert.equal(settled.data.combatEvents.at(-1)?.kind, 'combat_end');
  assert.equal(settled.data.combatEvents.some((event) => event.kind === 'combat_failure'), true);
  assert.ok(settled.data.combatEvents.length <= 7);
  assert.deepEqual(settled.data.combatEvents, (await repository.getPlayer('signature-service')).highTierAttempts[started.data.attemptId]?.combatEvents);
  const replay = await service.settleHighTier({ playerId: 'signature-service', attemptId: started.data.attemptId, expectedRevision: 999, now: at(999) });
  assert.deepEqual(replay, settled);
});

test('signature-only settlement commit failure leaves the start trace and active attempt unchanged', async () => {
  const { repository, service } = await setup('signature-rollback');
  const started = await service.startHighTier({ playerId: 'signature-rollback', realm: 'nascent_soul', seed: 18, expectedRevision: 1, now: base });
  const before = await repository.getPlayer('signature-rollback');
  repository.injectCommitFailure();
  await assert.rejects(() => service.settleHighTier({ playerId: 'signature-rollback', attemptId: started.data.attemptId, expectedRevision: 2, now: at(started.data.targetClearTime + 1) }), (error: unknown) => error instanceof ApiError && error.code === 'INTERNAL_ROLLBACK');
  assert.deepEqual(await repository.getPlayer('signature-rollback'), before);
});
