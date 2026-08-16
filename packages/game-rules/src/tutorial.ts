import Decimal from 'decimal.js';

export type TutorialId =
  | 'tutorial.t1.first_cultivation'
  | 'tutorial.t1.first_herb'
  | 'tutorial.t1.save_queue'
  | 'tutorial.t1.offline_return'
  | 'tutorial.t1.first_alchemy'
  | 'tutorial.t1.use_pill'
  | 'tutorial.t1.equipment_preset'
  | 'tutorial.t1.qingshe_cave_enter'
  | 'tutorial.t1.qingshe_cave_complete';

export type FoundationGoalId = 'goal.t1.foundation_breakthrough';

export type TutorialResolutionMode = 'COMPLETE' | 'SKIP';
export type TutorialStatus = 'LOCKED' | 'READY' | 'COMPLETED' | 'SKIPPED';
export type GoalStatus = 'LOCKED' | 'TRACKING' | 'READY';
export type TutorialGateStatus = 'SATISFIED' | 'MISSING';

export type TutorialCompletionIntent = {
  readonly intentId: string;
  readonly tutorialId: TutorialId;
  readonly mode: TutorialResolutionMode;
};

export type TutorialAssetBalance = {
  readonly total: string;
  readonly reserved: string;
};

export type TutorialQueueSnapshot = {
  readonly savedQueueVersion: string | null;
  readonly slotCount: number;
  readonly savedAtUs: string | null;
};

export type TutorialOfflineSummarySnapshot = {
  readonly summaryId: string;
  readonly elapsedUs: string;
  readonly segmentCount: number;
};

export type TutorialEquipmentPresetSnapshot = {
  readonly presetId: string | null;
  readonly presetCount: number;
  readonly savedAtUs: string | null;
};

export type TutorialDungeonSnapshot = {
  readonly enteredDungeonIds: readonly string[];
  readonly completedDungeonIds: readonly string[];
};

export type TutorialProgressSnapshot = {
  readonly completedTutorialIds: readonly TutorialId[];
  readonly skippedTutorialIds: readonly TutorialId[];
  readonly appliedIntentIds: readonly string[];
};

export type TutorialAuthoritySnapshot = {
  readonly realmId: string;
  readonly cultivationXp: string;
  readonly assets: Readonly<Record<string, TutorialAssetBalance | undefined>>;
  readonly queue: TutorialQueueSnapshot;
  readonly offlineSummary: TutorialOfflineSummarySnapshot | null;
  readonly equipmentPreset: TutorialEquipmentPresetSnapshot;
  readonly dungeon: TutorialDungeonSnapshot;
  readonly progress: TutorialProgressSnapshot;
};

export type TutorialAuthorityEvent =
  | {
      readonly eventId: string;
      readonly eventIndex: number;
      readonly eventType: 'ACTION_COMPLETED';
      readonly actionConfigId: string;
      readonly completedAtUs: string;
    }
  | {
      readonly eventId: string;
      readonly eventIndex: number;
      readonly eventType: 'QUEUE_SAVED';
      readonly queueVersion: string;
      readonly slotCount: number;
      readonly savedAtUs: string;
    }
  | {
      readonly eventId: string;
      readonly eventIndex: number;
      readonly eventType: 'OFFLINE_SETTLEMENT_RECORDED';
      readonly summaryId: string;
      readonly elapsedUs: string;
      readonly segmentCount: number;
      readonly recordedAtUs: string;
    }
  | {
      readonly eventId: string;
      readonly eventIndex: number;
      readonly eventType: 'ITEM_CONSUMED';
      readonly itemId: string;
      readonly quantity: string;
      readonly consumedAtUs: string;
    }
  | {
      readonly eventId: string;
      readonly eventIndex: number;
      readonly eventType: 'EQUIPMENT_PRESET_SAVED';
      readonly presetId: string;
      readonly equippedItemIds: readonly string[];
      readonly savedAtUs: string;
    }
  | {
      readonly eventId: string;
      readonly eventIndex: number;
      readonly eventType: 'DUNGEON_RUN_ENTERED';
      readonly dungeonId: string;
      readonly enteredAtUs: string;
    }
  | {
      readonly eventId: string;
      readonly eventIndex: number;
      readonly eventType: 'DUNGEON_RUN_COMPLETED';
      readonly dungeonId: string;
      readonly outcome: 'SUCCESS' | 'FAILURE';
      readonly completedAtUs: string;
    };

