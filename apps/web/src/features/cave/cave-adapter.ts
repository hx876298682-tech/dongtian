import type { CaveBuildRequest, CaveBuildTaskCostSnapshot, CaveFacility, CaveResponse, InventorySnapshot } from '@dongtian/contracts';

import { describeItemId, describeRealmId, formatCount, formatDurationUs } from '../content/content-adapter.js';

export type CaveFacilityStatusKind = 'LOCKED' | 'READY' | 'BUILDING' | 'COMPLETED' | 'RESOURCE_INSUFFICIENT';

export interface CaveResourceGapView {
  readonly itemId: string;
  readonly required: string;
  readonly owned: string;
  readonly missing: string;
}

export interface CaveFacilityView {
  readonly facilityConfigId: string;
  readonly facilityKind: string;
  readonly facilityLabel: string;
  readonly nameKey: string;
  readonly descriptionKey: string;
  readonly taskStateLabel: string | null;
  readonly level: number;
  readonly levelLabel: string;
  readonly currentModifierLabel: string;
  readonly nextLevelRuleLevel: number | null;
  readonly nextLevelRuleLabel: string;
  readonly nextBuildDuration: string;
  readonly countdown: string;
  readonly buildStatus: CaveFacilityStatusKind;
  readonly buildStatusLabel: string;
  readonly lockedReason: string | null;
  readonly buildTaskId: string | null;
  readonly buildTaskStatus: string | null;
  readonly buildTaskWindow: string | null;
  readonly buildTaskCostSummary: string | null;
  readonly missingResources: ReadonlyArray<CaveResourceGapView>;
  readonly stockSummary: string;
  readonly canBuild: boolean;
}

export interface CavePageView {
  readonly title: string;
  readonly summary: string;
  readonly facts: ReadonlyArray<{ readonly label: string; readonly value: string }>;
  readonly facilities: ReadonlyArray<CaveFacilityView>;
  readonly activeFacility: CaveFacilityView | null;
  readonly activeFacilityState: string;
}

function toFiniteNumber(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined || value === '') {
    return null;
  }

  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function asInventoryQuantity(value: number | string | null | undefined): number {
  const parsed = toFiniteNumber(value);
  return parsed === null ? 0 : parsed;
}

function readInventoryQuantity(inventory: InventorySnapshot, itemId: string): number {
  const stack = [...inventory.items, ...inventory.currencies].find((entry) => entry.asset_id === itemId) ?? null;
  if (stack === null) {
    return 0;
  }

  return asInventoryQuantity(stack.available_quantity ?? stack.quantity);
}

