/** 炼器室：器方卡片墙。卡片 = 器名 + 部位/品质 + 耗时；点击出成品预览确认。锻成装备经正式 writer 直接入库。 */
import { useGame } from '../../store/GameStore';
import { deriveActionView } from '../../store/actionView';
import { useShell } from '../../app/shell';
import { useActionFlow } from '../../flows/useActionFlow';
import { ConfirmSheet, SwitchWarnBlock } from '../../components/sheets';
import { EmptyHint, PageHeaderBack, QualityChip } from '../../components/primitives';
import { ItemGlyph } from '../../components/ItemGlyph';
import { slotLabel, qualityMeta } from '../../content/meta';
import { EQUIPMENT_DISPLAY } from '../../content/growth';
import { fmtSpan } from '../../api/format';

export function ForgePage() {
  const { player, catalog } = useGame();
  const shell = useShell();
  const flow = useActionFlow(shell.showToast);
  const action = deriveActionView(player, catalog);

  if (!player || !catalog) return null;

  const forgeRecipes = catalog.recipes.filter((r) => r.actionId === 'forge' && r.status === 'released');
  const templates = catalog.equipmentTemplates.filter((t) => t.status === 'released');
  const runningThis = action?.home === 'forge';

  return (
    <div className="pad">
      <PageHeaderBack title="炼器室" sub={runningThis ? `引火淬炼中 · ${action?.targetName}` : '炉冷砧静，择一器型'} onClose={() => shell.closePage()} />

      {forgeRecipes.length === 0 || templates.length === 0 ? (
        <EmptyHint text="器方与图样尚未释出，待内容门禁开放后入驻。" />
      ) : (
        <div className="card-grid">
          {templates.map((template) => {
            const meta = qualityMeta(template.quality);
            const isCurrent = runningThis && action?.targetId?.includes(template.id);
            return (
              <button
                key={template.id}
                className={`mini-card${isCurrent ? ' selected' : ''}`}
                onClick={() => !isCurrent && openPreview(template.id)}
              >
                <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span className={`equip-frame ${meta.cls}`} style={{ width: 34, height: 34 }}>
                    <ItemGlyph slot={template.slot} size={20} />
                  </span>
                  <span className="mc-name">{template.displayName}</span>
                </span>
                <span className="mc-sub">{slotLabel(template.slot)} · 锻成自动入库</span>
                <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 2 }}>
                  <QualityChip quality={meta.label} />
                  {isCurrent
                    ? <span style={{ fontSize: 10.5, color: 'var(--jade)', fontWeight: 600 }}>锻造中</span>
                    : <span style={{ fontSize: 10.5, color: 'var(--gold)', fontWeight: 600 }}>点击预览</span>}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );

  function openPreview(templateId: string): void {
    if (!catalog) return;
    const template = catalog.equipmentTemplates.find((t) => t.id === templateId);
    if (!template) return;
    const meta = qualityMeta(template.quality);
    shell.openSheet(
      <ConfirmSheet title="锻器预览" onClose={() => shell.closeSheet()}>
        <div className="equip-hero" style={{ paddingInline: 4 }}>
          <span className={`equip-frame ${meta.cls}`} style={{ color: 'var(--ink-900)' }}>
            <ItemGlyph slot={template.slot} size={44} />
          </span>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
            <b style={{ fontSize: 15 }}>{template.displayName}</b>
            <QualityChip quality={meta.label} />
            <small style={{ color: 'var(--ink-600)' }}>
              {slotLabel(template.slot)}
              {forgeRecipes[0] ? ` · ${fmtSpan(forgeRecipes[0].intervalSeconds)}` : ''} · 锻成后自动入库
            </small>
            <small style={{ color: 'var(--ink-600)', fontSize: 10.5 }}>
              基础属性预算 {EQUIPMENT_DISPLAY.slotBudget(template.slot)}（品阶倍率 {meta.label}）
            </small>
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
    );
  }
}
