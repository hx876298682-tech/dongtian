/** 跨页通用头部（二级页返回行） */
import { ChevronLeft } from 'lucide-react';

export function PageHeaderBack({ title, sub, onClose }: { title: string; sub?: string; onClose(): void }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 2 }}>
      <button className="icon-btn" onClick={onClose} aria-label="返回"><ChevronLeft size={18} /></button>
      <div>
        <b style={{ fontFamily: 'var(--font-display)', fontSize: 17, letterSpacing: '.05em' }}>{title}</b>
        {sub && <div style={{ fontSize: 10.5, color: 'var(--ink-600)', marginTop: 1 }}>{sub}</div>}
      </div>
    </div>
  );
}
