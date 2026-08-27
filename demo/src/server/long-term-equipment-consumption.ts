import { isContentPending, type ContentPackage, type EquipmentTemplate } from '../content/content-schema.ts';
import { FROZEN_PARAMETERS } from '../game/frozen-parameters.ts';
import type { ConfigParameterMap } from './config-release.ts';
import { decideEquipmentExit, equipmentExitResourceDelta, validateEquipmentExitPolicy, type EquipmentExitDecision } from './equipment-exit.ts';
import { writeEquipmentInstanceFromContent } from './equipment-instance-writer.ts';
import type { EquipmentInstance, ResourceId } from './types.ts';

export type LongTermEquipmentQuality = 'normal' | 'fine' | 'rare' | 'epic' | 'legendary' | 'immortal';
export type LongTermEquipmentDropBatch = {
  source: 'ordinary_map' | 'high_tier';
  /** A future formal content package must bind this source to a map. */
  bindingMapId: string;
  byQuality: Partial<Record<LongTermEquipmentQuality, number>>;
};
export type LongTermEquipmentPromotionRequest = { fromQuality: LongTermEquipmentQuality; count: number };
export type LongTermEquipmentConsumptionRequest = {
  seed: number;
  configVersion?: string;
  parameters?: ConfigParameterMap;
  content?: ContentPackage;
  inventoryCount: number;
  inventoryCapacity: number;
  drops: readonly LongTermEquipmentDropBatch[];
  autoPromotion?: {
    enabled: boolean;
    requests?: readonly LongTermEquipmentPromotionRequest[];
    availableResources?: Partial<Record<ResourceId, number>>;
  };
};

export type LongTermEquipmentDiagnostic = {
  path: string;
  code: 'MISSING_PARAMETER' | 'INVALID_VALUE' | 'UNSUPPORTED_POLICY' | 'MISSING_CONTENT_BINDING' | 'CONTENT_LOCKED' | 'INSUFFICIENT_RESOURCE';
  message: string;
};

export type LongTermEquipmentConsumptionResult = {
  mode: 'read_only_equipment_consumption_v1';
  inventory: { before: number; after: number; capacity: number; overflow: number };
  generated: { count: number; byQuality: Record<LongTermEquipmentQuality, number>; instances: Array<Pick<EquipmentInstance, 'instanceId' | 'templateId' | 'slot' | 'quality'>> };
  exits: {
    retained: number;
    salvaged: number;
    sold: number;
    byQuality: Record<LongTermEquipmentQuality, { retain: number; salvage: number; sell: number }>;
  };
  resourceLedger: Partial<Record<ResourceId, number>>;
  promotion: {
    status: 'not_requested' | 'blocked' | 'planned';
    requests: LongTermEquipmentPromotionRequest[];
    resourceCost: Partial<Record<ResourceId, number>>;
  };
  diagnostics: LongTermEquipmentDiagnostic[];
};

export class LongTermEquipmentConsumptionError extends Error {
  readonly diagnostics: LongTermEquipmentDiagnostic[];

  constructor(diagnostics: LongTermEquipmentDiagnostic[]) {
    super('long-term equipment consumption contract is not runnable');
    this.name = 'LongTermEquipmentConsumptionError';
    this.diagnostics = diagnostics;
  }
}

