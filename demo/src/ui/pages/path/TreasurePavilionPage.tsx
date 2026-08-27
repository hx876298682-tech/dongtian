/** 法宝阁：法宝收藏（treasureStars）、研修（treasure_research 主行动）与法宝升星（collection/actions treasure_upgrade）。 */
import { useState } from 'react';
import { useGame } from '../../store/GameStore';
import { useShell } from '../../app/shell';
import { useActionFlow } from '../../flows/useActionFlow';
import { ConfirmSheet, SwitchWarnBlock } from '../../components/sheets';
import { PageHeaderBack, EmptyHint, QualityChip } from '../../components/primitives';
import { fmtNum } from '../../api/format';

/** 首发法宝池（treasureId → 展示名/永久属性），与 service.ts 战斗加成的五件对齐。 */
const TREASURES: Array<{ id: string; name: string; bonus: string; unlockRealm: string }> = [
  { id: 'qing_lian_lamp', name: '青莲灯', bonus: '攻击提升（每星）', unlockRealm: '筑基' },
  { id: 'shan_he_seal', name: '山河印', bonus: '防御提升（每星）', unlockRealm: '筑基' },
  { id: 'zhu_que_feather', name: '朱雀羽', bonus: '攻击提升（每星）', unlockRealm: '金丹' },
  { id: 'xuan_gui_shell', name: '玄龟甲', bonus: '生命提升（每星）', unlockRealm: '金丹' },
  { id: 'tai_xu_mirror', name: '太虚镜', bonus: '速度提升（每星）', unlockRealm: '元婴' },
];

export function TreasurePavilionPage() {
  const { player, catalog, client, revision } = useGame();
  const shell = useShell();
  const flow = useActionFlow(shell.showToast);
  const [sheetTreasure, setSheetTreasure] = useState<string | null>(null);

  if (!player || !catalog) return null;

  const stars = player.collection?.treasureStars ?? {};
  const researchXp = player.collection?.techniqueResearchXp ?? 0;
  const marks = player.collection?.collectionMarks ?? 0;
  const researching = player.primaryAction.actionId === 'treasure_research';

  return (
    <div className="pad">
      <PageHeaderBack title="法宝阁" sub={`收藏研究 · 心得 ${fmtNum(researchXp)} · 集换印 ${fmtNum(marks)}`} onClose={() => shell.closePage()} />

      <div className="card card-padded" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <div style={{ flex: 1 }}>
          <b style={{ fontSize: 13.5 }}>法宝研修</b>
          <p style={{ fontSize: 11, color: 'var(--ink-600)', marginTop: 3, lineHeight: 1.6 }}>
            占用当前行动；每轮产出集换印记，用于兑换与升星（数量以服务端结算为准）。
          </p>
        </div>
        <button
          className={researching ? 'btn-mini' : 'btn-go'}
          style={researching ? { color: 'var(--jade)' } : undefined}
          disabled={researching || flow.busy}
          onClick={() => {
            void (async () => {
              await flow.startAction({ actionId: 'treasure_research' }, '法宝研修');
            })();
          }}
        >
          {researching ? '研修中' : '开始研修'}
        </button>
      </div>

      <h2 className="section-head" style={{ marginTop: 4 }}>
        <span style={{ fontFamily: 'var(--font-display)', fontSize: 15, fontWeight: 700 }}>所藏法宝</span>
        <small style={{ fontSize: 10.5, color: 'var(--ink-600)' }}>获得即永久生效 · 可用重复件升星</small>
      </h2>

      {TREASURES.length === 0 ? <EmptyHint text="暂无法宝。" /> : (
        <div className="card-grid">
          {TREASURES.map((t) => {
            const star = stars[t.id] ?? 0;
            const owned = star > 0;
            return (
              <button key={t.id} className="mini-card" style={owned ? undefined : { opacity: .72 }} onClick={() => setSheetTreasure(t.id)}>
                <span className="mc-lv" style={owned ? undefined : { color: 'var(--ink-600)', background: 'var(--bg-sunken)' }}>
                  {owned ? '★'.repeat(Math.min(star, 5)) : '未获得'}
                </span>
                <span className="mc-name">{t.name}</span>
                <span className="mc-sub">{t.bonus}</span>
                {!owned && <span className="mc-sub" style={{ color: 'var(--gold)' }}>{t.unlockRealm}起 · 秘境掉落</span>}
                <span><QualityChip quality={owned ? '稀有' : '普通'} /></span>
              </button>
            );
          })}
        </div>
      )}

      {sheetTreasure && (
        <TreasureSheet
          treasureId={sheetTreasure}
          star={stars[sheetTreasure] ?? 0}
          busy={flow.busy}
          onClose={() => setSheetTreasure(null)}
          onStartResearch={async () => {
            setSheetTreasure(null);
            await flow.startAction({ actionId: 'treasure_research' }, '法宝研修');
          }}
          onUpgrade={async () => {
            shell.closeSheet();
            await flow.runMutation(
              () => client.collectionAction('treasure_upgrade', { treasureId: sheetTreasure }, revision()),
              '升星成功',
            );
          }}
        />
      )}
    </div>
  );

}

function TreasureSheet({ treasureId, star, busy, onClose, onStartResearch, onUpgrade }: {
  treasureId: string; star: number; busy: boolean; onClose(): void; onStartResearch(): Promise<void>; onUpgrade(): Promise<void>;
}) {
  const t = TREASURES.find((x) => x.id === treasureId) ?? TREASURES[0];
  const owned = star > 0;
  return (
    <ConfirmSheet title={`${t.name} · ${owned ? `${'★'.repeat(Math.min(star, 5))}` : '未获得'}`} onClose={onClose}>
      <div className="card card-padded" style={{ textAlign: 'center', paddingBlock: 14 }}>
        <b style={{ fontFamily: 'var(--font-display)', fontSize: 17 }}>{t.name}</b>
        <p style={{ fontSize: 11.5, color: 'var(--ink-600)', marginTop: 6, lineHeight: 1.7 }}>
          {owned
            ? `永久生效：${t.bonus}。用重复件可升星（消耗集换印记与重复件，数量以服务端结算为准）。`
            : `获得后永久生效：${t.bonus}。通过法宝研修产出印记兑换，或在对应秘境探索获得。`}
        </p>
      </div>
      {!owned && (
        <>
          <SwitchWarnBlock view={null} newLabel="法宝研修" />
          <button className="btn-primary" disabled={busy} onClick={() => void onStartResearch()}>
            {busy ? '结算旧序列…' : '开始法宝研修'}
          </button>
        </>
      )}
      {owned && (
        <button className="btn-primary" disabled={busy} onClick={() => void onUpgrade()}>
          {busy ? '结算中…' : '尝试升星'}
        </button>
      )}
    </ConfirmSheet>
  );
}
