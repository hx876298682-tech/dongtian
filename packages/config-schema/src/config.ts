import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { z } from 'zod';

const StableIdSchema = z.string().regex(/^[a-z0-9_]+(?:\.[a-z0-9_]+)+$/);
const NonNegativeDecimalStringSchema = z.string().regex(/^(?:0|[1-9]\d*)(?:\.\d+)?$/);
const PositiveIntegerStringSchema = z.string().regex(/^[1-9]\d*$/);
const ScopeSchema = z.enum(['MVP', 'MVP_ENDGAME', 'ANCHOR']);

const CommonContentShape = {
  id: StableIdSchema,
  name_key: z.string().min(1),
  description_key: z.string().min(1).optional(),
  enabled: z.boolean(),
  deprecated: z.boolean(),
  realm_required: StableIdSchema,
  feature_flag: StableIdSchema.nullable().optional(),
  sort_order: z.number().int().nonnegative(),
  tags: z.array(z.string().min(1)),
  source_note: z.string().min(1),
} as const;

const EquipmentSlotSchema = z.enum(['WEAPON', 'ARMOR', 'ACCESSORY', 'TOOL']);
const EquipmentRequirementSchema = z.object({
  required_realm: StableIdSchema.nullable(),
  required_tags: z.array(z.string().min(1)),
});
const ToolEffectSchema = z.object({
  skill_id: StableIdSchema,
  action_speed_bonus: NonNegativeDecimalStringSchema,
  action_efficiency_bonus: NonNegativeDecimalStringSchema,
});
const DungeonRouteRiskSchema = z.enum(['SAFE', 'HIGH_RISK']);
const DungeonNodeTypeSchema = z.enum(['PREPARE', 'ENTRY', 'CHOICE', 'BATTLE', 'REWARD']);
const DungeonAutoResolvePolicySchema = z.enum(['NONE', 'DEFAULT_SAFE_ROUTE', 'TIMEOUT_SAFE_ROUTE']);
const LootTableEntrySchema = z.object({
  item_id: StableIdSchema,
  min_qty: PositiveIntegerStringSchema,
  max_qty: PositiveIntegerStringSchema.optional(),
  probability: z.string().regex(/^(?:0(?:\.\d+)?|1(?:\.0+)?)$/),
  rolls: z.number().int().positive(),
  pity_group: z.string().min(1).optional(),
});
const DungeonMonsterCombatSchema = z.object({
  hp: NonNegativeDecimalStringSchema,
  attack: NonNegativeDecimalStringSchema,
  defense: NonNegativeDecimalStringSchema,
  attack_interval_seconds: NonNegativeDecimalStringSchema,
  skill_script_id: StableIdSchema,
  recommended_power: NonNegativeDecimalStringSchema,
  base_battle_duration_us: PositiveIntegerStringSchema,
  spirit_stone: NonNegativeDecimalStringSchema,
  loot_table_id: StableIdSchema,
});
const DungeonNodeSchema = z.object({
  id: StableIdSchema,
  type: DungeonNodeTypeSchema,
  monster_ids: z.array(StableIdSchema),
  choice_ids: z.array(StableIdSchema),
  next_node_ids: z.array(StableIdSchema),
  auto_resolve_policy: DungeonAutoResolvePolicySchema.optional(),
});
const DungeonChoiceSchema = z.object({
  id: StableIdSchema,
  route_id: StableIdSchema,
  risk: DungeonRouteRiskSchema,
  label_key: z.string().min(1),
  monster_id: StableIdSchema,
  success_reward_table_id: StableIdSchema,
  failure_reward_table_id: StableIdSchema,
  max_events: z.number().int().positive().optional(),
  max_rounds: z.number().int().positive().optional(),
});
const DungeonSuccessModelSchema = z.object({
  base_success_rate: NonNegativeDecimalStringSchema,
  recommended_power: NonNegativeDecimalStringSchema,
  power_elasticity: NonNegativeDecimalStringSchema,
  min_success_rate: z.string().regex(/^(?:0(?:\.\d+)?|1(?:\.0+)?)$/),
  max_success_rate: z.string().regex(/^(?:0(?:\.\d+)?|1(?:\.0+)?)$/),
});

const RegionKindSchema = z.enum(['FOOTHILL', 'SLOPE', 'SPRING', 'PASS', 'MINE', 'VALLEY']);
const CaveFacilityKindSchema = z.enum(['JULING_ROOM', 'ALCHEMY_ROOM', 'FORGING_ROOM']);
const CaveFacilityEffectTypeSchema = z.enum(['cultivation_efficiency', 'alchemy_efficiency', 'forging_efficiency']);
const MaterialCostSchema = z.object({
  item_id: StableIdSchema,
  quantity: PositiveIntegerStringSchema,
});

