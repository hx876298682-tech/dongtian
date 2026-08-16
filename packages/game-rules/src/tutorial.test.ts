import { describe, expect, it } from 'vitest';

import {
  applyTutorialIntent,
  evaluateTutorialCore,
  foundationGoalGates,
  tutorialDefinitions,
  type TutorialAuthorityEvent,
  type TutorialAuthoritySnapshot,
  type TutorialCompletionIntent,
} from './tutorial.js';

function baseSnapshot(): TutorialAuthoritySnapshot {
  return {
    realmId: 'realm.qi.late',
    cultivationXp: '24100',
    assets: {
      'item.t1.foundation_pill': { total: '1', reserved: '0' },
      'item.t2.lingsui': { total: '3', reserved: '0' },
      'item.t1.meridian_pill': { total: '2', reserved: '0' },
      'currency.spirit_stone': { total: '2500', reserved: '0' },
    },
    queue: {
      savedQueueVersion: 'queue-v1',
      slotCount: 2,
      savedAtUs: '120000000',
    },
    offlineSummary: {
      summaryId: 'offline-1',
      elapsedUs: '120000000',
      segmentCount: 1,
    },
    equipmentPreset: {
      presetId: 'preset-1',
      presetCount: 1,
      savedAtUs: '130000000',
    },
    dungeon: {
      enteredDungeonIds: ['dungeon.t1.qingshe_cave'],
      completedDungeonIds: ['dungeon.t1.qingshe_cave'],
    },
    progress: {
      completedTutorialIds: [],
      skippedTutorialIds: [],
      appliedIntentIds: [],
    },
  };
}

function fullEvidenceEvents(): readonly TutorialAuthorityEvent[] {
  return [
    {
      eventId: 'evt-0',
      eventIndex: 0,
      eventType: 'ACTION_COMPLETED',
      actionConfigId: 'action.cultivation.qi',
      completedAtUs: '1000',
    },
    {
      eventId: 'evt-1',
      eventIndex: 1,
      eventType: 'ACTION_COMPLETED',
      actionConfigId: 'action.t1.herb_baicao_valley',
      completedAtUs: '2000',
    },
    {
      eventId: 'evt-2',
      eventIndex: 2,
      eventType: 'QUEUE_SAVED',
      queueVersion: 'queue-v1',
      slotCount: 2,
      savedAtUs: '120000000',
    },
    {
      eventId: 'evt-3',
      eventIndex: 3,
      eventType: 'OFFLINE_SETTLEMENT_RECORDED',
      summaryId: 'offline-1',
      elapsedUs: '120000000',
      segmentCount: 1,
      recordedAtUs: '240000000',
    },
    {
      eventId: 'evt-4',
      eventIndex: 4,
      eventType: 'ACTION_COMPLETED',
      actionConfigId: 'recipe.t1.qi_gathering_pill',
      completedAtUs: '250000000',
    },
    {
      eventId: 'evt-5',
      eventIndex: 5,
      eventType: 'ITEM_CONSUMED',
      itemId: 'item.t1.qi_gathering_pill',
      quantity: '1',
      consumedAtUs: '260000000',
    },
    {
      eventId: 'evt-6',
      eventIndex: 6,
      eventType: 'EQUIPMENT_PRESET_SAVED',
      presetId: 'preset-1',
      equippedItemIds: ['item.t1.xuantie_sword'],
      savedAtUs: '270000000',
    },
    {
      eventId: 'evt-7',
      eventIndex: 7,
      eventType: 'DUNGEON_RUN_ENTERED',
      dungeonId: 'dungeon.t1.qingshe_cave',
      enteredAtUs: '280000000',
    },
    {
      eventId: 'evt-8',
      eventIndex: 8,
      eventType: 'DUNGEON_RUN_COMPLETED',
      dungeonId: 'dungeon.t1.qingshe_cave',
      outcome: 'SUCCESS',
      completedAtUs: '290000000',
    },
  ];
}

function tutorialIntent(tutorialId: string, intentId: string, mode: 'COMPLETE' | 'SKIP'): TutorialCompletionIntent {
  return {
    tutorialId: tutorialId as TutorialCompletionIntent['tutorialId'],
    intentId,
    mode,
  };
}

