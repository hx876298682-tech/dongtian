import type { ConfigParameterMap } from './config-release.ts';
import { RANDOM_EVENT_DEFINITIONS, RANDOM_EVENT_WINDOW_SECONDS } from './random-event-runtime.ts';

/**
 * The runtime schema remains proposal_v1. This gate only proves that a
 * release which carries the existing frozen schedule rows cannot silently
 * drift from the deterministic runtime constants. It intentionally does not
 * validate or activate any expected-factor formula.
 */
export type RandomEventContractDiagnostic = {
  path: string;
  code: 'MISSING' | 'INVALID_TYPE' | 'INVALID_VALUE';
  message: string;
};

const events = ['spirit_tide', 'beast_raid'] as const;
const raw = (parameters: ConfigParameterMap, id: string): unknown => parameters[id]?.value;
const has = (parameters: ConfigParameterMap, id: string): boolean => Object.prototype.hasOwnProperty.call(parameters, id);
const number = (parameters: ConfigParameterMap, id: string, diagnostics: RandomEventContractDiagnostic[], options: { min?: number; integer?: boolean } = {}): number | null => {
  if (!has(parameters, id)) {
    diagnostics.push({ path: id, code: 'MISSING', message: 'required random-event parameter is missing' });
    return null;
  }
  const value = raw(parameters, id);
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    diagnostics.push({ path: id, code: 'INVALID_TYPE', message: 'random-event parameter must be a finite number' });
    return null;
  }
  if (options.integer && !Number.isInteger(value)) diagnostics.push({ path: id, code: 'INVALID_VALUE', message: 'random-event parameter must be an integer' });
  if (options.min !== undefined && value < options.min) diagnostics.push({ path: id, code: 'INVALID_VALUE', message: `random-event parameter must be >= ${options.min}` });
  return value;
};

const expectedRuntime = (eventId: (typeof events)[number]) => RANDOM_EVENT_DEFINITIONS.find((definition) => definition.eventId === eventId)!;

export const diagnoseRandomEventParameterContract = (parameters: ConfigParameterMap): RandomEventContractDiagnostic[] => {
  const diagnostics: RandomEventContractDiagnostic[] = [];
  const intervalHours = number(parameters, 'schedule.random_event.roll_interval_hours', diagnostics, { min: 1, integer: true });
  const maxActive = number(parameters, 'schedule.random_event.max_active', diagnostics, { min: 1, integer: true });
  if (intervalHours !== null && intervalHours * 60 * 60 !== RANDOM_EVENT_WINDOW_SECONDS) diagnostics.push({ path: 'schedule.random_event.roll_interval_hours', code: 'INVALID_VALUE', message: 'roll interval does not match UTC runtime window' });
  if (maxActive !== null && maxActive !== 1) diagnostics.push({ path: 'schedule.random_event.max_active', code: 'INVALID_VALUE', message: 'runtime supports exactly one mutually-exclusive event' });

  let chanceSum = 0;
  for (const eventId of events) {
    const prefix = `schedule.random_event.${eventId}`;
    const chance = number(parameters, `${prefix}.chance`, diagnostics, { min: 0 });
    const duration = number(parameters, `${prefix}.duration_hours`, diagnostics, { min: 0, integer: true });
    const multiplier = number(parameters, `${prefix}.production_multiplier`, diagnostics, { min: 0 });
    if (chance !== null) {
      if (chance > 100) diagnostics.push({ path: `${prefix}.chance`, code: 'INVALID_VALUE', message: 'event chance must be <= 100 percent' });
      chanceSum += chance;
      const runtime = expectedRuntime(eventId);
      if (Math.abs(chance / 100 - runtime.chance) > 1e-12) diagnostics.push({ path: `${prefix}.chance`, code: 'INVALID_VALUE', message: 'event chance drifts from runtime definition' });
    }
    if (duration !== null && duration !== expectedRuntime(eventId).durationSeconds / 3600) diagnostics.push({ path: `${prefix}.duration_hours`, code: 'INVALID_VALUE', message: 'event duration drifts from runtime definition' });
    if (multiplier !== null && multiplier !== expectedRuntime(eventId).productionMultiplier) diagnostics.push({ path: `${prefix}.production_multiplier`, code: 'INVALID_VALUE', message: 'event production multiplier drifts from runtime definition' });
  }
  if (chanceSum > 100) diagnostics.push({ path: 'schedule.random_event', code: 'INVALID_VALUE', message: 'mutually-exclusive event probabilities exceed 100 percent' });
  return diagnostics;
};

export const validateRandomEventParameterContract = (parameters: ConfigParameterMap): void => {
  const diagnostics = diagnoseRandomEventParameterContract(parameters);
  if (diagnostics.length > 0) throw new Error(`random-event parameter contract is invalid (${diagnostics.length} diagnostic${diagnostics.length === 1 ? '' : 's'})`);
};
