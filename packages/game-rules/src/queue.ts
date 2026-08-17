import { decimal } from './decimal.js';

export const queueModes = ['COUNT', 'DURATION', 'INFINITE'] as const;
export type SupportedQueueMode = (typeof queueModes)[number];
export type QueueMode = SupportedQueueMode | 'UNTIL_INVENTORY';
export type BlockedPolicy = 'SKIP' | 'FALLBACK';
export type QueueInventoryConditionOperator = '<' | '>=';
export type QueueInventoryCondition = {
  readonly itemId: string;
  readonly operator: QueueInventoryConditionOperator;
  readonly targetValue: string;
};
export type QueueBlockedResolution = {
  readonly policy: BlockedPolicy;
  readonly reasonCode: 'INPUT_SHORTAGE';
  readonly currentStatus: 'BLOCKED' | 'DONE_INCOMPLETE';
  readonly nextAction: 'FALLBACK' | 'NEXT_ENTRY';
  readonly releaseCurrentCycleReservation: true;
};
export type QueueBlockedMaterialReason = {
  readonly itemId: string;
  readonly required: string;
  readonly available: string;
  readonly shortfall: string;
};
export type QueueEntryStatus =
  | 'QUEUED'
  | 'RUNNING'
  | 'BLOCKED'
  | 'DONE'
  | 'DONE_INCOMPLETE'
  | 'DONE_CONDITION_MET'
  | 'CANCELLED';

export type QueueEntryDraft = {
  readonly clientEntryId: string;
  readonly actionConfigId: string;
  readonly mode: QueueMode;
  readonly targetValue?: string;
  readonly onBlocked: BlockedPolicy;
};

export type QueuePlan = {
  readonly entries: readonly QueueEntryDraft[];
  readonly fallbackActionId: string;
};

export type NormalizedQueuePlan = {
  readonly entries: readonly (QueueEntryDraft & { readonly position: number })[];
  readonly fallbackActionId: string;
};

export type QueueValidationInput = {
  readonly plan: QueuePlan;
  readonly maxSlots: number;
  readonly availableActionIds: ReadonlySet<string>;
  readonly allowedModesByActionId?: ReadonlyMap<string, ReadonlySet<SupportedQueueMode>>;
};

function fail(reason: string): never {
  throw new Error(`QUEUE_VALIDATION_FAILED:${reason}`);
}

function assertPositiveInteger(value: string, field: string): void {
  if (!/^[1-9]\d*$/.test(value)) {
    fail(`${field}_POSITIVE_INTEGER_REQUIRED`);
  }
}

function assertPositiveDecimal(value: string, field: string): void {
  if (!/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value) || decimal(value).isZero()) {
    fail(`${field}_POSITIVE_REQUIRED`);
  }
}

function validateModeTarget(mode: QueueMode, targetValue: string | undefined): void {
  if (mode === 'INFINITE') {
    if (targetValue !== undefined) {
      fail('INFINITE_TARGET_FORBIDDEN');
    }
    return;
  }
  if (targetValue === undefined) {
    fail(`${mode}_TARGET_REQUIRED`);
  }
  if (mode === 'UNTIL_INVENTORY') {
    assertPositiveInteger(targetValue, 'UNTIL_INVENTORY_TARGET');
    return;
  }
  if (mode === 'COUNT') {
    assertPositiveInteger(targetValue, 'COUNT_TARGET');
  } else {
    assertPositiveDecimal(targetValue, 'DURATION_TARGET');
  }
}

export function validateQueuePlan(input: QueueValidationInput): NormalizedQueuePlan {
  if (!Number.isInteger(input.maxSlots) || input.maxSlots < 1 || input.maxSlots > 3) {
    fail('SLOT_LIMIT_INVALID');
  }
  if (input.plan.entries.length > input.maxSlots) {
    fail('SLOT_LIMIT_EXCEEDED');
  }
  if (input.plan.fallbackActionId.trim().length === 0) {
    fail('FALLBACK_ACTION_REQUIRED');
  }
  if (!input.availableActionIds.has(input.plan.fallbackActionId)) {
    fail('FALLBACK_ACTION_UNAVAILABLE');
  }
  const fallbackModes = input.allowedModesByActionId?.get(input.plan.fallbackActionId);
  if (fallbackModes !== undefined && !fallbackModes.has('INFINITE')) {
    fail('FALLBACK_INFINITE_NOT_ALLOWED');
  }

  const clientEntryIds = new Set<string>();
  const entries = input.plan.entries.map((entry, position) => {
    if (entry.clientEntryId.trim().length === 0) {
      fail('ENTRY_ID_REQUIRED');
    }
    if (clientEntryIds.has(entry.clientEntryId)) {
      fail('ENTRY_ID_DUPLICATE');
    }
    clientEntryIds.add(entry.clientEntryId);
    if (entry.actionConfigId.trim().length === 0 || !input.availableActionIds.has(entry.actionConfigId)) {
      fail(`ACTION_UNAVAILABLE:${entry.actionConfigId}`);
    }
    if (entry.onBlocked !== 'SKIP' && entry.onBlocked !== 'FALLBACK') {
      fail('BLOCKED_POLICY_INVALID');
    }
    const allowedModes = input.allowedModesByActionId?.get(entry.actionConfigId);
    if (allowedModes !== undefined && entry.mode !== 'UNTIL_INVENTORY' && !allowedModes.has(entry.mode)) {
      fail(`MODE_NOT_ALLOWED:${entry.actionConfigId}:${entry.mode}`);
    }
    validateModeTarget(entry.mode, entry.targetValue);
    return { ...entry, position };
  });

  return { entries, fallbackActionId: input.plan.fallbackActionId };
}