export type TutorialGateProgress = {
  readonly gateId: string;
  readonly labelKey: string;
  readonly assetId: string;
  readonly sourceRouteId: string;
  readonly required: string;
  readonly current: string;
  readonly reserved: string;
  readonly available: string;
  readonly shortfall: string;
  readonly progressRatio: string;
  readonly status: TutorialGateStatus;
};

export type FoundationGoalProgress = {
  readonly goalId: FoundationGoalId;
  readonly status: GoalStatus;
  readonly prerequisiteTutorialId: TutorialId;
  readonly allSatisfied: boolean;
  readonly satisfiedGateCount: number;
  readonly totalGateCount: number;
  readonly blockingGateId: string | null;
  readonly gates: readonly TutorialGateProgress[];
};

export type TutorialDefinition = {
  readonly id: TutorialId;
  readonly prerequisiteTutorialIds: readonly TutorialId[];
  readonly match: (input: TutorialEvaluationInput) => boolean;
};

export type TutorialEvaluationInput = {
  readonly snapshot: TutorialAuthoritySnapshot;
  readonly events: readonly TutorialAuthorityEvent[];
};

export type TutorialEntryEvaluation = {
  readonly tutorialId: TutorialId;
  readonly prerequisiteTutorialIds: readonly TutorialId[];
  readonly status: TutorialStatus;
  readonly ready: boolean;
  readonly evidenceSatisfied: boolean;
  readonly missingPrerequisiteTutorialIds: readonly TutorialId[];
};

export type TutorialEvaluationResult = {
  readonly tutorials: readonly TutorialEntryEvaluation[];
  readonly foundationGoal: FoundationGoalProgress;
};

export type TutorialIntentResult = {
  readonly snapshot: TutorialAuthoritySnapshot;
  readonly completedTutorialIds: readonly TutorialId[];
  readonly skippedTutorialIds: readonly TutorialId[];
  readonly appliedIntentIds: readonly string[];
  readonly idempotent: boolean;
  readonly rewardDelta: readonly [];
};

const FOUNDATION_GOAL_ID: FoundationGoalId = 'goal.t1.foundation_breakthrough';
const FOUNDATION_PILL_ITEM_ID = 'item.t1.foundation_pill';
const LINGSUI_ITEM_ID = 'item.t2.lingsui';
const MERIDIAN_PILL_ITEM_ID = 'item.t1.meridian_pill';
const SPIRIT_STONE_ITEM_ID = 'currency.spirit_stone';
const FOUNDATION_PREREQUISITE_TUTORIAL_ID: TutorialId = 'tutorial.t1.qingshe_cave_complete';

