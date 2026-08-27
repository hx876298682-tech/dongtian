/** 排行榜：读服务端 /v1/leaderboards/{type}（异步榜，只读）。 */
import { useEffect, useState } from 'react';
import { useGame } from '../../store/GameStore';
import { useShell } from '../../app/shell';
import { PageHeaderBack, EmptyHint, SkeletonCard } from '../../components/primitives';
import { realmLabel } from '../../content/meta';
import { fmtNum } from '../../api/format';

const BOARDS: Array<{ type: string; label: string; scoreLabel: string }> = [
  { type: 'combat_power', label: '战力', scoreLabel: '战力' },
  { type: 'cultivation_xp', label: '修为', scoreLabel: '修为' },
  { type: 'realm', label: '境界', scoreLabel: '境界' },
  { type: 'herbalism', label: '采药', scoreLabel: '采药' },
  { type: 'mining', label: '挖矿', scoreLabel: '挖矿' },
  { type: 'alchemy', label: '丹道', scoreLabel: '丹道' },
  { type: 'forge', label: '炼器', scoreLabel: '炼器' },
  { type: 'technique', label: '功法', scoreLabel: '功法' },
];

const MEDALS = ['🥇', '🥈', '🥉'];

export function LeaderboardPage() {
  const { client, player } = useGame();
  const shell = useShell();
  const [type, setType] = useState('combat_power');
  const [entries, setEntries] = useState<Array<{ rank: number; playerId: string; realmId: string; combatPower?: number; cultivationXp?: number; skillLevel?: number; skillXp?: number }> | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setEntries(null);
    setError(null);
    client.leaderboard(type, 20)
      .then((envelope) => { if (alive) setEntries(envelope.data.entries as typeof entries); })
      .catch((err: unknown) => { if (alive) setError(err instanceof Error ? err.message : '榜单拉取失败'); });
    return () => { alive = false; };
  }, [type]); // eslint-disable-line react-hooks/exhaustive-deps

  const scoreOf = (e: { realmId: string; combatPower?: number; cultivationXp?: number; skillLevel?: number; skillXp?: number }): string => {
    if (type === 'combat_power') return fmtNum(e.combatPower);
    if (type === 'cultivation_xp') return fmtNum(e.cultivationXp);
    if (type === 'realm') return realmLabel(e.realmId);
    if (['herbalism', 'mining', 'alchemy', 'forge', 'technique'].includes(type)) return `Lv.${e.skillLevel ?? '—'}`;
    return '—';
  };

  return (
    <div className="pad">
      <PageHeaderBack title="英雄榜" sub="异步榜单 · 每次结算后刷新" onClose={() => shell.closePage()} />

      <div className="filter-chips">
        {BOARDS.map((b) => (
          <button key={b.type} className={`f-chip${type === b.type ? ' active' : ''}`} onClick={() => setType(b.type)}>
            {b.label}
          </button>
        ))}
      </div>

      {error && <EmptyHint text={error} />}
      {!entries && !error && <SkeletonCard height={200} />}
      {entries && entries.length === 0 && <EmptyHint text="此榜暂无上榜者——成为第一个留名的人。" />}
      {entries && entries.length > 0 && (
        <div className="journal-panel">
          {entries.map((e) => {
            const isMe = player?.playerId === e.playerId;
            return (
              <div key={`${e.rank}-${e.playerId}`} className="option-row" style={{ borderRadius: 0, boxShadow: 'none', borderBottom: '1px dashed var(--line)', cursor: 'default' }}>
                <b className="num" style={{ width: 30, color: e.rank <= 3 ? 'var(--gold)' : 'var(--ink-600)' }}>
                  {e.rank <= 3 ? MEDALS[e.rank - 1] : e.rank}
                </b>
                <span className="option-main">
                  <b style={{ fontSize: 13 }}>{isMe ? '云岫（我）' : `道友 ${e.playerId.slice(0, 10)}`}</b>
                  <span className="option-sub">{realmLabel(e.realmId)}</span>
                </span>
                <b className="num" style={{ fontSize: 13.5 }}>{scoreOf(e)}</b>
              </div>
            );
          })}
        </div>
      )}

      <p style={{ fontSize: 10.5, color: 'var(--ink-600)', lineHeight: 1.7 }}>
        榜单为异步结算快照；战力只是展示值，实际战斗以服务端结算为准。
      </p>
    </div>
  );
}
