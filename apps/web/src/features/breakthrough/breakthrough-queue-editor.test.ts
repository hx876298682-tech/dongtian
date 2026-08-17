import { describe, expect, it } from 'vitest';

import {
  createBreakthroughQueueDraft,
  setBreakthroughQueueEntryMode,
  updateBreakthroughQueueEntry,
  toBreakthroughQueuePlan,
} from './breakthrough-queue-editor.js';

describe('breakthrough queue editor', () => {
  it('creates the official gather-to-inventory-to-cultivation template with three slots', () => {
    const draft = createBreakthroughQueueDraft('4');
    const request = toBreakthroughQueuePlan(draft);

    expect(request.entries).toHaveLength(3);
    expect(request.entries[0]).toMatchObject({
      mode: 'UNTIL_INVENTORY',
      condition_item_id: 'item.t1.qingling_herb',
      condition_operator: '>=',
      action_id: 'action.t1.herb_baicao_valley',
    });
    expect(request.entries[1]).toMatchObject({
      mode: 'UNTIL_INVENTORY',
      condition_item_id: 'item.t1.qi_gathering_pill',
      condition_operator: '>=',
      action_id: 'action.t1.qi_gathering_pill',
    });
    expect(request.entries[2]).toMatchObject({
      action_id: 'action.cultivation.qi',
      mode: 'INFINITE',
    });
    expect(request.fallback.mode).toBe('INFINITE');
  });

  it('rejects more than three entries and does not emit unsupported boolean conditions', () => {
    const draft = createBreakthroughQueueDraft('4');
    expect(() =>
      toBreakthroughQueuePlan({ ...draft, entries: [...draft.entries, ...draft.entries] }),
    ).toThrow('THREE_QUEUE_SLOTS');
    expect(
      toBreakthroughQueuePlan(draft).entries.every(
        (entry) =>
          entry.condition_operator === undefined ||
          entry.condition_operator === '>=' ||
          entry.condition_operator === '<',
      ),
    ).toBe(true);
  });

  it('hydrates an existing queue and retains editable conditions', () => {
    const draft = createBreakthroughQueueDraft({
      queue_version: 8,
      paused: false,
      pending_replace_after_cycle: false,
      fallback: { action_id: 'action.cultivation.qi', mode: 'INFINITE' },
      current: null,
      entries: [
        {
          entry_id: 'entry-1',
          client_entry_id: 'client-1',
          position: 0,
          action_id: 'action.t1.herb_baicao_valley',
          mode: 'UNTIL_INVENTORY',
          target_value: '7',
          condition_item_id: 'item.t1.qingling_herb',
          condition_operator: '>=',
          on_blocked: 'FALLBACK',
          status: 'QUEUED',
          completed_cycles: '0',
          progress_time_us: '0',
          snapshot_config_version: null,
        },
      ],
      as_of: '2026-08-17T00:00:00.000Z',
    });

    expect(draft.expected_queue_version).toBe('8');
    expect(draft.entries).toHaveLength(1);
    expect(draft.entries[0]).toMatchObject({
      action_id: 'action.t1.herb_baicao_valley',
      condition_item_id: 'item.t1.qingling_herb',
      target_value: '7',
    });
  });

  it('updates an entry without changing the other slots', () => {
    const draft = createBreakthroughQueueDraft('4');
    const updated = updateBreakthroughQueueEntry(draft, 'foundation-pill', {
      condition_item_id: 'item.t1.qingling_herb',
      target_value: '5',
      condition_operator: '<',
    });
    expect(updated.entries[0]).toMatchObject({
      condition_item_id: 'item.t1.qingling_herb',
      target_value: '5',
      condition_operator: '<',
    });
    expect(updated.entries[1]).toMatchObject({ client_entry_id: 'lingsui' });
  });

  it('limits mode changes to the supported inventory and infinite shapes', () => {
    const draft = createBreakthroughQueueDraft('4');
    const updated = setBreakthroughQueueEntryMode(draft, 'foundation-pill', 'INFINITE');

    expect(updated.entries[0]).toEqual({
      client_entry_id: 'foundation-pill',
      action_id: 'action.t1.herb_baicao_valley',
      mode: 'INFINITE',
      on_blocked: 'FALLBACK',
    });
    expect(toBreakthroughQueuePlan(updated).entries[0]).not.toHaveProperty('target_value');
    expect(toBreakthroughQueuePlan(updated).entries[0]).not.toHaveProperty('condition_item_id');
  });
});