const QUALITIES: readonly LongTermEquipmentQuality[] = ['normal', 'fine', 'rare', 'epic', 'legendary', 'immortal'];
const CATEGORIES = ['weapon', 'armor', 'accessory'] as const;
const TRANSITIONS = QUALITIES.slice(0, -1).map((fromQuality, index) => ({ fromQuality, toQuality: QUALITIES[index + 1], name: `${fromQuality}_to_${QUALITIES[index + 1]}` }));
const PROMOTION_RESOURCES = ['spirit_stone', 'millennium_herb', 'meteor_iron'] as const;
const RESOURCE_IDS = ['spirit_stone', 'spirit_herb', 'spirit_ore', 'spirit_wood', 'pill', 'ancient_scroll', 'millennium_herb', 'meteor_iron', 'demon_core'] as const;
const resource = (parameters: ConfigParameterMap, path: string): unknown => parameters[path]?.value;
const finite = (parameters: ConfigParameterMap, path: string): number | undefined => {
  const candidate = resource(parameters, path);
  return typeof candidate === 'number' && Number.isFinite(candidate) ? candidate : undefined;
};
const add = (target: Partial<Record<ResourceId, number>>, id: ResourceId, amount: number): void => { target[id] = (target[id] ?? 0) + amount; };
const emptyQualityRecord = <T>(factory: () => T): Record<LongTermEquipmentQuality, T> => Object.fromEntries(QUALITIES.map((quality) => [quality, factory()])) as Record<LongTermEquipmentQuality, T>;
const random = (seed: number, draw: number): number => {
  let state = (seed + Math.imul(draw + 1, 0x9e3779b9)) >>> 0;
  state = (Math.imul(1664525, state) + 1013904223) >>> 0;
  return state / 0x100000000;
};
const weightedCategory = (weights: number[], roll: number): number => {
  const total = weights.reduce((sum, value) => sum + value, 0);
  let cursor = roll * total;
  for (let index = 0; index < weights.length; index += 1) {
    cursor -= weights[index];
    if (cursor < 0) return index;
  }
  return weights.length - 1;
};

const diagnostic = (diagnostics: LongTermEquipmentDiagnostic[], path: string, code: LongTermEquipmentDiagnostic['code'], message: string): void => {
  diagnostics.push({ path, code, message });
};

const requireFrozenProvenance = (parameters: ConfigParameterMap, path: string, diagnostics: LongTermEquipmentDiagnostic[]): void => {
  const entry = parameters[path];
  if (!entry) return;
  if (entry.status !== 'frozen_v1') diagnostic(diagnostics, path, 'UNSUPPORTED_POLICY', 'automatic equipment promotion requires a frozen_v1 parameter');
  if (typeof entry.source !== 'string' || entry.source.trim().length === 0) diagnostic(diagnostics, path, 'MISSING_PARAMETER', 'automatic equipment promotion requires parameter source provenance');
};

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

const validateAvailableResources = (value: unknown, diagnostics: LongTermEquipmentDiagnostic[]): void => {
  if (value === undefined) return;
  if (!isRecord(value)) {
    diagnostic(diagnostics, 'autoPromotion.availableResources', 'INVALID_VALUE', 'availableResources must be an object');
    return;
  }
  for (const [id, amount] of Object.entries(value)) {
    if (!(RESOURCE_IDS as readonly string[]).includes(id)) {
      diagnostic(diagnostics, `autoPromotion.availableResources.${id}`, 'INVALID_VALUE', 'resource is unsupported');
    } else if (typeof amount !== 'number' || !Number.isFinite(amount) || amount < 0 || !Number.isSafeInteger(amount)) {
      diagnostic(diagnostics, `autoPromotion.availableResources.${id}`, 'INVALID_VALUE', 'available resource amount must be a non-negative safe integer');
    }
  }
};

