import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it } from 'vitest';

import { computeReleaseContentHash, loadConfigRegistry } from './config.js';

const version = '2026.08.16.1';
const releasePath = fileURLToPath(new URL(`../../../config/releases/${version}`, import.meta.url));
const temporaryRoots: string[] = [];

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

function copyRelease(): string {
  const root = mkdtempSync(join(tmpdir(), 'dongtian-config-'));
  temporaryRoots.push(root);
  cpSync(releasePath, join(root, version), { recursive: true });
  return root;
}

function readReleaseJson<T>(root: string, fileName: string): T {
  return JSON.parse(readFileSync(join(root, version, fileName), 'utf8')) as T;
}

function writeReleaseJson(root: string, fileName: string, value: unknown): void {
  writeFileSync(join(root, version, fileName), `${JSON.stringify(value, null, 2)}\n`);
}

function refreshManifestHash(root: string): void {
  const manifest = readReleaseJson<Record<string, unknown>>(root, 'manifest.json');
  manifest['content_hash'] = computeReleaseContentHash(join(root, version));
  writeReleaseJson(root, 'manifest.json', manifest);
}

describe('versioned config registry', () => {
  it('loads the first development release and queries stable IDs', () => {
    const registry = loadConfigRegistry({ releasesRoot: fileURLToPath(new URL('../../../config/releases', import.meta.url)), version });

    expect(registry.manifest.config_version).toBe(version);
    expect(registry.getRealm('realm.qi.late').stage_order).toBe(3);
    expect(registry.getItem('item.t1.qingling_herb').trade_policy).toBe('NONE');
    expect(registry.getAction('action.t1.herb_baicao_valley').outputs[0]?.item_id).toBe('item.t1.qingling_herb');
    expect(registry.getAction('action.t1.herb_wuyin_slope').outputs[0]?.item_id).toBe('item.t1.ninglu_hua');
    expect(registry.getAction('action.t1.qi_gathering_pill').inputs.map((input) => input.item_id)).toEqual([
      'item.t1.qingling_herb',
      'item.t1.ninglu_hua',
    ]);
    expect(registry.getAction('action.t1.ore_chitong_kuang').required_tool_tag).toBe('mining_tool');
    expect(registry.getAction('action.t1.herb_lingquan_valley').loot_table_id).toBe(
      'loot.t1.herb_lingquan_valley',
    );
    expect(registry.getAction('action.t1.essence_pill').scope).toBe('ANCHOR');
    expect(registry.getAction('action.cultivation.qi')).toMatchObject({
      skill_id: null,
      skill_xp: '0.000000',
      cultivation_xp: '4.500000',
      base_duration_us: '60000000',
      inputs: [],
      outputs: [],
      allowed_queue_modes: ['DURATION', 'INFINITE'],
    });
    expect(registry.getRecipe('recipe.t1.qi_gathering_powder').ingredients[0]?.quantity).toBe('2');
    expect(registry.getRecipeAction('recipe.t1.qi_gathering_powder').id).toBe('action.t1.qi_gathering_powder');
    expect(registry.getRecipeAction('recipe.t1.qi_gathering_pill').outputs[0]?.item_id).toBe('item.t1.qi_gathering_pill');
    expect(registry.getRecipeAction('recipe.t1.recovery_pill').inputs[1]?.item_id).toBe('item.t1.qingshe_dan');
    expect(registry.getRecipeAction('recipe.t1.foundation_pill').outputs[0]?.item_id).toBe('item.t1.foundation_pill');
    expect(registry.getRecipeAction('recipe.t1.mubing_yaochu').id).toBe('action.t1.mubing_yaochu');
    expect(registry.getDungeon('dungeon.t1.qingshe_cave')).toMatchObject({
      id: 'dungeon.t1.qingshe_cave',
      choice_timeout_seconds: 60,
      default_safe_choice_id: 'choice.t1.qingshe_cave.safe_exit',
      reward_table_id: 'loot.t1.qingshe.success',
      failure_reward_table_id: 'loot.t1.qingshe.failure',
    });
    expect(registry.getDungeon('dungeon.t1.xuantie_cavern')).toMatchObject({
      id: 'dungeon.t1.xuantie_cavern',
      reward_table_id: 'loot.t1.xuantie_cavern.success',
      failure_reward_table_id: 'loot.t1.xuantie_cavern.failure',
    });
    expect(registry.getMonster('monster.t1.qingshe')).toMatchObject({
      id: 'monster.t1.qingshe',
      combat: {
        attack: '18',
        loot_table_id: 'loot.t1.qingshe.monster',
      },
    });
    expect(registry.getRegion('region.t2.blackwind_valley')).toMatchObject({
      id: 'region.t2.blackwind_valley',
      region_kind: 'VALLEY',
      dungeon_ids: ['dungeon.t1.heifeng_mijing'],
    });
    expect(registry.getCaveFacility('cave_facility.t1.forging_room_lv4')).toMatchObject({
      level: 4,
      effect_value: '0.07',
    });
    expect(registry.getLootTable('loot.t1.qingshe.success')).toMatchObject({
      id: 'loot.t1.qingshe.success',
      cultivation_xp: '250',
      entries: expect.arrayContaining([
        expect.objectContaining({ item_id: 'item.t2.lingsui' }),
        expect.objectContaining({ item_id: 'item.t1.qingyu_pei' }),
      ]),
    });
    expect(registry.getEquipment('item.t1.qingtong_yaochu')).toMatchObject({
      slot: 'TOOL',
      tool_effects: [
        {
          skill_id: 'skill.herbalism',
          action_speed_bonus: '0.12',
          action_efficiency_bonus: '0.05',
        },
      ],
    });
    expect(registry.getEquipment('item.t1.cuizhi_jian')).toMatchObject({
      item_id: 'item.t1.cuizhi_jian',
      slot: 'WEAPON',
      attack: 12,
    });
    expect(registry.getTempering(1)).toMatchObject({
      target_level: 1,
      success_probability: '0.95',
      scope: 'MVP',
      tempering_stone_item_id: 'item.t1.xingwen_gang',
      protection_material_item_id: 'item.t1.zhuji_hufu',
    });
    expect(registry.getTempering(6)).toMatchObject({
      target_level: 6,
      same_equipment_cost: '100',
    });
    expect(registry.getTempering(7)).toMatchObject({
      target_level: 7,
      scope: 'ANCHOR',
    });
    const eightHoursUs = 8n * 60n * 60n * 1_000_000n;
    const cultivationTailUs = eightHoursUs
      - BigInt(registry.getAction('action.t1.herb_baicao_valley').base_duration_us) * 72n
      - BigInt(registry.getAction('action.t1.qi_gathering_pill').base_duration_us) * 20n;
    expect(cultivationTailUs).toBe(17_100_000_000n);
    expect(registry.getFeatureUnlock('feature.market').enabled).toBe(false);
    expect(registry.getFeatureUnlock('feature.weapon_mastery.sword')).toMatchObject({
      enabled: true,
      visible_stage: 'realm.mortal.entry',
      usable_stage: 'realm.mortal.entry',
    });
    expect(registry.getSkill('skill.herbalism').max_level).toBe(100);
    expect(registry.getSkillXpCurve('skill.herbalism').levels).toHaveLength(100);
    expect(registry.getSkillXpCurve('skill.herbalism').levels[1]?.cumulative_xp).toBe('83');
    expect(registry.getSkill('skill.weapon_mastery.sword')).toMatchObject({
      tags: ['weapon_mastery', 'sword'],
      attack_bonus_per_level: '0.02',
    });
    expect(registry.getAction('action.weapon_mastery.sword')).toMatchObject({
      skill_id: 'skill.weapon_mastery.sword',
      base_duration_us: '60000000',
      skill_xp: '5',
      cultivation_xp: '0',
      outputs: [],
      allowed_queue_modes: ['INFINITE'],
    });
    expect(registry.actions).toHaveLength(50);
    expect(registry.items).toHaveLength(49);
    expect(registry.recipes).toHaveLength(25);
    expect(registry.buffs).toHaveLength(9);
    expect(registry.monsters).toHaveLength(11);
    expect(registry.dungeons).toHaveLength(3);
    expect(registry.regions).toHaveLength(6);
    expect(registry.monsters.filter((monster) => monster.tags.includes('boss')).length).toBeGreaterThanOrEqual(2);
    expect(registry.dungeons.filter((dungeon) => dungeon.enabled)).toHaveLength(3);
    expect(registry.caveFacilities).toHaveLength(12);
    expect(registry.temperings).toHaveLength(10);
  });

  it('rejects a release whose content hash no longer matches', () => {
    const root = copyRelease();
    const items = readReleaseJson<Array<Record<string, unknown>>>(root, 'items.json');
    items[0]!['name_key'] = 'item.changed.name';
    writeReleaseJson(root, 'items.json', items);

    expect(() => loadConfigRegistry({ releasesRoot: root, version })).toThrow(/CONFIG_HASH_MISMATCH/);
  });

  it('rejects negative or dangling configuration references', () => {
    const negativeRoot = copyRelease();
    const negativeItems = readReleaseJson<Array<Record<string, unknown>>>(negativeRoot, 'items.json');
    negativeItems[0]!['max_stack'] = '-1';
    writeReleaseJson(negativeRoot, 'items.json', negativeItems);
    expect(() => loadConfigRegistry({ releasesRoot: negativeRoot, version })).toThrow();

    const referenceRoot = copyRelease();
    const actions = readReleaseJson<Array<Record<string, unknown>>>(referenceRoot, 'actions.json');
    const outputs = actions[0]!['outputs'] as Array<Record<string, unknown>>;
    outputs[0]!['item_id'] = 'item.t1.missing';
    writeReleaseJson(referenceRoot, 'actions.json', actions);
    refreshManifestHash(referenceRoot);

    expect(() => loadConfigRegistry({ releasesRoot: referenceRoot, version })).toThrow(
      /CONFIG_MISSING_REFERENCE:action\.outputs\.item_id:item\.t1\.missing/,
    );

    const equipmentReferenceRoot = copyRelease();
    const equipment = readReleaseJson<Array<Record<string, unknown>>>(equipmentReferenceRoot, 'equipment.json');
    equipment[0]!['item_id'] = 'item.t1.missing';
    writeReleaseJson(equipmentReferenceRoot, 'equipment.json', equipment);
    refreshManifestHash(equipmentReferenceRoot);
    expect(() => loadConfigRegistry({ releasesRoot: equipmentReferenceRoot, version })).toThrow(
      /CONFIG_MISSING_REFERENCE:equipment\.item_id:item\.t1\.missing/,
    );

    const recipeReferenceRoot = copyRelease();
    const recipeActions = readReleaseJson<Array<Record<string, unknown>>>(recipeReferenceRoot, 'actions.json');
    const recipeActionInputs = recipeActions[3]!['inputs'] as Array<Record<string, unknown>>;
    recipeActionInputs[0]!['item_id'] = 'item.t1.missing';
    writeReleaseJson(recipeReferenceRoot, 'actions.json', recipeActions);
    refreshManifestHash(recipeReferenceRoot);
    expect(() => loadConfigRegistry({ releasesRoot: recipeReferenceRoot, version })).toThrow(
      /CONFIG_MISSING_REFERENCE:action\.inputs\.item_id:item\.t1\.missing/,
    );

    const featureReferenceRoot = copyRelease();
    const features = readReleaseJson<Array<Record<string, unknown>>>(
      featureReferenceRoot,
      'feature_unlocks.json',
    );
    features[0]!['visible_stage'] = 'realm.missing';
    writeReleaseJson(featureReferenceRoot, 'feature_unlocks.json', features);
    refreshManifestHash(featureReferenceRoot);
    expect(() => loadConfigRegistry({ releasesRoot: featureReferenceRoot, version })).toThrow(
      /CONFIG_MISSING_REFERENCE:feature\.visible_stage:realm\.missing/,
    );

    const curveReferenceRoot = copyRelease();
    const curves = readReleaseJson<Array<Record<string, unknown>>>(curveReferenceRoot, 'xp_curves.json');
    curves[0]!['skill_id'] = 'skill.missing';
    writeReleaseJson(curveReferenceRoot, 'xp_curves.json', curves);
    refreshManifestHash(curveReferenceRoot);
    expect(() => loadConfigRegistry({ releasesRoot: curveReferenceRoot, version })).toThrow(
      /CONFIG_MISSING_REFERENCE:xp_curve\.skill_id:skill\.missing/,
    );

    const skillXpWithoutSkillRoot = copyRelease();
    const skilllessActions = readReleaseJson<Array<Record<string, unknown>>>(
      skillXpWithoutSkillRoot,
      'actions.json',
    );
    const cultivationAction = skilllessActions.find((action) => action['id'] === 'action.cultivation.qi');
    expect(cultivationAction).toBeDefined();
    if (cultivationAction !== undefined) {
      cultivationAction['skill_xp'] = '1';
    }
    writeReleaseJson(skillXpWithoutSkillRoot, 'actions.json', skilllessActions);
    refreshManifestHash(skillXpWithoutSkillRoot);
    expect(() => loadConfigRegistry({ releasesRoot: skillXpWithoutSkillRoot, version })).toThrow(
      /CONFIG_SKILL_XP_WITHOUT_SKILL:action\.cultivation\.qi/,
    );

    const toolTagRoot = copyRelease();
    const toolTagActions = readReleaseJson<Array<Record<string, unknown>>>(toolTagRoot, 'actions.json');
    const toolTagAction = toolTagActions.find((action) => action['id'] === 'action.t1.ore_chitong_kuang');
    expect(toolTagAction).toBeDefined();
    if (toolTagAction !== undefined) {
      toolTagAction['required_tool_tag'] = 'ghost_tool';
    }
    writeReleaseJson(toolTagRoot, 'actions.json', toolTagActions);
    refreshManifestHash(toolTagRoot);
    expect(() => loadConfigRegistry({ releasesRoot: toolTagRoot, version })).toThrow(
      /CONFIG_MISSING_REQUIRED_TOOL_TAG:action\.t1\.ore_chitong_kuang:ghost_tool/,
    );
  });
});
