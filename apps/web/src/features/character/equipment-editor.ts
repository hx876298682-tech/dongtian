import type { EquipmentSlot, LoadoutConsumable, LoadoutPreset } from '@dongtian/contracts';

export interface EquipmentEditorDraft {
  readonly presetId: string;
  readonly expectedStateVersion: string;
  readonly name: string;
  readonly weaponInstanceId: string | null;
  readonly armorInstanceId: string | null;
  readonly accessoryInstanceId: string | null;
  readonly combatConsumables: ReadonlyArray<LoadoutConsumable>;
  readonly strategyId: string;
}

export interface EquipmentVersionConflict {
  readonly expectedStateVersion: string;
  readonly actualStateVersion: string;
}

export interface EquipmentEditorState {
  readonly draft: EquipmentEditorDraft | null;
  readonly baselineFingerprint: string | null;
  readonly conflict: EquipmentVersionConflict | null;
  readonly lastSavedStateVersion: string | null;
  readonly isDirty: boolean;
}

export type EquipmentEditorAction =
  | { readonly type: 'reset' }
  | { readonly type: 'hydrate'; readonly preset: LoadoutPreset }
  | { readonly type: 'set-name'; readonly name: string }
  | { readonly type: 'set-slot-instance'; readonly slot: EquipmentSlot; readonly instanceId: string | null }
  | { readonly type: 'set-strategy'; readonly strategyId: string }
  | { readonly type: 'set-expected-state-version'; readonly expectedStateVersion: string }
  | { readonly type: 'mark-conflict'; readonly conflict: EquipmentVersionConflict }
  | { readonly type: 'clear-conflict' }
  | { readonly type: 'mark-saved'; readonly preset: LoadoutPreset };

export const DEFAULT_LOADOUT_NAME = '均衡预设';
export const DEFAULT_STRATEGY_ID = 'strategy.safe';

function presetToDraft(preset: LoadoutPreset): EquipmentEditorDraft {
  return {
    presetId: preset.preset_id,
    expectedStateVersion: String(preset.state_version),
    name: preset.name,
    weaponInstanceId: preset.weapon_instance_id,
    armorInstanceId: preset.armor_instance_id,
    accessoryInstanceId: preset.accessory_instance_id,
    combatConsumables: preset.combat_consumables,
    strategyId: preset.strategy_id,
  };
}

function fingerprintDraft(draft: EquipmentEditorDraft): string {
  return JSON.stringify({
    presetId: draft.presetId,
    expectedStateVersion: draft.expectedStateVersion,
    name: draft.name,
    weaponInstanceId: draft.weaponInstanceId,
    armorInstanceId: draft.armorInstanceId,
    accessoryInstanceId: draft.accessoryInstanceId,
    combatConsumables: draft.combatConsumables,
    strategyId: draft.strategyId,
  });
}

export function createInitialEquipmentEditorState(): EquipmentEditorState {
  return {
    draft: null,
    baselineFingerprint: null,
    conflict: null,
    lastSavedStateVersion: null,
    isDirty: false,
  };
}

export function createEquipmentEditorState(preset: LoadoutPreset): EquipmentEditorState {
  const draft = presetToDraft(preset);
  return {
    draft,
    baselineFingerprint: fingerprintDraft(draft),
    conflict: null,
    lastSavedStateVersion: String(preset.state_version),
    isDirty: false,
  };
}

export function equipmentEditorReducer(state: EquipmentEditorState, action: EquipmentEditorAction): EquipmentEditorState {
  switch (action.type) {
    case 'reset':
      return createInitialEquipmentEditorState();
    case 'hydrate': {
      return createEquipmentEditorState(action.preset);
    }
    case 'set-name': {
      if (state.draft === null) {
        return state;
      }
      const draft = { ...state.draft, name: action.name };
      return {
        ...state,
        draft,
        isDirty: state.baselineFingerprint !== fingerprintDraft(draft),
      };
    }
    case 'set-slot-instance': {
      if (state.draft === null) {
        return state;
      }
      const draft = {
        ...state.draft,
        weaponInstanceId: action.slot === 'WEAPON' ? action.instanceId : state.draft.weaponInstanceId,
        armorInstanceId: action.slot === 'ARMOR' ? action.instanceId : state.draft.armorInstanceId,
        accessoryInstanceId: action.slot === 'ACCESSORY' ? action.instanceId : state.draft.accessoryInstanceId,
      };
      return {
        ...state,
        draft,
        conflict: null,
        isDirty: state.baselineFingerprint !== fingerprintDraft(draft),
      };
    }
    case 'set-strategy': {
      if (state.draft === null) {
        return state;
      }
      const draft = { ...state.draft, strategyId: action.strategyId };
      return {
        ...state,
        draft,
        isDirty: state.baselineFingerprint !== fingerprintDraft(draft),
      };
    }
    case 'set-expected-state-version': {
      if (state.draft === null) {
        return state;
      }
      const draft = { ...state.draft, expectedStateVersion: action.expectedStateVersion };
      return {
        ...state,
        draft,
        isDirty: state.baselineFingerprint !== fingerprintDraft(draft),
      };
    }
    case 'mark-conflict':
      return { ...state, conflict: action.conflict };
    case 'clear-conflict':
      return { ...state, conflict: null };
    case 'mark-saved': {
      const draft = presetToDraft(action.preset);
      return {
        draft,
        baselineFingerprint: fingerprintDraft(draft),
        conflict: null,
        lastSavedStateVersion: String(action.preset.state_version),
        isDirty: false,
      };
    }
    default:
      return state;
  }
}

export function createLoadoutSaveRequest(draft: EquipmentEditorDraft) {
  return {
    expected_state_version: draft.expectedStateVersion,
    name: draft.name,
    weapon_instance_id: draft.weaponInstanceId,
    armor_instance_id: draft.armorInstanceId,
    accessory_instance_id: draft.accessoryInstanceId,
    combat_consumables: draft.combatConsumables,
    strategy_id: draft.strategyId,
  } as const;
}

export function isLoadoutComplete(draft: EquipmentEditorDraft | null): boolean {
  if (draft === null) {
    return false;
  }

  return draft.weaponInstanceId !== null && draft.armorInstanceId !== null && draft.accessoryInstanceId !== null;
}
