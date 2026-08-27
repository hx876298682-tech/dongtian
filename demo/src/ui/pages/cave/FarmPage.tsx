/** 灵田药圃：2×2 田契网格，四态展示；显式种植、不占主行动；成熟随下次结算入库。 */
import { useState } from 'react';
import { useGame } from '../../store/GameStore';
import { useShell } from '../../app/shell';
import { useActionFlow } from '../../flows/useActionFlow';
import { ConfirmSheet } from '../../components/sheets';
import { PageHeaderBack, EmptyHint } from '../../components/primitives';
import { FARM_PLANTS, plantName, errorText } from '../../content/meta';
import type { ApiError } from '../../api/client';
import { fmtClock } from '../../api/format';

const PLOT_COUNT = 4;

const ALCHEMY_NAMES: Record<string, string> = {
  alchemy_basic: '聚气丹',
};

export function FarmPage() {
  const { player, catalog, client, now } = useGame();
  const shell = useShell();
  const flow = useActionFlow(shell.showToast);
  const [plantingPlot, setPlantingPlot] = useState<string | null>(null);


  if (!player) return null;
  const farm = player.buildings?.spirit_farm;
  // 种子用途：从 catalog 中找以灵草为输入的丹方（仅展示名称，数值不在前端推算）
  const herbUses = (catalog?.recipes ?? [])
    .filter((r) => r.actionId === 'alchemy' && (r.inputCosts.spirit_herb ?? 0) > 0)
    .map((r) => ALCHEMY_NAMES[r.id] ?? r.id)
    .join('、') || '入库炼丹材料';

  const legacyBatch = farm?.plantedPlots !== undefined && farm.plantedPlots !== null && (farm.plantedPlots ?? 0) > 0
    ? farm.plantedPlots : 0;
  const plots = Array.from({ length: PLOT_COUNT }, (_, i) => {
    const plotId = `plot_${i + 1}`;
    const record = farm?.spiritFarmPlots?.[plotId];
    return { plotId, record };
  });
  const nowMs = now();

  return (
    <div className="pad">
      <PageHeaderBack title="灵田药圃" sub="不占当前行动 · 成熟后随结算自动入库" onClose={() => shell.closePage()} />

      {legacyBatch > 0 && (
        <div className="gate-banner gate-blocked">
          旧版整片种植（{legacyBatch} 格）待收获结算后方可改用逐格播种。
        </div>
      )}

      <div className="plot-grid">
        {plots.map(({ plotId, record }) => {
          if (!record) {
            return (
              <button key={plotId} className="plot-box plot-empty" onClick={() => setPlantingPlot(plotId)}>
                <span style={{ fontFamily: 'var(--font-display)', fontWeight: 700 }}>第 {plotId.split('_')[1]} 号田</span>
                <span>虚位以待 · 点击播种</span>
              </button>
            );
          }
          const matureAtMs = Date.parse(record.matureAt);
          const matured = matureAtMs <= nowMs;
          return (
            <div key={plotId} className={`plot-box ${matured ? 'plot-mature' : 'plot-growing'}`}>
              <span className="plot-name">{plantName(record.plantId)}</span>
              {matured ? (
                <span className="plot-tag">已成熟 · 待下次结算入库</span>
              ) : (
                <>
                  <span className="timer">{fmtClock((matureAtMs - nowMs) / 1000)}</span>
                  <span className="plot-tag">生长中</span>
                </>
              )}
            </div>
          );
        })}
      </div>

      <p style={{ fontSize: 11, color: 'var(--ink-600)', lineHeight: 1.7 }}>
        灵田与修炼互不相扰：播种不影响你的当前行动；灵物成熟后无需收取——下一次任何结算发生时会自动入库。
      </p>

      {/* 种植面板挂在全局 sheet 层 */}
      {plantingPlot && (
        <PlantSheet
          plotId={plantingPlot}
          busy={flow.busy}
          onClose={() => setPlantingPlot(null)}
          herbUses={herbUses}
          onPick={async (plantId, name) => {
            try {
              await flow.runMutation(
                () => client.plantPlot(plantingPlot, plantId, player.stateRevision),
                `${name} 已播入第 ${plantingPlot.split('_')[1]} 号田`,
              );
            } catch (error) {
              shell.showToast(errorText((error as ApiError).code), 'warn');
            }
            setPlantingPlot(null);
          }}
        />
      )}
    </div>
  );

  function PlantSheet({ plotId, busy, onClose, onPick, herbUses }: {
    plotId: string; busy: boolean; onClose(): void; herbUses: string;
    onPick(plantId: string, name: string): Promise<void>;
  }) {
    if (!FARM_PLANTS.length) return <EmptyHint text="暂无可种灵物" />;
    return (
      <ConfirmSheet title={`为第 ${plotId.split('_')[1]} 号田选种`} onClose={() => { setPlantingPlot(null); onClose(); }}>
        {FARM_PLANTS.map((plant) => (
          <button key={plant.id} className="option-row" disabled={busy} onClick={() => void onPick(plant.id, plant.name)}>
            <span className="option-main">
              <b>{plant.name}</b>
              <span className="option-sub">成熟时长由灵田等级决定；成熟自动入库</span>
              <span className="option-sub" style={{ color: 'var(--gold)' }}>可用途：{herbUses}</span>
            </span>
            <span className="btn-mini">播种</span>
          </button>
        ))}
      </ConfirmSheet>
    );
  }
}
