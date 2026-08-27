/** 行囊：资源 / 装备 分段 + 装备详情操作（equip/unequip/reinforce/lock/salvage，写 API 全走服务端校验）。 */
import { useState } from 'react';
import { Pin, Trash2 } from 'lucide-react';
import { useGame } from '../../store/GameStore';
import { useShell } from '../../app/shell';
import { useActionFlow } from '../../flows/useActionFlow';
import { ConfirmSheet } from '../../components/sheets';
import { EmptyHint, QualityChip } from '../../components/primitives';
import { ItemGlyph } from '../../components/ItemGlyph';
import { RESOURCE_META, RESOURCE_ORDER, qualityMeta, slotLabel } from '../../content/meta';
import { fmtNum } from '../../api/format';

export function BagPage() {
  const { player, catalog } = useGame();
  const shell = useShell();
  const [segment, setSegment] = useState<'equip' | 'resource'>('equip');

  if (!player) return null;
  const instances = Object.values(player.equipmentInstances);

  return (
    <div className="pad">
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginTop: 2 }}>
        <b style={{ fontFamily: 'var(--font-display)', fontSize: 17, letterSpacing: '.05em' }}>行囊</b>
        <small style={{ fontSize: 10.5, color: 'var(--ink-600)' }}>
          装备 {player.equipmentCount} 件 · 出口策略：普通精良自动分解，稀有以上保留
        </small>
      </div>

      <div className="segmented">
        <button className={`seg-btn${segment === 'equip' ? ' active' : ''}`} onClick={() => setSegment('equip')}>法宝兵刃</button>
        <button className={`seg-btn${segment === 'resource' ? ' active' : ''}`} onClick={() => setSegment('resource')}>天然资源</button>
      </div>

      {segment === 'equip' && (
        instances.length === 0 ? (
          <EmptyHint text="行囊清空。妖魔身上自有补足之道——去历练走一遭。" />
        ) : (
          <div className="journal-panel">
            {[...instances]
              .sort((a, b) => Number(b.isEquipped) - Number(a.isEquipped))
              .map((inst) => {
                const template = catalog?.equipmentTemplates.find((t) => t.id === inst.templateId);
                const meta = qualityMeta(inst.quality);
                return (
                  <button
                    key={inst.instanceId}
                    className="option-row"
                    style={{ borderRadius: 0, boxShadow: 'none', borderBottom: '1px dashed var(--line)' }}
                    onClick={() => shell.openSheet(
                      <EquipmentDetailSheet instanceId={inst.instanceId} onClose={() => shell.closeSheet()} />,
                    )}
                  >
                    <span className={`equip-frame ${meta.cls}`} style={{ width: 42, height: 42 }}>
                      <ItemGlyph slot={inst.slot} size={22} />
                    </span>
                    <span className="option-main">
                      <b>{template?.displayName ?? inst.templateId}{inst.isEquipped ? ' · 已佩戴' : ''}</b>
                      <span className="option-sub">
                        {slotLabel(inst.slot)}
                        {inst.reinforcementLevel > 0 ? ` · 强化 +${inst.reinforcementLevel}` : ''}
                      </span>
                    </span>
                    <QualityChip quality={meta.label} />
                  </button>
                );
              })}
          </div>
        )
      )}

      {segment === 'resource' && (
        <div className="journal-panel">
          {RESOURCE_ORDER.map((id) => {
            const entry = player.resources[id];
            const meta = RESOURCE_META[id];
            const nearCap = entry ? entry.capacity > 0 && entry.amount >= entry.capacity * 0.9 : false;
            return (
              <div key={id} className="option-row" style={{ borderRadius: 0, boxShadow: 'none', borderBottom: '1px dashed var(--line)', cursor: 'default' }}>
                <span className="option-main">
                  <b>{meta.name}</b>
                  <span className="option-sub">上限 {fmtNum(entry?.capacity)}</span>
                </span>
                <b className="num" style={{ fontSize: 14.5, color: nearCap ? 'var(--cinnabar)' : undefined }}>
                  {fmtNum(entry?.amount)}
                </b>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

type ConfirmOp = { op: 'salvage'; note: string } | null;

function EquipmentDetailSheet({ instanceId, onClose }: { instanceId: string; onClose(): void }) {
  const { player, catalog, client } = useGame();
  const shell = useShell();
  const flow = useActionFlow(shell.showToast);
  const [confirmOp, setConfirmOp] = useState<ConfirmOp>(null);

  const instance = player?.equipmentInstances[instanceId] ?? null;
  if (!instance || !player) return null;
  const template = catalog?.equipmentTemplates.find((t) => t.id === instance.templateId);
  const meta = qualityMeta(instance.quality);
  const affixEntries = Object.entries(instance.affixes ?? {});
  const pending = flow.busy;
  const revisionNow = player.stateRevision;

  async function run(op: 'equip' | 'unequip' | 'reinforce' | 'lock'): Promise<void> {
    const result = await flow.runMutation(() => client.equipmentAction(instanceId, op, revisionNow), OP_OK[op]);
    if (result !== null) onClose();
  }

  async function runSalvage(): Promise<void> {
    setConfirmOp(null);
    const result = await flow.runMutation(() => client.equipmentAction(instanceId, 'salvage', revisionNow), '器物已分解入炉');
    if (result !== null) onClose();
  }

  return (
    <ConfirmSheet title="器物鉴赏" onClose={onClose}>
      <div className="card double card-padded">
        <div className="equip-hero" style={{ paddingInline: 2 }}>
          <span className={`equip-frame ${meta.cls}`} style={{ color: 'var(--ink-900)' }}>
            <ItemGlyph slot={instance.slot} size={46} />
          </span>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
            <b style={{ fontSize: 16 }}>{template?.displayName ?? instance.templateId}</b>
            <QualityChip quality={meta.label} />
            <small style={{ color: 'var(--ink-600)' }}>
              {slotLabel(instance.slot)}
              {instance.isEquipped ? ' · 已佩戴' : ' · 库中'}
              {instance.reinforcementLevel > 0 ? ` · 强化 +${instance.reinforcementLevel}` : ''}
            </small>
          </div>
        </div>

        <div className="affix-list" style={{ marginTop: 4 }}>
          {affixEntries.length === 0 ? (
            <span style={{ color: 'var(--ink-600)', fontSize: 11 }}>未开词条</span>
          ) : (
            affixEntries.map(([key, value]) => (
              <span key={key} style={{ display: 'flex', gap: 6 }}>
                <i style={{ fontStyle: 'normal' }}>◆</i>
                <span className="num">{key}: {String(value)}</span>
              </span>
            ))
          )}
        </div>
        <small style={{ fontSize: 10.5, color: 'var(--ink-600)' }}>实际属性与词条效果由服务端战斗结算实时取用。</small>
      </div>

      {confirmOp ? (
        <>
          <div className="gate-banner gate-blocked">{confirmOp.note}</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            <button className="btn-danger-ghost" onClick={() => setConfirmOp(null)}>再想想</button>
            <button className="btn-primary" disabled={pending} onClick={() => void runSalvage()}>确认分解</button>
          </div>
        </>
      ) : (
        <div className="op-grid">
          <button className="op-btn" disabled={pending} onClick={() => void run(instance.isEquipped ? 'unequip' : 'equip')}>
            {instance.isEquipped ? '卸下' : '装备'}
          </button>
          <button className="op-btn" disabled={pending} onClick={() => void run('reinforce')}>强化</button>
          <button className="op-btn" disabled={pending} onClick={() => void run('lock')}>
            <Pin size={12} style={{ verticalAlign: -2 }} /> 锁定
          </button>
          <button
            className="op-btn"
            disabled={pending || instance.isEquipped}
            title={instance.isEquipped ? '先卸下再分解' : undefined}
            onClick={() => setConfirmOp({ op: 'salvage', note: '分解后器物化入炉中，返还材料由天道核算（服务端结算）。' })}
          >
            <Trash2 size={12} style={{ verticalAlign: -2 }} /> 分解
          </button>
        </div>
      )}

      <p style={{ fontSize: 10.5, color: 'var(--ink-600)', lineHeight: 1.7 }}>
        升品、洗练、觉醒诸道受产品门禁约束，正式开放后此处点亮。
      </p>
    </ConfirmSheet>
  );
}

const OP_OK: Record<string, string> = {
  equip: '已佩戴',
  unequip: '已卸下入囊',
  reinforce: '淬炼成功',
  lock: '已标记锁定',
};
