import { isContentPending, validateContentPackage } from '../content/content-schema.ts';
import type { ContentPackage, EquipmentTemplate } from '../content/content-schema.ts';
import type { ConfigParameterMap } from './config-release.ts';
import { ApiError, type EquipmentInstance } from './types.ts';

const SLOTS = ['weapon', 'armor_1', 'armor_2', 'armor_3', 'armor_4', 'accessory'] as const;
const QUALITIES = ['normal', 'fine', 'rare', 'epic', 'legendary', 'immortal'] as const;
const ELEMENTS = ['metal', 'wood', 'water', 'fire', 'earth'] as const;
const SPECIALS = ['armor_break', 'body_protection', 'vitality', 'rejuvenation'] as const;
const REINFORCEMENT_FIELDS = [
  'max_level_parameter',
  'stat_multiplier_parameter',
  'spirit_stone_base_parameter',
  'spirit_stone_growth_parameter',
  'spirit_ore_base_parameter',
  'spirit_wood_base_parameter',
  'material_growth_parameter',
] as const;

type Slot = EquipmentInstance['slot'];
type Quality = (typeof QUALITIES)[number];
type Category = 'weapon' | 'armor' | 'accessory';
export type EquipmentInstanceWriterInput = {
  instanceId: string;
  configVersion: string;
  seed: number;
  template: EquipmentTemplate | null | undefined;
};
export type ContentEquipmentInstanceWriterInput = Omit<EquipmentInstanceWriterInput, 'template'> & {
  content: ContentPackage;
  templateId: string;
  parameterSha256?: string;
};

const fail = (message: string, details?: unknown): never => { throw new ApiError('CONTENT_LOCKED', message, details); };
const validationFail = (message: string, details?: unknown): never => { throw new ApiError('VALIDATION_FAILED', message, details); };
const parameterValue = (parameters: ConfigParameterMap, id: string): unknown => parameters[id]?.value;
const finiteNumber = (parameters: ConfigParameterMap, id: string, label: string, minimum = 0): number => {
  const value = parameterValue(parameters, id);
  if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum) fail(`${label} references an invalid parameter`, { parameter: id, value });
  return value as number;
};
const requireParameter = (parameters: ConfigParameterMap, id: unknown, label: string): string => {
  if (typeof id !== 'string' || id.length === 0 || !parameters[id] || !Object.prototype.hasOwnProperty.call(parameters[id], 'value')) fail(`${label} references a missing parameter`, { parameter: id });
  return id as string;
};
const categoryOf = (slot: Slot): Category => slot === 'weapon' ? 'weapon' : slot === 'accessory' ? 'accessory' : 'armor';
const random = (seed: number, draw: number): number => {
  let state = (seed + Math.imul(draw + 1, 0x9e3779b9)) >>> 0;
  state = (Math.imul(1664525, state) + 1013904223) >>> 0;
  return state / 0x100000000;
};
const weighted = <T>(items: readonly T[], weights: readonly number[], roll: number, label: string): T => {
  if (items.length === 0 || items.length !== weights.length || !Number.isFinite(roll) || roll < 0 || roll >= 1) fail(`${label} pool shape is invalid`);
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  if (!Number.isFinite(total) || total <= 0) fail(`${label} pool has no positive weight`);
  let cursor = roll * total;
  for (let index = 0; index < items.length; index += 1) {
    cursor -= weights[index];
    if (cursor < 0) return items[index];
  }
  return items[items.length - 1];
};

function validateTemplate(template: EquipmentTemplate | null | undefined, parameters: ConfigParameterMap): asserts template is EquipmentTemplate {
  if (!template || typeof template !== 'object') throw new ApiError('CONTENT_LOCKED', 'equipment template is required');
  if (typeof template.id !== 'string' || template.id.length === 0 || typeof template.display_name !== 'string' || template.display_name.length === 0) fail('equipment template identity is incomplete');
  if (!SLOTS.includes(template.slot)) fail('equipment template slot is not one of the six canonical slots', { templateId: template.id, slot: template.slot });
  if (!QUALITIES.includes(template.quality as Quality)) fail('equipment template quality is not one of the six frozen qualities', { templateId: template.id, quality: template.quality });
  const expectedQualityParameter = `loot.equipment.quality.multiplier.${template.quality}`;
  if (template.quality_parameter !== expectedQualityParameter) fail('equipment template quality parameter does not match its quality', { templateId: template.id, quality: template.quality, qualityParameter: template.quality_parameter });
  requireParameter(parameters, template.quality_parameter, `equipment ${template.id}.quality_parameter`);
  if (!template.reinforcement || typeof template.reinforcement !== 'object' || Array.isArray(template.reinforcement)) fail('equipment template reinforcement contract is missing', { templateId: template.id });
  for (const field of REINFORCEMENT_FIELDS) requireParameter(parameters, template.reinforcement[field], `equipment ${template.id}.reinforcement.${field}`);
}

