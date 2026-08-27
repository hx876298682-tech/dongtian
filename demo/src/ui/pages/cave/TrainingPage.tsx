/** 练功房：功法卡片墙。卡片 = 功法名 + 当前等级 + 属性方向；点击出确认面板。 */
import { useGame } from '../../store/GameStore';
import { deriveActionView } from '../../store/actionView';
import { useShell } from '../../app/shell';
import { useActionFlow } from '../../flows/useActionFlow';
import { ConfirmSheet, SwitchWarnBlock } from '../../components/sheets';
import { QualityChip, SectionHead, EmptyHint, PageHeaderBack } from '../../components/primitives';
import { techniqueName, qualityMeta } from '../../content/meta';
import { techniqueGrowthFromCatalog } from '../../content/growth';

export function TrainingPage() {
  const { player, catalog } = useGame();
  const shell = useShell();
  const flow = useActionFlow(shell.showToast);
  const action = deriveActionView(player, catalog);

  if (!player || !catalog) return null;

  const techniques = catalog.techniques.filter((t) => t.status === 'released');
  const currentTechniqueId = action?.kind === 'technique_training' ? action.refId : null;
  const techLevels = player.skillLevels?.technique ?? {};

  const levelOf = (id: string): number | null => {
    const direct = techLevels[id];
    if (typeof direct === 'number') return direct;
    const suffix = id.split('.').pop();
    const hit = Object.entries(techLevels).find(([k]) => k.endsWith(`.${suffix}`) || k === suffix);
    return typeof hit?.[1] === 'number' ? hit[1] : null;
  };

  const openConfirm = (technique: (typeof techniques)[number]) => {
    const techniqueId = technique.id;
    shell.openSheet(
      <TechniqueSheet
        techniqueId={techniqueId}
        tech={technique}
        view={action}
        busy={flow.busy}
        onCancel={() => shell.closeSheet()}
        onStart={async () => {
          shell.closeSheet();
          await flow.startAction({ actionId: 'technique_training', techniqueId }, '功法修炼');
        }}
      />,
    );
  };

  return (
    <div className="pad">
      <PageHeaderBack title="练功房" sub={currentTechniqueId ? `正在研习 · ${techniqueName(currentTechniqueId)}` : '未在研习'} onClose={() => shell.closePage()} />

      <SectionHead title="功法目录" sub={`所藏 ${techniques.length} 部 · 修习皆增进修为`} />
      {techniques.length === 0 ? (
        <EmptyHint text="功法阁尚未收录任何可修习功法。" />
      ) : (
        <div className="card-grid">
          {techniques.map((tech) => {
            const meta = qualityMeta(tech.quality);
            const isCurrent = tech.id === currentTechniqueId;
            const lv = levelOf(tech.id);
            return (
              <button
                key={tech.id}
                className={`mini-card${isCurrent ? ' selected' : ''}`}
                onClick={() => !isCurrent && openConfirm(tech)}
              >
                {lv !== null && <span className="mc-lv num">Lv.{lv}</span>}
                <span className="mc-name">{techniqueName(tech.id)}</span>
                <span className="mc-sub">{techniqueGrowthFromCatalog(tech)}</span>
                <span style={{ marginTop: 2 }}><QualityChip quality={meta.label} /></span>
                <span style={{ fontSize: 10.5, color: isCurrent ? 'var(--jade)' : 'var(--gold)', fontWeight: 600 }}>
                  {isCurrent ? '研习中 · 点击收功后可换' : '点击研习'}
                </span>
              </button>
            );
          })}
        </div>
      )}

      {catalog.focusCultivation.status === 'proposal_v1' && (
        <p style={{ fontSize: 11, color: 'var(--ink-600)', lineHeight: 1.7 }}>
          「修为专注」功法尚在提案门禁（proposal），正式冻结后开放。
        </p>
      )}
    </div>
  );
}

function TechniqueSheet({
  techniqueId,
  tech,
  view,
  busy,
  onCancel,
  onStart,
}: {
  techniqueId: string;
  tech: Parameters<typeof techniqueGrowthFromCatalog>[0];
  view: ReturnType<typeof deriveActionView>;
  busy: boolean;
  onCancel(): void;
  onStart(): Promise<void> | void;
}) {
  const label = techniqueName(techniqueId);
  return (
    <ConfirmSheet title={`研习 · ${label}`} onClose={onCancel}>
      <div className="card card-padded" style={{ textAlign: 'center', paddingBlock: 16 }}>
        <b style={{ fontFamily: 'var(--font-display)', fontSize: 18, letterSpacing: '.08em' }}>{label}</b>
        <div style={{ marginTop: 6, fontSize: 11.5, color: 'var(--ink-600)' }}>
          研习期间每轮同时获得修为与《{label}》对应属性
        </div>
        <div style={{ marginTop: 8, fontSize: 11.5, color: 'var(--ink-900)', background: 'var(--bg-page)', padding: '8px 10px', borderRadius: 4 }}>
          {techniqueGrowthFromCatalog(tech)}
        </div>
      </div>
      <SwitchWarnBlock view={view} newLabel={`${label}研习`} />
      <button className="btn-primary" disabled={busy} onClick={() => void onStart()}>
        {busy ? '结算旧序列…' : '开始修炼'}
      </button>
    </ConfirmSheet>
  );
}
