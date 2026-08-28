import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { FROZEN_PARAMETER_SHA256, FROZEN_PARAMETERS } from '../game/frozen-parameters.ts';
import { ApiError, CONFIG_VERSION } from '../server/types.ts';

export type ContentAsset = { id: string; kind: 'equipment_icon'; status: 'placeholder_v1' | 'released'; source: string; sha256: string };
export type ContentManifest = {
  config_version: string;
  parameter_sha256: string;
  schema_version: string;
  status: string;
  content_files: string[];
  content_sha256: string;
  asset_manifest?: ContentAsset[];
  name_pool_ids?: string[];
  appearance_tag_ids?: string[];
  stat_template_ids?: string[];
};
export type ContentObjectStatus = 'content_spec_v1' | 'content_pending' | 'released';
/**
 * A map may not claim to emit an equipment drop unless the content package
 * binds that drop to concrete equipment templates.  The current frozen
 * package intentionally omits this field; the server treats a hit on the
 * configured equipment chance as CONTENT_LOCKED until it is frozen.
 */
export type MapEquipmentDropBinding = { template_ids: string[] };
export type MapContent = { id: string; type: 'map'; display_name: string; unlock_realm_id: string; target_kill_time_parameter: string; reward_parameters: Record<string, string>; equipment_drop?: MapEquipmentDropBinding; status?: ContentObjectStatus };
export type EquipmentTemplate = {
  id: string;
  display_name: string;
  name_pool_id?: string;
  icon_asset_id?: string;
  appearance_tag_ids?: string[];
  stat_template_id?: string;
  source_map_ids?: string[];
  slot: 'weapon' | 'armor_1' | 'armor_2' | 'armor_3' | 'armor_4' | 'accessory';
  quality: string;
  quality_parameter: string;
  reinforcement: Record<string, string>;
  status?: ContentObjectStatus;
};
export type RecipeContent = { id: string; building_id: 'alchemy_room' | 'forge_room'; interval_parameter: string; output_resource: string; output_parameter: string; input_parameters: Record<string, string>; status?: ContentObjectStatus };
export type ContentPackage = { manifest: ContentManifest; maps: MapContent[]; equipment: EquipmentTemplate[]; recipes: RecipeContent[] };
export type ContentParameterMap = Record<string, { value: unknown; [key: string]: unknown }>;
export type MapEquipmentReadinessDiagnostic = { path: string; code: string; message: string };
export type ContentReachabilityDiagnostic = { path: string; code: 'CONTENT_PENDING'; message: string };

