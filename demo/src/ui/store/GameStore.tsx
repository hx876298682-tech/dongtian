/** 全局数据快照：bootstrap + catalog + 流水。
    规则（对齐 docs 运行时口径）：UI 不推算收益；客户端仅按服务端时间渲染时钟。 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { ApiError, GameClient } from '../api/client';
import type { Catalog, CollectionEventItem, RemotePlayer } from '../api/client';
import { RESOURCE_META } from '../content/meta';

type Phase = 'connecting' | 'ready' | 'failed';

/** 最近一次结算的收益摘要（供行动条"最近收获"展示）。 */
export type GainLine = { label: string; amount: number };

type StoreValue = {
  phase: Phase;
  connectError: string | null;
  client: GameClient;
  player: RemotePlayer | null;
  catalog: Catalog | null;
  configVersion: string | null;
  events: CollectionEventItem[];
  lastGains: GainLine[];
  /** 以服务端时钟为准的当前时间 */
  now(): number;
  revision(): number;
  /** 记录服务端返回的结算摘要（仅展示用） */
  recordSettlement(data: { resourceDelta?: Partial<Record<string, number>>; cultivationDelta?: number }): void;
  refresh(silent?: boolean): Promise<void>;
  refreshEvents(silent?: boolean): Promise<void>;
};

const StoreContext = createContext<StoreValue | null>(null);

const POLL_MS = 60_000;

function usePolling(refresh: () => Promise<void>, enabled: boolean): void {
  useEffect(() => {
    if (!enabled) return;
    const timer = window.setInterval(() => void refresh(), POLL_MS);
    const onVisible = () => {
      if (document.visibilityState === 'visible') void refresh();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [refresh, enabled]);
}

export function GameProvider({ children }: { children: ReactNode }) {
  const [client] = useState(() => new GameClient());

  const [phase, setPhase] = useState<Phase>('connecting');
  const [connectError, setConnectError] = useState<string | null>(null);
  const [player, setPlayer] = useState<RemotePlayer | null>(null);
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [configVersion, setConfigVersion] = useState<string | null>(null);
  const [events, setEvents] = useState<CollectionEventItem[]>([]);
  const [lastGains, setLastGains] = useState<GainLine[]>([]);

  const recordSettlement = useCallback((data: { resourceDelta?: Partial<Record<string, number>>; cultivationDelta?: number }) => {
    const lines: GainLine[] = [];
    for (const [resId, amount] of Object.entries(data.resourceDelta ?? {})) {
      const meta = RESOURCE_META[resId as keyof typeof RESOURCE_META];
      if (meta && typeof amount === 'number' && amount !== 0) lines.push({ label: meta.name, amount });
    }
    if (typeof data.cultivationDelta === 'number' && data.cultivationDelta !== 0) {
      lines.push({ label: '修为', amount: data.cultivationDelta });
    }
    setLastGains(lines.slice(0, 4));
  }, []);

  const refreshEvents = useCallback(async (silent = true) => {
    try {
      const envelope = await client.collectionEvents(30);
      setEvents(envelope.data.events);
    } catch (error) {
      if (!silent && error instanceof ApiError) throw error;
    }
  }, [client]);

  const refresh = useCallback(async (silent = false) => {
    try {
      const [boot, cat] = await Promise.all([client.bootstrap(), client.catalog()]);
      setPlayer(boot.data.player);
      setCatalog(cat.data);
      setConfigVersion(boot.configVersion);
      setPhase('ready');
      void refreshEvents(true);
    } catch (error) {
      setPhase((prev) => (prev === 'ready' ? prev : 'failed'));
      setConnectError(error instanceof Error ? error.message : '无法连接洞府服务');
      if (!silent) console.error('refresh failed', error);
    }
  }, [client, refreshEvents]);

  // 首次挂载即拉取快照：数据 arriving 后 setState 属对外部服务的正常同步
  // eslint-disable-next-line react/set-state-in-effect
  useEffect(() => { void refresh(); }, [refresh]);
  usePolling(() => refresh(true), phase === 'ready');

  const value = useMemo<StoreValue>(() => ({
    phase,
    connectError,
    client,
    player,
    catalog,
    configVersion,
    events,
    lastGains,
    now: () => client.now(),
    revision: () => player?.stateRevision ?? 0,
    recordSettlement,
    refresh,
    refreshEvents,
  }), [phase, connectError, client, player, catalog, configVersion, events, lastGains, recordSettlement, refresh, refreshEvents]);

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useGame(): StoreValue {
  const ctx = useContext(StoreContext);
  if (!ctx) throw new Error('useGame 必须在 GameProvider 内使用');
  return ctx;
}