const validateShares = (parameters: ConfigParameterMap, category: Category): { primary: number; secondary: number; health: number } => {
  const read = (name: 'primary_share' | 'secondary_share' | 'health_share'): number => {
    const id = `loot.equipment.affix.${name}.${category}`;
    // Armor has no secondary allocation in the frozen contract; it is
    // explicitly zero rather than an inferred or guessed value.
    if (category === 'armor' && name === 'secondary_share' && !parameters[id]) return 0;
    return finiteNumber(parameters, id, `${category} ${name}`);
  };
  const shares = { primary: read('primary_share'), secondary: read('secondary_share'), health: read('health_share') };
  if (Math.abs(shares.primary + shares.secondary + shares.health - 100) > 1e-9) fail(`equipment ${category} attribute shares must total 100`, shares);
  return shares;
};

const rollAffix = (parameters: ConfigParameterMap, quality: Quality, slot: Slot, seed: number, index: number): Record<string, unknown> => {
  const speedWeight = finiteNumber(parameters, 'loot.equipment.affix.roll_weight.speed', 'speed affix weight');
  const elementWeight = finiteNumber(parameters, 'loot.equipment.affix.roll_weight.element', 'element affix weight');
  const specialWeight = finiteNumber(parameters, 'loot.equipment.affix.roll_weight.special', 'special affix weight');
  const specialWeights = SPECIALS.map((special) => finiteNumber(parameters, `loot.equipment.affix.special_pool.${special}.weight`, `${special} special weight`));
  const kind = weighted(['speed', 'element', 'special'] as const, [speedWeight, elementWeight, specialWeight], random(seed, index * 3), 'equipment affix');
  if (kind === 'speed') {
    const value = finiteNumber(parameters, `loot.equipment.affix.speed_rating.${quality}`, `${quality} speed rating`);
    if (value <= 0) fail(`${quality} speed rating must be positive`, { value });
    return { kind, value };
  }
  if (kind === 'element') return { kind, value: ELEMENTS[Math.floor(random(seed, index * 3 + 1) * ELEMENTS.length) % ELEMENTS.length] };
  const special = weighted(SPECIALS, specialWeights, random(seed, index * 3 + 1), 'equipment special affix');
  const targetCategory = categoryOf(slot);
  const target = parameterValue(parameters, `loot.equipment.affix.target.special.${targetCategory}`);
  if (typeof target !== 'string' || target.length === 0) fail('equipment special affix target is missing', { category: targetCategory });
  const grade = finiteNumber(parameters, `loot.equipment.affix.special_grade.${quality}`, `${quality} special grade`);
  if (!Number.isInteger(grade) || grade < 1 || grade > 4) fail(`${quality} special grade must be an integer from 1 to 4`, { grade });
  return { kind, value: special, target, grade };
};

/**
 * Create one canonical equipment instance from an already Schema-validated
 * template and a frozen parameter snapshot. This writer is deliberately not
 * wired into map settlement until the ordinary-map content readiness gate is
 * cleared; it is a deterministic, side-effect-free contract for that future
 * integration.
 */
