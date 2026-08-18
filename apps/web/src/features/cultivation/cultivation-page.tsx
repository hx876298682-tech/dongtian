import { useCallback, useState, type ReactElement } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useOutletContext } from 'react-router';
import { ApiClientError, type ActionCatalogEntry, type AuthActiveSession, type ContentActionsResponse, type Queue } from '@dongtian/contracts';
import { EmptyStateScreen, LoadingStateScreen, LocalErrorStateScreen } from '@dongtian/ui';

import { apiClient } from '../../lib/api.js';
import { emitGameFeedback } from '../../lib/game-feedback.js';
import { describeBehaviorAction, startBehaviorAction, type BehaviorQueueClient } from '../behavior/behavior-adapter.js';
import { formatCount, formatDurationUs, describeRealmId } from '../content/content-adapter.js';
import { findCultivationAction, findWeaponMasteryAction, findWeaponMasteryProgression, getCultivationChoices, isCultivationDirectionAvailable, isWeaponMasteryAvailable, type CultivationDirection, type WeaponMastery } from './cultivation-adapter.js';

function DirectionCard({ direction, action, starting, onStart }: { readonly direction: CultivationDirection; readonly action: ActionCatalogEntry | null; readonly starting: boolean; readonly onStart: () => void }): ReactElement {
  const available = action !== null && isCultivationDirectionAvailable(direction, [action]);
  return <article className={`behavior-resource ${available ? '' : 'behavior-resource--locked'}`}>
    <div className="behavior-resource__header"><div><p className="page-card__eyebrow">修炼方向</p><h4>{direction.label}</h4></div><span className="behavior-resource__status">{available ? '可执行' : '暂未配置'}</span></div>
    <p className="behavior-resource__lock-copy">{direction.description}</p>
    {available && action !== null ? <><div className="behavior-resource__outputs"><span>每轮修为</span><strong>{formatCount(action.cultivation_xp)}</strong><span>行动</span><strong>{describeBehaviorAction(action.action_id)}</strong></div><div className="behavior-resource__facts"><span>每轮 {formatDurationUs(action.base_duration_us)}</span><span>技能经验 {formatCount(action.skill_xp)}</span></div></> : <p className="behavior-resource__lock-copy">{direction.unavailableReason}</p>}
    <button className="ghost-button behavior-resource__start" type="button" onClick={onStart} disabled={!available || starting}>{starting ? '正在开始…' : '开始修炼'}</button>
  </article>;
}

function WeaponMasteryCard({ mastery, action, progression, starting, onStart }: { readonly mastery: WeaponMastery; readonly action: ActionCatalogEntry | null; readonly progression: ReturnType<typeof findWeaponMasteryProgression>; readonly starting: boolean; readonly onStart: () => void }): ReactElement {
  const available = action !== null && isWeaponMasteryAvailable(mastery, [action]);
  const level = progression?.level ?? 0;
  const bonus = Number(progression?.attack_bonus_per_level ?? '0.02') * level * 100;
  return <article className={`behavior-resource ${available ? '' : 'behavior-resource--locked'}`}>
    <div className="behavior-resource__header"><div><p className="page-card__eyebrow">修炼方向</p><h4>{mastery.label}</h4></div><span className="behavior-resource__status">{available ? '可执行' : '暂未配置'}</span></div>
    <p className="behavior-resource__lock-copy">{mastery.description}</p>
    <div className="behavior-resource__outputs"><span>当前等级</span><strong>Lv.{level}</strong><span>攻击加成</span><strong>{bonus.toFixed(0)}%</strong></div>
    {progression !== null ? <div className="behavior-resource__facts"><span>技能经验 {formatCount(progression.xp)}</span><span>每级 +{(Number(progression.attack_bonus_per_level ?? '0.02') * 100).toFixed(0)}%</span></div> : null}
    {available && action !== null ? <div className="behavior-resource__facts"><span>每轮 {formatDurationUs(action.base_duration_us)}</span><span>每轮技能经验 {formatCount(action.skill_xp)}</span></div> : <p className="behavior-resource__lock-copy">该专精的真实修炼行动尚未开放。</p>}
    <button className="ghost-button behavior-resource__start" type="button" onClick={onStart} disabled={!available || starting}>{starting ? '正在开始…' : '开始修炼'}</button>
  </article>;
}

