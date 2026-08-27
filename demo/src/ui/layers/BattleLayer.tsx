/** 时刻型秘境战斗层：播放服务端结算回放的逐秒事件（不本地推演胜负）。
    播放速率可调，可跳过直接看结果。 */
import { useMemo, useRef, useState } from 'react';
import type { DungeonSettlementData } from '../api/client';
import { ElementTag } from '../components/ElementTag';
import { fmtNum, fmtSpan } from '../api/format';
import { RESOURCE_META, type ResourceId } from '../content/meta';

type BattleData = {
  status: 'succeeded' | 'failed';
  elapsedSeconds: number;
  targetClearTime?: number;
  bossMaxHp?: number;
  phase?: number;
  combatEvents?: Array<{ second: number; actor: 'player' | 'boss' | 'system'; kind: string; amount?: number; state?: Record<string, unknown> }>;
  combatSnapshot?: { element?: string } | null;
  resourceDelta?: Partial<Record<ResourceId, number>>;
  drops?: { millenniumHerb?: number; meteorIron?: number; techniqueId?: string | null; treasureId?: string | null };
  failed?: boolean;
};
type Props = { dungeonName: string; data: DungeonSettlementData | (BattleData & { dungeonId?: string }); onClose(): void; onRetry(): void; retryEnabled: boolean };

const SPEEDS = [1, 2, 4];

