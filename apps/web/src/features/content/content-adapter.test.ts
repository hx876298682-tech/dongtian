import { describe, expect, it } from 'vitest';

import type { ActionCatalogEntry, Queue } from '@dongtian/contracts';

import { formatActionRate, formatCount, formatDurationUs, joinQueuePath, joinRoutePath, isActionQueued, selectBestAction, summarizeInventoryAsset } from './content-adapter.js';

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
