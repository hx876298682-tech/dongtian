import { describe, expect, it } from 'vitest';

import {
  createInitialQueueEditorState,
  createQueueEditorDraft,
  createQueuePlanRequest,
  fingerprintDraft,
  isPreviewFresh,
  queueEditorReducer,
} from './queue-editor.js';

describe('queue editor reducer', () => {
  it('adds, reorders, removes, and fingerprints entries without losing fallback', () => {
    const initialState = createInitialQueueEditorState('7');
    const withOneEntry = queueEditorReducer(initialState, { type: 'add-entry', clientEntryId: 'tmp-1', actionId: 'action.t1.herb_baicao_valley' });
    const withTwoEntries = queueEditorReducer(withOneEntry, { type: 'add-entry', clientEntryId: 'tmp-2' });
    const moved = queueEditorReducer(withTwoEntries, { type: 'move-entry', clientEntryId: 'tmp-2', direction: -1 });
    const removed = queueEditorReducer(moved, { type: 'remove-entry', clientEntryId: 'tmp-1' });

    expect(removed.draft.expectedQueueVersion).toBe('7');
    expect(removed.draft.fallbackActionId).toBe('action.cultivation.qi');
    expect(removed.draft.entries).toHaveLength(1);
    expect(removed.draft.entries[0]?.clientEntryId).toBe('tmp-2');
    expect(withOneEntry.draft.entries[0]?.actionId).toBe('action.t1.herb_baicao_valley');
    expect(removed.isDirty).toBe(true);
    expect(fingerprintDraft(removed.draft)).toContain('tmp-2');
  });

  it('builds a request payload and keeps preview freshness aligned with the draft', () => {
    const draft = createQueueEditorDraft('11', [
      {
        clientEntryId: 'tmp-1',
        actionId: 'action.t1.herb_baicao_valley',
        mode: 'COUNT',
        targetValue: '2',
        onBlocked: 'FALLBACK',
      },
      {
        clientEntryId: 'tmp-2',
        actionId: 'action.cultivation.qi',
        mode: 'INFINITE',
        targetValue: '',
        onBlocked: 'FALLBACK',
      },
    ]);

    const request = createQueuePlanRequest(draft);

    expect(request.expected_queue_version).toBe('11');
    expect(request.entries).toHaveLength(2);
    expect(request.entries[0]?.target_value).toBe('2');
    expect(request.entries[1]?.target_value).toBeUndefined();
    expect(isPreviewFresh({ draft, baselineFingerprint: fingerprintDraft(draft), preview: null, previewFingerprint: fingerprintDraft(draft), conflict: null, lastSavedQueueVersion: null, isDirty: false })).toBe(true);
  });
});
