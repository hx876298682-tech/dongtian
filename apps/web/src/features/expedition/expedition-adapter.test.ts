import { describe, expect, it } from 'vitest';

import type { DungeonOpportunityResponse, DungeonRunResponse } from '@dongtian/contracts';

import {
  isDungeonRunTimedOut,
  summarizeDungeonOpportunity,
  summarizeDungeonPreview,
  summarizeDungeonRun,
} from './expedition-adapter.js';

const opportunity: DungeonOpportunityResponse = {
  character: { character_id: 'character-1', state_version: 42, active_config_version: '2026.08.16.1' },
  opportunity: {
    current_opportunities: 5,
    opportunity_cap: 6,
    recovery_anchor_at: '2026-08-16T00:00:00.000Z',
    next_recovery_at: '2026-08-16T12:00:00.000Z',
    recovery_interval_seconds: 43_200,
    is_capped: false,
  },
  teaching_grant: {
    source_tutorial_id: 'TUT-007',
    claimed_at: null,
    available: true,
    applied_quantity: 1,
  },
  calculation_as_of: '2026-08-16T00:00:00.000Z',
  config_version: '2026.08.16.1',
};

const runResponse: DungeonRunResponse = {
  character: opportunity.character,
  opportunity: opportunity.opportunity,
  teaching_grant: opportunity.teaching_grant,
  calculation_as_of: opportunity.calculation_as_of,
  config_version: opportunity.config_version,
  run: {
    run_id: 'run-1',
    dungeon_id: 'dungeon.t1.qingshe_cave',
    status: 'REWARD_CANDIDATE',
    current_node_id: 'node.t1.qingshe_cave.reward',
    phase: 'REWARD_CANDIDATE',
    outcome: 'SUCCESS',
    revision: 1,
    initial_route_id: 'route.t1.qingshe_cave.safe_exit',
    loadout_preset_id: 'preset-1',
    strategy_preset_id: 'strategy.safe',
    opportunity_cost: 1,
    config_version: '2026.08.16.1',
    created_at: '2026-08-16T00:00:00.000Z',
    choice_deadline_at: '2026-08-16T00:01:00.000Z',
    selected_choice_id: 'choice.t1.qingshe_cave.safe_exit',
    selected_route_id: 'route.t1.qingshe_cave.safe_exit',
    selected_route_risk: 'SAFE',
    selected_at: '2026-08-16T00:00:10.000Z',
    combat_resolved_at: '2026-08-16T00:00:11.000Z',
    finalized_at: null,
    run_state: {
      combatResult: {
        terminationReason: 'ENEMY_DEFEATED',
        winner: 'PLAYER',
        elapsedUs: '6000000',
      },
      rewardCandidate: {
        outcome: 'SUCCESS',
        routeId: 'route.t1.qingshe_cave.safe_exit',
        choiceId: 'choice.t1.qingshe_cave.safe_exit',
        routeRisk: 'SAFE',
        cultivationXp: '250',
        items: [{ assetId: 'item.t2.lingsui', quantity: '1' }],
      },
    },
  },
};

describe('expedition adapter', () => {
  it('summarizes the dungeon opportunity and run state', () => {
    const opportunityView = summarizeDungeonOpportunity(opportunity, '青蛇洞');
    const previewView = summarizeDungeonPreview({
      character: opportunity.character,
      dungeon: {
        dungeon_id: 'dungeon.t1.qingshe_cave',
        recommended_power: '80',
        base_success_rate: '0.9',
        estimated_success_rate: '0.9',
        choice_timeout_seconds: 60,
        opportunity_cost: 1,
        entry_items: [{ item_id: 'item.t1.fragment', quantity: '1' }],
        choices: [
          { choice_id: 'choice.t1.qingshe_cave.safe_exit', route_id: 'route.t1.qingshe_cave.safe_exit', risk: 'SAFE', label: '安全撤离' },
          { choice_id: 'choice.t1.qingshe_cave.deep_den', route_id: 'route.t1.qingshe_cave.deep_den', risk: 'HIGH_RISK', label_key: 'risk.route' },
        ],
        core_rewards: ['item.t2.lingsui'],
      },
      config_version: '2026.08.16.1',
      calculation_as_of: '2026-08-16T00:00:00.000Z',
    });
    const runView = summarizeDungeonRun(runResponse);

    expect(opportunityView.title).toContain('机会 5/6');
    expect(previewView.choices).toHaveLength(2);
    expect(runView.headline).toContain('等待结算');
    expect(runView.rewardLines.join(' ')).toContain('item.t2.lingsui');
    expect(isDungeonRunTimedOut(runResponse.run, new Date('2026-08-16T00:00:30.000Z'))).toBe(false);
  });
});
