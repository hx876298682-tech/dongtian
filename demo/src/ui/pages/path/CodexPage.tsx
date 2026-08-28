/** 词条图鉴：装备词条体系总览（冻结规则的可读版）。
    品阶激活槽位、特殊词条四类效果与目标部位、身法/五行说明。 */
import { useGame } from '../../store/GameStore';
import { useShell } from '../../app/shell';
import { useEffect, useState } from 'react';
import type { HighTierPreviewData } from '../../api/client';
import { PageHeaderBack, SectionHead } from '../../components/primitives';
import { fmtNum, fmtSpan } from '../../api/format';
import { ElementTag } from '../../components/ElementTag';
import { EQUIPMENT_GROWTH_LIMITS } from '../../content/growth';

const SPECIALS: Array<{ key: string; name: string; hint: string; targets: string }> = [
  { key: 'armor_break', name: '破甲', hint: '按品级提升造成的伤害（品级 1-4）', targets: '武器 · 饰品' },
  { key: 'body_protection', name: '护体', hint: '按品级降低受到的伤害（品级 1-4）', targets: '护甲' },
  { key: 'vitality', name: '生机', hint: '按品级提升生命上限（品级 1-4）', targets: '护甲 · 饰品' },
  { key: 'rejuvenation', name: '回春', hint: '按品级提升丹药治疗效果（品级 1-4）', targets: '饰品为主' },
];

const QUALITY_SLOTS: Array<{ quality: string; label: string; slots: number }> = [
  { quality: 'normal', label: '普通', slots: EQUIPMENT_GROWTH_LIMITS.utilitySlots.normal },
  { quality: 'fine', label: '精良', slots: EQUIPMENT_GROWTH_LIMITS.utilitySlots.fine },
  { quality: 'rare', label: '稀有', slots: EQUIPMENT_GROWTH_LIMITS.utilitySlots.rare },
  { quality: 'epic', label: '史诗', slots: EQUIPMENT_GROWTH_LIMITS.utilitySlots.epic },
  { quality: 'legendary', label: '传说', slots: EQUIPMENT_GROWTH_LIMITS.utilitySlots.legendary },
  { quality: 'immortal', label: '仙器', slots: EQUIPMENT_GROWTH_LIMITS.utilitySlots.immortal },
];

const HIGH_TIERS: Array<{ realm: string; name: string }> = [
  { realm: 'nascent_soul', name: '元婴' },
  { realm: 'divine_transformation', name: '化神' },
];

