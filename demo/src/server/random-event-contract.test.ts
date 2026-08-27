import assert from 'node:assert/strict';
import test from 'node:test';
import { FROZEN_PARAMETERS } from '../game/frozen-parameters.ts';
import { diagnoseRandomEventParameterContract } from './random-event-contract.ts';

const parameters = () => structuredClone(FROZEN_PARAMETERS) as Record<string, { value: unknown }>;

test('frozen random-event rows match the deterministic runtime contract', () => {
  assert.deepEqual(diagnoseRandomEventParameterContract(parameters()), []);
});

test('random-event contract rejects drift in interval, probabilities, duration, and multiplier', () => {
  const map = parameters();
  map['schedule.random_event.roll_interval_hours']!.value = 24;
  map['schedule.random_event.spirit_tide.chance']!.value = 25;
  map['schedule.random_event.beast_raid.duration_hours']!.value = 5;
  map['schedule.random_event.spirit_tide.production_multiplier']!.value = 1.3;
  const paths = diagnoseRandomEventParameterContract(map).map((diagnostic) => diagnostic.path);
  assert.deepEqual(paths, [
    'schedule.random_event.roll_interval_hours',
    'schedule.random_event.spirit_tide.chance',
    'schedule.random_event.spirit_tide.production_multiplier',
    'schedule.random_event.beast_raid.duration_hours',
  ]);
});

test('random-event contract stays fail-closed when a required row is missing', () => {
  const map = parameters();
  delete map['schedule.random_event.beast_raid.chance'];
  const diagnostics = diagnoseRandomEventParameterContract(map);
  assert.ok(diagnostics.some((diagnostic) => diagnostic.path === 'schedule.random_event.beast_raid.chance' && diagnostic.code === 'MISSING'));
});
