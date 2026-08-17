/// <reference types="node" />

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import actionsConfig from '../../../../../config/releases/2026.08.16.1/actions.json';
import itemsConfig from '../../../../../config/releases/2026.08.16.1/items.json';
import recipesConfig from '../../../../../config/releases/2026.08.16.1/recipes.json';

import type { ActionCatalogEntry, Queue } from '@dongtian/contracts';

import { describeActionDescription, describeActionId, describeItemId, describeRecipeId, describeRoute, describeSkillId, describeUnlockReason, formatActionRate, formatCount, formatDurationUs, joinQueuePath, joinRoutePath, isActionQueued, selectBestAction, summarizeInventoryAsset } from './content-adapter.js';

describe('content adapter', () => {
  it('formats durations, queue links, and inventory summaries', () => {
    expect(formatCount('1200')).toBe('1,200');
    expect(formatDurationUs('60000000')).toBe('1 分钟');
    expect(joinQueuePath('action.cultivation.qi')).toBe('/dashboard?action_id=action.cultivation.qi');
    expect(joinRoutePath({ route_type: 'RECIPE', target_id: 'recipe.t1.qi_gathering_pill', name_key: 'x', description_key: null, source_note: 'y' })).toBe('/craft?tab=recipes&recipe_id=recipe.t1.qi_gathering_pill');
    expect(
      summarizeInventoryAsset({
        asset_type: 'ITEM',
        asset_id: 'item.t1.qingling_herb',
        category: 'herb',
        quantity: 5,
        reserved_quantity: 2,
        available_quantity: 3,
      }),
    ).toContain('可用 3');
  });

  it('translates known technical IDs for player-facing content labels', () => {
    expect(describeSkillId('skill.alchemy')).toBe('炼丹');
    expect(describeActionId('action.t1.herb_baicao_valley')).toBe('采药');
    expect(describeItemId('item.t1.qingling_herb')).toBe('青灵草');
    expect(describeRecipeId('recipe.t1.qi_gathering_pill')).toBe('聚气丹配方');
    expect(describeRoute({ route_type: 'ACTION', target_id: 'action.t1.herb_baicao_valley', name_key: 'x', description_key: null, source_note: 'x' })).toBe('行动 · 采药');
    expect(describeRoute({ route_type: 'RECIPE', target_id: 'recipe.t1.qi_gathering_pill', name_key: 'x', description_key: null, source_note: 'x' })).toBe('配方 · 聚气丹配方');
    expect(describeActionId('action.unknown')).toBe('未知行动');
    expect(describeRecipeId('recipe.unknown')).toBe('未知配方');
    expect(describeItemId('item.unknown')).toBe('未鉴定物品');
    expect(describeActionDescription('action.unknown')).toBe('完成这项修行后会积累对应修行进度。');
  });

  it('keeps every current config action, recipe, and item player-facing', () => {
    for (const entry of actionsConfig) {
      const label = describeActionId(entry.id);
      expect(label).not.toBe(entry.id);
      expect(label).not.toContain(entry.id);
    }
    for (const entry of recipesConfig) {
      const label = describeRecipeId(entry.id);
      expect(label).not.toBe(entry.id);
      expect(label).not.toContain(entry.id);
    }
    for (const entry of itemsConfig) {
      const label = describeItemId(entry.id);
      expect(label).not.toBe(entry.id);
      expect(label).not.toContain(entry.id);
    }
  });

  it('translates tutorial and realm unlock blockers and removes duplicate fragments', () => {
    expect(describeUnlockReason('TUT-001')).toBe('完成采药入门教学后解锁');
    expect(describeUnlockReason('TUT-002')).toBe('完成炼丹入门教学后解锁');
    expect(describeUnlockReason('realm.qi.early')).toBe('达到炼气初期后解锁');
    expect(describeUnlockReason('TUT-001', [{ kind: 'realm', required_id: 'realm.qi.early', actual_id: 'realm.mortal.entry' }])).toBe('完成采药入门教学后解锁；达到炼气初期后解锁（当前炼气入门）');
    expect(describeUnlockReason('技能等级不足：需要 skill.mining 10 级')).toBe('技能等级不足：需要 挖矿 10 级');
    expect(describeUnlockReason('技能等级不足：需要 skill.unknown 10 级')).toBe('技能等级不足：需要 未知技能 10 级');

    const reason = describeUnlockReason('教程未完成：需要 TUT-001；境界不足：需要 realm.qi.early，当前 realm.mortal.entry；教程未完成：需要 TUT-001', [
      { kind: 'tutorial', required_id: 'TUT-001' },
      { kind: 'realm', required_id: 'realm.qi.early', actual_id: 'realm.mortal.entry' },
      { kind: 'tutorial', required_id: 'TUT-001' },
    ]);

    expect(reason).toContain('采药入门');
    expect(reason).toContain('炼气初期');
    expect(reason).not.toMatch(/TUT-|realm\./);
    expect(reason.match(/采药入门/g)).toHaveLength(1);
  });

  it('keeps content page actions player-facing and hides raw ID title attributes', () => {
    const source = readFileSync(new URL('./content-page.tsx', import.meta.url), 'utf8');
    expect(source).toContain('开始修行');
    expect(source).toContain('开始炼制');
    expect(source).not.toContain('加入当前草稿');
    expect(source).not.toMatch(/>\s*加入队列\s*</);
    expect(source).not.toMatch(/title=\{(?:entry|item|action|recipe)\.(?:action_id|recipe_id|asset_id)\}/);
  });

  it('selects the best unlocked action per skill and checks queue state', () => {
    const actions: ReadonlyArray<ActionCatalogEntry> = [
      {
        action_id: 'action.low',
        name_key: 'low',
        description_key: null,
        skill_id: 'skill.alchemy',
        enabled: true,
        unlocked: true,
        unlock_state: { enabled: true, visible: true, usable: true, optimized_ui: true, reason_key: null, reason: '可用', blockers: [] },
        queue_action_id: 'action.low',
        can_add_to_queue: true,
        base_duration_us: '120000000',
        skill_xp: '3',
        cultivation_xp: '1',
        allowed_queue_modes: ['COUNT'],
        required_tool_tag: null,
        modifier_tags: [],
        tags: [],
        inputs: [],
        outputs: [],
      },
      {
        action_id: 'action.high',
        name_key: 'high',
        description_key: null,
        skill_id: 'skill.alchemy',
        enabled: true,
        unlocked: true,
        unlock_state: { enabled: true, visible: true, usable: true, optimized_ui: true, reason_key: null, reason: '可用', blockers: [] },
        queue_action_id: 'action.high',
        can_add_to_queue: true,
        base_duration_us: '60000000',
        skill_xp: '8',
        cultivation_xp: '4',
        allowed_queue_modes: ['COUNT'],
        required_tool_tag: null,
        modifier_tags: [],
        tags: [],
        inputs: [],
        outputs: [],
      },
    ];

    const queue: Queue = {
      queue_version: '1',
      paused: false,
      pending_replace_after_cycle: false,
      fallback: { action_id: 'action.cultivation.qi', mode: 'INFINITE' },
      current: { entry_id: 'entry-1', client_entry_id: null, position: 0, action_id: 'action.high', mode: 'COUNT', target_value: '1', condition_item_id: null, condition_operator: null, on_blocked: 'FALLBACK', status: 'RUNNING', completed_cycles: '0', progress_time_us: '0', snapshot_config_version: null },
      entries: [],
      as_of: '2026-08-16T00:00:00.000Z',
    };

    expect(selectBestAction(actions).get('skill.alchemy')?.action_id).toBe('action.high');
    expect(isActionQueued('action.high', queue)).toBe(true);
    expect(formatActionRate(actions[1] as ActionCatalogEntry)).toContain('/小时');
  });
});
