import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ApiClientError } from '@dongtian/contracts';

import { DashboardError, DashboardLoading, QueuePreviewCard, SettlementSummaryCard, TaskStatusDialog, RewardStatusDialog, formatPlayerDashboardError, selectCurrentTask } from './dashboard-page.js';
import { buildLatestSettlementView } from './dashboard-adapter.js';
import { createQueueEditorState } from './queue-editor.js';
import dashboardSource from './dashboard-page.tsx?raw';

describe('dashboard page components', () => {
  it('keeps right-rail draft copy in player language', () => {
    expect(dashboardSource).not.toContain('先预览再保存；保存、暂停、恢复都需要幂等键。');
    expect(dashboardSource).not.toContain('CSRF');
    expect(dashboardSource).not.toContain('Idempotency-Key');
  });

  it('puts advanced idle settings behind a closed native details disclosure', () => {
    expect(dashboardSource).toContain('<details className="dashboard-settings">');
    expect(dashboardSource).toContain('<summary>挂机设置</summary>');
    expect(dashboardSource).not.toContain('当前 run ${dungeonRun?.run_id');
    for (const internalLabel of ['权威快照', '服务端', '后端', '适配器', '持久化', '队列版本', '草稿条目', '预览新鲜']) {
      expect(dashboardSource).not.toContain(internalLabel);
    }
  });
  it('falls back to the first queued task when the API has no current pointer', () => {
    expect(selectCurrentTask({ current: null, entries: [{ entry_id: 'first' } as never] })?.entry_id).toBe('first');
  });
  it('renders loading and error surfaces without browser-only APIs', () => {
    const loadingMarkup = renderToStaticMarkup(<DashboardLoading />);
    const errorMarkup = renderToStaticMarkup(<DashboardError error="boom" onRetry={() => undefined} />);

    expect(loadingMarkup).toContain('正在读取角色状态');
    expect(errorMarkup).toContain('首页读取失败');
  });

  it('formats implementation errors into player-facing retry copy', () => {
    const generic = '修行暂时无法继续，请稍后重试。';

    expect(formatPlayerDashboardError(new Error('error.csrf_validation_failed'))).toBe(generic);
    expect(formatPlayerDashboardError({ message_key: 'error.idempotency_key_reused' })).toBe(generic);
    expect(formatPlayerDashboardError('ECONNRESET: request failed')).toBe(generic);
    expect(formatPlayerDashboardError({ code: 'QUEUE_VERSION_CONFLICT', message: 'QUEUE_VERSION_CONFLICT' })).toBe('挂机计划刚刚发生变化，请重新载入后再继续。');
    expect(formatPlayerDashboardError(new ApiClientError('HTTP 409', { status: 409, retryable: false }))).toBe('挂机计划刚刚发生变化，请重新载入后再继续。');
  });

  it('does not render raw error details in the dashboard error surface', () => {
    const markup = renderToStaticMarkup(<DashboardError error={new Error('error.csrf_validation_failed')} onRetry={() => undefined} />);

    expect(markup).toContain('修行暂时无法继续，请稍后重试。');
    expect(markup).not.toContain('csrf_validation_failed');
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

    expect(markup).toContain('title="总时长 0.004 秒 · 1 段"');
    expect(markup).not.toContain('µs');
    expect(markup).not.toContain('2026.08.16.1');
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
    expect(readyMarkup).toContain('行动摘要');
    expect(readyMarkup).toContain('修为与物品');
    expect(readyMarkup).toContain('百艺经验');
    expect(readyMarkup).not.toContain('XP');
    expect(readyMarkup).not.toContain('2026-08-16T00:00:00.000Z');
    expect(readyMarkup).not.toContain('7200000');
    expect(readyMarkup).not.toContain('1800000');
    expect(readyMarkup).not.toContain('只读持久化摘要');
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
