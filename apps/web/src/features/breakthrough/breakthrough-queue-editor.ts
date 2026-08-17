import type { Queue, QueuePlanEntry, QueuePlanRequest } from '@dongtian/contracts';

export interface BreakthroughQueueEntryDraft extends QueuePlanEntry {
  readonly client_entry_id: string;
}

export interface BreakthroughQueueDraft {
  readonly expected_queue_version: string;
  readonly entries: ReadonlyArray<BreakthroughQueueEntryDraft>;
  readonly fallback_action_id: string;
}

export type BreakthroughQueueMode = Extract<QueuePlanEntry['mode'], 'UNTIL_INVENTORY' | 'INFINITE'>;

const DEFAULT_ACTION = 'action.cultivation.qi';

function createOfficialBreakthroughQueueDraft(
  queueVersion: number | string,
): BreakthroughQueueDraft {
  return {
    expected_queue_version: String(queueVersion),
    fallback_action_id: DEFAULT_ACTION,
    entries: [
      {
        client_entry_id: 'foundation-pill',
        action_id: 'action.t1.herb_baicao_valley',
        mode: 'UNTIL_INVENTORY',
        condition_item_id: 'item.t1.qingling_herb',
        condition_operator: '>=',
        target_value: '3',
        on_blocked: 'FALLBACK',
      },
      {
        client_entry_id: 'lingsui',
        action_id: 'action.t1.qi_gathering_pill',
        mode: 'UNTIL_INVENTORY',
        condition_item_id: 'item.t1.qi_gathering_pill',
        condition_operator: '>=',
        target_value: '1',
        on_blocked: 'FALLBACK',
      },
      {
        client_entry_id: 'cultivation',
        action_id: DEFAULT_ACTION,
        mode: 'INFINITE',
        on_blocked: 'FALLBACK',
      },
    ],
  };
}

export function createBreakthroughQueueDraft(
  queueOrVersion: Queue | number | string,
): BreakthroughQueueDraft {
  if (typeof queueOrVersion === 'number' || typeof queueOrVersion === 'string') {
    return createOfficialBreakthroughQueueDraft(queueOrVersion);
  }
  return {
    expected_queue_version: String(queueOrVersion.queue_version),
    fallback_action_id: queueOrVersion.fallback.action_id,
    entries: queueOrVersion.entries.slice(0, 3).map((entry) => ({
      client_entry_id: entry.client_entry_id ?? entry.entry_id,
      action_id: entry.action_id,
      mode: entry.mode,
      on_blocked: entry.on_blocked,
      ...(entry.target_value === null ? {} : { target_value: entry.target_value }),
      ...(entry.condition_item_id === null ? {} : { condition_item_id: entry.condition_item_id }),
      ...(entry.condition_operator === null
        ? {}
        : { condition_operator: entry.condition_operator }),
    })),
  };
}

export function updateBreakthroughQueueEntry(
  draft: BreakthroughQueueDraft,
  clientEntryId: string,
  patch: Partial<Omit<BreakthroughQueueEntryDraft, 'client_entry_id'>>,
): BreakthroughQueueDraft {
  return {
    ...draft,
    entries: draft.entries.map((entry) =>
      entry.client_entry_id === clientEntryId ? { ...entry, ...patch } : entry,
    ),
  };
}

export function setBreakthroughQueueEntryMode(
  draft: BreakthroughQueueDraft,
  clientEntryId: string,
  mode: BreakthroughQueueMode,
): BreakthroughQueueDraft {
  return {
    ...draft,
    entries: draft.entries.map((entry) => {
      if (entry.client_entry_id !== clientEntryId) return entry;
      if (mode === 'UNTIL_INVENTORY') return { ...entry, mode };
      return {
        client_entry_id: entry.client_entry_id,
        action_id: entry.action_id,
        mode,
        on_blocked: entry.on_blocked,
      };
    }),
  };
}

export function removeBreakthroughQueueEntry(
  draft: BreakthroughQueueDraft,
  clientEntryId: string,
): BreakthroughQueueDraft {
  return {
    ...draft,
    entries: draft.entries.filter((entry) => entry.client_entry_id !== clientEntryId),
  };
}

export function moveBreakthroughQueueEntry(
  draft: BreakthroughQueueDraft,
  clientEntryId: string,
  direction: -1 | 1,
): BreakthroughQueueDraft {
  const index = draft.entries.findIndex((entry) => entry.client_entry_id === clientEntryId);
  const nextIndex = index + direction;
  if (index < 0 || nextIndex < 0 || nextIndex >= draft.entries.length) return draft;
  const entries = [...draft.entries];
  const [entry] = entries.splice(index, 1);
  if (entry === undefined) return draft;
  entries.splice(nextIndex, 0, entry);
  return { ...draft, entries };
}

export function appendBreakthroughQueueEntry(
  draft: BreakthroughQueueDraft,
  entry: BreakthroughQueueEntryDraft,
): BreakthroughQueueDraft {
  if (draft.entries.length >= 3) throw new Error('THREE_QUEUE_SLOTS');
  return { ...draft, entries: [...draft.entries, entry] };
}

export function toBreakthroughQueuePlan(draft: BreakthroughQueueDraft): QueuePlanRequest {
  if (draft.entries.length > 3) {
    throw new Error('THREE_QUEUE_SLOTS');
  }
  return {
    expected_queue_version: draft.expected_queue_version,
    entries: draft.entries.map((entry) => ({
      client_entry_id: entry.client_entry_id,
      action_id: entry.action_id,
      mode: entry.mode,
      on_blocked: entry.on_blocked,
      ...(entry.mode === 'UNTIL_INVENTORY'
        ? {
            condition_item_id: entry.condition_item_id,
            condition_operator: entry.condition_operator,
            target_value: entry.target_value,
          }
        : {}),
    })),
    fallback: { action_id: draft.fallback_action_id, mode: 'INFINITE' },
  };
}
