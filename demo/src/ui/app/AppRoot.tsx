/** 应用壳：全局框架层 + 页面栈 + 浮层层 + 离线回归。 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { GameProvider, useGame } from '../store/GameStore';
import { deriveActionView, shouldOfferOfflineSettlement } from '../store/actionView';
import { useActionFlow } from '../flows/useActionFlow';
import type { ToastItem } from '../components/framework';
import {
  ActionBar, BottomNav, IdentityBar, ResourceRail, ToastHost,
} from '../components/framework';
import { FlowContext, ShellContext, useShell } from './shell';
import type { PageId, ShellApi, TabId } from './shell';
import { CavePage } from '../pages/cave/CavePage';
import { TrainingPage } from '../pages/cave/TrainingPage';
import { AlchemyPage } from '../pages/cave/AlchemyPage';
import { ForgePage } from '../pages/cave/ForgePage';
import { FarmPage } from '../pages/cave/FarmPage';
import { PavilionPage } from '../pages/path/PavilionPage';
import { TreasurePavilionPage } from '../pages/path/TreasurePavilionPage';
import { CodexPage } from '../pages/path/CodexPage';
import { LeaderboardPage } from '../pages/journey/LeaderboardPage';
import { JourneyPage } from '../pages/journey/JourneyPage';
import { BagPage } from '../pages/bag/BagPage';
import { PathPage } from '../pages/path/PathPage';
import { BreakthroughPage } from '../pages/path/BreakthroughPage';
import { OfflineLayer } from '../layers/OfflineLayer';
import { PageHeaderBack } from '../components/PageHeaderBack';
import { JournalList } from '../components/JournalList';
import { REALMS } from '../../game/config';

export default function AppRoot() {
  return (
    <GameProvider>
      <div className="stage">
        <div className="device">
          <Inner />
        </div>
      </div>
    </GameProvider>
  );
}

function Inner() {
  const game = useGame();
  const [tab, setTab] = useState<TabId>('cave');
  const [stack, setStack] = useState<PageId[]>([]);
  const [sheet, setSheet] = useState<ReactNode | null>(null);
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const toastSeq = useRef(0);
  const offlineTriggeredRef = useRef(false);
  const [offlineOpen, setOfflineOpen] = useState(false);

  /* —— toast —— */
  const showToast = useCallback((text: string, tone: 'ok' | 'warn' = 'ok') => {
    const id = ++toastSeq.current;
    setToasts((prev) => [...prev.slice(-2), { id, text, tone }]);
    window.setTimeout(() => {
      setToasts((prev) => prev.map((t) => (t.id === id ? { ...t, leaving: true } : t)));
      window.setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 240);
    }, 2600);
  }, []);

  /* —— 全应用唯一的行动流（单一 settling/busy 状态源）—— */
  const flow = useActionFlow(showToast);

  /* —— 导航 —— */
  const shell = useMemo<ShellApi>(() => ({
    openPage: (id) => setStack((prev) => [...prev, id]),
    closePage: () => setStack((prev) => prev.slice(0, -1)),
    openSheet: (node) => setSheet(node),
    closeSheet: () => setSheet(null),
    showToast,
  }), [showToast]);

  /* —— 行动条状态：冷却 > 结算收束 > 运行中/空闲 —— */
  const nowMs = game.now();
  const view = deriveActionView(game.player, game.catalog);
  const cooldownRemainMs = game.player?.failureCooldownUntil
    ? Math.max(0, Date.parse(game.player.failureCooldownUntil) - nowMs)
    : 0;
  const phase: 'idle' | 'running' | 'settling' | 'cooldown' =
    flow.busy
      ? 'settling'
      : cooldownRemainMs > 0
        ? 'cooldown'
        : view ? 'running' : 'idle';

  /* —— 离线回归：冷启动判定一次 —— */
  const readyPhase = game.phase;
  const readyPlayer = game.player;
  useEffect(() => {
    if (readyPhase !== 'ready' || !readyPlayer || offlineTriggeredRef.current) return;
    const atMs = game.now();
    const plots = Object.values(readyPlayer.buildings?.spirit_farm?.spiritFarmPlots ?? {});
    const hasMaturedFarm = plots.some((p) => Date.parse(p.matureAt) <= atMs);
    offlineTriggeredRef.current = true;
    if (shouldOfferOfflineSettlement(readyPlayer, hasMaturedFarm, atMs)) {
      // 打开全屏层是对“快照就绪”这一外部事实的同步；ref 保证整个会话只触发一次
      // eslint-disable-next-line react/set-state-in-effect
      setOfflineOpen(true);
    }
  }, [readyPhase, readyPlayer, game]);

  const topPlayer = game.player;

  /* —— 连接中 / 失败（纯展示，不依赖上下文）—— */
  if (game.phase === 'connecting') {
    return (
      <div className="frame-top" style={{ flex: 1 }}>
        <div className="pad">
          <div className="skeleton" style={{ height: 84 }} />
          <div className="skeleton" style={{ height: 40 }} />
          <div className="skeleton" style={{ height: 130 }} />
          <p style={{ textAlign: 'center', color: 'var(--ink-600)', fontSize: 11.5 }}>正在沟通洞府……</p>
        </div>
      </div>
    );
  }

  if (game.phase === 'failed' || !topPlayer) {
    return (
      <div className="connect-screen">
        <div className="inner">
          <span className="seal-big">洞</span>
          <b style={{ fontFamily: 'var(--font-display)', fontSize: 17 }}>洞府之门未启</b>
          <p style={{ fontSize: 12, color: 'var(--ink-600)', lineHeight: 1.8 }}>
            {game.connectError ?? '尚未获得洞天档案'}
            <br />
            请先启动服务端：<code>npm run server</code>
            <br />
            开发模式默认走 Vite 代理 <code>/api</code>，也可设置 <code>VITE_GAME_API_URL</code>
          </p>
          <button className="btn-primary" style={{ width: 160 }} onClick={() => void game.refresh()}>重试叩门</button>
        </div>
      </div>
    );
  }

  /* —— 二级页注册表 —— */
  const pageElement: Partial<Record<PageId, ReactNode>> = {
    training: <TrainingPage />,
    alchemy: <AlchemyPage />,
    forge: <ForgePage />,
    farm: <FarmPage />,
    pavilion: <PavilionPage />,
    treasure_pavilion: <TreasurePavilionPage />,
    codex: <CodexPage />,
    leaderboard: <LeaderboardPage />,
    journal: <JournalPageShell />,
    breakthrough: <BreakthroughPage />,
    settings: <SettingsPageShell />,
  };

  return (
    <ShellContext.Provider value={shell}>
      <FlowContext.Provider value={flow}>
        {/* ===== 全局框架层 ===== */}
        <div className="frame-top">
          <IdentityBar
            realmId={topPlayer.realmId}
            cultivationXp={topPlayer.cultivationXp}
            cultivationMax={(REALMS as Record<string, { cultivationMax: number }>)[topPlayer.realmId]?.cultivationMax ?? null}
            onSync={() => void game.refresh()}
            onSettings={() => shell.openPage('settings')}
          />
          <ResourceRail resources={topPlayer.resources} />
          <ActionBar
            phase={phase}
            view={view}
            nowMs={nowMs}
            cooldownRemainSeconds={cooldownRemainMs / 1000}
            lastGains={game.lastGains}
            lastGainsPerHour={game.lastGainsPerHour}
            lastError={null}
            onStop={() => {
              if (!view) return;
              void flow.stopAction(new Date(view.startedAtMs).toISOString());
            }}
            onGoAssign={() => {
              setStack([]);
              setTab('cave');
            }}
          />
        </div>

        {/* ===== 页面层 ===== */}
        <main className="page-scroll" key={`${tab}-${stack.join('/')}`}>
          {stack.length > 0
            ? pageElement[stack[stack.length - 1]]
            : tab === 'cave' ? <CavePage />
              : tab === 'journey' ? <JourneyPage />
                : tab === 'bag' ? <BagPage />
                  : <PathPage />}
        </main>

        {/* ===== 底部导航 ===== */}
        <BottomNav
          active={tab}
          badges={{ cave: farmHasMatured(topPlayer, nowMs) }}
          onChange={(next) => {
            setStack([]);
            setTab(next);
          }}
        />

        {/* ===== 浮层层 ===== */}
        {sheet}
        {offlineOpen && <OfflineLayer onDone={() => setOfflineOpen(false)} />}
        <ToastHost items={toasts} />
      </FlowContext.Provider>
    </ShellContext.Provider>
  );
}

