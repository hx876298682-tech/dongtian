import { describe, expect, it } from 'vitest';

import type { SkillToolAssignmentsResponse } from '@dongtian/contracts';

import {
  summarizeToolAssignmentDetail,
  summarizeToolAssignmentSkill,
  summarizeToolAssignmentsHero,
} from './tool-assignments-adapter.js';

const response: SkillToolAssignmentsResponse = {
  character_id: 'character-1',
  state_version: 7,
  config_version: '2026.08.16.1',
  as_of: '2026-08-16T00:00:00.000Z',
  assignments: [
    {
      skill_id: 'skill.mining',
      current: {
        equipment_instance_id: 'tool-1',
        item_id: 'item.t1.mining_tool',
        item_name_key: '玄铁镐',
        source_note: '矿脉',
        required_realm: 'realm.qi.early',
        required_tags: ['tool'],
        tool_tag: 'mining_tool',
        speed_multiplier: '1.00',
        efficiency_multiplier: '1.00',
        cycles_per_hour: '60',
        effective_throughput_per_hour: '60',
        source_routes: [
          { route_type: 'ACTION', target_id: 'action.t1.ore_chitong_kuang', name_key: 'x', description_key: null, source_note: '采矿' },
        ],
        usage_routes: [
          { route_type: 'RECIPE', target_id: 'recipe.t1.mining_tool', name_key: 'y', description_key: null, source_note: '炼器' },
        ],
        comparison: null,
      },
      options: [
        {
          equipment_instance_id: 'tool-1',
          item_id: 'item.t1.mining_tool',
          item_name_key: '玄铁镐',
          source_note: '矿脉',
          required_realm: 'realm.qi.early',
          required_tags: ['tool'],
          tool_tag: 'mining_tool',
          speed_multiplier: '1.00',
          efficiency_multiplier: '1.00',
          cycles_per_hour: '60',
          effective_throughput_per_hour: '60',
          source_routes: [],
          usage_routes: [],
          comparison: null,
        },
      ],
    },
  ],
};

describe('tool assignments adapter', () => {
  it('summarizes hero, skill and detail views without price data', () => {
    const hero = summarizeToolAssignmentsHero(response, 'realm.qi.early');
    const skill = response.assignments[0];
    expect(skill).toBeDefined();
    const currentSkill = skill!;

    expect(hero.simplifiedMode).toBe(true);
    expect(hero.facts[0]?.value).toBe('1');
    expect(summarizeToolAssignmentSkill(currentSkill, currentSkill.options[0] ?? null).label).toBe('采矿');
    expect(summarizeToolAssignmentDetail(currentSkill, currentSkill.options[0] ?? null, true).currentSummary).toContain('玄铁镐');
  });
});
