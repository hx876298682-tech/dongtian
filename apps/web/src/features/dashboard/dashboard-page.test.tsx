import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { DashboardError, DashboardLoading, QueuePreviewCard, SettlementSummaryCard, TaskStatusDialog, RewardStatusDialog, selectCurrentTask } from './dashboard-page.js';
import { buildLatestSettlementView } from './dashboard-adapter.js';
import { createQueueEditorState } from './queue-editor.js';

describe('dashboard page components', () => {
  it('falls back to the first queued task when the API has no current pointer', () => {
    expect(selectCurrentTask({ current: null, entries: [{ entry_id: 'first' } as never] })?.entry_id).toBe('first');
  });
  it('renders loading and error surfaces without browser-only APIs', () => {
    const loadingMarkup = renderToStaticMarkup(<DashboardLoading />);
    const errorMarkup = renderToStaticMarkup(<DashboardError error="boom" onRetry={() => undefined} />);

    expect(loadingMarkup).toContain('正在读取权威快照');
    expect(errorMarkup).toContain('首页读取失败');
  });

  it('renders the preview empty state before any authoritative preview exists', () => {
    const markup = renderToStaticMarkup(<QueuePreviewCard preview={createQueueEditorState('3').preview} />);

    expect(markup).toContain('预览未生成');
    expect(markup).toContain('先点击预览');
  });

  it('renders queue preview tooltips for numeric summary values', () => {
    const preview = {
      queue_version: '3',
      expected_queue_version: '3',
      fallback: { action_id: 'action.cultivation.qi', mode: 'INFINITE' },
      calculation_as_of: '2026-08-16T00:00:00.000Z',
      config_version: '2026.08.16.1',
      total_duration_us: '3600',
      entries: [{ action_id: 'action.cultivation.qi', mode: 'INFINITE' }],
      warnings: [],
    } as NonNullable<Parameters<typeof QueuePreviewCard>[0]['preview']>;

    const markup = renderToStaticMarkup(<QueuePreviewCard preview={preview} />);

    expect(markup).toContain('title="总时长 3600 µs · 1 段"');
    expect(markup).toContain('采气修炼');
  });

  it('renders settlement empty and ready states without local settlement synthesis', () => {
    const emptyMarkup = renderToStaticMarkup(<SettlementSummaryCard view={buildLatestSettlementView({ settlement: null })} onRefresh={() => undefined} />);
    const readyMarkup = renderToStaticMarkup(
      <SettlementSummaryCard
        view={buildLatestSettlementView({
          settlement: {
            settlement_id: 'settlement-1',
            character_id: 'character-1',
            as_of: '2026-08-16T02:00:06.000Z',
            from_at: '2026-08-16T00:00:00.000Z',
            requested_until: '2026-08-16T02:30:00.000Z',
            effective_until: '2026-08-16T02:00:00.000Z',
            effective_time_us: '7200000',
            capped_time_us: '1800000',
            continuation_required: false,
            status: 'COMPLETED',
            summary: { status: 'COMPLETED' },
            rewards: {
              cultivation_xp: '2.5',
              skill_xp: '1.0',
              items: [{ item_id: 'item.t1.qingling_herb', quantity: '4' }],
            },
            timeline: [],
            ledger_entries: [],
          },
        })}
        onRefresh={() => undefined}
      />,
    );

    expect(emptyMarkup).toContain('暂无最新离线摘要');
    expect(readyMarkup).toContain('离线收获');
    expect(readyMarkup).toContain('时间线');
    expect(readyMarkup).toContain('XP 与物品');
  });

  it('renders task status details and reward status in explicit dialogs', () => {
    const taskMarkup = renderToStaticMarkup(
      <TaskStatusDialog open task={{ action_id: 'action.cultivation.qi', status: 'RUNNING', completed_cycles: '3', progress_time_us: '1200000' }} onOpenChange={() => undefined} />,
    );
    const rewardMarkup = renderToStaticMarkup(
      <RewardStatusDialog open rewards={[{ title: '修为', detail: '+2.5 XP' }]} onOpenChange={() => undefined} />,
    );

    expect(taskMarkup).toContain('任务详情');
    expect(taskMarkup).toContain('已完成 3 轮');
    expect(rewardMarkup).toContain('奖励状态');
    expect(rewardMarkup).toContain('+2.5 XP');
  });
});
