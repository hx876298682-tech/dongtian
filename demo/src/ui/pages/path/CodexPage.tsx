/** 词条图鉴：装备词条体系总览（冻结规则的可读版）。
    品阶激活槽位、特殊词条四类效果与目标部位、身法/五行说明。 */
import { useGame } from '../../store/GameStore';
import { useShell } from '../../app/shell';
import { PageHeaderBack, SectionHead } from '../../components/primitives';
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

export function CodexPage() {
  const shell = useShell();
  const { player } = useGame();

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

      <p style={{ fontSize: 10.5, color: 'var(--ink-600)', lineHeight: 1.7 }}>
        词条在掉落时按品质随机激活；洗练可重掷未锁定词条，锁定槽在洗练时保留（最多锁 2 槽）。最终效果以服务端战斗结算为准。
      </p>
    </div>
  );
}
