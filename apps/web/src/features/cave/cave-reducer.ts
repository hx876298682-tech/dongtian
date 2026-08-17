import type { CaveResponse } from '@dongtian/contracts';

export interface CavePageState {
  readonly selectedFacilityId: string | null;
  readonly confirmationOpen: boolean;
  readonly pendingIdempotencyKey: string | null;
  readonly lastBuildResponse: CaveResponse | null;
  readonly lastErrorMessage: string | null;
}

export type CavePageAction =
  | { readonly type: 'hydrate'; readonly response: CaveResponse; readonly preferredFacilityId: string | null }
  | { readonly type: 'select-facility'; readonly facilityId: string | null }
  | { readonly type: 'open-confirmation' }
  | { readonly type: 'close-confirmation' }
  | { readonly type: 'prepare-submit'; readonly idempotencyKey: string }
  | { readonly type: 'mark-success'; readonly response: CaveResponse }
  | { readonly type: 'mark-error'; readonly message: string }
  | { readonly type: 'clear-error' };

export function createInitialCavePageState(preferredFacilityId: string | null = null): CavePageState {
  return {
    selectedFacilityId: preferredFacilityId,
    confirmationOpen: false,
    pendingIdempotencyKey: null,
    lastBuildResponse: null,
    lastErrorMessage: null,
  };
}

function resolveSelectedFacilityId(state: CavePageState, response: CaveResponse, preferredFacilityId: string | null): string | null {
  const candidate = state.selectedFacilityId ?? preferredFacilityId;
  if (candidate !== null && response.cave.facilities.some((facility) => facility.facility_config_id === candidate)) {
    return candidate;
  }

  const firstFacility = response.cave.facilities[0];
  return firstFacility === undefined ? null : firstFacility.facility_config_id;
}

export function cavePageReducer(state: CavePageState, action: CavePageAction): CavePageState {
  switch (action.type) {
    case 'hydrate':
      return {
        ...state,
        selectedFacilityId: resolveSelectedFacilityId(state, action.response, action.preferredFacilityId),
      };
    case 'select-facility':
      return {
        ...state,
        selectedFacilityId: action.facilityId,
        confirmationOpen: false,
        lastErrorMessage: null,
      };
    case 'open-confirmation':
      return {
        ...state,
        confirmationOpen: true,
        lastErrorMessage: null,
      };
    case 'close-confirmation':
      return {
        ...state,
        confirmationOpen: false,
      };
    case 'prepare-submit':
      return {
        ...state,
        pendingIdempotencyKey: action.idempotencyKey,
        confirmationOpen: false,
        lastErrorMessage: null,
      };
    case 'mark-success':
      return {
        ...state,
        pendingIdempotencyKey: null,
        confirmationOpen: false,
        lastBuildResponse: action.response,
        lastErrorMessage: null,
        selectedFacilityId: resolveSelectedFacilityId(state, action.response, null),
      };
    case 'mark-error':
      return {
        ...state,
        lastErrorMessage: action.message,
      };
    case 'clear-error':
      return {
        ...state,
        lastErrorMessage: null,
      };
    default:
      return state;
  }
}

export function createCaveIdempotencyKey(): string {
  return typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `tmp-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}
