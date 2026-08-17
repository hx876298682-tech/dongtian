import { useEffect, useMemo, useReducer, useState, type KeyboardEvent, type ReactElement } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useOutletContext } from 'react-router';

import {
  ApiClientError,
  type AuthActiveSession,
  type CharacterProgression,
  type InventorySnapshot,
  type SkillToolAssignmentToolOption,
  type SkillToolAssignmentView,
  type SkillToolAssignmentsResponse,
} from '@dongtian/contracts';
import { EmptyStateScreen, LoadingStateScreen, LocalErrorStateScreen, LockedStateScreen, MaintenanceStateScreen, NormalStateScreen } from '@dongtian/ui';

import { apiClient } from '../../lib/api.js';
import { describeRealmId, describeRoute, describeSkillId, formatCount, joinRoutePath, routeKey } from '../content/content-adapter.js';
import {
  buildToolAssignmentRouteHref,
  buildToolAssignmentRouteLabel,
  describeToolItemName,
  describeToolTag,
  summarizeToolAssignmentDetail,
  summarizeToolAssignmentSkill,
  summarizeToolAssignmentsError,
  summarizeToolAssignmentsHero,
} from './tool-assignments-adapter.js';
import {
  createInitialToolAssignmentEditorState,
  createToolAssignmentsSaveRequest,
  findToolAssignmentEntry,
  toolAssignmentEditorReducer,
  type ToolAssignmentDraft,
} from './tool-assignments-reducer.js';

const TOOL_QUERY_PREFIX = 'tool-assignments';