export function CodexPage() {
  const shell = useShell();
  const { player, client } = useGame();
  const [bossBook, setBossBook] = useState<Array<{ realm: string; name: string; data: HighTierPreviewData } | null> | null>(null);

  // BOSS 图鉴：拉三个远征境界的 preview（只读，含机制/门槛），失败静默降级
  useEffect(function () {
    let alive = true;
    void (async function () {
      const results = await Promise.all(HIGH_TIERS.map(function (ht) {
        return client.highTierPreview(ht.realm).then(function (env) {
          return { realm: ht.realm, name: ht.name, data: env.data };
        }).catch(function () { return null; });
      }));
      if (alive) setBossBook(results);
    })();
    return function () { alive = false; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  if (!player) return null;
  // 已收集到的特殊词条（从装备实例聚合，纯读取）
  const seen = new Set<string>();
  for (const inst of Object.values(player.equipmentInstances)) {
    const slots = (inst.affixes?.slots ?? []) as Array<{ kind?: string; value?: unknown }>;
    for (const slot of slots) {
      if (slot && slot.kind === 'special' && typeof slot.value === 'string') seen.add(slot.value);
    }
  }

  return (
    <div className="pad">
      <PageHeaderBack title="词条图鉴" sub="装备词条体系 · 冻结规则速查" onClose={() => shell.closePage()} />

      <SectionHead title="功能槽位" sub="按品质开放（0/0/1/1/2/3）" />
      <div className="stat-grid">
        {QUALITY_SLOTS.map((q) => (
          <div key={q.quality} className="stat-block">
            <span>{q.label}</span>
            <b>{q.slots} 槽</b>
          </div>
        ))}
      </div>

      <SectionHead title="特殊词条" sub={`已收集 ${seen.size}/${SPECIALS.length}`} />
      <div className="journal-panel">
        {SPECIALS.map((sp) => {
          const collected = seen.has(sp.key);
          return (
            <div key={sp.key} className="option-row" style={{ borderRadius: 0, boxShadow: 'none', borderBottom: '1px dashed var(--line)', cursor: 'default', opacity: collected ? 1 : .6 }}>
              <span className="option-main">
                <b>{sp.name}{collected ? ' · 已见过' : ''}</b>
                <span className="option-sub">{sp.hint}</span>
                <span className="option-sub" style={{ color: 'var(--gold)' }}>常见于：{sp.targets}</span>
              </span>
            </div>
          );
        })}
      </div>

      <SectionHead title="身法与五行" sub="速度与元素词条" />
      <div className="journal-panel">
        <div className="option-row" style={{ borderRadius: 0, boxShadow: 'none', borderBottom: '1px dashed var(--line)', cursor: 'default' }}>
          <span className="option-main">
            <b>身法</b>
            <span className="option-sub">提升速度、缩短攻击间隔（有下限）</span>
          </span>
        </div>
        <div className="option-row" style={{ borderRadius: 0, boxShadow: 'none', cursor: 'default' }}>
          <span className="option-main">
            <b>五行印记</b>
            <span className="option-sub">金/木/水/火/土——参与克制与 Boss 抗性判定</span>
          </span>
        </div>
      </div>

      <SectionHead title="高阶 BOSS 图鉴" sub="元婴起远征遭遇 · 机制速查" />
      {!bossBook && <div className="skeleton" style={{ height: 120 }} />}
      {bossBook && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {bossBook.map(function (entry: { realm: string; name: string; data: HighTierPreviewData } | null) {
            if (!entry) return null;
            const d = entry.data;
            const gate = d.gate;
            const unlocked = gate.status === 'open';
            return (
              <div key={entry.realm} className="card card-padded" style={{ opacity: unlocked ? 1 : .62 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <ElementTag elementKey={d.stats?.element ?? ''} />
                  <b style={{ fontFamily: 'var(--font-display)', fontSize: 14.5 }}>{entry.name}境 BOSS</b>
                  <span style={{ marginLeft: 'auto', fontSize: 10.5, color: unlocked ? 'var(--jade)' : 'var(--ink-300)' }}>
                    {unlocked ? '可挑战' : '门槛未达'}
                  </span>
                </div>
                <div className="stat-grid" style={{ marginTop: 8 }}>
                  <div className="stat-block"><span>生命</span><b>{fmtNum(d.bossHp)}</b></div>
                  <div className="stat-block"><span>护盾</span><b>{fmtNum(d.bossHp * (d.pillBudget ? 1 : 1))}</b></div>
                  <div className="stat-block"><span>攻击</span><b>{fmtNum(d.stats?.attack)}</b></div>
                </div>
                {d.skill && (
                  <small style={{ fontSize: 10.5, color: 'var(--ink-600)', display: 'block', marginTop: 6 }}>
                    专属技能：冷却 {fmtSpan(d.skill.cooldownSeconds)} · 持续 {fmtSpan(d.skill.durationSeconds)} · 攻击压制 {d.skill.attackSuppressionPercent}%
                  </small>
                )}
                {gate.required && (
                  <small style={{ fontSize: 10.5, color: 'var(--ink-600)', display: 'block', marginTop: 4 }}>
                    P10 构筑需求：攻 {fmtNum(gate.required.attack)} / 防 {fmtNum(gate.required.defence)} / 血 {fmtNum(gate.required.health)}
                  </small>
                )}
              </div>
            );
          })}
        </div>
      )}

      <p style={{ fontSize: 10.5, color: 'var(--ink-600)', lineHeight: 1.7 }}>
        词条在掉落时按品质随机激活；洗练可重掷未锁定词条，锁定槽在洗练时保留（最多锁 2 槽）。最终效果以服务端战斗结算为准。
      </p>
    </div>
  );
}