export const ManifestSchema = z.object({
  config_version: z.string().regex(/^\d{4}\.\d{2}\.\d+\.\d+$/),
  schema_version: z.number().int().positive(),
  formula_version: z.number().int().positive(),
  created_at: z.string().datetime({ offset: true }),
  min_client_version: z.string().regex(/^\d+\.\d+\.\d+$/),
  content_hash: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  previous_version: z.string().regex(/^\d{4}\.\d{2}\.\d+\.\d+$/).nullable(),
});

export const RealmConfigSchema = z.object({
  ...CommonContentShape,
  realm_group: z.enum(['MORTAL', 'QI', 'FOUNDATION', 'CORE_ANCHOR']),
  stage_order: z.number().int().nonnegative(),
  cultivation_xp_start: NonNegativeDecimalStringSchema,
  cultivation_xp_required: PositiveIntegerStringSchema,
  queue_slots: z.number().int().min(1).max(3),
  medicine_slots: z.number().int().min(1).max(3),
  offline_cap_seconds: z.number().int().positive(),
  unlock_bundle_id: StableIdSchema,
  scope: ScopeSchema,
});

const ItemCategorySchema = z.enum(['HERB', 'ORE', 'WOOD', 'MONSTER', 'PILL', 'EQUIPMENT', 'MATERIAL']);
const ItemRaritySchema = z.enum(['COMMON', 'UNCOMMON', 'RARE', 'EPIC']);
const ItemQuantitySchema = z.string().regex(/^[1-9]\d*$/);

export const ItemConfigSchema = z.object({
  ...CommonContentShape,
  category: ItemCategorySchema,
  tier: z.number().int().positive(),
  stackable: z.boolean(),
  max_stack: ItemQuantitySchema,
  trade_policy: z.literal('NONE'),
  rarity: ItemRaritySchema,
  overflow_policy: z.enum(['MATERIAL_STACK', 'TEMP_STORAGE']),
});

export const EquipmentConfigSchema = z.object({
  item_id: StableIdSchema,
  slot: EquipmentSlotSchema,
  attack: z.number().int().nonnegative(),
  defense: z.number().int().nonnegative(),
  hp: z.number().int().nonnegative(),
  speed: z.number(),
  power_index: z.number().int().nonnegative(),
  equip_requirements: EquipmentRequirementSchema,
  modifier_ids: z.array(z.string().min(1)),
  temperable: z.boolean(),
  max_temper_level: z.number().int().nonnegative(),
  tool_effects: z.array(ToolEffectSchema).optional(),
});

const ItemQuantityPairSchema = z.object({
  item_id: StableIdSchema,
  quantity: ItemQuantitySchema,
});

const BuffModifierSchema = z.object({
  stat: z.string().min(1),
  operation: z.enum(['ADD', 'MULTIPLY']),
  value: NonNegativeDecimalStringSchema,
  tags: z.array(z.string().min(1)),
});

export const BuffConfigSchema = z.object({
  ...CommonContentShape,
  source_item_id: StableIdSchema,
  duration_seconds: z.number().int().nonnegative(),
  slot_cost: z.number().int().positive(),
  stack_group: z.string().min(1),
  stack_rule: z.enum(['REPLACE', 'STACK']),
  modifiers: z.array(BuffModifierSchema),
  applicable_tags: z.array(z.string().min(1)),
});

export const LootTableConfigSchema = z.object({
  ...CommonContentShape,
  entries: z.array(LootTableEntrySchema),
  cultivation_xp: NonNegativeDecimalStringSchema,
  scope: ScopeSchema,
});

export const MonsterConfigSchema = z.object({
  ...CommonContentShape,
  combat: DungeonMonsterCombatSchema,
  scope: ScopeSchema,
});

export const DungeonConfigSchema = z.object({
  ...CommonContentShape,
  opportunity_cost: z.number().int().positive(),
  entry_items: z.array(z.object({
    item_id: StableIdSchema,
    quantity: PositiveIntegerStringSchema,
  })),
  recommended_power: NonNegativeDecimalStringSchema,
  base_success_model: DungeonSuccessModelSchema,
  choice_timeout_seconds: z.number().int().positive(),
  default_safe_choice_id: StableIdSchema,
  prepare_node_id: StableIdSchema,
  entry_node_id: StableIdSchema,
  choice_node_id: StableIdSchema,
  battle_node_id: StableIdSchema,
  reward_node_id: StableIdSchema,
  nodes: z.array(DungeonNodeSchema).min(1),
  choices: z.array(DungeonChoiceSchema).min(1),
  reward_table_id: StableIdSchema,
  failure_reward_table_id: StableIdSchema,
  scope: ScopeSchema,
});

