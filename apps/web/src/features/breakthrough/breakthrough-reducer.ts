import type { BreakthroughRun } from '@dongtian/contracts';

export interface BreakthroughPageState {
  readonly runId: string | null;
  readonly status: BreakthroughRun['status'] | null;
  readonly currentNodeId: string | null;
  readonly runVersion: number | null;
  readonly pendingIdempotencyKey: string | null;
  readonly lastError: string | null;
  readonly confirmationOpen: boolean;
}

export type BreakthroughPageAction =
  | {
      readonly type: 'hydrate-run';
      readonly run: Pick<
        BreakthroughRun,
        'breakthrough_run_id' | 'status' | 'current_node_id' | 'run_version'
      >;
    }
  | { readonly type: 'prepare-start'; readonly idempotencyKey: string }
  | { readonly type: 'start-failed'; readonly message: string }
  | { readonly type: 'clear-pending-start' }
  | { readonly type: 'open-confirmation' }
  | { readonly type: 'close-confirmation' }
  | { readonly type: 'clear-error' };

export function createInitialBreakthroughPageState(
  runId: string | null = null,
): BreakthroughPageState {
  return {
    runId,
    status: null,
    currentNodeId: null,
    runVersion: null,
    pendingIdempotencyKey: null,
    lastError: null,
    confirmationOpen: false,
  };
}

export function breakthroughPageReducer(
  state: BreakthroughPageState,
  action: BreakthroughPageAction,
): BreakthroughPageState {
  switch (action.type) {
    case 'hydrate-run':
      return {
        ...state,
        runId: action.run.breakthrough_run_id,
        status: action.run.status,
        currentNodeId: action.run.current_node_id,
        runVersion: action.run.run_version,
        lastError: null,
      };
    case 'prepare-start':
      return {
        ...state,
        pendingIdempotencyKey: action.idempotencyKey,
        lastError: null,
        confirmationOpen: false,
      };
    case 'start-failed':
      return { ...state, lastError: action.message };
    case 'clear-pending-start':
      return { ...state, pendingIdempotencyKey: null, lastError: null };
    case 'open-confirmation':
      return { ...state, confirmationOpen: true };
    case 'close-confirmation':
      return { ...state, confirmationOpen: false };
    case 'clear-error':
      return { ...state, lastError: null };
  }
}

export function createBreakthroughIdempotencyKey(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `breakthrough-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}
