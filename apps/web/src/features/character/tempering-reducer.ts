import type { TemperingAttemptResponse } from '@dongtian/contracts';

import type { EquipmentFilterMode, EquipmentSortMode } from './tempering-adapter.js';

export interface TemperingDraft {
  readonly selectedInstanceId: string | null;
  readonly targetLevel: number;
  readonly useProtectionMaterial: boolean;
  readonly attemptId: string | null;
}

export interface TemperingPageState {
  readonly query: string;
  readonly filterMode: EquipmentFilterMode;
  readonly sortMode: EquipmentSortMode;
  readonly pageIndex: number;
  readonly pageSize: number;
  readonly keptInstanceIds: ReadonlySet<string>;
  readonly draft: TemperingDraft;
  readonly lastResponse: TemperingAttemptResponse | null;
  readonly lastErrorMessage: string | null;
}

export type TemperingPageAction =
  | { readonly type: 'set-query'; readonly query: string }
  | { readonly type: 'set-filter-mode'; readonly filterMode: EquipmentFilterMode }
  | { readonly type: 'set-sort-mode'; readonly sortMode: EquipmentSortMode }
  | { readonly type: 'set-page-index'; readonly pageIndex: number }
  | { readonly type: 'set-page-size'; readonly pageSize: number }
  | { readonly type: 'toggle-keep'; readonly instanceId: string }
  | { readonly type: 'select-instance'; readonly instanceId: string | null }
  | { readonly type: 'set-target-level'; readonly targetLevel: number }
  | { readonly type: 'set-use-protection'; readonly useProtectionMaterial: boolean }
  | { readonly type: 'prepare-attempt'; readonly attemptId: string }
  | { readonly type: 'clear-attempt' }
  | { readonly type: 'mark-response'; readonly response: TemperingAttemptResponse }
  | { readonly type: 'mark-error'; readonly message: string }
  | { readonly type: 'reset-feedback' };

export function createInitialTemperingPageState(): TemperingPageState {
  return {
    query: '',
    filterMode: 'all',
    sortMode: 'recent',
    pageIndex: 0,
    pageSize: 8,
    keptInstanceIds: new Set<string>(),
    draft: {
      selectedInstanceId: null,
      targetLevel: 1,
      useProtectionMaterial: false,
      attemptId: null,
    },
    lastResponse: null,
    lastErrorMessage: null,
  };
}

export function temperingPageReducer(state: TemperingPageState, action: TemperingPageAction): TemperingPageState {
  switch (action.type) {
    case 'set-query':
      return { ...state, query: action.query, pageIndex: 0 };
    case 'set-filter-mode':
      return { ...state, filterMode: action.filterMode, pageIndex: 0 };
    case 'set-sort-mode':
      return { ...state, sortMode: action.sortMode, pageIndex: 0 };
    case 'set-page-index':
      return { ...state, pageIndex: Math.max(0, action.pageIndex) };
    case 'set-page-size':
      return { ...state, pageSize: Math.max(1, action.pageSize), pageIndex: 0 };
    case 'toggle-keep': {
      const next = new Set(state.keptInstanceIds);
      if (next.has(action.instanceId)) {
        next.delete(action.instanceId);
      } else {
        next.add(action.instanceId);
      }
      return { ...state, keptInstanceIds: next };
    }
    case 'select-instance':
      return {
        ...state,
        draft: {
          ...state.draft,
          selectedInstanceId: action.instanceId,
          attemptId: null,
        },
        lastResponse: null,
        lastErrorMessage: null,
      };
    case 'set-target-level':
      return {
        ...state,
        draft: {
          ...state.draft,
          targetLevel: action.targetLevel,
          attemptId: null,
        },
        lastResponse: null,
        lastErrorMessage: null,
      };
    case 'set-use-protection':
      return {
        ...state,
        draft: {
          ...state.draft,
          useProtectionMaterial: action.useProtectionMaterial,
          attemptId: null,
        },
        lastResponse: null,
        lastErrorMessage: null,
      };
    case 'prepare-attempt':
      return {
        ...state,
        draft: {
          ...state.draft,
          attemptId: action.attemptId,
        },
        lastErrorMessage: null,
      };
    case 'clear-attempt':
      return {
        ...state,
        draft: {
          ...state.draft,
          attemptId: null,
        },
      };
    case 'mark-response':
      return {
        ...state,
        lastResponse: action.response,
        lastErrorMessage: null,
        draft: {
          ...state.draft,
          attemptId: action.response.attempt_id,
          selectedInstanceId: action.response.equipment.instance_id,
          targetLevel: action.response.target_level,
        },
      };
    case 'mark-error':
      return { ...state, lastErrorMessage: action.message };
    case 'reset-feedback':
      return { ...state, lastResponse: null, lastErrorMessage: null };
    default:
      return state;
  }
}

export function createTemperingAttemptId(): string {
  return typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `tmp-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}
