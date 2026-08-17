import type {
  ContentRoute,
  SkillToolAssignmentToolOption,
  SkillToolAssignmentView,
  SkillToolAssignmentsResponse,
} from '@dongtian/contracts';

import { describeItemId, describeRealmId, describeRoute, describeSkillId, joinRoutePath, routeKey } from '../content/content-adapter.js';

function toFiniteNumber(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined || value === '') {
    return null;
  }

  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function formatDecimal(value: string | number | null | undefined, digits = 2): string {
  const parsed = toFiniteNumber(value);
  if (parsed === null) {
    return '未知';
  }

  return Number.isInteger(parsed) ? String(parsed) : parsed.toFixed(digits);
}

function formatPercent(value: string | number | null | undefined): string {
  const parsed = toFiniteNumber(value);
  if (parsed === null) {
    return '未知';
  }

  return `${(parsed * 100).toFixed(parsed < 0.1 ? 1 : 0)}%`;
}

function skillLabel(skillId: string): string {
  return skillId === 'skill.mining' ? '采矿' : describeSkillId(skillId);
}

export function describeToolItemName(nameKey: string | null | undefined): string {
  if (nameKey === null || nameKey === undefined || nameKey.length === 0) return '未知工具';
  if (!/^[a-z0-9_.-]+$/.test(nameKey)) return nameKey;
  const itemId = nameKey.replace(/\.name$/, '').replace(/^item\.(?!t\d+\.)/, 'item.t1.');
  const label = describeItemId(itemId);
  return label === '未鉴定物品' ? '未知工具' : label;
}

export function describeToolTag(tag: string | null | undefined): string {
  switch (tag) {
    case 'alchemy_tool':
      return '炼丹炉';
    case 'herbalism_tool':
      return '采药工具';
    case 'mining_tool':
      return '采矿工具';
    default:
      return '修行工具';
  }
}

function summarizeRouteList(routes: ReadonlyArray<ContentRoute>): string {
  if (routes.length === 0) {
    return '无路线';
  }

  return routes.map(describeRoute).join(' · ');
}

export interface ToolAssignmentsHeaderFact {
  readonly label: string;
  readonly value: string;
}

export interface ToolAssignmentsHeroView {
  readonly title: string;
  readonly subtitle: string;
  readonly facts: ReadonlyArray<ToolAssignmentsHeaderFact>;
  readonly simplifiedMode: boolean;
}

export interface ToolAssignmentsSkillSummary {
  readonly skillId: string;
  readonly label: string;
  readonly assignmentLabel: string;
  readonly currentLine: string;
  readonly optionCount: number;
  readonly lockedCount: number;
  readonly bestLine: string;
}

export interface ToolAssignmentOptionView {
  readonly option: SkillToolAssignmentToolOption;
  readonly label: string;
  readonly summary: string;
  readonly comparisonLine: string;
  readonly sourceRoutes: string;
  readonly usageRoutes: string;
}

export interface ToolAssignmentsDetailView {
  readonly header: string;
  readonly summary: string;
  readonly currentSummary: string;
  readonly currentStats: ReadonlyArray<{ readonly label: string; readonly value: string }>;
  readonly options: ReadonlyArray<ToolAssignmentOptionView>;
  readonly simplifiedMode: boolean;
  readonly routeHints: ReadonlyArray<string>;
}

export interface ToolAssignmentsErrorSummary {
  readonly title: string;
  readonly description: string;
  readonly footnote?: string;
}

export function summarizeToolAssignmentsHero(
  response: SkillToolAssignmentsResponse,
  realmStageId: string,
): ToolAssignmentsHeroView {
  const simplifiedMode = realmStageId.startsWith('realm.qi.');
  const currentCount = response.assignments.filter((entry) => entry.current !== null).length;
  const optionCount = response.assignments.reduce((total, entry) => total + entry.options.length, 0);
  return {
    title: '工具分配与产能对比',
    subtitle: simplifiedMode
      ? '炼气期显示简化摘要，突出当前工具与推荐替代。'
      : '筑基及更高境界展开完整比较，包含产能、效率和路线细节。',
    facts: [
      { label: '技能数', value: String(response.assignments.length) },
      { label: '当前分配', value: String(currentCount) },
      { label: '候选工具', value: String(optionCount) },
      { label: '状态', value: '已同步' },
    ],
    simplifiedMode,
  };
}