const validatePromotion = (parameters: ConfigParameterMap, request: NonNullable<LongTermEquipmentConsumptionRequest['autoPromotion']>, diagnostics: LongTermEquipmentDiagnostic[]): LongTermEquipmentPromotionRequest[] => {
  if (!isRecord(request)) {
    diagnostic(diagnostics, 'autoPromotion', 'INVALID_VALUE', 'autoPromotion must be an object');
    return [];
  }
  validateAvailableResources(request.availableResources, diagnostics);
  if (request.requests !== undefined && !Array.isArray(request.requests)) {
    diagnostic(diagnostics, 'autoPromotion.requests', 'INVALID_VALUE', 'promotion requests must be an array');
  }
  if (typeof request.enabled !== 'boolean') {
    diagnostic(diagnostics, 'autoPromotion.enabled', 'INVALID_VALUE', 'automatic promotion enabled must be boolean');
    return [];
  }
  if (!request.enabled) return [];
  if (request.requests !== undefined && !Array.isArray(request.requests)) return [];
  const enabledPath = 'schedule.equipment.auto_promotion.enabled';
  const enabled = resource(parameters, enabledPath);
  requireFrozenProvenance(parameters, enabledPath, diagnostics);
  if (enabled === undefined) diagnostic(diagnostics, enabledPath, 'MISSING_PARAMETER', 'automatic equipment promotion requires a formal frozen enable flag');
  else if (enabled !== 1) diagnostic(diagnostics, enabledPath, 'UNSUPPORTED_POLICY', 'automatic equipment promotion is not enabled by the active frozen policy');
  const duplicatePath = 'loot.equipment.promotion.duplicate_required';
  const duplicate = finite(parameters, duplicatePath);
  requireFrozenProvenance(parameters, duplicatePath, diagnostics);
  if (duplicate === undefined) diagnostic(diagnostics, duplicatePath, 'MISSING_PARAMETER', 'automatic equipment promotion requires duplicate cost');
  else if (!Number.isInteger(duplicate) || duplicate < 1) diagnostic(diagnostics, duplicatePath, 'INVALID_VALUE', 'duplicate cost must be a positive integer');
  const successPath = 'loot.equipment.promotion.success_chance';
  const success = finite(parameters, successPath);
  requireFrozenProvenance(parameters, successPath, diagnostics);
  if (success === undefined) diagnostic(diagnostics, successPath, 'MISSING_PARAMETER', 'automatic equipment promotion requires success chance');
  else if (success !== 100) diagnostic(diagnostics, successPath, 'UNSUPPORTED_POLICY', 'automatic promotion requires a deterministic 100 percent success contract');
  const preservedPath = 'loot.equipment.promotion.enhancement_preserved';
  const preserved = finite(parameters, preservedPath);
  requireFrozenProvenance(parameters, preservedPath, diagnostics);
  if (preserved === undefined) diagnostic(diagnostics, preservedPath, 'MISSING_PARAMETER', 'automatic equipment promotion requires enhancement preservation policy');
  else if (preserved !== 1) diagnostic(diagnostics, preservedPath, 'UNSUPPORTED_POLICY', 'automatic promotion requires enhancement preservation');
  const requests = Array.isArray(request.requests) ? request.requests : [];
  for (const [index, promotion] of requests.entries()) {
    if (!isRecord(promotion)) {
      diagnostic(diagnostics, `autoPromotion.requests.${index}`, 'INVALID_VALUE', 'promotion request must be an object');
      continue;
    }
    const fromQuality = promotion.fromQuality;
    const count = promotion.count;
    if (!QUALITIES.includes(fromQuality as LongTermEquipmentQuality)) diagnostic(diagnostics, `autoPromotion.requests.${index}.fromQuality`, 'INVALID_VALUE', 'promotion quality is unsupported');
    if (typeof count !== 'number' || !Number.isSafeInteger(count) || count < 0) diagnostic(diagnostics, `autoPromotion.requests.${index}.count`, 'INVALID_VALUE', 'promotion count must be a non-negative safe integer');
    const transition = TRANSITIONS.find((candidate) => candidate.fromQuality === fromQuality);
    if (!transition) continue;
    for (const id of PROMOTION_RESOURCES) {
      const path = `loot.equipment.promotion.${transition.name}.${id}_cost`;
      const value = finite(parameters, path);
      requireFrozenProvenance(parameters, path, diagnostics);
      if (value === undefined) diagnostic(diagnostics, path, 'MISSING_PARAMETER', 'automatic equipment promotion requires a formal frozen resource cost');
      else if (value < 0) diagnostic(diagnostics, path, 'INVALID_VALUE', 'promotion resource cost must be non-negative');
      else if (!Number.isSafeInteger(value) || typeof count !== 'number' || !Number.isSafeInteger(value * count)) diagnostic(diagnostics, path, 'INVALID_VALUE', 'promotion resource cost must remain a safe integer at the requested count');
    }
  }
  return requests as LongTermEquipmentPromotionRequest[];
};

