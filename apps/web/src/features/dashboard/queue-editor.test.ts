import { describe, expect, it } from 'vitest';

import {
  createInitialQueueEditorState,
  createQueueEditorDraft,
  createOfficialInventoryQueueDraft,
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
        conditionItemId: '',
        conditionOperator: '>=',
        onBlocked: 'FALLBACK',
      },
      {
        clientEntryId: 'tmp-2',
        actionId: 'action.cultivation.qi',
        mode: 'INFINITE',
        targetValue: '',
        conditionItemId: '',
        conditionOperator: '>=',
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

  it('round-trips a single inventory condition through the editor request', () => {
    const queueEntry = {
      client_entry_id: 'tmp-inventory',
      action_id: 'action.t1.herb_baicao_valley',
      mode: 'UNTIL_INVENTORY',
      target_value: '20',
      condition_item_id: 'item.t1.qingling_herb',
      condition_operator: '>=',
      on_blocked: 'FALLBACK',
    } as const;
    const queue = {
      queue_version: 3,
      paused: false,
      pending_replace_after_cycle: false,
      fallback: { action_id: 'action.cultivation.qi', mode: 'INFINITE' },
      current: null,
      entries: [{
        entry_id: 'entry-inventory',
        ...queueEntry,
        position: 0,
        status: 'QUEUED',
        completed_cycles: '0',
        progress_time_us: '0',
        snapshot_config_version: null,
      }],
      as_of: '2026-08-17T00:00:00.000Z',
    } as const;

    const state = queueEditorReducer(createInitialQueueEditorState(), { type: 'hydrate', queue });
    expect(state.draft.entries[0]).toMatchObject({
      mode: 'UNTIL_INVENTORY',
      conditionItemId: 'item.t1.qingling_herb',
      conditionOperator: '>=',
    });
    expect(createQueuePlanRequest(state.draft).entries[0]).toMatchObject(queueEntry);
  });

  it('builds the official harvest-to-refine-to-cultivate template', () => {
    const draft = createOfficialInventoryQueueDraft('8', '20', '10');

    expect(draft).toMatchObject({
      expectedQueueVersion: '8',
      fallbackActionId: 'action.cultivation.qi',
      entries: [
        {
          actionId: 'action.t1.herb_baicao_valley',
          mode: 'UNTIL_INVENTORY',
          targetValue: '20',
          conditionItemId: 'item.t1.qingling_herb',
          conditionOperator: '>=',
        },
        {
          actionId: 'action.t1.qi_gathering_pill',
          mode: 'UNTIL_INVENTORY',
          targetValue: '10',
          conditionItemId: 'item.t1.qi_gathering_pill',
          conditionOperator: '>=',
        },
        { actionId: 'action.cultivation.qi', mode: 'INFINITE' },
      ],
    });
  });
});
