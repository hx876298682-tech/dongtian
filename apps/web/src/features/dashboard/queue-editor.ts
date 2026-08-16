import type {
  Queue,
  QueueBlockedPolicy,
  QueueEntry,
  QueueMode,
  QueuePlanEntry,
  QueuePlanFallback,
  QueuePlanRequest,
  QueuePreview,
} from '@dongtian/contracts';

export type QueueEditorMode = Extract<QueueMode, 'COUNT' | 'DURATION' | 'INFINITE'>;

export interface QueueEditorEntryDraft {
  readonly clientEntryId: string;
  readonly actionId: string;
  readonly mode: QueueEditorMode;
  readonly targetValue: string;
  readonly onBlocked: QueueBlockedPolicy;
}

export interface QueueEditorDraft {
  readonly expectedQueueVersion: string;
  readonly entries: ReadonlyArray<QueueEditorEntryDraft>;
  readonly fallbackActionId: string;
}

export interface QueueVersionConflict {
  readonly expectedQueueVersion: string;
  readonly actualQueueVersion: string;
}

export interface QueueEditorState {
  readonly draft: QueueEditorDraft;
  readonly baselineFingerprint: string;
  readonly preview: QueuePreview | null;
  readonly previewFingerprint: string | null;
  readonly conflict: QueueVersionConflict | null;
  readonly lastSavedQueueVersion: string | null;
  readonly isDirty: boolean;
}

export type QueueEditorAction =
  | { readonly type: 'hydrate'; readonly queue: Queue }
  | { readonly type: 'set-expected-version'; readonly expectedQueueVersion: string }
  | { readonly type: 'add-entry'; readonly clientEntryId?: string; readonly afterClientEntryId?: string; readonly actionId?: string }
  | { readonly type: 'update-entry'; readonly clientEntryId: string; readonly patch: Partial<Pick<QueueEditorEntryDraft, 'actionId' | 'mode' | 'targetValue' | 'onBlocked'>> }
  | { readonly type: 'remove-entry'; readonly clientEntryId: string }
  | { readonly type: 'move-entry'; readonly clientEntryId: string; readonly direction: -1 | 1 }
  | { readonly type: 'set-fallback-action'; readonly actionId: string }
  | { readonly type: 'apply-preview'; readonly preview: QueuePreview; readonly fingerprint: string }
  | { readonly type: 'clear-preview' }
  | { readonly type: 'mark-conflict'; readonly conflict: QueueVersionConflict }
  | { readonly type: 'clear-conflict' }
  | { readonly type: 'mark-saved'; readonly queue: Queue };

export const DEFAULT_QUEUE_ACTION_ID = 'action.cultivation.qi';
export const DEFAULT_QUEUE_TARGET_VALUE = '1';
export const DEFAULT_FALLBACK_ACTION_ID = 'action.cultivation.qi';

export function createQueueEditorEntryDraft(clientEntryId: string, overrides: Partial<QueueEditorEntryDraft> = {}): QueueEditorEntryDraft {
  return {
    clientEntryId,
    actionId: overrides.actionId ?? DEFAULT_QUEUE_ACTION_ID,
    mode: overrides.mode ?? 'COUNT',
    targetValue: overrides.targetValue ?? DEFAULT_QUEUE_TARGET_VALUE,
    onBlocked: overrides.onBlocked ?? 'FALLBACK',
  };
}

export function createQueueEditorDraft(queueVersion: number | string = '0', entries: ReadonlyArray<QueueEditorEntryDraft> = []): QueueEditorDraft {
  return {
    expectedQueueVersion: String(queueVersion),
    entries,
    fallbackActionId: DEFAULT_FALLBACK_ACTION_ID,
  };
}

export function createQueueEditorState(queueVersion: number | string = '0'): QueueEditorState {
  const draft = createQueueEditorDraft(queueVersion);
  return {
    draft,
    baselineFingerprint: fingerprintDraft(draft),
    preview: null,
    previewFingerprint: null,
    conflict: null,
    lastSavedQueueVersion: String(queueVersion),
    isDirty: false,
  };
}

export function createQueuePlanRequest(draft: QueueEditorDraft): QueuePlanRequest {
  return {
    expected_queue_version: draft.expectedQueueVersion,
    entries: draft.entries.map((entry): QueuePlanEntry => {
      const plannedEntry: QueuePlanEntry = {
        client_entry_id: entry.clientEntryId,
        action_id: entry.actionId,
        mode: entry.mode,
        on_blocked: entry.onBlocked,
        ...(entry.mode !== 'INFINITE' && entry.targetValue.length > 0 ? { target_value: entry.targetValue } : {}),
      };

      return plannedEntry;
    }),
    fallback: {
      action_id: draft.fallbackActionId,
      mode: 'INFINITE',
    } satisfies QueuePlanFallback,
  };
}

export function fingerprintDraft(draft: QueueEditorDraft): string {
  return JSON.stringify({
    expectedQueueVersion: draft.expectedQueueVersion,
    entries: draft.entries.map((entry) => ({
      clientEntryId: entry.clientEntryId,
      actionId: entry.actionId,
      mode: entry.mode,
      targetValue: entry.targetValue,
      onBlocked: entry.onBlocked,
    })),
    fallbackActionId: draft.fallbackActionId,
  });
}

export function isPreviewFresh(state: QueueEditorState): boolean {
  return state.previewFingerprint === fingerprintDraft(state.draft);
}

function normalizeMode(mode: QueueMode): QueueEditorMode {
  if (mode === 'INFINITE') {
    return 'INFINITE';
  }

  if (mode === 'DURATION') {
    return 'DURATION';
  }

  return 'COUNT';
}

