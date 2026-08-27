import assert from 'node:assert/strict';
import test from 'node:test';
import { BREAKTHROUGH_CONFIG, MAP_CONFIG, TRAINING_CONFIG } from './config.ts';
import { breakthrough, canBreakthrough, claimTraining, createInitialState, productionActions, settleExpedition, startExpedition, tickCooldown } from './engine.ts';

const readyForBreakthrough = () => {
  const state = createInitialState();
  const claimed = claimTraining(state).state;
  return { ...claimed, cultivation: BREAKTHROUGH_CONFIG.cultivation, resources: { ...claimed.resources, stones: BREAKTHROUGH_CONFIG.resources.stones, pills: BREAKTHROUGH_CONFIG.resources.pills, scrolls: BREAKTHROUGH_CONFIG.resources.scrolls } };
};

test('claimTraining is one-shot and increments revision once', () => {
  const initial = createInitialState();
  const first = claimTraining(initial);
  assert.equal(first.summary.ok, true);
  assert.equal(first.state.revision, initial.revision + 1);
  assert.equal(first.state.cultivation, 9870);
  assert.equal(first.state.resources.stones, INITIAL_STONES + TRAINING_CONFIG.resources.stones);
  const repeated = claimTraining(first.state);
  assert.equal(repeated.summary.ok, false);
  assert.equal(repeated.state.revision, first.state.revision);
  assert.deepEqual(repeated.state, first.state);
});

test('production uses frozen interval, floors partial time, and clips carry', () => {
  assert.equal(productionActions(TRAINING_CONFIG.intervalSeconds - 1), 0);
  assert.equal(productionActions(TRAINING_CONFIG.intervalSeconds * 3 + 1), 3);
  assert.equal(productionActions(Number.POSITIVE_INFINITY), 0);
  const result = claimTraining(createInitialState(), TRAINING_CONFIG.intervalSeconds * 3 + 1);
  assert.equal(result.summary.ok, true);
  assert.equal(result.state.cultivation, 9800 + TRAINING_CONFIG.cultivation * 3);
});

test('production carries elapsed remainder into the next settlement', () => {
  const first = claimTraining(createInitialState(), TRAINING_CONFIG.intervalSeconds + 30);
  assert.equal(first.summary.ok, true);
  assert.equal(first.state.activity.carrySeconds, 30);
  assert.equal(first.state.activity.claimable, true);
  const second = claimTraining(first.state, 30);
  assert.equal(second.summary.ok, true);
  assert.equal(second.state.activity.carrySeconds, 0);
  assert.equal(second.state.activity.claimable, false);
  assert.equal(second.state.cultivation, 9800 + TRAINING_CONFIG.cultivation * 2);
});

const INITIAL_STONES = 5620;

test('startExpedition rejects power-gated maps without changing state', () => {
  const initial = createInitialState();
  const result = startExpedition(initial, 'flame');
  assert.equal(result.summary.ok, false);
  assert.match(result.summary.message, /还需/);
  assert.deepEqual(result.state, initial);
});

test('expedition follows idle -> fighting -> cooldown and settles rewards', () => {
  const initial = { ...createInitialState(), power: MAP_CONFIG.find((map) => map.id === 'wind')?.requiredPower ?? 0 };
  const started = startExpedition(initial, 'wind', 0);
  assert.equal(started.summary.ok, true);
  assert.equal(started.state.activity.status, 'fighting');
  assert.equal(started.state.revision, 1);
  const duplicateStart = startExpedition(started.state, 'wind');
  assert.equal(duplicateStart.summary.ok, false);
  assert.equal(duplicateStart.state.revision, started.state.revision);
  const settled = settleExpedition(started.state);
  assert.equal(settled.summary.ok, true);
  assert.equal(settled.state.activity.status, 'cooldown');
  assert.equal(settled.state.activity.cooldownRemaining, MAP_CONFIG.find((map) => map.id === 'wind')?.cooldownSeconds);
  assert.equal(settled.state.resources.ore, initial.resources.ore + (MAP_CONFIG.find((map) => map.id === 'wind')?.rewardResources.ore ?? 0));
  assert.equal(settled.summary.equipmentIds.length, 1);
  assert.equal(settled.state.equipment.some((item) => item.id.startsWith('equipment.cloud_blade.')), true);
  const blocked = startExpedition(settled.state, 'wind');
  assert.equal(blocked.summary.ok, false);
  assert.equal(blocked.summary.kind, 'cooldown');
  const ready = tickCooldown(settled.state, 999);
  assert.equal(ready.activity.status, 'idle');
  assert.equal(ready.activity.cooldownRemaining, 0);
  assert.equal(startExpedition(ready, 'herb').summary.ok, true);
});