function formatCountdown(targetAt: string | null | undefined, now: Date): string {
  if (typeof targetAt !== 'string' || targetAt.length === 0) {
    return '无';
  }

  const target = new Date(targetAt);
  if (Number.isNaN(target.getTime())) {
    return targetAt;
  }

  const diffMs = target.getTime() - now.getTime();
  if (diffMs <= 0) {
    return '已完成';
  }

  const totalSeconds = Math.floor(diffMs / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
}

function facilityKindLabel(kind: string): string {
  switch (kind) {
    case 'JULING_ROOM':
      return '练功房';
    case 'ALCHEMY_ROOM':
      return '炼丹炉';
    case 'FORGING_ROOM':
      return '锻造炉';
    default:
      return kind;
  }
}

function realmGroupRank(group: string | null | undefined): number {
  switch (group) {
    case 'MORTAL':
      return 0;
    case 'QI':
      return 1;
    case 'FOUNDATION':
      return 2;
    default:
      return -1;
  }
}

function realmGroupLabel(group: string | null | undefined): string {
  switch (group) {
    case 'MORTAL':
      return '凡人境';
    case 'QI':
      return '炼气境';
    case 'FOUNDATION':
      return '筑基境';
    default:
      return '未知境界';
  }
}

function realmStageGroup(realmStageId: string | null | undefined): 'MORTAL' | 'QI' | 'FOUNDATION' | null {
  if (typeof realmStageId !== 'string' || realmStageId.length === 0) {
    return null;
  }

  if (realmStageId.includes('.foundation.')) {
    return 'FOUNDATION';
  }

  if (realmStageId.includes('.qi.')) {
    return 'QI';
  }

  if (realmStageId.includes('.mortal.')) {
    return 'MORTAL';
  }

  return null;
}

function formatModifierLabel(modifier: CaveFacility['current_modifier']): string {
  if (modifier === null) {
    return '无当前加成';
  }

  const statLabel = modifier.stat === 'cultivation_xp'
    ? '修为效率'
    : modifier.stat === 'alchemy_xp'
      ? '炼丹效率'
      : '炼器效率';
  if (modifier.operation === 'MULTIPLY') {
    const multiplier = Number(modifier.value);
    if (Number.isFinite(multiplier)) {
      return `${statLabel} +${Math.round((multiplier - 1) * 100)}%`;
    }
  }
  return `${statLabel} +${modifier.value}`;
}

function summarizeRule(rule: CaveFacility['next_level_rule']): string {
  if (rule === null) {
    return '已达上限';
  }

  const materialCost = rule.material_costs.length === 0 ? '无材料' : rule.material_costs.map((cost) => `${describeItemId(cost.itemId)} × ${formatCount(cost.quantity)}`).join(' · ');
  return `Lv${rule.level} · 灵石 ${formatCount(rule.spirit_stone_cost)} · ${materialCost} · ${formatDurationUs(rule.build_duration_us)}`;
}

function summarizeCostSnapshot(snapshot: CaveBuildTaskCostSnapshot): string {
  const materialCost = snapshot.material_costs.length === 0 ? '无材料' : snapshot.material_costs.map((cost) => `${describeItemId(cost.itemId)} × ${formatCount(cost.quantity)}`).join(' · ');
  return `${facilityKindLabel(snapshot.facility_kind)} · Lv${snapshot.level} · 灵石 ${formatCount(snapshot.spirit_stone_cost)} · ${materialCost} · ${formatDurationUs(snapshot.build_duration_us)}`;
}

function buildMissingResources(
  facility: CaveFacility,
  inventory: InventorySnapshot,
): ReadonlyArray<CaveResourceGapView> {
  const rule = facility.next_level_rule;
  if (rule === null) {
    return [];
  }

  const gaps: CaveResourceGapView[] = [];
  const spiritStoneOwned = readInventoryQuantity(inventory, 'currency.spirit_stone');
  const spiritStoneRequired = asInventoryQuantity(rule.spirit_stone_cost);
  if (spiritStoneOwned < spiritStoneRequired) {
    gaps.push({
      itemId: 'currency.spirit_stone',
      required: formatCount(spiritStoneRequired),
      owned: formatCount(spiritStoneOwned),
      missing: formatCount(spiritStoneRequired - spiritStoneOwned),
    });
  }

  for (const cost of rule.material_costs) {
    const owned = readInventoryQuantity(inventory, cost.itemId);
    const required = asInventoryQuantity(cost.quantity);
    if (owned < required) {
      gaps.push({
        itemId: cost.itemId,
        required: formatCount(required),
        owned: formatCount(owned),
        missing: formatCount(required - owned),
      });
    }
  }

  return gaps;
}

function buildFacilityStatus(
  facility: CaveFacility,
  gaps: ReadonlyArray<CaveResourceGapView>,
  currentRealmGroup: 'MORTAL' | 'QI' | 'FOUNDATION' | null,
): { readonly kind: CaveFacilityStatusKind; readonly label: string } {
  const taskStatus = facility.build_task?.status ?? null;
  if (taskStatus === 'RUNNING') {
    return { kind: 'BUILDING', label: '进行中' };
  }

  if (facility.next_level_rule === null) {
    return { kind: 'LOCKED', label: '锁定' };
  }

  if (currentRealmGroup !== null && realmGroupRank(currentRealmGroup) < realmGroupRank(facility.next_level_rule.required_realm_group)) {
    return { kind: 'LOCKED', label: '境界不足' };
  }

  if (gaps.length > 0) {
    return { kind: 'RESOURCE_INSUFFICIENT', label: '资源不足' };
  }

  return { kind: 'READY', label: '可开建' };
}

export function buildCaveFacilityView(
  facility: CaveFacility,
  inventory: InventorySnapshot,
  currentRealmStageId: string | null,
  now: Date,
): CaveFacilityView {
  const currentRealmGroup = realmStageGroup(currentRealmStageId);
  const missingResources = buildMissingResources(facility, inventory);
  const status = buildFacilityStatus(facility, missingResources, currentRealmGroup);
  const task = facility.build_task;
  const lockedReason =
    facility.next_level_rule === null
      ? '当前已达到该设施上限'
      : currentRealmGroup !== null && realmGroupRank(currentRealmGroup) < realmGroupRank(facility.next_level_rule.required_realm_group)
        ? `当前境界 ${realmGroupLabel(currentRealmGroup)} 低于需求 ${realmGroupLabel(facility.next_level_rule.required_realm_group)}`
        : null;
  const taskStateLabel =
    task === null
      ? null
      : task.status === 'RUNNING'
        ? '进行中'
        : task.status === 'COMPLETED' && facility.next_level_rule !== null
          ? '上次完成，可继续升级'
          : task.status === 'COMPLETED'
            ? '已完成'
            : task.status;

  return {
    facilityConfigId: facility.facility_config_id,
    facilityKind: facility.facility_kind,
    facilityLabel: facilityKindLabel(facility.facility_kind),
    nameKey: facility.name_key,
    descriptionKey: facility.description_key,
    taskStateLabel,
    level: facility.level,
    levelLabel: `Lv${facility.level}`,
    currentModifierLabel: formatModifierLabel(facility.current_modifier),
    nextLevelRuleLevel: facility.next_level_rule?.level ?? null,
    nextLevelRuleLabel: summarizeRule(facility.next_level_rule),
    nextBuildDuration: facility.next_level_rule === null ? '无' : formatDurationUs(facility.next_level_rule.build_duration_us),
    countdown:
      task === null
        ? '无'
        : task.status === 'COMPLETED'
          ? '已完成'
          : formatCountdown(task.projected_completion_at, now),
    buildStatus: status.kind,
    buildStatusLabel: status.label,
    lockedReason,
    buildTaskId: task?.build_task_id ?? null,
    buildTaskStatus: task?.status ?? null,
    buildTaskWindow: task === null ? null : `${task.started_at} → ${task.projected_completion_at}`,
    buildTaskCostSummary: task === null ? null : summarizeCostSnapshot(task.cost_snapshot),
    missingResources,
    stockSummary: `灵石可用 ${formatCount(readInventoryQuantity(inventory, 'currency.spirit_stone'))} · 材料缺口 ${formatCount(missingResources.length)}`,
    canBuild: status.kind === 'READY',
  };
}

export function buildCavePageView(
  response: CaveResponse,
  inventory: InventorySnapshot,
  selectedFacilityId: string | null,
  currentRealmStageId: string | null,
  now: Date,
): CavePageView {
  const facilities = response.cave.facilities.map((facility) => buildCaveFacilityView(facility, inventory, currentRealmStageId, now));
  const activeFacility = selectedFacilityId === null ? facilities[0] ?? null : facilities.find((facility) => facility.facilityConfigId === selectedFacilityId) ?? facilities[0] ?? null;

  return {
    title: '洞府设施',
    summary: `洞府状态已更新 · ${facilities.length} 个设施`,
    facts: [
      { label: '设施数量', value: String(facilities.length) },
      { label: '当前境界', value: describeRealmId(currentRealmStageId) },
    ],
    facilities,
    activeFacility,
    activeFacilityState: activeFacility === null ? '空' : activeFacility.buildStatusLabel,
  };
}

export function buildCaveBuildRequest(response: CaveResponse, facility: CaveFacility): CaveBuildRequest {
  if (facility.next_level_rule === null) {
    throw new Error('CAVE_FACILITY_MAX_LEVEL');
  }

  return {
    facility_id: facility.facility_config_id,
    target_level: facility.next_level_rule.level,
    expected_state_version: response.character.state_version,
    config_version: response.cave.config_version,
  };
}

export function summarizeCaveFacilitySubtitle(view: CaveFacilityView): string {
  return `${view.levelLabel} · ${view.buildStatusLabel} · 下级 ${view.nextLevelRuleLabel}`;
}
