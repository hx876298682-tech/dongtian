/** 道途：六槽装备 · 技艺等级 · 境界路线 · 突破入口 */
import { useEffect, useState } from 'react';
import { Sparkles } from 'lucide-react';
import { useGame } from '../../store/GameStore';
import { useShell } from '../../app/shell';
import { QualityChip, SectionHead } from '../../components/primitives';
import { ItemGlyph } from '../../components/ItemGlyph';
import { SLOT_LABELS, realmLabel, qualityMeta, slotLabel } from '../../content/meta';
import { fmtNum } from '../../api/format';
import { REALMS } from '../../../game/config';
import type { CombatPreviewData, EquipmentInstance } from '../../api/client';

export function PathPage() {
  const { player, catalog, client, revision, now } = useGame();
  const shell = useShell();
  const [preview, setPreview] = useState<CombatPreviewData | null>(null);

  const firstMap = catalog?.maps.find((m) => m.unlocked && m.status === 'released');

  // 道途页展示真实战斗属性：来自只读 combat/preview（首个已解锁地图）
  useEffect(() => {
    if (!firstMap || !player) return;
    let alive = true;
    client.combatPreview(firstMap.actionId, revision())
      .then((envelope) => { if (alive) setPreview(envelope.data); })
      .catch(() => { if (alive) setPreview(null); });
    return () => { alive = false; };
  }, [firstMap?.actionId]);  // eslint-disable-line react-hooks/exhaustive-deps

  if (!player || !catalog) return null;

  const equipped = Object.values(player.equipmentInstances).filter((e) => e.isEquipped);
  const bySlot = (slot: string): EquipmentInstance | undefined =>
    equipped.find((e) => e.slot === slot);
  const realmMax = (REALMS as Record<string, { cultivationMax: number }>)[player.realmId]?.cultivationMax ?? null;

  return (
    <div className="pad">
      {/* 身份卡 */}
      <div className="card card-padded" style={{ display: 'flex', gap: 14, alignItems: 'center' }}>
        <span className="seal-avatar" style={{ width: 52, height: 52, fontSize: 26, borderRadius: 10 }}>云</span>
        <div style={{ flex: 1 }}>
          <b style={{ fontFamily: 'var(--font-display)', fontSize: 17, letterSpacing: '.06em' }}>云岫</b>
          <p style={{ fontSize: 11, color: 'var(--ink-600)', marginTop: 3 }}>逍遥散修 · 无门无派</p>
          <span className="realm-badge" style={{ display: 'inline-block', marginTop: 6 }}>
            {realmLabel(player.realmId)}{realmMax ? ` · ${fmtNum(player.cultivationXp)}/${fmtNum(realmMax)}` : ` · 修为 ${fmtNum(player.cultivationXp)}`}
          </span>
        </div>
        {preview && (
          <div style={{ textAlign: 'right' }}>
            <small style={{ fontSize: 10, color: 'var(--ink-600)' }}>战力（展示值）</small>
            <b className="num" style={{ display: 'block', fontSize: 19 }}>{fmtNum(preview.stats.battlePower)}</b>
          </div>
        )}
      </div>

      {/* 六槽 */}
      <SectionHead title="随身法器" sub="六处灵窍" />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
        {SLOT_LABELS.map(({ slot, label }) => {
          const inst = bySlot(slot);
          if (!inst) {
            return (
              <div key={slot} className="slot-cell">
                <ItemGlyph slot={slot} size={22} />
                <span>{label}</span>
              </div>
            );
          }
          const meta = qualityMeta(inst.quality);
          const template = catalog.equipmentTemplates.find((t) => t.id === inst.templateId);
          return (
            <button
              key={slot}
              className="slot-cell filled"
              onClick={() => shell.showToast(`《${template?.displayName ?? inst.templateId}》详情请至行囊查看`)}
              title={`${label} · ${template?.displayName ?? ''}`}
            >
              <span className={`equip-frame ${meta.cls}`} style={{ width: 40, height: 40 }}>
                <ItemGlyph slot={slot} size={20} />
              </span>
              <QualityChip quality={meta.label} />
              <span>{slotLabel(slot)}</span>
            </button>
          );
        })}
      </div>

      {/* 真实属性（服务端 preview）+ 技艺等级 */}
      {preview && (
        <>
          <SectionHead
        title="属性"
        tail={<button className="btn-mini" onClick={() => shell.openPage('codex')}>词条图鉴 ›</button>}
        sub={`${firstMap ? `以${firstMap.displayName}为准的实战口径` : '服务端口径'} · 战力只是展示值`} />
          <div className="stat-grid">
            <AttrBlock label="生命" value={preview.stats.health} />
            <AttrBlock label="攻击" value={preview.stats.attack} />
            <AttrBlock label="防御" value={preview.stats.defence} />
            <AttrBlock label="速度" value={preview.stats.speed} showDecimal />
            <AttrBlock label="命中" value={preview.stats.accuracy} showDecimal />
            <AttrBlock label="闪避" value={preview.stats.evasion} showDecimal />
          </div>
        </>
      )}

      {(player.skillLevels || player.skillProgress) && (
        <>
          <SectionHead title="技艺修行" sub="采集与丹器之道" />
          <div className="stat-grid">
            <AttrBlock label="采药" value={player.skillLevels?.herbalism ?? levelFromXp(player.skillProgress?.herbalismXp)} />
            <AttrBlock label="挖矿" value={player.skillLevels?.mining ?? levelFromXp(player.skillProgress?.miningXp)} />
            <AttrBlock label="丹道" value={player.skillLevels?.alchemy ?? levelFromXp(player.skillProgress?.alchemyXp)} />
            <AttrBlock label="炼器" value={player.skillLevels?.forge ?? levelFromXp(player.skillProgress?.forgeXp)} />
          </div>
        </>
      )}

      {/* 突破入口 */}
      <button className="btn-ceremony" onClick={() => shell.openPage('breakthrough')}>
        <Sparkles size={14} style={{ verticalAlign: -2, marginRight: 6 }} />叩问玄关 · 境界突破
      </button>

      <small style={{ fontSize: 10.5, color: 'var(--ink-600)', textAlign: 'center' }}>
        {now() > 0 ? '洞天状态与天地同步中' : ''}
      </small>
    </div>
  );
}

function AttrBlock({ label, value, showDecimal }: { label: string; value?: number; showDecimal?: boolean }) {
  return (
    <div className="stat-block">
      <span>{label}</span>
      <b>{value === undefined ? '—' : showDecimal ? Number(value).toFixed(3) : fmtNum(value)}</b>
    </div>
  );
}

function levelFromXp(xp: number | undefined): number | undefined {
  // 服务端已提供 skillLevels 时优先；此回退仅显示原始 XP 数量级，不推算等级
  return xp === undefined ? undefined : Math.max(1, Math.floor(Math.log2(xp + 1)) + 1);
}
