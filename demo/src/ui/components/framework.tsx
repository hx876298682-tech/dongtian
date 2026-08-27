/** 全局框架层：身份区 / 资源栏 / 行动条五态 / 底部导航 */
import { Backpack, Check, ChevronRight, CircleAlert, Compass, Home, RefreshCw, Settings, UserRound } from 'lucide-react';
import type { ActionView } from '../store/actionView';
import type { ResourceId } from '../content/meta';
import { RESOURCE_META, RESOURCE_ORDER, realmLabel } from '../content/meta';
import { clamp01, fmtNum, fmtSpan } from '../api/format';

/* ============ 身份区 ============ */
export function IdentityBar({
  realmId,
  cultivationXp,
  cultivationMax,
  syncing,
  onSync,
  onSettings,
}: {
  realmId: string;
  cultivationXp: number;
  cultivationMax: number | null;
  syncing?: boolean;
  onSync(): void;
  onSettings(): void;
}) {
  const pct = cultivationMax ? clamp01(cultivationXp / cultivationMax) * 100 : null;
  return (
    <div className="identity">
      <span className="seal-avatar">云</span>
      <div className="who">
        <b>云岫</b>
        <span className="realm-badge">{realmLabel(realmId)}</span>
      </div>
      <div className="cult-micro">
        {pct === null ? (
          <span className="num">修为 {fmtNum(cultivationXp)}</span>
        ) : (
          <>
            <span className="num">修为 {fmtNum(cultivationXp)} / {fmtNum(cultivationMax)}</span>
            <i className="track" style={{ width: 56 }}><i style={{ width: `${pct}%`, transition: 'none' }} /></i>
          </>
        )}
        <button className="icon-btn" onClick={onSync} title="同步洞天状态" disabled={syncing}>
          <RefreshCw size={14} />
        </button>
        <button className="icon-btn" onClick={onSettings} title="设置"><Settings size={15} /></button>
      </div>
    </div>
  );
}

/* ============ 资源栏 ============ */
export function ResourceRail({ resources }: { resources: Partial<Record<ResourceId, { amount: number; capacity: number }>> }) {
  return (
    <div className="res-rail">
      {RESOURCE_ORDER.map((id) => {
        const entry = resources[id];
        const meta = RESOURCE_META[id];
        const nearCap = entry ? entry.capacity > 0 && entry.amount >= entry.capacity * 0.9 : false;
        return (
          <span key={id} className={`res-pill${nearCap ? ' near-cap' : ''}`} title={meta.name}>
            <span style={{ color: 'var(--ink-600)' }}>{meta.short}</span>
            <b className="num">{entry ? fmtNum(entry.amount) : '—'}</b>
          </span>
        );
      })}
    </div>
  );
}

/* ============ 行动条 ============ */
export type ActionBarPhase = 'idle' | 'running' | 'settling' | 'cooldown';

export function ActionBar({
  phase,
  view,
  nowMs,
  cooldownRemainSeconds,
  lastGains,
  lastError,
  onStop,
  onGoAssign,
}: {
  phase: ActionBarPhase;
  view: ActionView | null;
  nowMs: number;
  cooldownRemainSeconds: number;
  lastGains: Array<{ label: string; amount: number }>;
  lastError: string | null;
  onStop(): void;
  onGoAssign(): void;
}) {
  let progressPct = 0;

  if (phase === 'running' && view) {
    const elapsedSec = Math.max(0, (nowMs - view.startedAtMs) / 1000);
    if (view.intervalSeconds > 0) {
      progressPct = clamp01((elapsedSec % view.intervalSeconds) / view.intervalSeconds) * 100;
    }
  }

  const gainsText = lastGains.length
    ? '最近收获 ' + lastGains.map((g) => `${g.label} ${g.amount > 0 ? '+' : ''}${fmtNum(g.amount)}`).join(' · ')
    : null;

  return (
    <section
      className={`action-bar s-${phase}`}
      role="status"
      aria-label={`当前行动状态：${phase}`}
    >
      <div className="action-row">
        <span className="action-dot" />
        <div className="action-title">
          <small>{PHASE_TITLE[phase]}</small>
          <b>{phase === 'running' && view ? `${view.verb} · ${view.targetName}` : phase === 'settling' ? '旧序列结算中…' : PHASE_SUB[phase]}</b>
        </div>
        <div className="action-meta">
          {gainsText && <span className="action-gain num">{gainsText}</span>}
          {phase === 'cooldown' && <span className="count num" style={{ color: 'var(--cinnabar)' }}>恢复 {Math.ceil(cooldownRemainSeconds)}s</span>}
          {phase === 'running' && view && (
            <button className="btn-mini danger" onClick={onStop}>收功</button>
          )}
          {phase === 'idle' && (
            <button className="btn-mini" onClick={onGoAssign}>
              去指派 <ChevronRight size={11} style={{ verticalAlign: -1 }} />
            </button>
          )}
        </div>
      </div>
      <div className="track"><i style={{ width: `${progressPct}%` }} /></div>
      {(lastError || (view?.carrySeconds ?? 0) > 90) && (
        <span className="action-hint">
          {lastError ?? `含离线累计 ${fmtSpan(view?.carrySeconds ?? 0)}，结算后自动入库`}
        </span>
      )}
    </section>
  );
}

const PHASE_TITLE: Record<ActionBarPhase, string> = {
  idle: '神识空闲',
  running: '当前行动',
  settling: '切换收束',
  cooldown: '心神恢复',
};
const PHASE_SUB: Record<ActionBarPhase, string> = {
  idle: '未在运转任何行动',
  running: '',
  settling: '',
  cooldown: '上一场折戟，稍候自动恢复',
};

/* ============ 底部导航 ============ */
const NAV_ITEMS: Array<{ id: 'cave' | 'journey' | 'bag' | 'path'; label: string; Icon: typeof Home }> = [
  { id: 'cave', label: '洞府', Icon: Home },
  { id: 'journey', label: '历练', Icon: Compass },
  { id: 'bag', label: '行囊', Icon: Backpack },
  { id: 'path', label: '道途', Icon: UserRound },
];

export function BottomNav({ active, badges, onChange }: {
  active: string;
  badges: Partial<Record<'cave' | 'journey' | 'bag' | 'path', boolean>>;
  onChange(tab: 'cave' | 'journey' | 'bag' | 'path'): void;
}) {
  return (
    <nav className="bottom-nav">
      {NAV_ITEMS.map(({ id, label, Icon }) => (
        <button key={id} className={`nav-item${active === id ? ' active' : ''}`} onClick={() => onChange(id)}>
          <Icon size={19} strokeWidth={active === id ? 2.1 : 1.6} />
          <span>{label}</span>
          {badges[id] && <i className="badge-dot" />}
        </button>
      ))}
    </nav>
  );
}

/* ============ Toast ============ */
export type ToastItem = { id: number; text: string; tone: 'ok' | 'warn'; leaving?: boolean };

function toastGlyph(tone: 'ok' | 'warn') {
  return tone === 'warn'
    ? <CircleAlert size={13} />
    : <Check size={13} />;
}

export function ToastHost({ items }: { items: ToastItem[] }) {
  return (
    <div className="toast-host" aria-live="polite">
      {items.map((t) => (
        <span key={t.id} className={`toast${t.tone === 'warn' ? ' warn' : ''}${t.leaving ? ' out' : ''}`}>
          {toastGlyph(t.tone)}
          <span>{t.text}</span>
        </span>
      ))}
    </div>
  );
}
