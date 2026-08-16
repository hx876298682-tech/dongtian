import type { DungeonPreviewChoice, DungeonPreviewResponse, DungeonRunDetails, DungeonRunResponse, DungeonOpportunityResponse } from '@dongtian/contracts';

import { QINGSHE_HIGH_RISK_CHOICE_ID, QINGSHE_HIGH_RISK_ROUTE_ID, QINGSHE_SAFE_CHOICE_ID, QINGSHE_SAFE_ROUTE_ID } from './expedition-reducer.js';

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

function formatChoiceLabel(choice: DungeonPreviewChoice, fallbackIndex: number): string {
  if (typeof choice.label === 'string' && choice.label.length > 0) {
    return choice.label;
  }
  if (typeof choice.label_key === 'string' && choice.label_key.length > 0) {
    return choice.label_key;
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
    description: `下次恢复 ${opportunity.next_recovery_at ?? '已封顶'} · 恢复间隔 ${Math.round(opportunity.recovery_interval_seconds / 3600)} 小时`,
    facts: [
      { label: '恢复锚点', value: opportunity.recovery_anchor_at },
      { label: '计算时间', value: response.calculation_as_of },
      { label: '配置版本', value: response.config_version },
    ],
    grantLine: teachingGrant.available
      ? `教学赠送可领 ${teachingGrant.applied_quantity} 次 · 来源 ${teachingGrant.source_tutorial_id}`
      : `教学赠送已领取 ${teachingGrant.applied_quantity} 次 · 领取于 ${teachingGrant.claimed_at ?? '未知'}`,
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
    coreRewards: response.dungeon.core_rewards,
    entryItems: response.dungeon.entry_items.map((item) => {
      const itemId = readString(item['item_id'], '未知物品');
      const quantity = readString(item['quantity'], '1');
      return `${itemId} × ${quantity}`;
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

  const lines = [`路线 ${readString(candidate['routeId'])} · ${readString(candidate['outcome'])}`];
  const items = Array.isArray(candidate['items']) ? candidate['items'] : [];
  for (const item of items) {
    const itemRecord = readRecord(item);
    if (itemRecord !== null) {
      lines.push(`${readString(itemRecord['assetId'])} × ${readString(itemRecord['quantity'])}`);
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

  const lines = [`结果 ${readString(reward['outcome'])} · 路线 ${readString(reward['routeId'])}`];
  const items = Array.isArray(reward['items']) ? reward['items'] : [];
  for (const item of items) {
    const itemRecord = readRecord(item);
    if (itemRecord !== null) {
      lines.push(`${readString(itemRecord['assetId'])} × ${readString(itemRecord['quantity'])}`);
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

  return [
    `终止原因 ${readString(combat['terminationReason'])}`,
    `胜负 ${readString(combat['winner'])}`,
    `耗时 ${readString(combat['elapsedUs'])}µs`,
  ];
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
        ? `结果 ${readString(run.outcome)} · 运行 ${run.run_id}`
        : run.selected_route_id === null
          ? '等待路线选择。'
          : `已选 ${run.selected_route_id} · ${run.selected_route_risk ?? '未知风险'}`,
    facts: [
      { label: '节点', value: run.current_node_id },
      { label: '阶段', value: run.phase },
      { label: '结果', value: run.outcome },
      { label: '版本', value: String(run.revision) },
      { label: '截止', value: run.choice_deadline_at },
      { label: '配置', value: run.config_version },
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
  return `${choice.label} · ${choice.riskLabel} · ${choice.choiceId}`;
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
