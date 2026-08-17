import type {
  BreakthroughPreviewResponse,
  CharacterProgression,
  InventorySnapshot,
  LatestSettlementResponse,
  SettlementLedgerEntry,
  SettlementTimelineEntry,
  Queue,
  QueuePreview,
} from '@dongtian/contracts';

const ACTION_LABELS: Record<string, string> = {
  'action.cultivation.qi': '采气修炼',
  'action.t1.herb_baicao_valley': '百草谷采药',
  'action.t1.herb_wuyin_slope': '雾隐坡采花',
  'action.t1.qi_gathering_pill': '炼制聚气丹',
  'action.t1.qi_gathering_powder': '炼制聚气散',
  'action.t1.ore_chitong_kuang': '赤铜矿采矿',
};

const ITEM_LABELS: Record<string, string> = {
  'item.t1.qingling_herb': '青灵草',
  'item.t1.ninglu_hua': '凝露花',
};

const ACTION_CYCLE_MS: Record<string, number> = {
  'action.cultivation.qi': 100_000,
  'action.t1.herb_baicao_valley': 140_000,
  'action.t1.qi_gathering_pill': 100_000,
  'action.t1.qi_gathering_powder': 100_000,
};

export function describeAction(actionId: string | null | undefined): string {
  if (actionId === null || actionId === undefined || actionId === '') {
    return '暂无行动';
  }

  return ACTION_LABELS[actionId] ?? actionId.replace(/^action\.(?:t1\.)?/, '').replaceAll('_', ' ');
}

export function describeItem(itemId: string | null | undefined): string {
  if (itemId === null || itemId === undefined || itemId === '') {
    return '未知物品';
  }

  return ITEM_LABELS[itemId] ?? itemId.replace(/^item\.(?:t1\.)?/, '').replaceAll('_', ' ');
}

function describeTransitionReason(reason: string | null): string {
  if (reason === null) {
    return '任务完成';
  }

  return {
    ACTION_SWITCH: '自动切换下一项',
    BLOCKED_MATERIAL: '材料不足，已切换任务',
  }[reason] ?? '任务状态发生变化';
}

export interface OfflineTimelineItem {
  readonly title: string;
  readonly detail: string;
}

export interface OfflineSummaryView {
  readonly kind: 'empty' | 'ready';
  readonly title: string;
  readonly description: string;
  readonly timeline: ReadonlyArray<OfflineTimelineItem>;
  readonly footnote: string;
  readonly rewards: ReadonlyArray<SettlementLineItem>;
  readonly consumptions: ReadonlyArray<SettlementLineItem>;
  readonly anomalies: ReadonlyArray<SettlementLineItem>;
}

export interface DashboardAuthoritySnapshot {
  readonly realmLabel: string;
  readonly cultivationLabel: string;
  readonly currentActionLabel: string;
  readonly currentActionDetail: string;
  readonly queueLabel: string;
  readonly queueDetail: string;
  readonly goalTrackerLabel: string;
  readonly goalTrackerDetail: string;
  readonly inventoryLabel: string;
  readonly currentActionProgress: number;
  readonly currentActionRemaining: string;
  readonly offlineSummary: OfflineSummaryView;
}

function formatRemaining(milliseconds: number): string {
  const seconds = Math.max(1, Math.ceil(milliseconds / 1000));
  if (seconds < 60) return `${seconds} 秒`;
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return remainder === 0 ? `${minutes} 分钟` : `${minutes} 分 ${remainder} 秒`;
}

export interface IdleProgressView {
  readonly actionLabel: string;
  readonly progress: number;
  readonly remaining: string;
  readonly completedCycles: string;
  readonly paused: boolean;
}

export function buildIdleProgressView(queue: Queue, nowMs = Date.now()): IdleProgressView | null {
  const action = queue.current ?? queue.entries[0] ?? null;
  if (action === null) return null;

  const cycleMs = ACTION_CYCLE_MS[action.action_id] ?? 100_000;
  const serverAsOfMs = Date.parse(queue.as_of);
  const serverProgressMs = Number(action.progress_time_us ?? '0') / 1000;
  const liveProgressMs = queue.paused || !Number.isFinite(serverAsOfMs)
    ? serverProgressMs
    : serverProgressMs + Math.max(0, nowMs - serverAsOfMs);
  const cycleProgress = liveProgressMs % cycleMs;

  return {
    actionLabel: describeAction(action.action_id),
    progress: Math.min(0.99, cycleProgress / cycleMs),
    remaining: `本轮还需 ${formatRemaining(cycleMs - cycleProgress)}`,
    completedCycles: action.completed_cycles,
    paused: queue.paused,
  };
}

export interface SettlementFact {
  readonly label: string;
  readonly value: string;
}

