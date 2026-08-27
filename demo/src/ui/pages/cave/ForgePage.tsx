/** 炼器室：六部位器方 + 成品预览确认。锻成装备经正式 writer 直接入库。 */
import { useState } from 'react';
import { useGame } from '../../store/GameStore';
import { deriveActionView } from '../../store/actionView';
import { useShell } from '../../app/shell';
import { useActionFlow } from '../../flows/useActionFlow';
import { ConfirmSheet, SwitchWarnBlock } from '../../components/sheets';
import { EmptyHint, PageHeaderBack, QualityChip } from '../../components/primitives';
import { ItemGlyph } from '../../components/ItemGlyph';
import { SLOT_LABELS, slotLabel, qualityMeta } from '../../content/meta';

export function ForgePage() {
  const { player, catalog } = useGame();
  const shell = useShell();
  const flow = useActionFlow(shell.showToast);
  const action = deriveActionView(player, catalog);
  const [slotFilter, setSlotFilter] = useState<string>('weapon');

  if (!player || !catalog) return null;

  const forgeRecipes = catalog.recipes.filter((r) => r.actionId === 'forge' && r.status === 'released');
  const templates = catalog.equipmentTemplates.filter(
    (t) => t.status === 'released' && (slotFilter ? t.slot === slotFilter : true),
  );
  const runningThis = action?.home === 'forge';

  return (
    <div className="pad">
      <PageHeaderBack title="炼器室" sub={runningThis ? `引火淬炼中 · ${action?.targetName}` : '炉冷砧静，择一器型'} onClose={() => shell.closePage()} />

      {forgeRecipes.length === 0 ? (
        <EmptyHint text="器方与图样尚未释出，待内容门禁开放后入驻。" />
      ) : (
        <>
          <div className="segmented">
            {SLOT_LABELS.map(({ slot, label }) => (
              <button key={slot} className={`seg-btn${slot === slotFilter ? ' active' : ''}`} onClick={() => setSlotFilter(slot)}>
                {label.replace('护甲·', '')}
              </button>
            ))}
          </div>

          {templates.length === 0 && <EmptyHint text="该部位暂无已释出的器样。" />}
          <div className="journal-panel">
            {templates.map((template) => {
              const meta = qualityMeta(template.quality);
              const isCurrent = runningThis && action?.targetId?.includes(template.id);
              return (
                <button
                  key={template.id}
                  className={`option-row${isCurrent ? ' selected' : ''}`}
                  style={{ borderRadius: 0, boxShadow: 'none', borderBottom: '1px dashed var(--line)' }}
                  disabled={isCurrent || flow.busy}
                  onClick={() =>
                    shell.openSheet(
                      <ConfirmSheet title="锻器预览" onClose={() => shell.closeSheet()}>
                        <div className="equip-hero" style={{ paddingInline: 4 }}>
                          <span className={`equip-frame ${meta.cls}`} style={{ color: 'currentColor' }}>
                            <ItemGlyph slot={template.slot} size={44} />
                          </span>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                            <b style={{ fontSize: 15 }}>{template.displayName}</b>
                            <QualityChip quality={meta.label} />
                            <small style={{ color: 'var(--ink-600)' }}>{slotLabel(template.slot)} · 锻成后自动入库</small>
                          </div>
                        </div>
                        <SwitchWarnBlock view={action} newLabel={`${template.displayName}锻造`} />
                        <button
                          className="btn-primary"
                          disabled={flow.busy}
                          onClick={() => {
                            shell.closeSheet();
                            void flow.startAction(
                              { actionId: 'forge', recipeId: forgeRecipes[0].id, equipmentTemplateId: template.id },
                              `锻造·${template.displayName}`,
                            );
                          }}
                        >
                          {flow.busy ? '结算旧序列…' : '开始锻造'}
                        </button>
                      </ConfirmSheet>,
                    )
                  }
                >
                  <span className="option-main">
                    <b>{template.displayName}{isCurrent ? ' · 锻造中' : ''}</b>
                    <span className="option-sub">{slotLabel(template.slot)}</span>
                  </span>
                  <QualityChip quality={meta.label} />
                  <span className="btn-mini">预览</span>
                </button>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
