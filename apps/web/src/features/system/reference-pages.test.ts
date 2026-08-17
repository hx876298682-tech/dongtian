import { describe, expect, it } from 'vitest';
import type { Queue, QueueEntry, QueueEntryStatus } from '@dongtian/contracts';

import { selectTaskItemsByTab } from './reference-pages.js';

// These reference pages are intentionally tested as a source contract because the
// web package does not ship a DOM test renderer.
import referencePagesSource from './reference-pages.tsx?raw';

function createQueueEntry(entryId: string, status: QueueEntryStatus, overrides: Partial<QueueEntry> = {}): QueueEntry {
  return {
    entry_id: entryId,
    client_entry_id: null,
    position: 0,
    action_id: 'action.cultivation.qi',
    mode: 'INFINITE',
    target_value: null,
    condition_item_id: null,
    condition_operator: null,
    on_blocked: 'SKIP',
    status,
    completed_cycles: '0',
    progress_time_us: '0',
    snapshot_config_version: null,
    ...overrides,
  };
}

const queueFixture: Queue = {
  queue_version: '3',
  paused: false,
  pending_replace_after_cycle: false,
  fallback: { action_id: 'action.cultivation.qi', mode: 'INFINITE' },
  current: createQueueEntry('running', 'RUNNING', { position: 0, completed_cycles: '2' }),
  entries: [
    createQueueEntry('running', 'RUNNING', { position: 0, completed_cycles: '2' }),
    createQueueEntry('queued', 'QUEUED', { position: 1, mode: 'COUNT', target_value: '3' }),
    createQueueEntry('done', 'DONE', { position: 2, mode: 'COUNT', target_value: '5', completed_cycles: '5' }),
    createQueueEntry('incomplete', 'DONE_INCOMPLETE', { position: 3, mode: 'COUNT', target_value: '8', completed_cycles: '4' }),
    createQueueEntry('condition', 'DONE_CONDITION_MET', { position: 4, mode: 'UNTIL_INVENTORY', target_value: '10', condition_item_id: 'item.t1.qingling_herb', completed_cycles: '10' }),
  ],
  as_of: '2026-08-17T00:00:00.000Z',
};

describe('reference pages parity contract', () => {
  it('gives open reference tabs player-facing filters and item detail actions', () => {
    expect(referencePagesSource).toMatch(/筛选/);
    expect(referencePagesSource).toMatch(/全部/);
    expect(referencePagesSource).toMatch(/进行中/);
    expect(referencePagesSource).toMatch(/查看详情/);
    expect(referencePagesSource).toMatch(/暂无/);
    expect(referencePagesSource).toMatch(/onItemDetail/);
  });

  it('keeps task, maze, guide, rules, and news content tab-specific', () => {
    expect(referencePagesSource).toMatch(/queueEntryToItem/);
    expect(referencePagesSource).toMatch(/describeAction\(entry\.action_id\)/);
    expect(referencePagesSource).toMatch(/activeTab === '房间'/);
    expect(referencePagesSource).toMatch(/guideSections/);
    expect(referencePagesSource).toMatch(/ruleSections/);
    expect(referencePagesSource).toMatch(/newsSections/);
  });

  it('selects current, completed, and target task entries from the authoritative queue', () => {
    expect(selectTaskItemsByTab(queueFixture, '当前任务').map((entry) => entry.entry_id)).toEqual(['running', 'queued']);
    expect(selectTaskItemsByTab(queueFixture, '已完成').map((entry) => entry.entry_id)).toEqual(['done', 'incomplete', 'condition']);
    expect(selectTaskItemsByTab(queueFixture, '目标').map((entry) => entry.entry_id)).toEqual(['queued', 'done', 'incomplete', 'condition']);
  });

  it('uses a reference-style locked panel without fabricated records', () => {
    expect(referencePagesSource).toMatch(/reference-locked-panel/);
    expect(referencePagesSource).toMatch(/暂未开放/);
    expect(referencePagesSource).toMatch(/不伪造/);
    expect(referencePagesSource).toMatch(/primaryDisabled/);
    expect(referencePagesSource).not.toMatch(/后端/);
  });
});
