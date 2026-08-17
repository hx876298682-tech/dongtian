import type { DungeonPreviewChoice, DungeonPreviewResponse, DungeonRunDetails, DungeonRunResponse, DungeonOpportunityResponse } from '@dongtian/contracts';

import { QINGSHE_HIGH_RISK_CHOICE_ID, QINGSHE_HIGH_RISK_ROUTE_ID, QINGSHE_SAFE_CHOICE_ID, QINGSHE_SAFE_ROUTE_ID } from './expedition-reducer.js';
import { describeItemId } from '../content/content-adapter.js';

export interface ExpeditionChoiceView {
  readonly choiceId: string;
  readonly routeId: string;
  readonly riskLabel: string;
  readonly label: string;
}

export interface ExpeditionOpportunityView {
  readonly title: string;
  readonly description: string;
  readonly facts: ReadonlyArray<{ readonly label: string; readonly value: string }>;
  readonly grantLine: string;
}

export interface ExpeditionPreviewView {
  readonly summary: string;
  readonly facts: ReadonlyArray<{ readonly label: string; readonly value: string }>;
  readonly coreRewards: ReadonlyArray<string>;
  readonly choices: ReadonlyArray<ExpeditionChoiceView>;
  readonly entryItems: ReadonlyArray<string>;
}

export interface ExpeditionRunView {
  readonly headline: string;
  readonly description: string;
  readonly facts: ReadonlyArray<{ readonly label: string; readonly value: string }>;
  readonly rewardLines: ReadonlyArray<string>;
  readonly combatLines: ReadonlyArray<string>;
  readonly isTimedOut: boolean;
  readonly canChoose: boolean;
  readonly canFinalize: boolean;
}

function readString(value: unknown, fallback = '未知'): string {
  return typeof value === 'string' && value.length > 0 ? value : fallback;
}

function readRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function formatRiskLabel(risk: string | undefined): string {
  switch (risk) {
    case 'SAFE':
      return '安全';
    case 'HIGH_RISK':
      return '高风险';
    default:
      return '未知';
  }
}

function describeTutorialId(id: string | null | undefined): string {
  return id === 'TUT-007' ? '秘境入门教学' : '入门教学';
}

function describeRouteId(id: string | null | undefined): string {
  switch (id) {
    case QINGSHE_SAFE_ROUTE_ID:
      return '左侧矿脉';
    case QINGSHE_HIGH_RISK_ROUTE_ID:
      return '右侧妖巢';
    default:
      return '未知路线';
  }
}

function describeOutcome(value: string | null | undefined): string {
  switch (value) {
    case 'SUCCESS':
      return '成功';
    case 'FAILURE':
      return '失败';
    default:
      return '待结算';
  }
}

function formatChoiceLabel(choice: DungeonPreviewChoice, fallbackIndex: number): string {
  if (typeof choice.label === 'string' && choice.label.length > 0) {
    return choice.label;
  }
  if (typeof choice.label_key === 'string' && choice.label_key.length > 0) {
    return choice.label_key === 'risk.route' ? '深入险地' : '路线选择';
  }
  return `路线 ${fallbackIndex + 1}`;
}

function formatChoiceId(choice: DungeonPreviewChoice): string {
  if (typeof choice.choice_id === 'string') {
    return choice.choice_id;
  }
  if (typeof choice.route_id === 'string') {
    return choice.route_id;
  }
  return '未知路线';
}

export function summarizeDungeonOpportunity(
  response: DungeonOpportunityResponse,
  dungeonLabel: string,
): ExpeditionOpportunityView {
  const opportunity = response.opportunity;
  const teachingGrant = response.teaching_grant;

  return {
    title: `${dungeonLabel} · 机会 ${opportunity.current_opportunities}/${opportunity.opportunity_cap}`,
    description: opportunity.next_recovery_at === null
      ? '探险次数已达上限。'
      : `探险次数将在稍后恢复 · 间隔 ${Math.round(opportunity.recovery_interval_seconds / 3600)} 小时`,
    facts: [
      { label: '恢复状态', value: opportunity.next_recovery_at === null ? '已封顶' : '等待恢复' },
    ],
    grantLine: teachingGrant.available
      ? `可领取 ${teachingGrant.applied_quantity} 次 · ${describeTutorialId(teachingGrant.source_tutorial_id)}`
      : `已领取 ${teachingGrant.applied_quantity} 次 · ${describeTutorialId(teachingGrant.source_tutorial_id)}`,
  };
}

export function summarizeDungeonPreview(response: DungeonPreviewResponse): ExpeditionPreviewView {
  return {
    summary: `推荐战力 ${response.dungeon.recommended_power} · 预计成功率 ${response.dungeon.estimated_success_rate}`,
    facts: [
      { label: '基础成功率', value: response.dungeon.base_success_rate },
      { label: '机会消耗', value: String(response.dungeon.opportunity_cost) },
      { label: '路线超时', value: `${response.dungeon.choice_timeout_seconds} 秒` },
    ],
      coreRewards: response.dungeon.core_rewards.map((itemId) => describeItemId(itemId)),
    entryItems: response.dungeon.entry_items.map((item) => {
      const itemId = readString(item['item_id'], '未知物品');
      const quantity = readString(item['quantity'], '1');
      return `${describeItemId(itemId)} × ${quantity}`;
    }),
    choices: response.dungeon.choices.map((choice, index) => ({
      choiceId: formatChoiceId(choice),
      routeId: readString(choice.route_id, index === 0 ? QINGSHE_SAFE_ROUTE_ID : QINGSHE_HIGH_RISK_ROUTE_ID),
      riskLabel: formatRiskLabel(typeof choice.risk === 'string' ? choice.risk : undefined),
      label: formatChoiceLabel(choice, index),
    })),
  };
}

