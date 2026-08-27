/** 离线修行录：冷启动时对离线窗口请求一次结算，按真实 SettlementData 呈现。 */
import { useEffect, useRef, useState } from 'react';
import { useGame } from '../store/GameStore';
import { fmtSpan, fmtTimeOfDay } from '../api/format';
import type { CollectionEventItem, SettlementData } from '../api/client';
import { JournalList } from '../components/JournalList';

type OfflineOutcome =
  | { state: 'settled'; windowText: string; events: CollectionEventItem[]; failedNote: string | null }
  | { state: 'rejected'; reason: string };

export function OfflineLayer({ onDone }: { onDone(): void }) {
  const { client, player, revision, refresh, refreshEvents } = useGame();
  const [outcome, setOutcome] = useState<OfflineOutcome | null>(null);
  const attemptedRef = useRef(false);

  useEffect(() => {
    if (!player || attemptedRef.current) return;
    attemptedRef.current = true;
    const startedAtIso = player.primaryAction.startedAt ?? player.lastSettledAt;
    client
      .offlineSettlement(revision(), startedAtIso, new Date(client.now()).toISOString())
      .then(async (envelope) => {
        await Promise.all([refresh(true), refreshEvents(true)]);
        const data = envelope.data;
        setOutcome({
          state: 'settled',
          windowText: `${fmtTimeOfDay(data.settledStartedAt)} — ${fmtTimeOfDay(data.settledEndedAt)} · 共 ${fmtSpan(data.settledSeconds)}${data.clipped ? '（超长部分已截断）' : ''}`,
          events: toEventViews(data),
          failedNote: data.failed ? '期间曾遭遇折戟，其后行动停手' : null,
        });
      })
      .catch((error: unknown) => {
        const code = (error as { code?: string }).code;
        setOutcome({
          state: 'rejected',
          reason:
            code === 'TIME_RANGE_INVALID'
              ? '时间区间无效（回拨或重叠），本次未重复发放收益。'
              : code === 'DUPLICATE_REQUEST'
                ? '该窗口已结算过，不会重复发放。'
                : code === 'STALE_REVISION'
                  ? '状态已在别处更新，本次跳过；可手动同步后再看。'
                  : '本次未结算成功，不影响后续行动。',
        });
      });
    // 刻意只在挂载后执行一次（ref 防重入）；依赖全为首次快照
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="offline-layer" role="dialog" aria-label="离线修行录">
      <div className="offline-book">
        <div className="book-head">
          <h2>離山行止錄</h2>
          <small>{outcome?.state === 'settled' ? outcome.windowText : '正在向洞府核对这段时间的行止……'}</small>
        </div>

        {!outcome && (
          <>
            <div className="skeleton" style={{ height: 64, margin: '10px 14px' }} />
            <div className="skeleton" style={{ height: 48, margin: '0 14px' }} />
          </>
        )}

        {outcome?.state === 'rejected' && (
          <>
            <div className="book-group fail">
              <span className="group-title">本次未结算</span>
              <span style={{ fontSize: 12, color: 'var(--ink-600)', lineHeight: 1.7 }}>{outcome.reason}</span>
            </div>
            <p className="book-note">规则提醒：离线与在线同一口径，结算幂等，绝不二次发放。</p>
            <div className="book-foot"><button className="btn-primary" onClick={onDone}>知道了</button></div>
          </>
        )}

        {outcome?.state === 'settled' && (
          <>
            <JournalList events={outcome.events} emptyText="这段时间岁月静好，无产出入账。" />
            {outcome.failedNote && (
              <p className="book-note" style={{ color: 'var(--cinnabar)' }}>{outcome.failedNote}</p>
            )}
            <div className="book-foot"><button className="btn-primary" onClick={onDone}>收入洞府</button></div>
          </>
        )}
      </div>
    </div>
  );
}

/** 把 SettlementData 转成流水行视图，完全按服务端数字渲染（JournalList 负责格式化）。 */
function toEventViews(data: SettlementData): CollectionEventItem[] {
  const rows: CollectionEventItem[] = [];
  let seq = 0;
  const mk = (eventType: string, payload: Record<string, unknown>): CollectionEventItem => ({
    eventId: `offline-${seq++}`,
    eventType,
    payload,
    createdAt: data.settledEndedAt,
  });

  rows.push(mk('settlement_committed', {
    resourceDelta: data.resourceDelta,
    cultivationDelta: data.cultivationDelta,
    completedActions: data.completedActions,
  }));
  for (const [output, amount] of Object.entries(data.productionDelta ?? {})) {
    if (Number(amount) > 0) rows.push(mk('production_inlined', { productionDelta: { [output]: amount } }));
  }
  if ((data.skillXpDelta?.herbalism ?? 0) > 0 || (data.skillXpDelta?.mining ?? 0) > 0) {
    rows.push(mk('skill_gained', {}));
  }
  return rows;
}