const templateForDrop = (content: ContentPackage, batch: LongTermEquipmentDropBatch, quality: LongTermEquipmentQuality, seed: number, draw: number, parameters: ConfigParameterMap, diagnostics: LongTermEquipmentDiagnostic[]): EquipmentTemplate | null => {
  if (batch.source === 'high_tier') {
    diagnostic(diagnostics, 'dungeon.high_tier.equipment_drop', 'MISSING_CONTENT_BINDING', 'high-tier equipment drops require a dedicated formal content binding');
    return null;
  }
  const map = content.maps.find((candidate) => candidate.id === batch.bindingMapId);
  if (isContentPending(map)) {
    diagnostic(diagnostics, `maps.${batch.bindingMapId}.status`, 'CONTENT_LOCKED', 'pending maps cannot emit long-term equipment drops');
    return null;
  }
  const binding = map?.equipment_drop;
  if (!map || !binding || binding.template_ids.length === 0) {
    diagnostic(diagnostics, `maps.${batch.bindingMapId}.equipment_drop`, 'MISSING_CONTENT_BINDING', 'positive long-term equipment drops require a formal content template binding');
    return null;
  }
  const candidates = binding.template_ids
    .map((id) => content.equipment.find((template) => template.id === id))
    .filter((template): template is EquipmentTemplate => Boolean(template && template.quality === quality));
  if (candidates.some((template) => isContentPending(template))) {
    diagnostic(diagnostics, `maps.${batch.bindingMapId}.equipment_drop.template_ids`, 'CONTENT_LOCKED', `quality ${quality} includes a content_pending equipment template`);
    return null;
  }
  if (candidates.length === 0) {
    diagnostic(diagnostics, `maps.${batch.bindingMapId}.equipment_drop.template_ids`, 'MISSING_CONTENT_BINDING', `quality ${quality} has no bound formal equipment template`);
    return null;
  }
  const weights = CATEGORIES.map((category) => finite(parameters, `loot.equipment.drop_slot_weight.${category}`) ?? Number.NaN);
  if (weights.some((weight) => !Number.isFinite(weight) || weight < 0) || weights.every((weight) => weight === 0)) {
    diagnostic(diagnostics, 'loot.equipment.drop_slot_weight', 'INVALID_VALUE', 'equipment slot weights must be finite, non-negative, and contain a positive weight');
    return null;
  }
  const category = CATEGORIES[weightedCategory(weights, random(seed, draw))];
  const categoryCandidates = candidates.filter((template) => template.slot === category || (category === 'armor' && template.slot.startsWith('armor_')));
  if (categoryCandidates.length === 0) {
    diagnostic(diagnostics, `maps.${batch.bindingMapId}.equipment_drop.template_ids`, 'MISSING_CONTENT_BINDING', `quality ${quality} has no bound template for slot category ${category}`);
    return null;
  }
  return categoryCandidates[Math.floor(random(seed, draw + 1) * categoryCandidates.length) % categoryCandidates.length];
};

const promotionLedger = (parameters: ConfigParameterMap, requests: readonly LongTermEquipmentPromotionRequest[], ledger: Partial<Record<ResourceId, number>>): Partial<Record<ResourceId, number>> => {
  const resourceCost: Partial<Record<ResourceId, number>> = {};
  for (const request of requests) {
    const transition = TRANSITIONS.find((candidate) => candidate.fromQuality === request.fromQuality);
    if (!transition) continue;
    for (const id of PROMOTION_RESOURCES) {
      const amount = (finite(parameters, `loot.equipment.promotion.${transition.name}.${id}_cost`) ?? 0) * request.count;
      add(resourceCost, id, amount);
      add(ledger, id, -amount);
    }
  }
  return resourceCost;
};

/**
 * Build a deterministic equipment generation -> exit -> resource ledger plan.
 * The function never writes a player or mutates the supplied content,
 * parameters, drops, or inventory snapshot.  It requires formal content
 * bindings for every positive drop, so a future release can opt in without
 * allowing a synthetic template or another route's parameters to leak in.
 */
