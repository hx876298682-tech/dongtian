import { describe, expect, it } from 'vitest';

import { createEquipmentEditorState, createLoadoutSaveRequest, equipmentEditorReducer } from './equipment-editor.js';

describe('equipment editor reducer', () => {
  it('hydrates, edits, and preserves state version tracking', () => {
    const hydrated = equipmentEditorReducer(createEquipmentEditorState({
      character_id: 'character-1',
      preset_id: 'preset-1',
      name: '均衡',
      active: false,
      complete: false,
      state_version: 7,
      weapon_instance_id: 'weapon-1',
      armor_instance_id: null,
      accessory_instance_id: null,
      combat_consumables: [{ item_id: 'item.t1.qi', quantity: '2' }],
      strategy_id: 'strategy.safe',
      version: '1',
    }), {
      type: 'set-slot-instance',
      slot: 'ARMOR',
      instanceId: 'armor-1',
    });

    expect(hydrated.isDirty).toBe(true);
    expect(hydrated.draft?.armorInstanceId).toBe('armor-1');
    expect(hydrated.draft).not.toBeNull();
    expect(createLoadoutSaveRequest(hydrated.draft!)).toMatchObject({
      expected_state_version: '7',
      armor_instance_id: 'armor-1',
    });
  });

  it('resets after a saved preset returns authoritative values', () => {
    const nextState = equipmentEditorReducer(createEquipmentEditorState({
      character_id: 'character-1',
      preset_id: 'preset-1',
      name: '均衡',
      active: false,
      complete: true,
      state_version: 7,
      weapon_instance_id: 'weapon-1',
      armor_instance_id: 'armor-1',
      accessory_instance_id: 'accessory-1',
      combat_consumables: [],
      strategy_id: 'strategy.safe',
      version: '1',
    }), {
      type: 'mark-saved',
      preset: {
        character_id: 'character-1',
        preset_id: 'preset-1',
        name: '均衡',
        active: true,
        complete: true,
        effective_next_cycle: true,
        state_version: 8,
        weapon_instance_id: 'weapon-1',
        armor_instance_id: 'armor-1',
        accessory_instance_id: 'accessory-1',
        combat_consumables: [],
        strategy_id: 'strategy.safe',
        version: '2',
      },
    });

    expect(nextState.isDirty).toBe(false);
    expect(nextState.lastSavedStateVersion).toBe('8');
    expect(nextState.draft?.expectedStateVersion).toBe('8');
  });
});