export interface SettlementLineItem {
  readonly title: string;
  readonly detail: string;
}

export interface LatestSettlementView {
  readonly kind: 'empty' | 'ready';
  readonly title: string;
  readonly description: string;
  readonly footnote: string;
  readonly summaryLine: string;
  readonly facts: ReadonlyArray<SettlementFact>;
  readonly timeline: ReadonlyArray<SettlementLineItem>;
  readonly rewards: ReadonlyArray<SettlementLineItem>;
  readonly consumptions: ReadonlyArray<SettlementLineItem>;
  readonly anomalies: ReadonlyArray<SettlementLineItem>;
}

function isNegativeDelta(value: string): boolean {
  return value.startsWith('-') && value !== '-0';
}

function describeTimelineEntry(entry: SettlementTimelineEntry): SettlementLineItem {
  const cycles = `${entry.completed_cycles} 轮`;
  const reason = describeTransitionReason(entry.transition_reason);

  return {
    title: describeAction(entry.action_config_id),
    detail: `完成 ${cycles} · ${reason}`,
  };
}

function describeLedgerEntry(entry: SettlementLedgerEntry): SettlementLineItem {
  return {
    title: describeItem(entry.asset_id),
    detail: `${entry.delta} · 当前拥有 ${entry.balance_after}`,
  };
}

export function buildLatestSettlementView(response: LatestSettlementResponse | null | undefined): LatestSettlementView {
  const settlement = response?.settlement ?? null;
  if (settlement === null) {
    return {
      kind: 'empty',
      title: '暂无最新离线摘要',
      description: '完成一次挂机后，离线收益会在这里出现。',
      footnote: '回来时记得领取你的修为和物品。',
      summaryLine: '最新离线摘要为空',
      facts: [],
      timeline: [],
      rewards: [],
      consumptions: [],
      anomalies: [],
    };
  }

  const rewards: SettlementLineItem[] = [];
  rewards.push({ title: '修为', detail: `+${settlement.rewards.cultivation_xp}` });
  rewards.push({ title: '百艺经验', detail: `+${settlement.rewards.skill_xp}` });
  for (const item of settlement.rewards.items) {
    rewards.push({ title: describeItem(item.item_id), detail: `+${item.quantity}` });
  }

  const consumptions = settlement.ledger_entries
    .filter((entry) => isNegativeDelta(entry.delta))
    .map(describeLedgerEntry);

  const anomalies: SettlementLineItem[] = [];
  if (settlement.continuation_required) {
    anomalies.push({ title: '续跑', detail: '当前摘要仍有 continuation_required=true，后续结算继续推进。' });
  }
  if (settlement.capped_time_us !== '0') {
    anomalies.push({ title: '上限截断', detail: `另有 ${formatDurationMicroseconds(settlement.capped_time_us)} 未计入本次收获。` });
  }
  if (settlement.status !== 'COMPLETED') {
    anomalies.push({ title: '状态', detail: `结算状态为 ${settlement.status}` });
  }
  for (const entry of settlement.timeline) {
    if (entry.transition_reason !== null && entry.transition_reason !== 'ACTION_SWITCH') {
      anomalies.push({ title: describeAction(entry.action_config_id), detail: describeTransitionReason(entry.transition_reason) });
    }
  }

  return {
    kind: 'ready',
    title: '离线收获',
    description: `这段时间共获得修为 ${settlement.rewards.cultivation_xp} 点，物品 ${settlement.rewards.items.length} 种。`,
    footnote: settlement.continuation_required ? '还有未完成的挂机计划，回来后会继续结算。' : '挂机收益已经结算到你的洞天。',
    summaryLine: `获得修为 ${settlement.rewards.cultivation_xp} · ${settlement.rewards.items.length} 种物品`,
    facts: [],
    timeline: settlement.timeline.map(describeTimelineEntry),
    rewards,
    consumptions,
    anomalies,
  };
}

