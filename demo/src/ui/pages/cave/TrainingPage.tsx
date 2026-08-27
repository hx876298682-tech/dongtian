/** 练功房：功法目录 + 确认面板。修炼任何功法同时增长修为与该功法属性（运行时口径）。 */
import { useGame } from '../../store/GameStore';
import { deriveActionView } from '../../store/actionView';
import { useShell } from '../../app/shell';
import { useActionFlow } from '../../flows/useActionFlow';
import { ConfirmSheet, SwitchWarnBlock } from '../../components/sheets';
import { QualityChip, SectionHead, EmptyHint, PageHeaderBack } from '../../components/primitives';
import { techniqueName, qualityMeta } from '../../content/meta';

export function TrainingPage() {
  const { player, catalog } = useGame();
  const shell = useShell();
  const flow = useActionFlow(shell.showToast);
  const action = deriveActionView(player, catalog);

  if (!player || !catalog) return null;

  const techniques = catalog.techniques.filter((t) => t.status === 'released');
  const currentTechniqueId = action?.kind === 'technique_training' ? action.refId : null;

  const openConfirm = (techniqueId: string) => {
    shell.openSheet(
      <TechniqueSheet
        techniqueId={techniqueId}
        view={action}
        busy={flow.busy}
        onCancel={() => shell.closeSheet()}
        onStart={async () => {
          shell.closeSheet();
          await flow.startAction({ actionId: 'technique_training', techniqueId }, `功法修炼`);
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
        <div className="journal-panel">
          {techniques.map((tech) => {
            const meta = qualityMeta(tech.quality);
            const isCurrent = tech.id === currentTechniqueId;
            return (
              <button
                key={tech.id}
                className={`option-row${isCurrent ? ' selected' : ''}`}
                onClick={() => !isCurrent && openConfirm(tech.id)}
                style={{ borderRadius: 0, boxShadow: 'none', borderBottom: '1px dashed var(--line)' }}
              >
                <span className="option-main">
                  <b>{techniqueName(tech.id)}{isCurrent ? ' · 研习中' : ''}</b>
                  <span className="option-sub">每轮推进修为与该功法专属属性</span>
                </span>
                <QualityChip quality={meta.label} />
                {!isCurrent && <span className="btn-mini">研习</span>}
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
  view,
  busy,
  onCancel,
  onStart,
}: {
  techniqueId: string;
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
      </div>
      <SwitchWarnBlock view={view} newLabel={`${label}研习`} />
      <button className="btn-primary" disabled={busy} onClick={() => void onStart()}>
        {busy ? '结算旧序列…' : '开始修炼'}
      </button>
    </ConfirmSheet>
  );
}
