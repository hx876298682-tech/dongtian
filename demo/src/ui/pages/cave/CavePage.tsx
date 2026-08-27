/** 洞府首页：洞天卡（等级/加成/升级） · 主动之所 · 长养之所
    突破入口已移至道途页；入库流水入口移至行囊页。 */
import { useState } from 'react';
import { Beaker, BookOpen, Hammer, Sprout, TrendingUp } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useGame } from '../../store/GameStore';
import { deriveActionView } from '../../store/actionView';
import { useShell, type PageId } from '../../app/shell';
import { ConfirmSheet } from '../../components/sheets';
import { realmLabel } from '../../content/meta';
import { fmtNum } from '../../api/format';
import { REALMS } from '../../../game/config';

type BuildingKey = 'training' | 'alchemy' | 'forge';

/** 洞天等级/升级属于待实装玩法（服务端 buildingIds 暂无 cave）：
    交互先落地，数值与升级走 fail-closed 提示。 */
const CAVE_LEVEL_PLACEHOLDER = 1;

export function CavePage() {
  const { player, catalog, now } = useGame();
  const shell = useShell();
  const [upgradeSheet, setUpgradeSheet] = useState(false);
  const action = deriveActionView(player, catalog);

  if (!player || !catalog) return null;

  const realmMax = (REALMS as Record<string, { cultivationMax: number }>)[player.realmId]?.cultivationMax ?? null;
  const farmPlots = Object.values(player.buildings?.spirit_farm?.spiritFarmPlots ?? {});
  const growing = farmPlots.filter((p) => Date.parse(p.matureAt) > now()).length;
  const matured = farmPlots.length - growing;

  const primaryBuildings: Array<{ key: PageId; bldKey?: BuildingKey; name: string; desc: string; Icon: LucideIcon }> = [
    { key: 'training', bldKey: 'training', name: '练功房', desc: actionSummary(action, 'training'), Icon: BookOpen },
    { key: 'alchemy', bldKey: 'alchemy', name: '炼丹房', desc: actionSummary(action, 'alchemy'), Icon: Beaker },
    { key: 'forge', bldKey: 'forge', name: '炼器室', desc: actionSummary(action, 'forge'), Icon: Hammer },
  ];

  return (
    <div className="pad">
      {/* ===== 洞天卡 ===== */}
      <div className="cave-hero">
        <div className="hero-top scene-dongtian">
          <span className="hero-seal">洞</span>
          <div style={{ flex: 1 }}>
            <div className="hero-title">云岫洞天</div>
            <div className="hero-sub">{realmLabel(player.realmId)} · 洞天 {CAVE_LEVEL_PLACEHOLDER} 级</div>
          </div>
          <button
            className="btn-mini"
            style={{ background: 'rgba(247,245,236,.16)', color: '#f2efe4', boxShadow: 'inset 0 0 0 1px rgba(242,239,228,.4)' }}
            onClick={() => setUpgradeSheet(true)}
          >
            <TrendingUp size={11} style={{ verticalAlign: -1.5 }} /> 升级
          </button>
        </div>
        <div className="hero-body">
          <div className="bonus-line">
            <b>当前加成</b><br />
            灵田 Lv.1 · 生长速度 ×1.0
            <span style={{ color: 'var(--ink-300)' }}> · 其余建筑加成待洞天等级开启</span>
          </div>
        </div>
      </div>

      {/* ===== 修为摘要 ===== */}
      <div className="card card-padded" style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 11, color: 'var(--ink-600)', marginBottom: 4 }}>当前修为</div>
          <b className="num" style={{ fontSize: 20 }}>
            {fmtNum(player.cultivationXp)}
            {realmMax ? <span style={{ fontSize: 12, color: 'var(--ink-600)' }}> / {fmtNum(realmMax)}</span> : null}
          </b>
        </div>
        <span style={{ fontSize: 10.5, color: 'var(--ink-300)' }}>突破入口见道途</span>
      </div>

      <h2 className="section-head" style={{ marginTop: 4 }}>
        <span style={{ fontFamily: 'var(--font-display)', fontSize: 15, fontWeight: 700 }}>主动之所</span>
        <small style={{ fontSize: 10.5, color: 'var(--ink-600)' }}>共用一个当前行动</small>
      </h2>
      <div className="building-grid">
        {primaryBuildings.map(({ key, bldKey, name, desc, Icon }) => (
          <button key={key} className={`bld-card${action?.home === bldKey ? ' running' : ''}`} onClick={() => shell.openPage(key)}>
            <div className="bld-top">
              <span className="bld-icon"><Icon size={17} /></span>
              <span className="bld-status">{action?.home === bldKey ? '运转中' : '可进入'}</span>
            </div>
            <b className="bld-name">{name}</b>
            <span className="bld-desc">{desc}</span>
          </button>
        ))}
        <button className="reveal-card" style={{ textAlign: 'left' }} onClick={() => shell.openPage('pavilion')}>
          <span className="glyph">阁</span>
          <div>
            <b>功法阁</b>
            <p>筑基正式开启 · 现可预览所藏</p>
          </div>
        </button>
      </div>

      <h2 className="section-head" style={{ marginTop: 4 }}>
        <span style={{ fontFamily: 'var(--font-display)', fontSize: 15, fontWeight: 700 }}>长养之所</span>
        <small style={{ fontSize: 10.5, color: 'var(--ink-600)' }}>并行运转，不占行动</small>
      </h2>
      <div className="building-grid">
        <button className="bld-card" onClick={() => shell.openPage('farm')}>
          <div className="bld-top">
            <span className="bld-icon"><Sprout size={17} /></span>
            <span className="bld-status">{matured > 0 ? `${matured} 块待结算` : `${growing}/4 生长中`}</span>
          </div>
          <b className="bld-name">灵田药圃</b>
          <span className="bld-desc">{farmDesc(farmPlots.length, growing, matured)}</span>
        </button>
        <button className="reveal-card" style={{ textAlign: 'left' }} onClick={() => shell.openPage('treasure_pavilion')}>
          <span className="glyph">宝</span>
          <div>
            <b>法宝阁</b>
            <p>金丹正式开启 · 现可预览所藏</p>
          </div>
        </button>
      </div>

      {upgradeSheet && (
        <ConfirmSheet title="洞天升级" onClose={() => setUpgradeSheet(false)}>
          <div className="card card-padded">
            <b style={{ fontSize: 14 }}>洞天 {CAVE_LEVEL_PLACEHOLDER} 级 → 2 级</b>
            <p style={{ fontSize: 11.5, color: 'var(--ink-600)', marginTop: 6, lineHeight: 1.7 }}>
              升级条件与下一级加成数值需由服务端契约下发（洞天等级当前未实装，见运行时口径）。
            </p>
          </div>
          <div className="gate-banner gate-blocked">
            洞天升级通道尚未开启。已开放的建筑升级（灵田、练功房等）将随洞天等级一并接入。
          </div>
          <button className="btn-primary" disabled>暂不可升级</button>
        </ConfirmSheet>
      )}
    </div>
  );
}

function actionSummary(action: ReturnType<typeof deriveActionView>, home: string): string {
  if (!action) return '神识空闲，静候指派';
  return action.home === home ? `${action.verb} · ${action.targetName}` : '空闲';
}

function farmDesc(total: number, growing: number, matured: number): string {
  if (total === 0) return '四块灵圃虚位以待';
  if (matured > 0) return `已成熟 ${matured} 块，随下次结算入库`;
  return `${growing} 块灵物润育中`;
}
