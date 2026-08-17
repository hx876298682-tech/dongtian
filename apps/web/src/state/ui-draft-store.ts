import { create } from 'zustand';

export type RailSection = 'current-action' | 'settlement-summary' | 'goal-tracker' | 'slot-placeholder';

interface UiDraftState {
  readonly leftRailCollapsed: boolean;
  readonly rightRailPinned: boolean;
  readonly activeRailSection: RailSection;
  readonly currentActionSummary: string;
  readonly settlementSummary: string;
  readonly goalTrackerSummary: string;
  readonly queueDraftTitle: string;
  readonly queueDraftNote: string;
  setLeftRailCollapsed: (collapsed: boolean) => void;
  setRightRailPinned: (pinned: boolean) => void;
  setActiveRailSection: (section: RailSection) => void;
  setShellSummaries: (summaries: { currentActionSummary: string; settlementSummary: string; goalTrackerSummary: string }) => void;
  setQueueDraftTitle: (title: string) => void;
  setQueueDraftNote: (note: string) => void;
  resetDrafts: () => void;
}

const initialState = {
  leftRailCollapsed: false,
  rightRailPinned: true,
  activeRailSection: 'current-action' as RailSection,
  currentActionSummary: '当前无权威行动快照。',
  settlementSummary: '最新离线摘要尚未加载。',
  goalTrackerSummary: '加载目标追踪后显示筑基缺口。',
  queueDraftTitle: '采药 2 小时 → 炼丹 100 次 → 无限修炼',
  queueDraftNote: '仅保存本机计划备注，不承载权威队列或收益。',
};

export const useUiDraftStore = create<UiDraftState>((set) => ({
  ...initialState,
  setLeftRailCollapsed(collapsed) {
    set({ leftRailCollapsed: collapsed });
  },
  setRightRailPinned(pinned) {
    set({ rightRailPinned: pinned });
  },
  setActiveRailSection(section) {
    set({ activeRailSection: section });
  },
  setShellSummaries(summaries) {
    set({
      currentActionSummary: summaries.currentActionSummary,
      settlementSummary: summaries.settlementSummary,
      goalTrackerSummary: summaries.goalTrackerSummary,
    });
  },
  setQueueDraftTitle(title) {
    set({ queueDraftTitle: title });
  },
  setQueueDraftNote(note) {
    set({ queueDraftNote: note });
  },
  resetDrafts() {
    set(initialState);
  },
}));