function createIdempotencyKey(): string {
  return typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `tmp-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

type ToolNoticeKind = 'success' | 'error' | 'info';

interface ToolNotice {
  readonly kind: ToolNoticeKind;
  readonly title: string;
  readonly description: string;
  readonly footnote?: string;
}

function buildMutationNotice(error: unknown): ToolNotice {
  if (error instanceof ApiClientError) {
    return {
      kind: 'error',
      title: '工具分配暂未完成',
      description: summarizeToolAssignmentsError(error.status, error.code, error.details),
    };
  }

  return {
    kind: 'error',
    title: '写入失败',
    description: '暂时无法保存工具分配，请稍后重试。',
  };
}

function ToolNoticeCard({ notice }: { readonly notice: ToolNotice | null }): ReactElement {
  if (notice === null) {
    return <EmptyStateScreen title="操作反馈" description="保存、切换和刷新后的结果会显示在这里。" />;
  }

  if (notice.kind === 'error') {
    return <LocalErrorStateScreen title={notice.title} description={notice.description} footnote={notice.footnote} />;
  }

  return <NormalStateScreen title={notice.title} description={notice.description} footnote={notice.footnote} highlight={notice.kind === 'success' ? '状态已更新' : '提示'} />;
}

function useToolAssignmentsQueries(characterId: string) {
  const progressionQuery = useQuery<CharacterProgression>({
    queryKey: [TOOL_QUERY_PREFIX, characterId, 'progression'],
    queryFn: () => apiClient.getProgression(characterId),
  });

  const inventoryQuery = useQuery<InventorySnapshot>({
    queryKey: [TOOL_QUERY_PREFIX, characterId, 'inventory'],
    queryFn: () => apiClient.getInventory(characterId),
  });

  const assignmentsQuery = useQuery<SkillToolAssignmentsResponse>({
    queryKey: [TOOL_QUERY_PREFIX, characterId, 'assignments'],
    queryFn: () => apiClient.getSkillToolAssignments(characterId),
  });

  return { progressionQuery, inventoryQuery, assignmentsQuery };
}

export function ToolAssignmentsLoading(): ReactElement {
  return (
    <section className="tool-layout">
      <div className="tool-panel tool-panel--hero">
        <LoadingStateScreen title="正在查看百艺工具" description="正在整理修为、库存和工具分配。" />
      </div>
      <div className="tool-panel">
        <LoadingStateScreen title="技能列表" description="等待工具分配。" />
      </div>
      <div className="tool-panel">
        <LoadingStateScreen title="工具详情" description="等待候选工具。" />
      </div>
      <div className="tool-panel">
        <LoadingStateScreen title="路线与比较" description="等待来源、用途与比较信息。" />
      </div>
    </section>
  );
}

export function ToolAssignmentsError({ onRetry }: { readonly error: string; readonly onRetry: () => void }): ReactElement {
  return (
    <section className="tool-layout">
      <div className="tool-panel tool-panel--hero">
        <LocalErrorStateScreen title="工具页暂时无法打开" description="工具状态暂时无法读取，请稍后重试。" actions={[{ label: '重试', onClick: onRetry }]} />
      </div>
      <div className="tool-panel">
        <EmptyStateScreen title="技能列表" description="读取失败时不展示伪造内容。" />
      </div>
      <div className="tool-panel">
        <EmptyStateScreen title="工具详情" description="读取失败时不展示伪造内容。" />
      </div>
      <div className="tool-panel">
        <EmptyStateScreen title="路线与比较" description="读取失败时不展示伪造内容。" />
      </div>
    </section>
  );
}

export function ToolAssignmentsMaintenance({ onRetry }: { readonly reason: string; readonly onRetry: () => void }): ReactElement {
  return (
    <section className="tool-layout">
      <div className="tool-panel tool-panel--hero">
        <MaintenanceStateScreen title="工具页维护中" description="工具暂时无法读取，请稍后重试。" actions={[{ label: '重试', onClick: onRetry }]} />
      </div>
      <div className="tool-panel">
        <EmptyStateScreen title="技能列表" description="维护期间不展示伪造内容。" />
      </div>
      <div className="tool-panel">
        <EmptyStateScreen title="工具详情" description="维护期间不展示伪造内容。" />
      </div>
      <div className="tool-panel">
        <EmptyStateScreen title="路线与比较" description="维护期间不展示伪造内容。" />
      </div>
    </section>
  );
}

export function ToolAssignmentsLocked({ onRetry }: { readonly reason: string; readonly onRetry: () => void }): ReactElement {
  return (
    <section className="tool-layout">
      <div className="tool-panel tool-panel--hero">
        <LockedStateScreen title="工具功能受限" description="当前暂时无法进入工具页，请稍后重试。" actions={[{ label: '重试', onClick: onRetry }]} />
      </div>
      <div className="tool-panel">
        <EmptyStateScreen title="技能列表" description="当前无法读取工具分配。" />
      </div>
      <div className="tool-panel">
        <EmptyStateScreen title="工具详情" description="当前无法读取工具分配。" />
      </div>
      <div className="tool-panel">
        <EmptyStateScreen title="路线与比较" description="当前无法读取工具分配。" />
      </div>
    </section>
  );
}

export function ToolAssignmentsEmpty({ onOpenEquipment }: { readonly onOpenEquipment: () => void }): ReactElement {
  return (
    <section className="tool-layout">
      <div className="tool-panel tool-panel--hero">
        <EmptyStateScreen
          title="暂无工具分配"
          description="当前还没有工具候选，或尚未安排百艺工具。"
          actions={[{ label: '去装备页', onClick: onOpenEquipment }]}
          footnote="暂未发现可用工具，不展示虚构分配。"
        />
      </div>
      <div className="tool-panel">
        <EmptyStateScreen title="技能列表" description="当前没有工具分配。" />
      </div>
      <div className="tool-panel">
        <EmptyStateScreen title="工具详情" description="当前没有工具分配。" />
      </div>
      <div className="tool-panel">
        <EmptyStateScreen title="路线与比较" description="当前没有工具分配。" />
      </div>
    </section>
  );
}

function ToolPanelHeader({ title, copy }: { readonly title: string; readonly copy: string }): ReactElement {
  return (
    <div className="tool-panel__header">
      <div>
        <p className="page-card__eyebrow">角色 · 工具</p>
        <h3 className="page-card__title">{title}</h3>
      </div>
      <p className="page-card__copy">{copy}</p>
    </div>
  );
}

function RouteLinkList({ routes }: { readonly routes: ReadonlyArray<{ readonly route_type: 'ACTION' | 'RECIPE'; readonly target_id: string; readonly name_key: string; readonly description_key: string | null; readonly source_note: string; }> }): ReactElement | null {
  if (routes.length === 0) {
    return null;
  }

  return (
    <div className="tool-route-list">
      {routes.map((route) => (
        <button key={routeKey(route)} className="chip-button" type="button" onClick={() => window.location.assign(buildToolAssignmentRouteHref(route))}>
          {describeRoute(route)}
        </button>
      ))}
    </div>
  );
}

function ToolAssignmentSkillCard({
  assignment,
  selected,
  selectedOption,
  onSelect,
}: {
  readonly assignment: SkillToolAssignmentView;
  readonly selected: boolean;
  readonly selectedOption: SkillToolAssignmentToolOption | null;
  readonly onSelect: () => void;
}): ReactElement {
  const summary = summarizeToolAssignmentSkill(assignment, selectedOption);
  return (
      <button className={`tool-skill ${selected ? 'tool-skill--selected' : ''}`} type="button" onClick={onSelect} aria-pressed={selected}>
      <span className="tool-skill__row">
        <strong>{summary.label}</strong>
        <span className="equipment-chip">{summary.optionCount} 候选</span>
      </span>
      <span className="tool-skill__copy">{summary.currentLine}</span>
      <span className="tool-skill__copy">当前分配：{summary.assignmentLabel} · 空置 {summary.lockedCount}</span>
      <span className="tool-skill__note">{summary.bestLine}</span>
    </button>
  );
}

function ToolOptionCard({
  option,
  selected,
  onChoose,
}: {
  readonly option: SkillToolAssignmentToolOption;
  readonly selected: boolean;
  readonly onChoose: () => void;
}): ReactElement {
  return (
    <article className={`tool-option ${selected ? 'tool-option--selected' : ''}`}>
      <button className="tool-option__button" type="button" onClick={onChoose} aria-pressed={selected}>
        <span className="tool-option__row">
          <strong>{describeToolItemName(option.item_name_key)}</strong>
          <span className="content-card__status">{describeToolTag(option.tool_tag)}</span>
        </span>
        <span className="tool-option__copy">{option.source_note}</span>
      </button>
      <p className="tool-option__copy">
        {describeRealmId(option.required_realm)} · {option.required_tags.map((tag) => tag === 'tool' ? '工具' : '修行标签').join(' / ') || '无标签'}
      </p>
      <div className="tool-option__meta">
        <span>每小时产能 {option.effective_throughput_per_hour}</span>
        <span>每小时周期 {option.cycles_per_hour}</span>
        <span>速度 {option.speed_multiplier}</span>
        <span>效率 {option.efficiency_multiplier}</span>
      </div>
    </article>
  );
}

function ToolAssignmentDetailCard({
  assignment,
  selectedOption,
  simplifiedMode,
  onChooseOption,
  onClearAssignment,
}: {
  readonly assignment: SkillToolAssignmentView;
  readonly selectedOption: SkillToolAssignmentToolOption | null;
  readonly simplifiedMode: boolean;
  readonly onChooseOption: (option: SkillToolAssignmentToolOption) => void;
  readonly onClearAssignment: () => void;
}): ReactElement {
  const detail = summarizeToolAssignmentDetail(assignment, selectedOption, simplifiedMode);

  return (
    <section className="tool-detail">
      <div className="tool-detail__header">
        <div>
          <p className="page-card__eyebrow">工具详情</p>
          <h3 className="tool-detail__title">{detail.header}</h3>
          <p className="tool-detail__copy">{detail.summary}</p>
        </div>
        <div className="tool-detail__badges">
          {assignment.current !== null ? <span className="content-card__status">当前分配</span> : <span className="content-card__status content-card__status--locked">空置</span>}
          <span className="content-card__status">{simplifiedMode ? '炼气简化' : '筑基展开'}</span>
        </div>
      </div>

      <NormalStateScreen title={describeSkillId(assignment.skill_id)} description={detail.currentSummary} highlight={simplifiedMode ? '简化视图' : '完整视图'} footnote={assignment.current?.source_note ?? '当前没有装备工具。'} />

      <div className="tool-detail__stats">
        {detail.currentStats.length === 0 ? (
          <EmptyStateScreen title="当前工具为空" description="选择候选工具后，这里会显示产能、效率和周期。" />
        ) : (
          detail.currentStats.map((fact) => (
            <div key={fact.label} className="tool-fact">
              <span>{fact.label}</span>
              <strong>{fact.value}</strong>
            </div>
          ))
        )}
      </div>

      <div className="tool-detail__section">
        <h4>候选工具</h4>
        <div className="tool-option-list">
          {assignment.options.map((option) => (
            <ToolOptionCard
              key={option.equipment_instance_id}
              option={option}
              selected={selectedOption?.equipment_instance_id === option.equipment_instance_id}
              onChoose={() => onChooseOption(option)}
            />
          ))}
        </div>
      </div>

      <div className="tool-detail__section">
        <h4>当前与候选的对比</h4>
        {selectedOption === null ? (
          <EmptyStateScreen title="未选中候选" description="从候选列表里选择一个工具查看比较。可用键盘左右键切换。" />
        ) : (
          <NormalStateScreen
            title={describeToolItemName(selectedOption.item_name_key)}
            description={selectedOption.comparison === null ? '当前选项没有额外比较数据。' : `产能差 ${selectedOption.comparison.throughput_delta_per_hour}/小时 · 周期差 ${selectedOption.comparison.cycles_delta_per_hour}/小时`}
            highlight={`${describeRealmId(selectedOption.required_realm)} · ${describeToolTag(selectedOption.tool_tag)}`}
            footnote={`来源 ${selectedOption.source_note}`}
          />
        )}
      </div>

      <div className="tool-detail__section">
        <h4>来源与用途</h4>
        {selectedOption === null ? <p className="tool-detail__copy">先选择候选工具，再查看来源与用途互跳。</p> : null}
        {selectedOption !== null ? (
          <>
            <RouteLinkList routes={selectedOption.source_routes} />
            <RouteLinkList routes={selectedOption.usage_routes} />
            <div className="tool-route-copy">
              <p>{`来源：${selectedOption.source_routes.map(describeRoute).join(' · ') || '无'}`}</p>
              <p>{`用途：${selectedOption.usage_routes.map(describeRoute).join(' · ') || '无'}`}</p>
            </div>
          </>
        ) : null}
      </div>

      <div className="tool-detail__actions">
        <button className="ghost-button" type="button" onClick={onClearAssignment} disabled={assignment.current === null}>
          清空分配
        </button>
      </div>
    </section>
  );
}

function buildToolSelectionState(response: SkillToolAssignmentsResponse, draft: ToolAssignmentDraft | null, selectedSkillId: string | null): { readonly skillId: string | null; readonly selectedOption: SkillToolAssignmentToolOption | null } {
  const skillId = selectedSkillId ?? draft?.selectedSkillId ?? response.assignments[0]?.skill_id ?? null;
  const assignment = skillId === null ? null : response.assignments.find((item) => item.skill_id === skillId) ?? null;
  if (assignment === null) {
    return { skillId: null, selectedOption: null };
  }

  if (draft === null || skillId === null) {
    return { skillId, selectedOption: null };
  }

  const selectedEntry = findToolAssignmentEntry(draft, skillId);
  if (selectedEntry === null || selectedEntry.equipmentInstanceId === null) {
    return { skillId, selectedOption: null };
  }

  const selectedOption = assignment.options.find((option) => option.equipment_instance_id === selectedEntry.equipmentInstanceId) ?? null;

  return { skillId, selectedOption };
}

function keyboardIndex(currentIndex: number, delta: number, total: number): number {
  if (total <= 0) {
    return 0;
  }

  const next = currentIndex + delta;
  if (next < 0) {
    return total - 1;
  }
  if (next >= total) {
    return 0;
  }
  return next;
}

export function CharacterToolAssignmentsPage(): ReactElement {
  const session = useOutletContext<AuthActiveSession>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { progressionQuery, inventoryQuery, assignmentsQuery } = useToolAssignmentsQueries(session.character_id);
  const [editorState, dispatch] = useReducer(toolAssignmentEditorReducer, createInitialToolAssignmentEditorState());
  const [selectedSkillId, setSelectedSkillId] = useState<string | null>(null);
  const [selectedOptionIndex, setSelectedOptionIndex] = useState(0);
  const [notice, setNotice] = useState<ToolNotice | null>(null);

  useEffect(() => {
    if (assignmentsQuery.data !== undefined) {
      dispatch({ type: 'hydrate', response: assignmentsQuery.data });
    }
  }, [assignmentsQuery.data]);

  useEffect(() => {
    setSelectedSkillId(editorState.draft?.selectedSkillId ?? null);
  }, [editorState.draft?.selectedSkillId]);

  const response = assignmentsQuery.data ?? null;
  const progression = progressionQuery.data ?? null;
  const inventory = inventoryQuery.data ?? null;
  const draft = editorState.draft;
  const selection = useMemo(
    () => (response === null ? { skillId: null, selectedOption: null } : buildToolSelectionState(response, draft, selectedSkillId)),
    [draft, response, selectedSkillId],
  );
  const selectedAssignment = useMemo(
    () => (response === null || selection.skillId === null ? null : response.assignments.find((entry) => entry.skill_id === selection.skillId) ?? null),
    [response, selection.skillId],
  );

  useEffect(() => {
    if (selectedAssignment === null) {
      setSelectedOptionIndex(0);
      return;
    }

    const currentOptionIndex = selectedAssignment.current === null
      ? 0
      : selectedAssignment.options.findIndex((option) => option.equipment_instance_id === selectedAssignment.current?.equipment_instance_id);
    setSelectedOptionIndex(currentOptionIndex >= 0 ? currentOptionIndex : 0);
  }, [selectedAssignment]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (editorState.draft === null) {
        throw new Error('NO_DRAFT');
      }
      return apiClient.saveSkillToolAssignments(session.character_id, createToolAssignmentsSaveRequest(editorState.draft), createIdempotencyKey());
    },
    onSuccess: (data) => {
      dispatch({ type: 'mark-saved', response: data });
      setSelectedSkillId(data.assignments[0]?.skill_id ?? null);
      setSelectedOptionIndex(0);
      setNotice({
        kind: 'success',
        title: '工具分配已保存',
        description: data.effective_next_cycle ? '下周期生效。' : '已生效。',
        footnote: data.effective_next_cycle ? '下周期生效，不会伪改当前库存。' : '已生效。',
      });
      void queryClient.invalidateQueries({ queryKey: [TOOL_QUERY_PREFIX, session.character_id] });
    },
    onError: (error: unknown) => {
      if (error instanceof ApiClientError && error.status === 409) {
        dispatch({
          type: 'mark-conflict',
          conflict: {
            expectedStateVersion: editorState.draft?.expectedStateVersion ?? '0',
            actualStateVersion: String((error.details as { readonly actual_state_version?: unknown } | undefined)?.actual_state_version ?? 'unknown'),
          },
        });
      }
      setNotice(buildMutationNotice(error));
    },
  });

  const refreshAll = () => {
    void Promise.all([progressionQuery.refetch(), inventoryQuery.refetch(), assignmentsQuery.refetch()]);
  };

  const goToEquipment = () => {
    navigate('/character');
  };

  const assignSelectedOption = (option: SkillToolAssignmentToolOption | null) => {
    if (selection.skillId === null || option === null) {
      return;
    }

    dispatch({ type: 'set-assignment', skillId: selection.skillId, equipmentInstanceId: option.equipment_instance_id });
  };

  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (response === null) {
      return;
    }

    const skills = response.assignments;
    if (skills.length === 0) {
      return;
    }

    const currentSkillIndex = selection.skillId === null ? 0 : skills.findIndex((entry) => entry.skill_id === selection.skillId);
    const activeSkillIndex = currentSkillIndex >= 0 ? currentSkillIndex : 0;
    const activeSkill = skills[activeSkillIndex] ?? null;
    if (activeSkill === null) {
      return;
    }

    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const nextIndex = keyboardIndex(activeSkillIndex, event.key === 'ArrowDown' ? 1 : -1, skills.length);
      const nextSkill = skills[nextIndex];
      if (nextSkill !== undefined) {
        setSelectedSkillId(nextSkill.skill_id);
        dispatch({ type: 'select-skill', skillId: nextSkill.skill_id });
      }
      return;
    }

    const options = activeSkill.options;
    if (options.length === 0) {
      return;
    }

    if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
      event.preventDefault();
      const delta = event.key === 'ArrowRight' ? 1 : -1;
      setSelectedOptionIndex((index) => keyboardIndex(index, delta, options.length));
      return;
    }

    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      const option = options[selectedOptionIndex] ?? null;
      assignSelectedOption(option);
    }
  };

  if (progressionQuery.isPending || inventoryQuery.isPending || assignmentsQuery.isPending) {
    return <ToolAssignmentsLoading />;
  }

  const firstError = progressionQuery.error ?? inventoryQuery.error ?? assignmentsQuery.error;
  if (firstError !== undefined && firstError !== null) {
    if (firstError instanceof ApiClientError && firstError.status === 503) {
      return <ToolAssignmentsMaintenance reason={firstError.message} onRetry={refreshAll} />;
    }
    if (firstError instanceof ApiClientError && firstError.status === 403) {
      return <ToolAssignmentsLocked reason={firstError.message} onRetry={refreshAll} />;
    }

    return <ToolAssignmentsError error={firstError.message} onRetry={refreshAll} />;
  }

  if (progression === null || inventory === null || response === null) {
    return <ToolAssignmentsLoading />;
  }

  if (response.assignments.length === 0) {
    return <ToolAssignmentsEmpty onOpenEquipment={goToEquipment} />;
  }

  const hero = summarizeToolAssignmentsHero(response, progression.cultivation.realm_stage_id);
  const selectedSkill = selectedAssignment ?? response.assignments[0] ?? null;
  const selectedOption = selectedSkill === null ? null : selectedSkill.options[selectedOptionIndex] ?? selectedSkill.options[0] ?? null;

  return (
    <section className="tool-layout" onKeyDown={onKeyDown} tabIndex={0} aria-label="工具分配页面">
      <div className="tool-panel tool-panel--hero">
        <div className="tool-hero">
          <div>
            <p className="page-card__eyebrow">工具分配</p>
            <h3 className="page-card__title">{hero.title}</h3>
            <p className="page-card__copy">{hero.subtitle}</p>
          </div>
          <div className="dashboard-metrics">
            {hero.facts.map((fact) => (
              <div key={fact.label} className="metric-chip">
                <span className="metric-chip__label">{fact.label}</span>
              <strong className="metric-chip__value" title={fact.value}>
                {fact.value}
              </strong>
              </div>
            ))}
            <div className="metric-chip">
              <span className="metric-chip__label">角色</span>
              <strong className="metric-chip__value" title={progression.character.name}>
                {progression.character.name}
              </strong>
            </div>
            <div className="metric-chip">
              <span className="metric-chip__label">状态</span>
              <strong className="metric-chip__value">已同步</strong>
            </div>
            <div className="metric-chip">
              <span className="metric-chip__label">工具状态</span>
              <strong className="metric-chip__value" title={response.effective_next_cycle ? '下周期生效' : '当前生效'}>
                {response.effective_next_cycle ? '下周期生效' : '当前生效'}
              </strong>
            </div>
          </div>
          <div className="tool-hero__actions">
            <button className="ghost-button" type="button" onClick={refreshAll}>
              刷新状态
            </button>
            <button className="ghost-button" type="button" onClick={goToEquipment}>
              去装备页
            </button>
            <button className="ghost-button" type="button" onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending || editorState.draft === null || !editorState.isDirty}>
              保存分配
            </button>
          </div>
          <p className="tool-hero__note">
            仅展示洞天规则结算的产能、效率、路线和比较，不引入价格或市场。键盘支持上下左右与回车。
          </p>
        </div>
      </div>

      <div className="tool-panel">
        <ToolPanelHeader title="技能列表" copy="采矿、炼器和其他技能按洞天安排展示。选择一项后，中间面板会显示候选工具。" />
        <div className="tool-skill-list">
          {response.assignments.map((assignment) => (
            <ToolAssignmentSkillCard
              key={assignment.skill_id}
              assignment={assignment}
              selected={selectedSkill?.skill_id === assignment.skill_id}
              selectedOption={selectedSkill?.skill_id === assignment.skill_id ? selectedOption : null}
              onSelect={() => {
                dispatch({ type: 'select-skill', skillId: assignment.skill_id });
                setSelectedSkillId(assignment.skill_id);
              }}
            />
          ))}
        </div>
      </div>

      <div className="tool-panel">
        <ToolPanelHeader
          title={selectedSkill === null ? '未选中技能' : describeSkillId(selectedSkill.skill_id)}
          copy={hero.simplifiedMode ? '炼气简化视图，重点显示当前工具与可替代方案。' : '筑基展开视图，展示完整候选、比较和路线细节。'}
        />
        {selectedSkill === null ? (
          <EmptyStateScreen title="未选中技能" description="从左侧选择一个技能查看候选工具。" />
        ) : (
          <ToolAssignmentDetailCard
            assignment={selectedSkill}
            selectedOption={selectedOption}
            simplifiedMode={hero.simplifiedMode}
            onChooseOption={(option) => {
              dispatch({ type: 'set-assignment', skillId: selectedSkill.skill_id, equipmentInstanceId: option.equipment_instance_id });
              const nextIndex = selectedSkill.options.findIndex((item) => item.equipment_instance_id === option.equipment_instance_id);
              setSelectedOptionIndex(nextIndex >= 0 ? nextIndex : 0);
            }}
            onClearAssignment={() => {
              dispatch({ type: 'set-assignment', skillId: selectedSkill.skill_id, equipmentInstanceId: null });
              setSelectedOptionIndex(0);
            }}
          />
        )}
      </div>

      <div className="tool-panel">
        <ToolPanelHeader title="路线与比较" copy="来源和用途都跳回百艺页面，方便核对材料链路。比较只使用洞天规则结算的产能差值。" />
        <div className="tool-inspector">
          <NormalStateScreen
            title="当前库存"
            description={`装备实例 ${formatCount(inventory.equipment_instances.length)} · 物品 ${formatCount(inventory.items.length)} · 货币 ${formatCount(inventory.currencies.length)}`}
            highlight={response.effective_next_cycle ? '下周期生效' : '当前生效'}
            footnote="当前库存与工具安排已同步。"
          />
          <div className="tool-inspector__routes">
            {selectedSkill?.options.map((option) => (
              <article key={option.equipment_instance_id} className="tool-inspector__route-card">
                <strong>{describeToolItemName(option.item_name_key)}</strong>
                <p>{option.comparison === null ? '无比较信息' : `产能差 ${option.comparison.throughput_delta_per_hour}/小时`}</p>
                <div className="tool-route-list">
                  {option.source_routes.map((route) => (
                    <button key={`${option.equipment_instance_id}-${buildToolAssignmentRouteLabel(route)}`} className="chip-button" type="button" onClick={() => navigate(joinRoutePath(route))}>
                      {describeRoute(route)}
                    </button>
                  ))}
                  {option.usage_routes.map((route) => (
                    <button key={`${option.equipment_instance_id}-${buildToolAssignmentRouteLabel(route)}-use`} className="chip-button" type="button" onClick={() => navigate(joinRoutePath(route))}>
                      {describeRoute(route)}
                    </button>
                  ))}
                </div>
              </article>
            ))}
          </div>
          <div className="tool-inspector__footer">
            <ToolNoticeCard notice={notice} />
          </div>
        </div>
      </div>
    </section>
  );
}
