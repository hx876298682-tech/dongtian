/** 功法阁：所藏功法卡片总览 + 品阶筛选；未获得功法显示获取条件。
    研究（technique_research）门禁开放后从卡片发起。 */
import { useState } from 'react';
import { useGame } from '../../store/GameStore';
import { useShell } from '../../app/shell';
import { useActionFlow } from '../../flows/useActionFlow';
import { ConfirmSheet, SwitchWarnBlock } from '../../components/sheets';
import { useTicker } from '../../hooks';
import { QualityChip, PageHeaderBack, EmptyHint } from '../../components/primitives';
import { techniqueName, qualityMeta } from '../../content/meta';
import { techniqueBonusAtLevel } from '../../content/growth';

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
  const flow = useActionFlow(shell.showToast);
  const [filter, setFilter] = useState('all');
  useTicker(1000);

  if (!player || !catalog) return null;

  const [researchTarget, setResearchTarget] = useState<string | null>(null);
  const all = catalog.techniques.filter((t) => t.status !== 'content_pending');
  // 研修研修中的功法（主行动 = technique_training）不能同时作为研究目标
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
                  <span className="mc-sub">已加属性：攻+{techniqueBonusAtLevel(tech, lv ?? 0).attack} 防+{techniqueBonusAtLevel(tech, lv ?? 0).defence} 血+{techniqueBonusAtLevel(tech, lv ?? 0).health}</span>
                ) : (
                  <>
                    <span className="mc-sub">每层成长见品阶（数值以冻结表为准）</span>
                    <span className="mc-sub" style={{ color: 'var(--gold)' }}>{acquireHint(tech.quality)}</span>
                  </>
                )}
                <span><QualityChip quality={meta.label} /></span>
              </div>
            );
          })}
        </div>
      )}

      <p style={{ fontSize: 11, color: 'var(--ink-600)', lineHeight: 1.7 }}>
        点选功法卡可发起「研修」：研修占用当前行动，产出研修心得（technique_research_xp），心得用于解锁新功法与提升层数。解锁新功法另需古修残卷与灵石。
      </p>

      {researchTarget && (
        <ResearchSheet
          techniqueId={researchTarget}
          owned={levelOf(researchTarget) !== null}
          busy={flow.busy}
          onClose={() => setResearchTarget(null)}
          onStart={async () => {
            const id = researchTarget;
            setResearchTarget(null);
            await flow.startAction({ actionId: 'technique_research', techniqueId: id }, `研修·${techniqueName(id)}`);
          }}
        />
      )}
    </div>
  );
}

function ResearchSheet({ techniqueId, owned, busy, onClose, onStart }: {
  techniqueId: string; owned: boolean; busy: boolean; onClose(): void; onStart(): Promise<void>;
}) {
  const label = techniqueName(techniqueId);
  return (
    <ConfirmSheet title={`研修 · ${label}`} onClose={onClose}>
      <div className="card card-padded" style={{ textAlign: 'center', paddingBlock: 14 }}>
        <b style={{ fontFamily: 'var(--font-display)', fontSize: 17 }}>{label}</b>
        <p style={{ fontSize: 11.5, color: 'var(--ink-600)', marginTop: 6, lineHeight: 1.7 }}>
          {owned
            ? '研修产出心得，逐层提升此功法层数（每层消耗按冻结公式递增）。'
            : '首次解锁需消耗古修残卷与灵石（数量以服务端校验为准），解锁后再研修提升层数。'}
        </p>
      </div>
      <SwitchWarnBlock view={null} newLabel={`研修·${label}`} />
      <button className="btn-primary" disabled={busy} onClick={() => void onStart()}>
        {busy ? '结算旧序列…' : '开始研修'}
      </button>
    </ConfirmSheet>
  );
}