export const RegionConfigSchema = z.object({
  ...CommonContentShape,
  region_kind: RegionKindSchema,
  stage_label: z.string().min(1),
  resource_item_ids: z.array(StableIdSchema).min(1),
  action_ids: z.array(StableIdSchema).min(1),
  monster_ids: z.array(StableIdSchema).min(1),
  dungeon_ids: z.array(StableIdSchema),
  recommended_goal: z.string().min(1),
  scope: ScopeSchema,
});

export const CaveFacilityConfigSchema = z.object({
  id: StableIdSchema,
  facility_id: StableIdSchema,
  name_key: z.string().min(1),
  description_key: z.string().min(1),
  enabled: z.boolean(),
  deprecated: z.boolean(),
  realm_required: StableIdSchema,
  feature_flag: StableIdSchema.nullable().optional(),
  sort_order: z.number().int().nonnegative(),
  tags: z.array(z.string().min(1)),
  source_note: z.string().min(1),
  level: z.number().int().positive(),
  facility_kind: CaveFacilityKindSchema,
  spirit_stone_cost: PositiveIntegerStringSchema,
  material_costs: z.array(MaterialCostSchema),
  build_duration_us: PositiveIntegerStringSchema,
  effect_type: CaveFacilityEffectTypeSchema,
  effect_value: NonNegativeDecimalStringSchema,
  scope: ScopeSchema,
});

export const ActionConfigSchema = z.object({
  ...CommonContentShape,
  skill_id: StableIdSchema.nullable(),
  base_duration_us: PositiveIntegerStringSchema,
  inputs: z.array(ItemQuantityPairSchema),
  outputs: z.array(ItemQuantityPairSchema),
  skill_xp: NonNegativeDecimalStringSchema,
  cultivation_xp: NonNegativeDecimalStringSchema,
  loot_table_id: StableIdSchema.nullable().optional(),
  allowed_queue_modes: z.array(z.enum(['COUNT', 'DURATION', 'INFINITE'])).min(1),
  required_tool_tag: z.string().min(1).nullable().optional(),
  modifier_tags: z.array(z.string().min(1)),
  scope: ScopeSchema,
});

export const RecipeConfigSchema = z.object({
  ...CommonContentShape,
  craft_skill_id: StableIdSchema,
  action_config_id: StableIdSchema,
  result_item_id: StableIdSchema,
  result_quantity: ItemQuantitySchema,
  ingredients: z.array(ItemQuantityPairSchema).min(1),
  base_duration_us: PositiveIntegerStringSchema,
  skill_xp: NonNegativeDecimalStringSchema,
  required_level: z.number().int().positive(),
  required_facility_id: StableIdSchema.nullable().optional(),
  scope: ScopeSchema,
});

export const FeatureUnlockConfigSchema = z.object({
  feature_id: StableIdSchema,
  enabled: z.boolean(),
  visible_stage: StableIdSchema,
  usable_stage: StableIdSchema,
  mastery_stage: StableIdSchema,
  required_tutorial_ids: z.array(z.string().regex(/^TUT-\d{3}$/)),
  required_skill_id: StableIdSchema.nullable(),
  required_skill_level: z.number().int().positive().nullable(),
  feature_flag: StableIdSchema.nullable(),
  locked_reason_key: z.string().min(1),
  source_note: z.string().min(1),
});

export const SkillConfigSchema = z.object({
  ...CommonContentShape,
  max_level: z.number().int().positive(),
  scope: ScopeSchema,
});

const SkillXpLevelSchema = z.object({
  level: z.number().int().positive(),
  xp_to_next: NonNegativeDecimalStringSchema,
  cumulative_xp: NonNegativeDecimalStringSchema,
  speed_modifier: NonNegativeDecimalStringSchema,
  efficiency_modifier: NonNegativeDecimalStringSchema,
  stage_node: z.boolean(),
});

export const SkillXpCurveSchema = z.object({
  curve_id: StableIdSchema,
  skill_id: StableIdSchema,
  levels: z.array(SkillXpLevelSchema).min(1),
  source_note: z.string().min(1),
});

export type Manifest = z.infer<typeof ManifestSchema>;
export type RealmConfig = z.infer<typeof RealmConfigSchema>;
export type ItemConfig = z.infer<typeof ItemConfigSchema>;
export type ActionConfig = z.infer<typeof ActionConfigSchema>;
export type RecipeConfig = z.infer<typeof RecipeConfigSchema>;
export type EquipmentConfig = z.infer<typeof EquipmentConfigSchema>;
export type FeatureUnlockConfig = z.infer<typeof FeatureUnlockConfigSchema>;
export type SkillConfig = z.infer<typeof SkillConfigSchema>;
export type SkillXpLevel = z.infer<typeof SkillXpLevelSchema>;
export type SkillXpCurve = z.infer<typeof SkillXpCurveSchema>;
export type BuffModifier = z.infer<typeof BuffModifierSchema>;
export type BuffConfig = z.infer<typeof BuffConfigSchema>;
export type ToolEffect = z.infer<typeof ToolEffectSchema>;
export type LootTableConfig = z.infer<typeof LootTableConfigSchema>;
export type MonsterConfig = z.infer<typeof MonsterConfigSchema>;
export type DungeonConfig = z.infer<typeof DungeonConfigSchema>;
export type RegionConfig = z.infer<typeof RegionConfigSchema>;
export type CaveFacilityConfig = z.infer<typeof CaveFacilityConfigSchema>;

