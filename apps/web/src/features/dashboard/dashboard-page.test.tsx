import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { DashboardError, DashboardLoading, QueuePreviewCard, SettlementSummaryCard } from './dashboard-page.js';
import { buildLatestSettlementView } from './dashboard-adapter.js';
import { createQueueEditorState } from './queue-editor.js';

describe('dashboard page components', () => {
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
    expect(readyMarkup).toContain('最新离线摘要 · COMPLETED');
    expect(readyMarkup).toContain('时间线');
    expect(readyMarkup).toContain('XP 与物品');
  });
});
