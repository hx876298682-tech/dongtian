import { describe, expect, it } from 'vitest';

import {
  canTransitionQueueEntryStatus,
  buildOfficialInventoryQueueTemplate,
  isQueueInventoryConditionSatisfied,
  queueReplacementBoundary,
  resolveBlockedAction,
  type SupportedQueueMode,
  validateQueuePlan,
} from './queue.js';

const actions = new Set(['action.t1.herb_baicao_valley', 'action.cultivation.qi']);
const allowedModes = new Map([
  ['action.t1.herb_baicao_valley', new Set<SupportedQueueMode>(['COUNT', 'DURATION', 'INFINITE'])],
  ['action.cultivation.qi', new Set<SupportedQueueMode>(['DURATION', 'INFINITE'])],
]);

describe('queue rules', () => {
  it('releases the current cycle reservation for both blocked policies', () => {
    expect(resolveBlockedAction('SKIP')).toEqual({
      policy: 'SKIP',
      reasonCode: 'INPUT_SHORTAGE',
      currentStatus: 'DONE_INCOMPLETE',
      nextAction: 'NEXT_ENTRY',
      releaseCurrentCycleReservation: true,
    });
    expect(resolveBlockedAction('FALLBACK')).toEqual({
      policy: 'FALLBACK',
      reasonCode: 'INPUT_SHORTAGE',
      currentStatus: 'BLOCKED',
      nextAction: 'FALLBACK',
      releaseCurrentCycleReservation: true,
    });
  });
  it('validates one/two-slot plans, targets, fallback, and normalizes positions', () => {
    expect(validateQueuePlan({
      maxSlots: 2,
      availableActionIds: actions,
      plan: {
        fallbackActionId: 'action.cultivation.qi',
        entries: [{
          clientEntryId: 'tmp-1',
          actionConfigId: 'action.t1.herb_baicao_valley',
          mode: 'COUNT',
          targetValue: '20',
          onBlocked: 'FALLBACK',
        }],
      },
      allowedModesByActionId: allowedModes,
    })).toMatchObject({ entries: [{ position: 0, mode: 'COUNT' }] });
    expect(validateQueuePlan({
      maxSlots: 2,
      availableActionIds: actions,
      allowedModesByActionId: allowedModes,
      plan: {
        fallbackActionId: 'action.cultivation.qi',
        entries: [{
          clientEntryId: 'tmp-1',
          actionConfigId: 'action.t1.herb_baicao_valley',
          mode: 'DURATION',
          targetValue: '7200',
          onBlocked: 'SKIP',
        }, {
          clientEntryId: 'tmp-2',
          actionConfigId: 'action.cultivation.qi',
          mode: 'INFINITE',
          onBlocked: 'FALLBACK',
        }],
      },
    }).entries.map((entry) => entry.position)).toEqual([0, 1]);
  });

  it('rejects unsupported modes and duplicate client entry identifiers', () => {
    expect(() => validateQueuePlan({
      maxSlots: 1,
      availableActionIds: actions,
      allowedModesByActionId: allowedModes,
      plan: {
        fallbackActionId: 'action.cultivation.qi',
        entries: [{
          clientEntryId: 'tmp-1',
          actionConfigId: 'action.cultivation.qi',
          mode: 'COUNT',
          targetValue: '2',
          onBlocked: 'FALLBACK',
        }],
      },
    })).toThrow('MODE_NOT_ALLOWED:action.cultivation.qi:COUNT');
    expect(() => validateQueuePlan({
      maxSlots: 2,
      availableActionIds: actions,
      allowedModesByActionId: allowedModes,
      plan: {
        fallbackActionId: 'action.cultivation.qi',
        entries: [{
          clientEntryId: 'tmp-1', actionConfigId: 'action.t1.herb_baicao_valley', mode: 'COUNT', targetValue: '2', onBlocked: 'SKIP',
        }, {
          clientEntryId: 'tmp-1', actionConfigId: 'action.t1.herb_baicao_valley', mode: 'INFINITE', onBlocked: 'SKIP',
        }],
      },
    })).toThrow('ENTRY_ID_DUPLICATE');
  });

  it('requires the fallback action to support infinite execution', () => {
    expect(() => validateQueuePlan({
      maxSlots: 1,
      availableActionIds: actions,
      allowedModesByActionId: new Map([
        ['action.cultivation.qi', new Set<SupportedQueueMode>(['COUNT'])],
      ]),
      plan: {
        fallbackActionId: 'action.cultivation.qi',
        entries: [],
      },
    })).toThrow('FALLBACK_INFINITE_NOT_ALLOWED');
  });

  it('accepts UNTIL_INVENTORY targets and still rejects invalid count and slot limits', () => {
    expect(() => validateQueuePlan({
      maxSlots: 1,
      availableActionIds: actions,
      plan: {
        fallbackActionId: 'action.cultivation.qi',
        entries: [{
          clientEntryId: 'tmp-1',
          actionConfigId: 'action.t1.herb_baicao_valley',
          mode: 'UNTIL_INVENTORY',
          targetValue: '20',
          onBlocked: 'FALLBACK',
        }],
      },
    })).not.toThrow();
    expect(() => validateQueuePlan({
      maxSlots: 1,
      availableActionIds: actions,
      plan: {
        fallbackActionId: 'action.cultivation.qi',
        entries: [{
          clientEntryId: 'tmp-1',
          actionConfigId: 'action.t1.herb_baicao_valley',
          mode: 'COUNT',
          targetValue: '0',
          onBlocked: 'FALLBACK',
        }],
      },
    })).toThrow('COUNT_TARGET_POSITIVE_INTEGER_REQUIRED');
    expect(() => validateQueuePlan({
      maxSlots: 1,
      availableActionIds: actions,
      plan: {
        fallbackActionId: 'action.cultivation.qi',
        entries: [{
          clientEntryId: 'tmp-1',
          actionConfigId: 'action.t1.herb_baicao_valley',
          mode: 'UNTIL_INVENTORY',
          targetValue: '0',
          onBlocked: 'FALLBACK',
        }],
      },
    })).toThrow('UNTIL_INVENTORY_TARGET_POSITIVE_INTEGER_REQUIRED');
    expect(() => validateQueuePlan({
      maxSlots: 1,
      availableActionIds: actions,
      plan: {
        fallbackActionId: 'action.cultivation.qi',
        entries: [{
          clientEntryId: 'tmp-1', actionConfigId: 'action.cultivation.qi', mode: 'INFINITE', onBlocked: 'FALLBACK',
        }, {
          clientEntryId: 'tmp-2', actionConfigId: 'action.cultivation.qi', mode: 'INFINITE', onBlocked: 'FALLBACK',
        }],
      },
    })).toThrow('SLOT_LIMIT_EXCEEDED');
  });

  it('evaluates inventory conditions and exposes the official progression template', () => {
    expect(isQueueInventoryConditionSatisfied(10n, {
      itemId: 'item.t1.qingling_herb',
      operator: '>=',
      targetValue: '10',
    })).toBe(true);
    expect(isQueueInventoryConditionSatisfied(9n, {
      itemId: 'item.t1.qingling_herb',
      operator: '>=',
      targetValue: '10',
    })).toBe(false);
    expect(isQueueInventoryConditionSatisfied(3n, {
      itemId: 'item.t1.qingling_herb',
      operator: '<',
      targetValue: '10',
    })).toBe(true);
    expect(buildOfficialInventoryQueueTemplate({
      harvestActionId: 'action.t1.herb_baicao_valley',
      refineActionId: 'action.t1.qi_gathering_pill',
      cultivateActionId: 'action.cultivation.qi',
      harvestItemId: 'item.t1.qingling_herb',
      refineItemId: 'item.t1.qi_gathering_pill',
      harvestTargetValue: '20',
      refineTargetValue: '10',
    })).toMatchObject({
      id: 'official.inventory.progression',
      title: '采到N→炼到N→无限修炼',
      fallbackActionId: 'action.cultivation.qi',
      steps: [
        {
          actionConfigId: 'action.t1.herb_baicao_valley',
          mode: 'UNTIL_INVENTORY',
          conditionOperator: '>=',
          conditionItemId: 'item.t1.qingling_herb',
        },
        {
          actionConfigId: 'action.t1.qi_gathering_pill',
          mode: 'UNTIL_INVENTORY',
          conditionOperator: '>=',
          conditionItemId: 'item.t1.qi_gathering_pill',
        },
        {
          actionConfigId: 'action.cultivation.qi',
          mode: 'INFINITE',
        },
      ],
    });
  });

  it('restricts lifecycle transitions and defers replacement while a cycle is active', () => {
    expect(canTransitionQueueEntryStatus('QUEUED', 'RUNNING')).toBe(true);
    expect(canTransitionQueueEntryStatus('DONE', 'RUNNING')).toBe(false);
    expect(queueReplacementBoundary({
      activeQueueEntryId: 'entry-1',
      requestedPlan: { fallbackActionId: 'action.cultivation.qi', entries: [] },
    })).toEqual({ applyImmediately: false, pendingReplaceAfterCycle: true });
  });
});