const configFiles = [
  'realms.json',
  'feature_unlocks.json',
  'skills.json',
  'xp_curves.json',
  'items.json',
  'actions.json',
  'recipes.json',
  'equipment.json',
  'buffs.json',
  'loot_tables.json',
  'monsters.json',
  'dungeons.json',
  'regions.json',
  'cave_facilities.json',
] as const;

function readJson(filePath: string): unknown {
  return JSON.parse(readFileSync(filePath, 'utf8')) as unknown;
}

function indexById<T extends { readonly id: string }>(values: readonly T[], label: string): ReadonlyMap<string, T> {
  const result = new Map<string, T>();

  for (const value of values) {
    if (result.has(value.id)) {
      throw new Error(`CONFIG_DUPLICATE_ID:${label}:${value.id}`);
    }

    result.set(value.id, value);
  }

  return result;
}

function indexByField<T>(
  values: readonly T[],
  field: keyof T,
  label: string,
): ReadonlyMap<string, T> {
  const result = new Map<string, T>();

  for (const value of values) {
    const fieldValue = value[field];
    if (typeof fieldValue !== 'string') {
      throw new Error(`CONFIG_INVALID_INDEX_FIELD:${label}`);
    }
    if (result.has(fieldValue)) {
      throw new Error(`CONFIG_DUPLICATE_ID:${label}:${fieldValue}`);
    }
    result.set(fieldValue, value);
  }

  return result;
}

function assertReference(registry: ReadonlyMap<string, unknown>, reference: string, field: string): void {
  if (!registry.has(reference)) {
    throw new Error(`CONFIG_MISSING_REFERENCE:${field}:${reference}`);
  }
}

export function computeReleaseContentHash(releaseDir: string): string {
  const hash = createHash('sha256');

  for (const fileName of configFiles) {
    hash.update(fileName);
    hash.update('\0');
    hash.update(readFileSync(join(releaseDir, fileName)));
    hash.update('\0');
  }

  return `sha256:${hash.digest('hex')}`;
}

export type ConfigRelease = Readonly<{
  manifest: Manifest;
  realms: readonly RealmConfig[];
  featureUnlocks: readonly FeatureUnlockConfig[];
  skills: readonly SkillConfig[];
  xpCurves: readonly SkillXpCurve[];
  items: readonly ItemConfig[];
  actions: readonly ActionConfig[];
  recipes: readonly RecipeConfig[];
  equipments: readonly EquipmentConfig[];
  buffs: readonly BuffConfig[];
  lootTables: readonly LootTableConfig[];
  monsters: readonly MonsterConfig[];
  dungeons: readonly DungeonConfig[];
  regions: readonly RegionConfig[];
  caveFacilities: readonly CaveFacilityConfig[];
}>;

export class ConfigRegistry {
  private readonly realmById: ReadonlyMap<string, RealmConfig>;
  private readonly featureUnlockById: ReadonlyMap<string, FeatureUnlockConfig>;
  private readonly skillById: ReadonlyMap<string, SkillConfig>;
  private readonly xpCurveBySkillId: ReadonlyMap<string, SkillXpCurve>;
  private readonly itemById: ReadonlyMap<string, ItemConfig>;
  private readonly actionById: ReadonlyMap<string, ActionConfig>;
  private readonly recipeById: ReadonlyMap<string, RecipeConfig>;
  private readonly equipmentByItemId: ReadonlyMap<string, EquipmentConfig>;
  private readonly buffById: ReadonlyMap<string, BuffConfig>;
  private readonly buffBySourceItemId: ReadonlyMap<string, BuffConfig>;
  private readonly lootTableById: ReadonlyMap<string, LootTableConfig>;
  private readonly monsterById: ReadonlyMap<string, MonsterConfig>;
  private readonly dungeonById: ReadonlyMap<string, DungeonConfig>;
  private readonly regionById: ReadonlyMap<string, RegionConfig>;
  private readonly caveFacilityById: ReadonlyMap<string, CaveFacilityConfig>;

