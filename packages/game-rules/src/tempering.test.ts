import { describe, expect, it } from 'vitest';

import {
  createTemperingRules,
  isTemperingAttemptAllowed,
  resolveTemperingAttempt,
  temperingRules,
} from './tempering.js';

const seedHex = '0123456789abcdef0123456789abcdef';

describe('tempering rules', () => {
  it('loads the approved +1 to +10 ladder with +1 to +6 open and +7 to +10 anchored', () => {
    expect(temperingRules).toHaveLength(10);
    expect(temperingRules[0]).toMatchObject({
      targetLevel: 1,
      successProbability: '0.95',
      temperingStoneCost: '1',
      spiritStoneCost: '20',
      sameEquipmentCost: '0',
      protectionMaterialCost: '0',
      scope: 'MVP',
    });
    expect(temperingRules[5]).toMatchObject({
      targetLevel: 6,
      successProbability: '0.34',
      temperingStoneCost: '3',
      spiritStoneCost: '283.97139999999996',
      sameEquipmentCost: '100',
      protectionMaterialCost: '0',
      scope: 'MVP',
    });
    expect(temperingRules[6]).toMatchObject({ targetLevel: 7, scope: 'ANCHOR' });
    expect(temperingRules[9]).toMatchObject({ targetLevel: 10, scope: 'ANCHOR' });
    expect(isTemperingAttemptAllowed(6)).toBe(true);
    expect(isTemperingAttemptAllowed(7)).toBe(false);
  });

  it('resolves a deterministic attempt and keeps retry output identical', () => {
    const input = {
      attemptId: 'attempt-001',
      equipmentInstanceId: 'eq-001',
      fromLevel: 5,
      targetLevel: 6,
      useProtectionMaterial: false,
      serverSeedHex: seedHex,
      configVersion: '2026.08.16.1',
      formulaVersion: 1,
    } as const;
    const first = resolveTemperingAttempt(input);
    const second = resolveTemperingAttempt(input);
    expect(first).toEqual(second);
    expect(first.status).toBe('APPLIED');
    expect(first.outcome).toMatch(/SUCCESS|FAILURE/);
    expect(first.randomAudit).not.toBeNull();
    expect(first.randomAudit?.seedHex).toMatch(/^[0-9a-f]{32}$/i);
    expect(first.auditSummary).toContain('tempering_attempt');
    expect(first.auditSummary).toContain('attempt=attempt-001');
  });

  it('charges protection material only when requested and keeps failure at the same level', () => {
    const unprotected = resolveTemperingAttempt({
      attemptId: 'attempt-002',
      equipmentInstanceId: 'eq-002',
      fromLevel: 5,
      targetLevel: 6,
      useProtectionMaterial: false,
      serverSeedHex: seedHex,
      configVersion: '2026.08.16.1',
      formulaVersion: 1,
    });
    const protectedAttempt = resolveTemperingAttempt({
      attemptId: 'attempt-003',
      equipmentInstanceId: 'eq-003',
      fromLevel: 7,
      targetLevel: 8,
      useProtectionMaterial: true,
      serverSeedHex: seedHex,
      configVersion: '2026.08.16.1',
      formulaVersion: 1,
    });
    expect(unprotected.costSnapshot.protectionMaterialCostSpent).toBe('0');
    expect(protectedAttempt.status).toBe('REJECTED');
    expect(protectedAttempt.rejectionReason).toBe('TEMPERING_LEVEL_LOCKED');
    expect(protectedAttempt.costSnapshot.protectionMaterialCostRequested).toBe('30');
    expect(protectedAttempt.costSnapshot.protectionMaterialCostSpent).toBe('30');
    expect(protectedAttempt.randomAudit).toBeNull();
    expect(protectedAttempt.equipmentLevelAfter).toBe(7);
  });

  it('rejects +7 to +10 attempts as anchored configuration only', () => {
    const result = resolveTemperingAttempt({
      attemptId: 'attempt-004',
      equipmentInstanceId: 'eq-004',
      fromLevel: 6,
      targetLevel: 7,
      useProtectionMaterial: false,
      serverSeedHex: seedHex,
      configVersion: '2026.08.16.1',
      formulaVersion: 1,
    });
    expect(result).toMatchObject({
      status: 'REJECTED',
      outcome: 'REJECTED',
      applied: false,
      success: false,
      equipmentLevelBefore: 6,
      equipmentLevelAfter: 6,
      rejectionReason: 'TEMPERING_LEVEL_LOCKED',
    });
    expect(result.ruleSnapshot).toMatchObject({
      targetLevel: 7,
      scope: 'ANCHOR',
    });
  });

  it('handles 0% and 100% probability boundaries without client-side success submission', () => {
    const customRules = createTemperingRules([
      {
        targetLevel: 1,
        successProbability: '0',
        attributeIncrease: '0.1',
        temperingStoneCost: '1',
        spiritStoneCost: '5',
        sameEquipmentCost: '0',
        protectionMaterialCost: '0',
        failureResult: 'KEEP_LEVEL',
        scope: 'MVP',
      },
      {
        targetLevel: 2,
        successProbability: '1',
        attributeIncrease: '0.2',
        temperingStoneCost: '2',
        spiritStoneCost: '10',
        sameEquipmentCost: '0',
        protectionMaterialCost: '0',
        failureResult: 'KEEP_LEVEL',
        scope: 'MVP',
      },
    ] as const);

    const failResult = resolveTemperingAttempt({
      attemptId: 'attempt-005',
      equipmentInstanceId: 'eq-005',
      fromLevel: 0,
      targetLevel: 1,
      useProtectionMaterial: false,
      serverSeedHex: seedHex,
      configVersion: '2026.08.16.1',
      formulaVersion: 1,
    }, customRules);
    expect(failResult.success).toBe(false);
    expect(failResult.equipmentLevelAfter).toBe(0);

    const winResult = resolveTemperingAttempt({
      attemptId: 'attempt-006',
      equipmentInstanceId: 'eq-006',
      fromLevel: 1,
      targetLevel: 2,
      useProtectionMaterial: false,
      serverSeedHex: seedHex,
      configVersion: '2026.08.16.1',
      formulaVersion: 1,
    }, customRules);
    expect(winResult.success).toBe(true);
    expect(winResult.equipmentLevelAfter).toBe(2);

    expect(() => resolveTemperingAttempt({
      attemptId: 'attempt-007',
      equipmentInstanceId: 'eq-007',
      fromLevel: 0,
      targetLevel: 1,
      useProtectionMaterial: false,
      serverSeedHex: seedHex,
      configVersion: '2026.08.16.1',
      formulaVersion: 1,
      success: true,
    } as never, customRules)).toThrow('TEMPERING_CLIENT_RESULT_FORBIDDEN:success');
  });

  it('rejects invalid levels, missing continuity, and negative costs', () => {
    expect(() => resolveTemperingAttempt({
      attemptId: 'attempt-008',
      equipmentInstanceId: 'eq-008',
      fromLevel: -1,
      targetLevel: 0,
      useProtectionMaterial: false,
      serverSeedHex: seedHex,
      configVersion: '2026.08.16.1',
      formulaVersion: 1,
    })).toThrow('TEMPERING_FROM_LEVEL_INVALID');

    expect(() => createTemperingRules([
      {
        targetLevel: 1,
        successProbability: '0.5',
        attributeIncrease: '0.1',
        temperingStoneCost: '-1',
        spiritStoneCost: '0',
        sameEquipmentCost: '0',
        protectionMaterialCost: '0',
        failureResult: 'KEEP_LEVEL',
        scope: 'MVP',
      },
    ] as const)).toThrow('TEMPERING_TEMPERING_STONE_COST_NEGATIVE');

    expect(() => createTemperingRules([
      {
        targetLevel: 1,
        successProbability: '0.5',
        attributeIncrease: '0.1',
        temperingStoneCost: '1',
        spiritStoneCost: '0',
        sameEquipmentCost: '0',
        protectionMaterialCost: '0',
        failureResult: 'KEEP_LEVEL',
        scope: 'MVP',
      },
      {
        targetLevel: 3,
        successProbability: '0.5',
        attributeIncrease: '0.1',
        temperingStoneCost: '1',
        spiritStoneCost: '0',
        sameEquipmentCost: '0',
        protectionMaterialCost: '0',
        failureResult: 'KEEP_LEVEL',
        scope: 'MVP',
      },
    ] as const)).toThrow('TEMPERING_LEVEL_GAP:3');
  });

  it('keeps the outcome distribution in the expected range for a fixed sample', () => {
    let successCount = 0;
    for (let index = 0; index < 256; index += 1) {
      const result = resolveTemperingAttempt({
        attemptId: `attempt-${index}`,
        equipmentInstanceId: `eq-${index}`,
        fromLevel: 5,
        targetLevel: 6,
        useProtectionMaterial: false,
        serverSeedHex: seedHex,
        configVersion: '2026.08.16.1',
        formulaVersion: 1,
      });
      if (result.success) {
        successCount += 1;
      }
    }
    expect(successCount).toBeGreaterThan(30);
    expect(successCount).toBeLessThan(170);
  });
});

