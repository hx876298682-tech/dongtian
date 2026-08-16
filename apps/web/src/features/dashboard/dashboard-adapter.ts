import type {
  CharacterProgression,
  InventorySnapshot,
  LatestSettlementResponse,
  LatestSettlementSummary,
  SettlementJson,
  SettlementLedgerEntry,
  SettlementTimelineEntry,
  Queue,
  QueueEntry,
} from '@dongtian/contracts';

function formatStringValue(value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === '') {
    return '未知';
  }

  return String(value);
}

function describeQueueEntry(entry: QueueEntry): string {
  const targetValue = entry.target_value === null ? '' : ` · 目标 ${entry.target_value}`;
  const progress = ` · 完成 ${entry.completed_cycles} · 累计 ${entry.progress_time_us}µs`;
  const snapshot = entry.snapshot_config_version === null ? '' : ` · 快照 ${entry.snapshot_config_version}`;
  return `${entry.position + 1}. ${entry.action_id} · ${entry.mode}${targetValue} · ${entry.status}${progress}${snapshot}`;
}

export interface OfflineTimelineItem {
  readonly title: string;
  readonly detail: string;
}

export interface OfflineSummaryView {
  readonly kind: 'unavailable';
  readonly title: string;
  readonly description: string;
  readonly timeline: ReadonlyArray<OfflineTimelineItem>;
  readonly footnote: string;
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
  readonly offlineSummary: OfflineSummaryView;
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

function compactJson(value: SettlementJson, limit = 120): string {
  const raw = typeof value === 'string' ? value : JSON.stringify(value);
  if (raw === undefined) {
    return 'null';
  }

  return raw.length > limit ? `${raw.slice(0, limit - 1)}…` : raw;
}

function isNegativeDelta(value: string): boolean {
  return value.startsWith('-') && value !== '-0';
}

function describeTimelineEntry(entry: SettlementTimelineEntry): SettlementLineItem {
  const window = `${entry.from_at} → ${entry.to_at}`;
  const cycles = `周期 ${entry.completed_cycles}`;
  const reason = entry.transition_reason === null ? '无切换原因' : entry.transition_reason;
  const payload = `输入 ${compactJson(entry.inputs)} ｜ 输出 ${compactJson(entry.outputs)} ｜ XP ${compactJson(entry.xp_changes)}`;

  return {
    title: `段 ${entry.segment_index}`,
    detail: `${entry.action_config_id} · ${window} · ${cycles} · ${reason} · ${payload}`,
  };
}

function describeLedgerEntry(entry: SettlementLedgerEntry): SettlementLineItem {
  return {
    title: `${entry.asset_type} ${entry.asset_id}`,
    detail: `${entry.delta} → ${entry.balance_after} · ${entry.reason_code} · ${entry.reference_type}:${entry.reference_id}`,
  };
}

function summarizeSettlementStatus(settlement: LatestSettlementSummary): string {
  const parts = [
    `from ${settlement.from_at}`,
    `effective ${settlement.effective_until}`,
    `capped ${settlement.capped_time_us}µs`,
    settlement.continuation_required ? 'continuation required' : 'continuation complete',
  ];

  return parts.join(' · ');
}

export function buildLatestSettlementView(response: LatestSettlementResponse | null | undefined): LatestSettlementView {
  const settlement = response?.settlement ?? null;
  if (settlement === null) {
    return {
      kind: 'empty',
      title: '暂无最新离线摘要',
      description: '服务端尚未持久化最新结算；这里只显示权威空态，不本地推演，不本地发奖。',
      footnote: '后端返回 settlement: null 时，页面仅提示空态与刷新入口。',
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
  rewards.push({ title: '百艺 XP', detail: `+${settlement.rewards.skill_xp}` });
  for (const item of settlement.rewards.items) {
    rewards.push({ title: item.item_id, detail: `+${item.quantity}` });
  }

  const consumptions = settlement.ledger_entries
    .filter((entry) => isNegativeDelta(entry.delta))
    .map(describeLedgerEntry);

  const anomalies: SettlementLineItem[] = [];
  if (settlement.continuation_required) {
    anomalies.push({ title: '续跑', detail: '当前摘要仍有 continuation_required=true，后续结算继续推进。' });
  }
  if (settlement.capped_time_us !== '0') {
    anomalies.push({ title: '上限截断', detail: `另有 ${settlement.capped_time_us} 微秒被离线结算上限截断。` });
  }
  if (settlement.status !== 'COMPLETED') {
    anomalies.push({ title: '状态', detail: `结算状态为 ${settlement.status}` });
  }
  for (const entry of settlement.timeline) {
    if (entry.transition_reason !== null && entry.transition_reason !== 'ACTION_SWITCH') {
      anomalies.push({ title: `段 ${entry.segment_index}`, detail: entry.transition_reason });
    }
  }

  const facts: SettlementFact[] = [
    { label: '起点', value: settlement.from_at },
    { label: '结算到', value: settlement.effective_until },
    { label: '请求到', value: settlement.requested_until },
    { label: '有效时长', value: settlement.effective_time_us },
    { label: '离线上限', value: settlement.capped_time_us },
    { label: '续跑', value: settlement.continuation_required ? '是' : '否' },
  ];

  return {
    kind: 'ready',
    title: `最新离线摘要 · ${settlement.status}`,
    description: `结算 ${settlement.settlement_id} 已持久化，不会再次触发发奖。${summarizeSettlementStatus(settlement)}`,
    footnote: `as_of ${settlement.as_of} · XP ${settlement.rewards.cultivation_xp} / ${settlement.rewards.skill_xp} · items ${settlement.rewards.items.length}`,
    summaryLine: `${settlement.from_at} → ${settlement.effective_until} · capped ${settlement.capped_time_us}µs · ${settlement.continuation_required ? 'continuation' : 'closed'}`,
    facts,
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
): DashboardAuthoritySnapshot {
  const currentAction = queue.current;
  const timeline: OfflineTimelineItem[] = [];

  if (currentAction === null) {
    timeline.push({
      title: '当前行动',
      detail: '暂无正在运行的权威行动快照。',
    });
  } else {
    timeline.push({
      title: '当前行动',
      detail: `${currentAction.action_id} · ${currentAction.status} · 已完成 ${currentAction.completed_cycles} 周期`,
    });
  }

  for (const entry of queue.entries) {
    timeline.push({
      title: `队列 ${entry.position + 1}`,
      detail: describeQueueEntry(entry),
    });
  }

  return {
    realmLabel: progression.cultivation.realm_stage_id,
    cultivationLabel: `${progression.cultivation.stage_progress_xp} / ${progression.cultivation.stage_required_xp}`,
    currentActionLabel: currentAction === null ? '当前无正在执行的行动' : currentAction.action_id,
    currentActionDetail:
      currentAction === null
        ? `队列版本 ${formatStringValue(queue.queue_version)} · ${queue.entries.length} 段计划 · 保底 ${queue.fallback.action_id}`
        : `${currentAction.action_id} · ${currentAction.status} · 队列版本 ${formatStringValue(queue.queue_version)}`,
    queueLabel: `队列版本 ${formatStringValue(queue.queue_version)} · ${queue.entries.length} 段`,
    queueDetail: `${queue.paused ? '已暂停' : '运行中'} · 保底 ${queue.fallback.action_id}`,
    goalTrackerLabel: progression.feature_permissions.some((permission) => permission.visible)
      ? '目标追踪已接入'
      : '目标追踪待接入',
    goalTrackerDetail: `${progression.character.name} · 修为 ${progression.cultivation.xp} · 总库存 ${inventory.total_count}`,
    inventoryLabel: `库存 ${inventory.total_count} 件`,
    offlineSummary: {
      kind: 'unavailable',
      title: '后端尚未提供离线摘要 GET',
      description: '当前只展示权威队列、修为和库存快照；不会在前端本地推演结算或发奖。',
      timeline,
      footnote: `如果后端补齐 GET /characters/{character_id}/settlements/{settlement_id}，这里可以切换为真实回流摘要。`,
    },
  };
}

export function describeQueuePreviewWarning(warning: Record<string, unknown>): string {
  if (typeof warning['message_key'] === 'string') {
    return warning['message_key'];
  }

  if (typeof warning['message'] === 'string') {
    return warning['message'];
  }

  if (typeof warning['blocked_reason'] === 'string') {
    return warning['blocked_reason'];
  }

  return JSON.stringify(warning);
}

export function describeQueuePreviewEntry(entry: Record<string, unknown>): string {
  const actionId = typeof entry['action_id'] === 'string' ? entry['action_id'] : '未知行动';
  const mode = typeof entry['mode'] === 'string' ? entry['mode'] : 'UNKNOWN';
  const targetValue = entry['target_value'];
  const blockedReason = typeof entry['blocked_reason'] === 'string' ? entry['blocked_reason'] : null;

  const parts = [actionId, mode];
  if (targetValue !== undefined && targetValue !== null && targetValue !== '') {
    parts.push(`目标 ${String(targetValue)}`);
  }
  if (blockedReason !== null) {
    parts.push(blockedReason);
  }

  return parts.join(' · ');
}