  public constructor(private readonly release: ConfigRelease) {
    this.realmById = indexById(release.realms, 'realm');
    this.featureUnlockById = indexByField(release.featureUnlocks, 'feature_id', 'feature');
    this.skillById = indexById(release.skills, 'skill');
    this.xpCurveBySkillId = indexByField(release.xpCurves, 'skill_id', 'skill_xp_curve');
    this.itemById = indexById(release.items, 'item');
    this.actionById = indexById(release.actions, 'action');
    this.recipeById = indexById(release.recipes, 'recipe');
    this.equipmentByItemId = indexByField(release.equipments, 'item_id', 'equipment');
    this.buffById = indexById(release.buffs, 'buff');
    this.buffBySourceItemId = indexByField(release.buffs, 'source_item_id', 'buff_source_item');
    this.lootTableById = indexById(release.lootTables, 'loot_table');
    this.monsterById = indexById(release.monsters, 'monster');
    this.dungeonById = indexById(release.dungeons, 'dungeon');
    this.regionById = indexById(release.regions, 'region');
    this.caveFacilityById = indexById(release.caveFacilities, 'cave_facility');
  }

  public get manifest(): Manifest {
    return this.release.manifest;
  }

  public getRealm(id: string): RealmConfig {
    return this.getRequired(this.realmById, id, 'realm');
  }

  public get realms(): readonly RealmConfig[] {
    return this.release.realms;
  }

  public getItem(id: string): ItemConfig {
    return this.getRequired(this.itemById, id, 'item');
  }

  public get items(): readonly ItemConfig[] {
    return this.release.items;
  }

  public getFeatureUnlock(id: string): FeatureUnlockConfig {
    return this.getRequired(this.featureUnlockById, id, 'feature');
  }

  public get features(): readonly FeatureUnlockConfig[] {
    return this.release.featureUnlocks;
  }

  public getSkill(id: string): SkillConfig {
    return this.getRequired(this.skillById, id, 'skill');
  }

  public get skills(): readonly SkillConfig[] {
    return this.release.skills;
  }

  public getSkillXpCurve(skillId: string): SkillXpCurve {
    return this.getRequired(this.xpCurveBySkillId, skillId, 'skill_xp_curve');
  }

  public getAction(id: string): ActionConfig {
    return this.getRequired(this.actionById, id, 'action');
  }

  public get actions(): readonly ActionConfig[] {
    return this.release.actions;
  }

  public getRecipe(id: string): RecipeConfig {
    return this.getRequired(this.recipeById, id, 'recipe');
  }

  public get recipes(): readonly RecipeConfig[] {
    return this.release.recipes;
  }

  public getEquipment(itemId: string): EquipmentConfig {
    return this.getRequired(this.equipmentByItemId, itemId, 'equipment');
  }

  public get equipments(): readonly EquipmentConfig[] {
    return this.release.equipments;
  }

  public getRecipeAction(id: string): ActionConfig {
    const recipe = this.getRecipe(id);
    return this.getRequired(this.actionById, recipe.action_config_id, 'action');
  }

  public getBuff(id: string): BuffConfig {
    return this.getRequired(this.buffById, id, 'buff');
  }

  public getBuffBySourceItemId(sourceItemId: string): BuffConfig {
    return this.getRequired(this.buffBySourceItemId, sourceItemId, 'buff_source_item');
  }

  public get buffs(): readonly BuffConfig[] {
    return this.release.buffs;
  }

  public getLootTable(id: string): LootTableConfig {
    return this.getRequired(this.lootTableById, id, 'loot_table');
  }

  public get lootTables(): readonly LootTableConfig[] {
    return this.release.lootTables;
  }

  public getMonster(id: string): MonsterConfig {
    return this.getRequired(this.monsterById, id, 'monster');
  }

  public get monsters(): readonly MonsterConfig[] {
    return this.release.monsters;
  }

  public getDungeon(id: string): DungeonConfig {
    return this.getRequired(this.dungeonById, id, 'dungeon');
  }

  public get dungeons(): readonly DungeonConfig[] {
    return this.release.dungeons;
  }

  public getRegion(id: string): RegionConfig {
    return this.getRequired(this.regionById, id, 'region');
  }

  public get regions(): readonly RegionConfig[] {
    return this.release.regions;
  }

  public getCaveFacility(id: string): CaveFacilityConfig {
    return this.getRequired(this.caveFacilityById, id, 'cave_facility');
  }

  public get caveFacilities(): readonly CaveFacilityConfig[] {
    return this.release.caveFacilities;
  }

  private getRequired<T>(values: ReadonlyMap<string, T>, id: string, label: string): T {
    const value = values.get(id);

    if (value === undefined) {
      throw new Error(`CONFIG_NOT_FOUND:${label}:${id}`);
    }

    return value;
  }
}

export type LoadConfigRegistryOptions = Readonly<{
  releasesRoot: string;
  version: string;
}>;

