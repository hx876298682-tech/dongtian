/** 行囊：资源 / 装备 分段 + 装备详情操作（equip/unequip/reinforce/lock/salvage，写 API 全走服务端校验）。 */
import { useState } from 'react';
import { Pin, Trash2 } from 'lucide-react';
import { useGame } from '../../store/GameStore';
import { useShell } from '../../app/shell';
import { useActionFlow } from '../../flows/useActionFlow';
import { ConfirmSheet } from '../../components/sheets';
import { EmptyHint, QualityChip } from '../../components/primitives';
import { ItemGlyph } from '../../components/ItemGlyph';
import { ElementTag } from '../../components/ElementTag';
import { RESOURCE_META, RESOURCE_ORDER, qualityMeta, slotLabel } from '../../content/meta';
import { EQUIPMENT_DISPLAY, EQUIPMENT_GROWTH_LIMITS, parseAffixSlots, SPECIAL_AFFIX_NAMES, SPECIAL_AFFIX_HINTS, RESOURCE_USAGE, reinforcePreview, promotePreview, awakenPreview } from '../../content/growth';
import type { CostLine } from '../../content/growth';
import { fmtNum } from '../../api/format';

export function BagPage() {
  const { player, catalog } = useGame();
  const shell = useShell();
  const [filter, setFilter] = useState<'all' | 'equip' | 'resource'>('all');

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

      <div className="filter-chips">
        {[['all','全部'],['equip','装备'],['resource','资源']].map(([key,label]) => (
          <button key={key} className={`f-chip${filter === key ? ' active' : ''}`} onClick={() => setFilter(key as typeof filter)}>{label}</button>
        ))}
      </div>

      {(filter === 'all' || filter === 'resource') && (
        <div className="inv-cells">
          {RESOURCE_ORDER.map((id) => {
            const entry = player.resources[id];
            const meta = RESOURCE_META[id];
            const usage = RESOURCE_USAGE[id];
            return (
              <button
                key={id}
                className="inv-cell"
                title={meta.name}
                onClick={() => shell.openSheet(
                  <ConfirmSheet title={meta.name} onClose={() => shell.closeSheet()}>
                    <div className="card card-padded" style={{ textAlign: 'center', paddingBlock: 14 }}>
                      <b style={{ fontFamily: 'var(--font-display)', fontSize: 16 }}>{meta.name}</b>
                      <p className="num" style={{ marginTop: 6, color: 'var(--ink-600)', fontSize: 12 }}>
                        现有 {fmtNum(entry?.amount)} / 上限 {fmtNum(entry?.capacity)}
                      </p>
                    </div>
                    <div className="journal-panel">
                      <InfoLine label="用途" value={usage?.use ?? '待内容侧补充'} />
                      <InfoLine label="来源" value={usage?.source ?? '待内容侧补充'} />
                    </div>
                  </ConfirmSheet>,
                )}
              >
                <b className="num" style={{ fontSize: 12.5 }}>{fmtNum(entry?.amount)}</b>
                <span className="cell-name">{meta.name}</span>
                {entry && entry.capacity > 0 && entry.amount >= entry.capacity * 0.9 && (
                  <span className="cell-count" style={{ color: 'var(--cinnabar)' }}>近满</span>
                )}
              </button>
            );
          })}
        </div>
      )}

      {(filter === 'all' || filter === 'equip') && (
        instances.length === 0 && filter === 'equip' ? (
          <EmptyHint text="行囊清空。妖魔身上自有补足之道——去历练走一遭。" />
        ) : (
          <div className="inv-cells">
            {[...instances]
              .sort((a, b) => Number(b.isEquipped) - Number(a.isEquipped))
              .map((inst) => {
                const template = catalog?.equipmentTemplates.find((t) => t.id === inst.templateId);
                const meta = qualityMeta(inst.quality);
                return (
                  <button
                    key={inst.instanceId}
                    className={`inv-cell ${meta.cls}`}
                    style={{ color: 'var(--ink-900)' }}
                    title={`${template?.displayName ?? inst.templateId} · ${slotLabel(inst.slot)}`}
                    onClick={() => shell.openSheet(
                      <EquipmentDetailSheet instanceId={inst.instanceId} onClose={() => shell.closeSheet()} />,
                    )}
                  >
                    <ItemGlyph slot={inst.slot} size={24} />
                    {inst.isEquipped && <span className="cell-count" style={{ color: 'var(--jade)' }}>已穿</span>}
                  </button>
                );
              })}
          </div>
        )
      )}
    </div>
  );
}

