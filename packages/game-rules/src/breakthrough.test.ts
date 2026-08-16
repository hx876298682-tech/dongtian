import Decimal from 'decimal.js';
import { describe, expect, it } from 'vitest';

import {
  abandonBreakthroughRun,
  evaluateBreakthroughFinalizeEligibility,
  finalizeBreakthroughRun,
  foundationBreakthroughConfig,
  previewBreakthrough,
  restoreBreakthroughRun,
  selectBreakthroughRoute,
  startBreakthroughTrial,
} from './breakthrough.js';

function buildPreview(input?: {
  readonly cultivationXp?: string;
  readonly foundationPills?: { readonly total: string; readonly reserved: string };
  readonly lingsui?: { readonly total: string; readonly reserved: string };
  readonly meridianPills?: { readonly total: string; readonly reserved: string };
  readonly spiritStone?: { readonly total: string; readonly reserved: string };
}): ReturnType<typeof previewBreakthrough> {
  return previewBreakthrough({
    config: foundationBreakthroughConfig,
    cultivationXp: input?.cultivationXp ?? '24100',
    items: {
      'item.t1.foundation_pill': input?.foundationPills ?? { total: '1', reserved: '0' },
      'item.t2.lingsui': input?.lingsui ?? { total: '3', reserved: '0' },
      'item.t1.meridian_pill': input?.meridianPills ?? { total: '2', reserved: '0' },
    },
    currencies: {
      'currency.spirit_stone': input?.spiritStone ?? { total: '2500', reserved: '0' },
    },
    sourceSecondsPerUnitByRouteId: {
      'action.cultivation.qi': '13.333333333333334',
    },
  });
}

