import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { TemperingLadderTable, TemperingOutcomeCard } from './equipment-page.js';

describe('tempering page surfaces', () => {
  it('renders the lock ladder and result card without browser APIs', () => {
    const ladder = renderToStaticMarkup(createElement(TemperingLadderTable, { selectedTargetLevel: 6 }));
    const result = renderToStaticMarkup(
      createElement(TemperingOutcomeCard, {
        response: {
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
        },
        onRetry: () => undefined,
      }),
    );

    expect(ladder).toContain('+7 以上锁定');
    expect(result).toContain('audit-1');
    expect(result).toContain('相同 attempt_id 重试');
  });
});
