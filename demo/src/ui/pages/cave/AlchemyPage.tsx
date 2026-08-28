/** 炼丹房：丹方卡片墙。卡片 = 丹名 + 消耗/产出/耗时；点击出确认面板。
    运行时口径：暂无 quantity DTO，序列持续炼制直至材料耗尽或库存满。 */
import { useGame } from '../../store/GameStore';
import { deriveActionView } from '../../store/actionView';
import { useShell } from '../../app/shell';
import { useActionFlow } from '../../flows/useActionFlow';
import { ConfirmSheet, SwitchWarnBlock } from '../../components/sheets';
import { EmptyHint, PageHeaderBack } from '../../components/primitives';
import type { ResourceId } from '../../content/meta';
import { RESOURCE_META } from '../../content/meta';
import { fmtNum, fmtSpan } from '../../api/format';

const RECIPE_DISPLAY: Record<string, string> = {
  alchemy_basic: '聚气丹',
};

export function AlchemyPage() {
  const { player, catalog } = useGame();
  const shell = useShell();
  const flow = useActionFlow(shell.showToast);
  const action = deriveActionView(player, catalog);

  if (!player || !catalog) return null;

  const recipes = catalog.recipes.filter((r) => r.actionId === 'alchemy' && r.status === 'released');
  const runningThis = action?.home === 'alchemy';

  return (
    <div className="pad">
      <PageHeaderBack title="炼丹房" sub={runningThis ? `炉火正旺 · ${action?.targetName}` : '丹炉清冷，可开一炉'} onClose={() => shell.closePage()} />

      {recipes.length === 0 ? (
        <EmptyHint text="丹方尚未释出，待内容门禁开放后入驻。" />
      ) : (
        <div className="card-grid">
          {recipes.map((recipe) => {
            const costs = Object.entries(recipe.inputCosts) as Array<[ResourceId, number]>;
            const isCurrent = runningThis && action?.refId === recipe.id;
            const label = RECIPE_DISPLAY[recipe.id] ?? recipe.id;
            const lacking = costs.some(([resId, amount]) => (player.resources[resId]?.amount ?? 0) < amount);
            return (
              <button
                key={recipe.id}
                className={`mini-card${isCurrent ? ' selected' : ''}`}
                onClick={() => !isCurrent && openAlchemyConfirm(recipe.id, label)}
              >
                {isCurrent && <span className="mc-lv" style={{ color: 'var(--jade)', background: 'var(--jade-bg)' }}>炼制中</span>}
                <span className="mc-name">{label}</span>
                {costs.map(([resId, amount]) => {
                  const have = player.resources[resId]?.amount ?? 0;
                  const enough = have >= amount;
                  return (
                    <span key={resId} className="mc-sub" style={{ color: enough ? undefined : 'var(--cinnabar)' }}>
                      {RESOURCE_META[resId].name} {fmtNum(amount)} <span style={{ opacity: .7 }}>(有 {fmtNum(have)})</span>
                    </span>
                  );
                })}
                <span className="mc-sub">产出 {RESOURCE_META[recipe.outputResource as ResourceId]?.name ?? recipe.outputResource} ×{fmtNum(recipe.outputAmount)} · {fmtSpan(recipe.intervalSeconds)}/批</span>
                <span style={{ fontSize: 10.5, color: isCurrent ? 'var(--jade)' : lacking ? 'var(--cinnabar)' : 'var(--gold)', fontWeight: 600 }}>
                  {isCurrent ? '进行中' : lacking ? '材料不足' : '点击开炉'}
                </span>
              </button>
            );
          })}
        </div>
      )}

      <p style={{ fontSize: 11, color: 'var(--ink-600)', lineHeight: 1.7 }}>
        炼制占用当前行动；完成后持续炼制，产出自动入库，直至材料耗尽或库存满。
        <br />更多丹方（紫云丹·凝露散等，将分别对应紫云花/凝露草）待草药品种体系冻结后开放。
      </p>
    </div>
  );

  function openAlchemyConfirm(recipeId: string, label: string) {
    shell.openSheet(
      <ConfirmSheet title={`开炉 · ${label}`} onClose={() => shell.closeSheet()}>
        <div className="card card-padded" style={{ textAlign: 'center', paddingBlock: 14 }}>
          <b style={{ fontFamily: 'var(--font-display)', fontSize: 17 }}>{label}</b>
          <p style={{ fontSize: 11.5, color: 'var(--ink-600)', marginTop: 5 }}>
            炼制占用当前行动；产出随批次完成自动入库
          </p>
        </div>
        <SwitchWarnBlock view={action} newLabel={`${label}炼制`} />
        <button
          className="btn-primary"
          disabled={flow.busy}
          onClick={() => {
            shell.closeSheet();
            void flow.startAction({ actionId: 'alchemy', recipeId }, `炼制·${label}`);
          }}
        >
          {flow.busy ? '结算旧序列…' : '开始炼制'}
        </button>
      </ConfirmSheet>,
    );
  }
}
