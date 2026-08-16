import { describe, expect, it } from 'vitest';

import { buildDashboardAuthoritySnapshot, buildLatestSettlementView } from './dashboard-adapter.js';

describe('dashboard adapter', () => {
  it('maps a missing latest settlement into an explicit empty state', () => {
    const view = buildLatestSettlementView({ settlement: null });

    expect(view.kind).toBe('empty');
    expect(view.title).toContain('暂无');
    expect(view.description).toContain('权威空态');
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
    expect(view.summaryLine).toContain('capped 1800000µs');
    expect(view.facts).toContainEqual(expect.objectContaining({ label: '起点' }));
    expect(view.timeline).toHaveLength(2);
    expect(view.rewards.some((item) => item.title === '修为')).toBe(true);
    expect(view.consumptions).toHaveLength(1);
    expect(view.anomalies.some((item) => item.title === '续跑')).toBe(true);
    expect(view.anomalies.some((item) => item.detail.includes('BLOCKED_MATERIAL'))).toBe(true);
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
        current: null,
        entries: [],
        as_of: '2026-08-16T02:00:06.000Z',
      },
      {
        items: [],
        currencies: [],
        equipment_instances: [],
        total_count: 3,
      },
    );

    expect(snapshot.goalTrackerDetail).toContain('洞天散修');
    expect(snapshot.offlineSummary.description).toContain('权威队列');
  });
});
