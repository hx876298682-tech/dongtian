import type { HighTierRealm } from './types.ts';
import type { ConfigParameterMap } from './config-release.ts';

/**
 * The frozen V1 package only contains the signature-skill slice. A full
 * high-tier combat model is intentionally opt-in: a release must provide the
 * complete contract before the runtime is allowed to consume it.
 */
export const HIGH_TIER_COMBAT_MODE_PARAMETER = 'dungeon.high_tier.combat_mode';
export const HIGH_TIER_SIGNATURE_ONLY_MODE = 'signature_only_v1';
export const HIGH_TIER_FULL_MODE = 'full_v1';

export const HIGH_TIER_REALMS: readonly HighTierRealm[] = [
  'nascent_soul',
  'divine_transformation',
  'void_refining',
  'body_unity',
  'great_vehicle',
  'tribulation',
] as const;

export type HighTierSkillKind = 'damage' | 'damage_over_time' | 'control' | 'output_suppression';
export type HighTierSkillDefinition = {
  id: string;
  kind: HighTierSkillKind;
  cooldownSeconds: number;
  durationSeconds: number;
  magnitude: number;
};
export type HighTierResistancePolicy = {
  controlPercent: number;
  damageOverTimePercent: number;
  outputSuppressionPercent: number;
};
export type HighTierAutoPillPolicy = {
  thresholdPercent: number;
  healPerUse: number;
  targetPercent: number;
  maxUses: number;
};
export type HighTierRealmCombatContract = {
  bossAttack: number;
  bossDefence: number;
  bossAccuracy: number;
  bossAttackIntervalSeconds: number;
  bossElement: 'neutral' | 'metal' | 'wood' | 'water' | 'fire' | 'earth';
  skills: HighTierSkillDefinition[];
  resistances: HighTierResistancePolicy;
  autoPill: HighTierAutoPillPolicy;
};
export type HighTierCombatContract = {
  mode: typeof HIGH_TIER_SIGNATURE_ONLY_MODE | typeof HIGH_TIER_FULL_MODE;
  realms: Partial<Record<HighTierRealm, HighTierRealmCombatContract>>;
};

export type HighTierContractDiagnostic = {
  path: string;
  code: 'MISSING' | 'INVALID_TYPE' | 'INVALID_VALUE' | 'DUPLICATE' | 'UNSUPPORTED';
  message: string;
};

/**
 * Release lifecycle provenance is deliberately separate from structural
 * validation. The combat engine tests may use an in-memory contract fixture,
 * but a release that can reach canary/active must prove that every full_v1
 * parameter was explicitly frozen and has an attributable source.
 */
export const diagnoseHighTierCombatFormalProvenance = (parameters: ConfigParameterMap): HighTierContractDiagnostic[] => {
  const diagnostics: HighTierContractDiagnostic[] = [];
  if (raw(parameters, HIGH_TIER_COMBAT_MODE_PARAMETER) !== HIGH_TIER_FULL_MODE) return diagnostics;
  const provenanceEntries: Array<[string, ConfigParameterMap[string] | undefined]> = [[HIGH_TIER_COMBAT_MODE_PARAMETER, parameters[HIGH_TIER_COMBAT_MODE_PARAMETER]]];
  const fullFields = ['boss_attack', 'boss_defence', 'boss_accuracy', 'boss_attack_interval_seconds', 'boss_element', 'skills', 'resistances', 'auto_pill'];
  for (const realm of HIGH_TIER_REALMS) {
    for (const field of fullFields) provenanceEntries.push([`dungeon.high_tier.${realm}.${field}`, parameters[`dungeon.high_tier.${realm}.${field}`]]);
  }
  for (const [id, entry] of provenanceEntries) {
    // Structural validation reports missing fields. Do not duplicate those
    // diagnostics here; this gate only checks provenance of present values.
    if (!entry) continue;
    if (entry.status !== 'frozen_v1') diagnostics.push({ path: `${id}.status`, code: 'INVALID_VALUE', message: 'full_v1 release parameters must have status=frozen_v1' });
    const source = typeof entry.source === 'string' ? entry.source.trim() : '';
    if (source.length === 0) diagnostics.push({ path: `${id}.source`, code: 'MISSING', message: 'full_v1 release parameters require a non-empty source' });
    else if (/proposal|synthetic|fixture|test/i.test(source)) diagnostics.push({ path: `${id}.source`, code: 'INVALID_VALUE', message: 'full_v1 release parameters cannot cite proposal or test fixture provenance' });
  }
  return diagnostics;
};

