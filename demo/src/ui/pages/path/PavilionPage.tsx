/** 功法阁：所藏功法卡片总览 + 品阶筛选；未获得功法显示获取条件。
    研究（technique_research）门禁开放后从卡片发起。 */
import { useState } from 'react';
import { useGame } from '../../store/GameStore';
import { useShell } from '../../app/shell';
import { QualityChip, PageHeaderBack, EmptyHint } from '../../components/primitives';
import { techniqueName, qualityMeta } from '../../content/meta';

const FILTERS: Array<{ key: string; label: string }> = [
  { key: 'all', label: '全部' },
  { key: 'mortal', label: '凡阶' },
  { key: 'yellow', label: '黄阶' },
  { key: 'xuan', label: '玄阶' },
  { key: 'earth', label: '地阶' },
  { key: 'heaven', label: '天阶' },
  { key: 'immortal', label: '仙阶' },
];

/** 未获得功法的获取条件（内容侧占位口径：凡黄入门可修，玄以上出自秘境探索）。 */
function acquireHint(quality: string): string {
  switch (quality) {
    case 'mortal':
    case 'yellow': return '获取条件：练功房入门即可修习';
    case 'xuan': return '获取条件：秘境探索 · 清风秘境起';
    case 'earth': return '获取条件：秘境探索 · 炎狱秘境起';
    case 'heaven':
    case 'immortal': return '获取条件：高阶秘境与洞天深造（待开放）';
    default: return '获取条件：待内容侧补充';
  }
}

export function PavilionPage() {
  const { player, catalog } = useGame();
  const shell = useShell();
  const [filter, setFilter] = useState('all');

  if (!player || !catalog) return null;

  const all = catalog.techniques.filter((t) => t.status !== 'content_pending');
  const shown = filter === 'all' ? all : all.filter((t) => t.quality === filter);
  const techLevels = player.skillLevels?.technique ?? {};

  const levelOf = (id: string): number | null => {
    const direct = techLevels[id];
    if (typeof direct === 'number') return direct;
    const suffix = id.split('.').pop();
    const hit = Object.entries(techLevels).find(([k]) => k.endsWith(`.${suffix}`) || k === suffix);
    return typeof hit?.[1] === 'number' ? hit[1] : null;
  };

  return (
    <div className="pad">
      <PageHeaderBack title="功法阁" sub={`所藏 ${all.length} 部 · 已研习 ${all.filter((t) => levelOf(t.id) !== null).length} 部`} onClose={() => shell.closePage()} />

      <div className="filter-chips">
        {FILTERS.map((f) => (
          <button key={f.key} className={`f-chip${filter === f.key ? ' active' : ''}`} onClick={() => setFilter(f.key)}>
            {f.label}
          </button>
        ))}
      </div>

      {shown.length === 0 ? (
        <EmptyHint text="此品阶暂无所藏。" />
      ) : (
        <div className="card-grid">
          {shown.map((tech) => {
            const meta = qualityMeta(tech.quality);
            const lv = levelOf(tech.id);
            const owned = lv !== null;
            return (
              <div key={tech.id} className="mini-card" style={owned ? undefined : { opacity: .62 }}>
                {owned
                  ? <span className="mc-lv num">Lv.{lv}</span>
                  : <span className="mc-lv" style={{ color: 'var(--ink-600)', background: 'var(--bg-sunken)' }}>未获得</span>}
                <span className="mc-name">{techniqueName(tech.id)}</span>
                {owned ? (
                  <span className="mc-sub">已研习 · 层数随修炼增长</span>
                ) : (
                  <span className="mc-sub" style={{ color: 'var(--gold)' }}>{acquireHint(tech.quality)}</span>
                )}
                <span><QualityChip quality={meta.label} /></span>
              </div>
            );
          })}
        </div>
      )}

      <p style={{ fontSize: 11, color: 'var(--ink-600)', lineHeight: 1.7 }}>
        功法研究（长期挂机提升层数上限）与功法阁建筑升级将随境界与门禁开放逐步点亮。
      </p>
    </div>
  );
}