type ConfirmOp = { op: 'salvage'; note: string } | null;

function InfoLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="option-row" style={{ borderRadius: 0, boxShadow: 'none', borderBottom: '1px dashed var(--line)', cursor: 'default' }}>
      <span className="option-main"><span className="option-sub">{label}</span></span>
      <b style={{ fontSize: 12, maxWidth: '70%', textAlign: 'right' }}>{value}</b>
    </div>
  );
}

/** 从实例 affixes 读取三维属性；旧格式（空对象）返回 null 触发容错文案。 */
function readStats(affixes: Record<string, unknown> | undefined): { attack: number; defence: number; health: number } | null {
  if (!affixes || typeof affixes.attack !== 'number') return null;
  return { attack: affixes.attack, defence: Number(affixes.defence ?? 0), health: Number(affixes.health ?? 0) };
}

function sourceName(mapId: string): string {
  return ({ bai_cao_valley: '百草谷', black_wind_valley: '黑风谷', red_flame_cave: '赤炎洞' } as Record<string, string>)[mapId] ?? mapId;
}

function StatCell({ label, value }: { label: string; value: number }) {
  return (
    <div className="stat-block">
      <span>{label}</span>
      <b>{fmtNum(value)}</b>
    </div>
  );
}

function EquipmentDetailSheet({ instanceId, onClose }: { instanceId: string; onClose(): void }) {
  const { player, catalog, client } = useGame();
  const shell = useShell();
  const flow = useActionFlow(shell.showToast);
  const [confirmOp, setConfirmOp] = useState<ConfirmOp>(null);
  const [growthOp, setGrowthOp] = useState<{ op: 'reinforce' | 'promote' | 'awaken'; title: string; costs: CostLine[] } | null>(null);
  const [rerollMode, setRerollMode] = useState<{ lockedSlots: number[]; targetAffix?: 'speed' | 'element' | 'special' } | null>(null);

  const instance = player?.equipmentInstances[instanceId] ?? null;
  if (!instance || !player) return null;
  const template = catalog?.equipmentTemplates.find((t) => t.id === instance.templateId);
  const meta = qualityMeta(instance.quality);
  const stats = readStats(instance.affixes);
  const hasStats = stats !== null;
  const affixSlots = parseAffixSlots(instance.affixes);
  const activeSlotCount = Math.max(0, Math.min(3, Math.floor(EQUIPMENT_GROWTH_LIMITS.utilitySlots[instance.quality] ?? 0)));
  const isLegendaryPlus = instance.quality === 'legendary' || instance.quality === 'immortal';
  const rerollBaseCost = 300;
  const rerollPillCost = 1;
  const pending = flow.busy;
  const revisionNow = player.stateRevision;

  async function run(op: 'equip' | 'unequip' | 'reinforce' | 'lock'): Promise<void> {
    const result = await flow.runMutation(() => client.equipmentAction(instanceId, op, revisionNow), OP_OK[op]);
    if (result !== null) onClose();
  }

  const lockedSlotsNow = instance.lockedSlots ?? [];

  async function toggleSlotLock(index: number): Promise<void> {
    const locked = lockedSlotsNow.includes(index) ? [index] : [];
    const result = await flow.runMutation(() => client.equipmentAction(instanceId, 'lock', revisionNow, { lockSlots: locked }), locked.length ? '已锁定该词条' : '已解锁该词条');
    if (result !== null) onClose();
  }

  async function runGrowth(op: 'reinforce' | 'promote' | 'awaken'): Promise<void> {
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
            </small>
          </div>
        </div>

        {hasStats ? (
          <>
            <div className="stat-grid" style={{ marginBlock: 6 }}>
              <StatCell label="攻击" value={stats.attack} />
              <StatCell label="防御" value={stats.defence} />
              <StatCell label="生命" value={stats.health} />
            </div>
            <small style={{ fontSize: 10.5, color: 'var(--ink-600)' }}>
              强化 {instance.reinforcementLevel}/{EQUIPMENT_DISPLAY.reinforcementMaxLevel} 级 · 每级属性 +{Math.round(EQUIPMENT_DISPLAY.reinforcementPerLevel * 100)}%（最终值由服务端结算）
            </small>
          </>
        ) : (
          <small style={{ fontSize: 11, color: 'var(--ink-600)' }}>初始器物，无属性记录；属性在首次淬炼后生成。</small>
        )}

        <div className="affix-list" style={{ marginTop: 8 }}>
          {affixSlots.map((slot, index) => {
            const locked = lockedSlotsNow.includes(index);
            const canLock = activeSlotCount > 0 && slot.kind !== 'empty';
            return (
              <button
                key={index}
                style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, width: '100%', textAlign: 'left', padding: '3px 4px', borderRadius: 4, background: locked ? 'var(--gold-bg)' : undefined }}
                disabled={!canLock || pending}
                title={canLock ? '点击切换词条锁定（洗练时保留）' : '空槽不可锁定'}
                onClick={() => toggleSlotLock(index)}
              >
                {slot.kind === 'empty' ? (
                  <><i style={{ fontStyle: 'normal', color: 'var(--ink-300)' }}>◇</i><span style={{ color: 'var(--ink-300)' }}>未激活词条</span></>
                ) : (
                  <>
                    <i style={{ fontStyle: 'normal', color: locked ? 'var(--gold)' : 'var(--jade)' }}>{locked ? '🔒' : '◆'}</i>
                    {slot.kind === 'speed' && <span className="num">身法 +{fmtNum(slot.value)}</span>}
                    {slot.kind === 'element' && <ElementTag elementKey={slot.value} />}
                    {slot.kind === 'special' && (
                      <span className="num">
                        {SPECIAL_AFFIX_NAMES[slot.value] ?? slot.value}
                        {slot.grade ? ` · ${slot.grade} 品` : ''}
                        <small style={{ color: 'var(--ink-600)', marginLeft: 4 }}>{SPECIAL_AFFIX_HINTS[slot.value] ?? ''}</small>
                      </span>
                    )}
                    {locked && <small style={{ color: 'var(--gold)', marginLeft: 'auto' }}>洗练保留</small>}
                  </>
                )}
              </button>
            );
          })}
        </div>

        <small style={{ fontSize: 10.5, color: 'var(--ink-300)', display: 'block', marginTop: 6 }}>
          来源：{(template?.sourceMapIds ?? []).map((id) => sourceName(id)).join('、') || '初始器物'}
        </small>
      </div>

      {confirmOp ? (
        <>
          <div className="gate-banner gate-blocked">{confirmOp.note}</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            <button className="btn-danger-ghost" onClick={() => setConfirmOp(null)}>再想想</button>
            <button className="btn-primary" disabled={pending} onClick={() => void runSalvage()}>确认分解</button>
          </div>
        </>
      ) : growthOp ? (
        <>
          <div className="card card-padded">
            <b style={{ fontSize: 13.5 }}>{GROWTH_LABEL[growthOp.op]} · {growthOp.title}</b>
            <div className="journal-panel" style={{ marginTop: 8 }}>
              {growthOp.costs.map((line) => {
                const have = line.resourceId ? (player.resources[line.resourceId as keyof typeof player.resources]?.amount ?? 0) : null;
                const enough = have === null || have >= line.amount;
                return (
                  <div key={line.label} className="journal-row">
                    <span className="journal-text">{line.label}</span>
                    <span className={`journal-gain num${enough ? ' loss' : ''}`} style={!enough ? { color: 'var(--cinnabar)' } : undefined}>
                      -{fmtNum(line.amount)}{have !== null ? `（有 ${fmtNum(have)}）` : ''}
                    </span>
                  </div>
                );
              })}
            </div>
            <small style={{ fontSize: 10.5, color: 'var(--ink-600)', display: 'block', marginTop: 6 }}>
              预览取自公开冻结参数公式；提交后以服务端结算为准，材料不足时不扣分毫。
            </small>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            <button className="btn-danger-ghost" onClick={() => setGrowthOp(null)}>再想想</button>
            <button
              className="btn-primary"
              disabled={pending}
              onClick={() => {
                const op = growthOp.op;
                setGrowthOp(null);
                void runGrowth(op);
              }}
            >
              确认{GROWTH_LABEL[growthOp.op]}
            </button>
          </div>
        </>
      ) : rerollMode ? (
        <>
          <div className="card card-padded">
            <b style={{ fontSize: 13.5 }}>洗练 · 重掷未锁定词条</b>
            <p style={{ fontSize: 11, color: 'var(--ink-600)', marginTop: 4, lineHeight: 1.6 }}>
              每次消耗 灵石 ×{fmtNum(rerollBaseCost)} 与 丹药 ×{fmtNum(rerollPillCost)}；已锁定词条保留。
              {isLegendaryPlus ? ' 传说/仙器可指定目标词条类别（多轮尝试直至命中，消耗递增）。' : ''}
            </p>
            {isLegendaryPlus && (
              <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
                {([['', '不限'], ['speed', '身法'], ['element', '五行'], ['special', '特殊']] as const).map(([key, label]) => (
                  <button key={label} className={`f-chip${(rerollMode.targetAffix ?? '') === key ? ' active' : ''}`} onClick={() => setRerollMode({ ...rerollMode, targetAffix: key || undefined })}>
                    {label}
                  </button>
                ))}
              </div>
            )}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            <button className="btn-danger-ghost" onClick={() => setRerollMode(null)}>再想想</button>
            <button className="btn-primary" disabled={pending} onClick={() => {
              const opts = { lockSlots: rerollMode.lockedSlots, target: rerollMode.targetAffix ? true : undefined, targetAffix: rerollMode.targetAffix };
              setRerollMode(null);
              void (async () => {
                const result = await flow.runMutation(() => client.equipmentAction(instanceId, 'reroll', revisionNow, opts), '洗练完成');
                if (result?.data?.targetMatched) shell.showToast('目标词条已命中', 'ok');
              })();
            }}>
              确认洗练
            </button>
          </div>
        </>
      ) : (
        <>
          <div className="op-grid" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
            <button className="op-btn" disabled={pending} onClick={() => void run(instance.isEquipped ? 'unequip' : 'equip')}>
              {instance.isEquipped ? '卸下' : '装备'}
            </button>
            <button className="op-btn" disabled={pending} onClick={() => setGrowthOp({ op: 'reinforce', title: `强化 +${instance.reinforcementLevel + 1}`, costs: reinforcePreview(instance.reinforcementLevel) })}>
              强化
            </button>
            <button className="op-btn" disabled={pending} onClick={() => {
              const next = promotePreview(instance.quality);
              if (!next) return;
              setGrowthOp({ op: 'promote', title: `升品 · ${instance.quality} → 下一阶`, costs: next });
            }}>
              升品
            </button>
            <button className="op-btn" disabled={pending} onClick={() => setGrowthOp({ op: 'awaken', title: `觉醒 ${instance.awakeningLevel ?? 0} → ${(instance.awakeningLevel ?? 0) + 1}`, costs: awakenPreview(instance.awakeningLevel ?? 0) })}>
              觉醒
            </button>
            <button className="op-btn" disabled={pending || activeSlotCount === 0} title={activeSlotCount === 0 ? '该品质无可洗练词条' : undefined}
              onClick={() => { setConfirmOp(null); setRerollMode({ lockedSlots: [] }); }}>
              洗练
            </button>
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
          <small style={{ fontSize: 10.5, color: 'var(--ink-600)', lineHeight: 1.7 }}>
            洗练受词条门禁约束（需稀有以上并锁定词条），正式开放后此处点亮。强化上限 {EQUIPMENT_GROWTH_LIMITS.reinforcementMaxLevel} 级 · 觉醒上限 {EQUIPMENT_GROWTH_LIMITS.awakeningMaxLevel} 级。
          </small>
        </>
      )}
    </ConfirmSheet>
  );
}

const OP_OK: Record<string, string> = {
  equip: '已佩戴',
  unequip: '已卸下入囊',
  reinforce: '淬炼成功',
  promote: '升品成功',
  awaken: '觉醒成功',
  lock: '已标记锁定',
};

const GROWTH_LABEL: Record<string, string> = { reinforce: '强化', promote: '升品', awaken: '觉醒' };