export class HighTierCombatContractError extends Error {
  readonly diagnostics: HighTierContractDiagnostic[];

  constructor(diagnostics: HighTierContractDiagnostic[]) {
    super(`high-tier combat contract is invalid (${diagnostics.length} diagnostic${diagnostics.length === 1 ? '' : 's'})`);
    this.name = 'HighTierCombatContractError';
    this.diagnostics = structuredClone(diagnostics);
  }
}

const has = (parameters: ConfigParameterMap, id: string): boolean => Object.prototype.hasOwnProperty.call(parameters, id);
const raw = (parameters: ConfigParameterMap, id: string): unknown => parameters[id]?.value;
const numberValue = (parameters: ConfigParameterMap, id: string, diagnostics: HighTierContractDiagnostic[], options: { min?: number; max?: number; integer?: boolean } = {}): number | null => {
  if (!has(parameters, id)) {
    diagnostics.push({ path: id, code: 'MISSING', message: 'required parameter is missing' });
    return null;
  }
  const value = raw(parameters, id);
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    diagnostics.push({ path: id, code: 'INVALID_TYPE', message: 'parameter must be a finite number' });
    return null;
  }
  if (options.integer && !Number.isInteger(value)) diagnostics.push({ path: id, code: 'INVALID_VALUE', message: 'parameter must be an integer' });
  if (options.min !== undefined && value < options.min) diagnostics.push({ path: id, code: 'INVALID_VALUE', message: `parameter must be >= ${options.min}` });
  if (options.max !== undefined && value > options.max) diagnostics.push({ path: id, code: 'INVALID_VALUE', message: `parameter must be <= ${options.max}` });
  return value;
};
const objectValue = (parameters: ConfigParameterMap, id: string, diagnostics: HighTierContractDiagnostic[]): Record<string, unknown> | null => {
  if (!has(parameters, id)) {
    diagnostics.push({ path: id, code: 'MISSING', message: 'required object parameter is missing' });
    return null;
  }
  const value = raw(parameters, id);
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    diagnostics.push({ path: id, code: 'INVALID_TYPE', message: 'parameter must be an object' });
    return null;
  }
  return value as Record<string, unknown>;
};
const nestedNumber = (object: Record<string, unknown>, field: string, diagnostics: HighTierContractDiagnostic[], options: { min?: number; max?: number; integer?: boolean } = {}, diagnosticPath = field): number | null => {
  const value = object[field];
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    diagnostics.push({ path: diagnosticPath, code: 'INVALID_TYPE', message: 'field must be a finite number' });
    return null;
  }
  if (options.integer && !Number.isInteger(value)) diagnostics.push({ path: diagnosticPath, code: 'INVALID_VALUE', message: 'field must be an integer' });
  if (options.min !== undefined && value < options.min) diagnostics.push({ path: diagnosticPath, code: 'INVALID_VALUE', message: `field must be >= ${options.min}` });
  if (options.max !== undefined && value > options.max) diagnostics.push({ path: diagnosticPath, code: 'INVALID_VALUE', message: `field must be <= ${options.max}` });
  return value;
};