export function summarizeToolAssignmentSkill(
  assignment: SkillToolAssignmentView,
  selectedOption: SkillToolAssignmentToolOption | null,
): ToolAssignmentsSkillSummary {
  const lockedCount = assignment.options.filter((option) => toFiniteNumber(option.effective_throughput_per_hour) === 0).length;
  return {
    skillId: assignment.skill_id,
    label: skillLabel(assignment.skill_id),
    assignmentLabel: assignment.current === null ? '未分配' : describeToolItemName(assignment.current.item_name_key),
    currentLine: assignment.current === null
      ? '当前没有装备工具'
      : `${describeToolItemName(assignment.current.item_name_key)} · ${describeToolTag(assignment.current.tool_tag)} · ${assignment.current.effective_throughput_per_hour}/小时`,
    optionCount: assignment.options.length,
    lockedCount,
    bestLine: selectedOption === null
      ? '暂无选中候选'
      : `${describeToolItemName(selectedOption.item_name_key)} · ${selectedOption.effective_throughput_per_hour}/小时`,
  };
}

export function summarizeToolAssignmentDetail(
  assignment: SkillToolAssignmentView,
  selectedOption: SkillToolAssignmentToolOption | null,
  simplifiedMode: boolean,
): ToolAssignmentsDetailView {
  const currentSummary = assignment.current === null
    ? '当前分配为空'
    : `${describeToolItemName(assignment.current.item_name_key)} · ${describeToolTag(assignment.current.tool_tag)} · ${assignment.current.effective_throughput_per_hour}/小时`;
  const currentStats = assignment.current === null
    ? []
    : [
        { label: '工具类型', value: describeToolTag(assignment.current.tool_tag) },
        { label: '速度倍率', value: formatPercent(assignment.current.speed_multiplier) },
        { label: '效率倍率', value: formatPercent(assignment.current.efficiency_multiplier) },
        { label: '每小时周期', value: `${formatDecimal(assignment.current.cycles_per_hour)} 次` },
        { label: '每小时产能', value: `${formatDecimal(assignment.current.effective_throughput_per_hour)} 单位` },
      ];

  const options = assignment.options.map((option) => ({
    option,
    label: describeToolItemName(option.item_name_key),
    summary: `${describeToolTag(option.tool_tag)} · ${option.effective_throughput_per_hour}/小时 · ${option.source_note}`,
    comparisonLine:
      option.comparison === null
        ? '当前选项为基准或缺少比较值'
        : `相对首选工具 · 产能差 ${option.comparison.throughput_delta_per_hour}/小时 · 周期差 ${option.comparison.cycles_delta_per_hour}/小时`,
    sourceRoutes: summarizeRouteList(option.source_routes),
    usageRoutes: summarizeRouteList(option.usage_routes),
  }));

  const routeHints = options.flatMap((option) => option.option.source_routes.map(describeRoute).concat(option.option.usage_routes.map(describeRoute)));

  return {
    header: selectedOption === null ? skillLabel(assignment.skill_id) : `${skillLabel(assignment.skill_id)} · ${describeToolItemName(selectedOption.item_name_key)}`,
    summary: selectedOption === null
      ? '从左侧选择工具，或者使用键盘在候选项之间切换。'
      : `${describeRealmId(selectedOption.required_realm)} · ${selectedOption.source_note} · ${selectedOption.effective_throughput_per_hour}/小时`,
    currentSummary,
    currentStats,
    options,
    simplifiedMode,
    routeHints,
  };
}

export function summarizeToolAssignmentsError(status: number, _code: string | undefined, _details: unknown): string {
  if (status === 404) {
    return '当前角色没有可读取的工具分配，或者角色不存在。';
  }

  if (status === 403) {
    return '当前会话已认证，但没有读取或保存工具分配的权限。';
  }

  if (status === 409) {
    return '当前状态已变化，请刷新后重试。';
  }

  if (status === 422) {
    return '当前工具分配未能生效，请稍后重试。';
  }

  if (status === 400) {
    return '请求参数不合法。';
  }

  return status >= 500 ? '暂时无法读取工具状态，请稍后重试。' : '工具分配暂时未完成，请检查条件后重试。';
}

export function buildToolAssignmentRouteHref(route: ContentRoute): string {
  return joinRoutePath(route);
}

export function buildToolAssignmentRouteLabel(route: ContentRoute): string {
  return routeKey(route);
}