export const planLongTermEquipmentConsumption = (request: LongTermEquipmentConsumptionRequest): LongTermEquipmentConsumptionResult => {
  const parameters = request.parameters ?? FROZEN_PARAMETERS;
  const diagnostics: LongTermEquipmentDiagnostic[] = [];
  if (!Number.isInteger(request.seed) || request.seed < 0 || request.seed > 0xffffffff) diagnostic(diagnostics, 'seed', 'INVALID_VALUE', 'seed must be an unsigned 32-bit integer');
  if (!Number.isSafeInteger(request.inventoryCount) || request.inventoryCount < 0) diagnostic(diagnostics, 'inventoryCount', 'INVALID_VALUE', 'inventoryCount must be a non-negative safe integer');
  if (!Number.isSafeInteger(request.inventoryCapacity) || request.inventoryCapacity < 0) diagnostic(diagnostics, 'inventoryCapacity', 'INVALID_VALUE', 'inventoryCapacity must be a non-negative safe integer');
  if (request.inventoryCount > request.inventoryCapacity) diagnostic(diagnostics, 'inventoryCount', 'INVALID_VALUE', 'inventoryCount cannot exceed inventoryCapacity');
  diagnostics.push(...validateEquipmentExitPolicy(parameters));
  const promotionRequests = validatePromotion(parameters, request.autoPromotion ?? { enabled: false }, diagnostics);
  const byQuality = emptyQualityRecord(() => 0);
  const exitByQuality = emptyQualityRecord(() => ({ retain: 0, salvage: 0, sell: 0 }));
  const instances: Array<Pick<EquipmentInstance, 'instanceId' | 'templateId' | 'slot' | 'quality'>> = [];
  const resourceLedger: Partial<Record<ResourceId, number>> = {};
  let generatedCount = 0;
  let retained = 0;
  let salvaged = 0;
  let sold = 0;
  let inventory = request.inventoryCount;
  let draw = 0;
  const content = request.content;
  for (const [batchIndex, batch] of request.drops.entries()) {
    for (const quality of QUALITIES) {
      const count = batch.byQuality[quality] ?? 0;
      if (!Number.isSafeInteger(count) || count < 0) {
        diagnostic(diagnostics, `drops.${batchIndex}.byQuality.${quality}`, 'INVALID_VALUE', 'equipment drop count must be a non-negative safe integer');
        continue;
      }
      for (let index = 0; index < count; index += 1) {
        if (!content) {
          diagnostic(diagnostics, `drops.${batchIndex}.bindingMapId`, 'MISSING_CONTENT_BINDING', 'positive long-term equipment drops require a validated formal content package');
          draw += 2;
          continue;
        }
        const template = templateForDrop(content, batch, quality, request.seed, draw, parameters, diagnostics);
        if (!template) { draw += 2; continue; }
        const instance = writeEquipmentInstanceFromContent({ instanceId: `long-term-equipment.${request.seed >>> 0}.${generatedCount}`, configVersion: request.configVersion ?? content.manifest.config_version, seed: (request.seed + generatedCount) >>> 0, content, templateId: template.id, parameterSha256: content.manifest.parameter_sha256 }, parameters);
        generatedCount += 1;
        byQuality[quality] += 1;
        instances.push({ instanceId: instance.instanceId, templateId: instance.templateId, slot: instance.slot, quality: instance.quality });
        const decision: EquipmentExitDecision = decideEquipmentExit(parameters, quality, inventory >= request.inventoryCapacity);
        exitByQuality[quality][decision] += 1;
        if (decision === 'retain') { retained += 1; inventory += 1; }
        else if (decision === 'salvage') salvaged += 1;
        else sold += 1;
        for (const [id, amount] of Object.entries(equipmentExitResourceDelta(parameters, quality, decision)) as [ResourceId, number][]) add(resourceLedger, id, amount);
        draw += 2;
      }
    }
  }
  const promotionStatus = request.autoPromotion?.enabled ? (diagnostics.length > 0 ? 'blocked' : 'planned') : 'not_requested';
  const resourceCost = promotionStatus === 'planned' ? promotionLedger(parameters, promotionRequests, resourceLedger) : {};
  if (promotionStatus === 'planned' && request.autoPromotion?.availableResources) {
    for (const [id, amount] of Object.entries(resourceCost) as [ResourceId, number][]) {
      if ((request.autoPromotion.availableResources[id] ?? 0) < amount) diagnostic(diagnostics, `autoPromotion.availableResources.${id}`, 'INSUFFICIENT_RESOURCE', `insufficient ${id} for automatic promotion`);
    }
  }
  if (diagnostics.length > 0) throw new LongTermEquipmentConsumptionError(diagnostics);
  return { mode: 'read_only_equipment_consumption_v1', inventory: { before: request.inventoryCount, after: inventory, capacity: request.inventoryCapacity, overflow: Math.max(0, inventory - request.inventoryCapacity) }, generated: { count: generatedCount, byQuality, instances }, exits: { retained, salvaged, sold, byQuality: exitByQuality }, resourceLedger, promotion: { status: promotionStatus, requests: promotionRequests, resourceCost }, diagnostics: [] };
};

export const simulateLongTermEquipmentConsumption = planLongTermEquipmentConsumption;