/* ============ 二级页：入库流水 ============ */
function JournalPageShell() {
  const shell = useShell();
  const { events } = useGame();
  return (
    <div className="pad">
      <PageHeaderBack title="入库流水" sub="全部自动入库记录" onClose={() => shell.closePage()} />
      <JournalList events={events} emptyText="尚无入库记录。" />
    </div>
  );
}

/* ============ 二级页：版本石碑（设置）============ */
function SettingsPageShell() {
  const shell = useShell();
  const { configVersion, player, catalog } = useGame();
  return (
    <div className="pad">
      <PageHeaderBack title="洞府石碑" sub="版本与档案" onClose={() => shell.closePage()} />
      <div className="journal-panel">
        <InfoRow label="道号" value="云岫" />
        <InfoRow label="玩家标识" value={player?.playerId ?? '—'} mono />
        <InfoRow label="配置版本" value={configVersion ?? '—'} mono />
        <InfoRow label="状态修订" value={String(player?.stateRevision ?? '—')} mono />
        <InfoRow label="行动模型" value={catalog?.actionModel ?? 'global_single_slot_v1'} mono />
      </div>
      <p style={{ fontSize: 10.5, color: 'var(--ink-600)', lineHeight: 1.8 }}>
        动效遵循系统「减弱动态效果」偏好；长期挂机界面保持安静可靠。
      </p>
    </div>
  );
}

function InfoRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="option-row" style={{ borderRadius: 0, boxShadow: 'none', borderBottom: '1px dashed var(--line)', cursor: 'default' }}>
      <span className="option-main"><span className="option-sub">{label}</span></span>
      <b className={mono ? 'num' : undefined} style={{ fontSize: 12 }}>{value}</b>
    </div>
  );
}

function farmHasMatured(
  player: Parameters<typeof farmCheck>[0],
  nowMs: number,
): boolean {
  return farmCheck(player, nowMs);
}

function farmCheck(
  player: NonNullable<ReturnType<typeof useGame>['player']>,
  nowMs: number,
): boolean {
  if (!player) return false;
  const plots = Object.values(player.buildings?.spirit_farm?.spiritFarmPlots ?? {});
  return plots.some((p) => Date.parse(p.matureAt) <= nowMs);
}