const fullRealm = (parameters: ConfigParameterMap, realm: HighTierRealm, diagnostics: HighTierContractDiagnostic[]): HighTierRealmCombatContract | null => {
  const prefix = `dungeon.high_tier.${realm}`;
  const bossAttack = numberValue(parameters, `${prefix}.boss_attack`, diagnostics, { min: 0 });
  const bossDefence = numberValue(parameters, `${prefix}.boss_defence`, diagnostics, { min: 0 });
  const bossAccuracy = numberValue(parameters, `${prefix}.boss_accuracy`, diagnostics, { min: 0 });
  const bossAttackIntervalSeconds = numberValue(parameters, `${prefix}.boss_attack_interval_seconds`, diagnostics, { min: 0.001 });
  const elementId = `${prefix}.boss_element`;
  let bossElement: HighTierRealmCombatContract['bossElement'] | null = null;
  if (!has(parameters, elementId)) diagnostics.push({ path: elementId, code: 'MISSING', message: 'required parameter is missing' });
  else {
    const value = raw(parameters, elementId);
    if (!['neutral', 'metal', 'wood', 'water', 'fire', 'earth'].includes(String(value))) diagnostics.push({ path: elementId, code: 'INVALID_VALUE', message: 'unsupported element' });
    else bossElement = value as HighTierRealmCombatContract['bossElement'];
  }

  const skillsId = `${prefix}.skills`;
  const skillsValue = raw(parameters, skillsId);
  const skills: HighTierSkillDefinition[] = [];
  if (!has(parameters, skillsId)) diagnostics.push({ path: skillsId, code: 'MISSING', message: 'required skill array parameter is missing' });
  else if (!Array.isArray(skillsValue)) diagnostics.push({ path: skillsId, code: 'INVALID_TYPE', message: 'skills parameter must be an array' });
  else {
    const seen = new Set<string>();
    for (const [index, item] of skillsValue.entries()) {
      const path = `${skillsId}[${index}]`;
      if (!item || typeof item !== 'object' || Array.isArray(item)) {
        diagnostics.push({ path, code: 'INVALID_TYPE', message: 'skill must be an object' });
        continue;
      }
      const skill = item as Record<string, unknown>;
      const id = typeof skill.id === 'string' ? skill.id.trim() : '';
      if (!id) diagnostics.push({ path: `${path}.id`, code: 'INVALID_TYPE', message: 'skill id must be a non-empty string' });
      else if (seen.has(id)) diagnostics.push({ path: `${path}.id`, code: 'DUPLICATE', message: `duplicate skill id: ${id}` });
      else seen.add(id);
      const kind = skill.kind;
      if (!['damage', 'damage_over_time', 'control', 'output_suppression'].includes(String(kind))) diagnostics.push({ path: `${path}.kind`, code: 'INVALID_VALUE', message: 'unsupported skill kind' });
      const cooldownSeconds = nestedNumber(skill, 'cooldownSeconds', diagnostics, { min: 0.001 }, `${path}.cooldownSeconds`);
      const durationSeconds = nestedNumber(skill, 'durationSeconds', diagnostics, { min: 0.001 }, `${path}.durationSeconds`);
      const magnitude = nestedNumber(skill, 'magnitude', diagnostics, { min: 0, max: 1000000000 }, `${path}.magnitude`);
      if (cooldownSeconds !== null && durationSeconds !== null && durationSeconds > cooldownSeconds) diagnostics.push({ path: `${path}.durationSeconds`, code: 'INVALID_VALUE', message: 'skill duration must not exceed cooldown' });
      if (id && ['damage', 'damage_over_time', 'control', 'output_suppression'].includes(String(kind)) && cooldownSeconds !== null && durationSeconds !== null && magnitude !== null) skills.push({ id, kind: kind as HighTierSkillKind, cooldownSeconds, durationSeconds, magnitude });
    }
    if (skills.length === 0) diagnostics.push({ path: skillsId, code: 'INVALID_VALUE', message: 'full combat contract requires at least one valid skill' });
  }

  const resistanceId = `${prefix}.resistances`;
  const resistanceObject = objectValue(parameters, resistanceId, diagnostics);
  const controlPercent = resistanceObject ? nestedNumber(resistanceObject, 'controlPercent', diagnostics, { min: 0, max: 100 }, `${resistanceId}.controlPercent`) : null;
  const damageOverTimePercent = resistanceObject ? nestedNumber(resistanceObject, 'damageOverTimePercent', diagnostics, { min: 0, max: 100 }, `${resistanceId}.damageOverTimePercent`) : null;
  const outputSuppressionPercent = resistanceObject ? nestedNumber(resistanceObject, 'outputSuppressionPercent', diagnostics, { min: 0, max: 100 }, `${resistanceId}.outputSuppressionPercent`) : null;

  const autoPillId = `${prefix}.auto_pill`;
  const autoPillObject = objectValue(parameters, autoPillId, diagnostics);
  const thresholdPercent = autoPillObject ? nestedNumber(autoPillObject, 'thresholdPercent', diagnostics, { min: 0, max: 100 }, `${autoPillId}.thresholdPercent`) : null;
  const healPerUse = autoPillObject ? nestedNumber(autoPillObject, 'healPerUse', diagnostics, { min: 0 }, `${autoPillId}.healPerUse`) : null;
  const targetPercent = autoPillObject ? nestedNumber(autoPillObject, 'targetPercent', diagnostics, { min: 0, max: 100 }, `${autoPillId}.targetPercent`) : null;
  const maxUses = autoPillObject ? nestedNumber(autoPillObject, 'maxUses', diagnostics, { min: 0, integer: true }, `${autoPillId}.maxUses`) : null;
  if (thresholdPercent !== null && targetPercent !== null && targetPercent < thresholdPercent) diagnostics.push({ path: `${autoPillId}.targetPercent`, code: 'INVALID_VALUE', message: 'targetPercent must be >= thresholdPercent' });

  if (bossAttack === null || bossDefence === null || bossAccuracy === null || bossAttackIntervalSeconds === null || bossElement === null || controlPercent === null || damageOverTimePercent === null || outputSuppressionPercent === null || thresholdPercent === null || healPerUse === null || targetPercent === null || maxUses === null || skills.length === 0) return null;
  return { bossAttack, bossDefence, bossAccuracy, bossAttackIntervalSeconds, bossElement, skills, resistances: { controlPercent, damageOverTimePercent, outputSuppressionPercent }, autoPill: { thresholdPercent, healPerUse, targetPercent, maxUses } };
};