export function BattleLayer({ dungeonName, data, onClose, onRetry, retryEnabled }: Props) {
  const [speed, setSpeed] = useState(2);
  const [finished, setFinished] = useState(false);
  const cursorRef = useRef(0);
  const [cursor, setCursor] = useState(0);
  const events = useMemo(
    () => [...(data.combatEvents ?? [])].sort((a, b) => a.second - b.second),
    [data.combatEvents],
  );
  const total = events.length;
  const lastSecond = events.at(-1)?.second ?? data.elapsedSeconds ?? 0;

  // 播放推进：每 220ms/speed 前进一个事件
  const advance = (): void => {
    if (cursorRef.current >= total) { setFinished(true); return; }
    cursorRef.current += 1;
    setCursor(cursorRef.current);
    if (cursorRef.current >= total) setFinished(true);
  };
  // 播放循环（走 interval 而非 ticker，便于变速）
  usePlayback(advance, finished ? 0 : Math.max(60, 220 / speed));

  const shown = events.slice(0, cursor);
  const bossHpPct = (() => {
    for (let i = cursor - 1; i >= 0; i -= 1) {
      const hp = (events[i]?.state as Record<string, unknown> | undefined)?.bossHp;
      const maxHp = typeof data.bossMaxHp === 'number' ? data.bossMaxHp : 0;
      if (typeof hp === 'number' && maxHp > 0) return Math.max(0, Math.min(100, (hp / maxHp) * 100));
    }
    return 100;
  })();

  const won = data.status === 'succeeded';
  return (
    <div className="offline-layer" role="dialog" aria-label="秘境战斗">
      <div className="offline-book" style={{ maxWidth: 420 }}>
        <div className="book-head" style={{ paddingBottom: 6 }}>
          <h2 style={{ letterSpacing: '.1em' }}>{dungeonName}</h2>
          <small>第 {data.phase} 阶段 · 战斗回放（服务端逐秒判定）</small>
        </div>

        <div style={{ padding: '0 16px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
            <span style={{ fontSize: 11, color: 'var(--ink-600)', width: 30 }}>BOSS</span>
            <div className="track" style={{ flex: 1 }}>
              <i style={{ width: `${bossHpPct}%`, background: 'var(--cinnabar)' }} />
            </div>
            <span className="num" style={{ fontSize: 11, color: 'var(--ink-600)' }}>{Math.round(bossHpPct)}%</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 11, color: 'var(--ink-600)', width: 30 }}>我方</span>
            <div className="track" style={{ flex: 1 }}>
              <i style={{ width: '100%', background: 'var(--jade)' }} />
            </div>
            <span className="num" style={{ fontSize: 11, color: 'var(--ink-600)' }}>交战 {fmtSpan(Math.min(lastSecond, events[cursor - 1]?.second ?? 0))}</span>
          </div>
        </div>

        <div className="journal-panel" style={{ margin: '10px 16px', maxHeight: 200, overflowY: 'auto' }}>
          {shown.length === 0 && <div className="journal-row"><span className="journal-text">战鼓未响…</span></div>}
          {shown.map((e, i) => (
            <div key={i} className="journal-row">
              <span className="journal-time num">{e.second}s</span>
              <span className="journal-text">
                {e.actor === 'player' ? '我方' : e.actor === 'boss' ? 'BOSS' : '天地'} · {e.kind}
                {typeof e.amount === 'number' ? ` ${fmtNum(e.amount)}` : ''}
              </span>
            </div>
          ))}
        </div>

        {!finished && (
          <div className="book-note" style={{ display: 'flex', justifyContent: 'center', gap: 8 }}>
            {SPEEDS.map((s) => (
              <button key={s} className={`f-chip${speed === s ? ' active' : ''}`} onClick={() => setSpeed(s)}>×{s}</button>
            ))}
            <button className="f-chip" onClick={() => { cursorRef.current = total; setCursor(total); setFinished(true); }}>跳过</button>
          </div>
        )}

        {finished && (
          <>
            <div className={`book-group ${won ? '' : 'fail'}`}>
              <span className="group-title">{won ? '⚔ 秘境告捷' : '✕ 征战失利'}</span>
              <span style={{ fontSize: 12, color: 'var(--ink-600)', lineHeight: 1.7 }}>
                用时 {fmtSpan(data.elapsedSeconds)}{data.targetClearTime ? `（目标 ${fmtSpan(data.targetClearTime)}）` : ''} ·
                {won ? ' 奖励已自动入库' : ' 本场奖励 0，丹药未扣除'}
              </span>
              {Object.entries(data.resourceDelta ?? {}).map(function ([res, amount]) {
                if (!(typeof amount === 'number' && amount !== 0)) return null;
                return (
                  <span key={res} className="gain-line">
                    {RESOURCE_META[res as ResourceId]?.name ?? res}
                    <b className="num">{amount > 0 ? `+${fmtNum(amount)}` : fmtNum(amount)}</b>
                  </span>
                );
              })}              {(Number(data.drops?.millenniumHerb) > 0 || Number(data.drops?.meteorIron) > 0 || data.drops?.techniqueId || data.drops?.treasureId) && (
                <span style={{ fontSize: 12 }}>
                  掉落：
                  {Number(data.drops?.millenniumHerb) > 0 && `千年灵药 ×${data.drops?.millenniumHerb} `}
                  {Number(data.drops?.meteorIron) > 0 && `天外陨铁 ×${data.drops?.meteorIron} `}
                  {data.drops?.techniqueId && '功法残页 '}
                  {data.drops?.treasureId && '法宝线索 '}
                </span>
              )}
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ fontSize: 11, color: 'var(--ink-600)' }}>BOSS 五行</span>
                <ElementTag elementKey={data.combatSnapshot?.element ?? ''} />
              </div>
            </div>
            <div className="book-foot" style={{ display: 'flex', gap: 8 }}>
              <button className="btn-primary" style={{ flex: 1 }} onClick={onClose}>返回洞府</button>
              <button className="btn-danger-ghost" disabled={!retryEnabled} onClick={onRetry}>再次尝试</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/** 简易播放循环 */
function usePlayback(step: () => void, intervalMs: number): void {
  const ref = useRef(intervalMs);
  const stepRef = useRef(step);
  ref.current = intervalMs;
  stepRef.current = step;
  useStateInit(() => {
    const timer = window.setInterval(() => stepRef.current(), Math.max(60, ref.current));
    return () => window.clearInterval(timer);
  });
}

// 首渲染挂 interval 的极简封装（等价 useEffect）
import { useEffect } from 'react';
function useStateInit(effect: () => (() => void) | void): void {
  useEffect(effect, []);
}