export const writeEquipmentInstance = (input: EquipmentInstanceWriterInput, parameters: ConfigParameterMap): EquipmentInstance => {
  if (!input || typeof input !== 'object') validationFail('equipment writer input is required');
  if (typeof input.instanceId !== 'string' || input.instanceId.trim().length === 0) validationFail('equipment instanceId must be a non-empty string');
  if (typeof input.configVersion !== 'string' || input.configVersion.trim().length === 0) validationFail('equipment createdConfigVersion must be a non-empty string');
  if (!Number.isInteger(input.seed) || input.seed < 0 || input.seed > 0xffffffff) validationFail('equipment writer seed must be an unsigned 32-bit integer');
  validateTemplate(input.template, parameters);
  const template = input.template;
  const quality = template.quality as Quality;
  const category = categoryOf(template.slot);
  const qualityMultiplier = finiteNumber(parameters, template.quality_parameter, `${template.id} quality multiplier`, Number.MIN_VALUE);
  const baseBudget = finiteNumber(parameters, `loot.equipment.slot_budget.${category}`, `${category} slot budget`, Number.MIN_VALUE);
  const budget = Math.round(baseBudget * qualityMultiplier);
  if (!Number.isSafeInteger(budget) || budget <= 0) fail('equipment stat budget must be a positive safe integer', { templateId: template.id, budget });
  const shares = validateShares(parameters, category);
  const secondaryPoints = Math.round(budget * shares.secondary / 100);
  const healthPoints = Math.round(budget * shares.health / 100);
  const primaryPoints = budget - secondaryPoints - healthPoints;
  if (primaryPoints < 0 || secondaryPoints < 0 || healthPoints < 0) fail('equipment stat budget allocation is negative', { budget, primaryPoints, secondaryPoints, healthPoints });
  const attackValue = finiteNumber(parameters, 'loot.equipment.stat_point.attack_value', 'attack stat value', Number.MIN_VALUE);
  const defenceValue = finiteNumber(parameters, 'loot.equipment.stat_point.defence_value', 'defence stat value', Number.MIN_VALUE);
  const healthValue = finiteNumber(parameters, 'loot.equipment.stat_point.health_value', 'health stat value', Number.MIN_VALUE);
  const primaryAttribute = category === 'armor' ? 'defence' : 'attack';
  const secondaryAttribute = category === 'weapon' || category === 'accessory' ? 'defence' : null;
  const attack = Math.round((primaryAttribute === 'attack' ? primaryPoints : secondaryPoints) * attackValue);
  const defence = Math.round((primaryAttribute === 'defence' ? primaryPoints : secondaryPoints) * defenceValue);
  const health = Math.round(healthPoints * healthValue);
  const utilitySlots = finiteNumber(parameters, `loot.equipment.affix.utility_slots.${quality}`, `${quality} utility slot count`);
  if (!Number.isInteger(utilitySlots) || utilitySlots < 0 || utilitySlots > 3) fail('equipment utility slot count must be an integer from 0 to 3', { quality, utilitySlots });
  const slots = Array.from({ length: 3 }, (_, index) => index < utilitySlots ? rollAffix(parameters, quality, template.slot, input.seed, index) : { kind: 'empty' });
  // Keep the explicit secondary attribute check close to allocation so a
  // future template category cannot silently receive an unmodeled stat.
  if (secondaryAttribute === null && secondaryPoints !== 0) fail('equipment category has an unsupported secondary attribute allocation');
  return {
    instanceId: input.instanceId,
    templateId: template.id,
    slot: template.slot,
    quality,
    reinforcementLevel: 0,
    awakeningLevel: 0,
    affixes: { attack, defence, health, baseBudget: budget, qualityMultiplier, slots },
    lockedSlots: [],
    isEquipped: false,
    createdConfigVersion: input.configVersion,
  };
};

/** Resolve a template from a hashed, Schema-validated content package before
 * handing it to the pure writer. Unknown IDs and content/version mismatches
 * remain CONTENT_LOCKED; no ad-hoc fallback template is synthesized. */
export const writeEquipmentInstanceFromContent = (input: ContentEquipmentInstanceWriterInput, parameters: ConfigParameterMap): EquipmentInstance => {
  if (!input || typeof input !== 'object' || !input.content) validationFail('validated content package is required');
  if (typeof input.templateId !== 'string' || input.templateId.trim().length === 0) validationFail('equipment templateId must be a non-empty string');
  validateContentPackage(input.content, input.configVersion, input.parameterSha256 ?? input.content.manifest.parameter_sha256);
  const template = input.content.equipment.find((candidate) => candidate.id === input.templateId);
  if (!template) fail('equipment template is not present in the validated content package', { templateId: input.templateId });
  if (isContentPending(template)) fail('equipment template is content_pending and cannot produce an instance', { templateId: input.templateId });
  return writeEquipmentInstance({ ...input, template }, parameters);
};
