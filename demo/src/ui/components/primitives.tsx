/** 跨页通用小组件 */
import type { ReactNode } from 'react';
import { qualityMeta } from '../content/meta';
import { fmtNum } from '../api/format';

export { PageHeaderBack } from './PageHeaderBack';

export function SectionHead({ title, sub, tail }: { title: string; sub?: string; tail?: ReactNode }) {
  return (
    <div className="section-head">
      <h2>{title}</h2>
      {sub && <small>{sub}</small>}
      {tail && <span className="tail">{tail}</span>}
    </div>
  );
}

export function QualityChip({ quality }: { quality: string }) {
  const meta = qualityMeta(quality);
  return <span className={`q-chip ${meta.cls}`}>{meta.label}</span>;
}

export function SkeletonCard({ height = 64 }: { height?: number }) {
  return <div className="skeleton" style={{ height }} aria-label="加载中" />;
}

export function RevealCard({ glyph, title, desc }: { glyph: string; title: string; desc: string }) {
  return (
    <div className="reveal-card">
      <span className="glyph">{glyph}</span>
      <div>
        <b>{title}</b>
        <p>{desc}</p>
      </div>
    </div>
  );
}

export function EmptyHint({ text }: { text: string }) {
  return (
    <div style={{ textAlign: 'center', color: 'var(--ink-600)', fontSize: 11.5, padding: '18px 0', lineHeight: 1.7 }}>
      {text}
    </div>
  );
}

export function Num({ value, suffix }: { value: number | undefined | null; suffix?: string }) {
  return <span className="num">{fmtNum(value)}{suffix ?? ''}</span>;
}
