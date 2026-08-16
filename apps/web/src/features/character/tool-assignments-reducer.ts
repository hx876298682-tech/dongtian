import type { SkillToolAssignmentsResponse, SkillToolAssignmentsSaveRequest } from '@dongtian/contracts';

export interface ToolAssignmentDraftEntry {
  readonly skillId: string;
  readonly equipmentInstanceId: string | null;
}

export interface ToolAssignmentDraft {
  readonly expectedStateVersion: string;
  readonly selectedSkillId: string | null;
  readonly entries: ReadonlyArray<ToolAssignmentDraftEntry>;
}

export interface ToolAssignmentVersionConflict {
  readonly expectedStateVersion: string;
  readonly actualStateVersion: string;
}

export interface ToolAssignmentEditorState {
  readonly draft: ToolAssignmentDraft | null;
  readonly baselineFingerprint: string | null;
  readonly conflict: ToolAssignmentVersionConflict | null;
  readonly lastSavedStateVersion: string | null;
  readonly isDirty: boolean;
}

export type ToolAssignmentEditorAction =
  | { readonly type: 'reset' }
  | { readonly type: 'hydrate'; readonly response: SkillToolAssignmentsResponse }
  | { readonly type: 'select-skill'; readonly skillId: string }
  | { readonly type: 'set-assignment'; readonly skillId: string; readonly equipmentInstanceId: string | null }
  | { readonly type: 'mark-conflict'; readonly conflict: ToolAssignmentVersionConflict }
  | { readonly type: 'clear-conflict' }
  | { readonly type: 'mark-saved'; readonly response: SkillToolAssignmentsResponse };

function fingerprintDraft(draft: ToolAssignmentDraft): string {
  return JSON.stringify({
    expectedStateVersion: draft.expectedStateVersion,
    selectedSkillId: draft.selectedSkillId,
    entries: draft.entries,
  });
}

function buildDraft(response: SkillToolAssignmentsResponse): ToolAssignmentDraft {
  const entries = response.assignments.map((assignment) => ({
    skillId: assignment.skill_id,
    equipmentInstanceId: assignment.current?.equipment_instance_id ?? null,
  }));

  return {
    expectedStateVersion: String(response.state_version),
    selectedSkillId: response.assignments[0]?.skill_id ?? null,
    entries,
  };
}

export function createInitialToolAssignmentEditorState(): ToolAssignmentEditorState {
  return {
    draft: null,
    baselineFingerprint: null,
    conflict: null,
    lastSavedStateVersion: null,
    isDirty: false,
  };
}

export function createToolAssignmentEditorState(response: SkillToolAssignmentsResponse): ToolAssignmentEditorState {
  const draft = buildDraft(response);
  return {
    draft,
    baselineFingerprint: fingerprintDraft(draft),
    conflict: null,
    lastSavedStateVersion: String(response.state_version),
    isDirty: false,
  };
}

function updateDraft(
  state: ToolAssignmentEditorState,
  updater: (draft: ToolAssignmentDraft) => ToolAssignmentDraft,
): ToolAssignmentEditorState {
  if (state.draft === null) {
    return state;
  }

  const draft = updater(state.draft);
  return {
    ...state,
    draft,
    isDirty: state.baselineFingerprint !== fingerprintDraft(draft),
  };
}

export function toolAssignmentEditorReducer(
  state: ToolAssignmentEditorState,
  action: ToolAssignmentEditorAction,
): ToolAssignmentEditorState {
  switch (action.type) {
    case 'reset':
      return createInitialToolAssignmentEditorState();
    case 'hydrate':
      return createToolAssignmentEditorState(action.response);
    case 'select-skill':
      return updateDraft(state, (draft) => ({ ...draft, selectedSkillId: action.skillId }));
    case 'set-assignment':
      return updateDraft(state, (draft) => ({
        ...draft,
        entries: draft.entries.map((entry) => (entry.skillId === action.skillId ? { ...entry, equipmentInstanceId: action.equipmentInstanceId } : entry)),
        selectedSkillId: action.skillId,
      }));
    case 'mark-conflict':
      return { ...state, conflict: action.conflict };
    case 'clear-conflict':
      return { ...state, conflict: null };
    case 'mark-saved':
      return createToolAssignmentEditorState(action.response);
    default:
      return state;
  }
}

export function createToolAssignmentsSaveRequest(draft: ToolAssignmentDraft): SkillToolAssignmentsSaveRequest {
  return {
    expected_state_version: draft.expectedStateVersion,
    assignments: draft.entries.map((entry) => ({
      skill_id: entry.skillId,
      equipment_instance_id: entry.equipmentInstanceId,
    })),
  };
}

export function findToolAssignmentEntry(draft: ToolAssignmentDraft | null, skillId: string): ToolAssignmentDraftEntry | null {
  if (draft === null) {
    return null;
  }

  return draft.entries.find((entry) => entry.skillId === skillId) ?? null;
}