export const diagnoseHighTierCombatContract = (parameters: ConfigParameterMap): HighTierContractDiagnostic[] => {
  const diagnostics: HighTierContractDiagnostic[] = [];
  const modeValue = raw(parameters, HIGH_TIER_COMBAT_MODE_PARAMETER);
  const fullFieldNames = ['boss_attack', 'boss_defence', 'boss_accuracy', 'boss_attack_interval_seconds', 'boss_element', 'skills', 'resistances', 'auto_pill'];
  const hasFullFields = HIGH_TIER_REALMS.some((realm) => fullFieldNames.some((field) => has(parameters, `dungeon.high_tier.${realm}.${field}`)));
  const mode = modeValue === undefined ? (hasFullFields ? HIGH_TIER_FULL_MODE : HIGH_TIER_SIGNATURE_ONLY_MODE) : modeValue;
  if (mode !== HIGH_TIER_SIGNATURE_ONLY_MODE && mode !== HIGH_TIER_FULL_MODE) {
    diagnostics.push({ path: HIGH_TIER_COMBAT_MODE_PARAMETER, code: 'UNSUPPORTED', message: `mode must be ${HIGH_TIER_SIGNATURE_ONLY_MODE} or ${HIGH_TIER_FULL_MODE}` });
    return diagnostics;
  }
  if (mode === HIGH_TIER_SIGNATURE_ONLY_MODE) {
    if (hasFullFields) diagnostics.push({ path: HIGH_TIER_COMBAT_MODE_PARAMETER, code: 'INVALID_VALUE', message: 'full combat fields are present but combat_mode is not full_v1' });
    return diagnostics;
  }
  if (modeValue === undefined) diagnostics.push({ path: HIGH_TIER_COMBAT_MODE_PARAMETER, code: 'MISSING', message: 'full combat fields require explicit combat_mode=full_v1' });
  for (const realm of HIGH_TIER_REALMS) fullRealm(parameters, realm, diagnostics);
  return diagnostics;
};

export const validateHighTierCombatContract = (parameters: ConfigParameterMap): HighTierCombatContract => {
  const diagnostics = diagnoseHighTierCombatContract(parameters);
  if (diagnostics.length > 0) throw new HighTierCombatContractError(diagnostics);
  const mode = raw(parameters, HIGH_TIER_COMBAT_MODE_PARAMETER) === HIGH_TIER_FULL_MODE ? HIGH_TIER_FULL_MODE : HIGH_TIER_SIGNATURE_ONLY_MODE;
  if (mode === HIGH_TIER_SIGNATURE_ONLY_MODE) return { mode, realms: {} };
  const realms: Partial<Record<HighTierRealm, HighTierRealmCombatContract>> = {};
  for (const realm of HIGH_TIER_REALMS) {
    const diagnosticsForRealm: HighTierContractDiagnostic[] = [];
    const contract = fullRealm(parameters, realm, diagnosticsForRealm);
    if (!contract) throw new HighTierCombatContractError(diagnosticsForRealm);
    realms[realm] = contract;
  }
  return { mode, realms };
};
