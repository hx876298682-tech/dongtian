/** 行动编排：启动/切换/收功。写操作全程 fail-closed：
    - 发起时进入 settling，按钮统一禁用，行动条呈切换收束态
    - STALE_REVISION → 静默重同步后提示用户重试
    - 成功 → 刷新快照 + 流水（收益展示交给流水与结算摘要） */
import { useCallback, useState } from 'react';
import { ApiError } from '../api/client';
import type { ActionOptions } from '../api/client';
import { useGame } from '../store/GameStore';
import { errorText } from '../content/meta';

export type ToastTone = 'ok' | 'warn';
export type ShowToast = (text: string, tone?: ToastTone) => void;

export function useActionFlow(showToast: ShowToast) {
  const { client, player, revision, refresh, refreshEvents, recordSettlement } = useGame();
  const [settling, setSettling] = useState(false);

  const run = useCallback(async <T,>(job: () => Promise<T>, okText: string): Promise<T | null> => {
    if (settling) return null;
    setSettling(true);
    try {
      const result = await job();
      await Promise.all([refresh(true), refreshEvents(true)]);
      if (okText) showToast(okText);
      return result;
    } catch (error) {
      if (error instanceof ApiError && error.code === 'STALE_REVISION') {
        showToast(errorText('STALE_REVISION'), 'warn');
        await refresh(true);
      } else if (error instanceof ApiError) {
        showToast(errorText(error.code, error.message), 'warn');
      } else {
        showToast('网络不畅，稍候再试', 'warn');
      }
      return null;
    } finally {
      setSettling(false);
    }
  }, [refresh, refreshEvents, showToast, settling]);

  /** 从 stop/switch 的响应里取出服务端结算摘要，供行动条"最近收获"展示。 */
  const recordFromEnvelope = useCallback((data: unknown): void => {
    if (!data || typeof data !== 'object') return;
    const obj = data as Record<string, unknown>;
    const settlement = (obj.settlement ?? (obj.stopped as Record<string, unknown> | undefined)?.settlement) as
      | { data?: { resourceDelta?: Record<string, number>; cultivationDelta?: number; completedActions?: number; settledSeconds?: number } }
      | undefined;
    if (settlement?.data) {
      recordSettlement({
        resourceDelta: settlement.data.resourceDelta,
        cultivationDelta: settlement.data.cultivationDelta,
        completedActions: settlement.data.completedActions,
        settledSeconds: settlement.data.settledSeconds,
      });
    }
  }, [recordSettlement]);

  const startAction = useCallback((options: ActionOptions, label: string) =>
    run(() => client.startAction(options, revision()), `已开启${label}`), [run, client, revision]);

  const switchAction = useCallback((options: ActionOptions, startedAtIso: string, label: string) => {
    const primaryStartedAt = player?.primaryAction.startedAt ?? startedAtIso;
    return run(async () => {
      const envelope = await client.switchAction(options, revision(), primaryStartedAt);
      recordFromEnvelope(envelope.data);
      return envelope;
    }, `旧序列已结算 · 已切换至${label}`);
  }, [run, client, revision, player, recordFromEnvelope]);

  const stopAction = useCallback((startedAtIso: string) =>
    run(async () => {
      const envelope = await client.stopAction(revision(), startedAtIso);
      recordFromEnvelope(envelope.data);
      return envelope;
    }, '已收功，本轮收获已自动入库'), [run, client, revision, recordFromEnvelope]);

  return {
    settling,
    busy: settling,
    startAction,
    switchAction,
    stopAction,
    /** 通用的带刷新突变封装（灵田、装备、突破等复用） */
    runMutation: run,
  };
}