export function buildDashboardAuthoritySnapshot(
  progression: CharacterProgression,
  queue: Queue,
  inventory: InventorySnapshot,
  latestSettlement?: LatestSettlementResponse | null,
  breakthrough?: BreakthroughPreviewResponse | null,
  nowMs = Date.now(),
): DashboardAuthoritySnapshot {
  const currentAction = queue.current ?? queue.entries[0] ?? null;
  const cycleMs = currentAction === null ? 100_000 : ACTION_CYCLE_MS[currentAction.action_id] ?? 100_000;
  const serverAsOfMs = Date.parse(queue.as_of);
  const serverProgressMs = Number(currentAction?.progress_time_us ?? '0') / 1000;
  const liveProgressMs = currentAction === null || queue.paused || !Number.isFinite(serverAsOfMs)
    ? serverProgressMs
    : serverProgressMs + Math.max(0, nowMs - serverAsOfMs);
  const currentActionProgress = currentAction === null ? 0 : Math.min(0.99, (liveProgressMs % cycleMs) / cycleMs);
  const settlementView = buildLatestSettlementView(latestSettlement);

  return {
    realmLabel: progression.cultivation.realm_stage_id,
    cultivationLabel: `${progression.cultivation.stage_progress_xp} / ${progression.cultivation.stage_required_xp}`,
    currentActionLabel: currentAction === null ? '尚未开始挂机' : describeAction(currentAction.action_id),
    currentActionDetail:
      currentAction === null
        ? queue.entries.length === 0 ? '选择一项任务即可开始积累修为。' : `已安排 ${queue.entries.length} 项挂机任务。`
        : `${queue.paused ? '挂机已暂停' : '正在挂机'} · ${describeAction(currentAction.action_id)}`,
    queueLabel: queue.paused ? '挂机已暂停' : queue.entries.length > 0 ? '挂机进行中' : '等待开始',
    queueDetail: `${queue.entries.length} 项任务 · 结束后自动继续下一项`,
    goalTrackerLabel: breakthrough === null ? '目标追踪暂不可用' : '筑基目标追踪',
    goalTrackerDetail:
      breakthrough?.breakthrough === undefined
        ? `${progression.character.name} · 当前修为 ${progression.cultivation.xp} · 洞天物资 ${inventory.total_count} 件`
        : `${breakthrough.breakthrough.requirements.filter((requirement) => requirement.status === 'SATISFIED').length}/${breakthrough.breakthrough.requirements.length} 项条件满足 · ${breakthrough.breakthrough.all_satisfied ? '可以开始筑基' : '仍有资源缺口'}`,
    inventoryLabel: `库存 ${inventory.total_count} 件`,
    currentActionProgress,
    currentActionRemaining: currentAction === null ? '等待开始' : `本轮还需 ${formatRemaining(cycleMs - (liveProgressMs % cycleMs))}`,
    offlineSummary: settlementView,
  };
}

export function describeQueuePreviewWarning(warning: Record<string, unknown>): string {
  if (typeof warning['message_key'] === 'string') {
    return {
      'error.queue_version_conflict': '挂机计划刚刚发生变化，请重新预览。',
      'error.validation_error': '计划中有一项需要调整。',
      'error.resource_not_found': '有一项任务或材料暂时不可用。',
      'error.feature_locked': '该任务尚未解锁。',
      'error.csrf_validation_failed': '操作已过期，请重新预览。',
      'error.idempotency_key_reused': '操作已完成，请刷新后再试。',
      'error.idempotency_in_progress': '操作正在处理中，请稍候。',
    }[warning['message_key']] ?? '这项计划暂时无法安排。';
  }

  if (typeof warning['message'] === 'string') {
    return warning['message'];
  }

  if (typeof warning['blocked_reason'] === 'string') {
    return warning['blocked_reason'] === 'BLOCKED_MATERIAL' ? '材料不足，暂时无法执行。' : '这项任务暂时无法执行。';
  }

  return '这项计划暂时无法安排。';
}

function formatDurationMicroseconds(value: unknown): string {
  const microseconds = Number(value);
  if (!Number.isFinite(microseconds)) return '未知时长';
  const seconds = microseconds / 1_000_000;
  if (seconds >= 3600) return `${Number((seconds / 3600).toFixed(1))} 小时`;
  if (seconds >= 60) return `${Number((seconds / 60).toFixed(1))} 分钟`;
  return `${Number(seconds.toFixed(seconds < 1 ? 3 : 1))} 秒`;
}

export function describeQueuePreviewSummary(preview: Pick<QueuePreview, 'total_duration_us' | 'entries'>): string {
  return `总时长 ${formatDurationMicroseconds(preview.total_duration_us)} · ${preview.entries.length} 段`;
}

export function describeQueuePreviewEntry(entry: Record<string, unknown>): string {
  const actionId = describeAction(typeof entry['action_id'] === 'string' ? entry['action_id'] : null);
  const targetValue = entry['target_value'];
  const blockedReason = typeof entry['blocked_reason'] === 'string' ? entry['blocked_reason'] : null;

  const parts = [actionId];
  if (targetValue !== undefined && targetValue !== null && targetValue !== '') {
    const mode = entry['mode'];
    parts.push(mode === 'DURATION' ? `持续 ${String(targetValue)} 秒` : mode === 'COUNT' ? `目标 ${String(targetValue)} 次` : `目标 ${String(targetValue)}`);
  }
  if (blockedReason !== null) {
    parts.push(`暂时无法执行：${blockedReason === 'BLOCKED_MATERIAL' ? '材料不足' : '当前条件不满足'}`);
  }

  return parts.join(' · ');
}
