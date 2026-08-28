import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..', 'src/content');
const maps = [
  ['bai_cao_valley', '百草谷', ['normal', 'fine', 'rare', 'epic']],
  ['black_wind_valley', '黑风谷', ['normal', 'fine', 'rare', 'epic', 'legendary']],
  ['red_flame_cave', '赤炎洞', ['normal', 'fine', 'rare', 'epic', 'legendary', 'immortal']],
];
const slots = ['weapon', 'armor_1', 'armor_2', 'armor_3', 'armor_4', 'accessory'];
const slotNames = { weapon: '剑', armor_1: '护肩', armor_2: '护甲', armor_3: '护腕', armor_4: '战靴', accessory: '玉佩' };
const qualityNames = { normal: '凡', fine: '精', rare: '稀', epic: '史', legendary: '传', immortal: '仙' };
const reinforcement = {
  max_level_parameter: 'loot.equipment.enhancement.max_level',
  stat_multiplier_parameter: 'loot.equipment.enhancement.stat_multiplier_per_level',
  spirit_stone_base_parameter: 'loot.equipment.enhancement.spirit_stone_base_cost',
  spirit_stone_growth_parameter: 'loot.equipment.enhancement.spirit_stone_growth',
  spirit_ore_base_parameter: 'loot.equipment.enhancement.spirit_ore_base_cost',
  spirit_wood_base_parameter: 'loot.equipment.enhancement.spirit_wood_base_cost',
  material_growth_parameter: 'loot.equipment.enhancement.material_growth',
};
const reward = (id) => ({
  spirit_stone_per_kill: `map.${id}.spirit_stone_per_kill`,
  spirit_ore_per_kill: `map.${id}.spirit_ore_per_kill`,
  spirit_wood_per_kill: `map.${id}.spirit_wood_per_kill`,
  ancient_scroll_drop_chance: `map.${id}.ancient_scroll_drop_chance`,
  ancient_scroll_pity_kills: `map.${id}.ancient_scroll_pity_kills`,
});
const mapsPayload = maps.map(([id, displayName, qualities]) => ({
  id,
  type: 'map',
  display_name: displayName,
  unlock_realm_id: id === 'red_flame_cave' ? 'foundation_establishment' : 'qi_refining',
  target_kill_time_parameter: `map.${id}.target_kill_time`,
  reward_parameters: reward(id),
  equipment_drop: { template_ids: qualities.flatMap((quality) => slots.map((slot) => `equip.${id}.${slot}.${quality}.001`)) },
  status: 'released',
}));
const generatedEquipment = maps.flatMap(([mapId, , qualities]) => qualities.flatMap((quality) => slots.map((slot) => ({
  id: `equip.${mapId}.${slot}.${quality}.001`,
  display_name: `${qualityNames[quality]}${slotNames[slot]}`,
  name_pool_id: `name_pool.${mapId}.${slot}.${quality}`,
  icon_asset_id: `asset.placeholder.equipment.${mapId}.${slot}.${quality}`,
  appearance_tag_ids: [`appearance.${mapId}`],
  stat_template_id: `stat_template.${slot === 'weapon' ? 'weapon' : slot === 'accessory' ? 'accessory' : 'armor'}.v1`,
  source_map_ids: [mapId],
  slot,
  quality,
  quality_parameter: `loot.equipment.quality.multiplier.${quality}`,
  reinforcement,
  status: 'released',
}))));
// Preserve the two historical template IDs used by existing player snapshots
// and replay fixtures while the approved map bindings move to versioned IDs.
const equipment = [...generatedEquipment,
  { ...generatedEquipment.find((item) => item.id === 'equip.bai_cao_valley.weapon.fine.001'), id: 'iron_saber', display_name: '玄铁剑', name_pool_id: 'name_pool.legacy.iron_saber', icon_asset_id: 'asset.placeholder.legacy.iron_saber', appearance_tag_ids: ['appearance.bai_cao_valley'], source_map_ids: ['bai_cao_valley'] },
  { ...generatedEquipment.find((item) => item.id === 'equip.black_wind_valley.weapon.fine.001'), id: 'cloud_blade', display_name: '流云刃', name_pool_id: 'name_pool.legacy.cloud_blade', icon_asset_id: 'asset.placeholder.legacy.cloud_blade', appearance_tag_ids: ['appearance.black_wind_valley'], source_map_ids: ['black_wind_valley'] },
];
const recipes = [
  { id: 'alchemy_basic', building_id: 'alchemy_room', interval_parameter: 'building.alchemy_room.base_interval', output_resource: 'pill', output_parameter: 'recipe.alchemy_basic.output', input_parameters: { spirit_herb: 'recipe.alchemy_basic.herb_cost', spirit_stone: 'recipe.alchemy_basic.stone_cost' } },
  { id: 'pill_zi_yun', building_id: 'alchemy_room', interval_parameter: 'building.alchemy_room.base_interval', output_resource: 'pill_zi_yun', output_parameter: 'recipe.pill_zi_yun.output', input_parameters: { spirit_herb: 'recipe.pill_zi_yun.herb_cost', spirit_stone: 'recipe.pill_zi_yun.stone_cost' }, status: 'released' },
  { id: 'pill_ning_lu', building_id: 'alchemy_room', interval_parameter: 'building.alchemy_room.base_interval', output_resource: 'pill_ning_lu', output_parameter: 'recipe.pill_ning_lu.output', input_parameters: { spirit_herb: 'recipe.pill_ning_lu.herb_cost', spirit_stone: 'recipe.pill_ning_lu.stone_cost' }, status: 'released' },
  { id: 'forge_basic', building_id: 'forge_room', interval_parameter: 'building.forge_room.base_interval', output_resource: 'equipment', output_parameter: 'recipe.forge_basic.output', input_parameters: { spirit_ore: 'recipe.forge_basic.ore_cost', spirit_wood: 'recipe.forge_basic.wood_cost', spirit_stone: 'recipe.forge_basic.stone_cost' } },
];
const canonicalRecord = (value, preferred = []) => Object.fromEntries([...preferred.filter((key) => Object.hasOwn(value, key)), ...Object.keys(value).filter((key) => !preferred.includes(key)).sort()].map((key) => [key, canonicalValue(value[key])]));
const canonicalValue = (value) => Array.isArray(value) ? value.map(canonicalValue) : value && typeof value === 'object' ? canonicalRecord(value) : value;
const canonicalize = () => ({
  maps: mapsPayload.map((map) => { const result = canonicalRecord(map, ['id', 'type', 'display_name', 'unlock_realm_id', 'target_kill_time_parameter', 'reward_parameters']); result.reward_parameters = canonicalRecord(map.reward_parameters, ['spirit_stone_per_kill', 'spirit_ore_per_kill', 'spirit_wood_per_kill', 'ancient_scroll_drop_chance', 'ancient_scroll_pity_kills']); return result; }),
  equipment: equipment.map((item) => { const result = canonicalRecord(item, ['id', 'display_name', 'name_pool_id', 'icon_asset_id', 'appearance_tag_ids', 'stat_template_id', 'source_map_ids', 'slot', 'quality', 'quality_parameter', 'reinforcement']); result.reinforcement = canonicalRecord(item.reinforcement, ['max_level_parameter', 'stat_multiplier_parameter', 'spirit_stone_base_parameter', 'spirit_stone_growth_parameter', 'spirit_ore_base_parameter', 'spirit_wood_base_parameter', 'material_growth_parameter']); return result; }),
  recipes: recipes.map((recipe) => { const result = canonicalRecord(recipe, ['id', 'building_id', 'interval_parameter', 'output_resource', 'output_parameter', 'input_parameters']); const varietyPill = /^pill_(zi_yun|ning_lu|huang_long|chi_yan)$/.test(recipe.id);
result.input_parameters = canonicalRecord(recipe.input_parameters, recipe.id === 'alchemy_basic' ? ['spirit_herb', 'spirit_stone'] : varietyPill ? ['spirit_herb', 'spirit_stone'] : ['spirit_ore', 'spirit_wood', 'spirit_stone']); return result; }),
});
const hash = createHash('sha256').update(JSON.stringify(canonicalize())).digest('hex');
const namePoolIds = equipment.map((item) => item.name_pool_id);
const appearanceTagIds = [...new Set(equipment.flatMap((item) => item.appearance_tag_ids))];
const statTemplateIds = [...new Set(equipment.map((item) => item.stat_template_id))];
const assetManifest = equipment.map((item) => ({ id: item.icon_asset_id, kind: 'equipment_icon', status: 'placeholder_v1', source: 'mvp-placeholder-no-ui-default', sha256: '0'.repeat(64) }));
const manifest = { config_version: '1.0.0-frozen', parameter_sha256: 'f67401fefb406a32b2e58abaabb655c12d56dbfe33309278a3780b9f82565a63', schema_version: '1.1', status: 'frozen_v1', content_files: ['maps.json', 'equipment.json', 'recipes.json'], content_sha256: hash, asset_manifest: assetManifest, name_pool_ids: namePoolIds, appearance_tag_ids: appearanceTagIds, stat_template_ids: statTemplateIds };
await mkdir(root, { recursive: true });
for (const [name, value] of [['maps.json', mapsPayload], ['equipment.json', equipment], ['recipes.json', recipes], ['manifest.json', manifest]]) await writeFile(resolve(root, name), `${JSON.stringify(value, null, 2)}\n`);
console.log(`content_package_generated templates=${equipment.length} maps=${mapsPayload.length} content_sha256=${hash}`);