function queueEntryToDraft(entry: QueueEntry): QueueEditorEntryDraft {
  return {
    clientEntryId: entry.client_entry_id ?? entry.entry_id,
    actionId: entry.action_id,
    mode: normalizeMode(entry.mode),
    targetValue: entry.target_value ?? DEFAULT_QUEUE_TARGET_VALUE,
    onBlocked: entry.on_blocked,
  };
}

function insertEntry(entries: ReadonlyArray<QueueEditorEntryDraft>, entry: QueueEditorEntryDraft, afterClientEntryId?: string): ReadonlyArray<QueueEditorEntryDraft> {
  if (!afterClientEntryId) {
    return [...entries, entry];
  }

  const index = entries.findIndex((item) => item.clientEntryId === afterClientEntryId);
  if (index === -1) {
    return [...entries, entry];
  }

  return [...entries.slice(0, index + 1), entry, ...entries.slice(index + 1)];
}

function moveEntry(entries: ReadonlyArray<QueueEditorEntryDraft>, clientEntryId: string, direction: -1 | 1): ReadonlyArray<QueueEditorEntryDraft> {
  const index = entries.findIndex((item) => item.clientEntryId === clientEntryId);
  if (index === -1) {
    return entries;
  }

  const nextIndex = index + direction;
  if (nextIndex < 0 || nextIndex >= entries.length) {
    return entries;
  }

  const nextEntries = [...entries];
  const [entry] = nextEntries.splice(index, 1);
  if (entry === undefined) {
    return entries;
  }

  nextEntries.splice(nextIndex, 0, entry);
  return nextEntries;
}

export function queueEditorReducer(state: QueueEditorState, action: QueueEditorAction): QueueEditorState {
  switch (action.type) {
    case 'hydrate': {
      const draft = {
        expectedQueueVersion: String(action.queue.queue_version),
        entries: action.queue.entries.map(queueEntryToDraft),
        fallbackActionId: action.queue.fallback.action_id,
      };

      return {
        draft,
        baselineFingerprint: fingerprintDraft(draft),
        preview: null,
        previewFingerprint: null,
        conflict: null,
        lastSavedQueueVersion: String(action.queue.queue_version),
        isDirty: false,
      };
    }
    case 'set-expected-version': {
      const draft = {
        ...state.draft,
        expectedQueueVersion: action.expectedQueueVersion,
      };

      return {
        ...state,
        draft,
        isDirty: fingerprintDraft(draft) !== state.baselineFingerprint,
      };
    }
    case 'add-entry': {
      const actionIdPatch = action.actionId === undefined ? {} : { actionId: action.actionId };
      const draft = {
        ...state.draft,
        entries: insertEntry(
          state.draft.entries,
          createQueueEditorEntryDraft(action.clientEntryId ?? `tmp-${crypto.randomUUID()}`, actionIdPatch),
          action.afterClientEntryId,
        ),
      };

      return {
        ...state,
        draft,
        preview: null,
        previewFingerprint: null,
        conflict: null,
        isDirty: true,
      };
    }
    case 'update-entry': {
      const draft = {
        ...state.draft,
        entries: state.draft.entries.map((entry) =>
          entry.clientEntryId === action.clientEntryId ? { ...entry, ...action.patch } : entry,
        ),
      };

      return {
        ...state,
        draft,
        preview: null,
        previewFingerprint: null,
        conflict: null,
        isDirty: true,
      };
    }
    case 'remove-entry': {
      const draft = {
        ...state.draft,
        entries: state.draft.entries.filter((entry) => entry.clientEntryId !== action.clientEntryId),
      };

      return {
        ...state,
        draft,
        preview: null,
        previewFingerprint: null,
        conflict: null,
        isDirty: true,
      };
    }
    case 'move-entry': {
      const draft = {
        ...state.draft,
        entries: moveEntry(state.draft.entries, action.clientEntryId, action.direction),
      };

      return {
        ...state,
        draft,
        preview: null,
        previewFingerprint: null,
        conflict: null,
        isDirty: true,
      };
    }
    case 'set-fallback-action': {
      const draft = {
        ...state.draft,
        fallbackActionId: action.actionId,
      };

      return {
        ...state,
        draft,
        preview: null,
        previewFingerprint: null,
        conflict: null,
        isDirty: true,
      };
    }
    case 'apply-preview':
      return {
        ...state,
        preview: action.preview,
        previewFingerprint: action.fingerprint,
        conflict: null,
      };
    case 'clear-preview':
      return {
        ...state,
        preview: null,
        previewFingerprint: null,
      };
    case 'mark-conflict':
      return {
        ...state,
        conflict: action.conflict,
      };
    case 'clear-conflict':
      return {
        ...state,
        conflict: null,
      };
    case 'mark-saved': {
      const nextDraft = {
        expectedQueueVersion: String(action.queue.queue_version),
        entries: action.queue.entries.map(queueEntryToDraft),
        fallbackActionId: action.queue.fallback.action_id,
      };

      return {
        draft: nextDraft,
        baselineFingerprint: fingerprintDraft(nextDraft),
        preview: null,
        previewFingerprint: null,
        conflict: null,
        lastSavedQueueVersion: String(action.queue.queue_version),
        isDirty: false,
      };
    }
    default:
      return state;
  }
}

export function createInitialQueueEditorState(queueVersion: number | string = '0'): QueueEditorState {
  return createQueueEditorState(queueVersion);
}

export function buildQueueEditorPreviewLabel(preview: QueuePreview | null): string {
  if (preview === null) {
    return '尚未预览';
  }

  return `总时长 ${preview.total_duration_us ?? '未知'} µs · ${preview.entries.length} 段`;
}
