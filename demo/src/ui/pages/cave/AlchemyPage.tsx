/** 炼丹房：配方账簿 + 批次说明 + 单序列起点。
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
        recipes.map((recipe) => {
          const costs = Object.entries(recipe.inputCosts) as Array<[ResourceId, number]>;
          const isCurrent = runningThis && action?.refId === recipe.id;
          return (
            <div key={recipe.id} className={`map-card${isCurrent ? ' current' : ''}`}>
              <div className="map-body">
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                  <b style={{ fontFamily: 'var(--font-display)', fontSize: 15.5 }}>{RECIPE_DISPLAY[recipe.id] ?? recipe.id}</b>
                  <small style={{ color: 'var(--ink-600)' }}>单批 {fmtSpan(recipe.intervalSeconds)}</small>
                  {isCurrent && <span className="badge-current" style={{ marginLeft: 'auto' }}>炼制中</span>}
                </div>
                <div className="drop-row">
                  消耗：
                  {costs.map(([resId, amount]) => {
                    const have = player.resources[resId]?.amount ?? 0;
                    const enough = have >= amount;
                    return (
                      <span key={resId} className="drop-chip" style={!enough ? { color: 'var(--cinnabar)' } : undefined}>
                        {RESOURCE_META[resId].name} ×{fmtNum(amount)}（有 {fmtNum(have)}）
                      </span>
                    );
                  })}
                </div>
                <div className="drop-row">
                  产出：<span className="drop-chip">{RESOURCE_META[recipe.outputResource as ResourceId]?.name ?? recipe.outputResource} ×{fmtNum(recipe.outputAmount)}/批</span>
                  <small style={{ color: 'var(--ink-600)' }}>完成后自动入库，直至材料耗尽或库存满</small>
                </div>
                <div className="map-foot">
                  <small>丹炉等级加成由建筑决定</small>
                  <button
                    className="btn-go"
                    disabled={isCurrent || flow.busy}
                    onClick={() =>
                      openAlchemyConfirm(recipe.id, RECIPE_DISPLAY[recipe.id] ?? recipe.id)
                    }
                  >
                    {isCurrent ? '进行中' : '开炉'}
                  </button>
                </div>
              </div>
            </div>
          );
        })
      )}
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

const RECIPE_DISPLAY: Record<string, string> = {
  alchemy_basic: '聚气丹',
};
