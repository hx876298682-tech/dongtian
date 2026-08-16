import { describe, expect, it } from 'vitest';

import { createToolAssignmentEditorState, createToolAssignmentsSaveRequest, toolAssignmentEditorReducer } from './tool-assignments-reducer.js';

const response = {
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
        item_name_key: 'tool.mining',
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
      options: [],
    },
  ],
} as const;

describe('tool assignment reducer', () => {
  it('hydrates and serializes tool assignments without mutating inventory state', () => {
    const state = createToolAssignmentEditorState(response);
    expect(state.draft?.selectedSkillId).toBe('skill.mining');

    const next = toolAssignmentEditorReducer(state, {
      type: 'set-assignment',
      skillId: 'skill.mining',
      equipmentInstanceId: null,
    });

    expect(next.isDirty).toBe(true);
    expect(next.draft?.entries[0]?.equipmentInstanceId).toBeNull();
    expect(createToolAssignmentsSaveRequest(next.draft!)).toMatchObject({
      expected_state_version: '7',
      assignments: [{ skill_id: 'skill.mining', equipment_instance_id: null }],
    });
  });

  it('tracks the selected skill and resets on saved authority', () => {
    const hydrated = createToolAssignmentEditorState(response);
    const next = toolAssignmentEditorReducer(hydrated, {
      type: 'select-skill',
      skillId: 'skill.mining',
    });

    expect(next.draft?.selectedSkillId).toBe('skill.mining');
  });
});

