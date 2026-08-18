import { useCallback, useMemo, useState, type ReactElement } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useOutletContext } from 'react-router';
import { ApiClientError, type ActionCatalogEntry, type AuthActiveSession, type ContentActionsResponse, type Queue } from '@dongtian/contracts';
import { EmptyStateScreen, LocalErrorStateScreen, LoadingStateScreen } from '@dongtian/ui';

import { apiClient } from '../../lib/api.js';
import { emitGameFeedback } from '../../lib/game-feedback.js';
import { formatDurationUs, describeUnlockReason } from '../content/content-adapter.js';
import { isBehaviorActionAvailable, startBehaviorAction, type BehaviorQueueClient } from '../behavior/behavior-adapter.js';
import { findExpeditionMonster, getExpeditionRegions, type ExpeditionMonsterCatalogEntry } from './expedition-catalog.js';

const COMBAT_QUERY_PREFIX = 'combat';

export function CombatLoading(): ReactElement {
  return <LoadingStateScreen title="正在读取历练地图" description="正在整理可挑战的地图和怪物。" />;
}

export function CombatError({ onRetry }: { readonly onRetry: () => void | Promise<unknown> }): ReactElement {
  return <LocalErrorStateScreen title="历练内容读取失败" description="地图或怪物目录暂时无法读取。" actions={[{ label: '重试', onClick: onRetry }]} />;
}

export function CombatEmpty(): ReactElement {
  return <EmptyStateScreen title="暂无可挑战的怪物" description="当前配置中还没有可执行的战斗行动。" />;
}

function actionForMonster(monster: ExpeditionMonsterCatalogEntry, actions: readonly ActionCatalogEntry[]): ActionCatalogEntry | null {
  return actions.find((action) => action.action_id === monster.actionId) ?? null;
}

function CombatMonsterCard({ monster, action, selected, starting, onActivate }: {
  readonly monster: ExpeditionMonsterCatalogEntry;
  readonly action: ActionCatalogEntry | null;
  readonly selected: boolean;
  readonly starting: boolean;
  readonly onActivate: () => void;
}): ReactElement {
  const available = action !== null && isBehaviorActionAvailable(action);
  const lockCopy = action === null ? '该怪物暂未配置战斗行动' : describeUnlockReason(action.unlock_state.reason, action.unlock_state.blockers);
  return (
    <article className={`behavior-resource expedition-monster ${selected ? 'behavior-resource--selected' : ''} ${available ? '' : 'behavior-resource--locked'}`}>
      <button className="expedition-monster__select" type="button" aria-pressed={selected} aria-label={`${monster.label}，${available ? '点击开始战斗挂机' : '已锁定'}`} onClick={onActivate} disabled={starting}>
        <span className="behavior-resource__header"><strong>{monster.label}</strong><span className="behavior-resource__status">{available ? '可挂机' : '已锁定'}</span></span>
        <span className="behavior-resource__facts"><span>战力 {monster.recommendedPower}</span><span>生命 {monster.hp}</span><span>攻击 {monster.attack}</span><span>防御 {monster.defense}</span></span>
        <span className="behavior-resource__outputs"><span>可能掉落</span><strong>{monster.loot.join('、')}</strong></span>
        {action !== null ? <span className="behavior-resource__facts"><span>每轮 {formatDurationUs(action.base_duration_us)}</span><span>修为 +{action.cultivation_xp}</span></span> : null}
      </button>
      {!available ? <p className="behavior-resource__lock-copy">{lockCopy}</p> : null}
      {available ? <span className="behavior-resource__start" aria-hidden="true">{starting ? '正在开始…' : '点击怪物开始挂机'}</span> : null}
    </article>
  );
}

