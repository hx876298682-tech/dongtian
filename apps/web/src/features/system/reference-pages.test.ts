import { describe, expect, it } from 'vitest';
import type { Queue, QueueEntry, QueueEntryStatus } from '@dongtian/contracts';

import { buildTaskRows, selectTaskItemsByTab } from './reference-pages.js';

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
    expect(referencePagesSource).toMatch(/const roomEntry/);
    expect(referencePagesSource).toMatch(/guideSections/);
    expect(referencePagesSource).toMatch(/ruleSections/);
    expect(referencePagesSource).toMatch(/newsSections/);
  });

  it('uses reference task and maze sections without inventing a task claim action', () => {
    expect(referencePagesSource).toMatch(/tabs: \['任务栏', '任务商店'\]/);
    expect(referencePagesSource).toMatch(/tabs: \['迷宫', '迷宫商店'\]/);
    expect(referencePagesSource).toMatch(/roomEntry/);
    expect(referencePagesSource).toMatch(/automationEntry/);
    expect(referencePagesSource).toMatch(/<progress/);
    expect(referencePagesSource).toMatch(/前往/);
    expect(referencePagesSource).toMatch(/任务商店/);
    expect(referencePagesSource).toMatch(/迷宫商店/);
    expect(referencePagesSource).not.toMatch(/任务.*领取/);
  });

  it('selects current, completed, and target task entries from the authoritative queue', () => {
    expect(selectTaskItemsByTab(queueFixture, '当前任务').map((entry) => entry.entry_id)).toEqual(['running', 'queued']);
    expect(selectTaskItemsByTab(queueFixture, '已完成').map((entry) => entry.entry_id)).toEqual(['done', 'incomplete', 'condition']);
    expect(selectTaskItemsByTab(queueFixture, '目标').map((entry) => entry.entry_id)).toEqual(['queued', 'done', 'incomplete', 'condition']);
  });

  it('builds task rows with authoritative status and progress for the task bar', () => {
    const rows = buildTaskRows(queueFixture, '任务栏', Date.parse('2026-08-17T00:00:10.000Z'));

    expect(rows.map((row) => row.entryId)).toEqual(['running', 'queued', 'done', 'incomplete', 'condition']);
    expect(rows[0]).toMatchObject({ status: '进行中', progress: 0.1, progressLabel: '10% · 本轮还需 1 分 30 秒', rewardLabel: '待结算' });
    expect(rows[1]).toMatchObject({ status: '待执行', progress: 0, progressLabel: '0 / 3 轮', rewardLabel: '待结算' });
    expect(rows[2]).toMatchObject({ status: '已完成', progress: 1, progressLabel: '5 / 5 轮', rewardLabel: '已结算' });
  });

  it('uses the task target instead of the current action cycle for COUNT and DURATION progress', () => {
    const countCurrentQueue: Queue = {
      ...queueFixture,
      current: createQueueEntry('count-current', 'RUNNING', { mode: 'COUNT', target_value: '20', completed_cycles: '2', progress_time_us: '90000000' }),
      entries: [createQueueEntry('count-current', 'RUNNING', { mode: 'COUNT', target_value: '20', completed_cycles: '2', progress_time_us: '90000000' })],
    };
    const countRow = buildTaskRows(countCurrentQueue, '任务栏', Date.parse('2026-08-17T00:00:10.000Z'))[0];
    expect(countRow).toMatchObject({ progress: 0.1, progressLabel: '2 / 20 轮' });

    const durationQueue: Queue = {
      ...queueFixture,
      current: createQueueEntry('duration', 'RUNNING', {
        mode: 'DURATION',
        target_value: '300',
        completed_cycles: '1',
        progress_time_us: '20000000',
      }),
      entries: [createQueueEntry('duration', 'RUNNING', {
        mode: 'DURATION',
        target_value: '300',
        completed_cycles: '1',
        progress_time_us: '20000000',
      })],
      as_of: '2026-08-17T00:00:00.000Z',
    };
    const row = buildTaskRows(durationQueue, '任务栏', Date.parse('2026-08-17T00:00:10.000Z'))[0];
    expect(row).toMatchObject({ progress: 13 / 30, progressLabel: '2 分 10 秒 / 5 分钟' });
    expect(referencePagesSource).toMatch(/mode === 'DURATION'/);
    expect(referencePagesSource).not.toMatch(/currentView\?\.progress \?\?/);
  });

  it('exposes retryable API errors and standard tab semantics', () => {
    expect(referencePagesSource).toMatch(/queueQuery\.isError/);
    expect(referencePagesSource).toMatch(/opportunityQuery\.isError/);
    expect(referencePagesSource).toMatch(/重试/);
    expect(referencePagesSource).toMatch(/refetchInterval: 1_000/);
    expect(referencePagesSource).toMatch(/role="tablist"/);
    expect(referencePagesSource).toMatch(/role="tab"/);
    expect(referencePagesSource).toMatch(/aria-selected/);
    expect(referencePagesSource).toMatch(/aria-controls/);
    expect(referencePagesSource).toMatch(/role="tabpanel"/);
    expect(referencePagesSource).not.toMatch(/aria-pressed=\{tab === activeTab\}/);
    expect(referencePagesSource).toMatch(/tabIndex=\{tab === activeTab \? 0 : -1\}/);
    expect(referencePagesSource).toMatch(/onKeyDown=\{handleTabKeyDown\}/);
    expect(referencePagesSource).toMatch(/event\.key === 'Home'/);
    expect(referencePagesSource).toMatch(/event\.key === 'End'/);
    expect(referencePagesSource).toMatch(/referenceTabRefs\.current\[nextIndex\]\?\.focus\(\)/);
  });

  it('uses compact task rows and distinct reference views for every page family', () => {
    expect(referencePagesSource).toMatch(/reference-task-row/);
    expect(referencePagesSource).toMatch(/rewardLabel/);
    expect(referencePagesSource).toMatch(/reference-content-panel/);
    expect(referencePagesSource).toMatch(/reference-locked-panel--\$\{config\.kind\}/);
    expect(referencePagesSource).toMatch(/panelTitle/);
    expect(referencePagesSource).toMatch(/reference-page--\$\{kind\}/);
  });

  it('uses a reference-style locked panel without fabricated records', () => {
    expect(referencePagesSource).toMatch(/reference-locked-panel/);
    expect(referencePagesSource).toMatch(/暂未开放/);
    expect(referencePagesSource).toMatch(/不伪造/);
    expect(referencePagesSource).toMatch(/primaryDisabled/);
    expect(referencePagesSource).not.toMatch(/后端/);
    expect(referencePagesSource).toMatch(/reference-shop-lock/);
    expect(referencePagesSource).toMatch(/reference-achievement-lock/);
    expect(referencePagesSource).toMatch(/reference-leaderboard-lock/);
    expect(referencePagesSource).toMatch(/reference-guild-lock/);
    expect(referencePagesSource).toMatch(/reference-social-lock/);
  });
});