export const tutorialDefinitions: readonly TutorialDefinition[] = [
  {
    id: 'tutorial.t1.first_cultivation',
    prerequisiteTutorialIds: [],
    match: (input) =>
      hasActionCompleted(input.events, 'action.cultivation.qi'),
  },
  {
    id: 'tutorial.t1.first_herb',
    prerequisiteTutorialIds: ['tutorial.t1.first_cultivation'],
    match: (input) =>
      hasActionCompleted(input.events, 'action.t1.herb_baicao_valley'),
  },
  {
    id: 'tutorial.t1.save_queue',
    prerequisiteTutorialIds: ['tutorial.t1.first_herb'],
    match: (input) =>
      input.snapshot.queue.savedQueueVersion !== null
      && input.snapshot.queue.savedAtUs !== null
      && input.snapshot.queue.slotCount >= 1
      && hasQueueSaved(input.events, input.snapshot.queue.savedQueueVersion),
  },
  {
    id: 'tutorial.t1.offline_return',
    prerequisiteTutorialIds: ['tutorial.t1.save_queue'],
    match: (input) =>
      input.snapshot.offlineSummary !== null
      && isAtLeast(input.snapshot.offlineSummary.elapsedUs, '120000000')
      && input.snapshot.offlineSummary.segmentCount >= 1
      && hasOfflineSummary(input.events, input.snapshot.offlineSummary.summaryId),
  },
  {
    id: 'tutorial.t1.first_alchemy',
    prerequisiteTutorialIds: ['tutorial.t1.offline_return'],
    match: (input) =>
      hasActionCompleted(input.events, 'recipe.t1.qi_gathering_pill'),
  },
  {
    id: 'tutorial.t1.use_pill',
    prerequisiteTutorialIds: ['tutorial.t1.first_alchemy'],
    match: (input) =>
      hasItemConsumed(input.events, 'item.t1.qi_gathering_pill', '1')
      || hasItemConsumed(input.events, 'item.t1.qi_powder', '1'),
  },
  {
    id: 'tutorial.t1.equipment_preset',
    prerequisiteTutorialIds: ['tutorial.t1.use_pill'],
    match: (input) =>
      input.snapshot.equipmentPreset.presetId !== null
      && input.snapshot.equipmentPreset.presetCount >= 1
      && input.snapshot.equipmentPreset.savedAtUs !== null
      && hasEquipmentPresetSaved(input.events, input.snapshot.equipmentPreset.presetId),
  },
  {
    id: 'tutorial.t1.qingshe_cave_enter',
    prerequisiteTutorialIds: ['tutorial.t1.equipment_preset'],
    match: (input) =>
      hasDungeonEntered(input.events, 'dungeon.t1.qingshe_cave'),
  },
  {
    id: 'tutorial.t1.qingshe_cave_complete',
    prerequisiteTutorialIds: ['tutorial.t1.qingshe_cave_enter'],
    match: (input) =>
      hasDungeonEntered(input.events, 'dungeon.t1.qingshe_cave')
      && hasDungeonCompleted(input.events, 'dungeon.t1.qingshe_cave', 'SUCCESS'),
  },
];

export const foundationGoalGates: readonly {
  readonly gateId: string;
  readonly labelKey: string;
  readonly assetId: string;
  readonly sourceRouteId: string;
  readonly required: string;
}[] = [
  {
    gateId: 'foundation.cultivation_xp',
    labelKey: 'goal.foundation.cultivation_xp',
    assetId: 'cultivation_xp',
    sourceRouteId: 'action.cultivation.qi',
    required: '24100',
  },
  {
    gateId: 'foundation.foundation_pill',
    labelKey: 'goal.foundation.foundation_pill',
    assetId: FOUNDATION_PILL_ITEM_ID,
    sourceRouteId: 'recipe.t1.foundation_pill',
    required: '1',
  },
  {
    gateId: 'foundation.lingsui',
    labelKey: 'goal.foundation.lingsui',
    assetId: LINGSUI_ITEM_ID,
    sourceRouteId: 'route.t1.qingshe_cave.safe_exit',
    required: '3',
  },
  {
    gateId: 'foundation.meridian_pill',
    labelKey: 'goal.foundation.meridian_pill',
    assetId: MERIDIAN_PILL_ITEM_ID,
    sourceRouteId: 'recipe.t1.meridian_pill',
    required: '2',
  },
  {
    gateId: 'foundation.spirit_stone',
    labelKey: 'goal.foundation.spirit_stone',
    assetId: SPIRIT_STONE_ITEM_ID,
    sourceRouteId: 'route.t1.qingshe_cave.deep_den',
    required: '2500',
  },
];

function fail(reason: string): never {
  throw new Error(`TUTORIAL_${reason}`);
}

function trimOrFail(value: string, field: string): string {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    fail(`${field}_REQUIRED`);
  }
  return trimmed;
}

function parseNonNegativeInteger(value: string, field: string): bigint {
  const trimmed = trimOrFail(value, field);
  if (!/^(?:0|[1-9]\d*)$/.test(trimmed)) {
    fail(`${field}_INVALID`);
  }
  return BigInt(trimmed);
}

function isAtLeast(value: string, minimum: string): boolean {
  return parseNonNegativeInteger(value, 'VALUE') >= parseNonNegativeInteger(minimum, 'MINIMUM');
}