export function loadConfigRegistry(options: LoadConfigRegistryOptions): ConfigRegistry {
  const releaseDir = join(options.releasesRoot, options.version);
  const manifest = ManifestSchema.parse(readJson(join(releaseDir, 'manifest.json')));
  const realms = z.array(RealmConfigSchema).parse(readJson(join(releaseDir, 'realms.json')));
  const featureUnlocks = z
    .array(FeatureUnlockConfigSchema)
    .parse(readJson(join(releaseDir, 'feature_unlocks.json')));
  const skills = z.array(SkillConfigSchema).parse(readJson(join(releaseDir, 'skills.json')));
  const xpCurves = z.array(SkillXpCurveSchema).parse(readJson(join(releaseDir, 'xp_curves.json')));
  const items = z.array(ItemConfigSchema).parse(readJson(join(releaseDir, 'items.json')));
  const actions = z.array(ActionConfigSchema).parse(readJson(join(releaseDir, 'actions.json')));
  const recipes = z.array(RecipeConfigSchema).parse(readJson(join(releaseDir, 'recipes.json')));
  const equipments = z.array(EquipmentConfigSchema).parse(readJson(join(releaseDir, 'equipment.json')));
  const buffs = z.array(BuffConfigSchema).parse(readJson(join(releaseDir, 'buffs.json')));
  const lootTables = z.array(LootTableConfigSchema).parse(readJson(join(releaseDir, 'loot_tables.json')));
  const monsters = z.array(MonsterConfigSchema).parse(readJson(join(releaseDir, 'monsters.json')));
  const dungeons = z.array(DungeonConfigSchema).parse(readJson(join(releaseDir, 'dungeons.json')));
  const regions = z.array(RegionConfigSchema).parse(readJson(join(releaseDir, 'regions.json')));
  const caveFacilities = z.array(CaveFacilityConfigSchema).parse(readJson(join(releaseDir, 'cave_facilities.json')));

  if (manifest.config_version !== options.version) {
    throw new Error(`CONFIG_VERSION_MISMATCH:${options.version}:${manifest.config_version}`);
  }

  const actualHash = computeReleaseContentHash(releaseDir);
  if (manifest.content_hash !== actualHash) {
    throw new Error(`CONFIG_HASH_MISMATCH:${manifest.content_hash}:${actualHash}`);
  }

  const realmById = indexById(realms, 'realm');
  const skillById = indexById(skills, 'skill');
  const xpCurveBySkillId = indexByField(xpCurves, 'skill_id', 'skill_xp_curve');
  const featureById = indexByField(featureUnlocks, 'feature_id', 'feature');

  const stageOrders = new Set<number>();
  for (const realm of realms) {
    if (stageOrders.has(realm.stage_order)) {
      throw new Error(`CONFIG_DUPLICATE_STAGE_ORDER:${realm.stage_order}`);
    }
    stageOrders.add(realm.stage_order);
  }

  for (const feature of featureUnlocks) {
    assertReference(realmById, feature.visible_stage, 'feature.visible_stage');
    assertReference(realmById, feature.usable_stage, 'feature.usable_stage');
    assertReference(realmById, feature.mastery_stage, 'feature.mastery_stage');
    if (feature.required_skill_id !== null) {
      assertReference(skillById, feature.required_skill_id, 'feature.required_skill_id');
    }
    if (feature.required_skill_id === null && feature.required_skill_level !== null) {
      throw new Error(`CONFIG_SKILL_LEVEL_WITHOUT_SKILL:${feature.feature_id}`);
    }
  }

  for (const curve of xpCurves) {
    assertReference(skillById, curve.skill_id, 'xp_curve.skill_id');
    const skill = skillById.get(curve.skill_id);
    if (skill === undefined || curve.levels.length !== skill.max_level) {
      throw new Error(`CONFIG_XP_CURVE_LEVEL_COUNT:${curve.skill_id}`);
    }
    const levels = new Set(curve.levels.map((level) => level.level));
    if (levels.size !== curve.levels.length) {
      throw new Error(`CONFIG_XP_CURVE_DUPLICATE_LEVEL:${curve.skill_id}`);
    }
  }

  if (featureById.size !== featureUnlocks.length || xpCurveBySkillId.size !== xpCurves.length) {
    throw new Error('CONFIG_INDEX_SIZE_MISMATCH');
  }
  const itemById = indexById(items, 'item');
  const actionById = indexById(actions, 'action');
  const buffById = indexById(buffs, 'buff');
  const equipmentTags = new Set(
    items
      .filter((item) => item.category === 'EQUIPMENT')
      .flatMap((item) => item.tags),
  );
  const lootTableById = indexById(lootTables, 'loot_table');
  const monsterById = indexById(monsters, 'monster');
  const dungeonById = indexById(dungeons, 'dungeon');
  for (const item of items) {
    assertReference(realmById, item.realm_required, 'item.realm_required');
  }

  for (const equipment of equipments) {
    assertReference(itemById, equipment.item_id, 'equipment.item_id');
    const item = itemById.get(equipment.item_id);
    if (item === undefined) {
      throw new Error(`CONFIG_NOT_FOUND:item:${equipment.item_id}`);
    }
    if (item.category !== 'EQUIPMENT') {
      throw new Error(`CONFIG_EQUIPMENT_ITEM_CATEGORY_MISMATCH:${equipment.item_id}`);
    }
    if (equipment.equip_requirements.required_realm !== null) {
      assertReference(realmById, equipment.equip_requirements.required_realm, 'equipment.equip_requirements.required_realm');
    }
    const slotTag = equipment.slot.toLowerCase();
    if (!item.tags.includes(slotTag)) {
      throw new Error(`CONFIG_EQUIPMENT_SLOT_TAG_MISMATCH:${equipment.item_id}`);
    }
    for (const modifierId of equipment.modifier_ids) {
      assertReference(buffById, modifierId, 'equipment.modifier_ids');
    }
    if (equipment.slot === 'TOOL') {
      if (equipment.tool_effects === undefined || equipment.tool_effects.length === 0) {
        throw new Error(`CONFIG_TOOL_EFFECTS_REQUIRED:${equipment.item_id}`);
      }
      for (const effect of equipment.tool_effects) {
        assertReference(skillById, effect.skill_id, 'equipment.tool_effects.skill_id');
      }
    } else if ((equipment.tool_effects?.length ?? 0) > 0) {
      throw new Error(`CONFIG_TOOL_EFFECTS_ON_NON_TOOL:${equipment.item_id}`);
    }
  }

  for (const action of actions) {
    assertReference(realmById, action.realm_required, 'action.realm_required');
    const requiredToolTag = action.required_tool_tag ?? null;
    if (action.skill_id !== null) {
      assertReference(skillById, action.skill_id, 'action.skill_id');
    } else if (!/^0(?:\.0+)?$/.test(action.skill_xp)) {
      throw new Error(`CONFIG_SKILL_XP_WITHOUT_SKILL:${action.id}`);
    }
    if (requiredToolTag !== null && !equipmentTags.has(requiredToolTag)) {
      throw new Error(`CONFIG_MISSING_REQUIRED_TOOL_TAG:${action.id}:${requiredToolTag}`);
    }
    for (const input of action.inputs) {
      assertReference(itemById, input.item_id, 'action.inputs.item_id');
    }
    for (const output of action.outputs) {
      assertReference(itemById, output.item_id, 'action.outputs.item_id');
    }
  }

  for (const recipe of recipes) {
    assertReference(realmById, recipe.realm_required, 'recipe.realm_required');
    assertReference(actionById, recipe.action_config_id, 'recipe.action_config_id');
    assertReference(itemById, recipe.result_item_id, 'recipe.result_item_id');
    for (const ingredient of recipe.ingredients) {
      assertReference(itemById, ingredient.item_id, 'recipe.ingredients.item_id');
    }
    const action = actionById.get(recipe.action_config_id);
    if (action === undefined) {
      throw new Error(`CONFIG_NOT_FOUND:action:${recipe.action_config_id}`);
    }
    if (action.skill_id !== recipe.craft_skill_id) {
      throw new Error(`CONFIG_RECIPE_SKILL_MISMATCH:${recipe.id}`);
    }
    if (action.realm_required !== recipe.realm_required) {
      throw new Error(`CONFIG_RECIPE_REALM_MISMATCH:${recipe.id}`);
    }
    if (action.base_duration_us !== recipe.base_duration_us) {
      throw new Error(`CONFIG_RECIPE_DURATION_MISMATCH:${recipe.id}`);
    }
    if (action.skill_xp !== recipe.skill_xp) {
      throw new Error(`CONFIG_RECIPE_XP_MISMATCH:${recipe.id}`);
    }
    if (action.inputs.length !== recipe.ingredients.length) {
      throw new Error(`CONFIG_RECIPE_INPUT_COUNT_MISMATCH:${recipe.id}`);
    }
    for (const [index, ingredient] of recipe.ingredients.entries()) {
      const actionInput = action.inputs[index];
      if (
        actionInput === undefined
        || actionInput.item_id !== ingredient.item_id
        || actionInput.quantity !== ingredient.quantity
      ) {
        throw new Error(`CONFIG_RECIPE_INPUT_MISMATCH:${recipe.id}:${index}`);
      }
    }
    if (action.outputs.length !== 1) {
      throw new Error(`CONFIG_RECIPE_OUTPUT_COUNT_MISMATCH:${recipe.id}`);
    }
    const output = action.outputs[0];
    if (
      output === undefined
      || output.item_id !== recipe.result_item_id
      || output.quantity !== recipe.result_quantity
    ) {
      throw new Error(`CONFIG_RECIPE_OUTPUT_MISMATCH:${recipe.id}`);
    }
  }

  for (const buff of buffs) {
    assertReference(realmById, buff.realm_required, 'buff.realm_required');
    assertReference(itemById, buff.source_item_id, 'buff.source_item_id');
    for (const modifier of buff.modifiers) {
      if (modifier.tags.length === 0) {
        throw new Error(`CONFIG_BUFF_MODIFIER_TAGS_EMPTY:${buff.id}`);
      }
    }
    if (!buff.enabled && buff.deprecated === false) {
      // disabled active content is allowed for future releases, but MVP buffs should be enabled.
    }
  }

  for (const lootTable of lootTables) {
    assertReference(realmById, lootTable.realm_required, 'loot_table.realm_required');
    for (const entry of lootTable.entries) {
      assertReference(itemById, entry.item_id, 'loot_table.entries.item_id');
    }
  }

  for (const monster of monsters) {
    assertReference(realmById, monster.realm_required, 'monster.realm_required');
    assertReference(lootTableById, monster.combat.loot_table_id, 'monster.combat.loot_table_id');
  }

  for (const dungeon of dungeons) {
    assertReference(realmById, dungeon.realm_required, 'dungeon.realm_required');
    assertReference(lootTableById, dungeon.reward_table_id, 'dungeon.reward_table_id');
    assertReference(lootTableById, dungeon.failure_reward_table_id, 'dungeon.failure_reward_table_id');
    const nodeById = indexById(dungeon.nodes, 'dungeon_node');
    const choiceById = indexById(dungeon.choices, 'dungeon_choice');
    if (!choiceById.has(dungeon.default_safe_choice_id)) {
      throw new Error(`CONFIG_DUNGEON_DEFAULT_SAFE_CHOICE_MISSING:${dungeon.id}`);
    }
    for (const node of dungeon.nodes) {
      for (const monsterId of node.monster_ids) {
        assertReference(monsterById, monsterId, 'dungeon.nodes.monster_ids');
      }
      for (const choiceId of node.choice_ids) {
        assertReference(choiceById, choiceId, 'dungeon.nodes.choice_ids');
      }
      for (const nextNodeId of node.next_node_ids) {
        assertReference(nodeById, nextNodeId, 'dungeon.nodes.next_node_ids');
      }
    }
    for (const choice of dungeon.choices) {
      assertReference(monsterById, choice.monster_id, 'dungeon.choices.monster_id');
      assertReference(lootTableById, choice.success_reward_table_id, 'dungeon.choices.success_reward_table_id');
      assertReference(lootTableById, choice.failure_reward_table_id, 'dungeon.choices.failure_reward_table_id');
    }
  }

  for (const region of regions) {
    assertReference(realmById, region.realm_required, 'region.realm_required');
    for (const itemId of region.resource_item_ids) {
      assertReference(itemById, itemId, 'region.resource_item_ids');
    }
    for (const actionId of region.action_ids) {
      assertReference(actionById, actionId, 'region.action_ids');
    }
    for (const monsterId of region.monster_ids) {
      assertReference(monsterById, monsterId, 'region.monster_ids');
    }
    for (const dungeonId of region.dungeon_ids) {
      assertReference(dungeonById, dungeonId, 'region.dungeon_ids');
    }
  }

  const caveLevelsByFacility = new Map<string, number[]>();
  for (const facility of caveFacilities) {
    assertReference(realmById, facility.realm_required, 'cave_facility.realm_required');
    for (const material of facility.material_costs) {
      assertReference(itemById, material.item_id, 'cave_facility.material_costs.item_id');
    }
    const levels = caveLevelsByFacility.get(facility.facility_id) ?? [];
    levels.push(facility.level);
    caveLevelsByFacility.set(facility.facility_id, levels);
  }
  for (const levels of caveLevelsByFacility.values()) {
    const sorted = [...levels].sort((left, right) => left - right);
    for (let index = 0; index < sorted.length; index += 1) {
      const expectedLevel = index + 1;
      if (sorted[index] !== expectedLevel) {
        throw new Error(`CONFIG_CAVE_FACILITY_LEVEL_GAP:${expectedLevel}`);
      }
    }
  }

  return new ConfigRegistry({
    manifest,
    realms,
    featureUnlocks,
    skills,
    xpCurves,
    items,
    actions,
    recipes,
    equipments,
    buffs,
    lootTables,
    monsters,
    dungeons,
    regions,
    caveFacilities,
  });
}
