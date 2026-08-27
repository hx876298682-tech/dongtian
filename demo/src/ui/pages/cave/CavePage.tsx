/** 洞府首页：修为摘要 · 主动之所 · 长养之所 · 最近入库 */
import { Beaker, BookOpen, Hammer, Sparkles, Sprout } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useGame } from '../../store/GameStore';
import { deriveActionView } from '../../store/actionView';
import { useShell, type PageId } from '../../app/shell';
import { SectionHead, RevealCard } from '../../components/primitives';
import { JournalList } from '../../components/JournalList';
import { realmLabel } from '../../content/meta';
import { fmtNum } from '../../api/format';
import { REALMS } from '../../../game/config';

type BuildingKey = 'training' | 'alchemy' | 'forge';

export function CavePage() {
  const { player, catalog, events, now } = useGame();
  const shell = useShell();
  const action = deriveActionView(player, catalog);
  const nowMs = now();

  if (!player || !catalog) return null;

  const realmMax = (REALMS as Record<string, { cultivationMax: number }>)[player.realmId]?.cultivationMax ?? null;
  const farmPlots = Object.values(player.buildings?.spirit_farm?.spiritFarmPlots ?? {});
  const growing = farmPlots.filter((p) => Date.parse(p.matureAt) > nowMs).length;
  const matured = farmPlots.length - growing;

  const primaryBuildings: Array<{ key: PageId; bldKey?: BuildingKey; name: string; desc: string; Icon: LucideIcon; lockedRealm?: string }> = [
    { key: 'training', bldKey: 'training', name: '练功房', desc: actionSummary(action, 'training'), Icon: BookOpen },
    { key: 'alchemy', bldKey: 'alchemy', name: '炼丹房', desc: actionSummary(action, 'alchemy'), Icon: Beaker },
    { key: 'forge', bldKey: 'forge', name: '炼器室', desc: actionSummary(action, 'forge'), Icon: Hammer },
  ];

  return (
    <div className="pad">
      {/* 洞府横幅：唯一的环境插画区 */}
      <div className="map-scene scene-dongtian" style={{ borderRadius: 6, height: 108 }}>
        <span className="glyph-seal">洞</span>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
          <h3>云岫洞天</h3>
          <small style={{ color: 'rgba(247,245,236,.82)', fontSize: 11 }}>
            {realmLabel(player.realmId)} · 战力由界域底蕴与装备淬炼而来
          </small>
        </div>
      </div>

      <div className="card card-padded" style={{ marginTop: -26, marginInline: 10, position: 'relative', zIndex: 1, display: 'flex', alignItems: 'center', gap: 12 }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 11, color: 'var(--ink-600)', marginBottom: 4 }}>当前修为</div>
          <b className="num" style={{ fontSize: 20 }}>
            {fmtNum(player.cultivationXp)}
            {realmMax ? <span style={{ fontSize: 12, color: 'var(--ink-600)' }}> / {fmtNum(realmMax)}</span> : null}
          </b>
        </div>
        <button className="btn-primary" style={{ height: 36, width: 96, fontSize: 13 }} onClick={() => shell.openPage('breakthrough')}>
          <Sparkles size={13} style={{ verticalAlign: -2, marginRight: 4 }} />突破
        </button>
      </div>

      <SectionHead title="主动之所" sub="共用一个当前行动" />
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
        <RevealCard glyph="阁" title="功法阁" desc={`筑基开启 · 功法收藏与研习`} />
      </div>

      <SectionHead title="长养之所" sub="并行运转，不占行动" />
      <div className="building-grid">
        <button className="bld-card" onClick={() => shell.openPage('farm')}>
          <div className="bld-top">
            <span className="bld-icon"><Sprout size={17} /></span>
            <span className="bld-status">{matured > 0 ? `${matured} 块待结算` : `${growing}/4 生长中`}</span>
          </div>
          <b className="bld-name">灵田药圃</b>
          <span className="bld-desc">{farmDesc(farmPlots.length, growing, matured)}</span>
        </button>
        <RevealCard glyph="宝" title="法宝阁" desc="金丹开启 · 收藏法宝与永久传承" />
      </div>

      <SectionHead
        title="最近入库"
        sub="挂机产出实时记录"
        tail={<button className="btn-mini" onClick={() => shell.openPage('journal')}>全部 ›</button>}
      />
      <JournalList events={events.slice(0, 5)} emptyText="尚无入库记录。指派一处行动后，产出会自动记入账册。" />
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