function decimalString(value: Decimal): string {
  return value.toFixed(6).replace(/0+$/, '').replace(/\.$/, '') || '0';
}

function uniqueStrings(values: readonly string[], field: string): readonly string[] {
  const seen = new Set<string>();
  for (const value of values) {
    const trimmed = trimOrFail(value, field);
    if (seen.has(trimmed)) {
      fail(`${field}_DUPLICATE:${trimmed}`);
    }
    seen.add(trimmed);
  }
  return [...seen];
}

function validateEvents(events: readonly TutorialAuthorityEvent[]): void {
  const seenEventIds = new Set<string>();
  events.forEach((event, index) => {
    if (event.eventIndex !== index) {
      fail('EVENT_STREAM_OUT_OF_ORDER');
    }
    const eventId = trimOrFail(event.eventId, 'EVENT_ID');
    if (seenEventIds.has(eventId)) {
      fail('EVENT_DUPLICATE');
    }
    seenEventIds.add(eventId);

    switch (event.eventType) {
      case 'ACTION_COMPLETED':
        trimOrFail(event.actionConfigId, 'ACTION_CONFIG_ID');
        parseNonNegativeInteger(event.completedAtUs, 'ACTION_COMPLETED_AT');
        return;
      case 'QUEUE_SAVED':
        trimOrFail(event.queueVersion, 'QUEUE_VERSION');
        if (!Number.isInteger(event.slotCount) || event.slotCount < 1 || event.slotCount > 3) {
          fail('QUEUE_SLOT_COUNT_INVALID');
        }
        parseNonNegativeInteger(event.savedAtUs, 'QUEUE_SAVED_AT');
        return;
      case 'OFFLINE_SETTLEMENT_RECORDED':
        trimOrFail(event.summaryId, 'OFFLINE_SUMMARY_ID');
        parseNonNegativeInteger(event.elapsedUs, 'OFFLINE_ELAPSED_US');
        if (!Number.isInteger(event.segmentCount) || event.segmentCount < 1) {
          fail('OFFLINE_SEGMENT_COUNT_INVALID');
        }
        parseNonNegativeInteger(event.recordedAtUs, 'OFFLINE_RECORDED_AT');
        return;
      case 'ITEM_CONSUMED':
        trimOrFail(event.itemId, 'ITEM_ID');
        parseNonNegativeInteger(event.quantity, 'ITEM_CONSUMED_QUANTITY');
        parseNonNegativeInteger(event.consumedAtUs, 'ITEM_CONSUMED_AT');
        return;
      case 'EQUIPMENT_PRESET_SAVED':
        trimOrFail(event.presetId, 'PRESET_ID');
        uniqueStrings(event.equippedItemIds, 'EQUIPPED_ITEM_ID');
        parseNonNegativeInteger(event.savedAtUs, 'PRESET_SAVED_AT');
        return;
      case 'DUNGEON_RUN_ENTERED':
        trimOrFail(event.dungeonId, 'DUNGEON_ID');
        parseNonNegativeInteger(event.enteredAtUs, 'DUNGEON_ENTERED_AT');
        return;
      case 'DUNGEON_RUN_COMPLETED':
        trimOrFail(event.dungeonId, 'DUNGEON_ID');
        parseNonNegativeInteger(event.completedAtUs, 'DUNGEON_COMPLETED_AT');
        return;
    }
  });
}

function hasActionCompleted(events: readonly TutorialAuthorityEvent[], actionConfigId: string): boolean {
  return events.some((event) => event.eventType === 'ACTION_COMPLETED' && event.actionConfigId === actionConfigId);
}

function hasQueueSaved(events: readonly TutorialAuthorityEvent[], queueVersion: string): boolean {
  return events.some((event) => event.eventType === 'QUEUE_SAVED' && event.queueVersion === queueVersion);
}

function hasOfflineSummary(events: readonly TutorialAuthorityEvent[], summaryId: string): boolean {
  return events.some((event) => event.eventType === 'OFFLINE_SETTLEMENT_RECORDED' && event.summaryId === summaryId);
}

