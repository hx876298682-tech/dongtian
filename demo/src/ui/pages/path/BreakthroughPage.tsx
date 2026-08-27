/** 突破页：材料不齐不扣分毫；所需以服务端校验为准。成功后以 BreakthroughData 回显真实消耗。 */
import { useState } from 'react';
import { useGame } from '../../store/GameStore';
import { useShell } from '../../app/shell';
import { useActionFlow } from '../../flows/useActionFlow';
import { PageHeaderBack } from '../../components/primitives';
import type { ResourceId } from '../../content/meta';
import { RESOURCE_META, REALM_LADDER, realmLabel } from '../../content/meta';
import { fmtNum } from '../../api/format';
import { REALMS } from '../../../game/config';

export function BreakthroughPage() {
  const { player, client, revision } = useGame();
  const shell = useShell();
  const flow = useActionFlow(shell.showToast);
  const [success, setSuccess] = useState<{ from: string; to: string; costs: Partial<Record<ResourceId, number>>; cultivationCost: number } | null>(null);

  if (!player) return null;
  const nextRealm = REALM_LADDER[REALM_LADDER.findIndex((r) => r.id === player.realmId) + 1];
  const realmMax = (REALMS as Record<string, { cultivationMax: number }>)[player.realmId]?.cultivationMax ?? null;

  return (
    <div className="pad">
      <PageHeaderBack title="叩问玄关" sub={success ? `${realmLabel(success.from)} → ${realmLabel(success.to)} · 已成` : `当前 ${realmLabel(player.realmId)}`} onClose={() => shell.closePage()} />

      {success ? (
        <>
          <div className="card double card-padded" style={{ textAlign: 'center', paddingBlock: 22 }}>
            <div
              aria-hidden
              style={{
                width: 58, height: 58, margin: '0 auto 10px', borderRadius: 10,
                background: 'var(--cinnabar)', color: '#f7ede4',
                fontFamily: 'var(--font-display)', fontSize: 30, fontWeight: 700,
                display: 'grid', placeItems: 'center', boxShadow: 'inset 0 0 0 2px rgba(255,251,244,.55)',
              }}
            >
              破
            </div>
            <b className="serif" style={{ fontSize: 20, letterSpacing: '.12em' }}>
              {realmLabel(success.from)} → {realmLabel(success.to)}
            </b>
            <p style={{ marginTop: 8, fontSize: 11.5, color: 'var(--ink-600)' }}>
              玄关洞开，灵台清明。新境界已录入洞府档案。
            </p>
          </div>
          <div className="journal-panel">
            <div className="journal-row"><span className="journal-text">修为消耗</span><span className="journal-gain loss num">-{fmtNum(success.cultivationCost)}</span></div>
            {(Object.entries(success.costs) as Array<[ResourceId, number]>).map(([resId, amount]) => (
              Number.isFinite(amount) && amount > 0 ? (
                <div key={resId} className="journal-row">
                  <span className="journal-text">{RESOURCE_META[resId]?.name ?? resId}</span>
                  <span className="journal-gain loss num">-{fmtNum(amount)}</span>
                </div>
              ) : null
            ))}
          </div>
          <button className="btn-primary" onClick={() => shell.closePage()}>收入洞府</button>
        </>
      ) : (
        <>
          <div className="card card-padded" style={{ textAlign: 'center', paddingBlock: 18 }}>
            <b className="serif" style={{ fontSize: 18, letterSpacing: '.1em' }}>{realmLabel(player.realmId)}</b>
            <p className="num" style={{ marginTop: 6, color: 'var(--ink-600)', fontSize: 12.5 }}>
              积累修为 {fmtNum(player.cultivationXp)}
              {realmMax ? ` / ${fmtNum(realmMax)}` : ''}
              {nextRealm ? ` · 前路 ${realmLabel(nextRealm.id)}` : ' · 前路未明'}
            </p>
          </div>

          <ul style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 11.5, color: 'var(--ink-600)', lineHeight: 1.7 }}>
            <li>· 突破需修为圆满并备齐丹药、灵石、残卷与特殊材料。</li>
            <li>· 材料不齐则玄关不开，且<strong>不损分毫</strong>；材料齐全必定功成，没有失败概率。</li>
            <li>· 所需清单由服务端按冻结规则实时校验，此处不放演示数值。</li>
          </ul>

          <button
            className="btn-ceremony"
            disabled={flow.busy}
            onClick={() => {
              void (async () => {
                const result = await flow.runMutation(() => client.breakthrough(revision()), '');
                if (result?.data) {
                  setSuccess({
                    from: result.data.fromRealm,
                    to: result.data.toRealm,
                    costs: result.data.resourceCost,
                    cultivationCost: result.data.cultivationCost,
                  });
                  shell.showToast(`恭喜道友，成功突破至${realmLabel(result.data.toRealm)}`);
                }
              })();
            }}
          >
            {flow.busy ? '推演中…' : '引动天劫 · 尝试突破'}
          </button>
        </>
      )}
    </div>
  );
}
