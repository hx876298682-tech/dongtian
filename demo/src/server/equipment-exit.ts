import type { ConfigParameterMap } from './config-release.ts';
import { ApiError, type ResourceId } from './types.ts';

export type EquipmentExitDiagnostic = {
  path: string;
  code: 'MISSING_PARAMETER' | 'INVALID_VALUE' | 'UNSUPPORTED_POLICY';
  message: string;
};

export type EquipmentExitDecision = 'retain' | 'salvage' | 'sell';
export type EquipmentExitResourceDelta = Partial<Record<ResourceId, number>>;

const QUALITIES = ['normal', 'fine', 'rare', 'epic', 'legendary', 'immortal'] as const;
const LOW_QUALITIES = new Set(['normal', 'fine']);

const raw = (parameters: ConfigParameterMap, id: string): unknown => parameters[id]?.value;
const numberValue = (parameters: ConfigParameterMap, id: string): number | undefined => {
  const candidate = raw(parameters, id);
  if (candidate === undefined) return undefined;
  if (typeof candidate !== 'number') return undefined;
  return Number.isFinite(candidate) ? candidate : undefined;
};

/**
 * Validate the frozen policy used by every automatic equipment-exit writer.
 * This deliberately validates values even when the current content package
 * cannot produce map equipment, so a future binding cannot silently inherit a
 * malformed economy contract.
 */
export const validateEquipmentExitPolicy = (parameters: ConfigParameterMap): EquipmentExitDiagnostic[] => {
  const diagnostics: EquipmentExitDiagnostic[] = [];
  const policy = raw(parameters, 'schedule.equipment.exit_policy');
  if (policy === undefined) diagnostics.push({ path: 'schedule.equipment.exit_policy', code: 'MISSING_PARAMETER', message: 'equipment exit policy must be frozen' });
  else if (policy !== 'retain_rare') diagnostics.push({ path: 'schedule.equipment.exit_policy', code: 'UNSUPPORTED_POLICY', message: 'runtime only supports the frozen retain_rare exit policy' });

  const reserve = numberValue(parameters, 'schedule.equipment.progression_reserve');
  if (reserve === undefined) diagnostics.push({ path: 'schedule.equipment.progression_reserve', code: 'MISSING_PARAMETER', message: 'progression reserve flag must be frozen' });
  else if (reserve !== 0 && reserve !== 1) diagnostics.push({ path: 'schedule.equipment.progression_reserve', code: 'INVALID_VALUE', message: 'progression reserve flag must be 0 or 1' });

  for (const quality of QUALITIES) {
    const enabledPath = `loot.equipment.auto_salvage.${quality}_enabled`;
    const enabled = numberValue(parameters, enabledPath);
    if (enabled === undefined) diagnostics.push({ path: enabledPath, code: 'MISSING_PARAMETER', message: 'auto salvage flag must be frozen' });
    else if (enabled !== 0 && enabled !== 1) diagnostics.push({ path: enabledPath, code: 'INVALID_VALUE', message: 'auto salvage flag must be 0 or 1' });
    const salvagePaths = [`loot.equipment.salvage.${quality}.spirit_ore`, `loot.equipment.salvage.${quality}.spirit_wood`];
    for (const path of salvagePaths) {
      const value = numberValue(parameters, path);
      // Sale-only qualities do not need salvage yields, but if a value exists
      // it must still be a finite non-negative number.
      if (value !== undefined && value < 0) diagnostics.push({ path, code: 'INVALID_VALUE', message: 'salvage yield must be finite and non-negative' });
    }
    const salePath = `loot.equipment.sell.spirit_stone.${quality}`;
    const sale = numberValue(parameters, salePath);
    if (sale === undefined) diagnostics.push({ path: salePath, code: 'MISSING_PARAMETER', message: 'automatic sale value must be frozen' });
    else if (sale < 0) diagnostics.push({ path: salePath, code: 'INVALID_VALUE', message: 'automatic sale value must be finite and non-negative' });
  }

  // The registered retain_rare policy is intentionally stricter than an
  // arbitrary per-quality mix: low qualities salvage, rare+ qualities sell.
  for (const quality of ['normal', 'fine'] as const) {
    if (numberValue(parameters, `loot.equipment.auto_salvage.${quality}_enabled`) !== 1) diagnostics.push({ path: `loot.equipment.auto_salvage.${quality}_enabled`, code: 'UNSUPPORTED_POLICY', message: `${quality} equipment must be auto salvaged for retain_rare` });
  }
  for (const quality of ['rare', 'epic', 'legendary', 'immortal'] as const) {
    if (numberValue(parameters, `loot.equipment.auto_salvage.${quality}_enabled`) !== 0) diagnostics.push({ path: `loot.equipment.auto_salvage.${quality}_enabled`, code: 'UNSUPPORTED_POLICY', message: `${quality} equipment must be sold rather than auto salvaged for retain_rare` });
  }
  return diagnostics;
};

/** Resolve the configured automatic action after inventory capacity is known. */
export const decideEquipmentExit = (parameters: ConfigParameterMap, quality: string, inventoryFull: boolean): EquipmentExitDecision => {
  if (!QUALITIES.includes(quality as (typeof QUALITIES)[number])) throw new ApiError('VALIDATION_FAILED', `unsupported equipment quality: ${quality}`, { quality });
  const diagnostics = validateEquipmentExitPolicy(parameters);
  if (diagnostics.length > 0) throw new ApiError('VALIDATION_FAILED', 'equipment exit policy is not runnable', { diagnostics });
  if (!inventoryFull) return 'retain';
  return LOW_QUALITIES.has(quality) ? 'salvage' : 'sell';
};

/**
 * Resolve only the resource side of an already validated automatic exit.
 * This is intentionally pure: callers can build a long-term ledger without
 * mutating inventory or invoking the service transaction path.
 */
export const equipmentExitResourceDelta = (parameters: ConfigParameterMap, quality: string, decision: EquipmentExitDecision): EquipmentExitResourceDelta => {
  const diagnostics = validateEquipmentExitPolicy(parameters);
  if (diagnostics.length > 0) throw new ApiError('VALIDATION_FAILED', 'equipment exit policy is not runnable', { diagnostics });
  if (!QUALITIES.includes(quality as (typeof QUALITIES)[number])) throw new ApiError('VALIDATION_FAILED', `unsupported equipment quality: ${quality}`, { quality });
  if (decision === 'retain') return {};
  if (decision === 'salvage') {
    if (!LOW_QUALITIES.has(quality)) throw new ApiError('VALIDATION_FAILED', `salvage is not configured for quality: ${quality}`, { quality });
    return {
      spirit_ore: numberValue(parameters, `loot.equipment.salvage.${quality}.spirit_ore`) ?? 0,
      spirit_wood: numberValue(parameters, `loot.equipment.salvage.${quality}.spirit_wood`) ?? 0,
    };
  }
  return { spirit_stone: numberValue(parameters, `loot.equipment.sell.spirit_stone.${quality}`) ?? 0 };
};