function hasItemConsumed(events: readonly TutorialAuthorityEvent[], itemId: string, quantity: string): boolean {
  return events.some(
    (event) => event.eventType === 'ITEM_CONSUMED' && event.itemId === itemId && event.quantity === quantity,
  );
}

function hasEquipmentPresetSaved(events: readonly TutorialAuthorityEvent[], presetId: string): boolean {
  return events.some((event) => event.eventType === 'EQUIPMENT_PRESET_SAVED' && event.presetId === presetId);
}

function hasDungeonEntered(events: readonly TutorialAuthorityEvent[], dungeonId: string): boolean {
  return events.some((event) => event.eventType === 'DUNGEON_RUN_ENTERED' && event.dungeonId === dungeonId);
}

function hasDungeonCompleted(
  events: readonly TutorialAuthorityEvent[],
  dungeonId: string,
  outcome: 'SUCCESS' | 'FAILURE',
): boolean {
  return events.some(
    (event) =>
      event.eventType === 'DUNGEON_RUN_COMPLETED'
      && event.dungeonId === dungeonId
      && event.outcome === outcome,
  );
}

function getBalance(snapshot: TutorialAuthoritySnapshot, assetId: string): TutorialAssetBalance {
  return snapshot.assets[assetId] ?? { total: '0', reserved: '0' };
}

function gateProgress(snapshot: TutorialAuthoritySnapshot, gate: (typeof foundationGoalGates)[number]): TutorialGateProgress {
  const balance = gate.assetId === 'cultivation_xp'
    ? { total: snapshot.cultivationXp, reserved: '0' }
    : getBalance(snapshot, gate.assetId);
  const total = new Decimal(balance.total);
  const reserved = new Decimal(balance.reserved);
  const available = Decimal.max(0, total.minus(reserved));
  const required = new Decimal(gate.required);
  const shortfall = Decimal.max(0, required.minus(available));
  const progressRatio = required.isZero() ? new Decimal(1) : Decimal.min(1, available.div(required));

  return {
    gateId: gate.gateId,
    labelKey: gate.labelKey,
    assetId: gate.assetId,
    sourceRouteId: gate.sourceRouteId,
    required: gate.required,
    current: decimalString(total),
    reserved: decimalString(reserved),
    available: decimalString(available),
    shortfall: decimalString(shortfall),
    progressRatio: decimalString(progressRatio),
    status: shortfall.isZero() ? 'SATISFIED' : 'MISSING',
  };
}

function resolvedTutorialIds(snapshot: TutorialAuthoritySnapshot): readonly TutorialId[] {
  return [...snapshot.progress.completedTutorialIds, ...snapshot.progress.skippedTutorialIds];
}

function isTutorialResolved(snapshot: TutorialAuthoritySnapshot, tutorialId: TutorialId): boolean {
  return resolvedTutorialIds(snapshot).includes(tutorialId);
}

function getTutorialDefinition(tutorialId: TutorialId): TutorialDefinition {
  const definition = tutorialDefinitions.find((item) => item.id === tutorialId);
  if (definition === undefined) {
    fail('UNKNOWN_TUTORIAL_ID');
  }
  return definition;
}

function evaluateTutorialDefinition(input: TutorialEvaluationInput, definition: TutorialDefinition): TutorialEntryEvaluation {
  const resolved = new Set(resolvedTutorialIds(input.snapshot));
  const missingPrerequisiteTutorialIds = definition.prerequisiteTutorialIds.filter((tutorialId) => !resolved.has(tutorialId));
  const evidenceSatisfied = definition.match(input);
  const completed = input.snapshot.progress.completedTutorialIds.includes(definition.id);
  const skipped = input.snapshot.progress.skippedTutorialIds.includes(definition.id);

  let status: TutorialStatus = 'LOCKED';
  if (completed) {
    status = 'COMPLETED';
  } else if (skipped) {
    status = 'SKIPPED';
  } else if (missingPrerequisiteTutorialIds.length === 0 && evidenceSatisfied) {
    status = 'READY';
  }

  return {
    tutorialId: definition.id,
    prerequisiteTutorialIds: definition.prerequisiteTutorialIds,
    status,
    ready: status === 'READY',
    evidenceSatisfied,
    missingPrerequisiteTutorialIds,
  };
}