function summarizeRewardCandidate(runState: Record<string, unknown>): ReadonlyArray<string> {
  const candidate = readRecord(runState['rewardCandidate']);
  if (candidate === null) {
    return [];
  }

  const lines = [`路线 ${describeRouteId(readString(candidate['routeId'], ''))} · ${describeOutcome(readString(candidate['outcome'], ''))}`];
  const items = Array.isArray(candidate['items']) ? candidate['items'] : [];
  for (const item of items) {
    const itemRecord = readRecord(item);
    if (itemRecord !== null) {
      lines.push(`${describeItemId(readString(itemRecord['assetId'], ''))} × ${readString(itemRecord['quantity'])}`);
    }
  }

  const cultivationXp = readString(candidate['cultivationXp'], '');
  if (cultivationXp.length > 0) {
    lines.push(`修为/秘境 XP ${cultivationXp}`);
  }
  return lines;
}

function summarizeFinalization(runState: Record<string, unknown>): ReadonlyArray<string> {
  const finalization = readRecord(runState['finalization']);
  if (finalization === null) {
    return [];
  }

  const reward = readRecord(finalization['reward']);
  if (reward === null) {
    return ['奖励已结算'];
  }

  const lines = [`结果 ${describeOutcome(readString(reward['outcome'], ''))} · 路线 ${describeRouteId(readString(reward['routeId'], ''))}`];
  const items = Array.isArray(reward['items']) ? reward['items'] : [];
  for (const item of items) {
    const itemRecord = readRecord(item);
    if (itemRecord !== null) {
      lines.push(`${describeItemId(readString(itemRecord['assetId'], ''))} × ${readString(itemRecord['quantity'])}`);
    }
  }

  const cultivationXp = readString(reward['cultivationXp'], '');
  if (cultivationXp.length > 0) {
    lines.push(`修为/秘境 XP ${cultivationXp}`);
  }

  return lines;
}

function summarizeCombat(runState: Record<string, unknown>): ReadonlyArray<string> {
  const combat = readRecord(runState['combatResult']);
  if (combat === null) {
    return [];
  }

  return [`战斗结束 · ${readString(combat['winner']) === 'PLAYER' ? '修士胜出' : '战斗结果已记录'}`];
}

export function isDungeonRunTimedOut(run: DungeonRunDetails, now: Date): boolean {
  return run.phase === 'ENTERED' && run.selected_choice_id === null && new Date(run.choice_deadline_at).getTime() <= now.getTime();
}

export function summarizeDungeonRun(response: DungeonRunResponse, now: Date = new Date()): ExpeditionRunView {
  const { run } = response;
  const runState = readRecord(run.run_state) ?? {};
  const isTimedOut = isDungeonRunTimedOut(run, now);
  const rewardLines = summarizeRewardCandidate(runState);
  const finalizationLines = summarizeFinalization(runState);
  const combatLines = summarizeCombat(runState);
  const rewardCandidate = readRecord(runState['rewardCandidate']);

  return {
    headline:
      run.phase === 'FINALIZED'
        ? '秘境完成 · 奖励已入账'
        : run.phase === 'REWARD_CANDIDATE'
          ? '战斗已结束 · 等待结算'
          : isTimedOut
            ? '路线超时 · 已转入安全结算'
            : '秘境运行中',
    description:
      run.phase === 'FINALIZED'
        ? `结果 ${describeOutcome(run.outcome)}`
        : run.selected_route_id === null
          ? '等待路线选择。'
          : `已选 ${describeRouteId(run.selected_route_id)} · ${formatRiskLabel(run.selected_route_risk ?? undefined)}`,
    facts: [
      { label: '探索状态', value: run.phase === 'REWARD_CANDIDATE' ? '等待结算' : '探索中' },
      { label: '结果', value: describeOutcome(run.outcome) },
      { label: '选择状态', value: isTimedOut ? '已到期' : '等待选择' },
    ],
    rewardLines:
      finalizationLines.length > 0
        ? finalizationLines
        : rewardLines.length > 0
          ? rewardLines
          : rewardCandidate !== null
            ? ['奖励候选已生成']
            : [],
    combatLines,
    isTimedOut,
    canChoose: run.phase === 'ENTERED' && run.selected_choice_id === null,
    canFinalize: run.phase === 'REWARD_CANDIDATE',
  };
}

export function describeDungeonChoice(choice: ExpeditionChoiceView): string {
  return `${choice.label} · ${choice.riskLabel}`;
}

export function dungeonRouteHint(choiceId: string): string {
  if (choiceId === QINGSHE_SAFE_CHOICE_ID) {
    return '默认安全撤离路线，适合先熟悉流程。';
  }
  if (choiceId === QINGSHE_HIGH_RISK_CHOICE_ID) {
    return '高风险路线，战斗更激进，奖励预期更高。';
  }
  return '未知路线。';
}