describe('tutorial rules', () => {
  it('exposes stable tutorial ids and the foundation goal gates', () => {
    expect(tutorialDefinitions.map((item) => item.id)).toEqual([
      'tutorial.t1.first_cultivation',
      'tutorial.t1.first_herb',
      'tutorial.t1.save_queue',
      'tutorial.t1.offline_return',
      'tutorial.t1.first_alchemy',
      'tutorial.t1.use_pill',
      'tutorial.t1.equipment_preset',
      'tutorial.t1.qingshe_cave_enter',
      'tutorial.t1.qingshe_cave_complete',
    ]);
    expect(foundationGoalGates.map((item) => item.gateId)).toEqual([
      'foundation.cultivation_xp',
      'foundation.foundation_pill',
      'foundation.lingsui',
      'foundation.meridian_pill',
      'foundation.spirit_stone',
    ]);
  });

  it('rejects forged, duplicate, and out-of-order authority events', () => {
    const snapshot = baseSnapshot();

    expect(() =>
      evaluateTutorialCore({
        snapshot,
        events: [
          ...fullEvidenceEvents(),
          {
            eventId: 'evt-7',
            eventIndex: 9,
            eventType: 'ACTION_COMPLETED',
            actionConfigId: 'action.cultivation.qi',
            completedAtUs: '300000000',
          },
        ],
      }),
    ).toThrow('TUTORIAL_EVENT_DUPLICATE');

    expect(() =>
      evaluateTutorialCore({
        snapshot,
        events: [
          ...fullEvidenceEvents().slice(0, 2),
          {
            eventId: 'evt-2',
            eventIndex: 4,
            eventType: 'QUEUE_SAVED',
            queueVersion: 'queue-v1',
            slotCount: 2,
            savedAtUs: '120000000',
          },
        ],
      }),
    ).toThrow('TUTORIAL_EVENT_STREAM_OUT_OF_ORDER');

    expect(() =>
      applyTutorialIntent(
        {
          snapshot: {
            ...snapshot,
            progress: {
              ...snapshot.progress,
              completedTutorialIds: [
                'tutorial.t1.first_cultivation',
                'tutorial.t1.first_herb',
                'tutorial.t1.save_queue',
                'tutorial.t1.offline_return',
                'tutorial.t1.first_alchemy',
                'tutorial.t1.use_pill',
                'tutorial.t1.equipment_preset',
                'tutorial.t1.qingshe_cave_enter',
              ],
            },
          },
          events: [
            {
              eventId: 'evt-x',
              eventIndex: 0,
              eventType: 'DUNGEON_RUN_COMPLETED',
              dungeonId: 'dungeon.t1.qingshe_cave',
              outcome: 'SUCCESS',
              completedAtUs: '1',
            },
          ],
        },
        tutorialIntent('tutorial.t1.qingshe_cave_complete', 'intent-forged', 'COMPLETE'),
      ),
    ).toThrow('TUTORIAL_EVIDENCE_MISSING');
  });

  it('enforces dependency order and keeps skip side effects reward-free', () => {
    const snapshot = baseSnapshot();
    const events = fullEvidenceEvents();

    expect(() =>
      applyTutorialIntent(
        {
          snapshot: {
            ...snapshot,
            progress: {
              ...snapshot.progress,
              completedTutorialIds: [],
              skippedTutorialIds: [],
              appliedIntentIds: [],
            },
          },
          events,
        },
        tutorialIntent('tutorial.t1.first_herb', 'intent-1', 'COMPLETE'),
      ),
    ).toThrow('TUTORIAL_PREREQUISITES_MISSING');

    const skipped = applyTutorialIntent(
      {
        snapshot: {
          ...snapshot,
          progress: {
            ...snapshot.progress,
            completedTutorialIds: ['tutorial.t1.first_cultivation'],
          },
        },
        events,
      },
      tutorialIntent('tutorial.t1.first_herb', 'intent-skip', 'SKIP'),
    );

    expect(skipped.rewardDelta).toEqual([]);
    expect(skipped.skippedTutorialIds).toContain('tutorial.t1.first_herb');

    const downstream = evaluateTutorialCore({
      snapshot: {
        ...skipped.snapshot,
        progress: {
          ...skipped.snapshot.progress,
          completedTutorialIds: skipped.completedTutorialIds,
          skippedTutorialIds: skipped.skippedTutorialIds,
          appliedIntentIds: skipped.appliedIntentIds,
        },
      },
      events,
    });

    expect(downstream.tutorials.find((item) => item.tutorialId === 'tutorial.t1.save_queue')?.status).toBe('READY');
  });

  it('applies completion intents idempotently without duplicating state', () => {
    const snapshot = baseSnapshot();
    const events = fullEvidenceEvents();

    const first = applyTutorialIntent(
      {
        snapshot,
        events,
      },
      tutorialIntent('tutorial.t1.first_cultivation', 'intent-1', 'COMPLETE'),
    );

    expect(first.completedTutorialIds).toContain('tutorial.t1.first_cultivation');
    expect(first.rewardDelta).toEqual([]);
    expect(first.idempotent).toBe(false);

    const second = applyTutorialIntent(
      {
        snapshot: {
          ...first.snapshot,
          progress: {
            ...first.snapshot.progress,
            completedTutorialIds: first.completedTutorialIds,
            skippedTutorialIds: first.skippedTutorialIds,
            appliedIntentIds: first.appliedIntentIds,
          },
        },
        events,
      },
      tutorialIntent('tutorial.t1.first_cultivation', 'intent-1', 'COMPLETE'),
    );

    expect(second.idempotent).toBe(true);
    expect(second.completedTutorialIds).toEqual(first.completedTutorialIds);
    expect(second.appliedIntentIds).toEqual(first.appliedIntentIds);
  });

  it('walks the full tutorial chain and exposes foundation goal progress', () => {
    let snapshot = baseSnapshot();
    const events = fullEvidenceEvents();

    const orderedTutorials: readonly TutorialCompletionIntent[] = [
      tutorialIntent('tutorial.t1.first_cultivation', 'intent-1', 'COMPLETE'),
      tutorialIntent('tutorial.t1.first_herb', 'intent-2', 'COMPLETE'),
      tutorialIntent('tutorial.t1.save_queue', 'intent-3', 'COMPLETE'),
      tutorialIntent('tutorial.t1.offline_return', 'intent-4', 'COMPLETE'),
      tutorialIntent('tutorial.t1.first_alchemy', 'intent-5', 'COMPLETE'),
      tutorialIntent('tutorial.t1.use_pill', 'intent-6', 'COMPLETE'),
      tutorialIntent('tutorial.t1.equipment_preset', 'intent-7', 'COMPLETE'),
      tutorialIntent('tutorial.t1.qingshe_cave_enter', 'intent-8', 'COMPLETE'),
      tutorialIntent('tutorial.t1.qingshe_cave_complete', 'intent-9', 'COMPLETE'),
    ];

    let progress = snapshot.progress;
    for (const intent of orderedTutorials) {
      const result = applyTutorialIntent(
        {
          snapshot: {
            ...snapshot,
            progress,
          },
          events,
        },
        intent,
      );
      progress = {
        completedTutorialIds: result.completedTutorialIds,
        skippedTutorialIds: result.skippedTutorialIds,
        appliedIntentIds: result.appliedIntentIds,
      };
      snapshot = {
        ...result.snapshot,
        progress,
      };
    }

    const evaluated = evaluateTutorialCore({
      snapshot,
      events,
    });

    expect(evaluated.tutorials.every((item) => item.status === 'COMPLETED')).toBe(true);
    expect(evaluated.foundationGoal).toMatchObject({
      goalId: 'goal.t1.foundation_breakthrough',
      status: 'READY',
      allSatisfied: true,
      satisfiedGateCount: 5,
      totalGateCount: 5,
      blockingGateId: null,
    });
  });

  it('maps foundation gate progress from authoritative snapshot values', () => {
    const evaluated = evaluateTutorialCore({
      snapshot: {
        ...baseSnapshot(),
        cultivationXp: '24000',
        assets: {
          'item.t1.foundation_pill': { total: '1', reserved: '0' },
          'item.t2.lingsui': { total: '2', reserved: '0' },
          'item.t1.meridian_pill': { total: '2', reserved: '0' },
          'currency.spirit_stone': { total: '2000', reserved: '0' },
        },
        progress: {
          completedTutorialIds: ['tutorial.t1.qingshe_cave_complete'],
          skippedTutorialIds: [],
          appliedIntentIds: [],
        },
      },
      events: fullEvidenceEvents(),
    });

    const [cultivationGate, foundationPillGate] = evaluated.foundationGoal.gates;
    expect(cultivationGate).toMatchObject({
      gateId: 'foundation.cultivation_xp',
      status: 'MISSING',
      current: '24000',
      shortfall: '100',
    });
    expect(foundationPillGate).toMatchObject({
      gateId: 'foundation.foundation_pill',
      status: 'SATISFIED',
    });
    expect(evaluated.foundationGoal.status).toBe('TRACKING');
    expect(evaluated.foundationGoal.blockingGateId).toBe('foundation.cultivation_xp');
  });
});