const readJson = <T>(name: string): T => JSON.parse(readFileSync(new URL(`./${name}`, import.meta.url), 'utf8')) as T;
const SHA256_PATTERN = /^[0-9a-f]{64}$/i;
const canonicalRecord = (value: Record<string, unknown>, preferredKeys: readonly string[]): Record<string, unknown> => {
  const preferred = preferredKeys.filter((key) => Object.prototype.hasOwnProperty.call(value, key));
  const remaining = Object.keys(value).filter((key) => !preferredKeys.includes(key)).sort();
  return Object.fromEntries([...preferred, ...remaining].map((key) => [key, canonicalValue(value[key])]));
};
const canonicalValue = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (value && typeof value === 'object') return canonicalRecord(value as Record<string, unknown>, []);
  return value;
};
const canonicalMap = (map: MapContent): Record<string, unknown> => {
  const result = canonicalRecord(map as unknown as Record<string, unknown>, ['id', 'type', 'display_name', 'unlock_realm_id', 'target_kill_time_parameter', 'reward_parameters']);
  result.reward_parameters = canonicalRecord(map.reward_parameters, ['spirit_stone_per_kill', 'spirit_ore_per_kill', 'spirit_wood_per_kill', 'ancient_scroll_drop_chance', 'ancient_scroll_pity_kills']);
  return result;
};
const canonicalEquipment = (item: EquipmentTemplate): Record<string, unknown> => {
  const result = canonicalRecord(item as unknown as Record<string, unknown>, ['id', 'display_name', 'name_pool_id', 'icon_asset_id', 'appearance_tag_ids', 'stat_template_id', 'source_map_ids', 'slot', 'quality', 'quality_parameter', 'reinforcement']);
  result.reinforcement = canonicalRecord(item.reinforcement, ['max_level_parameter', 'stat_multiplier_parameter', 'spirit_stone_base_parameter', 'spirit_stone_growth_parameter', 'spirit_ore_base_parameter', 'spirit_wood_base_parameter', 'material_growth_parameter']);
  return result;
};
const canonicalRecipe = (recipe: RecipeContent): Record<string, unknown> => {
  const result = canonicalRecord(recipe as unknown as Record<string, unknown>, ['id', 'building_id', 'interval_parameter', 'output_resource', 'output_parameter', 'input_parameters']);
  const varietyPill = /^pill_(zi_yun|ning_lu|huang_long|chi_yan)$/.test(recipe.id);
  const inputOrder = recipe.id === 'alchemy_basic' ? ['spirit_herb', 'spirit_stone'] : recipe.id === 'forge_basic' ? ['spirit_ore', 'spirit_wood', 'spirit_stone'] : varietyPill ? ['spirit_herb', 'spirit_stone'] : [];
  result.input_parameters = canonicalRecord(recipe.input_parameters, inputOrder);
  return result;
};
export const canonicalizeContent = (maps: MapContent[], equipment: EquipmentTemplate[], recipes: RecipeContent[]): { maps: Record<string, unknown>[]; equipment: Record<string, unknown>[]; recipes: Record<string, unknown>[] } => ({
  maps: maps.map(canonicalMap),
  equipment: equipment.map(canonicalEquipment),
  recipes: recipes.map(canonicalRecipe),
});
export const hashContent = (maps: MapContent[], equipment: EquipmentTemplate[], recipes: RecipeContent[]): string => createHash('sha256').update(JSON.stringify(canonicalizeContent(maps, equipment, recipes))).digest('hex');
const fail = (message: string, details?: unknown): never => { throw new ApiError('VALIDATION_FAILED', message, details); };
const requireObject = (value: unknown, label: string): Record<string, unknown> => { if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${label} must be an object`); return value as Record<string, unknown>; };
const requireText = (value: unknown, label: string): string => { if (typeof value !== 'string' || value.length === 0) { fail(`${label} must be a non-empty string`); } return value as string; };
const requireParameter = (id: string, label: string): void => { if (!(id in FROZEN_PARAMETERS)) fail(`${label} references unknown parameter ${id}`); };
const unique = (items: string[], label: string): void => { if (new Set(items).size !== items.length) fail(`${label} contains duplicate ids`); };
const requireContentStatus = (status: unknown, label: string): void => { if (status !== undefined && !['content_spec_v1', 'content_pending', 'released'].includes(status as string)) fail(`${label}.status is invalid`); };
export const isContentPending = (value: { status?: ContentObjectStatus } | null | undefined): boolean => value?.status === 'content_pending';

/**
 * A pending object may remain in a content package as a design placeholder,
 * but it must not be reachable from an active runtime route.  Keep this
 * separate from the base schema so the boot-compatible frozen package can
 * still carry unbound future content.
 */
export const diagnoseContentReachability = (content: ContentPackage): ContentReachabilityDiagnostic[] => {
  const diagnostics: ContentReachabilityDiagnostic[] = [];
  for (const map of content.maps) if (isContentPending(map)) diagnostics.push({ path: `maps.${map.id}.status`, code: 'CONTENT_PENDING', message: 'pending maps cannot be exposed as playable actions' });
  for (const recipe of content.recipes) if (isContentPending(recipe)) diagnostics.push({ path: `recipes.${recipe.id}.status`, code: 'CONTENT_PENDING', message: 'pending recipes cannot be queued for production' });
  const boundTemplateIds = new Set(content.maps.flatMap((map) => map.equipment_drop?.template_ids ?? []));
  for (const template of content.equipment) if (boundTemplateIds.has(template.id) && isContentPending(template)) diagnostics.push({ path: `equipment.${template.id}.status`, code: 'CONTENT_PENDING', message: 'pending equipment templates cannot be used by a map drop binding' });
  return diagnostics;
};

/**
 * Diagnose whether the ordinary-map equipment contract is publishable.  This
 * is intentionally separate from validateContentPackage: the frozen MVP
 * package is allowed to boot while ordinary-map equipment remains locked, but
 * a release operator must have an explicit gate that proves all positive
 * weights have concrete templates before enabling the writer.
 */
export const diagnoseMapEquipmentReleaseReadiness = (content: ContentPackage, parameters: ContentParameterMap): MapEquipmentReadinessDiagnostic[] => {
  const diagnostics: MapEquipmentReadinessDiagnostic[] = [];
  const requiredMaps = ['bai_cao_valley', 'black_wind_valley', 'red_flame_cave'];
  const mapById = new Map(content.maps.map((map) => [map.id, map]));
  const equipmentById = new Map(content.equipment.map((item) => [item.id, item]));
  const qualities = ['normal', 'fine', 'rare', 'epic', 'legendary', 'immortal'] as const;
  const mapChance = (mapId: string): number => Number(parameters[`map.${mapId}.equipment_drop_chance`]?.value);
  for (const mapId of requiredMaps) {
    const map = mapById.get(mapId);
    if (!map) {
      diagnostics.push({ path: `maps.${mapId}`, code: 'MISSING_MAP', message: 'ordinary-map equipment release requires all three launch maps' });
      continue;
    }
    if (isContentPending(map)) diagnostics.push({ path: `maps.${map.id}.status`, code: 'CONTENT_PENDING', message: 'pending maps cannot publish ordinary-map equipment' });
    const chanceKey = `map.${mapId}.equipment_drop_chance`;
    if (!parameters[chanceKey]) diagnostics.push({ path: chanceKey, code: 'MISSING_PARAMETER', message: 'equipment drop probability is required when publishing ordinary-map equipment' });
    const chance = mapChance(mapId);
    if (!Number.isFinite(chance) || chance < 0 || chance > 100) {
      diagnostics.push({ path: chanceKey, code: 'INVALID_VALUE', message: 'equipment drop probability must be a finite number between 0 and 100' });
    }
    if (!(chance > 0)) continue;
    const binding = map.equipment_drop;
    const templateIds = binding?.template_ids;
    if (!Array.isArray(templateIds) || templateIds.length === 0) {
      diagnostics.push({ path: `map.${mapId}.equipment_drop`, code: 'MISSING_CONTENT_BINDING', message: 'positive equipment drop probability requires concrete equipment template binding' });
      continue;
    }
    const boundQualities = new Set<string>();
    const boundSlots = new Set<'weapon' | 'armor' | 'accessory'>();
    const boundActualSlots = new Set<EquipmentTemplate['slot']>();
    for (const templateId of templateIds) {
      const template = equipmentById.get(templateId);
      if (!template) {
        diagnostics.push({ path: `map.${mapId}.equipment_drop.template_ids`, code: 'UNKNOWN_TEMPLATE', message: `equipment template ${templateId} is not present in the content package` });
        continue;
      }
      if (isContentPending(template)) {
        diagnostics.push({ path: `equipment.${template.id}.status`, code: 'CONTENT_PENDING', message: 'pending equipment templates cannot be used by a map drop binding' });
        continue;
      }
      boundQualities.add(template.quality);
      boundActualSlots.add(template.slot);
      boundSlots.add(template.slot === 'weapon' ? 'weapon' : template.slot === 'accessory' ? 'accessory' : 'armor');
    }
    let qualityTotal = 0;
    for (const quality of qualities) {
      const key = `map.${mapId}.equipment_quality_${quality}_chance`;
      if (!parameters[key]) {
        diagnostics.push({ path: key, code: 'MISSING_PARAMETER', message: 'equipment quality probability is required when publishing ordinary-map equipment' });
        continue;
      }
      const value = Number(parameters[key]?.value);
      if (!Number.isFinite(value) || value < 0) {
        diagnostics.push({ path: key, code: 'INVALID_VALUE', message: 'equipment quality probability must be a finite non-negative number' });
      } else if (value > 0 && !boundQualities.has(quality)) {
        qualityTotal += value;
        diagnostics.push({ path: `map.${mapId}.equipment_drop.template_ids`, code: 'MISSING_TEMPLATE_FOR_QUALITY', message: `equipment quality ${quality} has positive drop weight but no bound template` });
      } else if (value > 0) {
        qualityTotal += value;
      }
    }
    if (qualityTotal <= 0) diagnostics.push({ path: `map.${mapId}.equipment_quality_chance`, code: 'INVALID_VALUE', message: 'equipment quality probability pool must have positive total weight' });
    for (const category of ['weapon', 'armor', 'accessory'] as const) {
      const key = `loot.equipment.drop_slot_weight.${category}`;
      const weight = Number(parameters[key]?.value);
      if (!Number.isFinite(weight) || weight < 0) diagnostics.push({ path: key, code: 'INVALID_VALUE', message: 'equipment slot weight must be a finite non-negative number' });
      else if (weight > 0 && !boundSlots.has(category)) diagnostics.push({ path: `map.${mapId}.equipment_drop.template_ids`, code: 'MISSING_TEMPLATE_FOR_SLOT_CATEGORY', message: `equipment slot category ${category} has positive drop weight but no bound template` });
    }
    for (const slot of ['weapon', 'armor_1', 'armor_2', 'armor_3', 'armor_4', 'accessory'] as const) {
      if (!boundActualSlots.has(slot)) diagnostics.push({ path: `map.${mapId}.equipment_drop.template_ids`, code: 'MISSING_TEMPLATE_FOR_SLOT', message: `equipment slot ${slot} has no bound template; all six launch slots are required before release` });
    }
  }
  if (parameters['schedule.equipment.exit_policy']?.value !== 'retain_rare') diagnostics.push({ path: 'schedule.equipment.exit_policy', code: 'UNSUPPORTED_POLICY', message: 'ordinary map equipment requires the frozen retain_rare exit policy' });
  for (const quality of ['normal', 'fine'] as const) if (Number(parameters[`loot.equipment.auto_salvage.${quality}_enabled`]?.value) !== 1) diagnostics.push({ path: `loot.equipment.auto_salvage.${quality}_enabled`, code: 'UNSUPPORTED_POLICY', message: `${quality} equipment must have auto salvage enabled for retain_rare` });
  for (const quality of ['rare', 'epic', 'legendary', 'immortal'] as const) if (Number(parameters[`loot.equipment.auto_salvage.${quality}_enabled`]?.value) !== 0) diagnostics.push({ path: `loot.equipment.auto_salvage.${quality}_enabled`, code: 'UNSUPPORTED_POLICY', message: `${quality} equipment must not be auto salvaged for retain_rare` });
  return diagnostics;
};

export function validateContentPackage(content: ContentPackage, expectedConfigVersion = CONFIG_VERSION, expectedParameterSha256 = FROZEN_PARAMETER_SHA256): ContentPackage {
  const manifest = requireObject(content.manifest, 'manifest') as unknown as ContentManifest;
  if (manifest.config_version !== expectedConfigVersion || !SHA256_PATTERN.test(manifest.parameter_sha256) || manifest.parameter_sha256 !== expectedParameterSha256) throw new ApiError('CONFIG_VERSION_MISMATCH', 'content package config version or parameter hash does not match runtime', { expectedConfigVersion, actualConfigVersion: manifest.config_version, expectedParameterSha256, actualParameterSha256: manifest.parameter_sha256 });
  if (!['1.0', '1.1'].includes(manifest.schema_version) || manifest.status !== 'frozen_v1') fail('unsupported content manifest schema or status');
  const expectedContentFiles = ['maps.json', 'equipment.json', 'recipes.json'];
  if (!Array.isArray(manifest.content_files) || manifest.content_files.length !== expectedContentFiles.length || new Set(manifest.content_files).size !== manifest.content_files.length || expectedContentFiles.some((file) => !manifest.content_files.includes(file))) fail('content manifest file list does not match the loaded content collections');
  const maps = content.maps;
  const equipment = content.equipment;
  const recipes = content.recipes;
  if (!Array.isArray(maps) || !Array.isArray(equipment) || !Array.isArray(recipes)) fail('content collections must be arrays');
  const hasFormalEquipmentFields = equipment.some((item) => item.name_pool_id !== undefined || item.icon_asset_id !== undefined || item.appearance_tag_ids !== undefined || item.stat_template_id !== undefined || item.source_map_ids !== undefined);
  if (hasFormalEquipmentFields && (!Array.isArray(manifest.asset_manifest) || !Array.isArray(manifest.name_pool_ids) || !Array.isArray(manifest.appearance_tag_ids) || !Array.isArray(manifest.stat_template_ids))) fail('formal equipment fields require content manifest registries');
  const assets = new Map<string, ContentAsset>();
  for (const asset of manifest.asset_manifest ?? []) {
    requireText(asset?.id, 'manifest.asset_manifest.id');
    if (asset.kind !== 'equipment_icon' || !['placeholder_v1', 'released'].includes(asset.status)) fail(`manifest asset ${asset.id} has invalid kind or status`);
    requireText(asset.source, `manifest asset ${asset.id}.source`);
    if (!SHA256_PATTERN.test(asset.sha256)) fail(`manifest asset ${asset.id}.sha256 must be a SHA-256 value`);
    if (assets.has(asset.id)) fail(`manifest.asset_manifest contains duplicate id ${asset.id}`);
    assets.set(asset.id, asset);
  }
  unique((manifest.name_pool_ids ?? []).map((id) => requireText(id, 'manifest.name_pool_ids')), 'manifest.name_pool_ids');
  unique((manifest.appearance_tag_ids ?? []).map((id) => requireText(id, 'manifest.appearance_tag_ids')), 'manifest.appearance_tag_ids');
  unique((manifest.stat_template_ids ?? []).map((id) => requireText(id, 'manifest.stat_template_ids')), 'manifest.stat_template_ids');
  unique(maps.map((item) => requireText(item?.id, 'map.id')), 'maps');
  unique(equipment.map((item) => requireText(item?.id, 'equipment.id')), 'equipment');
  unique(recipes.map((item) => requireText(item?.id, 'recipe.id')), 'recipes');
  for (const map of maps) {
    requireContentStatus(map.status, `map ${map.id}`);
    requireText(map.display_name, `map ${map.id}.display_name`);
    if (map.type !== 'map') fail(`map ${map.id}.type must be map`);
    requireParameter(map.target_kill_time_parameter, `map ${map.id}.target_kill_time_parameter`);
    for (const [key, parameter] of Object.entries(requireObject(map.reward_parameters, `map ${map.id}.reward_parameters`))) requireParameter(requireText(parameter, `map ${map.id}.reward_parameters.${key}`), `map ${map.id}.reward_parameters.${key}`);
    if (map.equipment_drop !== undefined) {
      const binding = requireObject(map.equipment_drop, `map ${map.id}.equipment_drop`) as unknown as MapEquipmentDropBinding;
      if (!Array.isArray(binding.template_ids) || binding.template_ids.length === 0) fail(`map ${map.id}.equipment_drop.template_ids must contain at least one template`);
      unique(binding.template_ids.map((id) => requireText(id, `map ${map.id}.equipment_drop.template_ids`)), `map ${map.id}.equipment_drop.template_ids`);
      for (const templateId of binding.template_ids) if (!equipment.some((item) => item.id === templateId)) fail(`map ${map.id}.equipment_drop references unknown equipment template ${templateId}`);
    }
  }
  const slots = new Set(['weapon', 'armor_1', 'armor_2', 'armor_3', 'armor_4', 'accessory']);
  const qualities = new Set(['normal', 'fine', 'rare', 'epic', 'legendary', 'immortal']);
  for (const item of equipment) {
    requireContentStatus(item.status, `equipment ${item.id}`);
    requireText(item.display_name, `equipment ${item.id}.display_name`);
    if (hasFormalEquipmentFields) {
      requireText(item.name_pool_id, `equipment ${item.id}.name_pool_id`);
      if (!manifest.name_pool_ids?.includes(item.name_pool_id as string)) fail(`equipment ${item.id}.name_pool_id is not registered`);
      requireText(item.icon_asset_id, `equipment ${item.id}.icon_asset_id`);
      const icon = assets.get(item.icon_asset_id as string);
      if (!icon || icon.kind !== 'equipment_icon') fail(`equipment ${item.id}.icon_asset_id is not registered in asset manifest`);
      const registeredIcon = icon as ContentAsset;
      if (registeredIcon.status === 'placeholder_v1' && item.status === 'content_pending') fail(`equipment ${item.id} cannot be pending when its binding is formal`);
      if (!Array.isArray(item.appearance_tag_ids) || item.appearance_tag_ids.length === 0) fail(`equipment ${item.id}.appearance_tag_ids must be non-empty`);
      const appearanceTagIds = item.appearance_tag_ids as string[];
      unique(appearanceTagIds.map((id) => requireText(id, `equipment ${item.id}.appearance_tag_ids`)), `equipment ${item.id}.appearance_tag_ids`);
      for (const tag of appearanceTagIds) if (!manifest.appearance_tag_ids?.includes(tag)) fail(`equipment ${item.id}.appearance_tag_ids references an unregistered tag`);
      requireText(item.stat_template_id, `equipment ${item.id}.stat_template_id`);
      if (!manifest.stat_template_ids?.includes(item.stat_template_id as string)) fail(`equipment ${item.id}.stat_template_id is not registered`);
      if (!Array.isArray(item.source_map_ids) || item.source_map_ids.length === 0) fail(`equipment ${item.id}.source_map_ids must be non-empty`);
      const sourceMapIds = item.source_map_ids as string[];
      unique(sourceMapIds.map((id) => requireText(id, `equipment ${item.id}.source_map_ids`)), `equipment ${item.id}.source_map_ids`);
    }
    if (!slots.has(item.slot)) fail(`equipment ${item.id}.slot is invalid`);
    if (!qualities.has(item.quality)) fail(`equipment ${item.id}.quality is invalid`);
    requireParameter(item.quality_parameter, `equipment ${item.id}.quality_parameter`);
    for (const [key, parameter] of Object.entries(requireObject(item.reinforcement, `equipment ${item.id}.reinforcement`))) requireParameter(requireText(parameter, `equipment ${item.id}.reinforcement.${key}`), `equipment ${item.id}.reinforcement.${key}`);
  }
  for (const recipe of recipes) {
    requireContentStatus(recipe.status, `recipe ${recipe.id}`);
    if (recipe.building_id !== 'alchemy_room' && recipe.building_id !== 'forge_room') fail(`recipe ${recipe.id}.building_id is invalid`);
    requireParameter(recipe.interval_parameter, `recipe ${recipe.id}.interval_parameter`);
    requireParameter(recipe.output_parameter, `recipe ${recipe.id}.output_parameter`);
    for (const [resource, parameter] of Object.entries(requireObject(recipe.input_parameters, `recipe ${recipe.id}.input_parameters`))) { requireText(resource, `recipe ${recipe.id}.input resource`); requireParameter(requireText(parameter, `recipe ${recipe.id}.input_parameters.${resource}`), `recipe ${recipe.id}.input_parameters.${resource}`); }
  }
  if (manifest.content_sha256 !== hashContent(maps, equipment, recipes)) fail('content package hash does not match manifest');
  return content;
}

export const loadContentPackage = (expectedConfigVersion = CONFIG_VERSION): ContentPackage => validateContentPackage({ manifest: readJson<ContentManifest>('manifest.json'), maps: readJson<MapContent[]>('maps.json'), equipment: readJson<EquipmentTemplate[]>('equipment.json'), recipes: readJson<RecipeContent[]>('recipes.json') }, expectedConfigVersion);
export const CONTENT_PACKAGE = loadContentPackage();
export const CONTENT_HASH = CONTENT_PACKAGE.manifest.content_sha256;
