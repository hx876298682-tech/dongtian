import { describe, expect, it } from 'vitest';

import type { TemperingAttemptResponse } from '@dongtian/contracts';

import { createInitialTemperingPageState, temperingPageReducer } from './tempering-reducer.js';

const response: TemperingAttemptResponse = {
  character_id: 'character-1',
  equipment_instance_id: 'eq-1',
  attempt_id: 'attempt-1',
  from_level: 5,
  target_level: 6,
  level_before: 5,
  level_after: 6,
  status: 'APPLIED',
  outcome: 'SUCCESS',
  success: true,
  success_probability: '0.34',
  attribute_increase: '0.065',
  random_audit: {
    namespace: 'equipment.tempering',
    attempt_key: 'attempt-1',
    seed_hex: '0123456789abcdef0123456789abcdef',
    roll: '0.12',
    success_probability: '0.34',
    formula_version: 1,
  },
  cost_snapshot: {
    tempering_stone_cost: '3',
    spirit_stone_cost: '283.97139999999996',
    same_equipment_cost: '100',
    protection_material_cost_requested: '0',
    protection_material_cost_spent: '0',
  },
  equipment: {
    instance_id: 'eq-1',
    item_id: 'item.t1.cuizhi_jian',
    temper_level: 6,
    bound: false,
    created_config_version: '2026.08.16.1',
  },
  asset_transaction_id: 'tx-1',
  temper_audit_id: 'audit-1',
  state_version: 12,
  config_version: '2026.08.16.1',
};

describe('tempering reducer', () => {
  it('tracks selection, pagination, keep flags, and attempt reuse', () => {
    const initial = createInitialTemperingPageState();
    const selected = temperingPageReducer(initial, { type: 'select-instance', instanceId: 'eq-1' });
    expect(selected.draft.selectedInstanceId).toBe('eq-1');
    expect(selected.draft.attemptId).toBeNull();

    const prepared = temperingPageReducer(selected, { type: 'prepare-attempt', attemptId: 'attempt-1' });
    expect(prepared.draft.attemptId).toBe('attempt-1');

    const kept = temperingPageReducer(prepared, { type: 'toggle-keep', instanceId: 'eq-1' });
    expect(kept.keptInstanceIds.has('eq-1')).toBe(true);

    const responseState = temperingPageReducer(kept, { type: 'mark-response', response });
    expect(responseState.lastResponse?.temper_audit_id).toBe('audit-1');
    expect(responseState.draft.attemptId).toBe('attempt-1');

    const target = temperingPageReducer(responseState, { type: 'set-target-level', targetLevel: 7 });
    expect(target.draft.targetLevel).toBe(7);
    expect(target.draft.attemptId).toBeNull();
  });
});
