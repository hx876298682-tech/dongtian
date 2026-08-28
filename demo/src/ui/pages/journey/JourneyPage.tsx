/** 历练主页：斩妖 / 采药 / 挖矿 三分段 + 秘境区块（准备面板内嵌 combat/preview 只读预览） */
import { useEffect, useState } from 'react';
import { Trophy } from 'lucide-react';
import { useGame } from '../../store/GameStore';
import { deriveActionView } from '../../store/actionView';
import { useShell } from '../../app/shell';
import { useActionFlow } from '../../flows/useActionFlow';
import { ConfirmSheet, SwitchWarnBlock } from '../../components/sheets';
import { SectionHead, RevealCard, SkeletonCard, EmptyHint } from '../../components/primitives';
import { ElementTag } from '../../components/ElementTag';
import { mapPresentation, DUNGEONS, realmLabel } from '../../content/meta';
import { fmtNum, fmtSpan } from '../../api/format';
import type { ActionView } from '../../store/actionView';
import type { CombatPreviewData, DungeonSettlementData, HighTierPreviewData, HighTierSettlementData } from '../../api/client';
import { BattleLayer } from '../../layers/BattleLayer';

type Segment = 'hunt' | 'herb' | 'mine';

export function JourneyPage() {
  const game = useGame();
  const { player, catalog, now } = game;
  const shell = useShell();
  const flow = useActionFlow(shell.showToast);
  const [segment, setSegment] = useState<Segment>('hunt');
  const [huntView, setHuntView] = useState<'wild' | 'dungeon'>('wild');
  const [battle, setBattle] = useState<{ name: string; data: DungeonSettlementData | HighTierSettlementData; retryRealm?: string } | null>(null);
  if (!player || !catalog) return null;

  const action = deriveActionView(player, catalog);
  const releasedMaps = catalog.maps.filter((m) => m.status === 'released');

  return (
    <div className="pad">
      {battle && (
        <BattleLayer
          dungeonName={battle.name}
          data={battle.data}
          onClose={() => setBattle(null)}
          onRetry={() => {
            const b = battle as { name: string; retryRealm?: string };
            setBattle(null);
            if (b.retryRealm) void openDungeon(b.retryRealm, b.name);
          }}
          retryEnabled={!flow.busy}
        />
      )}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <div className="segmented" style={{ flex: 1 }}>
          <button className={`seg-btn${segment === 'hunt' ? ' active' : ''}`} onClick={() => setSegment('hunt')}>斩妖</button>
          <button className={`seg-btn${segment === 'herb' ? ' active' : ''}`} onClick={() => setSegment('herb')}>采药</button>
          <button className={`seg-btn${segment === 'mine' ? ' active' : ''}`} onClick={() => setSegment('mine')}>挖矿</button>
        </div>
        <button className="icon-btn" title="英雄榜" onClick={() => shell.openPage('leaderboard')}><Trophy size={17} /></button>
      </div>

      {segment === 'hunt' && (
        <div className="sub-seg">
          <button className={huntView === 'wild' ? 'active' : ''} onClick={() => setHuntView('wild')}>野外斩妖</button>
          <button className={huntView === 'dungeon' ? 'active' : ''} onClick={() => setHuntView('dungeon')}>秘境</button>
        </div>
      )}

      {segment === 'hunt' ? (
        huntView === 'wild' ? <MapList /> : <DungeonBlock />
      ) : (
        <>
          <SectionHead title={segment === 'herb' ? '采集灵草' : '开采灵矿'} sub="提案玩法 · 以服务端结算为准" />
          <GatherList segment={segment} />
        </>
      )}
    </div>
  );

  function MapList() {
    if (releasedMaps.length === 0) return <SkeletonCard height={130} />;
    return (
      <div className="map-grid">
        {releasedMaps.map((map) => {
          const pres = mapPresentation(map.id);
          const isCurrent = action?.home === 'map' && action.refId === map.id;
          if (!map.unlocked) {
            return (
              <RevealCard
                key={map.id}
                glyph={pres.glyph}
                title={map.displayName}
                desc={`${pres.flavor} · ${realmLabel(map.unlockRealmId)}开启`}
              />
            );
          }
          const cycles = isCurrent && action && map.targetKillTimeSeconds > 0
            ? Math.floor((now() - action.startedAtMs) / 1000 / map.targetKillTimeSeconds)
            : null;
          return (
            <div key={map.id} className={`map-card${isCurrent ? ' current' : ''}`}>
              <div className={`map-scene ${pres.sceneCls}`}>
                <h3>{map.displayName}</h3>
                <span className="glyph-seal">{pres.glyph}</span>
                <span
                  className="danger-tag"
                  style={{ background: pres.danger === '高危' ? 'var(--cinnabar)' : pres.danger === '中危' ? '#8a6b42' : 'var(--jade)' }}
                >
                  {pres.danger}
                </span>
              </div>
              <div className="map-body">
                <div className="drop-row">
                  <span>产出：</span><span className="drop-chip">灵石</span><span className="drop-chip">材料</span>
                  <span className="drop-chip">装备</span>
                </div>
                <div className="map-foot">
                  <small>每场约 {fmtSpan(map.targetKillTimeSeconds)}</small>
                  {isCurrent ? (
                    <span className="badge-current">历练中{cycles !== null ? ` · ${fmtNum(cycles)} 场` : ''}</span>
                  ) : (
                    <button className="btn-go" disabled={flow.busy} onClick={() => openPrep(map.actionId, map.displayName)}>
                      前往挂机
                    </button>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    );
  }

  /** 秘境全链路：start（开启 attempt）→ settle（服务端确定性模拟，返回逐秒回放与奖励）→ BattleLayer 播放 */
  async function openDungeon(dungeonId: string, name: string): Promise<void> {
    shell.closeSheet();
    const startResult = await flow.runMutation(() => game.client.startDungeon(dungeonId, game.revision()), '');
    if (!startResult) return;
    const attemptId = startResult.data.attemptId;
    const settled = await flow.runMutation(() => game.client.settleDungeon(attemptId, game.revision()), '');
    if (settled?.data) setBattle({ name, data: settled.data });
  }

  async function openHighTier(realm: string, name: string): Promise<void> {
    shell.closeSheet();
    const preview = await game.client.highTierPreview(realm).catch(function () { return null; });
    if (!preview) { shell.showToast('远征预览不可用，稍后再试', 'warn'); return; }
    shell.openSheet(
      <HighTierPrepSheet
        name={name}
        preview={preview.data}
        busy={flow.busy}
        onCancel={() => shell.closeSheet()}
        onStart={async () => {
          shell.closeSheet();
          const started = await flow.runMutation(function () { return game.client.startHighTier(realm, game.revision()); }, '');
          if (!started) return;
          const attemptId = (started.data as { attemptId?: string }).attemptId;
          if (!attemptId) { shell.showToast('远征开启异常', 'warn'); return; }
          const settled = await flow.runMutation(function () { return game.client.settleHighTier(attemptId, game.revision()); }, '');
          if (settled?.data) setBattle({ name, data: settled.data, retryRealm: realm });
        }}
      />,
    );
  }

  function DungeonBlock() {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <p style={{ fontSize: 11, color: 'var(--ink-600)' }}>秘境为时刻型挑战：先在战前整备核对门槛，首败即止并进入冷却。</p>
        {DUNGEONS.map((dungeon) => (
          <button key={dungeon.id} className="option-row" onClick={() => openDungeon(dungeon.id, dungeon.name)}>
            <span className="option-main">
              <b>{dungeon.name}</b>
              <span className="option-sub">{dungeon.flavor}</span>
            </span>
            <span className="btn-mini">探入</span>
          </button>
        ))}

        <div style={{ fontSize: 11, color: 'var(--gold)', marginTop: 4 }}>‖ 高阶远征（P10 构筑门槛 · 独立奖励）</div>
        {[{ realm: 'nascent_soul', name: '元婴远征' }, { realm: 'divine_transformation', name: '化神远征' }].map((ht) => (
          <button key={ht.realm} className="option-row" onClick={() => void openHighTier(ht.realm, ht.name)}>
            <span className="option-main">
              <b>{ht.name}</b>
              <span className="option-sub">高阶 Boss 专属技能 · 独立掉落 · 资源供给窗口另计</span>
            </span>
            <span className="btn-mini">远征</span>
          </button>
        ))}
      </div>
    );
  }

  function GatherList({ segment }: { segment: 'herb' | 'mine' }) {
    if (!catalog) return null;
    const wanted = segment === 'herb' ? 'herbalism' : 'mining';
    const maps = catalog.gatheringMaps.filter((g) => g.actionId === wanted && g.status !== 'content_pending');
    if (maps.length === 0) return <EmptyHint text="此地尚未开垦。" />;
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {maps.map((g) => {
          const isCurrent = action?.home === 'gather' && action.refId === g.id;
          const gateClosed = g.status === 'proposal_v1';
          return (
            <div key={g.id} className={`map-card${isCurrent ? ' current' : ''}`}>
              <div className={`map-scene ${segment === 'herb' ? 'scene-baicao' : 'scene-heifeng'}`}>
                <h3>{g.displayName}</h3>
                <span className="danger-tag" style={{ background: 'var(--jade)' }}>资源区</span>
              </div>
              <div className="map-body">
                <p>{segment === 'herb' ? '灵气滋养的天然药圃，可直接入篮。' : '灵脉纵横，矿石随手可拾，偶有妖物骚扰。'}</p>
                <div className="drop-row">
                  <span>产出：</span><span className="drop-chip">每轮 ×{fmtNum(g.yieldPerCompletion)}</span>
                  {gateClosed && <span style={{ fontSize: 10.5, color: 'var(--gold)' }}>提案试玩 · 门禁未放行</span>}
                </div>
                <div className="map-foot">
                  <small>每轮 {fmtSpan(g.intervalSeconds)}</small>
                  {isCurrent ? (
                    <span className="badge-current">进行中</span>
                  ) : (
                    <button
                      className="btn-go"
                      disabled={flow.busy || gateClosed}
                      onClick={() => void beginGather(g.actionId, g.id, g.displayName)}
                    >
                      {gateClosed ? '待放行' : '前往采集'}
                    </button>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    );
  }

  async function beginGather(actionId: 'herbalism' | 'mining', mapId: string, name: string): Promise<void> {
    shell.closeSheet();
    await flow.startAction({ actionId, mapId }, `采集·${name}`);
  }

  function openPrep(activityId: string, name: string): void {
    shell.openSheet(
      <PrepSheet
        activityId={activityId}
        name={name}
        view={action}
        busy={flow.busy}
        onCancel={() => shell.closeSheet()}
        onStart={async () => {
          shell.closeSheet();
          await flow.startAction({ actionId: activityId }, `历练·${name}`);
        }}
      />,
    );
  }
}

function PrepSheet({
  activityId, name, view, busy, onCancel, onStart,
}: {
  activityId: string; name: string; view: ActionView | null; busy: boolean;
  onCancel(): void; onStart(): Promise<void>;
}) {
  const { client, revision } = useGame();
  const [preview, setPreview] = useState<CombatPreviewData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setPreview(null);
    setError(null);
    client.combatPreview(activityId, revision())
      .then((envelope) => { if (alive) setPreview(envelope.data); })
      .catch((err: unknown) => { if (alive) setError(err instanceof Error ? err.message : '预估失败'); });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activityId]);

  const blocked = preview?.gate.status === 'blocked';
  const blockedReason = blocked
    ? preview?.gate.reason === 'realm'
      ? `${realmLabel(preview.gate.requiredRealm ?? '')}境界`
      : '失败冷却'
    : null;

  return (
    <ConfirmSheet title={`${name} · 战前整备`} onClose={onCancel}>
      <div style={{ textAlign: 'center', padding: '4px 0 2px' }}>
        <b style={{ fontFamily: 'var(--font-display)', fontSize: 17, letterSpacing: '.06em' }}>{name}</b>
      </div>

      {!preview && !error && <SkeletonCard height={116} />}
      {error && <EmptyHint text={`无法获取战斗预估：${error}`} />}
      {preview && (
        <>
          <div className={`gate-banner ${blocked ? 'gate-blocked' : 'gate-open'}`}>
            {blocked ? `门槛不足：${blockedReason ?? ''}` : '门槛已过，可入此地历练。首败将中止后续场次并进入冷却，失败不发奖励。'}
          </div>
          <div className="prep-stats">
            <Stat label="生命" value={preview.stats.health} />
            <Stat label="攻击" value={preview.stats.attack} />
            <Stat label="防御" value={preview.stats.defence} />
            <Stat label="战力" value={preview.stats.battlePower} />
            <Stat label="命中" value={preview.stats.accuracy} showDecimal />
            <Stat label="闪避" value={preview.stats.evasion} showDecimal />
          </div>
          <div className="drop-row" style={{ paddingInline: 2 }}>
            <span>预计清场 {fmtSpan(preview.targetClearTime)}</span>
            {preview.pillBudget > 0 && <span className="drop-chip">丹药预算 ×{preview.pillBudget}</span>}
            <ElementTag elementKey={preview.stats.element} />
          </div>
        </>
      )}

      <SwitchWarnBlock view={view} newLabel={`${name}历练`} />

      <button className="btn-primary" disabled={busy || blocked || !preview} onClick={() => void onStart()}>
        {busy ? '结算旧序列…' : blocked ? '造化未足' : '开始挂机'}
      </button>
    </ConfirmSheet>
  );
}

function Stat({ label, value, showDecimal }: { label: string; value: number; showDecimal?: boolean }) {
  return (
    <div className="stat-block">
      <span>{label}</span>
      <b>{showDecimal ? Number(value).toFixed(3) : fmtNum(value)}</b>
    </div>
  );
}

function HighTierPrepSheet({ name, preview, busy, onCancel, onStart }: {
  name: string;
  preview: HighTierPreviewData;
  busy: boolean;
  onCancel(): void;
  onStart(): Promise<void>;
}) {
  const gate = preview.gate;
  const blocked = gate.status === 'blocked';
  const reasonText = gate.reason === 'realm'
    ? `境界需达到 ${realmLabel(gate.requiredRealm ?? '')}`
    : gate.reason === 'collection'
      ? `集换印不足（${preview.collectionProgress ? `${preview.collectionProgress.marks}/${preview.collectionProgress.requiredMarks}` : '?'}）`
      : '门槛未达';
  const required = gate.required;
  return (
    <ConfirmSheet title={`${name} · 战前整备`} onClose={onCancel}>
      <div style={{ textAlign: 'center', padding: '4px 0 2px' }}>
        <b style={{ fontFamily: 'var(--font-display)', fontSize: 17, letterSpacing: '.06em' }}>{name} · 高阶远征</b>
      </div>

      <div className={`gate-banner ${blocked ? 'gate-blocked' : 'gate-open'}`}>
        {blocked ? `门槛未达：${reasonText}` : '门禁通过。高阶 Boss 失败无奖励、不扣丹药，进入恢复冷却。'}
      </div>

      {blocked && gate.reason === 'realm' && required && (
        <div className="journal-panel">
          {([['攻击', required.attack, preview.stats.attack], ['防御', required.defence, preview.stats.defence], ['生命', required.health, preview.stats.health]] as Array<[string, number, number]>).map(function ([label, need, have]) {
            const ok = have >= need;
            return (
              <div key={label} className={`check-line ${ok ? 'ok' : 'miss'}`}>
                <span className="check-state">{ok ? '✓' : '✗'}</span>
                <span>{label}</span>
                <span className="check-val num">{fmtNum(have)} / {fmtNum(need)}{!ok ? ` · 缺 ${fmtNum(need - have)}` : ''}</span>
              </div>
            );
          })}
        </div>
      )}
      {blocked && gate.reason === 'collection' && preview.collectionProgress && (
        <div className="journal-panel">
          <div className="check-line miss">
            <span className="check-state">✗</span>
            <span>集换印（P10 构筑）</span>
            <span className="check-val num">{preview.collectionProgress.marks} / {preview.collectionProgress.requiredMarks}</span>
          </div>
        </div>
      )}

      <div className="prep-stats">
        <Stat label="BOSS 生命" value={preview.bossHp} />
        <Stat label="丹药预算" value={preview.pillBudget} />
      </div>
        <div className="drop-row" style={{ paddingInline: 2 }}>
          <span>预计清场 {fmtSpan(preview.targetClearTime)}</span>
          <span className="drop-chip">恢复冷却 {fmtSpan(preview.recoverySeconds)}</span>
        </div>
      {preview.skill && (
        <small style={{ fontSize: 10.5, color: 'var(--ink-600)' }}>
          BOSS 专属技能：冷却 {fmtSpan(preview.skill.cooldownSeconds)} · 持续 {fmtSpan(preview.skill.durationSeconds)} · 攻击压制 {preview.skill.attackSuppressionPercent}%
        </small>
      )}

      <SwitchWarnBlock view={null} newLabel={`${name}远征`} />
      <button className="btn-primary" disabled={busy || blocked} onClick={() => void onStart()}>
        {busy ? '结算旧序列…' : blocked ? '造化未足' : '开始远征'}
      </button>
      <button className="btn-danger-ghost" onClick={onCancel}>取消</button>
    </ConfirmSheet>
  );
}