describe('breakthrough rules', () => {
  it('maps the foundation gate at the exact threshold and exposes source routes', () => {
    const preview = buildPreview();
    expect(preview.successRate).toBe('1');
    expect(preview.allSatisfied).toBe(true);
    expect(preview.requirements).toEqual([
      expect.objectContaining({
        assetId: 'cultivation_xp',
        current: '24100',
        required: '24100',
        status: 'SATISFIED',
        shortfall: '0',
        sourceRouteId: 'action.cultivation.qi',
        estimatedTimeSeconds: '0',
      }),
      expect.objectContaining({
        assetId: 'item.t1.foundation_pill',
        current: '1',
        required: '1',
        status: 'SATISFIED',
        shortfall: '0',
        sourceRouteId: 'recipe.t1.foundation_pill',
        estimatedTimeSeconds: '0',
      }),
      expect.objectContaining({
        assetId: 'item.t2.lingsui',
        current: '3',
        required: '3',
        status: 'SATISFIED',
        shortfall: '0',
        sourceRouteId: 'route.t1.qingshe_cave.safe_exit',
        estimatedTimeSeconds: '0',
      }),
      expect.objectContaining({
        assetId: 'item.t1.meridian_pill',
        current: '2',
        required: '2',
        status: 'SATISFIED',
        shortfall: '0',
        sourceRouteId: 'recipe.t1.meridian_pill',
        estimatedTimeSeconds: '0',
      }),
      expect.objectContaining({
        assetId: 'currency.spirit_stone',
        current: '2500',
        required: '2500',
        status: 'SATISFIED',
        shortfall: '0',
        sourceRouteId: 'route.t1.qingshe_cave.deep_den',
        estimatedTimeSeconds: '0',
      }),
    ]);
  });

  it('treats reserved quantity as unavailable and shows a missing item when only total looks sufficient', () => {
    const preview = buildPreview({
      foundationPills: { total: '1', reserved: '1' },
    });
    expect(preview.allSatisfied).toBe(false);
    expect(preview.requirements.find((item) => item.assetId === 'item.t1.foundation_pill')).toEqual(
      expect.objectContaining({
        current: '0',
        total: '1',
        reserved: '1',
        available: '0',
        required: '1',
        status: 'MISSING',
        shortfall: '1',
      }),
    );
    expect(preview.successRate).toBe('0');
  });

  it('reports the missing gate when one material is short and keeps the other sources intact', () => {
    const preview = buildPreview({
      meridianPills: { total: '1', reserved: '0' },
    });
    expect(preview.allSatisfied).toBe(false);
    expect(preview.requirements.find((item) => item.assetId === 'item.t1.meridian_pill')).toEqual(
      expect.objectContaining({
        current: '1',
        required: '2',
        status: 'MISSING',
        shortfall: '1',
        sourceRouteId: 'recipe.t1.meridian_pill',
      }),
    );
  });

  it('starts a run idempotently once the full preview is satisfied', () => {
    const preview = buildPreview();
    const first = startBreakthroughTrial({
      runId: 'run-1',
      characterId: 'character-1',
      startedAtUs: 0n,
      preview,
      config: foundationBreakthroughConfig,
    });
    const second = startBreakthroughTrial({
      runId: 'run-2',
      characterId: 'character-1',
      startedAtUs: 1n,
      preview,
      config: foundationBreakthroughConfig,
      existingRun: first.run,
    });
    expect(first.run).toMatchObject({
      breakthroughRunId: 'run-1',
      status: 'TRIAL_ACTIVE',
      currentNodeId: 'TRIAL_ACTIVE',
      trialDeadlineAtUs: '900000000',
      expiresAtUs: '86400000000',
      selectedChoiceId: null,
    });
    expect(second.idempotent).toBe(true);
    expect(second.run).toBe(first.run);
  });

  it('rejects starting before all gates are satisfied', () => {
    const preview = buildPreview({
      spiritStone: { total: '2499', reserved: '0' },
    });
    expect(preview.allSatisfied).toBe(false);
    expect(() => startBreakthroughTrial({
      runId: 'run-1',
      characterId: 'character-1',
      startedAtUs: 0n,
      preview,
      config: foundationBreakthroughConfig,
    })).toThrow('BREAKTHROUGH_REQUIREMENTS_NOT_MET');
  });

  it('supports a single route selection, duplicate selection idempotency, and version checks', () => {
    const preview = buildPreview();
    const started = startBreakthroughTrial({
      runId: 'run-1',
      characterId: 'character-1',
      startedAtUs: 0n,
      preview,
      config: foundationBreakthroughConfig,
    }).run;
    const chosen = selectBreakthroughRoute({
      run: started,
      choiceId: 'choice.breakthrough.foundation.safe_exit',
      chosenAtUs: 60_000_000n,
      expectedRunVersion: 0n,
    });
    expect(chosen.run).toMatchObject({
      status: 'TRIAL_WAITING_CHOICE',
      selectedChoiceId: 'choice.breakthrough.foundation.safe_exit',
      selectedRouteId: 'route.t1.qingshe_cave.safe_exit',
      selectedRouteRisk: 'SAFE',
      selectedAtUs: '60000000',
      runVersion: 1n,
    });
    expect(selectBreakthroughRoute({
      run: chosen.run,
      choiceId: 'choice.breakthrough.foundation.safe_exit',
      chosenAtUs: 60_000_000n,
      expectedRunVersion: 1n,
    })).toEqual({ run: chosen.run, idempotent: true });
    expect(() => selectBreakthroughRoute({
      run: chosen.run,
      choiceId: 'choice.breakthrough.foundation.deep_den',
      chosenAtUs: 60_000_000n,
      expectedRunVersion: 1n,
    })).toThrow('BREAKTHROUGH_CHOICE_ALREADY_SELECTED');
  });

  it('allows finalize only at the 15 minute boundary and keeps the unlock summary stable on repeat finalize', () => {
    const preview = buildPreview();
    const started = startBreakthroughTrial({
      runId: 'run-1',
      characterId: 'character-1',
      startedAtUs: 0n,
      preview,
      config: foundationBreakthroughConfig,
    }).run;
    const chosen = selectBreakthroughRoute({
      run: started,
      choiceId: 'choice.breakthrough.foundation.deep_den',
      chosenAtUs: 60_000_000n,
      expectedRunVersion: 0n,
    }).run;
    expect(evaluateBreakthroughFinalizeEligibility({
      run: chosen,
      restoredAtUs: 899_999_999n,
    })).toEqual({
      eligible: false,
      reason: 'TOO_EARLY',
      trialReadyAtUs: '900000000',
      expiresAtUs: '86400000000',
    });
    expect(evaluateBreakthroughFinalizeEligibility({
      run: chosen,
      restoredAtUs: 900_000_000n,
    })).toEqual({
      eligible: true,
      reason: 'FINALIZE_READY',
      trialReadyAtUs: '900000000',
      expiresAtUs: '86400000000',
    });
    const finalized = finalizeBreakthroughRun({
      run: chosen,
      restoredAtUs: 900_000_000n,
    });
    expect(finalized.run).toMatchObject({
      status: 'COMPLETED',
      currentNodeId: 'COMPLETED',
      finalizedAtUs: '900000000',
      result: {
        breakthroughRunId: 'run-1',
        breakthroughConfigId: 'breakthrough.foundation.early',
        successRate: '1',
        unlockedRealmId: 'realm.foundation.early',
        unlockBundleId: 'unlock.foundation.early',
        queueSlots: 3,
        medicineSlots: 3,
      },
    });
    expect(finalizeBreakthroughRun({
      run: finalized.run,
      restoredAtUs: 900_000_000n,
    })).toEqual({ run: finalized.run, idempotent: true });
  });

  it('restores and expires an active run after 24 hours, and abandon is idempotent', () => {
    const preview = buildPreview();
    const started = startBreakthroughTrial({
      runId: 'run-1',
      characterId: 'character-1',
      startedAtUs: 0n,
      preview,
      config: foundationBreakthroughConfig,
    }).run;
    const chosen = selectBreakthroughRoute({
      run: started,
      choiceId: 'choice.breakthrough.foundation.safe_exit',
      chosenAtUs: 60_000_000n,
      expectedRunVersion: 0n,
    }).run;
    const restored = restoreBreakthroughRun({
      run: chosen,
      restoredAtUs: 86_400_000_000n,
    });
    expect(restored.run).toMatchObject({
      status: 'FAILED_RECOVERABLE',
      currentNodeId: 'READY',
      releasedAtUs: '86400000000',
    });
    expect(restored.eligibility).toEqual({
      eligible: false,
      reason: 'EXPIRED',
      trialReadyAtUs: '900000000',
      expiresAtUs: '86400000000',
    });
    const abandoned = abandonBreakthroughRun({
      run: chosen,
      restoredAtUs: 120_000_000n,
    });
    expect(abandoned.run).toMatchObject({
      status: 'ABANDONED',
      currentNodeId: 'READY',
      abandonedAtUs: '120000000',
      releasedAtUs: '120000000',
    });
    expect(abandonBreakthroughRun({
      run: abandoned.run,
      restoredAtUs: 120_000_000n,
    })).toEqual({ run: abandoned.run, idempotent: true });
  });

  it('does not release or finalize when the run is still before the 15 minute boundary', () => {
    const preview = buildPreview();
    const started = startBreakthroughTrial({
      runId: 'run-1',
      characterId: 'character-1',
      startedAtUs: 0n,
      preview,
      config: foundationBreakthroughConfig,
    }).run;
    const chosen = selectBreakthroughRoute({
      run: started,
      choiceId: 'choice.breakthrough.foundation.safe_exit',
      chosenAtUs: 60_000_000n,
      expectedRunVersion: 0n,
    }).run;
    expect(evaluateBreakthroughFinalizeEligibility({
      run: chosen,
      restoredAtUs: 899_999_999n,
    }).eligible).toBe(false);
  });

  it('computes the cultivation estimate from the approved 4.5 XP per minute rule', () => {
    const preview = previewBreakthrough({
      config: foundationBreakthroughConfig,
      cultivationXp: '0',
      items: {
        'item.t1.foundation_pill': { total: '1', reserved: '0' },
        'item.t2.lingsui': { total: '3', reserved: '0' },
        'item.t1.meridian_pill': { total: '2', reserved: '0' },
      },
      currencies: {
        'currency.spirit_stone': { total: '2500', reserved: '0' },
      },
      sourceSecondsPerUnitByRouteId: {
        'action.cultivation.qi': '13.333333333333334',
      },
    });
    expect(preview.requirements[0]).toEqual(
      expect.objectContaining({
        assetId: 'cultivation_xp',
        current: '0',
        shortfall: '24100',
        estimatedTimeSeconds: '321334',
      }),
    );
  });

  it('keeps the stable configuration values available for downstream consumers', () => {
    expect(foundationBreakthroughConfig).toMatchObject({
      breakthroughConfigId: 'breakthrough.foundation.early',
      targetRealmId: 'realm.foundation.early',
      targetCultivationXp: '24100',
      assetCoverageMultiplier: '1',
      trialDurationUs: '900000000',
      reservationExpiryUs: '86400000000',
      successRate: '1',
      unlockBundleId: 'unlock.foundation.early',
    });
    expect(foundationBreakthroughConfig.requirements.map((item) => item.assetId)).toEqual([
      'cultivation_xp',
      'item.t1.foundation_pill',
      'item.t2.lingsui',
      'item.t1.meridian_pill',
      'currency.spirit_stone',
    ]);
  });

  it('keeps decimal math stable for the cultivation estimate helper', () => {
    expect(new Decimal('24100').minus('0').dividedBy('0.075').ceil().toString()).toBe('321334');
  });
});
