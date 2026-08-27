import assert from 'node:assert/strict';
import test from 'node:test';
import { GameService } from './service.ts';
import { MemoryRepository, makeInitialPlayer } from './repository.ts';
import { levelFromXp, skillXpForLevel } from './skill-level.ts';

const at = (seconds: number): Date => new Date(Date.UTC(2026, 0, 1, 0, 0, seconds));

test('proposal skill curve has stable level boundaries', () => {
  assert.equal(skillXpForLevel(1), 0);
  assert.equal(skillXpForLevel(2), 100);
  assert.equal(skillXpForLevel(3), 400);
  assert.equal(levelFromXp(0), 1);
  assert.equal(levelFromXp(99), 1);
  assert.equal(levelFromXp(100), 2);
  assert.equal(levelFromXp(399), 2);
  assert.equal(levelFromXp(400), 3);
  assert.equal(levelFromXp(-1), 1);
});

test('bootstrap exposes derived skill levels after a persisted training settlement', async () => {
  const repository = new MemoryRepository();
  const service = new GameService(repository, () => at(0));
  await repository.createPlayer(makeInitialPlayer('skill-player', at(0)));
  const started = await service.startAction({ playerId: 'skill-player', actionId: 'technique_training', techniqueId: 'focus_cultivation', expectedRevision: 0, now: at(0), idempotencyKey: 'start-skill' });
  const settled = await service.offlineSettlement({ playerId: 'skill-player', settlementId: 'skill-settlement', requestedStartedAt: at(0).toISOString(), requestedEndedAt: at(600).toISOString(), expectedRevision: started.stateRevision, now: at(600) });
  assert.equal(settled.data.skillXpDelta?.technique?.focus_cultivation, 10);
  const bootstrap = await service.bootstrap('skill-player', { now: at(600) });
  assert.equal(bootstrap.data.player.skillLevels?.technique.focus_cultivation, 1);
  assert.equal(bootstrap.data.player.skillProgress.techniqueXp.focus_cultivation, 10);
});

test('memory leaderboard returns both skill XP and derived level', async () => {
  const repository = new MemoryRepository();
  const first = makeInitialPlayer('leader-one', at(0));
  first.skillProgress.alchemyXp = 400;
  await repository.createPlayer(first);
  await repository.createPlayer(makeInitialPlayer('leader-two', at(0)));
  const leaderboard = await repository.getLeaderboard('alchemy', 10, 0);
  assert.equal(leaderboard.entries[0]?.skillXp, 400);
  assert.equal(leaderboard.entries[0]?.skillLevel, 3);
});