test('seeded expedition settlement is replayable and advances map pity', () => {
  const base = { ...createInitialState(), power: MAP_CONFIG.find((map) => map.id === 'wind')?.requiredPower ?? 0 };
  const run = () => settleExpedition(startExpedition(base, 'wind', 42).state);
  const first = run();
  const replay = run();
  assert.deepEqual(first.state.resources, replay.state.resources);
  assert.deepEqual(first.state.equipment, replay.state.equipment);
  assert.deepEqual(first.summary, replay.summary);
  assert.equal(first.state.mapPityKills.wind, first.summary.resourceDelta.scrolls > 0 ? 0 : 1);
});

test('settlement without fighting is rejected and cannot create negative resources', () => {
  const initial = createInitialState();
  const result = settleExpedition(initial);
  assert.equal(result.summary.ok, false);
  assert.deepEqual(result.state.resources, initial.resources);
  assert.equal(Object.values(result.state.resources).every((value) => value >= 0), true);
});

test('invalid map and invalid resource boundaries are rejected without mutation', () => {
  const initial = createInitialState();
  const invalidMap = startExpedition(initial, 'missing-map');
  assert.equal(invalidMap.summary.ok, false);
  assert.deepEqual(invalidMap.state, initial);
  const negative = { ...initial, resources: { ...initial.resources, stones: -1 } };
  const denied = breakthrough({ ...negative, cultivation: BREAKTHROUGH_CONFIG.cultivation });
  assert.equal(denied.summary.ok, false);
  assert.equal(denied.state.resources.stones, -1);
  const overflow = claimTraining({ ...initial, resources: { ...initial.resources, stones: Number.MAX_SAFE_INTEGER } });
  assert.equal(overflow.summary.ok, true);
  assert.equal(Number.isSafeInteger(overflow.state.resources.stones), true);
  assert.equal(overflow.state.resources.stones, 25000);
});

test('breakthrough reports missing conditions and leaves state unchanged', () => {
  const initial = createInitialState();
  const check = canBreakthrough(initial);
  assert.equal(check.ok, false);
  assert.equal(check.missing.length > 0, true);
  const result = breakthrough(initial);
  assert.equal(result.summary.ok, false);
  assert.deepEqual(result.state, initial);
});

test('breakthrough succeeds only when all conditions are met and conserves resources', () => {
  const ready = readyForBreakthrough();
  const before = { ...ready.resources };
  assert.equal(canBreakthrough(ready).ok, true);
  const result = breakthrough(ready);
  assert.equal(result.summary.ok, true);
  assert.equal(result.state.realm, 'foundation_establishment');
  assert.equal(result.state.cultivation, 0);
  assert.equal(result.state.resources.stones, before.stones - BREAKTHROUGH_CONFIG.resources.stones);
  assert.equal(result.state.resources.herbs, before.herbs - BREAKTHROUGH_CONFIG.resources.herbs);
  assert.equal(Object.values(result.state.resources).every((value) => value >= 0), true);
  assert.equal(result.state.revision, ready.revision + 1);
});