export function CombatPage(): ReactElement {
  const session = useOutletContext<AuthActiveSession>();
  const queryClient = useQueryClient();
  const regions = getExpeditionRegions();
  const [selectedRegionId, setSelectedRegionId] = useState(regions[0]?.id ?? '');
  const [selectedMonsterId, setSelectedMonsterId] = useState(regions[0]?.monsterIds[0] ?? '');
  const [startingActionId, setStartingActionId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const actionsQuery = useQuery<ContentActionsResponse>({ queryKey: [COMBAT_QUERY_PREFIX, session.character_id, 'actions'], queryFn: () => apiClient.getActions() });
  const queueQuery = useQuery<Queue>({ queryKey: [COMBAT_QUERY_PREFIX, session.character_id, 'queue'], queryFn: () => apiClient.getQueue(session.character_id) });
  const selectedRegion = regions.find((region) => region.id === selectedRegionId) ?? regions[0];
  const selectedMonster = findExpeditionMonster(selectedMonsterId);
  const actions = actionsQuery.data?.actions ?? [];
  const monsters = useMemo(() => selectedRegion?.monsterIds.map(findExpeditionMonster).filter((monster): monster is ExpeditionMonsterCatalogEntry => monster !== null) ?? [], [selectedRegion]);
  const firstError = actionsQuery.error ?? queueQuery.error;

  const selectRegion = (regionId: string): void => {
    const region = regions.find((candidate) => candidate.id === regionId);
    setSelectedRegionId(regionId);
    setSelectedMonsterId(region?.monsterIds[0] ?? '');
  };

  const startCombat = useCallback(async (monster: ExpeditionMonsterCatalogEntry): Promise<void> => {
    const action = actionForMonster(monster, actions);
    if (action === null || queueQuery.data === undefined || startingActionId !== null) return;
    setStartingActionId(action.action_id);
    setFeedback(null);
    try {
      await startBehaviorAction(action, {
        characterId: session.character_id,
        queue: queueQuery.data,
        client: apiClient as BehaviorQueueClient,
        behaviorKind: 'combat',
        invalidate: (queryKey) => queryClient.invalidateQueries({ queryKey: [COMBAT_QUERY_PREFIX, ...queryKey.slice(1)] }),
        emitFeedback: (message) => { setFeedback(message); emitGameFeedback(message, 'success'); },
        actionLabel: () => `${monster.label}战斗`,
      });
    } catch (error) {
      const message = error instanceof ApiClientError && error.status === 409 ? '挂机计划刚刚发生变化，请稍后再试。' : '战斗暂时无法开始，请稍后重试。';
      setFeedback(message);
      emitGameFeedback(message, 'warning');
    } finally {
      setStartingActionId(null);
    }
  }, [actions, queryClient, queueQuery.data, session.character_id, startingActionId]);

  if (actionsQuery.isPending || queueQuery.isPending) return <CombatLoading />;
  if (firstError !== null && firstError !== undefined) return <CombatError onRetry={() => queryClient.invalidateQueries({ queryKey: [COMBAT_QUERY_PREFIX, session.character_id] })} />;
  if (actions.length === 0 || queueQuery.data === undefined) return <CombatEmpty />;

  return <section className="behavior-layout" aria-label="历练战斗">
    <header className="behavior-panel behavior-panel--hero"><div><p className="page-card__eyebrow">历练 · 自动战斗</p><h3 className="page-card__title">选择怪物，开始挂机</h3><p className="page-card__copy">先选地图，再点击怪物即可开始战斗挂机；战斗会和其他行动一样持续结算，收益显示在顶部行为栏。</p></div><span className="behavior-panel__realm">{regions.length} 张地图 · {11} 只怪物</span></header>
    <div className="behavior-panel behavior-panel--regions"><div className="behavior-panel__heading"><h4>地图</h4><span>{regions.length} 个区域</span></div><div className="behavior-region-list">{regions.map((region) => <button key={region.id} className={`behavior-region ${region.id === selectedRegion?.id ? 'behavior-region--selected' : ''}`} type="button" aria-pressed={region.id === selectedRegion?.id} onClick={() => selectRegion(region.id)}><span className="behavior-region__header"><strong>{region.label}</strong><small>{region.stageLabel}</small></span><span className="behavior-region__description">{region.description}</span></button>)}</div></div>
    <div className="behavior-panel behavior-panel--resources"><div className="behavior-panel__heading"><div><h4>{selectedRegion?.label ?? '历练地图'}</h4><p>点击怪物开始战斗</p></div><span>{monsters.length} 只怪物</span></div><div className="behavior-resource-list">{monsters.map((monster) => <CombatMonsterCard key={monster.id} monster={monster} action={actionForMonster(monster, actions)} selected={monster.id === selectedMonster?.id} starting={startingActionId === monster.actionId} onActivate={() => { setSelectedMonsterId(monster.id); if (actionForMonster(monster, actions) !== null) void startCombat(monster); }} />)}</div></div>
    {feedback ? <p className="behavior-feedback" role="status">{feedback}</p> : null}
  </section>;
}