export function CultivationPage(): ReactElement {
  const session = useOutletContext<AuthActiveSession>();
  const queryClient = useQueryClient();
  const actionsQuery = useQuery<ContentActionsResponse>({ queryKey: ['cultivation', session.character_id, 'actions'], queryFn: () => apiClient.getActions() });
  const queueQuery = useQuery<Queue>({ queryKey: ['cultivation', session.character_id, 'queue'], queryFn: () => apiClient.getQueue(session.character_id) });
  const progressionQuery = useQuery({ queryKey: ['cultivation', session.character_id, 'progression'], queryFn: () => apiClient.getProgression(session.character_id) });
  const [startingId, setStartingId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const choices = getCultivationChoices();
  const actions = actionsQuery.data?.actions ?? [];
  const start = useCallback(async (target: { readonly id: string }, action: ActionCatalogEntry | null) => {
    if (action === null || queueQuery.data === undefined || startingId !== null) return;
    setStartingId(target.id); setFeedback(null);
    try {
      await startBehaviorAction(action, { characterId: session.character_id, queue: queueQuery.data, client: apiClient as BehaviorQueueClient, behaviorKind: 'cultivation', invalidate: (queryKey) => queryClient.invalidateQueries({ queryKey }), emitFeedback: (message) => { setFeedback(message); emitGameFeedback(message, 'success'); } });
    } catch (error) {
      const message = error instanceof ApiClientError && error.status === 409 ? '挂机计划刚刚发生变化，请稍后再试。' : '修炼行动暂时无法开始，请稍后重试。';
      setFeedback(message); emitGameFeedback(message, 'warning');
    } finally { setStartingId(null); }
  }, [queueQuery.data, queryClient, session.character_id, startingId]);
  if (actionsQuery.isPending || queueQuery.isPending || progressionQuery.isPending) return <LoadingStateScreen title="正在读取修炼方向" description="正在检查已配置的修炼行动。" />;
  if (actionsQuery.error || queueQuery.error || progressionQuery.error) return <LocalErrorStateScreen title="修炼内容暂时无法读取" description="修炼方向和挂机计划读取失败。" actions={[{ label: '重试', onClick: () => { void queryClient.invalidateQueries({ queryKey: ['cultivation', session.character_id] }); } }]} />;
  if (actionsQuery.data === undefined || queueQuery.data === undefined || progressionQuery.data === undefined) return <EmptyStateScreen title="修炼内容暂不可用" description="暂无可展示的修炼目录。" />;
  return (
    <section className="behavior-layout behavior-layout--cultivation" aria-label="修炼方向选择">
      <header className="behavior-panel behavior-panel--hero">
        <div>
          <p className="page-card__eyebrow">修炼</p>
          <h3 className="page-card__title">选择修炼方向</h3>
          <p className="page-card__copy">练气、练体与各类武器修炼是同级修行路线；只有已配置的行动可以开始挂机。</p>
        </div>
        <span className="behavior-panel__realm">当前境界 · {describeRealmId(progressionQuery.data.cultivation.realm_stage_id)}</span>
      </header>
      <div className="behavior-panel behavior-panel--resources behavior-panel--cultivation-directions">
        <div className="behavior-panel__heading">
          <h4>修炼方向</h4>
          <span>{choices.length} 条路线</span>
        </div>
        <div className="behavior-resource-list">
          {choices.map((choice) => choice.kind === 'direction' ? (
            <DirectionCard
              key={choice.direction.id}
              direction={choice.direction}
              action={findCultivationAction(choice.direction, actions)}
              starting={startingId === choice.direction.id}
              onStart={() => { void start(choice.direction, findCultivationAction(choice.direction, actions)); }}
            />
          ) : (
            <WeaponMasteryCard
              key={choice.mastery.id}
              mastery={choice.mastery}
              action={findWeaponMasteryAction(choice.mastery, actions)}
              progression={findWeaponMasteryProgression(choice.mastery, progressionQuery.data.skills)}
              starting={startingId === choice.mastery.id}
              onStart={() => { void start(choice.mastery, findWeaponMasteryAction(choice.mastery, actions)); }}
            />
          ))}
        </div>
        {feedback !== null ? <p className="behavior-feedback" role="status">{feedback}</p> : null}
        <Link className="ghost-button" to="/cultivation/breakthrough">前往突破</Link>
      </div>
    </section>
  );
}