function evaluateFoundationGoal(input: TutorialEvaluationInput): FoundationGoalProgress {
  const prerequisiteResolved = isTutorialResolved(input.snapshot, FOUNDATION_PREREQUISITE_TUTORIAL_ID);
  const gates = foundationGoalGates.map((gate) => gateProgress(input.snapshot, gate));
  const satisfiedGateCount = gates.filter((gate) => gate.status === 'SATISFIED').length;
  const allSatisfied = satisfiedGateCount === gates.length;
  const blockingGate = gates.find((gate) => gate.status === 'MISSING') ?? null;

  let status: GoalStatus = 'LOCKED';
  if (prerequisiteResolved && allSatisfied) {
    status = 'READY';
  } else if (prerequisiteResolved || satisfiedGateCount > 0) {
    status = 'TRACKING';
  }

  return {
    goalId: FOUNDATION_GOAL_ID,
    status,
    prerequisiteTutorialId: FOUNDATION_PREREQUISITE_TUTORIAL_ID,
    allSatisfied,
    satisfiedGateCount,
    totalGateCount: gates.length,
    blockingGateId: blockingGate ? blockingGate.gateId : null,
    gates,
  };
}

export function evaluateTutorialCore(input: TutorialEvaluationInput): TutorialEvaluationResult {
  validateEvents(input.events);
  const tutorials = tutorialDefinitions.map((definition) => evaluateTutorialDefinition(input, definition));
  const foundationGoal = evaluateFoundationGoal(input);
  return { tutorials, foundationGoal };
}

export function applyTutorialIntent(
  input: TutorialEvaluationInput,
  intent: TutorialCompletionIntent,
): TutorialIntentResult {
  validateEvents(input.events);
  const intentId = trimOrFail(intent.intentId, 'INTENT_ID');
  const tutorialId = intent.tutorialId;
  const definition = getTutorialDefinition(tutorialId);
  const resolvedIntentIds = new Set(input.snapshot.progress.appliedIntentIds.map((value) => trimOrFail(value, 'APPLIED_INTENT_ID')));
  if (resolvedIntentIds.has(intentId)) {
    return {
      snapshot: input.snapshot,
      completedTutorialIds: input.snapshot.progress.completedTutorialIds,
      skippedTutorialIds: input.snapshot.progress.skippedTutorialIds,
      appliedIntentIds: input.snapshot.progress.appliedIntentIds,
      idempotent: true,
      rewardDelta: [],
    };
  }

  const evaluation = evaluateTutorialDefinition(input, definition);
  if (intent.mode === 'COMPLETE') {
    if (evaluation.status === 'COMPLETED' || evaluation.status === 'SKIPPED') {
      fail('ALREADY_RESOLVED');
    }
    if (evaluation.missingPrerequisiteTutorialIds.length > 0) {
      fail('PREREQUISITES_MISSING');
    }
    if (!evaluation.evidenceSatisfied) {
      fail('EVIDENCE_MISSING');
    }
    return {
      snapshot: input.snapshot,
      completedTutorialIds: uniqueStrings([...input.snapshot.progress.completedTutorialIds, tutorialId], 'COMPLETED_TUTORIAL_ID') as readonly TutorialId[],
      skippedTutorialIds: input.snapshot.progress.skippedTutorialIds,
      appliedIntentIds: [...input.snapshot.progress.appliedIntentIds, intentId],
      idempotent: false,
      rewardDelta: [],
    };
  }

  if (evaluation.status !== 'READY') {
    fail('SKIP_NOT_ALLOWED');
  }

  return {
    snapshot: input.snapshot,
    completedTutorialIds: input.snapshot.progress.completedTutorialIds,
    skippedTutorialIds: uniqueStrings([...input.snapshot.progress.skippedTutorialIds, tutorialId], 'SKIPPED_TUTORIAL_ID') as readonly TutorialId[],
    appliedIntentIds: [...input.snapshot.progress.appliedIntentIds, intentId],
    idempotent: false,
    rewardDelta: [],
  };
}
