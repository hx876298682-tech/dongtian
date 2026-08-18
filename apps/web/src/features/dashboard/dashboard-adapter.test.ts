import { describe, expect, it } from 'vitest';

import { buildDashboardAuthoritySnapshot, buildLatestSettlementView, describeAction, describeQueuePreviewEntry, describeQueuePreviewSummary, describeQueuePreviewWarning } from './dashboard-adapter.js';

describe('dashboard adapter', () => {
  it('maps a missing latest settlement into an explicit empty state', () => {
    const view = buildLatestSettlementView({ settlement: null });

    expect(view.kind).toBe('empty');
    expect(view.title).toContain('暂无');
    expect(view.description).toContain('离线收益');
  });

  it('maps a persisted settlement into facts, timeline, rewards, consumptions, and anomalies', () => {
    const view = buildLatestSettlementView({
      settlement: {
        settlement_id: 'settlement-1',
        character_id: 'character-1',
        as_of: '2026-08-16T02:00:06.000Z',
        from_at: '2026-08-16T00:00:00.000Z',
        requested_until: '2026-08-16T02:30:00.000Z',
        effective_until: '2026-08-16T02:00:00.000Z',
        effective_time_us: '7200000',
        capped_time_us: '1800000',
        continuation_required: true,
        status: 'COMPLETED',
        summary: { status: 'COMPLETED' },
        rewards: {
          cultivation_xp: '2.5',
          skill_xp: '1.0',
          items: [{ item_id: 'item.t1.qingling_herb', quantity: '4' }],
        },
        timeline: [
          {
            segment_index: 0,
            queue_entry_id: 'entry-1',
            action_config_id: 'action.t1.herb_baicao_valley',
            from_at: '2026-08-16T00:00:00.000Z',
            to_at: '2026-08-16T01:00:00.000Z',
            completed_cycles: '60',
            inputs: [],
            outputs: [],
            xp_changes: [],
            transition_reason: 'ACTION_SWITCH',
            snapshot: {},
          },
          {
            segment_index: 1,
            queue_entry_id: 'entry-2',
            action_config_id: 'action.cultivation.qi',
            from_at: '2026-08-16T01:00:00.000Z',
            to_at: '2026-08-16T02:00:00.000Z',
            completed_cycles: '60',
            inputs: [],
            outputs: [],
            xp_changes: [],
            transition_reason: 'BLOCKED_MATERIAL',
            snapshot: {},
          },
        ],
        ledger_entries: [
          {
            entry_id: 'ledger-1',
            transaction_id: 'txn-1',
            asset_type: 'ITEM',
            asset_id: 'item.t1.qingling_herb',
            delta: '-4',
            balance_after: '12',
            reason_code: 'settlement.consume',
            reference_type: 'SETTLEMENT',
            reference_id: 'settlement-1',
            config_version: '2026.08.16.1',
            created_at: '2026-08-16T02:00:06.000Z',
          },
        ],
      },
    });

    expect(view.kind).toBe('ready');
    expect(view.summaryLine).toContain('获得修为 2.5');
    expect(view.facts).toHaveLength(0);
    expect(view.timeline).toHaveLength(2);
    expect(view.rewards.some((item) => item.title === '修为')).toBe(true);
    expect(view.consumptions).toHaveLength(1);
    expect(view.anomalies.some((item) => item.title === '续跑')).toBe(true);
    expect(view.anomalies.some((item) => item.detail.includes('材料不足'))).toBe(true);
  });

  it('keeps the shell summary focused on authoritative dashboard fields', () => {
    const snapshot = buildDashboardAuthoritySnapshot(
      {
        character: {
          character_id: 'character-1',
          name: '洞天散修',
          state_version: 12,
          active_config_version: '2026.08.16.1',
        },
        cultivation: {
          xp: '2400',
          realm_stage_id: 'realm.qi.early',
          stage_start_xp: '0',
          stage_required_xp: '5000',
          stage_progress_xp: '2400',
          remaining_xp: '2600',
          progress_ratio: '0.48',
        },
        skills: [],
        feature_permissions: [],
        calculation_as_of: '2026-08-16T02:00:06.000Z',
        config_version: '2026.08.16.1',
      },
      {
        queue_version: '4',
        paused: false,
        pending_replace_after_cycle: false,
        fallback: { action_id: 'action.cultivation.qi', mode: 'INFINITE' },
        current: {
          entry_id: 'entry-1', client_entry_id: 'task-1', position: 0,
          action_id: 'action.cultivation.qi', mode: 'INFINITE', target_value: null,
          condition_item_id: null, condition_operator: null, on_blocked: 'FALLBACK',
          status: 'RUNNING', completed_cycles: '2', progress_time_us: '0', snapshot_config_version: '2026.08.16.1',
          base_duration_us: '60000000',
        },
        entries: [],
        as_of: '2026-08-16T02:00:06.000Z',
      },
      {
        items: [],
        currencies: [],
        equipment_instances: [],
        total_count: 3,
      },
      null,
      null,
      new Date('2026-08-16T02:00:56.000Z').getTime(),
    );

    expect(snapshot.goalTrackerDetail).toContain('洞天散修');
    expect(snapshot.offlineSummary.kind).toBe('empty');
    expect(snapshot.currentActionProgress).toBeCloseTo(5 / 6);
    expect(snapshot.currentActionRemaining).toBe('本轮还需 10 秒');
  });

  it('maps the latest settlement into the dashboard offline summary', () => {
    const snapshot = buildDashboardAuthoritySnapshot(
      {
        character: {
          character_id: 'character-1',
          name: '洞天散修',
          state_version: 12,
          active_config_version: '2026.08.16.1',
        },
        cultivation: {
          xp: '2400',
          realm_stage_id: 'realm.qi.early',
          stage_start_xp: '0',
          stage_required_xp: '5000',
          stage_progress_xp: '2400',
          remaining_xp: '2600',
          progress_ratio: '0.48',
        },
        skills: [],
        feature_permissions: [],
        calculation_as_of: '2026-08-16T02:00:06.000Z',
        config_version: '2026.08.16.1',
      },
      {
        queue_version: '4',
        paused: false,
        pending_replace_after_cycle: false,
        fallback: { action_id: 'action.cultivation.qi', mode: 'INFINITE' },
        current: null,
        entries: [],
        as_of: '2026-08-16T02:00:06.000Z',
      },
      { items: [], currencies: [], equipment_instances: [], total_count: 3 },
      {
        settlement: {
          settlement_id: 'settlement-1',
          character_id: 'character-1',
          as_of: '2026-08-16T02:00:06.000Z',
          from_at: '2026-08-16T00:00:00.000Z',
          requested_until: '2026-08-16T02:30:00.000Z',
          effective_until: '2026-08-16T02:00:00.000Z',
          effective_time_us: '7200000',
          capped_time_us: '1800000',
          continuation_required: true,
          status: 'COMPLETED',
          summary: { status: 'COMPLETED' },
          rewards: { cultivation_xp: '2.5', skill_xp: '1.0', items: [{ item_id: 'item.herb', quantity: '4' }] },
          timeline: [
            {
              segment_index: 0,
              queue_entry_id: 'entry-1',
              action_config_id: 'action.herb',
              from_at: '2026-08-16T00:00:00.000Z',
              to_at: '2026-08-16T01:00:00.000Z',
              completed_cycles: '60',
              inputs: [],
              outputs: [],
              xp_changes: [],
              transition_reason: 'BLOCKED_MATERIAL',
              snapshot: {},
            },
          ],
          ledger_entries: [
            {
              entry_id: 'ledger-1',
              transaction_id: 'txn-1',
              asset_type: 'ITEM',
              asset_id: 'item.herb',
              delta: '-1',
              balance_after: '3',
              reason_code: 'settlement.consume',
              reference_type: 'SETTLEMENT',
              reference_id: 'settlement-1',
              config_version: '2026.08.16.1',
              created_at: '2026-08-16T02:00:06.000Z',
            },
          ],
        },
      },
    );

    expect(snapshot.offlineSummary.kind).toBe('ready');
    expect(snapshot.offlineSummary.rewards.some((item) => item.title === '修为')).toBe(true);
    expect(snapshot.offlineSummary.consumptions).toHaveLength(1);
    expect(snapshot.offlineSummary.timeline).toHaveLength(1);
    expect(snapshot.offlineSummary.anomalies.some((item) => item.detail.includes('材料不足'))).toBe(true);
  });

  it('uses player-facing labels for dashboard actions and preview entries', () => {
    expect(describeAction('action.cultivation.qi')).toBe('采气修炼');
    expect(describeAction('action.weapon_mastery.sword')).toBe('练剑');
    expect(describeAction('action.t1.herb_baicao_valley')).toBe('百草谷采药');
    expect(describeQueuePreviewEntry({ action_id: 'action.t1.qi_gathering_pill', mode: 'INFINITE' })).toBe('炼制聚气丹');
    expect(describeQueuePreviewEntry({ action_id: 'action.t1.herb_baicao_valley', mode: 'COUNT', target_value: 3 })).toContain('百草谷采药');
    expect(describeQueuePreviewEntry({ action_id: 'action.t1.herb_baicao_valley', mode: 'COUNT', blocked_reason: 'BLOCKED_MATERIAL' })).toContain('暂时无法执行');
  });

  it('turns preview internals into readable duration and warning copy', () => {
    expect(describeQueuePreviewSummary({ total_duration_us: '3600', entries: [{ action_id: 'action.cultivation.qi' }] } as never)).toBe('总时长 0.004 秒 · 1 段');
    expect(describeQueuePreviewWarning({ message_key: 'error.queue_version_conflict' })).toContain('挂机计划刚刚发生变化');
    expect(describeQueuePreviewWarning({ blocked_reason: 'BLOCKED_MATERIAL' })).toContain('材料不足');
    expect(describeQueuePreviewWarning({ message: '材料不足' })).toBe('材料不足');
  });
});