export function canTransitionQueueEntryStatus(
  from: QueueEntryStatus,
  to: QueueEntryStatus,
): boolean {
  const transitions: Readonly<Record<QueueEntryStatus, readonly QueueEntryStatus[]>> = {
    QUEUED: ['RUNNING', 'CANCELLED'],
    RUNNING: ['BLOCKED', 'DONE', 'DONE_INCOMPLETE', 'DONE_CONDITION_MET', 'CANCELLED'],
    BLOCKED: ['RUNNING', 'DONE_INCOMPLETE', 'CANCELLED'],
    DONE: [],
    DONE_INCOMPLETE: [],
    DONE_CONDITION_MET: ['RUNNING'],
    CANCELLED: [],
  };
  return transitions[from].includes(to);
}

export function resolveBlockedAction(policy: BlockedPolicy): QueueBlockedResolution {
  if (policy === 'SKIP') {
    return {
      policy,
      reasonCode: 'INPUT_SHORTAGE',
      currentStatus: 'DONE_INCOMPLETE',
      nextAction: 'NEXT_ENTRY',
      releaseCurrentCycleReservation: true,
    };
  }
  return {
    policy,
    reasonCode: 'INPUT_SHORTAGE',
    currentStatus: 'BLOCKED',
    nextAction: 'FALLBACK',
    releaseCurrentCycleReservation: true,
  };
}

export function formatBlockedMaterialReason(input: QueueBlockedMaterialReason): string {
  return `blocked_material:${input.itemId}:required=${input.required}:available=${input.available}:shortfall=${input.shortfall}`;
}

export function isQueueInventoryConditionSatisfied(
  availableQuantity: bigint,
  condition: QueueInventoryCondition,
): boolean {
  const target = BigInt(condition.targetValue);
  return condition.operator === '<'
    ? availableQuantity < target
    : availableQuantity >= target;
}

export type OfficialInventoryQueueTemplateStep = QueueEntryDraft & {
  readonly conditionItemId?: string;
  readonly conditionOperator?: QueueInventoryConditionOperator;
};

export type OfficialInventoryQueueTemplate = {
  readonly id: 'official.inventory.progression';
  readonly title: '采到N→炼到N→无限修炼';
  readonly fallbackActionId: string;
  readonly steps: readonly [
    OfficialInventoryQueueTemplateStep,
    OfficialInventoryQueueTemplateStep,
    QueueEntryDraft,
  ];
};

export function buildOfficialInventoryQueueTemplate(input: {
  readonly harvestActionId: string;
  readonly refineActionId: string;
  readonly cultivateActionId: string;
  readonly harvestItemId: string;
  readonly refineItemId: string;
  readonly harvestTargetValue: string;
  readonly refineTargetValue: string;
}): OfficialInventoryQueueTemplate {
  return {
    id: 'official.inventory.progression',
    title: '采到N→炼到N→无限修炼',
    fallbackActionId: input.cultivateActionId,
    steps: [
      {
        clientEntryId: 'official.harvest_to_n',
        actionConfigId: input.harvestActionId,
        mode: 'UNTIL_INVENTORY',
        targetValue: input.harvestTargetValue,
        onBlocked: 'FALLBACK',
        conditionItemId: input.harvestItemId,
        conditionOperator: '>=',
      },
      {
        clientEntryId: 'official.refine_to_n',
        actionConfigId: input.refineActionId,
        mode: 'UNTIL_INVENTORY',
        targetValue: input.refineTargetValue,
        onBlocked: 'FALLBACK',
        conditionItemId: input.refineItemId,
        conditionOperator: '>=',
      },
      {
        clientEntryId: 'official.cultivate_infinite',
        actionConfigId: input.cultivateActionId,
        mode: 'INFINITE',
        onBlocked: 'FALLBACK',
      },
    ],
  };
}

export function queueReplacementBoundary(input: {
  readonly activeQueueEntryId: string | null;
  readonly requestedPlan: NormalizedQueuePlan;
}): {
  readonly applyImmediately: boolean;
  readonly pendingReplaceAfterCycle: boolean;
} {
  if (input.activeQueueEntryId === null) {
    return { applyImmediately: true, pendingReplaceAfterCycle: false };
  }
  return { applyImmediately: false, pendingReplaceAfterCycle: true };
}
